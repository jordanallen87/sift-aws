/**
 * Deterministic discovery derivation: coverage, readiness, next moves, and
 * the authority rules that govern turning a response into state.
 *
 * ## The invariant
 *
 * Identical state always produces identical readiness, allowed moves, and
 * required pane view. Nothing in this module reads a clock, a random source,
 * or a model — every function is a pure projection of `(CaseState, pack)`,
 * with the one timestamp that a state change needs passed in explicitly.
 *
 * That is what makes reload/resume work: the pane does not restore a
 * remembered position, it *recomputes* the same one, so a person who
 * refreshes lands exactly where they were and ChatGPT reading the case on
 * its next turn sees exactly what the pane shows.
 *
 * ## Why the authority rules are enforced again here
 *
 * `@sift/contracts`' discovery.ts makes four rules structural, but a schema
 * can only reject an illegal *shape*. It cannot know that the topic a model
 * is writing to was already answered by a person, that the topic does not
 * exist in this pack, or that it does not apply to this case. Those need the
 * current state to decide, so they live here, in the one function that turns
 * a response into new state.
 *
 * ## What "resolved" means, and what it deliberately does not
 *
 * A required topic counts as resolved when it is `confirmed` or
 * `not_applicable` — a person either said what it is, or said it does not
 * apply to them. Both are answers. `deferred` is *not* an answer, and in
 * companion mode a required topic may not be deferred at all; standalone may,
 * and pays for it by marking its own output provisional.
 *
 * `inferred_pending` is never resolved, whatever its confidence. That is the
 * entire point of the tier: a model's reading of what someone said is not the
 * same as what they said.
 */
import type {
  CaseState,
  CompiledDecisionPack,
  DecisionBrief,
  DecisionMode,
  DiscoveryCoverage,
  DiscoveryTopicState,
  DiscoveryTopicTemplate,
  InteractionResponse,
  NextMove,
  PackDiscoveryDefinition,
  TopicMapping,
} from '@sift/contracts';

/** Statuses that mean a person has actually answered the topic. */
const RESOLVED_STATUSES = new Set(['confirmed', 'not_applicable']);

/** Why a mapping in a response was not applied. */
export type DiscoveryRejectionReason =
  'undeclared_topic' | 'not_applicable_topic' | 'human_confirmed';

export interface DiscoveryRejection {
  readonly topicId: string;
  readonly reason: DiscoveryRejectionReason;
}

export interface DiscoveryReadiness {
  readonly mode: DecisionMode;
  /** Every topic that applies to this case, answered or not, in ask order. */
  readonly topics: readonly DiscoveryTopicState[];
  readonly coverage: DiscoveryCoverage;
  /** The single highest-value thing to ask next, or null when nothing is outstanding. */
  readonly nextTopicId: string | null;
  readonly pendingConfirmationTopicIds: readonly string[];
  readonly applicableBlindSpotIds: readonly string[];
  readonly readyToDiscover: boolean;
  /** True when something was deferred, so any output built on this is not the whole picture. */
  readonly provisional: boolean;
  /**
   * Why the case is not ready. Topic ids for blocked topics, plus the
   * sentinel `blind_spot_review_incomplete` when only the review is missing.
   */
  readonly blockers: readonly string[];
  readonly brief: DecisionBrief;
}

export interface DiscoveryResponsePlan {
  readonly caseState: CaseState;
  /** Topics that genuinely changed, in the order their mappings arrived. Each becomes one `discovery.topic_updated` event. */
  readonly updatedTopics: readonly DiscoveryTopicState[];
  readonly rejected: readonly DiscoveryRejection[];
}

const EMPTY_DISCOVERY: PackDiscoveryDefinition = { topics: [], blindSpots: [] };

function discoveryOf(pack: CompiledDecisionPack): PackDiscoveryDefinition {
  return pack.discovery ?? EMPTY_DISCOVERY;
}

/**
 * Ask order: highest declared priority first, then topic id.
 *
 * The id tiebreak is not decoration. Two topics at the same priority must
 * still produce one stable order across processes and reloads, or the pane
 * and the model can disagree about what to ask next — which reads to a
 * person as the product changing its mind.
 */
function byAskOrder(a: DiscoveryTopicTemplate, b: DiscoveryTopicTemplate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Whether a conditional topic or blind-spot prompt applies, given what the
 * case has *confirmed* so far.
 *
 * Only confirmed values satisfy a condition. An inference that a case is a
 * business one must not pull a whole branch of business questions into scope
 * before anyone agreed with it.
 */
function conditionMet(
  condition: { topicId: string; equalsAnyOf: readonly string[] } | undefined,
  answers: ReadonlyMap<string, DiscoveryTopicState>,
): boolean {
  if (condition === undefined) return true;
  const answer = answers.get(condition.topicId);
  if (answer?.status !== 'confirmed') return false;
  const value = answer.valueSummary;
  if (value === undefined) return false;
  return condition.equalsAnyOf.some((candidate) => candidate === value);
}

function answerMap(caseState: CaseState): Map<string, DiscoveryTopicState> {
  const map = new Map<string, DiscoveryTopicState>();
  for (const topic of caseState.discovery?.topics ?? []) map.set(topic.topicId, topic);
  return map;
}

function unknownTopic(template: DiscoveryTopicTemplate, updatedAt: string): DiscoveryTopicState {
  return {
    topicId: template.id,
    label: template.label,
    status: 'unknown',
    necessity: template.necessity,
    origin: 'pack',
    humanConfirmed: false,
    updatedAt,
  };
}

/**
 * The pack's topic templates compiled into this case's coverage: every
 * applicable topic, carrying its stored state where one exists and `unknown`
 * where it does not.
 *
 * A stored topic the pack no longer declares is dropped rather than carried
 * forward. A retired topic must not keep counting toward a coverage
 * denominator that the current pack cannot ever fill.
 */
export function compileDiscoveryTopics(
  caseState: CaseState,
  pack: CompiledDecisionPack,
): DiscoveryTopicState[] {
  const answers = answerMap(caseState);
  const createdAt = caseState.discovery?.updatedAt ?? caseState.createdAt;

  return [...discoveryOf(pack).topics]
    .sort(byAskOrder)
    .filter((template) => conditionMet(template.appliesWhen, answers))
    .map((template) => {
      const stored = answers.get(template.id);
      if (stored === undefined) return unknownTopic(template, createdAt);
      // The template owns label and necessity; the case owns the answer.
      // Taking necessity from storage would let a pack edit be silently
      // overridden by whatever a case recorded when it was first asked.
      return { ...stored, label: template.label, necessity: template.necessity };
    });
}

function coverageOf(topics: readonly DiscoveryTopicState[], reviewComplete: boolean) {
  const required = topics.filter((topic) => topic.necessity === 'required');
  const soft = topics.filter((topic) => topic.necessity === 'soft');
  return {
    requiredTotal: required.length,
    requiredResolved: required.filter((topic) => RESOLVED_STATUSES.has(topic.status)).length,
    softTotal: soft.length,
    softResolved: soft.filter((topic) => RESOLVED_STATUSES.has(topic.status)).length,
    blindSpotReviewComplete: reviewComplete,
  };
}

/**
 * The next thing worth asking.
 *
 * A pending inference always outranks a new question, whatever their
 * priorities. Leaving an unconfirmed reading of what someone said sitting on
 * the case while moving on to something else is how an inference quietly
 * hardens into a fact — and the person never gets the one moment where they
 * would have said "no, that is not what I meant".
 */
function nextTopic(topics: readonly DiscoveryTopicState[]): DiscoveryTopicState | null {
  const pending = topics.find((topic) => topic.status === 'inferred_pending');
  if (pending !== undefined) return pending;

  const unresolvedRequired = topics.find(
    (topic) =>
      topic.necessity === 'required' &&
      !RESOLVED_STATUSES.has(topic.status) &&
      topic.status !== 'blocked',
  );
  if (unresolvedRequired !== undefined) return unresolvedRequired;

  return topics.find((topic) => topic.necessity === 'soft' && topic.status === 'unknown') ?? null;
}

export function deriveDiscoveryReadiness(
  caseState: CaseState,
  pack: CompiledDecisionPack,
): DiscoveryReadiness {
  const discovery = caseState.discovery;
  const mode: DecisionMode = discovery?.mode ?? 'companion';
  const review = discovery?.blindSpotReview ?? {
    status: 'pending' as const,
    offeredPromptIds: [],
    selectedPromptIds: [],
  };

  const topics = compileDiscoveryTopics(caseState, pack);
  const coverage = coverageOf(topics, review.status === 'complete');
  const answers = answerMap(caseState);

  const applicableBlindSpotIds = discoveryOf(pack)
    .blindSpots.filter((prompt) => conditionMet(prompt.appliesWhen, answers))
    .map((prompt) => prompt.id);

  const blockers: string[] = topics
    .filter((topic) => topic.status === 'blocked')
    .map((topic) => topic.topicId);

  const requiredOutstanding = coverage.requiredResolved < coverage.requiredTotal;
  if (requiredOutstanding) {
    for (const topic of topics) {
      if (
        topic.necessity === 'required' &&
        !RESOLVED_STATUSES.has(topic.status) &&
        topic.status !== 'blocked'
      ) {
        blockers.push(topic.topicId);
      }
    }
  }

  if (review.status !== 'complete') blockers.push('blind_spot_review_incomplete');

  const next = nextTopic(topics);
  const provisional = topics.some((topic) => topic.status === 'deferred');

  const brief: DecisionBrief = {
    mode,
    useCase: discovery?.useCase ?? 'unstated',
    decisionFor: discovery?.decisionFor ?? 'this decision',
    outcome: discovery?.outcome ?? 'a shortlist worth acting on',
    topics,
    coverage,
    ...(next === null ? {} : { nextTopicId: next.topicId }),
    blindSpotReview: review,
    provisional,
    updatedAt: discovery?.updatedAt ?? caseState.updatedAt,
  };

  return {
    mode,
    topics,
    coverage,
    nextTopicId: next?.topicId ?? null,
    pendingConfirmationTopicIds: topics
      .filter((topic) => topic.status === 'inferred_pending')
      .map((topic) => topic.topicId),
    applicableBlindSpotIds,
    readyToDiscover: blockers.length === 0,
    provisional,
    blockers,
    brief,
  };
}

/**
 * Turn one interaction response into new case state.
 *
 * Three rules decide what happens to each mapping, and they are checked in
 * this order because each one presumes the previous:
 *
 * 1. **Does this topic exist in the pack?** A mapping onto an undeclared
 *    topic is a model writing to something nobody declared.
 * 2. **Does it apply to this case?** A family case is never shown the
 *    payload question, so a mapping onto it is a write to a topic the person
 *    was never asked.
 * 3. **Did a person already settle it?** A model may not overwrite a
 *    human-confirmed value. A person may correct their own answer freely —
 *    that is what a correction is.
 *
 * A surviving mapping from a model becomes `inferred_pending`, never
 * `confirmed`, and its importance is capped below the blocking tier: a
 * proposed `must_work` is recorded as `needs_verification`, so the need is
 * visible and nothing has been removed from consideration on a model's say-so.
 */
export function planDiscoveryResponse(
  caseState: CaseState,
  response: InteractionResponse,
  actor: 'human' | 'agent',
  pack: CompiledDecisionPack,
  now: string,
): DiscoveryResponsePlan {
  const declared = new Set(discoveryOf(pack).topics.map((template) => template.id));
  const applicable = new Set(compileDiscoveryTopics(caseState, pack).map((topic) => topic.topicId));
  const existing = answerMap(caseState);
  const templates = new Map(discoveryOf(pack).topics.map((template) => [template.id, template]));

  const updatedTopics: DiscoveryTopicState[] = [];
  const rejected: DiscoveryRejection[] = [];

  for (const mapping of response.mappings) {
    if (!declared.has(mapping.topicId)) {
      rejected.push({ topicId: mapping.topicId, reason: 'undeclared_topic' });
      continue;
    }
    if (!applicable.has(mapping.topicId)) {
      rejected.push({ topicId: mapping.topicId, reason: 'not_applicable_topic' });
      continue;
    }

    const prior = existing.get(mapping.topicId);
    if (actor !== 'human' && prior?.humanConfirmed === true) {
      rejected.push({ topicId: mapping.topicId, reason: 'human_confirmed' });
      continue;
    }

    updatedTopics.push(topicFromMapping(mapping, templates.get(mapping.topicId), actor, now));
  }

  const nextTopics = [...(caseState.discovery?.topics ?? [])];
  for (const updated of updatedTopics) {
    const index = nextTopics.findIndex((topic) => topic.topicId === updated.topicId);
    if (index === -1) nextTopics.push(updated);
    else nextTopics[index] = updated;
  }

  const discovery = caseState.discovery ?? {
    mode: 'companion' as const,
    topics: [],
    blindSpotReview: {
      status: 'pending' as const,
      offeredPromptIds: [],
      selectedPromptIds: [],
    },
    dispositions: [],
    pendingInteraction: null,
    updatedAt: now,
  };

  return {
    caseState: {
      ...caseState,
      discovery: {
        ...discovery,
        topics: nextTopics,
        // The interaction that produced this response is done, answered or
        // escaped. An escape is a real answer -- it just does not confirm
        // anything.
        pendingInteraction: null,
        updatedAt: now,
      },
      updatedAt: now,
    },
    updatedTopics,
    rejected,
  };
}

function topicFromMapping(
  mapping: TopicMapping,
  template: DiscoveryTopicTemplate | undefined,
  actor: 'human' | 'agent',
  now: string,
): DiscoveryTopicState {
  const human = actor === 'human';
  // A model-proposed blocker is recorded at the tier below blocking. The
  // need stays visible and investigable; it just cannot remove options from
  // consideration until a person confirms it.
  const importance =
    !human && mapping.importance === 'must_work' ? 'needs_verification' : mapping.importance;

  return {
    topicId: mapping.topicId,
    label: template?.label ?? mapping.topicId,
    status: human ? 'confirmed' : 'inferred_pending',
    necessity: template?.necessity ?? 'soft',
    valueSummary: mapping.valueSummary,
    ...(importance === undefined ? {} : { importance }),
    origin: human ? 'user' : 'model',
    ...(human ? {} : { confidence: mapping.confidence }),
    humanConfirmed: human,
    updatedAt: now,
  };
}

/** Convenience wrapper matching the signature the canonical plan names. */
export function applyDiscoveryResponse(
  caseState: CaseState,
  response: InteractionResponse,
  actor: 'human' | 'agent',
  pack: CompiledDecisionPack,
  now: string,
): CaseState {
  return planDiscoveryResponse(caseState, response, actor, pack, now).caseState;
}

/**
 * The bounded set of moves that are valid right now, most useful first.
 *
 * The first entry is what the pane's action dock offers and what the
 * orientation shell describes as "next". The list is derived from state
 * rather than generated as prose precisely so that the pane, the model, and
 * the persona harness cannot disagree about what should happen next.
 *
 * Ordering is a strict cascade -- confirm what is pending, finish required
 * discovery, check blind spots, discover, triage, compare, decide -- because
 * each stage's output is the next stage's input. A person is never offered
 * "compare what you kept" before there is anything kept.
 *
 * A `decided` case short-circuits the cascade and is offered review moves
 * only. See the branch below for why the cascade cannot be trusted to reach
 * that conclusion on its own.
 */
export function deriveNextMoves(caseState: CaseState, pack: CompiledDecisionPack): NextMove[] {
  // A decided case leaves the cascade entirely.
  //
  // Every gate below reads state that a decided case still carries, and none
  // of them read `status`. So a closed decision still had a `ready`
  // recommendation and was still offered "Confirm what moves forward"; it
  // still had an unanswered soft topic and was still offered that question.
  // Both were visible together in the `decided` baseline screenshot -- the
  // pane asking someone to confirm a decision they had already made, above
  // an invitation to reopen discovery underneath it.
  //
  // `deriveDecisionPhase` already treats `decided` as terminal, so this is
  // the same rule applied to the move list rather than a new one. What is
  // left on a closed case is genuinely only looking at it: no discovery, no
  // triage, and above all no authority gate -- those were spent on the
  // decision itself, and re-offering one is the pane claiming a settled
  // thing is still open.
  //
  // One move, not a menu. A second review move ("look at the evidence
  // behind it") was drafted and dropped: `handleDockAction` in the web app
  // dispatches on `move.kind` and has no `review_question` branch at all, so
  // every move of this kind is currently an inert button. That is a
  // pre-existing gap -- the fallback at the end of this function has always
  // emitted `review_question` -- and it is the web app's to close, but there
  // is no reason to double the inert surface from here while it is open.
  if (caseState.status === 'decided') {
    return [
      {
        kind: 'review_question',
        label: 'Review what was decided',
        reason: 'The decision is made; this is where it landed',
        requiredView: 'recommendations',
        toolName: 'sift_get_case_context',
        humanOnly: false,
        mayInterruptHumanNavigation: false,
      },
    ];
  }

  const readiness = deriveDiscoveryReadiness(caseState, pack);
  const moves: NextMove[] = [];

  const requiredComplete = readiness.coverage.requiredResolved === readiness.coverage.requiredTotal;

  const askTopicMove = (topicId: string, reason: string): NextMove => {
    const topic = readiness.topics.find((entry) => entry.topicId === topicId);
    return {
      kind: 'answer_topic',
      label: topic?.label ?? 'Answer the next question',
      reason,
      topicId,
      requiredView: 'interaction',
      toolName: 'sift_request_interaction',
      humanOnly: false,
      mayInterruptHumanNavigation: false,
    };
  };

  const pendingTopicId = readiness.pendingConfirmationTopicIds[0];
  if (pendingTopicId !== undefined) {
    const topic = readiness.topics.find((entry) => entry.topicId === pendingTopicId);
    moves.push({
      kind: 'confirm_inference',
      label: `Confirm: ${topic?.label ?? pendingTopicId}`,
      reason: 'Sift read this from the conversation and has not had it confirmed yet',
      topicId: pendingTopicId,
      requiredView: 'interaction',
      humanOnly: false,
      mayInterruptHumanNavigation: true,
    });
  } else if (!requiredComplete && readiness.nextTopicId !== null) {
    moves.push(
      askTopicMove(
        readiness.nextTopicId,
        'This is the highest-value thing still unknown about the decision',
      ),
    );
  }

  // The blind-spot review outranks any remaining optional question, because
  // it is the one thing still standing between the person and discovery. An
  // unanswered soft topic is not: it is nice to know, and offering it ahead
  // of the actual gate would tell someone the wrong thing about what their
  // next step is.
  //
  // It is only a gate when the pack actually declares a contextual check that
  // applies to this case. A pack that declares none -- `bid-comparison` has no
  // `blindSpots` at all -- used to offer this move anyway, which made "Check
  // for anything missed" the pane's primary action and opened a sheet reading
  // "This decision pack does not declare any contextual checks for this case
  // yet." That is precisely the dead end the fallback at the bottom of this
  // function exists to prevent, arrived at through the front door.
  if (
    requiredComplete &&
    !readiness.coverage.blindSpotReviewComplete &&
    readiness.applicableBlindSpotIds.length > 0
  ) {
    moves.push({
      kind: 'review_blind_spots',
      label: 'Check for anything missed',
      reason: 'Every required topic is answered; one contextual check remains before discovery',
      requiredView: 'brief',
      toolName: 'sift_request_interaction',
      humanOnly: false,
      mayInterruptHumanNavigation: true,
    });
  }

  const candidates = caseState.entities.filter((entity) => entity.kind === 'candidate');
  const dispositions = new Map(
    (caseState.discovery?.dispositions ?? []).map((record) => [record.entityId, record]),
  );
  const untriaged = candidates.filter(
    (candidate) => (dispositions.get(candidate.id)?.disposition ?? 'unreviewed') === 'unreviewed',
  );
  const retained = candidates.filter((candidate) => {
    const disposition = dispositions.get(candidate.id)?.disposition;
    return disposition === 'keep' || disposition === 'unsure';
  });

  if (readiness.readyToDiscover && candidates.length === 0) {
    moves.push({
      kind: 'discover_candidates',
      label: 'Discover models',
      reason: 'The brief is complete, so Sift can search the catalog',
      requiredView: 'candidates',
      toolName: 'sift_search_catalog',
      humanOnly: false,
      mayInterruptHumanNavigation: false,
    });
  }

  if (untriaged.length > 0) {
    moves.push({
      kind: 'quick_pick',
      label: 'Continue Quick Pick',
      reason: `${String(untriaged.length)} candidate(s) still need a Keep, Pass, or Unsure`,
      requiredView: 'quick_pick',
      humanOnly: false,
      mayInterruptHumanNavigation: false,
    });
  }

  if (retained.length > 0) {
    moves.push({
      kind: 'compare_retained',
      label: 'Compare what you kept',
      reason: 'Retained candidates can be compared side by side',
      requiredView: 'compare',
      toolName: 'sift_set_view',
      humanOnly: false,
      mayInterruptHumanNavigation: false,
    });
  }

  if (caseState.recommendation !== null && caseState.recommendation.status === 'ready') {
    moves.push({
      kind: 'confirm_shortlist',
      // Deliberately pack-neutral. This move is derived for every pack, and
      // the copy used to be written for exactly one of them: Home Energy
      // Guardian — a case about whether to get an HVAC inspection — offered
      // "Confirm your test-drive shortlist" and explained it as "only you
      // can decide which models are worth going to see". Seen in the real
      // rendering while reviewing journey screenshots (ADR 0014); no test
      // asserted the label, so nothing caught it.
      //
      // The better long-term answer is a pack-declared term for what its
      // options *are*, so the car pack can say "test-drive shortlist" and
      // the energy pack can say "response". That is a pack-schema change
      // and is not made here; this wording is true for both.
      label: 'Confirm what moves forward',
      reason: 'Only you can decide which options go ahead',
      requiredView: 'confirmation',
      // No `toolName`. `NextMoveSchema` refuses one on a human-only move, so
      // nothing walking this list can find a tool to register for it.
      humanOnly: true,
      mayInterruptHumanNavigation: false,
    });
  }

  // An optional question is worth offering once nothing it could delay is
  // still outstanding.
  if (
    requiredComplete &&
    pendingTopicId === undefined &&
    readiness.nextTopicId !== null &&
    readiness.coverage.blindSpotReviewComplete
  ) {
    moves.push(askTopicMove(readiness.nextTopicId, 'Optional, and it would sharpen the ranking'));
  }

  if (moves.length === 0) {
    // The pane must never be a dead end. When nothing else applies, the
    // honest move is to look at where the decision currently stands.
    moves.push({
      kind: 'review_question',
      label: 'Review where this stands',
      reason: 'Nothing is outstanding right now',
      requiredView: 'recommendations',
      toolName: 'sift_get_case_context',
      humanOnly: false,
      mayInterruptHumanNavigation: false,
    });
  }

  return moves;
}

// --- Decision phase ---

/**
 * Where a case is, as one word.
 *
 * This lived in `apps/web/src/components/decision-orientation.ts` until the
 * persona harness needed the same answer. Two implementations of "what
 * phase is this case in" would be two things that can disagree, and the
 * `state_ui_contradiction` gate would then be testing a copy of the
 * product's logic rather than the product's logic. It belongs here for the
 * same reason `deriveDiscoveryReadiness` does: it is a pure derivation from
 * case state and pack, and everything that renders or checks a phase should
 * be reading the same one.
 *
 * The order below is the order a person moves through, and each branch is
 * a claim the state actually supports: `decided` because the case says so,
 * `deciding` because a recommendation is ready, `triage`/`investigating`
 * because candidates exist and either have or have not been judged.
 */
export const DECISION_PHASES = [
  'discovery',
  'blind_spot_review',
  'discovering_candidates',
  'triage',
  'investigating',
  'deciding',
  'decided',
] as const;
export type DecisionPhase = (typeof DECISION_PHASES)[number];

export function deriveDecisionPhase(
  caseState: CaseState,
  pack: CompiledDecisionPack,
): DecisionPhase {
  if (caseState.status === 'decided') return 'decided';
  if (caseState.recommendation !== null && caseState.recommendation.status === 'ready') {
    return 'deciding';
  }

  const readiness = deriveDiscoveryReadiness(caseState, pack);
  const requiredComplete =
    readiness.coverage.requiredResolved === readiness.coverage.requiredTotal &&
    readiness.coverage.requiredTotal > 0;

  const candidates = caseState.entities.filter((entity) => entity.kind === 'candidate');
  if (candidates.length > 0 && (requiredComplete || caseState.discovery === undefined)) {
    // Having options is not the same as being ready to narrow them down.
    //
    // Found by the known-listing persona: someone who opens with "I am
    // looking at a RAV4 Hybrid" has a candidate after one turn and has
    // answered one question of five. Calling that `triage` put "Narrowing
    // down what you found" directly above "1 of 5 covered" -- the same
    // contradiction the companion frame was repaired for once already,
    // reached by a different route. Sift's honest next move there is still
    // to ask, so the phase is still discovery.
    //
    // A case with no discovery state at all (a seeded demo) is the other
    // side of the same rule: it makes no coverage claim, so there is
    // nothing for `triage` to contradict.
    const dispositions = new Map(
      (caseState.discovery?.dispositions ?? []).map((record) => [
        record.entityId,
        record.disposition,
      ]),
    );
    const untriaged = candidates.filter(
      (entity) => (dispositions.get(entity.id) ?? 'unreviewed') === 'unreviewed',
    );
    return untriaged.length > 0 ? 'triage' : 'investigating';
  }

  if (readiness.readyToDiscover) return 'discovering_candidates';

  return requiredComplete ? 'blind_spot_review' : 'discovery';
}

/**
 * The coverage a pane may honestly display.
 *
 * A case that arrived with candidates but never ran discovery — a seeded
 * demo, or a person who pasted in a specific vehicle — has a pack that
 * declares required topics and a journey that never asked any of them.
 * Reporting "0 of 5 covered" there invites someone to watch a denominator
 * they were never offered a way to move, and pairs badly with any phase
 * label that mentions progress.
 *
 * So: no discovery, no coverage claim. The counts are real the moment the
 * person answers anything.
 *
 * A decided case is the same rule at the other end of the journey. The
 * `decided` baseline read "Decided · 0 of 5 covered · Next: Review what was
 * decided" — arithmetically true, because that case was decided from catalog
 * data and evidence and the five topics were never asked, and still a
 * progress counter for an activity that can no longer progress. Beside the
 * word "Decided" it reads as "decided having covered nothing". The
 * suppression is unconditional rather than limited to incomplete coverage:
 * "5 of 5 covered" on a closed case makes the same live claim, and hiding
 * only the unflattering half would turn the counter's presence into a signal
 * of its own. Nothing is lost that the person still needs — what a decision
 * rested on is the recommendation's account to give, not a discovery
 * denominator's.
 *
 * `provisionalityOf` in the web shell already exempts `decided` from the
 * phases that qualify a result as reached without asking everything, so this
 * completes a pair rather than starting a rule.
 *
 * Lives in core rather than in the shell because the persona harness checks
 * the same claim the shell renders, and two copies of this rule would mean
 * the gate was testing its own copy rather than the product's.
 */
export function deriveDisplayedCoverage(
  caseState: CaseState,
  pack: CompiledDecisionPack,
): DiscoveryCoverage {
  // A live progress claim is honest only while the progress it describes can
  // still be made: not before discovery has begun, and not after the decision
  // has closed.
  const canStillProgress = caseState.discovery !== undefined && caseState.status !== 'decided';
  if (!canStillProgress) {
    return {
      requiredTotal: 0,
      requiredResolved: 0,
      softTotal: 0,
      softResolved: 0,
      blindSpotReviewComplete: false,
    };
  }
  return deriveDiscoveryReadiness(caseState, pack).coverage;
}
