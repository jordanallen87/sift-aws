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
import type { AttributeRecord, CaseState, CommandReceipt } from '@sift/contracts';
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

/** The five attributes a bid DOCUMENT states, and the only ones this command ever writes. */
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
    document: { filename: string; format: string; text: string; sourceUrl?: string },
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

      expect(updated.sources).toHaveLength(1);
      const source = updated.sources[0];
      expect(source?.origin).toBe('user_submitted');
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
      expect(Object.keys(entity?.attributes ?? {}).sort()).toEqual(
        [...DOCUMENT_ATTRIBUTE_IDS].sort(),
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
      const sourceId = updated.sources[0]?.id;

      expect(sourceId).toBeDefined();
      for (const record of allRecords(updated)) {
        expect(record.sourceIds).toEqual([sourceId]);
      }
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

    it('never writes the derived or looked-up attributes it did not read', () => {
      const snapshot = startCase();
      const result = submit(snapshot, fullDocument);
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
      const second = submit(snapshot, fullDocument);
      requireOk(second);

      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
      const stored = caseStore.load(snapshot.id);
      expect(stored?.entities).toHaveLength(1);
      expect(stored?.sources).toHaveLength(1);
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

      // A derivation another part of the system owns, written between the
      // two reads. A replace-the-whole-map import would destroy it.
      const derived = service.setOptionAttribute('cmd-derived', {
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
      expect(attributes['bid.scope_completeness']?.value).toEqual({
        type: 'number',
        value: 87.5,
        unit: '%',
      });
      // Two documents, two sources; the second option was never created.
      expect(final.sources).toHaveLength(2);
      expect(final.entities[0]?.label).toBe('Northgate Plumbing');
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
});
