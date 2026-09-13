/**
 * Declarative scenario schemas (docs/specs/testing.md "Scenario tests").
 * `ScenarioAssertion` has an exact discriminated-union field list in
 * testing.md and is translated verbatim below. `DemoScenario.seed:
 * ScenarioSeed` and `ScenarioStep` are named without field lists; both are
 * inferred and grounded at their definitions.
 */
import { z } from 'zod';
import { DEMO_IDS } from './commands.js';
import { JsonValueSchema } from './events.js';

const HTML_OR_EXECUTABLE_PATTERN = /<\/?[a-zA-Z!]|javascript:|on[a-zA-Z]+\s*=\s*["']/;

function safeString(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .refine((value) => !HTML_OR_EXECUTABLE_PATTERN.test(value), {
      message: 'value must not contain HTML tags or executable expressions',
    });
}

const idString = (maxLength = 200) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[A-Za-z0-9._-]+$/, 'id must contain only letters, digits, ".", "_", or "-"');

/**
 * Inferred: `DemoScenario.seed: ScenarioSeed` has no field list. Grounded in
 * the plan's `packages/scenarios/src/seeds.ts` file (fixture seed data
 * loaded to instantiate a case) and testing.md's flake policy ("Each
 * scenario starts with a new temporary store and case ID" / injected
 * deterministic `Clock`).
 */
export const ScenarioSeedSchema = z
  .object({
    demoId: z.enum(DEMO_IDS),
    fixtureBundleId: idString(),
    clockIso: z.iso.datetime(),
  })
  .strict();
export type ScenarioSeed = z.infer<typeof ScenarioSeedSchema>;

/**
 * Inferred: `ScenarioStep` has no field list. Grounded in testing.md
 * "Scenario tests execute the actual core, pack, Strands adapter, scripted
 * model, interventions, fixture tools, event store, and API in process" --
 * a step is a call to one real `SiftCommands` method with its input. `command`
 * is restricted to the exact method names in architecture.md's `SiftCommands`
 * interface rather than an arbitrary string, so a malformed scenario file
 * fails validation instead of silently no-op'ing at runtime. `input` is a
 * bounded `JsonValue` here (not the specific per-command Zod schema from
 * commands.ts) because the scenario runner validates each step's `input`
 * against the real command schema at execution time; contracts only needs to
 * guarantee the envelope itself is safe, size-bounded JSON.
 */
export const SCENARIO_COMMAND_NAMES = [
  'startDemo',
  'selectPack',
  'upsertOption',
  'focusOption',
  'defineCaseAttribute',
  'reviewCaseExtension',
  'focusEvidence',
  'updateCriteria',
  'submitSource',
  'requestInvestigation',
  'reviewProposal',
] as const;
export type ScenarioCommandName = (typeof SCENARIO_COMMAND_NAMES)[number];

export const ScenarioStepSchema = z
  .object({
    command: z.enum(SCENARIO_COMMAND_NAMES),
    input: JsonValueSchema,
    description: safeString(500).optional(),
  })
  .strict();
export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

// --- ScenarioAssertion (testing.md "Scenario tests", verbatim) ---

const PackSelectedAssertionSchema = z
  .object({ kind: z.literal('pack_selected'), packId: idString(), reasonIncludes: safeString(500) })
  .strict();

const CaseExtensionDefinedAssertionSchema = z
  .object({
    kind: z.literal('case_extension_defined'),
    definitionId: idString(),
    origin: safeString(200),
  })
  .strict();

const CaseObligationCreatedAssertionSchema = z
  .object({
    kind: z.literal('case_obligation_created'),
    obligationId: idString(),
    criterionId: idString(),
  })
  .strict();

const SkillActivatedAssertionSchema = z
  .object({ kind: z.literal('skill_activated'), skillId: idString(), obligationId: idString() })
  .strict();

const SpecialistInvokedAssertionSchema = z
  .object({ kind: z.literal('specialist_invoked'), specialistId: idString() })
  .strict();

const GraphNodeAssertionSchema = z
  .object({ kind: z.literal('graph_node'), nodeId: idString() })
  .strict();

const SwarmHandoffAssertionSchema = z
  .object({ kind: z.literal('swarm_handoff'), from: idString(), to: idString() })
  .strict();

const ContextInjectedAssertionSchema = z
  .object({ kind: z.literal('context_injected'), fields: z.array(safeString(200)).max(50) })
  .strict();

const GoalValidationFailedAssertionSchema = z
  .object({ kind: z.literal('goal_validation_failed'), reasonIncludes: safeString(500) })
  .strict();

/**
 * A genuine GoalLoop reject-then-recover cycle: at least one failed
 * validation attempt whose feedback includes `reasonIncludes`, followed by
 * at least one later attempt that passed (`maxAttempts: 2` -- strands-
 * runtime.md "GoalLoop output validation"). Distinct from
 * `goal_validation_failed` (which only proves the rejection half): a pack
 * whose demo trajectory must prove the run recovered and still produced a
 * valid final result (not merely that a draft was once rejected) needs this
 * stronger claim expressed declaratively rather than as an ad hoc inline
 * check, since "reject once, then recover" is a reusable trajectory shape
 * any pack's GoalLoop-gated agent could exercise, not a one-off dynamic
 * value.
 */
const GoalRecoveredAssertionSchema = z
  .object({ kind: z.literal('goal_recovered'), reasonIncludes: safeString(500) })
  .strict();

const SnapshotRestoredAssertionSchema = z
  .object({ kind: z.literal('snapshot_restored'), caseId: idString() })
  .strict();

const DebugEventCorrelatedAssertionSchema = z
  .object({
    kind: z.literal('debug_event_correlated'),
    eventName: safeString(300),
    activityType: safeString(200),
  })
  .strict();

const RedactionCanaryAbsentAssertionSchema = z
  .object({ kind: z.literal('redaction_canary_absent'), canary: safeString(500) })
  .strict();

const ToolCalledAssertionSchema = z
  .object({
    kind: z.literal('tool_called'),
    toolId: idString(),
    count: z.number().int().min(0).optional(),
  })
  .strict();

const InterventionAssertionSchema = z
  .object({
    kind: z.literal('intervention'),
    action: z.enum(['guide', 'confirm', 'deny']),
    handler: safeString(200),
  })
  .strict();

const ClaimLinkedAssertionSchema = z
  .object({
    kind: z.literal('claim_linked'),
    claimId: idString(),
    sourceIds: z.array(idString()).max(50),
  })
  .strict();

const EvidenceStaleAssertionSchema = z
  .object({ kind: z.literal('evidence_stale'), evidenceId: idString() })
  .strict();

const ObligationStatusAssertionSchema = z
  .object({
    kind: z.literal('obligation_status'),
    obligationId: idString(),
    status: safeString(100),
  })
  .strict();

const ReadinessAssertionSchema = z
  .object({
    kind: z.literal('readiness'),
    ready: z.boolean(),
    blockers: z.array(idString()).max(200),
  })
  .strict();

const RecommendationAssertionSchema = z
  .object({ kind: z.literal('recommendation'), favoredOptionId: idString() })
  .strict();

const HumanActionAssertionSchema = z
  .object({ kind: z.literal('human_action'), action: safeString(200) })
  .strict();

const ForbiddenEventAbsentAssertionSchema = z
  .object({ kind: z.literal('forbidden_event_absent'), eventType: safeString(200) })
  .strict();

export const ScenarioAssertionSchema = z.discriminatedUnion('kind', [
  PackSelectedAssertionSchema,
  CaseExtensionDefinedAssertionSchema,
  CaseObligationCreatedAssertionSchema,
  SkillActivatedAssertionSchema,
  SpecialistInvokedAssertionSchema,
  GraphNodeAssertionSchema,
  SwarmHandoffAssertionSchema,
  ContextInjectedAssertionSchema,
  GoalValidationFailedAssertionSchema,
  GoalRecoveredAssertionSchema,
  SnapshotRestoredAssertionSchema,
  DebugEventCorrelatedAssertionSchema,
  RedactionCanaryAbsentAssertionSchema,
  ToolCalledAssertionSchema,
  InterventionAssertionSchema,
  ClaimLinkedAssertionSchema,
  EvidenceStaleAssertionSchema,
  ObligationStatusAssertionSchema,
  ReadinessAssertionSchema,
  RecommendationAssertionSchema,
  HumanActionAssertionSchema,
  ForbiddenEventAbsentAssertionSchema,
]);
export type ScenarioAssertion = z.infer<typeof ScenarioAssertionSchema>;

// --- DemoScenario (testing.md "Scenario tests", verbatim) ---

export const DemoScenarioSchema = z
  .object({
    id: idString(),
    packId: idString(),
    seed: ScenarioSeedSchema,
    steps: z.array(ScenarioStepSchema).max(200),
    assertions: z.array(ScenarioAssertionSchema).max(200),
  })
  .strict();
export type DemoScenario = z.infer<typeof DemoScenarioSchema>;

// --- Persona UX harness (final-hackathon-execution-plan.md Task 8) ---
//
// A persona is a scripted sequence of human turns through the companion
// pane, run against the real stack. Running one produces a `TurnArtifact`
// per turn; hard gates then run over those artifacts deterministically.
//
// Two rules are structural here, for the same reason they are elsewhere in
// this build:
//
// 1. **A diagnostic score must cite a turn.** `DiagnosticScore.evidence` is
//    required, so "orientation: 4" with nothing behind it cannot be
//    written down. These scores are judgments a model or a person makes;
//    the harness validates and enforces them but never invents one.
// 2. **A gate that could not be evaluated is not a gate that passed.**
//    `HardGateOutcome` has a third value, `not_evaluated`, because an
//    in-process harness genuinely cannot see a browser console or an axe
//    tree. Collapsing that into `pass` would be the exact fabrication the
//    gates exist to catch.

export const PERSONA_IDS = [
  'family-novice',
  'landscaping-owner',
  'known-listing-shopper',
  // `bid-comparison`'s own persona: a school facilities manager who is not
  // a procurement expert, choosing among twelve plumbing bids. Deliberately
  // has no entry in `DIAGNOSTIC_PASS` (`packages/scenarios/fixtures/personas/
  // diagnostics.ts`) -- nobody has run a diagnostic pass over its turn
  // artifacts, and inventing scores nobody produced is exactly what that
  // module's own header forbids.
  'school-facilities-manager',
] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

/** Who took the turn. An agent turn is held to the authority rules a human turn is not. */
export const PERSONA_TURN_ACTORS = ['human', 'agent'] as const;
export type PersonaTurnActor = (typeof PERSONA_TURN_ACTORS)[number];

export const PersonaTurnSchema = z
  .object({
    label: safeString(200),
    actor: z.enum(PERSONA_TURN_ACTORS),
    /** What the person said or did, in their own words. Rendered into the artifact's chat record. */
    utterance: safeString(1000).optional(),
    /** The command this turn performs, if any. A turn may be pure narration. */
    command: safeString(100).optional(),
    input: JsonValueSchema.optional(),
  })
  .strict();
export type PersonaTurn = z.infer<typeof PersonaTurnSchema>;

export const PersonaSchema = z
  .object({
    id: z.enum(PERSONA_IDS),
    title: safeString(200),
    /** What this person is actually trying to do, in one sentence. */
    goal: safeString(500),
    packId: idString(),
    demoId: z.enum(DEMO_IDS),
    mode: z.enum(['companion', 'standalone']),
    turns: z.array(PersonaTurnSchema).min(1).max(60),
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;

/** The eleven deterministic failures from the canonical plan's Task 8. */
export const HARD_GATE_IDS = [
  'state_ui_contradiction',
  'unsupported_claim',
  'authority_violation',
  'incomplete_companion_discovery',
  'blocker_inference',
  'missing_next_action',
  'broken_persistent_frame',
  'fabricated_progress',
  'accessibility',
  'console_or_network_error',
  'outcome_dead_end',
  // Added after the first real run: a turn that ran a command and changed
  // nothing. Every other gate passed on a family journey whose last seven
  // turns were byte-identical -- same phase, same coverage, same next
  // move, empty diffs -- because "nothing happened" violates none of them.
  // A green report on a journey that never moved is the exact fabricated
  // pass these gates exist to prevent.
  'stalled_turn',
] as const;
export type HardGateId = (typeof HARD_GATE_IDS)[number];

/**
 * `not_evaluated` is a first-class outcome, not a synonym for `pass`. A gate
 * whose evidence this harness cannot see reports that plainly so a reader
 * knows what was and was not checked.
 */
export const HARD_GATE_OUTCOMES = ['pass', 'fail', 'not_evaluated'] as const;
export type HardGateOutcome = (typeof HARD_GATE_OUTCOMES)[number];

export const HardGateFindingSchema = z
  .object({
    gateId: z.enum(HARD_GATE_IDS),
    turnIndex: z.number().int().min(0).max(200),
    /** What exactly went wrong, specific enough to repair from without re-running. */
    detail: safeString(1000),
  })
  .strict();
export type HardGateFinding = z.infer<typeof HardGateFindingSchema>;

export const HardGateResultSchema = z
  .object({
    gateId: z.enum(HARD_GATE_IDS),
    outcome: z.enum(HARD_GATE_OUTCOMES),
    findings: z.array(HardGateFindingSchema).max(200),
    /** Required when `not_evaluated`: why this harness could not check it. */
    notEvaluatedReason: safeString(500).optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.outcome === 'not_evaluated' && result.notEvaluatedReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['notEvaluatedReason'],
        message: 'a gate that was not evaluated must say why',
      });
    }
    if (result.outcome === 'fail' && result.findings.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'a failing gate must name at least one finding',
      });
    }
    if (result.outcome === 'pass' && result.findings.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'a passing gate cannot carry findings',
      });
    }
  });
export type HardGateResult = z.infer<typeof HardGateResultSchema>;

export const DIAGNOSTIC_DIMENSIONS = [
  'orientation',
  'next_action_clarity',
  'relevance',
  'efficiency',
  'conversation_canvas_coherence',
  'control_flexibility',
  'trust_evidence',
  'cognitive_load',
] as const;
export type DiagnosticDimension = (typeof DIAGNOSTIC_DIMENSIONS)[number];

/**
 * The two dimensions the canonical plan holds to a higher bar: no single
 * turn may score below 3 on either, because a person who cannot tell where
 * they are or what to do next has no way to recover on their own.
 */
export const CRITICAL_DIAGNOSTIC_DIMENSIONS = ['orientation', 'next_action_clarity'] as const;

export const DiagnosticEvidenceSchema = z
  .object({
    turnIndex: z.number().int().min(0).max(200),
    /** Text actually present in that turn's artifact. A score is not an opinion about the product in general. */
    quote: safeString(1000),
  })
  .strict();

export const DiagnosticScoreSchema = z
  .object({
    dimension: z.enum(DIAGNOSTIC_DIMENSIONS),
    turnIndex: z.number().int().min(0).max(200),
    score: z.number().int().min(1).max(5),
    /** Required: a score with nothing behind it is not expressible. */
    evidence: DiagnosticEvidenceSchema,
  })
  .strict();
export type DiagnosticScore = z.infer<typeof DiagnosticScoreSchema>;

export const TURN_OWNERSHIP = ['human', 'agent', 'shared'] as const;
export type TurnOwnership = (typeof TURN_OWNERSHIP)[number];

export const TurnArtifactSchema = z
  .object({
    index: z.number().int().min(0).max(200),
    label: safeString(200),
    actor: z.enum(PERSONA_TURN_ACTORS),
    chat: z
      .object({
        utterance: safeString(1000).optional(),
        reply: safeString(2000).optional(),
      })
      .strict(),
    /** Command/tool names invoked on this turn, in order. */
    tools: z.array(safeString(100)).max(50),
    sequenceBefore: z.number().int().min(0),
    sequenceAfter: z.number().int().min(0),
    /** One line per meaningful change, so a failure points at what moved. */
    stateDiff: z.array(safeString(300)).max(100),
    coverage: z
      .object({
        requiredTotal: z.number().int().min(0),
        requiredResolved: z.number().int().min(0),
      })
      .strict(),
    phase: safeString(100),
    nextMove: z
      .object({ kind: safeString(100), label: safeString(300), humanOnly: z.boolean() })
      .strict()
      .nullable(),
    runPlan: z
      .object({
        version: z.number().int().min(1),
        plannedItems: z.number().int().min(0),
        deepItems: z.number().int().min(0),
        reused: z.number().int().min(0),
        added: z.number().int().min(0),
      })
      .strict()
      .nullable(),
    events: z.array(safeString(300)).max(100),
    view: safeString(100),
    ownership: z.enum(TURN_OWNERSHIP),
    /** What a person could actually press on this turn. */
    visibleControls: z.array(safeString(200)).max(50),
    /** Present only when a browser captured one; absent is honest, a placeholder is not. */
    screenshotPath: safeString(500).optional(),
    accessibility: z
      .object({ seriousViolations: z.number().int().min(0), checked: z.boolean() })
      .strict(),
    consoleErrors: z.array(safeString(500)).max(50),
    networkFailures: z.array(safeString(500)).max(50),
    latencyMs: z.number().min(0),
    estimatedCostUsd: z.number().min(0),
  })
  .strict();
export type TurnArtifact = z.infer<typeof TurnArtifactSchema>;

export const PersonaRunReportSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    personaId: z.enum(PERSONA_IDS),
    caseId: idString(),
    turns: z.array(TurnArtifactSchema).max(200),
    gates: z.array(HardGateResultSchema).max(50),
    /** Absent until a diagnostic pass has genuinely been run. Never defaulted to a number. */
    scores: z.array(DiagnosticScoreSchema).max(400).optional(),
    passed: z.boolean(),
  })
  .strict();
export type PersonaRunReport = z.infer<typeof PersonaRunReportSchema>;
