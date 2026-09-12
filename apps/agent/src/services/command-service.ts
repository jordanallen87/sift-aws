/**
 * `CommandService`: one method per `SiftCommands` verb except
 * `requestInvestigation` (docs/specs/architecture.md "Shared command
 * client"; `run-service.ts` owns `requestInvestigation` -- see that file's
 * header comment for why it is a genuinely separate concern, not merely a
 * split for convenience).
 *
 * Every method follows the same shape (docs/specs/architecture.md "Command
 * and event flow"):
 *  1. validate the raw input against its real `@sift/contracts` Zod schema;
 *  2. load the case and check `expectedSequence` (optimistic concurrency);
 *  3. derive the resulting `CaseEvent`(s) using the appropriate `@sift/core`
 *     pure function;
 *  4. call `CaseStore.append()` with idempotency-key deduplication;
 *  5. derive and append the matching `PublicActivityEvent`(s);
 *  6. return a `CommandReceipt`-shaped `ServiceResult`.
 *
 * `commandId` (the idempotency key) is a caller-supplied parameter, not a
 * field on any `@sift/contracts` `*Input` schema -- none of them carry one
 * (confirmed: `apps/agent/src/db/schema.ts`'s own header comment reaches the
 * same conclusion for the DB layer: "the client-generated `commandId` *is*
 * the idempotency key ... that is the only identifier the contracts
 * actually carry"). `routes/commands.ts` reads it from the request's
 * `Idempotency-Key` header, a well-established REST convention, rather than
 * this module inventing an ad hoc envelope schema.
 *
 * --- Real, confirmed gaps in the current `@sift/contracts` `CaseEvent`
 * taxonomy this module works around, all documented in depth in
 * `store/case-store.ts` (`AppendOptions.seedSnapshot`, `SelectionPatch`) ---
 *
 *  - `attributeDefinitions` (creation only: `startDemo`'s `seedSnapshot`);
 *  - `selectedOptionId`/`selectedEvidenceId`/`activeFocus` (`focusOption`/
 *    `focusEvidence`'s `updateSelection`);
 *  - `sources` (`submitSource`'s `updateSelection`).
 *
 * --- Closed by the 2026-08-30 custom-field/research pipeline task (was:
 * "Deliberately deferred to a later task") ---
 *
 *  - `updateCriteria`'s `add` operation now derives a real case obligation
 *    for a newly-added criterion that needs evidence
 *    (`criterionNeedsEvidenceQuestion`, `deriveObligations` -- both real
 *    `@sift/core` functions, used as-is, not reimplemented), gated on the
 *    pinned pack's `extensionPolicy.allowCaseObligations`. See
 *    `synthesizeUserConcernObligationTemplate`'s own doc comment for why
 *    the template content is synthesized generically rather than looked up
 *    from pack data (no pack manifest in this codebase carries real
 *    `userConcern` template content anywhere -- `extensionPolicy.
 *    userConcernTemplateId` is only a reserved id namespace). This is
 *    scoped to `updateCriteria` specifically (not `defineCaseAttribute`):
 *    `criterionNeedsEvidenceQuestion` requires a `Criterion`, which does
 *    not exist until one is added, matching packs-and-routing.md's own
 *    "Users may add ... criteria. When a custom criterion needs evidence,
 *    the core derives a case obligation" ordering.
 *  - `defineCaseAttribute`'s `origin` (`'user'` vs `'agent_proposed'`) is
 *    now also reachable directly on the wire, via
 *    `DefineCaseAttributeInputSchema.origin` (optional, defaulting to
 *    `'user'`) -- see that schema's own doc comment. The pre-existing
 *    method-parameter channel (`originParam`) is preserved unchanged for
 *    backward compatibility with callers that predate this field; the wire
 *    field wins when both are supplied.
 *  - `upsertOption`'s `OptionAttributeInputSchema` now accepts optional
 *    `status`/`confidence`/`origin` alongside an optional (was required)
 *    `value`, so a caller can express a verified value with sources, a
 *    low-confidence agent inference, or an explicit "unknown" -- see that
 *    schema's own doc comment in `packages/contracts/src/commands.ts`.
 *    `AttributeRecordSchema`'s existing cross-field invariant (value
 *    required unless `status: 'unknown'`) is enforced once, by the same
 *    `createAttributeRecord` call this method already made; this task adds
 *    no new invariant logic here.
 *  - `upsertOption`/`reviewCaseExtension` now invalidate a `ready`
 *    recommendation precisely when the write touches a definitionId (or
 *    confirms an extension) an *active* criterion's `appliesToAttribute`
 *    depends on (`criteriaDependOnAttributes`, shared by both) --
 *    narrower, on purpose, than `updateCriteria`/`setEvidenceDisposition`'s
 *    coarser "any change at all" rule, since attribute/extension writes are
 *    far more frequent and often touch fields no criterion currently cares
 *    about.
 *  - `submitSource` now turns `input.source.claims[]` into durable,
 *    option-linked `Claim` records (each paired with an `EvidenceLink`,
 *    the one `CaseEvent` variant that can carry a `Claim`) whenever the
 *    caller supplies the new optional `input.obligationId` --
 *    `SubmitSourceInputSchema`'s own doc comment explains why that field
 *    is genuinely required for linkage and cannot be inferred. When
 *    absent, the `Source` itself still persists (unchanged, pre-existing
 *    behavior) and the activity summary says explicitly how many claims
 *    went unlinked and why -- an honest degradation, not a silent drop.
 */
import {
  AddNoteInputSchema,
  DefineCaseAttributeInputSchema,
  FocusEvidenceInputSchema,
  FocusOptionInputSchema,
  ReviewCaseExtensionInputSchema,
  ReviewProposalInputSchema,
  RequestRevisionInputSchema,
  SelectPackInputSchema,
  SetEvidenceDispositionInputSchema,
  SetOptionAttributeInputSchema,
  SetViewInputSchema,
  CheckEnergyBillFeedInputSchema,
  StartCaseInputSchema,
  StartDemoInputSchema,
  SubmitBidDocumentInputSchema,
  SubmitSourceInputSchema,
  UpdateCriteriaInputSchema,
  UpsertOptionInputSchema,
  EntityRecordSchema,
  MAX_CASE_ENTITIES,
  SourceSchema,
  type AttributeRecord,
  type AttributeValue,
  type CaseEvent,
  type CaseAttributeDefinition,
  type CaseAttributeOrigin,
  type CaseNote,
  type DefineCaseAttributeInput,
  type CaseState,
  type Claim,
  type CommandOrigin,
  PRESENTATION_ONLY_ACTIVITY_DETAIL,
  type CommandReceipt,
  type EnergyBillFeedCheckResult,
  type CompiledDecisionPack,
  type Criterion,
  type EntityRecord,
  type EvidenceLink,
  type ObligationTemplate,
  type PublicActivityEvent,
  type ReviewProposalInput,
  type Source,
  UpdateDiscoveryInputSchema,
  RequestInteractionInputSchema,
  SubmitInteractionResponseInputSchema,
  SetCandidateDispositionInputSchema,
  CompleteBlindSpotReviewInputSchema,
  type CandidateDispositionRecord,
  type DiscoveryTopicState,
  type BlindSpotReviewState,
} from '@sift/contracts';
import {
  addCriterion,
  createAttributeRecord,
  criterionNeedsEvidenceQuestion,
  defineCaseExtension,
  deriveObligations,
  instantiateCase,
  isSiftDomainError,
  normalizeAttributeValue,
  PolicyViolationError,
  removeCriterion,
  renameCriterion,
  reviewCaseExtension as reviewCaseExtensionDomain,
  reviewProposal as reviewProposalDomain,
  reweightCriterion,
  type Clock,
  type ExistingEvidenceSignal,
  type IdGenerator,
  type PackSelection,
  compileDiscoveryTopics,
  planDiscoveryResponse,
} from '@sift/core';
import type { PackRegistry } from '@sift/packs';
import {
  extractBidDocument,
  loadAndEvaluateBillFeed,
  type BidDocumentExtractionResult,
  type ExtractedBidFields,
  type ExtractedValue,
} from '@sift/scenarios';
import type { RunPlanRevisionCause } from '../runtime/run-plan.js';
import type { ActivityStore } from '../store/activity-store.js';
import type { AppendResult, CaseStore } from '../store/case-store.js';
import {
  conflict,
  formatZodIssues,
  notFound,
  ok,
  policyFailure,
  validationFailure,
  type ServiceResult,
} from './service-result.js';

export interface CommandServiceDeps {
  readonly caseStore: CaseStore;
  readonly activityStore: ActivityStore;
  readonly registry: PackRegistry;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  /**
   * Demo id -> starting `EntityRecord`s for `startDemo` to seed onto the
   * freshly created case, alongside its `pack`/`criteria`/`obligations`
   * (`instantiateCase` always seeds `entities: []` -- packs-and-routing.md
   * says nothing about starting candidates because that is demo-launcher
   * behavior, not pack data). Optional so every pack/demo without an entry
   * (and every existing test) keeps starting with zero entities unchanged.
   *
   * `upsertOption` cannot be reused to seed these instead:
   * `OptionAttributeInputSchema.value` is required and the handler
   * hardcodes `status: 'asserted'`, so an entity carrying a legitimately
   * `status: 'unknown'` attribute (no value -- docs/engineering-principles.md "never fabricate")
   * can only be expressed as a direct `option.upserted` event, which is
   * exactly what `startDemo` appends here.
   */
  readonly demoSeedEntities?: Readonly<Record<string, (clock: Clock) => readonly EntityRecord[]>>;
  /**
   * The continuous RunPlan's revision hook (`run-plan-service.ts`'s
   * `RunPlanService.revisePlan`). Optional so every existing test and any
   * deployment without a plan wired keeps working unchanged.
   *
   * Structurally typed rather than imported as `RunPlanService` for two
   * reasons: it keeps `CommandService` free of a dependency on the runtime
   * layer (the arrow only ever points the other way), and it makes the
   * *contract* explicit — a revisor may be told what changed, and may not
   * hand anything back that could influence the command's own outcome. A
   * plan revision is a consequence of a command, never a participant in it.
   */
  readonly runPlanRevisor?: {
    revisePlan(caseId: string, cause: RunPlanRevisionCause): unknown;
  };
}

/**
 * Tells the RunPlan what changed, if a plan revisor is wired.
 *
 * Called only on an `applied` result: a rejected or replayed command
 * changed nothing about the case, so nothing about the plan can have
 * changed either. Failures are swallowed deliberately — a plan is a
 * derived, always-recomputable projection, and losing one revision must
 * never turn an accepted, durably-appended command into an error the
 * person sees.
 */
function notifyRunPlan(
  deps: CommandServiceDeps,
  caseId: string,
  cause: RunPlanRevisionCause,
): void {
  const revisor = deps.runPlanRevisor;
  if (revisor === undefined) return;
  try {
    revisor.revisePlan(caseId, cause);
  } catch {
    // Intentionally ignored; see this function's doc comment.
  }
}

function compareSemver(a: string, b: string): number {
  const partsOf = (version: string): number[] => version.split('.').map(Number);
  const [aMajor = 0, aMinor = 0, aPatch = 0] = partsOf(a);
  const [bMajor = 0, bMinor = 0, bPatch = 0] = partsOf(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

/** The highest-`version` compiled pack registered under `packId`, or `undefined` when none is installed. */
function resolveLatestPack(
  registry: PackRegistry,
  packId: string,
): CompiledDecisionPack | undefined {
  const candidates = registry.list().filter((pack) => pack.identity.id === packId);
  return candidates.reduce<CompiledDecisionPack | undefined>((latest, candidate) => {
    if (latest === undefined) return candidate;
    return compareSemver(candidate.identity.version, latest.identity.version) > 0
      ? candidate
      : latest;
  }, undefined);
}

/**
 * Conservative normalisation for `Source.tags`, the free-form labels that
 * organise a case's reference library (`SourceSchema.tags`,
 * `packages/contracts/src/case.ts`).
 *
 * Deliberately does only what is unambiguously safe: trims surrounding
 * whitespace, drops entries that are empty once trimmed, and removes
 * case-insensitive duplicates -- keeping the FIRST occurrence with the
 * submitter's own casing intact, so "EV" stays "EV" and is never flattened
 * to "ev" for display.
 *
 * Deliberately does NOT do anything else. It does not lowercase the stored
 * value, does not map synonyms, does not split on separators, and does not
 * check the tag against any vocabulary: the whole reason a reference library
 * has tags rather than a pack-declared enum is that it collects material
 * nobody anticipated (the same reasoning `custom.*` attributes rest on).
 * Rewriting a submitter's label into a canonical form would quietly claim
 * they said something they did not.
 */
function normalizeSourceTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed === '') continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

// --- submitBidDocument support ---

/** The one entity kind `packages/packs/src/bid-comparison.ts` declares (`entities: [{ id: 'bid', ... }]`). */
const BID_ENTITY_KIND = 'bid';

/**
 * One bid-comparison attribute a bid DOCUMENT states, and how to read it off
 * an extraction.
 *
 * Deliberately exactly five. The pack declares ten attributes on its `bid`
 * entity; the other five (`bid.adjusted_total`, `bid.scope_completeness`,
 * `bid.license_status`, `bid.insurance_named_insured_match`,
 * `bid.credentials_valid`) are derivations and registry lookups that no bid
 * states about itself -- see `submitBidDocument`'s doc comment for why this
 * command leaves them entirely alone rather than writing them as unknowns.
 *
 * Each `label`/`unit` pair matches `packages/packs/src/bid-comparison.ts`'s
 * own declaration and `packages/scenarios/src/seeds.ts`'s existing records
 * for the same attribute, so a bid imported from a document and a bid seeded
 * from a fixture are described identically in the UI.
 */
interface BidDocumentAttributeMapping {
  readonly definitionId: string;
  readonly label: string;
  /** The extracted value as an `AttributeValue`, with the extractor's own confidence -- or `undefined` when the document did not state this field. */
  readonly read: (
    fields: ExtractedBidFields,
  ) => { value: AttributeValue; confidence: number } | undefined;
}

function numberAttributeMapping(
  definitionId: string,
  label: string,
  unit: string,
  select: (fields: ExtractedBidFields) => ExtractedValue<number> | undefined,
): BidDocumentAttributeMapping {
  return {
    definitionId,
    label,
    read: (fields) => {
      const extracted = select(fields);
      return extracted === undefined
        ? undefined
        : {
            value: { type: 'number', value: extracted.value, unit },
            confidence: extracted.confidence,
          };
    },
  };
}

const BID_DOCUMENT_ATTRIBUTE_MAP: readonly BidDocumentAttributeMapping[] = [
  {
    definitionId: 'bid.quoted_total',
    label: 'Quoted total',
    read: (fields) =>
      fields.total === undefined
        ? undefined
        : {
            value: {
              type: 'money',
              amount: fields.total.value.amount,
              currency: fields.total.value.currency,
            },
            confidence: fields.total.confidence,
          },
  },
  numberAttributeMapping(
    'bid.deposit_percent',
    'Deposit requested',
    '%',
    (fields) => fields.depositPercent,
  ),
  numberAttributeMapping(
    'bid.start_weeks',
    'Weeks until work can start',
    'weeks',
    (fields) => fields.startInWeeks,
  ),
  numberAttributeMapping(
    'bid.duration_days',
    'Estimated project duration',
    'days',
    (fields) => fields.durationWorkingDays,
  ),
  numberAttributeMapping(
    'bid.warranty_months',
    'Warranty term',
    'months',
    (fields) => fields.warrantyMonths,
  ),
];

/** Line items rendered into `Source.excerpt` before the rest are summarised as a count. */
const MAX_EXCERPT_LINE_ITEMS = 25;

/** Kept under `SourceSchema.excerpt`'s own `safeString(5000)` bound with room for the truncation marker. */
const MAX_EXCERPT_CHARS = 4_800;

/**
 * A bounded rendering of what the document itself said, stored as
 * `Source.excerpt` -- which `SourceSchema` documents as "a quotation FROM
 * the source", exactly what this is, as distinct from `summary` ("the
 * submitter's OWN summary"), which this command has no right to write
 * because no submitter wrote one.
 *
 * Carries the licence number and the priced line items: both are read off
 * the document, neither has a pack attribute to live in yet, and losing
 * them would mean the case held an option whose supporting document could
 * no longer be inspected for the two things a credential check and a scope
 * comparison will need next. Returns `undefined` when there was nothing to
 * quote, so an empty `excerpt` key is never stored.
 */
function buildBidDocumentExcerpt(extracted: BidDocumentExtractionResult): string | undefined {
  const lines: string[] = [];
  if (extracted.fields.licenseNumber !== undefined) {
    lines.push(`License number stated: ${extracted.fields.licenseNumber.value}`);
  }
  if (extracted.lineItems.length > 0) {
    lines.push(`Line items (${extracted.lineItems.length}):`);
    for (const item of extracted.lineItems.slice(0, MAX_EXCERPT_LINE_ITEMS)) {
      const scope = item.scopeItemId !== undefined ? `${item.scopeItemId}: ` : '';
      lines.push(`- ${scope}${item.label} -- ${item.amount.amount} ${item.amount.currency}`);
    }
    const remaining = extracted.lineItems.length - MAX_EXCERPT_LINE_ITEMS;
    if (remaining > 0) {
      lines.push(`(${remaining} more line item${remaining === 1 ? '' : 's'} not shown)`);
    }
  }
  if (lines.length === 0) return undefined;
  const excerpt = lines.join('\n');
  return excerpt.length <= MAX_EXCERPT_CHARS
    ? excerpt
    : `${excerpt.slice(0, MAX_EXCERPT_CHARS)}...`;
}

/**
 * One option's answer for the attribute being defined
 * (`CaseAttributeValueDraftSchema`, `packages/contracts/src/commands.ts`).
 * Derived from `DefineCaseAttributeInput` rather than imported directly:
 * `@sift/contracts` exports the schema but no inferred type for it, and
 * that package is not this lane's to edit.
 */
type CaseAttributeValueDraft = NonNullable<DefineCaseAttributeInput['values']>[number];

export class CommandService {
  constructor(private readonly deps: CommandServiceDeps) {}

  startDemo(commandId: string, rawInput: unknown): ServiceResult<CommandReceipt> {
    const parsed = StartDemoInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid startDemo input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const pack = resolveLatestPack(this.deps.registry, input.demoId);
    if (pack === undefined) {
      return notFound(`No installed Decision Pack was found for demo "${input.demoId}".`);
    }

    const selection: PackSelection = {
      selectedBy: 'user',
      reasons: [`Started the "${input.demoId}" demo from the launcher.`],
    };
    const seed = instantiateCase(pack, selection, this.deps.clock, this.deps.idGenerator);
    const seedEntities = this.deps.demoSeedEntities?.[input.demoId]?.(this.deps.clock) ?? [];

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 1,
        timestamp: seed.createdAt,
        commandId,
        type: 'case.created',
        // The decision mode is recorded here, not left absent.
        //
        // `case.created` seeds `CaseState.discovery` only when `mode` is
        // present, and the companion frame's render gate is
        // `snapshot.discovery !== undefined`. Without this, every case had
        // an undefined discovery, that gate was false on every real case,
        // and the whole orientation shell -- written, unit tested, and
        // wired into `App.tsx` -- rendered for nobody while every unit test
        // passed. Caught by `tests/e2e/adaptive-vehicle-journey.spec.ts`,
        // which is the only test that looks at a screen.
        //
        // `companion` is the truthful value: both entry points create a
        // case for the right-pane experience, and only a standalone entry
        // point may defer a soft topic.
        payload: { title: seed.title, pack: seed.pack, mode: 'companion' },
      },
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 2,
        timestamp: seed.createdAt,
        commandId,
        type: 'criteria.updated',
        payload: { criteria: seed.criteria },
      },
      ...seed.obligations.map((obligation, index): CaseEvent => ({
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 3 + index,
        timestamp: seed.createdAt,
        commandId,
        type: 'obligation.updated',
        payload: { obligation },
      })),
      ...seedEntities.map((entity, index): CaseEvent => ({
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 3 + seed.obligations.length + index,
        timestamp: seed.createdAt,
        commandId,
        type: 'option.upserted',
        payload: { entity },
      })),
    ];

    const result = this.deps.caseStore.append(seed.id, events, 0, {
      seedSnapshot: seed,
      idempotency: { commandId, commandName: 'startDemo' },
    });

    if (result.status === 'applied') {
      this.emitActivity({
        timestamp: seed.createdAt,
        caseId: result.snapshot.id,
        commandId,
        type: 'command.accepted',
        phase: 'completed',
        summary: `Started "${pack.identity.name}".`,
      });
      for (const entity of seedEntities) {
        this.emitActivity({
          timestamp: seed.createdAt,
          caseId: result.snapshot.id,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `Added option "${entity.label}".`,
        });
      }
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * `checkEnergyBillFeed`: the deterministic Home Energy Guardian
   * case-creation gate. Decides, from the real bill-feed arithmetic
   * (`@sift/scenarios`'s `loadAndEvaluateBillFeed`/`evaluateBillFeed`,
   * `bill-feed-gate.ts`, itself built on `energy-calculator.ts`'s
   * `determineAnomaly` -- the one place the 15% "materially abnormal"
   * threshold is defined), whether a case is opened at all -- not merely a
   * computation that runs *inside* an already-created case.
   *
   * A sibling command to `startDemo`, not an overload of it: `startDemo`'s
   * own "reset to the fixture, unconditionally" semantics for every demo
   * (including `home-energy-guardian`) are left completely intact, and
   * this command's result cannot be represented as a bare `CommandReceipt`
   * -- that schema requires a non-empty `caseId`, which does not exist
   * when the gate declines. See `EnergyBillFeedCheckResultSchema`'s own
   * doc comment in `packages/contracts/src/commands.ts`.
   *
   * `billFeedId: 'anomalous'` points at the real, checked-in
   * `current-bill.json` (42% above baseline -- always opens a case, by the
   * same arithmetic `energy-calculator.test.ts` already proves).
   * `billFeedId: 'normal'` points at `current-bill-normal.json` (within
   * the default 15% threshold -- never opens a case). When the gate opens
   * a case, it delegates the actual case creation to `this.startDemo`
   * (identical pack resolution, seed entities, event sequence, and
   * idempotency as the existing `home-energy-guardian` demo path) rather
   * than duplicating that construction -- so a person who reaches an
   * opened case through this command sees exactly the same case shape as
   * the unconditional launcher button produces.
   */
  checkEnergyBillFeed(
    commandId: string,
    rawInput: unknown,
  ): ServiceResult<EnergyBillFeedCheckResult> {
    const parsed = CheckEnergyBillFeedInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid checkEnergyBillFeed input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    // Pure and deterministic (no side effects) -- safe to recompute on
    // every call, including an idempotent retry of a "no case opened"
    // result, without needing its own idempotency record.
    const fixtureName = input.billFeedId === 'anomalous' ? 'current-bill' : 'current-bill-normal';
    const decision = loadAndEvaluateBillFeed(fixtureName);

    if (!decision.caseShouldOpen) {
      return ok({
        commandId,
        billFeedId: input.billFeedId,
        caseOpened: false,
        percentAboveBaseline: decision.percentAboveBaseline,
        thresholdPercent: decision.thresholdPercent,
        reason: decision.reason,
      });
    }

    const startResult = this.startDemo(commandId, { demoId: 'home-energy-guardian' });
    if (startResult.status !== 'ok') return startResult;

    return ok({
      commandId,
      billFeedId: input.billFeedId,
      caseOpened: true,
      percentAboveBaseline: decision.percentAboveBaseline,
      thresholdPercent: decision.thresholdPercent,
      reason: decision.reason,
      receipt: startResult.value,
    });
  }

  /**
   * `startCase` (docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md):
   * a normal, non-demo case-creation entry point pinned to any registered
   * pack id -- unlike `startDemo`, never resets to a fixture and seeds zero
   * entities (a catalog-built case's candidates are added afterward, one
   * per vehicle, via the existing, unmodified `upsertOption`). Mirrors
   * `startDemo`'s exact event sequence (`case.created` then
   * `criteria.updated` then one `obligation.updated` per derived
   * obligation) minus the seed-entity events `startDemo`'s
   * `demoSeedEntities` hook adds -- `instantiateCase` always derives
   * `entities: []`, so there is nothing to seed here by construction.
   */
  startCase(commandId: string, rawInput: unknown): ServiceResult<CommandReceipt> {
    const parsed = StartCaseInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid startCase input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const pack = resolveLatestPack(this.deps.registry, input.packId);
    if (pack === undefined) {
      return notFound(`No installed Decision Pack was found for pack id "${input.packId}".`);
    }

    const selection: PackSelection = {
      selectedBy: 'user',
      reasons: [`Started a new case against "${pack.identity.name}".`],
    };
    const seed = instantiateCase(pack, selection, this.deps.clock, this.deps.idGenerator);

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 1,
        timestamp: seed.createdAt,
        commandId,
        type: 'case.created',
        // Same reasoning as `startDemo` above: without a recorded mode the
        // case has no discovery state, and the companion frame never
        // renders.
        payload: { title: seed.title, pack: seed.pack, mode: 'companion' },
      },
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 2,
        timestamp: seed.createdAt,
        commandId,
        type: 'criteria.updated',
        payload: { criteria: seed.criteria },
      },
      ...seed.obligations.map((obligation, index): CaseEvent => ({
        eventId: this.deps.idGenerator.next('event'),
        caseId: seed.id,
        sequence: 3 + index,
        timestamp: seed.createdAt,
        commandId,
        type: 'obligation.updated',
        payload: { obligation },
      })),
    ];

    const result = this.deps.caseStore.append(seed.id, events, 0, {
      seedSnapshot: seed,
      idempotency: { commandId, commandName: 'startCase' },
    });

    if (result.status === 'applied') {
      this.emitActivity({
        timestamp: seed.createdAt,
        caseId: result.snapshot.id,
        commandId,
        type: 'command.accepted',
        phase: 'completed',
        summary: `Started a new case against "${pack.identity.name}".`,
      });
    }
    return this.toReceipt(commandId, result);
  }

  selectPack(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SelectPackInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid selectPack input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const pack = resolveLatestPack(this.deps.registry, input.packId);
    if (pack === undefined) {
      return validationFailure(`Pack "${input.packId}" is not installed.`);
    }

    const now = this.deps.clock.now();
    const event: CaseEvent = {
      eventId: this.deps.idGenerator.next('event'),
      caseId: input.caseId,
      sequence: snapshot.eventSequence + 1,
      timestamp: now,
      commandId,
      type: 'case.pack_selected',
      payload: {
        pack: {
          id: pack.identity.id,
          version: pack.identity.version,
          compiledHash: pack.compiledHash,
          selectedBy: 'user',
          reasons: ['User explicitly selected this Decision Pack.'],
        },
      },
    };

    const result = this.deps.caseStore.append(input.caseId, [event], input.expectedSequence, {
      idempotency: { commandId, commandName: 'selectPack' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `Selected Decision Pack "${pack.identity.id}".`,
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  upsertOption(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = UpsertOptionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid upsertOption input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const optionId = input.optionId ?? this.deps.idGenerator.next('option');
    const existingEntity = snapshot.entities.find((entity) => entity.id === optionId);

    const now = this.deps.clock.now();
    const attributes: Record<string, AttributeRecord> = {};
    const errors: string[] = [];
    for (const attribute of input.option.attributes) {
      // `origin`/`status`/`confidence` default to the exact pre-existing
      // hardcoded values (`'user'`/`'asserted'`/absent) when the caller
      // omits them, preserving backward compatibility for a caller passing
      // just `{ definitionId, value }`. `value` itself is now optional on
      // the wire (`OptionAttributeInputSchema`) so a caller can express
      // `status: 'unknown'` with no value at all -- `createAttributeRecord`
      // (`@sift/core`) already enforces the "value required unless unknown"
      // cross-field invariant and is used exactly as before, just no
      // longer with a value/status pair this method fixes itself.
      const recordResult = createAttributeRecord(
        {
          definitionId: attribute.definitionId,
          label: attribute.label ?? attribute.definitionId,
          origin: attribute.origin ?? 'user',
          status: attribute.status ?? 'asserted',
          ...(attribute.value !== undefined ? { value: attribute.value } : {}),
          ...(attribute.confidence !== undefined ? { confidence: attribute.confidence } : {}),
          ...(attribute.sourceIds !== undefined ? { sourceIds: attribute.sourceIds } : {}),
        },
        this.deps.clock,
      );
      if (!recordResult.ok) {
        errors.push(...recordResult.errors);
        continue;
      }
      attributes[attribute.definitionId] = recordResult.value;
    }
    if (errors.length > 0) {
      return validationFailure('Invalid option attributes.', errors);
    }

    const entity: EntityRecord = {
      id: optionId,
      kind: input.option.kind,
      label: input.option.label,
      attributes,
      createdAt: existingEntity?.createdAt ?? now,
      updatedAt: now,
    };

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'option.upserted',
        payload: { entity },
      },
    ];

    // Item 4 (dependent invalidation): a `ready` recommendation is
    // invalidated only when this write touches a definitionId at least one
    // *active* criterion actually depends on (`criteriaDependOnAttributes`
    // below) -- not on every option/attribute write. See that method's own
    // doc comment for why the coarser "always invalidate" rule
    // `updateCriteria`/`setEvidenceDisposition` use does not fit here.
    const changedDefinitionIds = new Set(
      input.option.attributes.map((attribute) => attribute.definitionId),
    );
    const invalidatesRecommendation =
      snapshot.recommendation !== null &&
      snapshot.recommendation.status === 'ready' &&
      this.criteriaDependOnAttributes(snapshot.criteria, changedDefinitionIds);
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 2,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: {
          recommendationId: snapshot.recommendation.id,
          reason: 'A comparison attribute the recommendation depends on changed.',
        },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'upsertOption' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `${existingEntity !== undefined ? 'Updated' : 'Added'} option "${entity.label}".`,
        },
        commandOrigin,
      );
      if (invalidatesRecommendation) {
        this.emitActivity(
          {
            timestamp: now,
            caseId: input.caseId,
            commandId,
            type: 'recommendation.invalidated',
            phase: 'completed',
            summary: 'Recommendation invalidated: a dependent option attribute changed.',
          },
          commandOrigin,
        );
      }
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * ADR 0006 decision 4: writes exactly one attribute on one EXISTING
   * option, merging it into the entity's attributes map rather than
   * replacing the whole map the way `upsertOption` does. This IS decision
   * mutation (an option's attribute values are decision-relevant state), so
   * it goes through `append()`, not `updateSelection()` -- unlike
   * `setView`/`focusOption` immediately above and below it.
   *
   * No new `CaseEvent` variant is introduced: the merged attributes map is
   * emitted as the existing `option.upserted` event, keeping the event
   * union stable and every existing reducer/readiness/invalidation path
   * unchanged. `createAttributeRecord` is called exactly the way
   * `upsertOption` calls it (same defaults: `origin ?? 'user'`,
   * `status ?? 'asserted'`), enforcing the identical asserted/unknown
   * cross-field invariant.
   *
   * Unlike `upsertOption`, both `optionId` and `attribute.definitionId` are
   * validated to actually exist on the case before any write is attempted
   * -- an unknown option or an attribute id declared nowhere on the case
   * (neither `attributeDefinitions` nor a `caseExtensions` entry) is a clean
   * validation error, never a silent no-op, per this command's narrower,
   * more authoritative contract.
   */
  setOptionAttribute(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SetOptionAttributeInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid setOptionAttribute input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const existingEntity = snapshot.entities.find((entity) => entity.id === input.optionId);
    if (existingEntity === undefined) {
      return validationFailure(
        `Option "${input.optionId}" was not found on case "${input.caseId}".`,
      );
    }

    const definitionId = input.attribute.definitionId;
    const definitionExists =
      snapshot.attributeDefinitions.some((definition) => definition.id === definitionId) ||
      snapshot.caseExtensions.some((extension) => extension.definition.id === definitionId);
    if (!definitionExists) {
      return validationFailure(
        `Attribute definition "${definitionId}" was not found on case "${input.caseId}".`,
      );
    }

    const now = this.deps.clock.now();
    const recordResult = createAttributeRecord(
      {
        definitionId,
        label: input.attribute.label ?? definitionId,
        origin: input.attribute.origin ?? 'user',
        status: input.attribute.status ?? 'asserted',
        ...(input.attribute.value !== undefined ? { value: input.attribute.value } : {}),
        ...(input.attribute.confidence !== undefined
          ? { confidence: input.attribute.confidence }
          : {}),
        ...(input.attribute.sourceIds !== undefined
          ? { sourceIds: input.attribute.sourceIds }
          : {}),
      },
      this.deps.clock,
    );
    if (!recordResult.ok) {
      return validationFailure('Invalid option attribute.', recordResult.errors);
    }

    const entity: EntityRecord = {
      ...existingEntity,
      attributes: { ...existingEntity.attributes, [definitionId]: recordResult.value },
      updatedAt: now,
    };

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'option.upserted',
        payload: { entity },
      },
    ];

    // Same "does a ready recommendation actually depend on this" rule
    // `upsertOption` uses -- see `criteriaDependOnAttributes`'s own doc
    // comment.
    const invalidatesRecommendation =
      snapshot.recommendation !== null &&
      snapshot.recommendation.status === 'ready' &&
      this.criteriaDependOnAttributes(snapshot.criteria, new Set([definitionId]));
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 2,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: {
          recommendationId: snapshot.recommendation.id,
          reason: 'A comparison attribute the recommendation depends on changed.',
        },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'setOptionAttribute' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `Set option "${existingEntity.label}" attribute "${definitionId}".`,
        },
        commandOrigin,
      );
      if (invalidatesRecommendation) {
        this.emitActivity(
          {
            timestamp: now,
            caseId: input.caseId,
            commandId,
            type: 'recommendation.invalidated',
            phase: 'completed',
            summary: 'Recommendation invalidated: a dependent option attribute changed.',
          },
          commandOrigin,
        );
      }
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * `submitBidDocument`: brings a person's OWN bid document into a case and
   * applies what a deterministic extractor could read off it.
   *
   * Before this command, the only two ways an option reached a case were
   * `upsertOption`/`setOptionAttribute` (one hand-typed scalar at a time)
   * and the twelve bid fixtures checked into this repository. A real
   * document had no way in at all. See `SubmitBidDocumentInputSchema`
   * (`@sift/contracts`) for the input contract and the recorded decision on
   * free text.
   *
   * --- The rule this method exists to enforce ---
   *
   * **Extraction proposes; it never asserts on the person's behalf.** Every
   * attribute record written here is `origin: 'agent_proposed'` with a
   * `confidence` the extractor assigned, and never `status: 'verified'` --
   * `@sift/core`'s `attributeStatusOriginError` refuses that combination
   * outright ("only origin 'user' (a human attestation) may claim
   * 'verified'"), and this method reaches it through the same
   * `createAttributeRecord` smart constructor `upsertOption` uses, so the
   * rule is enforced by the domain layer rather than restated here. A value
   * read off an unverified document is `'supported'`: it has exactly one
   * source behind it, which is more than a bare assertion and less than a
   * human attestation.
   *
   * A field the extractor could NOT read becomes `status: 'unknown'` with
   * no value -- never a zero, never a default. That is the same rule
   * `packages/packs/src/bid-comparison.ts` spells out for
   * `bid.warranty_months` and `packages/scenarios/src/seeds.ts` applies to
   * an unresolved `bid.adjusted_total`.
   *
   * --- Traceability ---
   *
   * The document becomes a real `Source` (`origin: 'user_submitted'`,
   * `verification: 'unverified'`) BEFORE the entity that cites it is
   * appended, and every attribute record this method writes -- valued or
   * unknown -- carries that source's id in `sourceIds`. Carrying it on the
   * unknowns too is a deliberate divergence from `seeds.ts`, which writes
   * `sourceIds: []` for a value it never had a document for: here there IS
   * a document, it WAS read, and the field was not in it. Recording which
   * document was searched is strictly more traceable than recording
   * nothing, and it asserts no value (the schema still forbids one).
   *
   * The extractor is handed the `Source.id` this method is about to persist
   * (`BidDocumentExtractorInput.sourceId` is required for exactly this
   * reason), so the tool's own evidence item and every record's `sourceIds`
   * name the same real record rather than two ids that merely happen to
   * agree.
   *
   * --- Two store calls, one command ---
   *
   * `sources` has no `CaseEvent` variant (see `case-store.ts`'s
   * `SelectionPatch` doc comment), so the `Source` goes through
   * `updateSelection()` -- which does not advance `eventSequence` -- and the
   * entity goes through `append()` as an ordinary `option.upserted` event at
   * `expectedSequence + 1`. Exactly the split `submitSource` already makes,
   * including its derived-idempotency-key trick: the two calls cannot share
   * the literal `commandId` or the second would see the first's own
   * registration and answer `'duplicate'` without writing anything.
   *
   * Known, deliberately unchanged window, identical in shape to
   * `submitSource`'s: if the source write lands and the event append is then
   * refused by a competing writer, a retry of the same `commandId` is not
   * caught by `checkIdempotent` (only the append registers that key), so it
   * mints a fresh source id while the original stays on the case. The retry
   * still succeeds and still produces a correct, fully-sourced option; the
   * cost is one orphaned `Source` row. Closing it properly means one
   * idempotency domain across both store calls, which is a `case-store.ts`
   * change affecting `submitSource` too -- not something to fork a
   * private scheme for here.
   *
   * --- What it deliberately does not touch ---
   *
   * Only the five attributes a bid DOCUMENT states are written.
   * `bid.adjusted_total`, `bid.scope_completeness`, `bid.license_status`,
   * `bid.insurance_named_insured_match` and `bid.credentials_valid` are
   * left entirely alone: no bid states them, they are owned by
   * `bid-calculator`/`scope-differ`/`license-lookup` and the
   * credential-verification skill, and writing them as `'unknown'` here
   * would be this command reporting on a search it never performed. For the
   * same reason a re-read MERGES into an existing option's attribute map
   * rather than replacing it the way `upsertOption` does -- a corrected
   * document must never delete a derivation or a registry lookup it never
   * looked at.
   *
   * The extracted contractor name becomes the option's label and the
   * `Source.publisher`; the extracted licence number is recorded in the
   * source's `excerpt` (content quoted FROM the document) and returned by
   * the extractor for a later credential-verification increment. Neither
   * reaches the activity stream: that summary names the option, the file,
   * and the counts, and nothing read out of the document itself.
   */
  submitBidDocument(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SubmitBidDocumentInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid submitBidDocument input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const optionId = input.optionId ?? this.deps.idGenerator.next('option');
    const existingEntity = snapshot.entities.find((entity) => entity.id === optionId);
    // The same cap `CaseStateSchema.entities` enforces (`MAX_CASE_ENTITIES`),
    // checked here so a full case refuses the submission with a sentence a
    // person can act on rather than failing later inside snapshot validation.
    if (existingEntity === undefined && snapshot.entities.length >= MAX_CASE_ENTITIES) {
      return validationFailure(
        `This case already holds the maximum of ${MAX_CASE_ENTITIES} options; remove one before adding another.`,
      );
    }

    const now = this.deps.clock.now();
    const sourceId = this.deps.idGenerator.next('source');

    const extraction = extractBidDocument({
      sourceId,
      filename: input.document.filename,
      format: input.document.format,
      text: input.document.text,
    });
    if (extraction.status !== 'ok') {
      // A document that resolves to no bid at all (unparseable, over a cap,
      // a CSV with no usable header) is bad input, reported with the
      // extractor's own reason -- never a silently empty option.
      return validationFailure(
        `The document "${input.document.filename}" could not be read as a bid.`,
        [extraction.message],
      );
    }
    const extracted = extraction.data;
    const excerpt = buildBidDocumentExcerpt(extracted);

    const source: Source = {
      id: sourceId,
      // A file a person hands over has no web address. Rather than inventing
      // one (`SourceSchema.url` is required), this mints a non-network URI
      // that names the stored document and nothing else.
      url: input.document.sourceUrl ?? `sift://cases/${input.caseId}/documents/${sourceId}`,
      title: input.document.filename,
      ...(extracted.fields.contractorName !== undefined
        ? { publisher: extracted.fields.contractorName.value }
        : {}),
      retrievedAt: now,
      ...(excerpt !== undefined ? { excerpt } : {}),
      tags: ['bid-document', input.document.format],
      origin: 'user_submitted',
      verification: 'unverified',
      createdAt: now,
    };

    const attributeResult = this.buildExtractedBidAttributes(extracted, sourceId);
    if (!attributeResult.ok) {
      return validationFailure('Invalid extracted bid attributes.', attributeResult.errors);
    }

    const entity: EntityRecord = {
      id: optionId,
      // The `bid-comparison` pack manifest declares exactly one entity kind.
      kind: BID_ENTITY_KIND,
      // Never invented: the contractor's own name when the document states
      // it, and otherwise the file's own name, which claims nothing about
      // who wrote it.
      label: extracted.fields.contractorName?.value ?? input.document.filename,
      // MERGE, not replace -- see this method's doc comment.
      attributes: { ...existingEntity?.attributes, ...attributeResult.attributes },
      createdAt: existingEntity?.createdAt ?? now,
      updatedAt: now,
    };

    // Defense in depth against a document whose own text cannot legally be
    // stored: every string that will be RENDERED (the option label, the
    // source title/publisher/excerpt) goes through `safeString` inside these
    // schemas, so markup-shaped content from a submitted file is refused
    // loudly here rather than silently rewritten, or discovered later when a
    // snapshot fails to parse.
    const sourceCheck = SourceSchema.safeParse(source);
    if (!sourceCheck.success) {
      return validationFailure(
        `The document "${input.document.filename}" could not be stored as a source.`,
        formatZodIssues(sourceCheck.error.issues),
      );
    }
    const entityCheck = EntityRecordSchema.safeParse(entity);
    if (!entityCheck.success) {
      return validationFailure(
        `The document "${input.document.filename}" could not be stored as an option.`,
        formatZodIssues(entityCheck.error.issues),
      );
    }

    // The source first, so nothing extracted can ever exist on the case
    // without the document it came from already being there to point at.
    // `updateSelection()` does not advance `eventSequence`, so the append
    // below still starts at `expectedSequence + 1`.
    const sourceWrite = this.deps.caseStore.updateSelection(
      input.caseId,
      { sources: [...snapshot.sources, source] },
      input.expectedSequence,
      now,
      { commandId: `${commandId}:source`, commandName: 'submitBidDocument' },
    );
    if (sourceWrite.status === 'conflict' || sourceWrite.status === 'not_found') {
      return this.toReceipt(commandId, sourceWrite);
    }

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: input.expectedSequence + 1,
        timestamp: now,
        commandId,
        type: 'option.upserted',
        payload: { entity },
      },
    ];

    // Identical rule to `upsertOption`'s: invalidate a `ready`
    // recommendation only when this write touches a definitionId an ACTIVE
    // criterion actually depends on.
    const changedDefinitionIds = new Set(Object.keys(attributeResult.attributes));
    const invalidatesRecommendation =
      snapshot.recommendation !== null &&
      snapshot.recommendation.status === 'ready' &&
      this.criteriaDependOnAttributes(snapshot.criteria, changedDefinitionIds);
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: input.expectedSequence + 2,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: {
          recommendationId: snapshot.recommendation.id,
          reason: 'A comparison attribute the recommendation depends on changed.',
        },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'submitBidDocument' },
    });
    if (result.status === 'applied') {
      const readCount = Object.values(attributeResult.attributes).filter(
        (record) => record.status !== 'unknown',
      ).length;
      const unknownCount = Object.keys(attributeResult.attributes).length - readCount;
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          // Deliberately reports only counts and the file's own name --
          // never a value, a licence number, or any other content read out
          // of the submitted document. Same discipline `addNote`/
          // `submitSource` keep with note bodies and source excerpts.
          summary: `${existingEntity !== undefined ? 'Updated' : 'Added'} option "${entity.label}" from submitted document "${input.document.filename}": ${readCount} proposed value${readCount === 1 ? '' : 's'}, ${unknownCount} left unknown.`,
        },
        commandOrigin,
      );
      if (invalidatesRecommendation) {
        this.emitActivity(
          {
            timestamp: now,
            caseId: input.caseId,
            commandId,
            type: 'recommendation.invalidated',
            phase: 'completed',
            summary: 'Recommendation invalidated: a dependent option attribute changed.',
          },
          commandOrigin,
        );
      }
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * Turns one extraction into the `AttributeRecord`s for the five
   * bid-comparison attributes a bid DOCUMENT states -- proposed when the
   * extractor read a value, explicitly unknown when it did not. See
   * `submitBidDocument`'s doc comment for why only these five, why
   * `origin: 'agent_proposed'`/`status: 'supported'`, and why every record
   * (unknown included) carries the document's source id.
   */
  private buildExtractedBidAttributes(
    extracted: BidDocumentExtractionResult,
    sourceId: string,
  ): { ok: true; attributes: Record<string, AttributeRecord> } | { ok: false; errors: string[] } {
    const attributes: Record<string, AttributeRecord> = {};
    const errors: string[] = [];

    for (const mapping of BID_DOCUMENT_ATTRIBUTE_MAP) {
      const read = mapping.read(extracted.fields);
      const recordResult = createAttributeRecord(
        {
          definitionId: mapping.definitionId,
          label: mapping.label,
          // Never `'user'`: this value was read off a document, not asserted
          // by the person who submitted it.
          origin: 'agent_proposed',
          // Never `'verified'` -- `@sift/core` refuses that for this origin.
          // `'supported'` is the strongest claim a single unverified
          // document can carry; an unread field carries none at all.
          status: read === undefined ? 'unknown' : 'supported',
          sourceIds: [sourceId],
          ...(read !== undefined ? { value: read.value, confidence: read.confidence } : {}),
        },
        this.deps.clock,
      );
      if (!recordResult.ok) {
        errors.push(...recordResult.errors);
        continue;
      }
      attributes[mapping.definitionId] = recordResult.value;
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, attributes };
  }

  /**
   * `addNote` (docs/change-sets/2026-08-30-generic-decision-workspace.md §28
   * "Notes"/§29 "WebMCP should be able to add research and notes"): appends
   * a `CaseNote` -- a human's or the model's observation attached to a case
   * that is real, first-class content but deliberately NOT evidence ("Not
   * every thought belongs as evidence, criterion, or attribute", §28).
   *
   * Unlike `submitSource` (which records a `Source` through
   * `updateSelection()`, since no `CaseEvent` variant touches `sources`), a
   * note IS event-sourced (`note.added`, events.ts) and flows through
   * `append()` like every other canonical mutation -- there is no
   * architectural reason to route it through the non-event `SelectionPatch`
   * escape hatch the way `sources`/`view`/the selection ids currently must.
   *
   * Deliberately touches nothing else: no obligation, no recommendation, no
   * evidence link, no case extension, and (unlike `upsertOption`/
   * `setOptionAttribute`/`updateCriteria`/`setEvidenceDisposition`/
   * `reviewCaseExtension`) never appends a `recommendation.invalidated`
   * event either. This absence is the concrete mechanism behind "notes
   * never auto-promote to evidence" (docs/engineering-principles.md's deterministic-core
   * ownership of evidence validity/readiness/human authority): adding a
   * note can never satisfy an obligation, invalidate a `ready`
   * recommendation, or appear as a `Source`, because the command that
   * creates one has no code path that reads or writes any of those fields.
   *
   * `optionIds`/`obligationId` are validated to actually exist on the case
   * (same "clean validation error, never a silent no-op" contract
   * `setOptionAttribute` already applies to `optionId`/`attribute.
   * definitionId`) so a note can never durably reference a dangling id.
   *
   * `origin`/`authoredBy` mirror `defineCaseAttribute`'s exact `origin ===
   * 'user' ? 'user' : 'model'` convention -- see `CaseNoteSchema`'s own doc
   * comment (`@sift/contracts` case.ts) for why this reuses
   * `CASE_ATTRIBUTE_ORIGINS` rather than a parallel vocabulary.
   *
   * The public activity summary deliberately never echoes `note.body`
   * verbatim (a note is user-entered free text) -- it states only that a
   * note was added and, when present, how many options it references,
   * matching `submitSource`'s own summary, which likewise never echoes
   * `source.excerpt` or claim statements into the sanitized activity
   * stream.
   */
  addNote(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = AddNoteInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid addNote input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;
    const origin: CaseAttributeOrigin = input.origin ?? 'user';

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    // Sequence-independent (see `loadForIndependentMutation`). A note is the
    // author's own observation: it satisfies no obligation, invalidates no
    // recommendation, links to no evidence, and -- as this method's own
    // comment above already states in full -- has "no code path that reads or
    // writes any of those fields". There is therefore no case state a
    // bystander event could change that would make the note the person just
    // wrote the wrong note. Its only references to the case, `optionIds` and
    // `obligationId`, are validated immediately below against the snapshot
    // handed back here, which is the CURRENT one -- so accepting a caller
    // that is behind cannot let a dangling id through.
    const loaded = this.loadForIndependentMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const optionIds = input.note.optionIds ?? [];
    const unknownOptionIds = optionIds.filter(
      (optionId) => !snapshot.entities.some((entity) => entity.id === optionId),
    );
    if (unknownOptionIds.length > 0) {
      return validationFailure(
        `Note references option id(s) not found on case "${input.caseId}": ${unknownOptionIds.join(', ')}.`,
      );
    }
    if (
      input.note.obligationId !== undefined &&
      !snapshot.obligations.some((obligation) => obligation.id === input.note.obligationId)
    ) {
      return validationFailure(
        `Obligation "${input.note.obligationId}" was not found on case "${input.caseId}".`,
      );
    }

    const now = this.deps.clock.now();
    const note: CaseNote = {
      id: this.deps.idGenerator.next('note'),
      body: input.note.body,
      kind: input.note.kind ?? 'observation',
      origin,
      authoredBy: origin === 'user' ? 'user' : 'model',
      optionIds,
      ...(input.note.obligationId !== undefined ? { obligationId: input.note.obligationId } : {}),
      sourceIds: input.note.sourceIds ?? [],
      createdAt: now,
    };

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'note.added',
        payload: { note },
      },
    ];

    // `snapshot.eventSequence`, not `input.expectedSequence`: the caller is
    // allowed to be behind here, and the event above is numbered off the
    // current snapshot. `append` still does its own atomic check inside the
    // transaction, so a genuine interleave is still refused.
    const result = this.deps.caseStore.append(input.caseId, events, snapshot.eventSequence, {
      idempotency: { commandId, commandName: 'addNote' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary:
            optionIds.length > 0
              ? `Added a note about ${optionIds.length} option${optionIds.length === 1 ? '' : 's'}.`
              : 'Added a note.',
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  focusOption(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = FocusOptionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid focusOption input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    // `null` means "clear the selection" (FocusOptionInputSchema's own doc
    // comment, commands.ts) and names no real option, so the existence check
    // below -- which exists to reject a caller pointing at an option that is
    // not actually on this case -- only applies when a real id was supplied.
    if (
      input.optionId !== null &&
      !snapshot.entities.some((entity) => entity.id === input.optionId)
    ) {
      return validationFailure(
        `Option "${input.optionId}" was not found on case "${input.caseId}".`,
      );
    }

    const now = this.deps.clock.now();
    const result = this.deps.caseStore.updateSelection(
      input.caseId,
      { selectedOptionId: input.optionId },
      input.expectedSequence,
      now,
      { commandId, commandName: 'focusOption' },
    );
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary:
            input.optionId === null
              ? 'Cleared the focused option.'
              : `Focused option "${input.optionId}".`,
          safeDetails: { [PRESENTATION_ONLY_ACTIVITY_DETAIL]: true },
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * docs/decisions/0005-workspace-view-state-and-option-views.md "Decision"
   * §1: `WorkspaceViewState` is presentation state, not a decision
   * mutation, so this routes through `CaseStore.updateSelection()` -- NOT
   * `append()` -- exactly like `focusOption`/`focusEvidence` immediately
   * above. This is the property that makes §54 ("presentation is not
   * decision mutation") true by construction rather than by convention: a
   * view-only patch structurally cannot reach `append()`/`applyCaseEvent`,
   * so it can never advance `eventSequence` or invalidate a
   * `recommendation`.
   */
  setView(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SetViewInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid setView input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;

    const now = this.deps.clock.now();
    const result = this.deps.caseStore.updateSelection(
      input.caseId,
      { view: input.view },
      input.expectedSequence,
      now,
      { commandId, commandName: 'setView' },
    );
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `Set workspace view to "${input.view.mode}".`,
          safeDetails: { [PRESENTATION_ONLY_ACTIVITY_DETAIL]: true },
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * Defines a `custom.*` comparison column on a case, and -- as of ADR 0011
   * -- fills it in, in one transactional write.
   *
   * Three rules, in order:
   *
   *  1. **The pack decides whether this may happen at all.** The pinned
   *     pack's `extensionPolicy.allowCaseAttributes` is the author's
   *     standing pre-authorization. `false` means the command is REJECTED
   *     with a policy failure naming the pack and the flag -- never silently
   *     ignored, and never quietly downgraded to some weaker write the
   *     caller did not ask for and would not know happened.
   *  2. **A permitted agent-defined extension lands `confirmed`**, carrying
   *     its `origin` and `reason`. It does not sit `pending` waiting for a
   *     click: the person whose concern this is is talking in the
   *     conversation, not watching this pane, and a `pending` column is
   *     invisible to the comparison until someone happens to look. The
   *     safeguard is not a gate in front of the write, it is provenance plus
   *     an undo behind it -- `reviewCaseExtension` (a human-only verb,
   *     absent from the WebMCP catalog) can reject a confirmed extension at
   *     any time.
   *  3. **A model that defines a column must fill it in.** An
   *     `'agent_proposed'` definition arriving over the wire must supply a
   *     value, or an explicit reasoned unknown, for EVERY option it applies
   *     to (`resolveCaseAttributeValueCoverage`). An empty column is worse
   *     than no column: it reads as a real dimension the comparison failed
   *     to resolve, when nobody ever tried.
   *
   * None of this touches the decision gate. Extending a case is not
   * deciding it: `reviewProposal` stays absent from the WebMCP catalog, and
   * `attributeStatusOriginError` still refuses `status: 'verified'` from any
   * origin but `'user'` -- which is enforced here for free, because every
   * value written below goes through the real `createAttributeRecord`.
   *
   * `originParam` is the pre-existing call-site channel (still used by
   * `apps/agent/src/runtime/car-purchase-scenario.ts` and
   * `car-purchase-engine.test.ts`, both outside this task's scope): a
   * caller that already knows it is agent-driven and does not embed
   * `origin` in the raw command body itself. `input.origin` (now part of
   * `DefineCaseAttributeInputSchema` -- see that schema's own doc comment)
   * is the NEW wire-level channel this task adds, reachable through
   * `routes/commands.ts`'s single-argument `service.defineCaseAttribute
   * (commandId, input)` call and therefore through the WebMCP tool/HTTP
   * route, neither of which pass a third argument. `input.origin` wins
   * when both are present (`effectiveOrigin = input.origin ?? originParam`)
   * so the wire input is authoritative when a caller actually sets it,
   * while every existing caller that supplies only the third argument (and
   * omits `origin` from the body) keeps its exact current behavior
   * unchanged -- `input.origin` is `undefined` in that case, so the
   * expression falls through to `originParam`.
   *
   * `commandOrigin` (4th parameter) is an unrelated concept, added by I1 --
   * do not confuse it with `originParam`/`origin` above. `originParam`/
   * `origin` is a *domain* field (`CaseAttributeOrigin`: did a human or the
   * model define this attribute? -- it sets the written records' own
   * `AttributeRecord.origin`, decides whether a reasoned unknown's note is
   * attributed to `'user'` or `'model'`, and gates real branches in this
   * method's own logic).
   * `commandOrigin` is a *transport* marker (`CommandOrigin`: did this
   * command arrive over a WebMCP tool call? -- see `emitActivity`'s doc
   * comment) that only affects what gets recorded on the activity trail
   * and never participates in any decision this method makes.
   */
  defineCaseAttribute(
    commandId: string,
    rawInput: unknown,
    originParam: CaseAttributeOrigin = 'user',
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = DefineCaseAttributeInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid defineCaseAttribute input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;
    const origin: CaseAttributeOrigin = input.origin ?? originParam;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    // Deliverable 1 (ADR 0011): the pinned pack's `extensionPolicy` is the
    // dial the pack author set at authoring time. Resolved through
    // `requirePinnedPack`, which fails CLOSED -- an unresolvable pinned pack
    // is an invariant violation that throws, never a silent "assume
    // permitted" (see that helper's own doc comment).
    const pack = this.requirePinnedPack(snapshot, 'defineCaseAttribute');
    if (!pack.extensionPolicy.allowCaseAttributes) {
      return policyFailure(
        `Pack "${pack.identity.id}@${pack.identity.version}" forbids case-defined attributes (extensionPolicy.allowCaseAttributes is false), so case attribute "${input.definition.id}" was not defined.`,
      );
    }

    const existingAttributeIds = [
      ...snapshot.attributeDefinitions.map((definition) => definition.id),
      ...snapshot.caseExtensions.map((extension) => extension.definition.id),
    ];

    // Rebuilt as a plain object (rather than passing `input.definition`
    // through as-is) because Zod's inferred type for an `.optional()` field
    // is `T | undefined` (the key's *value* may be explicitly `undefined`),
    // while `CaseAttributeDraft` (`@sift/core`) declares `unit?: string` in
    // the stricter `exactOptionalPropertyTypes` sense (the key must be
    // *omitted*, never present with value `undefined`) -- conditionally
    // spreading each optional field reconciles the two.
    const draft = {
      id: input.definition.id,
      label: input.definition.label,
      valueType: input.definition.valueType,
      appliesTo: input.definition.appliesTo,
      evidenceExpectation: input.definition.evidenceExpectation,
      comparison: input.definition.comparison,
      reason: input.definition.reason,
      ...(input.definition.unit !== undefined ? { unit: input.definition.unit } : {}),
      ...(input.definition.allowedValues !== undefined
        ? { allowedValues: input.definition.allowedValues }
        : {}),
      ...(input.definition.orderedValues !== undefined
        ? { orderedValues: input.definition.orderedValues }
        : {}),
    };

    const extensionResult = defineCaseExtension(
      draft,
      {
        caseId: input.caseId,
        origin,
        proposedBy: origin === 'user' ? 'user' : 'model',
        existingAttributeIds,
        // Always `true` at this point (the gate above returned otherwise);
        // passed as the real flag rather than a literal so the causal link
        // -- the PACK pre-authorized this, nothing else -- stays visible.
        preauthorized: pack.extensionPolicy.allowCaseAttributes,
      },
      { clock: this.deps.clock, idGenerator: this.deps.idGenerator },
    );
    if (!extensionResult.ok) {
      return validationFailure('Unable to define case attribute.', extensionResult.errors);
    }
    const definition = extensionResult.value.definition;

    // Deliverable 3: the column and its cells are ONE operation.
    const valueDrafts = input.values ?? [];
    const coverage = this.resolveCaseAttributeValueCoverage(
      snapshot,
      definition,
      valueDrafts,
      input.origin,
    );
    if (coverage.status !== 'ok') return coverage;

    const now = this.deps.clock.now();
    const written = this.buildCaseAttributeValueWrites(definition, coverage.value, origin, now);
    if (written.status !== 'ok') return written;
    const { entities: touchedEntities, notes: unknownNotes } = written.value;

    let nextSequence = snapshot.eventSequence + 1;
    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'extension.defined',
        payload: { extension: extensionResult.value },
      },
    ];
    for (const entity of touchedEntities) {
      nextSequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'option.upserted',
        payload: { entity },
      });
    }
    for (const note of unknownNotes) {
      nextSequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'note.added',
        payload: { note },
      });
    }

    // Same "does a `ready` recommendation actually depend on this" rule
    // `upsertOption`/`setOptionAttribute` use. Scoped to the case where
    // values were actually written: defining an empty column changes no
    // comparison data, so a definition with no `values` behaves exactly as
    // it did before this task -- one `extension.defined` event, nothing else.
    const invalidatesRecommendation =
      touchedEntities.length > 0 &&
      snapshot.recommendation !== null &&
      snapshot.recommendation.status === 'ready' &&
      this.criteriaDependOnAttributes(snapshot.criteria, new Set([definition.id]));
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      nextSequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: {
          recommendationId: snapshot.recommendation.id,
          reason: 'A comparison attribute the recommendation depends on changed.',
        },
      });
    }

    // ONE append: the definition, every value, and every reasoned unknown
    // land together or not at all, so a case can never hold a column that
    // half exists.
    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'defineCaseAttribute' },
    });
    if (result.status === 'applied') {
      const unknownCount = unknownNotes.length;
      const summaryParts = [
        origin === 'user'
          ? `Defined case attribute "${input.definition.id}".`
          : `Defined case attribute "${input.definition.id}" (added by the assistant).`,
      ];
      if (valueDrafts.length > 0) {
        summaryParts.push(
          `Recorded ${valueDrafts.length} value${valueDrafts.length === 1 ? '' : 's'}${
            unknownCount > 0
              ? `, ${unknownCount} of them an explicit unknown with a stated reason`
              : ''
          }.`,
        );
      }
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: summaryParts.join(' '),
        },
        commandOrigin,
      );
      if (invalidatesRecommendation) {
        this.emitActivity(
          {
            timestamp: now,
            caseId: input.caseId,
            commandId,
            type: 'recommendation.invalidated',
            phase: 'completed',
            summary: 'Recommendation invalidated: a dependent option attribute changed.',
          },
          commandOrigin,
        );
      }
      // A new concern is the change the RunPlan exists to absorb. Without
      // this the headline beat -- "raising a concern revises work already
      // under way" -- was simply not wired: only triage and discovery
      // notified the plan, so a concern raised mid-run left the plan at
      // its previous version. Found by the persona harness, whose family
      // journey sat on plan v1 through the turn that was supposed to move
      // it to v2.
      notifyRunPlan(this.deps, input.caseId, {
        reason: 'new_concern',
        trigger: input.definition.id,
        triggerLabel: input.definition.label,
      });
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * Deliverable 3's coverage/reference check, kept next to the two private
   * helpers it shares a contract with rather than inline, so
   * `defineCaseAttribute` above reads as the sequence of decisions it makes.
   *
   * Three rejections, all clean validation errors that name what was wrong:
   *
   *  1. a `values` entry naming an option that is not on the case;
   *  2. a `values` entry naming an option the attribute does not apply to
   *     (`definition.appliesTo` lists entity KINDS -- writing a "cargo
   *     width" cell onto a row the column was never declared over produces
   *     an attribute nothing renders and no criterion can read, which is the
   *     same incoherence as a dangling id, one level down);
   *  3. an `'agent_proposed'` definition that leaves an applicable option
   *     unaccounted for. `CaseAttributeValueDraftSchema` already guarantees
   *     each supplied entry is either a real value or a reasoned unknown;
   *     only this layer can see the case's entities, so only this layer can
   *     check that EVERY one of them got an answer.
   *
   * Keyed on `wireOrigin` (`input.origin`) rather than the effective origin,
   * matching `DefineCaseAttributeInputSchema`'s own `superRefine` exactly:
   * the schema demands a non-empty `values` for precisely the calls whose
   * body declares `origin: 'agent_proposed'`, and this checks that those
   * same values are complete. The in-process `originParam` channel (
   * `car-purchase-scenario.ts`, `car-purchase-engine.ts` -- never reachable
   * from HTTP or WebMCP, both of which call `defineCaseAttribute(commandId,
   * input)` with no third argument) predates `values` entirely and keeps its
   * existing "define the column, let the specialists fill it" behavior.
   *
   * On success it returns each draft already PAIRED with the real
   * `EntityRecord` it names, so the write step below never has to re-look-up
   * an id and never needs a defensive "what if it is missing" branch: by the
   * time it runs, "this option exists and this attribute applies to it" is a
   * fact carried in the type, not a re-check.
   */
  private resolveCaseAttributeValueCoverage(
    snapshot: CaseState,
    definition: CaseAttributeDefinition,
    valueDrafts: readonly CaseAttributeValueDraft[],
    wireOrigin: CaseAttributeOrigin | undefined,
  ): ServiceResult<{ draft: CaseAttributeValueDraft; entity: EntityRecord }[]> {
    const errors: string[] = [];
    const named = new Set<string>();
    const resolved: { draft: CaseAttributeValueDraft; entity: EntityRecord }[] = [];
    for (const valueDraft of valueDrafts) {
      if (named.has(valueDraft.optionId)) {
        errors.push(
          `values carries more than one entry for option "${valueDraft.optionId}"; one option can only have one value for one attribute`,
        );
        continue;
      }
      named.add(valueDraft.optionId);
      const entity = snapshot.entities.find((candidate) => candidate.id === valueDraft.optionId);
      if (entity === undefined) {
        errors.push(
          `values names option "${valueDraft.optionId}", which was not found on case "${snapshot.id}"`,
        );
        continue;
      }
      if (!definition.appliesTo.includes(entity.kind)) {
        errors.push(
          `values names option "${entity.label}" (${entity.id}), whose kind "${entity.kind}" is not one of this attribute's appliesTo kinds (${definition.appliesTo.join(', ')})`,
        );
        continue;
      }
      resolved.push({ draft: valueDraft, entity });
    }
    if (errors.length > 0) {
      return validationFailure(`Invalid values for case attribute "${definition.id}".`, errors);
    }

    if (wireOrigin === 'agent_proposed') {
      const uncovered = snapshot.entities.filter(
        (entity) => definition.appliesTo.includes(entity.kind) && !named.has(entity.id),
      );
      if (uncovered.length > 0) {
        return validationFailure(
          `An agent-defined case attribute must account for every option it applies to; "${definition.id}" left ${uncovered.length} unaccounted for.`,
          [
            `no value and no explicit unknown was supplied for: ${uncovered
              .map((entity) => `"${entity.label}" (${entity.id})`)
              .join(', ')}`,
          ],
        );
      }
    }

    return ok(resolved);
  }

  /**
   * Turns each validated `CaseAttributeValueDraft` into the durable records
   * the append will carry.
   *
   * Every value goes through the real `@sift/core` `normalizeAttributeValue`
   * (which applies the definition's `allowedValues`/default `unit` and
   * rejects a value whose variant does not match the declared `valueType`)
   * and the real `createAttributeRecord` -- never a hand-assembled
   * `AttributeRecord` -- so the existing status/origin invariants apply here
   * completely unchanged. In particular `attributeStatusOriginError` still
   * refuses `status: 'verified'` from any origin but `'user'`: a model that
   * defines a column may fill it in, and may not promote its own inference
   * to a human attestation.
   *
   * An `unknown` draft becomes a genuine `status: 'unknown'` `AttributeRecord`
   * -- present in the entity's `attributes` map, not absent from it. That
   * distinction is the whole point and is already rendered: `OptionProfileSheet`
   * shows `status: null` ("nobody asked") and `status: 'unknown'` ("this case
   * records that nobody knows") as two different things.
   *
   * The unknown's `reason` rides along as a real `CaseNote` (`note.added`,
   * appended in the SAME transaction), because `AttributeRecordSchema`
   * (`@sift/contracts`, `.strict()`, not editable from this lane) carries no
   * per-record reason field. A note is the closest durable, first-class,
   * option-linked home the current contracts offer, and it is the one the
   * `addNote` command already writes for "a real observation that is
   * deliberately not evidence". `kind: 'question'` -- an unresolved unknown
   * with a stated reason is an open question about that option, not a
   * finding.
   */
  private buildCaseAttributeValueWrites(
    definition: CaseAttributeDefinition,
    resolved: readonly { draft: CaseAttributeValueDraft; entity: EntityRecord }[],
    origin: CaseAttributeOrigin,
    now: string,
  ): ServiceResult<{ entities: EntityRecord[]; notes: CaseNote[] }> {
    const touched = new Map<string, EntityRecord>();
    const notes: CaseNote[] = [];
    const errors: string[] = [];

    for (const { draft: valueDraft, entity } of resolved) {
      let value: AttributeValue | undefined;
      if (valueDraft.value !== undefined) {
        const normalized = normalizeAttributeValue(definition, valueDraft.value);
        if (!normalized.ok) {
          errors.push(`option "${entity.label}" (${entity.id}): ${normalized.errors.join('; ')}`);
          continue;
        }
        value = normalized.value;
      }

      const recordResult = createAttributeRecord(
        {
          definitionId: definition.id,
          label: definition.label,
          origin,
          status: valueDraft.status,
          ...(value !== undefined ? { value } : {}),
          ...(valueDraft.confidence !== undefined ? { confidence: valueDraft.confidence } : {}),
          ...(valueDraft.sourceIds !== undefined ? { sourceIds: valueDraft.sourceIds } : {}),
        },
        this.deps.clock,
      );
      if (!recordResult.ok) {
        errors.push(`option "${entity.label}" (${entity.id}): ${recordResult.errors.join('; ')}`);
        continue;
      }

      // No merge needed: `resolveCaseAttributeValueCoverage` already
      // rejected a `values` array carrying two entries for the same option,
      // so each entity is touched exactly once here.
      touched.set(entity.id, {
        ...entity,
        attributes: { ...entity.attributes, [definition.id]: recordResult.value },
        updatedAt: now,
      });

      if (valueDraft.status === 'unknown' && valueDraft.reason !== undefined) {
        // Prefixed with the attribute's own label so the note says WHAT is
        // unknown, since `CaseNoteSchema` has no attribute-id field. Falls
        // back to the bare reason when the prefix would push the body past
        // `safeString(2000)` -- truncating the author's own words to make
        // room for a label Sift added would be the wrong trade.
        const prefixed = `${definition.label}: ${valueDraft.reason}`;
        notes.push({
          id: this.deps.idGenerator.next('note'),
          body: prefixed.length <= 2000 ? prefixed : valueDraft.reason,
          kind: 'question',
          origin,
          authoredBy: origin === 'user' ? 'user' : 'model',
          optionIds: [entity.id],
          sourceIds: [],
          createdAt: now,
        });
      }
    }

    if (errors.length > 0) {
      return validationFailure(`Invalid values for case attribute "${definition.id}".`, errors);
    }
    return ok({ entities: [...touched.values()], notes });
  }

  reviewCaseExtension(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = ReviewCaseExtensionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid reviewCaseExtension input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const extension = snapshot.caseExtensions.find((item) => item.id === input.extensionId);
    if (extension === undefined) {
      return validationFailure(
        `Case extension "${input.extensionId}" was not found on case "${input.caseId}".`,
      );
    }

    const reviewResult = reviewCaseExtensionDomain(extension, input.decision);
    if (!reviewResult.ok) {
      return validationFailure('Unable to review case extension.', reviewResult.errors);
    }

    const now = this.deps.clock.now();
    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'extension.confirmed',
        payload: { extensionId: input.extensionId, decision: input.decision },
      },
    ];

    // Item 4, extended by ADR 0011. Two reviews can change what a
    // recommendation was computed from, and both must invalidate it:
    //
    //  - `confirm` (the original rule, unchanged): a confirmed attribute is
    //    usable, so a criterion depending on it now reads a value it could
    //    not read before.
    //  - `reject` of an already-`confirmed` extension (ADR 0011's undo, new
    //    with this task): the column the recommendation WAS computed from
    //    has just been taken away. Leaving the recommendation `ready` there
    //    would display a conclusion drawn from a dimension the human just
    //    removed.
    //
    // Rejecting a still-`pending` extension remains non-invalidating, for
    // the original reason: it was never usable, so nothing a recommendation
    // read has changed.
    //
    // Both are scoped, as before, to whether an *active* criterion's
    // `appliesToAttribute` actually names this extension's attribute id --
    // reviewing an extension no criterion references cannot affect a
    // current recommendation either way.
    const reviewChangesUsableAttributes =
      input.decision === 'confirm' ||
      (input.decision === 'reject' && extension.definition.confirmation === 'confirmed');
    const invalidatesRecommendation =
      reviewChangesUsableAttributes &&
      snapshot.recommendation !== null &&
      snapshot.recommendation.status === 'ready' &&
      this.criteriaDependOnAttributes(snapshot.criteria, new Set([extension.definition.id]));
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 2,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: {
          recommendationId: snapshot.recommendation.id,
          reason: 'A confirmed case extension the recommendation depends on changed.',
        },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'reviewCaseExtension' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `${input.decision === 'confirm' ? 'Confirmed' : 'Rejected'} case extension "${input.extensionId}".`,
        },
        commandOrigin,
      );
      if (invalidatesRecommendation) {
        this.emitActivity(
          {
            timestamp: now,
            caseId: input.caseId,
            commandId,
            type: 'recommendation.invalidated',
            phase: 'completed',
            summary: 'Recommendation invalidated: a confirmed case extension changed.',
          },
          commandOrigin,
        );
      }
    }
    return this.toReceipt(commandId, result);
  }

  focusEvidence(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = FocusEvidenceInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid focusEvidence input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    // `null` means "clear the selection" (FocusEvidenceInputSchema's own doc
    // comment, commands.ts) and names no real evidence link, so the
    // existence check below only applies when a real id was supplied --
    // identical reasoning to `focusOption` immediately above.
    if (
      input.evidenceId !== null &&
      !snapshot.evidenceLinks.some((link) => link.id === input.evidenceId)
    ) {
      return validationFailure(
        `Evidence "${input.evidenceId}" was not found on case "${input.caseId}".`,
      );
    }

    const now = this.deps.clock.now();
    const result = this.deps.caseStore.updateSelection(
      input.caseId,
      { selectedEvidenceId: input.evidenceId },
      input.expectedSequence,
      now,
      { commandId, commandName: 'focusEvidence' },
    );
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary:
            input.evidenceId === null
              ? 'Cleared the focused evidence.'
              : `Focused evidence "${input.evidenceId}".`,
          safeDetails: { [PRESENTATION_ONLY_ACTIVITY_DETAIL]: true },
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  updateCriteria(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = UpdateCriteriaInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid updateCriteria input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const pack = this.requirePinnedPack(snapshot, 'updateCriteria');

    let criteria: Criterion[] = [...snapshot.criteria];
    const addedCriterionIds: string[] = [];
    for (const operation of input.operations) {
      switch (operation.op) {
        case 'add': {
          // Two distinct manifest dials, both real, both checked here
          // because `add` is the only operation in this switch that EXTENDS
          // the case past what the pack shipped. `reweight`/`rename`/
          // `remove` act on a criterion that already exists, so
          // `extensionPolicy` has nothing to say about them (their own guard
          // is `criteria.protectedCriterionIds`, below).
          //
          //  - `extensionPolicy.allowCaseCriteria` (ADR 0011): may this pack's
          //    cases grow criteria at all?
          //  - `criteria.allowUserDefined`: may a criterion be authored
          //    outside the pack's own `criteria.defaults`?
          //
          // Checked in that order -- the broader "can this case be extended"
          // question first -- so a pack that forbids case criteria says so
          // rather than reporting the narrower authorship rule.
          if (!pack.extensionPolicy.allowCaseCriteria) {
            return policyFailure(
              `Pack "${pack.identity.id}@${pack.identity.version}" forbids case-defined criteria (extensionPolicy.allowCaseCriteria is false), so criterion "${operation.criterion.id}" was not added.`,
            );
          }
          if (!pack.criteria.allowUserDefined) {
            return policyFailure(
              `Pack "${pack.identity.id}" does not allow user-defined criteria.`,
            );
          }
          // Same exactOptionalPropertyTypes reconciliation as
          // `defineCaseAttribute`'s `draft` above: rebuild rather than pass
          // Zod's parsed `operation.criterion` straight through.
          const criterionInput = {
            id: operation.criterion.id,
            label: operation.criterion.label,
            kind: operation.criterion.kind,
            weight: operation.criterion.weight,
            direction: operation.criterion.direction,
            ...(operation.criterion.target !== undefined
              ? { target: operation.criterion.target }
              : {}),
            ...(operation.criterion.appliesToAttribute !== undefined
              ? { appliesToAttribute: operation.criterion.appliesToAttribute }
              : {}),
            ...(operation.criterion.question !== undefined
              ? { question: operation.criterion.question }
              : {}),
          };
          const result = addCriterion(criteria, criterionInput, 'user');
          if (!result.ok) return validationFailure('Unable to update criteria.', result.errors);
          criteria = result.value;
          addedCriterionIds.push(operation.criterion.id);
          break;
        }
        case 'remove': {
          if (pack.criteria.protectedCriterionIds.includes(operation.criterionId)) {
            return policyFailure(
              `Criterion "${operation.criterionId}" is protected by the pack and cannot be removed.`,
            );
          }
          const result = removeCriterion(
            criteria,
            operation.criterionId,
            pack.criteria.protectedCriterionIds,
          );
          if (!result.ok) return validationFailure('Unable to update criteria.', result.errors);
          criteria = result.value;
          break;
        }
        case 'reweight': {
          if (pack.criteria.protectedCriterionIds.includes(operation.criterionId)) {
            return policyFailure(
              `Criterion "${operation.criterionId}" is protected by the pack and cannot be reweighted.`,
            );
          }
          const result = reweightCriterion(criteria, operation.criterionId, operation.weight, {
            protectedCriterionIds: pack.criteria.protectedCriterionIds,
            allowProtectedReweight: false,
          });
          if (!result.ok) return validationFailure('Unable to update criteria.', result.errors);
          criteria = result.value;
          break;
        }
        case 'rename': {
          // Protected criteria are protected against RELABELLING too, not
          // only against removal and reweighting. A criterion reaches the
          // consumer surface by its label alone -- its id never does -- so
          // a silent rename of a pack-required criterion is
          // indistinguishable from substituting a different one, while it
          // stays weighted and stays protected.
          const result = renameCriterion(criteria, operation.criterionId, operation.label, {
            protectedCriterionIds: pack.criteria.protectedCriterionIds,
          });
          if (!result.ok) return validationFailure('Unable to update criteria.', result.errors);
          criteria = result.value;
          break;
        }
      }
    }

    const now = this.deps.clock.now();
    let nextSequence = snapshot.eventSequence + 1;
    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'criteria.updated',
        payload: { criteria },
      },
    ];

    // Item 2 ("Let a custom field create an obligation"): packs-and-
    // routing.md "Users may add ... criteria. When a custom criterion needs
    // evidence, the core derives a case obligation from the pack's
    // `userConcern` template." A "custom criterion" is exactly what this
    // `add` operation just created -- not restricted to a criterion that
    // happens to reference a `custom.*` attribute; a newly-added criterion
    // over a pack-defined attribute with no sourced value yet needs
    // evidence just the same, per `criterionNeedsEvidenceQuestion`'s own
    // generic predicate (`@sift/core`'s `criteria.ts`), which this loop
    // uses exactly as written, not reimplemented. Gated on
    // `pack.extensionPolicy.allowCaseObligations` -- the literal manifest
    // flag governing this exact behavior (packs-and-routing.md
    // `extensionPolicy`); `packages/packs/src/compiler.ts`'s own "Step 8"
    // already enforces `allowCaseObligations: true` implies
    // `allowCaseCriteria: true`, so this gate is never reachable for a
    // pack that forbids case criteria at all.
    //
    // The gate itself predates ADR 0011 and is unchanged. What ADR 0011 adds
    // is that skipping it can no longer be SILENT: `unobligedCriterionIds`
    // records every added criterion that genuinely needed an evidence
    // question and did not get one because this pack forbids case
    // obligations, and the activity summary below says so. Rejecting the
    // whole `add` would be wrong here -- the pack permitted the criterion
    // (`allowCaseCriteria`) and forbade only the derived obligation -- so
    // this is the same honest-degradation shape `submitSource` already uses
    // when it cannot link a claim, not a silent drop.
    const unobligedCriterionIds: string[] = [];
    for (const criterionId of addedCriterionIds) {
      const criterion = criteria.find((entry) => entry.id === criterionId);
      if (criterion === undefined) continue; // defensive; addCriterion always inserts what it accepted
      const existingEvidence = this.existingEvidenceSignal(criterion, snapshot);
      if (!criterionNeedsEvidenceQuestion(criterion, existingEvidence)) continue;
      if (!pack.extensionPolicy.allowCaseObligations) {
        unobligedCriterionIds.push(criterion.id);
        continue;
      }
      const template = this.synthesizeUserConcernObligationTemplate(criterion);
      const derived = deriveObligations(
        pack,
        [{ template, criterionId: criterion.id }],
        snapshot.obligations,
        this.deps.clock,
      );
      const newObligation = derived.find((obligation) => obligation.id === template.id);
      if (newObligation === undefined) continue; // defensive; deriveObligations always includes every supplied template
      nextSequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'obligation.updated',
        payload: { obligation: newObligation },
      });
    }

    const invalidatesRecommendation =
      snapshot.recommendation !== null && snapshot.recommendation.status === 'ready';
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      nextSequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: { recommendationId: snapshot.recommendation.id, reason: 'Criteria changed.' },
      });
    }

    // Marking the recommendation stale says the old answer is wrong. It does
    // not, on its own, give anything the ability to produce a new one:
    // `selectNextObligation` only considers `open` obligations, so a case
    // whose obligations were all satisfied had nothing left to investigate
    // and a re-run failed outright with "No open obligation remains to
    // select."
    //
    // A criteria change does not invalidate a *measurement* -- how much of
    // the bill came from a tariff change is unaffected by how much the
    // household now cares about long-term waste. It does invalidate an
    // answer that was a synthesis over those criteria, which is exactly what
    // `dependsOnCriteria` marks. Those obligations, and only those, reopen,
    // so the re-run re-synthesizes against the new weights while every
    // measured finding stands.
    //
    // `attemptsUsed` is deliberately NOT reset: reopening restores the
    // ability to try again within the budget the pack already granted, and
    // resetting it would let repeated reweights loop forever.
    const reopenedObligations = !invalidatesRecommendation
      ? []
      : snapshot.obligations.filter(
          (obligation) =>
            obligation.dependsOnCriteria === true &&
            (obligation.status === 'satisfied' || obligation.status === 'accepted_uncertainty') &&
            obligation.attemptsUsed < obligation.maxAttempts,
        );
    for (const obligation of reopenedObligations) {
      nextSequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: nextSequence,
        timestamp: now,
        commandId,
        type: 'obligation.updated',
        payload: {
          obligation: { ...obligation, status: 'open', updatedAt: now },
        },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'updateCriteria' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: [
            `Updated criteria (${input.operations.length} change${input.operations.length === 1 ? '' : 's'}).`,
            ...(unobligedCriterionIds.length > 0
              ? [
                  `No evidence question was created for ${unobligedCriterionIds.join(', ')}: pack "${pack.identity.id}" forbids case obligations.`,
                ]
              : []),
          ].join(' '),
        },
        commandOrigin,
      );
      if (invalidatesRecommendation) {
        this.emitActivity(
          {
            timestamp: now,
            caseId: input.caseId,
            commandId,
            type: 'recommendation.invalidated',
            phase: 'completed',
            summary: 'Recommendation invalidated: criteria changed.',
          },
          commandOrigin,
        );
      }
      // Adding a criterion is what synthesizes a case-extension obligation
      // (`synthesizeUserConcernObligationTemplate`), and a new obligation is
      // exactly what the RunPlan turns into new work. This is the command
      // that completes the "raise a concern" chain, so it is the one that
      // must tell the plan.
      const added = input.operations.find((operation) => operation.op === 'add');
      if (added !== undefined) {
        notifyRunPlan(this.deps, input.caseId, {
          reason: 'new_concern',
          trigger: added.criterion.id,
          triggerLabel: added.criterion.label,
        });
      }
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * Item 5: durably records the submitted `Source` (unchanged, existing
   * behavior -- always happens, via `updateSelection`), and additionally
   * turns `input.source.claims[]` into durable, option-linked `Claim`
   * records (via real `append()`ed `evidence.accepted` events -- the one
   * `CaseEvent` variant that can carry a `Claim`, per `events.ts`) whenever
   * `input.obligationId` is supplied. `Claim.obligationId`/
   * `EvidenceLink.obligationId` are both required fields on the canonical
   * storage records (`case.ts`, not owned by this module) -- linking a
   * claim to live evidence genuinely requires knowing which obligation it
   * addresses, and nothing about a bare `statement` + `appliesToEntityIds`
   * pair can honestly supply that on its own. When `obligationId` is
   * absent, claim linkage is skipped but the source itself still persists
   * -- an honest degradation (the activity summary below says exactly how
   * many claims went unlinked and why), never a silent drop.
   *
   * One `Claim` per (claim x entityId) pair: `appliesToEntityIds` may name
   * several options, and `Claim.entityId` is singular, so each named
   * option gets its own genuinely option-linked record. A claim with an
   * empty `appliesToEntityIds` still produces one `Claim`, with `entityId`
   * omitted -- a case-general finding, durable but honestly not
   * option-linked (never fabricating an entity link the caller did not
   * supply).
   *
   * Deliberately does NOT also synthesize a stronger evidence signal than
   * the data supports: `evidence.ts`'s own `achievedEvidenceLevel` doc
   * comment states "a Claim alone (no corroborating EvidenceLink) can only
   * ever establish E0 -- unverified statement or user-provided assertion",
   * which is exactly the right strength for a raw, freshly-submitted,
   * `unverified` source's claim (§27: "Submission does not automatically
   * make a source trusted"). The paired `EvidenceLink` this method creates
   * per claim is therefore tagged `level: 'E0'`, `verdict: 'pass'`
   * (evidence-gathering genuinely succeeded; verdict is not a strength
   * signal -- level is), `disposition: 'included'` (the existing
   * `sift_set_evidence_disposition` command remains the only way to
   * exclude/question it later, per §27's "Existing source-challenge/
   * evidence rules remain authoritative"). `Claim.stance`/`confidence`
   * have no signal on the command input at all (`SourceClaimInputSchema`
   * carries only `statement`/`appliesToEntityIds`) -- `'neutral'`/`0.5` are
   * the deliberately noncommittal defaults: inventing a directional stance
   * or a confidence above the midpoint would assert a judgment about the
   * claim's truth or reliability that nothing in the input actually
   * supports.
   */
  submitSource(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SubmitSourceInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure('Invalid submitSource input.', formatZodIssues(parsed.error.issues));
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    if (
      input.obligationId !== undefined &&
      !snapshot.obligations.some((obligation) => obligation.id === input.obligationId)
    ) {
      return validationFailure(
        `Obligation "${input.obligationId}" was not found on case "${input.caseId}".`,
      );
    }

    const now = this.deps.clock.now();
    // Empty after normalisation means "this submission carried no usable
    // tag", which is the same fact as "no tags were supplied" -- recorded by
    // omitting the key rather than by storing `[]`, matching how every other
    // optional field on this record is written.
    const tags = normalizeSourceTags(input.source.tags ?? []);
    const source: Source = {
      id: this.deps.idGenerator.next('source'),
      url: input.source.url,
      title: input.source.title,
      ...(input.source.publisher !== undefined ? { publisher: input.source.publisher } : {}),
      ...(input.source.publishedAt !== undefined ? { publishedAt: input.source.publishedAt } : {}),
      retrievedAt: input.source.retrievedAt,
      ...(input.source.excerpt !== undefined ? { excerpt: input.source.excerpt } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      // `summaryFormat` describes how `summary` should be rendered, so it is
      // only carried when there is a summary for it to describe -- a stored
      // `summaryFormat: 'markdown'` with no text would tell a renderer to
      // parse nothing, and would read as a claim about content this source
      // does not have.
      ...(input.source.summary !== undefined
        ? {
            summary: input.source.summary,
            ...(input.source.summaryFormat !== undefined
              ? { summaryFormat: input.source.summaryFormat }
              : {}),
          }
        : {}),
      origin: 'user_submitted',
      verification: 'unverified',
      createdAt: now,
    };

    // The obligationId this submission targets, resolved once above.
    const obligationId = input.obligationId;
    let currentSequence = input.expectedSequence;
    let linkedClaimCount = 0;
    const unlinkedClaimCount = obligationId === undefined ? input.source.claims.length : 0;

    if (obligationId !== undefined && input.source.claims.length > 0) {
      const claimEvents: CaseEvent[] = [];
      for (const sourceClaim of input.source.claims) {
        const entityIds: readonly (string | undefined)[] =
          sourceClaim.appliesToEntityIds.length > 0 ? sourceClaim.appliesToEntityIds : [undefined];
        for (const entityId of entityIds) {
          const claim: Claim = {
            id: this.deps.idGenerator.next('claim'),
            obligationId,
            ...(entityId !== undefined ? { entityId } : {}),
            statement: sourceClaim.statement,
            stance: 'neutral',
            confidence: 0.5,
            sourceIds: [source.id],
            stale: false,
            createdAt: now,
          };
          const evidenceLink: EvidenceLink = {
            id: this.deps.idGenerator.next('evidence'),
            obligationId,
            claimId: claim.id,
            sourceId: source.id,
            level: 'E0',
            verdict: 'pass',
            disposition: 'included',
            summary: sourceClaim.statement,
            stale: false,
            createdAt: now,
            updatedAt: now,
          };
          currentSequence += 1;
          claimEvents.push({
            eventId: this.deps.idGenerator.next('event'),
            caseId: input.caseId,
            sequence: currentSequence,
            timestamp: now,
            commandId,
            type: 'evidence.accepted',
            payload: { evidenceLink, claim },
          });
          linkedClaimCount += 1;
        }
      }

      // Derived idempotency key, distinct from the exact `commandId` the
      // `updateSelection()` call below (and this method's own top-of-method
      // `checkIdempotent`) uses: both calls sharing the literal `commandId`
      // would make `updateSelection()` see this `append()` call's own
      // idempotency registration and answer 'duplicate' without ever
      // writing the source -- this method genuinely calls two different
      // store operations for one command, per `case-store.ts`'s own
      // `SelectionPatch` doc comment ("`submitSource`'s source record
      // itself (distinct from the `evidence.accepted` event(s) a
      // submission may *also* produce when it can be linked to an active
      // obligation -- `command-service.ts` calls both `append()` and
      // `updateSelection()` for that case)").
      const claimAppend = this.deps.caseStore.append(
        input.caseId,
        claimEvents,
        input.expectedSequence,
        { idempotency: { commandId: `${commandId}:claims`, commandName: 'submitSource' } },
      );
      if (claimAppend.status === 'conflict' || claimAppend.status === 'not_found') {
        return this.toReceipt(commandId, claimAppend);
      }
      currentSequence = claimAppend.snapshot.eventSequence;
    }

    const result = this.deps.caseStore.updateSelection(
      input.caseId,
      { sources: [...snapshot.sources, source] },
      currentSequence,
      now,
      { commandId, commandName: 'submitSource' },
    );
    if (result.status === 'applied') {
      const summaryParts = [`Submitted source "${source.title}".`];
      if (linkedClaimCount > 0) {
        summaryParts.push(
          `Linked ${linkedClaimCount} claim${linkedClaimCount === 1 ? '' : 's'} to obligation "${obligationId}".`,
        );
      }
      if (unlinkedClaimCount > 0) {
        summaryParts.push(
          `${unlinkedClaimCount} claim${unlinkedClaimCount === 1 ? '' : 's'} not linked: no obligationId was supplied.`,
        );
      }
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: summaryParts.join(' '),
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  setEvidenceDisposition(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SetEvidenceDispositionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid setEvidenceDisposition input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    const existing = snapshot.evidenceLinks.find((link) => link.id === input.evidenceId);
    if (existing === undefined) {
      return validationFailure(
        `Evidence "${input.evidenceId}" was not found on case "${input.caseId}".`,
      );
    }

    const now = this.deps.clock.now();
    const updatedLink: EvidenceLink = {
      ...existing,
      disposition: input.disposition,
      dispositionReason: input.reason,
      updatedAt: now,
    };

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'evidence.accepted',
        payload: { evidenceLink: updatedLink },
      },
    ];
    const invalidatesRecommendation =
      snapshot.recommendation !== null && snapshot.recommendation.status === 'ready';
    if (invalidatesRecommendation && snapshot.recommendation !== null) {
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 2,
        timestamp: now,
        commandId,
        type: 'recommendation.invalidated',
        payload: {
          recommendationId: snapshot.recommendation.id,
          reason: 'Evidence disposition changed.',
        },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'setEvidenceDisposition' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'evidence.accepted',
          phase: 'completed',
          summary: `Set evidence "${input.evidenceId}" disposition to "${input.disposition}".`,
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  requestRevision(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = RequestRevisionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid requestRevision input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    return this.applyProposalReview(
      commandId,
      {
        caseId: input.caseId,
        proposalId: input.proposalId,
        actor: 'human',
        decision: 'request_revision',
        instructions: input.instructions,
        expectedSequence: input.expectedSequence,
      },
      'requestRevision',
      commandOrigin,
    );
  }

  reviewProposal(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = ReviewProposalInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid reviewProposal input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    return this.applyProposalReview(commandId, parsed.data, 'reviewProposal', commandOrigin);
  }

  private applyProposalReview(
    commandId: string,
    input: ReviewProposalInput,
    commandName: string,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    let reviewed: CaseState;
    try {
      reviewed = reviewProposalDomain(snapshot, input, this.deps.clock);
    } catch (error) {
      if (error instanceof PolicyViolationError) {
        return policyFailure(error.message);
      }
      if (isSiftDomainError(error)) {
        return validationFailure(error.message);
      }
      throw error;
    }

    const proposal = reviewed.proposal;
    if (proposal === null) {
      // Unreachable: `reviewProposalDomain` only ever returns a `CaseState`
      // with a non-null `proposal` (it rejects, via a thrown error above,
      // every input that would leave one unset). Guarded defensively so
      // this function's return type stays exactly `CaseEvent` rather than
      // `CaseEvent | undefined`.
      throw new Error(
        'CommandService: reviewProposal produced a null proposal, which should be unreachable.',
      );
    }

    const now = this.deps.clock.now();
    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'proposal.reviewed',
        payload: { proposal },
      },
    ];

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName },
    });
    if (result.status === 'applied') {
      const summary =
        input.decision === 'approve'
          ? 'Proposal approved.'
          : input.decision === 'reject'
            ? 'Proposal rejected.'
            : 'Revision requested.';
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary,
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * Idempotency-key short-circuit, called as the *first* step of every
   * command method (after Zod validation, before `loadForMutation`).
   *
   * Real bug this fixes, worth documenting: a naive implementation checks
   * `expectedSequence` against the case's *current* sequence before ever
   * consulting the idempotency key. That ordering is wrong for any command
   * whose events actually advance `eventSequence` (i.e. every command
   * except the `updateSelection`-based ones, which never advance it at
   * all): a client retrying the exact same `commandId` after a successful
   * first attempt necessarily still carries the *original* (now stale)
   * `expectedSequence` -- the mutation this `commandId` already produced is
   * exactly what advanced the sequence past it. Checking `expectedSequence`
   * first would misclassify that retry as a `409 CONFLICT` instead of
   * replaying the original result, defeating the entire point of
   * idempotency-key deduplication. `CaseStore.append()`/`updateSelection()`
   * already get this ordering right internally (idempotency checked before
   * the sequence check, in the same transaction) -- this mirrors that same
   * ordering at the point *this* class decides whether to do any work at
   * all, via the read-only `CaseStore.peekIdempotent()`.
   */
  private checkIdempotent(commandId: string): ServiceResult<CommandReceipt> | undefined {
    const existing = this.deps.caseStore.peekIdempotent(commandId);
    if (existing === undefined) return undefined;
    const snapshot = this.deps.caseStore.load(existing.caseId);
    if (snapshot === undefined) {
      // Not reachable through any real `CaseStore` public API today: both
      // implementations' `resetDemo()` remove a case's idempotency records
      // together with the case itself (SQLite's `idempotency_keys.case_id`
      // foreign key cascades on delete; `MemoryCaseStore.resetDemo` mirrors
      // that). Kept as defense-in-depth against a future `CaseStore`
      // implementation that does not preserve this invariant.
      throw new Error(
        `CommandService: idempotency record for commandId "${commandId}" references case "${existing.caseId}", which no longer exists`,
      );
    }
    return ok({
      commandId,
      caseId: existing.caseId,
      acceptedSequence: existing.acceptedSequence,
      snapshot,
    });
  }

  /**
   * The case's PINNED pack (`CaseState.pack.id` + `.version`), which is the
   * only pack whose `extensionPolicy`/`criteria` policy may govern a write
   * to this case -- never `resolveLatestPack`'s newest installed version,
   * which could silently widen or narrow what a case already in flight
   * permits.
   *
   * Fails CLOSED, and loudly: a case whose pinned pack has vanished from the
   * registry is a real invariant violation (production wiring should make it
   * impossible), so this throws rather than returning a `ServiceFailure`.
   * That is deliberate on two counts. It surfaces as a `500 INTERNAL`
   * through `routes/commands.ts`'s error middleware, matching `@sift/core`'s
   * own thrown-`SiftDomainError` convention for invariant violations (see
   * `service-result.ts`'s header comment) -- and, critically, an
   * unresolvable pack can never be read as "no policy found, therefore
   * allowed". The alternative (treat a missing pack as permissive) would
   * make the policy gate below vanish exactly when the system is least sure
   * of itself.
   *
   * `methodName` keeps the pre-existing `updateCriteria` message text
   * byte-identical now that `defineCaseAttribute` shares this code path.
   */
  private requirePinnedPack(snapshot: CaseState, methodName: string): CompiledDecisionPack {
    const pack = this.deps.registry.get(snapshot.pack.id, snapshot.pack.version);
    if (pack === undefined) {
      throw new Error(
        `CommandService.${methodName}: pinned pack "${snapshot.pack.id}@${snapshot.pack.version}" is not present in the registry.`,
      );
    }
    return pack;
  }

  /**
   * Item 4's shared "does a `ready` recommendation actually depend on this"
   * predicate, used by `upsertOption` and `reviewCaseExtension`. Only an
   * `active` criterion's `appliesToAttribute` counts -- an `excluded`
   * criterion no longer participates in scoring
   * (`normalizeCriterionWeights`, `@sift/core`), so a value it once
   * referenced can no longer affect a recommendation, and a criterion with
   * no `appliesToAttribute` at all cannot name any `attributeIds` member by
   * construction. Deliberately does not consider pack-defined vs.
   * `custom.*` origin: a `Criterion.appliesToAttribute` referencing either
   * kind of attribute id means the recommendation depends on it exactly
   * the same way.
   */
  private criteriaDependOnAttributes(
    criteria: readonly Criterion[],
    attributeIds: ReadonlySet<string>,
  ): boolean {
    return criteria.some(
      (criterion) =>
        criterion.status === 'active' &&
        criterion.appliesToAttribute !== undefined &&
        attributeIds.has(criterion.appliesToAttribute),
    );
  }

  /**
   * Item 2's "existing sourced value" signal for
   * `criterionNeedsEvidenceQuestion` (`@sift/core`'s `criteria.ts`): does
   * any entity on this case already carry a *sourced* value for the
   * criterion's linked attribute? Requires both a real value
   * (`status !== 'unknown'`) and at least one `sourceIds` entry --
   * "sourced" means backed by a source, not merely present; an `asserted`
   * value with no `sourceIds` (a plain user-typed figure with no citation)
   * does not count as already having answered the question a newly-added
   * criterion is asking. Returns an empty array (not a false-`hasSourced
   * Value` entry) when the criterion has no `appliesToAttribute` at all --
   * `criterionNeedsEvidenceQuestion` already treats that case as "always
   * needs one" without consulting `existingEvidence`.
   */
  private existingEvidenceSignal(
    criterion: Criterion,
    snapshot: CaseState,
  ): ExistingEvidenceSignal[] {
    if (criterion.appliesToAttribute === undefined) {
      return [];
    }
    const attributeDefinitionId = criterion.appliesToAttribute;
    const hasSourcedValue = snapshot.entities.some((entity) => {
      const record = entity.attributes[attributeDefinitionId];
      return record !== undefined && record.status !== 'unknown' && record.sourceIds.length > 0;
    });
    return [{ attributeDefinitionId, hasSourcedValue }];
  }

  /**
   * Item 2: synthesizes the case-scoped `ObligationTemplate` a newly-added
   * criterion that needs evidence gets folded into, via the real
   * `@sift/core` `deriveObligations` -- this method only builds the
   * template data that function expects as input; it does not reimplement
   * `deriveObligations` or `criterionNeedsEvidenceQuestion` themselves.
   *
   * pack-authoring.md: "Each pack declares a `userConcern` obligation
   * template ... a case-specific obligation such as
   * `case.<caseId>.dog-crate-fit`." In the current schema,
   * `extensionPolicy.userConcernTemplateId`
   * (`packages/contracts/src/packs.ts`) is only a reserved id namespace --
   * `packages/packs/src/compiler.ts`'s own "Step 8" comment confirms it
   * exists purely to avoid colliding with a real declared obligation id,
   * not to look up actual template content (label/priority/evidence
   * level/...). No pack manifest in this codebase carries such content
   * anywhere. This method therefore synthesizes a template generically,
   * the same pattern `apps/agent/src/runtime/car-purchase-scenario.ts`'s
   * `dogCrateObligationTemplate()` already uses for its one hand-tuned
   * case, made generic here so it applies to any newly-added criterion in
   * any pack, not one hardcoded car-purchase concern.
   *
   * Judgment calls, each chosen to avoid fabricating a signal the
   * criterion itself does not carry:
   *  - `id`: `` `case.${criterion.id}` `` -- matches the exact convention
   *    already live in this codebase
   *    (`apps/agent/src/runtime/scripted-beats/car-purchase.ts`'s
   *    `DOG_CRATE_FIT_OBLIGATION_ID = 'case.custom.dog_crate_fit'`), which
   *    omits the case id pack-authoring.md's own illustrative example
   *    includes -- criterion ids are already unique within one case
   *    (`addCriterion` rejects a duplicate id), so this stays unique
   *    without it, and staying byte-identical to the live convention means
   *    a criterion this method and that hand-tuned demo code both touch
   *    (e.g. `custom.dog_crate_fit`) converge on the SAME obligation record
   *    rather than producing a confusing duplicate.
   *  - `label`/`question`: taken directly from the criterion (`question`
   *    falls back to a generic phrasing built from the label when the
   *    criterion itself was added with none, since
   *    `ObligationTemplateSchema.question` is required but
   *    `CriterionAddInput.question` is optional).
   *  - `priority`: the criterion's own `weight` (both 0-100 scales already
   *    express "how much this matters"), tying a case-derived obligation's
   *    urgency to what the caller who added the criterion said mattered,
   *    rather than an arbitrary constant.
   *  - `requiredEvidenceLevel`/`completionRule.minimumEvidenceLevel: 'E1'`:
   *    the weakest level that still requires an actual source --
   *    appropriate for a concern the pack never anticipated and has no
   *    specialist wired to investigate.
   *  - `maxAttempts: 2`: docs/engineering-principles.md's own canonical GoalLoop bound
   *    ("GoalLoop with a callable recommendation validator and
   *    `maxAttempts: 2`"), and the same value every existing
   *    case-extension template in this codebase already uses
   *    (`dogCrateObligationTemplate`, the `apartment-hunt-extension.test.ts`
   *    fixture).
   *  - `acceptedUncertaintyAllowed: true` (both here and on
   *    `completionRule`): an unanticipated, case-scoped concern may have no
   *    installed skill/specialist able to resolve it at all
   *    (packs-and-routing.md: "Unsupported concerns remain explicit
   *    unknowns"); blocking the case indefinitely on it would contradict
   *    that.
   *  - `preferredSkills`/`preferredSpecialists: []`: this method has no way
   *    to know which installed skill/specialist (if any) can investigate an
   *    arbitrary new criterion in an arbitrary pack -- leaving both empty
   *    is the honest choice over guessing one that might not exist,
   *    matching how `apartment-hunt-extension.test.ts`'s own fixture treats
   *    the identical "no installed skill/specialist can investigate this"
   *    case.
   *  - `dependsOn: []`, `category: 'user_concern'`, `required: true`,
   *    `completionRule.minimumIndependentSources: 0`: no signal exists to
   *    derive any of these from a bare `Criterion`, so each takes the same
   *    fixed value every existing case-extension template in this codebase
   *    already uses.
   */
  private synthesizeUserConcernObligationTemplate(criterion: Criterion): ObligationTemplate {
    return {
      id: `case.${criterion.id}`,
      label: criterion.label,
      question: criterion.question ?? `What should be established about "${criterion.label}"?`,
      category: 'user_concern',
      required: true,
      priority: criterion.weight,
      requiredEvidenceLevel: 'E1',
      maxAttempts: 2,
      acceptedUncertaintyAllowed: true,
      dependsOn: [],
      preferredSkills: [],
      preferredSpecialists: [],
      completionRule: {
        minimumEvidenceLevel: 'E1',
        minimumIndependentSources: 0,
        acceptedUncertaintyAllowed: true,
      },
      origin: 'case_extension',
    };
  }

  private loadForMutation(caseId: string, expectedSequence: number): ServiceResult<CaseState> {
    const snapshot = this.deps.caseStore.load(caseId);
    if (snapshot === undefined) {
      return notFound(`Case "${caseId}" was not found.`);
    }
    if (snapshot.eventSequence !== expectedSequence) {
      return conflict(
        'The case has advanced since expectedSequence was read; refresh and retry.',
        expectedSequence,
        snapshot.eventSequence,
        snapshot,
      );
    }
    return ok(snapshot);
  }

  /**
   * `loadForMutation`'s counterpart for the few commands whose effect no other
   * event can invalidate. Named for what it asserts, and used by exactly two
   * commands today (`addNote`, `setCandidateDisposition`) -- each with its own
   * justification recorded at its call site.
   *
   * --- Why a second rule exists at all ---
   *
   * `expectedSequence` "exists so a mutation can be rejected when it was
   * written against a stale view" (docs/specs/webmcp.md "Cancellation and
   * concurrency"). `loadForMutation` implements that as case-wide equality,
   * which conflates two different things: a competing WRITE to what this
   * command is changing, and a BYSTANDER event that merely moved the case's
   * counter. That conflation was harmless while a run drained its events in
   * one burst at the end. It is not harmless now: the runtime streams events
   * as the graph progresses, so an ordinary investigation advances the case
   * steadily for several seconds, and a person who presses a button during
   * that window gets a hard refusal caused by work they were only watching.
   *
   * The client cannot close this window, and it is worth being precise about
   * why rather than adding retries until it looks closed. A browser learns
   * that the case moved from the SSE activity stream, whose `sequence` is "a
   * wholly separate monotonic counter from `CaseEvent.sequence`"
   * (`store/activity-store.ts`), so it must re-read the canonical snapshot to
   * learn the real number -- and between that read and the command arriving
   * here, the run can append again. `apps/web`'s `resolveEventSequence`
   * narrows that window to network latency and removes the great majority of
   * these refusals; it cannot remove the last of them, because no read
   * performed before a request can describe the state at the moment the
   * request lands. A guard that a correct client cannot satisfy is not
   * protecting anything -- it is just intermittently failing.
   *
   * --- What this rule actually permits ---
   *
   * Only being BEHIND. A caller may present a sequence the case has already
   * passed; it may never present one the case has not reached, which is not a
   * stale read but a wrong one (a fabricated sequence, or a request aimed at a
   * different case's history), and still conflicts.
   *
   * Everything else stays exactly as strict as it was. This is not a relaxed
   * default: every other command still goes through `loadForMutation`, and
   * adding a command here requires showing that its effect depends on no case
   * state a bystander event could change. A command that reads the case to
   * decide what to write -- `reviewProposal` acting on a proposal,
   * `setEvidenceDisposition` judging a specific finding, `updateCriteria`
   * reweighting a set it just read, `upsertOption`/`setOptionAttribute`
   * writing a field another writer may also be writing -- does not qualify
   * and must keep the strict check.
   *
   * The returned snapshot is the CURRENT one, so the handler validates and
   * derives against present state; its caller must append at
   * `snapshot.eventSequence` rather than at the caller's own stale
   * `expectedSequence`. `CaseStore.append` still performs its own atomic
   * check-and-write inside the transaction, so a genuine interleaving between
   * this load and that append is still refused.
   */
  private loadForIndependentMutation(
    caseId: string,
    expectedSequence: number,
  ): ServiceResult<CaseState> {
    const snapshot = this.deps.caseStore.load(caseId);
    if (snapshot === undefined) {
      return notFound(`Case "${caseId}" was not found.`);
    }
    if (expectedSequence > snapshot.eventSequence) {
      return conflict(
        'expectedSequence is ahead of this case; refresh and retry.',
        expectedSequence,
        snapshot.eventSequence,
        snapshot,
      );
    }
    return ok(snapshot);
  }

  private toReceipt(commandId: string, result: AppendResult): ServiceResult<CommandReceipt> {
    switch (result.status) {
      case 'applied':
        return ok({
          commandId,
          caseId: result.snapshot.id,
          acceptedSequence: result.snapshot.eventSequence,
          snapshot: result.snapshot,
        });
      case 'duplicate':
        return ok({
          commandId,
          caseId: result.snapshot.id,
          acceptedSequence: result.acceptedSequence,
          snapshot: result.snapshot,
        });
      case 'conflict':
        return conflict(
          'The case has advanced since expectedSequence was read; refresh and retry.',
          result.expectedSequence,
          result.actualSequence,
          result.snapshot,
        );
      case 'not_found':
        return notFound('Case was not found.');
    }
  }

  // --- Adaptive discovery commands ---
  //
  // Each of these validates against the case's *pinned pack* before writing.
  // That is the check a schema cannot make: `UpdateDiscoveryInputSchema`
  // knows an agent may not confirm, but only the pack knows whether
  // `car.payload` is a topic at all, and only the case's own answers know
  // whether it applies here. A model writing to a topic nobody was ever
  // shown is exactly the failure this layer exists to stop.

  updateDiscovery(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = UpdateDiscoveryInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid updateDiscovery input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;
    const pack = this.requirePinnedPack(snapshot, 'updateDiscovery');

    const declared = new Map((pack.discovery?.topics ?? []).map((t) => [t.id, t]));
    const applicable = new Map(
      compileDiscoveryTopics(snapshot, pack).map((topic) => [topic.topicId, topic]),
    );
    const now = this.deps.clock.now();
    const existing = new Map(
      (snapshot.discovery?.topics ?? []).map((topic) => [topic.topicId, topic]),
    );

    const events: CaseEvent[] = [];
    let sequence = snapshot.eventSequence;

    for (const operation of input.operations) {
      const template = declared.get(operation.topicId);
      if (template === undefined) {
        return validationFailure(
          `Topic "${operation.topicId}" is not declared by pack "${snapshot.pack.id}".`,
        );
      }
      if (!applicable.has(operation.topicId)) {
        return validationFailure(
          `Topic "${operation.topicId}" does not apply to this case, so it was never asked.`,
        );
      }

      const prior = existing.get(operation.topicId);
      if (input.actor !== 'human' && prior?.humanConfirmed === true) {
        return validationFailure(
          `Topic "${operation.topicId}" was confirmed by a person and cannot be changed by an agent.`,
        );
      }

      if (operation.op === 'defer' && template.necessity === 'required') {
        // Only standalone may defer, and only a soft topic. A required
        // conversational topic has no skip -- that is the rule that stops
        // discovery being short-circuited into search.
        return validationFailure(
          `Topic "${operation.topicId}" is required and cannot be deferred.`,
        );
      }

      const base = {
        topicId: operation.topicId,
        label: template.label,
        necessity: template.necessity,
        updatedAt: now,
      } as const;

      let topic: DiscoveryTopicState;
      let cause: 'response' | 'confirmation' | 'correction' | 'proposal';
      switch (operation.op) {
        case 'confirm':
        case 'correct': {
          topic = {
            ...base,
            status: 'confirmed',
            valueSummary: operation.valueSummary,
            ...(operation.importance === undefined ? {} : { importance: operation.importance }),
            origin: 'user',
            humanConfirmed: true,
          };
          cause = operation.op === 'confirm' ? 'confirmation' : 'correction';
          break;
        }
        case 'propose': {
          topic = {
            ...base,
            status: 'inferred_pending',
            valueSummary: operation.valueSummary,
            // A model-proposed blocker is recorded one tier down. The need
            // stays visible; it cannot remove options until confirmed.
            ...(operation.importance === undefined
              ? {}
              : {
                  importance:
                    operation.importance === 'must_work'
                      ? 'needs_verification'
                      : operation.importance,
                }),
            origin: 'model',
            confidence: operation.confidence,
            humanConfirmed: false,
          };
          cause = 'proposal';
          break;
        }
        case 'defer': {
          topic = { ...base, status: 'deferred', origin: 'user', humanConfirmed: false };
          cause = 'response';
          break;
        }
        case 'not_applicable': {
          topic = {
            ...base,
            status: 'not_applicable',
            valueSummary: operation.reason,
            origin: 'user',
            humanConfirmed: true,
          };
          cause = 'confirmation';
          break;
        }
        case 'reject_inference': {
          topic = { ...base, status: 'unknown', origin: 'user', humanConfirmed: false };
          cause = 'correction';
          break;
        }
      }

      sequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence,
        timestamp: now,
        commandId,
        type: 'discovery.topic_updated',
        payload: { topic, cause },
      });
    }

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'updateDiscovery' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `Updated ${String(input.operations.length)} discovery topic(s).`,
        },
        commandOrigin,
      );
      // One revision per command, triggered by the first topic touched. A
      // command carrying several operations is one human action, and
      // reporting it as several separate causes would overstate what
      // happened.
      const firstTopicId = input.operations[0]?.topicId;
      if (firstTopicId !== undefined) {
        const topicLabel = (pack.discovery?.topics ?? []).find(
          (template) => template.id === firstTopicId,
        )?.label;
        notifyRunPlan(this.deps, input.caseId, {
          reason: 'discovery_changed',
          trigger: firstTopicId,
          ...(topicLabel !== undefined ? { triggerLabel: topicLabel } : {}),
        });
      }
    }
    return this.toReceipt(commandId, result);
  }

  requestInteraction(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = RequestInteractionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid requestInteraction input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;
    const pack = this.requirePinnedPack(snapshot, 'requestInteraction');

    const applicable = new Set(
      compileDiscoveryTopics(snapshot, pack).map((topic) => topic.topicId),
    );
    for (const topicId of input.interaction.topicIds) {
      if (!applicable.has(topicId)) {
        return validationFailure(
          `Interaction targets topic "${topicId}", which this case does not ask.`,
        );
      }
    }

    const allowed = new Map((pack.discovery?.topics ?? []).map((t) => [t.id, t]));
    for (const topicId of input.interaction.topicIds) {
      const template = allowed.get(topicId);
      if (
        template !== undefined &&
        !template.allowedInteractions.includes(input.interaction.kind)
      ) {
        return validationFailure(
          `Topic "${topicId}" does not allow a "${input.interaction.kind}" interaction.`,
        );
      }
    }

    const now = this.deps.clock.now();
    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'discovery.interaction_requested',
        payload: { interaction: input.interaction },
      },
    ];

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'requestInteraction' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Asked a question in the pane.',
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  submitInteractionResponse(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SubmitInteractionResponseInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid submitInteractionResponse input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;
    const pack = this.requirePinnedPack(snapshot, 'submitInteractionResponse');

    const actor = input.response.respondedBy === 'human' ? 'human' : 'agent';
    const now = this.deps.clock.now();
    const plan = planDiscoveryResponse(snapshot, input.response, actor, pack, now);

    // A rejected mapping is reported, never silently dropped: a person needs
    // to know their answer did not land, and a model needs to know why.
    if (plan.rejected.length > 0) {
      return validationFailure(
        `Response mapping(s) rejected: ${plan.rejected
          .map((rejection) => `${rejection.topicId} (${rejection.reason})`)
          .join(', ')}.`,
      );
    }

    let sequence = snapshot.eventSequence;
    const events: CaseEvent[] = [];
    for (const topic of plan.updatedTopics) {
      sequence += 1;
      events.push({
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence,
        timestamp: now,
        commandId,
        type: 'discovery.topic_updated',
        payload: { topic, cause: 'response' },
      });
    }
    sequence += 1;
    events.push({
      eventId: this.deps.idGenerator.next('event'),
      caseId: input.caseId,
      sequence,
      timestamp: now,
      commandId,
      type: 'discovery.interaction_answered',
      payload: { response: input.response },
    });

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'submitInteractionResponse' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary: `Answered a question, filling ${String(plan.updatedTopics.length)} topic(s).`,
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  setCandidateDisposition(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = SetCandidateDispositionInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid setCandidateDisposition input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    // Sequence-independent (see `loadForIndependentMutation`), and the one
    // command where the strict rule was actively harmful: Quick Pick triage
    // is what a person does WHILE an investigation streams, and a refusal
    // here is swallowed by design on the client (`App.tsx`'s
    // `handleQuickPickDisposition`), so the strict check turned a bystander
    // event into a judgment that silently vanished.
    //
    // It qualifies on its own terms, not merely because failing was ugly.
    // The command carries the COMPLETE desired value of one entity's own
    // disposition field rather than a delta, so nothing about it is computed
    // from a view that could have gone stale; disposition is last-writer-wins
    // per candidate by construction (undo is expressed as another forward
    // command, `unreviewed`, precisely so the history of what someone
    // considered survives); and a person saying "keep looking at this one" is
    // an act of authority over their own triage, not a claim about facts that
    // new evidence could contradict. `previousDisposition` below is derived
    // from the snapshot handed back here -- the CURRENT one -- so a caller
    // that is behind produces a MORE accurate record than a stale read would,
    // not a less accurate one.
    const loaded = this.loadForIndependentMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;

    if (!snapshot.entities.some((entity) => entity.id === input.entityId)) {
      return validationFailure(
        `Candidate "${input.entityId}" was not found on case "${input.caseId}".`,
      );
    }

    const previous =
      snapshot.discovery?.dispositions.find((record) => record.entityId === input.entityId)
        ?.disposition ?? 'unreviewed';

    const now = this.deps.clock.now();
    const record: CandidateDispositionRecord = {
      entityId: input.entityId,
      disposition: input.disposition,
      previousDisposition: previous,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      decidedAt: now,
    };

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'candidate.disposition_set',
        payload: { disposition: record },
      },
    ];

    // See `addNote`'s matching comment: the caller may be behind, so the
    // append is anchored to the snapshot these events were numbered from.
    const result = this.deps.caseStore.append(input.caseId, events, snapshot.eventSequence, {
      idempotency: { commandId, commandName: 'setCandidateDisposition' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary:
            input.disposition === 'unreviewed'
              ? 'Undid a Quick Pick decision.'
              : `Marked a candidate "${input.disposition}".`,
        },
        commandOrigin,
      );
      // Triage is the authorization deep work depends on, so this is the
      // command that most often changes what Sift should be doing next.
      //
      // The label comes from the entity, not the id: the resulting
      // `plan.revised` summary is consumer-visible copy, and a raw entity
      // id there would break the same rule every activity label follows.
      const candidateLabel = snapshot.entities.find(
        (entity) => entity.id === input.entityId,
      )?.label;
      notifyRunPlan(this.deps, input.caseId, {
        reason: 'triage_changed',
        trigger: input.entityId,
        ...(candidateLabel !== undefined ? { triggerLabel: candidateLabel } : {}),
      });
    }
    return this.toReceipt(commandId, result);
  }

  completeBlindSpotReview(
    commandId: string,
    rawInput: unknown,
    commandOrigin?: CommandOrigin,
  ): ServiceResult<CommandReceipt> {
    const parsed = CompleteBlindSpotReviewInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return validationFailure(
        'Invalid completeBlindSpotReview input.',
        formatZodIssues(parsed.error.issues),
      );
    }
    const input = parsed.data;

    const duplicate = this.checkIdempotent(commandId);
    if (duplicate !== undefined) return duplicate;

    const loaded = this.loadForMutation(input.caseId, input.expectedSequence);
    if (loaded.status !== 'ok') return loaded;
    const snapshot = loaded.value;
    const pack = this.requirePinnedPack(snapshot, 'completeBlindSpotReview');

    const declared = new Set((pack.discovery?.blindSpots ?? []).map((prompt) => prompt.id));
    for (const promptId of input.offeredPromptIds) {
      if (!declared.has(promptId)) {
        return validationFailure(
          `Blind-spot prompt "${promptId}" is not declared by pack "${snapshot.pack.id}".`,
        );
      }
    }

    const now = this.deps.clock.now();
    const review: BlindSpotReviewState = {
      status: 'complete',
      offeredPromptIds: input.offeredPromptIds,
      selectedPromptIds: input.selectedPromptIds,
      acknowledgedAt: now,
    };

    const events: CaseEvent[] = [
      {
        eventId: this.deps.idGenerator.next('event'),
        caseId: input.caseId,
        sequence: snapshot.eventSequence + 1,
        timestamp: now,
        commandId,
        type: 'discovery.blind_spot_reviewed',
        payload: { review },
      },
    ];

    const result = this.deps.caseStore.append(input.caseId, events, input.expectedSequence, {
      idempotency: { commandId, commandName: 'completeBlindSpotReview' },
    });
    if (result.status === 'applied') {
      this.emitActivity(
        {
          timestamp: now,
          caseId: input.caseId,
          commandId,
          type: 'command.accepted',
          phase: 'completed',
          summary:
            input.selectedPromptIds.length === 0
              ? 'Completed the blind-spot review with nothing to add.'
              : `Completed the blind-spot review, raising ${String(input.selectedPromptIds.length)} concern(s).`,
        },
        commandOrigin,
      );
    }
    return this.toReceipt(commandId, result);
  }

  /**
   * `commandOrigin` (I1: WebMCP call provenance -- ADR 0006 decision 8,
   * docs/specs/debugging-and-observability.md "WebMCP tool calls") is
   * folded into `safeDetails.origin` here, in this one place, rather than
   * at each of the ~14 call sites below -- `PublicActivityEventSchema`
   * (`@sift/contracts` events.ts, not owned by this task) already declares
   * `safeDetails: z.record(z.string(), JsonValueSchema).optional()`, so
   * recording the marker needs no schema change, no new column, and no
   * second activity-event shape. When `commandOrigin` is `undefined` (the
   * overwhelming majority of calls: every direct UI action, and every
   * caller written before this marker existed), `event` passes through
   * completely unchanged -- byte-identical to this method's pre-existing
   * behavior, which is the whole point: this field changes what gets
   * *recorded*, never what a command *does* (see this file's header
   * comment and `packages/contracts/src/http.ts`'s `CommandOrigin` doc
   * comment for why it is never trusted for an authorization decision).
   */
  private emitActivity(
    event: Omit<PublicActivityEvent, 'sequence' | 'eventId' | 'schemaVersion'>,
    commandOrigin?: CommandOrigin,
  ): void {
    this.deps.activityStore.append(
      commandOrigin === undefined
        ? event
        : { ...event, safeDetails: { ...event.safeDetails, origin: commandOrigin } },
    );
  }
}
