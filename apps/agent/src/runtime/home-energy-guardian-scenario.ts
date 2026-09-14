/**
 * The concrete Home Energy Guardian scenario engine: drives the real bounded
 * Strands Swarm (`executeHomeEnergySwarm`, `./home-energy-swarm.ts`) through
 * the entire required demo trajectory (docs/specs/demos-and-submission.md
 * "Home Energy Guardian scenario" -> "Required sequence"), accumulating a
 * `ScenarioTrajectory` (`@sift/scenarios`) the scenario test checks every
 * required assertion against.
 *
 * This is the Swarm-hero analog of `car-purchase-scenario.ts`'s
 * `runCarPurchaseScenario`, built the same way: it does NOT go through
 * `home-energy-engine.ts`'s `createHomeEnergyEngine(...).trigger(...)` (that
 * engine's own scripted-beats wiring is fixed and cannot be selectively
 * patched for one node), it drives `executeHomeEnergySwarm` directly, twice,
 * folding real `ExecutionResult`s into canonical `CaseEvent`s via
 * `car-purchase-scenario.ts`'s already-exported, fully generic
 * `buildExecutionRequestFor`/`foldExecutionResult`/`ensureSourcesExist`/
 * `loadSnapshotOrThrow`/`extractCitedSourceIds` helpers (read-only imports,
 * genuinely reused -- none of those five functions reference anything
 * car-purchase-specific), exactly the way `home-energy-engine.ts`'s own
 * `foldHomeEnergyRound1`/`foldHomeEnergyRound2` already do. Swarm
 * construction itself is never re-derived here: it lives entirely in
 * `home-energy-swarm.ts` (`executeHomeEnergySwarm`,
 * `buildHomeEnergySwarmScriptedProviders`, `scriptedModelFor`,
 * `setScenarioBeat`), imported unmodified. `homeEnergyCapabilityCatalog` is
 * reused from `home-energy-engine.ts` for the same reason
 * `car-purchase-scenario.ts`'s own `carPurchaseCapabilityCatalog` is reused
 * elsewhere: one real compiled pack construction, not two competing copies.
 *
 * --- Two rounds, matching the Swarm's real two synthesis moments ---
 *
 * `runHomeEnergyGuardianScenario` runs the real six-node Swarm exactly
 * twice: `round1` (the initial investigation, starting at
 * `anomaly-investigator`, under the pack's own default 80/20 cost/
 * conservation weighting) and `round2` (after the household reweights
 * toward long-term waste reduction, starting directly at
 * `decision-synthesizer` -- nothing about the already-confirmed anomaly/
 * rate/weather/household-event evidence changes, only the criteria
 * weighting, mirroring `home-energy-engine.ts`'s own round2 restart point).
 * Every other required beat (case seeding, the household's criteria
 * reweight, human proposal review) drives the real, already-built
 * `CommandService`/`RunService`/`CaseStore` directly, exactly like
 * `car-purchase-scenario.ts`.
 *
 * --- A genuinely triggered GoalLoop rejection-then-recovery (required
 * sequence step 5: "A plausible early `monitor-one-cycle` draft is rejected
 * because household-change evidence is unresolved; the UI displays `Draft
 * withheld`") ---
 *
 * The scripted round1 trajectory `scripted-beats/home-energy-guardian.ts`
 * already ships (unmodified, imported read-only here) never actually
 * exercises this: its `decision-synthesizer` beat is a single, already-valid
 * turn. What actually happens in THIS scenario's own round1 run instead:
 * `decision-synthesizer`'s first turn emits an uncited draft
 * ("Monitor for now.", below), the real `DEFAULT_SYNTHESIZER_VALIDATOR`
 * rejects it and `event-normalizer.ts` emits a real `goal.validation_failed`
 * event on attempt 1 (captured into `trajectory.goalValidationFailures`
 * below), and the corrected retry -- citing real fixture sources and
 * naming `monitor-one-cycle` -- validates on attempt 2, emitting a real
 * `goal.validated` event (`trajectory.goalValidationPasses`). The real
 * `GoalLoop` rejection mechanism this reuses is proven directly
 * (`home-energy-swarm.test.ts`, describe block "intervention integrity",
 * test "rejects a decision-synthesizer draft with no source citation, then
 * accepts a corrected retry (GoalLoop maxAttempts: 2)"), but does not fire
 * on the standard scripted pass. Per docs/engineering-principles.md's honesty discipline, this
 * scenario does not fake a "Draft withheld" label -- it genuinely
 * *constructs* the rejection, reusing that exact same proven mechanism: a
 * one-node-patched `modelFor` (`round1ModelFor` below, mirroring that test's
 * own `patchedModelFor` pattern precisely) gives `decision-synthesizer` a
 * first turn with no source citation (rejected by the real
 * `DEFAULT_SYNTHESIZER_VALIDATOR`, which every other node in this run also
 * uses unmodified), then a corrected retry citing real fixture sources and
 * naming `monitor-one-cycle` -- the exact same content
 * `scripted-beats/home-energy-guardian.ts`'s own `DECISION_TEXT_ROUND1`
 * documents as the real cost-favoring outcome at this evidence state. Every
 * other node's provider (anomaly/rate/weather/household/challenger) is the
 * unmodified real scripted-beats bundle. This genuinely exercises `GoalLoop`
 * end to end (a real rejection, a real retry, a real pass) rather than
 * asserting a hard-coded final string.
 *
 * --- A genuine session-snapshot restart-and-restore (required sequence
 * steps 12-13) ---
 *
 * strands-runtime.md "Sessions and snapshots": "Create an immutable snapshot
 * before a human confirmation and after a recommendation proposal. The
 * Energy deterministic scenario must restart the adapter after the
 * confirmation snapshot, restore it, and continue from the same handoff/
 * session position." This scenario builds one real case-level Strands
 * orchestrator session `Agent` (strands-runtime.md: "Each case uses one
 * Strands orchestrator session") wired to a real `SessionManager` +
 * `LocalFileStorage` (`session-adapter.ts`, unmodified, imported read-only),
 * has it summarize round2's pending inspection decision, saves an immutable
 * snapshot through the real filesystem, then discards that `Agent`/
 * `SessionManager` pair entirely and builds a brand-new pair pointed at the
 * same on-disk session directory -- a genuine restart, not a re-used
 * in-memory object -- and restores from it, exactly mirroring
 * `session-adapter.test.ts`'s own "genuine round trip through the real
 * filesystem" proof. Only once that restore genuinely succeeds does this
 * scenario create the `proposal.proposed` `CaseEvent` the human then
 * approves -- "saves a session snapshot before an inspection proposal is
 * created".
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@strands-agents/sdk';
import type { Clock, IdGenerator } from '@sift/core';
import { compileHomeEnergyGuardianPack, PackRegistry } from '@sift/packs';
import type { CaseEvent, CaseState, CompiledDecisionPack } from '@sift/contracts';
import {
  buildHomeEnergyResponseOptionEntities,
  emptyScenarioTrajectory,
  type ScenarioTrajectory,
} from '@sift/scenarios';
import { CommandService } from '../services/command-service.js';
import { InMemoryActivityStore } from '../store/activity-store.js';
import { MemoryCaseStore } from '../store/memory-case-store.js';
import { MemoryRunStore, RunService } from '../services/run-service.js';
import {
  buildExecutionRequestFor,
  ensureSourcesExist,
  entityLabelsById,
  extractCitedSourceIds,
  foldExecutionResult,
  humanizeDecisionText,
  loadSnapshotOrThrow,
} from './car-purchase-scenario.js';
import { homeEnergyCapabilityCatalog } from './home-energy-engine.js';
import {
  HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS,
  executeHomeEnergySwarm,
  type HomeEnergySequentialSpecialistId,
  type HomeEnergySwarmDeps,
  type HomeEnergySwarmNodeId,
  type HomeEnergySwarmResult,
} from './home-energy-swarm.js';
import {
  buildHomeEnergySwarmScriptedProviders,
  scriptedModelFor,
  setScenarioBeat,
} from './scripted-beats/home-energy-guardian.js';
import { ScriptedModelProvider } from './model-provider.js';
import {
  buildLocalSessionManager,
  restoreCaseSnapshot,
  saveCaseSnapshot,
} from './session-adapter.js';
import { createSequenceCounter, type RuntimeEvent } from './event-normalizer.js';
import { deriveScoredRecommendationFields, mergeLimitations } from './recommendation-scoring.js';

export interface HomeEnergyGuardianScenarioDeps {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly skillsRootDir: string;
}

export interface HomeEnergyGuardianScenarioResult {
  readonly trajectory: ScenarioTrajectory;
  readonly caseId: string;
}

/**
 * Real fixture-grounded round1 recommendation text: the same cost-favoring
 * `monitor-one-cycle` outcome, citing the same real sources,
 * `scripted-beats/home-energy-guardian.ts`'s own (unexported)
 * `DECISION_TEXT_ROUND1` documents -- restated here (not imported; that
 * constant is intentionally private to its module) as the *corrected*
 * second turn of this scenario's genuinely-triggered GoalLoop
 * reject-then-recover cycle (see module header).
 *
 * Cites `monitor-one-cycle`/`source-...` literally, the same citation format
 * `extractCitedSourceIds` parses `sourceIds` out of -- `humanizeDecisionText`
 * (`car-purchase-scenario.ts`, reused here for §34) renders this into
 * consumer-safe prose before it is ever stored as `Recommendation.rationale`,
 * so the raw ids below never reach `RecommendationCard.tsx`.
 */
const ROUND1_CORRECTED_RECOMMENDATION_TEXT =
  'Recommend monitor-one-cycle before taking further action, per source-current-bill-household-demo-energy-01 and source-household-event-event-thermostat-failure-2026-07. No inspection is proposed at this weighting.';

const ROUND1_FAVORED_OPTION_ID = 'monitor-one-cycle';

/** `energy.<x>` obligation id each sequential Swarm node's context resolves. Mirrors `home-energy-engine.ts`'s own (unexported) `SEQUENTIAL_OBLIGATION_ID` mapping. */
const SEQUENTIAL_OBLIGATION_ID: Record<HomeEnergySequentialSpecialistId, string> = {
  'anomaly-investigator': 'energy.anomaly',
  'rate-analyst': 'energy.rate_change',
  'weather-analyst': 'energy.weather',
  'home-systems-analyst': 'energy.household_change',
};

/**
 * Every non-empty `limitations` entry any node's captured context carried,
 * de-duplicated. Mirrors `home-energy-engine.ts`'s own (unexported)
 * `collectLimitations`. Exported (not merely a scenario-file-local helper)
 * so its `context?.limitations ?? []` fallback -- reached only when a
 * `contexts` map genuinely omits a node's context entirely, which the real
 * Swarm run this file drives never does -- can be unit-tested directly
 * against a small synthetic `contexts` map.
 */
export function collectLimitations(contexts: HomeEnergySwarmResult['contexts']): string[] {
  const seen = new Set<string>();
  for (const context of Object.values(contexts)) {
    for (const limitation of context?.limitations ?? []) {
      seen.add(limitation);
    }
  }
  return [...seen];
}

/** `resolvedObligationIds`/`acceptedUncertaintyObligationIds`, computed from real, current obligation statuses -- never hardcoded. Mirrors `home-energy-engine.ts`'s own (unexported) `obligationIdsByStatus`. */
function obligationIdsByStatus(
  snapshot: CaseState,
  status: 'satisfied' | 'accepted_uncertainty',
): string[] {
  return snapshot.obligations.filter((obligation) => obligation.status === status).map((o) => o.id);
}

/**
 * Captures the real `CaseEvent`s a just-completed `CommandService` call
 * appended internally, via the real `CaseStore.subscribe` replay -- the same
 * mechanism a real SSE client uses to catch up. Mirrors
 * `car-purchase-scenario.ts`'s own (unexported) `captureNewEvents`.
 */
function captureNewEvents(
  caseStore: MemoryCaseStore,
  caseId: string,
  fromSequence: number,
  trajectory: ScenarioTrajectory,
): void {
  const { replay } = caseStore.subscribe(caseId, fromSequence);
  trajectory.caseEvents.push(...replay);
}

/**
 * Builds the real `HomeEnergySwarmDeps` for one round from a live case
 * snapshot + the real compiled pack -- this file's own version of
 * `car-purchase-scenario.ts`'s `buildGraphDeps`, using the same reused
 * `buildExecutionRequestFor` building block for every `ExecutionRequest`.
 */
function buildSwarmDeps(
  caseState: CaseState,
  pack: CompiledDecisionPack,
  modelFor: HomeEnergySwarmDeps['modelFor'],
  deps: HomeEnergyGuardianScenarioDeps,
  start: HomeEnergySwarmNodeId | undefined,
): HomeEnergySwarmDeps {
  const specialistRequests = Object.fromEntries(
    HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS.map((specialistId) => [
      specialistId,
      buildExecutionRequestFor(caseState, pack, SEQUENTIAL_OBLIGATION_ID[specialistId]),
    ]),
  ) as HomeEnergySwarmDeps['specialistRequests'];

  return {
    pack,
    modelFor,
    skillsRootDir: deps.skillsRootDir,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    specialistRequests,
    responseOptionsRequest: buildExecutionRequestFor(caseState, pack, 'energy.response_options'),
    resolveConfirmation: () => true,
    ...(start !== undefined ? { start } : {}),
  };
}

/**
 * Drains one real `executeHomeEnergySwarm` run's normalized `RuntimeEvent`
 * stream, folding every event category the required assertions need into
 * `trajectory` -- the Swarm-shaped analog of `car-purchase-scenario.ts`'s
 * own (also exported, for the identical reason) `drainGraph`:
 * `swarm.node_completed`/`swarm.handoff` replace that function's
 * `graph`-category handling; `skill`/`context`/`intervention`/`tool`
 * handling is identical; `goal` handling is new here (car-purchase's Graph
 * nodes use a plain `DEFAULT_VALIDATOR` with no GoalLoop retry moment in its
 * own demo trajectory). Exported so its per-event-shape defensive branches
 * (a malformed/partial `RuntimeEvent` attribute, an unrecognized `goal.*`
 * event name) can be unit-tested directly against a small synthetic event
 * stream -- shapes the real, fully-scripted Swarm run never actually
 * produces (`event-normalizer.ts` only ever emits `goal.validated`/
 * `goal.validation_failed` for the `goal` category, and always supplies a
 * well-formed `skillId`/`toolName`/`nodeId`/`from`/`to`).
 */
export async function drainSwarm(
  gen: AsyncGenerator<RuntimeEvent, HomeEnergySwarmResult, undefined>,
  trajectory: ScenarioTrajectory,
): Promise<HomeEnergySwarmResult> {
  let next = await gen.next();
  while (!next.done) {
    const event = next.value;
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
    next = await gen.next();
  }
  return next.value;
}

/**
 * Runs the complete, real Home Energy Guardian demo trajectory
 * (docs/specs/demos-and-submission.md "Required sequence") in process: seeds
 * the case, runs the real six-node Swarm twice, drives every real command in
 * between, and returns the accumulated `ScenarioTrajectory` plus final
 * `caseId` for assertion checking.
 */
export async function runHomeEnergyGuardianScenario(
  deps: HomeEnergyGuardianScenarioDeps,
): Promise<HomeEnergyGuardianScenarioResult> {
  const trajectory = emptyScenarioTrajectory();
  const pack = compileHomeEnergyGuardianPack(homeEnergyCapabilityCatalog(), deps.clock);
  const registry = new PackRegistry();
  registry.register(pack);

  const caseStore = new MemoryCaseStore();
  const activityStore = new InMemoryActivityStore();
  const commandService = new CommandService({
    caseStore,
    activityStore,
    registry,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    demoSeedEntities: { 'home-energy-guardian': buildHomeEnergyResponseOptionEntities },
  });
  const runService = new RunService({
    caseStore,
    activityStore,
    runStore: new MemoryRunStore(),
    clock: deps.clock,
    idGenerator: deps.idGenerator,
  });

  // --- 1/2. The deterministic bill-feed gate (`CommandService.
  // checkEnergyBillFeed`, `@sift/scenarios`'s `evaluateBillFeed`) evaluates
  // the real, checked-in bill (42% above the normalized baseline, well
  // past the 15% threshold) and opens the case; Sift routes to Home Energy
  // Guardian without a human choice. This is a genuine gate, not a
  // narrated one: pointed at the OTHER real fixture
  // (`current-bill-normal.json`, within threshold) the same call declines
  // and opens no case at all -- proved directly in
  // `command-service.test.ts`'s "checkEnergyBillFeed" describe block, not
  // merely asserted here. `checkEnergyBillFeed('anomalous')` delegates its
  // actual case construction to the same `CommandService.startDemo` this
  // scenario used to call directly, so the resulting case/event sequence
  // is unchanged -- only the honesty of what decided to create it is.
  const checkResult = commandService.checkEnergyBillFeed(deps.idGenerator.next('cmd'), {
    billFeedId: 'anomalous',
  });
  if (checkResult.status !== 'ok' || checkResult.value.receipt?.snapshot === undefined) {
    throw new Error(
      `home-energy-guardian-scenario: checkEnergyBillFeed failed: status "${checkResult.status}"`,
    );
  }
  let snapshot = checkResult.value.receipt.snapshot;
  const caseId = snapshot.id;
  captureNewEvents(caseStore, caseId, 0, trajectory);
  trajectory.packSelections.push({ packId: snapshot.pack.id, reasons: snapshot.pack.reasons });

  // Every response option's real label (§34: `Recommendation.rationale` must
  // read "Monitor for one more billing cycle", never the raw
  // "monitor-one-cycle" id) -- built once from the demo-seeded entities,
  // mirroring `car-purchase-scenario.ts`'s own `candidateLabels`.
  const optionLabels = entityLabelsById(snapshot.entities);

  // --- 3-9. Round 1: the real six-node Swarm, starting at anomaly-investigator, at the pack's own default 80/20 cost/conservation weighting ---
  const providers = buildHomeEnergySwarmScriptedProviders();
  setScenarioBeat(providers, 'round1');

  // See module header: genuinely triggers a GoalLoop rejection-then-recovery
  // at decision-synthesizer, reusing the exact real mechanism
  // home-energy-swarm.test.ts's "intervention integrity" describe block
  // already proves, rather than faking "Draft withheld".
  const round1SynthesizerProvider = new ScriptedModelProvider({
    beats: {
      round1: [
        {
          toolCalls: [
            { name: 'strands_structured_output', input: { message: 'Monitor for now.' } },
          ],
        },
        {
          toolCalls: [
            {
              name: 'strands_structured_output',
              input: { message: ROUND1_CORRECTED_RECOMMENDATION_TEXT },
            },
          ],
        },
      ],
    },
  });
  round1SynthesizerProvider.setBeat('round1');
  const round1ModelFor: HomeEnergySwarmDeps['modelFor'] = (nodeId) =>
    nodeId === 'decision-synthesizer' ? round1SynthesizerProvider : providers[nodeId];

  const round1Result = await drainSwarm(
    executeHomeEnergySwarm(buildSwarmDeps(snapshot, pack, round1ModelFor, deps, undefined)),
    trajectory,
  );

  for (const specialistId of HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS) {
    const context = round1Result.contexts[specialistId];
    if (context === undefined) {
      throw new Error(
        `home-energy-guardian-scenario: round1 produced no context for "${specialistId}"`,
      );
    }
    foldExecutionResult(caseStore, activityStore, caseId, context, deps, trajectory, {
      attemptsToRecord: 1,
    });
  }
  const challengeRound1 = round1Result.contexts['source-challenger'];
  if (challengeRound1 === undefined) {
    throw new Error(
      'home-energy-guardian-scenario: round1 produced no context for "source-challenger"',
    );
  }
  // source-challenger corroborates the evidence chain rather than making its
  // own attempt at an obligation -- mirrors car-purchase-scenario.ts's and
  // home-energy-engine.ts's identical rationale for their own
  // source-challenger folds.
  foldExecutionResult(caseStore, activityStore, caseId, challengeRound1, deps, trajectory, {
    attemptsToRecord: 0,
  });

  // --- energy.response_options round1 synthesis (mirrors car.shortlist / home-energy-engine.ts's foldHomeEnergyRound1) ---
  const round1InitialSnapshot = loadSnapshotOrThrow(caseStore, caseId);
  const round1SourceIds = extractCitedSourceIds(round1Result.decisionSynthesizerText);
  ensureSourcesExist(
    caseStore,
    caseId,
    round1InitialSnapshot.eventSequence,
    round1SourceIds,
    deps.clock,
  );
  snapshot = foldExecutionResult(
    caseStore,
    activityStore,
    caseId,
    {
      obligationId: 'energy.response_options',
      disposition: 'evidence_found',
      claims: [
        {
          statement: humanizeDecisionText(round1Result.decisionSynthesizerText, optionLabels),
          stance: 'supports',
          confidence: 0.8,
          sourceIds: round1SourceIds,
        },
      ],
      evidenceResults: round1SourceIds.map((sourceId) => ({
        sourceId,
        level: 'E2' as const,
        verdict: 'pass' as const,
        summary: 'Cited in the response-options synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    deps,
    trajectory,
    { attemptsToRecord: 1 },
  );

  // --- Round 1 recommendation: a soft initial lean toward monitor-one-cycle (no proposal yet -- home-energy-guardian's one consequential effect is only ever exercised in round 2) ---
  // The model proposed the favorite; the deterministic scoreboard supplies
  // the numbers attached to it. See recommendation-scoring.ts for why a
  // disagreement is stated rather than resolved in either direction.
  const scoredRound1 = deriveScoredRecommendationFields(snapshot, ROUND1_FAVORED_OPTION_ID);
  const recommendation1Event: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'recommendation.ready',
    payload: {
      recommendation: {
        id: deps.idGenerator.next('rec'),
        status: 'ready',
        favoredOptionId: ROUND1_FAVORED_OPTION_ID,
        rationale: humanizeDecisionText(round1Result.decisionSynthesizerText, optionLabels),
        facts: scoredRound1.facts,
        hypotheses: [],
        confidence: scoredRound1.confidence,
        limitations: mergeLimitations(
          collectLimitations(round1Result.contexts),
          scoredRound1.limitations,
        ),
        sourceIds: round1SourceIds,
        resolvedObligationIds: obligationIdsByStatus(snapshot, 'satisfied'),
        acceptedUncertaintyObligationIds: obligationIdsByStatus(snapshot, 'accepted_uncertainty'),
        generatedAt: deps.clock.now(),
      },
    },
  };
  const rec1Append = caseStore.append(caseId, [recommendation1Event], snapshot.eventSequence);
  if (rec1Append.status !== 'applied') {
    throw new Error('home-energy-guardian-scenario: failed to record the round1 recommendation');
  }
  trajectory.caseEvents.push(recommendation1Event);
  snapshot = rec1Append.snapshot;

  // --- 10. "Long-term waste matters more than the cheapest immediate option" -> sift_update_criteria (invalidates the round1 recommendation, per command-service.ts's generic, pack-agnostic updateCriteria rule) ---
  const beforeCriteria = snapshot.eventSequence;
  const criteriaResult = commandService.updateCriteria(deps.idGenerator.next('cmd'), {
    caseId,
    expectedSequence: snapshot.eventSequence,
    operations: [
      { op: 'reweight', criterionId: 'energy.cost', weight: 20 },
      { op: 'reweight', criterionId: 'energy.conservation', weight: 80 },
    ],
  });
  if (criteriaResult.status !== 'ok' || criteriaResult.value.snapshot === undefined) {
    throw new Error(
      `home-energy-guardian-scenario: updateCriteria failed: ${criteriaResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: 'update_criteria:cost_to_conservation' });
  captureNewEvents(caseStore, caseId, beforeCriteria, trajectory);
  snapshot = criteriaResult.value.snapshot;

  // sift_request_investigation, mirroring the "Energy moment" WebMCP demo pairing (demos-and-submission.md).
  const investigationResult = runService.requestInvestigation(deps.idGenerator.next('cmd'), {
    caseId,
    obligationId: 'energy.response_options',
    expectedSequence: snapshot.eventSequence,
  });
  if (investigationResult.status !== 'ok') {
    throw new Error(
      `home-energy-guardian-scenario: requestInvestigation failed: ${investigationResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: 'request_investigation:energy.response_options' });

  // --- 11/12. Round 2: the real Swarm again, starting directly at decision-synthesizer, now favoring request-hvac-inspection; ConsequenceGuard confirms before the proposal exists ---
  setScenarioBeat(providers, 'round2');
  const round2Result = await drainSwarm(
    executeHomeEnergySwarm(
      buildSwarmDeps(snapshot, pack, scriptedModelFor(providers), deps, 'decision-synthesizer'),
    ),
    trajectory,
  );

  const round2InitialSnapshot = loadSnapshotOrThrow(caseStore, caseId);
  const round2SourceIds = extractCitedSourceIds(round2Result.decisionSynthesizerText);
  ensureSourcesExist(
    caseStore,
    caseId,
    round2InitialSnapshot.eventSequence,
    round2SourceIds,
    deps.clock,
  );
  // A re-synthesis revising the same obligation, not a fresh "attempt" at it
  // (matches source-challenger's attemptsToRecord: 0 corroboration
  // rationale above) -- energy.response_options is already "satisfied" from
  // round1.
  snapshot = foldExecutionResult(
    caseStore,
    activityStore,
    caseId,
    {
      obligationId: 'energy.response_options',
      disposition: 'evidence_found',
      claims: [
        {
          statement: humanizeDecisionText(round2Result.decisionSynthesizerText, optionLabels),
          stance: 'supports',
          confidence: 0.85,
          sourceIds: round2SourceIds,
        },
      ],
      evidenceResults: round2SourceIds.map((sourceId) => ({
        sourceId,
        level: 'E2' as const,
        verdict: 'pass' as const,
        summary: 'Cited in the revised response-options synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    deps,
    trajectory,
    { attemptsToRecord: 0 },
  );

  if (round2Result.proposedInspection === undefined) {
    throw new Error(
      'home-energy-guardian-scenario: round2 decision-synthesizer never called propose_inspection',
    );
  }
  const favoredRound2 = round2Result.proposedInspection.optionId;

  // The model proposed the favorite; the deterministic scoreboard supplies
  // the numbers attached to it. See recommendation-scoring.ts for why a
  // disagreement is stated rather than resolved in either direction.
  const scoredRound2 = deriveScoredRecommendationFields(snapshot, favoredRound2);
  const recommendation2Event: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'recommendation.ready',
    payload: {
      recommendation: {
        id: deps.idGenerator.next('rec'),
        status: 'ready',
        favoredOptionId: favoredRound2,
        rationale: humanizeDecisionText(round2Result.decisionSynthesizerText, optionLabels),
        facts: scoredRound2.facts,
        hypotheses: [],
        confidence: scoredRound2.confidence,
        limitations: mergeLimitations(
          collectLimitations(round2Result.contexts),
          scoredRound2.limitations,
        ),
        sourceIds: round2SourceIds,
        resolvedObligationIds: obligationIdsByStatus(snapshot, 'satisfied'),
        acceptedUncertaintyObligationIds: obligationIdsByStatus(snapshot, 'accepted_uncertainty'),
        generatedAt: deps.clock.now(),
      },
    },
  };
  const rec2Append = caseStore.append(caseId, [recommendation2Event], snapshot.eventSequence);
  if (rec2Append.status !== 'applied') {
    throw new Error('home-energy-guardian-scenario: failed to record the round2 recommendation');
  }
  trajectory.caseEvents.push(recommendation2Event);
  snapshot = rec2Append.snapshot;

  // --- 12/13. A genuine session-snapshot save, restart, and restore before the proposal is created (see module header) ---
  const sessionDataDir = mkdtempSync(join(tmpdir(), 'sift-energy-scenario-session-'));
  try {
    const sessionCtx = {
      traceId: deps.idGenerator.next('trace'),
      runId: deps.idGenerator.next('run'),
      caseId,
    };
    const sequence = createSequenceCounter();

    const summaryProvider = new ScriptedModelProvider({
      beats: {
        summary: [
          {
            text: `Pending household decision: request an HVAC/thermostat inspection (${favoredRound2}). ${round2Result.decisionSynthesizerText}`,
          },
        ],
      },
    });
    summaryProvider.setBeat('summary');
    const managerA = buildLocalSessionManager(sessionDataDir, caseId);
    const sessionAgentA = new Agent({
      model: summaryProvider,
      sessionManager: managerA,
      printer: false,
    });
    await sessionAgentA.invoke(
      'Summarize the pending home-energy-guardian response-options decision for the case record before the household confirms it.',
    );
    if (sessionAgentA.messages.length === 0) {
      throw new Error(
        'home-energy-guardian-scenario: the case session agent produced no messages to snapshot',
      );
    }
    await saveCaseSnapshot(managerA, sessionAgentA, {
      ctx: sessionCtx,
      sequence,
      emit: () => undefined,
    });

    // A brand-new SessionManager + brand-new Agent instance, pointed at the
    // same real on-disk session directory -- a genuine restart, not a reused
    // in-memory object, mirroring session-adapter.test.ts's own "genuine
    // round trip through the real filesystem" proof.
    const managerB = buildLocalSessionManager(sessionDataDir, caseId);
    const sessionAgentB = new Agent({
      model: new ScriptedModelProvider({ beats: {} }),
      printer: false,
    });
    const restored = await restoreCaseSnapshot(managerB, sessionAgentB, {
      ctx: sessionCtx,
      sequence,
      emit: () => undefined,
    });
    if (!restored || sessionAgentB.messages.length !== sessionAgentA.messages.length) {
      throw new Error(
        'home-energy-guardian-scenario: the session snapshot round trip did not genuinely restore',
      );
    }
    trajectory.snapshotRestorations.push({ caseId });
  } finally {
    rmSync(sessionDataDir, { recursive: true, force: true });
  }

  // --- Sift proposes requesting the inspection; only a human may approve ---
  const proposalId = deps.idGenerator.next('proposal');
  const proposalEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'proposal.proposed',
    payload: {
      proposal: {
        id: proposalId,
        recommendationId: recommendation2Event.payload.recommendation.id,
        status: 'pending',
        createdAt: deps.clock.now(),
      },
    },
  };
  const proposalAppend = caseStore.append(caseId, [proposalEvent], snapshot.eventSequence);
  if (proposalAppend.status !== 'applied') {
    throw new Error('home-energy-guardian-scenario: failed to create the decision proposal');
  }
  trajectory.caseEvents.push(proposalEvent);
  snapshot = proposalAppend.snapshot;

  // --- 13. The user approves creation of the proposal through the visible UI. The demo does not schedule anything. ---
  const beforeReview = snapshot.eventSequence;
  const reviewResult = commandService.reviewProposal(deps.idGenerator.next('cmd'), {
    caseId,
    proposalId,
    actor: 'human',
    decision: 'approve',
    expectedSequence: snapshot.eventSequence,
  });
  if (reviewResult.status !== 'ok' || reviewResult.value.snapshot === undefined) {
    throw new Error(
      `home-energy-guardian-scenario: reviewProposal(approve) failed: ${reviewResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: `approve_proposal:${favoredRound2}` });
  captureNewEvents(caseStore, caseId, beforeReview, trajectory);
  snapshot = reviewResult.value.snapshot;

  trajectory.finalCaseState = snapshot;
  return { trajectory, caseId };
}
