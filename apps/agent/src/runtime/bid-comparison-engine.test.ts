/**
 * Proves the real gap this task closes: a live, SQLite-backed `RunService`
 * whose `requestInvestigation` genuinely triggers the real six-node
 * `bid-comparison` Strands Swarm in the background -- mirroring
 * `home-energy-engine.test.ts`'s own proof for this codebase's other
 * Swarm-hero pack. Every store here is the real SQLite implementation
 * (`SqliteCaseStore`/`SqliteActivityStore`/`SqliteRunStore`), every command
 * goes through the real `CommandService`/`RunService`, and round detection
 * is read purely from the case's own persisted criteria weights --
 * `determineBidComparisonRound` is never told which round to run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { CommandReceipt, RunReceipt } from '@sift/contracts';
import type { Clock, IdGenerator } from '@sift/core';
import { compileBidComparisonPack, PackRegistry } from '@sift/packs';
import { buildBidComparisonEntities } from '@sift/scenarios';
import { createTestDatabase, type TestDatabase } from '../db/connection.js';
import { applyMigrations } from '../db/migrate.js';
import { CommandService } from '../services/command-service.js';
import { RunService, SqliteRunStore, type RunRecord } from '../services/run-service.js';
import { SqliteActivityStore } from '../store/activity-store.js';
import { SqliteCaseStore } from '../store/sqlite-case-store.js';
import { SqliteRuntimeEventStore } from '../store/runtime-event-store.js';
import { BID_COMPARISON_SWARM_NODE_IDS } from './bid-comparison-swarm.js';
import {
  bidComparisonCapabilityCatalog,
  createBidComparisonEngine,
  determineBidComparisonRound,
  extractFavoredBidId,
  type BidComparisonEngine,
} from './bid-comparison-engine.js';
import { ROUND2_CRITERIA_WEIGHTS } from './scripted-beats/bid-comparison.js';

const SKILLS_ROOT_DIR = fileURLToPath(new URL('../../skills', import.meta.url));
const FIXED_CLOCK: Clock = { now: () => '2026-08-27T00:00:00.000Z' };

function fixedIdGenerator(): IdGenerator {
  let counter = 0;
  return { next: (prefix) => `${prefix ?? 'id'}-${++counter}` };
}

function requireOkCommand(result: {
  status: string;
}): asserts result is { status: 'ok'; value: CommandReceipt } {
  if (result.status !== 'ok') {
    throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result)}`);
  }
}

function requireOkRun(result: {
  status: string;
}): asserts result is { status: 'ok'; value: RunReceipt } {
  if (result.status !== 'ok') {
    throw new Error(`expected ok, got ${result.status}: ${JSON.stringify(result)}`);
  }
}

/** Polls the real `SqliteRunStore` until `runId` settles into a terminal status -- no fixed sleep, mirroring `home-energy-engine.test.ts`'s identical helper. */
async function waitForRunSettled(
  runStore: SqliteRunStore,
  runId: string,
  timeoutMs = 25_000,
): Promise<RunRecord> {
  const start = Date.now();
  for (;;) {
    const record = runStore.load(runId);
    if (record !== undefined && (record.status === 'completed' || record.status === 'failed')) {
      return record;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitForRunSettled: run "${runId}" did not settle within ${timeoutMs}ms (status: ${record?.status ?? 'unknown'})`,
      );
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 15));
  }
}

let test: TestDatabase | undefined;

afterEach(() => {
  test?.cleanup();
  test = undefined;
});

function buildLiveStack(): {
  database: TestDatabase;
  caseStore: SqliteCaseStore;
  activityStore: SqliteActivityStore;
  runStore: SqliteRunStore;
  runtimeEventStore: SqliteRuntimeEventStore;
  commandService: CommandService;
  runService: RunService;
  engine: BidComparisonEngine;
  idGenerator: IdGenerator;
  registry: PackRegistry;
  pack: ReturnType<typeof compileBidComparisonPack>;
} {
  const database = createTestDatabase();
  test = database;
  applyMigrations(database.sqlite);

  const registry = new PackRegistry();
  const pack = compileBidComparisonPack(bidComparisonCapabilityCatalog(), FIXED_CLOCK);
  registry.register(pack);

  const caseStore = new SqliteCaseStore(database);
  const activityStore = new SqliteActivityStore(database);
  const runStore = new SqliteRunStore(database);
  const runtimeEventStore = new SqliteRuntimeEventStore(database);
  const idGenerator = fixedIdGenerator();

  const engine = createBidComparisonEngine({
    caseStore,
    activityStore,
    runStore,
    runtimeEventStore,
    registry,
    clock: FIXED_CLOCK,
    idGenerator,
    skillsRootDir: SKILLS_ROOT_DIR,
  });

  const commandService = new CommandService({
    caseStore,
    activityStore,
    registry,
    clock: FIXED_CLOCK,
    idGenerator,
    demoSeedEntities: { 'bid-comparison': buildBidComparisonEntities },
  });
  const runService = new RunService({
    caseStore,
    activityStore,
    runStore,
    clock: FIXED_CLOCK,
    idGenerator,
    engines: { [pack.identity.id]: engine },
  });

  return {
    database,
    caseStore,
    activityStore,
    runStore,
    runtimeEventStore,
    commandService,
    runService,
    engine,
    idGenerator,
    registry,
    pack,
  };
}

describe('determineBidComparisonRound', () => {
  function stateWithCriteria(
    criteria: { id: string; weight: number }[],
  ): Parameters<typeof determineBidComparisonRound>[0] {
    return {
      criteria: criteria.map((entry) => ({
        id: entry.id,
        label: entry.id,
        kind: 'preference',
        weight: entry.weight,
        direction: 'lower_better',
        origin: 'pack',
        status: 'active',
      })),
    } as Parameters<typeof determineBidComparisonRound>[0];
  }

  it('is round1 when the bid.adjusted_total/bid.warranty/bid.payment_risk criteria are absent', () => {
    expect(determineBidComparisonRound(stateWithCriteria([]))).toBe('round1');
  });

  it('is round1 at the pack default cost-heavy weighting', () => {
    const state = stateWithCriteria([
      { id: 'bid.adjusted_total', weight: 45 },
      { id: 'bid.warranty', weight: 10 },
      { id: 'bid.payment_risk', weight: 15 },
    ]);
    expect(determineBidComparisonRound(state)).toBe('round1');
  });

  it('is round2 once warranty + payment risk together outweigh adjusted total', () => {
    const state = stateWithCriteria([
      { id: 'bid.adjusted_total', weight: ROUND2_CRITERIA_WEIGHTS.adjustedTotal },
      { id: 'bid.warranty', weight: ROUND2_CRITERIA_WEIGHTS.warranty },
      { id: 'bid.payment_risk', weight: ROUND2_CRITERIA_WEIGHTS.paymentRisk },
    ]);
    expect(determineBidComparisonRound(state)).toBe('round2');
  });

  it('is round1 when only bid.warranty is raised but not enough combined with payment risk to cross adjusted total', () => {
    const state = stateWithCriteria([
      { id: 'bid.adjusted_total', weight: 40 },
      { id: 'bid.warranty', weight: 20 },
      { id: 'bid.payment_risk', weight: 15 },
    ]);
    expect(determineBidComparisonRound(state)).toBe('round1');
  });
});

describe('bid-comparison-engine (live, real Swarm, real SQLite)', () => {
  it('runs round1 then round2 purely from real case state, with no external round flag', async () => {
    const { caseStore, activityStore, runStore, runtimeEventStore, commandService, runService } =
      buildLiveStack();

    // --- Seed the case exactly as POST /api/cases/demo would ---
    const startResult = commandService.startDemo('cmd-start', { demoId: 'bid-comparison' });
    requireOkCommand(startResult);
    let snapshot = startResult.value.snapshot!;
    const caseId = snapshot.id;
    expect(determineBidComparisonRound(snapshot)).toBe('round1');
    // The demo-seeding gap this task closed: all twelve bid entities exist
    // before any investigation runs, so the eventual recommendation's
    // favoredOptionId resolves to a real, renderable EntityRecord.
    expect(snapshot.entities.map((entity) => entity.id).sort()).toEqual(
      [
        'bid-cedar',
        'bid-northgate',
        'bid-tworivers',
        'bid-summit',
        'bid-ironclad',
        'bid-parkside',
        'bid-westbrook',
        'bid-anchor',
        'bid-crestview',
        'bid-fieldstone',
        'bid-brightwater',
        'bid-oldmill',
      ].sort(),
    );

    // --- POST .../run: the real, only trigger for round1 (auto-selects bid.scope_normalization, the only open, dependsOn-free obligation) ---
    const run1Result = runService.requestInvestigation('cmd-run-1', {
      caseId,
      expectedSequence: snapshot.eventSequence,
    });
    requireOkRun(run1Result);
    const run1Id = run1Result.value.runId;

    const run1Record = await waitForRunSettled(runStore, run1Id);
    expect(run1Record.status).toBe('completed');
    expect(run1Record.result).toMatchObject({ round: 'round1' });

    snapshot = caseStore.load(caseId)!;
    expect(snapshot).toBeDefined();

    // --- Real round-1 progress genuinely happened ---
    const activityAfterRound1 = activityStore.replayFrom(caseId, 0);
    expect(activityAfterRound1.some((event) => event.type === 'run.started')).toBe(true);
    expect(activityAfterRound1.some((event) => event.type === 'run.completed')).toBe(true);
    expect(activityAfterRound1.some((event) => event.type === 'skill.activated')).toBe(true);
    expect(activityAfterRound1.some((event) => event.type === 'specialist.started')).toBe(true);
    expect(activityAfterRound1.some((event) => event.type === 'specialist.completed')).toBe(true);

    // --- The required Deny moment is visible to a person as a boundary
    // held, not dressed up as a broken tool: price-analyst reaches for
    // license-lookup (granted only to credential-checker); ScopeAuthorization
    // refuses it before it runs. ---
    const denials = activityAfterRound1.filter((event) => event.type === 'intervention.denied');
    expect(denials).toHaveLength(1);
    expect(denials[0]?.summary).toContain('license-lookup');

    const licenseLookupActivity = activityAfterRound1.filter((event) =>
      event.summary.includes('license-lookup'),
    );
    // The attempt itself is kept (tool.started fires before the guard runs),
    // but the denied call's own error-status AfterToolCall must never be
    // republished as a tool failure.
    expect(licenseLookupActivity.map((event) => event.type)).toEqual([
      'tool.started',
      'intervention.denied',
    ]);
    expect(
      activityAfterRound1.some(
        (event) => event.type === 'tool.failed' && event.summary.includes('license-lookup'),
      ),
    ).toBe(false);

    // --- The required Guide moment: scope-analyst repeats the same
    // scope-differ bid pair with no new angle before RetrySteering redirects
    // it to the full three-bid comparison. ---
    expect(
      activityAfterRound1.some(
        (event) => event.type === 'intervention.guided' && event.agentId === 'scope-analyst',
      ),
    ).toBe(true);

    // --- The required GoalLoop rejection: decision-synthesizer's first
    // draft ranks bids on raw quoted totals and is withheld; the corrected
    // retry (scope-normalized) is what reaches the case. ---
    expect(
      activityAfterRound1.some(
        (event) => event.type === 'draft.withheld' && event.agentId === 'decision-synthesizer',
      ),
    ).toBe(true);

    expect(activityAfterRound1.some((event) => event.type === 'evidence.accepted')).toBe(true);

    expect(snapshot.evidenceLinks.length).toBeGreaterThan(0);
    expect(snapshot.recommendation).not.toBeNull();
    // Northgate Plumbing: lowest scope-normalized adjusted total among bids
    // with fully valid credentials.
    expect(snapshot.recommendation?.favoredOptionId).toBe('bid-northgate');

    // --- The required Confirm moment: decision-synthesizer's propose_award
    // call is gated by ConsequenceGuard on human confirmation, and reaches
    // the case as a PENDING proposal -- Sift proposes, a human decides. This
    // pack's Confirm beat is reachable in round1 itself (unlike
    // home-energy-guardian's round-2-only inspection proposal). ---
    expect(snapshot.proposal).not.toBeNull();
    expect(snapshot.proposal?.status).toBe('pending');
    // Never auto-approved by the engine: no actor other than a human command
    // could ever have moved this proposal past "pending".
    expect(snapshot.proposal?.reviewedByActor).toBeUndefined();
    expect(snapshot.status).not.toBe('decided');

    // --- The real Runtime Inspector persistence path ---
    const runtimeEventsRound1 = runtimeEventStore.listByRun(run1Id);
    expect(runtimeEventsRound1.length).toBeGreaterThan(0);
    expect(runtimeEventsRound1.every((event) => event.runId === run1Id)).toBe(true);
    expect(runtimeEventsRound1.every((event) => event.caseId === caseId)).toBe(true);
    expect(new Set(runtimeEventsRound1.map((event) => event.traceId)).size).toBe(1);
    expect(
      runtimeEventsRound1.some(
        (event) => event.category === 'swarm' && event.name === 'swarm.node_completed',
      ),
    ).toBe(true);
    expect(
      runtimeEventsRound1.some(
        (event) => event.category === 'swarm' && event.name === 'swarm.handoff',
      ),
    ).toBe(true);
    expect(
      runtimeEventsRound1.some(
        (event) => event.category === 'intervention' && event.name === 'intervention.confirm',
      ),
    ).toBe(true);
    expect(run1Record.traceId).toBeTruthy();
    expect(runtimeEventsRound1.every((event) => event.traceId === run1Record.traceId)).toBe(true);

    const round1StateChange = runtimeEventsRound1.find((event) => event.category === 'case');
    expect(round1StateChange).toBeDefined();
    expect(round1StateChange?.name).toBe('case.state_changed');
    expect(round1StateChange?.stateDiff?.length).toBeGreaterThan(0);

    // --- The household or contractor reweights toward warranty length and
    // payment risk (real command, no engine involvement) ---
    const criteriaResult = commandService.updateCriteria('cmd-criteria', {
      caseId,
      expectedSequence: snapshot.eventSequence,
      operations: [
        {
          op: 'reweight',
          criterionId: 'bid.adjusted_total',
          weight: ROUND2_CRITERIA_WEIGHTS.adjustedTotal,
        },
        {
          op: 'reweight',
          criterionId: 'bid.scope_completeness',
          weight: ROUND2_CRITERIA_WEIGHTS.scopeCompleteness,
        },
        {
          op: 'reweight',
          criterionId: 'bid.payment_risk',
          weight: ROUND2_CRITERIA_WEIGHTS.paymentRisk,
        },
        {
          op: 'reweight',
          criterionId: 'bid.schedule_fit',
          weight: ROUND2_CRITERIA_WEIGHTS.scheduleFit,
        },
        { op: 'reweight', criterionId: 'bid.warranty', weight: ROUND2_CRITERIA_WEIGHTS.warranty },
      ],
    });
    requireOkCommand(criteriaResult);
    snapshot = criteriaResult.value.snapshot!;

    // Now reweighted: the engine should independently determine round2 from this real state.
    expect(determineBidComparisonRound(snapshot)).toBe('round2');

    // --- POST .../run again, explicitly against bid.award_recommendation
    // (already "satisfied" from round1, so it is not auto-selectable). ---
    const run2Result = runService.requestInvestigation('cmd-run-2', {
      caseId,
      obligationId: 'bid.award_recommendation',
      expectedSequence: snapshot.eventSequence,
    });
    requireOkRun(run2Result);
    const run2Id = run2Result.value.runId;

    const run2Record = await waitForRunSettled(runStore, run2Id);
    expect(run2Record.status).toBe('completed');
    expect(run2Record.result).toMatchObject({ round: 'round2' });

    snapshot = caseStore.load(caseId)!;
    expect(snapshot).toBeDefined();

    // --- Round 2 is not a flip: bid-tworivers scores highest on the
    // reweighted criteria but its credentials never verify as valid, so the
    // award stays with the higher-scoring compliant bid, Northgate Plumbing. ---
    expect(snapshot.recommendation?.favoredOptionId).toBe('bid-northgate');
    expect(snapshot.proposal).not.toBeNull();
    expect(snapshot.proposal?.status).toBe('pending');
    expect(snapshot.proposal?.reviewedByActor).toBeUndefined();

    const runtimeEventsRound2 = runtimeEventStore.listByRun(run2Id);
    expect(runtimeEventsRound2.length).toBeGreaterThan(0);
    expect(runtimeEventsRound2.every((event) => event.runId === run2Id)).toBe(true);
    expect(
      runtimeEventsRound1.every(
        (event) => !runtimeEventsRound2.some((otherEvent) => otherEvent.id === event.id),
      ),
    ).toBe(true);
    expect(run2Record.traceId).toBeTruthy();
    expect(run2Record.traceId).not.toBe(run1Record.traceId);

    // A human, never the engine, may approve the proposal -- proven by the
    // engine's own output across both rounds: it only ever appended
    // intervention.confirmation_required, never proposal.reviewed.
    const wholeActivity = activityStore.replayFrom(caseId, 0);
    expect(wholeActivity.some((event) => event.type === 'intervention.confirmation_required')).toBe(
      true,
    );
    expect(wholeActivity.some((event) => event.summary === 'Proposal approved.')).toBe(false);

    // Finally: a human approves it, and the actor of record is 'human', never 'agent'.
    const beforeApproval = caseStore.load(caseId)!;
    const approveResult = commandService.reviewProposal('cmd-approve', {
      caseId,
      proposalId: beforeApproval.proposal!.id,
      actor: 'human',
      decision: 'approve',
      reason: 'Confirmed by the contractor selecting the bid.',
      expectedSequence: beforeApproval.eventSequence,
    });
    requireOkCommand(approveResult);
    const decided = approveResult.value.snapshot!;
    expect(decided.status).toBe('decided');
    expect(decided.proposal?.status).toBe('approved');
    expect(decided.proposal?.reviewedByActor).toBe('human');
    expect(decided.proposal?.reviewedByActor).not.toBe('agent');
  }, 30_000);

  it('logs a real, inspectable trace when the case does not exist at all', async () => {
    const { engine } = buildLiveStack();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await engine.trigger({
        caseId: 'case-does-not-exist',
        runId: 'run-missing-case',
        obligationId: 'bid.scope_normalization',
      });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('was not found'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('marks a run failed with a real error activity event when the pinned pack is not registered for this engine', async () => {
    const { database, caseStore, activityStore, runStore, commandService, idGenerator } =
      buildLiveStack();

    const startResult = commandService.startDemo('cmd-start', { demoId: 'bid-comparison' });
    requireOkCommand(startResult);
    const caseId = startResult.value.snapshot!.id;

    const brokenEngine = createBidComparisonEngine({
      caseStore,
      activityStore,
      runStore,
      runtimeEventStore: new SqliteRuntimeEventStore(database),
      registry: new PackRegistry(),
      clock: FIXED_CLOCK,
      idGenerator,
      skillsRootDir: SKILLS_ROOT_DIR,
    });

    runStore.create({
      id: 'run-broken-registry',
      caseId,
      obligationId: 'bid.scope_normalization',
      status: 'queued',
      createdAt: FIXED_CLOCK.now(),
      updatedAt: FIXED_CLOCK.now(),
    });

    await brokenEngine.trigger({
      caseId,
      runId: 'run-broken-registry',
      obligationId: 'bid.scope_normalization',
    });

    const record = runStore.load('run-broken-registry');
    expect(record?.status).toBe('failed');
    expect(JSON.stringify(record?.result)).toContain('is not registered');

    const failedActivity = activityStore
      .replayFrom(caseId, 0)
      .find((event) => event.type === 'run.failed');
    expect(failedActivity).toBeDefined();
    expect(failedActivity?.summary).toContain('is not registered');
  });
});

describe('extractFavoredBidId', () => {
  const bidIdByName = new Map([
    ['Northgate Plumbing', 'bid-northgate'],
    ['Cedar & Sons', 'bid-cedar'],
    ['Two Rivers Mechanical', 'bid-tworivers'],
  ]);

  it('extracts the bid id from a "Recommend awarding to <contractor>." clause', () => {
    expect(extractFavoredBidId('... Recommend awarding to Northgate Plumbing.', bidIdByName)).toBe(
      'bid-northgate',
    );
  });

  it('falls back to a substring scan when there is no "Recommend awarding to..." clause', () => {
    expect(
      extractFavoredBidId('The best choice here is Cedar & Sons given the facts.', bidIdByName),
    ).toBe('bid-cedar');
  });

  it('returns null when the text names no known contractor anywhere', () => {
    expect(extractFavoredBidId('No bid is clearly favored yet.', bidIdByName)).toBeNull();
  });
});

describe('createBidComparisonEngine: in-flight-run tracking', () => {
  it('a second trigger for the same case queues behind the first rather than racing it, and both settle', async () => {
    const { engine, runStore, commandService } = buildLiveStack();
    const startResult = commandService.startDemo('cmd-start', { demoId: 'bid-comparison' });
    requireOkCommand(startResult);
    const caseId = startResult.value.snapshot!.id;

    runStore.create({
      id: 'run-a',
      caseId,
      obligationId: 'bid.scope_normalization',
      status: 'queued',
      createdAt: FIXED_CLOCK.now(),
      updatedAt: FIXED_CLOCK.now(),
    });
    runStore.create({
      id: 'run-b',
      caseId,
      obligationId: 'bid.scope_normalization',
      status: 'queued',
      createdAt: FIXED_CLOCK.now(),
      updatedAt: FIXED_CLOCK.now(),
    });

    const first = engine.trigger({
      caseId,
      runId: 'run-a',
      obligationId: 'bid.scope_normalization',
    });
    const second = engine.trigger({
      caseId,
      runId: 'run-b',
      obligationId: 'bid.scope_normalization',
    });

    await Promise.all([first, second]);

    expect(runStore.load('run-a')?.status).toBe('completed');
    expect(runStore.load('run-b')?.status).toBe('completed');
  }, 30_000);
});

// Sanity: this test file's own node-id assumption stays honest against the
// real Swarm's own declared node list.
describe('BID_COMPARISON_SWARM_NODE_IDS', () => {
  it('names exactly the six specialists this engine folds', () => {
    expect([...BID_COMPARISON_SWARM_NODE_IDS].sort()).toEqual(
      [
        'scope-analyst',
        'price-analyst',
        'credential-checker',
        'schedule-analyst',
        'source-challenger',
        'decision-synthesizer',
      ].sort(),
    );
  });
});
