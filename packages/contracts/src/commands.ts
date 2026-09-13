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

// --- SubmitBidDocumentInput ---
//
// A person's own bid document, brought into a case so its details can be
// read off it instead of retyped into a form of scalar fields. Until this
// command existed the ONLY ways an option could reach a case were
// `upsertOption`/`setOptionAttribute` (a field at a time, every value
// hand-entered) and the checked-in bid fixtures
// `packages/scenarios/src/tools/bid-reader.ts` loads. A real document had
// no way in at all.
//
// This is a sibling of `upsertOption`, not an overload of it, for the same
// reason `startCase` is a sibling of `startDemo`: the two commands differ
// in WHO is asserting. `upsertOption` writes what a person typed
// (`origin: 'user'`, `status: 'asserted'` by default); this command writes
// what a deterministic extractor READ off a document, which is a proposal
// about a fact, not the person's own assertion of it. Keeping them
// separate is what makes "extraction proposes, it never asserts on the
// person's behalf" true by construction rather than by convention -- a
// caller cannot reach `origin: 'user'` through this schema at all, because
// this schema carries no origin field to reach it with.

/**
 * The document formats the extractor can read *deterministically*, with no
 * model and no network:
 *
 *  - `application/json` -- the bid shape the checked-in fixtures already
 *    use (`packages/scenarios/fixtures/bids/bid-northgate.json`:
 *    `contractorName`, `licenseNumber`, `total`, `lineItems[]`,
 *    `allowances[]`, `warranty`, `depositPercent`, `startInWeeks`,
 *    `durationWorkingDays`).
 *  - `text/csv` -- a line-item table (a header row plus one row per priced
 *    scope item), which is what a plan room, an estimating package, or a
 *    spreadsheet export actually hands a person.
 *
 * **Decision on free text (`text/plain`): deliberately NOT accepted yet,
 * and this enum is the clean seam for adding it.** A deterministic,
 * model-free extractor cannot honestly read prose. Accepting free text now
 * would leave exactly two outcomes, and both are worse than refusing it:
 * pattern-match dollar figures out of a paragraph and assert them (a
 * fabricated reading of a document nobody checked), or read nothing and
 * return an all-unknown extraction (an import path that silently never
 * imports anything). Adding it later is additive and touches nothing else:
 * one more member here, one more branch in
 * `extractBidDocument`'s format switch, and -- when a model is genuinely
 * involved in the reading -- the *same* `origin: 'agent_proposed'` /
 * never-`'verified'` rules this command already enforces for every value
 * it writes. No shape in this file changes.
 */
export const BID_DOCUMENT_FORMATS = ['application/json', 'text/csv'] as const;
export type BidDocumentFormat = (typeof BID_DOCUMENT_FORMATS)[number];

/**
 * Hard cap on one submitted document, measured in UTF-8 **bytes**, per
 * architecture.md "Tool inputs, outputs, model responses, and persisted
 * snapshots are size-bounded". 256 KiB: the largest checked-in bid fixture
 * is under 4 KB and the fullest realistic CSV line-item table for a trade
 * package is a few tens of KB, so this is roughly two orders of magnitude
 * of headroom while still refusing an unbounded paste or a runaway upload
 * before a single byte of it is parsed.
 *
 * Enforced twice on purpose: here, so an over-size document is a clean
 * schema-level rejection the caller sees before any work is done, and again
 * inside the extractor itself (`MAX_BID_DOCUMENT_BYTES` is imported there,
 * never re-declared), so the tool is safe when called directly by a
 * specialist rather than through this command.
 */
export const MAX_BID_DOCUMENT_BYTES = 262_144;

/**
 * UTF-8 byte length. `String.prototype.length` counts UTF-16 code units, so
 * it under-counts every non-ASCII character -- a cap expressed in "bytes"
 * but checked against `.length` would accept a document up to four times
 * the stated size. `TextEncoder` is available in both Node and the browser,
 * which matters because this package is shared by `apps/agent` and
 * `apps/web`.
 */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Marks a submitted document's `text` as a MODEL's reading of a person's
 * PDF, rather than the file itself in a deterministically-parseable format
 * -- see `apps/agent/src/runtime/bid-document-reader.ts` (the model step)
 * and `apps/agent/src/routes/bid-documents.ts`'s
 * `POST /api/cases/:caseId/bid-documents/read` (the async route that runs
 * it BEFORE this command, then JSON-stringifies a successful reading into
 * an ordinary `format: 'application/json'` document, this schema's sibling
 * field, below).
 *
 * Optional, and deliberately its own object rather than a bare boolean:
 * "a model read this" alone does not say WHY a model reading is a WEAKER
 * claim than a labelled field in a machine-readable file --
 * `command-service.ts`'s `submitBidDocument` needs the model's own id (for
 * the same audit trail every other `origin: 'agent_proposed'` record
 * already carries) and the PDF's own original file name, so the `Source`
 * this command mints can be titled after the document the person actually
 * chose, not the synthesised JSON `text` carries once a reading succeeds.
 */
const SubmittedBidDocumentReadBySchema = z
  .object({
    /** Closed to `'model'`: the one non-human reader this marker exists to name. A future non-model automated reader (e.g. a deterministic OCR pass) would need its own value, not an overload of this one. */
    agent: z.literal('model'),
    /** Which model produced the reading (`SIFT_MODEL_ID`, config.ts) -- recorded for the same audit reason every other `origin: 'agent_proposed'` record's provenance is traceable. */
    modelId: safeString(200),
    /** The PDF's own file name -- the document the person actually chose. Carried here independently of `SubmittedBidDocumentSchema.filename` so the `Source` this command mints is titled correctly even if a caller ever got that sibling field wrong. */
    originalFilename: safeString(200),
    /**
     * The one original format this marker exists for today: a browser
     * extracts a PDF's text layer (this schema's own header,
     * `bid-document-reader.ts`'s) and hands the prose to a model, never the
     * reverse. A closed literal, not `BID_DOCUMENT_FORMATS` -- that enum
     * names formats the DETERMINISTIC extractor can parse directly, which a
     * raw PDF is not and never becomes; conflating the two axes would let a
     * PDF masquerade as one of that enum's deterministically-parseable
     * formats.
     */
    originalFormat: z.literal('application/pdf'),
  })
  .strict();
export type SubmittedBidDocumentReadBy = z.infer<typeof SubmittedBidDocumentReadBySchema>;

const SubmittedBidDocumentSchema = z
  .object({
    /** The document's own name, used as the `Source.title` and, when the contractor's name cannot be read, as the option's label. Never invented. */
    filename: safeString(200),
    format: z.enum(BID_DOCUMENT_FORMATS),
    /**
     * The document itself, as text.
     *
     * Deliberately a plain bounded `z.string()` rather than `safeString`.
     * `safeString`'s HTML/executable guard exists for strings that are
     * *rendered*; this one never is. It is parsed, and every value derived
     * from it re-enters these contracts through `AttributeRecordSchema`,
     * `SourceSchema`, and `EntityRecordSchema` -- all of which apply
     * `safeString` themselves, so a document carrying markup-shaped text in
     * a field that would be rendered is refused at that boundary, loudly,
     * rather than being silently rewritten here. Applying the guard to the
     * raw document instead would reject perfectly ordinary bid content (a
     * scope label reading `clearance < 24"`, say) while protecting nothing
     * that is not already protected.
     *
     * `.max()` on length is a cheap pre-filter that can never reject
     * anything the byte check would accept (UTF-8 byte length is always
     * >= UTF-16 code-unit count); the `.refine` below is the real cap.
     */
    text: z
      .string()
      .min(1)
      .max(MAX_BID_DOCUMENT_BYTES)
      .refine((text) => utf8ByteLength(text) <= MAX_BID_DOCUMENT_BYTES, {
        message: `document must not exceed ${MAX_BID_DOCUMENT_BYTES} bytes encoded as UTF-8`,
      }),
    /**
     * Where the document came from, when it came from somewhere addressable
     * (a plan-room link, a shared drive URL). Optional because the case this
     * command exists for -- a person handing over a file -- has no URL at
     * all; `command-service.ts` then mints a non-network `sift://` URI
     * naming the stored document, so `SourceSchema.url` (required) stays
     * honest instead of being filled with a fabricated web address.
     */
    sourceUrl: z.url().max(2000).optional(),
    /** Present only when `text` is a MODEL's reading of a PDF, not the file itself -- see `SubmittedBidDocumentReadBySchema`'s own doc comment. */
    readBy: SubmittedBidDocumentReadBySchema.optional(),
  })
  .strict();

export const SubmitBidDocumentInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    /**
     * Re-reading a corrected document onto the option it already produced,
     * rather than adding a second one. Optional exactly as it is on
     * `UpsertOptionInput`; absent means "create a new option".
     */
    optionId: idString().optional(),
    document: SubmittedBidDocumentSchema,
  })
  .strict();
export type SubmitBidDocumentInput = z.infer<typeof SubmitBidDocumentInputSchema>;

// No `Sift*ToolInputSchema` alias is exported for this command, unlike its
// neighbours above: webmcp.md's tool catalog declares no bid-document tool,
// and inventing one here would put a tool name in the contracts that no
// spec, registration, or handler backs.

// --- ModelReadBidDocumentSchema ---
//
// The other half of the free-text seam `BID_DOCUMENT_FORMATS`'s doc comment
// names above: "when a model is genuinely involved in the reading -- the
// *same* `origin: 'agent_proposed'` / never-`'verified'` rules this command
// already enforces for every value it writes." This is that model's output
// contract. It is not itself a `SiftCommands` input -- no command accepts it
// directly -- because a model call is async and `CommandService` is
// synchronous end-to-end (its store is `better-sqlite3`, and commands are
// replayed by `commandId` for idempotency, which a model call inside one
// would break). `apps/agent/src/runtime/bid-document-reader.ts` runs a model
// against this schema OUTSIDE and BEFORE `submitBidDocument`, then
// JSON-stringifies a valid reply into an ordinary
// `SubmitBidDocumentInput.document` with `format: 'application/json'` --
// so the proven deterministic `extractBidDocument` still does the actual
// field-by-field mapping onto attributes; this schema only bounds what a
// model may hand it.
//
// Mirrors the canonical bid shape `extractBidDocument` already reads
// (`packages/scenarios/fixtures/bids/bid-northgate.json`,
// `bid-document-extractor.ts`'s `extractJsonFields`/`readJsonWarrantyMonths`/
// `readJsonLineItems`) field-for-field: `contractorName`, `licenseNumber`,
// `total`, `depositPercent`, `startInWeeks`, `durationWorkingDays`,
// `warranty.termMonths`/`warranty.statedInWriting`, `lineItems[]`. A
// validated reply is therefore already a document that extractor
// understands with zero translation.
//
// **Every field is optional, all the way down** -- including every field of
// `warranty`, and every field of a line item but `label`/`amount` (the two a
// line item is meaningless without). That is the entire point: a model
// reading prose must be able to say nothing about a field it is not sure of,
// rather than invent a plausible-sounding value. See
// `bid-document-reader.ts`'s exported `READ_BID_DOCUMENT_PROMPT` for the
// instruction this schema exists to make enforceable, and
// `command-service.ts`'s "zero fields read" guard on `submitBidDocument`
// (search "Zero fields, not") for the sibling rule `bid-document-reader.ts`'s
// own zero-field check mirrors one layer earlier.
//
// Every numeric/length bound below is a plausibility ceiling, not a real
// domain limit -- generous on purpose (per `MAX_EXTRACTED_LINE_ITEMS`'s own
// comment, "deliberately generous while still bounded"), because the model
// already carries the only judgment call this shape makes ("did the
// document really state this"); these caps exist only to catch a garbled
// read (a stray digit, a hallucinated 40-year warranty), matching
// architecture.md "Tool inputs, outputs, model responses ... are
// size-bounded and schema-validated".

const MODEL_READ_ISO_4217_CURRENCY = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be a three-letter ISO 4217 code');

/**
 * Bound on a single dollar figure a model may read off a bid document --
 * `total.amount` and each line item's `amount.amount`. $100,000,000 is far
 * above any real trade-package bid (the largest checked-in fixture is under
 * $300,000); it exists to catch a garbled read, not to model a real ceiling.
 */
export const MAX_MODEL_READ_BID_AMOUNT = 100_000_000;

const ModelReadMoneyAmountSchema = z
  .object({
    amount: z.number().finite().nonnegative().max(MAX_MODEL_READ_BID_AMOUNT),
    currency: MODEL_READ_ISO_4217_CURRENCY,
  })
  .strict();

/** A trade bid rarely starts more than two years out; a figure past this is a misread of the schedule, not a real one. */
export const MAX_MODEL_READ_START_IN_WEEKS = 104;

/** ~8 working years -- generous headroom over any real trade-package duration, while still catching a garbled figure. */
export const MAX_MODEL_READ_DURATION_WORKING_DAYS = 2000;

/** 50 years. A workmanship warranty term past this is not a term the document plausibly states; it is a misread. */
export const MAX_MODEL_READ_WARRANTY_TERM_MONTHS = 600;

/**
 * The most line items a model-read document may contribute. Matches
 * `MAX_EXTRACTED_LINE_ITEMS` (`bid-document-extractor.ts`) exactly, so a
 * document that would clear this schema's cap never turns around and gets
 * refused a second time, once JSON-stringified, by the extractor's own
 * identical cap -- rejecting it here just gives the same answer one step
 * earlier. Not imported from that module: `@sift/contracts` must not depend
 * on `@sift/scenarios` (the dependency runs the other way), so the number is
 * restated, not shared.
 */
export const MAX_MODEL_READ_LINE_ITEMS = 200;

const ModelReadLineItemSchema = z
  .object({
    /**
     * Optional, and deliberately not `idString()`: a prose bid document has
     * no reason to print Sift's own internal scope-item slugs, so this is
     * populated only on the rare document that happens to print something
     * id-shaped next to a line. Most model reads will omit it and rely on
     * `label` alone, exactly as `extractBidDocument`'s own CSV path already
     * tolerates a line item with no `scopeItemId` column.
     */
    scopeItemId: safeString(200).optional(),
    label: safeString(500),
    amount: ModelReadMoneyAmountSchema,
  })
  .strict();

const ModelReadWarrantySchema = z
  .object({
    termMonths: z.number().finite().min(0).max(MAX_MODEL_READ_WARRANTY_TERM_MONTHS).optional(),
    /** Whether the document states the term IN WRITING, vs. merely mentioning a warranty exists -- the same distinction `readJsonWarrantyMonths`'s `QUALIFIED_FIELD_CONFIDENCE` branch draws, carried one layer earlier. */
    statedInWriting: z.boolean().optional(),
  })
  .strict();

export const ModelReadBidDocumentSchema = z
  .object({
    contractorName: safeString(200).optional(),
    licenseNumber: safeString(100).optional(),
    total: ModelReadMoneyAmountSchema.optional(),
    depositPercent: z.number().finite().min(0).max(100).optional(),
    startInWeeks: z.number().finite().min(0).max(MAX_MODEL_READ_START_IN_WEEKS).optional(),
    durationWorkingDays: z
      .number()
      .finite()
      .min(0)
      .max(MAX_MODEL_READ_DURATION_WORKING_DAYS)
      .optional(),
    warranty: ModelReadWarrantySchema.optional(),
    lineItems: z.array(ModelReadLineItemSchema).max(MAX_MODEL_READ_LINE_ITEMS).optional(),
  })
  .strict();
export type ModelReadBidDocument = z.infer<typeof ModelReadBidDocumentSchema>;

// --- ReadBidDocumentInput (apps/agent's async route, NOT a `SiftCommands`
// input) ---
//
// `POST /api/cases/:caseId/bid-documents/read` (`routes/bid-documents.ts`)
// validates its body with this schema BEFORE ever calling a model: a PDF's
// browser-extracted prose text layer, plus the same `expectedSequence`/
// `optionId` `SubmitBidDocumentInputSchema` already carries, since this
// route hands both straight through, unchanged, once a reading succeeds.
//
// Deliberately its own shape, not `SubmitBidDocumentInputSchema` reused:
// that schema's `document.format` is one of `BID_DOCUMENT_FORMATS`, and a
// raw PDF text layer is neither -- it becomes `application/json` only AFTER
// a model has read it into a `ModelReadBidDocument` above. `text` reuses
// the identical `MAX_BID_DOCUMENT_BYTES` cap `SubmittedBidDocumentSchema
// .text` enforces (restated, not re-derived, exactly like
// `bid-document-reader.ts`'s own identical restatement -- see that
// constant's own comment, "Enforced twice on purpose") so an oversized
// paste is refused at this earlier HTTP boundary, before a byte of it ever
// reaches a model.
export const ReadBidDocumentInputSchema = z
  .object({
    caseId: idString(),
    expectedSequence,
    /** Re-reading a corrected document onto the option it already produced. Same field, same meaning, as `SubmitBidDocumentInputSchema.optionId`. */
    optionId: idString().optional(),
    /** The document's own file name (e.g. `"northgate-bid.pdf"`) -- never invented, and carried through unchanged into `SubmittedBidDocumentSchema.filename`/`readBy.originalFilename` once a reading succeeds. */
    filename: safeString(200),
    /**
     * The PDF's extracted text layer, as plain text -- untrusted content a
     * browser handed this route (`bid-document-reader.ts`'s own
     * `READ_BID_DOCUMENT_PROMPT` instructs the model to treat it as data,
     * never instructions). Read but never rendered until a successful
     * reading re-enters these contracts through
     * `ModelReadBidDocumentSchema`'s own `safeString`-guarded fields.
     */
    text: z
      .string()
      .min(1)
      .max(MAX_BID_DOCUMENT_BYTES)
      .refine((text) => utf8ByteLength(text) <= MAX_BID_DOCUMENT_BYTES, {
        message: `document must not exceed ${MAX_BID_DOCUMENT_BYTES} bytes encoded as UTF-8`,
      }),
  })
  .strict();
export type ReadBidDocumentInput = z.infer<typeof ReadBidDocumentInputSchema>;

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
