/**
 * Runs the real "Bid Comparison" demo trajectory end to end
 * (docs/specs/testing.md "Scenario tests": "execute the actual core, pack,
 * Strands adapter, scripted model, interventions, fixture tools, event
 * store, and API in process") and proves every required assertion in
 * `bid-comparison.scenario.ts` genuinely passes against the real causal
 * trajectory -- not a scripted final-result shortcut
 * (docs/engineering-principles.md).
 *
 * --- Why this file drives the real, live, wired production engine instead
 * of a parallel scenario-specific Swarm runner ---
 *
 * `car-purchase-scenario.ts`/`home-energy-guardian-scenario.ts` each drive
 * their pack's Graph/Swarm directly, bypassing `car-purchase-engine.ts`/
 * `home-energy-engine.ts` entirely, because each needs to selectively patch
 * one node's scripted model to genuinely trigger a GoalLoop rejection that
 * the shipped round-1 trajectory does not otherwise reach on its own.
 * `bid-comparison` needs no such patch: its own shipped round-1 scripted
 * trajectory (`scripted-beats/bid-comparison.ts`) already drives Deny,
 * Guide, a genuine GoalLoop reject-then-recover cycle, and Confirm, all
 * within one round -- already proven end to end, against the real, live
 * `createBidComparisonEngine`, by `bid-comparison-engine.test.ts`'s own
 * "runs round1 then round2 purely from real case state" integration test.
 *
 * So this scenario test drives that exact same real, live production path
 * (`CommandService.startDemo` -> `RunService.requestInvestigation` ->
 * `createBidComparisonEngine(...).trigger(...)`, the identical wiring
 * `server.ts` registers under the `bid-comparison` pack id), using in-memory
 * store implementations for test speed (mirroring
 * `car-purchase-scenario.ts`/`home-energy-guardian-scenario.ts`'s own
 * `MemoryCaseStore`/`InMemoryActivityStore`/`MemoryRunStore` choice), plus
 * the real `InMemoryRuntimeEventStore` the live engine already writes every
 * normalized `RuntimeDebugEvent` into. The `ScenarioTrajectory` this file
 * checks assertions against is built by reading back those already-real,
 * already-persisted events (`buildTrajectoryFromRuntimeEvents` below) --
 * applying the exact same category/name/attributes mapping
 * `home-energy-guardian-scenario.ts`'s own `drainSwarm` applies to the live
 * generator stream, just over an already-completed array instead of an
 * in-flight one. Nothing here re-implements Strands orchestration, a Swarm,
 * or an intervention handler: every event asserted on was genuinely emitted
 * by the real `Swarm`/`InterventionHandler`/`GoalLoop` this task's
 * read-only files (`bid-comparison-swarm.ts`, `interventions.ts`,
 * `event-normalizer.ts`) already implement and already prove elsewhere.
 *
 * Writes the final snapshot, event log, trajectory, and assertion report to
 * `artifacts/verification/scenarios/bid-comparison/`, mirroring
 * `car-purchase-scenario.test.ts`/`home-energy-guardian-scenario.test.ts`
 * exactly.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { applyCaseEvent, scoreCaseState } from '../../packages/core/src/index.js';
import { deriveScoredRecommendationFields } from '../../apps/agent/src/runtime/recommendation-scoring.js';
import type { CaseEvent, CaseState } from '../../packages/contracts/src/index.js';
import { DemoScenarioSchema } from '../../packages/contracts/src/index.js';
import { checkAssertions } from '../../packages/scenarios/src/assertions.js';
import { writeScenarioArtifacts } from '../../packages/scenarios/src/artifact-writer.js';
import {
  emptyScenarioTrajectory,
  type ScenarioTrajectory,
} from '../../packages/scenarios/src/trajectory.js';
import { buildBidComparisonEntities } from '../../packages/scenarios/src/seeds.js';
import { compileBidComparisonPack } from '../../packages/packs/src/bid-comparison.js';
import { PackRegistry } from '../../packages/packs/src/registry.js';
import { CommandService } from '../../apps/agent/src/services/command-service.js';
import {
  RunService,
  MemoryRunStore,
  type RunRecord,
} from '../../apps/agent/src/services/run-service.js';
import { InMemoryActivityStore } from '../../apps/agent/src/store/activity-store.js';
import { MemoryCaseStore } from '../../apps/agent/src/store/memory-case-store.js';
import {
  InMemoryRuntimeEventStore,
  type PersistedRuntimeEvent,
} from '../../apps/agent/src/store/runtime-event-store.js';
import {
  bidComparisonCapabilityCatalog,
  createBidComparisonEngine,
} from '../../apps/agent/src/runtime/bid-comparison-engine.js';
import { BID_COMPARISON_DEMO_SCENARIO } from './bid-comparison.scenario.js';

const SKILLS_ROOT_DIR = fileURLToPath(new URL('../../apps/agent/skills', import.meta.url));

function fixedIdGenerator(): { next: (prefix?: string) => string } {
  let counter = 0;
  return { next: (prefix) => `${prefix ?? 'id'}-${++counter}` };
}

/** Polls the real (in-memory) `RunStore` until `runId` settles into a terminal status -- no fixed sleep, mirroring `bid-comparison-engine.test.ts`'s identical helper. */
async function waitForRunSettled(
  runStore: MemoryRunStore,
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
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 10));
  }
}

/**
 * Builds the `ScenarioTrajectory` fields a live Swarm run's normalized
 * `RuntimeDebugEvent` stream determines, from an already-persisted array
 * rather than an in-flight generator. Applies the identical category/name/
 * attributes mapping `home-energy-guardian-scenario.ts`'s own exported
 * `drainSwarm` applies (skill/context/intervention/tool/swarm/goal) -- see
 * this file's header comment for why re-deriving this projection from
 * already-real persisted events is not a reimplementation of Strands
 * orchestration.
 */
function applyRuntimeEventsToTrajectory(
  events: readonly PersistedRuntimeEvent[],
  trajectory: ScenarioTrajectory,
): void {
  for (const event of events) {
    if (event.category === 'skill' && event.name === 'skill.activated') {
      const skillId = event.attributes['skillId'];
      if (typeof skillId === 'string' && event.obligationId !== undefined) {
        trajectory.skillActivations.push({ skillId, obligationId: event.obligationId });
      }
    }
    if (event.category === 'context' && event.name === 'context.injected') {
      const fields = event.attributes['fields'];
      if (Array.isArray(fields)) {
        trajectory.contextInjections.push({
          fields: fields.filter((field): field is string => typeof field === 'string'),
        });
      }
    }
    if (event.category === 'intervention') {
      const handler = event.attributes['handler'];
      const action = event.name.replace('intervention.', '');
      if (
        typeof handler === 'string' &&
        (action === 'guide' || action === 'confirm' || action === 'deny')
      ) {
        trajectory.interventions.push({ action, handler });
      }
    }
    if (event.category === 'tool' && event.phase === 'finish') {
      const toolId = event.attributes['toolName'];
      if (typeof toolId === 'string') {
        trajectory.toolCalls.push({ toolId });
      }
    }
    if (event.category === 'swarm' && event.name === 'swarm.node_completed') {
      const nodeId = event.attributes['nodeId'];
      if (typeof nodeId === 'string' && !trajectory.specialistsInvoked.includes(nodeId)) {
        trajectory.specialistsInvoked.push(nodeId);
      }
    }
    if (event.category === 'swarm' && event.name === 'swarm.handoff') {
      const from = event.attributes['from'];
      const to = event.attributes['to'];
      if (typeof from === 'string' && typeof to === 'string') {
        trajectory.swarmHandoffs.push({ from, to });
      }
    }
    if (event.category === 'goal') {
      if (event.name === 'goal.validation_failed') {
        const feedback = event.attributes['feedback'];
        trajectory.goalValidationFailures.push({
          reason: typeof feedback === 'string' ? feedback : event.summary,
        });
      } else if (event.name === 'goal.validated') {
        const attempt = event.attributes['attempt'];
        trajectory.goalValidationPasses.push({
          attempt: typeof attempt === 'number' ? attempt : 0,
        });
      }
    }
  }
}

describe('BID_COMPARISON_DEMO_SCENARIO', () => {
  it('is a genuinely valid DemoScenario', () => {
    const parsed = DemoScenarioSchema.safeParse(BID_COMPARISON_DEMO_SCENARIO);
    expect(parsed.success, JSON.stringify('error' in parsed ? parsed.error.issues : null)).toBe(
      true,
    );
  });
});

describe('Bid Comparison scenario: real causal trajectory', () => {
  it('runs the real six-node Swarm once, a genuine GoalLoop reject-then-recover cycle, Deny/Guide/Confirm, and satisfies every required assertion', async () => {
    const FIXED_CLOCK = { now: () => '2026-08-27T00:00:00.000Z' };
    const idGenerator = fixedIdGenerator();

    const registry = new PackRegistry();
    const pack = compileBidComparisonPack(bidComparisonCapabilityCatalog(), FIXED_CLOCK);
    registry.register(pack);

    const caseStore = new MemoryCaseStore();
    const activityStore = new InMemoryActivityStore();
    const runStore = new MemoryRunStore();
    const runtimeEventStore = new InMemoryRuntimeEventStore();

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

    const trajectory = emptyScenarioTrajectory();

    // --- 1. Seed: the real demo-launcher path, twelve bid entities ---
    const startResult = commandService.startDemo(idGenerator.next('cmd'), {
      demoId: 'bid-comparison',
    });
    if (startResult.status !== 'ok' || startResult.value.snapshot === undefined) {
      throw new Error(`bid-comparison-scenario: startDemo failed: ${startResult.status}`);
    }
    let snapshot = startResult.value.snapshot;
    const caseId = snapshot.id;
    trajectory.packSelections.push({ packId: snapshot.pack.id, reasons: snapshot.pack.reasons });
    trajectory.caseEvents.push(...caseStore.subscribe(caseId, 0).replay);

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

    // --- 2. ChatGPT calls sift_request_investigation with no obligationId;
    // the engine auto-selects bid.scope_normalization (the only open,
    // dependency-free obligation) and runs the real six-node Swarm. ---
    const investigationResult = runService.requestInvestigation(idGenerator.next('cmd'), {
      caseId,
      expectedSequence: snapshot.eventSequence,
    });
    if (investigationResult.status !== 'ok') {
      throw new Error(
        `bid-comparison-scenario: requestInvestigation failed: ${investigationResult.status}`,
      );
    }
    trajectory.humanActions.push({ action: 'request_investigation:bid.scope_normalization' });
    const runId = investigationResult.value.runId;

    const runRecord = await waitForRunSettled(runStore, runId);
    expect(runRecord.status).toBe('completed');
    expect(runRecord.result).toMatchObject({ round: 'round1' });

    const afterRunSnapshot = caseStore.load(caseId);
    if (afterRunSnapshot === undefined) {
      throw new Error('bid-comparison-scenario: case unexpectedly disappeared after the run');
    }
    snapshot = afterRunSnapshot;
    trajectory.caseEvents.push(...caseStore.subscribe(caseId, trajectory.caseEvents.length).replay);
    trajectory.finalCaseState = snapshot;

    // --- Build the trajectory's Swarm-shaped fields from the real,
    // already-persisted runtime events this exact live run produced. ---
    const runtimeEvents = runtimeEventStore.listByRun(runId);
    expect(runtimeEvents.length).toBeGreaterThan(0);
    applyRuntimeEventsToTrajectory(runtimeEvents, trajectory);

    // --- Every declarative assertion from bid-comparison.scenario.ts ---
    const report = checkAssertions(trajectory, BID_COMPARISON_DEMO_SCENARIO.assertions);
    const failures = report.results.filter((entry) => !entry.passed);
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);

    // --- Structural facts: six real Swarm nodes, five real handoffs, four
    // real skill activations, at least one real context injection. Derived
    // relationally (handoffs === nodes - 1, a strict sequential chain),
    // never a bare hardcoded count the task's own claim was not run to
    // confirm. ---
    expect(trajectory.specialistsInvoked.sort()).toEqual(
      [
        'scope-analyst',
        'price-analyst',
        'credential-checker',
        'schedule-analyst',
        'source-challenger',
        'decision-synthesizer',
      ].sort(),
    );
    expect(trajectory.swarmHandoffs).toHaveLength(trajectory.specialistsInvoked.length - 1);
    expect(trajectory.skillActivations).toHaveLength(4);
    expect(trajectory.contextInjections.length).toBeGreaterThan(0);

    // --- 1. intervention.deny -- specialist "price-analyst", subject
    // "license-lookup" (the pack grants that tool only to
    // "credential-checker"). The declarative `intervention` assertion kind
    // has no per-specialist/subject field, so this is checked directly
    // against the raw runtime events, mirroring `car-purchase.scenario.ts`'s
    // own documented rationale for its dynamic-id checks. ---
    const denyEvents = runtimeEvents.filter(
      (event) => event.category === 'intervention' && event.name === 'intervention.deny',
    );
    expect(denyEvents).toHaveLength(1);
    expect(denyEvents[0]?.agentId).toBe('price-analyst');
    expect(denyEvents[0]?.attributes['subject']).toBe('license-lookup');

    // --- 2. intervention.guide -- RetrySteering redirecting scope-analyst
    // away from its own repeated scope-differ call. ---
    const guideEvents = runtimeEvents.filter(
      (event) => event.category === 'intervention' && event.name === 'intervention.guide',
    );
    expect(guideEvents.length).toBeGreaterThan(0);
    expect(guideEvents.every((event) => event.agentId === 'scope-analyst')).toBe(true);
    expect(guideEvents.every((event) => event.attributes['subject'] === 'scope-differ')).toBe(true);

    // --- 3. intervention.confirm -- subject "propose_award". ---
    const confirmEvents = runtimeEvents.filter(
      (event) => event.category === 'intervention' && event.name === 'intervention.confirm',
    );
    expect(confirmEvents.length).toBeGreaterThan(0);
    expect(confirmEvents.every((event) => event.attributes['subject'] === 'propose_award')).toBe(
      true,
    );

    // --- 4. goal.validation_failed then goal.validated for
    // decision-synthesizer (GoalLoop, maxAttempts 2). ---
    const goalFailedEvents = runtimeEvents.filter(
      (event) => event.category === 'goal' && event.name === 'goal.validation_failed',
    );
    const goalPassedEvents = runtimeEvents.filter(
      (event) => event.category === 'goal' && event.name === 'goal.validated',
    );
    expect(goalFailedEvents.length).toBeGreaterThan(0);
    expect(goalPassedEvents.length).toBeGreaterThan(0);
    expect(goalFailedEvents.every((event) => event.agentId === 'decision-synthesizer')).toBe(true);
    expect(goalPassedEvents.every((event) => event.agentId === 'decision-synthesizer')).toBe(true);
    const failedSequence = goalFailedEvents[0]?.sequence ?? Number.POSITIVE_INFINITY;
    const passedSequence = goalPassedEvents[0]?.sequence ?? -1;
    expect(failedSequence).toBeLessThan(passedSequence);

    // --- 6. forbidden_event_absent (public activity): no tool.failed
    // named "license-lookup" ever appears -- a Deny is a refusal, not a
    // failure. The one legitimate tool.failed is scope-differ, from the
    // Guide beat, and it is the only one. ---
    const activity = activityStore.replayFrom(caseId, 0);
    const toolFailedEvents = activity.filter((event) => event.type === 'tool.failed');
    expect(toolFailedEvents.some((event) => event.summary.includes('license-lookup'))).toBe(false);
    expect(toolFailedEvents).toHaveLength(1);
    expect(toolFailedEvents[0]?.summary).toContain('scope-differ');
    // The attempt itself is kept (tool.started fires before the guard
    // runs), but the denied call's own error-status AfterToolCall must
    // never be republished as a tool failure.
    const licenseLookupActivity = activity.filter((event) =>
      event.summary.includes('license-lookup'),
    );
    expect(licenseLookupActivity.map((event) => event.type)).toEqual([
      'tool.started',
      'intervention.denied',
    ]);

    // --- 7. The award proposal ends pending, with no approving actor.
    // Only origin 'user' may approve, and in this trajectory nobody ever
    // does. ---
    expect(snapshot.proposal).not.toBeNull();
    expect(snapshot.proposal?.status).toBe('pending');
    expect(snapshot.proposal?.reviewedByActor).toBeUndefined();
    expect(snapshot.status).not.toBe('decided');
    expect(trajectory.agentApprovedProposalAttempts).toBe(0);
    expect(activity.some((event) => event.summary === 'Proposal approved.')).toBe(false);
    const reviewedEvents = trajectory.caseEvents.filter(
      (event): event is Extract<CaseEvent, { type: 'proposal.reviewed' }> =>
        event.type === 'proposal.reviewed',
    );
    expect(reviewedEvents).toHaveLength(0);

    // --- 8. The recommendation is bid-northgate, and its rationale cites
    // Cedar's adjusted total of $279,000 exceeding Northgate's $276,000. ---
    expect(snapshot.recommendation?.favoredOptionId).toBe('bid-northgate');
    expect(snapshot.recommendation?.rationale).toContain('279,000');
    expect(snapshot.recommendation?.rationale).toContain('276,000');
    expect(snapshot.recommendation?.rationale).toContain('Cedar');
    expect(snapshot.recommendation?.rationale).toContain('Northgate');

    // --- The deterministic core, not the model, owns the ranking: the
    // persisted recommendation's confidence/facts reproduce exactly what
    // `deriveScoredRecommendationFields` recomputes from the same final
    // snapshot -- the identical parity proof car-purchase.scenario.test.ts/
    // home-energy-guardian.scenario.test.ts each run. ---
    const recomputed = deriveScoredRecommendationFields(snapshot, 'bid-northgate');
    expect(snapshot.recommendation?.confidence).toBe(recomputed.confidence);
    expect(snapshot.recommendation?.facts).toEqual(recomputed.facts);
    const board = scoreCaseState(snapshot);
    const favored = board.options.find((option) => option.optionId === 'bid-northgate');
    expect(favored?.total).not.toBeNull();

    // --- The protected hard constraint flags, it never silently
    // eliminates: bid-tworivers stays on the board, fully scored, its
    // invalid credentials visibly named as a disputed constraint. ---
    const twoRivers = board.options.find((option) => option.optionId === 'bid-tworivers');
    expect(twoRivers).toBeDefined();
    expect(twoRivers?.violatedConstraintIds).toContain('bid.credentials_valid');

    // --- queued/specialist/skill/tool/evidence/recommendation/completion
    // events appear, and case events are strictly ordered ---
    trajectory.caseEvents.forEach((event, index) => {
      if (index === 0) return;
      expect(event.sequence).toBeGreaterThan(trajectory.caseEvents[index - 1]!.sequence);
    });
    expect(trajectory.humanActions.length).toBeGreaterThan(0);
    expect(trajectory.toolCalls.length).toBeGreaterThan(0);
    expect(trajectory.skillActivations.length).toBeGreaterThan(0);
    expect(activity.some((event) => event.type === 'evidence.accepted')).toBe(true);
    expect(snapshot.evidenceLinks.length).toBeGreaterThan(0);

    // --- "reload produces the same case state" (replay every real
    // CaseEvent via applyCaseEvent from an empty case, the exact same
    // replay-equivalence proof car-purchase.scenario.test.ts/
    // home-energy-guardian.scenario.test.ts each use) ---
    let replayed: CaseState | null = null;
    for (const event of trajectory.caseEvents) {
      replayed = applyCaseEvent(replayed, event);
    }
    expect(replayed).not.toBeNull();
    // `attributeDefinitions`/`selectedOptionId`/`selectedEvidenceId`/
    // `sources` are never derivable from `CaseEvent` replay alone -- see
    // `case-store.ts`'s own module comment and the identical, documented
    // exclusion in both sibling scenario tests.
    expect({ ...replayed, attributeDefinitions: [], selectedOptionId: null, sources: [] }).toEqual({
      ...snapshot,
      attributeDefinitions: [],
      selectedOptionId: null,
      sources: [],
    });

    // --- Write the required scenario artifacts ---
    const paths = writeScenarioArtifacts({
      scenarioId: 'bid-comparison',
      finalCaseState: snapshot,
      eventLog: trajectory.caseEvents,
      trajectory,
      assertionReport: report,
    });
    expect(paths.dir).toContain('bid-comparison');
    expect(caseId).toBe(snapshot.id);
  }, 30_000);
});
