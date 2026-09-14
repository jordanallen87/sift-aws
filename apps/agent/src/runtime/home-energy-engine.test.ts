/**
 * Proves the real gap this task closes: a live, SQLite-backed `RunService`
 * whose `requestInvestigation` genuinely triggers the real six-node
 * `home-energy-guardian` Strands Swarm in the background -- mirroring
 * `car-purchase-engine.test.ts`'s own proof for the other hero pack. Every
 * store here is the real SQLite implementation
 * (`SqliteCaseStore`/`SqliteActivityStore`/`SqliteRunStore`), every command
 * goes through the real `CommandService`/`RunService`, and round detection
 * is read purely from the case's own persisted criteria weights --
 * `determineHomeEnergyRound` is never told which round to run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type {
  CaseEvent,
  CaseState,
  CommandReceipt,
  ExecutionResult,
  RunReceipt,
} from '@sift/contracts';
import type { Clock, IdGenerator } from '@sift/core';
import { compileHomeEnergyGuardianPack, PackRegistry } from '@sift/packs';
import { buildHomeEnergyResponseOptionEntities } from '@sift/scenarios';
import { createTestDatabase, openDatabase, type TestDatabase } from '../db/connection.js';
import { applyMigrations } from '../db/migrate.js';
import { CommandService } from '../services/command-service.js';
import { RunService, SqliteRunStore, type RunRecord } from '../services/run-service.js';
import { SqliteActivityStore } from '../store/activity-store.js';
import type { CaseStore } from '../store/case-store.js';
import { SqliteCaseStore } from '../store/sqlite-case-store.js';
import { SqliteRuntimeEventStore } from '../store/runtime-event-store.js';
import { HOME_ENERGY_SWARM_NODE_IDS, type HomeEnergySwarmResult } from './home-energy-swarm.js';
import {
  createHomeEnergyEngine,
  determineHomeEnergyRound,
  extractFavoredResponseOptionId,
  foldHomeEnergyRound1,
  foldHomeEnergyRound2,
  homeEnergyCapabilityCatalog,
  stripInlineSourceCitations,
  type HomeEnergyEngine,
  type HomeEnergyEngineDeps,
} from './home-energy-engine.js';
import {
  DECISION_TEXT_ROUND1,
  DECISION_TEXT_ROUND2,
} from './scripted-beats/home-energy-guardian.js';

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

/** Polls the real `SqliteRunStore` until `runId` settles into a terminal status -- no fixed sleep, mirroring `car-purchase-engine.test.ts`'s identical helper. */
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
  engine: HomeEnergyEngine;
  idGenerator: IdGenerator;
  registry: PackRegistry;
  pack: ReturnType<typeof compileHomeEnergyGuardianPack>;
} {
  const database = createTestDatabase();
  test = database;
  applyMigrations(database.sqlite);

  const registry = new PackRegistry();
  const pack = compileHomeEnergyGuardianPack(homeEnergyCapabilityCatalog(), FIXED_CLOCK);
  registry.register(pack);

  const caseStore = new SqliteCaseStore(database);
  const activityStore = new SqliteActivityStore(database);
  const runStore = new SqliteRunStore(database);
  const runtimeEventStore = new SqliteRuntimeEventStore(database);
  const idGenerator = fixedIdGenerator();

  const engine = createHomeEnergyEngine({
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
    demoSeedEntities: { 'home-energy-guardian': buildHomeEnergyResponseOptionEntities },
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

/**
 * Drives a fresh live stack through round1, the household's real reweight,
 * and round2 -- exactly the setup `'runs round1 then round2...'` above
 * proves, factored out so the human-approval/refusal tests below (which
 * this task added) do not each re-derive it -- until the case genuinely
 * carries a `pending` `request-hvac-inspection` proposal, the same real way
 * a person reaches `ApprovalCard` in the product. Never used by that
 * pre-existing test itself (kept exactly as it was written, so its own
 * step-by-step narration and inline assertions are undisturbed).
 */
async function driveToPendingInspectionProposal(): Promise<{
  stack: ReturnType<typeof buildLiveStack>;
  caseId: string;
}> {
  const stack = buildLiveStack();
  const { caseStore, runStore, commandService, runService } = stack;

  const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
  requireOkCommand(startResult);
  let snapshot = startResult.value.snapshot!;
  const caseId = snapshot.id;

  const run1Result = runService.requestInvestigation('cmd-run-1', {
    caseId,
    expectedSequence: snapshot.eventSequence,
  });
  requireOkRun(run1Result);
  await waitForRunSettled(runStore, run1Result.value.runId);

  snapshot = caseStore.load(caseId)!;
  const criteriaResult = commandService.updateCriteria('cmd-criteria', {
    caseId,
    expectedSequence: snapshot.eventSequence,
    operations: [
      { op: 'reweight', criterionId: 'energy.cost', weight: 20 },
      { op: 'reweight', criterionId: 'energy.conservation', weight: 80 },
    ],
  });
  requireOkCommand(criteriaResult);
  snapshot = criteriaResult.value.snapshot!;

  const run2Result = runService.requestInvestigation('cmd-run-2', {
    caseId,
    obligationId: 'energy.response_options',
    expectedSequence: snapshot.eventSequence,
  });
  requireOkRun(run2Result);
  await waitForRunSettled(runStore, run2Result.value.runId);

  snapshot = caseStore.load(caseId)!;
  if (snapshot.proposal?.status !== 'pending') {
    throw new Error(
      `test setup: expected a pending proposal after round2, got ${JSON.stringify(snapshot.proposal)}`,
    );
  }
  return { stack, caseId };
}

describe('determineHomeEnergyRound', () => {
  function stateWithCriteria(
    criteria: { id: string; weight: number }[],
  ): Parameters<typeof determineHomeEnergyRound>[0] {
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
    } as Parameters<typeof determineHomeEnergyRound>[0];
  }

  it('is round1 when energy.cost/energy.conservation criteria are absent', () => {
    expect(determineHomeEnergyRound(stateWithCriteria([]))).toBe('round1');
  });

  it('is round1 at the pack default cost-heavy 80/20 weighting', () => {
    const state = stateWithCriteria([
      { id: 'energy.cost', weight: 80 },
      { id: 'energy.conservation', weight: 20 },
    ]);
    expect(determineHomeEnergyRound(state)).toBe('round1');
  });

  it('is round1 while cost still outweighs conservation', () => {
    const state = stateWithCriteria([
      { id: 'energy.cost', weight: 80 },
      { id: 'energy.conservation', weight: 20 },
    ]);
    expect(determineHomeEnergyRound(state)).toBe('round1');
  });

  it('is round2 once conservation outweighs cost', () => {
    const state = stateWithCriteria([
      { id: 'energy.cost', weight: 20 },
      { id: 'energy.conservation', weight: 80 },
    ]);
    expect(determineHomeEnergyRound(state)).toBe('round2');
  });
});

describe('home-energy-engine (live, real Swarm, real SQLite)', () => {
  it('runs round1 then round2 purely from real case state, with no external round flag', async () => {
    const { caseStore, activityStore, runStore, runtimeEventStore, commandService, runService } =
      buildLiveStack();

    // --- Seed the case exactly as POST /api/cases/demo would ---
    const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
    requireOkCommand(startResult);
    let snapshot = startResult.value.snapshot!;
    const caseId = snapshot.id;
    expect(determineHomeEnergyRound(snapshot)).toBe('round1');
    // The demo-seeding gap this task closed: the four response-option
    // entities exist before any investigation runs, so the eventual
    // recommendation's favoredOptionId resolves to a real, renderable
    // EntityRecord.
    expect(snapshot.entities.map((entity) => entity.id).sort()).toEqual(
      [
        'change-rate-plan',
        'monitor-one-cycle',
        'request-energy-audit',
        'request-hvac-inspection',
      ].sort(),
    );

    // --- POST .../run: the real, only trigger for round1 (auto-selects energy.anomaly, the only open, dependsOn-free obligation) ---
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

    // --- The denial is visible to a person, and is not dressed up as a
    // broken tool. `anomaly-investigator` reaches for
    // `household-event-lookup`, which the compiled pack grants only to
    // `home-systems-analyst`; ScopeAuthorization refuses it before it runs.
    // Before this was projected, the only thing a reader saw was the denied
    // call's own error status, rendered "Couldn't complete that lookup" --
    // which describes a broken lookup rather than an enforced boundary, and
    // is the opposite of the reassurance the moment should carry.
    const denials = activityAfterRound1.filter((event) => event.type === 'intervention.denied');
    expect(denials).toHaveLength(1);
    expect(denials[0]?.summary).toContain('household-event-lookup');

    const householdLookupActivity = activityAfterRound1.filter((event) =>
      event.summary.includes('household-event-lookup'),
    );
    // The attempt itself is kept. `tool.started` is published before the
    // guard runs, and suppressing it would need lookahead a streaming
    // projection does not have -- but it is also the honest sequence, and it
    // reads correctly: "Looking something up" immediately followed by
    // "Action blocked". What must never appear is the *third* line, the
    // denied call's error status republished as a tool failure.
    expect(householdLookupActivity.map((event) => event.type)).toEqual([
      'tool.started',
      'intervention.denied',
    ]);
    expect(
      activityAfterRound1.some(
        (event) => event.type === 'tool.failed' && event.summary.includes('household-event-lookup'),
      ),
    ).toBe(false);
    expect(activityAfterRound1.some((event) => event.type === 'evidence.accepted')).toBe(true);

    const anomalyObligation = snapshot.obligations.find((o) => o.id === 'energy.anomaly');
    expect(anomalyObligation?.attemptsUsed).toBeGreaterThan(0);
    expect(snapshot.evidenceLinks.length).toBeGreaterThan(0);
    expect(snapshot.recommendation).not.toBeNull();
    expect(snapshot.recommendation?.favoredOptionId).toBe('monitor-one-cycle');
    expect(snapshot.proposal).toBeNull();

    // --- The real Runtime Inspector persistence path: every normalized
    // RuntimeEvent the real Swarm run produced is durably queryable back out
    // of runtime_events, correlated by the exact same runId/caseId/traceId
    // as the run itself. ---
    const runtimeEventsRound1 = runtimeEventStore.listByRun(run1Id);
    expect(runtimeEventsRound1.length).toBeGreaterThan(0);
    expect(runtimeEventsRound1.every((event) => event.runId === run1Id)).toBe(true);
    expect(runtimeEventsRound1.every((event) => event.caseId === caseId)).toBe(true);
    expect(new Set(runtimeEventsRound1.map((event) => event.traceId)).size).toBe(1);
    expect(runtimeEventsRound1.map((event) => event.sequence)).toEqual(
      [...runtimeEventsRound1.map((event) => event.sequence)].sort((a, b) => a - b),
    );
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
    expect(runtimeEventsRound1.some((event) => event.category === 'tool')).toBe(true);
    expect(runtimeEventsRound1.some((event) => event.category === 'skill')).toBe(true);
    // The required "repeated weather work -> Guide -> handoff" steering moment.
    expect(
      runtimeEventsRound1.some(
        (event) =>
          event.category === 'intervention' &&
          event.name === 'intervention.guide' &&
          event.agentId === 'weather-analyst',
      ),
    ).toBe(true);
    expect(run1Record.traceId).toBeTruthy();
    // --- The Runtime Inspector Overview's "Trace" must actually identify
    // this run's events. The run row's trace_id and the trace_id every
    // runtime_events row for that run carries are ONE id -- previously the
    // engine minted a local trace for the run row while the Swarm minted
    // its own for every event, so the value on screen matched nothing in
    // the Timeline. Asserted at the persisted-data level (both ids read
    // back out of real SQLite), because that is exactly where the two
    // diverged. ---
    expect(runtimeEventsRound1.every((event) => event.traceId === run1Record.traceId)).toBe(true);

    // --- I2: a consumer-visible activity event derived from a real Swarm
    // RuntimeEvent carries a real debugEventId that resolves to its exact
    // correlated runtime_events row -- never a placeholder or absent field. ---
    const round1ToolActivity = activityAfterRound1.find(
      (event) => event.runId === run1Id && event.type === 'tool.started',
    );
    expect(round1ToolActivity?.debugEventId).toBeTruthy();
    const round1CorrelatedDebugEvent = runtimeEventsRound1.find(
      (event) => event.id === round1ToolActivity?.debugEventId,
    );
    expect(round1CorrelatedDebugEvent).toBeDefined();
    expect(round1CorrelatedDebugEvent?.category).toBe('tool');
    expect(round1CorrelatedDebugEvent?.phase).toBe('start');

    // --- I3: a real, whole-run before/after case-state diff, never a
    // reconstructed guess -- computed from the actual CaseState loaded before
    // the run and the actual CaseState returned after folding completed. ---
    const round1StateChange = runtimeEventsRound1.find((event) => event.category === 'case');
    expect(round1StateChange).toBeDefined();
    expect(round1StateChange?.name).toBe('case.state_changed');
    expect(round1StateChange?.stateDiff?.length).toBeGreaterThan(0);
    expect(round1StateChange?.stateDiff?.some((op) => op.path === '/recommendation')).toBe(true);

    // --- The household reweights toward long-term waste reduction (real command, no engine involvement) ---
    const criteriaResult = commandService.updateCriteria('cmd-criteria', {
      caseId,
      expectedSequence: snapshot.eventSequence,
      operations: [
        { op: 'reweight', criterionId: 'energy.cost', weight: 20 },
        { op: 'reweight', criterionId: 'energy.conservation', weight: 80 },
      ],
    });
    requireOkCommand(criteriaResult);
    snapshot = criteriaResult.value.snapshot!;

    // Now reweighted: the engine should independently determine round2 from this real state.
    expect(determineHomeEnergyRound(snapshot)).toBe('round2');

    // --- POST .../run again, explicitly against energy.response_options
    // (already "satisfied" from round1, so it is not auto-selectable) --
    // mirrors the "Energy moment" WebMCP demo's sift_update_criteria +
    // sift_request_investigation pairing. ---
    const run2Result = runService.requestInvestigation('cmd-run-2', {
      caseId,
      obligationId: 'energy.response_options',
      expectedSequence: snapshot.eventSequence,
    });
    requireOkRun(run2Result);
    const run2Id = run2Result.value.runId;

    const run2Record = await waitForRunSettled(runStore, run2Id);
    expect(run2Record.status).toBe('completed');
    expect(run2Record.result).toMatchObject({ round: 'round2' });

    snapshot = caseStore.load(caseId)!;
    expect(snapshot).toBeDefined();

    // --- The revised recommendation + pending proposal, produced independently from real state ---
    expect(snapshot.recommendation?.favoredOptionId).toBe('request-hvac-inspection');
    expect(snapshot.proposal).not.toBeNull();
    expect(snapshot.proposal?.status).toBe('pending');

    // --- Round 2 produces its own, separately-sequenced runtime_events,
    // correlated to run2Id and never mixed with round 1's, including the
    // required ConsequenceGuard Confirm before the proposal existed. ---
    const runtimeEventsRound2 = runtimeEventStore.listByRun(run2Id);
    expect(runtimeEventsRound2.length).toBeGreaterThan(0);
    expect(runtimeEventsRound2.every((event) => event.runId === run2Id)).toBe(true);
    expect(runtimeEventsRound2.every((event) => event.caseId === caseId)).toBe(true);
    expect(
      runtimeEventsRound1.every(
        (event) => !runtimeEventsRound2.some((otherEvent) => otherEvent.id === event.id),
      ),
    ).toBe(true);
    expect(
      runtimeEventsRound2.some(
        (event) =>
          event.category === 'intervention' &&
          event.name === 'intervention.confirm' &&
          event.agentId === 'decision-synthesizer',
      ),
    ).toBe(true);
    // The same one-id invariant holds for round 2's own run row, and the
    // two runs' traces are genuinely distinct (one trace per real Swarm
    // invocation, so the Overview's "Trace" narrows to one run's events).
    expect(run2Record.traceId).toBeTruthy();
    expect(runtimeEventsRound2.every((event) => event.traceId === run2Record.traceId)).toBe(true);
    expect(run2Record.traceId).not.toBe(run1Record.traceId);

    // --- Round 2 gets its own real, separately-sequenced case-state diff and
    // debugEventId correlations, distinct from round 1's. ---
    const round2StateChange = runtimeEventsRound2.find((event) => event.category === 'case');
    expect(round2StateChange).toBeDefined();
    expect(round2StateChange?.stateDiff?.length).toBeGreaterThan(0);
    expect(round2StateChange?.id).not.toBe(round1StateChange?.id);

    const round2ToolActivity = activityStore
      .replayFrom(caseId, 0)
      .find((event) => event.runId === run2Id && event.type === 'tool.started');
    expect(round2ToolActivity?.debugEventId).toBeTruthy();
    expect(runtimeEventsRound2.some((event) => event.id === round2ToolActivity?.debugEventId)).toBe(
      true,
    );

    // A human, never the engine, approves the proposal -- proven by the
    // engine's own output: it only ever appended
    // intervention.confirmation_required, never proposal.reviewed.
    expect(
      activityStore
        .replayFrom(caseId, 0)
        .some((event) => event.type === 'intervention.confirmation_required'),
    ).toBe(true);
  }, 30_000);

  it('withholds an uncited first draft on the live path, and lands the corrected one', async () => {
    // The product refusing a plausible-sounding answer that cannot cite a
    // source is its clearest single argument, and for the whole life of the
    // feature it happened only inside a unit test. `draft.withheld` had a
    // label, a tone, a `RecommendationCard` state, a
    // `SpecialistActivityPanel` branch and `workspace-status` handling --
    // all tested, all unreachable, because the `goal` category never
    // reached the consumer stream and round 1's scripted draft passed on
    // its first attempt anyway.
    //
    // This asserts the whole path: a real GoalLoop rejection, surfaced as a
    // real consumer event, followed by a recommendation that still arrives.
    const { caseStore, activityStore, runStore, commandService, runService } = buildLiveStack();

    const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
    requireOkCommand(startResult);
    const snapshot = startResult.value.snapshot!;
    const caseId = snapshot.id;

    const runResult = runService.requestInvestigation('cmd-run-1', {
      caseId,
      expectedSequence: snapshot.eventSequence,
    });
    requireOkRun(runResult);
    const record = await waitForRunSettled(runStore, runResult.value.runId);
    expect(record.status).toBe('completed');

    const activity = activityStore.replayFrom(caseId, 0);
    const withheld = activity.filter((event) => event.type === 'draft.withheld');
    expect(withheld).toHaveLength(1);
    expect(withheld[0]?.phase).toBe('failed');
    // Correlated back to the specialist whose draft was rejected, so the
    // event is inspectable rather than a bare banner.
    expect(withheld[0]?.agentId).toBe('decision-synthesizer');
    expect(withheld[0]?.debugEventId).toBeTruthy();

    // The rejection is not the end state: the retry cites its sources and
    // the case ends up with a real recommendation.
    const finalSnapshot = caseStore.load(caseId);
    expect(finalSnapshot).not.toBeNull();
    expect(finalSnapshot?.recommendation?.status).toBe('ready');
    // Retargeted, not weakened: this used to assert the citation by matching
    // a raw `source-...` id inside `rationale` itself, back when that field
    // carried decision-synthesizer's text verbatim. `rationale` is now
    // display-cleaned (`stripInlineSourceCitations`, `home-energy-engine.ts`)
    // -- see that function's doc comment (`car-purchase-scenario.ts`) for why
    // -- so "the retry cites its sources" is now proven the same way
    // `car-purchase-engine.test.ts`'s own §34/DoD item 34 assertion proves
    // it: the structured `sourceIds` the citation chips actually render from,
    // plus a positive check that no raw id leaked into the display text.
    expect(finalSnapshot?.recommendation?.sourceIds.length).toBeGreaterThan(0);
    expect(finalSnapshot?.recommendation?.rationale).not.toMatch(/\bsource-[a-z0-9-]+\b/i);

    // Ordering matters for anyone watching: the withheld draft precedes the
    // recommendation it was replaced by.
    const withheldIndex = activity.findIndex((event) => event.type === 'draft.withheld');
    const readyIndex = activity.findIndex((event) => event.type === 'recommendation.ready');
    expect(withheldIndex).toBeGreaterThanOrEqual(0);
    expect(readyIndex).toBeGreaterThan(withheldIndex);
  }, 30_000);

  it("publishes each specialist's real duration onto the consumer activity stream, not only the Runtime Inspector", async () => {
    // The gap this closes: `home-energy-swarm.ts` measures a real per-node
    // duration and stamps it on the `runtime_events` row, but a consumer
    // surface reads `activity_events`. Without `safeDetails` forwarding,
    // the duration lands in the developer Inspector and the consumer pane's
    // elapsed column stays permanently blank.
    const { activityStore, runStore, runtimeEventStore, commandService, runService } =
      buildLiveStack();

    const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
    requireOkCommand(startResult);
    const snapshot = startResult.value.snapshot!;
    const caseId = snapshot.id;

    const runResult = runService.requestInvestigation('cmd-run-1', {
      caseId,
      expectedSequence: snapshot.eventSequence,
    });
    requireOkRun(runResult);
    const runId = runResult.value.runId;
    const record = await waitForRunSettled(runStore, runId);
    expect(record.status).toBe('completed');

    const activity = activityStore.replayFrom(caseId, 0);
    const completions = activity.filter(
      (event) => event.runId === runId && event.type === 'specialist.completed',
    );
    // Every real Swarm node reaches the consumer stream, each carrying its
    // own duration.
    expect([...new Set(completions.map((event) => event.agentId))].sort()).toEqual(
      [...HOME_ENERGY_SWARM_NODE_IDS].sort(),
    );

    const runtimeEvents = runtimeEventStore.listByRun(runId);
    for (const event of completions) {
      const durationMs = event.safeDetails?.['durationMs'];
      expect(durationMs, `expected a duration for "${String(event.agentId)}"`).toBeTypeOf('number');
      expect(durationMs as number).toBeGreaterThanOrEqual(0);

      // It is that specialist's OWN measured interval, carried through
      // unchanged from the exact correlated runtime event -- not a run
      // total, a neighbour's figure, or a number invented at this layer.
      const correlated = runtimeEvents.find((entry) => entry.id === event.debugEventId);
      expect(correlated?.name).toBe('swarm.node_completed');
      expect(correlated?.attributes['nodeId']).toBe(event.agentId);
      expect(durationMs).toBe(correlated?.durationMs);
    }

    // A specialist that has only started has no elapsed time to freeze yet,
    // so it publishes none -- absent, never a fabricated zero.
    const starts = activity.filter(
      (event) => event.runId === runId && event.type === 'specialist.started',
    );
    expect(starts.length).toBeGreaterThan(0);
    for (const event of starts) {
      expect(event.safeDetails?.['durationMs']).toBeUndefined();
    }
  }, 30_000);

  it('logs a real, inspectable trace when the case does not exist at all', async () => {
    const { engine } = buildLiveStack();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await engine.trigger({
        caseId: 'case-does-not-exist',
        runId: 'run-missing-case',
        obligationId: 'energy.anomaly',
      });

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('was not found'));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('marks a run failed with a real error activity event when the pinned pack is not registered for this engine', async () => {
    const { database, caseStore, activityStore, runStore, commandService, idGenerator } =
      buildLiveStack();

    const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
    requireOkCommand(startResult);
    const caseId = startResult.value.snapshot!.id;

    const brokenEngine = createHomeEnergyEngine({
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
      obligationId: 'energy.anomaly',
      status: 'queued',
      createdAt: FIXED_CLOCK.now(),
      updatedAt: FIXED_CLOCK.now(),
    });

    await brokenEngine.trigger({
      caseId,
      runId: 'run-broken-registry',
      obligationId: 'energy.anomaly',
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

  // --- Human approval and refusal of the round-2 inspection proposal, live
  // (real SQLite, real Swarm) -- the paths a defect-hunting pass over this
  // exact command found undertested: the pre-existing live test above
  // stopped the instant `snapshot.proposal?.status === 'pending'`, so
  // `reviewProposal` itself (approve, deny, idempotent retry, restart
  // durability) had never actually run against a live-Swarm-produced
  // `home-energy-guardian` proposal, only against hand-seeded fixture
  // proposals (`command-service.test.ts`) or the pure `@sift/core` function
  // (`policy.test.ts`). ---

  it('approves the live round-2 inspection proposal: case decided, attributed to origin human, reason kept, activity and case sequences stay distinct counters', async () => {
    const { stack, caseId } = await driveToPendingInspectionProposal();
    const { caseStore, activityStore, commandService } = stack;

    const beforeApproval = caseStore.load(caseId)!;
    const proposalId = beforeApproval.proposal!.id;

    const approveResult = commandService.reviewProposal('cmd-approve', {
      caseId,
      proposalId,
      actor: 'human',
      decision: 'approve',
      reason: 'The household wants the technician out before the next billing cycle.',
      expectedSequence: beforeApproval.eventSequence,
    });
    requireOkCommand(approveResult);
    const decided = approveResult.value.snapshot!;

    // CLAUDE.md's central rule, proven against a real Swarm-produced
    // proposal rather than a hand-seeded one: only a human actor may ever
    // move a case to 'decided', and the reviewer, not the model that
    // proposed the action, is who gets recorded.
    expect(decided.status).toBe('decided');
    expect(decided.proposal?.status).toBe('approved');
    expect(decided.proposal?.reviewedByActor).toBe('human');
    expect(decided.proposal?.id).toBe(proposalId);
    // The reviewer's own stated reason -- real defect fixed by this task
    // (`@sift/core`'s `reviewProposal` used to discard it entirely; see
    // `packages/core/src/policy.test.ts`).
    expect(decided.proposal?.reviewReason).toBe(
      'The household wants the technician out before the next billing cycle.',
    );

    // Re-submitting the identical commandId is a pure idempotent replay --
    // no second `proposal.reviewed` event, no change to acceptedSequence.
    const replay = commandService.reviewProposal('cmd-approve', {
      caseId,
      proposalId,
      actor: 'human',
      decision: 'approve',
      reason: 'The household wants the technician out before the next billing cycle.',
      expectedSequence: beforeApproval.eventSequence,
    });
    requireOkCommand(replay);
    expect(replay.value.acceptedSequence).toBe(approveResult.value.acceptedSequence);
    expect(caseStore.load(caseId)?.eventSequence).toBe(decided.eventSequence);

    // `PublicActivityEvent.sequence` and `CaseState.eventSequence` are
    // different monotonic counters (store/activity-store.ts's own header
    // comment) -- proven concretely, not just by type, against this real
    // run: the activity stream's own sequence numbers are contiguous from 1
    // for THIS case's activity events alone, while the case's event
    // sequence reflects every underlying CaseEvent two full Swarm rounds
    // plus the reweight plus this review produced, which is a materially
    // different (larger) number.
    const activity = activityStore.replayFrom(caseId, 0);
    expect(activity.map((event) => event.sequence)).toEqual(
      activity.map((_event, index) => index + 1),
    );
    expect(activity.at(-1)?.sequence).not.toBe(decided.eventSequence);
    expect(activity.some((event) => event.summary === 'Proposal approved.')).toBe(true);
  }, 30_000);

  it('denies the live round-2 inspection proposal: case stays draft with no dangling obligation, recommendation still stands, reason kept', async () => {
    const { stack, caseId } = await driveToPendingInspectionProposal();
    const { caseStore, activityStore, commandService } = stack;

    const beforeDenial = caseStore.load(caseId)!;
    const proposalId = beforeDenial.proposal!.id;
    // The obligation the round-2 recommendation itself rests on -- proven
    // satisfied before the denial, so the "no dangling obligation" assertion
    // below is a real before/after comparison, not an assumption.
    const obligationBefore = beforeDenial.obligations.find(
      (entry) => entry.id === 'energy.response_options',
    );
    expect(obligationBefore?.status).toBe('satisfied');

    const denyResult = commandService.reviewProposal('cmd-deny', {
      caseId,
      proposalId,
      actor: 'human',
      decision: 'reject',
      reason: 'Already have our own HVAC technician scheduled this week.',
      expectedSequence: beforeDenial.eventSequence,
    });
    requireOkCommand(denyResult);
    const denied = denyResult.value.snapshot!;

    // A denial is not a silent no-op and not a case the product can never
    // complete: the proposal itself is terminal (rejected)...
    expect(denied.proposal?.status).toBe('rejected');
    expect(denied.proposal?.reviewedByActor).toBe('human');
    expect(denied.proposal?.reviewReason).toBe(
      'Already have our own HVAC technician scheduled this week.',
    );
    // ...but 'decided' is reserved for approval alone (docs/specs/product.md
    // "CaseStatus is a two-value type"), so the case correctly stays
    // 'draft' rather than being stuck in some fourth, undocumented status.
    expect(denied.status).toBe('draft');
    // The recommendation the household can still act on was never touched
    // by the denial -- only the separate, optional consequential proposal
    // was.
    expect(denied.recommendation?.status).toBe('ready');
    expect(denied.recommendation?.favoredOptionId).toBe('request-hvac-inspection');
    // No dangling obligation: the obligation the recommendation rests on is
    // exactly as satisfied after the denial as it was before it -- denying
    // the optional follow-up proposal cannot re-open completed
    // investigation work.
    const obligationAfter = denied.obligations.find(
      (entry) => entry.id === 'energy.response_options',
    );
    expect(obligationAfter?.status).toBe('satisfied');
    expect(obligationAfter?.attemptsUsed).toBe(obligationBefore?.attemptsUsed);

    // The UI-facing activity stream says why the case landed here.
    const activity = activityStore.replayFrom(caseId, 0);
    expect(activity.some((event) => event.summary === 'Proposal rejected.')).toBe(true);

    // Idempotent duplicate submit -- a second identical POST (e.g. a
    // doubled network retry) never double-applies the denial.
    const replay = commandService.reviewProposal('cmd-deny', {
      caseId,
      proposalId,
      actor: 'human',
      decision: 'reject',
      reason: 'Already have our own HVAC technician scheduled this week.',
      expectedSequence: beforeDenial.eventSequence,
    });
    requireOkCommand(replay);
    expect(replay.value.acceptedSequence).toBe(denyResult.value.acceptedSequence);
    expect(caseStore.load(caseId)?.eventSequence).toBe(denied.eventSequence);
  }, 30_000);

  it('restart durability: an approved live inspection proposal survives closing and reopening the real SQLite connection', async () => {
    const { stack, caseId } = await driveToPendingInspectionProposal();
    const { database, caseStore, commandService } = stack;

    const beforeApproval = caseStore.load(caseId)!;
    const proposalId = beforeApproval.proposal!.id;
    const approveResult = commandService.reviewProposal('cmd-approve-restart', {
      caseId,
      proposalId,
      actor: 'human',
      decision: 'approve',
      reason: 'Confirmed with the household by phone.',
      expectedSequence: beforeApproval.eventSequence,
    });
    requireOkCommand(approveResult);
    const beforeRestart = approveResult.value.snapshot!;
    expect(beforeRestart.status).toBe('decided');

    // A genuine restart, not a second wrapper over the same open handle
    // (`sqlite-case-store.test.ts`'s existing "second store instance" test
    // already covers that lighter case): close the real connection this
    // stack wrote through, then open a brand-new one against the same
    // on-disk file, mirroring `session-adapter.test.ts`'s own "a genuine
    // round trip through the real filesystem" restore test for Strands
    // session snapshots.
    database.close();
    const reopened = openDatabase(database.dir);
    try {
      const reopenedCaseStore = new SqliteCaseStore(reopened);
      const restored = reopenedCaseStore.load(caseId);

      expect(restored?.status).toBe('decided');
      expect(restored?.proposal?.status).toBe('approved');
      expect(restored?.proposal?.id).toBe(proposalId);
      expect(restored?.proposal?.reviewedByActor).toBe('human');
      expect(restored?.proposal?.reviewReason).toBe('Confirmed with the household by phone.');
      expect(restored?.eventSequence).toBe(beforeRestart.eventSequence);
      expect(restored?.recommendation?.favoredOptionId).toBe('request-hvac-inspection');

      const reopenedActivityStore = new SqliteActivityStore(reopened);
      const restoredActivity = reopenedActivityStore.replayFrom(caseId, 0);
      expect(restoredActivity.some((event) => event.summary === 'Proposal approved.')).toBe(true);
    } finally {
      reopened.close();
    }
  }, 30_000);
});

describe('extractFavoredResponseOptionId', () => {
  it('extracts the option id from a "Recommend...(option-id)" clause when it names a known option', () => {
    expect(
      extractFavoredResponseOptionId('Recommend monitoring (monitor-one-cycle) for now.'),
    ).toBe('monitor-one-cycle');
  });

  it('falls back to a substring scan when the "Recommend...(...)" clause names something other than a known option id', () => {
    expect(
      extractFavoredResponseOptionId(
        'Recommend a wait-and-see approach (not-a-real-option) -- specifically change-rate-plan.',
      ),
    ).toBe('change-rate-plan');
  });

  it('falls back to a substring scan when there is no "Recommend...(...)" clause at all', () => {
    expect(
      extractFavoredResponseOptionId(
        'The best option here is request-hvac-inspection given the facts.',
      ),
    ).toBe('request-hvac-inspection');
  });

  it('returns null when the text names no known response option anywhere', () => {
    expect(extractFavoredResponseOptionId('No option is clearly favored yet.')).toBeNull();
  });
});

/**
 * `stripInlineSourceCitations` (imported here from `home-energy-engine.js`,
 * re-exported from the same shared `car-purchase-scenario.ts` helper
 * `bid-comparison-engine.test.ts` pins its own citation shapes against) is
 * the display-only half of the same §34/DoD item 34 split that pack's suite
 * documents: `decision-synthesizer`'s raw text cites a `source-...` id for
 * every claim (required by `DEFAULT_SYNTHESIZER_VALIDATOR` and consumed by
 * `extractCitedSourceIds` to build `Recommendation.sourceIds`), but that raw
 * text used to be rendered to a person verbatim in both `rationale`
 * (`RecommendationCard.tsx`) and `claims[0].statement`
 * (`EvidenceCard.tsx`/`FindingsSheet.tsx`) -- so every citation showed up
 * twice: once as an unreadable machine id in running prose, once as a proper
 * citation chip. Unlike bid-comparison's prose, this pack's real shipped
 * text (`DECISION_TEXT_ROUND1`/`DECISION_TEXT_ROUND2`,
 * `scripted-beats/home-energy-guardian.ts`) never wraps a citation in
 * parentheses -- it cites bare, mid-sentence ("...before taking further
 * action, per source-current-bill-household-demo-energy-01 and
 * source-household-event-event-thermostat-failure-2026-07.") -- so this
 * suite pins that third citation shape specifically, on top of the two
 * bid-comparison's own suite already covers.
 */
describe('stripInlineSourceCitations (home-energy-guardian prose)', () => {
  it('removes a bare, comma-introduced "per source-x and source-y" citation clause, leaving the sentence\'s own period intact', () => {
    expect(
      stripInlineSourceCitations(
        'Recommend monitoring for one more billing cycle (monitor-one-cycle) before taking further action, per source-current-bill-household-demo-energy-01 and source-household-event-event-thermostat-failure-2026-07. No inspection is proposed at this weighting.',
      ),
    ).toBe(
      'Recommend monitoring for one more billing cycle (monitor-one-cycle) before taking further action. No inspection is proposed at this weighting.',
    );
  });

  it('removes a bare, comma-introduced "per source-x" clause naming just one source', () => {
    expect(
      stripInlineSourceCitations(
        'Recommend requesting an HVAC/thermostat inspection (request-hvac-inspection) to address the confirmed thermostat sensor-drift root cause, per source-household-event-event-thermostat-failure-2026-07. Under the reweighted conservation-focused criteria this scores highest (0.87) versus monitor-one-cycle (0.20).',
      ),
    ).toBe(
      'Recommend requesting an HVAC/thermostat inspection (request-hvac-inspection) to address the confirmed thermostat sensor-drift root cause. Under the reweighted conservation-focused criteria this scores highest (0.87) versus monitor-one-cycle (0.20).',
    );
  });

  it('leaves text with no citation or em-dash pattern untouched', () => {
    const plain = 'Recommend monitoring for one more billing cycle (monitor-one-cycle).';
    expect(stripInlineSourceCitations(plain)).toBe(plain);
  });

  it('strips every source id out of the real shipped round1/round2 rationale, while keeping the option ids, weights, and scores a person needs', () => {
    for (const raw of [DECISION_TEXT_ROUND1, DECISION_TEXT_ROUND2]) {
      const cleaned = stripInlineSourceCitations(raw);
      expect(cleaned).not.toMatch(/\bsource-[a-z0-9-]+\b/i);
      expect(cleaned).not.toMatch(/ -- /);
      expect(cleaned).not.toMatch(/ {2}/);
    }
    const round1Cleaned = stripInlineSourceCitations(DECISION_TEXT_ROUND1);
    expect(round1Cleaned).toContain('monitor-one-cycle');
    expect(round1Cleaned).toContain('0.80');
    expect(round1Cleaned).toContain('0.47');
    expect(round1Cleaned).toContain('80');
    expect(round1Cleaned).toContain('20');
    const round2Cleaned = stripInlineSourceCitations(DECISION_TEXT_ROUND2);
    expect(round2Cleaned).toContain('request-hvac-inspection');
    expect(round2Cleaned).toContain('monitor-one-cycle');
    expect(round2Cleaned).toContain('0.87');
    expect(round2Cleaned).toContain('0.20');
  });
});

describe('foldHomeEnergyRound1 / foldHomeEnergyRound2 (direct unit tests via a hand-built HomeEnergySwarmResult)', () => {
  function executionResult(
    obligationId: string,
    overrides: Partial<ExecutionResult> = {},
  ): ExecutionResult {
    return {
      obligationId,
      disposition: 'evidence_found',
      claims: [
        {
          statement: 'Some finding.',
          stance: 'supports',
          confidence: 0.8,
          sourceIds: ['source-current-bill-household-demo-energy-01'],
        },
      ],
      evidenceResults: [
        {
          sourceId: 'source-current-bill-household-demo-energy-01',
          level: 'E1',
          verdict: 'pass',
          summary: 'Bill.',
        },
      ],
      limitations: [],
      suggestedStatus: 'satisfied',
      ...overrides,
    };
  }

  function fakeSwarmResult(overrides: Partial<HomeEnergySwarmResult> = {}): HomeEnergySwarmResult {
    return {
      multiAgentResult: {} as HomeEnergySwarmResult['multiAgentResult'],
      nodeStartOrder: [],
      nodeFinishOrder: [],
      handoffs: [],
      contexts: {
        'anomaly-investigator': executionResult('energy.anomaly'),
        'rate-analyst': executionResult('energy.rate_change'),
        'weather-analyst': executionResult('energy.weather'),
        'home-systems-analyst': executionResult('energy.household_change'),
        'source-challenger': executionResult('energy.response_options'),
      },
      decisionSynthesizerText: 'Recommend monitoring for now (monitor-one-cycle).',
      proposedInspection: undefined,
      goalLoopResult: undefined,
      repetitiveHandoffDetected: false,
      ...overrides,
    };
  }

  function seededCase(): {
    deps: HomeEnergyEngineDeps;
    caseId: string;
    snapshot: CaseState;
  } {
    const { caseStore, activityStore, runStore, runtimeEventStore, registry, idGenerator } =
      buildLiveStack();
    const deps: HomeEnergyEngineDeps = {
      caseStore,
      activityStore,
      runStore,
      runtimeEventStore,
      registry,
      clock: FIXED_CLOCK,
      idGenerator,
      skillsRootDir: SKILLS_ROOT_DIR,
    };
    const commandService = new CommandService({
      caseStore,
      activityStore,
      registry,
      clock: FIXED_CLOCK,
      idGenerator,
      demoSeedEntities: { 'home-energy-guardian': buildHomeEnergyResponseOptionEntities },
    });
    const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
    requireOkCommand(startResult);
    const snapshot = requireOkSnapshot(startResult.value);
    return { deps, caseId: snapshot.id, snapshot };
  }

  function requireOkSnapshot(receipt: CommandReceipt): CaseState {
    if (receipt.snapshot === undefined) throw new Error('receipt has no snapshot');
    return receipt.snapshot;
  }

  it('foldHomeEnergyRound1 throws when the Swarm produced no context for a sequential specialist (weather-analyst)', () => {
    const { deps, caseId } = seededCase();
    const swarmResult = fakeSwarmResult({
      contexts: {
        'anomaly-investigator': executionResult('energy.anomaly'),
        'rate-analyst': executionResult('energy.rate_change'),
        'home-systems-analyst': executionResult('energy.household_change'),
        'source-challenger': executionResult('energy.response_options'),
      },
    });
    expect(() => foldHomeEnergyRound1(deps, caseId, swarmResult)).toThrow(
      /round1 produced no context for "weather-analyst"/,
    );
  });

  it('foldHomeEnergyRound1 throws when the Swarm produced no context for source-challenger', () => {
    const { deps, caseId } = seededCase();
    const swarmResult = fakeSwarmResult({
      contexts: {
        'anomaly-investigator': executionResult('energy.anomaly'),
        'rate-analyst': executionResult('energy.rate_change'),
        'weather-analyst': executionResult('energy.weather'),
        'home-systems-analyst': executionResult('energy.household_change'),
      },
    });
    expect(() => foldHomeEnergyRound1(deps, caseId, swarmResult)).toThrow(
      /round1 produced no context for "source-challenger"/,
    );
  });

  it("foldHomeEnergyRound1 throws when decision-synthesizer's text names no known response option", () => {
    const { deps, caseId } = seededCase();
    const swarmResult = fakeSwarmResult({ decisionSynthesizerText: 'No clear option yet.' });
    expect(() => foldHomeEnergyRound1(deps, caseId, swarmResult)).toThrow(
      /round1 decision-synthesizer text named no known response option/,
    );
  });

  it('foldHomeEnergyRound1 de-duplicates limitations collected across multiple node contexts, and skips a context entry that is genuinely absent (e.g. decision-synthesizer, which this Swarm never populates in contexts)', () => {
    const { deps, caseId } = seededCase();
    const shared = 'A shared open question both nodes reported.';
    // Built as a loosely-typed record then cast: `exactOptionalPropertyTypes`
    // forbids an object *literal* from assigning `undefined` to an optional
    // property directly, but the real runtime shape collectLimitations'
    // `context?.limitations ?? []` guard defends against (a key present in
    // `contexts` with a genuinely `undefined` value) is exactly this.
    const contextsWithGenuinelyAbsentEntry: Record<string, ExecutionResult | undefined> = {
      'anomaly-investigator': executionResult('energy.anomaly', { limitations: [shared] }),
      'rate-analyst': executionResult('energy.rate_change', { limitations: [shared] }),
      'weather-analyst': executionResult('energy.weather'),
      'home-systems-analyst': executionResult('energy.household_change'),
      'source-challenger': executionResult('energy.response_options'),
      // decision-synthesizer is a valid HomeEnergySwarmNodeId but this
      // Swarm's own NodeResultEvent hook never populates a `contexts` entry
      // for it (see home-energy-swarm.ts).
      'decision-synthesizer': undefined,
    };
    const swarmResult = fakeSwarmResult({
      contexts: contextsWithGenuinelyAbsentEntry,
    });
    const snapshot = foldHomeEnergyRound1(deps, caseId, swarmResult);
    // Retargeted, not weakened. `limitations` is no longer only what
    // `collectLimitations` produced: the persisted array now merges those
    // with the ones derived from the deterministic scoreboard. Since
    // `mergeLimitations` keeps the context-collected entries first and
    // ahead of the derived ones, the assertions below still prove exactly
    // what this test was written for -- that two contexts reporting the
    // same limitation yield ONE entry, and that the genuinely absent
    // `decision-synthesizer` context contributes nothing rather than
    // throwing or emitting an empty slot.
    const limitations = snapshot.recommendation?.limitations ?? [];
    expect(limitations[0]).toBe(shared);
    expect(limitations.filter((entry) => entry === shared)).toHaveLength(1);
  });

  it('foldHomeEnergyRound2 throws when the reweighted text names no known response option and no inspection was proposed', () => {
    const { deps, caseId } = seededCase();
    const swarmResult = fakeSwarmResult({ decisionSynthesizerText: 'Still no clear winner.' });
    expect(() => foldHomeEnergyRound2(deps, caseId, swarmResult)).toThrow(
      /round2 decision-synthesizer text named no known response option/,
    );
  });

  it('foldHomeEnergyRound2 prefers the real proposedInspection.optionId over text-parsing when both are present', () => {
    const { deps, caseId } = seededCase();
    const swarmResult = fakeSwarmResult({
      decisionSynthesizerText:
        'Recommend monitoring (monitor-one-cycle) -- wait, actually inspect.',
      proposedInspection: { optionId: 'request-hvac-inspection', rationale: 'root cause fix' },
    });
    const snapshot = foldHomeEnergyRound2(deps, caseId, swarmResult);
    expect(snapshot.recommendation?.favoredOptionId).toBe('request-hvac-inspection');
    expect(snapshot.proposal).not.toBeNull();
  });

  it('foldHomeEnergyRound2 leaves no pending proposal when decision-synthesizer never called propose_inspection', () => {
    const { deps, caseId } = seededCase();
    const swarmResult = fakeSwarmResult();
    const snapshot = foldHomeEnergyRound2(deps, caseId, swarmResult);
    expect(snapshot.recommendation?.favoredOptionId).toBe('monitor-one-cycle');
    expect(snapshot.proposal).toBeNull();
  });

  /** Same real-`CaseStore`-substitute technique as `car-purchase-engine.test.ts`'s own `caseStoreConflictingOn`. */
  function caseStoreConflictingOn(
    real: CaseStore,
    matches: (events: readonly CaseEvent[]) => boolean,
  ): CaseStore {
    return {
      load: (caseId) => real.load(caseId),
      peekIdempotent: (commandId) => real.peekIdempotent(commandId),
      append: (caseId, events, expectedSequence, options) => {
        if (matches(events)) {
          const snapshot = real.load(caseId);
          if (snapshot === undefined) throw new Error('test: case unexpectedly missing');
          return {
            status: 'conflict',
            expectedSequence,
            actualSequence: snapshot.eventSequence,
            snapshot,
          };
        }
        return real.append(caseId, events, expectedSequence, options);
      },
      updateSelection: (caseId, patch, expectedSequence, updatedAt, idempotency) =>
        real.updateSelection(caseId, patch, expectedSequence, updatedAt, idempotency),
      subscribe: (caseId, fromSequence) => real.subscribe(caseId, fromSequence),
      resetDemo: (caseId) => real.resetDemo(caseId),
    };
  }

  it('foldHomeEnergyRound1 throws a real, inspectable error when recording the round1 recommendation hits a genuine append conflict', () => {
    const { deps, caseId } = seededCase();
    const conflictingCaseStore = caseStoreConflictingOn(deps.caseStore, (events) =>
      events.some((event) => event.type === 'recommendation.ready'),
    );
    const swarmResult = fakeSwarmResult();
    expect(() =>
      foldHomeEnergyRound1({ ...deps, caseStore: conflictingCaseStore }, caseId, swarmResult),
    ).toThrow(/failed to record the round1 recommendation.*status "conflict"/);
  });

  it('foldHomeEnergyRound2 throws a real, inspectable error when recording the round2 recommendation hits a genuine append conflict', () => {
    const { deps, caseId } = seededCase();
    const conflictingCaseStore = caseStoreConflictingOn(deps.caseStore, (events) =>
      events.some((event) => event.type === 'recommendation.ready'),
    );
    const swarmResult = fakeSwarmResult();
    expect(() =>
      foldHomeEnergyRound2({ ...deps, caseStore: conflictingCaseStore }, caseId, swarmResult),
    ).toThrow(/failed to record the round2 recommendation.*status "conflict"/);
  });

  it('foldHomeEnergyRound2 throws a real, inspectable error when creating the decision proposal hits a genuine append conflict', () => {
    const { deps, caseId } = seededCase();
    const conflictingCaseStore = caseStoreConflictingOn(deps.caseStore, (events) =>
      events.some((event) => event.type === 'proposal.proposed'),
    );
    const swarmResult = fakeSwarmResult({
      decisionSynthesizerText: 'Recommend inspecting the HVAC system.',
      proposedInspection: { optionId: 'request-hvac-inspection', rationale: 'root cause fix' },
    });
    expect(() =>
      foldHomeEnergyRound2({ ...deps, caseStore: conflictingCaseStore }, caseId, swarmResult),
    ).toThrow(/failed to create the decision proposal.*status "conflict"/);
  });
});

describe('createHomeEnergyEngine: in-flight-run tracking', () => {
  it('a second trigger for the same case queues behind the first rather than racing it, and both settle', async () => {
    const { engine, runStore, commandService } = buildLiveStack();
    const startResult = commandService.startDemo('cmd-start', { demoId: 'home-energy-guardian' });
    requireOkCommand(startResult);
    const caseId = startResult.value.snapshot!.id;

    runStore.create({
      id: 'run-a',
      caseId,
      obligationId: 'energy.anomaly',
      status: 'queued',
      createdAt: FIXED_CLOCK.now(),
      updatedAt: FIXED_CLOCK.now(),
    });
    runStore.create({
      id: 'run-b',
      caseId,
      obligationId: 'energy.anomaly',
      status: 'queued',
      createdAt: FIXED_CLOCK.now(),
      updatedAt: FIXED_CLOCK.now(),
    });

    const first = engine.trigger({ caseId, runId: 'run-a', obligationId: 'energy.anomaly' });
    const second = engine.trigger({ caseId, runId: 'run-b', obligationId: 'energy.anomaly' });

    await Promise.all([first, second]);

    expect(runStore.load('run-a')?.status).toBe('completed');
    expect(runStore.load('run-b')?.status).toBe('completed');
  }, 30_000);
});
