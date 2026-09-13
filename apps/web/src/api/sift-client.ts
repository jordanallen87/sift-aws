/**
 * Same-origin typed HTTP client implementing `SiftCommands`
 * (docs/specs/architecture.md "Shared command client"; the locked file map
 * names this file directly:
 * `apps/web/src/api/sift-client.ts   Same-origin typed HTTP client`).
 *
 * docs/engineering-principles.md's "Non-negotiable product truths" requires that "Visible UI
 * controls and WebMCP callbacks use the same command implementation." This
 * module is that one implementation: every method validates its input
 * against the real `@sift/contracts` Zod schema *before* sending anything
 * (so a malformed call never reaches the network), POSTs to the real HTTP
 * route, and validates the response against the real `CommandReceipt`/
 * `RunReceipt` schema before returning it. A later task's WebMCP tool
 * callbacks and this task's React components both call through the exact
 * same `SiftCommands` instance obtained from `AppProviders`
 * (`apps/web/src/app/AppProviders.tsx`) -- there is no separate WebMCP-only
 * mutation path.
 *
 * Route mapping (architecture.md "HTTP service"):
 * - `startDemo` -> `POST /api/cases/demo` (no case exists yet).
 * - `requestInvestigation` -> `POST /api/cases/:caseId/run` (architecture.md
 *   names this as its own route, distinct from the generic per-command
 *   route, and its result always carries a `runId` -- `RunReceipt`, not the
 *   more general `CommandReceipt`).
 * - every other method -> `POST /api/cases/:caseId/commands/:commandName`,
 *   where `:commandName` is the `SiftCommands` method name itself. This is
 *   an inferred mapping: `commands.ts`'s own module comment notes that
 *   `setEvidenceDisposition` and `requestRevision` have "no corresponding
 *   `SiftCommands` method name ... in architecture.md" and that resolving
 *   their real route is "an implementation decision for `apps/agent`/
 *   `apps/web`, not a contracts concern." Routing them through the same
 *   generic `/commands/:commandName` shape as the other nine keeps one
 *   uniform, honest rule instead of a special case; the sibling HTTP-route
 *   task is free to name its Express routes differently, since this client
 *   only needs to be structurally correct and independently testable
 *   (via MSW) until that route wiring lands.
 *
 * Every command carries a client-generated `commandId`
 * (architecture.md "Command and event flow" step 1: "A UI action or WebMCP
 * callback sends a validated command with an idempotency key and
 * client-generated `commandId`"). Since no `commands.ts` input schema
 * carries a `commandId`/idempotency field in its JSON body (by design --
 * those schemas are pure business payloads), this client sends it as the
 * `X-Sift-Command-Id` request header and reuses the same value as the
 * `Idempotency-Key` header value, rather than inventing a body field the
 * real contracts schema would reject (every command input schema is
 * `.strict()`).
 */
import {
  AddNoteInputSchema,
  UpdateDiscoveryInputSchema,
  RequestInteractionInputSchema,
  SubmitInteractionResponseInputSchema,
  SetCandidateDispositionInputSchema,
  CompleteBlindSpotReviewInputSchema,
  CheckEnergyBillFeedInputSchema,
  CommandReceiptSchema,
  DefineCaseAttributeInputSchema,
  EnergyBillFeedCheckResultSchema,
  FocusEvidenceInputSchema,
  FocusOptionInputSchema,
  HttpConflictResponseSchema,
  HttpErrorBodySchema,
  ReadBidDocumentInputSchema,
  RequestInvestigationInputSchema,
  RequestRevisionInputSchema,
  ReviewCaseExtensionInputSchema,
  ReviewProposalInputSchema,
  RunReceiptSchema,
  SelectPackInputSchema,
  SetEvidenceDispositionInputSchema,
  SetOptionAttributeInputSchema,
  SetViewInputSchema,
  StartCaseInputSchema,
  StartDemoInputSchema,
  SubmitBidDocumentInputSchema,
  SubmitSourceInputSchema,
  UpdateCriteriaInputSchema,
  UpsertOptionInputSchema,
  type AddNoteInput,
  type UpdateDiscoveryInput,
  type RequestInteractionInput,
  type SubmitInteractionResponseInput,
  type SetCandidateDispositionInput,
  type CompleteBlindSpotReviewInput,
  type CaseState,
  type CheckEnergyBillFeedInput,
  type CommandOrigin,
  type CommandReceipt,
  type DefineCaseAttributeInput,
  type EnergyBillFeedCheckResult,
  type FocusEvidenceInput,
  type FocusOptionInput,
  type ReadBidDocumentInput,
  type RequestInvestigationInput,
  type RequestRevisionInput,
  type ReviewCaseExtensionInput,
  type ReviewProposalInput,
  type RunReceipt,
  type SelectPackInput,
  type SetEvidenceDispositionInput,
  type SetOptionAttributeInput,
  type SetViewInput,
  type StartCaseInput,
  type StartDemoInput,
  type SubmitBidDocumentInput,
  type SubmitSourceInput,
  type ToolErrorCode,
  type UpdateCriteriaInput,
  type UpsertOptionInput,
} from '@sift/contracts';
import { z } from 'zod';

/**
 * Per-call options every `SiftCommands` method accepts, added after the fact
 * (see `docs/build-log.md`'s dated integration entry) once the WebMCP tool
 * registration task found this client had no way to honor two behaviors
 * `webmcp.md`'s "Cancellation and concurrency" section requires: "Each
 * callback accepts the browser-provided abort signal and forwards it to
 * fetch" and "Retried mutations reuse an idempotency key derived from the
 * browser tool call ID." Both fields are optional and purely additive --
 * every existing call site that omits this parameter keeps working exactly
 * as before, with a freshly minted `commandId` and no abort wiring.
 */
export interface CommandCallOptions {
  /** Forwarded directly to `fetch`. An already-aborted signal fails fast with a `SiftClientError` carrying `code: 'UNAVAILABLE'`/`retryable: true`, matching webmcp.md's required abort envelope. */
  signal?: AbortSignal;
  /** Overrides the client-generated `commandId`/idempotency key (sent as both `X-Sift-Command-Id` and `Idempotency-Key`). A WebMCP tool callback should derive this from the browser's own tool-call id so a retried call is recognized as the same command rather than double-applied. */
  commandId?: string;
  /**
   * Self-reported provenance, sent as `X-Sift-Command-Origin` and recorded
   * onto the activity trail's `safeDetails.origin` (plan task I1, change-set
   * §34: WebMCP tool calls must be visible in the developer view). A WebMCP
   * tool callback passes `'webmcp'`; a visible page control omits this
   * entirely, and omitting it is byte-identical to the prior behavior.
   *
   * This is observability, never authorization. Nothing downstream reads it
   * for a policy decision — human-only verbs are unreachable from WebMCP
   * because the tool catalog never exposes them, not because this field says
   * so. A client could set it to anything; that would falsify a log line and
   * nothing more.
   */
  origin?: CommandOrigin;
}

/**
 * The `SiftCommands` interface (docs/specs/architecture.md "Shared command
 * client", copied verbatim by method name, parameter, and return type).
 * `@sift/contracts` deliberately exports only the per-method Zod input/output
 * schemas, not this TypeScript interface itself -- it is owned here, the one
 * place that both implements and (later) consumes it.
 *
 * Written as function-typed properties (`startDemo: (input) => Promise<...>`)
 * rather than architecture.md's literal method-shorthand syntax
 * (`startDemo(input): Promise<...>`): the two are behaviorally identical --
 * same name, same parameter, same return type -- but method-shorthand marks
 * a member as implicitly `this`-sensitive at the type level, which trips
 * `@typescript-eslint/unbound-method` the moment a caller (or a test
 * asserting `expect(commands.startDemo).toHaveBeenCalledWith(...)`)
 * references a member without immediately invoking it. Every implementation
 * of this interface (`createSiftClient` below, and
 * `../test/fake-sift-commands.ts`) is a plain object of closures with no
 * `this` dependency, so the property-arrow form is both accurate and avoids
 * that footgun.
 */
export interface SiftCommands {
  startDemo: (input: StartDemoInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  /** Docs/decisions/0003: a normal, non-demo case-creation entry point pinned to any registered pack id -- see `POST /api/cases`. */
  startCase: (input: StartCaseInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  /**
   * The deterministic Home Energy Guardian case-creation gate
   * (`packages/scenarios/src/tools/bill-feed-gate.ts`,
   * `CommandService.checkEnergyBillFeed`): evaluates a real bill feed and
   * only opens a case when it is materially abnormal. Returns
   * `EnergyBillFeedCheckResult`, not `CommandReceipt` -- unlike every other
   * method here, a call can genuinely succeed with no case created at all
   * (`caseOpened: false`, no `receipt`), which `CommandReceipt`'s required
   * `caseId` cannot represent.
   */
  checkEnergyBillFeed: (
    input: CheckEnergyBillFeedInput,
    options?: CommandCallOptions,
  ) => Promise<EnergyBillFeedCheckResult>;
  selectPack: (input: SelectPackInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  upsertOption: (input: UpsertOptionInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  focusOption: (input: FocusOptionInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  defineCaseAttribute: (
    input: DefineCaseAttributeInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  reviewCaseExtension: (
    input: ReviewCaseExtensionInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  focusEvidence: (
    input: FocusEvidenceInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  updateCriteria: (
    input: UpdateCriteriaInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  submitSource: (input: SubmitSourceInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  requestInvestigation: (
    input: RequestInvestigationInput,
    options?: CommandCallOptions,
  ) => Promise<RunReceipt>;
  reviewProposal: (
    input: ReviewProposalInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  setEvidenceDisposition: (
    input: SetEvidenceDispositionInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  requestRevision: (
    input: RequestRevisionInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  /**
   * Presentation state, not decision mutation (change-set §54). The backend
   * `setView` handler routes through `CaseStore.updateSelection()`, which
   * appends no `case_events` row, never advances `eventSequence`, and
   * therefore structurally cannot invalidate a recommendation -- see
   * `apps/agent/src/store/case-store.ts`'s `SelectionPatch` module comment.
   * It is listed here beside the decision commands because it is a real
   * durable write over the same transport, not because it carries the same
   * authority.
   */
  setView: (input: SetViewInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  /**
   * A scoped single-attribute write that MERGES into an option's existing
   * attribute map. Distinct from `upsertOption`, which replaces the map
   * wholesale -- a caller using `upsertOption` to change one attribute must
   * resend every other one, and destroys any it omits.
   */
  setOptionAttribute: (
    input: SetOptionAttributeInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  /**
   * A person's own bid document, brought into the case so a deterministic
   * extractor can read it (`CommandService.submitBidDocument`).
   *
   * A sibling of `upsertOption`, never an overload of it, for the reason
   * `SubmitBidDocumentInputSchema` states at length: the two differ in WHO
   * is asserting. `upsertOption` writes what a person typed (`origin:
   * 'user'`); this writes what an extractor READ off a document, which the
   * handler records as `origin: 'agent_proposed'` with the extractor's own
   * confidence, and a field the document did not state as `status:
   * 'unknown'` with no value at all. No caller can reach `origin: 'user'`
   * through this command, because its input carries no origin field.
   *
   * The document travels as `document.text`, not as a multipart upload:
   * both accepted formats are text, so the browser reads the file with
   * `FileReader` and this stays one ordinary JSON command over the same
   * transport, with the same idempotency key, as every other method here.
   */
  submitBidDocument: (
    input: SubmitBidDocumentInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  /**
   * A person's own bid PDF, read by a MODEL rather than the deterministic
   * extractor `submitBidDocument` uses -- `POST /api/cases/:caseId/
   * bid-documents/read` (`ReadBidDocumentInputSchema`, `routes/
   * bid-documents.ts`), not the generic `/commands/:commandName` shape
   * every `genericCommand` method below goes through.
   *
   * A PDF has no labelled fields the way a JSON/CSV bid does -- only prose
   * a browser's own PDF text layer extraction can hand over
   * (`../components/pdf-bid-document.ts`), and reading prose honestly needs
   * a model. `CommandService` is synchronous end to end by design (see
   * `submitBidDocument`'s own doc comment for why), so that model call
   * cannot live inside a command handler -- it has to happen in a route
   * that runs BEFORE the command, which is exactly what this method calls.
   * A successful reading still ends up going through the identical,
   * synchronous, deterministic `submitBidDocument` command server-side
   * (`routes/bid-documents.ts`'s own header) and returns the same
   * `CommandReceipt` shape, so this client's caller never needs to treat
   * the outcome differently -- only the request differs, never the
   * response contract.
   *
   * Two failure modes a caller should expect and surface verbatim, never
   * reword: `503 UNAVAILABLE` when this deployment has no model configured
   * for it (`SIFT_BID_DOCUMENT_READER_ENABLED` is off, the default), and
   * `400 VALIDATION` when a reading produced nothing usable. Both carry a
   * human-readable `message` on the thrown `SiftClientError`.
   */
  readBidDocument: (
    input: ReadBidDocumentInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  /**
   * Notes never auto-promote to evidence (change-set §28): adding one cannot
   * satisfy an obligation, move readiness, or invalidate a recommendation.
   * Enforced by the command handler, not by this client.
   */
  addNote: (input: AddNoteInput, options?: CommandCallOptions) => Promise<CommandReceipt>;
  /**
   * Adaptive discovery. `updateDiscovery` carries an explicit `actor`, and
   * the schema refuses everything but `propose` when that actor is an agent
   * -- a model offers a reading of what was said; a person decides.
   */
  updateDiscovery: (
    input: UpdateDiscoveryInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  requestInteraction: (
    input: RequestInteractionInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  submitInteractionResponse: (
    input: SubmitInteractionResponseInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  /** Quick Pick triage. Human-only: the schema refuses any other actor. */
  setCandidateDisposition: (
    input: SetCandidateDispositionInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
  /** Human-only, for the same reason: nobody else can say what a person did not think of. */
  completeBlindSpotReview: (
    input: CompleteBlindSpotReviewInput,
    options?: CommandCallOptions,
  ) => Promise<CommandReceipt>;
}

export interface SiftClientErrorOptions {
  status: number;
  // `| undefined` is explicit, not redundant: with `exactOptionalPropertyTypes`
  // (tsconfig.base.json) an optional field's value type must include
  // `undefined` itself to be assignable *from* an already-optional source
  // (`HttpError['code']` below is itself optional) -- otherwise passing
  // `code: error.code` through to this options bag, and then through to the
  // class field of the same shape, is a type error even though the field is
  // marked `?`.
  code?: ToolErrorCode | undefined;
  retryable: boolean;
  details?: unknown;
}

/** Shape of `SiftClientError.details` specifically when `code === 'CONFLICT'` (a 409 response). */
export interface SiftClientConflictDetails {
  expectedSequence: number;
  actualSequence: number;
  snapshot: CaseState;
}

/** Thrown by every `SiftCommands` method on local-validation failure, a non-OK HTTP response, or a response that fails to validate against its expected receipt schema. */
export class SiftClientError extends Error {
  readonly status: number;
  readonly code?: ToolErrorCode | undefined;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(message: string, options: SiftClientErrorOptions) {
    super(message);
    this.name = 'SiftClientError';
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.details = options.details;
  }

  static fromErrorResponse(status: number, payload: unknown): SiftClientError {
    // Try the more specific 409 conflict shape first: `HttpConflictResponseSchema`
    // is `.strict()` with an extra top-level `snapshot` field `HttpErrorBodySchema`
    // does not declare, so a conflict body fails `HttpErrorBodySchema.safeParse`
    // outright (an unknown key under `.strict()`) and previously fell straight
    // through to the generic fallback below, silently discarding `actualSequence`
    // and -- critically -- the latest `snapshot` webmcp.md requires ("Conflicts
    // return the latest sequence so ChatGPT can call `sift_get_case_context`
    // before retrying").
    const parsedConflict = HttpConflictResponseSchema.safeParse(payload);
    if (parsedConflict.success) {
      const { error, snapshot } = parsedConflict.data;
      return new SiftClientError(error.message, {
        status,
        code: error.code,
        retryable: error.retryable,
        details: {
          expectedSequence: error.expectedSequence,
          actualSequence: error.actualSequence,
          snapshot,
        },
      });
    }

    const parsedBody = HttpErrorBodySchema.safeParse(payload);
    if (parsedBody.success) {
      const { error } = parsedBody.data;
      return new SiftClientError(error.message, {
        status,
        code: error.code,
        retryable: error.retryable,
        details: error.details,
      });
    }
    return new SiftClientError(`Sift service request failed with status ${status}.`, {
      status,
      retryable: status >= 500,
    });
  }
}

export interface CreateSiftClientOptions {
  /** Same-origin by default (an empty string, so requests resolve against the page's own origin per architecture.md "Deployed browser requests remain same-origin"). Overridable for tests. */
  baseUrl?: string;
  /** Injectable fetch implementation for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Deliberately typed with a plain, non-generic `z.ZodTypeAny` parameter and
 * an `unknown` return, rather than a generic `<T>`/`<Schema extends
 * z.ZodTypeAny>` signature whose return type tracks the specific schema
 * passed in. Two problems ruled that out, both confirmed empirically against
 * this exact codebase, not assumed:
 *
 * 1. A first version used `z.ZodType<T>` directly, generic over each
 *    command's own inferred type (some, like `UpsertOptionInput`, nesting
 *    the ten-branch discriminated `AttributeValue` union). `tsc --noEmit`
 *    on that version reliably ran the compiler out of memory (confirmed
 *    still failing at an 8 GB `--max-old-space-size` ceiling) typechecking
 *    this file's nine per-command call sites, each forcing bidirectional
 *    inference against zod v4's own multi-parameter `ZodType` generic.
 * 2. A second version switched to `<Schema extends z.ZodTypeAny>` +
 *    `z.infer<Schema>` (avoiding the OOM), but every call site passing a
 *    concrete compiled schema (e.g. `CommandReceiptSchema`) then failed
 *    with "Argument ... is not assignable to parameter of type
 *    `ZodType<unknown, unknown, ...>` with `exactOptionalPropertyTypes:
 *    true`" -- an assignability friction between a concrete `ZodObject` and
 *    the abstract `ZodTypeAny` constraint under this repo's
 *    `exactOptionalPropertyTypes: true` (tsconfig.base.json), which then
 *    made every dependent inference collapse to `unknown`.
 *
 * Keeping the schema parameter's own type out of the generic signature
 * altogether avoids both failure modes. Callers below regain the concrete
 * type via a narrow, explicitly-commented `as` cast immediately after the
 * adjacent `safeParse` call that actually enforces it at runtime -- the
 * cast asserts a fact `safeParse` already checked, it does not bypass
 * validation.
 */
function validate(schema: z.ZodTypeAny, value: unknown): unknown {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SiftClientError('Command input failed local validation.', {
      status: 0,
      code: 'VALIDATION',
      retryable: false,
      details: z.treeifyError(result.error),
    });
  }
  return result.data;
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  outputSchema: z.ZodTypeAny,
  options: CommandCallOptions = {},
): Promise<unknown> {
  const commandId = options.commandId ?? crypto.randomUUID();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sift-Command-Id': commandId,
        'Idempotency-Key': commandId,
        ...(options.origin !== undefined ? { 'X-Sift-Command-Origin': options.origin } : {}),
      },
      body: JSON.stringify(body),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // `fetch` rejects with a `DOMException` named `AbortError` when its
    // `signal` fires (before or during the request) -- webmcp.md requires
    // "Cancellation produces `UNAVAILABLE` with `retryable: true`", not a
    // raw, differently-shaped `DOMException` leaking out of this client.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SiftClientError('Sift command request was aborted.', {
        status: 0,
        code: 'UNAVAILABLE',
        retryable: true,
      });
    }
    throw error;
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw SiftClientError.fromErrorResponse(response.status, payload);
  }

  const parsed = outputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SiftClientError('Sift service returned a response that did not match its contract.', {
      status: response.status,
      code: 'INTERNAL',
      retryable: false,
      details: z.treeifyError(parsed.error),
    });
  }
  return parsed.data;
}

/** Creates a `SiftCommands` client that sends every command to the real HTTP routes. Structurally complete and independently testable via a mocked `fetch`/MSW ahead of the real server routes landing. */
export function createSiftClient(options: CreateSiftClientOptions = {}): SiftCommands {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;

  // `TInput`/`TOutput` are supplied explicitly by each call site below
  // (`genericCommand<SelectPackInput, CommandReceipt>(...)`), not inferred
  // from the schema arguments -- see the comment above `validate` for why
  // schema-driven inference is avoided here. `TInput extends { caseId:
  // string }` is safe to state as a real generic bound in *this* position
  // (a type parameter's own constraint, not a schema argument's type) since
  // it does not touch zod's generic types at all; every real `SiftCommands`
  // input is `.strict()`-shaped with a required `caseId: idString()` field
  // (checked directly against commands.ts).
  function genericCommand<TInput extends { caseId: string }, TOutput>(
    commandName: string,
    inputSchema: z.ZodTypeAny,
    outputSchema: z.ZodTypeAny,
  ): (input: TInput, options?: CommandCallOptions) => Promise<TOutput> {
    return async (input: TInput, options?: CommandCallOptions): Promise<TOutput> => {
      // `safeParse` (inside `validate`) already checked `input` against
      // `inputSchema` at runtime; this cast reasserts that same fact to the
      // type checker rather than bypassing it.
      const validated = validate(inputSchema, input) as TInput;
      const url = `${baseUrl}/api/cases/${encodeURIComponent(validated.caseId)}/commands/${commandName}`;
      // Same justification as above: `outputSchema.safeParse` inside
      // `postJson` already enforced this shape at runtime.
      return postJson(fetchImpl, url, validated, outputSchema, options) as Promise<TOutput>;
    };
  }

  return {
    startDemo: async (input, options) => {
      const validated = validate(StartDemoInputSchema, input) as StartDemoInput;
      return postJson(
        fetchImpl,
        `${baseUrl}/api/cases/demo`,
        validated,
        CommandReceiptSchema,
        options,
      ) as Promise<CommandReceipt>;
    },
    startCase: async (input, options) => {
      const validated = validate(StartCaseInputSchema, input) as StartCaseInput;
      return postJson(
        fetchImpl,
        `${baseUrl}/api/cases`,
        validated,
        CommandReceiptSchema,
        options,
      ) as Promise<CommandReceipt>;
    },
    checkEnergyBillFeed: async (input, options) => {
      const validated = validate(CheckEnergyBillFeedInputSchema, input) as CheckEnergyBillFeedInput;
      return postJson(
        fetchImpl,
        `${baseUrl}/api/cases/energy-bill-feed-check`,
        validated,
        EnergyBillFeedCheckResultSchema,
        options,
      ) as Promise<EnergyBillFeedCheckResult>;
    },
    requestInvestigation: async (input, options) => {
      const validated = validate(
        RequestInvestigationInputSchema,
        input,
      ) as RequestInvestigationInput;
      const url = `${baseUrl}/api/cases/${encodeURIComponent(validated.caseId)}/run`;
      return postJson(fetchImpl, url, validated, RunReceiptSchema, options) as Promise<RunReceipt>;
    },
    selectPack: genericCommand<SelectPackInput, CommandReceipt>(
      'selectPack',
      SelectPackInputSchema,
      CommandReceiptSchema,
    ),
    upsertOption: genericCommand<UpsertOptionInput, CommandReceipt>(
      'upsertOption',
      UpsertOptionInputSchema,
      CommandReceiptSchema,
    ),
    focusOption: genericCommand<FocusOptionInput, CommandReceipt>(
      'focusOption',
      FocusOptionInputSchema,
      CommandReceiptSchema,
    ),
    defineCaseAttribute: genericCommand<DefineCaseAttributeInput, CommandReceipt>(
      'defineCaseAttribute',
      DefineCaseAttributeInputSchema,
      CommandReceiptSchema,
    ),
    reviewCaseExtension: genericCommand<ReviewCaseExtensionInput, CommandReceipt>(
      'reviewCaseExtension',
      ReviewCaseExtensionInputSchema,
      CommandReceiptSchema,
    ),
    focusEvidence: genericCommand<FocusEvidenceInput, CommandReceipt>(
      'focusEvidence',
      FocusEvidenceInputSchema,
      CommandReceiptSchema,
    ),
    updateCriteria: genericCommand<UpdateCriteriaInput, CommandReceipt>(
      'updateCriteria',
      UpdateCriteriaInputSchema,
      CommandReceiptSchema,
    ),
    submitSource: genericCommand<SubmitSourceInput, CommandReceipt>(
      'submitSource',
      SubmitSourceInputSchema,
      CommandReceiptSchema,
    ),
    reviewProposal: genericCommand<ReviewProposalInput, CommandReceipt>(
      'reviewProposal',
      ReviewProposalInputSchema,
      CommandReceiptSchema,
    ),
    setEvidenceDisposition: genericCommand<SetEvidenceDispositionInput, CommandReceipt>(
      'setEvidenceDisposition',
      SetEvidenceDispositionInputSchema,
      CommandReceiptSchema,
    ),
    setView: genericCommand<SetViewInput, CommandReceipt>(
      'setView',
      SetViewInputSchema,
      CommandReceiptSchema,
    ),
    setOptionAttribute: genericCommand<SetOptionAttributeInput, CommandReceipt>(
      'setOptionAttribute',
      SetOptionAttributeInputSchema,
      CommandReceiptSchema,
    ),
    submitBidDocument: genericCommand<SubmitBidDocumentInput, CommandReceipt>(
      'submitBidDocument',
      SubmitBidDocumentInputSchema,
      CommandReceiptSchema,
    ),
    // Not `genericCommand`: that helper always posts to `/api/cases/:caseId/
    // commands/:commandName`, and this route is deliberately its own thing
    // (`/api/cases/:caseId/bid-documents/read`) -- see `readBidDocument`'s
    // own doc comment above for why a PDF reading cannot be just another
    // command.
    readBidDocument: async (input, options) => {
      const validated = validate(ReadBidDocumentInputSchema, input) as ReadBidDocumentInput;
      const url = `${baseUrl}/api/cases/${encodeURIComponent(validated.caseId)}/bid-documents/read`;
      return postJson(
        fetchImpl,
        url,
        validated,
        CommandReceiptSchema,
        options,
      ) as Promise<CommandReceipt>;
    },
    addNote: genericCommand<AddNoteInput, CommandReceipt>(
      'addNote',
      AddNoteInputSchema,
      CommandReceiptSchema,
    ),
    requestRevision: genericCommand<RequestRevisionInput, CommandReceipt>(
      'requestRevision',
      RequestRevisionInputSchema,
      CommandReceiptSchema,
    ),
    updateDiscovery: genericCommand<UpdateDiscoveryInput, CommandReceipt>(
      'updateDiscovery',
      UpdateDiscoveryInputSchema,
      CommandReceiptSchema,
    ),
    requestInteraction: genericCommand<RequestInteractionInput, CommandReceipt>(
      'requestInteraction',
      RequestInteractionInputSchema,
      CommandReceiptSchema,
    ),
    submitInteractionResponse: genericCommand<SubmitInteractionResponseInput, CommandReceipt>(
      'submitInteractionResponse',
      SubmitInteractionResponseInputSchema,
      CommandReceiptSchema,
    ),
    setCandidateDisposition: genericCommand<SetCandidateDispositionInput, CommandReceipt>(
      'setCandidateDisposition',
      SetCandidateDispositionInputSchema,
      CommandReceiptSchema,
    ),
    completeBlindSpotReview: genericCommand<CompleteBlindSpotReviewInput, CommandReceipt>(
      'completeBlindSpotReview',
      CompleteBlindSpotReviewInputSchema,
      CommandReceiptSchema,
    ),
  };
}
