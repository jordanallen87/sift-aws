/**
 * The exact scripted `ModelProvider` response sequence driving the real
 * Home Energy Guardian Strands Swarm (`../home-energy-swarm.js`)
 * deterministically through the pack's required demo trajectory
 * (docs/specs/packs-and-routing.md "Home Energy Guardian Decision Pack" ->
 * "Required adaptive moments"), the analogous file to
 * `scripted-beats/car-purchase.ts` for the Swarm-hero pack.
 *
 * - `round1`: the initial investigation under the pack's default 80/20
 *   cost-heavy cost/conservation criteria, where the scripted synthesis
 *   genuinely favors the cheapest response option -- `monitor-one-cycle` --
 *   rather than coincidentally landing on the root-cause fix regardless of
 *   weighting (see the arithmetic note below). The pack's default and this
 *   beat's narration are the same weighting on purpose, and
 *   `home-energy-guardian.test.ts` fails if they diverge.
 *   Exercises: anomaly-first ordering, the weather steering-then-handoff
 *   moment, and a cost-favoring synthesis that does not propose an
 *   inspection.
 * - `round2`: the household reweights toward long-term waste reduction
 *   (20/80 cost/conservation). Run starting directly at
 *   `decision-synthesizer` (its own turns do not depend on how the Swarm
 *   reached it), it now favors `request-hvac-inspection` and calls
 *   `propose_inspection`, requiring human confirmation.
 *
 * Every number below is the REAL output of the real fixture data
 * (`packages/scenarios/fixtures/energy/*.json`, read directly while
 * authoring this file -- see the dated docs/build-log.md entry). In
 * particular:
 *
 * - The current bill totals $248.50, 42% above the weather- and
 *   trend-normalized baseline of $175.00 (current-bill.json), 490 kWh above
 *   the 1,075 kWh baseline usage.
 * - The tariff change from `tariff-standard-2024` to `tariff-standard-2026`
 *   (rate-schedules.json) accounts for $18.62 (20.21%) of the $92.12 total
 *   gap versus the prior tariff at baseline usage, holding usage constant.
 * - Weather (weather-history.json's current-cycle `weatherAttribution`: 80
 *   excess cooling degree days at 2.625 kWh/CDD) explains 210 of the 490 kWh
 *   usage gap, leaving 280 kWh unexplained by rate change or weather alone.
 * - `event-thermostat-failure-2026-07` (household-events.json): a smart
 *   thermostat sensor-drift fault first observed 2026-07-19, 3 days into the
 *   anomalous cycle, plausibly accounting for the unexplained 280 kWh.
 * - `response-options.json`'s four options, scored by this file's own
 *   `costWeight`/`conservationWeight` arithmetic (matching
 *   `energy-calculator.ts`'s `evaluateResponseOptions` formula exactly --
 *   `costScore = 1 - roughCost / maxRoughCostAmongOptions`,
 *   `conservationScore = addressesRootCause ? 1 : 0`,
 *   `fitScore = costWeight*costScore + conservationWeight*conservationScore`,
 *   `maxRoughCostAmongOptions = 250` (request-energy-audit's cost)): at
 *   80/20 (cost-heavy), `monitor-one-cycle`/`change-rate-plan` both score
 *   0.80 versus `request-hvac-inspection`'s 0.47 -- the cheap options win.
 *   At 20/80 (conservation-heavy), `request-hvac-inspection` scores 0.87
 *   versus `monitor-one-cycle`'s 0.20 -- the root-cause fix wins. This is
 *   the real arithmetic proof behind packs-and-routing.md's required
 *   adaptive moment "Changing the criterion from lowest immediate cost to
 *   long-term waste reduction changes option ranking" -- not an asserted
 *   final string, but the actual scored crossover this file's two beats
 *   dramatize.
 *
 * `energy.no_emergency_risk`/`energy.user_concern` are not exercised here:
 * the shipped demo scenario is never an emergency (home-energy-guardian.ts's
 * own module header) and no case-specific extension is part of this
 * trajectory.
 */
import type { ExecutionResult } from '@sift/contracts';
import type { JSONValue } from '@strands-agents/sdk';
import { PROPOSE_INSPECTION_TOOL_ID } from '../home-energy-swarm.js';
import { ScriptedModelProvider, type ScriptedTurn } from '../model-provider.js';
import { HOME_ENERGY_SWARM_NODE_IDS, type HomeEnergySwarmNodeId } from '../home-energy-swarm.js';

export const HOME_ENERGY_SCENARIO_BEATS = ['round1', 'round2'] as const;
export type HomeEnergyScenarioBeat = (typeof HOME_ENERGY_SCENARIO_BEATS)[number];

interface ScriptedHandoffOutput {
  agentId?: string;
  message: string;
  context?: ExecutionResult;
}

function structuredOutputTurn(output: ScriptedHandoffOutput): ScriptedTurn {
  return {
    toolCalls: [{ name: 'strands_structured_output', input: output as unknown as JSONValue }],
  };
}

// --- Response-option scoring arithmetic (see module header) ---

export const RESPONSE_OPTION_MAX_ROUGH_COST = 250;

export interface ResponseOptionFacts {
  optionId: string;
  roughCost: number;
  addressesRootCause: boolean;
}

export const RESPONSE_OPTIONS: readonly ResponseOptionFacts[] = [
  { optionId: 'monitor-one-cycle', roughCost: 0, addressesRootCause: false },
  { optionId: 'change-rate-plan', roughCost: 0, addressesRootCause: false },
  { optionId: 'request-energy-audit', roughCost: 250, addressesRootCause: false },
  { optionId: 'request-hvac-inspection', roughCost: 165, addressesRootCause: true },
];

/** Reproduces `energy-calculator.ts`'s `evaluateResponseOptions` fit-score formula exactly, for this file's own documented arithmetic (see module header). */
export function fitScore(
  option: ResponseOptionFacts,
  costWeight: number,
  conservationWeight: number,
): number {
  const costScore = 1 - option.roughCost / RESPONSE_OPTION_MAX_ROUGH_COST;
  const conservationScore = option.addressesRootCause ? 1 : 0;
  const totalWeight = costWeight + conservationWeight;
  return (
    Math.round(
      ((costWeight * costScore + conservationWeight * conservationScore) / totalWeight) * 100,
    ) / 100
  );
}

// --- energy.anomaly (anomaly-investigator) ---

export const ANOMALY_CONTEXT: ExecutionResult = {
  obligationId: 'energy.anomaly',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'The current bill totals $248.50, 42% above the weather- and trend-normalized baseline of $175.00 (490 kWh above the 1,075 kWh baseline usage), independently re-verified as materially abnormal against a 15% threshold.',
      stance: 'supports',
      confidence: 0.95,
      sourceIds: ['source-energy-calculator-anomaly'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-energy-calculator-anomaly',
      level: 'E3',
      verdict: 'pass',
      summary:
        'Current bill $248.50 is 42% above the normalized baseline of $175.00 (threshold 15%): materially abnormal.',
    },
  ],
  limitations: [],
  suggestedStatus: 'satisfied',
};

function buildAnomalyInvestigatorProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'bill-normalizer' } }] },
        { toolCalls: [{ name: 'bill-reader', input: {} }] },
        { toolCalls: [{ name: 'calculator', input: {} }] },
        // Deliberate overreach, and the only scripted turn here that is
        // *meant* to fail. Having measured a 42% spike, the bill specialist
        // reaches for the household device log to explain it -- a tool the
        // compiled pack grants to `home-systems-analyst`, not to this node
        // (`allowedTools` here is bill-reader / usage-history-query /
        // calculator). The real `ScopeAuthorization` intervention denies it
        // before it executes.
        //
        // This is scripted because the guard cannot be demonstrated
        // otherwise: a scripted provider only ever asks for what it is told
        // to ask for, so with every turn inside the grant, `Deny` -- one of
        // the three intervention outcomes docs/engineering-principles.md
        // requires to be *visible* -- would never fire outside a unit test
        // that patches this provider on purpose. What is scripted is the
        // model's overreach, which is an ordinary real-world failure mode;
        // what does the denying is real code reading the real compiled pack.
        // It is also the honest answer to "why hand off at all instead of
        // letting one agent do everything": it cannot.
        { toolCalls: [{ name: 'household-event-lookup', input: {} }] },
        structuredOutputTurn({
          agentId: 'rate-analyst',
          message:
            'Confirmed the current bill is materially abnormal (42% above the normalized baseline, per source-energy-calculator-anomaly). Handing off to rate-analyst to isolate how much of the increase is attributable to the tariff change.',
          context: ANOMALY_CONTEXT,
        }),
      ],
    },
  });
}

// --- energy.rate_change (rate-analyst) ---

export const RATE_CHANGE_CONTEXT: ExecutionResult = {
  obligationId: 'energy.rate_change',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'At the normalized baseline usage of 1,075 kWh, the tariff change from tariff-standard-2024 to tariff-standard-2026 accounts for $18.62 (20.21%) of the $92.12 total gap versus the prior tariff at baseline usage.',
      stance: 'supports',
      confidence: 0.9,
      sourceIds: [
        'source-energy-calculator-rate-change',
        'source-rate-schedule-tariff-standard-2026',
      ],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-energy-calculator-rate-change',
      level: 'E3',
      verdict: 'pass',
      summary:
        'At baseline usage (1075 kWh), the tariff change from tariff-standard-2024 to tariff-standard-2026 accounts for $18.62 (20.21%) of the $92.12 total gap.',
    },
    {
      sourceId: 'source-rate-schedule-tariff-standard-2026',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Residential Standard Service (current tariff), effective 2026-06-01: $13.75 fixed + $0.150/kWh.',
    },
  ],
  limitations: [],
  suggestedStatus: 'satisfied',
};

function buildRateAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'rate-plan-analysis' } }] },
        { toolCalls: [{ name: 'tariff-lookup', input: {} }] },
        { toolCalls: [{ name: 'calculator', input: {} }] },
        structuredOutputTurn({
          agentId: 'weather-analyst',
          message:
            'The tariff change explains $18.62 (20.21%) of the total gap, per source-energy-calculator-rate-change. Handing off to weather-analyst to isolate how much of the remaining usage-driven gap is explained by weather.',
          context: RATE_CHANGE_CONTEXT,
        }),
      ],
    },
  });
}

// --- energy.weather (weather-analyst) -- the required steering moment ---

export const WEATHER_CONTEXT: ExecutionResult = {
  obligationId: 'energy.weather',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'Weather explains 210 of the 490 kWh usage gap (80 excess cooling degree days at 2.625 kWh/CDD), leaving 280 kWh unexplained by rate change or weather alone.',
      stance: 'neutral',
      confidence: 0.85,
      sourceIds: ['source-energy-calculator-weather', 'source-weather-history-2026-08'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-energy-calculator-weather',
      level: 'E3',
      verdict: 'pass',
      summary: '80 excess CDD at 2.625 kWh/CDD explains 210 kWh of the usage increase.',
    },
    {
      sourceId: 'source-weather-history-2026-08',
      level: 'E1',
      verdict: 'pass',
      summary: 'Cycle 2026-08 (2026-07-16 to 2026-08-14): 0 HDD, 460 CDD.',
    },
  ],
  limitations: [
    '210 of the 490 kWh usage gap is explained by weather; the remaining 280 kWh requires household-event correlation.',
  ],
  suggestedStatus: 'accepted_uncertainty',
};

/**
 * `weather-analyst`'s two identical `weather-lookup` calls deliberately
 * repeat the same normalized arguments -- `RetrySteering`'s
 * `matchesPriorQueryFamily` condition (strands-runtime.md "Retry steering
 * rules": "a search repeats a prior query family without explaining a new
 * angle") fires `Guide` on the second call. The third call pivots to
 * `calculator` -- a genuinely different technique, matching strands-
 * runtime.md's "The guidance identifies an allowed alternative technique
 * from the active skill" -- before the specialist hands off to
 * `home-systems-analyst` because weather explains only part of the gap.
 * This is strands-runtime.md's own worked "Energy Swarm" example verbatim:
 * "the required 'repeated weather work -> Guide -> handoff to
 * home-systems-analyst' trajectory."
 */
function buildWeatherAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'weather-comparison' } }] },
        { toolCalls: [{ name: 'weather-lookup', input: { cycleLabel: '2026-08' } }] },
        { toolCalls: [{ name: 'weather-lookup', input: { cycleLabel: '2026-08' } }] },
        { toolCalls: [{ name: 'calculator', input: {} }] },
        structuredOutputTurn({
          agentId: 'home-systems-analyst',
          message:
            'Weather explains 210 of the 490 kWh gap (per source-energy-calculator-weather) but not all of it. Handing off to home-systems-analyst to check for a correlated household or appliance event that explains the remaining 280 kWh.',
          context: WEATHER_CONTEXT,
        }),
      ],
    },
  });
}

// --- energy.household_change (home-systems-analyst) ---

export const HOUSEHOLD_CHANGE_CONTEXT: ExecutionResult = {
  obligationId: 'energy.household_change',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'A smart-thermostat sensor-drift fault (event-thermostat-failure-2026-07), first observed 2026-07-19 (3 days into the anomalous billing cycle), plausibly accounts for the 280 kWh not explained by the rate change or weather.',
      stance: 'supports',
      confidence: 0.7,
      sourceIds: ['source-household-event-event-thermostat-failure-2026-07'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-household-event-event-thermostat-failure-2026-07',
      level: 'E1',
      verdict: 'pass',
      summary: '2026-07-19: Smart thermostat sensor drift first observed (thermostat_malfunction).',
    },
  ],
  limitations: [
    'A plausible, not certain, explanation — household-events.json supports correlation, not proof.',
  ],
  suggestedStatus: 'accepted_uncertainty',
};

function buildHomeSystemsAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'home-event-correlation' } }] },
        {
          toolCalls: [
            {
              name: 'household-event-lookup',
              input: { eventId: 'event-thermostat-failure-2026-07' },
            },
          ],
        },
        structuredOutputTurn({
          agentId: 'source-challenger',
          message:
            'The thermostat sensor-drift fault (event-thermostat-failure-2026-07) plausibly explains the 280 kWh remaining gap, per source-household-event-event-thermostat-failure-2026-07. Handing off to source-challenger to review the full evidence chain before synthesis.',
          context: HOUSEHOLD_CHANGE_CONTEXT,
        }),
      ],
    },
  });
}

// --- energy.response_options review (source-challenger) ---

export const CHALLENGE_CONTEXT: ExecutionResult = {
  obligationId: 'energy.response_options',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'Re-verified: the current bill and the thermostat-failure event both check out against their own source documents with no contradictions. The anomaly, rate-change, weather, and household-event findings are ready for synthesis.',
      stance: 'supports',
      confidence: 0.9,
      sourceIds: [
        'source-current-bill-household-demo-energy-01',
        'source-household-event-event-thermostat-failure-2026-07',
      ],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-current-bill-household-demo-energy-01',
      level: 'E1',
      verdict: 'pass',
      summary: 'Re-verified against the bill-reader source: no contradictions found.',
    },
    {
      sourceId: 'source-household-event-event-thermostat-failure-2026-07',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Re-verified against the household-event-lookup source: timing and status check out.',
    },
  ],
  limitations: [],
  suggestedStatus: 'open',
};

function buildSourceChallengerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'bill-reader', input: {} }] },
        {
          toolCalls: [
            {
              name: 'household-event-lookup',
              input: { eventId: 'event-thermostat-failure-2026-07' },
            },
          ],
        },
        structuredOutputTurn({
          message:
            'Every finding checks out with no contradictions, per source-current-bill-household-demo-energy-01 and source-household-event-event-thermostat-failure-2026-07. Handing off to decision-synthesizer for the final response-options synthesis.',
          agentId: 'decision-synthesizer',
          context: CHALLENGE_CONTEXT,
        }),
      ],
    },
  });
}

// --- energy.response_options synthesis (decision-synthesizer) ---

/** Round 1's fit scores at cost-heavy 80/20 weighting (see module header arithmetic): cheap options win. */
export const ROUND1_COST_WEIGHT = 80;
export const ROUND1_CONSERVATION_WEIGHT = 20;

/**
 * The option round 1 recommends.
 *
 * Exported so `home-energy-guardian.test.ts` can assert the thing that
 * actually matters and was not previously checked anywhere: that the option
 * this beat recommends is the option the *pack's shipped default weighting*
 * ranks first. Round 1's narration only tells the truth if the case a person
 * starts is weighted the way the narration says it is, and nothing tied those
 * two facts together until that test did.
 */
export const ROUND1_RECOMMENDED_OPTION_ID = 'monitor-one-cycle';

/** Round 2's fit scores at conservation-heavy 20/80 weighting: the root-cause fix wins. */
export const ROUND2_COST_WEIGHT = 20;
export const ROUND2_CONSERVATION_WEIGHT = 80;

/**
 * Exported (not module-private) for the same direct-unit-testability reason
 * `scripted-beats/bid-comparison.ts` exports its own `DECISION_TEXT_ROUND1`/
 * `DECISION_TEXT_ROUND2`: `home-energy-engine.test.ts`'s
 * `stripInlineSourceCitations` suite pins its cleanup against this pack's
 * real shipped prose, not a hand-typed stand-in that could silently drift
 * from what a person actually sees.
 */
export const DECISION_TEXT_ROUND1 =
  "Given the household's current criteria (energy.cost weight 80, energy.conservation weight 20), the lowest-cost options score highest: monitor-one-cycle and change-rate-plan both score 0.80, versus request-hvac-inspection's 0.47. Recommend monitoring for one more billing cycle (monitor-one-cycle) before taking further action, per source-current-bill-household-demo-energy-01 and source-household-event-event-thermostat-failure-2026-07. No inspection is proposed at this weighting.";

export const PROPOSED_INSPECTION_ROUND2 = {
  optionId: 'request-hvac-inspection',
  rationale:
    "Addresses the confirmed thermostat sensor-drift root cause (event-thermostat-failure-2026-07); scores 0.87 under the household's now conservation-weighted criteria (energy.cost weight 20, energy.conservation weight 80) versus monitor-one-cycle's 0.20.",
};

export const DECISION_TEXT_ROUND2 =
  'Recommend requesting an HVAC/thermostat inspection (request-hvac-inspection) to address the confirmed thermostat sensor-drift root cause, per source-household-event-event-thermostat-failure-2026-07. Under the reweighted conservation-focused criteria this scores highest (0.87) versus monitor-one-cycle (0.20).';

function buildDecisionSynthesizerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        // A first draft that sounds entirely reasonable and cites nothing.
        //
        // This is not padding. `decision-synthesizer`'s real `GoalLoop`
        // validator requires a `source-` id, so this attempt is genuinely
        // rejected by the same validator the release gate exercises, and
        // the corrected attempt below is what actually reaches the case.
        // Before this, round 1 validated on attempt 1 and the whole
        // rejection path -- the product's clearest demonstration that it
        // will not ship an unsupported answer -- existed only inside a unit
        // test, while the UI built to display it sat unreachable.
        //
        // `maxAttempts: 2` means there is exactly one retry, so a second
        // failure would surface as a real failure rather than loop.
        structuredOutputTurn({
          message: 'Monitoring for one more billing cycle looks like the sensible call here.',
        }),
        structuredOutputTurn({
          message: DECISION_TEXT_ROUND1,
        }),
      ],
      round2: [
        {
          toolCalls: [
            {
              name: PROPOSE_INSPECTION_TOOL_ID,
              input: { ...PROPOSED_INSPECTION_ROUND2 },
            },
          ],
        },
        structuredOutputTurn({
          message: DECISION_TEXT_ROUND2,
        }),
      ],
    },
  });
}

export interface HomeEnergySwarmScriptedProviders extends Record<
  HomeEnergySwarmNodeId,
  ScriptedModelProvider
> {
  'anomaly-investigator': ScriptedModelProvider;
  'rate-analyst': ScriptedModelProvider;
  'weather-analyst': ScriptedModelProvider;
  'home-systems-analyst': ScriptedModelProvider;
  'source-challenger': ScriptedModelProvider;
  'decision-synthesizer': ScriptedModelProvider;
}

/**
 * Builds one fresh `ScriptedModelProvider` per Home Energy Guardian Swarm
 * node. `decision-synthesizer` carries both `round1`/`round2` beats; the
 * other five carry only `round1` (they are never visited when a test starts
 * the Swarm directly at `decision-synthesizer` for the round2 reweight
 * scenario). The caller calls `provider.setBeat(...)` on every provider it
 * intends to exercise before invoking the Swarm.
 */
export function buildHomeEnergySwarmScriptedProviders(
  /** Optional demo pacing, forwarded to every provider. 0 (the default) is what every test and gate uses -- see `ScriptedModelProvider.turnDelayMs`. */
  turnDelayMs = 0,
): HomeEnergySwarmScriptedProviders {
  const paced = <T extends ScriptedModelProvider>(provider: T): T => {
    provider.setTurnDelayMs(turnDelayMs);
    return provider;
  };
  return {
    'anomaly-investigator': paced(buildAnomalyInvestigatorProvider()),
    'rate-analyst': paced(buildRateAnalystProvider()),
    'weather-analyst': paced(buildWeatherAnalystProvider()),
    'home-systems-analyst': paced(buildHomeSystemsAnalystProvider()),
    'source-challenger': paced(buildSourceChallengerProvider()),
    'decision-synthesizer': paced(buildDecisionSynthesizerProvider()),
  };
}

/** `HomeEnergySwarmDeps.modelFor` built directly from a `HomeEnergySwarmScriptedProviders` bundle. */
export function scriptedModelFor(
  providers: HomeEnergySwarmScriptedProviders,
): (nodeId: HomeEnergySwarmNodeId) => ScriptedModelProvider {
  return (nodeId) => providers[nodeId];
}

/** Sets every provider in the bundle to the same beat, before one `executeHomeEnergySwarm` round. */
export function setScenarioBeat(
  providers: HomeEnergySwarmScriptedProviders,
  beat: HomeEnergyScenarioBeat,
): void {
  for (const nodeId of HOME_ENERGY_SWARM_NODE_IDS) {
    providers[nodeId].setBeat(beat);
  }
}
