/**
 * `CommandService.submitBidDocument` end to end: a person's own bid document
 * becomes a real `Source` plus an option whose attribute records carry the
 * extracted values as PROPOSALS.
 *
 * Kept in its own file (the precedent `command-service.run-plan.test.ts`
 * sets) because it is the only suite here that needs the real
 * `bid-comparison` pack registered rather than the synthetic car-purchase
 * one every other `command-service.test.ts` case uses -- the attribute ids
 * this command writes (`bid.quoted_total`, ...) are that pack's, and a test
 * against a pack that does not declare them would prove nothing about
 * whether the option it produces is comparable.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AttributeRecord,
  CaseState,
  CommandReceipt,
  SubmittedBidDocumentReadBy,
} from '@sift/contracts';
import { MAX_BID_DOCUMENT_BYTES, MAX_CASE_ENTITIES } from '@sift/contracts';
import { compileBidComparisonPack, PackRegistry } from '@sift/packs';
import { bidComparisonCapabilityCatalog } from '../runtime/bid-comparison-engine.js';
import { createSequentialIdGenerator, fixedClock } from '../fixtures/synthetic-pack.js';
import { InMemoryActivityStore } from '../store/activity-store.js';
import { MemoryCaseStore } from '../store/memory-case-store.js';
import { COMMAND_NAMES, dispatchCommand } from '../routes/commands.js';
import { CommandService } from './command-service.js';

function requireOk(result: {
  status: string;
}): asserts result is { status: 'ok'; value: CommandReceipt } {
  if (result.status !== 'ok') {
    throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result)}`);
  }
}

function requireSnapshot(receipt: CommandReceipt): CaseState {
  if (receipt.snapshot === undefined) throw new Error('receipt has no snapshot');
  return receipt.snapshot;
}

/**
 * The five attributes a bid DOCUMENT states -- the ones extraction writes.
 * The command can also write credential and scope attributes, but only from
 * checks it runs itself; see the dedicated describe block for those.
 */
const DOCUMENT_ATTRIBUTE_IDS = [
  'bid.quoted_total',
  'bid.deposit_percent',
  'bid.start_weeks',
  'bid.duration_days',
  'bid.warranty_months',
];

/** A complete bid, in the shape the checked-in fixtures use. */
const FULL_BID_JSON = JSON.stringify({
  contractorName: 'Northgate Plumbing',
  licenseNumber: 'PL-4417-NG',
  total: { amount: 276000, currency: 'USD' },
  lineItems: [
    {
      scopeItemId: 'demo-existing',
      label: 'Demo of existing fixtures',
      amount: { amount: 176000, currency: 'USD' },
    },
    {
      scopeItemId: 'fixture-set-install',
      label: 'Set and connect all fixtures',
      amount: { amount: 100000, currency: 'USD' },
    },
  ],
  depositPercent: 25,
  warranty: { present: true, termMonths: 24, statedInWriting: true },
  startInWeeks: 3,
  durationWorkingDays: 45,
});

/** The same contractor, with the schedule, deposit and warranty simply absent from the document. */
const PARTIAL_BID_JSON = JSON.stringify({
  contractorName: 'Cedar & Sons',
  licenseNumber: 'PL-2210-CS',
  total: { amount: 241000, currency: 'USD' },
});

const LINE_ITEM_CSV = [
  'scopeItemId,label,amount,currency',
  'demo-existing,Demo of existing fixtures,22500,USD',
  'rough-in-supply,"Rough-in supply piping, all locations",48000,USD',
].join('\n');

/**
 * A licence number `packages/scenarios/fixtures/bids/license-registry.json`
 * holds no entry for, on an otherwise perfectly readable bid. The registry
 * MISS this exercises answers exactly one question ("is this licence on
 * file"), so the document's line items are deliberately given in prose only
 * -- no `scopeItemId` -- to keep this fixture from ALSO exercising the scope
 * check; the two are independent findings and each has its own dedicated
 * test below.
 */
const MISSING_LICENSE_BID_JSON = JSON.stringify({
  contractorName: 'Rustic Flow Plumbing',
  licenseNumber: 'PL-0000-ZZ',
  total: { amount: 198000, currency: 'USD' },
  lineItems: [
    {
      label: 'Set toilets and lavatories throughout both restrooms',
      amount: { amount: 198000, currency: 'USD' },
    },
  ],
});

/** States a real, stated field (so it is not the "nothing readable" refusal) but no licence number at all. */
const NO_LICENSE_BID_JSON = JSON.stringify({
  contractorName: 'Harbor Fixtures Co',
  total: { amount: 150000, currency: 'USD' },
});

/**
 * A registry HIT (Brightwater Mechanical's real, active licence,
 * `PL-9021-BW`) paired with line items that carry only a prose `label`, no
 * `scopeItemId`. Deliberately mixes the two so the scope-completeness
 * abstention test below proves the RIGHT thing: that a document which
 * successfully clears the credential checks can still leave
 * `bid.scope_completeness` untouched, rather than merely observing "nothing
 * was written" for a document that failed everything.
 */
const PROSE_LINE_ITEMS_BID_JSON = JSON.stringify({
  contractorName: 'Bayview Plumbing',
  licenseNumber: 'PL-9021-BW',
  total: { amount: 205000, currency: 'USD' },
  lineItems: [
    { label: 'Demo of existing restroom fixtures', amount: { amount: 90000, currency: 'USD' } },
    {
      label: 'Set new fixtures throughout both restrooms',
      amount: { amount: 115000, currency: 'USD' },
    },
  ],
});

/**
 * The exact live defect this file's fix exists to catch: "Harborline
 * Mechanical" states Northgate Plumbing's real, active, correctly-insured
 * licence `PL-4417-NG`. The licence itself is completely clean, so
 * `bid.license_status` and `bid.insurance_named_insured_match` still read
 * true facts about it -- but nothing on this document, or in the registry,
 * says Harborline IS Northgate, so `bid.credentials_valid` must not clear.
 */
const IMPERSONATING_BID_JSON = JSON.stringify({
  contractorName: 'Harborline Mechanical',
  licenseNumber: 'PL-4417-NG',
  total: { amount: 250000, currency: 'USD' },
});

/** A registry HIT (Northgate's real licence) with no `contractorName` stated at all -- nobody to attribute the licence to. */
const LICENSE_NO_CONTRACTOR_BID_JSON = JSON.stringify({
  licenseNumber: 'PL-4417-NG',
  total: { amount: 250000, currency: 'USD' },
});

/**
 * `bid-tworivers.json`'s own real discrepancy (see `license-lookup.ts`'s
 * header and `licenceHolderMatchesBidder`'s own docstring): the registry's
 * `licenseHolderName` for `PL-8801-TR` is "Two Rivers Mechanical Inc", a
 * corporate suffix away from the name this document states. Proves the
 * suffix-tolerant comparison end to end through the command, not just at
 * the helper's own unit-test level.
 */
const SUFFIX_TOLERANT_BID_JSON = JSON.stringify({
  contractorName: 'Two Rivers Mechanical',
  licenseNumber: 'PL-8801-TR',
  total: { amount: 240000, currency: 'USD' },
});

describe('CommandService.submitBidDocument', () => {
  let caseStore: MemoryCaseStore;
  let activityStore: InMemoryActivityStore;
  let service: CommandService;

  beforeEach(() => {
    caseStore = new MemoryCaseStore();
    activityStore = new InMemoryActivityStore();
    const registry = new PackRegistry();
    registry.register(compileBidComparisonPack(bidComparisonCapabilityCatalog(), fixedClock));
    service = new CommandService({
      caseStore,
      activityStore,
      registry,
      clock: fixedClock,
      idGenerator: createSequentialIdGenerator(),
    });
  });

  function startCase(): CaseState {
    const result = service.startDemo('cmd-start', { demoId: 'bid-comparison' });
    requireOk(result);
    return requireSnapshot(result.value);
  }

  function submit(
    snapshot: CaseState,
    document: {
      filename: string;
      format: string;
      text: string;
      sourceUrl?: string;
      /** Present only in the dedicated `readBy` describe block below -- every other call site omits it, exercising the identical, unchanged pre-existing behaviour. */
      readBy?: SubmittedBidDocumentReadBy;
    },
    overrides: { commandId?: string; optionId?: string; expectedSequence?: number } = {},
  ) {
    return service.submitBidDocument(overrides.commandId ?? 'cmd-doc', {
      caseId: snapshot.id,
      expectedSequence: overrides.expectedSequence ?? snapshot.eventSequence,
      ...(overrides.optionId !== undefined ? { optionId: overrides.optionId } : {}),
      document,
    });
  }

  const fullDocument = {
    filename: 'northgate-bid.json',
    format: 'application/json',
    text: FULL_BID_JSON,
  };

  describe('happy path (application/json)', () => {
    it('creates the document as a user-submitted, unverified Source and an option that cites it', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      const updated = requireSnapshot(result.value);

      // The submitted document is the FIRST source, and the only
      // `user_submitted` one. The rest of this case's rows are the checks
      // the import itself ran on that document (the registry lookup and the
      // scope diff), which are `origin: 'fixture'` -- asserted explicitly
      // below rather than by a bare count, so a future check being added
      // cannot quietly change what this test believes it is proving.
      const source = updated.sources[0];
      expect(source?.origin).toBe('user_submitted');
      expect(updated.sources.filter((row) => row.origin === 'user_submitted')).toHaveLength(1);
      expect(
        updated.sources
          .filter((row) => row.origin !== 'user_submitted')
          .every((row) => {
            return row.tags?.includes('import-check') === true;
          }),
      ).toBe(true);
      expect(source?.verification).toBe('unverified');
      expect(source?.title).toBe('northgate-bid.json');
      expect(source?.publisher).toBe('Northgate Plumbing');
      expect(source?.tags).toEqual(['bid-document', 'application/json']);
      // No web address was supplied, so a non-network URI names the stored
      // document rather than a fabricated one being invented for it.
      expect(source?.url).toBe(`sift://cases/${snapshot.id}/documents/${source?.id ?? ''}`);

      expect(updated.entities).toHaveLength(1);
      const entity = updated.entities[0];
      expect(entity?.kind).toBe('bid');
      expect(entity?.label).toBe('Northgate Plumbing');
      // The EXACT attribute set, not a superset check: every attribute a bid
      // DOCUMENT states, plus exactly the four the import's own two checks
      // produce for this document (it carries a registry-hit licence and job
      // scope ids -- both checks have their own describe block). An exact
      // set is what catches an attribute appearing that nothing asked for;
      // `bid.adjusted_total` in particular is in neither list and must never
      // appear.
      expect(Object.keys(entity?.attributes ?? {}).sort()).toEqual(
        [
          ...DOCUMENT_ATTRIBUTE_IDS,
          'bid.license_status',
          'bid.insurance_named_insured_match',
          'bid.credentials_valid',
          'bid.scope_completeness',
        ].sort(),
      );
    });

    it('carries every extracted value as a proposal with the extractor confidence', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      expect(attributes['bid.quoted_total']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        confidence: 0.9,
        value: { type: 'money', amount: 276000, currency: 'USD' },
      });
      expect(attributes['bid.deposit_percent']?.value).toEqual({
        type: 'number',
        value: 25,
        unit: '%',
      });
      expect(attributes['bid.start_weeks']?.value).toEqual({
        type: 'number',
        value: 3,
        unit: 'weeks',
      });
      expect(attributes['bid.duration_days']?.value).toEqual({
        type: 'number',
        value: 45,
        unit: 'days',
      });
      expect(attributes['bid.warranty_months']?.value).toEqual({
        type: 'number',
        value: 24,
        unit: 'months',
      });
    });

    it('stores what the document itself said as the source excerpt, never as an assertion', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      const source = requireSnapshot(result.value).sources[0];

      expect(source?.excerpt).toContain('License number stated: PL-4417-NG');
      expect(source?.excerpt).toContain('Line items (2):');
      expect(source?.summary).toBeUndefined();
    });

    it('records a real source URL when the submission carries one', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        ...fullDocument,
        sourceUrl: 'https://planroom.example/bids/northgate.json',
      });
      requireOk(result);
      expect(requireSnapshot(result.value).sources[0]?.url).toBe(
        'https://planroom.example/bids/northgate.json',
      );
    });
  });

  describe('the invariants extraction may never break', () => {
    function allRecords(snapshot: CaseState): AttributeRecord[] {
      return snapshot.entities.flatMap((entity) => Object.values(entity.attributes));
    }

    it('never writes a verified record, and never writes origin "user"', () => {
      const snapshot = startCase();
      for (const [index, document] of [FULL_BID_JSON, PARTIAL_BID_JSON].entries()) {
        const result = submit(
          caseStore.load(snapshot.id) ?? snapshot,
          { filename: `bid-${index}.json`, format: 'application/json', text: document },
          { commandId: `cmd-doc-${index}` },
        );
        requireOk(result);
      }
      const records = allRecords(caseStore.load(snapshot.id) ?? snapshot);

      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(record.origin).toBe('agent_proposed');
        expect(record.status).not.toBe('verified');
      }
    });

    it('gives every record produced by extraction the submitted document source id', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'partial.json',
        format: 'application/json',
        text: PARTIAL_BID_JSON,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const documentSourceId = updated.sources[0]?.id;
      const attributes = updated.entities[0]?.attributes ?? {};

      // Restricted to the five attributes a bid DOCUMENT states -- these are
      // the only records extraction itself produces, and each must cite
      // exactly the document it was read from.
      expect(documentSourceId).toBeDefined();
      for (const definitionId of DOCUMENT_ATTRIBUTE_IDS) {
        expect(attributes[definitionId]?.sourceIds).toEqual([documentSourceId]);
      }

      // The derived check this same submission also runs (`PARTIAL_BID_JSON`'s
      // licence, `PL-2210-CS`, is a registry MISS) is a finding about the
      // REGISTRY, not the document -- misattributing it to the document's own
      // source would be exactly as wrong as a value laundered into the wrong
      // origin. It must instead cite a real `Source` row on the case, tagged
      // as one of this import's own checks.
      const licenseStatus = attributes['bid.license_status'];
      expect(licenseStatus?.value).toEqual({ type: 'enum', value: 'not_found' });
      expect(licenseStatus?.sourceIds).not.toContain(documentSourceId);
      const caseSourceIds = new Set(updated.sources.map((source) => source.id));
      const citedSource = updated.sources.find((source) =>
        licenseStatus?.sourceIds.includes(source.id),
      );
      expect(licenseStatus?.sourceIds.every((id) => caseSourceIds.has(id))).toBe(true);
      expect(citedSource?.tags).toContain('import-check');
    });

    it('leaves an unstated field explicitly unknown, with no value and no fabricated zero', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'partial.json',
        format: 'application/json',
        text: PARTIAL_BID_JSON,
      });
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      for (const definitionId of [
        'bid.deposit_percent',
        'bid.start_weeks',
        'bid.duration_days',
        'bid.warranty_months',
      ]) {
        const record = attributes[definitionId];
        expect(record?.status).toBe('unknown');
        expect(record?.value).toBeUndefined();
        expect(record?.confidence).toBeUndefined();
      }
      // The one field this document does state is still read.
      expect(attributes['bid.quoted_total']?.status).toBe('supported');
      // Not a single stored value is a zero standing in for "not stated".
      expect(JSON.stringify(attributes)).not.toContain('"value":0');
    });

    // Renamed and re-targeted: `fullDocument` states a licence AND line items
    // that speak the job's scope vocabulary, so this command now legitimately
    // runs both of its own checks on it and writes three of these five ids --
    // it no longer proves "nothing it did not read", it would prove the
    // opposite. `NO_LICENSE_BID_JSON` states a real field (so it is not the
    // "nothing readable" refusal) but no licence number and no line items, so
    // neither check has anything to run on, and every one of the five must
    // stay absent.
    it('never writes a derived or looked-up attribute for a check it did not run', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'harbor-fixtures-bid.json',
        format: 'application/json',
        text: NO_LICENSE_BID_JSON,
      });
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      for (const definitionId of [
        'bid.adjusted_total',
        'bid.scope_completeness',
        'bid.license_status',
        'bid.insurance_named_insured_match',
        'bid.credentials_valid',
      ]) {
        expect(attributes[definitionId]).toBeUndefined();
      }
    });

    it('keeps the document contents out of the activity stream', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);

      const activity = activityStore.replayFrom(snapshot.id, 0);
      const summaries = activity.map((event) => event.summary).join(' | ');
      expect(summaries).toContain('northgate-bid.json');
      expect(summaries).toContain('5 proposed values, 0 left unknown');
      // Never the licence number, never a quoted amount.
      expect(summaries).not.toContain('PL-4417-NG');
      expect(summaries).not.toContain('276000');
    });
  });

  describe('text/csv', () => {
    it('imports a line-item table as a derived total and honest unknowns', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'bid-tab.csv',
        format: 'text/csv',
        text: LINE_ITEM_CSV,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const attributes = updated.entities[0]?.attributes ?? {};

      expect(attributes['bid.quoted_total']).toMatchObject({
        status: 'supported',
        confidence: 0.7,
        value: { type: 'money', amount: 70500, currency: 'USD' },
      });
      for (const definitionId of [
        'bid.deposit_percent',
        'bid.start_weeks',
        'bid.duration_days',
        'bid.warranty_months',
      ]) {
        expect(attributes[definitionId]?.status).toBe('unknown');
      }
      // A CSV names no contractor, so the file's own name is the label --
      // never an invented company.
      expect(updated.entities[0]?.label).toBe('bid-tab.csv');
      expect(updated.sources[0]?.publisher).toBeUndefined();
    });
  });

  describe('refusals', () => {
    it('rejects a malformed document and persists nothing (validation)', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'broken.json',
        format: 'application/json',
        text: '{ "contractorName": ',
      });

      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('unreachable');
      expect(result.message).toContain('could not be read as a bid');
      expect(result.issues.join(' ')).toContain('not valid JSON');
      const stored = caseStore.load(snapshot.id);
      expect(stored?.entities).toHaveLength(0);
      expect(stored?.sources).toHaveLength(0);
      expect(stored?.eventSequence).toBe(snapshot.eventSequence);
    });

    // The gap between these two: the malformed case above never PARSES, and
    // was already refused. This one parses perfectly and simply is not a bid
    // this extractor recognises -- valid JSON under different key names, or
    // the wrong file entirely. It used to report a successful import and
    // leave behind a candidate named after the file holding five attributes
    // and not one value, which then sat in the comparison being ranked
    // (found by pasting `quoted_total`/`contractor` instead of
    // `total`/`contractorName` into the real running app).
    it('rejects a well-formed document that states nothing it can read, and persists nothing', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'wrong-shape-bid.json',
        format: 'application/json',
        // Valid JSON, plausible-looking bid, every key under a name this
        // extractor does not know.
        text: JSON.stringify({
          contractor: 'Harborline Mechanical',
          quoted_total: { amount: 268400, currency: 'USD' },
          deposit_percent: 20,
          line_items: [{ description: 'Demo and haul-off', amount: 12000 }],
        }),
      });

      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('unreachable');
      expect(result.message).toContain('Nothing in "wrong-shape-bid.json" could be read as a bid');
      const stored = caseStore.load(snapshot.id);
      expect(stored?.entities).toHaveLength(0);
      expect(stored?.sources).toHaveLength(0);
      expect(stored?.eventSequence).toBe(snapshot.eventSequence);
    });

    // The other side of that boundary, asserted here so the refusal above can
    // never be widened into "refuse anything incomplete". A bid missing most
    // of its required fields is a case Sift exists to carry: it records each
    // gap as an explicit unknown and says so. Only reading NOTHING means the
    // wrong document.
    it('still accepts a document it can read only one field from, recording the rest as unknown', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'thin-bid.json',
        format: 'application/json',
        text: JSON.stringify({
          contractorName: 'Thin Bid Co',
          total: { amount: 100, currency: 'USD' },
        }),
      });

      expect(result.status).toBe('ok');
      const stored = caseStore.load(snapshot.id);
      expect(stored?.entities).toHaveLength(1);
      const entity = stored?.entities[0];
      expect(entity?.label).toBe('Thin Bid Co');
      expect(entity?.attributes['bid.quoted_total']?.status).toBe('supported');
      for (const unread of [
        'bid.deposit_percent',
        'bid.start_weeks',
        'bid.duration_days',
        'bid.warranty_months',
      ]) {
        expect(entity?.attributes[unread]?.status).toBe('unknown');
        expect(entity?.attributes[unread]?.value).toBeUndefined();
      }
    });

    it('rejects a document above the byte cap at the schema boundary (validation)', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'huge.json',
        format: 'application/json',
        text: `{"note":"${'a'.repeat(MAX_BID_DOCUMENT_BYTES)}"}`,
      });

      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('unreachable');
      expect(result.message).toContain('Invalid submitBidDocument input.');
      expect(caseStore.load(snapshot.id)?.sources).toHaveLength(0);
    });

    it('rejects a format the deterministic extractor cannot read (validation)', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'bid.txt',
        format: 'text/plain',
        text: 'We will do the work for about two hundred and seventy six thousand dollars.',
      });
      expect(result.status).toBe('validation');
    });

    it('refuses a document whose renderable text carries markup rather than storing it', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'hostile.json',
        format: 'application/json',
        text: JSON.stringify({
          contractorName: '<script>alert(1)</script>',
          total: { amount: 1, currency: 'USD' },
        }),
      });

      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('unreachable');
      expect(result.message).toContain('could not be stored as');
      expect(caseStore.load(snapshot.id)?.sources).toHaveLength(0);
    });

    it('returns not_found for a missing case', () => {
      const result = service.submitBidDocument('cmd-doc', {
        caseId: 'missing',
        expectedSequence: 0,
        document: fullDocument,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument, {
        expectedSequence: snapshot.eventSequence + 5,
      });
      expect(result.status).toBe('conflict');
    });

    it('refuses to exceed the case option cap', () => {
      const snapshot = startCase();
      const full: CaseState = {
        ...snapshot,
        entities: Array.from({ length: MAX_CASE_ENTITIES }, (_unused, index) => ({
          id: `filler-${index}`,
          kind: 'bid',
          label: `Filler ${index}`,
          attributes: {},
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
        })),
      };
      const cappedService = new CommandService({
        caseStore: {
          load: () => full,
          append: caseStore.append.bind(caseStore),
          updateSelection: caseStore.updateSelection.bind(caseStore),
          peekIdempotent: caseStore.peekIdempotent.bind(caseStore),
          subscribe: caseStore.subscribe.bind(caseStore),
          resetDemo: caseStore.resetDemo.bind(caseStore),
        },
        activityStore,
        registry: new PackRegistry(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = cappedService.submitBidDocument('cmd-capped', {
        caseId: snapshot.id,
        expectedSequence: full.eventSequence,
        document: fullDocument,
      });
      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('unreachable');
      expect(result.message).toContain(`maximum of ${MAX_CASE_ENTITIES} options`);
    });
  });

  describe('idempotency and re-reads', () => {
    it('replays a retried submission without adding a second option or source', () => {
      const snapshot = startCase();
      const first = submit(snapshot, fullDocument);
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      // Captured rather than hardcoded: `fullDocument` also mints the two
      // checks' own `Source` rows (a registry hit, a scope diff) alongside the
      // document's, so a fixed "1" would silently stop meaning "no duplicate"
      // the moment a check is added, removed, or changes how many sources it
      // mints.
      const entityCountAfterFirst = afterFirst.entities.length;
      const sourceCountAfterFirst = afterFirst.sources.length;
      expect(entityCountAfterFirst).toBe(1);

      const second = submit(snapshot, fullDocument);
      requireOk(second);

      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
      const stored = caseStore.load(snapshot.id);
      expect(stored?.entities).toHaveLength(entityCountAfterFirst);
      expect(stored?.sources).toHaveLength(sourceCountAfterFirst);
    });

    it('merges a corrected re-read into the option instead of replacing its attribute map', () => {
      const snapshot = startCase();
      const first = submit(snapshot, {
        filename: 'partial.json',
        format: 'application/json',
        text: PARTIAL_BID_JSON,
      });
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      const optionId = afterFirst.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected an option id');

      // A derivation another part of the system owns, written between the two
      // reads. `bid.adjusted_total` is the right probe here specifically: it
      // is the one derived attribute NO import path this command runs ever
      // touches (`buildDerivedBidAttributes`'s own doc comment -- normalizing
      // a total means supplying a plug number for every unpriced scope item,
      // which is a person's judgment, not a lookup), unlike
      // `bid.scope_completeness`, which `FULL_BID_JSON`'s own line items now
      // legitimately re-derive and so can no longer prove a
      // replace-the-whole-map import would destroy a value the import itself
      // never looked at.
      const derived = service.setOptionAttribute('cmd-derived', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: afterFirst.eventSequence,
        attribute: {
          definitionId: 'bid.adjusted_total',
          value: { type: 'money', amount: 281000, currency: 'USD' },
          status: 'supported',
          origin: 'agent_proposed',
          sourceIds: ['source-derived'],
        },
      });
      requireOk(derived);

      const corrected = submit(
        requireSnapshot(derived.value),
        { filename: 'corrected.json', format: 'application/json', text: FULL_BID_JSON },
        { commandId: 'cmd-doc-2', optionId },
      );
      requireOk(corrected);
      const final = requireSnapshot(corrected.value);

      expect(final.entities).toHaveLength(1);
      const attributes = final.entities[0]?.attributes ?? {};
      // The re-read filled in what the first document did not state...
      expect(attributes['bid.start_weeks']?.status).toBe('supported');
      // ...without deleting the derivation it never looked at.
      expect(attributes['bid.adjusted_total']).toMatchObject({
        value: { type: 'money', amount: 281000, currency: 'USD' },
        origin: 'agent_proposed',
        status: 'supported',
        sourceIds: ['source-derived'],
      });
      // Two DOCUMENTS were submitted, and the second correction is a real
      // registry hit (`PL-4417-NG`) with line items that speak the job's
      // scope vocabulary, so it mints its own check sources too: the first
      // read's document plus its registry-miss source (2), then the second
      // read's document plus its registry-hit pair and its scope-check source
      // (4) -- still exactly one document `Source` per submission, never a
      // duplicate for the one option.
      expect(final.sources.filter((source) => source.tags?.includes('bid-document'))).toHaveLength(
        2,
      );
      expect(final.sources).toHaveLength(6);
      expect(final.entities[0]?.label).toBe('Northgate Plumbing');
    });
  });

  // `keepingUserValues` (command-service.ts): a re-read re-runs this
  // command's own checks, so it must refresh a stale proposal of its own --
  // but `origin: 'user'` is not a stale proposal, it is a person's answer,
  // and an automatic check overwriting it is the same defect in the other
  // direction as a save laundering a sourced value into a user assertion.
  describe('keepingUserValues: a re-read may refresh its own proposal, but never overwrites a person', () => {
    it("never lets a re-read's check overwrite a person's value for the same attribute", () => {
      const snapshot = startCase();
      const first = submit(snapshot, {
        filename: 'partial.json',
        format: 'application/json',
        text: PARTIAL_BID_JSON,
      });
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      const optionId = afterFirst.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected an option id');

      // The person looks at the option and answers two fields the import's
      // own checks would otherwise compute -- no `origin` supplied, so both
      // record as `origin: 'user'` (`SetOptionAttributeInputSchema`'s own
      // default, the same one `upsertOption` uses).
      const userScope = service.setOptionAttribute('cmd-user-scope', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: afterFirst.eventSequence,
        attribute: {
          definitionId: 'bid.scope_completeness',
          value: { type: 'number', value: 90, unit: '%' },
        },
      });
      requireOk(userScope);
      const afterUserScope = requireSnapshot(userScope.value);

      const userCredentials = service.setOptionAttribute('cmd-user-credentials', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: afterUserScope.eventSequence,
        attribute: {
          definitionId: 'bid.credentials_valid',
          value: { type: 'boolean', value: false },
        },
      });
      requireOk(userCredentials);
      const afterUserValues = requireSnapshot(userCredentials.value);

      // `FULL_BID_JSON` is a registry HIT (`PL-4417-NG`) with line items that
      // price 2 of the job's 8 required scope items -- run on its own this
      // would compute `bid.scope_completeness: 25` and
      // `bid.credentials_valid: true`. Neither may land: a person already
      // answered both.
      const reread = submit(
        afterUserValues,
        { filename: 'corrected.json', format: 'application/json', text: FULL_BID_JSON },
        { commandId: 'cmd-doc-reread', optionId },
      );
      requireOk(reread);
      const attributes = requireSnapshot(reread.value).entities[0]?.attributes ?? {};

      expect(attributes['bid.scope_completeness']).toMatchObject({
        origin: 'user',
        value: { type: 'number', value: 90, unit: '%' },
      });
      expect(attributes['bid.credentials_valid']).toMatchObject({
        origin: 'user',
        value: { type: 'boolean', value: false },
      });
    });

    it('does refresh its own earlier proposal on a re-read -- the guard targets people, not every prior value', () => {
      const snapshot = startCase();
      const first = submit(snapshot, {
        filename: 'partial.json',
        format: 'application/json',
        text: PARTIAL_BID_JSON,
      });
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      const optionId = afterFirst.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected an option id');

      // Same interleaved write as the guard test above, but `origin:
      // 'agent_proposed'` this time -- standing in for an earlier run of this
      // command's own scope check, not a person's answer.
      const agentScope = service.setOptionAttribute('cmd-agent-scope', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: afterFirst.eventSequence,
        attribute: {
          definitionId: 'bid.scope_completeness',
          value: { type: 'number', value: 87.5, unit: '%' },
          status: 'supported',
          origin: 'agent_proposed',
          sourceIds: ['source-derived'],
        },
      });
      requireOk(agentScope);
      const afterAgentScope = requireSnapshot(agentScope.value);

      const reread = submit(
        afterAgentScope,
        { filename: 'corrected.json', format: 'application/json', text: FULL_BID_JSON },
        { commandId: 'cmd-doc-reread', optionId },
      );
      requireOk(reread);
      const attributes = requireSnapshot(reread.value).entities[0]?.attributes ?? {};

      // If this asserted 87.5 (the stale proposal) instead, the guard tested
      // above could be "fixed" into never refreshing anything at all --
      // pairing the two tests is what stops that.
      expect(attributes['bid.scope_completeness']).toMatchObject({
        origin: 'agent_proposed',
        value: { type: 'number', value: 25, unit: '%' },
      });
    });

    it("does not guard the document's own read values -- a re-read is the person choosing that document's reading", () => {
      const snapshot = startCase();
      const first = submit(snapshot, fullDocument);
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      const optionId = afterFirst.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected an option id');

      // The person overrides what the document said -- no `origin` supplied,
      // so this records `origin: 'user'`.
      const userQuotedTotal = service.setOptionAttribute('cmd-user-quoted-total', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: afterFirst.eventSequence,
        attribute: {
          definitionId: 'bid.quoted_total',
          value: { type: 'money', amount: 300000, currency: 'USD' },
        },
      });
      requireOk(userQuotedTotal);
      const afterUserValue = requireSnapshot(userQuotedTotal.value);
      expect(afterUserValue.entities[0]?.attributes['bid.quoted_total']?.origin).toBe('user');

      // `keepingUserValues` (command-service.ts, see its own doc comment) is
      // applied to the CHECKS only, not to the five attributes a bid document
      // states about itself: handing over the same document again for this
      // option is the person choosing its reading, so that reading is
      // entitled to replace one they typed earlier -- deliberately, not an
      // oversight.
      const reread = submit(afterUserValue, fullDocument, {
        commandId: 'cmd-doc-reread',
        optionId,
      });
      requireOk(reread);
      const attributes = requireSnapshot(reread.value).entities[0]?.attributes ?? {};

      expect(attributes['bid.quoted_total']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'money', amount: 276000, currency: 'USD' },
      });
    });
  });

  // `buildDerivedBidAttributes`/`buildCredentialAttributes`/
  // `buildScopeCompleteness`: the two checks `submitBidDocument` now
  // PERFORMS itself (a licence-registry lookup, a scope diff against the
  // job's own required items) and is therefore entitled to report, as
  // distinct from the five attributes covered above that a bid DOCUMENT
  // states about itself.
  describe('the two checks this command performs itself (registry lookup, scope diff)', () => {
    /**
     * The submitted document's own `Source` -- distinct from the registry/
     * scope-check rows this command additionally mints, which are tagged
     * `'import-check'` instead of `'bid-document'`.
     */
    function documentSourceOf(snapshot: CaseState) {
      const source = snapshot.sources.find((candidate) => candidate.tags?.includes('bid-document'));
      if (source === undefined) throw new Error('expected a bid-document source');
      return source;
    }

    /**
     * The general invariant item 7 of this task asks for: every `sourceId`
     * any attribute on the case cites must resolve to a real `Source` row on
     * that same case. Written as a sweep over the whole entity rather than a
     * hardcoded id list -- the failure mode this guards against is exactly
     * the one already found elsewhere in this repo: a seeded case that cites
     * 60 source ids while holding 0 `Source` rows.
     */
    function assertEverySourceIdResolves(snapshot: CaseState): void {
      const sourceIds = new Set(snapshot.sources.map((source) => source.id));
      for (const entity of snapshot.entities) {
        for (const record of Object.values(entity.attributes)) {
          for (const sourceId of record.sourceIds) {
            expect(
              sourceIds.has(sourceId),
              `attribute "${record.definitionId}" cites source "${sourceId}", which is not a Source on this case`,
            ).toBe(true);
          }
        }
      }
    }

    it('on a registry hit, writes license_status/insurance_named_insured_match/credentials_valid as agent_proposed, never verified', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      expect(attributes['bid.license_status']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'enum', value: 'active' },
      });
      expect(attributes['bid.insurance_named_insured_match']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'boolean', value: true },
      });
      // The identical four-way derivation `seeds.ts` uses for the seeded
      // twelve bids: Northgate's real registry entry clears all four, so an
      // imported Northgate bid and the seeded one mean the same thing here.
      expect(attributes['bid.credentials_valid']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'boolean', value: true },
      });

      for (const definitionId of [
        'bid.license_status',
        'bid.insurance_named_insured_match',
        'bid.credentials_valid',
      ]) {
        expect(attributes[definitionId]?.status).not.toBe('verified');
      }
    });

    it('on a registry hit whose stated contractorName does NOT match the licence holder, still writes license_status/insurance_named_insured_match but leaves credentials_valid an explicit unknown -- never a fabricated false', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'harborline-bid.json',
        format: 'application/json',
        text: IMPERSONATING_BID_JSON,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const attributes = updated.entities[0]?.attributes ?? {};

      // The licence itself is a genuinely clean record -- these two are
      // true facts about PL-4417-NG regardless of who cited it, so they are
      // written exactly as they would be for the real Northgate bid.
      expect(attributes['bid.license_status']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'enum', value: 'active' },
      });
      expect(attributes['bid.insurance_named_insured_match']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'boolean', value: true },
      });

      // But the combined gate cannot be signed off either way: "Harborline
      // Mechanical" is not "Northgate Plumbing" by any normalisation this
      // command trusts, so this is an honest abstention, not a verdict.
      const credentialsValid = attributes['bid.credentials_valid'];
      expect(credentialsValid).toBeDefined();
      expect(credentialsValid?.origin).toBe('agent_proposed');
      expect(credentialsValid?.status).toBe('unknown');
      expect(credentialsValid?.value).toBeUndefined();

      // A reader must be able to see WHY: some source this attribute cites
      // names both the bidder as stated and the licence holder of record.
      const citedSources = updated.sources.filter((source) =>
        credentialsValid?.sourceIds.includes(source.id),
      );
      const discrepancySource = citedSources.find(
        (source) =>
          source.excerpt?.includes('Harborline Mechanical') &&
          source.excerpt?.includes('Northgate Plumbing'),
      );
      expect(discrepancySource).toBeDefined();
    });

    it('on a registry hit whose document states a licence but no contractorName at all, leaves credentials_valid an explicit unknown -- nobody to attribute the licence to', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'unnamed-bidder-bid.json',
        format: 'application/json',
        text: LICENSE_NO_CONTRACTOR_BID_JSON,
      });
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      // Still a real, clean licence -- those facts are written.
      expect(attributes['bid.license_status']?.value).toEqual({ type: 'enum', value: 'active' });
      expect(attributes['bid.insurance_named_insured_match']?.value).toEqual({
        type: 'boolean',
        value: true,
      });

      const credentialsValid = attributes['bid.credentials_valid'];
      expect(credentialsValid).toBeDefined();
      expect(credentialsValid?.status).toBe('unknown');
      expect(credentialsValid?.value).toBeUndefined();
    });

    it('tolerates the "Two Rivers Mechanical" / "Two Rivers Mechanical Inc" corporate-suffix difference end to end -- credentials_valid IS written, not left unknown', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'two-rivers-bid.json',
        format: 'application/json',
        text: SUFFIX_TOLERANT_BID_JSON,
      });
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      // PL-8801-TR's own named-insured mismatch ("TRM Holdings LLC" vs.
      // "Two Rivers Mechanical Inc") is Two Rivers' real, distinct failure
      // reason -- so credentials_valid is written `false`, not left
      // unknown: the suffix tolerance let this command reach a real
      // verdict instead of abstaining on a corporate-suffix false alarm.
      expect(attributes['bid.insurance_named_insured_match']).toMatchObject({
        status: 'supported',
        value: { type: 'boolean', value: false },
      });
      expect(attributes['bid.credentials_valid']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'boolean', value: false },
      });
    });

    it('on a registry miss, records not_found plus two explicit unknowns -- never a fabricated false', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'rustic-flow-bid.json',
        format: 'application/json',
        text: MISSING_LICENSE_BID_JSON,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const attributes = updated.entities[0]?.attributes ?? {};

      expect(attributes['bid.license_status']).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'enum', value: 'not_found' },
      });
      // "We could not find this licence" and "we checked and these
      // credentials are bad" are different findings -- only the second would
      // be fair to score against a contractor, so a miss must never
      // manufacture the other two as a fabricated `false`.
      //
      // They are written as explicit UNKNOWNS rather than left off the
      // option, because the check genuinely ran: the registry simply holds
      // no record to compare against. An absent attribute would read as
      // "never attempted", which is a different and untrue thing, and it is
      // the same distinction the extractor already draws for a field a
      // document was searched for and did not state. Each still cites the
      // miss source, so the case records WHAT was searched.
      for (const definitionId of ['bid.insurance_named_insured_match', 'bid.credentials_valid']) {
        const record = attributes[definitionId];
        expect(record?.status).toBe('unknown');
        expect(record?.value).toBeUndefined();
        expect(record?.origin).toBe('agent_proposed');
        expect(record?.sourceIds?.length).toBeGreaterThan(0);
      }

      const missSource = updated.sources.find((source) =>
        source.excerpt?.includes(
          'No entry in the contractor licence registry matches licence "PL-0000-ZZ".',
        ),
      );
      expect(missSource).toBeDefined();
      expect(attributes['bid.license_status']?.sourceIds).toEqual([missSource?.id]);
    });

    it('writes none of the three credential attributes when the document states no licence number at all', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'harbor-fixtures-bid.json',
        format: 'application/json',
        text: NO_LICENSE_BID_JSON,
      });
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      for (const definitionId of [
        'bid.license_status',
        'bid.insurance_named_insured_match',
        'bid.credentials_valid',
      ]) {
        expect(attributes[definitionId]).toBeUndefined();
      }
    });

    it("computes scope_completeness as a PERCENTAGE NUMBER -- 2 of the job's 8 required scope items priced is 25, not 0.25", () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const documentSource = documentSourceOf(updated);
      const attribute = updated.entities[0]?.attributes['bid.scope_completeness'];

      expect(attribute).toMatchObject({
        origin: 'agent_proposed',
        status: 'supported',
        value: { type: 'number', value: 25, unit: '%' },
      });
      expect(attribute?.status).not.toBe('verified');
      // Cites a check this command ran ON the submitted document, not the
      // document's own source id.
      expect(attribute?.sourceIds).toEqual([`source-scope-check-${documentSource.id}`]);
    });

    // The single most important behaviour to lock down: a document whose
    // line items carry no `scopeItemId` speaks no vocabulary `diffBidScope`
    // can join against -- these are the job's own private ids
    // (`demo-existing`, `permits-inspections`, ...), not an industry
    // standard. Running the diff anyway would classify every required item
    // "absent" and report a confident near-zero completeness for a bid that
    // may price the entire job -- a fabricated reading. The honest report of
    // a check that could not be run is silence, not a number that merely
    // happens to be small.
    it('abstains from scope_completeness when no line item carries a scopeItemId, even though the credential checks (same document) still run', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'bayview-bid.json',
        format: 'application/json',
        text: PROSE_LINE_ITEMS_BID_JSON,
      });
      requireOk(result);
      const attributes = requireSnapshot(result.value).entities[0]?.attributes ?? {};

      // Proves this is a genuine abstention, not a side effect of the whole
      // import having failed to run any checks: the licence on this exact
      // document DOES resolve, and its credential attributes ARE written.
      expect(attributes['bid.license_status']?.value).toEqual({ type: 'enum', value: 'active' });

      expect(attributes['bid.scope_completeness']).toBeUndefined();
      // Not merely absent by accident of a missing key -- no record anywhere
      // on the entity holds a fabricated 0/0% standing in for "the check
      // never ran".
      expect(JSON.stringify(attributes)).not.toContain('"value":0');
    });

    it('never writes bid.adjusted_total from any of these paths (hit, miss, no licence, or the scope abstention)', () => {
      const documents = [
        fullDocument,
        {
          filename: 'rustic-flow-bid.json',
          format: 'application/json',
          text: MISSING_LICENSE_BID_JSON,
        },
        {
          filename: 'harbor-fixtures-bid.json',
          format: 'application/json',
          text: NO_LICENSE_BID_JSON,
        },
        {
          filename: 'bayview-bid.json',
          format: 'application/json',
          text: PROSE_LINE_ITEMS_BID_JSON,
        },
      ];
      for (const [index, document] of documents.entries()) {
        const snapshot = startCase();
        const result = submit(snapshot, document, { commandId: `cmd-adjusted-${index}` });
        requireOk(result);
        expect(
          requireSnapshot(result.value).entities[0]?.attributes['bid.adjusted_total'],
        ).toBeUndefined();
      }
    });

    it('cites only sourceIds that resolve to a real Source on the case -- registry hit plus a scope match', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      assertEverySourceIdResolves(requireSnapshot(result.value));
    });

    it('cites only sourceIds that resolve to a real Source on the case -- registry miss', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'rustic-flow-bid.json',
        format: 'application/json',
        text: MISSING_LICENSE_BID_JSON,
      });
      requireOk(result);
      assertEverySourceIdResolves(requireSnapshot(result.value));
    });

    it('does not duplicate the registry Source rows when a corrected document for the same licence is re-imported', () => {
      const snapshot = startCase();
      const first = submit(snapshot, fullDocument);
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      const optionId = afterFirst.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected an option id');

      const licenseSourceIds = [
        'source-license-pl-4417-ng',
        'source-license-pl-4417-ng-named-insured',
      ];
      for (const id of licenseSourceIds) {
        expect(afterFirst.sources.filter((source) => source.id === id)).toHaveLength(1);
      }

      // Standing in for a corrected re-upload of the same contractor's bid:
      // same licence number, submitted again against the same option.
      const corrected = submit(
        afterFirst,
        {
          filename: 'northgate-bid-corrected.json',
          format: 'application/json',
          text: FULL_BID_JSON,
        },
        { commandId: 'cmd-doc-corrected', optionId },
      );
      requireOk(corrected);
      const final = requireSnapshot(corrected.value);

      // Two document sources now (the original upload and the correction),
      // but still exactly one registry row and one insurance row for this
      // licence -- re-running the same lookup must not accumulate duplicate
      // evidence.
      for (const id of licenseSourceIds) {
        expect(final.sources.filter((source) => source.id === id)).toHaveLength(1);
      }
    });
  });

  describe('transport wiring', () => {
    it('is reachable through the same command table the HTTP route dispatches on', () => {
      expect(COMMAND_NAMES).toContain('submitBidDocument');

      const snapshot = startCase();
      const result = dispatchCommand(service, 'submitBidDocument', 'cmd-routed', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        document: fullDocument,
      });
      requireOk(result);
      expect(requireSnapshot(result.value).entities).toHaveLength(1);
    });
  });

  /**
   * `readBy`: a model's reading of a PDF is a WEAKER claim than a labelled
   * field in a machine-readable file, and must not borrow that field's
   * confidence, title, or tagging -- see `SubmittedBidDocumentReadBySchema`
   * (`@sift/contracts`) and `MODEL_READ_ATTRIBUTE_CONFIDENCE`
   * (`command-service.ts`) for the full reasoning. This block proves the
   * marker's every consequence, and its own absence, side by side against
   * the identical `fullDocument`/`FULL_BID_JSON` fixture the "happy path"
   * describe block above already exercises without it.
   */
  describe('readBy: a model reading of a PDF', () => {
    const modelReadFilename = 'northgate-bid.pdf';
    const readBy: SubmittedBidDocumentReadBy = {
      agent: 'model',
      modelId: 'test-model-v1',
      originalFilename: modelReadFilename,
      originalFormat: 'application/pdf',
    };

    it("caps every read field's confidence at the single lower model-read value (0.4), never the extractor's own tiers", () => {
      const snapshot = startCase();
      const result = submit(snapshot, { ...fullDocument, readBy });
      requireOk(result);
      const entity = requireSnapshot(result.value).entities[0];

      // Every field `FULL_BID_JSON` states would otherwise earn
      // `STATED_FIELD_CONFIDENCE` (0.9) from the deterministic extractor --
      // confirmed by the sibling "readBy absent" test below, which asserts
      // exactly that value for the IDENTICAL document. With `readBy`
      // present, every one of them is capped at 0.4 instead: lower than
      // every tier the extractor can produce, never higher.
      for (const definitionId of DOCUMENT_ATTRIBUTE_IDS) {
        expect(entity?.attributes[definitionId]?.confidence).toBe(0.4);
      }
    });

    it('leaves confidence, title, and tags exactly as before when readBy is absent (existing behaviour intact)', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const entity = updated.entities[0];

      for (const definitionId of DOCUMENT_ATTRIBUTE_IDS) {
        expect(entity?.attributes[definitionId]?.confidence).toBe(0.9);
      }
      const source = updated.sources[0];
      expect(source?.title).toBe(fullDocument.filename);
      expect(source?.tags).toEqual(['bid-document', 'application/json']);
      expect(source?.excerpt ?? '').not.toContain('model');
    });

    it('does not add a confidence to derived/registry-lookup attributes, which never carried one to begin with', () => {
      const snapshot = startCase();
      const result = submit(snapshot, { ...fullDocument, readBy });
      requireOk(result);
      const entity = requireSnapshot(result.value).entities[0];
      // `FULL_BID_JSON` cites Northgate's own real, active licence
      // (`PL-4417-NG`) -- the registry lookup still runs identically with
      // `readBy` present, but `buildDerivedBidAttributes`'s `add()` never
      // sets a `confidence` at all, with or without this marker.
      expect(entity?.attributes['bid.license_status']).toBeDefined();
      expect(entity?.attributes['bid.license_status']?.confidence).toBeUndefined();
      expect(entity?.attributes['bid.credentials_valid']?.confidence).toBeUndefined();
    });

    it('titles the Source with readBy.originalFilename, never the (possibly synthesised) document.filename', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        ...fullDocument,
        // Deliberately NOT the PDF's own name, to prove the title is read
        // from `readBy.originalFilename` independently rather than merely
        // happening to agree with it.
        filename: 'imported-reading.json',
        readBy: { ...readBy, originalFilename: 'northgate-bid-original.pdf' },
      });
      requireOk(result);
      expect(requireSnapshot(result.value).sources[0]?.title).toBe('northgate-bid-original.pdf');
    });

    it('tags the Source with the ORIGINAL PDF format and a model-read marker, not the synthesised application/json format', () => {
      const snapshot = startCase();
      const result = submit(snapshot, { ...fullDocument, readBy });
      requireOk(result);
      expect(requireSnapshot(result.value).sources[0]?.tags).toEqual([
        'bid-document',
        'application/pdf',
        'model-read',
      ]);
    });

    it("states in the Source excerpt that the reading is a model's and unverified", () => {
      const snapshot = startCase();
      const result = submit(snapshot, { ...fullDocument, readBy });
      requireOk(result);
      const excerpt = requireSnapshot(result.value).sources[0]?.excerpt ?? '';
      expect(excerpt).toContain('test-model-v1');
      expect(excerpt).toContain(modelReadFilename);
      expect(excerpt.toLowerCase()).toContain('unverified');
      expect(excerpt.toLowerCase()).toContain('model');
    });

    it('never lets a model-read attribute claim an origin other than agent_proposed, or a status of verified', () => {
      const snapshot = startCase();
      const result = submit(snapshot, { ...fullDocument, readBy });
      requireOk(result);
      const entity = requireSnapshot(result.value).entities[0];
      for (const record of Object.values(entity?.attributes ?? {})) {
        expect(record.origin).toBe('agent_proposed');
        expect(record.status).not.toBe('verified');
      }
    });

    it('still applies the zero-field guard identically when readBy is present', () => {
      const snapshot = startCase();
      const result = submit(snapshot, {
        filename: 'blank.pdf',
        format: 'application/json',
        text: '{}',
        readBy: { ...readBy, originalFilename: 'blank.pdf' },
      });
      expect(result.status).toBe('validation');
    });
  });
});
