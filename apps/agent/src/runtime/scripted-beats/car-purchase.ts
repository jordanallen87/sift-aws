/**
 * The exact scripted `ModelProvider` response sequence driving the real
 * car-purchase Strands Graph (`../car-purchase-graph.js`) through every
 * required demo beat (docs/specs/demos-and-submission.md "Choose Our Next
 * Car scenario" -> "Required sequence") deterministically, for two full
 * Graph rounds:
 *
 * - `round1`: the initial investigation (before the household interacts),
 *   producing a preliminary favor of `candidate-rav4`.
 * - `round2`: the revised investigation, run after the household's WebMCP-
 *   driven criteria reweight and `custom.rear_facing_seat_behind_driver`
 *   concern, producing the revised favor of `candidate-crv` (plus
 *   `candidate-outback` as the close alternative).
 *
 * Every number below is the REAL output of the real fixture tools
 * (`packages/scenarios/src/tools/`, verified directly against
 * `packages/scenarios/fixtures/car-purchase/*.json` while authoring this
 * file -- see the dated docs/build-log.md entry) -- never invented. In
 * particular:
 *
 * - `candidate-rav4`'s true out-the-door price is $33,291.30 (advertised
 *   $27,995.00, an 18.92% / $5,296.30 teaser-price gap), $1,291.30 OVER the
 *   household's $32,000.00 maximum budget -- a real hard-constraint
 *   violation, not merely a soft preference tradeoff.
 * - The real 5-year total ownership cost (`ownership-calculator`, shared
 *   financing baseline) is $37,198.20 for candidate-rav4, $36,866.12 for
 *   candidate-crv, $41,110.55 for candidate-cx5, and $36,864.54 for
 *   candidate-outback: candidate-crv and candidate-outback are
 *   effectively tied for cheapest, candidate-rav4 is third (its higher true
 *   price inflates depreciation/financing enough to erase its fuel-economy
 *   advantage on the TOTAL figure), and candidate-cx5 is clearly the most
 *   expensive to own. candidate-rav4's genuine, defensible ownership-cost
 *   edge is narrower than that -- best combined fuel economy (38 mpg,
 *   hybrid) and lowest 5-year fuel cost specifically ($5,447.37) -- and the
 *   scripted claims below say exactly that, not the stronger (false) "lowest
 *   total ownership cost" claim.
 * - candidate-crv has the largest known cargo width (42.8 in), cargo volume
 *   (39.3 cu ft), rear door opening (44.9 in), and second-row legroom
 *   (40.4 in, against 39.5 in for candidate-outback, 39.0 in for
 *   candidate-cx5, and 37.8 in for candidate-rav4) of the four candidates --
 *   the real, defensible reason it is the household-fit standout once the
 *   rear-facing-seat concern is added, even though whether a rear-facing
 *   seat actually clears the driver's seating position remains genuinely
 *   unverified for every candidate: published legroom is measured to a
 *   fixed front-seat reference position and no specification sheet states
 *   it.
 * - candidate-outback's reliability rating is genuinely disputed between two
 *   independent, current, traceable sources (`source-consumer-drive-index`:
 *   "Above Average"; `source-autotrust-reliability-survey`: "Below
 *   Average") -- the real reason it is offered as the shortlist's "close
 *   alternative" rather than the primary pick.
 *
 * `car.hard_constraints` is deliberately not scripted here: it is not one of
 * the six Graph nodes (strands-runtime.md "Orchestration" topology), and its
 * only discriminating fact this scenario needs -- every candidate shares the
 * identical AWD/adaptive-cruise/blind-spot/forward-collision/LATCH standard
 * features, so true out-the-door price against the household's $32,000
 * maximum is the sole differentiator -- is a plain deterministic filter the
 * scenario engine (`../car-purchase-scenario.js`) computes directly over the
 * seeded entity data, matching docs/engineering-principles.md's "the deterministic core, not an
 * LLM, owns ... readiness."
 */
import type { ExecutionResult } from '@sift/contracts';
import { PROPOSE_RECOMMENDATION_TOOL_ID } from '../strands-adapter.js';
import { ScriptedModelProvider, type ScriptedTurn } from '../model-provider.js';
import { CAR_PURCHASE_GRAPH_NODE_IDS, type CarPurchaseGraphNodeId } from '../car-purchase-graph.js';

export const CAR_PURCHASE_SCENARIO_BEATS = ['round1', 'round2'] as const;
export type CarPurchaseScenarioBeat = (typeof CAR_PURCHASE_SCENARIO_BEATS)[number];

/**
 * The synthesized `case_extension`-origin obligation id for the household's
 * rear-facing-car-seat concern -- a second child arrives in three months and
 * a rear-facing seat has to go behind the driver without pushing the
 * driver's seat forward (`../car-purchase-scenario.js` derives the real
 * `ObligationTemplate` this id names, via `@sift/core`'s `deriveObligations`
 * -- see that file's module header for the full "userConcern template" gap
 * this works around). `household-fit-analyst`'s round-2 result below targets
 * this id, not the pack's own `car.household_fit`, since round 2's job is to
 * "reopen household fit" specifically for the newly added concern, not
 * re-litigate the pack obligation `car.household_fit` already resolved
 * (accepted_uncertainty) in round 1.
 */
export const REAR_FACING_SEAT_OBLIGATION_ID = 'case.custom.rear_facing_seat_behind_driver';

const ALL_CANDIDATE_IDS = [
  'candidate-rav4',
  'candidate-crv',
  'candidate-cx5',
  'candidate-outback',
] as const;

function structuredOutputTurn(result: ExecutionResult): ScriptedTurn {
  return { toolCalls: [{ name: 'strands_structured_output', input: result }] };
}

// --- deal-analyst ---

const DEAL_ROUND1_RESULT: ExecutionResult = {
  obligationId: 'car.deal_normalization',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "candidate-rav4's advertised price is $27,995.00, which on its face is within the household's $32,000.00 out-the-door budget; the dealer offer includes a mandatory $2,394.00 Value Protection Package and a longer 75-month financing term not reflected in the advertised price.",
      stance: 'neutral',
      confidence: 0.6,
      sourceIds: ['source-listing-candidate-rav4', 'source-dealer-offer-candidate-rav4'],
    },
    {
      statement:
        'candidate-crv, candidate-cx5, and candidate-outback each show an ordinary tax/title/doc-fee gap between advertised and true out-the-door price (9.55% or less), with no mandatory add-on or financing-term conflict.',
      stance: 'neutral',
      confidence: 0.85,
      sourceIds: [
        'source-dealer-offer-candidate-crv',
        'source-dealer-offer-candidate-cx5',
        'source-dealer-offer-candidate-outback',
      ],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-listing-candidate-rav4',
      level: 'E1',
      verdict: 'pass',
      summary: '2022 Toyota RAV4 XLE Hybrid AWD, advertised $27,995.00 at 28,400 mi.',
    },
    {
      sourceId: 'source-dealer-offer-candidate-rav4',
      level: 'E1',
      verdict: 'degraded',
      summary:
        'Teaser-price conflict: advertised $27,995.00 vs. true out-the-door $33,291.30 (18.92% higher, $5,296.30 over the advertised price) after a mandatory $2,394.00 add-on. This exceeds the household budget.',
    },
    {
      sourceId: 'source-dealer-offer-candidate-crv',
      level: 'E1',
      verdict: 'pass',
      summary:
        'True out-the-door $29,023.65 (9.55% higher than advertised, ordinary tax/title/doc-fee math).',
    },
  ],
  limitations: [
    "Whether candidate-rav4's true out-the-door price exceeds the household's hard-constraint budget has not yet been formally verified.",
  ],
  suggestedStatus: 'open',
};

const DEAL_ROUND2_RESULT: ExecutionResult = {
  obligationId: 'car.deal_normalization',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "Final normalized comparison: candidate-rav4's true out-the-door price ($33,291.30) exceeds the household's $32,000.00 maximum budget by $1,291.30 and fails the hard-constraint budget rule. candidate-crv ($29,023.65), candidate-cx5 ($31,486.50), and candidate-outback ($28,363.00) all comply.",
      stance: 'opposes',
      confidence: 0.95,
      sourceIds: ['source-dealer-offer-candidate-rav4'],
    },
    {
      statement:
        'candidate-crv has the lowest true out-the-door price of the three budget-compliant candidates after candidate-outback, and carries no teaser-price or financing-term conflict.',
      stance: 'supports',
      confidence: 0.85,
      sourceIds: ['source-dealer-offer-candidate-crv'],
    },
  ],
  // Every item below is `verdict: 'pass'`, deliberately: by round 2 the
  // teaser-price conflict is a fully investigated, well-sourced, CONFIRMED
  // fact (not a data-quality problem any more -- see the round1 degraded
  // item, which this round's engine folding marks stale/superseded before
  // this clean, final comparison replaces it). An unfavorable fact that has
  // been fully verified is not "degraded" evidence.
  evidenceResults: [
    {
      sourceId: 'source-dealer-offer-candidate-rav4',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Confirmed: true out-the-door $33,291.30, $1,291.30 over the household budget. Fully documented, not a data-quality issue.',
    },
    {
      sourceId: 'source-dealer-offer-candidate-crv',
      level: 'E1',
      verdict: 'pass',
      summary: 'True out-the-door $29,023.65, within budget, no conflict.',
    },
    {
      sourceId: 'source-dealer-offer-candidate-cx5',
      level: 'E1',
      verdict: 'pass',
      summary: 'True out-the-door $31,486.50, within budget, no conflict.',
    },
    {
      sourceId: 'source-dealer-offer-candidate-outback',
      level: 'E1',
      verdict: 'pass',
      summary: 'True out-the-door $28,363.00, within budget, no conflict.',
    },
  ],
  limitations: [],
  suggestedStatus: 'satisfied',
};

function buildDealAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        // Real AgentSkills progressive activation (docs/specs/strands-
        // runtime.md "Skills"): deal-analyst explicitly activates both
        // skills its obligation needs before investigating.
        { toolCalls: [{ name: 'skills', input: { skill_name: 'listing-normalizer' } }] },
        { toolCalls: [{ name: 'skills', input: { skill_name: 'deal-analysis' } }] },
        { toolCalls: [{ name: 'listing-reader', input: {} }] },
        structuredOutputTurn(DEAL_ROUND1_RESULT),
      ],
      round2: [
        { toolCalls: [{ name: 'listing-reader', input: {} }] },
        structuredOutputTurn(DEAL_ROUND2_RESULT),
      ],
    },
  });
}

// --- ownership-cost-analyst (facts do not change between rounds) ---

const OWNERSHIP_RESULT: ExecutionResult = {
  obligationId: 'car.ownership_cost',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'candidate-rav4 has the best combined fuel economy (38 mpg, hybrid) and the lowest projected 5-year fuel cost ($5,447.37) of the four candidates.',
      stance: 'supports',
      confidence: 0.9,
      sourceIds: ['source-ownership-calculator-candidate-rav4'],
    },
    {
      statement:
        "Total 5-year ownership cost under the household's shared financing assumptions is closely comparable for candidate-crv ($36,866.12) and candidate-outback ($36,864.54), with candidate-rav4 third ($37,198.20, its higher true price offsetting its fuel-economy edge) and candidate-cx5 clearly the most expensive to own ($41,110.55).",
      stance: 'neutral',
      confidence: 0.9,
      sourceIds: [
        'source-ownership-calculator-candidate-crv',
        'source-ownership-calculator-candidate-outback',
        'source-ownership-calculator-candidate-rav4',
        'source-ownership-calculator-candidate-cx5',
      ],
    },
  ],
  evidenceResults: ALL_CANDIDATE_IDS.map((candidateId) => ({
    sourceId: `source-ownership-calculator-${candidateId}`,
    level: 'E3' as const,
    verdict: 'pass' as const,
    summary: `5-year ownership estimate computed for ${candidateId}.`,
  })),
  limitations: [],
  suggestedStatus: 'satisfied',
};

function buildOwnershipCostAnalystProvider(): ScriptedModelProvider {
  const turns: ScriptedTurn[] = [
    { toolCalls: [{ name: 'skills', input: { skill_name: 'ownership-cost' } }] },
    {
      toolCalls: ALL_CANDIDATE_IDS.map((candidateId) => ({
        name: 'ownership-calculator',
        input: { candidateId },
      })),
    },
    structuredOutputTurn(OWNERSHIP_RESULT),
  ];
  return new ScriptedModelProvider({ beats: { round1: turns, round2: turns } });
}

// --- safety-reliability-analyst (facts do not change between rounds) ---

const SAFETY_RESULT: ExecutionResult = {
  obligationId: 'car.safety_reliability',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'candidate-rav4 has the strongest, least-disputed safety/reliability record: Top Safety Pick+ crash safety, Superior driver assistance, and Above Average reliability with no source disagreement.',
      stance: 'supports',
      confidence: 0.9,
      sourceIds: [
        'source-national-crash-safety-consortium',
        'source-northfield-vehicle-safety-lab',
        'source-consumer-drive-index',
        'source-autotrust-reliability-survey',
      ],
    },
    {
      statement:
        'candidate-outback ties candidate-rav4 on crash safety (Top Safety Pick+) and driver assistance (Superior), but its reliability rating is genuinely disputed between two independent, current sources: source-consumer-drive-index rates it "Above Average" (realized owner-reported problems) while source-autotrust-reliability-survey rates it "Below Average" (predicted, powertrain technical-service-bulletin-weighted). candidate-crv and candidate-cx5 are one tier below on all three categories (Top Safety Pick / Advanced / Average, uncontested).',
      stance: 'neutral',
      confidence: 0.85,
      sourceIds: ['source-consumer-drive-index', 'source-autotrust-reliability-survey'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-national-crash-safety-consortium',
      level: 'E1',
      verdict: 'pass',
      summary:
        'candidate-rav4 and candidate-outback: Top Safety Pick+. candidate-crv and candidate-cx5: Top Safety Pick.',
    },
    {
      sourceId: 'source-consumer-drive-index',
      level: 'E1',
      verdict: 'degraded',
      summary:
        'candidate-outback reliability disputed against source-autotrust-reliability-survey.',
    },
    {
      sourceId: 'source-autotrust-reliability-survey',
      level: 'E1',
      verdict: 'degraded',
      summary: 'candidate-outback reliability disputed against source-consumer-drive-index.',
    },
  ],
  limitations: [
    "candidate-outback's reliability rating cannot be resolved to a single value — both sources are current and traceable but measure different things (realized owner complaints vs. predicted powertrain risk).",
  ],
  suggestedStatus: 'accepted_uncertainty',
};

function buildSafetyReliabilityAnalystProvider(): ScriptedModelProvider {
  const turns: ScriptedTurn[] = [
    { toolCalls: [{ name: 'skills', input: { skill_name: 'safety-reliability' } }] },
    {
      toolCalls: ALL_CANDIDATE_IDS.map((candidateId) => ({
        name: 'safety-reliability-lookup',
        input: { candidateId },
      })),
    },
    structuredOutputTurn(SAFETY_RESULT),
  ];
  return new ScriptedModelProvider({ beats: { round1: turns, round2: turns } });
}

// --- household-fit-analyst ---

const HOUSEHOLD_FIT_ROUND1_RESULT: ExecutionResult = {
  obligationId: 'car.household_fit',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'candidate-crv has the largest known cargo width (42.8 in), cargo volume (39.3 cu ft), rear door opening (44.9 in), and second-row legroom (40.4 in) of the four candidates.',
      stance: 'supports',
      confidence: 0.8,
      sourceIds: ['source-household-fit-candidate-crv'],
    },
  ],
  evidenceResults: ALL_CANDIDATE_IDS.map((candidateId) => ({
    sourceId: `source-household-fit-${candidateId}`,
    level: 'E1' as const,
    verdict: 'pass' as const,
    summary: `Known cargo/rear-seat specifications recorded for ${candidateId}.`,
  })),
  limitations: [
    'Driving comfort is subjective and cannot be established from specification data for any candidate; it requires a test drive.',
  ],
  suggestedStatus: 'accepted_uncertainty',
};

const HOUSEHOLD_FIT_ROUND2_RESULT: ExecutionResult = {
  obligationId: REAR_FACING_SEAT_OBLIGATION_ID,
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "For the newly added rear-facing-seat requirement (custom.rear_facing_seat_behind_driver): candidate-crv has the most second-row legroom of the four candidates (40.4 in), ahead of candidate-outback (39.5 in), candidate-cx5 (39.0 in), and candidate-rav4 (37.8 in). Published legroom is measured to a fixed front-seat reference position, so it indicates which candidate has the most room to work with and nothing more: no specification sheet states whether a rear-facing infant seat clears the driver's own seating position on any of the four.",
      stance: 'neutral',
      confidence: 0.5,
      sourceIds: ['source-household-fit-candidate-crv', 'source-household-fit-candidate-outback'],
    },
  ],
  evidenceResults: ALL_CANDIDATE_IDS.map((candidateId) => ({
    sourceId: `source-household-fit-${candidateId}`,
    level: 'E1' as const,
    verdict: 'pass' as const,
    summary: `Known cargo/rear-seat specifications re-confirmed for ${candidateId}.`,
  })),
  limitations: [
    "Whether a rear-facing seat fits behind the driver without moving the driver's seat forward cannot be established from published specifications for any candidate — it is a physical fit check in the vehicle itself, with this household's own seat.",
    'Driving comfort remains subjective and unresolved for every candidate pending a test drive.',
  ],
  suggestedStatus: 'accepted_uncertainty',
};

function buildHouseholdFitAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'household-fit' } }] },
        {
          toolCalls: ALL_CANDIDATE_IDS.map((candidateId) => ({
            name: 'household-fit-matrix',
            input: { candidateId },
          })),
        },
        structuredOutputTurn(HOUSEHOLD_FIT_ROUND1_RESULT),
      ],
      round2: [
        {
          toolCalls: ALL_CANDIDATE_IDS.map((candidateId) => ({
            name: 'household-fit-matrix',
            input: { candidateId },
          })),
        },
        structuredOutputTurn(HOUSEHOLD_FIT_ROUND2_RESULT),
      ],
    },
  });
}

// --- source-challenger ---

const CHALLENGE_ROUND1_RESULT: ExecutionResult = {
  obligationId: 'car.deal_normalization',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "Verified: candidate-rav4's true out-the-door price of $33,291.30 (after a mandatory $2,394.00 Value Protection Package and a 75-month financing term) is a real, sourced conflict with its $27,995.00 advertised price — $1,291.30 over the household's $32,000.00 maximum budget, not a data error.",
      stance: 'opposes',
      confidence: 0.95,
      sourceIds: ['source-dealer-offer-candidate-rav4'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-dealer-offer-candidate-rav4',
      level: 'E1',
      verdict: 'degraded',
      summary:
        'Re-verified against the dealer offer terms: the teaser-price conflict is real and material.',
    },
  ],
  limitations: [],
  suggestedStatus: 'open',
};

const CHALLENGE_ROUND2_RESULT: ExecutionResult = {
  obligationId: 'car.deal_normalization',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "Final review: candidate-rav4's budget-exceeding true price is fully documented and does not change on re-verification; it is a hard-constraint failure. The remaining three candidates' normalized prices are clean and comparable.",
      stance: 'opposes',
      confidence: 0.95,
      sourceIds: ['source-dealer-offer-candidate-rav4'],
    },
    {
      statement:
        "candidate-outback's disputed reliability rating is upheld on review: both source-consumer-drive-index and source-autotrust-reliability-survey remain current, traceable, and legitimately measuring different things. Neither source is stale or wrong.",
      stance: 'neutral',
      confidence: 0.8,
      sourceIds: ['source-consumer-drive-index', 'source-autotrust-reliability-survey'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-dealer-offer-candidate-rav4',
      level: 'E2',
      verdict: 'pass',
      summary:
        'Final, corroborated normalized comparison across all four candidates: candidate-rav4 exceeds budget; candidate-crv, candidate-cx5, and candidate-outback all comply.',
    },
  ],
  limitations: [],
  suggestedStatus: 'satisfied',
};

function buildSourceChallengerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'listing-reader', input: { candidateId: 'candidate-rav4' } }] },
        {
          toolCalls: [
            { name: 'safety-reliability-lookup', input: { candidateId: 'candidate-outback' } },
          ],
        },
        structuredOutputTurn(CHALLENGE_ROUND1_RESULT),
      ],
      round2: [
        { toolCalls: [{ name: 'listing-reader', input: {} }] },
        structuredOutputTurn(CHALLENGE_ROUND2_RESULT),
      ],
    },
  });
}

// --- decision-synthesizer ---

export interface CarPurchaseProposal {
  readonly candidateIds: readonly string[];
  readonly rationale: string;
}

/** Round 1's `propose_recommendation` call: initially favors `candidate-rav4`. */
export const PROPOSAL_ROUND1: CarPurchaseProposal = {
  candidateIds: ['candidate-rav4'],
  rationale:
    'Under the current weighting (safety/reliability 30%, ownership cost 30%), candidate-rav4 has the cleanest, uncontested best safety and reliability record and the best fuel economy of the four candidates. Its deal terms are still under review.',
};

const DECISION_TEXT_ROUND1 =
  'Recommend candidate-rav4 per source-national-crash-safety-consortium, source-northfield-vehicle-safety-lab, and source-consumer-drive-index — the strongest, least-disputed safety and reliability record, and the best fuel economy of the four candidates. Its deal terms remain under review (source-dealer-offer-candidate-rav4).';

/** Round 2's `propose_recommendation` call: revised to favor `candidate-crv`, with `candidate-outback` as the close alternative. */
export const PROPOSAL_ROUND2: CarPurchaseProposal = {
  candidateIds: ['candidate-crv', 'candidate-outback'],
  rationale:
    "candidate-rav4 is disqualified: its normalized true out-the-door price ($33,291.30) exceeds the household's $32,000.00 hard-constraint budget by $1,291.30. Among the three budget-compliant candidates, candidate-crv has the most second-row legroom (favorable for the new rear-facing-seat requirement) and is tied for the lowest 5-year ownership cost. candidate-outback is offered as the close alternative: comparably priced and safety-rated, though its reliability rating is genuinely disputed between two sources. Driving comfort and whether a rear-facing seat clears the driver's seating position remain open in-person questions for both.",
};

const DECISION_TEXT_ROUND2 =
  'Revise the shortlist to candidate-crv, with candidate-outback as a close alternative. candidate-rav4 is disqualified per source-dealer-offer-candidate-rav4 (true price over the household budget). candidate-crv has the most second-row legroom per source-household-fit-candidate-crv and is tied for lowest ownership cost per source-ownership-calculator-candidate-crv. candidate-outback remains competitive per source-national-crash-safety-consortium but carries a disputed reliability rating per source-consumer-drive-index and source-autotrust-reliability-survey. Rear-facing seat fit and driving comfort still have to be checked in the car itself, for both.';

function buildDecisionSynthesizerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        {
          toolCalls: [
            {
              name: PROPOSE_RECOMMENDATION_TOOL_ID,
              input: {
                candidateIds: [...PROPOSAL_ROUND1.candidateIds],
                rationale: PROPOSAL_ROUND1.rationale,
              },
            },
          ],
        },
        { text: DECISION_TEXT_ROUND1 },
      ],
      round2: [
        {
          toolCalls: [
            {
              name: PROPOSE_RECOMMENDATION_TOOL_ID,
              input: {
                candidateIds: [...PROPOSAL_ROUND2.candidateIds],
                rationale: PROPOSAL_ROUND2.rationale,
              },
            },
          ],
        },
        { text: DECISION_TEXT_ROUND2 },
      ],
    },
  });
}

/** Every scripted `ExecutionResult` this module produces, exported for direct schema/content assertions (`car-purchase.test.ts`) independent of driving a real `Agent`. */
export const CAR_PURCHASE_SCRIPTED_EXECUTION_RESULTS = {
  dealRound1: DEAL_ROUND1_RESULT,
  dealRound2: DEAL_ROUND2_RESULT,
  ownership: OWNERSHIP_RESULT,
  safety: SAFETY_RESULT,
  householdFitRound1: HOUSEHOLD_FIT_ROUND1_RESULT,
  householdFitRound2: HOUSEHOLD_FIT_ROUND2_RESULT,
  challengeRound1: CHALLENGE_ROUND1_RESULT,
  challengeRound2: CHALLENGE_ROUND2_RESULT,
} as const;

export interface CarPurchaseScriptedProviders {
  'deal-analyst': ScriptedModelProvider;
  'ownership-cost-analyst': ScriptedModelProvider;
  'safety-reliability-analyst': ScriptedModelProvider;
  'household-fit-analyst': ScriptedModelProvider;
  'source-challenger': ScriptedModelProvider;
  'decision-synthesizer': ScriptedModelProvider;
}

/**
 * Builds one fresh `ScriptedModelProvider` per car-purchase Graph node, each
 * pre-loaded with both `round1` and `round2` beats. The caller (the scenario
 * engine) calls `provider.setBeat('round1' | 'round2')` on every provider
 * before each of the two `executeCarPurchaseGraph` invocations the scenario
 * makes.
 */
export function buildCarPurchaseScriptedProviders(): CarPurchaseScriptedProviders {
  return {
    'deal-analyst': buildDealAnalystProvider(),
    'ownership-cost-analyst': buildOwnershipCostAnalystProvider(),
    'safety-reliability-analyst': buildSafetyReliabilityAnalystProvider(),
    'household-fit-analyst': buildHouseholdFitAnalystProvider(),
    'source-challenger': buildSourceChallengerProvider(),
    'decision-synthesizer': buildDecisionSynthesizerProvider(),
  };
}

/** `CarPurchaseGraphDeps.modelFor` built directly from a `CarPurchaseScriptedProviders` bundle. */
export function scriptedModelFor(
  providers: CarPurchaseScriptedProviders,
): (nodeId: CarPurchaseGraphNodeId) => ScriptedModelProvider {
  return (nodeId) => providers[nodeId];
}

/** Sets every provider in the bundle to the same beat, before one `executeCarPurchaseGraph` round. */
export function setScenarioBeat(
  providers: CarPurchaseScriptedProviders,
  beat: CarPurchaseScenarioBeat,
): void {
  for (const nodeId of CAR_PURCHASE_GRAPH_NODE_IDS) {
    providers[nodeId].setBeat(beat);
  }
}
