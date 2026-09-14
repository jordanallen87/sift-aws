/**
 * The concrete car-purchase scenario engine: drives the real
 * `CommandService`/`RunService`/`MemoryCaseStore`/`PackRegistry` (read-only
 * references, imported not modified) and the real `executeCarPurchaseGraph`
 * (`car-purchase-graph.js`) through the entire required demo trajectory
 * (docs/specs/demos-and-submission.md "Choose Our Next Car scenario" ->
 * "Required sequence"), accumulating a `ScenarioTrajectory`
 * (`@sift/scenarios`) the scenario test checks every required assertion
 * against.
 *
 * This is the "minimal version this scenario needs" of a scenario runner
 * (`packages/scenarios/src/runner.ts` stays a generic, apps-agnostic step
 * iterator -- see that file's header for why the concrete engine cannot live
 * there: `packages/scenarios` sits below `apps/agent` in the workspace
 * dependency graph and cannot import the Strands runtime that actually
 * drives a run). A fuller generic runner that drives arbitrary
 * `DemoScenario.steps` against arbitrary packs is documented, explicit
 * follow-up work, not built here.
 *
 * --- Two rounds, matching the Graph's real "two synthesis moments" ---
 *
 * `runCarPurchaseScenario` runs the real six-node car-purchase Graph exactly
 * twice: `round1` (the initial investigation, before the household
 * interacts) and `round2` (after the household's WebMCP-driven criteria
 * reweight and `custom.rear_facing_seat_behind_driver` concern). Every other
 * required beat (pack routing, candidate seeding, focus, criteria update,
 * case-attribute definition/confirmation, human proposal review,
 * reload/replay) drives the real, already-built
 * `CommandService`/`RunService`/`CaseStore` directly.
 *
 * --- Two real, confirmed gaps this engine works around (both documented in
 * the dated docs/build-log.md entry for this task; both are additive fixes
 * to files NOT on this task's read-only list) ---
 *
 * 1. No `CaseEvent` ever creates the first pending `DecisionProposal` (only
 *    `proposal.reviewed` *reviews* an existing one). Fixed by adding
 *    `proposal.proposed` to `@sift/contracts`'s `CaseEvent` union and folding
 *    it in `packages/core`'s `applyCaseEvent`, exactly like
 *    `recommendation.ready` folds a `Recommendation` -- see `events.ts`'s
 *    own comment on that schema for the full reasoning.
 * 2. `defineCaseAttribute`/`updateCriteria` do not derive the case
 *    obligation pack-authoring.md's "userConcern template" describes (a
 *    documented, deliberately deferred gap in `command-service.ts`'s own
 *    header comment). This engine derives it directly via `@sift/core`'s
 *    `deriveObligations` with a synthesized `case_extension`-origin
 *    `ObligationTemplate`, then appends the resulting `obligation.updated`
 *    event itself -- `command-service.ts` is not modified.
 *
 * --- car.hard_constraints is deliberately resolved deterministically, not
 * through the Graph ---
 *
 * `car.hard_constraints` is not one of the six Graph nodes (strands-
 * runtime.md "Orchestration" topology only names the four parallel
 * specialists, `source-challenger`, and `decision-synthesizer`). Every
 * candidate shares the identical AWD/adaptive-cruise/blind-spot/forward-
 * collision/LATCH standard features (`packages/scenarios/fixtures/car-
 * purchase/candidate-listings.json`), so the household's maximum-budget rule
 * against each candidate's true out-the-door price is the only
 * discriminating fact -- a plain deterministic filter this engine computes
 * directly, once the final normalized prices are known (after round 2),
 * matching docs/engineering-principles.md's "the deterministic core, not an LLM, owns ...
 * readiness."
 */
import {
  advanceObligation,
  deriveObligations,
  evaluateReadiness,
  recordObligationAttempt,
  type CaseExtensionObligationTemplate,
  type Clock,
  type IdGenerator,
} from '@sift/core';
import {
  createCapabilityCatalog,
  compileCarPurchasePack,
  CAR_PURCHASE_MANIFEST,
  PackRegistry,
} from '@sift/packs';
import type {
  CaseEvent,
  CaseState,
  Claim,
  CompiledDecisionPack,
  EvidenceLink,
  ExecutionRequest,
  ExecutionResult,
  ObligationTemplate,
  Source,
} from '@sift/contracts';
import {
  buildCarPurchaseSeedEvents,
  emptyScenarioTrajectory,
  publisherForFixtureSource as publisherFor,
  type ScenarioTrajectory,
} from '@sift/scenarios';
import { CommandService } from '../services/command-service.js';
import { InMemoryActivityStore, type ActivityStore } from '../store/activity-store.js';
import type { CaseStore } from '../store/case-store.js';
import { MemoryCaseStore } from '../store/memory-case-store.js';
import { MemoryRunStore, RunService } from '../services/run-service.js';
import {
  CAR_PURCHASE_GRAPH_NODE_IDS,
  CAR_PURCHASE_PARALLEL_SPECIALIST_IDS,
  executeCarPurchaseGraph,
  type CarPurchaseGraphDeps,
  type CarPurchaseGraphResult,
} from './car-purchase-graph.js';
import {
  buildCarPurchaseScriptedProviders,
  REAR_FACING_SEAT_OBLIGATION_ID,
  scriptedModelFor,
  setScenarioBeat,
  type CarPurchaseScriptedProviders,
} from './scripted-beats/car-purchase.js';
import type { RuntimeEvent } from './event-normalizer.js';
import { deriveScoredRecommendationFields, mergeLimitations } from './recommendation-scoring.js';

export interface CarPurchaseScenarioDeps {
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly skillsRootDir: string;
}

export interface CarPurchaseScenarioResult {
  readonly trajectory: ScenarioTrajectory;
  readonly caseId: string;
}

/**
 * Exported (not merely a scenario-file-local helper) so `car-purchase-
 * engine.ts` -- and `server.ts`'s real boot wiring -- can compile and
 * register the exact same real `car-purchase` `CompiledDecisionPack` this
 * scenario proves against, rather than duplicating this capability-catalog
 * construction a second time.
 */
export function carPurchaseCapabilityCatalog() {
  return createCapabilityCatalog([
    ...CAR_PURCHASE_MANIFEST.skills.map((skill) => ({
      id: skill.id,
      kind: 'skill' as const,
      version: '1.0.0',
    })),
    ...CAR_PURCHASE_MANIFEST.specialists.map((specialist) => ({
      id: specialist.id,
      kind: 'specialist' as const,
      version: '1.0.0',
    })),
    ...CAR_PURCHASE_MANIFEST.tools.map((tool) => ({
      id: tool.id,
      kind: 'tool' as const,
      version: '1.0.0',
    })),
  ]);
}

// --- Publisher labels for constructed Source records ---
//
// `publisherFor` (imported above, aliased from `@sift/scenarios`'s
// `publisherForFixtureSource`) used to be defined locally here. It moved
// down into `packages/scenarios/src/seeds.ts` so that package's own
// `buildCarPurchaseSources`/`buildHomeEnergySources` seed-time builders
// could reuse the SAME mapping `ensureSourcesExist` below already uses for
// its live-run backfill, without `packages/scenarios` importing from
// `apps/agent` (a layering inversion architecture.md forbids) and without a
// second, copy-pasted table drifting from this one. Re-exported here,
// unchanged, under its original name so every existing caller/test in this
// file (and `humanizeDecisionText` below) keeps working untouched. See
// `seeds.ts`'s own "Shared fixture Source publisher labels" section header
// for the full reasoning.
export { publisherFor };

/**
 * Ensures every `sourceId` an `ExecutionResult` cited has a matching
 * `Source` record in `caseState.sources`, via the real `CaseStore.
 * updateSelection` (the same non-event-sourced path `submitSource` uses).
 * Every constructed source is `verification: 'verified'` -- deterministic
 * fixture-mode sources are pre-vetted for this demo (docs/engineering-principles.md's "fixture
 * mode must execute the complete product" posture), which also makes E1-\>E2
 * evidence synthesis (`achievedEvidenceLevel`'s "one authoritative source"
 * rule, `@sift/core` `evidence.ts`) deterministic and independent of whether
 * two sources happen to share a publisher (a dealer's own listing and its
 * own written offer genuinely are not independent sources in the "two
 * independent sources" sense, even though they are two distinct documents).
 */
export function ensureSourcesExist(
  caseStore: CaseStore,
  caseId: string,
  expectedSequence: number,
  sourceIds: readonly string[],
  clock: Clock,
): void {
  const snapshot = caseStore.load(caseId);
  if (snapshot === undefined) {
    throw new Error(
      `car-purchase-scenario: case "${caseId}" not found while ensuring sources exist`,
    );
  }
  const known = new Set(snapshot.sources.map((source) => source.id));
  const now = clock.now();
  const newSources: Source[] = [];
  for (const sourceId of new Set(sourceIds)) {
    if (known.has(sourceId)) continue;
    newSources.push({
      id: sourceId,
      url: `https://fixtures.example.com/sources/${sourceId}`,
      // The human-readable publisher name, NOT the raw `sourceId`.
      // `RecommendationCard` renders `source.title` as the citation link's
      // visible text, so `title: sourceId` put internal ids like
      // "source-national-crash-safety-consortium" directly in front of the
      // user under "Sources" -- change-set §34 / DoD item 34. Found by
      // reading a regenerated 430px baseline, after the same leak had
      // already been closed in `rationale`/`limitations`: the citation list
      // was a third surface nobody had checked.
      title: publisherFor(sourceId),
      publisher: publisherFor(sourceId),
      retrievedAt: now,
      origin: 'fixture',
      verification: 'verified',
      createdAt: now,
    });
  }
  if (newSources.length === 0) return;
  const result = caseStore.updateSelection(
    caseId,
    { sources: [...snapshot.sources, ...newSources] },
    expectedSequence,
    now,
  );
  if (result.status !== 'applied') {
    throw new Error(
      `car-purchase-scenario: failed to record sources for case "${caseId}": status "${result.status}"`,
    );
  }
}

/** Reloads `caseId`'s latest snapshot, throwing if it has somehow disappeared. Used after a batch of writes (a loop of `foldExecutionResult` calls, `ensureSourcesExist`) where re-reading the freshest state once, rather than threading a per-call return value through, keeps the caller's own `snapshot` variable a single, always-current source of truth. */
export function loadSnapshotOrThrow(caseStore: CaseStore, caseId: string): CaseState {
  const snapshot = caseStore.load(caseId);
  if (snapshot === undefined) {
    throw new Error(`car-purchase-scenario: case "${caseId}" unexpectedly disappeared`);
  }
  return snapshot;
}

/**
 * Captures the real `CaseEvent`s a just-completed `CommandService`/
 * `RunService` call appended internally (`focusOption`/`updateCriteria`/
 * `defineCaseAttribute`/`reviewCaseExtension`/`reviewProposal`, ...), via
 * the real `CaseStore.subscribe` replay -- the same mechanism a real SSE
 * client uses to catch up. `CommandReceipt`'s public surface only exposes
 * the resulting `CaseState` snapshot, never the individual events that
 * produced it, so this is the one legitimate way to recover them without
 * reaching into `CommandService`'s private internals.
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

export interface FoldOptions {
  /** How many attempts to record against `obligationId` before recomputing its status. */
  attemptsToRecord: number;
  /** Overrides which obligationId the evidence/claims attach to (used to route household-fit-analyst's round-2 findings to the new rear-facing-seat obligation instead of the pack's `car.household_fit`). */
  obligationIdOverride?: string;
}

/**
 * Folds one specialist's validated `ExecutionResult` into real canonical
 * `CaseEvent`s: ensures matching `Source` records exist, appends one
 * `evidence.accepted` event per evidence item (pairing a `Claim` in when
 * index-aligned), records the given number of obligation attempts, then
 * recomputes and (if changed) appends the obligation's new status via
 * `obligation.updated` -- mirroring strands-runtime.md's engine loop
 * ("validate structured result; append evidence and activity events;
 * recompute readiness") using the real `@sift/core` functions that own each
 * rule.
 */
export function foldExecutionResult(
  caseStore: CaseStore,
  activityStore: ActivityStore,
  caseId: string,
  result: ExecutionResult,
  deps: CarPurchaseScenarioDeps,
  trajectory: ScenarioTrajectory,
  options: FoldOptions,
): CaseState {
  let snapshot = caseStore.load(caseId);
  if (snapshot === undefined) {
    throw new Error(
      `car-purchase-scenario: case "${caseId}" not found while folding an ExecutionResult`,
    );
  }
  const obligationId = options.obligationIdOverride ?? result.obligationId;
  const now = deps.clock.now();

  const allSourceIds = [
    ...result.evidenceResults.map((item) => item.sourceId),
    ...result.claims.flatMap((claim) => claim.sourceIds),
  ];
  ensureSourcesExist(caseStore, caseId, snapshot.eventSequence, allSourceIds, deps.clock);

  const events: CaseEvent[] = [];
  let sequence = snapshot.eventSequence;
  result.evidenceResults.forEach((item, index) => {
    sequence += 1;
    const evidenceLink: EvidenceLink = {
      id: deps.idGenerator.next('ev'),
      obligationId,
      sourceId: item.sourceId,
      level: item.level,
      verdict: item.verdict,
      disposition: 'included',
      summary: item.summary,
      stale: false,
      createdAt: now,
      updatedAt: now,
    };
    const claimSource = result.claims[index];
    let claim: Claim | undefined;
    if (claimSource !== undefined) {
      claim = {
        id: deps.idGenerator.next('claim'),
        obligationId,
        statement: claimSource.statement,
        stance: claimSource.stance,
        confidence: claimSource.confidence,
        sourceIds: [...claimSource.sourceIds],
        stale: false,
        createdAt: now,
      };
      trajectory.claims.push({ claimId: claim.id, sourceIds: claim.sourceIds });
    }
    events.push({
      eventId: deps.idGenerator.next('event'),
      caseId,
      sequence,
      timestamp: now,
      type: 'evidence.accepted',
      payload: { evidenceLink, ...(claim !== undefined ? { claim } : {}) },
    });
  });

  if (events.length > 0) {
    const result_ = caseStore.append(caseId, events, snapshot.eventSequence);
    if (result_.status !== 'applied') {
      throw new Error(
        `car-purchase-scenario: failed to append evidence for obligation "${obligationId}": status "${result_.status}"`,
      );
    }
    trajectory.caseEvents.push(...events);
    snapshot = result_.snapshot;
    activityStore.append({
      timestamp: now,
      caseId,
      obligationId,
      type: 'evidence.accepted',
      phase: 'completed',
      summary: `Recorded ${events.length} evidence item(s) for obligation "${obligationId}".`,
    });
  }

  for (let i = 0; i < options.attemptsToRecord; i++) {
    const obligation = snapshot.obligations.find((entry) => entry.id === obligationId);
    if (obligation === undefined) {
      throw new Error(
        `car-purchase-scenario: obligation "${obligationId}" not found on case "${caseId}"`,
      );
    }
    const advanced = recordObligationAttempt(obligation, deps.clock);
    const attemptEvent: CaseEvent = {
      eventId: deps.idGenerator.next('event'),
      caseId,
      sequence: snapshot.eventSequence + 1,
      timestamp: deps.clock.now(),
      type: 'obligation.updated',
      payload: { obligation: advanced },
    };
    const appended = caseStore.append(caseId, [attemptEvent], snapshot.eventSequence);
    if (appended.status !== 'applied') {
      throw new Error(`car-purchase-scenario: failed to record an attempt for "${obligationId}"`);
    }
    trajectory.caseEvents.push(attemptEvent);
    snapshot = appended.snapshot;
  }

  const obligationNow = snapshot.obligations.find((entry) => entry.id === obligationId);
  if (obligationNow === undefined) {
    throw new Error(
      `car-purchase-scenario: obligation "${obligationId}" not found on case "${caseId}"`,
    );
  }
  const nextObligation = advanceObligation(
    obligationNow,
    { claims: snapshot.claims, evidenceLinks: snapshot.evidenceLinks, sources: snapshot.sources },
    deps.clock,
  );
  if (nextObligation.status !== obligationNow.status) {
    const advanceEvent: CaseEvent = {
      eventId: deps.idGenerator.next('event'),
      caseId,
      sequence: snapshot.eventSequence + 1,
      timestamp: deps.clock.now(),
      type: 'obligation.updated',
      payload: { obligation: nextObligation },
    };
    const appended = caseStore.append(caseId, [advanceEvent], snapshot.eventSequence);
    if (appended.status !== 'applied') {
      throw new Error(`car-purchase-scenario: failed to advance obligation "${obligationId}"`);
    }
    trajectory.caseEvents.push(advanceEvent);
    snapshot = appended.snapshot;
    activityStore.append({
      timestamp: deps.clock.now(),
      caseId,
      obligationId,
      type: 'obligation.updated',
      phase: 'completed',
      summary: `Obligation "${obligationId}" is now "${nextObligation.status}".`,
    });
  }

  return snapshot;
}

export function buildExecutionRequestFor(
  caseState: CaseState,
  pack: CompiledDecisionPack,
  obligationId: string,
): ExecutionRequest {
  const obligation = caseState.obligations.find((entry) => entry.id === obligationId);
  if (obligation === undefined) {
    throw new Error(`car-purchase-scenario: obligation "${obligationId}" not found`);
  }
  const readiness = evaluateReadiness(caseState);
  return {
    runId: `run-${obligationId}`,
    caseId: caseState.id,
    pack: { id: pack.identity.id, version: pack.identity.version, compiledHash: pack.compiledHash },
    obligation,
    caseSummary: {
      caseId: caseState.id,
      title: caseState.title,
      status: caseState.status,
      criteria: caseState.criteria,
      optionSummaries: caseState.entities.map((entity) => ({
        id: entity.id,
        label: entity.label,
        kind: entity.kind,
      })),
      evidenceCounts: {
        satisfied: readiness.satisfied.length,
        active: readiness.active.length,
        blocked: readiness.blocked.length,
        acceptedUncertainty: readiness.acceptedUncertainty.length,
        open: readiness.open.length,
      },
    },
    caseExtensions: caseState.caseExtensions.map((extension) => ({
      id: extension.definition.id,
      label: extension.definition.label,
      valueType: extension.definition.valueType,
      reason: extension.definition.reason,
      origin: extension.definition.origin,
      confirmation: extension.definition.confirmation,
    })),
    availableSkills: [...pack.skills.map((skill) => skill.id)],
    availableSpecialists: [...pack.specialists.map((specialist) => specialist.id)],
    allowedTools: [...pack.tools.map((tool) => tool.id)],
    priorAttempts: [],
    limits: {
      maxAttemptsPerObligation: obligation.maxAttempts,
      maxToolCallsPerRun: 12,
      maxGraphNodeExecutionsPerRun: pack.orchestration.maxSteps,
      modelRequestTimeoutMs: pack.orchestration.nodeTimeoutMs,
      totalRunTimeoutMs: pack.orchestration.totalTimeoutMs,
    },
  };
}

const SPECIALIST_OBLIGATION_ID: Record<
  (typeof CAR_PURCHASE_PARALLEL_SPECIALIST_IDS)[number],
  string
> = {
  'deal-analyst': 'car.deal_normalization',
  'ownership-cost-analyst': 'car.ownership_cost',
  'safety-reliability-analyst': 'car.safety_reliability',
  'household-fit-analyst': 'car.household_fit',
};

/**
 * Exported (not merely a scenario-file-local helper) so its per-event-shape
 * defensive branches (a malformed/partial `RuntimeEvent` attribute -- a
 * non-string `skillId`/`toolName`/`nodeId`, a missing `obligationId`, a
 * `fields`/`handler` of the wrong shape) can be unit-tested directly against
 * a small synthetic event stream, the same way `foldExecutionResult`/
 * `ensureSourcesExist` are exported for isolated testing above. These shapes
 * are never actually produced by the real, fully-scripted two-round Graph
 * run this file drives (`event-normalizer.ts` always supplies a well-formed
 * `skillId`/`toolName`/`nodeId`/`obligationId` for every real event it
 * emits), so a synthetic stream is the only way to exercise this real
 * defensive parsing without invasively reshaping the real Strands Graph's
 * own output.
 */
export async function drainGraph(
  gen: AsyncGenerator<RuntimeEvent, CarPurchaseGraphResult, undefined>,
  trajectory: ScenarioTrajectory,
): Promise<CarPurchaseGraphResult> {
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
          fields: fields.filter((f): f is string => typeof f === 'string'),
        });
      }
    }
    if (event.category === 'intervention') {
      const handler = event.attributes['handler'];
      const action = event.name.replace('intervention.', '');
      if (
        typeof handler === 'string' &&
        ['proceed', 'guide', 'confirm', 'deny', 'transform'].includes(action)
      ) {
        if (action === 'guide' || action === 'confirm' || action === 'deny') {
          trajectory.interventions.push({ action, handler });
        }
      }
    }
    if (event.category === 'tool' && event.phase === 'finish') {
      const toolId = event.attributes['toolName'];
      if (typeof toolId === 'string') {
        trajectory.toolCalls.push({ toolId });
      }
    }
    if (event.category === 'graph' && event.phase === 'finish') {
      const nodeId = event.attributes['nodeId'];
      if (typeof nodeId === 'string' && !trajectory.graphNodes.includes(nodeId)) {
        trajectory.graphNodes.push(nodeId);
        if ((CAR_PURCHASE_GRAPH_NODE_IDS as readonly string[]).includes(nodeId)) {
          trajectory.specialistsInvoked.push(nodeId);
        }
      }
    }
    next = await gen.next();
  }
  return next.value;
}

/**
 * Exported so `car-purchase-engine.ts` can build the same real
 * `CarPurchaseGraphDeps` this scenario builds, from a live case snapshot
 * instead of this file's own in-process seeded one -- see this file's own
 * "genuinely reuse... by importing" instruction in the live-engine task that
 * added this export.
 */
export function buildGraphDeps(
  caseState: CaseState,
  pack: CompiledDecisionPack,
  providers: CarPurchaseScriptedProviders,
  deps: CarPurchaseScenarioDeps,
): CarPurchaseGraphDeps {
  const specialistRequests = Object.fromEntries(
    CAR_PURCHASE_PARALLEL_SPECIALIST_IDS.map((specialistId) => [
      specialistId,
      buildExecutionRequestFor(caseState, pack, SPECIALIST_OBLIGATION_ID[specialistId]),
    ]),
  ) as CarPurchaseGraphDeps['specialistRequests'];

  return {
    pack,
    modelFor: scriptedModelFor(providers),
    skillsRootDir: deps.skillsRootDir,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    specialistRequests,
    shortlistRequest: buildExecutionRequestFor(caseState, pack, 'car.shortlist'),
    resolveConfirmation: () => true,
  };
}

/**
 * The household's own grade scale for `custom.rear_facing_seat_behind_driver`,
 * WORST FIRST, per `AttributeDefinition.orderedValues`'s contract
 * (`@sift/contracts` attributes.ts): the field supplies the SCALE, the
 * attribute's `comparison: 'higher_better'` supplies the DIRECTION. Three
 * grades rather than a boolean because "fits, but only once you give up
 * driver legroom" is a genuinely different answer from either yes or no, and
 * collapsing it into a boolean is exactly the kind of invented certainty this
 * product exists to refuse.
 *
 * Shared by the attribute definition and its criterion so the two can never
 * drift apart into a column that renders but cannot be scored.
 */
export const REAR_FACING_SEAT_GRADES = [
  'Driver seat must move forward',
  'Fits with driver seat back',
  'Fits with room to spare',
] as const;

/** Synthesizes the `case_extension`-origin `ObligationTemplate` for `custom.rear_facing_seat_behind_driver`, per pack-authoring.md's "userConcern template" pattern (`command-service.ts`'s own documented gap -- see module header). */
export function rearFacingSeatObligationTemplate(): ObligationTemplate {
  return {
    id: REAR_FACING_SEAT_OBLIGATION_ID,
    label: 'Rear-facing seat fits behind the driver',
    question:
      "Does a rear-facing seat fit behind the driver without moving the driver's seat forward?",
    category: 'user_concern',
    required: true,
    priority: 65,
    requiredEvidenceLevel: 'E1',
    maxAttempts: 2,
    acceptedUncertaintyAllowed: true,
    dependsOn: [],
    preferredSkills: ['household-fit'],
    preferredSpecialists: ['household-fit-analyst'],
    completionRule: {
      minimumEvidenceLevel: 'E1',
      minimumIndependentSources: 1,
      acceptedUncertaintyAllowed: true,
    },
    origin: 'case_extension',
  };
}

/**
 * Runs the complete, real car-purchase demo trajectory
 * (docs/specs/demos-and-submission.md "Required sequence") in process:
 * seeds the case, runs the real six-node Graph twice, drives every real
 * command in between, and returns the accumulated `ScenarioTrajectory` plus
 * final `caseId` for assertion checking.
 */
export async function runCarPurchaseScenario(
  deps: CarPurchaseScenarioDeps,
): Promise<CarPurchaseScenarioResult> {
  const trajectory = emptyScenarioTrajectory();
  const pack = compileCarPurchasePack(carPurchaseCapabilityCatalog(), deps.clock);
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
  });
  const runService = new RunService({
    caseStore,
    activityStore,
    runStore: new MemoryRunStore(),
    clock: deps.clock,
    idGenerator: deps.idGenerator,
  });

  // --- 1. Seed: instantiateCase + option.upserted x4 (seeds.ts) ---
  const seed = buildCarPurchaseSeedEvents({
    pack,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
  });
  const seedResult = caseStore.append(seed.caseState.id, seed.events, 0, {
    seedSnapshot: seed.caseState,
  });
  if (seedResult.status !== 'applied') {
    throw new Error(`car-purchase-scenario: failed to seed case: status "${seedResult.status}"`);
  }
  trajectory.caseEvents.push(...seed.events);
  trajectory.packSelections.push({
    packId: seed.caseState.pack.id,
    reasons: seed.caseState.pack.reasons,
  });
  const caseId = seed.caseState.id;
  let snapshot = seedResult.snapshot;

  // Every candidate's real label (§34: `Recommendation.rationale`/
  // `limitations` must read "2022 Toyota RAV4 XLE Hybrid AWD", never the
  // raw "candidate-rav4" id) -- built once, since seeding is the only place
  // these entities' labels are ever set.
  const candidateLabels = entityLabelsById(snapshot.entities);

  // --- 2/3/4. Round 1: the real six-node Graph, initially favoring candidate-rav4 ---
  const providers = buildCarPurchaseScriptedProviders();
  setScenarioBeat(providers, 'round1');
  const round1Result = await drainGraph(
    executeCarPurchaseGraph(buildGraphDeps(snapshot, pack, providers, deps)),
    trajectory,
  );

  for (const specialistId of CAR_PURCHASE_PARALLEL_SPECIALIST_IDS) {
    const result = round1Result.executionResults[specialistId];
    if (result === undefined) {
      throw new Error(
        `car-purchase-scenario: round1 produced no ExecutionResult for "${specialistId}"`,
      );
    }
    const attemptsToRecord =
      specialistId === 'safety-reliability-analyst'
        ? 3
        : specialistId === 'household-fit-analyst'
          ? 2
          : 1;
    foldExecutionResult(caseStore, activityStore, caseId, result, deps, trajectory, {
      attemptsToRecord,
    });
  }
  const challengeRound1 = round1Result.executionResults['source-challenger'];
  if (challengeRound1 === undefined) {
    throw new Error(
      'car-purchase-scenario: round1 produced no ExecutionResult for source-challenger',
    );
  }
  // source-challenger corroborates/reviews car.deal_normalization's own
  // evidence rather than making its own attempt at the obligation --
  // deal-analyst is the one whose attempt budget this obligation tracks.
  snapshot = foldExecutionResult(
    caseStore,
    activityStore,
    caseId,
    challengeRound1,
    deps,
    trajectory,
    {
      attemptsToRecord: 0,
    },
  );

  // --- Round 1 recommendation: candidate-rav4, a soft initial lean (no DecisionProposal yet) ---
  if (round1Result.proposedRecommendation === undefined) {
    throw new Error(
      'car-purchase-scenario: round1 decision-synthesizer never called propose_recommendation',
    );
  }
  ensureSourcesExist(
    caseStore,
    caseId,
    snapshot.eventSequence,
    extractCitedSourceIds(round1Result.decisionSynthesizerText),
    deps.clock,
  );
  snapshot = loadSnapshotOrThrow(caseStore, caseId);
  const recommendation1Id = deps.idGenerator.next('rec');
  // The model proposed the favorite; the deterministic scoreboard supplies
  // the numbers attached to it. See recommendation-scoring.ts for why a
  // disagreement is stated rather than resolved in either direction.
  const scoredRound1 = deriveScoredRecommendationFields(
    snapshot,
    round1Result.proposedRecommendation.candidateIds[0] ?? null,
  );
  const recommendation1Event: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'recommendation.ready',
    payload: {
      recommendation: {
        id: recommendation1Id,
        status: 'ready',
        favoredOptionId: round1Result.proposedRecommendation.candidateIds[0] ?? null,
        rationale: humanizeDecisionText(round1Result.decisionSynthesizerText, candidateLabels),
        facts: scoredRound1.facts,
        hypotheses: [],
        confidence: scoredRound1.confidence,
        limitations: [
          humanizeDecisionText(
            "candidate-rav4's deal terms are still under review.",
            candidateLabels,
          ),
        ],
        sourceIds: extractCitedSourceIds(round1Result.decisionSynthesizerText),
        resolvedObligationIds: [],
        acceptedUncertaintyObligationIds: [],
        generatedAt: deps.clock.now(),
      },
    },
  };
  const rec1Append = caseStore.append(caseId, [recommendation1Event], snapshot.eventSequence);
  if (rec1Append.status !== 'applied') {
    throw new Error('car-purchase-scenario: failed to record the round1 recommendation');
  }
  trajectory.caseEvents.push(recommendation1Event);
  snapshot = rec1Append.snapshot;

  // --- 5. The user selects candidate-rav4 ---
  const focusResult = commandService.focusOption(deps.idGenerator.next('cmd'), {
    caseId,
    optionId: 'candidate-rav4',
    expectedSequence: snapshot.eventSequence,
  });
  if (focusResult.status !== 'ok') {
    throw new Error(
      `car-purchase-scenario: focusOption(candidate-rav4) failed: ${focusResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: 'focus_option:candidate-rav4' });
  snapshot = focusResult.value.snapshot ?? snapshot;

  // --- 6. WebMCP: sift_get_case_context (read-only; selection already matches) then sift_request_investigation ---
  const contextSnapshot = caseStore.load(caseId);
  if (contextSnapshot?.selectedOptionId !== 'candidate-rav4') {
    throw new Error('car-purchase-scenario: WebMCP case context does not match the page selection');
  }
  const investigationResult = runService.requestInvestigation(deps.idGenerator.next('cmd'), {
    caseId,
    obligationId: 'car.deal_normalization',
    expectedSequence: snapshot.eventSequence,
  });
  if (investigationResult.status !== 'ok') {
    throw new Error(
      `car-purchase-scenario: requestInvestigation failed: ${investigationResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: 'request_investigation:car.deal_normalization' });

  // --- 8. "Driving comfort matters more than fuel economy" -> sift_update_criteria ---
  const beforeComfort = snapshot.eventSequence;
  const comfortResult = commandService.updateCriteria(deps.idGenerator.next('cmd'), {
    caseId,
    expectedSequence: snapshot.eventSequence,
    operations: [
      { op: 'reweight', criterionId: 'pref.driving_comfort', weight: 25 },
      { op: 'reweight', criterionId: 'pref.ownership_cost', weight: 15 },
    ],
  });
  if (comfortResult.status !== 'ok' || comfortResult.value.snapshot === undefined) {
    throw new Error(
      `car-purchase-scenario: updateCriteria(comfort) failed: ${comfortResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: 'update_criteria:driving_comfort_over_fuel_economy' });
  captureNewEvents(caseStore, caseId, beforeComfort, trajectory);
  snapshot = comfortResult.value.snapshot;

  // --- 9. A rear-facing car seat behind the driver -> sift_define_case_attribute + sift_update_criteria ---
  //
  // The column is declared with its full ordered grade scale but WITHOUT
  // per-candidate `values`. That is the point of this concern rather than an
  // omission: nobody publishes rear-facing-seat clearance, so no specialist
  // and no source in this fixture can establish it, and the scenario proves
  // the honest-unknown path -- the criterion carries real weight, every
  // candidate stays `unknown`, and the score reports the gap instead of
  // filling it. `orderedValues` still has to be here: without it
  // `scoreCase` refuses to treat the enum as ordinal (packages/core
  // `scoring.ts`), so a run that later DOES answer the question (the live
  // WebMCP demo does, in one `sift_define_case_attribute` call carrying
  // `values`) ranks against the same declared scale this case already pins.
  const beforeDefine = snapshot.eventSequence;
  const defineResult = commandService.defineCaseAttribute(
    deps.idGenerator.next('cmd'),
    {
      caseId,
      expectedSequence: snapshot.eventSequence,
      definition: {
        id: 'custom.rear_facing_seat_behind_driver',
        label: 'Rear-facing seat fits behind the driver',
        valueType: 'enum',
        appliesTo: ['candidate'],
        allowedValues: [...REAR_FACING_SEAT_GRADES],
        orderedValues: [...REAR_FACING_SEAT_GRADES],
        evidenceExpectation: 'verification',
        comparison: 'higher_better',
        reason:
          "A second child arrives in three months; a rear-facing seat has to go behind the driver without pushing the driver's seat forward. No manufacturer publishes this, so it is not derivable from specifications.",
      },
    },
    'agent_proposed',
  );
  if (defineResult.status !== 'ok' || defineResult.value.snapshot === undefined) {
    throw new Error(`car-purchase-scenario: defineCaseAttribute failed: ${defineResult.status}`);
  }
  captureNewEvents(caseStore, caseId, beforeDefine, trajectory);
  snapshot = defineResult.value.snapshot;
  const extension = snapshot.caseExtensions.find(
    (entry) => entry.definition.id === 'custom.rear_facing_seat_behind_driver',
  );
  if (extension === undefined) {
    throw new Error(
      'car-purchase-scenario: custom.rear_facing_seat_behind_driver extension was not created',
    );
  }
  trajectory.extensionsDefined.push({
    definitionId: extension.definition.id,
    origin: extension.definition.origin,
  });

  // Human confirms the agent-proposed concern through the visible UI.
  const beforeConfirm = snapshot.eventSequence;
  const confirmResult = commandService.reviewCaseExtension(deps.idGenerator.next('cmd'), {
    caseId,
    extensionId: extension.id,
    decision: 'confirm',
    expectedSequence: snapshot.eventSequence,
  });
  if (confirmResult.status !== 'ok' || confirmResult.value.snapshot === undefined) {
    throw new Error(`car-purchase-scenario: reviewCaseExtension failed: ${confirmResult.status}`);
  }
  trajectory.humanActions.push({
    action: 'confirm_case_extension:custom.rear_facing_seat_behind_driver',
  });
  captureNewEvents(caseStore, caseId, beforeConfirm, trajectory);
  snapshot = confirmResult.value.snapshot;

  const beforeCriteria2 = snapshot.eventSequence;
  const criteriaResult = commandService.updateCriteria(deps.idGenerator.next('cmd'), {
    caseId,
    expectedSequence: snapshot.eventSequence,
    operations: [
      {
        op: 'add',
        criterion: {
          id: 'custom.rear_facing_seat_behind_driver',
          label: 'Rear-facing seat fits behind the driver',
          kind: 'hard_constraint',
          weight: 20,
          direction: 'higher_better',
          appliesToAttribute: 'custom.rear_facing_seat_behind_driver',
          question:
            "Does a rear-facing seat fit behind the driver without moving the driver's seat forward?",
        },
      },
    ],
  });
  if (criteriaResult.status !== 'ok' || criteriaResult.value.snapshot === undefined) {
    throw new Error(
      `car-purchase-scenario: updateCriteria(rear-facing seat) failed: ${criteriaResult.status}`,
    );
  }
  trajectory.humanActions.push({
    action: 'update_criteria:add_custom.rear_facing_seat_behind_driver',
  });
  captureNewEvents(caseStore, caseId, beforeCriteria2, trajectory);
  snapshot = criteriaResult.value.snapshot;

  // Derive the case obligation the criterion needs (documented gap #2).
  const rearFacingSeatTemplate: CaseExtensionObligationTemplate = {
    template: rearFacingSeatObligationTemplate(),
    criterionId: 'custom.rear_facing_seat_behind_driver',
  };
  const nextObligations = deriveObligations(
    pack,
    [rearFacingSeatTemplate],
    snapshot.obligations,
    deps.clock,
  );
  const rearFacingSeatObligation = nextObligations.find(
    (entry) => entry.id === REAR_FACING_SEAT_OBLIGATION_ID,
  );
  if (rearFacingSeatObligation === undefined) {
    throw new Error(
      'car-purchase-scenario: failed to derive the custom.rear_facing_seat_behind_driver obligation',
    );
  }
  const obligationEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'obligation.updated',
    payload: { obligation: rearFacingSeatObligation },
  };
  const obligationAppend = caseStore.append(caseId, [obligationEvent], snapshot.eventSequence);
  if (obligationAppend.status !== 'applied') {
    throw new Error(
      'car-purchase-scenario: failed to append the custom.rear_facing_seat_behind_driver obligation',
    );
  }
  trajectory.caseEvents.push(obligationEvent);
  trajectory.obligationsCreated.push({
    obligationId: REAR_FACING_SEAT_OBLIGATION_ID,
    criterionId: 'custom.rear_facing_seat_behind_driver',
  });
  snapshot = obligationAppend.snapshot;

  // Link the extension back to its criterion/obligation (extensions.ts's own
  // documented pattern). Re-fetch from the latest snapshot rather than
  // reusing the `extension` captured before `reviewCaseExtension` --
  // spreading the stale (still-`pending`) object here would silently
  // overwrite the human's confirmation back to `pending`.
  const confirmedExtension = snapshot.caseExtensions.find((entry) => entry.id === extension.id);
  if (confirmedExtension === undefined) {
    throw new Error(
      'car-purchase-scenario: confirmed custom.rear_facing_seat_behind_driver extension went missing',
    );
  }
  const linkedExtension = {
    ...confirmedExtension,
    linkedCriterionId: 'custom.rear_facing_seat_behind_driver',
    linkedObligationId: REAR_FACING_SEAT_OBLIGATION_ID,
  };
  const linkEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'extension.defined',
    payload: { extension: linkedExtension },
  };
  const linkAppend = caseStore.append(caseId, [linkEvent], snapshot.eventSequence);
  if (linkAppend.status !== 'applied') {
    throw new Error(
      'car-purchase-scenario: failed to link the custom.rear_facing_seat_behind_driver extension',
    );
  }
  trajectory.caseEvents.push(linkEvent);
  snapshot = linkAppend.snapshot;

  // --- Round 2: the real six-node Graph again, revising the favorite to candidate-crv ---
  setScenarioBeat(providers, 'round2');
  const round2Result = await drainGraph(
    executeCarPurchaseGraph(buildGraphDeps(snapshot, pack, providers, deps)),
    trajectory,
  );

  const dealRound2 = round2Result.executionResults['deal-analyst'];
  if (dealRound2 === undefined) {
    throw new Error('car-purchase-scenario: round2 produced no ExecutionResult for deal-analyst');
  }
  // Supersede the stale round-1 teaser-price evidence link before folding
  // round2's clean, final normalized comparison -- "Conflicting evidence
  // becomes stale" (testing.md traceability matrix).
  // Round 1 produced two non-stale degraded links citing this source (one
  // from deal-analyst's own investigation, one from source-challenger's
  // review of it) -- every one of them must be superseded, not just the
  // first found, or a leftover non-stale degraded link would keep
  // fail-closed blocking `car.deal_normalization` forever.
  const staleLinks = snapshot.evidenceLinks.filter(
    (link) => link.sourceId === 'source-dealer-offer-candidate-rav4' && !link.stale,
  );
  if (staleLinks.length === 0) {
    throw new Error(
      'car-purchase-scenario: expected the round1 teaser-price evidence link(s) to still exist',
    );
  }
  const markStaleEvents: CaseEvent[] = staleLinks.map((link, index) => ({
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1 + index,
    timestamp: deps.clock.now(),
    type: 'evidence.conflicted',
    payload: {
      evidenceLink: { ...link, stale: true, updatedAt: deps.clock.now() },
      conflictingEvidenceIds: [],
    },
  }));
  const staleAppend = caseStore.append(caseId, markStaleEvents, snapshot.eventSequence);
  if (staleAppend.status !== 'applied') {
    throw new Error('car-purchase-scenario: failed to mark the round1 teaser-price evidence stale');
  }
  trajectory.caseEvents.push(...markStaleEvents);
  trajectory.staleEvidenceIds.push(...staleLinks.map((link) => link.id));

  foldExecutionResult(caseStore, activityStore, caseId, dealRound2, deps, trajectory, {
    attemptsToRecord: 1,
  });

  const householdFitRound2 = round2Result.executionResults['household-fit-analyst'];
  if (householdFitRound2 === undefined) {
    throw new Error(
      'car-purchase-scenario: round2 produced no ExecutionResult for household-fit-analyst',
    );
  }
  foldExecutionResult(caseStore, activityStore, caseId, householdFitRound2, deps, trajectory, {
    attemptsToRecord: 2,
    obligationIdOverride: REAR_FACING_SEAT_OBLIGATION_ID,
  });

  const challengeRound2 = round2Result.executionResults['source-challenger'];
  if (challengeRound2 === undefined) {
    throw new Error(
      'car-purchase-scenario: round2 produced no ExecutionResult for source-challenger',
    );
  }
  foldExecutionResult(caseStore, activityStore, caseId, challengeRound2, deps, trajectory, {
    attemptsToRecord: 0,
  });
  snapshot = loadSnapshotOrThrow(caseStore, caseId);

  // --- car.hard_constraints: deterministic core-level resolution (see module header) ---
  const hardConstraintsSourceId = 'source-dealer-offer-candidate-rav4';
  ensureSourcesExist(
    caseStore,
    caseId,
    snapshot.eventSequence,
    [hardConstraintsSourceId],
    deps.clock,
  );
  snapshot = loadSnapshotOrThrow(caseStore, caseId);
  const hardConstraintsEvidence: EvidenceLink = {
    id: deps.idGenerator.next('ev'),
    obligationId: 'car.hard_constraints',
    sourceId: hardConstraintsSourceId,
    level: 'E1',
    verdict: 'pass',
    disposition: 'included',
    summary:
      'Every candidate meets the household feature requirements (AWD, adaptive cruise, blind-spot monitoring, forward collision warning, 2 LATCH anchors). candidate-crv, candidate-cx5, and candidate-outback meet the maximum-budget requirement; candidate-rav4 does not.',
    stale: false,
    createdAt: deps.clock.now(),
    updatedAt: deps.clock.now(),
  };
  const hcEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'evidence.accepted',
    payload: { evidenceLink: hardConstraintsEvidence },
  };
  const hcAppend = caseStore.append(caseId, [hcEvent], snapshot.eventSequence);
  if (hcAppend.status !== 'applied') {
    throw new Error('car-purchase-scenario: failed to record car.hard_constraints evidence');
  }
  trajectory.caseEvents.push(hcEvent);
  foldExecutionResult(
    caseStore,
    activityStore,
    caseId,
    {
      obligationId: 'car.hard_constraints',
      disposition: 'evidence_found',
      claims: [],
      evidenceResults: [],
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    deps,
    trajectory,
    { attemptsToRecord: 1 },
  );
  snapshot = loadSnapshotOrThrow(caseStore, caseId);

  // --- car.shortlist: synthesized, once every dependency has resolved ---
  if (round2Result.proposedRecommendation === undefined) {
    throw new Error(
      'car-purchase-scenario: round2 decision-synthesizer never called propose_recommendation',
    );
  }
  const shortlistSourceIds = extractCitedSourceIds(round2Result.decisionSynthesizerText);
  ensureSourcesExist(caseStore, caseId, snapshot.eventSequence, shortlistSourceIds, deps.clock);
  snapshot = foldExecutionResult(
    caseStore,
    activityStore,
    caseId,
    {
      obligationId: 'car.shortlist',
      disposition: 'evidence_found',
      claims: [
        {
          statement: round2Result.decisionSynthesizerText,
          stance: 'supports',
          confidence: 0.85,
          sourceIds: shortlistSourceIds,
        },
      ],
      evidenceResults: shortlistSourceIds.map((sourceId) => ({
        sourceId,
        level: 'E2' as const,
        verdict: 'pass' as const,
        summary: 'Cited in the final shortlist synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    deps,
    trajectory,
    { attemptsToRecord: 1 },
  );

  // --- Revised recommendation: candidate-crv (recommendation.invalidated already fired inside updateCriteria) ---
  // The model proposed the favorite; the deterministic scoreboard supplies
  // the numbers attached to it. See recommendation-scoring.ts for why a
  // disagreement is stated rather than resolved in either direction.
  const scoredRound2 = deriveScoredRecommendationFields(
    snapshot,
    round2Result.proposedRecommendation.candidateIds[0] ?? null,
  );
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
        favoredOptionId: round2Result.proposedRecommendation.candidateIds[0] ?? null,
        rationale: humanizeDecisionText(round2Result.decisionSynthesizerText, candidateLabels),
        facts: scoredRound2.facts,
        hypotheses: [],
        confidence: scoredRound2.confidence,
        // Two hand-written lines, merged AHEAD of the derived ones
        // (`mergeLimitations`). They stay hand-written here rather than
        // reusing `car-purchase-engine.ts`'s
        // `deriveUnestablishedAttributeLimitations`: that module already
        // imports this one (`buildGraphDeps`, `foldExecutionResult`,
        // `carPurchaseCapabilityCatalog`), so importing it back would make
        // the pair mutually recursive for the sake of two sentences. Both
        // lines below are true of this specific scripted run -- neither
        // question is answered anywhere in it, for any candidate -- and the
        // derived lines `scoredRound2.limitations` contributes state the
        // same gap in the scoreboard's own weight-aware vocabulary.
        limitations: mergeLimitations(
          [
            'Whether a rear-facing seat fits behind the driver remains unverified for every candidate -- it is a fit check in the car, not a published specification.',
            'Driving comfort remains unverified for every candidate.',
          ],
          scoredRound2.limitations,
        ),
        sourceIds: shortlistSourceIds,
        resolvedObligationIds: [
          'car.hard_constraints',
          'car.deal_normalization',
          'car.ownership_cost',
          'car.household_fit',
          REAR_FACING_SEAT_OBLIGATION_ID,
          'car.shortlist',
        ],
        acceptedUncertaintyObligationIds: ['car.safety_reliability'],
        generatedAt: deps.clock.now(),
      },
    },
  };
  const rec2Append = caseStore.append(caseId, [recommendation2Event], snapshot.eventSequence);
  if (rec2Append.status !== 'applied') {
    throw new Error('car-purchase-scenario: failed to record the round2 recommendation');
  }
  trajectory.caseEvents.push(recommendation2Event);
  snapshot = rec2Append.snapshot;

  // --- 12/13. Sift proposes advancing candidate-crv + candidate-outback; only a human may approve ---
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
    throw new Error('car-purchase-scenario: failed to create the decision proposal');
  }
  trajectory.caseEvents.push(proposalEvent);
  snapshot = proposalAppend.snapshot;

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
      `car-purchase-scenario: reviewProposal(approve) failed: ${reviewResult.status}`,
    );
  }
  trajectory.humanActions.push({ action: 'approve_proposal:candidate-crv+candidate-outback' });
  captureNewEvents(caseStore, caseId, beforeReview, trajectory);
  snapshot = reviewResult.value.snapshot;

  trajectory.finalCaseState = snapshot;
  return { trajectory, caseId };
}

/** Extracts every `source-...`-shaped id cited in a decision-synthesizer response, for building `Recommendation.sourceIds`. */
export function extractCitedSourceIds(text: string): string[] {
  const matches = text.match(/\bsource-[a-z0-9-]+\b/gi) ?? [];
  return [...new Set(matches.map((match) => match.toLowerCase()))];
}

// --- Consumer-safe rendering of decision-synthesizer text (§34, DoD item 34) ---
//
// `RecommendationCard.tsx` renders `Recommendation.rationale`/`limitations`
// verbatim to the consumer. A decision-synthesizer's raw text cites option
// and source ids literally (e.g. "candidate-rav4",
// "source-national-crash-safety-consortium") -- the same citation format
// `extractCitedSourceIds` above parses `sourceIds` out of -- so those ids
// must never reach the consumer directly. `humanizeDecisionText` below
// substitutes each cited id with the real label its own case record already
// carries, never a second hardcoded copy that could drift from it.

/** Maps every entity's own id to its own real `label` (e.g. `buildCarPurchaseCandidateEntities`'s `"${modelYear} ${make} ${model} ${trim}"`, or a `response_option`'s fixture-declared label), for `humanizeDecisionText` below. */
export function entityLabelsById(
  entities: readonly { readonly id: string; readonly label: string }[],
): ReadonlyMap<string, string> {
  return new Map(entities.map((entity) => [entity.id, entity.label]));
}

/**
 * Renders a decision-synthesizer's raw text into consumer-safe prose: every
 * cited `source-...` id is replaced by the real publisher name
 * `publisherFor` (and `ensureSourcesExist`, which uses the same function to
 * build the actual `Source.publisher` field) already resolves it to, and
 * every id in `labels` (typically from `entityLabelsById`) is replaced by
 * its own real label. Must run AFTER `extractCitedSourceIds` on the original
 * text -- humanizing removes the very tokens that function looks for.
 *
 * Source ids are substituted first and as whole tokens (the same greedy
 * `source-[a-z0-9-]+` match `extractCitedSourceIds` uses), so a source id
 * that embeds a candidate/option id as a substring (e.g.
 * "source-dealer-offer-candidate-rav4") is fully consumed before the bare
 * candidate-id substitution pass runs -- otherwise that pass would corrupt
 * the source id into a mangled fragment instead of the id being cleanly
 * replaced as one citation.
 */
export function humanizeDecisionText(text: string, labels: ReadonlyMap<string, string>): string {
  const withSourcesHumanized = text.replace(/\bsource-[a-z0-9-]+\b/gi, (match) =>
    publisherFor(match.toLowerCase()),
  );
  let result = withSourcesHumanized;
  for (const [id, label] of labels) {
    result = result.split(id).join(label);
  }
  return result;
}

/**
 * The bid-comparison and home-energy-guardian live engines' own §34 (DoD
 * item 34) strategy -- a sibling to `humanizeDecisionText` above, not a
 * duplicate. `bid-comparison-engine.ts`'s `foldBidComparisonRound1`/
 * `foldBidComparisonRound2`/`recordRecommendationAndProposal` and
 * `home-energy-engine.ts`'s `foldHomeEnergyRound1`/`foldHomeEnergyRound2`
 * already call `extractCitedSourceIds` (above) on a decision-synthesizer's
 * raw text to build `Recommendation.sourceIds` -- the data that already
 * renders, correctly, as its own citation chips beneath the rationale
 * (`RecommendationCard.tsx`). Rendering that same raw text a second time,
 * inline, cited every source twice: once as an unreadable machine id in
 * running prose (e.g. "per source-current-bill-household-demo-energy-01"),
 * once as a proper chip. Neither engine needs `humanizeDecisionText`'s
 * substitute-a-real-label treatment for its own response-option/bid ids --
 * both packs' scripted decision-synthesizer prose already names the winning
 * option/contractor in plain words, never its raw id (see
 * `bid-comparison-engine.ts`'s own header comment, difference 2) -- so only
 * the inline source citations need removing here, not id substitution.
 *
 * Both packs' `GoalLoop` validators genuinely require at least one
 * `source-...` citation to accept the synthesis, so every caller MUST call
 * `extractCitedSourceIds` (and build `evidenceResults`/`sourceIds`) from the
 * ORIGINAL, unstripped text first -- once a source id is stripped here it
 * can no longer be recovered from the stripped copy. This function is the
 * display-only half of that split; it never runs before validation or
 * extraction, only before rendering.
 *
 * Three citation shapes are stripped, covering both packs' real shipped
 * prose (`scripted-beats/bid-comparison.ts`'s `DECISION_TEXT_ROUND1`/
 * `DECISION_TEXT_ROUND2`, `scripted-beats/home-energy-guardian.ts`'s own):
 *  - bid-comparison's standalone parenthetical whose entire content is one
 *    source id -- `"... is $279,000.00 (source-bid-calculator-bid-cedar-
 *    adjusted-total), not ..."` -- the whole `" (source-...)"` span is
 *    removed;
 *  - bid-comparison's source id appended, comma-separated, inside a
 *    parenthetical that also carries other content -- `"($276,000.00,
 *    source-bid-calculator-bid-northgate-adjusted-total)"` -- only the
 *    `", source-..."` tail is removed, leaving `"($276,000.00)"` intact;
 *  - home-energy-guardian's bare, un-parenthesized citation clause --
 *    `"...before taking further action, per source-current-bill-household-
 *    demo-energy-01 and source-household-event-event-thermostat-failure-
 *    2026-07."` -- the whole `", per source-... [and/, source-...]*"` clause
 *    is removed, leaving the sentence's own period untouched.
 *
 * Also normalizes the literal `--` a scripted/model response uses for an em
 * dash into the real `—` character the rest of the product's prose uses
 * (e.g. `CaseInsightsPanel.tsx`'s "measured across 100% of the weight — none
 * of which you have set yet").
 */
export function stripInlineSourceCitations(text: string): string {
  return text
    .replace(/,\s*source-[a-z0-9-]+(?=\))/gi, '')
    .replace(/ \(source-[a-z0-9-]+\)/gi, '')
    .replace(/,\s*per\s+source-[a-z0-9-]+(?:\s*(?:,|and)\s*source-[a-z0-9-]+)*/gi, '')
    .replace(/ -- /g, ' — ');
}
