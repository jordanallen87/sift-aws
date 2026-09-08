/**
 * Decision Pack source contract: `DecisionPackManifest` / `CompiledDecisionPack`
 * from docs/specs/pack-authoring.md ("Decision Pack source contract") and
 * `ObligationTemplate` / router types from docs/specs/packs-and-routing.md.
 *
 * Several nested shapes (`EntityTypeDefinition`, `SkillReference`,
 * `SpecialistDefinition`, `OrchestrationDefinition`, `ToolDeclaration`,
 * `PolicyDefinition`, `PresentationDefinition`, `PackEvaluationDefinition`,
 * `CompletionRule`, `ResolvedCapabilityCatalog`, `CompiledValidatorReferences`)
 * are named in prose but never given an explicit field list anywhere in the
 * spec set. Each is defined here as the minimal reasonable shape grounded in
 * how the spec describes its behavior; the comment above each documents the
 * grounding and flags it as inferred.
 */
import { z } from 'zod';
import { AttributeDefinitionSchema, CriterionSchema } from './attributes.js';
import { PackDiscoveryDefinitionSchema } from './discovery.js';

const HTML_OR_EXECUTABLE_PATTERN = /<\/?[a-zA-Z!]|javascript:|on[a-zA-Z]+\s*=\s*["']/;

function safeString(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .refine((value) => !HTML_OR_EXECUTABLE_PATTERN.test(value), {
      message: 'value must not contain HTML tags or executable expressions',
    });
}

// A conservative id charset shared by pack-scoped identifiers (pack id,
// entity/skill/specialist/tool/policy/criterion ids). Dots and hyphens are
// required by real ids used in the specs (e.g. `car-purchase`,
// `car.hard_constraints`, `deal-analyst`).
const idString = (maxLength = 200) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[A-Za-z0-9._-]+$/, 'id must contain only letters, digits, ".", "_", or "-"');

const semverString = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'version must be a semantic version (major.minor.patch)');

export const PackIdentitySchema = z
  .object({
    id: idString(),
    version: semverString,
    name: safeString(200),
    description: safeString(2000),
    tags: z.array(safeString(60)).max(30),
  })
  .strict();
export type PackIdentity = z.infer<typeof PackIdentitySchema>;

export const PackActivationSchema = z
  .object({
    intents: z.array(safeString(300)).max(50),
    keywords: z.array(safeString(100)).max(100),
    artifactKinds: z.array(safeString(100)).max(50),
    entitySignals: z.array(safeString(100)).max(50),
    exclusions: z.array(safeString(300)).max(50),
  })
  .strict();
export type PackActivation = z.infer<typeof PackActivationSchema>;

/**
 * Inferred: `EntityTypeDefinition` is named in pack-authoring.md's manifest
 * interface (`entities: EntityTypeDefinition[]`) with no field list. Grounded
 * in `EntityRecord.kind`/`label` (pack-authoring.md "Stable entity
 * envelope") plus which attribute definitions apply to this entity kind.
 */
export const EntityTypeDefinitionSchema = z
  .object({
    id: idString(),
    label: safeString(200),
    description: safeString(2000).optional(),
    attributeIds: z.array(idString()).max(200),
  })
  .strict();
export type EntityTypeDefinition = z.infer<typeof EntityTypeDefinitionSchema>;

export const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/**
 * Inferred: `CompletionRule` is referenced by `ObligationTemplate.
 * completionRule` (packs-and-routing.md) with no field list. Grounded in the
 * evidence-level table directly above it in the same spec (E0-E3, "E2:
 * corroborated by two independent sources or one authoritative source") and
 * in `acceptedUncertaintyAllowed` appearing as a sibling obligation field.
 */
export const CompletionRuleSchema = z
  .object({
    minimumEvidenceLevel: z.enum(EVIDENCE_LEVELS),
    minimumIndependentSources: z.number().int().min(0).max(20),
    acceptedUncertaintyAllowed: z.boolean(),
  })
  .strict();
export type CompletionRule = z.infer<typeof CompletionRuleSchema>;

export const OBLIGATION_ORIGINS = ['pack', 'case_extension'] as const;
export type ObligationOrigin = (typeof OBLIGATION_ORIGINS)[number];

export const ObligationTemplateSchema = z
  .object({
    id: idString(),
    label: safeString(200),
    question: safeString(2000),
    category: safeString(200),
    required: z.boolean(),
    priority: z.number().int().min(0).max(1000),
    requiredEvidenceLevel: z.enum(EVIDENCE_LEVELS),
    maxAttempts: z.number().int().min(1).max(20),
    acceptedUncertaintyAllowed: z.boolean(),
    dependsOn: z.array(idString()).max(50),
    preferredSkills: z.array(idString()).max(50),
    preferredSpecialists: z.array(idString()).max(50),
    completionRule: CompletionRuleSchema,
    origin: z.enum(OBLIGATION_ORIGINS),
    /**
     * True when this obligation's answer is a *synthesis over the case's
     * criteria* rather than a measurement of the world.
     *
     * The distinction decides what survives a reweight. "How much of the
     * increase came from tariff changes?" is a measurement: it is just as
     * true after the household decides conservation matters more. "Which
     * actions fit the user's cost and conservation criteria?" is not — it is
     * an answer *about* the criteria, so changing their weights makes the
     * previous answer stale by definition.
     *
     * Without this flag the two were treated identically, and since
     * `selectNextObligation` only considers `open` obligations, a case whose
     * every obligation had been satisfied had nothing left to investigate.
     * Reweighting therefore marked the recommendation stale and left no way
     * to produce a new one: the run request failed with "No open obligation
     * remains to select." That made the reweight-changes-the-ranking
     * moment — the thing these packs exist to demonstrate — unreachable
     * through the product's own controls.
     *
     * Optional, defaulting to false, because a measurement obligation is
     * overwhelmingly the common case and should not have to say so.
     */
    dependsOnCriteria: z.boolean().optional(),
  })
  .strict();
export type ObligationTemplate = z.infer<typeof ObligationTemplateSchema>;

/**
 * Inferred: `SkillReference` has no explicit field list. Grounded in
 * strands-runtime.md "Skills": AgentSkills progressive disclosure means the
 * agent "initially receives name and description metadata" only.
 */
export const SkillReferenceSchema = z
  .object({
    id: idString(),
    description: safeString(2000),
  })
  .strict();
export type SkillReference = z.infer<typeof SkillReferenceSchema>;

/**
 * Inferred: `SpecialistDefinition` has no explicit field list. Grounded in
 * strands-runtime.md "Specialists": "Each has a narrow prompt and tool
 * subset."
 */
export const SpecialistDefinitionSchema = z
  .object({
    id: idString(),
    description: safeString(2000),
    allowedTools: z.array(idString()).max(50),
    allowedSkills: z.array(idString()).max(50).optional(),
  })
  .strict();
export type SpecialistDefinition = z.infer<typeof SpecialistDefinitionSchema>;

export const ORCHESTRATION_STRATEGIES = ['graph', 'swarm', 'single_agent', 'hybrid'] as const;
export type OrchestrationStrategy = (typeof ORCHESTRATION_STRATEGIES)[number];

/**
 * Inferred: `OrchestrationDefinition` has no explicit field list. Grounded in
 * strands-runtime.md: "Graphs set `maxSteps`, timeouts, and concurrency
 * explicitly" and "The Swarm sets `maxSteps`, execution timeout, node
 * timeout, and repetitive-handoff detection." Swarm-only fields stay
 * optional so a Graph-orchestrated pack does not need to declare them.
 */
export const OrchestrationDefinitionSchema = z
  .object({
    strategy: z.enum(ORCHESTRATION_STRATEGIES),
    maxSteps: z.number().int().min(1).max(100),
    nodeTimeoutMs: z.number().int().min(1000).max(300_000),
    totalTimeoutMs: z.number().int().min(1000).max(600_000),
    maxConcurrency: z.number().int().min(1).max(20).optional(),
    repetitiveHandoffDetectionWindow: z.number().int().min(1).max(50).optional(),
    repetitiveHandoffMinUniqueAgents: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type OrchestrationDefinition = z.infer<typeof OrchestrationDefinitionSchema>;

/**
 * Inferred: `ToolDeclaration` has no explicit field list. Grounded in
 * architecture.md "Pack manifests declare tools, effects, extension policy,
 * and approval posture" and "Fixture tools are read-only except canonical
 * Sift commands."
 */
export const TOOL_EFFECTS = ['read_only', 'consequential'] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

export const ToolDeclarationSchema = z
  .object({
    id: idString(),
    description: safeString(2000),
    effect: z.enum(TOOL_EFFECTS),
    requiresApproval: z.boolean(),
  })
  .strict();
export type ToolDeclaration = z.infer<typeof ToolDeclarationSchema>;

/**
 * Inferred: `PolicyDefinition` has no explicit field list. Grounded in
 * strands-runtime.md's `ConsequenceGuard`, which "confirms a consequential
 * proposal and denies forbidden effects" for a named tool call.
 */
export const PolicyDefinitionSchema = z
  .object({
    id: idString(),
    description: safeString(2000),
    requiresHumanApproval: z.boolean(),
    appliesToToolIds: z.array(idString()).max(50).optional(),
  })
  .strict();
export type PolicyDefinition = z.infer<typeof PolicyDefinitionSchema>;

/**
 * Inferred: `PresentationDefinition` has no explicit field list. Grounded in
 * pack-authoring.md's compiler step "generic UI renderability checks" and
 * product.md's schema-driven, pack-agnostic option/attribute rendering.
 */
export const PresentationDefinitionSchema = z
  .object({
    optionLabel: safeString(200),
    optionLabelPlural: safeString(200),
    /**
     * The few attributes a browse CARD leads with, in the author's own
     * priority order -- distinct from `attributeGroups`, which is the
     * exhaustive, sectioned ordering a detail profile and the comparison
     * table use.
     *
     * Optional, and added because inferring this from group order was
     * actively wrong. `OptionListView` read only `attributeGroups[0]` at
     * narrow width, on the assumption that a pack's first group is its most
     * important. For `car-purchase` the first group is `basics` -- make,
     * model, model year, trim, body style, drivetrain -- so a 390px card
     * showed six restatements of its own title and **no price at all**, in
     * the ChatGPT pane that is the product's primary surface. The fix is to
     * let the author say which fields matter on a card rather than
     * reordering their groups behind their back: identity fields genuinely
     * do belong first in a detail view, and last on a card.
     *
     * A pack may omit it. The renderer then falls back to ranking by the
     * weight of the criteria an attribute feeds, and finally to
     * money-first -- so an existing pack keeps working and simply gets a
     * less-informed order.
     *
     * `.optional()` with no default is load-bearing for pack identity:
     * `canonicalize.ts` filters `undefined` keys before hashing, so a pack
     * that omits this field produces the byte-identical `compiledHash` it
     * always did and every already-pinned case stays valid. `compiler.test
     * .ts`'s inline-snapshot hash test guards exactly that property.
     */
    prominentAttributeIds: z.array(idString()).max(10).optional(),
    attributeGroups: z
      .array(
        z
          .object({
            id: idString(),
            label: safeString(200),
            attributeIds: z.array(idString()).max(100),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type PresentationDefinition = z.infer<typeof PresentationDefinitionSchema>;

/**
 * Inferred: `PackEvaluationDefinition` has no explicit field list. Grounded
 * in the compiler step "evaluation suites without negative cases" are
 * rejected (pack-authoring.md "Manifest compilation rejects ...") and the
 * authoring skill's "at least one success, incomplete-evidence, steering, and
 * human-boundary scenario" requirement.
 */
export const PackEvaluationDefinitionSchema = z
  .object({
    scenarioIds: z.array(idString()).max(50),
    requiresNegativeCase: z.boolean(),
  })
  .strict();
export type PackEvaluationDefinition = z.infer<typeof PackEvaluationDefinitionSchema>;

/**
 * The pack-level **Decision Guide** (docs/change-sets/2026-08-30-generic-
 * decision-workspace.md §46/§47, ADR 0006 decision 6, docs/specs/webmcp.md
 * "Decision Guide", docs/specs/packs-and-routing.md "Presentation metadata
 * and Decision Guide"): teaches ChatGPT how to collaborate with THIS CLASS
 * of decision -- not this one case. Field list is the exact one those specs
 * name verbatim: "domain purpose, discovery strategy, suggested questions,
 * important unknowns, research guidance, custom-field guidance, and
 * presentation guidance."
 *
 * ## Why this schema cannot carry prompt injection (a structural guarantee,
 * not a style preference -- see the specs above: "This is a hard boundary,
 * not a style preference")
 *
 * 1. **No field is, or could be renamed to be, an instruction channel.**
 *    There is no `instructions`, `systemPrompt`, or any other free-form
 *    "say whatever you want to the model" slot -- every field is a
 *    specific, named, bounded piece of declarative content (a purpose
 *    statement, a list of questions, a list of unknowns, ...), and the
 *    schema is `.strict()`: an author cannot add an eighth field under any
 *    other name and have it survive `DecisionPackManifestSchema.safeParse`
 *    (proven by the "unrecognized key" test in packs.test.ts).
 * 2. **Every string field is bounded and content-filtered.** Every field
 *    reuses this file's own `safeString(maxLength)` helper -- the same
 *    HTML-tag/`javascript:`/inline-event-handler rejection every other
 *    manifest text field (descriptions, labels, questions) already goes
 *    through, extended here to guide content per packs-and-routing.md's
 *    explicit instruction: "The compiler must reject free-form executable
 *    or instruction-shaped content in this field the same way it already
 *    rejects HTML/script content elsewhere in pack manifests." A field
 *    cannot become an unbounded essay-shaped payload, either.
 * 3. **The guide is consumed as data, never concatenated into a prompt.**
 *    Every consumer of this type (once `sift_get_decision_guide` and the
 *    Decision Profile UI exist) receives it as a typed JSON value inside a
 *    tool result or a rendered UI section -- both "data returned to a
 *    caller" channels. Nothing in this codebase's design concatenates pack
 *    content into a model's own system prompt; the integration mechanism
 *    is, and remains, tool descriptions and structured tool output.
 * 4. **The guide can only describe, never decide or execute.** Every field
 *    is prose or a list of question strings -- there is no field capable of
 *    expressing a tool call, a command, a conditional, or any other
 *    executable shape. A pack author can suggest that "budget" is worth
 *    asking about; they cannot make the guide itself set a value, approve a
 *    decision, or call anything.
 */
export const DecisionGuideSchema = z
  .object({
    /** What this class of decision is fundamentally about, for a model orienting itself to a new pack. */
    domainPurpose: safeString(1000),
    /** How to approach investigating this class of decision (e.g. "establish hard constraints first, then gather comparative evidence in parallel"). Describes an approach; does not command one. */
    discoveryStrategy: safeString(2000),
    /** Pack-authored discovery questions worth asking early for this class of decision (webmcp.md §16's `suggestedQuestions`). Each entry is a single bounded question string, never a compound instruction. */
    suggestedQuestions: z.array(safeString(300)).max(30),
    /** Things this class of decision commonly leaves unresolved even with good evidence (e.g. "whether an item physically fits without a measurement"). */
    importantUnknowns: z.array(safeString(300)).max(30),
    /** What kinds of sources/research are useful for this class of decision, and how to weigh them. */
    researchGuidance: safeString(2000),
    /** When and how a custom field is worth creating for this class of decision, and what should stay a human judgment rather than a model inference. */
    customFieldGuidance: safeString(2000),
    /** Which views/comparisons tend to help for this class of decision (e.g. "show deal and ownership cost together"). Declarative preference, not a UI command. */
    presentationGuidance: safeString(2000),
  })
  .strict();
export type DecisionGuide = z.infer<typeof DecisionGuideSchema>;

/**
 * A single named legal/regulatory standard relevant to this class of
 * decision.
 *
 * Grounded in `packages/scenarios/src/tools/license-lookup.ts`, which is the
 * model this shape describes: that fixture tool already does real
 * compliance-shaped work -- confirms a contractor's licence is active, its
 * class covers the scope, its certificate of insurance is active, and the
 * certificate's named insured matches the licence holder -- without the
 * manifest anywhere calling it that. `PackComplianceStandardSchema` gives a
 * pack author a place to say, in a reader's own language, what a real-world
 * standard actually requires, where it comes from, what the product checks
 * for it automatically (if anything), and what stays a human's own
 * responsibility -- so "this product does compliance work" stops being an
 * implicit property nobody can see and becomes something a human can read
 * (the product owner's own framing: "I basically just want to include
 * things like compliance, b/c thats big").
 *
 * No URL/link field. The only existing precedent for a pack-author-facing
 * URL anywhere in this codebase is `Source.url` in case.ts, and that is
 * case-scoped submitted evidence a human or agent supplies at runtime, never
 * static pack-manifest content an author ships once and everyone reads
 * forever. `packs.ts` itself has never declared a URL field on any schema.
 * `citation` below is a plain identifying string (e.g. "FAR 13.104(b)") a
 * reader can look up on their own -- not a live link a pack author could
 * point anywhere, which would make this schema a link-injection vector
 * `DecisionGuideSchema`'s own header comment already documents this file's
 * general refusal to add.
 */
export const PackComplianceStandardSchema = z
  .object({
    id: idString(),
    /** The standard's own name, in plain language, e.g. "Minimum competitive bids for public construction contracts." */
    label: safeString(200),
    /** What the standard actually requires, in plain language -- not a legal paraphrase a reader would need to double-check against the citation before trusting it. */
    summary: safeString(1000),
    /** The specific statute or regulation section this standard comes from, e.g. "FAR 13.104(b)" or "N.C. Gen. Stat. § 143-132." A citation only, never a link -- see the schema comment above. */
    citation: safeString(300),
    /** Who issues or enforces the standard, e.g. "U.S. Federal Acquisition Regulation" or "North Carolina General Assembly." Named explicitly so a reader is never left wondering whose rule this is. */
    authority: safeString(200),
    /**
     * What the product actually verifies automatically for this standard,
     * if anything -- e.g. "Confirms the contractor's licence is active, its
     * class covers this scope, and its certificate of insurance names the
     * licence holder."
     *
     * Optional, deliberately: several real standards this field can
     * describe (competitive-bid minimums, for instance) are informational
     * only. The product can count how many bids exist in a case, but it has
     * no way to confirm how many sources were actually SOLICITED before an
     * award -- the fact the statute actually gates on -- so a standard with
     * no automated check must be representable without inventing one it
     * cannot honestly perform.
     */
    automatedCheck: safeString(1000).optional(),
    /**
     * What stays a human's own responsibility for this standard, e.g.
     * confirming which jurisdiction's rule actually applies to this case, or
     * that a solicitation genuinely reached the required number of sources.
     * Always present, unlike `automatedCheck` above: even a fully automated
     * check still requires a human to confirm the underlying facts are
     * right for their own situation and to make the actual award decision --
     * this product gives no legal advice and asserts no jurisdictional
     * conclusion on a reader's behalf.
     */
    humanResponsibility: safeString(1000),
  })
  .strict();
export type PackComplianceStandard = z.infer<typeof PackComplianceStandardSchema>;

/**
 * The pack-level declaration of the real-world rules and standards this
 * class of decision is governed by: statutory minimums, licensing and
 * insurance requirements, and the like.
 *
 * Optional for the identical reason `decisionGuide` and `discovery` are (see
 * `DecisionPackManifestSchema.decisionGuide`'s comment for the full
 * mechanism): a pack that declares no `compliance` must still compile, pass
 * conformance, and -- critically -- produce the identical `compiledHash` it
 * always has, because `CasePackPin` (case.ts) pins that hash on every
 * stored case, and `canonicalizeManifest`
 * (packages/packs/src/canonicalize.ts) already drops `undefined` object
 * values before hashing, so an omitted `compliance` and an absent one
 * serialize identically. `compiler.test.ts`'s existing inline-snapshot hash
 * test proves this property for `decisionGuide`; this field carries an
 * equivalent proof of its own.
 *
 * `disclaimer` carries the one framing sentence that applies to every
 * standard below it -- informational only, never legal advice, and a
 * human's own responsibility to confirm against their actual jurisdiction --
 * so no individual `PackComplianceStandard` entry has to repeat it.
 */
export const PackComplianceSchema = z
  .object({
    /** e.g. "These are informational minimums on the party making the award, not legal advice -- confirm what applies in your own jurisdiction before relying on them." */
    disclaimer: safeString(1000),
    standards: z.array(PackComplianceStandardSchema).max(20),
  })
  .strict();
export type PackCompliance = z.infer<typeof PackComplianceSchema>;

export const DecisionPackManifestSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    identity: PackIdentitySchema,
    activation: PackActivationSchema,
    entities: z.array(EntityTypeDefinitionSchema).max(50),
    attributes: z.array(AttributeDefinitionSchema).max(500),
    criteria: z
      .object({
        // A pack default criterion is a `Criterion` template that
        // `instantiateCase` copies into a fresh case; reusing `CriterionSchema`
        // here (rather than a near-duplicate `CriterionDefinition` type)
        // keeps the manifest and runtime shapes from drifting apart.
        defaults: z.array(CriterionSchema).max(200),
        allowUserDefined: z.boolean(),
        protectedCriterionIds: z.array(idString()).max(200),
      })
      .strict(),
    obligations: z.array(ObligationTemplateSchema).max(200),
    extensionPolicy: z
      .object({
        allowCaseAttributes: z.boolean(),
        allowCaseCriteria: z.boolean(),
        allowCaseObligations: z.boolean(),
        userConcernTemplateId: idString(),
      })
      .strict(),
    skills: z.array(SkillReferenceSchema).max(100),
    specialists: z.array(SpecialistDefinitionSchema).max(100),
    orchestration: OrchestrationDefinitionSchema,
    tools: z.array(ToolDeclarationSchema).max(100),
    policies: z.array(PolicyDefinitionSchema).max(100),
    presentation: PresentationDefinitionSchema,
    evaluation: PackEvaluationDefinitionSchema,
    // Optional (§46/§47): a pack that declares no Decision Guide must still
    // compile, pass conformance, and -- critically -- produce the identical
    // `compiledHash` it always has (case.ts's `CasePackPinSchema` pins
    // `compiledHash`, so an already-guideless pack's hash must not drift the
    // moment this field was added). `canonicalizeManifest`
    // (packages/packs/src/canonicalize.ts) already drops `undefined` object
    // values before hashing, so an omitted `decisionGuide` and an absent one
    // serialize identically; proven directly in compiler.test.ts.
    decisionGuide: DecisionGuideSchema.optional(),
    /**
     * The pack's declared discovery process: which topics must be understood
     * before model discovery, which are conditional on the case, what
     * bounded interactions may ask about them, and which blind spots are
     * worth raising.
     *
     * Optional for the identical reason `decisionGuide` above is: a pack
     * that declares no discovery process must still compile, pass
     * conformance, and produce the *same* `compiledHash` it always has,
     * because `CasePackPin` pins that hash on every stored case.
     * `canonicalizeManifest` drops `undefined` values before hashing, so an
     * omitted `discovery` and an absent one serialize identically.
     */
    discovery: PackDiscoveryDefinitionSchema.optional(),
    /**
     * The real-world rules and standards this class of decision is
     * governed by. See `PackComplianceSchema` above for the full shape and
     * the exact optional/hash-stability reasoning, which is identical to
     * `decisionGuide`'s and `discovery`'s immediately above.
     */
    compliance: PackComplianceSchema.optional(),
  })
  .strict();
export type DecisionPackManifest = z.infer<typeof DecisionPackManifestSchema>;

const SHA256_HEX = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'compiledHash must be a lowercase hex SHA-256');

/**
 * Inferred: `ResolvedCapabilityCatalog` has no explicit field list. Grounded
 * in the compiler step "capability allowlist resolution"
 * (pack-authoring.md).
 */
export const ResolvedCapabilityCatalogSchema = z
  .object({
    skillIds: z.array(idString()).max(200),
    specialistIds: z.array(idString()).max(200),
    toolIds: z.array(idString()).max(200),
  })
  .strict();
export type ResolvedCapabilityCatalog = z.infer<typeof ResolvedCapabilityCatalogSchema>;

/**
 * Inferred: `CompiledValidatorReferences` has no explicit field list.
 * Grounded in "The compiler turns these definitions into runtime
 * validators, comparison metadata, and schema-driven forms"
 * (pack-authoring.md "Pack-defined attributes").
 */
export const CompiledValidatorReferencesSchema = z
  .object({
    attributeValidatorIds: z.array(idString()).max(500),
    obligationValidatorIds: z.array(idString()).max(200),
  })
  .strict();
export type CompiledValidatorReferences = z.infer<typeof CompiledValidatorReferencesSchema>;

export const CompiledDecisionPackSchema = DecisionPackManifestSchema.extend({
  compiledHash: SHA256_HEX,
  compiledAt: z.iso.datetime(),
  resolvedCapabilities: ResolvedCapabilityCatalogSchema,
  runtimeValidators: CompiledValidatorReferencesSchema,
}).strict();
export type CompiledDecisionPack = z.infer<typeof CompiledDecisionPackSchema>;

// --- Routing (docs/specs/packs-and-routing.md "Router input and output") ---

export const RoutingInputSchema = z
  .object({
    explicitPackId: idString().optional(),
    activeCasePack: z
      .object({ id: idString(), version: semverString, compiledHash: SHA256_HEX })
      .strict()
      .optional(),
    userGoal: safeString(2000),
    route: safeString(500),
    artifactKinds: z.array(safeString(100)).max(50),
    entitySignals: z.array(safeString(100)).max(50),
  })
  .strict();
export type RoutingInput = z.infer<typeof RoutingInputSchema>;

export const RoutingCandidateSchema = z
  .object({
    packId: idString(),
    version: semverString,
    compiledHash: SHA256_HEX,
    confidence: z.number().min(0).max(1),
    reasons: z.array(safeString(500)).max(20),
    matchedSignals: z.array(safeString(200)).max(50),
  })
  .strict();
export type RoutingCandidate = z.infer<typeof RoutingCandidateSchema>;

export const ROUTING_DECISION_KINDS = ['selected', 'needs_confirmation', 'no_match'] as const;

export const RoutingDecisionSchema = z
  .object({
    kind: z.enum(ROUTING_DECISION_KINDS),
    selected: RoutingCandidateSchema.nullable(),
    candidates: z.array(RoutingCandidateSchema).max(10),
  })
  .strict();
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
