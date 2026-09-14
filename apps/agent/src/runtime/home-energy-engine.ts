/**
 * The real, live, asynchronously-triggered Strands adapter for the
 * `home-energy-guardian` pack -- the Swarm-hero analog of
 * `car-purchase-engine.ts`. Before this file existed, `home-energy-guardian`
 * was never compiled or registered at boot (`server.ts` only ever wired
 * `car-purchase`), so `POST /api/cases/demo {demoId:
 * "home-energy-guardian"}` had no installed pack to resolve against at all
 * -- a real browser session clicking "Investigate my energy bill" hit a dead
 * end before a case could even be created, let alone investigated. This
 * closes that gap for the live server, without touching the already-proven
 * standalone Swarm construction/behavior (`home-energy-swarm.ts`,
 * `home-energy-swarm.test.ts`) or the untouched car-purchase live path.
 *
 * `createHomeEnergyEngine(deps).trigger(...)` is the one entry point,
 * mirroring `createCarPurchaseEngine`'s five responsibilities exactly:
 *
 *  1. determines whether this is `round1` or `round2` purely from the
 *     case's own current, real state (`determineHomeEnergyRound` below);
 *  2. builds the real `HomeEnergySwarmDeps` for the six-node Swarm from the
 *     live case snapshot (`buildHomeEnergySwarmDepsFromCase` below -- see
 *     that function's own comment for why this, not a car-purchase-style
 *     exported `buildGraphDeps`, is this task's version of "genuinely reuse
 *     the case-to-deps construction logic rather than re-deriving it from
 *     scratch");
 *  3. runs the real bounded `executeHomeEnergySwarm`, streaming every
 *     `RuntimeEvent` it yields into the real `ActivityStore` AS THE SWARM
 *     PROGRESSES (`drainSwarmToActivity` below) and, additively, into the
 *     real Runtime Inspector persistence path (`RuntimeEventStore`) --
 *     structurally the same two-destination fan-out
 *     `car-purchase-engine.ts`'s own `drainGraphToActivity` performs, but a
 *     genuinely parallel implementation here (not an import): that
 *     function's own signature is hard-typed to `CarPurchaseGraphResult`
 *     (the Graph's return shape) and its public-activity mapping switches
 *     on `category: 'graph'`, which this Swarm's `RuntimeEvent` stream never
 *     emits (it emits `category: 'swarm'` instead -- `swarm.node_started`/
 *     `swarm.node_completed`/`swarm.handoff`/`swarm.cycle_detected`/
 *     `swarm.timeout`, none of which `car-purchase-engine.ts` needs to
 *     handle). Neither file may be edited to generalize the other (this
 *     task's scope explicitly excludes touching `car-purchase-engine.ts`),
 *     so this is the documented "genuinely pack-specific, parallel
 *     implementation" case docs/engineering-principles.md's task brief for this file
 *     anticipated;
 *  4. folds every specialist's validated context/final synthesis into real
 *     `CaseEvent`s via `car-purchase-scenario.ts`'s own exported, fully
 *     generic `foldExecutionResult`/`ensureSourcesExist`/
 *     `loadSnapshotOrThrow`/`extractCitedSourceIds`/`buildExecutionRequestFor`
 *     helpers -- read-only imports, genuinely reused rather than
 *     copy-pasted (none of those five functions reference anything
 *     car-purchase-specific; they operate purely on `@sift/contracts`
 *     types, `CaseStore`, and `ActivityStore`, exactly like this file's own
 *     `foldHomeEnergyRound1`/`foldHomeEnergyRound2` need);
 *  5. on completion, records the round's recommendation, and (round 2 only,
 *     and only when `decision-synthesizer` genuinely called
 *     `propose_inspection`) the pending inspection proposal -- deliberately
 *     never auto-approved, identical to car-purchase's own posture:
 *     `reviewProposal` is a separate command a human issues through the
 *     normal UI, wholly outside this engine;
 *  6. advances the run's `RunStore` status `running` -> `completed`, or
 *     `failed` with a real error activity event on any thrown error, via
 *     the identical last-resort `try`/`catch` shape `car-purchase-engine.ts`
 *     uses so a run can never hang forever or vanish silently.
 *
 * --- Round-1-vs-round-2 detection ---
 *
 * docs/specs/demos-and-submission.md "Home Energy Guardian scenario" ->
 * "Required sequence" step 10: "The user or ChatGPT reweights the criterion
 * from lowest immediate cost to long-term waste reduction." That is the one
 * durable, real fact this engine reads back from case state:
 * `determineHomeEnergyRound` compares the case's current `energy.cost`/
 * `energy.conservation` criterion weights and calls it `round2` exactly when
 * `energy.conservation`'s weight now exceeds `energy.cost`'s -- the direct,
 * persisted trace of that reweight, independent of which caller performed
 * it (visible UI control or a WebMCP `sift_update_criteria` call, per
 * docs/engineering-principles.md "Visible UI controls and WebMCP callbacks use the same command
 * implementation"). A freshly started case (pack defaults: cost 80, conservation 20)
 * is `round1` (pack defaults are cost-heavy, so conservation never exceeds cost there).
 *
 * A freshly started case carries the pack's cost-heavy 80/20 default, which
 * is both what round 1's narration says and what the deterministic scorer
 * agrees with. That agreement used to be absent: the pack shipped 50/50
 * while the scripted round-1 text narrated 80/20, so the recommendation card
 * printed the scripted "0.80 versus 0.47" directly above the computed "67%
 * to 50%" and recommended an option its own criteria ranked second. The
 * default is now 80/20 and
 * `scripted-beats/home-energy-guardian.test.ts` fails if the two ever drift
 * apart again.
 *
 * Round 1 also genuinely exercises the `GoalLoop` rejection path: the
 * scripted `decision-synthesizer` offers an uncited draft first, the real
 * validator refuses it for citing no source, and the corrected retry is what
 * reaches the case. That rejection surfaces as a `draft.withheld` consumer
 * event -- the one `goal`-category event promoted out of Runtime
 * Inspector-only detail, because a product refusing an unsupported answer is
 * exactly what a person watching it work should see.
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
import {
  createCapabilityCatalog,
  HOME_ENERGY_GUARDIAN_MANIFEST,
  type PackRegistry,
} from '@sift/packs';
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
import { diffJsonValues, normalizeCaseStateChange, type RuntimeEvent } from './event-normalizer.js';
import {
  HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS,
  executeHomeEnergySwarm,
  type HomeEnergySequentialSpecialistId,
  type HomeEnergySwarmDeps,
  type HomeEnergySwarmNodeId,
  type HomeEnergySwarmResult,
} from './home-energy-swarm.js';
import {
  RESPONSE_OPTIONS,
  buildHomeEnergySwarmScriptedProviders,
  scriptedModelFor,
  setScenarioBeat,
  type HomeEnergyScenarioBeat,
  type HomeEnergySwarmScriptedProviders,
} from './scripted-beats/home-energy-guardian.js';
import { deriveScoredRecommendationFields, mergeLimitations } from './recommendation-scoring.js';

// Re-exported for the same direct-unit-testability reason
// `bid-comparison-engine.ts` re-exports it: see
// `car-purchase-scenario.ts`'s `stripInlineSourceCitations` doc comment for
// why this text-cleanup helper is shared, not duplicated, between the two
// live Swarm-hero engines.
export { stripInlineSourceCitations };

/**
 * Exported for the same reason `car-purchase-scenario.ts`'s
 * `carPurchaseCapabilityCatalog` is: `server.ts` needs to compile and
 * register the exact real `home-energy-guardian` `CompiledDecisionPack`
 * this engine runs against, without duplicating the catalog-construction
 * logic `home-energy-swarm.test.ts`'s own (test-local) `energyCatalog()`
 * helper already proves.
 */
export function homeEnergyCapabilityCatalog() {
  return createCapabilityCatalog([
    ...HOME_ENERGY_GUARDIAN_MANIFEST.skills.map((skill) => ({
      id: skill.id,
      kind: 'skill' as const,
      version: '1.0.0',
    })),
    ...HOME_ENERGY_GUARDIAN_MANIFEST.specialists.map((specialist) => ({
      id: specialist.id,
      kind: 'specialist' as const,
      version: '1.0.0',
    })),
    ...HOME_ENERGY_GUARDIAN_MANIFEST.tools.map((tool) => ({
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
export function determineHomeEnergyRound(caseState: CaseState): HomeEnergyScenarioBeat {
  const cost = caseState.criteria.find((criterion) => criterion.id === 'energy.cost');
  const conservation = caseState.criteria.find(
    (criterion) => criterion.id === 'energy.conservation',
  );
  if (cost === undefined || conservation === undefined) return 'round1';
  return conservation.weight > cost.weight ? 'round2' : 'round1';
}

export interface HomeEnergyEngineDeps {
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
}

export interface HomeEnergyEngine extends InvestigationEngine {
  /**
   * Fire-and-forget per `InvestigationEngine`, but returns the real
   * in-flight `Promise` -- production callers (`run-service.ts`) never
   * await it; tests may, to observe real completion deterministically.
   * Two triggers for the same `caseId` are serialized, mirroring
   * `CarPurchaseEngine.trigger`'s identical per-case queuing contract.
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
    /** The synthetic id of the exact correlated `runtime_events` row this activity event was derived from (I2: "a consumer-visible activity event should open its exact corresponding runtime event"). Omitted for engine-level bookkeeping events (`run.started`/`.completed`/`.failed`) that were never themselves one normalized `RuntimeEvent`. */
    debugEventId?: string;
    type: PublicActivityEventType;
    phase: PublicActivityPhase;
    summary: string;
    /**
     * Small, published, machine-readable facts a consumer surface can render
     * beside the summary -- `PublicActivityEvent.safeDetails`
     * (`packages/contracts/src/events.ts`), which `ActivityStore` already
     * persists and replays as the `activity_events.data` column.
     *
     * "Safe" is the whole contract: this rides on the sanitized *public*
     * stream, so only closed, non-user-shaped values belong here. Never a
     * user-entered note, a model's private reasoning, a raw tool payload, a
     * header, or anything credential-shaped -- those stay in the Runtime
     * Inspector's own detail, behind `event-normalizer.ts`'s redaction.
     */
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
 * matching public `ActivityStore` event, where the normal workspace's
 * public vocabulary (`@sift/contracts` `PUBLIC_ACTIVITY_EVENT_TYPES`) has
 * one. `category: 'swarm'`'s `swarm.node_started`/`swarm.node_completed`
 * map onto the same `specialist.started`/`specialist.completed` public
 * types `car-purchase-engine.ts` derives from its own Graph's
 * `graph.node_completed` start/finish phases -- the public vocabulary does
 * not distinguish Graph nodes from Swarm nodes, both are simply "a
 * specialist is working". `swarm.handoff`/`swarm.cycle_detected`/
 * `swarm.timeout` have no direct public counterpart today (there is no
 * `PublicActivityEventType` for "control moved to a different specialist"),
 * so -- like car-purchase's own `model`/`context`/`goal`/`session`/`error`
 * exclusions -- they remain Runtime Inspector-only detail. `model`/
 * `context`/`goal` categories are likewise left out for the same reason.
 */
function appendActivityForSwarmEvent(
  event: RuntimeEvent,
  ctx: { caseId: string; runId: string },
  activityStore: ActivityStore,
  clock: Clock,
  /** The synthetic id `runtimeEventStore.append` minted for this exact `event` (I2). Every `appendActivity` call below stamps it, so the resulting `PublicActivityEvent` resolves back to this precise `runtime_events` row. */
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
          // How long this specialist genuinely took, forwarded onto the
          // public stream so a consumer surface can freeze a running
          // elapsed time at the node's real duration rather than leaving
          // the column blank. `home-energy-swarm.ts` measures it across the
          // node's own real start/finish hooks and OMITS it when nothing
          // measured that node, so this spread carries a real figure or
          // nothing at all -- never a zero and never an estimate.
          //
          // Safe to publish: a single integer millisecond count read from a
          // clock, with no string leaf a note, payload, header, or
          // credential could reach -- the same reasoning
          // `event-normalizer.ts`'s `CallMetrics` records for keeping
          // `durationMs` out of `redactValue`.
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
      // A tool the run refused is not a tool that failed. ScopeAuthorization
      // denies the call in `beforeToolCall`, but the SDK still delivers an
      // `AfterToolCall` carrying an error status, which would otherwise be
      // published as "Couldn't complete that lookup" -- telling a person a
      // lookup broke when in fact a boundary held. The denial has already
      // been published as "Action blocked"; publishing this too would be
      // both redundant and false.
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
        // `Deny` -> "Action blocked" (docs/specs/product.md terminology
        // table). The denied tool's own `AfterToolCall` still arrives with
        // an error status, which the `tool` case above would otherwise
        // publish as "Couldn't complete that lookup" -- so `deniedTools`
        // records the subject here and suppresses that misleading line.
        const deniedTool = event.attributes['subject'];
        if (typeof deniedTool === 'string') {
          deniedTools.add(deniedTool);
        }
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'intervention.denied',
          // The guard ran to completion; it is the *action* that was
          // blocked. `intervention.guided` records itself the same way, and
          // "blocked" is not a `PUBLIC_ACTIVITY_PHASES` member. The reader
          // gets the meaning from the label ("Action blocked") and its
          // `blocked` tone, not from the lifecycle phase.
          phase: 'completed',
          summary: event.summary,
        });
      }
      return;
    }
    // The `goal` category is otherwise Runtime Inspector detail, and
    // `goal.validated` stays there: "the model got it right first time" is
    // not news to anyone. A *rejection* is the opposite. It is the moment
    // the product refuses a plausible-sounding answer that could not cite a
    // source, and a person watching an agent work has every reason to see
    // that happen rather than have it summarized afterwards.
    //
    // `draft.withheld` was a fully-built dead end before this: the label,
    // the `blocked` tone, `RecommendationCard`'s withheld state,
    // `SpecialistActivityPanel`'s branch and `workspace-status`'s handling
    // all existed and were tested, and nothing in the product ever emitted
    // the event they render.
    case 'goal': {
      if (event.name === 'goal.validation_failed') {
        appendActivity(activityStore, clock, ctx.caseId, {
          ...shared,
          type: 'draft.withheld',
          // `failed` is this attempt's real outcome. The *run* is not
          // failing -- GoalLoop retries and the corrected draft lands --
          // but the withheld attempt genuinely did not pass, and labelling
          // it `active` or `waiting` would understate what happened. The
          // `blocked` styling a reader sees comes from
          // `activity-labels.ts`'s tone for this event type, not the phase.
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

/**
 * Drains the real Swarm's `RuntimeEvent` stream as it progresses, writing
 * each event down two parallel, additive paths: the public `ActivityStore`
 * projection (`appendActivityForSwarmEvent`) and the real Runtime Inspector
 * persistence path (`runtimeEventStore.append`). Structurally identical to
 * `car-purchase-engine.ts`'s own `drainGraphToActivity` -- see this file's
 * header comment for why it is a parallel implementation, not a shared
 * import.
 *
 * The same real-runId correction that function documents applies here too:
 * every `ExecutionRequest.runId` `buildExecutionRequestFor` builds is the
 * synthetic per-obligation `` `run-${obligationId}` `` id (never this
 * trigger's actual durable `runs.id`), and `executeHomeEnergySwarm`'s own
 * `RunAccumulator.runId` is stamped from whichever request the Swarm
 * started at -- never the real id a client queries via
 * `GET /api/debug/runs/:runId`. `ctx.runId`/`ctx.caseId` (the real ones
 * this engine was `trigger()`ed with) are substituted in before either
 * durable write, exactly like `car-purchase-engine.ts` does.
 *
 * `onTraceId` is handed the trace each persisted event actually carries,
 * so `runOneInvestigation` can record that same id -- not a second,
 * separately minted one -- on the `runs` row. See its doc comment there.
 */
interface DrainResult {
  readonly result: HomeEnergySwarmResult;
  /**
   * The highest `sequence` any drained `RuntimeEvent` used, or `-1` if the
   * Swarm yielded none. `runOneInvestigation` uses `lastSequence + 1` as the
   * safe next sequence for this run's one additional, real
   * `case.state_changed` event (I3) -- see `car-purchase-engine.ts`'s
   * identical `DrainResult` for the full rationale.
   */
  readonly lastSequence: number;
}

async function drainSwarmToActivity(
  gen: AsyncGenerator<RuntimeEvent, HomeEnergySwarmResult, undefined>,
  ctx: { caseId: string; runId: string },
  activityStore: ActivityStore,
  runtimeEventStore: RuntimeEventStore,
  clock: Clock,
  onTraceId: (traceId: string) => void,
): Promise<DrainResult> {
  let next = await gen.next();
  let lastSequence = -1;
  // One per run: a tool denied once stays denied for this drain's lifetime.
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

function scenarioFoldDeps(deps: HomeEnergyEngineDeps): {
  clock: Clock;
  idGenerator: IdGenerator;
  skillsRootDir: string;
} {
  return { clock: deps.clock, idGenerator: deps.idGenerator, skillsRootDir: deps.skillsRootDir };
}

/** `energy.<x>` obligation id each sequential Swarm node's context resolves. Mirrors `home-energy-swarm.test.ts`'s own (test-local) `SEQUENTIAL_OBLIGATION_IDS` mapping. */
const SEQUENTIAL_OBLIGATION_ID: Record<HomeEnergySequentialSpecialistId, string> = {
  'anomaly-investigator': 'energy.anomaly',
  'rate-analyst': 'energy.rate_change',
  'weather-analyst': 'energy.weather',
  'home-systems-analyst': 'energy.household_change',
};

/**
 * Builds the real `HomeEnergySwarmDeps` from a live case snapshot + the real
 * compiled pack -- this task's own version of `buildGraphDeps`
 * (`car-purchase-scenario.ts`). No test-local equivalent could simply be
 * "widened and exported" the way `car-purchase-scenario.ts`'s own task did:
 * `home-energy-swarm.test.ts`'s `buildDeps` constructs every
 * `ExecutionRequest` from hand-authored fixture objects
 * (`buildExecutionRequest`/`specialistRequest`), not from a real
 * `CaseState`, so there is no case-shaped construction logic there to lift
 * out unchanged. What *is* genuinely reused is the underlying,
 * already-exported building blocks both that test and this engine need:
 * `car-purchase-scenario.ts`'s fully generic `buildExecutionRequestFor`
 * (reads only `CaseState`/`CompiledDecisionPack`/`obligationId` -- nothing
 * car-purchase-specific) for every `ExecutionRequest`, and
 * `scripted-beats/home-energy-guardian.ts`'s own already-exported
 * `scriptedModelFor` for `modelFor`.
 */
function buildHomeEnergySwarmDepsFromCase(
  caseState: CaseState,
  pack: CompiledDecisionPack,
  providers: HomeEnergySwarmScriptedProviders,
  deps: { clock: Clock; idGenerator: IdGenerator; skillsRootDir: string },
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
    modelFor: scriptedModelFor(providers),
    skillsRootDir: deps.skillsRootDir,
    clock: deps.clock,
    idGenerator: deps.idGenerator,
    specialistRequests,
    responseOptionsRequest: buildExecutionRequestFor(caseState, pack, 'energy.response_options'),
    resolveConfirmation: () => true,
    ...(start !== undefined ? { start } : {}),
  };
}

const KNOWN_RESPONSE_OPTION_IDS = RESPONSE_OPTIONS.map((option) => option.optionId);

/**
 * Extracts which response-option id `decisionSynthesizerText` recommends.
 * Home Energy Guardian has no dedicated "propose a response option" tool
 * call the way car-purchase's `propose_recommendation`/this pack's own
 * `propose_inspection` are (the pack only gates the one *consequential*
 * option, `request-hvac-inspection`, behind a tool call -- the other three
 * response options are never "proposed" through a tool at all, per
 * `home-energy-guardian.ts`'s manifest). Round 2's inspection
 * recommendation is read directly off `HomeEnergySwarmResult.
 * proposedInspection.optionId` when present (the real tool-call input, not
 * text-parsed); this text-based extraction is the fallback used whenever no
 * tool call carries the answer (every round-1 outcome, and any round-2
 * outcome that does not recommend the inspection) -- both the scripted
 * `DECISION_TEXT_ROUND1`/`DECISION_TEXT_ROUND2` strings
 * (`scripted-beats/home-energy-guardian.ts`) always name the recommended
 * option id in parentheses immediately after "Recommend...", which this
 * regex targets first; a secondary substring scan against every known
 * option id is the fallback of last resort.
 *
 * Exported for the same direct-unit-testability reason as
 * `foldHomeEnergyRound1`/`foldHomeEnergyRound2` above.
 */
export function extractFavoredResponseOptionId(text: string): string | null {
  const match = /Recommend[^()]*\(([a-z0-9-]+)\)/i.exec(text);
  const fromRecommendClause = match?.[1]?.toLowerCase();
  if (
    fromRecommendClause !== undefined &&
    KNOWN_RESPONSE_OPTION_IDS.includes(fromRecommendClause)
  ) {
    return fromRecommendClause;
  }
  return KNOWN_RESPONSE_OPTION_IDS.find((id) => text.includes(id)) ?? null;
}

/** Every non-empty `limitations` entry any node's captured context carried, de-duplicated -- used to ground `Recommendation.limitations` in what the Swarm's specialists actually reported rather than inventing generic prose. */
function collectLimitations(
  contexts: Partial<Record<HomeEnergySwarmNodeId, ExecutionResult>>,
): string[] {
  const seen = new Set<string>();
  for (const context of Object.values(contexts)) {
    for (const limitation of context?.limitations ?? []) {
      seen.add(limitation);
    }
  }
  return [...seen];
}

/** `resolvedObligationIds`/`acceptedUncertaintyObligationIds` computed from the real, current obligation statuses -- never hardcoded, so this stays correct regardless of exactly which obligations the deterministic core (`advanceObligation`) resolved to which status. */
function obligationIdsByStatus(
  snapshot: CaseState,
  status: 'satisfied' | 'accepted_uncertainty',
): string[] {
  return snapshot.obligations.filter((obligation) => obligation.status === status).map((o) => o.id);
}

/**
 * Folds round 1: the four sequential specialists' contexts, then
 * `source-challenger`'s corroboration, then a synthesized `evidence_found`
 * result for `energy.response_options` from `decision-synthesizer`'s final
 * ranking text, then a soft initial `recommendation.ready` lean (no
 * proposal -- home-energy-guardian has no round-1-only proposal moment, the
 * Swarm's one consequential effect, `propose_inspection`, is only ever
 * exercised in round 2). Mirrors `car-purchase-engine.ts`'s `foldRound1`
 * shape using the same reused fold helpers.
 *
 * Exported for the same direct-unit-testability reason
 * `car-purchase-engine.ts`'s own `foldRound1`/`foldRound2` are: its
 * defensive "the real Swarm produced no context for node X" throw guards
 * can be tested directly against a hand-built plain-data
 * `HomeEnergySwarmResult`, without needing to coerce the real Swarm itself
 * into omitting a node's result.
 */
export function foldHomeEnergyRound1(
  deps: HomeEnergyEngineDeps,
  caseId: string,
  swarmResult: HomeEnergySwarmResult,
): CaseState {
  const scenarioDeps = scenarioFoldDeps(deps);
  const trajectory = emptyScenarioTrajectory();

  for (const specialistId of HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS) {
    const context = swarmResult.contexts[specialistId];
    if (context === undefined) {
      throw new Error(
        `home-energy-engine: round1 produced no context for "${specialistId}" on case "${caseId}"`,
      );
    }
    foldExecutionResult(
      deps.caseStore,
      deps.activityStore,
      caseId,
      context,
      scenarioDeps,
      trajectory,
      {
        attemptsToRecord: 1,
      },
    );
  }

  const challengeContext = swarmResult.contexts['source-challenger'];
  if (challengeContext === undefined) {
    throw new Error(
      `home-energy-engine: round1 produced no context for "source-challenger" on case "${caseId}"`,
    );
  }
  // source-challenger corroborates the evidence chain rather than making its
  // own attempt at an obligation -- mirrors car-purchase-engine.ts's
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
      obligationId: 'energy.response_options',
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
        summary: 'Cited in the response-options synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    scenarioDeps,
    trajectory,
    { attemptsToRecord: 1 },
  );

  const favoredOptionId = extractFavoredResponseOptionId(swarmResult.decisionSynthesizerText);
  if (favoredOptionId === null) {
    throw new Error(
      `home-energy-engine: round1 decision-synthesizer text named no known response option for case "${caseId}"`,
    );
  }

  // The model proposed `favoredOptionId`; the deterministic scoreboard
  // supplies the numbers attached to it. When the two disagree, the
  // proposal stands but `limitations` says so outright and confidence is
  // capped -- see recommendation-scoring.ts for why neither silently
  // overwriting nor silently accepting is acceptable here.
  const scored = deriveScoredRecommendationFields(snapshot, favoredOptionId);
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
        favoredOptionId,
        rationale: stripInlineSourceCitations(swarmResult.decisionSynthesizerText),
        facts: scored.facts,
        hypotheses: [],
        confidence: scored.confidence,
        limitations: mergeLimitations(collectLimitations(swarmResult.contexts), scored.limitations),
        sourceIds,
        resolvedObligationIds: obligationIdsByStatus(snapshot, 'satisfied'),
        acceptedUncertaintyObligationIds: obligationIdsByStatus(snapshot, 'accepted_uncertainty'),
        generatedAt: deps.clock.now(),
      },
    },
  };
  const appended = deps.caseStore.append(caseId, [recommendationEvent], snapshot.eventSequence);
  if (appended.status !== 'applied') {
    throw new Error(
      `home-energy-engine: failed to record the round1 recommendation for case "${caseId}": status "${appended.status}"`,
    );
  }
  appendActivity(deps.activityStore, deps.clock, caseId, {
    type: 'recommendation.ready',
    phase: 'completed',
    summary: `Initial recommendation ready: favoring "${favoredOptionId}".`,
  });
  return appended.snapshot;
}

/**
 * Folds round 2: `decision-synthesizer`'s revised response-options ranking
 * (the only node the Swarm re-visits -- `home-energy-swarm.test.ts`'s own
 * round-2 case starts directly at `decision-synthesizer`, since nothing
 * about the confirmed anomaly/rate/weather/household-event evidence
 * changes, only the household's cost/conservation weighting), a revised
 * `recommendation.ready`, and -- only when `decision-synthesizer` genuinely
 * called `propose_inspection` -- a pending `proposal.proposed` requiring
 * human review. Mirrors `car-purchase-engine.ts`'s `foldRound2` shape,
 * simplified to this pack's actual round-2 scope (no stale-evidence
 * supersession or hard-constraints re-derivation obligation exists for this
 * pack).
 *
 * Exported for the same direct-unit-testability reason as
 * `foldHomeEnergyRound1` above.
 */
export function foldHomeEnergyRound2(
  deps: HomeEnergyEngineDeps,
  caseId: string,
  swarmResult: HomeEnergySwarmResult,
): CaseState {
  const scenarioDeps = scenarioFoldDeps(deps);
  const trajectory = emptyScenarioTrajectory();

  const initialSnapshot = loadSnapshotOrThrow(deps.caseStore, caseId);
  const sourceIds = extractCitedSourceIds(swarmResult.decisionSynthesizerText);
  ensureSourcesExist(deps.caseStore, caseId, initialSnapshot.eventSequence, sourceIds, deps.clock);

  // A re-synthesis corroborating/revising the same obligation, not a fresh
  // "attempt" at it (matches source-challenger's `attemptsToRecord: 0`
  // corroboration rationale above) -- `energy.response_options` is already
  // `satisfied` from round 1; this records the household's revised evidence
  // without consuming the obligation's own attempt budget a second time.
  // foldExecutionResult re-loads the case fresh internally, so its return
  // value (not the pre-ensureSourcesExist snapshot above) is this
  // function's one live source of truth from here on.
  let snapshot = foldExecutionResult(
    deps.caseStore,
    deps.activityStore,
    caseId,
    {
      obligationId: 'energy.response_options',
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
        summary: 'Cited in the revised response-options synthesis.',
      })),
      limitations: [],
      suggestedStatus: 'satisfied',
    },
    scenarioDeps,
    trajectory,
    { attemptsToRecord: 0 },
  );

  const favoredOptionId =
    swarmResult.proposedInspection?.optionId ??
    extractFavoredResponseOptionId(swarmResult.decisionSynthesizerText);
  if (favoredOptionId === null) {
    throw new Error(
      `home-energy-engine: round2 decision-synthesizer text named no known response option for case "${caseId}"`,
    );
  }

  // The model proposed `favoredOptionId`; the deterministic scoreboard
  // supplies the numbers attached to it. When the two disagree, the
  // proposal stands but `limitations` says so outright and confidence is
  // capped -- see recommendation-scoring.ts for why neither silently
  // overwriting nor silently accepting is acceptable here.
  const scored = deriveScoredRecommendationFields(snapshot, favoredOptionId);
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
        favoredOptionId,
        rationale: stripInlineSourceCitations(swarmResult.decisionSynthesizerText),
        facts: scored.facts,
        hypotheses: [],
        confidence: scored.confidence,
        limitations: mergeLimitations(collectLimitations(swarmResult.contexts), scored.limitations),
        sourceIds,
        resolvedObligationIds: obligationIdsByStatus(snapshot, 'satisfied'),
        acceptedUncertaintyObligationIds: obligationIdsByStatus(snapshot, 'accepted_uncertainty'),
        generatedAt: deps.clock.now(),
      },
    },
  };
  const recAppend = deps.caseStore.append(caseId, [recommendationEvent], snapshot.eventSequence);
  if (recAppend.status !== 'applied') {
    throw new Error(
      `home-energy-engine: failed to record the round2 recommendation for case "${caseId}": status "${recAppend.status}"`,
    );
  }
  snapshot = recAppend.snapshot;
  appendActivity(deps.activityStore, deps.clock, caseId, {
    type: 'recommendation.ready',
    phase: 'completed',
    summary: `Revised recommendation ready: favoring "${favoredOptionId}".`,
  });

  if (swarmResult.proposedInspection === undefined) {
    // The reweighted criteria still did not favor the one consequential
    // option -- there is nothing pending human confirmation this round.
    return snapshot;
  }

  // Sift proposes; only a human may approve via the separate `reviewProposal`
  // command (never called here -- see this file's header comment).
  const proposalEvent: CaseEvent = {
    eventId: deps.idGenerator.next('event'),
    caseId,
    sequence: snapshot.eventSequence + 1,
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
  const proposalAppend = deps.caseStore.append(caseId, [proposalEvent], snapshot.eventSequence);
  if (proposalAppend.status !== 'applied') {
    throw new Error(
      `home-energy-engine: failed to create the decision proposal for case "${caseId}": status "${proposalAppend.status}"`,
    );
  }
  appendActivity(deps.activityStore, deps.clock, caseId, {
    type: 'intervention.confirmation_required',
    phase: 'waiting',
    summary: 'A proposal to request an HVAC/thermostat inspection is awaiting human review.',
  });
  return proposalAppend.snapshot;
}

async function runOneInvestigation(
  params: { caseId: string; runId: string; obligationId: string },
  deps: HomeEnergyEngineDeps,
): Promise<void> {
  try {
    const initialSnapshot = deps.caseStore.load(params.caseId);
    if (initialSnapshot === undefined) {
      throw new Error(`home-energy-engine: case "${params.caseId}" was not found`);
    }
    const pack = deps.registry.get(initialSnapshot.pack.id, initialSnapshot.pack.version);
    if (pack === undefined) {
      throw new Error(
        `home-energy-engine: pinned pack "${initialSnapshot.pack.id}@${initialSnapshot.pack.version}" is not registered`,
      );
    }

    const round = determineHomeEnergyRound(initialSnapshot);

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

    const providers = buildHomeEnergySwarmScriptedProviders(deps.demoPacingMs ?? 0);
    setScenarioBeat(providers, round);
    const swarmDeps = buildHomeEnergySwarmDepsFromCase(
      initialSnapshot,
      pack,
      providers,
      scenarioFoldDeps(deps),
      round === 'round2' ? 'decision-synthesizer' : undefined,
    );

    // --- One trace per run, not two -- the identical correction
    // `car-purchase-engine.ts`'s `runOneInvestigation` documents in full.
    // The Swarm mints the trace every `runtime_events` row carries
    // (`home-energy-swarm.ts`'s `RunAccumulator.traceId`); the run row now
    // records that same id instead of a second, unrelated one that the
    // Runtime Inspector's Overview showed under "Trace" while matching no
    // event in the Timeline.
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
      executeHomeEnergySwarm(swarmDeps),
      { caseId: params.caseId, runId: params.runId },
      deps.activityStore,
      deps.runtimeEventStore,
      deps.clock,
      recordTraceId,
    );

    const finalSnapshot =
      round === 'round1'
        ? foldHomeEnergyRound1(deps, params.caseId, swarmResult)
        : foldHomeEnergyRound2(deps, params.caseId, swarmResult);

    // --- I3: one real, whole-run before/after case-state diff (see
    // event-normalizer.ts's normalizeCaseStateChange doc comment for why
    // this is a whole-run diff, not a per-CaseEvent one). Skipped only when
    // the run genuinely changed nothing (never expected for a completed
    // investigation, but a defensive guard against a vacuous event). ---
    const stateDiff = diffJsonValues(initialSnapshot, finalSnapshot);
    if (stateDiff.length > 0) {
      deps.runtimeEventStore.append(
        normalizeCaseStateChange(
          { stateDiff },
          {
            // The same one trace the run row and every other event for
            // this run carry. A trace is minted here only if the Swarm
            // yielded no events at all (never expected) -- and
            // `recordTraceId` puts that id on the run row too, so the
            // Overview's "Trace" still names this run's one event rather
            // than nothing.
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
    // Same last-resort pattern car-purchase-engine.ts documents: logged
    // unconditionally first (a run must never silently stay
    // "running"/"queued" forever with no inspectable trace), then the two
    // durable writes are attempted best-effort.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[sift] home-energy-engine: run "${params.runId}" for case "${params.caseId}" failed: ${message}`,
    );
    try {
      deps.runStore.updateStatus(params.runId, {
        status: 'failed',
        updatedAt: deps.clock.now(),
        result: { error: message },
      });
    } catch (updateError) {
      console.error(
        `[sift] home-energy-engine: failed to record run "${params.runId}" as failed:`,
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
        `[sift] home-energy-engine: failed to append a run.failed activity event for run "${params.runId}":`,
        activityError,
      );
    }
  }
}

/**
 * Builds the live `home-energy-guardian` `InvestigationEngine`. `RunService`
 * looks this up by pack id (`server.ts` registers it under
 * `'home-energy-guardian'`) and fires `trigger` after durably accepting a
 * run, without ever awaiting it.
 */
export function createHomeEnergyEngine(deps: HomeEnergyEngineDeps): HomeEnergyEngine {
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
