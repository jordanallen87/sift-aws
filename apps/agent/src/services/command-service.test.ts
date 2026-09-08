import { beforeEach, describe, expect, it } from 'vitest';
import type {
  CaseEvent,
  CaseState,
  CommandReceipt,
  EnergyBillFeedCheckResult,
  EntityRecord,
} from '@sift/contracts';
import { compileHomeEnergyGuardianPack, compilePack, PackRegistry } from '@sift/packs';
import { evaluateReadiness } from '@sift/core';
import {
  createRegistryWithSyntheticPack,
  createSequentialIdGenerator,
  fixedClock,
  FIXED_NOW,
  syntheticCarPurchaseManifest,
  syntheticCatalog,
} from '../fixtures/synthetic-pack.js';
import { homeEnergyCapabilityCatalog } from '../runtime/home-energy-engine.js';
import { InMemoryActivityStore } from '../store/activity-store.js';
import { MemoryCaseStore } from '../store/memory-case-store.js';
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
 * A `CaseStore` wrapper whose `load()` always returns a fixed, deliberately
 * stale snapshot while `append()`/`updateSelection()` (and everything else)
 * still hit the real, since-advanced store. Simulates the real race
 * `loadForMutation()`'s own pre-check cannot observe in a single
 * synchronous test process: another command committing between this
 * command's read and its write (architecture.md "Command and event flow" --
 * exactly the optimistic-concurrency contract `append()`/`updateSelection()`
 * enforce). Proves each command method's own `if (result.status ===
 * 'applied')` branch correctly sees the non-`'applied'` outcome `append()`/
 * `updateSelection()` can genuinely return, not just the one
 * `loadForMutation()`'s pre-check already filters for.
 */
function staleReadCaseStore(real: MemoryCaseStore, staleSnapshot: CaseState) {
  return {
    load: (_caseId: string) => staleSnapshot,
    append: real.append.bind(real),
    updateSelection: real.updateSelection.bind(real),
    peekIdempotent: real.peekIdempotent.bind(real),
    subscribe: real.subscribe.bind(real),
    resetDemo: real.resetDemo.bind(real),
  };
}

describe('CommandService', () => {
  let caseStore: MemoryCaseStore;
  let activityStore: InMemoryActivityStore;
  let registry: PackRegistry;
  let service: CommandService;

  beforeEach(() => {
    caseStore = new MemoryCaseStore();
    activityStore = new InMemoryActivityStore();
    registry = createRegistryWithSyntheticPack();
    service = new CommandService({
      caseStore,
      activityStore,
      registry,
      clock: fixedClock,
      idGenerator: createSequentialIdGenerator(),
    });
  });

  function startDemo(commandId = 'cmd-start'): CaseState {
    const result = service.startDemo(commandId, { demoId: 'car-purchase' });
    requireOk(result);
    return requireSnapshot(result.value);
  }

  describe('startDemo', () => {
    it('creates a fully-seeded case from the pinned pack (success)', () => {
      const result = service.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(result);
      const snapshot = requireSnapshot(result.value);

      expect(snapshot.pack.id).toBe('car-purchase');
      expect(snapshot.pack.selectedBy).toBe('user');
      expect(snapshot.title).toBe('Choose Our Next Car (test fixture)');
      expect(snapshot.criteria).toHaveLength(1);
      // Two: the measurement obligation and the `dependsOnCriteria`
      // synthesis one the reweight tests need.
      expect(snapshot.obligations).toHaveLength(2);
      // The real gap `seedSnapshot` closes: attributeDefinitions must come
      // from the pack, not be left empty by applyCaseEvent's minimal skeleton.
      expect(snapshot.attributeDefinitions).toHaveLength(1);
      expect(snapshot.attributeDefinitions[0]?.id).toBe('car.price');
      expect(result.value.acceptedSequence).toBe(snapshot.eventSequence);

      const activity = activityStore.replayFrom(snapshot.id, 0);
      expect(activity).toHaveLength(1);
      expect(activity[0]?.type).toBe('command.accepted');
    });

    it('rejects an unregistered demo pack (not_found)', () => {
      const emptyRegistryService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: new PackRegistry(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });
      const result = emptyRegistryService.startDemo('cmd-1', { demoId: 'home-energy-guardian' });
      expect(result.status).toBe('not_found');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.startDemo('cmd-1', { demoId: 'not-a-real-demo' });
      expect(result.status).toBe('validation');
    });

    it('is idempotent: retrying the same commandId returns the original case, not a second one', () => {
      const first = service.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(first);
      const second = service.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(second);

      expect(second.value.caseId).toBe(first.value.caseId);
      expect(activityStore.replayFrom(first.value.caseId, 0)).toHaveLength(1);
    });

    it('resolves the highest registered semantic version, comparing numerically not lexicographically', () => {
      const multiVersionRegistry = new PackRegistry();
      for (const version of ['1.0.0', '2.1.3', '2.1.10', '2.2.0']) {
        multiVersionRegistry.register(
          compilePack(
            syntheticCarPurchaseManifest({
              identity: { ...syntheticCarPurchaseManifest().identity, version },
            }),
            syntheticCatalog(),
            fixedClock,
          ),
        );
      }
      const multiVersionService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: multiVersionRegistry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = multiVersionService.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(result);
      // Numeric comparison at every level: "2.2.0" beats "2.1.10" (minor),
      // which beats "2.1.3" (patch, and not lexicographically -- a naive
      // string compare would incorrectly rank "2.1.3" above "2.1.10"),
      // which beats "1.0.0" (major).
      expect(result.value.snapshot?.pack.version).toBe('2.2.0');
    });

    it('keeps the already-found highest version when a later-registered candidate has a lower version (reduce\'s "not greater" branch, not just its "greater" branch every other multi-version case above exercises)', () => {
      const descendingVersionRegistry = new PackRegistry();
      for (const version of ['2.0.0', '1.5.0']) {
        descendingVersionRegistry.register(
          compilePack(
            syntheticCarPurchaseManifest({
              identity: { ...syntheticCarPurchaseManifest().identity, version },
            }),
            syntheticCatalog(),
            fixedClock,
          ),
        );
      }
      const descendingVersionService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: descendingVersionRegistry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = descendingVersionService.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(result);
      // "2.0.0" was registered (and found) first; "1.5.0" registered second
      // must NOT overwrite it -- proving the reduce's ternary took its
      // "candidate is not greater than latest" (false) branch.
      expect(result.value.snapshot?.pack.version).toBe('2.0.0');
    });

    it('seeds pack-specific demo entities (e.g. starting candidates) when demoSeedEntities configures the pack', () => {
      // Real gap this closes: instantiateCase always seeds entities: [], and
      // nothing else in the live product ever adds starting candidates to a
      // freshly started case -- confirmed by apps/agent's real live-engine
      // manual smoke test (docs/build-log.md). upsertOption cannot be used
      // to seed these instead: OptionAttributeInputSchema.value is required
      // and the handler hardcodes status: 'asserted', so an entity carrying
      // a legitimately unknown-status attribute (no value; docs/engineering-principles.md "never
      // fabricate") can only be expressed as a direct option.upserted event
      // -- exactly what demoSeedEntities lets a pack-boot wiring supply.
      const unknownAttributeEntity: EntityRecord = {
        id: 'candidate-demo',
        kind: 'option',
        label: 'Demo Candidate',
        attributes: {
          'car.price': {
            definitionId: 'car.price',
            label: 'Price',
            origin: 'pack',
            sourceIds: [],
            status: 'unknown',
            updatedAt: FIXED_NOW,
          },
        },
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      };
      const seededActivityStore = new InMemoryActivityStore();
      const seededService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: seededActivityStore,
        registry: createRegistryWithSyntheticPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
        demoSeedEntities: { 'car-purchase': () => [unknownAttributeEntity] },
      });

      const result = seededService.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(result);
      const snapshot = requireSnapshot(result.value);

      expect(snapshot.entities).toHaveLength(1);
      expect(snapshot.entities[0]?.id).toBe('candidate-demo');
      expect(snapshot.entities[0]?.attributes['car.price']?.status).toBe('unknown');
      expect(result.value.acceptedSequence).toBe(snapshot.eventSequence);

      const activity = seededActivityStore.replayFrom(snapshot.id, 0);
      expect(activity.map((event) => event.summary)).toEqual([
        'Started "Choose Our Next Car (test fixture)".',
        'Added option "Demo Candidate".',
      ]);
    });

    it('starts a case with no entities when the pack has no demoSeedEntities entry (unchanged default behavior)', () => {
      const snapshot = startDemo();
      expect(snapshot.entities).toHaveLength(0);
    });
  });

  /**
   * `checkEnergyBillFeed`: the deterministic Home Energy Guardian
   * case-creation gate (docs/specs/demos-and-submission.md: "A
   * deterministic watcher creates a case after detecting the 42%
   * anomaly."). Routes real case creation through
   * `@sift/scenarios`'s `evaluateBillFeed`/`loadAndEvaluateBillFeed`
   * (`bill-feed-gate.ts`) so a normal bill genuinely produces no case --
   * proven here against the real, checked-in `current-bill.json` (42%
   * above baseline, opens a case) and `current-bill-normal.json` (within
   * the default 15% threshold, does not), not a mock.
   */
  describe('checkEnergyBillFeed', () => {
    function requireEnergyResultOk(result: {
      status: string;
    }): asserts result is { status: 'ok'; value: EnergyBillFeedCheckResult } {
      if (result.status !== 'ok') {
        throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result)}`);
      }
    }

    /** Real, compiled home-energy-guardian pack -- not a synthetic stand-in -- since this is specifically the pack the gate creates cases against. */
    function registryWithHomeEnergyGuardianPack(): PackRegistry {
      const registry = new PackRegistry();
      registry.register(compileHomeEnergyGuardianPack(homeEnergyCapabilityCatalog(), fixedClock));
      return registry;
    }

    it('opens a real, persisted case for the real 42%-above-baseline bill feed ("anomalous")', () => {
      const localCaseStore = new MemoryCaseStore();
      const localActivityStore = new InMemoryActivityStore();
      const localService = new CommandService({
        caseStore: localCaseStore,
        activityStore: localActivityStore,
        registry: registryWithHomeEnergyGuardianPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'anomalous' });
      requireEnergyResultOk(result);

      expect(result.value.caseOpened).toBe(true);
      expect(result.value.percentAboveBaseline).toBe(42);
      expect(result.value.thresholdPercent).toBe(15);
      expect(result.value.reason).toMatch(/42%/);
      expect(result.value.receipt).toBeDefined();

      // A real case really exists in the store -- not just an in-memory claim.
      const caseId = result.value.receipt?.caseId;
      expect(caseId).toBeDefined();
      const persisted = caseId === undefined ? undefined : localCaseStore.load(caseId);
      expect(persisted?.pack.id).toBe('home-energy-guardian');
    });

    it('opens NO case for the real, within-threshold bill feed ("normal") -- the case store stays untouched', () => {
      const localCaseStore = new MemoryCaseStore();
      const localActivityStore = new InMemoryActivityStore();
      const localService = new CommandService({
        caseStore: localCaseStore,
        activityStore: localActivityStore,
        registry: registryWithHomeEnergyGuardianPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'normal' });
      requireEnergyResultOk(result);

      expect(result.value.caseOpened).toBe(false);
      expect(result.value.percentAboveBaseline).toBeLessThan(15);
      expect(result.value.thresholdPercent).toBe(15);
      expect(result.value.reason).toMatch(/normal/i);
      expect(result.value.receipt).toBeUndefined();

      // Nothing was appended anywhere: no case, no activity.
      expect(localActivityStore.replayFrom('any-case-id', 0)).toHaveLength(0);
    });

    it('declining a normal bill needs no registered pack at all -- the gate runs before any pack lookup', () => {
      const localService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: new PackRegistry(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'normal' });
      requireEnergyResultOk(result);
      expect(result.value.caseOpened).toBe(false);
    });

    it('an anomalous bill still fails honestly (not_found) when the pack is not registered', () => {
      const localService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: new PackRegistry(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'anomalous' });
      expect(result.status).toBe('not_found');
    });

    it('rejects invalid input (validation)', () => {
      const localService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: registryWithHomeEnergyGuardianPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'made-up' });
      expect(result.status).toBe('validation');
    });

    it('is idempotent for a case-opening result: retrying the same commandId returns the same case, not a second one', () => {
      const localCaseStore = new MemoryCaseStore();
      const localService = new CommandService({
        caseStore: localCaseStore,
        activityStore: new InMemoryActivityStore(),
        registry: registryWithHomeEnergyGuardianPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const first = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'anomalous' });
      requireEnergyResultOk(first);
      const second = localService.checkEnergyBillFeed('cmd-1', { billFeedId: 'anomalous' });
      requireEnergyResultOk(second);

      expect(second.value.receipt?.caseId).toBe(first.value.receipt?.caseId);
    });
  });

  describe('selectPack', () => {
    it('re-pins the case to a newly selected installed pack (success)', () => {
      const snapshot = startDemo();
      const result = service.selectPack('cmd-2', {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      expect(requireSnapshot(result.value).pack.selectedBy).toBe('user');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.selectPack('cmd-2', { caseId: '', packId: '', expectedSequence: -1 });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.selectPack('cmd-2', {
        caseId: 'missing',
        packId: 'car-purchase',
        expectedSequence: 0,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startDemo();
      const result = service.selectPack('cmd-2', {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: snapshot.eventSequence - 1,
      });
      expect(result.status).toBe('conflict');
    });

    it('rejects an uninstalled pack (validation)', () => {
      const snapshot = startDemo();
      const result = service.selectPack('cmd-2', {
        caseId: snapshot.id,
        packId: 'does-not-exist',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('validation');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const snapshot = startDemo();
      const input = {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: snapshot.eventSequence,
      };
      const first = service.selectPack('cmd-2', input);
      requireOk(first);
      const second = service.selectPack('cmd-2', input);
      requireOk(second);
      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
    });
  });

  // I1 (docs/planning/plans/2026-08-30-generic-decision-workspace.md
  // "Phase I"; ADR 0006 decision 8): `commandOrigin` is a trailing optional
  // parameter on the command envelope, threaded straight through to
  // `emitActivity` -- never a branch that changes what the command does.
  describe('commandOrigin (I1: WebMCP call provenance)', () => {
    it('records safeDetails.origin on the activity trail when "webmcp" is supplied', () => {
      const snapshot = startDemo();
      const result = service.selectPack(
        'cmd-webmcp',
        { caseId: snapshot.id, packId: 'car-purchase', expectedSequence: snapshot.eventSequence },
        'webmcp',
      );
      requireOk(result);

      const recorded = activityStore
        .replayFrom(snapshot.id, 0)
        .find((event) => event.commandId === 'cmd-webmcp');
      expect(recorded?.safeDetails).toEqual({ origin: 'webmcp' });
    });

    it('records nothing extra when commandOrigin is omitted (default, pre-existing behavior)', () => {
      const snapshot = startDemo();
      const result = service.selectPack('cmd-plain', {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);

      const recorded = activityStore
        .replayFrom(snapshot.id, 0)
        .find((event) => event.commandId === 'cmd-plain');
      expect(recorded?.safeDetails).toBeUndefined();
    });

    it('never changes case state or the eventSequence advance: two independent services given the same command, with and without the marker, converge on identical results', () => {
      // Two wholly separate CommandService instances (own store, own id
      // generator, own registry) so the marker is the ONLY variable between
      // them -- proving it is genuinely a recording-only field, not a
      // branch, the same way `routes/commands.test.ts`'s HTTP-level twin
      // of this test uses two harnesses.
      const storeA = new MemoryCaseStore();
      const activityA = new InMemoryActivityStore();
      const serviceA = new CommandService({
        caseStore: storeA,
        activityStore: activityA,
        registry: createRegistryWithSyntheticPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });
      const storeB = new MemoryCaseStore();
      const activityB = new InMemoryActivityStore();
      const serviceB = new CommandService({
        caseStore: storeB,
        activityStore: activityB,
        registry: createRegistryWithSyntheticPack(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const startResultA = serviceA.startDemo('cmd-start', { demoId: 'car-purchase' });
      const startResultB = serviceB.startDemo('cmd-start', { demoId: 'car-purchase' });
      requireOk(startResultA);
      requireOk(startResultB);
      const snapshotA = requireSnapshot(startResultA.value);
      const snapshotB = requireSnapshot(startResultB.value);
      expect(snapshotB).toEqual(snapshotA);

      const resultA = serviceA.selectPack('cmd-select', {
        caseId: snapshotA.id,
        packId: 'car-purchase',
        expectedSequence: snapshotA.eventSequence,
      });
      const resultB = serviceB.selectPack(
        'cmd-select',
        {
          caseId: snapshotB.id,
          packId: 'car-purchase',
          expectedSequence: snapshotB.eventSequence,
        },
        'webmcp',
      );
      requireOk(resultA);
      requireOk(resultB);

      expect(resultB.value.acceptedSequence).toBe(resultA.value.acceptedSequence);
      expect(requireSnapshot(resultB.value)).toEqual(requireSnapshot(resultA.value));
      expect(storeB.load(snapshotB.id)).toEqual(storeA.load(snapshotA.id));
    });
  });

  describe('upsertOption', () => {
    it('adds a new option with typed attribute records (success)', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 24000, currency: 'USD' } },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.entities).toHaveLength(1);
      expect(updated.entities[0]?.label).toBe('Honda Civic');
      expect(updated.entities[0]?.attributes['car.price']?.status).toBe('asserted');
    });

    it('updates an existing option in place when optionId matches (upsert)', () => {
      const snapshot = startDemo();
      const first = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 24000, currency: 'USD' } },
          ],
        },
      });
      requireOk(first);
      const afterFirst = requireSnapshot(first.value);
      const optionId = afterFirst.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected an option id');

      const second = service.upsertOption('cmd-3', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: afterFirst.eventSequence,
        option: {
          label: 'Honda Civic LX',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 23000, currency: 'USD' } },
          ],
        },
      });
      requireOk(second);
      const final = requireSnapshot(second.value);
      expect(final.entities).toHaveLength(1);
      expect(final.entities[0]?.label).toBe('Honda Civic LX');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.upsertOption('cmd-2', { caseId: '', expectedSequence: -1 });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.upsertOption('cmd-2', {
        caseId: 'missing',
        expectedSequence: 0,
        option: { label: 'x', kind: 'car', attributes: [] },
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence + 5,
        option: { label: 'x', kind: 'car', attributes: [] },
      });
      expect(result.status).toBe('conflict');
    });

    it('persists optional sourceIds on an option attribute when the caller provides them (every other test above omits sourceIds entirely)', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            {
              definitionId: 'car.price',
              value: { type: 'money', amount: 24000, currency: 'USD' },
              sourceIds: ['source-1'],
            },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.entities[0]?.attributes['car.price']?.sourceIds).toEqual(['source-1']);
    });

    it('accepts an explicit "unknown" status with no value (§24 explicit unknowns, item 3)', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [{ definitionId: 'custom.laptop_work_fit', status: 'unknown' }],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const record = updated.entities[0]?.attributes['custom.laptop_work_fit'];
      expect(record?.status).toBe('unknown');
      expect(record).not.toHaveProperty('value');
    });

    it('accepts a low-confidence agent-inferred value, preserving confidence/status/origin (§24, item 3)', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            {
              definitionId: 'custom.laptop_work_fit',
              value: { type: 'string', value: 'Likely good' },
              status: 'supported',
              confidence: 0.4,
              origin: 'agent_proposed',
            },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const record = updated.entities[0]?.attributes['custom.laptop_work_fit'];
      expect(record?.status).toBe('supported');
      expect(record?.confidence).toBe(0.4);
      expect(record?.origin).toBe('agent_proposed');
      expect(record?.value).toEqual({ type: 'string', value: 'Likely good' });
    });

    it('preserves exact backward compatibility for a caller passing just {definitionId, value} (no status/confidence/origin): defaults to status "asserted" and origin "user", identical to pre-item-3 behavior', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 24000, currency: 'USD' } },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const record = updated.entities[0]?.attributes['car.price'];
      expect(record?.status).toBe('asserted');
      expect(record?.origin).toBe('user');
      expect(record?.confidence).toBeUndefined();
    });

    it('rejects a status/value mismatch from the real domain invariant (e.g. status "verified" with no value) -- the `createAttributeRecord` error branch, newly reachable now that value is optional', () => {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [{ definitionId: 'car.price', status: 'verified' }],
        },
      });
      expect(result.status).toBe('validation');
    });

    function withReadyRecommendation(snapshot: CaseState): CaseState {
      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');
      return appended.snapshot;
    }

    it('invalidates a ready recommendation when an option attribute an active criterion depends on changes (item 4) -- the synthetic pack\'s own "price" criterion has appliesToAttribute: "car.price"', () => {
      const withRecommendation = withReadyRecommendation(startDemo());
      const result = service.upsertOption('cmd-2', {
        caseId: withRecommendation.id,
        expectedSequence: withRecommendation.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 24000, currency: 'USD' } },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('stale');
      const activity = activityStore.replayFrom(withRecommendation.id, 0);
      expect(activity.some((event) => event.type === 'recommendation.invalidated')).toBe(true);
    });

    it('does NOT invalidate a ready recommendation when the changed attribute is not referenced by any active criterion (precision: an unrelated attribute write must not invalidate)', () => {
      const withRecommendation = withReadyRecommendation(startDemo());
      const result = service.upsertOption('cmd-2', {
        caseId: withRecommendation.id,
        expectedSequence: withRecommendation.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            {
              definitionId: 'custom.trivia_note',
              value: { type: 'string', value: 'Has a sunroof.' },
            },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('ready');
    });
  });

  describe('setOptionAttribute', () => {
    function withOption(): { snapshot: CaseState; optionId: string } {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 24000, currency: 'USD' } },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const optionId = updated.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected option id');
      return { snapshot: updated, optionId };
    }

    function withCustomDefinition(snapshot: CaseState, id = 'custom.dog_crate_fit'): CaseState {
      const result = service.defineCaseAttribute('cmd-def', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        definition: {
          id,
          label: 'Dog crate fit',
          valueType: 'string',
          appliesTo: ['car'],
          evidenceExpectation: 'assertion',
          comparison: 'none',
          reason: 'The household has a dog that needs to fit in the trunk.',
        },
      });
      requireOk(result);
      return requireSnapshot(result.value);
    }

    function withReadyRecommendation(snapshot: CaseState): CaseState {
      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec-attr',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-attr-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');
      return appended.snapshot;
    }

    it('sets a new custom attribute while preserving the sibling pack-defined attribute already on the option (merge, not replace)', () => {
      const { snapshot, optionId } = withOption();
      const withDefinition = withCustomDefinition(snapshot);
      const result = service.setOptionAttribute('cmd-3', {
        caseId: withDefinition.id,
        optionId,
        expectedSequence: withDefinition.eventSequence,
        attribute: {
          definitionId: 'custom.dog_crate_fit',
          value: { type: 'string', value: 'Fits with seats down.' },
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const attrs = updated.entities.find((entity) => entity.id === optionId)?.attributes;
      expect(attrs?.['custom.dog_crate_fit']?.value).toEqual({
        type: 'string',
        value: 'Fits with seats down.',
      });
      expect(attrs?.['car.price']?.value).toEqual({
        type: 'money',
        amount: 24000,
        currency: 'USD',
      });
    });

    it('accepts an explicit "unknown" status with no value (§24 explicit unknowns)', () => {
      const { snapshot, optionId } = withOption();
      const withDefinition = withCustomDefinition(snapshot);
      const result = service.setOptionAttribute('cmd-3', {
        caseId: withDefinition.id,
        optionId,
        expectedSequence: withDefinition.eventSequence,
        attribute: { definitionId: 'custom.dog_crate_fit', status: 'unknown' },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const record = updated.entities.find((entity) => entity.id === optionId)?.attributes[
        'custom.dog_crate_fit'
      ];
      expect(record?.status).toBe('unknown');
      expect(record).not.toHaveProperty('value');
    });

    it('rejects a status/value mismatch from the real domain invariant (status "verified" with no value)', () => {
      const { snapshot, optionId } = withOption();
      const withDefinition = withCustomDefinition(snapshot);
      const result = service.setOptionAttribute('cmd-3', {
        caseId: withDefinition.id,
        optionId,
        expectedSequence: withDefinition.eventSequence,
        attribute: { definitionId: 'custom.dog_crate_fit', status: 'verified' },
      });
      expect(result.status).toBe('validation');
    });

    it('rejects an unknown optionId as a clean validation error, never a silent no-op', () => {
      const snapshot = startDemo();
      const withDefinition = withCustomDefinition(snapshot);
      const result = service.setOptionAttribute('cmd-3', {
        caseId: withDefinition.id,
        optionId: 'does-not-exist',
        expectedSequence: withDefinition.eventSequence,
        attribute: { definitionId: 'custom.dog_crate_fit', value: { type: 'string', value: 'x' } },
      });
      expect(result.status).toBe('validation');
    });

    it('rejects a definitionId not declared anywhere on the case (neither pack-defined nor a case extension) as a clean validation error, never a silent no-op', () => {
      const { snapshot, optionId } = withOption();
      const result = service.setOptionAttribute('cmd-3', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence,
        attribute: { definitionId: 'custom.never_defined', value: { type: 'string', value: 'x' } },
      });
      expect(result.status).toBe('validation');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.setOptionAttribute('cmd-3', {
        caseId: '',
        optionId: '',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.setOptionAttribute('cmd-3', {
        caseId: 'missing',
        optionId: 'x',
        expectedSequence: 0,
        attribute: {
          definitionId: 'car.price',
          value: { type: 'money', amount: 1, currency: 'USD' },
        },
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const { snapshot, optionId } = withOption();
      const result = service.setOptionAttribute('cmd-3', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence + 5,
        attribute: {
          definitionId: 'car.price',
          value: { type: 'money', amount: 1, currency: 'USD' },
        },
      });
      expect(result.status).toBe('conflict');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const { snapshot, optionId } = withOption();
      const input = {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence,
        attribute: {
          definitionId: 'car.price',
          value: { type: 'money' as const, amount: 25000, currency: 'USD' },
        },
      };
      const first = service.setOptionAttribute('cmd-4', input);
      requireOk(first);
      const second = service.setOptionAttribute('cmd-4', input);
      requireOk(second);
      expect(second.value.caseId).toBe(first.value.caseId);
    });

    it('invalidates a ready recommendation when the changed attribute is one an active criterion depends on (item 4, matching upsertOption\'s rule) -- the synthetic pack\'s "price" criterion has appliesToAttribute: "car.price"', () => {
      const { snapshot, optionId } = withOption();
      const withRecommendation = withReadyRecommendation(snapshot);
      const result = service.setOptionAttribute('cmd-5', {
        caseId: withRecommendation.id,
        optionId,
        expectedSequence: withRecommendation.eventSequence,
        attribute: {
          definitionId: 'car.price',
          value: { type: 'money', amount: 26000, currency: 'USD' },
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('stale');
      const activity = activityStore.replayFrom(withRecommendation.id, 0);
      expect(activity.some((event) => event.type === 'recommendation.invalidated')).toBe(true);
    });

    it('does NOT invalidate a ready recommendation when the changed attribute is not referenced by any active criterion (precision)', () => {
      const { snapshot, optionId } = withOption();
      const withDefinition = withCustomDefinition(snapshot);
      const withRecommendation = withReadyRecommendation(withDefinition);
      const result = service.setOptionAttribute('cmd-5', {
        caseId: withRecommendation.id,
        optionId,
        expectedSequence: withRecommendation.eventSequence,
        attribute: {
          definitionId: 'custom.dog_crate_fit',
          value: { type: 'string', value: 'ok' },
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('ready');
    });
  });

  describe('addNote', () => {
    function withOption(): { snapshot: CaseState; optionId: string } {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            { definitionId: 'car.price', value: { type: 'money', amount: 24000, currency: 'USD' } },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const optionId = updated.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected option id');
      return { snapshot: updated, optionId };
    }

    function withReadyRecommendation(snapshot: CaseState): CaseState {
      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec-note',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-note-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');
      return appended.snapshot;
    }

    it('adds a minimal note (success)', () => {
      const snapshot = startDemo();
      const result = service.addNote('cmd-note-1', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        note: { body: 'The seat position felt wrong on the test drive.' },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.notes).toHaveLength(1);
      expect(updated.notes?.[0]?.body).toBe('The seat position felt wrong on the test drive.');
      // Defaults applied by the command handler, not left unset.
      expect(updated.notes?.[0]?.kind).toBe('observation');
      expect(updated.notes?.[0]?.origin).toBe('user');
      expect(updated.notes?.[0]?.authoredBy).toBe('user');
      expect(updated.notes?.[0]?.optionIds).toEqual([]);
      expect(updated.notes?.[0]?.sourceIds).toEqual([]);

      const activity = activityStore.replayFrom(snapshot.id, 0);
      expect(activity.at(-1)?.type).toBe('command.accepted');
      // The public activity summary must never echo the raw note body
      // verbatim (a note is user-entered free text; keep it out of the
      // sanitized activity stream's plain-English summary).
      expect(activity.at(-1)?.summary).not.toContain('seat position');
    });

    it('adds an agent-authored note with an explicit kind, linked options, an obligation link, and cited sources', () => {
      const { snapshot, optionId } = withOption();
      const result = service.addNote('cmd-note-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        origin: 'agent_proposed',
        note: {
          body: 'Two listings disagree on the advertised price.',
          kind: 'research',
          optionIds: [optionId],
          obligationId: 'hard-constraints',
          sourceIds: [],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const note = updated.notes?.[0];
      expect(note?.kind).toBe('research');
      expect(note?.origin).toBe('agent_proposed');
      expect(note?.authoredBy).toBe('model');
      expect(note?.optionIds).toEqual([optionId]);
      expect(note?.obligationId).toBe('hard-constraints');
    });

    it('rejects a note referencing an unknown optionId as a clean validation error', () => {
      const snapshot = startDemo();
      const result = service.addNote('cmd-note-3', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        note: { body: 'x', optionIds: ['does-not-exist'] },
      });
      expect(result.status).toBe('validation');
    });

    it('rejects a note referencing an unknown obligationId as a clean validation error', () => {
      const snapshot = startDemo();
      const result = service.addNote('cmd-note-4', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        note: { body: 'x', obligationId: 'does-not-exist' },
      });
      expect(result.status).toBe('validation');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.addNote('cmd-note-5', {
        caseId: '',
        expectedSequence: -1,
        note: {},
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.addNote('cmd-note-6', {
        caseId: 'missing',
        expectedSequence: 0,
        note: { body: 'x' },
      });
      expect(result.status).toBe('not_found');
    });

    // Renamed, not weakened: `+5` is a sequence this case has never reached,
    // which is what the assertion below has always tested. "Stale" is the
    // opposite direction and is now a separate, deliberate behaviour -- see
    // the `sequence-independent commands` block at the end of this file.
    it('returns conflict for an expectedSequence AHEAD of the case', () => {
      const snapshot = startDemo();
      const result = service.addNote('cmd-note-7', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence + 5,
        note: { body: 'x' },
      });
      expect(result.status).toBe('conflict');
    });

    it('is idempotent: retrying the same commandId returns the original result, not a second note', () => {
      const snapshot = startDemo();
      const input = {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        note: { body: 'x' },
      };
      const first = service.addNote('cmd-note-8', input);
      requireOk(first);
      const second = service.addNote('cmd-note-8', input);
      requireOk(second);
      expect(second.value.caseId).toBe(first.value.caseId);
      expect(requireSnapshot(second.value).notes).toHaveLength(1);
    });

    // The central rule of this concept (docs/engineering-principles.md "The deterministic core,
    // not an LLM, owns case state, evidence validity, readiness, and human
    // authority"): a note is an observation that has not earned evidence
    // status. Adding one to a case that already has a ready recommendation
    // AND a required, still-open obligation must leave every one of those
    // untouched -- obligations, readiness, and the recommendation itself.
    it('never touches obligations, readiness, or a ready recommendation (notes never auto-promote to evidence)', () => {
      const snapshot = startDemo();
      const withRecommendation = withReadyRecommendation(snapshot);
      // The synthetic pack's seeded obligations are `required: true` and
      // start `open` -- exactly the "open obligations" precondition this
      // test needs, with no extra setup.
      expect(withRecommendation.obligations).toHaveLength(2);
      expect(withRecommendation.obligations.every((o) => o.status === 'open')).toBe(true);
      const readinessBefore = evaluateReadiness(withRecommendation);
      expect(readinessBefore.ready).toBe(false);

      const result = service.addNote('cmd-note-9', {
        caseId: withRecommendation.id,
        expectedSequence: withRecommendation.eventSequence,
        note: { body: 'Dealer said they may waive the package.' },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      expect(updated.notes).toHaveLength(1);
      expect(updated.obligations).toEqual(withRecommendation.obligations);
      expect(updated.recommendation).toEqual(withRecommendation.recommendation);
      expect(evaluateReadiness(updated)).toEqual(readinessBefore);

      // No recommendation.invalidated (or any other) activity beyond the
      // plain command.accepted for the note itself.
      const activity = activityStore.replayFrom(withRecommendation.id, 0);
      expect(activity.some((event) => event.type === 'recommendation.invalidated')).toBe(false);
    });
  });

  describe('focusOption', () => {
    function withOption(): { snapshot: CaseState; optionId: string } {
      const snapshot = startDemo();
      const result = service.upsertOption('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Honda Civic', kind: 'car', attributes: [] },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const optionId = updated.entities[0]?.id;
      if (optionId === undefined) throw new Error('expected option id');
      return { snapshot: updated, optionId };
    }

    it('sets selectedOptionId without advancing eventSequence (success)', () => {
      const { snapshot, optionId } = withOption();
      const result = service.focusOption('cmd-3', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.selectedOptionId).toBe(optionId);
      expect(updated.eventSequence).toBe(snapshot.eventSequence);
    });

    it('rejects invalid input (validation)', () => {
      const result = service.focusOption('cmd-3', {
        caseId: '',
        optionId: '',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.focusOption('cmd-3', {
        caseId: 'missing',
        optionId: 'x',
        expectedSequence: 0,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const { snapshot, optionId } = withOption();
      const result = service.focusOption('cmd-3', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence + 1,
      });
      expect(result.status).toBe('conflict');
    });

    it('rejects an unknown optionId (validation)', () => {
      const { snapshot } = withOption();
      const result = service.focusOption('cmd-3', {
        caseId: snapshot.id,
        optionId: 'does-not-exist',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('validation');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const { snapshot, optionId } = withOption();
      const input = { caseId: snapshot.id, optionId, expectedSequence: snapshot.eventSequence };
      const first = service.focusOption('cmd-3', input);
      requireOk(first);
      const second = service.focusOption('cmd-3', input);
      requireOk(second);
      expect(second.value.caseId).toBe(first.value.caseId);
    });

    it("returns a 409-shaped conflict when the underlying updateSelection() call itself detects the case has advanced (the \"if (result.status === 'applied')\" false path -- loadForMutation's own pre-check already catches every conflict every other test above produces, so only a genuine append()/updateSelection() race, simulated here, reaches it)", () => {
      const { snapshot, optionId } = withOption();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.focusOption('cmd-race', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('conflict');
    });

    /**
     * `optionId: null` clears the selection (`FocusOptionInputSchema`'s own
     * doc comment, `packages/contracts/src/commands.ts`) -- the fix for the
     * option card's `aria-pressed` toggle button having no way to un-press.
     * Two things distinguish this from the "focus a real option" path
     * above: `null` must skip the "does this option exist on the case"
     * check entirely (it names no option, so there is nothing to look up),
     * and it must actually reach `selectedOptionId` as `null`, not `undefined`
     * or the previously-selected id.
     */
    it('clears selectedOptionId when optionId is null, without requiring an existing option', () => {
      const { snapshot, optionId } = withOption();
      const focused = service.focusOption('cmd-3', {
        caseId: snapshot.id,
        optionId,
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(focused);
      const afterFocus = requireSnapshot(focused.value);
      expect(afterFocus.selectedOptionId).toBe(optionId);

      const cleared = service.focusOption('cmd-4', {
        caseId: snapshot.id,
        optionId: null,
        expectedSequence: afterFocus.eventSequence,
      });
      requireOk(cleared);
      const afterClear = requireSnapshot(cleared.value);
      expect(afterClear.selectedOptionId).toBeNull();
      expect(afterClear.eventSequence).toBe(snapshot.eventSequence);
    });
  });

  describe('setView', () => {
    function withReadyRecommendation(snapshot: CaseState): CaseState {
      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec-view',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-view-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');
      return appended.snapshot;
    }

    it('persists the view through updateSelection(): eventSequence and a ready recommendation stay EXACTLY unchanged, and a subsequent load() returns the persisted view (§54 "presentation is not decision mutation" -- the critical structural proof)', () => {
      const withRecommendation = withReadyRecommendation(startDemo());
      const view = { mode: 'compare' as const, compare: { optionIds: [] } };

      const result = service.setView('cmd-view-1', {
        caseId: withRecommendation.id,
        expectedSequence: withRecommendation.eventSequence,
        view,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      expect(updated.view).toEqual(view);
      expect(updated.eventSequence).toBe(withRecommendation.eventSequence);
      expect(updated.recommendation).toEqual(withRecommendation.recommendation);

      const reloaded = caseStore.load(withRecommendation.id);
      expect(reloaded?.view).toEqual(view);
      expect(reloaded?.eventSequence).toBe(withRecommendation.eventSequence);
      expect(reloaded?.recommendation).toEqual(withRecommendation.recommendation);
    });

    it('rejects invalid input (validation)', () => {
      const result = service.setView('cmd-view-2', {
        caseId: '',
        expectedSequence: -1,
        view: { mode: 'list' },
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.setView('cmd-view-3', {
        caseId: 'missing',
        expectedSequence: 0,
        view: { mode: 'list' },
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startDemo();
      const result = service.setView('cmd-view-4', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence + 1,
        view: { mode: 'list' },
      });
      expect(result.status).toBe('conflict');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const snapshot = startDemo();
      const input = {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        view: { mode: 'list' as const },
      };
      const first = service.setView('cmd-view-5', input);
      requireOk(first);
      const second = service.setView('cmd-view-5', input);
      requireOk(second);
      expect(second.value.caseId).toBe(first.value.caseId);
    });

    it("returns a 409-shaped conflict when the underlying updateSelection() call itself detects the case has advanced (a genuine append()/updateSelection() race, not loadForMutation's own pre-check)", () => {
      const snapshot = startDemo();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.setView('cmd-race', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        view: { mode: 'list' },
      });
      expect(result.status).toBe('conflict');
    });
  });

  describe('defineCaseAttribute', () => {
    function draftInput(caseId: string, expectedSequence: number) {
      return {
        caseId,
        expectedSequence,
        definition: {
          id: 'custom.pet_sensory_fit',
          label: 'Pet sensory fit',
          valueType: 'text' as const,
          appliesTo: ['car'],
          evidenceExpectation: 'assertion' as const,
          comparison: 'none' as const,
          reason: 'The household has a dog that reacts badly to certain interiors.',
        },
      };
    }

    /**
     * `startDemo()` seeds zero entities (this suite wires no
     * `demoSeedEntities`), so every test about `values` needs real options
     * on the case first -- added through the real, unmodified `upsertOption`
     * command, not by writing entities into the store behind its back.
     */
    function withOptions(
      base: CaseState,
      labels: readonly string[],
    ): { snapshot: CaseState; optionIds: string[] } {
      let current = base;
      const optionIds: string[] = [];
      labels.forEach((label, index) => {
        const result = service.upsertOption(`cmd-option-${index}`, {
          caseId: current.id,
          expectedSequence: current.eventSequence,
          option: { label, kind: 'car', attributes: [] },
        });
        requireOk(result);
        current = requireSnapshot(result.value);
        const added = current.entities.find((entity) => entity.label === label);
        if (added === undefined) throw new Error(`test setup: option "${label}" was not added`);
        optionIds.push(added.id);
      });
      return { snapshot: current, optionIds };
    }

    it('creates a confirmed user-origin extension by default (success)', () => {
      const snapshot = startDemo();
      const result = service.defineCaseAttribute(
        'cmd-2',
        draftInput(snapshot.id, snapshot.eventSequence),
      );
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions).toHaveLength(1);
      expect(updated.caseExtensions[0]?.definition.confirmation).toBe('confirmed');
      expect(updated.caseExtensions[0]?.definition.origin).toBe('user');
    });

    it('creates a CONFIRMED agent-proposed extension when origin is passed explicitly as the method parameter and the pinned pack pre-authorized case attributes (ADR 0011; pre-existing call shape, e.g. car-purchase-scenario.ts)', () => {
      const snapshot = startDemo();
      const result = service.defineCaseAttribute(
        'cmd-2',
        draftInput(snapshot.id, snapshot.eventSequence),
        'agent_proposed',
      );
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.confirmation).toBe('confirmed');
      expect(updated.caseExtensions[0]?.definition.origin).toBe('agent_proposed');
    });

    it('an agent-defined attribute the pack permits lands CONFIRMED, with its values, carrying the provenance the UI needs to show who added it and offer an undo (ADR 0011)', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V', 'Toyota RAV4']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'supported',
            value: { type: 'text', value: 'Cloth seats, no strong cabin odour reported.' },
            confidence: 0.6,
          },
          {
            optionId: optionIds[1]!,
            status: 'supported',
            value: { type: 'text', value: 'Synthetic leather; owners report a persistent smell.' },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      const extension = updated.caseExtensions[0];
      expect(extension?.definition.confirmation).toBe('confirmed');
      expect(extension?.definition.origin).toBe('agent_proposed');
      expect(extension?.definition.proposedBy).toBe('model');
      expect(extension?.definition.reason).toBe(
        'The household has a dog that reacts badly to certain interiors.',
      );

      // The column is not empty: every option it applies to carries a real
      // record for it, with the model's own origin.
      for (const optionId of optionIds) {
        const record = updated.entities.find((entity) => entity.id === optionId)?.attributes[
          'custom.pet_sensory_fit'
        ];
        expect(record?.status).toBe('supported');
        expect(record?.origin).toBe('agent_proposed');
        expect(record?.value).toBeDefined();
      }
      expect(
        updated.entities.find((entity) => entity.id === optionIds[0])?.attributes[
          'custom.pet_sensory_fit'
        ]?.confidence,
      ).toBe(0.6);
    });

    it('rejects an agent-defined attribute outright when the pinned pack forbids case attributes, naming the pack and the policy (ADR 0011: forbidden means rejected, never silently ignored or downgraded)', () => {
      const closedRegistry = new PackRegistry();
      closedRegistry.register(
        compilePack(
          syntheticCarPurchaseManifest({
            extensionPolicy: {
              allowCaseAttributes: false,
              allowCaseCriteria: false,
              allowCaseObligations: false,
              userConcernTemplateId: 'car.user_concern',
            },
          }),
          syntheticCatalog(),
          fixedClock,
        ),
      );
      const closedStore = new MemoryCaseStore();
      const closedService = new CommandService({
        caseStore: closedStore,
        activityStore: new InMemoryActivityStore(),
        registry: closedRegistry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const started = closedService.startDemo('cmd-closed-start', { demoId: 'car-purchase' });
      requireOk(started);
      const snapshot = requireSnapshot(started.value);

      const result = closedService.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: 'any-option',
            status: 'asserted' as const,
            value: { type: 'text' as const, value: 'anything' },
          },
        ],
      });
      expect(result.status).toBe('policy');
      if (result.status !== 'policy') throw new Error('expected a policy failure');
      expect(result.message).toContain('car-purchase');
      expect(result.message).toContain('allowCaseAttributes');

      // Rejected outright: no extension, and no weaker write left behind.
      const after = closedStore.load(snapshot.id);
      expect(after?.caseExtensions).toHaveLength(0);
      expect(after?.eventSequence).toBe(snapshot.eventSequence);
    });

    it('rejects an agent-defined attribute that leaves an applicable option unaccounted for, naming the options it omitted', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V', 'Toyota RAV4']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'asserted',
            value: { type: 'text', value: 'Cloth seats.' },
          },
        ],
      });
      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('expected a validation failure');
      expect(result.issues.join(' ')).toContain('Toyota RAV4');
      expect(result.issues.join(' ')).not.toContain('Honda CR-V');
    });

    it('rejects a values entry naming an option that does not exist on the case', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'asserted',
            value: { type: 'text', value: 'Cloth seats.' },
          },
          {
            optionId: 'option-that-was-never-added',
            status: 'asserted',
            value: { type: 'text', value: 'Invented.' },
          },
        ],
      });
      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('expected a validation failure');
      expect(result.issues.join(' ')).toContain('option-that-was-never-added');
    });

    it('rejects two values entries for the same option: one option can only hold one value for one attribute', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'asserted',
            value: { type: 'text', value: 'Cloth seats.' },
          },
          {
            optionId: optionIds[0]!,
            status: 'asserted',
            value: { type: 'text', value: 'Leather seats.' },
          },
        ],
      });
      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('expected a validation failure');
      expect(result.issues.join(' ')).toContain('more than one entry');
    });

    it('rejects a values entry for an option the attribute does not apply to (appliesTo lists entity KINDS)', () => {
      const snapshot = startDemo();
      const seeded = service.upsertOption('cmd-option-other-kind', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Corner shop', kind: 'dealer', attributes: [] },
      });
      requireOk(seeded);
      const withDealer = requireSnapshot(seeded.value);

      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(withDealer.id, withDealer.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: withDealer.entities[0]!.id,
            status: 'asserted',
            value: { type: 'text', value: 'Not a car.' },
          },
        ],
      });
      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('expected a validation failure');
      expect(result.issues.join(' ')).toContain('appliesTo');
    });

    it('never truncates a long unknown reason to make room for the label Sift adds: the note falls back to the reason verbatim', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V']);
      // 1995 chars: within `safeString(2000)` on its own, but past it once
      // the 15-character attribute label and ": " are prefixed.
      const longReason = `No source covers this. ${'x'.repeat(1972)}`;
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [{ optionId: optionIds[0]!, status: 'unknown', reason: longReason }],
      });
      requireOk(result);
      const note = (requireSnapshot(result.value).notes ?? [])[0];
      expect(note?.body).toBe(longReason);
    });

    it('persists an explicit unknown as a real status: "unknown" record carrying its reason -- distinguishable in stored state from an attribute nobody ever asked about', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V', 'Toyota RAV4']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'supported',
            value: { type: 'text', value: 'Cloth seats, no reported odour.' },
          },
          {
            optionId: optionIds[1]!,
            status: 'unknown',
            reason: 'No owner report or specification covers cabin materials for this trim.',
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      const unknownRecord = updated.entities.find((entity) => entity.id === optionIds[1])
        ?.attributes['custom.pet_sensory_fit'];
      // The record EXISTS and says "unknown" -- it is not absent.
      expect(unknownRecord).toBeDefined();
      expect(unknownRecord?.status).toBe('unknown');
      expect(unknownRecord?.value).toBeUndefined();

      // And "nobody asked" still looks different in stored state: an
      // attribute the definition never covered has no record at all.
      expect(
        updated.entities.find((entity) => entity.id === optionIds[1])?.attributes[
          'custom.never_asked'
        ],
      ).toBeUndefined();

      // The reason is durable, option-linked, and attributed to the model.
      const note = (updated.notes ?? []).find((entry) => entry.optionIds.includes(optionIds[1]!));
      expect(note?.body).toContain(
        'No owner report or specification covers cabin materials for this trim.',
      );
      expect(note?.origin).toBe('agent_proposed');
      expect(note?.authoredBy).toBe('model');
    });

    it('applies the definition and every value in ONE transactional append: a rejected value leaves no partial state at all', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V', 'Toyota RAV4']);
      const before = caseStore.load(snapshot.id);

      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'asserted',
            value: { type: 'text', value: 'Cloth seats.' },
          },
          {
            // A number value for a `text` attribute: rejected by the real
            // `normalizeAttributeValue`, after the first entry above was
            // already assembled.
            optionId: optionIds[1]!,
            status: 'asserted',
            value: { type: 'number', value: 42 },
          },
        ],
      });
      expect(result.status).toBe('validation');

      const after = caseStore.load(snapshot.id);
      expect(after?.eventSequence).toBe(before?.eventSequence);
      expect(after?.caseExtensions).toHaveLength(0);
      expect(
        after?.entities.find((entity) => entity.id === optionIds[0])?.attributes[
          'custom.pet_sensory_fit'
        ],
      ).toBeUndefined();
      expect(after?.notes ?? []).toHaveLength(0);
    });

    it('still refuses status "verified" from an agent origin -- pre-authorizing an EXTENSION never pre-authorizes a human attestation (attributeStatusOriginError, unchanged)', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'verified',
            value: { type: 'text', value: 'I checked it myself.' },
          },
        ],
      });
      expect(result.status).toBe('validation');
      if (result.status !== 'validation') throw new Error('expected a validation failure');
      expect(result.issues.join(' ')).toContain('only origin "user"');

      // ...and the same claim from a real human origin is accepted, so the
      // rule above is about WHO is claiming, not about the status existing.
      const asUser = service.defineCaseAttribute('cmd-3', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'user',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'verified',
            value: { type: 'text', value: 'I checked it myself.' },
          },
        ],
      });
      requireOk(asUser);
      expect(
        requireSnapshot(asUser.value).entities[0]?.attributes['custom.pet_sensory_fit']?.status,
      ).toBe('verified');
    });

    it("a user-origin definition still needs no values at all: absent means exactly today's behavior (the visible CustomConcernForm path)", () => {
      const { snapshot } = withOptions(startDemo(), ['Honda CR-V', 'Toyota RAV4']);
      const result = service.defineCaseAttribute(
        'cmd-2',
        draftInput(snapshot.id, snapshot.eventSequence),
      );
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.confirmation).toBe('confirmed');
      expect(updated.eventSequence).toBe(snapshot.eventSequence + 1);
      for (const entity of updated.entities) {
        expect(entity.attributes['custom.pet_sensory_fit']).toBeUndefined();
      }
    });

    it('an agent-defined extension can still be rejected afterwards -- the undo ADR 0011 promises', () => {
      const { snapshot, optionIds } = withOptions(startDemo(), ['Honda CR-V']);
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'agent_proposed',
        values: [
          {
            optionId: optionIds[0]!,
            status: 'asserted',
            value: { type: 'text', value: 'Cloth seats.' },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      const rejected = service.reviewCaseExtension('cmd-3', {
        caseId: updated.id,
        extensionId: updated.caseExtensions[0]!.id,
        decision: 'reject',
        expectedSequence: updated.eventSequence,
      });
      requireOk(rejected);
      expect(requireSnapshot(rejected.value).caseExtensions[0]?.definition.confirmation).toBe(
        'rejected',
      );
    });

    it('an explicit origin: "user" on the wire input is auto-confirmed, same as omitting origin entirely', () => {
      const snapshot = startDemo();
      const result = service.defineCaseAttribute('cmd-2', {
        ...draftInput(snapshot.id, snapshot.eventSequence),
        origin: 'user',
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.confirmation).toBe('confirmed');
      expect(updated.caseExtensions[0]?.definition.origin).toBe('user');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.defineCaseAttribute('cmd-2', { caseId: '', expectedSequence: -1 });
      expect(result.status).toBe('validation');
    });

    it('rejects a duplicate custom attribute id (validation, from the core domain function)', () => {
      const snapshot = startDemo();
      const first = service.defineCaseAttribute(
        'cmd-2',
        draftInput(snapshot.id, snapshot.eventSequence),
      );
      requireOk(first);
      const updated = requireSnapshot(first.value);
      const second = service.defineCaseAttribute(
        'cmd-3',
        draftInput(snapshot.id, updated.eventSequence),
      );
      expect(second.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.defineCaseAttribute('cmd-2', draftInput('missing', 0));
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startDemo();
      const result = service.defineCaseAttribute(
        'cmd-2',
        draftInput(snapshot.id, snapshot.eventSequence + 1),
      );
      expect(result.status).toBe('conflict');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const snapshot = startDemo();
      const input = draftInput(snapshot.id, snapshot.eventSequence);
      const first = service.defineCaseAttribute('cmd-2', input);
      requireOk(first);
      const second = service.defineCaseAttribute('cmd-2', input);
      requireOk(second);
      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
    });

    it('carries optional unit and allowedValues through to the created definition when provided (draftInput() above never sets either)', () => {
      const snapshot = startDemo();
      const result = service.defineCaseAttribute('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        definition: {
          id: 'custom.max_towing_capacity',
          label: 'Max towing capacity',
          valueType: 'number',
          appliesTo: ['car'],
          unit: 'lbs',
          allowedValues: ['1500', '3500', '5000'],
          evidenceExpectation: 'source',
          comparison: 'higher_better',
          reason: 'The household tows a small trailer.',
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.unit).toBe('lbs');
      expect(updated.caseExtensions[0]?.definition.allowedValues).toEqual(['1500', '3500', '5000']);
    });

    it('carries orderedValues through, which is what makes a model-defined enum scoreable at all', () => {
      // `scoring.ts` rule 3 refuses to rank enum grades without a declared
      // worst-to-best scale, and will not infer one from `allowedValues`. If
      // the ordering is dropped anywhere between the WebMCP call and the
      // stored definition, the column still renders and simply never scores
      // -- a silent failure, so it is asserted rather than assumed.
      const snapshot = startDemo();
      const result = service.defineCaseAttribute('cmd-ordered', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        definition: {
          id: 'custom.dog_crate_fit',
          label: 'Dog crate fit',
          valueType: 'enum',
          appliesTo: ['car'],
          allowedValues: ['none', 'one crate', 'two crates'],
          orderedValues: ['none', 'one crate', 'two crates'],
          evidenceExpectation: 'assertion',
          comparison: 'higher_better',
          reason: 'Two dog crates must fit behind the second row.',
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.orderedValues).toEqual([
        'none',
        'one crate',
        'two crates',
      ]);
    });

    it("returns a 409-shaped conflict when the underlying append() call itself detects the case has advanced (a genuine race, not one loadForMutation's pre-check already catches -- see focusOption's identical-purpose test above)", () => {
      const snapshot = startDemo();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.defineCaseAttribute(
        'cmd-race',
        draftInput(snapshot.id, snapshot.eventSequence),
      );
      expect(result.status).toBe('conflict');
    });
  });

  describe('reviewCaseExtension', () => {
    /**
     * ADR 0011 old->new: this helper used to be `withPendingExtension`, and
     * an `'agent_proposed'` definition genuinely landed `pending`. It cannot
     * any more -- the synthetic pack pre-authorizes case attributes
     * (`extensionPolicy.allowCaseAttributes: true`), so an agent-defined
     * extension lands `confirmed`, and a pack that forbids them rejects the
     * command outright rather than producing a pending one. `pending` is
     * therefore no longer reachable through `CommandService`, which is
     * exactly why `reviewCaseExtension` is now the human's authority in both
     * directions rather than a one-way gate.
     */
    function withAgentDefinedExtension(): { snapshot: CaseState; extensionId: string } {
      const snapshot = startDemo();
      const result = service.defineCaseAttribute(
        'cmd-2',
        {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          definition: {
            id: 'custom.pet_sensory_fit',
            label: 'Pet sensory fit',
            valueType: 'text',
            appliesTo: ['car'],
            evidenceExpectation: 'assertion',
            comparison: 'none',
            reason: 'reason',
          },
        },
        'agent_proposed',
      );
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const extensionId = updated.caseExtensions[0]?.id;
      if (extensionId === undefined) throw new Error('expected extension id');
      return { snapshot: updated, extensionId };
    }

    it('confirming an agent-defined extension succeeds and leaves it confirmed (ADR 0011: a re-affirmation, since a pre-authorized extension already landed confirmed)', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();
      const result = service.reviewCaseExtension('cmd-3', {
        caseId: snapshot.id,
        extensionId,
        decision: 'confirm',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.confirmation).toBe('confirmed');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.reviewCaseExtension('cmd-3', {
        caseId: '',
        extensionId: '',
        decision: 'confirm',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.reviewCaseExtension('cmd-3', {
        caseId: 'missing',
        extensionId: 'x',
        decision: 'confirm',
        expectedSequence: 0,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();
      const result = service.reviewCaseExtension('cmd-3', {
        caseId: snapshot.id,
        extensionId,
        decision: 'confirm',
        expectedSequence: snapshot.eventSequence + 1,
      });
      expect(result.status).toBe('conflict');
    });

    it('rejects reviewing an unknown extensionId (validation)', () => {
      const { snapshot } = withAgentDefinedExtension();
      const result = service.reviewCaseExtension('cmd-3', {
        caseId: snapshot.id,
        extensionId: 'does-not-exist',
        decision: 'confirm',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('validation');
    });

    it('rejects reviewing an already-REJECTED extension (validation, from the core domain function): rejection is terminal, and nothing revives it', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();
      const first = service.reviewCaseExtension('cmd-3', {
        caseId: snapshot.id,
        extensionId,
        decision: 'reject',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(first);
      const updated = requireSnapshot(first.value);
      const second = service.reviewCaseExtension('cmd-4', {
        caseId: snapshot.id,
        extensionId,
        decision: 'confirm',
        expectedSequence: updated.eventSequence,
      });
      expect(second.status).toBe('validation');
      expect(caseStore.load(snapshot.id)?.caseExtensions[0]?.definition.confirmation).toBe(
        'rejected',
      );
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();
      const input = {
        caseId: snapshot.id,
        extensionId,
        decision: 'confirm' as const,
        expectedSequence: snapshot.eventSequence,
      };
      const first = service.reviewCaseExtension('cmd-3', input);
      requireOk(first);
      const second = service.reviewCaseExtension('cmd-3', input);
      requireOk(second);
      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
    });

    it('rejects a pending extension and records a "Rejected" activity summary (every other test above only ever confirms)', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();
      const result = service.reviewCaseExtension('cmd-3', {
        caseId: snapshot.id,
        extensionId,
        decision: 'reject',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.caseExtensions[0]?.definition.confirmation).toBe('rejected');

      const activity = activityStore.replayFrom(snapshot.id, 0);
      expect(activity.some((event) => event.summary.includes('Rejected case extension'))).toBe(
        true,
      );
    });

    it('returns a 409-shaped conflict when the underlying append() call itself detects the case has advanced', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.reviewCaseExtension('cmd-race', {
        caseId: snapshot.id,
        extensionId,
        decision: 'confirm',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('conflict');
    });

    it('invalidates a ready recommendation when confirming an extension an active criterion already depends on (item 4)', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();

      const criteriaResult = service.updateCriteria('cmd-criteria', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'pet-sensory-fit',
              label: 'Pet sensory fit',
              kind: 'preference',
              weight: 30,
              direction: 'qualitative',
              appliesToAttribute: 'custom.pet_sensory_fit',
            },
          },
        ],
      });
      requireOk(criteriaResult);
      const withCriterion = requireSnapshot(criteriaResult.value);

      const appended = caseStore.append(
        withCriterion.id,
        [
          {
            eventId: 'ev-rec',
            caseId: withCriterion.id,
            sequence: withCriterion.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        withCriterion.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');

      const result = service.reviewCaseExtension('cmd-confirm', {
        caseId: appended.snapshot.id,
        extensionId,
        decision: 'confirm',
        expectedSequence: appended.snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('stale');
      const activity = activityStore.replayFrom(appended.snapshot.id, 0);
      expect(activity.some((event) => event.type === 'recommendation.invalidated')).toBe(true);
    });

    it('does NOT invalidate a ready recommendation when confirming an extension no active criterion references (precision)', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();

      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');

      const result = service.reviewCaseExtension('cmd-confirm', {
        caseId: appended.snapshot.id,
        extensionId,
        decision: 'confirm',
        expectedSequence: appended.snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('ready');
    });

    it('DOES invalidate a ready recommendation when rejecting a CONFIRMED extension an active criterion depends on -- the ADR 0011 undo takes away a column the recommendation was computed from', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();

      const criteriaResult = service.updateCriteria('cmd-criteria', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'pet-sensory-fit',
              label: 'Pet sensory fit',
              kind: 'preference',
              weight: 30,
              direction: 'qualitative',
              appliesToAttribute: 'custom.pet_sensory_fit',
            },
          },
        ],
      });
      requireOk(criteriaResult);
      const withCriterion = requireSnapshot(criteriaResult.value);

      const appended = caseStore.append(
        withCriterion.id,
        [
          {
            eventId: 'ev-rec',
            caseId: withCriterion.id,
            sequence: withCriterion.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        withCriterion.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');

      const result = service.reviewCaseExtension('cmd-reject', {
        caseId: appended.snapshot.id,
        extensionId,
        decision: 'reject',
        expectedSequence: appended.snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('stale');
      expect(
        activityStore
          .replayFrom(appended.snapshot.id, 0)
          .some((event) => event.type === 'recommendation.invalidated'),
      ).toBe(true);
    });

    it('does NOT invalidate a ready recommendation when rejecting an extension no active criterion references (precision, the reject side of the same rule)', () => {
      const { snapshot, extensionId } = withAgentDefinedExtension();

      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');

      const result = service.reviewCaseExtension('cmd-reject', {
        caseId: appended.snapshot.id,
        extensionId,
        decision: 'reject',
        expectedSequence: appended.snapshot.eventSequence,
      });
      requireOk(result);
      expect(requireSnapshot(result.value).recommendation?.status).toBe('ready');
    });
  });

  describe('updateCriteria', () => {
    /**
     * Marking a recommendation stale says the old answer is wrong. It does
     * not, by itself, make a new one reachable.
     *
     * `selectNextObligation` only considers `open` obligations, so on a case
     * whose obligations had all been satisfied, reweighting left nothing to
     * investigate and the follow-up run failed outright with "No open
     * obligation remains to select." Reweighting-changes-the-ranking is the
     * adaptive moment both shipped packs are built around, and it was
     * unreachable through the product's own controls -- the demo scripts
     * routed around it via DevTools rather than the UI.
     *
     * The distinction that fixes it is between a measurement and a
     * synthesis. What the tariff change cost is just as true after the
     * household decides conservation matters more; which option best fits
     * the criteria is not. Only obligations marked `dependsOnCriteria`
     * reopen.
     */
    /**
     * Adds an unprotected preference criterion this block can actually
     * reweight. Deliberately created here rather than added to the shared
     * synthetic pack: a second scoring criterion in that fixture silently
     * re-ranks every other test's options.
     */
    function withReweightableCriterion(snapshot: CaseState): CaseState {
      const added = service.updateCriteria('cmd-add-reweightable', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'value',
              label: 'Value',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      requireOk(added);
      return requireSnapshot(added.value);
    }

    function satisfiedCaseWithRecommendation(snapshot: CaseState): CaseState {
      const events: CaseEvent[] = snapshot.obligations.map((obligation, index) => ({
        eventId: `ev-sat-${String(index)}`,
        caseId: snapshot.id,
        sequence: snapshot.eventSequence + index + 1,
        timestamp: FIXED_NOW,
        type: 'obligation.updated',
        payload: {
          obligation: { ...obligation, status: 'satisfied', attemptsUsed: 1 },
        },
      }));
      events.push({
        eventId: 'ev-rec-reweight',
        caseId: snapshot.id,
        sequence: snapshot.eventSequence + events.length + 1,
        timestamp: FIXED_NOW,
        type: 'recommendation.ready',
        payload: {
          recommendation: {
            id: 'rec-reweight',
            status: 'ready',
            favoredOptionId: null,
            rationale: 'because',
            facts: [],
            hypotheses: [],
            confidence: 0.5,
            limitations: [],
            sourceIds: [],
            resolvedObligationIds: [],
            acceptedUncertaintyObligationIds: [],
            generatedAt: FIXED_NOW,
          },
        },
      });
      const appended = caseStore.append(snapshot.id, events, snapshot.eventSequence);
      if (appended.status !== 'applied') throw new Error('test setup failed');
      return appended.snapshot;
    }

    it('reopens a satisfied synthesis obligation so the invalidated recommendation can actually be replaced', () => {
      const satisfied = satisfiedCaseWithRecommendation(withReweightableCriterion(startDemo()));
      expect(satisfied.obligations.every((o) => o.status === 'satisfied')).toBe(true);

      const result = service.updateCriteria('cmd-reweight', {
        caseId: satisfied.id,
        expectedSequence: satisfied.eventSequence,
        operations: [{ op: 'reweight', criterionId: 'value', weight: 90 }],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      const synthesis = updated.obligations.find((o) => o.id === 'synthesis');
      const measurement = updated.obligations.find((o) => o.id === 'hard-constraints');
      expect(synthesis?.status).toBe('open');
      // The measurement stands. Reweighting did not un-measure anything.
      expect(measurement?.status).toBe('satisfied');
      // Reopening restores the remaining budget rather than granting a new
      // one, so repeated reweights cannot loop forever.
      expect(synthesis?.attemptsUsed).toBe(1);
    });

    it('leaves obligations alone when no ready recommendation was invalidated', () => {
      const base = withReweightableCriterion(startDemo());
      const appended = caseStore.append(
        base.id,
        base.obligations.map((obligation, index) => ({
          eventId: `ev-only-sat-${String(index)}`,
          caseId: base.id,
          sequence: base.eventSequence + index + 1,
          timestamp: FIXED_NOW,
          type: 'obligation.updated' as const,
          payload: { obligation: { ...obligation, status: 'satisfied' as const, attemptsUsed: 1 } },
        })),
        base.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');
      const satisfied = appended.snapshot;
      const result = service.updateCriteria('cmd-reweight-2', {
        caseId: satisfied.id,
        expectedSequence: satisfied.eventSequence,
        operations: [{ op: 'reweight', criterionId: 'value', weight: 70 }],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.obligations.every((o) => o.status === 'satisfied')).toBe(true);
    });

    it('adds a new user-defined criterion (success)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'range',
              label: 'Range',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.criteria).toHaveLength(2);
      expect(updated.criteria.some((c) => c.id === 'range')).toBe(true);
      // Item 2: this criterion has no appliesToAttribute, so
      // `criterionNeedsEvidenceQuestion` says it always needs a case
      // obligation ("a criterion with no appliesToAttribute ... always
      // needs one" -- there is by definition no existing sourced fact that
      // could answer it).
      expect(updated.obligations.some((o) => o.id === 'case.range')).toBe(true);
      const derived = updated.obligations.find((o) => o.id === 'case.range');
      expect(derived?.origin).toBe('case_extension');
      expect(derived?.criterionId).toBe('range');
      expect(derived?.status).toBe('open');
    });

    it('does NOT derive a case obligation when the referenced attribute already has a sourced value on an existing option (item 2 precision)', () => {
      const snapshot = startDemo();
      const withOption = service.upsertOption('cmd-option', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: {
          label: 'Honda Civic',
          kind: 'car',
          attributes: [
            {
              definitionId: 'car.price',
              value: { type: 'money', amount: 24000, currency: 'USD' },
              sourceIds: ['source-1'],
            },
          ],
        },
      });
      requireOk(withOption);
      const afterOption = requireSnapshot(withOption.value);

      const result = service.updateCriteria('cmd-2', {
        caseId: afterOption.id,
        expectedSequence: afterOption.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'price-again',
              label: 'Price (again)',
              kind: 'preference',
              weight: 40,
              direction: 'lower_better',
              appliesToAttribute: 'car.price',
            },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.obligations.some((o) => o.id === 'case.price-again')).toBe(false);
    });

    it('DOES derive a case obligation when the referenced attribute has no sourced value yet (item 2, positive)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'custom.garage_clearance',
              label: 'Garage clearance',
              kind: 'hard_constraint',
              weight: 60,
              direction: 'target',
              appliesToAttribute: 'custom.garage_clearance',
              question: 'Does the vehicle clear an 84-inch garage opening?',
            },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const derived = updated.obligations.find((o) => o.id === 'case.custom.garage_clearance');
      expect(derived).toBeDefined();
      expect(derived?.question).toBe('Does the vehicle clear an 84-inch garage opening?');
      expect(derived?.priority).toBe(60);
      expect(derived?.acceptedUncertaintyAllowed).toBe(true);
      expect(derived?.maxAttempts).toBe(2);
    });

    it('rejects adding a user-defined criterion when the pinned pack disallows them (policy) -- the synthetic pack every other test uses has allowUserDefined: true, so this needs a differently-configured pack', () => {
      const noUserDefinedRegistry = new PackRegistry();
      noUserDefinedRegistry.register(
        compilePack(
          syntheticCarPurchaseManifest({
            criteria: {
              defaults: [
                {
                  id: 'price',
                  label: 'Price',
                  kind: 'hard_constraint',
                  weight: 100,
                  direction: 'lower_better',
                  appliesToAttribute: 'car.price',
                  origin: 'pack',
                  status: 'active',
                },
              ],
              allowUserDefined: false,
              protectedCriterionIds: ['price'],
            },
          }),
          syntheticCatalog(),
          fixedClock,
        ),
      );
      const restrictedService = new CommandService({
        caseStore: new MemoryCaseStore(),
        activityStore: new InMemoryActivityStore(),
        registry: noUserDefinedRegistry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });
      const startResult = restrictedService.startDemo('cmd-1', { demoId: 'car-purchase' });
      requireOk(startResult);
      const restrictedSnapshot = requireSnapshot(startResult.value);

      const result = restrictedService.updateCriteria('cmd-2', {
        caseId: restrictedSnapshot.id,
        expectedSequence: restrictedSnapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'range',
              label: 'Range',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      expect(result.status).toBe('policy');
    });

    it('adds a criterion carrying optional target, appliesToAttribute, and question fields when provided (the "adds a new user-defined criterion" success test above sets none of them)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'max-price-hard',
              label: 'Max acceptable price',
              kind: 'hard_constraint',
              weight: 50,
              direction: 'target',
              target: { type: 'money', amount: 30000, currency: 'USD' },
              appliesToAttribute: 'car.price',
              question: 'What is the maximum acceptable out-the-door price?',
            },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const criterion = updated.criteria.find((c) => c.id === 'max-price-hard');
      expect(criterion?.target).toEqual({ type: 'money', amount: 30000, currency: 'USD' });
      expect(criterion?.appliesToAttribute).toBe('car.price');
      expect(criterion?.question).toBe('What is the maximum acceptable out-the-door price?');
    });

    it('removes a non-protected, previously user-added criterion (success) -- every removal test elsewhere in this block only exercises rejection paths', () => {
      const snapshot = startDemo();
      const added = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'range',
              label: 'Range',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      requireOk(added);
      const afterAdd = requireSnapshot(added.value);

      const result = service.updateCriteria('cmd-3', {
        caseId: snapshot.id,
        expectedSequence: afterAdd.eventSequence,
        operations: [{ op: 'remove', criterionId: 'range' }],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      // removeCriterion() marks the criterion 'excluded' rather than
      // deleting the entry (packages/core/src/criteria.ts) -- both entries
      // are still present, but "range" is no longer active.
      expect(updated.criteria).toHaveLength(2);
      const removed = updated.criteria.find((c) => c.id === 'range');
      expect(removed?.status).toBe('excluded');
    });

    it('rejects removing a protected criterion (policy)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [{ op: 'remove', criterionId: 'price' }],
      });
      expect(result.status).toBe('policy');
    });

    it('rejects reweighting a protected criterion (policy)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [{ op: 'reweight', criterionId: 'price', weight: 50 }],
      });
      expect(result.status).toBe('policy');
    });

    it('rejects an operation on an unknown criterionId (validation)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [{ op: 'rename', criterionId: 'does-not-exist', label: 'x' }],
      });
      expect(result.status).toBe('validation');
    });

    it('rejects adding a criterion with a duplicate id (validation, from the core domain function)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'price', // already exists as a pack default
              label: 'Price again',
              kind: 'preference',
              weight: 10,
              direction: 'lower_better',
            },
          },
        ],
      });
      expect(result.status).toBe('validation');
    });

    it('rejects removing an unknown criterionId (validation, from the core domain function)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [{ op: 'remove', criterionId: 'does-not-exist' }],
      });
      expect(result.status).toBe('validation');
    });

    it('rejects reweighting an unknown criterionId (validation, from the core domain function)', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        operations: [{ op: 'reweight', criterionId: 'does-not-exist', weight: 50 }],
      });
      expect(result.status).toBe('validation');
    });

    it('throws (real invariant violation) when the case pinned pack is missing from the registry', () => {
      const snapshot = startDemo();
      // A second service sharing the same caseStore but a fresh, empty
      // registry -- simulates the case's pinned pack having vanished from
      // the registry, which real production wiring should never allow but
      // which this method defends against explicitly rather than silently
      // misbehaving.
      const strandedService = new CommandService({
        caseStore,
        activityStore: new InMemoryActivityStore(),
        registry: new PackRegistry(),
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      expect(() =>
        strandedService.updateCriteria('cmd-2', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          operations: [{ op: 'rename', criterionId: 'price', label: 'x' }],
        }),
      ).toThrow(/is not present in the registry/);
    });

    it('rejects invalid input (validation)', () => {
      const result = service.updateCriteria('cmd-2', {
        caseId: '',
        expectedSequence: -1,
        operations: [],
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.updateCriteria('cmd-2', {
        caseId: 'missing',
        expectedSequence: 0,
        operations: [{ op: 'rename', criterionId: 'x', label: 'y' }],
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startDemo();
      const result = service.updateCriteria('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence + 1,
        // `rename` on 'price' was the vehicle here until ADR 0011 made
        // protected criteria unrenameable as well as unremovable. This
        // test is about invalidation/idempotency/conflict, not about
        // rename, so it uses a legal mutation instead; the assertions
        // below are unchanged.
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'custom.comfort',
              label: 'Comfort',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      expect(result.status).toBe('conflict');
    });

    it('invalidates a ready recommendation when criteria change', () => {
      const snapshot = startDemo();
      caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      const withRecommendation = caseStore.load(snapshot.id);
      if (withRecommendation === undefined) throw new Error('expected case');

      const result = service.updateCriteria('cmd-3', {
        caseId: snapshot.id,
        expectedSequence: withRecommendation.eventSequence,
        // `rename` on 'price' was the vehicle here until ADR 0011 made
        // protected criteria unrenameable as well as unremovable. This
        // test is about invalidation/idempotency/conflict, not about
        // rename, so it uses a legal mutation instead; the assertions
        // below are unchanged.
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'custom.comfort',
              label: 'Comfort',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.recommendation?.status).toBe('stale');

      const activity = activityStore.replayFrom(snapshot.id, 0);
      expect(activity.some((event) => event.type === 'recommendation.invalidated')).toBe(true);
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const snapshot = startDemo();
      const input = {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        // `rename` on 'price' was the vehicle here until ADR 0011 made
        // protected criteria unrenameable as well as unremovable. This
        // test is about invalidation/idempotency/conflict, not about
        // rename, so it uses a legal mutation instead; the assertions
        // below are unchanged.
        operations: [
          {
            op: 'add' as const,
            criterion: {
              id: 'custom.comfort',
              label: 'Comfort',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      };
      const first = service.updateCriteria('cmd-2', input);
      requireOk(first);
      const second = service.updateCriteria('cmd-2', input);
      requireOk(second);
      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
    });

    it('returns a 409-shaped conflict when the underlying append() call itself detects the case has advanced', () => {
      const snapshot = startDemo();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.updateCriteria('cmd-race', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        // `rename` on 'price' was the vehicle here until ADR 0011 made
        // protected criteria unrenameable as well as unremovable. This
        // test is about invalidation/idempotency/conflict, not about
        // rename, so it uses a legal mutation instead; the assertions
        // below are unchanged.
        operations: [
          {
            op: 'add',
            criterion: {
              id: 'custom.comfort',
              label: 'Comfort',
              kind: 'preference',
              weight: 40,
              direction: 'higher_better',
            },
          },
        ],
      });
      expect(result.status).toBe('conflict');
    });
  });

  describe('submitSource', () => {
    it('adds a source to the case (success)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/review',
          title: 'Consumer review',
          retrievedAt: FIXED_NOW,
          claims: [],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.sources).toHaveLength(1);
      expect(updated.sources[0]?.title).toBe('Consumer review');
      expect(updated.sources[0]?.verification).toBe('unverified');
      // Non-event-sourced escape hatch: does not advance eventSequence.
      expect(updated.eventSequence).toBe(snapshot.eventSequence);
    });

    it('rejects invalid input (validation)', () => {
      const result = service.submitSource('cmd-2', { caseId: '', expectedSequence: -1 });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.submitSource('cmd-2', {
        caseId: 'missing',
        expectedSequence: 0,
        source: { url: 'https://example.com', title: 'x', retrievedAt: FIXED_NOW, claims: [] },
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence + 1,
        source: { url: 'https://example.com', title: 'x', retrievedAt: FIXED_NOW, claims: [] },
      });
      expect(result.status).toBe('conflict');
    });

    it('is idempotent: retrying the same commandId does not add the source twice', () => {
      const snapshot = startDemo();
      const input = {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: { url: 'https://example.com', title: 'x', retrievedAt: FIXED_NOW, claims: [] },
      };
      const first = service.submitSource('cmd-2', input);
      requireOk(first);
      const second = service.submitSource('cmd-2', input);
      requireOk(second);
      expect(requireSnapshot(second.value).sources).toHaveLength(1);
    });

    it('captures optional publisher, publishedAt, and excerpt fields when the caller provides them (the "adds a source" success test above omits all three)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/review',
          title: 'Consumer review',
          publisher: 'Consumer Reports',
          publishedAt: FIXED_NOW,
          retrievedAt: FIXED_NOW,
          excerpt: 'This car scored well in reliability testing.',
          claims: [],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.sources[0]?.publisher).toBe('Consumer Reports');
      expect(updated.sources[0]?.publishedAt).toBe(FIXED_NOW);
      expect(updated.sources[0]?.excerpt).toBe('This car scored well in reliability testing.');
    });

    it('turns submitted claims into durable, option-linked Claim records when obligationId is provided (item 5, §27)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        obligationId: 'hard-constraints',
        source: {
          url: 'https://example.com/review/cx-50',
          title: 'CX-50 owner forum thread',
          retrievedAt: FIXED_NOW,
          claims: [
            { statement: 'Ride is stiff on rough pavement.', appliesToEntityIds: ['car-1'] },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);

      expect(updated.sources).toHaveLength(1);
      const sourceId = updated.sources[0]!.id;

      expect(updated.claims).toHaveLength(1);
      const claim = updated.claims[0]!;
      expect(claim.obligationId).toBe('hard-constraints');
      expect(claim.entityId).toBe('car-1');
      expect(claim.statement).toBe('Ride is stiff on rough pavement.');
      expect(claim.sourceIds).toEqual([sourceId]);
      expect(claim.stale).toBe(false);

      // A raw, freshly-submitted, not-yet-verified claim is honestly weak
      // evidence: exactly one EvidenceLink, tagged E0 ("unverified
      // statement or user-provided assertion" -- evidence.ts's own
      // achievedEvidenceLevel doc comment), linked back to this claim and
      // this source.
      expect(updated.evidenceLinks).toHaveLength(1);
      const link = updated.evidenceLinks[0]!;
      expect(link.obligationId).toBe('hard-constraints');
      expect(link.claimId).toBe(claim.id);
      expect(link.sourceId).toBe(sourceId);
      expect(link.level).toBe('E0');
      expect(link.verdict).toBe('pass');
      expect(link.disposition).toBe('included');

      // The claim-linkage path uses append() (real CaseEvents), unlike the
      // pre-existing source-only path -- eventSequence now genuinely
      // advances.
      expect(updated.eventSequence).toBeGreaterThan(snapshot.eventSequence);
    });

    it('creates one Claim per entity when a claim names multiple appliesToEntityIds (each is genuinely option-linked)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        obligationId: 'hard-constraints',
        source: {
          url: 'https://example.com/review',
          title: 'Comparative review',
          retrievedAt: FIXED_NOW,
          claims: [
            {
              statement: 'Both trims have stiff rear suspension.',
              appliesToEntityIds: ['car-1', 'car-2'],
            },
          ],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.claims).toHaveLength(2);
      expect(updated.claims.map((c) => c.entityId).sort()).toEqual(['car-1', 'car-2']);
      expect(updated.evidenceLinks).toHaveLength(2);
    });

    it('creates one case-general Claim (no entityId) when appliesToEntityIds is empty -- durable, just not option-linked (honest, not fabricated)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        obligationId: 'hard-constraints',
        source: {
          url: 'https://example.com/review',
          title: 'General market review',
          retrievedAt: FIXED_NOW,
          claims: [{ statement: 'This model year had a recall.', appliesToEntityIds: [] }],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.claims).toHaveLength(1);
      expect(updated.claims[0]?.entityId).toBeUndefined();
    });

    it('persists the source but honestly skips claim linkage when obligationId is absent, and says so in the activity summary (does not silently drop)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/review',
          title: 'Unlinked review',
          retrievedAt: FIXED_NOW,
          claims: [{ statement: 'Ride is stiff.', appliesToEntityIds: ['car-1'] }],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.sources).toHaveLength(1);
      expect(updated.claims).toHaveLength(0);
      expect(updated.evidenceLinks).toHaveLength(0);
      // Unchanged pre-existing behavior when no linkage happens.
      expect(updated.eventSequence).toBe(snapshot.eventSequence);

      const activity = activityStore.replayFrom(snapshot.id, 0);
      expect(
        activity.some(
          (event) =>
            event.summary.includes('1 claim') && event.summary.toLowerCase().includes('not linked'),
        ),
      ).toBe(true);
    });

    it('rejects an obligationId that does not exist on the case (validation, no fabricated linkage)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        obligationId: 'does-not-exist',
        source: {
          url: 'https://example.com/review',
          title: 'Review',
          retrievedAt: FIXED_NOW,
          claims: [{ statement: 'Ride is stiff.', appliesToEntityIds: ['car-1'] }],
        },
      });
      expect(result.status).toBe('validation');
    });

    it('does not require any claims to be present even when obligationId is supplied (no-op linkage step, source still persists)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        obligationId: 'hard-constraints',
        source: {
          url: 'https://example.com/review',
          title: 'Review with no claims',
          retrievedAt: FIXED_NOW,
          claims: [],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.sources).toHaveLength(1);
      expect(updated.claims).toHaveLength(0);
      expect(updated.eventSequence).toBe(snapshot.eventSequence);
    });

    // --- Reference-library fields: tags / summary / summaryFormat ---
    //
    // `SourceSchema` (packages/contracts/src/case.ts) carries `tags`,
    // `summary`, and `summaryFormat` so the case's sources can be browsed and
    // organised as a reference library. `submitSource` is the only writer of
    // a `Source` record on this path, so these tests pin that it actually
    // persists them (and how it normalises tags) rather than quietly
    // accepting and discarding them.

    it('persists tags, summary, and summaryFormat onto the Source record', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/paper',
          title: 'Long-term reliability study',
          retrievedAt: FIXED_NOW,
          tags: ['Reliability', 'Research paper'],
          summary: 'Ten-year failure rates, broken down by drivetrain.',
          summaryFormat: 'markdown',
          claims: [],
        },
      });
      requireOk(result);
      const stored = requireSnapshot(result.value).sources[0];
      expect(stored?.tags).toEqual(['Reliability', 'Research paper']);
      expect(stored?.summary).toBe('Ten-year failure rates, broken down by drivetrain.');
      expect(stored?.summaryFormat).toBe('markdown');
    });

    it('accepts a source with no claims and no obligationId as a plain reference (no claim, no evidence link, no sequence advance)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/blog',
          title: 'A blog post worth keeping',
          retrievedAt: FIXED_NOW,
          tags: ['Background'],
          claims: [],
        },
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.sources).toHaveLength(1);
      expect(updated.sources[0]?.tags).toEqual(['Background']);
      expect(updated.claims).toHaveLength(0);
      expect(updated.evidenceLinks).toHaveLength(0);
      expect(updated.eventSequence).toBe(snapshot.eventSequence);
    });

    it('normalises tags conservatively: trims, drops empties, de-duplicates case-insensitively, and keeps the submitter’s first casing', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/paper',
          title: 'Study',
          retrievedAt: FIXED_NOW,
          tags: ['  Reliability  ', '', '   ', 'reliability', 'RELIABILITY', 'Safety'],
          claims: [],
        },
      });
      requireOk(result);
      // First occurrence wins, with its own casing preserved for display --
      // never lowercased destructively, and never turned into a controlled
      // vocabulary.
      expect(requireSnapshot(result.value).sources[0]?.tags).toEqual(['Reliability', 'Safety']);
    });

    it('omits `tags` entirely when every submitted tag normalises away (never stores an empty array)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/paper',
          title: 'Study',
          retrievedAt: FIXED_NOW,
          tags: ['   ', ''],
          claims: [],
        },
      });
      requireOk(result);
      expect(requireSnapshot(result.value).sources[0]?.tags).toBeUndefined();
    });

    it('omits `summaryFormat` when no `summary` accompanies it (a format for absent text describes nothing)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/paper',
          title: 'Study',
          retrievedAt: FIXED_NOW,
          summaryFormat: 'markdown',
          claims: [],
        },
      });
      requireOk(result);
      const stored = requireSnapshot(result.value).sources[0];
      expect(stored?.summary).toBeUndefined();
      expect(stored?.summaryFormat).toBeUndefined();
    });

    it('leaves tags, summary, and summaryFormat absent when the caller supplies none (never fabricates a tag)', () => {
      const snapshot = startDemo();
      const result = service.submitSource('cmd-2', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        source: {
          url: 'https://example.com/paper',
          title: 'Study',
          retrievedAt: FIXED_NOW,
          claims: [],
        },
      });
      requireOk(result);
      const stored = requireSnapshot(result.value).sources[0];
      expect(stored?.tags).toBeUndefined();
      expect(stored?.summary).toBeUndefined();
      expect(stored?.summaryFormat).toBeUndefined();
    });

    it('is idempotent for the claim-linking path too: retrying the same commandId does not double-create claims or the source', () => {
      const snapshot = startDemo();
      const input = {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        obligationId: 'hard-constraints',
        source: {
          url: 'https://example.com/review',
          title: 'Review',
          retrievedAt: FIXED_NOW,
          claims: [{ statement: 'Ride is stiff.', appliesToEntityIds: ['car-1'] }],
        },
      };
      const first = service.submitSource('cmd-2', input);
      requireOk(first);
      const second = service.submitSource('cmd-2', input);
      requireOk(second);
      const updated = requireSnapshot(second.value);
      expect(updated.sources).toHaveLength(1);
      expect(updated.claims).toHaveLength(1);
    });
  });

  describe('setEvidenceDisposition', () => {
    function withEvidence(): { snapshot: CaseState; evidenceId: string } {
      const snapshot = startDemo();
      caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-evidence',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'evidence.accepted',
            payload: {
              evidenceLink: {
                id: 'evidence-1',
                obligationId: 'hard-constraints',
                level: 'E1',
                verdict: 'pass',
                disposition: 'included',
                summary: 'summary',
                stale: false,
                createdAt: FIXED_NOW,
                updatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      const updated = caseStore.load(snapshot.id);
      if (updated === undefined) throw new Error('expected case');
      return { snapshot: updated, evidenceId: 'evidence-1' };
    }

    it('changes an evidence link disposition (success)', () => {
      const { snapshot, evidenceId } = withEvidence();
      const result = service.setEvidenceDisposition('cmd-3', {
        caseId: snapshot.id,
        evidenceId,
        disposition: 'excluded',
        reason: 'Not independent.',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      const link = updated.evidenceLinks.find((item) => item.id === evidenceId);
      expect(link?.disposition).toBe('excluded');
      expect(link?.dispositionReason).toBe('Not independent.');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.setEvidenceDisposition('cmd-3', {
        caseId: '',
        evidenceId: '',
        disposition: 'excluded',
        reason: '',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.setEvidenceDisposition('cmd-3', {
        caseId: 'missing',
        evidenceId: 'x',
        disposition: 'excluded',
        reason: 'reason',
        expectedSequence: 0,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const { snapshot, evidenceId } = withEvidence();
      const result = service.setEvidenceDisposition('cmd-3', {
        caseId: snapshot.id,
        evidenceId,
        disposition: 'excluded',
        reason: 'reason',
        expectedSequence: snapshot.eventSequence + 1,
      });
      expect(result.status).toBe('conflict');
    });

    it('rejects an unknown evidenceId (validation)', () => {
      const { snapshot } = withEvidence();
      const result = service.setEvidenceDisposition('cmd-3', {
        caseId: snapshot.id,
        evidenceId: 'does-not-exist',
        disposition: 'excluded',
        reason: 'reason',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('validation');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const { snapshot, evidenceId } = withEvidence();
      const input = {
        caseId: snapshot.id,
        evidenceId,
        disposition: 'excluded' as const,
        reason: 'Not independent.',
        expectedSequence: snapshot.eventSequence,
      };
      const first = service.setEvidenceDisposition('cmd-3', input);
      requireOk(first);
      const second = service.setEvidenceDisposition('cmd-3', input);
      requireOk(second);
      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
    });

    it('returns a 409-shaped conflict when the underlying append() call itself detects the case has advanced', () => {
      const { snapshot, evidenceId } = withEvidence();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.setEvidenceDisposition('cmd-race', {
        caseId: snapshot.id,
        evidenceId,
        disposition: 'excluded',
        reason: 'reason',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('conflict');
    });
  });

  describe('focusEvidence', () => {
    function withEvidence(): { snapshot: CaseState; evidenceId: string } {
      const snapshot = startDemo();
      caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-evidence',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'evidence.accepted',
            payload: {
              evidenceLink: {
                id: 'evidence-1',
                obligationId: 'hard-constraints',
                level: 'E1',
                verdict: 'pass',
                disposition: 'included',
                summary: 'summary',
                stale: false,
                createdAt: FIXED_NOW,
                updatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      const updated = caseStore.load(snapshot.id);
      if (updated === undefined) throw new Error('expected case');
      return { snapshot: updated, evidenceId: 'evidence-1' };
    }

    it('sets selectedEvidenceId (success)', () => {
      const { snapshot, evidenceId } = withEvidence();
      const result = service.focusEvidence('cmd-3', {
        caseId: snapshot.id,
        evidenceId,
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      expect(requireSnapshot(result.value).selectedEvidenceId).toBe(evidenceId);
    });

    it('rejects invalid input (validation)', () => {
      const result = service.focusEvidence('cmd-3', {
        caseId: '',
        evidenceId: '',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('rejects an unknown evidenceId (validation)', () => {
      const { snapshot } = withEvidence();
      const result = service.focusEvidence('cmd-3', {
        caseId: snapshot.id,
        evidenceId: 'does-not-exist',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.focusEvidence('cmd-3', {
        caseId: 'missing',
        evidenceId: 'x',
        expectedSequence: 0,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const { snapshot, evidenceId } = withEvidence();
      const result = service.focusEvidence('cmd-3', {
        caseId: snapshot.id,
        evidenceId,
        expectedSequence: snapshot.eventSequence + 1,
      });
      expect(result.status).toBe('conflict');
    });

    it('is idempotent: retrying the same commandId returns the original result', () => {
      const { snapshot, evidenceId } = withEvidence();
      const input = { caseId: snapshot.id, evidenceId, expectedSequence: snapshot.eventSequence };
      const first = service.focusEvidence('cmd-3', input);
      requireOk(first);
      const second = service.focusEvidence('cmd-3', input);
      requireOk(second);
      expect(second.value.caseId).toBe(first.value.caseId);
    });

    it('returns a 409-shaped conflict when the underlying updateSelection() call itself detects the case has advanced', () => {
      const { snapshot, evidenceId } = withEvidence();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.focusEvidence('cmd-race', {
        caseId: snapshot.id,
        evidenceId,
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('conflict');
    });

    // Identical reasoning to `focusOption`'s own "clears ... when optionId
    // is null" test above: `evidenceId: null` clears the selection and must
    // skip the "does this evidence link exist" check, which only makes
    // sense for a real id.
    it('clears selectedEvidenceId when evidenceId is null, without requiring an existing evidence link', () => {
      const { snapshot, evidenceId } = withEvidence();
      const focused = service.focusEvidence('cmd-3', {
        caseId: snapshot.id,
        evidenceId,
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(focused);
      const afterFocus = requireSnapshot(focused.value);
      expect(afterFocus.selectedEvidenceId).toBe(evidenceId);

      const cleared = service.focusEvidence('cmd-4', {
        caseId: snapshot.id,
        evidenceId: null,
        expectedSequence: afterFocus.eventSequence,
      });
      requireOk(cleared);
      const afterClear = requireSnapshot(cleared.value);
      expect(afterClear.selectedEvidenceId).toBeNull();
      expect(afterClear.eventSequence).toBe(snapshot.eventSequence);
    });
  });

  describe('reviewProposal and requestRevision', () => {
    function withPendingProposal(): { snapshot: CaseState } {
      const snapshot = startDemo();
      caseStore.append(
        snapshot.id,
        [
          {
            eventId: 'ev-rec',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'because',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
          {
            eventId: 'ev-proposal',
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 2,
            timestamp: FIXED_NOW,
            type: 'proposal.reviewed',
            payload: {
              proposal: {
                id: 'proposal-1',
                recommendationId: 'rec-1',
                status: 'pending',
                createdAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      const updated = caseStore.load(snapshot.id);
      if (updated === undefined) throw new Error('expected case');
      return { snapshot: updated };
    }

    it('approves a pending proposal when actor is human (success), moving the case to decided', () => {
      const { snapshot } = withPendingProposal();
      const result = service.reviewProposal('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'human',
        decision: 'approve',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.proposal?.status).toBe('approved');
      expect(updated.status).toBe('decided');
    });

    it('rejects an agent actor attempting to approve (policy) -- the human-only authority rule', () => {
      const { snapshot } = withPendingProposal();
      const result = service.reviewProposal('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'agent',
        decision: 'approve',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('policy');
      // The case must remain exactly as it was -- no partial mutation.
      expect(caseStore.load(snapshot.id)?.status).not.toBe('decided');
    });

    it('rejects invalid input (validation)', () => {
      const result = service.reviewProposal('cmd-3', {
        caseId: '',
        proposalId: '',
        actor: 'human',
        decision: 'approve',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('returns not_found for a missing case', () => {
      const result = service.reviewProposal('cmd-3', {
        caseId: 'missing',
        proposalId: 'x',
        actor: 'human',
        decision: 'approve',
        expectedSequence: 0,
      });
      expect(result.status).toBe('not_found');
    });

    it('returns conflict for a stale expectedSequence', () => {
      const { snapshot } = withPendingProposal();
      const result = service.reviewProposal('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'human',
        decision: 'approve',
        expectedSequence: snapshot.eventSequence + 1,
      });
      expect(result.status).toBe('conflict');
    });

    it('rejects reviewing a proposal id that does not match the pending one (validation, from core)', () => {
      const { snapshot } = withPendingProposal();
      const result = service.reviewProposal('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'does-not-match',
        actor: 'human',
        decision: 'approve',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('validation');
    });

    it('requestRevision routes through reviewProposal with decision request_revision and actor human (success)', () => {
      const { snapshot } = withPendingProposal();
      const result = service.requestRevision('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        instructions: 'Please reconsider the mileage assumption.',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.proposal?.status).toBe('revision_requested');
      expect(updated.proposal?.revisionInstructions).toBe(
        'Please reconsider the mileage assumption.',
      );
      // request_revision never approves -- status must not become decided.
      expect(updated.status).not.toBe('decided');
    });

    it('requestRevision rejects invalid input (validation)', () => {
      const result = service.requestRevision('cmd-3', {
        caseId: '',
        proposalId: '',
        instructions: '',
        expectedSequence: -1,
      });
      expect(result.status).toBe('validation');
    });

    it('is idempotent: retrying the same commandId returns the original result (applyProposalReview, shared by reviewProposal/requestRevision)', () => {
      const { snapshot } = withPendingProposal();
      const input = {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'human' as const,
        decision: 'approve' as const,
        expectedSequence: snapshot.eventSequence,
      };
      const first = service.reviewProposal('cmd-3', input);
      requireOk(first);
      const second = service.reviewProposal('cmd-3', input);
      requireOk(second);
      expect(second.value.acceptedSequence).toBe(first.value.acceptedSequence);
    });

    it('rejects a pending proposal when actor is human (success), recording a "Proposal rejected." activity summary (every other test above only ever approves or requests revision)', () => {
      const { snapshot } = withPendingProposal();
      const result = service.reviewProposal('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'human',
        decision: 'reject',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.proposal?.status).toBe('rejected');

      const activity = activityStore.replayFrom(snapshot.id, 0);
      expect(activity.some((event) => event.summary === 'Proposal rejected.')).toBe(true);
    });

    // Real defect found by driving the product: a human's stated reason for
    // declining a consequential proposal was validated by the HTTP layer,
    // routed all the way to `CommandService`, and then discarded --
    // `applyProposalReview` never read `input.reason` at all, and
    // `DecisionProposalSchema` had no field to hold it even if it had. Fixed
    // in `@sift/contracts` (`DecisionProposalSchema.reviewReason`) and
    // `@sift/core` (`reviewProposal` now writes it). Proven here at the
    // service/store layer, not only the pure `@sift/core` function: this
    // asserts the reason survives a real `CaseStore.append` + reload, the
    // way a person reloading the page after rejecting would see it.
    it('persists the reviewer-supplied reason through append() and a fresh load (was silently dropped end to end)', () => {
      const { snapshot } = withPendingProposal();
      const result = service.reviewProposal('cmd-3', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'human',
        decision: 'reject',
        reason: 'The household already scheduled its own inspection.',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.proposal?.reviewReason).toBe(
        'The household already scheduled its own inspection.',
      );

      // Reload from the store fresh -- proves this is durable case state,
      // not merely an in-memory echo of the input the caller already had.
      const reloaded = caseStore.load(snapshot.id);
      expect(reloaded?.proposal?.reviewReason).toBe(
        'The household already scheduled its own inspection.',
      );
    });

    it('returns a 409-shaped conflict when the underlying append() call itself detects the case has advanced (applyProposalReview, shared by reviewProposal/requestRevision)', () => {
      const { snapshot } = withPendingProposal();
      const advanced = service.upsertOption('cmd-real', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        option: { label: 'Toyota Corolla', kind: 'car', attributes: [] },
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: staleReadCaseStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.reviewProposal('cmd-race', {
        caseId: snapshot.id,
        proposalId: 'proposal-1',
        actor: 'human',
        decision: 'approve',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('conflict');
    });
  });

  // `applyProposalReview`'s `proposal === null` guard (right after the
  // try/catch around `reviewProposalDomain`) is not covered here,
  // deliberately: the method's own comment already documents why --
  // `reviewProposalDomain` (the real `@sift/core` function under test
  // throughout this describe block) only ever returns a `CaseState` with a
  // non-null `proposal`; every input that would leave one unset is rejected
  // via a thrown error first (caught above). Not reachable without directly
  // replacing `@sift/core`'s real `reviewProposal`, which this suite
  // deliberately never does.
  //
  // `applyProposalReview`'s `catch` block's `throw error;` re-throw (the
  // `isSiftDomainError(error)` false path) is likewise not covered:
  // `reviewProposalDomain` only ever throws `PolicyViolationError` or
  // `ValidationFailedError` (both `SiftDomainError` subclasses,
  // packages/core/src/errors.ts) -- confirmed by reading every throw site in
  // packages/core/src/policy.ts. The `isSiftDomainError(error)` *true*
  // branch is already covered above ("rejects reviewing a proposal id that
  // does not match the pending one").

  // `checkIdempotent`'s "idempotency record references a case that no
  // longer exists" throw (see that method's own comment) is not reachable
  // through any real `CaseStore` public API: both `MemoryCaseStore` and
  // `SqliteCaseStore`'s `resetDemo()` remove a case's idempotency records
  // together with the case itself (the SQLite `idempotency_keys.case_id`
  // foreign key cascades on delete; `MemoryCaseStore.resetDemo` mirrors
  // that by filtering its own idempotency map) -- unlike
  // `run-service.ts`'s equivalent guard (`run-service.test.ts` covers it),
  // whose `RunStore` is a genuinely separate store with no such enforced
  // consistency with `CaseStore`. Left as documented, provably-unreachable
  // defense-in-depth, the same treatment `case-store.ts`'s own analogous
  // "folding produced no snapshot" guard gets.

  // `toReceipt`'s own `switch (result.status)` statement is not given a
  // `default:` arm: `AppendResult['status']` is a closed, fully-enumerated
  // union ('applied' | 'duplicate' | 'conflict' | 'not_found'), and every one
  // of those four literal cases is genuinely exercised somewhere in this
  // file ('applied'/'duplicate' throughout; 'conflict'/'not_found' by the
  // race-simulation tests directly below). The switch's own implicit
  // "matched no case" fallthrough is therefore not reachable by any value a
  // real `CaseStore` can produce -- only by a `CaseStore` implementation
  // that violates its own return-type contract, which this suite does not
  // simulate (unlike the deliberate stale-`load()` race below, that would
  // not be testing this file's real behavior, only a fabricated one).

  describe('toReceipt() conflict/not_found passthrough from CaseStore.append() itself', () => {
    // `loadForMutation()` already pre-checks `expectedSequence` against
    // `caseStore.load()`'s result before any command builds its events --
    // in a single synchronous process (as every other test in this file
    // runs), that pre-check and the later `caseStore.append()` call always
    // agree, so `toReceipt`'s own `'conflict'`/`'not_found'` branches never
    // fire that way. They exist for the real case `append()`'s own atomic
    // check protects against: another request committing between this
    // command's read and its write (architecture.md "Command and event
    // flow": exactly the optimistic-concurrency contract `append()`
    // enforces). Simulated here with a store wrapper whose `load()`
    // deliberately returns a stale snapshot while `append()` still sees the
    // real, since-advanced state -- proving `toReceipt` (not just
    // `loadForMutation`) correctly turns each of `append()`'s outcomes into
    // the right `ServiceResult`.
    function withStaleReadStore(real: MemoryCaseStore, staleSnapshot: CaseState) {
      return {
        load: (_caseId: string) => staleSnapshot,
        append: real.append.bind(real),
        updateSelection: real.updateSelection.bind(real),
        peekIdempotent: real.peekIdempotent.bind(real),
        subscribe: real.subscribe.bind(real),
        resetDemo: real.resetDemo.bind(real),
      };
    }

    it('returns a 409-shaped conflict when append() itself detects the case has advanced', () => {
      const snapshot = startDemo();
      const staleSnapshot = snapshot;
      // A second command commits for real, advancing the case past what
      // the stale read above still reflects.
      const advanced = service.selectPack('cmd-real', {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: snapshot.eventSequence,
      });
      requireOk(advanced);

      const staleReadService = new CommandService({
        caseStore: withStaleReadStore(caseStore, staleSnapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.selectPack('cmd-race', {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: staleSnapshot.eventSequence,
      });
      expect(result.status).toBe('conflict');
      if (result.status !== 'conflict') throw new Error('expected conflict');
      expect(result.actualSequence).toBe(advanced.value.acceptedSequence);
    });

    it('returns not_found when append() itself finds the case gone', () => {
      const snapshot = startDemo();
      caseStore.resetDemo(snapshot.id);

      const staleReadService = new CommandService({
        caseStore: withStaleReadStore(caseStore, snapshot),
        activityStore,
        registry,
        clock: fixedClock,
        idGenerator: createSequentialIdGenerator(),
      });

      const result = staleReadService.selectPack('cmd-race', {
        caseId: snapshot.id,
        packId: 'car-purchase',
        expectedSequence: snapshot.eventSequence,
      });
      expect(result.status).toBe('not_found');
    });
  });

  describe('adaptive discovery commands', () => {
    function ready(): CaseState {
      return startDemo();
    }

    describe('updateDiscovery', () => {
      it('confirms a topic a person stated', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d1', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.use_case', valueSummary: 'family' }],
        });
        requireOk(result);

        const updated = requireSnapshot(result.value);
        const topic = updated.discovery?.topics.find((t) => t.topicId === 'car.use_case');
        expect(topic?.status).toBe('confirmed');
        expect(topic?.humanConfirmed).toBe(true);
        expect(topic?.origin).toBe('user');
      });

      it('parks an agent proposal as an inference rather than a fact', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d2', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'agent',
          operations: [
            {
              op: 'propose',
              topicId: 'car.budget',
              valueSummary: 'Sounds like about 40,000',
              confidence: 0.6,
            },
          ],
        });
        requireOk(result);

        const topic = requireSnapshot(result.value).discovery?.topics.find(
          (t) => t.topicId === 'car.budget',
        );
        expect(topic?.status).toBe('inferred_pending');
        expect(topic?.humanConfirmed).toBe(false);
      });

      it('refuses an agent trying to confirm', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d3', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'agent',
          operations: [{ op: 'confirm', topicId: 'car.budget', valueSummary: '40,000' }],
        });

        expect(result.status).toBe('validation');
      });

      it('refuses a topic the pinned pack does not declare', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d4', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.invented', valueSummary: 'x' }],
        });

        expect(result.status).toBe('validation');
      });

      it('refuses a topic that does not apply to this case', () => {
        // `car.payload` is business-only, and this case has not said it is a
        // business, so nobody was ever shown that question.
        const snapshot = ready();
        const confirmed = service.updateDiscovery('cmd-d5', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.use_case', valueSummary: 'family' }],
        });
        requireOk(confirmed);

        const result = service.updateDiscovery('cmd-d6', {
          caseId: snapshot.id,
          expectedSequence: requireSnapshot(confirmed.value).eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.payload', valueSummary: 'Two tonnes' }],
        });

        expect(result.status).toBe('validation');
      });

      it('brings a conditional topic into scope once the case says it is a business', () => {
        const snapshot = ready();
        const confirmed = service.updateDiscovery('cmd-d7', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.use_case', valueSummary: 'business' }],
        });
        requireOk(confirmed);

        const result = service.updateDiscovery('cmd-d8', {
          caseId: snapshot.id,
          expectedSequence: requireSnapshot(confirmed.value).eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.payload', valueSummary: 'Two tonnes' }],
        });

        requireOk(result);
      });

      it('marks a topic not applicable with the reason the person gave', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d9', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [
            { op: 'not_applicable', topicId: 'car.budget', reason: 'Company is paying' },
          ],
        });
        requireOk(result);

        const topic = requireSnapshot(result.value).discovery?.topics.find(
          (t) => t.topicId === 'car.budget',
        );
        expect(topic?.status).toBe('not_applicable');
      });

      it('rejects a defer of a required topic in companion mode', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d10', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'defer', topicId: 'car.budget' }],
        });

        expect(result.status).toBe('validation');
      });

      it('allows deferring a soft topic', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d11', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'defer', topicId: 'car.colour' }],
        });
        requireOk(result);

        const topic = requireSnapshot(result.value).discovery?.topics.find(
          (t) => t.topicId === 'car.colour',
        );
        expect(topic?.status).toBe('deferred');
      });

      it('rejects an agent overwriting a human-confirmed value', () => {
        const snapshot = ready();
        const confirmed = service.updateDiscovery('cmd-d12', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [{ op: 'confirm', topicId: 'car.budget', valueSummary: 'Ceiling 40,000' }],
        });
        requireOk(confirmed);

        const result = service.updateDiscovery('cmd-d13', {
          caseId: snapshot.id,
          expectedSequence: requireSnapshot(confirmed.value).eventSequence,
          actor: 'agent',
          operations: [
            {
              op: 'propose',
              topicId: 'car.budget',
              valueSummary: 'Maybe 45,000',
              confidence: 0.5,
            },
          ],
        });

        expect(result.status).toBe('validation');
      });

      it('emits one topic event per operation', () => {
        const snapshot = ready();
        const result = service.updateDiscovery('cmd-d14', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          operations: [
            { op: 'confirm', topicId: 'car.use_case', valueSummary: 'family' },
            { op: 'confirm', topicId: 'car.budget', valueSummary: 'Ceiling 40,000' },
          ],
        });
        requireOk(result);

        const updated = requireSnapshot(result.value);
        expect(updated.eventSequence).toBe(snapshot.eventSequence + 2);
      });
    });

    describe('setCandidateDisposition', () => {
      function withCandidate(): CaseState {
        const snapshot = startDemo();
        const result = service.upsertOption('cmd-c1', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          option: { label: 'Honda CR-V', kind: 'car', attributes: [] },
        });
        requireOk(result);
        return requireSnapshot(result.value);
      }

      it('records a Keep with what it replaced', () => {
        const snapshot = withCandidate();
        const entityId = snapshot.entities[0]?.id;
        if (entityId === undefined) throw new Error('expected candidate');

        const result = service.setCandidateDisposition('cmd-c2', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          entityId,
          disposition: 'keep',
        });
        requireOk(result);

        const record = requireSnapshot(result.value).discovery?.dispositions[0];
        expect(record?.disposition).toBe('keep');
        expect(record?.previousDisposition).toBe('unreviewed');
      });

      it('undoes back to unreviewed while keeping what it replaced', () => {
        const snapshot = withCandidate();
        const entityId = snapshot.entities[0]?.id;
        if (entityId === undefined) throw new Error('expected candidate');

        const kept = service.setCandidateDisposition('cmd-c3', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          entityId,
          disposition: 'pass',
        });
        requireOk(kept);

        const undone = service.setCandidateDisposition('cmd-c4', {
          caseId: snapshot.id,
          expectedSequence: requireSnapshot(kept.value).eventSequence,
          actor: 'human',
          entityId,
          disposition: 'unreviewed',
        });
        requireOk(undone);

        const record = requireSnapshot(undone.value).discovery?.dispositions[0];
        expect(record?.disposition).toBe('unreviewed');
        expect(record?.previousDisposition).toBe('pass');
      });

      it('refuses an agent disposition', () => {
        const snapshot = withCandidate();
        const entityId = snapshot.entities[0]?.id;
        if (entityId === undefined) throw new Error('expected candidate');

        const result = service.setCandidateDisposition('cmd-c5', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'agent',
          entityId,
          disposition: 'pass',
        });

        expect(result.status).toBe('validation');
      });

      it('refuses a disposition on a candidate that does not exist', () => {
        const snapshot = withCandidate();
        const result = service.setCandidateDisposition('cmd-c6', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          entityId: 'candidate-does-not-exist',
          disposition: 'keep',
        });

        expect(result.status).toBe('validation');
      });
    });

    describe('completeBlindSpotReview', () => {
      it('records the review a person answered', () => {
        const snapshot = startDemo();
        const result = service.completeBlindSpotReview('cmd-b1', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          offeredPromptIds: ['blindspot.parking'],
          selectedPromptIds: ['blindspot.parking'],
        });
        requireOk(result);

        const review = requireSnapshot(result.value).discovery?.blindSpotReview;
        expect(review?.status).toBe('complete');
        expect(review?.acknowledgedAt).toBeDefined();
      });

      it('accepts "none of these"', () => {
        const snapshot = startDemo();
        const result = service.completeBlindSpotReview('cmd-b2', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          offeredPromptIds: ['blindspot.parking'],
          selectedPromptIds: [],
        });
        requireOk(result);
        expect(requireSnapshot(result.value).discovery?.blindSpotReview.status).toBe('complete');
      });

      it('refuses a prompt the pack never declares', () => {
        const snapshot = startDemo();
        const result = service.completeBlindSpotReview('cmd-b3', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          actor: 'human',
          offeredPromptIds: ['blindspot.invented'],
          selectedPromptIds: [],
        });

        expect(result.status).toBe('validation');
      });
    });

    describe('requestInteraction and submitInteractionResponse', () => {
      const interaction = {
        id: 'interaction-1',
        topicIds: ['car.budget'],
        kind: 'free_text' as const,
        prompt: 'What is your budget?',
        options: [],
        escapeHatches: {
          allowCustom: true,
          allowNone: false,
          allowUnsure: true,
          allowDefer: false,
        },
        requestedBy: 'model' as const,
        createdAt: '2026-08-27T00:00:00.000Z',
      };

      it('puts an interaction on screen and reads it back', () => {
        const snapshot = startDemo();
        const result = service.requestInteraction('cmd-i1', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          interaction,
        });
        requireOk(result);

        expect(requireSnapshot(result.value).discovery?.pendingInteraction?.id).toBe(
          'interaction-1',
        );
      });

      it('refuses an interaction about a topic the pack does not declare', () => {
        const snapshot = startDemo();
        const result = service.requestInteraction('cmd-i2', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          interaction: { ...interaction, topicIds: ['car.invented'] },
        });

        expect(result.status).toBe('validation');
      });

      it('applies a human response`s mappings and clears the interaction', () => {
        const snapshot = startDemo();
        const requested = service.requestInteraction('cmd-i3', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence,
          interaction,
        });
        requireOk(requested);

        const answered = service.submitInteractionResponse('cmd-i4', {
          caseId: snapshot.id,
          expectedSequence: requireSnapshot(requested.value).eventSequence,
          response: {
            interactionId: 'interaction-1',
            respondedBy: 'human',
            selectedOptionIds: [],
            customText: 'Ceiling of 40,000',
            mappings: [
              {
                topicId: 'car.budget',
                valueSummary: 'Hard ceiling of 40,000',
                origin: 'user',
                confidence: 1,
                requiresConfirmation: false,
              },
            ],
            respondedAt: '2026-08-27T00:00:00.000Z',
          },
        });
        requireOk(answered);

        const updated = requireSnapshot(answered.value);
        expect(updated.discovery?.pendingInteraction).toBeNull();
        expect(updated.discovery?.topics.find((t) => t.topicId === 'car.budget')?.status).toBe(
          'confirmed',
        );
      });
    });
  });

  /**
   * The bystander-event rule (`CommandService.loadForIndependentMutation`).
   *
   * The defect these cover, in the shape it actually occurred: an
   * investigation streams its events as the graph progresses, so the case's
   * sequence climbs for several seconds; a person adds a note or marks a
   * candidate during that window; and the command was refused for a
   * `409 CONFLICT` caused entirely by work they were watching rather than
   * competing with. It reproduced as an intermittent failure of the §61
   * Playwright journey (`addNote`, expected 41 against an actual 42) and is
   * not closable from the browser: the SSE stream carries a separate activity
   * counter, so a client must re-read the canonical snapshot to learn the case
   * sequence at all, and the run can append again between that read and the
   * request landing.
   *
   * These tests fix the boundary in both directions -- what the rule permits,
   * and what it must still refuse -- so a later change cannot quietly widen it
   * into "the sequence check does not apply".
   */
  describe('sequence-independent commands (bystander events must not refuse a human action)', () => {
    /**
     * Appends the shape of event a streaming run actually produces while a
     * person is watching -- nothing a note or a triage judgment depends on.
     */
    function advanceCaseByBystanderEvent(snapshot: CaseState): CaseState {
      const appended = caseStore.append(
        snapshot.id,
        [
          {
            eventId: `ev-bystander-${String(snapshot.eventSequence + 1)}`,
            caseId: snapshot.id,
            sequence: snapshot.eventSequence + 1,
            timestamp: FIXED_NOW,
            type: 'recommendation.ready',
            payload: {
              recommendation: {
                id: 'rec-bystander-1',
                status: 'ready',
                favoredOptionId: null,
                rationale: 'the run finished while the person was reading',
                facts: [],
                hypotheses: [],
                confidence: 0.5,
                limitations: [],
                sourceIds: [],
                resolvedObligationIds: [],
                acceptedUncertaintyObligationIds: [],
                generatedAt: FIXED_NOW,
              },
            },
          },
        ],
        snapshot.eventSequence,
      );
      if (appended.status !== 'applied') throw new Error('test setup failed');
      return appended.snapshot;
    }

    it('addNote accepts a caller whose expectedSequence the case has already passed, and appends at the real sequence', () => {
      const snapshot = startDemo();
      const staleSequence = snapshot.eventSequence;
      const advanced = advanceCaseByBystanderEvent(snapshot);
      expect(advanced.eventSequence).toBe(staleSequence + 1);

      const result = service.addNote('cmd-independent-note', {
        caseId: snapshot.id,
        // Exactly the shape of the real failure: the client read this before
        // the run appended, and the run appended before the click landed.
        expectedSequence: staleSequence,
        note: { body: 'Ask the dealer about the roof rails.' },
      });

      requireOk(result);
      const updated = requireSnapshot(result.value);
      expect(updated.notes).toHaveLength(1);
      // Appended ON TOP of the bystander event, never in place of it: the
      // recommendation the run had just produced survives untouched, and a
      // note is still not allowed to invalidate it.
      expect(updated.eventSequence).toBe(staleSequence + 2);
      expect(updated.recommendation?.id).toBe('rec-bystander-1');
      expect(updated.recommendation?.status).toBe('ready');
      expect(result.value.acceptedSequence).toBe(staleSequence + 2);
    });

    it('setCandidateDisposition accepts a stale caller and records what it replaced from the CURRENT state, not the stale one', () => {
      const started = startDemo();
      const withOption = service.upsertOption('cmd-independent-option', {
        caseId: started.id,
        expectedSequence: started.eventSequence,
        option: { label: 'Honda CR-V', kind: 'car', attributes: [] },
      });
      requireOk(withOption);
      const snapshot = requireSnapshot(withOption.value);
      const entityId = snapshot.entities[0]?.id;
      if (entityId === undefined) throw new Error('expected candidate');

      // A first judgment lands, and the caller below never sees it.
      const first = service.setCandidateDisposition('cmd-independent-keep', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        actor: 'human',
        entityId,
        disposition: 'keep',
      });
      requireOk(first);

      const second = service.setCandidateDisposition('cmd-independent-pass', {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        actor: 'human',
        entityId,
        disposition: 'pass',
      });

      requireOk(second);
      const record = requireSnapshot(second.value).discovery?.dispositions.find(
        (entry) => entry.entityId === entityId,
      );
      expect(record?.disposition).toBe('pass');
      // The point of deriving from the current snapshot: the history stays
      // truthful. A stale read would have claimed this replaced 'unreviewed'.
      expect(record?.previousDisposition).toBe('keep');
    });

    it('still refuses an expectedSequence AHEAD of the case, for both independent commands', () => {
      const snapshot = startDemo();

      expect(
        service.addNote('cmd-independent-ahead-note', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence + 1,
          note: { body: 'x' },
        }).status,
      ).toBe('conflict');

      expect(
        service.setCandidateDisposition('cmd-independent-ahead-disposition', {
          caseId: snapshot.id,
          expectedSequence: snapshot.eventSequence + 1,
          actor: 'human',
          entityId: 'candidate-nonexistent',
          disposition: 'keep',
        }).status,
      ).toBe('conflict');
    });

    it('leaves every other command exactly as strict as it was -- this is an opt-in, not a relaxed default', () => {
      const snapshot = startDemo();
      const staleSequence = snapshot.eventSequence;
      advanceCaseByBystanderEvent(snapshot);

      // Each of these decides what to write by reading the case, so a stale
      // view is a real hazard and the refusal is the correct answer.
      expect(
        service.upsertOption('cmd-strict-option', {
          caseId: snapshot.id,
          expectedSequence: staleSequence,
          option: { label: 'Mazda CX-5', kind: 'car', attributes: [] },
        }).status,
      ).toBe('conflict');

      expect(
        service.updateCriteria('cmd-strict-criteria', {
          caseId: snapshot.id,
          expectedSequence: staleSequence,
          operations: [{ op: 'reweight', criterionId: 'price', weight: 5 }],
        }).status,
      ).toBe('conflict');
    });
  });
});
