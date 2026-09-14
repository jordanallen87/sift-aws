/**
 * The real, live, asynchronously-triggered Strands adapter for the
 * `bid-comparison` pack -- this codebase's third live engine, and its
 * second Swarm-hero analog of `car-purchase-engine.ts` (the first being
 * `home-energy-engine.ts`, which this file mirrors structurally). Before
 * this file existed, `bid-comparison` was built, compiled-pack-tested, and
 * Swarm-tested (`bid-comparison-swarm.ts`/`scripted-beats/bid-comparison.ts`,
 * 462 green) but never wired into `server.ts`, so a real browser session
 * clicking a "Compare these bids" launcher card would 404 before a case
 * could even be created.
 *
 * `createBidComparisonEngine(deps).trigger(...)` is the one entry point,
 * mirroring `createHomeEnergyEngine`'s five responsibilities exactly:
 *
 *  1. determines whether this is `round1` or `round2` purely from the
 *     case's own current, real state (`determineBidComparisonRound` below);
 *  2. builds the real `BidComparisonSwarmDeps` for the six-node Swarm from
 *     the live case snapshot (`buildBidComparisonSwarmDepsFromCase` below);
 *  3. runs the real bounded `executeBidComparisonSwarm`, streaming every
 *     `RuntimeEvent` it yields into the real `ActivityStore` AS THE SWARM
 *     PROGRESSES (`drainSwarmToActivity` below) and, additively, into the
 *     real Runtime Inspector persistence path (`RuntimeEventStore`) --
 *     structurally the same two-destination fan-out `home-energy-engine.ts`'s
 *     own `drainSwarmToActivity` performs, but a genuinely parallel
 *     implementation here (not an import), for the identical documented
 *     reason that file's own header gives for not importing
 *     `car-purchase-engine.ts`'s version: each engine is a pack-specific,
 *     parallel implementation, not a shared module;
 *  4. folds every specialist's validated context/final synthesis into real
 *     `CaseEvent`s via `car-purchase-scenario.ts`'s own exported, fully
 *     generic `foldExecutionResult`/`ensureSourcesExist`/
 *     `loadSnapshotOrThrow`/`extractCitedSourceIds`/`buildExecutionRequestFor`
 *     helpers -- read-only imports, genuinely reused rather than
 *     copy-pasted;
 *  5. on completion, records the round's recommendation, and -- in BOTH
 *     rounds, unlike `home-energy-engine.ts`'s round-2-only proposal -- the
 *     pending award proposal whenever `decision-synthesizer` genuinely
 *     called `propose_award` (see "Two genuine differences from
 *     home-energy-engine.ts" below). Never auto-approved: `reviewProposal`
 *     is a separate command a human issues through the normal UI, wholly
 *     outside this engine;
 *  6. advances the run's `RunStore` status `running` -> `completed`, or
 *     `failed` with a real error activity event on any thrown error, via
 *     the identical last-resort `try`/`catch` shape `home-energy-engine.ts`
 *     uses so a run can never hang forever or vanish silently.
 *
 * --- Round-1-vs-round-2 detection ---
 *
 * docs/bid-comparison/plan.md's round2 beat: "the household reweights
 * toward warranty length and payment risk (`bid.warranty` and
 * `bid.payment_risk` raised, `bid.adjusted_total` reduced accordingly)".
 * `determineBidComparisonRound` reads back exactly that durable fact from
 * case state: it calls the case `round2` once the combined weight of
 * `bid.warranty` + `bid.payment_risk` exceeds `bid.adjusted_total`'s own
 * weight -- the direct, persisted trace of that reweight, independent of
 * which caller performed it (visible UI control or a WebMCP
 * `sift_update_criteria` call). At the pack's shipped default weighting
 * (`ROUND1_CRITERIA_WEIGHTS`: adjustedTotal 45 / warranty 10 / paymentRisk
 * 15 -- warranty+paymentRisk = 25 < 45), this is `round1`. At
 * `ROUND2_CRITERIA_WEIGHTS` (adjustedTotal 15 / warranty 30 / paymentRisk
 * 40 -- warranty+paymentRisk = 70 > 15), this is `round2`. Combining the two
 * upweighted criteria (rather than comparing `bid.warranty` alone) is what
 * makes the rule track the reweight `scripted-beats/bid-comparison.ts`'s own
 * module header actually describes ("toward warranty length AND payment
 * risk"), not merely a `bid.warranty`-specific coincidence.
 *
 * --- Two genuine differences from home-energy-engine.ts, both real Swarm
 * facts, not stylistic choices ---
 *
 * 1. **The award proposal is not round-2-only.** `docs/bid-comparison/
 *    plan.md`'s own "Confirm" beat ("`decision-synthesizer` calls
 *    `propose_award` ... the required Confirm moment, reachable in this
 *    same round1 trajectory alongside Deny, Guide, and GoalLoop") means
 *    `propose_award` is genuinely called in round1 too
 *    (`scripted-beats/bid-comparison.ts`'s `buildDecisionSynthesizerProvider`
 *    calls it in both `round1` and `round2`). `foldBidComparisonRound1` and
 *    `foldBidComparisonRound2` therefore both check
 *    `BidComparisonSwarmResult.proposedAward` and create a pending
 *    `proposal.proposed` event whenever it is present -- there is no
 *    "round1 never proposes anything" branch the way
 *    `foldHomeEnergyRound1` has for `propose_inspection`.
 * 2. **The favored bid id comes from the tool call, not text-parsing.**
 *    `decision-synthesizer`'s scripted prose (`DECISION_TEXT_ROUND1`/
 *    `DECISION_TEXT_ROUND2`) names the winning CONTRACTOR ("Recommend
 *    awarding to Northgate Plumbing."), never the bid id
 *    ("bid-northgate") -- unlike `home-energy-guardian`'s decision text,
 *    which always names its response-option id in parentheses. Since
 *    `propose_award`'s own `bidId` input field IS the real, structured
 *    answer, both fold functions prefer
 *    `swarmResult.proposedAward?.bidId` and fall back to
 *    `extractFavoredBidId` (a contractor-name text scan against the case's
 *    own real seeded bid entities, never a hardcoded name list) only when
 *    no proposal was made.
 */
import type {
  CaseEvent,
  CaseState,
  CompiledDecisionPack,
  ExecutionResult,
  PublicActivityEvent,
  PublicActivityEventType,
  PublicActivityPhase,
} from '@sift/contracts';
import type { Clock, IdGenerator } from '@sift/core';
import { BID_COMPARISON_MANIFEST, createCapabilityCatalog, type PackRegistry } from '@sift/packs';
import { emptyScenarioTrajectory } from '@sift/scenarios';
import type { RunStatus } from '../db/schema.js';
import type { InvestigationEngine, RunStore } from '../services/run-service.js';
import type { ActivityStore } from '../store/activity-store.js';
import type { CaseStore } from '../store/case-store.js';
import type { RuntimeEventStore } from '../store/runtime-event-store.js';
import {
  buildExecutionRequestFor,
  ensureSourcesExist,
  extractCitedSourceIds,
  foldExecutionResult,
  loadSnapshotOrThrow,
  stripInlineSourceCitations,
} from './car-purchase-scenario.js';
// Re-exported so this file's own callers, and `bid-comparison-engine.test.ts`,
// keep importing it from here -- see `car-purchase-scenario.ts`'s
// `stripInlineSourceCitations` doc comment for why it now lives in the
// shared module both this file and `home-energy-engine.ts` import from,
// mirroring that same module's own `export { publisherFor };` re-export
// idiom just above `extractCitedSourceIds`.
export { stripInlineSourceCitations };
import {
  BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS,
  executeBidComparisonSwarm,
  type BidComparisonSequentialSpecialistId,
  type BidComparisonSwarmDeps,
  type BidComparisonSwarmNodeId,
  type BidComparisonSwarmResult,
} from './bid-comparison-swarm.js';
import { diffJsonValues, normalizeCaseStateChange, type RuntimeEvent } from './event-normalizer.js';
import { resolveModelProvider } from './model-provider.js';
import { deriveScoredRecommendationFields, mergeLimitations } from './recommendation-scoring.js';
import {
  buildBidComparisonSwarmScriptedProviders,
  scriptedModelFor,
  setScenarioBeat,
  type BidComparisonScenarioBeat,
  type BidComparisonSwarmScriptedProviders,
} from './scripted-beats/bid-comparison.js';

/**
 * Exported for the same reason `home-energy-engine.ts`'s
 * `homeEnergyCapabilityCatalog` is: `server.ts` needs to compile and
 * register the exact real `bid-comparison` `CompiledDecisionPack` this
 * engine runs against, without duplicating the catalog-construction logic
 * `bid-comparison-swarm.test.ts`'s own (test-local) equivalent already
 * proves.
 */
export function bidComparisonCapabilityCatalog() {
  return createCapabilityCatalog([
    ...BID_COMPARISON_MANIFEST.skills.map((skill) => ({
      id: skill.id,
      kind: 'skill' as const,
      version: '1.0.0',
    })),
    ...BID_COMPARISON_MANIFEST.specialists.map((specialist) => ({
      id: specialist.id,
      kind: 'specialist' as const,
      version: '1.0.0',
    })),
    ...BID_COMPARISON_MANIFEST.tools.map((tool) => ({
      id: tool.id,
      kind: 'tool' as const,
      version: '1.0.0',
    })),
  ]);
}

/**
 * Pure round detection from real case state. See this file's header
 * comment for the full reasoning. Exported for a fast, focused unit test
 * independent of running the real Swarm.
 */
export function determineBidComparisonRound(caseState: CaseState): BidComparisonScenarioBeat {
  const adjustedTotal = caseState.criteria.find(
    (criterion) => criterion.id === 'bid.adjusted_total',
  );
  const warranty = caseState.criteria.find((criterion) => criterion.id === 'bid.warranty');
  const paymentRisk = caseState.criteria.find((criterion) => criterion.id === 'bid.payment_risk');
  if (adjustedTotal === undefined || warranty === undefined || paymentRisk === undefined) {
    return 'round1';
  }
  return warranty.weight + paymentRisk.weight > adjustedTotal.weight ? 'round2' : 'round1';
}

export interface BidComparisonEngineDeps {
  readonly caseStore: CaseStore;
  readonly activityStore: ActivityStore;
  readonly runStore: RunStore;
  readonly runtimeEventStore: RuntimeEventStore;
  readonly registry: PackRegistry;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly skillsRootDir: string;
  /** Optional demo pacing in ms per scripted model turn. Omitted/0 everywhere except a deliberate recording session -- see `ScriptedModelProvider.turnDelayMs`. */
  readonly demoPacingMs?: number;
  /**
   * Mirrors `SiftConfig.liveSwarmEnabled` (config.ts) exactly -- see that
   * field's doc comment for why this must stay opt-in. When `true`,
   * `buildBidComparisonSwarmDepsFromCase` gives every Swarm node
   * (`modelId`/`awsRegion` below) a real model instead of the deterministic
   * `scriptedModelFor` fixtures. Omitted/`false` everywhere except a
   * deliberate live run.
   */
  readonly liveSwarmEnabled?: boolean;
  /** `SIFT_MODEL_ID` -- only read when `liveSwarmEnabled` is `true`. */
  readonly modelId?: string;
  /** `AWS_REGION` -- only read when `liveSwarmEnabled` is `true`. */
  readonly awsRegion?: string;
}

export interface BidComparisonEngine extends InvestigationEngine {
  /**
   * Fire-and-forget per `InvestigationEngine`, but returns the real
   * in-flight `Promise` -- production callers (`run-service.ts`) never
   * await it; tests may, to observe real completion deterministically. Two
   * triggers for the same `caseId` are serialized, mirroring
   * `HomeEnergyEngine.trigger`'s identical per-case queuing contract.
   */
  trigger(params: { caseId: string; runId: string; obligationId: string }): Promise<void>;
}

function appendActivity(
  activityStore: ActivityStore,
  clock: Clock,
  caseId: string,
  fields: {
    runId?: string;
    obligationId?: string;
    agentId?: string;
    /** The synthetic id of the exact correlated `runtime_events` row this activity event was derived from (I2). Omitted for engine-level bookkeeping events (`run.started`/`.completed`/`.failed`) that were never themselves one normalized `RuntimeEvent`. */
    debugEventId?: string;
    type: PublicActivityEventType;
    phase: PublicActivityPhase;
    summary: string;
    safeDetails?: NonNullable<PublicActivityEvent['safeDetails']>;
  },
): void {
  activityStore.append({
    timestamp: clock.now(),
    caseId,
    ...(fields.runId !== undefined ? { runId: fields.runId } : {}),
    ...(fields.obligationId !== undefined ? { obligationId: fields.obligationId } : {}),
    ...(fields.agentId !== undefined ? { agentId: fields.agentId } : {}),
    ...(fields.debugEventId !== undefined ? { debugEventId: fields.debugEventId } : {}),
    type: fields.type,
    phase: fields.phase,
    summary: fields.summary,
    ...(fields.safeDetails !== undefined ? { safeDetails: fields.safeDetails } : {}),
  });
}

/**
 * Translates one normalized `RuntimeEvent` from the live Swarm run into the
 * matching public `ActivityStore` event. Structurally identical to
 * `home-energy-engine.ts`'s own `appendActivityForSwarmEvent` -- see this
 * file's header comment for why it is a parallel implementation, not a
 * shared import. Both operate purely on the generic `RuntimeEvent`
 * (`event-normalizer.ts`), with nothing pack-specific in this function
 * itself.
 */
function appendActivityForSwarmEvent(
  event: RuntimeEvent,
  ctx: { caseId: string; runId: string },
  activityStore: ActivityStore,
  clock: Clock,
  /** The synthetic id `runtimeEventStore.append` minted for this exact `event` (I2). */
  debugEventId: string,
  /** Tool names this run has already denied, so the denied call's own error-status `AfterToolCall` is not republished as a tool failure. Owned by the drain loop: one set per run, mutated here as denials are seen. */
  deniedTools: Set<string>,
): void {
  const shared = {
    runId: ctx.runId,
    debugEventId,
    ...(event.obligationId !== undefined ? { obligationId: event.obligationId } : {}),
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
  };

  switch (event.category) {
    case 'swarm': {
      if (event.name === 'swarm.node_started') {
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'specialist.started',
          phase: 'active',
          summary: event.summary,
        });
      } else if (event.name === 'swarm.node_completed') {
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'specialist.completed',
          phase: 'completed',
          summary: event.summary,
          ...(event.durationMs !== undefined
            ? { safeDetails: { durationMs: event.durationMs } }
            : {}),
        });
      }
      return;
    }
    case 'skill': {
      appendActivity(activityStore, clock, ctx.caseId, {
        ...shared,
        type: 'skill.activated',
        phase: 'completed',
        summary: event.summary,
      });
      return;
    }
    case 'tool': {
      // A tool the run refused is not a tool that failed. See
      // `home-energy-engine.ts`'s identical comment: `price-analyst`
      // reaching for `license-lookup` (granted only to
      // `credential-checker`) is this pack's own required Deny moment, and
      // the denied call's own error-status `AfterToolCall` must not be
      // republished as "Couldn't complete that lookup" once the denial
      // itself has already been published as "Action blocked".
      if (
        typeof event.attributes['toolName'] === 'string' &&
        deniedTools.has(event.attributes['toolName'])
      ) {
        return;
      }
      const type =
        event.phase === 'start'
          ? 'tool.started'
          : event.phase === 'error'
            ? 'tool.failed'
            : 'tool.completed';
      const phase =
        event.phase === 'start' ? 'active' : event.phase === 'error' ? 'failed' : 'completed';
      appendActivity(activityStore, clock, ctx.caseId, {
        ...shared,
        type,
        phase,
        summary: event.summary,
      });
      return;
    }
    case 'intervention': {
      if (event.name === 'intervention.guide') {
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'intervention.guided',
          phase: 'completed',
          summary: event.summary,
        });
      } else if (event.name === 'intervention.confirm') {
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'intervention.confirmation_required',
          phase: 'waiting',
          summary: event.summary,
        });
      } else if (event.name === 'intervention.deny') {
        const deniedTool = event.attributes['subject'];
        if (typeof deniedTool === 'string') {
          deniedTools.add(deniedTool);
        }
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'intervention.denied',
          phase: 'completed',
          summary: event.summary,
        });
      }
      return;
    }
    case 'goal': {
      if (event.name === 'goal.validation_failed') {
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'draft.withheld',
          phase: 'failed',
          summary: event.summary,
        });
      }
      return;
    }
    default:
      return;
  }
}

interface DrainResult {
  readonly result: BidComparisonSwarmResult;
  /** The highest `sequence` any drained `RuntimeEvent` used, or `-1` if the Swarm yielded none. See `home-energy-engine.ts`'s identical `DrainResult` for the full rationale. */
  readonly lastSequence: number;
}

async function drainSwarmToActivity(
  gen: AsyncGenerator<RuntimeEvent, BidComparisonSwarmResult, undefined>,
  ctx: { caseId: string; runId: string },
  activityStore: ActivityStore,
  runtimeEventStore: RuntimeEventStore,
  clock: Clock,
  onTraceId: (traceId: string) => void,
): Promise<DrainResult> {
  let next = await gen.next();
  let lastSequence = -1;
  const deniedTools = new Set<string>();
  while (!next.done) {
    const persisted = runtimeEventStore.append({
      ...next.value,
      caseId: ctx.caseId,
      runId: ctx.runId,
    });
    onTraceId(persisted.traceId);
    appendActivityForSwarmEvent(next.value, ctx, activityStore, clock, persisted.id, deniedTools);
    lastSequence = persisted.sequence;
    next = await gen.next();
  }
  return { result: next.value, lastSequence };
}

function scenarioFoldDeps(deps: BidComparisonEngineDeps): {
  clock: Clock;
  idGenerator: IdGenerator;
  skillsRootDir: string;
  liveSwarmEnabled: boolean | undefined;
  modelId: string | undefined;
  awsRegion: string | undefined;
} {
  return {
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    skillsRootDir: deps.skillsRootDir,
    liveSwarmEnabled: deps.liveSwarmEnabled,
    modelId: deps.modelId,
    awsRegion: deps.awsRegion,
  };
}

/**
 * Selects `BidComparisonSwarmDeps.modelFor`: the deterministic
 * `scriptedModelFor` fixtures every release gate and the recorded demo
 * require by default, or -- only when `BidComparisonEngineDeps
 * .liveSwarmEnabled` is explicitly `true` -- one real model
 * (`resolveModelProvider`, `model-provider.ts`) shared by every specialist
 * and the decision synthesizer for this run. `SiftConfig.liveSwarmEnabled`'s
 * doc comment (config.ts) has the full reasoning for why this must stay
 * opt-in. Exported for the same direct-unit-testability reason
 * `extractFavoredBidId` is.
 */
export function buildModelFor(
  providers: BidComparisonSwarmScriptedProviders,
  deps: {
    liveSwarmEnabled?: boolean | undefined;
    modelId?: string | undefined;
    awsRegion?: string | undefined;
  },
): BidComparisonSwarmDeps['modelFor'] {
  if (deps.liveSwarmEnabled !== true) {
    return scriptedModelFor(providers);
  }
  if (deps.modelId === undefined || deps.awsRegion === undefined) {
    throw new Error(
      'bid-comparison-engine: liveSwarmEnabled is true but modelId/awsRegion were not provided',
    );
  }
  const liveModel = resolveModelProvider({ modelId: deps.modelId, awsRegion: deps.awsRegion });
  return () => liveModel;
}

/** `bid.<x>` obligation id each sequential Swarm node's context resolves. Mirrors `bid-comparison-swarm.test.ts`'s own mapping. */
const SEQUENTIAL_OBLIGATION_ID: Record<BidComparisonSequentialSpecialistId, string> = {
  'scope-analyst': 'bid.scope_normalization',
  'price-analyst': 'bid.price_verification',
  'credential-checker': 'bid.credential_verification',
  'schedule-analyst': 'bid.schedule_feasibility',
};

/**
 * Builds the real `BidComparisonSwarmDeps` from a live case snapshot + the
 * real compiled pack -- this task's own version of
 * `buildHomeEnergySwarmDepsFromCase`. What is genuinely reused is the
 * underlying, already-exported building block both need:
 * `car-purchase-scenario.ts`'s fully generic `buildExecutionRequestFor`
 * (reads only `CaseState`/`CompiledDecisionPack`/`obligationId` -- nothing
 * pack-specific) for every `ExecutionRequest`, and
 * `scripted-beats/bid-comparison.ts`'s own already-exported
 * `scriptedModelFor` for `modelFor` -- via this file's own `buildModelFor`,
 * which is `scriptedModelFor(providers)` unconditionally UNLESS
 * `BidComparisonEngineDeps.liveSwarmEnabled` is explicitly `true`
 * (`config.ts`'s `SiftConfig.liveSwarmEnabled` doc comment has the full
 * opt-in reasoning).
 */
function buildBidComparisonSwarmDepsFromCase(
  caseState: CaseState,
  pack: CompiledDecisionPack,
  providers: BidComparisonSwarmScriptedProviders,
  deps: {
    clock: Clock;
    idGenerator: IdGenerator;
    skillsRootDir: string;
    liveSwarmEnabled?: boolean | undefined;
    modelId?: string | undefined;
    awsRegion?: string | undefined;
  },
  start: BidComparisonSwarmNodeId | undefined,
): BidComparisonSwarmDeps {
  const specialistRequests = Object.fromEntries(
    BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS.map((specialistId) => [
      specialistId,
      buildExecutionRequestFor(caseState, pack, SEQUENTIAL_OBLIGATION_ID[specialistId]),
    ]),
  ) as BidComparisonSwarmDeps['specialistRequests'];

  return {
    pack,
    modelFor: buildModelFor(providers, deps),
    skillsRootDir: deps.skillsRootDir,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    specialistRequests,
    awardRecommendationRequest: buildExecutionRequestFor(
      caseState,
      pack,
      'bid.award_recommendation',
    ),
    resolveConfirmation: () => true,
    ...(start !== undefined ? { start } : {}),
  };
}

/** Real bid id -> real contractor name (`EntityRecord.label`), read from the case's own seeded `kind: 'bid'` entities -- never a hardcoded name list. Used by `extractFavoredBidId`'s fallback below. */
function bidIdsByContractorName(caseState: CaseState): ReadonlyMap<string, string> {
  return new Map(
    caseState.entities
      .filter((entity) => entity.kind === 'bid')
      .map((entity) => [entity.label, entity.id]),
  );
}

/**
 * Extracts which bid id `decisionSynthesizerText` recommends awarding.
 * `propose_award`'s own `bidId` input field is the real, structured answer
 * (see this file's header comment, difference 2) -- this text-based
 * extraction is the fallback used only when no proposal was made in this
 * round (defensive; never actually reached by the shipped scripted
 * trajectory, which always calls `propose_award` before its final
 * structured output in both rounds).
 *
 * Exported for the same direct-unit-testability reason
 * `home-energy-engine.ts`'s `extractFavoredResponseOptionId` is.
 */
export function extractFavoredBidId(
  text: string,
  bidIdByName: ReadonlyMap<string, string>,
): string | null {
  const match = /Recommend awarding to ([^.]+)\./i.exec(text);
  const namedClause = match?.[1]?.trim();
  if (namedClause !== undefined) {
    const byClause = bidIdByName.get(namedClause);
    if (byClause !== undefined) return byClause;
  }
  for (const [contractorName, bidId] of bidIdByName) {
    if (text.includes(contractorName)) return bidId;
  }
  return null;
}

/** Every non-empty `limitations` entry any node's captured context carried, de-duplicated -- used to ground `Recommendation.limitations` in what the Swarm's specialists actually reported rather than inventing generic prose. */
function collectLimitations(
  contexts: Partial<Record<BidComparisonSwarmNodeId, ExecutionResult>>,
): string[] {
  const seen = new Set<string>();
  for (const context of Object.values(contexts)) {
    for (const limitation of context?.limitations ?? []) {
      seen.add(limitation);
    }
  }
  return [...seen];
}

/** `resolvedObligationIds`/`acceptedUncertaintyObligationIds` computed from the real, current obligation statuses -- never hardcoded. */
function obligationIdsByStatus(
  snapshot: CaseState,
  status: 'satisfied' | 'accepted_uncertainty',
): string[] {
  return snapshot.obligations.filter((obligation) => obligation.status === status).map((o) => o.id);
}

/**
 * Records the round's revised recommendation, then -- only when
 * `decision-synthesizer` genuinely called `propose_award` -- a pending
 * `proposal.proposed` requiring human review. Shared by both
 * `foldBidComparisonRound1`/`foldBidComparisonRound2` (see this file's
 * header comment, difference 1: unlike `home-energy-engine.ts`, this pack's
 * award proposal is not round-2-only, so the two fold functions would
 * otherwise duplicate this block verbatim).
 */
function recordRecommendationAndProposal(
  deps: BidComparisonEngineDeps,
  caseId: string,
  snapshot: CaseState,
  swarmResult: BidComparisonSwarmResult,
  sourceIds: readonly string[],
  roundLabel: 'initial' | 'revised',
): CaseState {
  const favoredBidId =
    swarmResult.proposedAward?.bidId ??
    extractFavoredBidId(swarmResult.decisionSynthesizerText, bidIdsByContractorName(snapshot));
  if (favoredBidId === null) {
    throw new Error(
      `bid-comparison-engine: ${roundLabel === 'initial' ? 'round1' : 'round2'} decision-synthesizer text named no known bid for case "${caseId}"`,
    );
  }

  // The model proposed `favoredBidId`; the deterministic scoreboard
  // supplies the numbers attached to it. When the two disagree, the
  // proposal stands but `limitations` says so outright and confidence is
  // capped -- see recommendation-scoring.ts for why neither silently
  // overwriting nor silently accepting is acceptable here.
  const scored = deriveScoredRecommendationFields(snapshot, favoredBidId);
  const recommendationEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'recommendation.ready',
    payload: {
      recommendation: {
        id: deps.idGenerator.next('rec'),
        status: 'ready',
        favoredOptionId: favoredBidId,
        rationale: stripInlineSourceCitations(swarmResult.decisionSynthesizerText),
        facts: scored.facts,
        hypotheses: [],
        confidence: scored.confidence,
        limitations: mergeLimitations(collectLimitations(swarmResult.contexts), scored.limitations),
        sourceIds: [...sourceIds],
        resolvedObligationIds: obligationIdsByStatus(snapshot, 'satisfied'),
        acceptedUncertaintyObligationIds: obligationIdsByStatus(snapshot, 'accepted_uncertainty'),
        generatedAt: deps.clock.now(),
      },
    },
  };
  const recAppend = deps.caseStore.append(caseId, [recommendationEvent], snapshot.eventSequence);
  if (recAppend.status !== 'applied') {
    throw new Error(
      `bid-comparison-engine: failed to record the ${roundLabel === 'initial' ? 'round1' : 'round2'} recommendation for case "${caseId}": status "${recAppend.status}"`,
    );
  }
  appendActivity(deps.activityStore, deps.clock, caseId, {
    type: 'recommendation.ready',
    phase: 'completed',
    summary: `${roundLabel === 'initial' ? 'Initial' : 'Revised'} recommendation ready: favoring "${favoredBidId}".`,
  });
  let nextSnapshot = recAppend.snapshot;

  if (swarmResult.proposedAward === undefined) {
    // decision-synthesizer's own recommendation did not name one bid to
    // award confidently enough to call propose_award this round -- there is
    // nothing pending human confirmation.
    return nextSnapshot;
  }

  // Sift proposes; only a human may approve via the separate `reviewProposal`
  // command (never called here -- see this file's header comment).
  const proposalEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: nextSnapshot.eventSequence + 1,
    timestamp: deps.clock.now(),
    type: 'proposal.proposed',
    payload: {
      proposal: {
        id: deps.idGenerator.next('proposal'),
        recommendationId: recommendationEvent.payload.recommendation.id,
        status: 'pending',
        createdAt: deps.clock.now(),
      },
    },
  };
  const proposalAppend = deps.caseStore.append(caseId, [proposalEvent], nextSnapshot.eventSequence);
  if (proposalAppend.status !== 'applied') {
    throw new Error(
      `bid-comparison-engine: failed to create the decision proposal for case "${caseId}": status "${proposalAppend.status}"`,
    );
  }
  nextSnapshot = proposalAppend.snapshot;
  appendActivity(deps.activityStore, deps.clock, caseId, {
    type: 'intervention.confirmation_required',
    phase: 'waiting',
    summary: 'A proposal to award this bid is awaiting human review.',
  });
  return nextSnapshot;
}

/**
 * Folds round 1: the four sequential specialists' contexts, then
 * `source-challenger`'s corroboration, then a synthesized `evidence_found`
 * result for `bid.award_recommendation` from `decision-synthesizer`'s final
 * ranking text, then the recommendation and (see this file's header
 * comment, difference 1) any pending award proposal. Mirrors
 * `home-energy-engine.ts`'s `foldHomeEnergyRound1` shape using the same
 * reused fold helpers.
 *
 * Exported for the same direct-unit-testability reason
 * `foldHomeEnergyRound1`/`foldHomeEnergyRound2` are.
 */
export function foldBidComparisonRound1(
  deps: BidComparisonEngineDeps,
  caseId: string,
  swarmResult: BidComparisonSwarmResult,
): CaseState {
  const scenarioDeps = scenarioFoldDeps(deps);
  const trajectory = emptyScenarioTrajectory();

  for (const specialistId of BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS) {
    const context = swarmResult.contexts[specialistId];
    if (context === undefined) {
      throw new Error(
        `bid-comparison-engine: round1 produced no context for "${specialistId}" on case "${caseId}"`,
      );
    }
    foldExecutionResult(
      deps.caseStore,
      deps.activityStore,
      caseId,
      context,
      scenarioDeps,
      trajectory,
      { attemptsToRecord: 1 },
    );
  }

  const challengeContext = swarmResult.contexts['source-challenger'];
  if (challengeContext === undefined) {
    throw new Error(
      `bid-comparison-engine: round1 produced no context for "source-challenger" on case "${caseId}"`,
    );
  }
  // source-challenger corroborates the evidence chain rather than making its
  // own attempt at an obligation -- mirrors home-energy-engine.ts's
  // identical rationale for its own source-challenger fold.
  foldExecutionResult(
    deps.caseStore,
    deps.activityStore,
    caseId,
    challengeContext,
    scenarioDeps,
    trajectory,
    { attemptsToRecord: 0 },
  );

  const initialSnapshot = loadSnapshotOrThrow(deps.caseStore, caseId);
  const sourceIds = extractCitedSourceIds(swarmResult.decisionSynthesizerText);
  ensureSourcesExist(deps.caseStore, caseId, initialSnapshot.eventSequence, sourceIds, deps.clock);

  // foldExecutionResult re-loads the case fresh internally, so its return
  // value (not the pre-ensureSourcesExist snapshot above) is this
  // function's one live source of truth from here on.
  const snapshot = foldExecutionResult(
    deps.caseStore,
    deps.activityStore,
    caseId,
    {
      obligationId: 'bid.award_recommendation',
      disposition: 'evidence_found',
      claims: [
        {
          statement: stripInlineSourceCitations(swarmResult.decisionSynthesizerText),
          stance: 'supports',
          confidence: 0.8,
          sourceIds,
        },
      ],
      evidenceResults: sourceIds.map((sourceId) => ({
        sourceId,
        level: 'E2' as const,
        verdict: 'pass' as const,
        summary: 'Cited in the award-recommendation synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    scenarioDeps,
    trajectory,
    { attemptsToRecord: 1 },
  );

  return recordRecommendationAndProposal(deps, caseId, snapshot, swarmResult, sourceIds, 'initial');
}

/**
 * Folds round 2: `decision-synthesizer`'s revised award-recommendation
 * ranking (the only node the Swarm re-visits -- the Swarm starts directly
 * at `decision-synthesizer`, since nothing about the confirmed scope/price/
 * credential/schedule evidence changes, only the household or contractor's
 * cost/warranty/payment-risk weighting), a revised `recommendation.ready`,
 * and any pending award proposal. Mirrors `home-energy-engine.ts`'s
 * `foldHomeEnergyRound2` shape, adjusted for this pack's actual round-2
 * scope (no household-specific inspection follow-up exists here; see this
 * file's header comment, difference 1, for why the proposal handling is
 * shared with round1 rather than round2-only).
 *
 * Exported for the same direct-unit-testability reason as
 * `foldBidComparisonRound1` above.
 */
export function foldBidComparisonRound2(
  deps: BidComparisonEngineDeps,
  caseId: string,
  swarmResult: BidComparisonSwarmResult,
): CaseState {
  const scenarioDeps = scenarioFoldDeps(deps);
  const trajectory = emptyScenarioTrajectory();

  const initialSnapshot = loadSnapshotOrThrow(deps.caseStore, caseId);
  const sourceIds = extractCitedSourceIds(swarmResult.decisionSynthesizerText);
  ensureSourcesExist(deps.caseStore, caseId, initialSnapshot.eventSequence, sourceIds, deps.clock);

  // A re-synthesis corroborating/revising the same obligation, not a fresh
  // "attempt" at it (matches source-challenger's `attemptsToRecord: 0`
  // corroboration rationale above) -- `bid.award_recommendation` is already
  // `satisfied` from round 1; this records the revised evidence without
  // consuming the obligation's own attempt budget a second time.
  // foldExecutionResult re-loads the case fresh internally, so its return
  // value (not the pre-ensureSourcesExist snapshot above) is this
  // function's one live source of truth from here on.
  const snapshot = foldExecutionResult(
    deps.caseStore,
    deps.activityStore,
    caseId,
    {
      obligationId: 'bid.award_recommendation',
      disposition: 'evidence_found',
      claims: [
        {
          statement: stripInlineSourceCitations(swarmResult.decisionSynthesizerText),
          stance: 'supports',
          confidence: 0.85,
          sourceIds,
        },
      ],
      evidenceResults: sourceIds.map((sourceId) => ({
        sourceId,
        level: 'E2' as const,
        verdict: 'pass' as const,
        summary: 'Cited in the revised award-recommendation synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    scenarioDeps,
    trajectory,
    { attemptsToRecord: 0 },
  );

  return recordRecommendationAndProposal(deps, caseId, snapshot, swarmResult, sourceIds, 'revised');
}

async function runOneInvestigation(
  params: { caseId: string; runId: string; obligationId: string },
  deps: BidComparisonEngineDeps,
): Promise<void> {
  try {
    const initialSnapshot = deps.caseStore.load(params.caseId);
    if (initialSnapshot === undefined) {
      throw new Error(`bid-comparison-engine: case "${params.caseId}" was not found`);
    }
    const pack = deps.registry.get(initialSnapshot.pack.id, initialSnapshot.pack.version);
    if (pack === undefined) {
      throw new Error(
        `bid-comparison-engine: pinned pack "${initialSnapshot.pack.id}@${initialSnapshot.pack.version}" is not registered`,
      );
    }

    const round = determineBidComparisonRound(initialSnapshot);

    deps.runStore.updateStatus(params.runId, {
      status: 'running',
      updatedAt: deps.clock.now(),
    });
    appendActivity(deps.activityStore, deps.clock, params.caseId, {
      runId: params.runId,
      obligationId: params.obligationId,
      type: 'run.started',
      phase: 'active',
      summary: `Investigation started (${round === 'round1' ? 'initial' : 'revised'} pass).`,
    });

    const providers = buildBidComparisonSwarmScriptedProviders(deps.demoPacingMs ?? 0);
    setScenarioBeat(providers, round);
    const swarmDeps = buildBidComparisonSwarmDepsFromCase(
      initialSnapshot,
      pack,
      providers,
      scenarioFoldDeps(deps),
      round === 'round2' ? 'decision-synthesizer' : undefined,
    );

    // --- One trace per run, not two -- the identical correction
    // `home-energy-engine.ts`'s `runOneInvestigation` documents in full. ---
    let recordedTraceId: string | undefined;
    const recordTraceId = (candidate: string): string => {
      if (recordedTraceId === undefined) {
        recordedTraceId = candidate;
        deps.runStore.updateStatus(params.runId, {
          status: 'running',
          updatedAt: deps.clock.now(),
          traceId: candidate,
        });
      }
      return recordedTraceId;
    };

    const { result: swarmResult, lastSequence } = await drainSwarmToActivity(
      executeBidComparisonSwarm(swarmDeps),
      { caseId: params.caseId, runId: params.runId },
      deps.activityStore,
      deps.runtimeEventStore,
      deps.clock,
      recordTraceId,
    );

    const finalSnapshot =
      round === 'round1'
        ? foldBidComparisonRound1(deps, params.caseId, swarmResult)
        : foldBidComparisonRound2(deps, params.caseId, swarmResult);

    // --- I3: one real, whole-run before/after case-state diff. ---
    const stateDiff = diffJsonValues(initialSnapshot, finalSnapshot);
    if (stateDiff.length > 0) {
      deps.runtimeEventStore.append(
        normalizeCaseStateChange(
          { stateDiff },
          {
            traceId: recordedTraceId ?? recordTraceId(deps.idGenerator.next('trace')),
            caseId: params.caseId,
            runId: params.runId,
            obligationId: params.obligationId,
          },
          lastSequence + 1,
        ),
      );
    }

    deps.runStore.updateStatus(params.runId, {
      status: 'completed',
      updatedAt: deps.clock.now(),
      result: { round, favoredOptionId: finalSnapshot.recommendation?.favoredOptionId ?? null },
    });
    appendActivity(deps.activityStore, deps.clock, params.caseId, {
      runId: params.runId,
      type: 'run.completed',
      phase: 'completed',
      summary: `Investigation completed (${round === 'round1' ? 'initial' : 'revised'} pass).`,
    });
  } catch (error) {
    // Same last-resort pattern home-energy-engine.ts documents: logged
    // unconditionally first, then the two durable writes are attempted
    // best-effort.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[sift] bid-comparison-engine: run "${params.runId}" for case "${params.caseId}" failed: ${message}`,
    );
    try {
      deps.runStore.updateStatus(params.runId, {
        status: 'failed',
        updatedAt: deps.clock.now(),
        result: { error: message },
      });
    } catch (updateError) {
      console.error(
        `[sift] bid-comparison-engine: failed to record run "${params.runId}" as failed:`,
        updateError,
      );
    }
    try {
      appendActivity(deps.activityStore, deps.clock, params.caseId, {
        runId: params.runId,
        obligationId: params.obligationId,
        type: 'run.failed',
        phase: 'failed',
        summary: `Investigation failed: ${message}`,
      });
    } catch (activityError) {
      console.error(
        `[sift] bid-comparison-engine: failed to append a run.failed activity event for run "${params.runId}":`,
        activityError,
      );
    }
  }
}

/**
 * Builds the live `bid-comparison` `InvestigationEngine`. `RunService`
 * looks this up by pack id (`server.ts` registers it under
 * `'bid-comparison'`) and fires `trigger` after durably accepting a run,
 * without ever awaiting it.
 */
export function createBidComparisonEngine(deps: BidComparisonEngineDeps): BidComparisonEngine {
  const inFlightByCase = new Map<string, Promise<void>>();

  function trigger(params: { caseId: string; runId: string; obligationId: string }): Promise<void> {
    const priorInFlight = inFlightByCase.get(params.caseId) ?? Promise.resolve();
    const thisRun = priorInFlight.then(() => runOneInvestigation(params, deps));
    inFlightByCase.set(params.caseId, thisRun);
    void thisRun.finally(() => {
      if (inFlightByCase.get(params.caseId) === thisRun) {
        inFlightByCase.delete(params.caseId);
      }
    });
    return thisRun;
  }

  return { trigger };
}

// Re-exported so a caller that only imports this module still has the
// concrete `RunStatus` vocabulary `runStore.load(...).status` returns.
export type { RunStatus };
