/**
 * `SiftCommands` input/output schemas (docs/specs/architecture.md "Shared
 * command client") and the WebMCP tool input catalog
 * (docs/specs/webmcp.md "Tool catalog").
 *
 * Where a WebMCP tool's input is identical in shape to a `SiftCommands`
 * input, this module defines the `SiftCommands` schema once and exports the
 * WebMCP tool schema as an alias of it (documented at each alias), instead
 * of duplicating the shape. Two WebMCP tools --
 * `sift_set_evidence_disposition` and `sift_request_revision` -- have no
 * corresponding method in architecture.md's `SiftCommands` interface; their
 * schemas are defined independently, grounded directly in webmcp.md. This is
 * a real gap between architecture.md's interface listing and webmcp.md's
 * tool catalog, not a shape I invented -- resolving *which* `SiftCommands`
 * method (if any) a later task wires `sift_set_evidence_disposition` through
 * is an implementation decision for `apps/agent`/`apps/web`, not a contracts
 * concern.
 */
import { z } from 'zod';
import {
  ATTRIBUTE_VALUE_TYPES,
  AttributeValueSchema,
  EVIDENCE_EXPECTATIONS,
  ATTRIBUTE_COMPARISONS,
  ATTRIBUTE_ORIGINS,
  ATTRIBUTE_STATUSES,
  TEXT_VALUE_FORMATS,
  CASE_ATTRIBUTE_ORIGINS,
  CRITERION_DIRECTIONS,
  CRITERION_KINDS,
} from './attributes.js';
import { CaseAttributeIdSchema } from './attributes.js';
import { CASE_NOTE_KINDS, CaseStateSchema, WorkspaceViewStateSchema } from './case.js';
import { EVIDENCE_DISPOSITIONS } from './case.js';
import { CaseExtensionReviewDecisionSchema } from './extensions.js';
import {
  CANDIDATE_DISPOSITIONS,
  IMPORTANCE_TIERS,
  InteractionRequestSchema,
  InteractionResponseSchema,
} from './discovery.js';

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

const expectedSequence = z.number().int().min(0);

// --- StartDemoInput ---
// Inferred: has no field list in architecture.md. Grounded in product.md's
// "Demo launcher": "The initial page presents exactly two options ... `car-
// purchase`/`home-energy-guardian` are the two pack ids those options start.

export const DEMO_IDS = ['car-purchase', 'home-energy-guardian', 'bid-comparison'] as const;
export type DemoId = (typeof DEMO_IDS)[number];

export const StartDemoInputSchema = z
  .object({
    demoId: z.enum(DEMO_IDS),
  })
  .strict();
export type StartDemoInput = z.infer<typeof StartDemoInputSchema>;

// --- StartCaseInput ---
// Added for docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md:
// a normal, non-demo case-creation entry point pinned to any registered
// pack id, not just the closed `DemoId` enum `startDemo` is scoped to. A
// sibling command, not an overload of `startDemo` -- see that ADR's
// "Decision" §3 for why `startDemo`'s fixture-reset semantics are kept
// separately intact rather than widened.

export const StartCaseInputSchema = z
  .object({
    packId: idString(),
  })
  .strict();
export type StartCaseInput = z.infer<typeof StartCaseInputSchema>;

// --- CheckEnergyBillFeedInput / EnergyBillFeedCheckResult ---
// The deterministic Home Energy Guardian case-creation gate
// (`packages/scenarios/src/tools/bill-feed-gate.ts`,
// `CommandService.checkEnergyBillFeed`): decides whether a bill feed is
// materially abnormal enough to open a case at all, so "a normal bill
// produces no case" is a real, reachable outcome rather than an
// unconditional case creation narrated as if it were gated.
//
// A sibling command to `startDemo`, not an overload of it, for the same
// reason `startCase` is a sibling rather than an overload (see that
// schema's own comment above): `startDemo`'s fixture-reset semantics stay
// intact and unconditional for every other demo, and this command's own
// result shape genuinely cannot be a `CommandReceipt` -- that schema
// requires a non-empty `caseId`, which does not exist when the gate
// declines to open a case.

export const ENERGY_BILL_FEED_IDS = ['anomalous', 'normal'] as const;
export type EnergyBillFeedId = (typeof ENERGY_BILL_FEED_IDS)[number];

export const CheckEnergyBillFeedInputSchema = z
  .object({
    billFeedId: z.enum(ENERGY_BILL_FEED_IDS),
  })
  .strict();
export type CheckEnergyBillFeedInput = z.infer<typeof CheckEnergyBillFeedInputSchema>;

export const EnergyBillFeedCheckResultSchema = z
  .object({
    commandId: idString(),
    billFeedId: z.enum(ENERGY_BILL_FEED_IDS),
    caseOpened: z.boolean(),
    percentAboveBaseline: z.number().finite(),
    thresholdPercent: z.number().finite(),
    reason: safeString(2000),
    /** Present if and only if `caseOpened` is `true`. */
    receipt: z.lazy(() => CommandReceiptSchema).optional(),
  })
  .strict();
export type EnergyBillFeedCheckResult = z.infer<typeof EnergyBillFeedCheckResultSchema>;

// --- SelectPackInput (webmcp.md `sift_select_pack`) ---

export const SelectPackInputSchema = z
  .object({
    caseId: idString(),
    packId: idString(),
    expectedSequence,
  })
  .strict();
export type SelectPackInput = z.infer<typeof SelectPackInputSchema>;

/** Identical shape to `SelectPackInput`; the WebMCP tool and the visible pack picker call the same command. */
export const SiftSelectPackToolInputSchema = SelectPackInputSchema;

// --- UpsertOptionInput (webmcp.md `sift_upsert_option`) ---

// `value`/`status`/`confidence`/`origin` mirror `AttributeRecordSchema`
// (attributes.ts) exactly -- that schema already supports a verified value
// with sources, a low-confidence agent inference, and an explicit
// "unknown" (value absent), per docs/decisions/0006-webmcp-two-way-
// collaboration-contract.md decision 4 ("`AttributeRecordSchema` already
// supports every field this needs ... this decision changes only the
// command input contract"). `value` is optional (was required) so a caller
// can express `status: 'unknown'` with no value -- the cross-field
// "value required unless status is unknown" invariant is deliberately not
// re-declared here via `.superRefine`; it is already enforced once, at the
// domain layer, by `@sift/core`'s `createAttributeRecord`/
// `attributeValueStatusInvariantError` (the same real function `command-
// service.ts`'s `upsertOption` already calls), so this schema only checks
// shape, matching architecture.md's "validate raw input against schema"
// step being distinct from the business-rule step that follows it.
//
// Backward compatibility: `status`/`confidence`/`origin` are all optional,
// so an existing caller passing only `{ definitionId, value }` (and
// optionally `label`/`sourceIds`) parses identically to before this change.
const OptionAttributeInputSchema = z
  .object({
    definitionId: idString(),
    label: safeString(200).optional(),
    value: AttributeValueSchema.optional(),
    sourceIds: z.array(idString()).max(50).optional(),
    status: z.enum(ATTRIBUTE_STATUSES).optional(),
    confidence: z.number().min(0).max(1).optional(),
    origin: z.enum(ATTRIBUTE_ORIGINS).optional(),
  })
  .strict();

export const UpsertOptionInputSchema = z
  .object({
    caseId: idString(),
    optionId: idString().optional(),
    expectedSequence,
    option: z
      .object({
        label: safeString(300),
        kind: idString(),
        attributes: z.array(OptionAttributeInputSchema).max(100),
      })
      .strict(),
  })
  .strict();
export type UpsertOptionInput = z.infer<typeof UpsertOptionInputSchema>;

/** Identical shape to `UpsertOptionInput`. */
export const SiftUpsertOptionToolInputSchema = UpsertOptionInputSchema;

// --- SetOptionAttributeInput (webmcp.md `sift_set_option_attribute`) ---
// docs/decisions/0006-webmcp-two-way-collaboration-contract.md decision 4: a
// narrower alternative to `UpsertOptionInput` for the case §25 describes --
// `upsertOption` replaces an entity's *entire* attributes map, so a caller
// that wants to set exactly one attribute must resend every other one, and
// any it omits are destroyed (unsafe for a scoped write from ChatGPT). This
// command writes exactly one attribute on one EXISTING option, merging it
// into the entity's attributes map rather than replacing it.
//
// Reuses `OptionAttributeInputSchema` unchanged -- the same single-attribute
// vocabulary (`value`, `status`, `confidence`, `origin`, `sourceIds`)
// `upsertOption` already carries is exactly what a scoped write needs; see
// that schema's own doc comment for why each field exists and why `value`
// is optional (status "unknown" carries no value).
//
// Unlike `UpsertOptionInputSchema`, `optionId` is required, not generated:
// this command can only write onto an option that already exists on the
// case. `command-service.ts`'s handler rejects both an unknown `optionId`
// and an unknown `attribute.definitionId` (not declared anywhere on the
// case, pack-defined or case-extension) as a clean validation error, never a
// silent no-op -- a stricter existence rule than `upsertOption`'s own open
// `Record` attributes map enforces, deliberate for this narrower, more
// authoritative operation.

export const SetOptionAttributeInputSchema = z
  .object({
    caseId: idString(),
    optionId: idString(),
    expectedSequence,
    attribute: OptionAttributeInputSchema,
  })
  .strict();
export type SetOptionAttributeInput = z.infer<typeof SetOptionAttributeInputSchema>;

/** Identical shape to `SetOptionAttributeInput`. */
export const SiftSetOptionAttributeToolInputSchema = SetOptionAttributeInputSchema;

// --- AddNoteInput (webmcp.md `sift_add_note` -- docs/change-sets/2026-08-30-
// generic-decision-workspace.md §28 "Notes" / §29 "WebMCP should be able to
// add research and notes") ---
//
// `CaseNote` (case.ts) is a first-class, event-sourced concept distinct from
// `Source`/`Claim`/`EvidenceLink`: "Not every thought belongs as evidence,
// criterion, or attribute" (§28). Deliberately does NOT reuse
// `SubmitSourceInputSchema`'s shape -- a note carries no URL/publisher/
// retrievedAt provenance and, critically, its command handler never derives
// an `EvidenceLink` from it. Keeping the input schemas separate (rather than
// widening `SubmitSourceInput` with an "is this actually a note" flag) is
// what makes "notes never auto-promote to evidence" true by construction --
// a caller literally cannot reach the evidence-creating code path through
// this schema -- rather than by convention.
//
// `origin` mirrors `DefineCaseAttributeInputSchema.origin`'s exact channel
// (optional, defaulting to `'user'` at the command-handler layer): reuses
// the already-established `CASE_ATTRIBUTE_ORIGINS` ('user'/'agent_proposed')
// vocabulary rather than inventing a third parallel "who wrote this" enum
// for notes alone -- see `CaseNoteSchema`'s own doc comment (case.ts) for
// the full reasoning.
//
// `note.optionIds`/`note.obligationId`/`note.sourceIds` are all optional:
// §28's requirements list only "notes may reference options" as something
// the concept must support, not something every note must carry.
const AddNoteDraftSchema = z
  .object({
    body: safeString(2000),
    kind: z.enum(CASE_NOTE_KINDS).optional(),
    optionIds: z.array(idString()).max(50).optional(),
    obligationId: idString().optional(),
    sourceIds: z.array(idString()).max(50).optional(),
  })
  .strict();

export const AddNoteInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    origin: z.enum(CASE_ATTRIBUTE_ORIGINS).optional(),
    note: AddNoteDraftSchema,
  })
  .strict();
export type AddNoteInput = z.infer<typeof AddNoteInputSchema>;

/** Identical shape to `AddNoteInput`. */
export const SiftAddNoteToolInputSchema = AddNoteInputSchema;

// --- FocusOptionInput (webmcp.md `sift_focus_option`) ---
//
// `optionId` is `.nullable()`, not just `idString()`: `CaseState.
// selectedOptionId` (case.ts) is itself `idString().nullable()`, and
// `SelectionPatch`/`updateSelection()` (apps/agent/src/store/case-store.ts)
// already accept and persist an explicit `null` to CLEAR the selection --
// that store-level support predates this schema change and was simply
// unreachable through this command. Before this, a caller that wanted to
// un-focus an option (the option card's `aria-pressed` toggle-button
// semantics promise this is possible) had no value it could send: leaving
// `optionId` required meant "clear the selection" was inexpressible in the
// contract, even though the persistence layer beneath it always supported
// it. `null` is the one extra value this field needs, not `.optional()`
// (which would mean "field absent", a different, unneeded state -- every
// caller already sends `optionId` on every call).
export const FocusOptionInputSchema = z
  .object({
    caseId: idString(),
    optionId: idString().nullable(),
    expectedSequence,
  })
  .strict();
export type FocusOptionInput = z.infer<typeof FocusOptionInputSchema>;

/** Identical shape to `FocusOptionInput`. */
export const SiftFocusOptionToolInputSchema = FocusOptionInputSchema;

// --- SetViewInput (webmcp.md `sift_set_view`) ---
// docs/decisions/0005-workspace-view-state-and-option-views.md "Decision" §1:
// `WorkspaceViewState` is presentation state, not a decision mutation, and
// persists exclusively through `CaseStore.updateSelection()` -- the same
// non-event-sourced path `FocusOptionInput`/`FocusEvidenceInput` already use
// for `selectedOptionId`/`selectedEvidenceId` -- never through `append()`.
// Routing a view change through `updateSelection()` makes ADR 0005's central
// guarantee true by construction: a view-only patch structurally cannot
// reach `append()`/`applyCaseEvent`, so it can never advance `eventSequence`
// or invalidate a `recommendation`.
//
// `view` carries the FULL `WorkspaceViewState`, not a partial patch: the
// caller sends the complete view state it wants persisted, matching how
// `CaseState.view` itself is stored (one nullable/optional field holding the
// whole object, not something merged field-by-field). `expectedSequence` is
// still required and checked (optimistic concurrency applies the same way
// it does to every other command -- see `command-service.ts`'s `setView`),
// even though a successful apply leaves it unchanged.

export const SetViewInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    view: WorkspaceViewStateSchema,
  })
  .strict();
export type SetViewInput = z.infer<typeof SetViewInputSchema>;

/** Identical shape to `SetViewInput`. */
export const SiftSetViewToolInputSchema = SetViewInputSchema;

// --- DefineCaseAttributeInput (webmcp.md `sift_define_case_attribute`) ---
// Deliberately narrower than `CaseAttributeDefinitionSchema` (attributes.ts):
// `required`, `sensitive`, `confirmation`, `proposedBy`, and `createdAt` are
// assigned by the command handler, not supplied by the caller, per
// webmcp.md's exact input shape.
//
// `origin` (top-level, sibling to `definition`, not inside it) IS supplied
// by the caller, per docs/change-sets/2026-08-30-generic-decision-
// workspace.md §23's "Custom field creation authority" distinction --
// "Explicit user request ... ChatGPT may create it as user-originated" vs.
// "Agent-generated idea ... it should propose it ... User confirms" -- and
// docs/decisions/0006-webmcp-two-way-collaboration-contract.md. Optional,
// defaulting to `'user'` when absent (preserving pre-existing behavior for
// every caller that predates this field): the ONE calling agent decides,
// per call, whether the concern it is submitting is something the human
// just said (`'user'`) or something the agent itself inferred
// (`'agent_proposed'`).
//
// UPDATED by ADR 0011: `origin` no longer decides the confirmation state on
// its own. The PACK does, via `extensionPolicy.allowCaseAttributes` -- where
// the pack pre-authorizes case attributes, an agent-originated definition
// lands `confirmed` with its provenance intact; where it forbids them, the
// command is rejected outright. `origin` remains fully load-bearing for
// three other things: it is recorded on the definition so the UI can say
// who added it, it governs whether `values` must accompany the definition
// (see `DefineCaseAttributeInputSchema` below), and it still gates
// `status: 'verified'` -- only `origin: 'user'` may ever claim that
// (`packages/core/src/attributes.ts`'s `attributeStatusOriginError`).
//
// Rationale, from the project owner: the conversation is the primary
// surface, so a per-item confirmation click is one a user living in chat
// would simply never see -- leaving the workspace quietly diverging from
// what was discussed. Pre-authorization moves that judgment to the pack
// author, once, where it can be reasoned about.

const CaseAttributeDraftSchema = z
  .object({
    id: CaseAttributeIdSchema,
    label: safeString(200),
    valueType: z.enum(ATTRIBUTE_VALUE_TYPES),
    appliesTo: z.array(idString()).max(50),
    unit: safeString(60).optional(),
    allowedValues: z.array(safeString(200)).max(200).optional(),
    /**
     * The same grades as `allowedValues`, listed worst to best.
     *
     * Without this a model-defined enum column renders but cannot be
     * scored: `scoring.ts` rule 3 is that enums are not ordinal until
     * something declares them so, and it deliberately refuses to read an
     * order out of `allowedValues`, which is a membership set. Supplying it
     * is what lets a criterion point at a custom rating and actually move
     * the ranking -- "fits two crates" beating "fits one" is a fact about
     * this household's scale, not something the engine may infer.
     */
    orderedValues: z.array(safeString(200)).max(200).optional(),
    evidenceExpectation: z.enum(EVIDENCE_EXPECTATIONS),
    comparison: z.enum(ATTRIBUTE_COMPARISONS),
    reason: safeString(2000),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (draft.orderedValues === undefined) return;
    const issue = (message: string) => {
      ctx.addIssue({ code: 'custom', path: ['orderedValues'], message });
    };
    if (draft.valueType !== 'enum') {
      issue(
        'orderedValues only applies to an enum attribute; every other type already ranks itself',
      );
      return;
    }
    if (draft.allowedValues === undefined) {
      issue(
        'orderedValues requires allowedValues: a grade must be selectable before it can be ranked',
      );
      return;
    }
    if (new Set(draft.orderedValues).size !== draft.orderedValues.length) {
      issue(
        'orderedValues must not repeat a grade, which would give it two positions on the scale',
      );
      return;
    }
    // Same set, not merely a subset. A grade that is selectable but
    // unordered scores as "not one of the declared grades", so a partial
    // ordering ships a column that silently refuses to score some options
    // -- the half-blank column this command exists to prevent.
    const allowed = new Set(draft.allowedValues);
    const ordered = new Set(draft.orderedValues);
    const missing = [...allowed].filter((grade) => !ordered.has(grade));
    const extra = [...ordered].filter((grade) => !allowed.has(grade));
    if (extra.length > 0) {
      issue(`orderedValues lists grades that are not selectable: ${extra.join(', ')}`);
    }
    if (missing.length > 0) {
      issue(
        `orderedValues must place every allowed grade on the scale; these have no position: ${missing.join(', ')}`,
      );
    }
  });

/**
 * One option's answer for the attribute being defined.
 *
 * Either a real `value` (with the provenance any attribute record carries),
 * or `status: 'unknown'` with a `reason`. There is no third option, and
 * that is the entire point: a caller must ACCOUNT for every option it can
 * see, and neither leaving a column half-blank nor inventing a value to
 * avoid a blank is expressible.
 */
export const CaseAttributeValueDraftSchema = z
  .object({
    optionId: idString(),
    value: AttributeValueSchema.optional(),
    status: z.enum(ATTRIBUTE_STATUSES),
    confidence: z.number().min(0).max(1).optional(),
    sourceIds: z.array(idString()).max(50).optional(),
    /** Required for `status: 'unknown'` -- an unknown must say WHY it could not be established, never just render blank. */
    reason: safeString(2000).optional(),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (draft.status === 'unknown') {
      if (draft.value !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'value must be absent when status is "unknown"',
        });
      }
      if (draft.reason === undefined || draft.reason.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['reason'],
          message:
            'an unknown value must state why it could not be established -- a blank cell with no reason is indistinguishable from an oversight',
        });
      }
      return;
    }
    if (draft.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `value is required when status is "${draft.status}"`,
      });
    }
  });

/**
 * Defining a comparison column and filling it in are ONE operation.
 *
 * Before this, `sift_define_case_attribute` created the column and
 * `sift_set_option_attribute` filled cells, with nothing tying them
 * together -- so a model could add "Dog crate fit" to the comparison and
 * simply never populate it, and nothing in the product would notice or
 * report it. An empty column is worse than no column: it reads as a real
 * dimension the comparison failed to resolve.
 *
 * `values` must account for EVERY option the attribute applies to
 * (enforced in the command service, which is the only layer that can see
 * the case's entities). Each entry is a real value or an explicit,
 * reasoned unknown -- so "I could not establish this for the Outback"
 * stays a first-class, visible answer, and is never quietly the same thing
 * as "nobody asked."
 */
export const DefineCaseAttributeInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    origin: z.enum(CASE_ATTRIBUTE_ORIGINS).optional(),
    definition: CaseAttributeDraftSchema,
    values: z.array(CaseAttributeValueDraftSchema).max(50).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    // The requirement is asymmetric by ORIGIN, and deliberately so.
    //
    // A person adding "dog crate fit" is saying *this matters, go find
    // out* -- the obligation system then drives the research. Demanding
    // they fill a cell for every saved option before the field can exist
    // would invert that: it turns asking a question into answering it, and
    // the visible `CustomConcernForm` would become unusable.
    //
    // A model adding a column has, by construction, just finished looking.
    // An empty column from the model is the defect this field exists to
    // prevent -- it reads as a real dimension the comparison failed to
    // resolve, when in fact nobody ever tried. So an agent-originated
    // definition must account for every option it can see; the command
    // service checks the COVERAGE (it is the only layer that can see the
    // case's entities), while this checks that an answer was offered at all.
    if (input.origin === 'agent_proposed' && (input.values ?? []).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['values'],
        message:
          'an agent-defined case attribute must supply a value (or an explicit, reasoned unknown) for every option it applies to -- defining a comparison column without filling it in leaves a dimension that reads as unresolved rather than unasked',
      });
    }
  });
export type DefineCaseAttributeInput = z.infer<typeof DefineCaseAttributeInputSchema>;

/** Identical shape to `DefineCaseAttributeInput`. */
export const SiftDefineCaseAttributeToolInputSchema = DefineCaseAttributeInputSchema;

// --- ReviewCaseExtensionInput ---
// Inferred: named in architecture.md's `SiftCommands` interface with no field
// list. Grounded in extensions.ts's `CaseExtensionReviewDecisionSchema` and
// webmcp.md's `sift_set_evidence_disposition`/`sift_request_revision` shape
// convention (id + optional free-text reason + expectedSequence).

export const ReviewCaseExtensionInputSchema = z
  .object({
    caseId: idString(),
    extensionId: idString(),
    decision: CaseExtensionReviewDecisionSchema,
    reason: safeString(2000).optional(),
    expectedSequence,
  })
  .strict();
export type ReviewCaseExtensionInput = z.infer<typeof ReviewCaseExtensionInputSchema>;

// --- FocusEvidenceInput (webmcp.md `sift_focus_evidence`) ---
//
// `evidenceId` is `.nullable()` for the identical reason `FocusOptionInput
// Schema.optionId` is, immediately above: `CaseState.selectedEvidenceId` is
// itself `idString().nullable()`, and `SelectionPatch`/`updateSelection()`
// already persist an explicit `null` clear -- this field only needed to stop
// blocking that value from reaching it.
export const FocusEvidenceInputSchema = z
  .object({
    caseId: idString(),
    evidenceId: idString().nullable(),
    expectedSequence,
  })
  .strict();
export type FocusEvidenceInput = z.infer<typeof FocusEvidenceInputSchema>;

/** Identical shape to `FocusEvidenceInput`. */
export const SiftFocusEvidenceToolInputSchema = FocusEvidenceInputSchema;

// --- UpdateCriteriaInput (webmcp.md `sift_update_criteria`) ---

const CriterionAddOperationSchema = z
  .object({
    op: z.literal('add'),
    criterion: z
      .object({
        id: idString(),
        label: safeString(200),
        kind: z.enum(CRITERION_KINDS),
        weight: z.number().int().min(0).max(100),
        direction: z.enum(CRITERION_DIRECTIONS),
        target: AttributeValueSchema.optional(),
        appliesToAttribute: idString().optional(),
        question: safeString(2000).optional(),
      })
      .strict(),
  })
  .strict();

const CriterionRemoveOperationSchema = z
  .object({ op: z.literal('remove'), criterionId: idString() })
  .strict();

const CriterionReweightOperationSchema = z
  .object({
    op: z.literal('reweight'),
    criterionId: idString(),
    weight: z.number().int().min(0).max(100),
  })
  .strict();

const CriterionRenameOperationSchema = z
  .object({ op: z.literal('rename'), criterionId: idString(), label: safeString(200) })
  .strict();

export const CriteriaOperationSchema = z.discriminatedUnion('op', [
  CriterionAddOperationSchema,
  CriterionRemoveOperationSchema,
  CriterionReweightOperationSchema,
  CriterionRenameOperationSchema,
]);
export type CriteriaOperation = z.infer<typeof CriteriaOperationSchema>;

export const UpdateCriteriaInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    operations: z.array(CriteriaOperationSchema).min(1).max(50),
  })
  .strict();
export type UpdateCriteriaInput = z.infer<typeof UpdateCriteriaInputSchema>;

/** Identical shape to `UpdateCriteriaInput`. */
export const SiftUpdateCriteriaToolInputSchema = UpdateCriteriaInputSchema;

// --- SubmitSourceInput (webmcp.md `sift_submit_source`) ---

const SourceClaimInputSchema = z
  .object({
    statement: safeString(2000),
    appliesToEntityIds: z.array(idString()).max(20),
  })
  .strict();

const SubmittedSourceInputSchema = z
  .object({
    url: z.url().max(2000),
    title: safeString(500),
    publisher: safeString(200).optional(),
    publishedAt: z.iso.datetime().optional(),
    retrievedAt: z.iso.datetime(),
    excerpt: safeString(5000).optional(),
    /** Free-form labels for the case's reference library -- see `SourceSchema.tags`. */
    tags: z.array(safeString(60)).max(20).optional(),
    /** The submitter's own summary of why this reference matters, distinct from `excerpt` (a quotation FROM the source). See `SourceSchema.summary`. */
    summary: safeString(20_000).optional(),
    summaryFormat: z.enum(TEXT_VALUE_FORMATS).optional(),
    /**
     * Empty is legitimate and is what makes a reference LIBRARY possible: a
     * paper or article can be worth keeping against the case as a whole
     * before anyone has drawn a specific claim from it. `obligationId`
     * below is likewise optional. A source with neither is a reference; a
     * source with both is evidence.
     */
    claims: z.array(SourceClaimInputSchema).max(50),
  })
  .strict();

export const SubmitSourceInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    // Optional: item 5 of docs/change-sets/2026-08-30-generic-decision-
    // workspace.md §27 ("Research must be a first-class shared resource").
    // `source.claims[]` (`statement`, `appliesToEntityIds`) carries no
    // signal identifying which `ObligationState` a claim answers --
    // `Claim.obligationId`/`EvidenceLink.obligationId` are both required
    // fields on the canonical storage records (`packages/contracts/src/
    // case.ts`, not owned by this module), so linking a submitted claim to
    // live evidence genuinely requires the caller to say which obligation
    // it addresses. When present, `command-service.ts`'s `submitSource`
    // turns every `source.claims[]` entry into durable `Claim` records
    // linked to this obligation and to the entities it names. When absent,
    // the `Source` itself still persists (unchanged, existing behavior);
    // only claim-level linkage is skipped -- an honest degradation, not a
    // silent drop (see that method's own doc comment).
    obligationId: idString().optional(),
    source: SubmittedSourceInputSchema,
  })
  .strict();
export type SubmitSourceInput = z.infer<typeof SubmitSourceInputSchema>;

/** Identical shape to `SubmitSourceInput`. */
export const SiftSubmitSourceToolInputSchema = SubmitSourceInputSchema;

// --- sift_set_evidence_disposition ---
// No corresponding `SiftCommands` method name exists in architecture.md; see
// the module-level comment. Shape matches webmcp.md exactly.

export const SetEvidenceDispositionInputSchema = z
  .object({
    caseId: idString(),
    evidenceId: idString(),
    disposition: z.enum(EVIDENCE_DISPOSITIONS),
    reason: safeString(2000),
    expectedSequence,
  })
  .strict();
export type SetEvidenceDispositionInput = z.infer<typeof SetEvidenceDispositionInputSchema>;

// --- RequestInvestigationInput (webmcp.md `sift_request_investigation`) ---

export const RequestInvestigationInputSchema = z
  .object({
    caseId: idString(),
    obligationId: idString().optional(),
    expectedSequence,
  })
  .strict();
export type RequestInvestigationInput = z.infer<typeof RequestInvestigationInputSchema>;

/** Identical shape to `RequestInvestigationInput`. */
export const SiftRequestInvestigationToolInputSchema = RequestInvestigationInputSchema;

// --- sift_request_revision ---
// No corresponding `SiftCommands` method name exists in architecture.md; see
// the module-level comment. Shape matches webmcp.md exactly (no `actor`/
// `decision` fields -- unlike `ReviewProposalInput` below, this tool can only
// ever attach a revision request; "It cannot approve or reject the
// decision.").

export const RequestRevisionInputSchema = z
  .object({
    caseId: idString(),
    proposalId: idString(),
    instructions: safeString(5000),
    expectedSequence,
  })
  .strict();
export type RequestRevisionInput = z.infer<typeof RequestRevisionInputSchema>;

// --- ReviewProposalInput ---
// Inferred: named in architecture.md's `SiftCommands` interface with no field
// list. Grounded in `reviewProposal(caseState, decision): CaseState`
// (architecture.md "Deterministic core"), "`reviewProposal` rejects requests
// whose `actor` is not `human`" (architecture.md "Security and authority"),
// and webmcp.md's `sift_request_revision` (which webmcp exposes as a
// standalone, narrower tool -- see `RequestRevisionInputSchema` above -- but
// which a later task's command-service implementation is expected to route
// through this same `reviewProposal` command, per docs/engineering-principles.md's "Visible UI
// controls and WebMCP callbacks use the same command implementation").
// `actor` deliberately allows `'agent'` structurally, matching
// `DecisionProposalSchema`'s `ActorSchema`: the human-only rule is a
// core-reducer behavior under property test, not a static schema
// restriction.

export const REVIEW_PROPOSAL_DECISIONS = ['approve', 'reject', 'request_revision'] as const;
export type ReviewProposalDecision = (typeof REVIEW_PROPOSAL_DECISIONS)[number];

const ActorSchema = z.enum(['human', 'agent']);

const ReviewProposalInputShape = z
  .object({
    caseId: idString(),
    proposalId: idString(),
    actor: ActorSchema,
    decision: z.enum(REVIEW_PROPOSAL_DECISIONS),
    instructions: safeString(5000).optional(),
    reason: safeString(2000).optional(),
    expectedSequence,
  })
  .strict();

export const ReviewProposalInputSchema = ReviewProposalInputShape.superRefine((input, ctx) => {
  if (input.decision === 'request_revision' && input.instructions === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['instructions'],
      message: 'instructions is required when decision is "request_revision"',
    });
  }
});
export type ReviewProposalInput = z.infer<typeof ReviewProposalInputSchema>;

// --- Read-only WebMCP tools (empty input) ---

export const GetCaseContextInputSchema = z.object({}).strict();
export type GetCaseContextInput = z.infer<typeof GetCaseContextInputSchema>;

export const ListPacksInputSchema = z.object({}).strict();
export type ListPacksInput = z.infer<typeof ListPacksInputSchema>;

// --- CommandReceipt / RunReceipt (architecture.md "Shared command client") ---

/**
 * Inferred: `CommandReceipt.snapshot?: CaseSnapshot` references a
 * `CaseSnapshot` type that is never separately defined -- a snapshot is the
 * case state at the accepted sequence, so this aliases `CaseStateSchema`
 * directly rather than inventing a distinct duplicate shape.
 */
export const CaseSnapshotSchema = CaseStateSchema;

export const CommandReceiptSchema = z
  .object({
    commandId: idString(),
    caseId: idString(),
    acceptedSequence: z.number().int().min(0),
    runId: idString().optional(),
    snapshot: CaseSnapshotSchema.optional(),
  })
  .strict();
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;

/**
 * `requestInvestigation` returns `Promise<RunReceipt>` rather than
 * `Promise<CommandReceipt>` (architecture.md): a run-starting command always
 * has a `runId`, unlike the general `CommandReceipt` where it is optional.
 */
export const RunReceiptSchema = CommandReceiptSchema.extend({
  runId: idString(),
}).strict();
export type RunReceipt = z.infer<typeof RunReceiptSchema>;

// --- SiftToolResult<T> (webmcp.md "Tool result envelope") ---

export const TOOL_ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'POLICY',
  'UNAVAILABLE',
  'INTERNAL',
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export const SiftToolUiSchema = z
  .object({
    changed: z.boolean(),
    focusTarget: idString().optional(),
  })
  .strict();
export type SiftToolUi = z.infer<typeof SiftToolUiSchema>;

export const SiftToolErrorSchema = z
  .object({
    code: z.enum(TOOL_ERROR_CODES),
    retryable: z.boolean(),
  })
  .strict();
export type SiftToolError = z.infer<typeof SiftToolErrorSchema>;

export interface SiftToolResult<T> {
  ok: boolean;
  message: string;
  data?: T;
  commandId?: string;
  runId?: string;
  caseId?: string;
  sequence?: number;
  ui: SiftToolUi;
  error?: SiftToolError;
}

export function SiftToolResultSchema<DataSchema extends z.ZodTypeAny>(dataSchema: DataSchema) {
  return z
    .object({
      ok: z.boolean(),
      message: safeString(2000),
      data: dataSchema.optional(),
      commandId: idString().optional(),
      runId: idString().optional(),
      caseId: idString().optional(),
      sequence: z.number().int().min(0).optional(),
      ui: SiftToolUiSchema,
      error: SiftToolErrorSchema.optional(),
    })
    .strict();
}

// --- Adaptive discovery commands ---
//
// Every command below carries an explicit `actor`, and every authority rule
// the canonical experience states is enforced *here*, at the command
// boundary, rather than left to whichever caller happens to construct the
// input. The reasoning matches `ReviewProposalInputSchema` directly above:
// the actor is a claim made by the caller, so the schema is where the claim
// meets the rule. Where a rule can be made structural it is (see
// discovery.ts); where it depends on who is asking, it lives here.

const discoveryActor = ActorSchema;

const ConfirmTopicOperationSchema = z
  .object({
    op: z.literal('confirm'),
    topicId: idString(),
    valueSummary: safeString(1000),
    importance: z.enum(IMPORTANCE_TIERS).optional(),
  })
  .strict();

/** A correction replaces a value a person previously gave. Same shape as confirm; different intent, and a different event. */
const CorrectTopicOperationSchema = z
  .object({
    op: z.literal('correct'),
    topicId: idString(),
    valueSummary: safeString(1000),
    importance: z.enum(IMPORTANCE_TIERS).optional(),
  })
  .strict();

/** What a model may do: offer a reading of what was said, for a person to accept or reject. */
const ProposeTopicOperationSchema = z
  .object({
    op: z.literal('propose'),
    topicId: idString(),
    valueSummary: safeString(1000),
    importance: z.enum(IMPORTANCE_TIERS).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const DeferTopicOperationSchema = z
  .object({ op: z.literal('defer'), topicId: idString() })
  .strict();

const NotApplicableTopicOperationSchema = z
  .object({
    op: z.literal('not_applicable'),
    topicId: idString(),
    /** Required: "this does not apply to me" is a claim, and the pane shows why. */
    reason: safeString(500),
  })
  .strict();

const RejectInferenceOperationSchema = z
  .object({ op: z.literal('reject_inference'), topicId: idString() })
  .strict();

export const DiscoveryOperationSchema = z.discriminatedUnion('op', [
  ConfirmTopicOperationSchema,
  CorrectTopicOperationSchema,
  ProposeTopicOperationSchema,
  DeferTopicOperationSchema,
  NotApplicableTopicOperationSchema,
  RejectInferenceOperationSchema,
]);
export type DiscoveryOperation = z.infer<typeof DiscoveryOperationSchema>;

/** The operations only a person may perform. An agent proposes; a person decides. */
const HUMAN_ONLY_DISCOVERY_OPS = new Set([
  'confirm',
  'correct',
  'defer',
  'not_applicable',
  'reject_inference',
]);

const UpdateDiscoveryInputShape = z
  .object({
    caseId: idString(),
    expectedSequence,
    actor: discoveryActor,
    operations: z.array(DiscoveryOperationSchema).min(1).max(20),
  })
  .strict();

export const UpdateDiscoveryInputSchema = UpdateDiscoveryInputShape.superRefine((input, ctx) => {
  if (input.actor === 'agent') {
    for (const operation of input.operations) {
      if (HUMAN_ONLY_DISCOVERY_OPS.has(operation.op)) {
        ctx.addIssue({
          code: 'custom',
          path: ['operations'],
          message: `an agent may only "propose"; "${operation.op}" is the person's decision`,
        });
      }
    }
  }

  const seen = new Set<string>();
  for (const operation of input.operations) {
    if (seen.has(operation.topicId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['operations'],
        message: `two operations act on "${operation.topicId}" in one command`,
      });
    }
    seen.add(operation.topicId);
  }
});
export type UpdateDiscoveryInput = z.infer<typeof UpdateDiscoveryInputSchema>;

/** Identical shape to `UpdateDiscoveryInput`. */
export const SiftUpdateDiscoveryToolInputSchema = UpdateDiscoveryInputSchema;

export const RequestInteractionInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    interaction: InteractionRequestSchema,
  })
  .strict();
export type RequestInteractionInput = z.infer<typeof RequestInteractionInputSchema>;

/** Identical shape to `RequestInteractionInput`. */
export const SiftRequestInteractionToolInputSchema = RequestInteractionInputSchema;

export const SubmitInteractionResponseInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    response: InteractionResponseSchema,
  })
  .strict();
export type SubmitInteractionResponseInput = z.infer<typeof SubmitInteractionResponseInputSchema>;

const SetCandidateDispositionInputShape = z
  .object({
    caseId: idString(),
    expectedSequence,
    actor: discoveryActor,
    entityId: idString(),
    /** `unreviewed` is how undo is expressed: it puts the candidate back in the queue. */
    disposition: z.enum(CANDIDATE_DISPOSITIONS),
    reason: safeString(500).optional(),
  })
  .strict();

/**
 * Quick Pick triage. There is no agent version of this command: Keep, Pass,
 * and Unsure are human judgments about whether a candidate is worth more of
 * the person's attention, and an agent that could set one could quietly
 * remove an option a person wanted.
 *
 * A disposition is deliberately NOT shortlist approval. Keep retains a
 * candidate and focuses deeper investigation on it; confirming the shortlist
 * is a separate, human-only `NextMove` with no tool attached to it at all.
 */
export const SetCandidateDispositionInputSchema = SetCandidateDispositionInputShape.superRefine(
  (input, ctx) => {
    if (input.actor !== 'human') {
      ctx.addIssue({
        code: 'custom',
        path: ['actor'],
        message: 'only a person may set a Quick Pick disposition',
      });
    }
  },
);
export type SetCandidateDispositionInput = z.infer<typeof SetCandidateDispositionInputSchema>;

const CompleteBlindSpotReviewInputShape = z
  .object({
    caseId: idString(),
    expectedSequence,
    actor: discoveryActor,
    offeredPromptIds: z.array(idString()).min(1).max(30),
    /** May be empty: "None of these" is a real answer, and the review is complete either way. */
    selectedPromptIds: z.array(idString()).max(30),
    customConcern: safeString(500).optional(),
  })
  .strict();

export const CompleteBlindSpotReviewInputSchema = CompleteBlindSpotReviewInputShape.superRefine(
  (input, ctx) => {
    if (input.actor !== 'human') {
      ctx.addIssue({
        code: 'custom',
        path: ['actor'],
        message: 'only a person may complete the blind-spot review',
      });
    }

    const offered = new Set(input.offeredPromptIds);
    for (const selected of input.selectedPromptIds) {
      if (!offered.has(selected)) {
        ctx.addIssue({
          code: 'custom',
          path: ['selectedPromptIds'],
          message: `"${selected}" was selected but never offered`,
        });
      }
    }
  },
);
export type CompleteBlindSpotReviewInput = z.infer<typeof CompleteBlindSpotReviewInputSchema>;
