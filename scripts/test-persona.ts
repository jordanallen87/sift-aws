#!/usr/bin/env tsx
/**
 * `pnpm test:persona` — the persona UX harness.
 *
 * Runs each persona's turns against the **real** stack in process: the real
 * compiled Decision Pack (Vehicle Selection or Bid Comparison, whichever the
 * persona names), the real `CommandService`, the real `RunPlanService`, real
 * SQLite, and the same `@sift/core` derivations the pane renders from.
 * Nothing here is a stand-in for a Sift component.
 *
 * ## The executor answers whatever Sift asks
 *
 * A persona turn says what the *person* would say ("Under about thirty-five
 * thousand"), not which topic id to write or what payload to send. The
 * executor resolves each turn against the case's current state: it asks
 * `deriveNextMoves` what Sift wants next and answers that.
 *
 * This is the design decision that makes the harness worth running. A
 * hard-coded input per turn would still pass if the pack started asking a
 * completely different set of questions — the script would answer the old
 * ones into the void. Answering whatever is actually asked means the
 * landscaping persona diverges from the family persona because the *pack's
 * conditional topics* diverge, not because two scripts differ.
 *
 * ## What this harness cannot see
 *
 * There is no browser here, so accessibility and console/network gates
 * report `not_evaluated` with a reason rather than `pass`. The end-to-end
 * journey supplies that evidence. A green report from this script means
 * "nine gates passed and two were not checked", and it says so.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CaseState,
  CompiledDecisionPack,
  NextMove,
  Persona,
  PersonaTurn,
} from '../packages/contracts/src/index.js';
import {
  deriveDecisionPhase,
  deriveDisplayedCoverage,
  deriveDiscoveryReadiness,
  deriveNextMoves,
  compileDiscoveryTopics,
  type Clock,
  type IdGenerator,
} from '../packages/core/src/index.js';
import {
  PackRegistry,
  compileCarPurchasePack,
  compileBidComparisonPack,
} from '../packages/packs/src/index.js';
import { PERSONAS } from '../packages/scenarios/fixtures/personas/index.js';
import {
  DIAGNOSTIC_PASS,
  DIAGNOSTIC_PASS_PROVENANCE,
} from '../packages/scenarios/fixtures/personas/diagnostics.js';
import {
  runPersona,
  type PersonaTurnExecutor,
  type PersonaTurnObservation,
} from '../packages/scenarios/src/persona-runner.js';
import { summarizeDiagnostics } from '../packages/scenarios/src/persona-diagnostics.js';
import { openDatabase } from '../apps/agent/src/db/connection.js';
import { applyMigrations } from '../apps/agent/src/db/migrate.js';
import { SqliteCaseStore } from '../apps/agent/src/store/sqlite-case-store.js';
import { SqliteActivityStore } from '../apps/agent/src/store/activity-store.js';
import { SqliteRunPlanStore } from '../apps/agent/src/store/run-plan-store.js';
import { CommandService } from '../apps/agent/src/services/command-service.js';
import { RunPlanService } from '../apps/agent/src/services/run-plan-service.js';
import { RunService, SqliteRunStore } from '../apps/agent/src/services/run-service.js';
import { carPurchaseCapabilityCatalog } from '../apps/agent/src/runtime/car-purchase-scenario.js';
import { bidComparisonCapabilityCatalog } from '../apps/agent/src/runtime/bid-comparison-engine.js';
import {
  buildCarPurchaseCandidateEntities,
  buildBidComparisonEntities,
  buildBidComparisonSources,
} from '../packages/scenarios/src/seeds.js';

const ARTIFACT_DIR = fileURLToPath(new URL('../artifacts/persona', import.meta.url));

/** Fixed clock and counter ids: two runs of the same persona must produce the same report. */
function deterministicPorts(): { clock: Clock; idGenerator: IdGenerator } {
  let tick = 0;
  return {
    clock: {
      now: () => {
        tick += 1;
        return new Date(Date.UTC(2026, 8, 2, 12, 0, tick)).toISOString();
      },
    },
    idGenerator: (() => {
      let counter = 0;
      return {
        next: (prefix?: string) => {
          counter += 1;
          return `${prefix ?? 'id'}-${String(counter).padStart(4, '0')}`;
        },
      };
    })(),
  };
}

interface Stack {
  readonly caseStore: SqliteCaseStore;
  readonly activityStore: SqliteActivityStore;
  readonly commandService: CommandService;
  readonly runService: RunService;
  readonly runPlanService: RunPlanService;
  readonly registry: PackRegistry;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  cleanup(): void;
}

function buildStack(): Stack {
  const dir = mkdtempSync(join(tmpdir(), 'sift-persona-'));
  const database = openDatabase(dir);
  applyMigrations(database.sqlite);

  const { clock, idGenerator } = deterministicPorts();
  const caseStore = new SqliteCaseStore(database);
  const activityStore = new SqliteActivityStore(database);
  const registry = new PackRegistry();
  registry.register(compileCarPurchasePack(carPurchaseCapabilityCatalog(), clock));
  registry.register(compileBidComparisonPack(bidComparisonCapabilityCatalog(), clock));

  const runPlanService = new RunPlanService({
    caseStore,
    planStore: new SqliteRunPlanStore(database),
    activityStore,
    registry,
    clock,
    idGenerator,
  });
  const commandService = new CommandService({
    caseStore,
    activityStore,
    registry,
    clock,
    idGenerator,
    runPlanRevisor: runPlanService,
    // Wired exactly as `server.ts` wires it. Without this a demo case has
    // no candidates at all, and every triage turn in every persona was a
    // silent no-op -- which is how a completely stuck family journey
    // reported PASS on its first run.
    demoSeedEntities: {
      'car-purchase': buildCarPurchaseCandidateEntities,
      'bid-comparison': buildBidComparisonEntities,
    },
    // Wired exactly as `server.ts` wires it. `buildBidComparisonEntities`
    // cites `sourceIds` on every attribute it seeds; without this, those
    // citations dangle on a freshly started `bid-comparison` demo case
    // (`CaseState.sources` stays `[]`) -- see `command-service.ts`'s own
    // `demoSeedSources` doc comment.
    demoSeedSources: { 'bid-comparison': buildBidComparisonSources },
  });

  const runService = new RunService({
    caseStore,
    activityStore,
    runStore: new SqliteRunStore(database),
    clock,
    idGenerator,
    runPlanService,
  });

  return {
    caseStore,
    activityStore,
    commandService,
    runService,
    runPlanService,
    registry,
    clock,
    idGenerator,
    cleanup: () => {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The controls a person can genuinely press right now, derived from the real next moves. */
function visibleControlsFor(moves: readonly NextMove[]): string[] {
  return moves.slice(0, 2).map((move) => move.label);
}

/**
 * One line per meaningful change between two snapshots.
 *
 * Every gate that asks "did anything happen" reads this, so an incomplete
 * diff makes those gates unreliable in the most dangerous direction: it
 * reports a working turn as a stall, and — worse — would report a
 * fabricated-progress turn as fine. The first version covered topics,
 * dispositions, entities and obligations only, which made
 * `completeBlindSpotReview` and `defineCaseAttribute` look like no-ops when
 * they had both worked.
 */
function diffSnapshots(before: CaseState | undefined, after: CaseState | undefined): string[] {
  if (after === undefined) return [];
  const lines: string[] = [];

  if (before === undefined) {
    // The case did not exist a moment ago. That is the largest change a
    // turn can make, and reporting it as "nothing happened" was the first
    // false stall this gate found.
    lines.push(`case ${after.id} created against pack ${after.pack.id}`);
    for (const entity of after.entities) lines.push(`option ${entity.id} seeded`);
    for (const obligation of after.obligations) lines.push(`concern ${obligation.id} seeded`);
    return lines;
  }

  const beforeTopics = new Map(
    (before.discovery?.topics ?? []).map((topic) => [topic.topicId, topic]),
  );
  for (const topic of after.discovery?.topics ?? []) {
    const previous = beforeTopics.get(topic.topicId);
    if (previous?.status !== topic.status) {
      lines.push(
        `topic ${topic.topicId} -> ${topic.status} (origin: ${topic.origin})` +
          (topic.importance === undefined ? '' : ` importance ${topic.importance}`),
      );
    }
  }

  const beforeReview = before.discovery?.blindSpotReview.status;
  const afterReview = after.discovery?.blindSpotReview.status;
  if (beforeReview !== afterReview && afterReview !== undefined) {
    lines.push(`blind-spot review -> ${afterReview}`);
  }

  const beforeDispositions = new Map(
    (before.discovery?.dispositions ?? []).map((record) => [record.entityId, record.disposition]),
  );
  for (const record of after.discovery?.dispositions ?? []) {
    if (beforeDispositions.get(record.entityId) !== record.disposition) {
      lines.push(`candidate ${record.entityId} -> ${record.disposition}`);
    }
  }

  const beforeEntities = new Set(before.entities.map((entity) => entity.id));
  for (const entity of after.entities) {
    if (!beforeEntities.has(entity.id)) lines.push(`option ${entity.id} added`);
  }

  const beforeObligations = new Set(before.obligations.map((obligation) => obligation.id));
  for (const obligation of after.obligations) {
    if (!beforeObligations.has(obligation.id)) lines.push(`concern ${obligation.id} added`);
  }

  const beforeAttributes = new Set(before.attributeDefinitions.map((entry) => entry.id));
  for (const definition of after.attributeDefinitions) {
    if (!beforeAttributes.has(definition.id)) lines.push(`attribute ${definition.id} defined`);
  }

  const beforeExtensions = new Set(before.caseExtensions.map((entry) => entry.definition.id));
  for (const extension of after.caseExtensions) {
    if (!beforeExtensions.has(extension.definition.id)) {
      lines.push(`case concern ${extension.definition.id} proposed`);
    }
  }

  const beforeCriteria = new Set(before.criteria.map((entry) => entry.id));
  for (const criterion of after.criteria) {
    if (!beforeCriteria.has(criterion.id)) lines.push(`criterion ${criterion.id} added`);
  }

  if (before.status !== after.status) lines.push(`case status -> ${after.status}`);
  if (before.recommendation?.status !== after.recommendation?.status) {
    lines.push(`recommendation -> ${String(after.recommendation?.status ?? 'none')}`);
  }

  return lines;
}

/**
 * The value a person's answer actually records.
 *
 * A topic with option seeds is a topic where a person picks a choice, and
 * the choice carries a canonical token (`family`, `business`) that the
 * pack's conditional topics match on. Writing the person's prose into
 * `valueSummary` instead meant `conditionMet` never matched, so the
 * landscaping journey silently received the *family* question set —
 * identical to the family journey, which is precisely what that persona
 * exists to disprove. The persona-set test passed anyway, because it
 * compared the personas' utterances rather than the questions Sift asked.
 *
 * Matching is deliberately dumb: a seed applies when its label or its value
 * appears in what the person said. Anything cleverer would be this harness
 * inventing comprehension the product does not have.
 */
function answerValueFor(
  template: {
    optionSeeds: readonly { label: string; valueSummary: string }[];
    escapeHatches: { allowCustom: boolean };
    id: string;
  },
  utterance: string | undefined,
  personaId: string,
): string {
  const said = (utterance ?? '').toLowerCase();
  const seed = template.optionSeeds.find(
    (option) =>
      said.includes(option.valueSummary.toLowerCase()) || said.includes(option.label.toLowerCase()),
  );
  if (seed !== undefined) return seed.valueSummary;
  if (template.optionSeeds.length > 0 && !template.escapeHatches.allowCustom) {
    throw new Error(
      `Persona "${personaId}" answered "${utterance ?? ''}" for topic "${template.id}", which offers only ` +
        `${template.optionSeeds.map((option) => option.valueSummary).join(', ')} and allows no custom answer.`,
    );
  }
  return utterance ?? 'Answered during the persona run';
}

class RealPersonaExecutor implements PersonaTurnExecutor {
  readonly browserEvidence = false;
  private caseIdValue = '';
  private commandCounter = 0;

  constructor(
    private readonly stack: Stack,
    private readonly persona: Persona,
  ) {}

  caseId(): string {
    return this.caseIdValue;
  }

  knownEntityLabels(): readonly string[] {
    const snapshot = this.snapshot();
    return snapshot === undefined ? [] : snapshot.entities.map((entity) => entity.label);
  }

  private snapshot(): CaseState | undefined {
    return this.caseIdValue === '' ? undefined : this.stack.caseStore.load(this.caseIdValue);
  }

  private nextCommandId(): string {
    this.commandCounter += 1;
    return `persona-${this.persona.id}-${String(this.commandCounter).padStart(3, '0')}`;
  }

  execute(turn: PersonaTurn, index: number): Promise<PersonaTurnObservation> {
    const started = Date.now();
    const before = this.snapshot();
    const activityBefore =
      this.caseIdValue === '' ? 0 : this.stack.activityStore.latestSequence(this.caseIdValue);
    const planVersionBefore =
      this.caseIdValue === ''
        ? undefined
        : this.stack.runPlanService.currentPlan(this.caseIdValue)?.version;

    const tools = this.applyTurn(turn, index);

    const after = this.snapshot();
    if (after === undefined) {
      throw new Error(
        `Persona "${this.persona.id}" turn ${String(index)} ("${turn.label}") left no case to observe.`,
      );
    }
    const pack = this.stack.registry.get(after.pack.id, after.pack.version);
    if (pack === undefined) {
      throw new Error(`Pinned pack "${after.pack.id}" is not registered.`);
    }

    const displayedCoverage = deriveDisplayedCoverage(after, pack);
    const moves = deriveNextMoves(after, pack);
    const firstMove = moves[0];
    const plan = this.stack.runPlanService.currentPlan(after.id);
    const events = this.stack.activityStore
      .replayFrom(after.id, activityBefore)
      .map((event) => `${event.type}: ${event.summary}`);

    return Promise.resolve({
      // No `reply`: this harness runs Sift, not ChatGPT, so no turn here
      // produces model-authored prose. An absent field is the honest
      // record; putting the next-move label here would have made the
      // unsupported-claim gate check Sift's own button text.
      chat: {
        ...(turn.utterance !== undefined ? { utterance: turn.utterance } : {}),
      },
      tools,
      sequenceBefore: before?.eventSequence ?? 0,
      sequenceAfter: after.eventSequence,
      // A turn's changes are not only changes to `CaseState`.
      // `requestInvestigation` deliberately appends no case event -- no
      // `run.*` variant exists -- so it moves the plan and nothing else.
      // Reporting that as "changed nothing" made a working turn look like
      // a stall, which is the mirror image of the bug the stall gate
      // exists to catch.
      stateDiff: [
        ...diffSnapshots(before, after),
        ...(plan !== undefined && plan.version !== planVersionBefore
          ? [
              planVersionBefore === undefined
                ? `run plan created at v${String(plan.version)} with ${String(plan.items.length)} item(s)`
                : `run plan v${String(planVersionBefore)} -> v${String(plan.version)}`,
            ]
          : []),
      ],
      // The coverage the *pane* would show, not the raw readiness counts:
      // a UX gate can only meaningfully check a claim the person can see.
      coverage: {
        requiredTotal: displayedCoverage.requiredTotal,
        requiredResolved: displayedCoverage.requiredResolved,
      },
      phase: deriveDecisionPhase(after, pack),
      nextMove:
        firstMove === undefined
          ? null
          : { kind: firstMove.kind, label: firstMove.label, humanOnly: firstMove.humanOnly },
      runPlan:
        plan === undefined
          ? null
          : {
              version: plan.version,
              plannedItems: plan.items.filter((item) => item.status === 'planned').length,
              deepItems: plan.items.filter((item) => item.depth === 'deep').length,
              reused: plan.revision?.reusedSignatures.length ?? 0,
              added: plan.revision?.addedSignatures.length ?? 0,
            },
      events,
      view: after.view?.mode ?? 'list',
      ownership: turn.actor === 'agent' ? 'agent' : 'human',
      visibleControls: visibleControlsFor(moves),
      accessibility: { seriousViolations: 0, checked: false },
      consoleErrors: [],
      networkFailures: [],
      latencyMs: Date.now() - started,
      estimatedCostUsd: 0,
    });
  }

  /**
   * Performs the turn and returns the commands it actually ran.
   *
   * Every branch resolves its input from *current* state rather than from
   * the persona: `updateDiscovery` answers whatever topic `deriveNextMoves`
   * is asking about, and `setCandidateDisposition` acts on whichever
   * candidate is still untriaged.
   */
  private applyTurn(turn: PersonaTurn, index: number): string[] {
    if (this.caseIdValue === '') {
      const receipt = this.stack.commandService.startDemo(this.nextCommandId(), {
        demoId: this.persona.demoId,
      });
      if (receipt.status !== 'ok') {
        throw new Error(`startDemo failed for "${this.persona.id}": ${JSON.stringify(receipt)}`);
      }
      this.caseIdValue = receipt.value.caseId;
      if (turn.command === undefined) return ['startDemo'];
    }

    const snapshot = this.snapshot();
    if (snapshot === undefined) throw new Error('no case after startDemo');
    if (turn.command === undefined) return [];

    switch (turn.command) {
      case 'updateDiscovery':
        return this.answerNextTopic(snapshot, turn, index);
      case 'finishDiscovery':
        return this.answerEveryRemainingTopic(snapshot, turn);
      case 'requestInvestigation':
        return this.requestInvestigation(snapshot);
      case 'completeBlindSpotReview':
        return this.completeBlindSpots(snapshot);
      case 'setCandidateDisposition':
        return this.triageNextCandidate(snapshot, turn);
      case 'upsertOption':
        return this.addKnownOption(snapshot, turn);
      case 'defineCaseAttribute':
        return this.raiseConcern(snapshot, turn);
      case 'reviewCaseExtension':
        return this.confirmConcern(snapshot);
      default:
        throw new Error(
          `Persona "${this.persona.id}" turn ${String(index)} names command "${turn.command}", which this executor does not know how to perform.`,
        );
    }
  }

  private answerNextTopic(snapshot: CaseState, turn: PersonaTurn, index: number): string[] {
    const pack = this.requirePack(snapshot);
    const readiness = deriveDiscoveryReadiness(snapshot, pack);
    const topicId = readiness.nextTopicId;
    if (topicId === null) {
      // A persona turn that says "answer the next question" when Sift is
      // asking none is a real mismatch between the journey and the
      // product. Reporting it as a silent no-op is how seven dead turns
      // passed every gate on the first run.
      throw new Error(
        `Persona "${this.persona.id}" turn ${String(index)} ("${turn.label}") tried to answer a question, but Sift is asking none.`,
      );
    }
    const receipt = this.stack.commandService.updateDiscovery(this.nextCommandId(), {
      caseId: snapshot.id,
      expectedSequence: snapshot.eventSequence,
      actor: 'human',
      operations: [
        {
          op: 'confirm',
          topicId,
          valueSummary: answerValueFor(
            this.templateFor(pack, topicId),
            turn.utterance ?? `Answered on turn ${String(index)}`,
            this.persona.id,
          ),
        },
      ],
    });
    if (receipt.status !== 'ok') {
      throw new Error(`updateDiscovery("${topicId}") failed: ${JSON.stringify(receipt)}`);
    }
    return ['updateDiscovery'];
  }

  /**
   * The person answers everything Sift still wants to know.
   *
   * A persona should not have to know how many questions a pack asks --
   * that is the number most likely to change, and hard-coding one turn per
   * question means a pack that adds a topic silently leaves the journey
   * short. This loops until `nextTopicId` is null, so the journey always
   * reaches the end of discovery no matter how long discovery is.
   */
  private answerEveryRemainingTopic(initial: CaseState, turn: PersonaTurn): string[] {
    const tools: string[] = [];
    let snapshot = initial;
    // Bounded: `DiscoveryStateSchema` caps topics at 100, so a loop that
    // does not terminate is a bug rather than a long pack.
    for (let guard = 0; guard < 100; guard += 1) {
      const pack = this.requirePack(snapshot);
      const topicId = deriveDiscoveryReadiness(snapshot, pack).nextTopicId;
      if (topicId === null) break;
      const receipt = this.stack.commandService.updateDiscovery(this.nextCommandId(), {
        caseId: snapshot.id,
        expectedSequence: snapshot.eventSequence,
        actor: 'human',
        operations: [
          {
            op: 'confirm',
            topicId,
            valueSummary: answerValueFor(
              this.templateFor(pack, topicId),
              turn.utterance,
              this.persona.id,
            ),
          },
        ],
      });
      if (receipt.status !== 'ok') {
        throw new Error(`updateDiscovery("${topicId}") failed: ${JSON.stringify(receipt)}`);
      }
      tools.push('updateDiscovery');
      const next = this.snapshot();
      if (next === undefined) throw new Error('case vanished mid-discovery');
      snapshot = next;
    }
    if (tools.length === 0) {
      throw new Error(
        `Persona "${this.persona.id}" turn "${turn.label}" had nothing left to answer.`,
      );
    }
    return tools;
  }

  private requestInvestigation(snapshot: CaseState): string[] {
    const receipt = this.stack.runService.requestInvestigation(this.nextCommandId(), {
      caseId: snapshot.id,
      expectedSequence: snapshot.eventSequence,
    });
    if (receipt.status !== 'ok') {
      throw new Error(`requestInvestigation failed: ${JSON.stringify(receipt)}`);
    }
    return ['requestInvestigation'];
  }

  /**
   * A real, verified product gap, not merely a harness assumption -- worth
   * recording precisely because it looked at first like a harness-only
   * restriction.
   *
   * `bid-comparison` declares no `discovery` section at all (see
   * `packages/packs/src/bid-comparison.ts`'s module header), so
   * `pack.discovery?.blindSpots` is empty for it. That alone looked
   * harmless: `CommandService.completeBlindSpotReview`'s own handler
   * accepts an empty `offeredPromptIds` (it only rejects an offered id the
   * pack never declared), and `deriveNextMoves`
   * (`packages/core/src/discovery.ts`) unconditionally offers "Check for
   * anything missed" the moment every required topic is answered --
   * trivially true here, since zero required topics are trivially all
   * answered.
   *
   * But `CompleteBlindSpotReviewInputSchema` (`packages/contracts/src/
   * commands.ts`) declares `offeredPromptIds: z.array(idString()).min(1)`
   * -- the command REFUSES an empty list before the handler is ever
   * reached. So for a pack that declares zero blind spots, there is no
   * valid `offeredPromptIds` value at all: the move `deriveNextMoves`
   * offers can never actually be completed, in this harness or in the real
   * product, by any person or agent. This throws rather than papering over
   * that with a call the real schema would also refuse -- see this file's
   * own header ("the executor answers whatever Sift asks"; here, Sift asks
   * for something structurally unanswerable, which a persona must not
   * pretend otherwise). Not fixed here: the right repair is a `core`
   * change (skip the move, or treat a zero-blind-spot pack's review as
   * trivially complete) that reaches every pack sharing this derivation,
   * which is beyond registering a second pack in this harness.
   */
  private completeBlindSpots(snapshot: CaseState): string[] {
    const pack = this.requirePack(snapshot);
    const offered = (pack.discovery?.blindSpots ?? []).map((prompt) => prompt.id);
    if (offered.length === 0) {
      throw new Error(
        `Persona "${this.persona.id}" completes a blind-spot review, but pack "${pack.identity.id}" declares no blind spots. ` +
          `CompleteBlindSpotReviewInputSchema requires at least one offered prompt id, so this is not completable for this pack -- ` +
          `not a harness limitation.`,
      );
    }
    const receipt = this.stack.commandService.completeBlindSpotReview(this.nextCommandId(), {
      caseId: snapshot.id,
      expectedSequence: snapshot.eventSequence,
      actor: 'human',
      offeredPromptIds: offered,
      selectedPromptIds: [],
    });
    if (receipt.status !== 'ok') {
      throw new Error(`completeBlindSpotReview failed: ${JSON.stringify(receipt)}`);
    }
    return ['completeBlindSpotReview'];
  }

  private triageNextCandidate(snapshot: CaseState, turn: PersonaTurn): string[] {
    const dispositions = new Map(
      (snapshot.discovery?.dispositions ?? []).map((record) => [
        record.entityId,
        record.disposition,
      ]),
    );
    const target = snapshot.entities.find(
      (entity) =>
        entity.kind === 'candidate' &&
        (dispositions.get(entity.id) ?? 'unreviewed') === 'unreviewed',
    );
    if (target === undefined) {
      throw new Error(
        `Persona "${this.persona.id}" turn "${turn.label}" triages a candidate, but every candidate is already triaged.`,
      );
    }

    const disposition = /pass/i.test(turn.label) ? 'pass' : 'keep';
    const receipt = this.stack.commandService.setCandidateDisposition(this.nextCommandId(), {
      caseId: snapshot.id,
      expectedSequence: snapshot.eventSequence,
      actor: 'human',
      entityId: target.id,
      disposition,
    });
    if (receipt.status !== 'ok') {
      throw new Error(`setCandidateDisposition failed: ${JSON.stringify(receipt)}`);
    }
    return ['setCandidateDisposition'];
  }

  private addKnownOption(snapshot: CaseState, turn: PersonaTurn): string[] {
    const receipt = this.stack.commandService.upsertOption(this.nextCommandId(), {
      caseId: snapshot.id,
      optionId: 'known-listing',
      expectedSequence: snapshot.eventSequence,
      option: {
        label: extractOptionLabel(turn.utterance) ?? 'The vehicle they found',
        kind: 'candidate',
        attributes: [],
      },
    });
    if (receipt.status !== 'ok') {
      throw new Error(`upsertOption failed: ${JSON.stringify(receipt)}`);
    }
    return ['upsertOption'];
  }

  private raiseConcern(snapshot: CaseState, turn: PersonaTurn): string[] {
    const receipt = this.stack.commandService.defineCaseAttribute(this.nextCommandId(), {
      caseId: snapshot.id,
      expectedSequence: snapshot.eventSequence,
      definition: {
        id: 'custom.dog_crate_fit',
        label: turn.utterance ?? 'A concern the pack never anticipated',
        valueType: 'boolean',
        appliesTo: ['candidate'],
        evidenceExpectation: 'source',
        comparison: 'constraint',
        reason: 'The person raised a need the pack never anticipated.',
      },
    });
    if (receipt.status !== 'ok') {
      throw new Error(`defineCaseAttribute failed: ${JSON.stringify(receipt)}`);
    }

    // Raising a concern is two commands, not one. `defineCaseAttribute`
    // creates the attribute; adding a criterion that scores against it is
    // what synthesizes the case-extension obligation the runtime can
    // actually work on. Stopping after the first left the concern
    // recorded but inert, and the plan correctly refused to revise for
    // work that did not exist.
    const afterAttribute = this.snapshot();
    if (afterAttribute === undefined) throw new Error('case vanished after defineCaseAttribute');
    const criteriaReceipt = this.stack.commandService.updateCriteria(this.nextCommandId(), {
      caseId: afterAttribute.id,
      expectedSequence: afterAttribute.eventSequence,
      operations: [
        {
          op: 'add',
          criterion: {
            id: 'custom.dog_crate_fit',
            label: 'Dog crate fit',
            kind: 'preference',
            weight: 20,
            direction: 'higher_better',
            appliesToAttribute: 'custom.dog_crate_fit',
            question: turn.utterance ?? 'Does a dog crate fit behind the back seats?',
          },
        },
      ],
    });
    if (criteriaReceipt.status !== 'ok') {
      throw new Error(`updateCriteria failed: ${JSON.stringify(criteriaReceipt)}`);
    }
    return ['defineCaseAttribute', 'updateCriteria'];
  }

  /**
   * The person confirms the concern they raised.
   *
   * Separate from raising it, because that separation is the product's
   * central authority rule: a proposed concern is a proposal until a human
   * says otherwise, and only the confirmation turns it into an obligation
   * the runtime will work on. That is also what makes the plan revise.
   */
  private confirmConcern(snapshot: CaseState): string[] {
    const pending = snapshot.caseExtensions.find(
      (extension) => extension.definition.confirmation !== 'confirmed',
    );
    if (pending === undefined) {
      throw new Error(
        `Persona "${this.persona.id}" confirms a concern, but the case has none awaiting review.`,
      );
    }
    const receipt = this.stack.commandService.reviewCaseExtension(this.nextCommandId(), {
      caseId: snapshot.id,
      extensionId: pending.id,
      decision: 'confirm',
      expectedSequence: snapshot.eventSequence,
    });
    if (receipt.status !== 'ok') {
      throw new Error(`reviewCaseExtension failed: ${JSON.stringify(receipt)}`);
    }
    return ['reviewCaseExtension'];
  }

  private templateFor(pack: CompiledDecisionPack, topicId: string) {
    const template = (pack.discovery?.topics ?? []).find((entry) => entry.id === topicId);
    if (template === undefined) {
      throw new Error(`Pack "${pack.identity.id}" declares no topic "${topicId}".`);
    }
    return template;
  }

  private requirePack(snapshot: CaseState) {
    const pack = this.stack.registry.get(snapshot.pack.id, snapshot.pack.version);
    if (pack === undefined) {
      throw new Error(`Pinned pack "${snapshot.pack.id}" is not registered.`);
    }
    // Touching `compileDiscoveryTopics` here keeps the executor honest about
    // reading the same compiled topic set the pane does.
    compileDiscoveryTopics(snapshot, pack);
    return pack;
  }
}

function extractOptionLabel(utterance: string | undefined): string | undefined {
  if (utterance === undefined) return undefined;
  const match = /\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*)\b/.exec(
    utterance.replace(/^I am looking at (a|an|the)\s+/i, ''),
  );
  return match?.[1];
}

/**
 * The questions Sift actually asked, per persona.
 *
 * This is the only evidence that the discovery is adaptive rather than
 * staged, and it has to be compared *across* runs, which no per-run gate
 * can do. Its absence is how a broken contrast beat stayed green: the
 * landscaping journey silently received the family question set, and the
 * persona-set unit test passed because it compared the personas' scripted
 * utterances rather than what Sift asked in response to them.
 */
function topicsAsked(report: { turns: readonly { stateDiff: readonly string[] }[] }): string[] {
  const topics = new Set<string>();
  for (const turn of report.turns) {
    for (const line of turn.stateDiff) {
      const match = /^topic (\S+) ->/.exec(line);
      if (match?.[1] !== undefined) topics.add(match[1]);
    }
  }
  return [...topics].sort((a, b) => a.localeCompare(b));
}

function assertJourneysDiverge(asked: ReadonlyMap<string, readonly string[]>): string[] {
  const family = asked.get('family-novice');
  const business = asked.get('landscaping-owner');
  if (family === undefined || business === undefined) return [];

  const familyOnly = family.filter((topic) => !business.includes(topic));
  const businessOnly = business.filter((topic) => !family.includes(topic));
  const problems: string[] = [];
  if (familyOnly.length === 0 || businessOnly.length === 0) {
    problems.push(
      'The family and landscaping journeys were asked the same questions. The contrast beat ' +
        'claims one pack adapts to two very different people; identical question sets disprove it.',
    );
  }
  return problems;
}

async function main(): Promise<void> {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  let failures = 0;
  const asked = new Map<string, readonly string[]>();

  for (const persona of PERSONAS) {
    const stack = buildStack();
    try {
      // `DIAGNOSTIC_PASS` is a `Partial` (see its own header comment): a
      // persona nobody has scored -- currently `school-facilities-manager`
      // -- has no entry. Spread it in only when genuinely present, exactly
      // the discipline `runPersona`/`RunPersonaOptions` itself documents
      // ("Omitted means unscored, never 'assumed fine'") -- passing
      // `{ scores: undefined }` would violate `exactOptionalPropertyTypes`
      // and, worse, would be this call site re-inventing the default the
      // schema was written to forbid.
      const diagnosticScores = DIAGNOSTIC_PASS[persona.id];
      const report = await runPersona(persona, new RealPersonaExecutor(stack, persona), {
        ...(diagnosticScores !== undefined ? { scores: diagnosticScores } : {}),
      });
      const diagnostics = summarizeDiagnostics(report.scores);

      writeFileSync(
        join(ARTIFACT_DIR, `${persona.id}.json`),
        `${JSON.stringify({ report, diagnostics }, null, 2)}\n`,
        'utf8',
      );

      asked.set(persona.id, topicsAsked(report));
      const failed = report.gates.filter((gate) => gate.outcome === 'fail');
      const notEvaluated = report.gates.filter((gate) => gate.outcome === 'not_evaluated');

      process.stdout.write(
        `\n${persona.id}: ${report.passed ? 'PASS' : 'FAIL'} (${String(report.turns.length)} turns)\n`,
      );
      for (const gate of failed) {
        failures += 1;
        for (const item of gate.findings) {
          process.stdout.write(
            `  ✗ ${gate.gateId} @ turn ${String(item.turnIndex)}: ${item.detail}\n`,
          );
        }
      }
      if (notEvaluated.length > 0) {
        process.stdout.write(
          `  · not evaluated here: ${notEvaluated.map((gate) => gate.gateId).join(', ')}\n`,
        );
      }
      if (!diagnostics.scored) {
        process.stdout.write(`  · ${diagnostics.reason ?? 'unscored'}\n`);
      } else {
        const medians = Object.entries(diagnostics.medians)
          .map(([dimension, value]) => `${dimension} ${String(value)}`)
          .join(', ');
        process.stdout.write(
          `  · diagnostics ${diagnostics.passed ? 'PASS' : 'FAIL'} (${DIAGNOSTIC_PASS_PROVENANCE.scoredBy}, ${DIAGNOSTIC_PASS_PROVENANCE.scoredAt}): ${medians}\n`,
        );
        for (const failure of diagnostics.failures) {
          failures += 1;
          process.stdout.write(`  ✗ diagnostic: ${failure}\n`);
        }
      }
    } finally {
      stack.cleanup();
    }
  }

  const divergence = assertJourneysDiverge(asked);
  for (const problem of divergence) {
    failures += 1;
    process.stdout.write(`\n  ✗ contrast: ${problem}\n`);
  }
  if (divergence.length === 0) {
    const family = asked.get('family-novice') ?? [];
    const business = asked.get('landscaping-owner') ?? [];
    process.stdout.write(
      `\ncontrast: the same pack asked the family journey about ` +
        `${family.filter((topic) => !business.includes(topic)).join(', ')} and the landscaping ` +
        `journey about ${business.filter((topic) => !family.includes(topic)).join(', ')}.\n`,
    );
  }

  process.stdout.write(
    `\nArtifacts written to ${ARTIFACT_DIR}\n${failures === 0 ? 'All hard gates passed.' : `${String(failures)} gate(s) failed.`}\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
