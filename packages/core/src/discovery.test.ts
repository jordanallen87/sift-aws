/**
 * Deterministic discovery derivation.
 *
 * The rule this whole module exists to make true: **identical state always
 * produces identical readiness, allowed moves, and required pane view.**
 * Nothing here consults a clock, a random source, or a model. Given the same
 * case and the same pack, `deriveDiscoveryReadiness` and `deriveNextMoves`
 * return the same answer on the tenth call as on the first — which is what
 * lets a reload restore not just the data but the person's exact place in
 * the journey.
 *
 * The authority rules from `@sift/contracts`' discovery.ts are enforced
 * again here, at the point where a response is turned into state, because
 * the schema can only reject an illegal *shape*: it cannot know that the
 * topic a model is writing to was already answered by a person.
 */
import { describe, expect, it } from 'vitest';
import type {
  CaseState,
  CompiledDecisionPack,
  DiscoveryTopicState,
  InteractionResponse,
  PackDiscoveryDefinition,
} from '@sift/contracts';
import {
  applyDiscoveryResponse,
  compileDiscoveryTopics,
  deriveDisplayedCoverage,
  deriveDiscoveryReadiness,
  deriveNextMoves,
  planDiscoveryResponse,
} from './discovery.js';

const AT = '2026-09-02T10:00:00.000Z';
const LATER = '2026-09-02T11:00:00.000Z';

const DISCOVERY: PackDiscoveryDefinition = {
  topics: [
    {
      id: 'vehicle.use_case',
      label: 'What this vehicle is for',
      question: 'What is this vehicle for?',
      necessity: 'required',
      priority: 100,
      allowedInteractions: ['single_select'],
      optionSeeds: [
        { id: 'seed.family', label: 'Family and personal use', valueSummary: 'family' },
        { id: 'seed.business', label: 'A business or trade', valueSummary: 'business' },
      ],
      escapeHatches: {
        allowCustom: true,
        allowNone: false,
        allowUnsure: false,
        allowDefer: false,
      },
      mapsToAttributeIds: [],
      mapsToCriterionIds: [],
      confirmationRequired: true,
    },
    {
      id: 'vehicle.occupants',
      label: 'Who and what has to fit',
      question: 'Who travels in it regularly, and what has to fit with them?',
      necessity: 'required',
      priority: 90,
      allowedInteractions: ['multi_select', 'free_text'],
      optionSeeds: [],
      escapeHatches: {
        allowCustom: true,
        allowNone: false,
        allowUnsure: true,
        allowDefer: false,
      },
      mapsToAttributeIds: [],
      mapsToCriterionIds: [],
      confirmationRequired: true,
    },
    {
      id: 'vehicle.budget',
      label: 'Budget',
      question: 'What is your budget?',
      necessity: 'required',
      priority: 80,
      allowedInteractions: ['range'],
      optionSeeds: [],
      escapeHatches: {
        allowCustom: false,
        allowNone: false,
        allowUnsure: true,
        allowDefer: false,
      },
      mapsToAttributeIds: [],
      mapsToCriterionIds: [],
      confirmationRequired: true,
    },
    {
      id: 'vehicle.payload',
      label: 'Payload and towing',
      question: 'What do you need to haul or tow?',
      necessity: 'required',
      priority: 85,
      // Only a business case is ever asked this.
      appliesWhen: { topicId: 'vehicle.use_case', equalsAnyOf: ['business'] },
      allowedInteractions: ['free_text'],
      optionSeeds: [],
      escapeHatches: {
        allowCustom: true,
        allowNone: false,
        allowUnsure: true,
        allowDefer: false,
      },
      mapsToAttributeIds: [],
      mapsToCriterionIds: [],
      confirmationRequired: true,
    },
    {
      id: 'vehicle.colour',
      label: 'Colour preference',
      question: 'Any colour preference?',
      necessity: 'soft',
      priority: 10,
      allowedInteractions: ['free_text'],
      optionSeeds: [],
      escapeHatches: { allowCustom: true, allowNone: true, allowUnsure: true, allowDefer: true },
      mapsToAttributeIds: [],
      mapsToCriterionIds: [],
      confirmationRequired: false,
    },
  ],
  blindSpots: [
    {
      id: 'blindspot.child_seats',
      label: 'Car seat layout',
      detail: 'Three across, or a rear-facing seat behind a tall driver',
    },
    {
      id: 'blindspot.garage',
      label: 'Garage clearance',
      detail: 'Height and length limits where it will be parked',
    },
    {
      id: 'blindspot.worksite',
      label: 'Worksite access',
      detail: 'Narrow gates, soft ground, or overhead limits',
      appliesWhen: { topicId: 'vehicle.use_case', equalsAnyOf: ['business'] },
    },
  ],
};

function pack(overrides: Partial<CompiledDecisionPack> = {}): CompiledDecisionPack {
  return {
    identity: { id: 'car-purchase', name: 'Vehicle Selection', version: '1.0.0', description: 'x' },
    discovery: DISCOVERY,
    ...overrides,
  } as unknown as CompiledDecisionPack;
}

function topic(overrides: Partial<DiscoveryTopicState> = {}): DiscoveryTopicState {
  return {
    topicId: 'vehicle.use_case',
    label: 'What this vehicle is for',
    status: 'confirmed',
    necessity: 'required',
    valueSummary: 'family',
    origin: 'user',
    humanConfirmed: true,
    updatedAt: AT,
    ...overrides,
  };
}

function caseWith(
  topics: DiscoveryTopicState[],
  overrides: Partial<NonNullable<CaseState['discovery']>> = {},
): CaseState {
  return {
    schemaVersion: '1.0',
    id: 'case-1',
    title: 'Choose our next car',
    status: 'draft',
    pack: {
      id: 'car-purchase',
      version: '1.0.0',
      compiledHash: 'a'.repeat(64),
      selectedBy: 'user',
      reasons: [],
    },
    attributeDefinitions: [],
    entities: [],
    criteria: [],
    obligations: [],
    caseExtensions: [],
    claims: [],
    sources: [],
    evidenceLinks: [],
    recommendation: null,
    proposal: null,
    activeFocus: null,
    selectedOptionId: null,
    selectedEvidenceId: null,
    eventSequence: 1,
    createdAt: AT,
    updatedAt: AT,
    discovery: {
      mode: 'companion',
      topics,
      blindSpotReview: { status: 'pending', offeredPromptIds: [], selectedPromptIds: [] },
      dispositions: [],
      pendingInteraction: null,
      updatedAt: AT,
      ...overrides,
    },
  };
}

describe('compileDiscoveryTopics: pack templates become case-specific coverage', () => {
  it('starts every declared topic as unknown for a case that has answered nothing', () => {
    const compiled = compileDiscoveryTopics(caseWith([]), pack());

    // `vehicle.payload` is conditional on a business use case that has not
    // been established, so it is not asked yet -- but it is also not
    // silently dropped, because the answer could still make it apply.
    expect(compiled.map((t) => t.topicId)).toEqual([
      'vehicle.use_case',
      'vehicle.occupants',
      'vehicle.budget',
      'vehicle.colour',
    ]);
    expect(compiled.every((t) => t.status === 'unknown')).toBe(true);
  });

  it('brings a conditional topic into scope once its condition is met', () => {
    const compiled = compileDiscoveryTopics(
      caseWith([topic({ valueSummary: 'business' })]),
      pack(),
    );

    expect(compiled.map((t) => t.topicId)).toContain('vehicle.payload');
  });

  it('keeps a conditional topic out of scope for a family case', () => {
    const compiled = compileDiscoveryTopics(caseWith([topic({ valueSummary: 'family' })]), pack());

    expect(compiled.map((t) => t.topicId)).not.toContain('vehicle.payload');
  });

  it('preserves answered state and fills the rest, so a reload restores the same picture', () => {
    const answered = [topic(), topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' })];
    const compiled = compileDiscoveryTopics(caseWith(answered), pack());

    expect(compiled.find((t) => t.topicId === 'vehicle.budget')?.status).toBe('confirmed');
    expect(compiled.find((t) => t.topicId === 'vehicle.occupants')?.status).toBe('unknown');
  });

  it('ignores a stored topic the pack no longer declares rather than inventing coverage for it', () => {
    const compiled = compileDiscoveryTopics(
      caseWith([topic(), topic({ topicId: 'vehicle.retired_topic' })]),
      pack(),
    );

    expect(compiled.map((t) => t.topicId)).not.toContain('vehicle.retired_topic');
  });

  it('returns the same result on repeated calls', () => {
    const state = caseWith([topic()]);
    expect(compileDiscoveryTopics(state, pack())).toEqual(compileDiscoveryTopics(state, pack()));
  });
});

describe('deriveDiscoveryReadiness: what still has to happen before discovery', () => {
  it('counts only applicable topics, so a family case is not held up by a business question', () => {
    const readiness = deriveDiscoveryReadiness(caseWith([topic()]), pack());

    expect(readiness.coverage.requiredTotal).toBe(3);
    expect(readiness.coverage.requiredResolved).toBe(1);
    expect(readiness.coverage.softTotal).toBe(1);
  });

  it('asks the highest-priority unresolved topic first', () => {
    expect(deriveDiscoveryReadiness(caseWith([]), pack()).nextTopicId).toBe('vehicle.use_case');
  });

  it('prefers confirming a pending inference over asking something new', () => {
    // Leaving an unconfirmed inference sitting while asking an unrelated
    // question is how an inference quietly hardens into a fact.
    const readiness = deriveDiscoveryReadiness(
      caseWith([
        topic(),
        topic({
          topicId: 'vehicle.occupants',
          status: 'inferred_pending',
          origin: 'model',
          humanConfirmed: false,
          valueSummary: 'Sounds like two children',
          confidence: 0.6,
        }),
      ]),
      pack(),
    );

    expect(readiness.nextTopicId).toBe('vehicle.occupants');
    expect(readiness.pendingConfirmationTopicIds).toEqual(['vehicle.occupants']);
  });

  it('is not ready to discover while a required topic is unanswered', () => {
    expect(deriveDiscoveryReadiness(caseWith([topic()]), pack()).readyToDiscover).toBe(false);
  });

  it('is not ready to discover until the blind-spot review is done', () => {
    // Every required topic answered is not the same as having checked for
    // the things the person did not think to say.
    const allAnswered = caseWith([
      topic(),
      topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults, two children' }),
      topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
    ]);

    const readiness = deriveDiscoveryReadiness(allAnswered, pack());
    expect(readiness.coverage.requiredResolved).toBe(3);
    expect(readiness.readyToDiscover).toBe(false);
    expect(readiness.blockers).toContain('blind_spot_review_incomplete');
  });

  it('is ready once every required topic is resolved and the review is acknowledged', () => {
    const ready = caseWith(
      [
        topic(),
        topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults, two children' }),
        topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
      ],
      {
        blindSpotReview: {
          status: 'complete',
          offeredPromptIds: ['blindspot.child_seats', 'blindspot.garage'],
          selectedPromptIds: ['blindspot.child_seats'],
          acknowledgedAt: LATER,
        },
      },
    );

    const readiness = deriveDiscoveryReadiness(ready, pack());
    expect(readiness.readyToDiscover).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('counts not_applicable as resolved, because "that does not apply to me" is an answer', () => {
    const readiness = deriveDiscoveryReadiness(
      caseWith([
        topic(),
        topic({ topicId: 'vehicle.occupants', valueSummary: 'Just me' }),
        topic({
          topicId: 'vehicle.budget',
          status: 'not_applicable',
          valueSummary: undefined,
          importance: undefined,
        }),
      ]),
      pack(),
    );

    expect(readiness.coverage.requiredResolved).toBe(3);
  });

  it('refuses to treat a deferred required topic as resolved in companion mode', () => {
    const readiness = deriveDiscoveryReadiness(
      caseWith([
        topic(),
        topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults' }),
        topic({ topicId: 'vehicle.budget', status: 'deferred', valueSummary: undefined }),
      ]),
      pack(),
    );

    expect(readiness.coverage.requiredResolved).toBe(2);
    expect(readiness.readyToDiscover).toBe(false);
  });

  it('lets standalone mode explore with a deferred soft gap, and says the result is provisional', () => {
    const readiness = deriveDiscoveryReadiness(
      caseWith(
        [
          topic(),
          topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults' }),
          topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
          topic({
            topicId: 'vehicle.colour',
            necessity: 'soft',
            status: 'deferred',
            valueSummary: undefined,
          }),
        ],
        {
          mode: 'standalone',
          blindSpotReview: {
            status: 'complete',
            offeredPromptIds: ['blindspot.child_seats'],
            selectedPromptIds: [],
            acknowledgedAt: LATER,
          },
        },
      ),
      pack(),
    );

    expect(readiness.readyToDiscover).toBe(true);
    expect(readiness.provisional).toBe(true);
    expect(readiness.brief.provisional).toBe(true);
  });

  it('is not provisional when nothing was deferred', () => {
    const readiness = deriveDiscoveryReadiness(
      caseWith(
        [
          topic(),
          topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults' }),
          topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
        ],
        {
          blindSpotReview: {
            status: 'complete',
            offeredPromptIds: ['blindspot.child_seats'],
            selectedPromptIds: [],
            acknowledgedAt: LATER,
          },
        },
      ),
      pack(),
    );

    expect(readiness.provisional).toBe(false);
  });

  it('reports a blocked topic as a blocker rather than quietly moving past it', () => {
    const readiness = deriveDiscoveryReadiness(
      caseWith([
        topic(),
        topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults' }),
        topic({
          topicId: 'vehicle.budget',
          status: 'blocked',
          valueSummary: undefined,
          blockingReason: 'No model meets both the budget and the towing minimum',
        }),
      ]),
      pack(),
    );

    expect(readiness.readyToDiscover).toBe(false);
    expect(readiness.blockers).toContain('vehicle.budget');
  });

  it('offers only blind-spot prompts that apply to this case', () => {
    const family = deriveDiscoveryReadiness(caseWith([topic()]), pack());
    expect(family.applicableBlindSpotIds).toEqual(['blindspot.child_seats', 'blindspot.garage']);

    const business = deriveDiscoveryReadiness(
      caseWith([topic({ valueSummary: 'business' })]),
      pack(),
    );
    expect(business.applicableBlindSpotIds).toContain('blindspot.worksite');
  });

  it('produces a brief that satisfies the contract it is rendered through', async () => {
    const { DecisionBriefSchema } = await import('@sift/contracts');
    const readiness = deriveDiscoveryReadiness(caseWith([topic()]), pack());

    const parsed = DecisionBriefSchema.safeParse(readiness.brief);
    expect(parsed.success, JSON.stringify('error' in parsed ? parsed.error : null)).toBe(true);
  });

  it('handles a case that has no discovery state at all', () => {
    const bare = caseWith([]);
    const withoutDiscovery: CaseState = { ...bare, discovery: undefined };

    const readiness = deriveDiscoveryReadiness(withoutDiscovery, pack());
    expect(readiness.coverage.requiredResolved).toBe(0);
    expect(readiness.nextTopicId).toBe('vehicle.use_case');
  });

  it('handles a pack that declares no discovery process at all', () => {
    const readiness = deriveDiscoveryReadiness(caseWith([]), pack({ discovery: undefined }));

    expect(readiness.coverage.requiredTotal).toBe(0);
    expect(readiness.nextTopicId).toBeNull();
    // Nothing to ask is not the same as ready -- the blind-spot review still
    // has to happen before discovery, and it cannot have happened yet.
    expect(readiness.readyToDiscover).toBe(false);
  });
});

describe('planDiscoveryResponse: who is allowed to change what', () => {
  function response(overrides: Partial<InteractionResponse> = {}): InteractionResponse {
    return {
      interactionId: 'interaction-1',
      respondedBy: 'human',
      selectedOptionIds: ['opt-a'],
      mappings: [
        {
          topicId: 'vehicle.occupants',
          valueSummary: 'Two adults and two children in car seats',
          origin: 'user',
          confidence: 1,
          requiresConfirmation: false,
        },
      ],
      respondedAt: LATER,
      ...overrides,
    };
  }

  it('fills several topics from one answer without asking again', () => {
    const applied = planDiscoveryResponse(
      caseWith([topic()]),
      response({
        mappings: [
          {
            topicId: 'vehicle.occupants',
            valueSummary: 'Two adults and two children in car seats',
            origin: 'user',
            confidence: 1,
            requiresConfirmation: false,
          },
          {
            topicId: 'vehicle.budget',
            valueSummary: 'Hard ceiling of 40,000',
            origin: 'user',
            confidence: 1,
            requiresConfirmation: false,
          },
        ],
      }),
      'human',
      pack(),
      LATER,
    );

    expect(applied.updatedTopics.map((t) => t.topicId)).toEqual([
      'vehicle.occupants',
      'vehicle.budget',
    ]);
    expect(applied.updatedTopics.every((t) => t.status === 'confirmed')).toBe(true);

    // And neither one is ever asked again: every required topic is now
    // resolved, so the only thing left to ask is the optional one.
    const readiness = deriveDiscoveryReadiness(applied.caseState, pack());
    expect(readiness.coverage.requiredResolved).toBe(3);
    expect(readiness.coverage.requiredTotal).toBe(3);
    expect(readiness.nextTopicId).toBe('vehicle.colour');
  });

  it('parks a model-extracted mapping as an inference rather than a fact', () => {
    const applied = planDiscoveryResponse(
      caseWith([topic()]),
      response({
        respondedBy: 'model',
        mappings: [
          {
            topicId: 'vehicle.occupants',
            valueSummary: 'Sounds like two children',
            origin: 'model',
            confidence: 0.6,
            requiresConfirmation: true,
          },
        ],
      }),
      'agent',
      pack(),
      LATER,
    );

    const updated = applied.updatedTopics[0];
    expect(updated?.status).toBe('inferred_pending');
    expect(updated?.humanConfirmed).toBe(false);
    expect(updated?.origin).toBe('model');
  });

  it('refuses to let a model overwrite something a person confirmed', () => {
    // The schema cannot catch this: the shape is legal, and only the
    // existing state says the topic is already settled by a human.
    const existing = caseWith([
      topic(),
      topic({ topicId: 'vehicle.budget', valueSummary: 'Hard ceiling of 40,000' }),
    ]);

    const applied = planDiscoveryResponse(
      existing,
      response({
        respondedBy: 'model',
        mappings: [
          {
            topicId: 'vehicle.budget',
            valueSummary: 'Probably flexible up to 45,000',
            origin: 'model',
            confidence: 0.5,
            requiresConfirmation: true,
          },
        ],
      }),
      'agent',
      pack(),
      LATER,
    );

    expect(applied.updatedTopics).toEqual([]);
    expect(applied.rejected).toEqual([
      {
        topicId: 'vehicle.budget',
        reason: 'human_confirmed',
      },
    ]);
    expect(
      applied.caseState.discovery?.topics.find((t) => t.topicId === 'vehicle.budget')?.valueSummary,
    ).toBe('Hard ceiling of 40,000');
  });

  it('lets a person correct their own earlier answer', () => {
    const existing = caseWith([
      topic(),
      topic({ topicId: 'vehicle.budget', valueSummary: 'Hard ceiling of 40,000' }),
    ]);

    const applied = planDiscoveryResponse(
      existing,
      response({
        mappings: [
          {
            topicId: 'vehicle.budget',
            valueSummary: 'Actually we can stretch to 45,000',
            origin: 'user',
            confidence: 1,
            requiresConfirmation: false,
          },
        ],
      }),
      'human',
      pack(),
      LATER,
    );

    expect(
      applied.caseState.discovery?.topics.find((t) => t.topicId === 'vehicle.budget')?.valueSummary,
    ).toMatch(/45,000/);
  });

  it('refuses a mapping to a topic the pack does not declare', () => {
    const applied = planDiscoveryResponse(
      caseWith([topic()]),
      response({
        mappings: [
          {
            topicId: 'vehicle.invented',
            valueSummary: 'Something the model made up',
            origin: 'user',
            confidence: 1,
            requiresConfirmation: false,
          },
        ],
      }),
      'human',
      pack(),
      LATER,
    );

    expect(applied.updatedTopics).toEqual([]);
    expect(applied.rejected[0]?.reason).toBe('undeclared_topic');
  });

  it('refuses a mapping to a topic that does not apply to this case', () => {
    // A family case is never asked about payload, so a mapping onto it is a
    // model writing to a topic the person was never shown.
    const applied = planDiscoveryResponse(
      caseWith([topic({ valueSummary: 'family' })]),
      response({
        mappings: [
          {
            topicId: 'vehicle.payload',
            valueSummary: 'Two tonnes',
            origin: 'user',
            confidence: 1,
            requiresConfirmation: false,
          },
        ],
      }),
      'human',
      pack(),
      LATER,
    );

    expect(applied.rejected[0]?.reason).toBe('not_applicable_topic');
  });

  it('keeps a model-proposed blocker out of blocking tier until a person confirms it', () => {
    const applied = planDiscoveryResponse(
      caseWith([topic()]),
      response({
        respondedBy: 'model',
        mappings: [
          {
            topicId: 'vehicle.occupants',
            valueSummary: 'A wheelchair must fit',
            importance: 'must_work',
            origin: 'model',
            confidence: 0.8,
            requiresConfirmation: true,
          },
        ],
      }),
      'agent',
      pack(),
      LATER,
    );

    const updated = applied.updatedTopics[0];
    expect(updated?.status).toBe('inferred_pending');
    // Downgraded, not dropped: the need is recorded and still visible, it
    // just cannot yet remove options from consideration.
    expect(updated?.importance).toBe('needs_verification');
    expect(updated?.valueSummary).toMatch(/wheelchair/);
  });

  it('records a custom answer that matched no suggestion', () => {
    const applied = planDiscoveryResponse(
      caseWith([topic()]),
      response({
        selectedOptionIds: [],
        customText: 'It has to fit a folded wheelchair',
        mappings: [
          {
            topicId: 'vehicle.occupants',
            valueSummary: 'A folded wheelchair must fit in the boot',
            origin: 'user',
            confidence: 1,
            requiresConfirmation: false,
          },
        ],
      }),
      'human',
      pack(),
      LATER,
    );

    expect(applied.updatedTopics[0]?.valueSummary).toMatch(/wheelchair/);
    expect(applied.updatedTopics[0]?.humanConfirmed).toBe(true);
  });

  it('treats an escape of "unsure" as a real answer that does not confirm anything', () => {
    const applied = planDiscoveryResponse(
      caseWith([topic()]),
      response({ selectedOptionIds: [], escape: 'unsure', mappings: [] }),
      'human',
      pack(),
      LATER,
    );

    expect(applied.updatedTopics).toEqual([]);
    expect(applied.caseState.discovery?.pendingInteraction).toBeNull();
  });

  it('clears the interaction it answered', () => {
    const withPending = caseWith([topic()], {
      pendingInteraction: {
        id: 'interaction-1',
        topicIds: ['vehicle.occupants'],
        kind: 'free_text',
        prompt: 'Who has to fit?',
        options: [],
        escapeHatches: {
          allowCustom: true,
          allowNone: false,
          allowUnsure: true,
          allowDefer: false,
        },
        requestedBy: 'model',
        createdAt: AT,
      },
    });

    const applied = planDiscoveryResponse(withPending, response(), 'human', pack(), LATER);
    expect(applied.caseState.discovery?.pendingInteraction).toBeNull();
  });

  it('produces a case state that still satisfies the canonical schema', async () => {
    const { CaseStateSchema } = await import('@sift/contracts');
    const applied = planDiscoveryResponse(caseWith([topic()]), response(), 'human', pack(), LATER);

    const parsed = CaseStateSchema.safeParse(applied.caseState);
    expect(parsed.success, JSON.stringify('error' in parsed ? parsed.error : null)).toBe(true);
  });

  it('applyDiscoveryResponse returns the same case state the plan carries', () => {
    const state = caseWith([topic()]);
    expect(applyDiscoveryResponse(state, response(), 'human', pack(), LATER)).toEqual(
      planDiscoveryResponse(state, response(), 'human', pack(), LATER).caseState,
    );
  });
});

describe('deriveNextMoves: the pane always has a next action', () => {
  const complete = {
    blindSpotReview: {
      status: 'complete' as const,
      offeredPromptIds: ['blindspot.child_seats'],
      selectedPromptIds: [],
      acknowledgedAt: LATER,
    },
  };

  function answeredCase(overrides: Partial<NonNullable<CaseState['discovery']>> = {}): CaseState {
    return caseWith(
      [
        topic(),
        topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults, two children' }),
        topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
      ],
      { ...complete, ...overrides },
    );
  }

  it('always returns at least one move', () => {
    expect(deriveNextMoves(caseWith([]), pack()).length).toBeGreaterThan(0);
  });

  it('leads with answering the next topic while discovery is incomplete', () => {
    const moves = deriveNextMoves(caseWith([]), pack());
    expect(moves[0]?.kind).toBe('answer_topic');
    expect(moves[0]?.topicId).toBe('vehicle.use_case');
    expect(moves[0]?.requiredView).toBe('interaction');
  });

  it('leads with confirming an inference before asking anything else', () => {
    const moves = deriveNextMoves(
      caseWith([
        topic(),
        topic({
          topicId: 'vehicle.occupants',
          status: 'inferred_pending',
          origin: 'model',
          humanConfirmed: false,
          valueSummary: 'Sounds like two children',
          confidence: 0.6,
        }),
      ]),
      pack(),
    );

    expect(moves[0]?.kind).toBe('confirm_inference');
    expect(moves[0]?.topicId).toBe('vehicle.occupants');
  });

  it('leads with the blind-spot review once every required topic is answered', () => {
    const moves = deriveNextMoves(
      caseWith([
        topic(),
        topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults, two children' }),
        topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
      ]),
      pack(),
    );

    expect(moves[0]?.kind).toBe('review_blind_spots');
  });

  it('never offers the blind-spot review to a pack that declares no contextual checks', () => {
    // `bid-comparison` declares no `blindSpots` at all. Offering the review
    // anyway made "Check for anything missed" the pane's primary action and
    // opened a sheet reading "This decision pack does not declare any
    // contextual checks for this case yet" -- a dead end reached through the
    // front door, which this function's own fallback exists to prevent.
    const answeredTopics = [
      topic(),
      topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults, two children' }),
      topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
    ];

    const moves = deriveNextMoves(
      caseWith(answeredTopics),
      pack({ discovery: { ...DISCOVERY, blindSpots: [] } }),
    );

    expect(moves.map((move) => move.kind)).not.toContain('review_blind_spots');
    // and the pane still has somewhere to go, rather than going quiet.
    expect(moves.length).toBeGreaterThan(0);
  });

  it('leads with discovering candidates once the case is ready and has none', () => {
    const moves = deriveNextMoves(answeredCase(), pack());
    expect(moves[0]?.kind).toBe('discover_candidates');
    expect(moves[0]?.requiredView).toBe('candidates');
  });

  it('leads with Quick Pick as soon as candidates exist and any is unreviewed', () => {
    const withCandidates: CaseState = {
      ...answeredCase(),
      entities: [
        {
          id: 'candidate-rav4',
          kind: 'candidate',
          label: 'RAV4',
          attributes: {},
          createdAt: AT,
          updatedAt: AT,
        },
      ],
    };

    const moves = deriveNextMoves(withCandidates, pack());
    expect(moves[0]?.kind).toBe('quick_pick');
    expect(moves[0]?.requiredView).toBe('quick_pick');
  });

  it('moves on from Quick Pick once every candidate has been triaged', () => {
    const triaged: CaseState = {
      ...answeredCase({
        dispositions: [
          {
            entityId: 'candidate-rav4',
            disposition: 'keep',
            previousDisposition: 'unreviewed',
            decidedAt: LATER,
          },
        ],
      }),
      entities: [
        {
          id: 'candidate-rav4',
          kind: 'candidate',
          label: 'RAV4',
          attributes: {},
          createdAt: AT,
          updatedAt: AT,
        },
      ],
    };

    const moves = deriveNextMoves(triaged, pack());
    expect(moves[0]?.kind).not.toBe('quick_pick');
    expect(moves.map((m) => m.kind)).toContain('compare_retained');
  });

  /**
   * Everything answered, one candidate kept, a recommendation ready -- and
   * the case still `draft`. This is the moment before the decision, not
   * after it: the shortlist confirmation is genuinely outstanding here.
   *
   * A separate fixture rather than an inline literal because the *decided*
   * case is this one plus `status: 'decided'`, and the whole point of the
   * decided tests is that the same state must produce a different move list
   * once the case is closed.
   */
  function readyToDecideCase(): CaseState {
    return {
      ...answeredCase({
        dispositions: [
          {
            entityId: 'candidate-rav4',
            disposition: 'keep',
            previousDisposition: 'unreviewed',
            decidedAt: LATER,
          },
        ],
      }),
      entities: [
        {
          id: 'candidate-rav4',
          kind: 'candidate',
          label: 'RAV4',
          attributes: {},
          createdAt: AT,
          updatedAt: AT,
        },
      ],
      recommendation: {
        id: 'rec-1',
        status: 'ready',
        favoredOptionId: 'candidate-rav4',
        rationale: 'x',
        facts: [],
        hypotheses: [],
        confidence: 0.7,
        limitations: [],
        sourceIds: [],
        resolvedObligationIds: [],
        acceptedUncertaintyObligationIds: [],
        generatedAt: LATER,
      },
    };
  }

  const decidedCase = (): CaseState => ({ ...readyToDecideCase(), status: 'decided' });

  it('never attaches a tool to the human-only shortlist move', () => {
    const shortlist = deriveNextMoves(readyToDecideCase(), pack()).find(
      (move) => move.kind === 'confirm_shortlist',
    );
    expect(shortlist).toBeDefined();
    expect(shortlist?.humanOnly).toBe(true);
    expect(shortlist?.toolName).toBeUndefined();
    // Derived for every pack, so its wording may not belong to one of them.
    // Home Energy Guardian — a case about an HVAC inspection — used to
    // offer "Confirm your test-drive shortlist", explained as "only you can
    // decide which models are worth going to see" (ADR 0014).
    expect(`${shortlist?.label ?? ''} ${shortlist?.reason ?? ''}`).not.toMatch(
      /test-drive|models|vehicle|car/i,
    );
  });

  it('offers nothing that implies a decided case is still open', () => {
    // The whole cascade reads state a decided case still carries: the
    // recommendation is still `ready`, so `confirm_shortlist` fired, and the
    // soft topic is still unanswered, so `answer_topic` fired. Both were
    // visible in the `decided` baseline screenshot -- "Confirm what moves
    // forward" and "What this vehicle is for", on a closed decision.
    const kinds = deriveNextMoves(decidedCase(), pack()).map((move) => move.kind);

    for (const stale of [
      'confirm_shortlist',
      'answer_topic',
      'confirm_inference',
      'review_blind_spots',
      'confirm_brief',
      'discover_candidates',
      'quick_pick',
      'decide',
    ]) {
      expect(kinds, `"${stale}" was offered on a decided case`).not.toContain(stale);
    }
  });

  it('leads a decided case with reviewing where it landed', () => {
    const moves = deriveNextMoves(decidedCase(), pack());

    // Still not a dead end -- the pane owes a person somewhere to go on
    // every case, closed ones included.
    expect(moves.length).toBeGreaterThan(0);
    expect(moves[0]?.kind).toBe('review_question');
    expect(moves[0]?.requiredView).toBe('recommendations');
    // Nothing left is a human authority gate: those were spent on the
    // decision itself.
    expect(moves.every((move) => !move.humanOnly)).toBe(true);
  });

  it('does not describe a decided case as having work outstanding', () => {
    const prose = deriveNextMoves(decidedCase(), pack())
      .map((move) => `${move.label} ${move.reason}`)
      .join(' ');

    expect(prose).not.toMatch(/confirm|outstanding|remain|still need|next step/i);
  });

  it('every derived move satisfies the NextMove contract', async () => {
    const { NextMoveSchema } = await import('@sift/contracts');
    for (const state of [caseWith([]), caseWith([topic()]), answeredCase(), decidedCase()]) {
      for (const move of deriveNextMoves(state, pack())) {
        const parsed = NextMoveSchema.safeParse(move);
        expect(parsed.success, `${move.kind}: ${JSON.stringify(parsed)}`).toBe(true);
      }
    }
  });

  it('returns identical moves for identical state', () => {
    const state = answeredCase();
    expect(deriveNextMoves(state, pack())).toEqual(deriveNextMoves(state, pack()));
  });
});

/**
 * The counts a pane is entitled to print, which are not always the counts the
 * readiness derivation holds.
 *
 * Both suppressions below are the same rule at two ends of the journey: a
 * live progress claim is only honest while the progress it describes can
 * still be made. Before discovery has begun nobody has been offered a way to
 * move the denominator; after the decision is closed there is no longer one.
 */
describe('deriveDisplayedCoverage: the coverage a pane may honestly display', () => {
  it('reports the real counts while discovery can still move', () => {
    const coverage = deriveDisplayedCoverage(caseWith([topic()]), pack());

    expect(coverage.requiredTotal).toBe(3);
    expect(coverage.requiredResolved).toBe(1);
  });

  it('makes no coverage claim for a case that never started discovery', () => {
    const seeded: CaseState = { ...caseWith([]), discovery: undefined };
    const coverage = deriveDisplayedCoverage(seeded, pack());

    expect(coverage.requiredTotal).toBe(0);
    expect(coverage.requiredResolved).toBe(0);
  });

  it('makes no live progress claim once the case is decided', () => {
    // The `decided` release baseline read "Decided · 0 of 5 covered · Next:
    // Review what was decided". Every number in it was arithmetically true --
    // this case was decided from catalog data and evidence, and the discovery
    // topics were never answered -- but a progress counter beside a closed
    // decision describes an activity that can no longer progress, and reads
    // as though the decision was made having covered nothing.
    const decided: CaseState = { ...caseWith([topic()]), status: 'decided' };
    const coverage = deriveDisplayedCoverage(decided, pack());

    expect(coverage.requiredTotal).toBe(0);
    expect(coverage.requiredResolved).toBe(0);
  });

  it('suppresses the claim on a decided case that answered everything too', () => {
    // Not a rule about unflattering numbers. "3 of 3 covered" beside a
    // closed decision is the same live progress claim about the same
    // finished activity, and keeping only the flattering half of the rule
    // would make the counter's presence a signal of its own.
    const answered = caseWith([
      topic(),
      topic({ topicId: 'vehicle.occupants', valueSummary: 'Two adults, two children' }),
      topic({ topicId: 'vehicle.budget', valueSummary: 'Under 40,000' }),
    ]);
    const decided: CaseState = { ...answered, status: 'decided' };

    expect(deriveDiscoveryReadiness(answered, pack()).coverage.requiredResolved).toBe(3);
    expect(deriveDisplayedCoverage(decided, pack()).requiredTotal).toBe(0);
  });

  it('returns identical coverage for identical state', () => {
    const state = caseWith([topic()]);
    expect(deriveDisplayedCoverage(state, pack())).toEqual(deriveDisplayedCoverage(state, pack()));
  });
});
