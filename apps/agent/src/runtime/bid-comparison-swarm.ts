/**
 * The real, code-driven Bid Comparison Strands `Swarm`
 * (docs/bid-comparison/plan.md "Orchestration: Strands Swarm, not Graph" --
 * `packages/packs/src/bid-comparison.ts`'s own module header: "Three of the
 * four measurement obligations ... can genuinely investigate independently
 * rather than through one fixed sequence, and the plan's own 'Guide' beat
 * ... is precisely the repeated-work-without-evidence-gain steering shape
 * docs/specs/strands-runtime.md 'Energy Swarm' describes for its bounded
 * Swarm, not a rigid Graph topology").
 *
 * This is `home-energy-swarm.ts`'s direct structural sibling: the same
 * composition (`AgentSkills`/`ContextInjector`/`RetrySteering`/
 * `ScopeAuthorization`/`ConsequenceGuard`/`BudgetGuard`/
 * `EvidenceQualitySteering`/`OutputSanitizer`/`GoalLoop`) applied to a
 * different Decision Pack, its own six real `Agent`s, and its own real
 * `Swarm`. Every helper below (`RunAccumulator`, the event emitters,
 * `buildInterventions`, `wireAgentHooks`, `assertSkillsRootDirExists`,
 * `filterToolsByName`, `extractHandoffContext`/`deriveHandoffReason`/
 * `deriveEvidenceDelta`) is deliberately re-implemented locally rather than
 * imported from `home-energy-swarm.ts`, for the identical reason that
 * file's own header gives for not importing `car-purchase-graph.ts`'s
 * versions: each Graph/Swarm construction file composes the same *exported*
 * building blocks (`interventions.ts`/`plugins.ts`/`event-normalizer.ts`)
 * into its own topology-specific wiring, and this task's file scope forbids
 * introducing a new shared module or editing an existing runtime file to
 * export them.
 *
 * Topology (docs/bid-comparison/plan.md "Specialists and skills" -- "`scope-
 * analyst` ... -> `price-analyst` ... -> `credential-checker` ... ->
 * `schedule-analyst` ... -> `source-challenger` ... -> `decision-
 * synthesizer`"): the six specialists `scope-analyst`, `price-analyst`,
 * `credential-checker`, `schedule-analyst`, `source-challenger`,
 * `decision-synthesizer` -- matching `bid-comparison.ts`'s compiled pack
 * `specialists[]` declaration order exactly -- run as a strict sequential
 * handoff chain in the shipped scripted trajectory (mirroring
 * `home-energy-swarm.ts`'s own shipped round1 trajectory, which is likewise
 * sequential even though `energy.rate_change`/`energy.weather` could in
 * principle proceed in either order): `bid.scope_normalization` must
 * resolve before price verification can compute a scope-normalized total;
 * `bid.credential_verification` and `bid.schedule_feasibility` can
 * genuinely proceed independently of price and of each other (each reads
 * its own separate document), but the scripted demo visits them in the
 * plan's own stated order rather than concurrently, exactly as
 * `home-energy-swarm.ts`'s own docstring documents for its analogous
 * sequential specialists. `bid.award_recommendation` (owned jointly by
 * `source-challenger` and `decision-synthesizer`, mirroring
 * `home-energy-swarm.ts`'s `responseOptionsRequest` reuse across
 * `source-challenger`/`decision-synthesizer`) depends on all four
 * measurement obligations.
 *
 * The same three documented, verified, real API differences from
 * `car-purchase-graph.ts` that `home-energy-swarm.ts`'s module header
 * records for the installed `@strands-agents/sdk@1.14.0` apply identically
 * here (a Swarm node's `structuredOutputSchema` is always the SDK's own
 * dynamically-built handoff schema; `decision-synthesizer`'s `GoalLoop`
 * validator must therefore read the `strands_structured_output` tool-use
 * block's `input.message`, not a `TextBlock`; `decision-synthesizer` has no
 * `ContextInjector`, so case-summary facts and the known, deterministic bid
 * facts are baked directly into its system prompt instead).
 */
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { z } from 'zod';
import {
  Agent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  tool,
  type BaseModelConfig,
  type InterventionHandler,
  type JSONValue,
  type Message,
  type Model,
  type ToolList,
  type ToolUseBlock,
} from '@strands-agents/sdk';
import {
  Swarm,
  BeforeNodeCallEvent,
  NodeResultEvent,
  MultiAgentHandoffEvent,
  type MultiAgentResult,
} from '@strands-agents/sdk/multiagent';
import type { Validator } from '@strands-agents/sdk/vended-plugins/goal';
import type { Clock, IdGenerator } from '@sift/core';
import {
  ExecutionResultSchema,
  type CompiledDecisionPack,
  type ExecutionRequest,
  type ExecutionResult,
  type RuntimeDebugEvent,
} from '@sift/contracts';
import {
  BID_READER_TOOL_ID,
  SCOPE_DIFFER_TOOL_ID,
  BID_CALCULATOR_TOOL_ID,
  LICENSE_LOOKUP_TOOL_ID,
  readBid,
  compareBidScope,
  calculateBidEconomics,
  lookupLicense,
} from '@sift/scenarios';
import {
  BudgetGuard,
  ConsequenceGuard,
  EvidenceQualitySteering,
  OutputSanitizer,
  RetrySteering,
  ScopeAuthorization,
  ToolLedger,
  type InterventionEvent,
} from './interventions.js';
import {
  buildContextInjector,
  buildDecisionSynthesizerAgent,
  buildSkillsPlugin,
} from './plugins.js';
import { SDK_INTERNAL_TOOL_NAMES } from './strands-adapter.js';
import {
  createSequenceCounter,
  normalizeAfterModelCall,
  normalizeAfterToolCall,
  normalizeBeforeModelCall,
  normalizeBeforeToolCall,
  normalizeGoalValidation,
  normalizeIntervention,
  normalizeSkillActivation,
  type NormalizerContext,
  type RuntimeEvent,
} from './event-normalizer.js';
import { RuntimeEventQueue } from './runtime-event-queue.js';

// --- Tool ids ---

/** `propose_award`'s tool id -- the pack's one consequential effect (packages/packs/src/bid-comparison.ts), mirroring `PROPOSE_INSPECTION_TOOL_ID`. */
export const PROPOSE_AWARD_TOOL_ID = 'propose_award';

// --- Node ids ---

/** The four sequential, obligation-owning specialists the Swarm always visits before the award-recommendation synthesis pair (docs/bid-comparison/plan.md "Specialists and skills" causal chain). */
export const BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS = [
  'scope-analyst',
  'price-analyst',
  'credential-checker',
  'schedule-analyst',
] as const;
export type BidComparisonSequentialSpecialistId =
  (typeof BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS)[number];

/** Every node id in this Swarm, in the compiled bid-comparison pack's `specialists[]` declaration order (docs/bid-comparison/plan.md "Specialists and skills"). */
export const BID_COMPARISON_SWARM_NODE_IDS = [
  ...BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS,
  'source-challenger',
  'decision-synthesizer',
] as const;
export type BidComparisonSwarmNodeId = (typeof BID_COMPARISON_SWARM_NODE_IDS)[number];

// --- Real fixture tools, wrapped as real Strands `Tool`s via `tool()` ---
// packages/scenarios/src/tools/{bid-reader,scope-differ,bid-calculator,
// license-lookup}.ts's exact functions, per this task's brief.

function buildBidReaderTool() {
  return tool({
    name: BID_READER_TOOL_ID,
    description:
      "Reads a subcontractor's bid document (contractor, quoted total, line items, deposit terms, warranty, and schedule) from fixture data.",
    inputSchema: z.object({ bidId: z.string() }),
    callback: (input, context) =>
      readBid({
        bidId: input.bidId,
        ...(context?.cancelSignal !== undefined ? { signal: context.cancelSignal } : {}),
      }),
  });
}

function buildScopeDifferTool() {
  return tool({
    name: SCOPE_DIFFER_TOOL_ID,
    description:
      'Compares the scope covered by two or more bids and returns which items are priced by some bids but excluded by others. Omit bidIds to compare every bid invited to this job.',
    inputSchema: z.object({ bidIds: z.array(z.string()).optional() }),
    callback: (input, context) =>
      compareBidScope({
        ...(input.bidIds !== undefined ? { bidIds: input.bidIds } : {}),
        ...(context?.cancelSignal !== undefined ? { signal: context.cancelSignal } : {}),
      }),
  });
}

function buildBidCalculatorTool() {
  return tool({
    name: BID_CALCULATOR_TOOL_ID,
    description:
      "Performs the deterministic arithmetic behind a bid's line-item sum, allowances, and scope-normalized adjusted total. Supply plugNumbers (dollar estimates keyed by scopeItemId) for any required scope item this bid leaves absent, or the adjusted total is reported as an explicit unknown.",
    inputSchema: z.object({
      bidId: z.string(),
      plugNumbers: z.record(z.string(), z.number()).optional(),
    }),
    callback: (input, context) =>
      calculateBidEconomics({
        bidId: input.bidId,
        ...(input.plugNumbers !== undefined ? { plugNumbers: input.plugNumbers } : {}),
        ...(context?.cancelSignal !== undefined ? { signal: context.cancelSignal } : {}),
      }),
  });
}

function buildLicenseLookupTool() {
  return tool({
    name: LICENSE_LOOKUP_TOOL_ID,
    description:
      "Reads a contractor's license status and certificate-of-insurance named insured from a fixture license registry.",
    inputSchema: z.object({ licenseNumber: z.string() }),
    callback: (input, context) =>
      lookupLicense({
        licenseNumber: input.licenseNumber,
        ...(context?.cancelSignal !== undefined ? { signal: context.cancelSignal } : {}),
      }),
  });
}

function buildProposeAwardTool() {
  return tool({
    name: PROPOSE_AWARD_TOOL_ID,
    description:
      'Creates the consequential proposal to award the bid to a subcontractor. Requires explicit human confirmation before the call proceeds. Does not execute or sign a contract.',
    inputSchema: z.object({
      bidId: z.string(),
      rationale: z.string(),
    }),
    callback: (input) => ({
      status: 'proposed',
      bidId: input.bidId,
      rationale: input.rationale,
    }),
  });
}

/** Every real fixture tool this pack's specialists use, wrapped as real Strands `Tool`s, plus the gated `propose_award` consequential tool. */
export function buildBidComparisonFixtureTools(): ToolList {
  return [
    buildBidReaderTool(),
    buildScopeDifferTool(),
    buildBidCalculatorTool(),
    buildLicenseLookupTool(),
    buildProposeAwardTool(),
  ];
}

function filterToolsByName(tools: ToolList, allowedNames: readonly string[]): ToolList {
  return tools.filter((entry) => 'name' in entry && allowedNames.includes(entry.name));
}

/** `pack.specialists[].allowedTools` for `nodeId`, code-driven from the compiled pack (never hand-duplicated) -- strands-runtime.md "Orchestration": "Graph construction is code-driven from validated compiled pack declarations," applied identically to Swarm construction. */
function specialistAllowedTools(pack: CompiledDecisionPack, nodeId: string): string[] {
  const specialist = pack.specialists.find((entry) => entry.id === nodeId);
  if (specialist === undefined) {
    throw new Error(
      `bid-comparison-swarm: compiled pack "${pack.identity.id}@${pack.identity.version}" declares no specialist "${nodeId}"`,
    );
  }
  return [...specialist.allowedTools];
}

/** `pack.specialists[].description` for `nodeId`, used both for the Swarm's own handoff-routing schema text (`AgentNode`'s `config.description`, derived from `Agent.description`) and this node's system prompt. */
function specialistDescription(pack: CompiledDecisionPack, nodeId: string): string {
  const specialist = pack.specialists.find((entry) => entry.id === nodeId);
  if (specialist === undefined) {
    throw new Error(
      `bid-comparison-swarm: compiled pack "${pack.identity.id}@${pack.identity.version}" declares no specialist "${nodeId}"`,
    );
  }
  return specialist.description;
}

export interface BidComparisonSwarmDeps {
  /** The validated, compiled `bid-comparison` pack. Node tool grants come from `pack.specialists[].allowedTools` -- code-driven, never hand-duplicated. */
  pack: CompiledDecisionPack;
  /** Selects the model each node's `Agent` uses. A distinct `ScriptedModelProvider` instance per node is required for deterministic tests -- see `HomeEnergySwarmDeps.modelFor`'s identical rationale. */
  modelFor: (nodeId: BidComparisonSwarmNodeId) => Model<BaseModelConfig> | string;
  skillsRootDir: string;
  clock: Clock;
  idGenerator: IdGenerator;
  /** One `ExecutionRequest` per sequential specialist, each carrying that specialist's own active obligation (bid.scope_normalization / bid.price_verification / bid.credential_verification / bid.schedule_feasibility). */
  specialistRequests: Record<BidComparisonSequentialSpecialistId, ExecutionRequest>;
  /** `source-challenger` and `decision-synthesizer`'s shared `ExecutionRequest` (obligation `bid.award_recommendation`), mirroring `home-energy-swarm.ts`'s `responseOptionsRequest` reuse across `source-challenger`/`decision-synthesizer`. */
  awardRecommendationRequest: ExecutionRequest;
  /** The node the Swarm starts at. Defaults to `'scope-analyst'` (docs/bid-comparison/plan.md: scope normalization must resolve before price verification can compute a scope-normalized total). Overridable so a focused test can start mid-chain (e.g. at `'decision-synthesizer'` to exercise a criteria reweight) without re-scripting every upstream specialist. */
  start?: BidComparisonSwarmNodeId;
  /** Defaults to `[PROPOSE_AWARD_TOOL_ID]` -- the pack's one consequential effect. */
  consequentialToolIds?: readonly string[];
  forbiddenToolIds?: readonly string[];
  /** Deterministic fixture-mode confirmation resolver for `ConsequenceGuard`. See `strands-adapter.ts`. */
  resolveConfirmation?: (toolName: string, input: JSONValue) => JSONValue | undefined;
  /** Overrides `decision-synthesizer`'s system prompt. Defaults to a prompt built from `awardRecommendationRequest` plus the static, known bid facts (see module header). */
  decisionSynthesizerSystemPrompt?: string;
  /** Overrides `decision-synthesizer`'s `GoalLoop` validator. Defaults to `DEFAULT_SYNTHESIZER_VALIDATOR`. */
  decisionSynthesizerValidator?: Validator;
  /** Overrides the Swarm's `invoke()` input. Every node builds its own instructions from its own `ExecutionRequest`'s injected context, so this text only needs to identify the run at a high level. Defaults to a prompt built from the starting node's own request. */
  invokePrompt?: string;
  /** Overrides `GoalLoop.maxAttempts`. Defaults to `2` (strands-runtime.md "GoalLoop output validation"). */
  goalLoopMaxAttempts?: number;
  /** Per-node `RetrySteering` alternative-technique hint (strands-runtime.md: "The guidance identifies an allowed alternative technique from the active skill."). */
  alternativeTechniqueHints?: Partial<Record<BidComparisonSwarmNodeId, string>>;
  /** Elapsed-millisecond source used only to measure real per-node durations for `RuntimeDebugEvent.durationMs` on `swarm.node_completed`. Defaults to wall-clock `Date.now`. Identical rationale to `HomeEnergySwarmDeps.nowMs`. */
  nowMs?: () => number;
}

/** One real Swarm handoff, normalized from the SDK's `MultiAgentHandoffEvent` plus the completed source node's parsed `context` (strands-runtime.md "Energy Swarm": "A handoff emits `swarm.handoff`"; debugging-and-observability.md: "Swarm handoff source, target, reason, evidence delta, and cycle counter"). */
export interface BidComparisonSwarmHandoff {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly evidenceDelta: number;
}

/** `goalLoop.lastResult(agent)`'s shape, re-declared narrowly here so this module does not need to import the SDK's own (unexported-by-name) GoalLoop result type -- identical rationale to `HomeEnergySwarmGoalLoopResult`. */
export interface BidComparisonSwarmGoalLoopResult {
  readonly passed: boolean;
  readonly stopReason: string;
  readonly attempts: readonly { passed: boolean; feedback?: string }[];
}

export interface BidComparisonSwarmResult {
  readonly multiAgentResult: MultiAgentResult;
  /** Node ids in the order their `BeforeNodeCallEvent` fired (real Swarm scheduling order). */
  readonly nodeStartOrder: string[];
  /** Node ids in the order their `NodeResultEvent` fired (real Swarm completion order). */
  readonly nodeFinishOrder: string[];
  /** Every real handoff the Swarm made, in order. */
  readonly handoffs: readonly BidComparisonSwarmHandoff[];
  /** The validated `context` (`ExecutionResult`-shaped) each node's handoff structured output carried, keyed by node id. */
  readonly contexts: Partial<Record<BidComparisonSwarmNodeId, ExecutionResult>>;
  /** `decision-synthesizer`'s final GoalLoop-validated handoff `message`. */
  readonly decisionSynthesizerText: string;
  /** The `propose_award` tool call `decision-synthesizer` made, captured from its `beforeToolCall` hook -- undefined if it never called the tool. */
  readonly proposedAward: { bidId: string; rationale: string } | undefined;
  readonly goalLoopResult: BidComparisonSwarmGoalLoopResult | undefined;
  /** `true` when the Swarm's own hard repetitive-handoff safety net tripped. Should never be `true` in the deterministic demo trajectory -- Sift's own `RetrySteering` must trip first. */
  readonly repetitiveHandoffDetected: boolean;
}

/** The handoff schema shape every Swarm node's `strands_structured_output` call produces (see `home-energy-swarm.ts`'s module header for the full, verified derivation). */
interface SwarmHandoffOutput {
  agentId?: string;
  message: string;
  context?: Record<string, unknown>;
}

function extractHandoffContext(structuredOutput: unknown): ExecutionResult | undefined {
  if (
    structuredOutput === null ||
    typeof structuredOutput !== 'object' ||
    !('context' in structuredOutput)
  ) {
    return undefined;
  }
  const context = (structuredOutput as { context?: unknown }).context;
  if (context === undefined) return undefined;
  const parsed = ExecutionResultSchema.safeParse(context);
  return parsed.success ? parsed.data : undefined;
}

/** Derives a human-readable `swarm.handoff` reason from the source node's parsed context. Same documented judgment call as `home-energy-swarm.ts`'s `deriveHandoffReason`: prefer the first limitation, then the first claim, then the suggested status. */
function deriveHandoffReason(context: ExecutionResult | undefined): string {
  if (context === undefined) return 'handoff (no structured context provided)';
  if (context.limitations.length > 0) return context.limitations[0]!;
  if (context.claims.length > 0) return context.claims[0]!.statement;
  return `disposition: ${context.disposition}`;
}

/** Evidence delta for a `swarm.handoff` event: the count of newly passing evidence items the source node's context carried. */
function deriveEvidenceDelta(context: ExecutionResult | undefined): number {
  return context?.evidenceResults.filter((result) => result.verdict === 'pass').length ?? 0;
}

/**
 * Collected mutable state one call to `executeBidComparisonSwarm` accumulates
 * across every node's hooks -- one run, one shared queue, one shared
 * monotonic `sequence`, identical rationale to `home-energy-swarm.ts`'s
 * `RunAccumulator`.
 */
interface RunAccumulator {
  queue: RuntimeEventQueue<RuntimeEvent>;
  sequence: () => number;
  traceId: string;
  runId: string;
  caseId: string;
  sessionId?: string;
  nodeDurations: NodeDurationTracker;
}

// --- Per-node duration (RuntimeDebugEvent.durationMs on swarm node events) ---

/** Records one node's real start reading and closes it into an elapsed interval. See `createNodeDurationTracker`. */
export interface NodeDurationTracker {
  noteNodeStart(nodeId: string): void;
  measureNode(nodeId: string): number | undefined;
}

/** Measures how long each Swarm node genuinely took. Identical rationale and mechanics to `home-energy-swarm.ts`'s `createNodeDurationTracker`. */
export function createNodeDurationTracker(
  now: () => number = () => Date.now(),
): NodeDurationTracker {
  const startedAt = new Map<string, number>();
  return {
    noteNodeStart(nodeId: string): void {
      startedAt.set(nodeId, now());
    },
    measureNode(nodeId: string): number | undefined {
      const started = startedAt.get(nodeId);
      startedAt.delete(nodeId);
      return started === undefined ? undefined : Math.max(0, Math.round(now() - started));
    },
  };
}

function emitSwarmNodeEvent(
  acc: RunAccumulator,
  params: { nodeId: string; phase: 'start' | 'finish'; status?: string },
): void {
  if (params.phase === 'start') {
    acc.nodeDurations.noteNodeStart(params.nodeId);
  }
  const durationMs =
    params.phase === 'start' ? undefined : acc.nodeDurations.measureNode(params.nodeId);
  const event: RuntimeDebugEvent = {
    schemaVersion: '1.0',
    sequence: acc.sequence(),
    timestamp: new Date().toISOString(),
    traceId: acc.traceId,
    caseId: acc.caseId,
    runId: acc.runId,
    ...(acc.sessionId !== undefined ? { sessionId: acc.sessionId } : {}),
    agentId: params.nodeId,
    category: 'swarm',
    name: params.phase === 'start' ? 'swarm.node_started' : 'swarm.node_completed',
    phase: params.phase === 'start' ? 'start' : 'finish',
    level: 'info',
    ...(durationMs !== undefined ? { durationMs } : {}),
    summary:
      params.phase === 'start'
        ? `Swarm node "${params.nodeId}" started.`
        : `Swarm node "${params.nodeId}" completed with status "${params.status ?? 'unknown'}".`,
    attributes: {
      nodeId: params.nodeId,
      ...(params.status !== undefined ? { status: params.status } : {}),
    },
    redactions: [],
  };
  acc.queue.push(event);
}

function emitSwarmHandoffEvent(acc: RunAccumulator, handoff: BidComparisonSwarmHandoff): void {
  const event: RuntimeDebugEvent = {
    schemaVersion: '1.0',
    sequence: acc.sequence(),
    timestamp: new Date().toISOString(),
    traceId: acc.traceId,
    caseId: acc.caseId,
    runId: acc.runId,
    ...(acc.sessionId !== undefined ? { sessionId: acc.sessionId } : {}),
    category: 'swarm',
    name: 'swarm.handoff',
    phase: 'finish',
    level: 'info',
    summary: `Swarm handoff: "${handoff.from}" -> "${handoff.to}" (${handoff.reason}).`,
    attributes: {
      from: handoff.from,
      to: handoff.to,
      reason: handoff.reason,
      evidenceDelta: handoff.evidenceDelta,
    },
    redactions: [],
  };
  acc.queue.push(event);
}

function emitSwarmCycleDetectedEvent(acc: RunAccumulator, message: string): void {
  const event: RuntimeDebugEvent = {
    schemaVersion: '1.0',
    sequence: acc.sequence(),
    timestamp: new Date().toISOString(),
    traceId: acc.traceId,
    caseId: acc.caseId,
    runId: acc.runId,
    ...(acc.sessionId !== undefined ? { sessionId: acc.sessionId } : {}),
    category: 'swarm',
    name: 'swarm.cycle_detected',
    phase: 'error',
    level: 'warn',
    summary: `Swarm repetitive-handoff safety net tripped: ${message}`,
    attributes: {},
    redactions: [],
  };
  acc.queue.push(event);
}

function emitSwarmTimeoutEvent(acc: RunAccumulator, message: string): void {
  const event: RuntimeDebugEvent = {
    schemaVersion: '1.0',
    sequence: acc.sequence(),
    timestamp: new Date().toISOString(),
    traceId: acc.traceId,
    caseId: acc.caseId,
    runId: acc.runId,
    ...(acc.sessionId !== undefined ? { sessionId: acc.sessionId } : {}),
    category: 'swarm',
    name: 'swarm.timeout',
    phase: 'error',
    level: 'error',
    summary: `Swarm exceeded its configured wall-clock budget: ${message}`,
    attributes: {},
    redactions: [],
  };
  acc.queue.push(event);
}

function buildInterventions(
  deps: {
    runId: string;
    obligationId: string;
    clock: Clock;
    allowedTools: readonly string[];
    consequentialToolIds: readonly string[];
    forbiddenToolIds: readonly string[];
    resolveConfirmation?: (toolName: string, input: JSONValue) => JSONValue | undefined;
    maxToolCallsPerRun: number;
    attemptsUsedForObligation: number;
    maxAttemptsPerObligation: number;
    alternativeTechniqueHint?: string;
  },
  emit: (event: InterventionEvent) => void,
): InterventionHandler[] {
  const ledger = new ToolLedger();
  return [
    new ScopeAuthorization({
      runId: deps.runId,
      obligationId: deps.obligationId,
      clock: deps.clock,
      emit,
      allowedTools: deps.allowedTools,
    }),
    new ConsequenceGuard({
      runId: deps.runId,
      obligationId: deps.obligationId,
      clock: deps.clock,
      emit,
      consequentialToolIds: deps.consequentialToolIds,
      forbiddenToolIds: deps.forbiddenToolIds,
      ...(deps.resolveConfirmation !== undefined
        ? { resolveConfirmation: deps.resolveConfirmation }
        : {}),
    }),
    new BudgetGuard({
      runId: deps.runId,
      obligationId: deps.obligationId,
      clock: deps.clock,
      emit,
      maxToolCallsPerRun: deps.maxToolCallsPerRun,
      excludedToolNames: SDK_INTERNAL_TOOL_NAMES,
    }),
    new RetrySteering({
      runId: deps.runId,
      obligationId: deps.obligationId,
      clock: deps.clock,
      emit,
      ledger,
      attemptsUsedForObligation: deps.attemptsUsedForObligation,
      maxAttemptsPerObligation: deps.maxAttemptsPerObligation,
      ...(deps.alternativeTechniqueHint !== undefined
        ? { alternativeTechniqueHint: deps.alternativeTechniqueHint }
        : {}),
    }),
    new EvidenceQualitySteering({
      runId: deps.runId,
      obligationId: deps.obligationId,
      clock: deps.clock,
      emit,
    }),
    new OutputSanitizer({
      runId: deps.runId,
      obligationId: deps.obligationId,
      clock: deps.clock,
      emit,
    }),
  ];
}

function wireAgentHooks(agent: Agent, ctx: NormalizerContext, acc: RunAccumulator): () => void {
  const cleanups = [
    agent.addHook(BeforeToolCallEvent, (event) => {
      acc.queue.push(normalizeBeforeToolCall(event, ctx, acc.sequence()));
    }),
    agent.addHook(AfterToolCallEvent, (event) => {
      acc.queue.push(normalizeAfterToolCall(event, ctx, acc.sequence()));
      if (event.toolUse.name === 'skills' && event.result.status === 'success') {
        const input = event.toolUse.input;
        const skillId =
          input !== null && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)['skill_name']
            : undefined;
        if (typeof skillId === 'string') {
          acc.queue.push(
            normalizeSkillActivation(
              {
                skillId,
                reason: 'activated via the skills tool',
                ...(ctx.agentId !== undefined ? { agentId: ctx.agentId } : {}),
              },
              ctx,
              acc.sequence(),
            ),
          );
        }
      }
    }),
    agent.addHook(BeforeModelCallEvent, (event) => {
      acc.queue.push(normalizeBeforeModelCall(event, ctx, acc.sequence()));
    }),
    agent.addHook(AfterModelCallEvent, (event) => {
      acc.queue.push(normalizeAfterModelCall(event, ctx, acc.sequence()));
    }),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/** Sanity guard, identical to `home-energy-swarm.ts`'s `assertSkillsRootDirExists`: confirms `skillsRootDir` really is a directory of skill subdirectories. */
function assertSkillsRootDirExists(skillsRootDir: string): void {
  const entries = readdirSync(skillsRootDir);
  if (!entries.some((entry) => statSync(join(skillsRootDir, entry)).isDirectory())) {
    throw new Error(
      `bid-comparison-swarm: skillsRootDir "${skillsRootDir}" has no skill subdirectories`,
    );
  }
}

function buildInvokePrompt(request: ExecutionRequest): string {
  return `Investigate obligation "${request.obligation.id}" for case "${request.caseId}": ${request.obligation.question}`;
}

function buildSystemPrompt(
  nodeId: string,
  request: ExecutionRequest,
  roleDescription: string,
): string {
  return [
    `You are "${nodeId}", a Sift Strands specialist in the "${request.pack.id}@${request.pack.version}" Swarm. ${roleDescription}`,
    `Active obligation: "${request.obligation.id}" -- ${request.obligation.question}`,
    'Use only the tools made available to you. Cite a source id for every claim.',
    'When you have gathered enough evidence for this obligation, call the structured output tool. Set agentId to the specialist who should investigate next (omit it only if you are ending the run), a message describing what you found and why that specialist should go next, and a context object carrying obligationId, disposition, claims, evidenceResults, limitations, and suggestedStatus.',
  ].join('\n');
}

/**
 * Builds `decision-synthesizer`'s system prompt, baking in the known,
 * deterministic bid facts a Context Injector would otherwise have supplied
 * -- see module header: `decision-synthesizer` is granted only
 * `propose_award`, no bid-reading tool, exactly mirroring
 * `home-energy-swarm.ts`'s identical `buildDecisionSynthesizerSystemPrompt`
 * judgment call for `energy.response_options`. Every figure below is the
 * real output of `packages/scenarios/src/tools/{bid-calculator,
 * license-lookup}.ts` against the checked-in `packages/scenarios/fixtures/
 * bids/*.json` fixtures (verified directly while authoring this file). Four
 * of the twelve bids are named individually -- the three this pack's
 * demo narrative always named, plus Fieldstone Plumbing Co., the lowest
 * scope-normalized adjusted total of all twelve, added when this fixture set
 * scaled from three bids to twelve (2026-09-08); the other eight are summarized,
 * not enumerated, matching `scripted-beats/bid-comparison.ts`'s own prose
 * discipline at this scale.
 */
function buildDecisionSynthesizerSystemPrompt(request: ExecutionRequest): string {
  const criteriaText = request.caseSummary.criteria
    .map((criterion) => `${criterion.id} (weight ${criterion.weight}, ${criterion.direction})`)
    .join('; ');
  const extensionsText = request.caseExtensions
    .filter((extension) => extension.confirmation === 'confirmed')
    .map((extension) => extension.label)
    .join('; ');
  return [
    'You are "decision-synthesizer", synthesizing resolved scope, price, credential, and schedule evidence across every prior bid-comparison obligation into a source-linked award recommendation.',
    `Active obligation: "${request.obligation.id}" -- ${request.obligation.question}`,
    `Current criteria: ${criteriaText || '(none)'}.`,
    extensionsText.length > 0 ? `Confirmed case-specific concerns: ${extensionsText}.` : '',
    'Known bid facts: Northgate Plumbing (bid-northgate) -- quoted $276,000.00, adjusted $276,000.00 (prices all 8 required scope items, 100% scope completeness), 25% deposit (normal payment risk), 3-week start / 45 working days, 24-month warranty, license PL-4417-NG fully valid (source-license-pl-4417-ng). Cedar & Sons (bid-cedar) -- quoted $223,500.00, but its scope-normalized adjusted total is $279,000.00 once its 3 absent required items (permits-inspections $18,000.00, shower-valve-rough-in $31,500.00, debris-haul-away $6,000.00) are priced in using another bidder’s own line-item amounts as the plug estimate (source-bid-calculator-bid-cedar-adjusted-total); 62.5% scope completeness, 45% deposit (elevated payment risk), 1-week start / 35 working days, warranty term not stated in writing, license PL-2290-CS fully valid (source-license-pl-2290-cs). Two Rivers Mechanical (bid-tworivers) -- quoted $288,750.00, adjusted $288,750.00 (prices all 8 required scope items, 100% scope completeness), 20% deposit (normal payment risk), 5-week start / 40 working days, 36-month warranty, but its certificate of insurance does not name its license holder (source-license-pl-8801-tr-named-insured) -- its credentials do not verify as valid. Fieldstone Plumbing Co. (bid-fieldstone) -- quoted $268,000.00, adjusted $268,000.00 -- the lowest scope-normalized adjusted total of all twelve bids, and the only one below Northgate Plumbing’s -- but its license class carries no plumbing trade endorsement for this scope (source-license-pl-7734-fs) -- its credentials do not verify as valid either. The other eight bids (Summit Mechanical Co., Ironclad Plumbing & Mechanical, Parkside Plumbing Group, Westbrook Mechanical Contractors, Anchor Point Plumbing, Crestview Mechanical Services, Brightwater Mechanical, Old Mill Plumbing & Heating) all carry fully valid credentials, and none has a scope-normalized adjusted total below Northgate Plumbing’s.',
    'Rank bids on their scope-normalized adjusted totals, never on raw quoted totals -- a bid that is silent on required scope is not actually cheaper once the missing items are priced in. A bid whose credentials do not verify as valid cannot be recommended for award. Cite a source id for every factual claim. Call propose_award only when the recommendation names one bid to award -- it requires human confirmation before it proceeds and never signs or executes a contract. When you are done, call the structured output tool with agentId omitted (ending the run) and a message giving your final recommendation.',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function extractHandoffToolUse(response: Message): SwarmHandoffOutput | undefined {
  const block = response.content.find(
    (entry): entry is ToolUseBlock =>
      entry.type === 'toolUseBlock' && entry.name === 'strands_structured_output',
  );
  if (block === undefined) return undefined;
  return block.input as unknown as SwarmHandoffOutput;
}

const SOURCE_ID_PATTERN = /\bsource-[a-z0-9-]+\b/i;

/**
 * Default `decision-synthesizer` `GoalLoop` validator for this pack.
 *
 * Two independent checks, in order:
 *
 * 1. **Source citation** -- the same hygiene rule `home-energy-swarm.ts`'s
 *    `DEFAULT_SYNTHESIZER_VALIDATOR` applies, because it genuinely fits
 *    here too: a recommendation with no source id at all is unsupported
 *    regardless of domain.
 * 2. **Scope normalization** -- this pack's own, genuinely different rule
 *    (docs/bid-comparison/plan.md "The Strands beats, placed deliberately":
 *    "first synthesis draft ranks on raw totals and is rejected because the
 *    scope basis is not normalized; the corrected attempt ranks on adjusted
 *    totals and cites the plug numbers"). Cedar & Sons' bid is silent on
 *    three required scope items, so a recommendation may not rank bids by
 *    their raw quoted totals ($223,500.00 for Cedar & Sons) -- it must show
 *    its work against the scope-normalized *adjusted* total ($279,000.00,
 *    once the missing items are priced in), which is the whole reason this
 *    pack exists. A draft that never mentions an adjusted total, or never
 *    reaches Cedar & Sons' own adjusted figure, has not actually normalized
 *    scope and is rejected with a reason that names the defect precisely,
 *    not a copy of the source-citation rule. `citesCedarAdjustedFigure`'s
 *    regex is pinned to this exact dollar figure -- when Cedar & Sons'
 *    fixture amounts change (as they did in this fixture set's 2026-09-08
 *    three-to-twelve-bid scaling, $18,600.00 -> $279,000.00), this regex
 *    MUST change with them, or the corrected draft this validator is meant
 *    to accept will fail forever.
 */
export const DEFAULT_SYNTHESIZER_VALIDATOR: Validator = (response) => {
  const handoff = extractHandoffToolUse(response);
  const text = handoff?.message ?? '';
  if (text.trim().length === 0) {
    return {
      passed: false,
      feedback: 'The recommendation must include a message explaining the decision.',
    };
  }
  if (!SOURCE_ID_PATTERN.test(text)) {
    return {
      passed: false,
      feedback: 'The recommendation must cite at least one source id (e.g. "source-...").',
    };
  }
  const citesAdjustedTotal = /adjusted total|scope-normalized/i.test(text);
  const citesCedarAdjustedFigure = /\$?279,?000/.test(text);
  if (!citesAdjustedTotal || !citesCedarAdjustedFigure) {
    return {
      passed: false,
      feedback:
        "The recommendation must rank bids on their scope-normalized adjusted totals, not raw quoted totals: Cedar & Sons' bid is silent on three required scope items (permits and inspections, shower-valve rough-in, debris haul-away), so its adjusted total -- $279,000.00 once those items are priced in -- is what belongs in the comparison, not its $223,500.00 quoted total.",
    };
  }
  return { passed: true };
};

const SWARM_ROLE_FALLBACK: Record<BidComparisonSwarmNodeId, string> = {
  'scope-analyst':
    'Put all bids on one scope basis by diffing what each bid includes and excludes.',
  'price-analyst': "Verify each bid's arithmetic and compute the scope-normalized adjusted total.",
  'credential-checker':
    "Verify a bid's license and insurance credentials against the license registry.",
  'schedule-analyst': "Evaluate whether a bid's stated start date and duration are credible.",
  'source-challenger':
    'Evaluate provenance, recency, and contradictions across submitted bid evidence before it can satisfy an obligation.',
  'decision-synthesizer':
    'Synthesize resolved scope, price, credential, and schedule evidence into a source-linked award recommendation.',
};

function requestFor(
  nodeId: BidComparisonSwarmNodeId,
  deps: BidComparisonSwarmDeps,
): ExecutionRequest {
  if (nodeId === 'source-challenger' || nodeId === 'decision-synthesizer') {
    return deps.awardRecommendationRequest;
  }
  return deps.specialistRequests[nodeId];
}

/** Builds one non-synthesizer node's `Agent`, fully wired with skills/context/interventions -- the same composition as `home-energy-swarm.ts`'s `buildSwarmSpecialistAgent`. */
function buildSwarmSpecialistAgent(
  nodeId: BidComparisonSequentialSpecialistId | 'source-challenger',
  request: ExecutionRequest,
  deps: BidComparisonSwarmDeps,
  acc: RunAccumulator,
): { agent: Agent; unwireHooks: () => void } {
  const allowedTools = specialistAllowedTools(deps.pack, nodeId);
  const allowedToolsWithInternals = [...allowedTools, ...SDK_INTERNAL_TOOL_NAMES];
  const roleDescription = specialistDescription(deps.pack, nodeId) || SWARM_ROLE_FALLBACK[nodeId];
  const ctx: NormalizerContext = {
    traceId: acc.traceId,
    runId: acc.runId,
    caseId: acc.caseId,
    obligationId: request.obligation.id,
    agentId: nodeId,
    ...(acc.sessionId !== undefined ? { sessionId: acc.sessionId } : {}),
  };
  const emitIntervention = (event: InterventionEvent): void => {
    acc.queue.push(normalizeIntervention(event, ctx, acc.sequence()));
  };
  const interventions = buildInterventions(
    {
      runId: acc.runId,
      obligationId: request.obligation.id,
      clock: deps.clock,
      allowedTools: allowedToolsWithInternals,
      consequentialToolIds: [],
      forbiddenToolIds: deps.forbiddenToolIds ?? [],
      ...(deps.resolveConfirmation !== undefined
        ? { resolveConfirmation: deps.resolveConfirmation }
        : {}),
      maxToolCallsPerRun: request.limits.maxToolCallsPerRun,
      attemptsUsedForObligation: request.priorAttempts.length,
      maxAttemptsPerObligation: request.limits.maxAttemptsPerObligation,
      ...(deps.alternativeTechniqueHints?.[nodeId] !== undefined
        ? { alternativeTechniqueHint: deps.alternativeTechniqueHints[nodeId] }
        : {}),
    },
    emitIntervention,
  );

  const skillsPlugin = buildSkillsPlugin(deps.skillsRootDir);
  const contextInjector = buildContextInjector(request, {
    ctx,
    sequence: acc.sequence,
    emit: (event) => acc.queue.push(event),
  });

  const tools = filterToolsByName(buildBidComparisonFixtureTools(), allowedTools);
  const agent = new Agent({
    id: nodeId,
    name: nodeId,
    description: roleDescription,
    model: deps.modelFor(nodeId),
    printer: false,
    systemPrompt: buildSystemPrompt(nodeId, request, roleDescription),
    tools,
    plugins: [skillsPlugin, contextInjector],
    interventions,
  });

  const unwireHooks = wireAgentHooks(agent, ctx, acc);
  return { agent, unwireHooks };
}

/**
 * Runs the real bounded Bid Comparison Strands `Swarm` once. Yields every
 * normalized `RuntimeEvent` the run produces (tool/model calls, skill
 * activation, context injection, interventions, GoalLoop attempts, and
 * `swarm.node_started`/`swarm.node_completed`/`swarm.handoff`/
 * `swarm.cycle_detected`/`swarm.timeout` events) *as the Swarm produces it*,
 * then returns the full `BidComparisonSwarmResult`. Same streaming, error,
 * and cleanup guarantees as `home-energy-swarm.ts`'s `executeHomeEnergySwarm`.
 */
export async function* executeBidComparisonSwarm(
  deps: BidComparisonSwarmDeps,
): AsyncGenerator<RuntimeEvent, BidComparisonSwarmResult, undefined> {
  assertSkillsRootDirExists(deps.skillsRootDir);

  const startNodeId: BidComparisonSwarmNodeId = deps.start ?? 'scope-analyst';
  const startRequest = requestFor(startNodeId, deps);

  const now = deps.nowMs ?? ((): number => Date.now());
  const acc: RunAccumulator = {
    queue: new RuntimeEventQueue<RuntimeEvent>(),
    sequence: createSequenceCounter(),
    traceId: deps.idGenerator.next('trace'),
    runId: startRequest.runId,
    caseId: startRequest.caseId,
    nodeDurations: createNodeDurationTracker(now),
  };

  const unwireCleanups: (() => void)[] = [];
  const agents: Record<BidComparisonSwarmNodeId, Agent> = {} as never;

  for (const nodeId of [
    ...BID_COMPARISON_SEQUENTIAL_SPECIALIST_IDS,
    'source-challenger',
  ] as const) {
    const built = buildSwarmSpecialistAgent(nodeId, requestFor(nodeId, deps), deps, acc);
    agents[nodeId] = built.agent;
    unwireCleanups.push(built.unwireHooks);
  }

  // --- decision-synthesizer: reuse plugins.ts's isolated Agent+GoalLoop pair verbatim ---
  const synthesizerRequest = deps.awardRecommendationRequest;
  const proposeAwardTool = filterToolsByName(buildBidComparisonFixtureTools(), [
    PROPOSE_AWARD_TOOL_ID,
  ]);
  const synthesizerCtx: NormalizerContext = {
    traceId: acc.traceId,
    runId: acc.runId,
    caseId: acc.caseId,
    obligationId: synthesizerRequest.obligation.id,
    agentId: 'decision-synthesizer',
    ...(acc.sessionId !== undefined ? { sessionId: acc.sessionId } : {}),
  };
  const emitSynthesizerIntervention = (event: InterventionEvent): void => {
    acc.queue.push(normalizeIntervention(event, synthesizerCtx, acc.sequence()));
  };
  const synthesizerInterventions = buildInterventions(
    {
      runId: acc.runId,
      obligationId: synthesizerRequest.obligation.id,
      clock: deps.clock,
      allowedTools: [PROPOSE_AWARD_TOOL_ID, ...SDK_INTERNAL_TOOL_NAMES],
      consequentialToolIds: deps.consequentialToolIds ?? [PROPOSE_AWARD_TOOL_ID],
      forbiddenToolIds: deps.forbiddenToolIds ?? [],
      ...(deps.resolveConfirmation !== undefined
        ? { resolveConfirmation: deps.resolveConfirmation }
        : {}),
      maxToolCallsPerRun: synthesizerRequest.limits.maxToolCallsPerRun,
      attemptsUsedForObligation: synthesizerRequest.priorAttempts.length,
      maxAttemptsPerObligation: synthesizerRequest.limits.maxAttemptsPerObligation,
    },
    emitSynthesizerIntervention,
  );

  const { agent: synthesizerAgent, goalLoop } = buildDecisionSynthesizerAgent({
    model: deps.modelFor('decision-synthesizer'),
    systemPrompt:
      deps.decisionSynthesizerSystemPrompt ??
      buildDecisionSynthesizerSystemPrompt(synthesizerRequest),
    validator: deps.decisionSynthesizerValidator ?? DEFAULT_SYNTHESIZER_VALIDATOR,
    tools: proposeAwardTool,
    interventions: synthesizerInterventions,
    ...(deps.goalLoopMaxAttempts !== undefined ? { maxAttempts: deps.goalLoopMaxAttempts } : {}),
  });
  // See `home-energy-swarm.ts`'s identical comment: `decision-synthesizer`'s
  // `description` (used for Swarm handoff-routing text) has no field on
  // `DecisionSynthesizerConfig`, and `Agent.description` is not assignable
  // post-construction, so this node's handoff routing text falls back to
  // the SDK's own "no description" rendering.
  agents['decision-synthesizer'] = synthesizerAgent;
  unwireCleanups.push(wireAgentHooks(synthesizerAgent, synthesizerCtx, acc));

  let proposedAward: BidComparisonSwarmResult['proposedAward'];
  const captureProposal = synthesizerAgent.addHook(BeforeToolCallEvent, (event) => {
    if (event.toolUse.name !== PROPOSE_AWARD_TOOL_ID) return;
    const input = event.toolUse.input as { bidId?: unknown; rationale?: unknown };
    if (typeof input.bidId === 'string' && typeof input.rationale === 'string') {
      proposedAward = { bidId: input.bidId, rationale: input.rationale };
    }
  });
  unwireCleanups.push(captureProposal);

  // --- Swarm construction: code-driven from the compiled pack's declared orchestration bounds ---
  const swarm = new Swarm({
    id: 'bid-comparison-swarm',
    nodes: BID_COMPARISON_SWARM_NODE_IDS.map((id) => agents[id]),
    start: startNodeId,
    maxSteps: deps.pack.orchestration.maxSteps,
    nodeTimeout: deps.pack.orchestration.nodeTimeoutMs,
    timeout: deps.pack.orchestration.totalTimeoutMs,
    repetitiveHandoffDetectionWindow: deps.pack.orchestration.repetitiveHandoffDetectionWindow ?? 0,
    repetitiveHandoffMinUniqueAgents: deps.pack.orchestration.repetitiveHandoffMinUniqueAgents ?? 0,
  });

  const nodeStartOrder: string[] = [];
  const nodeFinishOrder: string[] = [];
  const handoffs: BidComparisonSwarmHandoff[] = [];
  const contexts: BidComparisonSwarmResult['contexts'] = {};
  let lastCompleted: { nodeId: string; context: ExecutionResult | undefined } | undefined;

  const swarmCleanups = [
    swarm.addHook(BeforeNodeCallEvent, (event) => {
      nodeStartOrder.push(event.nodeId);
      emitSwarmNodeEvent(acc, { nodeId: event.nodeId, phase: 'start' });
    }),
    swarm.addHook(NodeResultEvent, (event) => {
      nodeFinishOrder.push(event.nodeId);
      const context = extractHandoffContext(event.result.structuredOutput);
      if (event.nodeId in agents && context !== undefined) {
        contexts[event.nodeId as BidComparisonSwarmNodeId] = context;
      }
      lastCompleted = { nodeId: event.nodeId, context };
      emitSwarmNodeEvent(acc, {
        nodeId: event.nodeId,
        phase: 'finish',
        status: event.result.status,
      });
    }),
    swarm.addHook(MultiAgentHandoffEvent, (event) => {
      const target = event.targets[0] ?? 'unknown';
      const context = lastCompleted?.nodeId === event.source ? lastCompleted.context : undefined;
      const handoff: BidComparisonSwarmHandoff = {
        from: event.source,
        to: target,
        reason: deriveHandoffReason(context),
        evidenceDelta: deriveEvidenceDelta(context),
      };
      handoffs.push(handoff);
      emitSwarmHandoffEvent(acc, handoff);
    }),
  ];

  // --- The run and the streaming of its events are genuinely concurrent;
  // see `home-energy-swarm.ts`'s equivalent block for the full rationale. ---
  const invocation = swarm.invoke(deps.invokePrompt ?? buildInvokePrompt(startRequest));

  let multiAgentResult: MultiAgentResult;
  try {
    multiAgentResult = yield* acc.queue.streamWhile(invocation, {
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('exceeded wall-clock budget')) {
          emitSwarmTimeoutEvent(acc, message);
        }
      },
    });
  } finally {
    for (const cleanup of swarmCleanups) cleanup();
    for (const cleanup of unwireCleanups) cleanup();
  }

  const repetitiveHandoffDetected =
    multiAgentResult.status === 'FAILED' &&
    (multiAgentResult.error?.message.includes('Repetitive handoff') ?? false);
  if (repetitiveHandoffDetected) {
    emitSwarmCycleDetectedEvent(acc, multiAgentResult.error?.message ?? 'repetitive handoff');
  }

  const rawGoalResult = goalLoop.lastResult(synthesizerAgent) as
    | {
        passed: boolean;
        stopReason: string;
        attempts: { attempt: number; passed: boolean; feedback?: string }[];
      }
    | undefined;
  if (rawGoalResult !== undefined) {
    const lastAttemptIndex = rawGoalResult.attempts.length - 1;
    rawGoalResult.attempts.forEach((attempt, index) => {
      const exhausted = !rawGoalResult.passed && index === lastAttemptIndex;
      acc.queue.push(
        normalizeGoalValidation(
          {
            attempt: attempt.attempt,
            passed: attempt.passed,
            ...(attempt.feedback !== undefined ? { feedback: attempt.feedback } : {}),
            exhausted,
          },
          synthesizerCtx,
          acc.sequence(),
        ),
      );
    });
  }

  for (const event of acc.queue.drain()) {
    yield event;
  }

  const synthesizerNodeResult = multiAgentResult.results.find(
    (entry) => entry.nodeId === 'decision-synthesizer',
  );
  const synthesizerOutput = synthesizerNodeResult?.structuredOutput as
    SwarmHandoffOutput | undefined;
  const decisionSynthesizerText = synthesizerOutput?.message ?? '';

  const goalLoopResult: BidComparisonSwarmGoalLoopResult | undefined =
    rawGoalResult === undefined
      ? undefined
      : {
          passed: rawGoalResult.passed,
          stopReason: rawGoalResult.stopReason,
          attempts: rawGoalResult.attempts,
        };

  return {
    multiAgentResult,
    nodeStartOrder,
    nodeFinishOrder,
    handoffs,
    contexts,
    decisionSynthesizerText,
    proposedAward,
    goalLoopResult,
    repetitiveHandoffDetected,
  };
}
