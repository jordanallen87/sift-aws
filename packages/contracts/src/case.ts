/**
 * Canonical case data model: `CaseState` and its nested shapes from
 * docs/specs/architecture.md "Canonical data model", grounded further by
 * pack-authoring.md's `EntityRecord` and packs-and-routing.md's
 * `ObligationTemplate`.
 *
 * Several fields are named in `CaseState` (`ObligationState`, `Claim`,
 * `Source`, `EvidenceLink`, `Recommendation`, `DecisionProposal`,
 * `ActiveFocus`) without an accompanying interface anywhere in the spec set.
 * Each is defined here as the minimal reasonable shape grounded in how the
 * spec describes its behavior elsewhere; every such inference is flagged in
 * a comment immediately above the schema.
 */
import { z } from 'zod';
import {
  AttributeDefinitionSchema,
  AttributeRecordSchema,
  CASE_ATTRIBUTE_ORIGINS,
  CriterionSchema,
  TEXT_VALUE_FORMATS,
  type Criterion,
} from './attributes.js';
import { EVIDENCE_LEVELS, ObligationTemplateSchema } from './packs.js';
import { CaseExtensionSchema, type CaseExtension } from './extensions.js';
import { CandidateProvenanceSchema, DiscoveryStateSchema } from './discovery.js';

// Re-exported so consumers of case.ts (which owns `CaseState.caseExtensions`)
// do not also need to import from extensions.ts directly.
export { CaseExtensionSchema };
export type { CaseExtension };

// Re-exported so consumers of case.ts (which owns `CaseState.criteria:
// Criterion[]`) do not also need to import from attributes.ts directly.
export { CriterionSchema };
export type { Criterion };

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

// --- EntityRecord (pack-authoring.md "Stable entity envelope") ---

export const EntityRecordSchema = z
  .object({
    id: idString(),
    kind: idString(),
    label: safeString(300),
    // Keyed by AttributeDefinition id (pack-defined or `custom.*`); an open
    // `Record`, not `.strict()`, because the set of attribute ids is
    // extensible per case (pack-authoring.md "Typed core with extensible
    // domain data"). Bounded to a defensive maximum entry count below.
    attributes: z
      .record(z.string(), AttributeRecordSchema)
      .refine((attributes) => Object.keys(attributes).length <= 500, {
        message: 'an entity may not carry more than 500 attributes',
      }),
    /**
     * Where this entity came from, and — critically — whether it is a *model*
     * or a specific *listing*. Optional so that every entity persisted or
     * constructed before this field existed still parses and still
     * typechecks (the same reasoning `CaseState.notes` documents at length);
     * an entity with no provenance makes no provenance claim at all, which
     * is the honest default. `CandidateProvenanceSchema` refuses
     * `level: 'listing'` without a listing block, so "this exact car, at
     * this dealer, at this price" cannot be asserted by accident.
     */
    provenance: CandidateProvenanceSchema.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type EntityRecord = z.infer<typeof EntityRecordSchema>;

// --- ObligationState ---
// Inferred: `deriveObligations(caseState): ObligationState[]` (architecture.md
// "Deterministic core") returns the runtime projection of an
// `ObligationTemplate` for one case. Grounded in: packs-and-routing.md's
// "case obligation ... inherits pack bounds and evidence semantics, records
// its originating criterion" (hence the optional `criterionId`, present only
// for `origin: 'case_extension'`); strands-runtime.md's `ExecutionResult.
// suggestedStatus` vocabulary (`open`/`satisfied`/`accepted_uncertainty`/
// `blocked`); and product.md's "Readiness" region grouping obligations by
// "satisfied, active, blocked, accepted uncertainty, and open" (adding the
// `active` status for "currently being investigated").

export const OBLIGATION_STATUSES = [
  'open',
  'active',
  'satisfied',
  'accepted_uncertainty',
  'blocked',
] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

const ObligationStateShape = ObligationTemplateSchema.extend({
  status: z.enum(OBLIGATION_STATUSES),
  attemptsUsed: z.number().int().min(0).max(20),
  // Present only for `origin: 'case_extension'` obligations, linking back to
  // the `Criterion` that produced them.
  criterionId: idString().optional(),
  updatedAt: z.iso.datetime(),
}).strict();

export const ObligationStateSchema = ObligationStateShape.superRefine((obligation, ctx) => {
  if (obligation.origin === 'case_extension' && obligation.criterionId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['criterionId'],
      message: 'a case_extension obligation must record its originating criterionId',
    });
  }
});
export type ObligationState = z.infer<typeof ObligationStateSchema>;

// --- Claim ---
// Inferred: `CaseState.claims: Claim[]` has no field list. Grounded in
// strands-runtime.md's `ExecutionResult.claims` shape (`statement`, `stance`,
// `confidence`, `sourceIds`), adding a persisted `id`/`obligationId`/
// `createdAt`/`stale` since canonical claims are addressable
// (testing.md ScenarioAssertion `claim_linked: { claimId, sourceIds }`) and
// can be invalidated when supporting evidence goes stale.

export const CLAIM_STANCES = ['supports', 'opposes', 'neutral'] as const;
export type ClaimStance = (typeof CLAIM_STANCES)[number];

export const ClaimSchema = z
  .object({
    id: idString(),
    obligationId: idString(),
    entityId: idString().optional(),
    statement: safeString(2000),
    stance: z.enum(CLAIM_STANCES),
    confidence: z.number().min(0).max(1),
    sourceIds: z.array(idString()).max(50),
    stale: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Claim = z.infer<typeof ClaimSchema>;

// --- Source ---
// Inferred: `CaseState.sources: Source[]` has no field list. Grounded in
// webmcp.md `sift_submit_source`'s input shape (`url`, `title`, `publisher`,
// `publishedAt`, `retrievedAt`, `excerpt`), adding a persisted `id`/`origin`/
// `verification`/`createdAt` per "submitted sources remain unverified until
// source challenge and retain provenance" (webmcp.md).

/**
 * The most options one case may hold. Exported because the UI must enforce
 * the SAME number the contract does: `OptionEditor` previously hardcoded its
 * own limit of 5, which no contract, command or store ever agreed with, so a
 * pack seeding twelve options rendered an Add form that refused every entry
 * ("You have reached the 5-Bid demo limit") on a case the engine was
 * perfectly happy with. A cap belongs in one place, and this is it.
 */
export const MAX_CASE_ENTITIES = 50;

export const SOURCE_ORIGINS = ['fixture', 'user_submitted', 'agent_discovered'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const SOURCE_VERIFICATIONS = ['unverified', 'challenged', 'verified', 'rejected'] as const;
export type SourceVerification = (typeof SOURCE_VERIFICATIONS)[number];

export const SourceSchema = z
  .object({
    id: idString(),
    url: z.url().max(2000),
    title: safeString(500),
    publisher: safeString(200).optional(),
    publishedAt: z.iso.datetime().optional(),
    retrievedAt: z.iso.datetime(),
    excerpt: safeString(5000).optional(),
    /**
     * Free-form labels for organising the case's reference library --
     * "the way I'm thinking about this... research papers, blogs, and any
     * other detail that might be relevant to the case", with tagging so the
     * UI can group it.
     *
     * Deliberately free-form rather than a pack-declared enum: the whole
     * point of a reference library is that it collects material nobody
     * anticipated, which is the same reasoning that makes `custom.*`
     * attributes free-form. Bounded (20 tags, 60 chars) because
     * architecture.md requires model-supplied input to be size-bounded, and
     * `safeString` because these are rendered directly.
     */
    tags: z.array(safeString(60)).max(20).optional(),
    /**
     * The submitter's OWN summary of why this reference matters to this
     * case -- distinct from `excerpt`, which is a quotation FROM the source.
     * Conflating the two would let a model's paraphrase be read as the
     * source's own words, which is the kind of quiet misattribution the
     * evidence model exists to prevent. Markdown for the same reason (and
     * with the same safety boundary) as `TextAttributeValueSchema.format`.
     */
    summary: safeString(20_000).optional(),
    summaryFormat: z.enum(TEXT_VALUE_FORMATS).optional(),
    origin: z.enum(SOURCE_ORIGINS),
    verification: z.enum(SOURCE_VERIFICATIONS),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type Source = z.infer<typeof SourceSchema>;

// --- EvidenceLink ---
// Inferred: `CaseState.evidenceLinks: EvidenceLink[]` has no field list.
// Grounded in strands-runtime.md's `ExecutionResult.evidenceResults` shape
// (`sourceId`, `level`, `verdict`, `summary`) plus the canonical, core-owned
// disposition/staleness layer described in webmcp.md `sift_set_evidence_
// disposition` ("include, exclude, or question one evidence item ... does
// not delete the source") and architecture.md ("evidence validity" is
// core-owned). This is the "evidence item" `sift_focus_evidence`/
// `CaseState.selectedEvidenceId` refer to.

export const EVIDENCE_VERDICTS = ['pass', 'fail', 'error', 'degraded', 'skipped'] as const;
export type EvidenceVerdict = (typeof EVIDENCE_VERDICTS)[number];

export const EVIDENCE_DISPOSITIONS = ['included', 'excluded', 'questioned'] as const;
export type EvidenceDisposition = (typeof EVIDENCE_DISPOSITIONS)[number];

export const EvidenceLinkSchema = z
  .object({
    id: idString(),
    obligationId: idString(),
    claimId: idString().optional(),
    sourceId: idString().optional(),
    level: z.enum(EVIDENCE_LEVELS),
    verdict: z.enum(EVIDENCE_VERDICTS),
    disposition: z.enum(EVIDENCE_DISPOSITIONS),
    dispositionReason: safeString(2000).optional(),
    summary: safeString(2000),
    stale: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

// --- ActiveFocus ---
// Inferred: `CaseState.activeFocus: ActiveFocus | null` has no field list.
// Distinguished from the separate `selectedOptionId`/`selectedEvidenceId`
// fields (which track the *user's or ChatGPT's* WebMCP-driven selection via
// `sift_focus_option`/`sift_focus_evidence`): `activeFocus` is the *system's*
// "Current focus" card from product.md's workspace layout ("the obligation
// being investigated, why it is next, active skill, and active specialist").

export const ActiveFocusSchema = z
  .object({
    obligationId: idString(),
    reason: safeString(2000),
    skillId: idString().optional(),
    specialistId: idString().optional(),
    runId: idString().optional(),
    since: z.iso.datetime(),
  })
  .strict();
export type ActiveFocus = z.infer<typeof ActiveFocusSchema>;

// --- Recommendation ---
// Inferred: `CaseState.recommendation: Recommendation | null` has no field
// list. Grounded in strands-runtime.md's GoalLoop validator, which "checks
// source linkage, resolved required obligations or accepted uncertainty,
// allowed confidence, separation of fact and hypothesis, and absence of
// forbidden effects" (hence `facts`/`hypotheses` as separate arrays,
// `sourceIds`, `confidence`, `resolvedObligationIds`/
// `acceptedUncertaintyObligationIds`), and testing.md's `recommendation:
// { favoredOptionId }` scenario assertion. `status` distinguishes a fresh,
// actionable recommendation (`ready`) from one a later criteria/evidence
// change has invalidated (`stale`), matching the `recommendation.
// invalidated`/`recommendation.ready` PublicActivityEvent types.

export const RECOMMENDATION_STATUSES = ['ready', 'stale'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const RecommendationSchema = z
  .object({
    id: idString(),
    status: z.enum(RECOMMENDATION_STATUSES),
    favoredOptionId: idString().nullable(),
    rationale: safeString(20_000),
    facts: z.array(safeString(2000)).max(50),
    hypotheses: z.array(safeString(2000)).max(50),
    confidence: z.number().min(0).max(1),
    limitations: z.array(safeString(2000)).max(50),
    sourceIds: z.array(idString()).max(100),
    resolvedObligationIds: z.array(idString()).max(100),
    acceptedUncertaintyObligationIds: z.array(idString()).max(100),
    generatedAt: z.iso.datetime(),
  })
  .strict();
export type Recommendation = z.infer<typeof RecommendationSchema>;

// --- DecisionProposal ---
// Inferred: `CaseState.proposal: DecisionProposal | null` has no field list.
// Grounded in `reviewProposal(caseState, decision): CaseState`
// (architecture.md "Deterministic core") and "`reviewProposal` rejects
// requests whose `actor` is not `human`" (architecture.md "Security and
// authority"). `Actor` deliberately allows `'agent'` at the schema level —
// the "human-only approval" rule is a core-reducer *behavior* under test
// (testing.md: "an agent actor can never produce an approved decision"), not
// a static type-level restriction; a schema that only permitted `'human'`
// would make that rule untestable at the reducer boundary.

export const ActorSchema = z.enum(['human', 'agent']);
export type Actor = z.infer<typeof ActorSchema>;

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'revision_requested'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const DecisionProposalSchema = z
  .object({
    id: idString(),
    recommendationId: idString(),
    status: z.enum(PROPOSAL_STATUSES),
    createdAt: z.iso.datetime(),
    reviewedAt: z.iso.datetime().optional(),
    reviewedByActor: ActorSchema.optional(),
    revisionInstructions: safeString(5000).optional(),
    // Mirrors `EvidenceLink.dispositionReason`'s precedent: the reviewer's
    // own free-text explanation for their decision (`ReviewProposalInput
    // .reason`, `commands.ts` -- always-optional, any of the three
    // decisions). Added because a real, user-reachable defect let this field
    // be validated, transmitted (`apps/web/src/app/App.tsx`'s
    // `handleReviewProposal` genuinely sends it), and then silently
    // discarded: `packages/core/src/policy.ts`'s `reviewProposal` never
    // wrote it anywhere, so a human's stated reason for declining or
    // approving a consequential action vanished the instant they submitted
    // it -- never on the case, never in the activity stream, nowhere. See
    // `policy.ts`'s `reviewProposal` doc comment for the write.
    reviewReason: safeString(2000).optional(),
  })
  .strict();
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;

// --- WorkspaceViewState (docs/decisions/0005-workspace-view-state-and-
// option-views.md "Decision" §1-2, sketched at docs/change-sets/
// 2026-08-30-generic-decision-workspace.md §13) ---
//
// Presentation state for the four option views (Quick Pick/List/Compare/
// Board). Deliberately NOT modeled as a `CaseEvent`-driven field: ADR 0005's
// central decision is that this persists exclusively through
// `apps/agent/src/store/case-store.ts`'s `SelectionPatch`/`updateSelection()`
// escape hatch (same non-event path `activeFocus`/`selectedOptionId` already
// use), so that a presentation change can never advance `eventSequence` or
// reach recommendation-invalidation logic -- "presentation filtering ≠
// criterion mutation" (change-set §54) becomes true by construction rather
// than by convention. See `CaseState.view` below for the nullable+optional
// field this schema populates.

export const WORKSPACE_VIEW_MODES = ['quick_pick', 'list', 'compare', 'board'] as const;
export type WorkspaceViewMode = (typeof WORKSPACE_VIEW_MODES)[number];

export const WorkspaceViewSortSchema = z
  .object({
    fieldId: idString(),
    direction: z.enum(['asc', 'desc']),
  })
  .strict();
export type WorkspaceViewSort = z.infer<typeof WorkspaceViewSortSchema>;

// A conservative, self-contained comparison vocabulary for presentation-only
// filtering -- distinct from `AttributeComparison` (attributes.ts), which
// describes how an attribute is *scored*, not how a view is *filtered*.
export const WORKSPACE_FILTER_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'less_than',
  'less_than_or_equal',
  'greater_than',
  'greater_than_or_equal',
] as const;
export type WorkspaceFilterOperator = (typeof WORKSPACE_FILTER_OPERATORS)[number];

export const WorkspaceFilterSchema = z
  .object({
    fieldId: idString(),
    operator: z.enum(WORKSPACE_FILTER_OPERATORS),
    value: safeString(500),
  })
  .strict();
export type WorkspaceFilter = z.infer<typeof WorkspaceFilterSchema>;

// Board column placement lives inside the column itself (`optionIds`), so a
// column's membership list IS an option's placement -- there is no separate
// per-option placement map to keep in sync.
export const BoardColumnDefinitionSchema = z
  .object({
    id: idString(),
    label: safeString(200),
    optionIds: z.array(idString()).max(50),
  })
  .strict();
export type BoardColumnDefinition = z.infer<typeof BoardColumnDefinitionSchema>;

export const WorkspaceCompareStateSchema = z
  .object({
    optionIds: z.array(idString()).max(50),
  })
  .strict();
export type WorkspaceCompareState = z.infer<typeof WorkspaceCompareStateSchema>;

export const WorkspaceBoardStateSchema = z
  .object({
    columns: z.array(BoardColumnDefinitionSchema).max(20),
  })
  .strict();
export type WorkspaceBoardState = z.infer<typeof WorkspaceBoardStateSchema>;

export const WorkspaceQuickPickStateSchema = z
  .object({
    queue: z.array(idString()).max(50),
    position: z.number().int().min(0),
  })
  .strict();
export type WorkspaceQuickPickState = z.infer<typeof WorkspaceQuickPickStateSchema>;

export const WorkspaceViewStateSchema = z
  .object({
    mode: z.enum(WORKSPACE_VIEW_MODES),
    focusedOptionId: idString().optional(),
    // Plan task E8: lets ChatGPT point the human at a specific unresolved
    // question (an ObligationState id) through WebMCP -- separate from
    // `activeFocus`, which is system-owned (set by the deterministic core,
    // e.g. when a specialist run starts investigating an obligation) rather
    // than model-settable. Plain `.optional()` (not `.nullable()`), matching
    // every other optional member of this schema: an absent key means "no
    // question is focused," and there is no persisted-before-this-field
    // backward-compatibility concern here the way there is for `CaseState
    // .view` itself (see that field's own comment) -- this is a new member
    // of an already-optional/nullable schema, not a new top-level `CaseState`
    // field.
    focusedQuestionId: idString().optional(),
    visibleOptionIds: z.array(idString()).max(50).optional(),
    visibleAttributeIds: z.array(idString()).max(500).optional(),
    pinnedAttributeIds: z.array(idString()).max(500).optional(),
    sort: WorkspaceViewSortSchema.optional(),
    filters: z.array(WorkspaceFilterSchema).max(50).optional(),
    compare: WorkspaceCompareStateSchema.optional(),
    board: WorkspaceBoardStateSchema.optional(),
    quickPick: WorkspaceQuickPickStateSchema.optional(),
  })
  .strict();
export type WorkspaceViewState = z.infer<typeof WorkspaceViewStateSchema>;

// --- CaseNote (docs/change-sets/2026-08-30-generic-decision-workspace.md §28
// "Notes") ---
//
// A human's or the model's observation attached to a case -- "the seat
// position felt wrong on the test drive", "dealer said the timing belt was
// done at 90k". Real, first-class content, event-sourced like every other
// canonical case record (`note.added`, events.ts), but deliberately outside
// the evidence pipeline: adding a note never satisfies an obligation, never
// changes readiness, never invalidates a recommendation, and never appears
// as a `Source`/`EvidenceLink`. §28: "notes do NOT automatically become
// evidence." A human may later act on what a note says by submitting real
// evidence (`submitSource`, a separate, explicit command) -- nothing about
// `CaseNote` itself can silently become evidence, which is exactly what
// keeps the deterministic core (not an LLM) the sole owner of evidence
// validity and readiness (docs/engineering-principles.md "Non-negotiable product truths").
//
// `origin`/`authoredBy` reuse `CaseAttributeDefinition`'s exact
// origin-vocabulary pattern (`CASE_ATTRIBUTE_ORIGINS`, `proposedBy`) rather
// than inventing a third parallel "who wrote this" enum: `origin` is the
// coarse `'user'` vs `'agent_proposed'` category (deliberately never
// `'pack'`, unlike the broader `ATTRIBUTE_ORIGINS` -- a pack never writes a
// note), `authoredBy` is the free-text identity within that category
// (`'user'`, or a specific specialist/agent id), matching
// `command-service.ts`'s existing `origin === 'user' ? 'user' : 'model'`
// convention already used for `defineCaseAttribute`.
//
// `optionIds`/`obligationId` are the "optionally a link to the option or
// question it concerns": §28's own conceptual shape carries `optionIds:
// string[]` (a note may reference zero, one, or several options at once,
// e.g. comparing two candidates in one observation), and independently a
// note may concern one specific unresolved question -- the same
// `ObligationState` id `WorkspaceViewState.focusedQuestionId` already calls
// a "question." `sourceIds` lets a note cite existing `Source` records
// purely informationally: naming a source id here creates no `EvidenceLink`
// and does not change that source's `verification` -- only `submitSource`/
// `setEvidenceDisposition` do that.
export const CASE_NOTE_KINDS = [
  'observation',
  'research',
  'question',
  'preference',
  'reminder',
] as const;
export type CaseNoteKind = (typeof CASE_NOTE_KINDS)[number];

export const CaseNoteSchema = z
  .object({
    id: idString(),
    body: safeString(2000),
    kind: z.enum(CASE_NOTE_KINDS),
    origin: z.enum(CASE_ATTRIBUTE_ORIGINS),
    authoredBy: safeString(200),
    optionIds: z.array(idString()).max(50),
    obligationId: idString().optional(),
    sourceIds: z.array(idString()).max(50),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type CaseNote = z.infer<typeof CaseNoteSchema>;

// --- CaseState (architecture.md "Canonical data model") ---

// Only 'draft' (create-case.ts, reducer.ts's `case.created` fold) and
// 'decided' (reducer.ts's `proposal.reviewed` fold, policy.ts's
// `reviewProposal`, both only on an approved decision) are ever assigned
// anywhere in the codebase. The previously-declared 'investigating',
// 'waiting', 'ready', and 'failed' values had no producer and were removed;
// see docs/audits/2026-08-30-generic-decision-workspace-audit.md §4.
export const CASE_STATUSES = ['draft', 'decided'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_PACK_SELECTED_BY = ['user', 'router'] as const;

export const CasePackPinSchema = z
  .object({
    id: idString(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be a semantic version'),
    compiledHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'compiledHash must be a lowercase hex SHA-256'),
    selectedBy: z.enum(CASE_PACK_SELECTED_BY),
    reasons: z.array(safeString(500)).max(20),
  })
  .strict();
export type CasePackPin = z.infer<typeof CasePackPinSchema>;

export const CaseStateSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: idString(),
    title: safeString(300),
    status: z.enum(CASE_STATUSES),
    pack: CasePackPinSchema,
    attributeDefinitions: z.array(AttributeDefinitionSchema).max(500),
    entities: z.array(EntityRecordSchema).max(MAX_CASE_ENTITIES),
    criteria: z.array(CriterionSchema).max(200),
    obligations: z.array(ObligationStateSchema).max(200),
    // The durable record of every case-scoped concern this case has ever
    // defined, pack-anticipated or not — added post-hoc after the parallel
    // `packages/core` build surfaced that `evaluateReadiness` had no way to
    // check an `origin: 'case_extension'` obligation's originating
    // extension's `definition.confirmation` from `CaseState` alone (an
    // unconfirmed agent-proposed extension's obligation must never count
    // toward readiness per architecture.md's "Security and authority"
    // section). Cross-referenced from `ObligationState.criterionId` via
    // `CaseExtension.linkedCriterionId`.
    caseExtensions: z.array(CaseExtensionSchema).max(200),
    claims: z.array(ClaimSchema).max(1000),
    sources: z.array(SourceSchema).max(500),
    evidenceLinks: z.array(EvidenceLinkSchema).max(1000),
    // Optional (not required/defaulted), exactly matching `view` immediately
    // below: `.optional()` lets a snapshot persisted before this field
    // existed still parse with the key entirely absent, and -- unlike
    // `.default([])` -- keeps `notes` out of the *required* fields of the
    // inferred `CaseState` TypeScript type. That distinction matters beyond
    // parsing: several other modules across this monorepo construct a
    // literal object typed as `CaseState` (`packages/scenarios`, `apps/web`
    // fixtures, ...), outside this task's file-ownership boundary. A
    // required field would force every one of those literals to be edited
    // just to keep typechecking, which this task must not do. No `.nullable()`
    // counterpart is needed (unlike `view`, which a command can explicitly
    // clear back to null): nothing ever un-adds a note, so "absent" and "not
    // yet populated" are the only two states that exist.
    notes: z.array(CaseNoteSchema).max(500).optional(),
    recommendation: RecommendationSchema.nullable(),
    proposal: DecisionProposalSchema.nullable(),
    activeFocus: ActiveFocusSchema.nullable(),
    selectedOptionId: idString().nullable(),
    selectedEvidenceId: idString().nullable(),
    // Optional (not just nullable, unlike `activeFocus`) so a snapshot
    // persisted before this field existed still parses -- `.optional()`
    // lets the key be entirely absent; `.nullable()` still lets it be
    // explicitly cleared once set. See the WorkspaceViewState module
    // comment above and ADR 0005 "Consequences".
    view: WorkspaceViewStateSchema.nullable().optional(),
    /**
     * Adaptive discovery: the topics this case has covered, the blind-spot
     * review, the Quick Pick dispositions, and any interaction currently on
     * screen. See discovery.ts for the four rules it makes unrepresentable.
     *
     * `.optional()` for exactly the reasons `notes` documents above: a
     * snapshot persisted before this field existed must still parse, and
     * the many `CaseState` object literals across `packages/scenarios`,
     * `apps/web` fixtures, and `apps/agent` must keep typechecking without
     * being rewritten. A case with no `discovery` is a case that has not
     * started discovery — which is the truthful reading of an absent key,
     * not a placeholder for one.
     *
     * Deliberately NOT nullable: unlike `view`, nothing ever clears
     * discovery back to "explicitly nothing". Topics move between statuses;
     * they do not get erased.
     */
    discovery: DiscoveryStateSchema.optional(),
    eventSequence: z.number().int().min(0),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type CaseState = z.infer<typeof CaseStateSchema>;
