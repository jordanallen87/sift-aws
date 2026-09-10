import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InvokableTool, ToolContext } from '@strands-agents/sdk';
import type { Clock, IdGenerator } from '@sift/core';
import {
  createCapabilityCatalog,
  compileBidComparisonPack,
  BID_COMPARISON_MANIFEST,
} from '@sift/packs';
import type { CapabilityCatalog } from '@sift/packs';
import type { ExecutionRequest } from '@sift/contracts';
import { BID_READER_TOOL_ID, SCOPE_DIFFER_TOOL_ID, LICENSE_LOOKUP_TOOL_ID } from '@sift/scenarios';
import { ScriptedModelProvider } from './model-provider.js';
import {
  BID_COMPARISON_SWARM_NODE_IDS,
  PROPOSE_AWARD_TOOL_ID,
  DEFAULT_SYNTHESIZER_VALIDATOR,
  buildBidComparisonFixtureTools,
  executeBidComparisonSwarm,
  type BidComparisonSequentialSpecialistId,
  type BidComparisonSwarmDeps,
  type BidComparisonSwarmNodeId,
  type BidComparisonSwarmResult,
} from './bid-comparison-swarm.js';
import type { RuntimeEvent } from './event-normalizer.js';
import type { BidComparisonCriteriaWeights } from './scripted-beats/bid-comparison.js';
import {
  PROPOSED_AWARD_ROUND1,
  PROPOSED_AWARD_ROUND2,
  ROUND1_CRITERIA_WEIGHTS,
  ROUND2_CRITERIA_WEIGHTS,
  buildBidComparisonSwarmScriptedProviders,
  setScenarioBeat,
  type BidComparisonScenarioBeat,
  type BidComparisonSwarmScriptedProviders,
} from './scripted-beats/bid-comparison.js';

const FIXED_CLOCK: Clock = { now: () => '2026-09-06T00:00:00.000Z' };

function fixedIdGenerator(): IdGenerator {
  let counter = 0;
  return { next: (prefix) => `${prefix ?? 'id'}-${++counter}` };
}

/**
 * A throwaway `AgentSkills` root built at test-run time under the OS temp
 * directory (never under the repo's `apps/agent/skills/`, which this task's
 * file scope forbids modifying) -- identical rationale and mechanics to
 * `home-energy-swarm.test.ts`'s `buildTempSkillsRootDir`.
 */
function buildTempSkillsRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'sift-bid-comparison-skills-'));
  for (const skill of BID_COMPARISON_MANIFEST.skills) {
    const skillDir = join(root, skill.id);
    mkdirSync(skillDir);
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${skill.id}\ndescription: ${skill.description.replace(/\n/g, ' ')}\n---\n\n# ${skill.id}\n\n${skill.description}\n`,
    );
  }
  return root;
}

const SKILLS_ROOT_DIR = buildTempSkillsRootDir();
afterAll(() => {
  rmSync(SKILLS_ROOT_DIR, { recursive: true, force: true });
});

function bidCatalog(): CapabilityCatalog {
  return createCapabilityCatalog([
    ...BID_COMPARISON_MANIFEST.skills.map((skill) => ({
      id: skill.id,
      kind: 'skill' as const,
      version: '1.0.0',
    })),
    ...BID_COMPARISON_MANIFEST.specialists.map((specialist) => ({
      id: specialist.id,
      kind: 'specialist' as const,
      version: '1.0.0',
    })),
    ...BID_COMPARISON_MANIFEST.tools.map((tool) => ({
      id: tool.id,
      kind: 'tool' as const,
      version: '1.0.0',
    })),
  ]);
}

function obligationFor(
  id: string,
  overrides: Partial<ExecutionRequest['obligation']> = {},
): ExecutionRequest['obligation'] {
  const declared = BID_COMPARISON_MANIFEST.obligations.find((entry) => entry.id === id);
  if (declared === undefined) {
    throw new Error(`test: no obligation "${id}" declared in BID_COMPARISON_MANIFEST`);
  }
  return {
    id: declared.id,
    label: declared.label,
    question: declared.question,
    category: declared.category,
    required: declared.required,
    priority: declared.priority,
    requiredEvidenceLevel: declared.requiredEvidenceLevel,
    maxAttempts: declared.maxAttempts,
    acceptedUncertaintyAllowed: declared.acceptedUncertaintyAllowed,
    dependsOn: [...declared.dependsOn],
    preferredSkills: [...declared.preferredSkills],
    preferredSpecialists: [...declared.preferredSpecialists],
    completionRule: { ...declared.completionRule },
    origin: declared.origin,
    status: 'active',
    attemptsUsed: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function criteriaFor(
  weights: BidComparisonCriteriaWeights,
): ExecutionRequest['caseSummary']['criteria'] {
  return [
    {
      id: 'bid.adjusted_total',
      label: 'Lowest scope-normalized cost',
      kind: 'preference',
      weight: weights.adjustedTotal,
      direction: 'lower_better',
      origin: 'pack',
      status: 'active',
    },
    {
      id: 'bid.scope_completeness',
      label: 'Scope completeness',
      kind: 'preference',
      weight: weights.scopeCompleteness,
      direction: 'higher_better',
      origin: 'pack',
      status: 'active',
    },
    {
      id: 'bid.payment_risk',
      label: 'Payment risk (deposit requested)',
      kind: 'preference',
      weight: weights.paymentRisk,
      direction: 'lower_better',
      origin: 'pack',
      status: 'active',
    },
    {
      id: 'bid.schedule_fit',
      label: 'Schedule fit (start date and duration)',
      kind: 'preference',
      weight: weights.scheduleFit,
      direction: 'higher_better',
      origin: 'pack',
      status: 'active',
    },
    {
      id: 'bid.warranty',
      label: 'Warranty term',
      kind: 'preference',
      weight: weights.warranty,
      direction: 'higher_better',
      origin: 'pack',
      status: 'active',
    },
    {
      id: 'bid.credentials_valid',
      label: 'License and insurance credentials are valid',
      kind: 'hard_constraint',
      weight: 0,
      direction: 'higher_better',
      origin: 'pack',
      status: 'active',
    },
  ];
}

function buildExecutionRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    runId: 'run-bid-comparison-1',
    caseId: 'case-demo-bid-comparison',
    pack: { id: 'bid-comparison', version: '1.0.0', compiledHash: 'a'.repeat(64) },
    obligation: obligationFor('bid.scope_normalization'),
    caseSummary: {
      caseId: 'case-demo-bid-comparison',
      title: 'Master bathroom remodel -- plumbing scope',
      status: 'draft',
      criteria: criteriaFor(ROUND1_CRITERIA_WEIGHTS),
      optionSummaries: [],
      evidenceCounts: { satisfied: 0, active: 1, blocked: 0, acceptedUncertainty: 0, open: 4 },
    },
    caseExtensions: [],
    availableSkills: BID_COMPARISON_MANIFEST.skills.map((skill) => skill.id),
    availableSpecialists: BID_COMPARISON_MANIFEST.specialists.map((specialist) => specialist.id),
    allowedTools: [],
    priorAttempts: [],
    limits: {
      maxAttemptsPerObligation: 2,
      maxToolCallsPerRun: 12,
      maxGraphNodeExecutionsPerRun: 6,
      modelRequestTimeoutMs: 120_000,
      totalRunTimeoutMs: 300_000,
    },
    ...overrides,
  };
}

const SEQUENTIAL_OBLIGATION_IDS: Record<BidComparisonSequentialSpecialistId, string> = {
  'scope-analyst': 'bid.scope_normalization',
  'price-analyst': 'bid.price_verification',
  'credential-checker': 'bid.credential_verification',
  'schedule-analyst': 'bid.schedule_feasibility',
};

function specialistRequest(nodeId: BidComparisonSequentialSpecialistId): ExecutionRequest {
  const specialist = BID_COMPARISON_MANIFEST.specialists.find((entry) => entry.id === nodeId);
  if (specialist === undefined) {
    throw new Error(`test: no specialist "${nodeId}" declared in BID_COMPARISON_MANIFEST`);
  }
  return buildExecutionRequest({
    obligation: obligationFor(SEQUENTIAL_OBLIGATION_IDS[nodeId]),
    availableSpecialists: [nodeId],
    allowedTools: [...specialist.allowedTools],
  });
}

interface BuildDepsOptions {
  start?: BidComparisonSwarmNodeId;
  beat?: BidComparisonScenarioBeat;
  weights?: BidComparisonCriteriaWeights;
  providers?: BidComparisonSwarmScriptedProviders;
}

function buildDeps(options: BuildDepsOptions = {}): {
  deps: BidComparisonSwarmDeps;
  providers: BidComparisonSwarmScriptedProviders;
} {
  const pack = compileBidComparisonPack(bidCatalog(), FIXED_CLOCK);
  const providers = options.providers ?? buildBidComparisonSwarmScriptedProviders();
  setScenarioBeat(providers, options.beat ?? 'round1');

  const specialistRequests = {
    'scope-analyst': specialistRequest('scope-analyst'),
    'price-analyst': specialistRequest('price-analyst'),
    'credential-checker': specialistRequest('credential-checker'),
    'schedule-analyst': specialistRequest('schedule-analyst'),
  };

  const challengerSpecialist = BID_COMPARISON_MANIFEST.specialists.find(
    (entry) => entry.id === 'source-challenger',
  )!;
  const synthesizerSpecialist = BID_COMPARISON_MANIFEST.specialists.find(
    (entry) => entry.id === 'decision-synthesizer',
  )!;

  const awardRecommendationRequest = buildExecutionRequest({
    obligation: obligationFor('bid.award_recommendation'),
    caseSummary: {
      caseId: 'case-demo-bid-comparison',
      title: 'Master bathroom remodel -- plumbing scope',
      status: 'draft',
      criteria: criteriaFor(options.weights ?? ROUND1_CRITERIA_WEIGHTS),
      optionSummaries: [],
      evidenceCounts: { satisfied: 4, active: 1, blocked: 0, acceptedUncertainty: 1, open: 0 },
    },
    availableSpecialists: ['source-challenger', 'decision-synthesizer'],
    allowedTools: [...challengerSpecialist.allowedTools, ...synthesizerSpecialist.allowedTools],
  });

  const deps: BidComparisonSwarmDeps = {
    pack,
    modelFor: (nodeId) => providers[nodeId],
    skillsRootDir: SKILLS_ROOT_DIR,
    clock: FIXED_CLOCK,
    idGenerator: fixedIdGenerator(),
    specialistRequests,
    awardRecommendationRequest,
    resolveConfirmation: () => true,
    ...(options.start !== undefined ? { start: options.start } : {}),
  };

  return { deps, providers };
}

function isRuntimeEvent(item: unknown): item is RuntimeEvent {
  return typeof item === 'object' && item !== null && 'sequence' in item;
}

async function drain(
  gen: AsyncGenerator<RuntimeEvent, BidComparisonSwarmResult, undefined>,
): Promise<{ events: RuntimeEvent[]; result: BidComparisonSwarmResult }> {
  const events: RuntimeEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    if (isRuntimeEvent(next.value)) events.push(next.value);
    next = await gen.next();
  }
  return { events, result: next.value };
}

describe('BID_COMPARISON_SWARM_NODE_IDS', () => {
  it('names exactly the six pack-declared specialists', () => {
    expect([...BID_COMPARISON_SWARM_NODE_IDS].sort()).toEqual(
      [
        'scope-analyst',
        'price-analyst',
        'credential-checker',
        'schedule-analyst',
        'source-challenger',
        'decision-synthesizer',
      ].sort(),
    );
  });
});

describe('executeBidComparisonSwarm: real Swarm topology (round1 -- happy path + all four required beats)', () => {
  it('runs the real six-node Swarm in the exact causal order: scope-analyst first, then a sequential handoff chain to decision-synthesizer', async () => {
    const { deps } = buildDeps();
    const { events, result } = await drain(executeBidComparisonSwarm(deps));

    expect(result.nodeStartOrder[0]).toBe('scope-analyst');
    expect(result.nodeFinishOrder).toEqual([
      'scope-analyst',
      'price-analyst',
      'credential-checker',
      'schedule-analyst',
      'source-challenger',
      'decision-synthesizer',
    ]);
    expect(result.multiAgentResult.status).toBe('COMPLETED');
    expect(result.repetitiveHandoffDetected).toBe(false);
    expect(events.length).toBeGreaterThan(0);
  });

  it('hands off in the exact causal chain with real swarm.handoff events (from/to/reason/evidenceDelta)', async () => {
    const { deps } = buildDeps();
    const { events, result } = await drain(executeBidComparisonSwarm(deps));

    expect(result.handoffs.map((handoff) => `${handoff.from}->${handoff.to}`)).toEqual([
      'scope-analyst->price-analyst',
      'price-analyst->credential-checker',
      'credential-checker->schedule-analyst',
      'schedule-analyst->source-challenger',
      'source-challenger->decision-synthesizer',
    ]);
    for (const handoff of result.handoffs) {
      expect(handoff.evidenceDelta).toBeGreaterThan(0);
    }

    const handoffEvents = events.filter(
      (event) => event.category === 'swarm' && event.name === 'swarm.handoff',
    );
    expect(handoffEvents).toHaveLength(5);
  });

  it('genuinely wires skills, context injection, and interventions for every non-synthesizer node, and swarm node lifecycle events for every node', async () => {
    const { deps } = buildDeps();
    const { events } = await drain(executeBidComparisonSwarm(deps));

    for (const nodeId of [
      'scope-analyst',
      'price-analyst',
      'credential-checker',
      'schedule-analyst',
      'source-challenger',
    ] as const) {
      expect(
        events.some((event) => event.category === 'context' && event.agentId === nodeId),
        `expected a context.injected event for node "${nodeId}"`,
      ).toBe(true);
    }
    // source-challenger declares no allowedSkills (bid-comparison.ts's
    // manifest, mirroring home-energy-guardian.ts's identical
    // source-challenger treatment) -- only the four obligation-owning
    // sequential specialists genuinely activate a skill.
    for (const nodeId of [
      'scope-analyst',
      'price-analyst',
      'credential-checker',
      'schedule-analyst',
    ] as const) {
      expect(
        events.some((event) => event.category === 'skill' && event.agentId === nodeId),
        `expected a skill.activated event for node "${nodeId}"`,
      ).toBe(true);
    }
    for (const nodeId of BID_COMPARISON_SWARM_NODE_IDS) {
      expect(
        events.some((event) => event.category === 'intervention' && event.agentId === nodeId),
        `expected an intervention event for node "${nodeId}"`,
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.category === 'swarm' &&
            event.name === 'swarm.node_started' &&
            event.agentId === nodeId,
        ),
        `expected a swarm.node_started event for node "${nodeId}"`,
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.category === 'swarm' &&
            event.name === 'swarm.node_completed' &&
            event.agentId === nodeId,
        ),
        `expected a swarm.node_completed event for node "${nodeId}"`,
      ).toBe(true);
    }
  });

  it('captures the parsed ExecutionResult-shaped context every node handed off', async () => {
    const { deps } = buildDeps();
    const { result } = await drain(executeBidComparisonSwarm(deps));

    expect(result.contexts['scope-analyst']?.suggestedStatus).toBe('satisfied');
    expect(result.contexts['price-analyst']?.suggestedStatus).toBe('satisfied');
    expect(result.contexts['credential-checker']?.suggestedStatus).toBe('satisfied');
    expect(result.contexts['schedule-analyst']?.suggestedStatus).toBe('accepted_uncertainty');
  });

  it('recommends awarding to Northgate Plumbing once scope is normalized, and confirms propose_award before recording the proposal', async () => {
    const { deps } = buildDeps();
    const { events, result } = await drain(executeBidComparisonSwarm(deps));

    expect(result.decisionSynthesizerText).toContain('Northgate Plumbing');
    expect(result.proposedAward).toEqual(PROPOSED_AWARD_ROUND1);
    expect(result.goalLoopResult?.passed).toBe(true);

    const confirmEvent = events.find(
      (event) =>
        event.category === 'intervention' &&
        event.name === 'intervention.confirm' &&
        event.agentId === 'decision-synthesizer' &&
        event.attributes['subject'] === PROPOSE_AWARD_TOOL_ID,
    );
    expect(confirmEvent).toBeDefined();
    expect(confirmEvent?.attributes['handler']).toBe('ConsequenceGuard');
  });

  // --- The four required beats, each proven from the real shipped round1
  // scripted trajectory (never a provider patched inside the test) ---

  it('Deny: the shipped round1 trajectory has price-analyst reach outside its grant for license-lookup, so a real Deny is visible on every run', async () => {
    const { deps } = buildDeps();
    const { events } = await drain(executeBidComparisonSwarm(deps));

    const denyEvent = events.find(
      (event) =>
        event.category === 'intervention' &&
        event.name === 'intervention.deny' &&
        event.agentId === 'price-analyst',
    );
    expect(denyEvent).toBeDefined();
    expect(denyEvent?.attributes['handler']).toBe('ScopeAuthorization');
    expect(denyEvent?.attributes['subject']).toBe(LICENSE_LOOKUP_TOOL_ID);

    // The deny must not derail the run: the specialist recovers within its
    // grant and the causal chain still reaches the synthesizer.
    const completedNodes = events
      .filter((event) => event.name === 'swarm.node_completed')
      .map((event) => event.agentId);
    expect(completedNodes).toContain('price-analyst');
    expect(completedNodes).toContain('decision-synthesizer');

    // The denied tool never reaches success; its granted tools do.
    const licenseLookupStatuses = events
      .filter(
        (event) =>
          event.category === 'tool' &&
          event.agentId === 'price-analyst' &&
          event.attributes['toolName'] === LICENSE_LOOKUP_TOOL_ID,
      )
      .map((event) => event.attributes['status'])
      .filter((status) => status !== undefined);
    expect(licenseLookupStatuses).toEqual(['error']);

    const grantedToolStatuses = events
      .filter(
        (event) =>
          event.category === 'tool' &&
          event.agentId === 'price-analyst' &&
          [BID_READER_TOOL_ID, 'bid-calculator'].includes(String(event.attributes['toolName'])) &&
          event.attributes['status'] !== undefined,
      )
      .map((event) => event.attributes['status']);
    expect(grantedToolStatuses.length).toBeGreaterThan(0);
    expect(grantedToolStatuses.every((status) => status === 'success')).toBe(true);
  });

  it('Guide: the shipped round1 trajectory has scope-analyst run scope-differ twice on the same bid pair with no new angle, so RetrySteering guides it before it widens to the full twelve-bid comparison', async () => {
    const { deps } = buildDeps();
    const { events } = await drain(executeBidComparisonSwarm(deps));

    const guideEvent = events.find(
      (event) =>
        event.category === 'intervention' &&
        event.name === 'intervention.guide' &&
        event.agentId === 'scope-analyst' &&
        event.attributes['handler'] === 'RetrySteering',
    );
    expect(guideEvent).toBeDefined();
    expect(guideEvent?.attributes['subject']).toBe(SCOPE_DIFFER_TOOL_ID);
  });

  it("GoalLoop: decision-synthesizer's first draft ranks bids on raw quoted totals and is rejected; the corrected second draft ranks on scope-normalized adjusted totals and passes (GoalLoop maxAttempts: 2)", async () => {
    const { deps } = buildDeps();
    const { events, result } = await drain(executeBidComparisonSwarm(deps));

    expect(result.goalLoopResult?.passed).toBe(true);
    expect(result.goalLoopResult?.attempts).toHaveLength(2);
    expect(result.goalLoopResult?.attempts[0]?.passed).toBe(false);
    expect(result.goalLoopResult?.attempts[0]?.feedback).toContain('scope-normalized');
    expect(result.goalLoopResult?.attempts[1]?.passed).toBe(true);

    const failedEvent = events.find(
      (event) => event.category === 'goal' && event.name === 'goal.validation_failed',
    );
    expect(failedEvent).toBeDefined();
    const passedEvent = events.find(
      (event) => event.category === 'goal' && event.name === 'goal.validated',
    );
    expect(passedEvent).toBeDefined();
    // The failed attempt precedes the passed attempt in run order.
    expect(failedEvent!.sequence).toBeLessThan(passedEvent!.sequence);
  });

  it('Confirm: decision-synthesizer calls propose_award, and ConsequenceGuard gates it on human confirmation before the proposal is recorded', async () => {
    const { deps } = buildDeps();
    const { events, result } = await drain(executeBidComparisonSwarm(deps));

    const confirmEvent = events.find(
      (event) =>
        event.category === 'intervention' &&
        event.name === 'intervention.confirm' &&
        event.agentId === 'decision-synthesizer' &&
        event.attributes['subject'] === PROPOSE_AWARD_TOOL_ID,
    );
    expect(confirmEvent).toBeDefined();
    expect(confirmEvent?.attributes['handler']).toBe('ConsequenceGuard');
    expect(result.proposedAward).toBeDefined();
  });

  it('genuinely pauses instead of completing when resolveConfirmation is never supplied: the human confirmation gates the write, it does not merely log it', async () => {
    const { deps } = buildDeps();
    const { resolveConfirmation: _unused, ...depsWithoutConfirmation } = deps;
    void _unused;

    // Unlike home-energy-guardian's round1 (which never calls its
    // consequential tool at all), this pack's decision-synthesizer always
    // calls `propose_award` in round1. With no preemptive resolver,
    // `ConsequenceGuard`'s `Confirm` action calls the real SDK's
    // `event.interrupt()`, which throws `InterruptError` on first call --
    // pausing the agent for external resume rather than completing. This is
    // the genuine gate, not a cosmetic one: the run does not quietly finish
    // and record the proposal, it stops before the tool call the
    // confirmation guards ever resolves.
    const { result } = await drain(executeBidComparisonSwarm(depsWithoutConfirmation));
    expect(result.multiAgentResult.status).toBe('INTERRUPTED');
  });
});

describe('executeBidComparisonSwarm: criteria reweight exercises the hard-constraint refusal (round2)', () => {
  it('warranty- and payment-risk-heavy criteria give Two Rivers Mechanical the highest raw score, but the award still goes to Northgate Plumbing -- requiring a fresh human confirmation -- because Two Rivers Mechanical fails the protected credentials constraint', async () => {
    const { deps, providers } = buildDeps({
      start: 'decision-synthesizer',
      beat: 'round2',
      weights: ROUND2_CRITERIA_WEIGHTS,
    });
    const { events, result } = await drain(executeBidComparisonSwarm(deps));

    expect(result.proposedAward).toEqual(PROPOSED_AWARD_ROUND2);
    expect(result.proposedAward?.bidId).toBe('bid-northgate');
    // The named reason, not a generic "constraint failed": the actual
    // scored bid, its qualitative lead, and the actual mismatched entity
    // names.
    expect(result.decisionSynthesizerText).toContain('Two Rivers Mechanical');
    expect(result.decisionSynthesizerText).toContain('scores highest of the twelve bids');
    // Regression guard. This string once claimed "0.58 vs. Cedar & Sons'
    // 0.31" while the card beside it rendered Cedar at 24%, because the
    // prose was authored from `scoreBids` rather than from production
    // `scoreCaseState`. Scores belong to the deterministic core, which
    // renders them itself; a score numeral reaching this narrative can only
    // ever agree with the page or contradict it.
    expect(result.decisionSynthesizerText).not.toMatch(/\b0\.\d+\b/);
    expect(result.decisionSynthesizerText).toContain('TRM Holdings LLC');
    expect(result.decisionSynthesizerText).toContain('Two Rivers Mechanical Inc');
    expect(result.decisionSynthesizerText).toContain('Northgate Plumbing');
    expect(result.goalLoopResult?.passed).toBe(true);

    const confirmEvent = events.find(
      (event) =>
        event.category === 'intervention' &&
        event.name === 'intervention.confirm' &&
        event.agentId === 'decision-synthesizer' &&
        event.attributes['subject'] === PROPOSE_AWARD_TOOL_ID,
    );
    expect(confirmEvent).toBeDefined();
    expect(confirmEvent?.attributes['handler']).toBe('ConsequenceGuard');

    // Genuine mechanism proof, not just a hand-scripted final answer: the
    // reweighted criteria (bid.payment_risk raised from 15 to 40) really
    // reached the model through decision-synthesizer's system prompt.
    const synthesizerCallLog = providers['decision-synthesizer'].callLog;
    expect(synthesizerCallLog.length).toBeGreaterThan(0);
    const systemPrompt = synthesizerCallLog[0]?.options?.systemPrompt;
    expect(
      typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt),
    ).toContain(`bid.payment_risk (weight ${ROUND2_CRITERIA_WEIGHTS.paymentRisk}`);
  });

  it('differs from round1: the same pack, the same awarded bid, but a genuinely different reasoning -- round1 corrects for scope, round2 refuses a higher-scoring bid on unresolved credentials', async () => {
    const round1 = buildDeps();
    const round2 = buildDeps({
      start: 'decision-synthesizer',
      beat: 'round2',
      weights: ROUND2_CRITERIA_WEIGHTS,
    });

    const { result: result1 } = await drain(executeBidComparisonSwarm(round1.deps));
    const { result: result2 } = await drain(executeBidComparisonSwarm(round2.deps));

    // Not a flip: both rounds award Northgate Plumbing. What differs is WHY.
    expect(result1.proposedAward?.bidId).toBe('bid-northgate');
    expect(result2.proposedAward?.bidId).toBe('bid-northgate');
    expect(result1.decisionSynthesizerText).not.toBe(result2.decisionSynthesizerText);
    // Round1's reasoning is about scope normalization; it never needs to
    // discuss Two Rivers Mechanical's credentials (that finding surfaces
    // earlier, from credential-checker, not from decision-synthesizer's own
    // text). Round2 leads with it.
    expect(result2.decisionSynthesizerText).toContain('TRM Holdings LLC');
    expect(result1.decisionSynthesizerText).not.toContain('TRM Holdings LLC');
  });
});

describe('DEFAULT_SYNTHESIZER_VALIDATOR: direct unit coverage', () => {
  function messageWithToolUse(
    input: Record<string, unknown> | undefined,
  ): Parameters<typeof DEFAULT_SYNTHESIZER_VALIDATOR>[0] {
    return {
      role: 'assistant',
      content:
        input === undefined
          ? []
          : [
              {
                type: 'toolUseBlock',
                toolUseId: 'test-tool-use',
                name: 'strands_structured_output',
                input,
              },
            ],
    } as unknown as Parameters<typeof DEFAULT_SYNTHESIZER_VALIDATOR>[0];
  }

  const FAKE_AGENT = {} as Parameters<typeof DEFAULT_SYNTHESIZER_VALIDATOR>[1];

  it('fails when the response carries no strands_structured_output tool-use block at all', async () => {
    const outcome = await DEFAULT_SYNTHESIZER_VALIDATOR(messageWithToolUse(undefined), FAKE_AGENT);
    expect(outcome).toMatchObject({ passed: false });
  });

  it('fails when the handoff carries no message field', async () => {
    const outcome = (await DEFAULT_SYNTHESIZER_VALIDATOR(
      messageWithToolUse({ agentId: 'source-challenger' }),
      FAKE_AGENT,
    )) as { passed: boolean; feedback?: string };
    expect(outcome.passed).toBe(false);
    expect(outcome.feedback).toContain('must include a message');
  });

  it('fails when the message cites no source id', async () => {
    const outcome = (await DEFAULT_SYNTHESIZER_VALIDATOR(
      messageWithToolUse({ message: 'No citation here.' }),
      FAKE_AGENT,
    )) as { passed: boolean; feedback?: string };
    expect(outcome.passed).toBe(false);
    expect(outcome.feedback).toContain('must cite at least one source');
  });

  it('fails when the message cites a source but ranks bids on raw quoted totals, never mentioning an adjusted total', async () => {
    const outcome = (await DEFAULT_SYNTHESIZER_VALIDATOR(
      messageWithToolUse({
        message:
          'Cedar & Sons offers the lowest total at $223,500.00 (source-bid-cedar). Recommend awarding to Cedar & Sons.',
      }),
      FAKE_AGENT,
    )) as { passed: boolean; feedback?: string };
    expect(outcome.passed).toBe(false);
    expect(outcome.feedback).toContain('scope-normalized adjusted totals');
  });

  it('fails when the message mentions "adjusted total" but never reaches the $279,000 figure', async () => {
    const outcome = (await DEFAULT_SYNTHESIZER_VALIDATOR(
      messageWithToolUse({
        message:
          'Recommend awarding to Cedar & Sons based on its adjusted total, per source-bid-cedar.',
      }),
      FAKE_AGENT,
    )) as { passed: boolean; feedback?: string };
    expect(outcome.passed).toBe(false);
  });

  it('passes when the message cites a source and ranks on the scope-normalized adjusted total', async () => {
    const outcome = await DEFAULT_SYNTHESIZER_VALIDATOR(
      messageWithToolUse({
        message:
          "Cedar & Sons' scope-normalized adjusted total is $279,000.00, per source-bid-calculator-bid-cedar-adjusted-total -- higher than Northgate's $276,000.00. Recommend awarding to Northgate Plumbing.",
      }),
      FAKE_AGENT,
    );
    expect(outcome).toEqual({ passed: true });
  });
});

describe('buildBidComparisonFixtureTools: real Strands tool.invoke() forwards inputs and context.cancelSignal', () => {
  function toolNamed(name: string): InvokableTool<unknown, unknown> {
    const tool = buildBidComparisonFixtureTools().find(
      (entry): entry is InvokableTool<unknown, unknown> =>
        'name' in entry && 'invoke' in entry && entry.name === name,
    );
    if (tool === undefined) throw new Error(`test: no fixture tool named "${name}"`);
    return tool;
  }

  const withCancelSignal: ToolContext = {
    cancelSignal: new AbortController().signal,
  } as unknown as ToolContext;

  it('bid-reader: reads a real bid and forwards context.cancelSignal', async () => {
    const result = (await toolNamed(BID_READER_TOOL_ID).invoke(
      { bidId: 'bid-northgate' },
      withCancelSignal,
    )) as { data: { contractorName: string } };
    expect(result.data.contractorName).toBe('Northgate Plumbing');
  });

  it('scope-differ: omitting bidIds compares every invited bid, and Cedar & Sons is missing 3 items', async () => {
    const all = (await toolNamed(SCOPE_DIFFER_TOOL_ID).invoke({})) as {
      data: { bids: { bidId: string; absentItemCount: number }[] };
    };
    const cedar = all.data.bids.find((bid) => bid.bidId === 'bid-cedar');
    expect(cedar?.absentItemCount).toBe(3);
  });

  it('bid-calculator: an absent required item with no plug number reports the adjusted total as an explicit unknown', async () => {
    const result = (await toolNamed('bid-calculator').invoke({ bidId: 'bid-cedar' })) as {
      data: { adjustedTotal: { status: string } };
    };
    expect(result.data.adjustedTotal.status).toBe('unknown');
  });

  it("bid-calculator: supplying the real plug numbers reports Cedar & Sons' adjusted total as $279,000", async () => {
    const result = (await toolNamed('bid-calculator').invoke({
      bidId: 'bid-cedar',
      plugNumbers: {
        'permits-inspections': 18000,
        'shower-valve-rough-in': 31500,
        'debris-haul-away': 6000,
      },
    })) as { data: { adjustedTotal: { status: string; value?: { amount: number } } } };
    expect(result.data.adjustedTotal).toEqual({
      status: 'known',
      value: { amount: 279000, currency: 'USD' },
    });
  });

  it("license-lookup: Two Rivers Mechanical Inc's certificate does not name its license holder", async () => {
    const result = (await toolNamed(LICENSE_LOOKUP_TOOL_ID).invoke({
      licenseNumber: 'PL-8801-TR',
    })) as { data: { license: { insurance: { matchesLicenseHolder: boolean } } } };
    expect(result.data.license.insurance.matchesLicenseHolder).toBe(false);
  });

  it('propose_award: returns a proposed status carrying the given bidId/rationale', async () => {
    const result = await toolNamed(PROPOSE_AWARD_TOOL_ID).invoke({
      bidId: 'bid-northgate',
      rationale: 'test rationale',
    });
    expect(result).toEqual({
      status: 'proposed',
      bidId: 'bid-northgate',
      rationale: 'test rationale',
    });
  });
});

describe('executeBidComparisonSwarm: defensive guards', () => {
  it('throws before any node runs when the compiled pack declares no specialist matching a required Swarm node id', async () => {
    const { deps } = buildDeps();
    const brokenPack = {
      ...deps.pack,
      specialists: deps.pack.specialists.filter((specialist) => specialist.id !== 'scope-analyst'),
    };

    await expect(drain(executeBidComparisonSwarm({ ...deps, pack: brokenPack }))).rejects.toThrow(
      /declares no specialist "scope-analyst"/,
    );
  });

  it('throws before any node runs when skillsRootDir has no skill subdirectories', async () => {
    const { deps } = buildDeps();
    const emptyRoot = mkdtempSync(join(tmpdir(), 'sift-empty-bid-comparison-skills-'));
    writeFileSync(join(emptyRoot, 'not-a-skill.txt'), 'just a file');
    try {
      await expect(
        drain(executeBidComparisonSwarm({ ...deps, skillsRootDir: emptyRoot })),
      ).rejects.toThrow(/has no skill subdirectories/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('overrides GoalLoop.maxAttempts via goalLoopMaxAttempts, surviving two failed decision-synthesizer attempts the default maxAttempts: 2 would not', async () => {
    const { deps } = buildDeps({ start: 'decision-synthesizer', beat: 'round1' });
    const provider = new ScriptedModelProvider({
      beats: {
        round1: [
          {
            toolCalls: [
              { name: 'strands_structured_output', input: { message: 'No citation, attempt 1.' } },
            ],
          },
          {
            toolCalls: [
              { name: 'strands_structured_output', input: { message: 'No citation, attempt 2.' } },
            ],
          },
          {
            toolCalls: [
              {
                name: 'strands_structured_output',
                input: {
                  message:
                    "Cedar & Sons' scope-normalized adjusted total is $279,000.00, per source-bid-calculator-bid-cedar-adjusted-total. Recommend awarding to Northgate Plumbing.",
                },
              },
            ],
          },
        ],
      },
    });
    provider.setBeat('round1');
    const patchedModelFor: BidComparisonSwarmDeps['modelFor'] = (nodeId) =>
      nodeId === 'decision-synthesizer' ? provider : deps.modelFor(nodeId);

    const { result } = await drain(
      executeBidComparisonSwarm({ ...deps, modelFor: patchedModelFor, goalLoopMaxAttempts: 3 }),
    );

    expect(result.goalLoopResult?.attempts).toHaveLength(3);
    expect(result.goalLoopResult?.attempts[0]?.passed).toBe(false);
    expect(result.goalLoopResult?.attempts[1]?.passed).toBe(false);
    expect(result.goalLoopResult?.attempts[2]?.passed).toBe(true);
    expect(result.goalLoopResult?.passed).toBe(true);
  });
});

describe('createNodeDurationTracker is exercised via a real run (swarm.node_completed durationMs)', () => {
  it('reports a nonnegative measured duration for every node using an injectable clock', async () => {
    let ticks = 0;
    const nowMs = (): number => (ticks += 1000);
    const { deps } = buildDeps();

    const { events } = await drain(executeBidComparisonSwarm({ ...deps, nowMs }));

    const nodeFinishes = events.filter((event) => event.name === 'swarm.node_completed');
    expect(nodeFinishes.map((event) => event.attributes['nodeId']).sort()).toEqual(
      [...BID_COMPARISON_SWARM_NODE_IDS].sort(),
    );
    for (const event of nodeFinishes) {
      expect(event.durationMs).toBeDefined();
      expect(event.durationMs).toBeGreaterThan(0);
    }
  });
});
