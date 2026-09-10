/**
 * The exact scripted `ModelProvider` response sequence driving the real Bid
 * Comparison Strands Swarm (`../bid-comparison-swarm.js`) deterministically
 * through the pack's required demo trajectory (docs/bid-comparison/plan.md
 * "The Strands beats, placed deliberately"), the analogous file to
 * `scripted-beats/home-energy-guardian.ts` for this codebase's second
 * Swarm-orchestrated pack.
 *
 * --- Scaled from three bids to twelve (2026-09-08) ---
 *
 * A real commercial/public trade-package solicitation routinely draws
 * 10-30+ bidders through a plan room, not a hand-picked handful -- three
 * bids is a chore a person will actually compare by hand; twelve with
 * mismatched scopes and credentials is exactly the case where a person
 * gives up and sorts by the bottom-line number instead, which is precisely
 * the failure mode this pack exists to catch. `BID_FACTS` below now carries
 * all twelve of `packages/scenarios/fixtures/bids/*.json`'s bid fixtures,
 * but the demo's three load-bearing beats are unchanged in kind, only in
 * dollar scale (the job itself also scaled, from a residential bathroom
 * remodel to a public school's restroom/locker-room plumbing package, so
 * twelve bidders is plausible): Northgate Plumbing is still the
 * recommendation, Cedar & Sons is still the scope-normalization beat, and
 * Two Rivers Mechanical is still the round-2 hard-constraint beat. A fourth
 * beat is new at this scale: Fieldstone Plumbing Co.'s bid is the lowest
 * scope-normalized adjusted total of all twelve, and the only one that comes
 * in under Northgate Plumbing once every bid is on the same scope basis --
 * the bid a person comparing on the CORRECTED numbers would pick, which is
 * the sharper version of the beat -- and it fails credential verification on
 * a THIRD,
 * genuinely distinct ground from Two Rivers' (its license class carries no
 * plumbing trade endorsement for this scope, not a named-insured mismatch).
 * The other eight bids are also-rans: realistic variety in total, deposit,
 * warranty, schedule, and (for two of them) their own single-item scope
 * gaps, none of which disturbs the recommendation -- see `BID_FACTS`'s own
 * doc comment for the verified invariants this design satisfies. Prose
 * below summarizes this larger set ("seven of the other nine...", "eight of
 * the other nine...") and names individually only the four bids the
 * narrative actually turns on, rather than enumerating all twelve --
 * unreadable at three bids' worth of individual mentions, let alone
 * twelve's.
 *
 * - `round1`: the initial investigation under the pack's default criteria
 *   weighting (`bid.adjusted_total` 45 / `bid.scope_completeness` 20 /
 *   `bid.payment_risk` 15 / `bid.schedule_fit` 10 / `bid.warranty` 10,
 *   `packages/packs/src/bid-comparison.ts`'s own `criteria.defaults`).
 *   Exercises, in order, all four beats this task requires reachable in one
 *   shipped trajectory:
 *     - **Deny** -- `price-analyst` reaches for `license-lookup`, granted
 *       only to `credential-checker`.
 *     - **Guide** -- `scope-analyst` runs `scope-differ` twice on the same
 *       bid pair with no new angle, then a third, genuinely different call
 *       (the full twelve-bid comparison) succeeds.
 *     - **GoalLoop** -- `decision-synthesizer`'s first draft ranks bids on
 *       raw quoted totals and is rejected; the corrected draft ranks on
 *       scope-normalized adjusted totals and cites the plug numbers.
 *     - **Confirm** -- `decision-synthesizer` calls `propose_award`, gated
 *       by `ConsequenceGuard` on human confirmation.
 *   Round 1 recommends awarding to Northgate Plumbing: once Cedar & Sons'
 *   bid is adjusted for the three required scope items it leaves absent,
 *   its $279,000.00 adjusted total is higher than Northgate's $276,000.00,
 *   and Northgate also leads on scope completeness (100% vs. 62.5%) and
 *   payment risk (25% vs. 45% deposit) -- the two next-heaviest-weighted
 *   criteria. Two Rivers Mechanical and Fieldstone Plumbing Co. are each
 *   never a contender, on two different grounds: Two Rivers' certificate of
 *   insurance does not name its license holder, and Fieldstone's license
 *   class does not cover this scope of work -- so neither's credentials
 *   verify as valid (the pack's protected `bid.credentials_valid` hard
 *   constraint). Northgate genuinely outscores every other bid on raw score
 *   too, Two Rivers included, at this weighting -- `scoreBids`'s own round1
 *   test proves this directly, not just the constraint-first sort.
 * - `round2`: the person choosing reweights toward warranty length and payment
 *   risk (`bid.warranty` and `bid.payment_risk` raised, `bid.adjusted_total`
 *   reduced accordingly -- `ROUND2_CRITERIA_WEIGHTS`). Run starting directly
 *   at `decision-synthesizer` (mirroring `home-energy-guardian.ts`'s
 *   identical round2 structure), this is the pack's one genuine exercise of
 *   the protected `bid.credentials_valid` hard constraint at the very top of
 *   the board (round1 never puts a constraint-violator at the top of the raw
 *   score either, so round2 is where the hard constraint first has to do
 *   real, visible work): `scoreBids(ROUND2_CRITERIA_WEIGHTS)` gives Two
 *   Rivers Mechanical the highest raw score of all twelve bids -- it
 *   genuinely leads on both upweighted criteria (a 36-month warranty and a
 *   20% deposit) -- and it is still not recommended, because its
 *   certificate of insurance names "TRM Holdings LLC," not its license
 *   holder "Two Rivers Mechanical Inc." `packages/core/src/scoring.ts`'s own
 *   rule 4 ("A hard constraint flags; it never silently eliminates ...
 *   ranked below compliant ones") is what `scoreBids`'s sort mirrors, so the
 *   award stays with Northgate Plumbing -- the higher-scoring of the ten
 *   bids whose credentials are fully valid (Northgate's scope-normalized
 *   adjusted total, $276,000.00, is still lower than Cedar & Sons',
 *   $279,000.00) -- and `decision-synthesizer` names the exact discrepancy
 *   rather than a generic "constraint failed." This is the same thesis as
 *   round1's GoalLoop rejection (an unresolved fact blocks an
 *   otherwise-attractive number from being acted on) applied to a different
 *   kind of unresolved fact, one document-provenance rather than one
 *   scope-normalization.
 *
 *   A schedule-urgency reweight (`bid.schedule_fit` raised instead) was
 *   tried first and rejected on narrative grounds, not arithmetic ones: it
 *   is the only lever in this fixture set that can move the *award* itself
 *   off Northgate Plumbing, but the resulting recommendation -- awarding to
 *   Cedar & Sons, the bid whose silence on $55,500 of required scope this
 *   exact Swarm run just caught -- undercuts the round1 finding rather than
 *   building on it. `scoreBids`'s tests still cover that direction directly
 *   (it never even closes the Northgate/Cedar gap under the shipped round1
 *   or round2 weighting, let alone reverses it) as a documented, verified
 *   rejection.
 *
 * Every number below is the REAL output of the real fixture data
 * (`packages/scenarios/fixtures/bids/*.json` plus
 * `packages/scenarios/src/tools/{bid-reader,scope-differ,bid-calculator,
 * license-lookup}.ts`, computed directly against those exact tool
 * implementations while authoring this file, the same discipline the
 * original three-bid version of this file used).
 */
import type { ExecutionResult } from '@sift/contracts';
import type { JSONValue } from '@strands-agents/sdk';
import { PROPOSE_AWARD_TOOL_ID } from '../bid-comparison-swarm.js';
import { ScriptedModelProvider, type ScriptedTurn } from '../model-provider.js';
import {
  BID_COMPARISON_SWARM_NODE_IDS,
  type BidComparisonSwarmNodeId,
} from '../bid-comparison-swarm.js';

export const BID_COMPARISON_SCENARIO_BEATS = ['round1', 'round2'] as const;
export type BidComparisonScenarioBeat = (typeof BID_COMPARISON_SCENARIO_BEATS)[number];

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

// --- Criteria weights (see module header) ---

/** The pack's own shipped default weighting (`bid-comparison.ts`'s `criteria.defaults`). Round 1 uses this weighting verbatim -- `bid-comparison-swarm.test.ts` fails if this drifts out of sync with the manifest. */
export const ROUND1_CRITERIA_WEIGHTS = {
  adjustedTotal: 45,
  scopeCompleteness: 20,
  paymentRisk: 15,
  scheduleFit: 10,
  warranty: 10,
} as const;

/**
 * This is `docs/bid-comparison/plan.md`'s own suggested reweight target --
 * "move weight off `adjusted_total` toward `scope_completeness` and
 * `payment_risk`" -- adjusted to `bid.warranty` in place of
 * `bid.scope_completeness`, since scope completeness is where Two Rivers
 * Mechanical (the bid this reweight is meant to test) is merely tied with
 * Northgate Plumbing (both price all 8 required items), while warranty (36
 * months vs. Northgate's 24) is where it genuinely leads -- the reweight
 * needs to give the bid under test its best real case, not an arbitrary one.
 *
 * Verified with `scoreBids`, not hand-tuned to it: this weighting gives Two
 * Rivers Mechanical the highest raw score of all twelve bids -- it leads on
 * both of the two upweighted criteria -- and it still sorts below every
 * compliant bid, because `packages/core/src/scoring.ts`'s own rule 4 ranks
 * any hard-constraint violator below every compliant bid regardless of
 * score (with two violators in this twelve-bid set -- Two Rivers and
 * Fieldstone Plumbing Co. -- "sorts below every compliant bid" is the
 * precise claim; nothing requires it to sort literally last, only below
 * every compliant option, and `scoreBids`'s own tests verify exactly that).
 * Northgate Plumbing remains the higher-scoring of the ten credentials-valid
 * bids, so the award stays with Northgate: the numbers move, the constraint
 * does not, and the recommendation names both.
 *
 * The authoritative figures are production `scoreCaseState`'s, over the
 * wire in `tests/e2e/bid-comparison-journey.spec.ts` -- that spec asserts
 * against the live computation directly (never a hand-copied numeral) and
 * is the source to re-run for the current figures after this fixture set's
 * 2026-09-08 three-to-twelve-bid scaling; no specific score value is
 * asserted here because, per the note above `DECISION_TEXT_ROUND2`, none
 * may ever appear in a user-visible string, and `scoreBids` below is a
 * hand-written reproduction with no coverage concept, so it is expected to
 * disagree with production on any bid whose scope coverage is incomplete
 * (originally discovered on Cedar & Sons; the same caveat now applies to
 * Westbrook Mechanical Contractors and Brightwater Mechanical, this
 * fixture set's other two scope-incomplete bids).
 *
 * A schedule-urgency reweight (raising `bid.schedule_fit` instead) was
 * tried and rejected on narrative, not arithmetic, grounds -- see the
 * module header. It remains the only lever in this fixture set that can
 * move the *award itself* off Northgate Plumbing, which the tests below
 * verify directly as a documented, rejected alternative.
 */
export const ROUND2_CRITERIA_WEIGHTS = {
  adjustedTotal: 15,
  scopeCompleteness: 10,
  paymentRisk: 40,
  scheduleFit: 5,
  warranty: 30,
} as const;

/** The bid round 1's default weighting recommends. Exported so a pack-level test can assert this against the pack's own shipped default, mirroring `home-energy-guardian.ts`'s `ROUND1_RECOMMENDED_OPTION_ID`. */
export const ROUND1_RECOMMENDED_BID_ID = 'bid-northgate';
/**
 * The bid round 2's warranty/payment-risk-weighted criteria actually award.
 * Deliberately the SAME bid as round1: round2 is not a flip, it is
 * `bid-tworivers` scoring highest and being refused anyway -- see the
 * module header and `ROUND2_CRITERIA_WEIGHTS`'s own doc comment.
 */
export const ROUND2_RECOMMENDED_BID_ID = 'bid-northgate';

// --- Deterministic scoring parity proof (see module header) ---
//
// `home-energy-guardian.ts` proves its own round1/round2 crossover with a
// direct `fitScore` reproduction rather than merely asserting prose; this
// pack's ranking has five weighted criteria (one of them composed of two
// attributes) plus a protected hard constraint instead of two plain
// preference criteria, so the equivalent proof here is `scoreBids` below:
// real per-bid facts (the same figures this file's contexts and
// `decision-synthesizer` texts already cite), min-max normalized per
// criterion across the full twelve-bid set, weighted by whichever criteria
// weights a test supplies, and sorted by `packages/core/src/scoring.ts`'s
// own documented hard-constraint rule (see `scoreBids`'s doc comment) rather
// than by score alone. `bid-comparison.test.ts` exercises this directly to
// prove `ROUND1_RECOMMENDED_BID_ID`/`ROUND2_RECOMMENDED_BID_ID` are genuine
// scored outcomes of `ROUND1_CRITERIA_WEIGHTS`/`ROUND2_CRITERIA_WEIGHTS`,
// not just asserted text -- and, separately, that no weighting of these five
// criteria can ever put `bid-tworivers` first, because its hard-constraint
// violation is real and permanent, not a matter of degree.

export interface BidFacts {
  bidId: string;
  adjustedTotal: number;
  scopeCompleteness: number;
  depositPercent: number;
  startWeeks: number;
  durationDays: number;
  /** `null` mirrors `bid-calculator.ts`'s own `warrantyMonths: number | null` -- an explicit unknown, never coalesced to `0`. */
  warrantyMonths: number | null;
  /** The pack's protected `bid.credentials_valid` hard constraint. A bid with `false` here can still be scored and ranked by `scoreBids`, but never sorts above a bid with `true` here, at any weighting -- see `scoreBids`'s doc comment for the authoritative rule this mirrors. */
  credentialsValid: boolean;
}

/**
 * All twelve bids' real, fixture-derived facts -- see this file's module
 * header for where each figure comes from. `bid-northgate`/`bid-cedar`/
 * `bid-tworivers`/`bid-fieldstone` are the four the demo prose names
 * individually; the other eight are also-ran bids scaling this case to a
 * realistic twelve-bidder public bid tab, invented with real variety
 * (total, deposit, warranty, schedule, and -- for two of them -- their own
 * single-item scope gaps) rather than eight clones. `bid-comparison.test.ts`
 * proves every invariant this design depends on directly against
 * `scoreBids`, not just asserted here:
 *
 * - No credentials-valid bid's `adjustedTotal` undercuts Northgate
 *   Plumbing's $276,000.00 -- Northgate remains the cheapest scope-complete,
 *   credentials-valid bid of the twelve.
 * - `scoreBids(ROUND1_CRITERIA_WEIGHTS)` ranks Northgate first, genuinely
 *   outscoring every other bid on raw score, Two Rivers Mechanical included
 *   -- round1's cost-heavy weighting keeps the protected hard constraint
 *   from ever needing to do visible work at the top of the board.
 * - `scoreBids(ROUND2_CRITERIA_WEIGHTS)` gives Two Rivers Mechanical the
 *   highest RAW score of all twelve, and still sorts Northgate first, the
 *   pack's own hard-constraint rule 4 at work.
 * - Fieldstone Plumbing Co. -- the lowest scope-normalized adjusted total of
 *   all twelve, and the only bid under Northgate's once scope is corrected
 *   -- fails `credentialsValid` on a third, genuinely distinct ground from
 *   Two Rivers': `classCoversScope: false` (see `packages/scenarios/
 *   fixtures/bids/license-registry.json`), not a named-insured mismatch.
 *   It is real evidence this fixture set's `license-lookup.ts` header
 *   comment now documents as a genuinely reachable case against the
 *   checked-in registry.
 */
export const BID_FACTS: readonly BidFacts[] = [
  {
    bidId: 'bid-northgate',
    adjustedTotal: 276000,
    scopeCompleteness: 1,
    depositPercent: 25,
    startWeeks: 3,
    durationDays: 45,
    warrantyMonths: 24,
    credentialsValid: true,
  },
  {
    bidId: 'bid-cedar',
    adjustedTotal: 279000,
    scopeCompleteness: 0.625,
    depositPercent: 45,
    startWeeks: 1,
    durationDays: 35,
    warrantyMonths: null,
    credentialsValid: true,
  },
  {
    bidId: 'bid-tworivers',
    adjustedTotal: 288750,
    scopeCompleteness: 1,
    depositPercent: 20,
    startWeeks: 5,
    durationDays: 40,
    warrantyMonths: 36,
    // Its certificate of insurance does not name its license holder (see
    // `CREDENTIAL_CONTEXT` below) -- a settled, deterministic fact, not an
    // open question -- so it fails the protected `bid.credentials_valid`
    // hard constraint. Per `packages/core/src/scoring.ts`'s own rule 4, this
    // never removes it from the board, but it also never lets it outrank a
    // compliant bid, however favorably it would otherwise score.
    credentialsValid: false,
  },
  {
    bidId: 'bid-summit',
    adjustedTotal: 293000,
    scopeCompleteness: 1,
    depositPercent: 30,
    startWeeks: 4,
    durationDays: 42,
    warrantyMonths: 18,
    credentialsValid: true,
  },
  {
    bidId: 'bid-ironclad',
    adjustedTotal: 305000,
    scopeCompleteness: 1,
    depositPercent: 28,
    startWeeks: 3,
    durationDays: 48,
    warrantyMonths: 12,
    credentialsValid: true,
  },
  {
    bidId: 'bid-parkside',
    adjustedTotal: 300000,
    scopeCompleteness: 1,
    depositPercent: 35,
    startWeeks: 6,
    durationDays: 45,
    warrantyMonths: 24,
    credentialsValid: true,
  },
  {
    bidId: 'bid-westbrook',
    // Missing debris-haul-away alone (Northgate's own $6,000.00 priced
    // amount for that item is this bid's plug number -- see
    // `BID_COMPARISON_PLUG_NUMBERS` in seeds.ts): quoted $284,000.00 + a
    // $6,000.00 plug = $290,000.00, still well above Northgate's own
    // adjusted total.
    adjustedTotal: 290000,
    scopeCompleteness: 0.875,
    depositPercent: 32,
    startWeeks: 4,
    durationDays: 44,
    warrantyMonths: 12,
    credentialsValid: true,
  },
  {
    bidId: 'bid-anchor',
    adjustedTotal: 281000,
    scopeCompleteness: 1,
    depositPercent: 38,
    startWeeks: 4,
    durationDays: 45,
    warrantyMonths: 12,
    credentialsValid: true,
  },
  {
    bidId: 'bid-crestview',
    adjustedTotal: 309000,
    scopeCompleteness: 1,
    depositPercent: 25,
    startWeeks: 8,
    durationDays: 55,
    warrantyMonths: 24,
    credentialsValid: true,
  },
  {
    bidId: 'bid-fieldstone',
    // The lowest scope-normalized adjusted total of all twelve ($268,000.00,
    // complete scope, so adjustedTotal equals quotedTotal) -- the only bid
    // that comes in under Northgate Plumbing's $276,000.00 once every bid is
    // on the same scope basis, so it is the bid a person comparing on the
    // corrected numbers would pick. (It is NOT the lowest RAW quote: Cedar &
    // Sons' $223,500.00 is, which is the whole point of the Cedar beat.)
    // Its license class carries no
    // plumbing trade endorsement for this scope
    // (`license-registry.json`'s `classCoversScope: false`), a genuinely
    // distinct failure from Two Rivers Mechanical's named-insured mismatch.
    adjustedTotal: 268000,
    scopeCompleteness: 1,
    depositPercent: 40,
    startWeeks: 3,
    durationDays: 40,
    warrantyMonths: 12,
    credentialsValid: false,
  },
  {
    bidId: 'bid-brightwater',
    // Missing permits-inspections alone (Northgate's own $18,000.00 priced
    // amount for that item is this bid's plug number): quoted $278,000.00 +
    // an $18,000.00 plug = $296,000.00.
    adjustedTotal: 296000,
    scopeCompleteness: 0.875,
    depositPercent: 33,
    startWeeks: 5,
    durationDays: 46,
    warrantyMonths: 12,
    credentialsValid: true,
  },
  {
    bidId: 'bid-oldmill',
    adjustedTotal: 315000,
    scopeCompleteness: 1,
    depositPercent: 27,
    startWeeks: 5,
    durationDays: 50,
    warrantyMonths: 24,
    credentialsValid: true,
  },
];

export interface BidComparisonCriteriaWeights {
  adjustedTotal: number;
  scopeCompleteness: number;
  paymentRisk: number;
  scheduleFit: number;
  warranty: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 1.0 for the lowest `value` among `values`, 0.0 for the highest, linear between. All-equal values score 1.0 for every entry (no basis to prefer one over another). */
function normalizeLowerBetter(values: readonly number[], value: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 1;
  return (max - value) / (max - min);
}

/** 1.0 for the highest `value` among `values`, 0.0 for the lowest, linear between. All-equal values score 1.0 for every entry. */
function normalizeHigherBetter(values: readonly number[], value: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 1;
  return (value - min) / (max - min);
}

/** One bid's weighted score, plus whether it fails the protected `bid.credentials_valid` hard constraint. See `scoreBids`. */
export interface ScoredBid {
  readonly bidId: string;
  readonly score: number;
  readonly constraintViolated: boolean;
}

/**
 * Scores every bid in `BID_FACTS` against `weights`, normalized 0..1 per
 * criterion across the FULL twelve-bid candidate set -- matching
 * `packages/core/src/scoring.ts`'s own `buildScale`, which normalizes across
 * every option passed to `scoreCase`, constraint violators included, not
 * just the compliant subset.
 *
 * `bid.schedule_fit` is scored as the average of its two composed
 * attributes' own normalized scores (`bid-comparison.ts`'s own
 * `composedOfAttributes: ['bid.start_weeks', 'bid.duration_days']`), each
 * independently lower-is-better. A bid whose warranty term is an explicit
 * unknown (`warrantyMonths: null`) scores a neutral `0.5` on that one
 * criterion rather than the worst or best score -- it is genuinely unknown,
 * not a zero-month warranty and not a generous one.
 *
 * **Sort order is not "highest score wins".** `packages/core/src/
 * scoring.ts`'s own rule 4 ("A hard constraint flags; it never silently
 * eliminates. A violating option stays on the board, fully scored and
 * visibly labelled, ranked below compliant ones.") and its
 * `compareOptionScores` comparator ("Constraint violations dominate
 * everything ... ranked last, never removed, then score") are both
 * authoritative and verified directly against the installed source while
 * fixing this function for this task -- see the dated docs/build-log.md
 * entry. `bid-tworivers` therefore never sorts above a compliant bid here,
 * no matter how high its own weighted score computes, because its
 * insurance certificate does not name its license holder
 * (`CREDENTIAL_CONTEXT` below) -- a settled, deterministic fact, not an
 * unresolved unknown. An earlier version of this function modeled a failed
 * hard constraint as removing the bid from consideration entirely (filtering
 * it out of the returned list); that does not match the real engine's own
 * documented "flags, never eliminates" rule, so this version scores every
 * bid and sorts constraint violators after every compliant bid instead,
 * exactly as `compareOptionScores` does.
 *
 * Returns bids sorted best-first under that rule.
 */
export function scoreBids(weights: BidComparisonCriteriaWeights): ScoredBid[] {
  const all = BID_FACTS;
  const adjustedTotals = all.map((bid) => bid.adjustedTotal);
  const scopeCompletenesses = all.map((bid) => bid.scopeCompleteness);
  const depositPercents = all.map((bid) => bid.depositPercent);
  const startWeeksList = all.map((bid) => bid.startWeeks);
  const durationDaysList = all.map((bid) => bid.durationDays);
  const numericWarranties = all
    .map((bid) => bid.warrantyMonths)
    .filter((months): months is number => months !== null);

  const totalWeight =
    weights.adjustedTotal +
    weights.scopeCompleteness +
    weights.paymentRisk +
    weights.scheduleFit +
    weights.warranty;

  const scored: ScoredBid[] = all.map((bid) => {
    const adjustedTotalScore = normalizeLowerBetter(adjustedTotals, bid.adjustedTotal);
    const scopeCompletenessScore = normalizeHigherBetter(
      scopeCompletenesses,
      bid.scopeCompleteness,
    );
    const paymentRiskScore = normalizeLowerBetter(depositPercents, bid.depositPercent);
    const scheduleFitScore =
      (normalizeLowerBetter(startWeeksList, bid.startWeeks) +
        normalizeLowerBetter(durationDaysList, bid.durationDays)) /
      2;
    const warrantyScore =
      bid.warrantyMonths === null
        ? 0.5
        : normalizeHigherBetter(numericWarranties, bid.warrantyMonths);

    const weighted =
      weights.adjustedTotal * adjustedTotalScore +
      weights.scopeCompleteness * scopeCompletenessScore +
      weights.paymentRisk * paymentRiskScore +
      weights.scheduleFit * scheduleFitScore +
      weights.warranty * warrantyScore;

    return {
      bidId: bid.bidId,
      score: round2(weighted / totalWeight),
      constraintViolated: !bid.credentialsValid,
    };
  });

  return scored.sort((a, b) => {
    const aViolates = a.constraintViolated ? 1 : 0;
    const bViolates = b.constraintViolated ? 1 : 0;
    if (aViolates !== bViolates) return aViolates - bViolates;
    return b.score - a.score;
  });
}

// --- bid.scope_normalization (scope-analyst) -- the required Guide moment ---

export const SCOPE_CONTEXT: ExecutionResult = {
  obligationId: 'bid.scope_normalization',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'Northgate Plumbing and Two Rivers Mechanical each price all 8 required scope items, and so do seven of the other nine bids. Two of those nine -- Westbrook Mechanical Contractors and Brightwater Mechanical -- are each silent on one required item of their own. Cedar & Sons is missing 3 of 8 required scope items -- shower valve rough-in and blocking for the gymnasium locker-room showers, plumbing permit filing and inspection scheduling, and haul-away and disposal of demolition debris -- so its $223,500.00 quoted total is not yet comparable to the others on the same scope basis.',
      stance: 'supports',
      confidence: 0.95,
      sourceIds: [
        'source-scope-diff-bid-northgate',
        'source-scope-diff-bid-cedar',
        'source-scope-diff-bid-tworivers',
      ],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-scope-diff-bid-northgate',
      level: 'E3',
      verdict: 'pass',
      summary:
        'Northgate Plumbing (bid-northgate) prices all 8 required scope items -- nothing absent.',
    },
    {
      sourceId: 'source-scope-diff-bid-cedar',
      level: 'E3',
      verdict: 'degraded',
      summary:
        'Cedar & Sons (bid-cedar) is missing 3 of 8 required scope items: Shower valve rough-in and blocking for the gymnasium locker-room showers; Plumbing permit filing and inspection scheduling; Haul-away and disposal of demolition debris.',
    },
    {
      sourceId: 'source-scope-diff-bid-tworivers',
      level: 'E3',
      verdict: 'pass',
      summary:
        'Two Rivers Mechanical (bid-tworivers) prices all 8 required scope items -- nothing absent.',
    },
  ],
  limitations: [],
  suggestedStatus: 'satisfied',
};

/**
 * `scope-analyst`'s first two `scope-differ` calls deliberately repeat the
 * same `bidIds` pair -- `RetrySteering`'s `matchesPriorQueryFamily`
 * condition (strands-runtime.md "Retry steering rules": "a search repeats a
 * prior query family without explaining a new angle") fires `Guide` on the
 * second call. The third call widens the comparison to the full twelve-bid
 * set -- docs/bid-comparison/plan.md's own words, "RetrySteering redirects
 * it to the third bid" (the original three-bid shape this beat is named
 * for; at twelve bids the same redirect widens to every bidder at once,
 * `scope-differ`'s own `bidIds` accepting the full array in one call rather
 * than needing eleven more repeated calls) -- a genuinely different
 * technique, before the specialist hands off to `price-analyst`.
 */
function buildScopeAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'scope-normalization' } }] },
        {
          toolCalls: [{ name: 'scope-differ', input: { bidIds: ['bid-northgate', 'bid-cedar'] } }],
        },
        {
          toolCalls: [{ name: 'scope-differ', input: { bidIds: ['bid-northgate', 'bid-cedar'] } }],
        },
        {
          toolCalls: [
            {
              name: 'scope-differ',
              input: {
                bidIds: [
                  'bid-northgate',
                  'bid-cedar',
                  'bid-tworivers',
                  'bid-summit',
                  'bid-ironclad',
                  'bid-parkside',
                  'bid-westbrook',
                  'bid-anchor',
                  'bid-crestview',
                  'bid-fieldstone',
                  'bid-brightwater',
                  'bid-oldmill',
                ],
              },
            },
          ],
        },
        structuredOutputTurn({
          agentId: 'price-analyst',
          message:
            'All twelve bids are now compared on the same scope basis: Northgate Plumbing, Two Rivers Mechanical, and seven of the other nine price every required item; Westbrook Mechanical Contractors and Brightwater Mechanical are each silent on one item of their own, and Cedar & Sons is silent on 3 of 8, per source-scope-diff-bid-cedar. Handing off to price-analyst to compute the scope-normalized adjusted totals.',
          context: SCOPE_CONTEXT,
        }),
      ],
    },
  });
}

// --- bid.price_verification (price-analyst) -- the required Deny moment ---

export const PRICE_CONTEXT: ExecutionResult = {
  obligationId: 'bid.price_verification',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "Cedar & Sons' bid quotes $223,500.00 for 5 of 8 required scope items (62.5% scope completeness); adjusted for the three items it leaves absent using Northgate Plumbing's own priced amounts as plug numbers (permits-inspections $18,000.00, shower-valve-rough-in $31,500.00, debris-haul-away $6,000.00), its scope-normalized adjusted total is $279,000.00 -- higher than Northgate Plumbing's own adjusted total of $276,000.00. Two Rivers Mechanical's adjusted total equals its quoted total, $288,750.00, since it prices every required item. The same plug-number discipline applies to the two other bids silent on part of the scope: Westbrook Mechanical Contractors' $284,000.00 quote, missing debris haul-away, adjusts to $290,000.00; Brightwater Mechanical's $278,000.00 quote, missing permits and inspections, adjusts to $296,000.00. Neither adjustment comes close to undercutting Northgate Plumbing's own adjusted total.",
      stance: 'supports',
      confidence: 0.95,
      sourceIds: [
        'source-bid-calculator-bid-northgate-adjusted-total',
        'source-bid-calculator-bid-cedar-adjusted-total',
        'source-bid-calculator-bid-tworivers-adjusted-total',
        'source-bid-calculator-bid-westbrook-adjusted-total',
        'source-bid-calculator-bid-brightwater-adjusted-total',
      ],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-bid-calculator-bid-northgate-adjusted-total',
      level: 'E3',
      verdict: 'pass',
      summary:
        "Northgate Plumbing's bid quotes $276,000.00 and prices all 8 required scope items -- no plug-number adjustment needed.",
    },
    {
      sourceId: 'source-bid-calculator-bid-cedar-adjusted-total',
      level: 'E3',
      verdict: 'pass',
      summary:
        "Cedar & Sons's bid quotes $223,500.00; adjusted for 3 unpriced required item(s) using the supplied plug numbers, the adjusted total is $279,000.00.",
    },
    {
      sourceId: 'source-bid-calculator-bid-tworivers-adjusted-total',
      level: 'E3',
      verdict: 'pass',
      summary:
        "Two Rivers Mechanical's bid quotes $288,750.00 and prices all 8 required scope items -- no plug-number adjustment needed.",
    },
    {
      sourceId: 'source-bid-calculator-bid-westbrook-adjusted-total',
      level: 'E3',
      verdict: 'pass',
      summary:
        "Westbrook Mechanical Contractors's bid quotes $284,000.00; adjusted for 1 unpriced required item(s) using the supplied plug numbers, the adjusted total is $290,000.00.",
    },
    {
      sourceId: 'source-bid-calculator-bid-brightwater-adjusted-total',
      level: 'E3',
      verdict: 'pass',
      summary:
        "Brightwater Mechanical's bid quotes $278,000.00; adjusted for 1 unpriced required item(s) using the supplied plug numbers, the adjusted total is $296,000.00.",
    },
  ],
  limitations: [],
  suggestedStatus: 'satisfied',
};

/**
 * `price-analyst`'s deliberate overreach: having just adjusted Cedar &
 * Sons' total, it reaches for `license-lookup` to check Cedar's credentials
 * too -- a tool the compiled pack grants only to `credential-checker`
 * (`allowedTools` here is `bid-reader`/`bid-calculator`). The real
 * `ScopeAuthorization` intervention denies it before it executes. Same
 * rationale as `home-energy-guardian.ts`'s `anomaly-investigator` overreach:
 * a scripted provider only ever asks for what it is told to ask for, so
 * this is the one place `Deny` -- one of the three intervention outcomes
 * that must be visible on every run -- genuinely fires in the shipped
 * trajectory rather than only inside a unit test that patches the provider.
 *
 * The two `bid-calculator` calls for Westbrook Mechanical Contractors and
 * Brightwater Mechanical, right after Cedar & Sons', are new at this pack's
 * twelve-bid scale: the same plug-number arithmetic that flips Cedar's
 * ranking applies to any bid silent on part of the required scope, not just
 * the one bid the demo narrates in full, and running it for real on both
 * proves that neither's adjustment comes close to disturbing the award --
 * not merely asserted in prose.
 */
function buildPriceAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'price-arithmetic' } }] },
        { toolCalls: [{ name: 'bid-calculator', input: { bidId: 'bid-northgate' } }] },
        { toolCalls: [{ name: 'bid-reader', input: { bidId: 'bid-northgate' } }] },
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'PL-2290-CS' } }] },
        {
          toolCalls: [
            {
              name: 'bid-calculator',
              input: {
                bidId: 'bid-cedar',
                plugNumbers: {
                  'permits-inspections': 18000,
                  'shower-valve-rough-in': 31500,
                  'debris-haul-away': 6000,
                },
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: 'bid-calculator',
              input: {
                bidId: 'bid-westbrook',
                plugNumbers: { 'debris-haul-away': 6000 },
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: 'bid-calculator',
              input: {
                bidId: 'bid-brightwater',
                plugNumbers: { 'permits-inspections': 18000 },
              },
            },
          ],
        },
        { toolCalls: [{ name: 'bid-calculator', input: { bidId: 'bid-tworivers' } }] },
        structuredOutputTurn({
          agentId: 'credential-checker',
          message:
            "Cedar & Sons' scope-normalized adjusted total is $279,000.00, higher than Northgate Plumbing's $276,000.00, per source-bid-calculator-bid-cedar-adjusted-total. Handing off to credential-checker to verify each contractor's license and insurance.",
          context: PRICE_CONTEXT,
        }),
      ],
    },
  });
}

// --- bid.credential_verification (credential-checker) ---

export const CREDENTIAL_CONTEXT: ExecutionResult = {
  obligationId: 'bid.credential_verification',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        'Northgate Plumbing\'s and Cedar & Sons\' licenses are active, cover this scope, and their insurance certificates name the license holder exactly -- the same is true of eight of the other nine bids. The remaining two fail on two different, genuine grounds: Two Rivers Mechanical\'s license and insurance are active, but its certificate of insurance names "TRM Holdings LLC", not the license holder "Two Rivers Mechanical Inc" -- its credentials do not verify as valid. Fieldstone Plumbing Co. -- whose $268,000.00 bid is the lowest scope-normalized adjusted total of all twelve -- has active, correctly-named insurance, but its license class carries no plumbing trade endorsement for this scope, so its credentials do not verify as valid either.',
      stance: 'supports',
      confidence: 0.95,
      sourceIds: [
        'source-license-pl-4417-ng',
        'source-license-pl-2290-cs',
        'source-license-pl-8801-tr-named-insured',
        'source-license-pl-7734-fs',
      ],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-license-pl-4417-ng',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Northgate Plumbing (PL-4417-NG): licence active, Class C-36 Plumbing Contractor (fictional state classification) covers this scope, insurance active.',
    },
    {
      sourceId: 'source-license-pl-4417-ng-named-insured',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Certificate of insurance names "Northgate Plumbing", matching the licence holder "Northgate Plumbing".',
    },
    {
      sourceId: 'source-license-pl-2290-cs',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Cedar & Sons (PL-2290-CS): licence active, Class C-36 Plumbing Contractor (fictional state classification) covers this scope, insurance active.',
    },
    {
      sourceId: 'source-license-pl-2290-cs-named-insured',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Certificate of insurance names "Cedar & Sons", matching the licence holder "Cedar & Sons".',
    },
    {
      sourceId: 'source-license-pl-8801-tr',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Two Rivers Mechanical Inc (PL-8801-TR): licence active, Class C-36 Plumbing Contractor (fictional state classification) covers this scope, insurance active.',
    },
    {
      sourceId: 'source-license-pl-8801-tr-named-insured',
      level: 'E1',
      verdict: 'degraded',
      summary:
        'Certificate of insurance names "TRM Holdings LLC", which does not match the licence holder "Two Rivers Mechanical Inc" -- needs a human answer before this bid\'s credentials can be marked verified.',
    },
    {
      sourceId: 'source-license-pl-7734-fs',
      level: 'E1',
      verdict: 'degraded',
      summary:
        'Fieldstone Plumbing Co. (PL-7734-FS): licence active, Class B General Building Contractor (fictional state classification) -- no plumbing trade endorsement on file does not cover this scope, insurance active.',
    },
    {
      sourceId: 'source-license-pl-7734-fs-named-insured',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Certificate of insurance names "Fieldstone Plumbing Co.", matching the licence holder "Fieldstone Plumbing Co.".',
    },
  ],
  limitations: [
    "Two Rivers Mechanical's named-insured mismatch needs a human answer before its credentials can be marked verified; until then its bid.credentials_valid attribute is false.",
    "Fieldstone Plumbing Co.'s license class carries no plumbing trade endorsement for this scope; until a corrected or endorsed license is on file, its bid.credentials_valid attribute is false.",
  ],
  suggestedStatus: 'satisfied',
};

function buildCredentialCheckerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'credential-verification' } }] },
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'PL-4417-NG' } }] },
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'PL-2290-CS' } }] },
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'PL-8801-TR' } }] },
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'PL-7734-FS' } }] },
        structuredOutputTurn({
          agentId: 'schedule-analyst',
          message:
            "Northgate Plumbing and Cedar & Sons both carry fully valid credentials; Two Rivers Mechanical's insurance certificate does not name its license holder, per source-license-pl-8801-tr-named-insured, and Fieldstone Plumbing Co.'s license class does not cover this scope, per source-license-pl-7734-fs. Handing off to schedule-analyst to evaluate each bid's start date and duration.",
          context: CREDENTIAL_CONTEXT,
        }),
      ],
    },
  });
}

// --- bid.schedule_feasibility (schedule-analyst) ---

export const SCHEDULE_CONTEXT: ExecutionResult = {
  obligationId: 'bid.schedule_feasibility',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "Every one of the twelve bids' stated start dates and durations is credible for this scope of work: Northgate Plumbing starts in 3 weeks over 45 working days, Cedar & Sons in 1 week over 35 working days, and Two Rivers Mechanical in 5 weeks over 40 working days. The other nine bids fall in the same range -- 1 to 8 weeks to start, 35 to 55 working days to complete -- none implausibly fast or slow for a full restroom and locker-room re-rough and fixture-set installation of this size.",
      stance: 'supports',
      confidence: 0.75,
      sourceIds: ['source-bid-northgate', 'source-bid-cedar', 'source-bid-tworivers'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-bid-northgate',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Northgate Plumbing (bid-northgate): $276,000.00 total across 8 line items, 25% deposit.',
    },
    {
      sourceId: 'source-bid-cedar',
      level: 'E1',
      verdict: 'pass',
      summary: 'Cedar & Sons (bid-cedar): $223,500.00 total across 5 line items, 45% deposit.',
    },
    {
      sourceId: 'source-bid-tworivers',
      level: 'E1',
      verdict: 'pass',
      summary:
        'Two Rivers Mechanical (bid-tworivers): $288,750.00 total across 8 line items, 20% deposit.',
    },
  ],
  limitations: [
    "Schedule credibility is a plausibility judgment from each bid's own stated dates, not independently verified against contractor capacity or permitting timelines.",
  ],
  suggestedStatus: 'accepted_uncertainty',
};

function buildScheduleAnalystProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'skills', input: { skill_name: 'schedule-analysis' } }] },
        { toolCalls: [{ name: 'bid-reader', input: { bidId: 'bid-northgate' } }] },
        { toolCalls: [{ name: 'bid-reader', input: { bidId: 'bid-cedar' } }] },
        { toolCalls: [{ name: 'bid-reader', input: { bidId: 'bid-tworivers' } }] },
        structuredOutputTurn({
          agentId: 'source-challenger',
          message:
            "Every bid's stated start date and duration is credible for this scope, per source-bid-northgate, source-bid-cedar, and source-bid-tworivers. Handing off to source-challenger to review the full evidence chain before synthesis.",
          context: SCHEDULE_CONTEXT,
        }),
      ],
    },
  });
}

// --- bid.award_recommendation review (source-challenger) ---

export const CHALLENGE_CONTEXT: ExecutionResult = {
  obligationId: 'bid.award_recommendation',
  disposition: 'evidence_found',
  claims: [
    {
      statement:
        "Re-verified: Cedar & Sons' bid document and its scope-diff both check out against their own source documents with no contradictions. The scope, price, credential, and schedule findings are ready for synthesis.",
      stance: 'supports',
      confidence: 0.9,
      sourceIds: ['source-bid-cedar', 'source-scope-diff-bid-cedar'],
    },
  ],
  evidenceResults: [
    {
      sourceId: 'source-bid-cedar',
      level: 'E1',
      verdict: 'pass',
      summary: 'Re-verified against the bid-reader source: no contradictions found.',
    },
    {
      sourceId: 'source-scope-diff-bid-cedar',
      level: 'E3',
      verdict: 'pass',
      summary:
        'Re-verified against the scope-differ source: the three absent items and their status check out.',
    },
  ],
  limitations: [],
  suggestedStatus: 'open',
};

function buildSourceChallengerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        { toolCalls: [{ name: 'bid-reader', input: { bidId: 'bid-cedar' } }] },
        { toolCalls: [{ name: 'scope-differ', input: { bidIds: ['bid-cedar'] } }] },
        structuredOutputTurn({
          agentId: 'decision-synthesizer',
          message:
            'Every finding checks out with no contradictions, per source-bid-cedar and source-scope-diff-bid-cedar. Handing off to decision-synthesizer for the final award recommendation.',
          context: CHALLENGE_CONTEXT,
        }),
      ],
    },
  });
}

// --- bid.award_recommendation synthesis (decision-synthesizer) ---

export const PROPOSED_AWARD_ROUND1 = {
  bidId: 'bid-northgate',
  rationale:
    'Lowest scope-normalized adjusted total ($276,000.00) among bids with fully valid credentials, and leads on scope completeness (100%) and payment risk (25% deposit).',
};

/**
 * `decision-synthesizer` still proposes Northgate Plumbing in round 2 --
 * this is not a flip, it is `bid-tworivers` scoring highest and being
 * refused anyway. The rationale names the exact discrepancy (the specific
 * mismatched entity names, per this task's own requirement), not a generic
 * "constraint failed."
 */
export const PROPOSED_AWARD_ROUND2 = {
  bidId: 'bid-northgate',
  rationale:
    'Two Rivers Mechanical scores highest of the twelve under the revised warranty- and payment-risk-weighted criteria, but its certificate of insurance names "TRM Holdings LLC," not its license holder "Two Rivers Mechanical Inc," so its credentials do not verify as valid. Of the ten bids with fully valid credentials, Northgate Plumbing scores higher, and its scope-normalized adjusted total ($276,000.00) remains the lower of the two.',
};

/**
 * The three synthesis texts are exported solely so `bid-comparison.test.ts`
 * can check what they CLAIM against what `BID_FACTS` and the checked-in bid
 * fixtures actually say. That test exists because this exact class of defect
 * shipped: `DECISION_TEXT_ROUND1` below once told the person reading it that
 * "Fieldstone Plumbing Co.'s $268,000.00 bid is the single lowest quoted
 * total of all twelve" and that of the other nine "none has an adjusted
 * total below Northgate's" -- both false against the fixtures in this very
 * repository (Cedar & Sons quotes $223,500.00, and Fieldstone's $268,000.00
 * adjusted total is below Northgate's $276,000.00), and the second sentence
 * contradicted by `DECISION_TEXT_ROUND1_DRAFT` two constants above it. Every
 * gate was green, because no gate read the prose.
 */
export const DECISION_TEXT_ROUND1_DRAFT =
  "Cedar & Sons offers the lowest total of all twelve bids at $223,500.00 (source-bid-cedar) -- undercutting even Fieldstone Plumbing Co.'s $268,000.00 (source-bid-fieldstone) -- versus Northgate Plumbing's $276,000.00 (source-bid-northgate) and Two Rivers Mechanical's $288,750.00 (source-bid-tworivers). Recommend awarding to Cedar & Sons on lowest price.";

export const DECISION_TEXT_ROUND1 =
  "Correcting for scope: Cedar & Sons' $223,500.00 quote is missing three required items -- permits and inspections ($18,000.00), shower-valve rough-in ($31,500.00), and debris haul-away ($6,000.00) -- so its scope-normalized adjusted total is $279,000.00 (source-bid-calculator-bid-cedar-adjusted-total), not $223,500.00. That is higher than Northgate Plumbing's adjusted total of $276,000.00 (source-bid-calculator-bid-northgate-adjusted-total), which already prices every required item and carries fully valid license and insurance credentials (source-license-pl-4417-ng). Of the other nine bids, seven price every required item outright; two -- Westbrook Mechanical Contractors and Brightwater Mechanical -- are each silent on one item of their own, and neither's adjustment closes the gap. Two Rivers Mechanical's adjusted total is $288,750.00 (source-bid-calculator-bid-tworivers-adjusted-total) and its insurance certificate does not name its license holder (source-license-pl-8801-tr-named-insured), so its credentials do not verify as valid. Exactly one bid of the twelve comes in under Northgate Plumbing once every bid is on the same scope basis: Fieldstone Plumbing Co., whose $268,000.00 is the lowest scope-normalized adjusted total of all twelve (source-bid-calculator-bid-fieldstone-adjusted-total) -- but its license class carries no plumbing trade endorsement for this scope (source-license-pl-7734-fs), so its credentials do not verify as valid either. Recommend awarding to Northgate Plumbing.";

/**
 * No score numeral appears in this text, deliberately.
 *
 * It used to read "0.58 vs. Cedar & Sons' 0.31" -- and the page beside it
 * rendered Cedar at 24%. Production `scoreCaseState` computes a different
 * figure for Cedar than `scoreBids` below, the hand-written reproduction
 * used to design this fixture, which has no coverage concept and so
 * disagrees with production on exactly the bid (or bids) whose coverage is
 * incomplete -- Cedar & Sons, and now also Westbrook Mechanical Contractors
 * and Brightwater Mechanical at this fixture set's twelve-bid scale. The two
 * agree on every scope-complete bid, which is why the original discrepancy
 * survived review: it is visible only on an incomplete-coverage bid.
 *
 * The deeper reason not to simply correct the numeral is architectural.
 * "The deterministic core, not an LLM, owns case state, evidence validity,
 * readiness, and human authority" (CLAUDE.md). Scores belong to the core,
 * which already renders them next to every bid. Prose that restates them
 * asserts ownership the model does not have, and can only ever agree or be
 * wrong. Qualitative claims ("scores highest of the twelve bids") stay,
 * because they remain true across any weighting that upweights warranty and
 * deposit, which is what this round exists to demonstrate. Dollar figures
 * stay too: those are tool outputs carrying their own source ids.
 */
export const DECISION_TEXT_ROUND2 =
  'With warranty length and payment risk now weighted most heavily, Two Rivers Mechanical scores highest of the twelve bids -- it leads on both upweighted criteria: a 36-month warranty (source-bid-tworivers) and a 20% deposit (source-bid-tworivers), the lowest payment risk of the twelve. It is still not recommended: its certificate of insurance names "TRM Holdings LLC," not its license holder "Two Rivers Mechanical Inc" (source-license-pl-8801-tr-named-insured), so its credentials do not verify as valid. Of the ten bids whose credentials are fully valid, Northgate Plumbing scores higher, and its scope-normalized adjusted total ($276,000.00, source-bid-calculator-bid-northgate-adjusted-total) remains lower than Cedar & Sons\' ($279,000.00, source-bid-calculator-bid-cedar-adjusted-total). Recommend awarding to Northgate Plumbing. Correcting the named-insured discrepancy on Two Rivers Mechanical\'s certificate of insurance would reopen this recommendation.';

/**
 * `decision-synthesizer`'s round 1 begins with a draft that sounds entirely
 * reasonable and ranks bids on their raw quoted totals -- exactly the
 * failure mode this whole pack exists to catch. `DEFAULT_SYNTHESIZER_
 * VALIDATOR` genuinely rejects it (it never mentions an adjusted total or
 * reaches Cedar & Sons' own $279,000.00 adjusted figure), and the corrected
 * second attempt is what actually reaches the case. `maxAttempts: 2` means
 * there is exactly one retry.
 *
 * Between the rejected first attempt and the corrected second attempt, the
 * agent calls `propose_award` -- a normal tool call, not a
 * `strands_structured_output` call, so it does not itself count as a
 * GoalLoop attempt (mirroring `home-energy-guardian.ts`'s `propose_
 * inspection` placement in its own round2). `ConsequenceGuard` gates it on
 * human confirmation before the proposal is recorded -- the required
 * Confirm moment, reachable in this same round1 trajectory alongside Deny,
 * Guide, and GoalLoop.
 *
 * Round 2's own draft passes `DEFAULT_SYNTHESIZER_VALIDATOR` on the first
 * attempt (no rejection is scripted for it, matching
 * `home-energy-guardian.ts`'s identical round2 shape): it cites a source,
 * and it still grounds the comparison in the two compliant bids' real
 * scope-normalized adjusted totals ($276,000.00 / $279,000.00) alongside the
 * new warranty/payment-risk finding -- the same scope-normalization
 * discipline round1 established, not abandoned once the story moves on to
 * credentials.
 */
function buildDecisionSynthesizerProvider(): ScriptedModelProvider {
  return new ScriptedModelProvider({
    beats: {
      round1: [
        structuredOutputTurn({ message: DECISION_TEXT_ROUND1_DRAFT }),
        { toolCalls: [{ name: PROPOSE_AWARD_TOOL_ID, input: { ...PROPOSED_AWARD_ROUND1 } }] },
        structuredOutputTurn({ message: DECISION_TEXT_ROUND1 }),
      ],
      round2: [
        { toolCalls: [{ name: PROPOSE_AWARD_TOOL_ID, input: { ...PROPOSED_AWARD_ROUND2 } }] },
        structuredOutputTurn({ message: DECISION_TEXT_ROUND2 }),
      ],
    },
  });
}

export interface BidComparisonSwarmScriptedProviders extends Record<
  BidComparisonSwarmNodeId,
  ScriptedModelProvider
> {
  'scope-analyst': ScriptedModelProvider;
  'price-analyst': ScriptedModelProvider;
  'credential-checker': ScriptedModelProvider;
  'schedule-analyst': ScriptedModelProvider;
  'source-challenger': ScriptedModelProvider;
  'decision-synthesizer': ScriptedModelProvider;
}

/**
 * Builds one fresh `ScriptedModelProvider` per Bid Comparison Swarm node.
 * `decision-synthesizer` carries both `round1`/`round2` beats; the other
 * five carry only `round1` (they are never visited when a test starts the
 * Swarm directly at `decision-synthesizer` for the round2 reweight
 * scenario). The caller calls `provider.setBeat(...)` on every provider it
 * intends to exercise before invoking the Swarm.
 */
export function buildBidComparisonSwarmScriptedProviders(
  /** Optional demo pacing, forwarded to every provider. 0 (the default) is what every test and gate uses -- see `ScriptedModelProvider.turnDelayMs`. */
  turnDelayMs = 0,
): BidComparisonSwarmScriptedProviders {
  const paced = <T extends ScriptedModelProvider>(provider: T): T => {
    provider.setTurnDelayMs(turnDelayMs);
    return provider;
  };
  return {
    'scope-analyst': paced(buildScopeAnalystProvider()),
    'price-analyst': paced(buildPriceAnalystProvider()),
    'credential-checker': paced(buildCredentialCheckerProvider()),
    'schedule-analyst': paced(buildScheduleAnalystProvider()),
    'source-challenger': paced(buildSourceChallengerProvider()),
    'decision-synthesizer': paced(buildDecisionSynthesizerProvider()),
  };
}

/** `BidComparisonSwarmDeps.modelFor` built directly from a `BidComparisonSwarmScriptedProviders` bundle. */
export function scriptedModelFor(
  providers: BidComparisonSwarmScriptedProviders,
): (nodeId: BidComparisonSwarmNodeId) => ScriptedModelProvider {
  return (nodeId) => providers[nodeId];
}

/** Sets every provider in the bundle to the same beat, before one `executeBidComparisonSwarm` round. */
export function setScenarioBeat(
  providers: BidComparisonSwarmScriptedProviders,
  beat: BidComparisonScenarioBeat,
): void {
  for (const nodeId of BID_COMPARISON_SWARM_NODE_IDS) {
    providers[nodeId].setBeat(beat);
  }
}
