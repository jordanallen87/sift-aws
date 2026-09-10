/**
 * Direct unit tests for `scoreBids`'s pure arithmetic -- the real,
 * fixture-derived scoring this file's own module header documents.
 * `scoreBids` is never actually called by production code (it exists purely
 * so this file's own documented round1/round2 beats -- Northgate Plumbing's
 * round1 award, and round2's hard-constraint refusal of a higher-scoring
 * Two Rivers Mechanical -- are genuinely *proven* arithmetic against the
 * real fixture numbers, not merely asserted prose), mirroring
 * `home-energy-guardian.test.ts`'s identical `fitScore` unit suite for this
 * codebase's other Swarm-orchestrated pack.
 */
import { describe, expect, it } from 'vitest';
import { BID_COMPARISON_MANIFEST } from '@sift/packs';
import type { ExecutionResult } from '@sift/contracts';
import { BID_FIXTURE_NAMES, readBid } from '@sift/scenarios';
import {
  BID_FACTS,
  CHALLENGE_CONTEXT,
  CREDENTIAL_CONTEXT,
  DECISION_TEXT_ROUND1,
  DECISION_TEXT_ROUND1_DRAFT,
  DECISION_TEXT_ROUND2,
  PRICE_CONTEXT,
  PROPOSED_AWARD_ROUND1,
  PROPOSED_AWARD_ROUND2,
  SCHEDULE_CONTEXT,
  SCOPE_CONTEXT,
  ROUND1_CRITERIA_WEIGHTS,
  ROUND2_CRITERIA_WEIGHTS,
  ROUND1_RECOMMENDED_BID_ID,
  ROUND2_RECOMMENDED_BID_ID,
  scoreBids,
  type BidComparisonCriteriaWeights,
} from './bid-comparison.js';

describe('scoreBids: hard-constraint semantics (packages/core/src/scoring.ts rule 4)', () => {
  it('scores bid-tworivers and keeps it on the board -- a hard constraint flags, it never removes an option from consideration', () => {
    expect(BID_FACTS.find((bid) => bid.bidId === 'bid-tworivers')?.credentialsValid).toBe(false);
    for (const weights of [ROUND1_CRITERIA_WEIGHTS, ROUND2_CRITERIA_WEIGHTS]) {
      const ranked = scoreBids(weights);
      expect(ranked).toHaveLength(12);
      expect(ranked.map((entry) => entry.bidId)).toContain('bid-tworivers');
      expect(ranked.find((entry) => entry.bidId === 'bid-tworivers')?.constraintViolated).toBe(
        true,
      );
    }
  });

  it('never lets bid-tworivers outrank a compliant bid, even at a perfect 1.00 raw score under a weighting built entirely to favor it (bid.warranty + bid.payment_risk, 50/50, zero elsewhere)', () => {
    // The most generous plausible case for Two Rivers Mechanical: every
    // point of weight on the two criteria it leads (36-month warranty,
    // 20% deposit), none anywhere else.
    const allInOnTwoRivers: BidComparisonCriteriaWeights = {
      adjustedTotal: 0,
      scopeCompleteness: 0,
      paymentRisk: 50,
      scheduleFit: 0,
      warranty: 50,
    };
    const ranked = scoreBids(allInOnTwoRivers);
    const tworivers = ranked.find((entry) => entry.bidId === 'bid-tworivers');
    expect(tworivers?.score).toBe(1);
    expect(ranked[0]?.bidId).not.toBe('bid-tworivers');
    expect(ranked[1]?.bidId).not.toBe('bid-tworivers');
    // A perfect raw score and it still sorts below EVERY compliant bid --
    // rule 4, not a scoring coincidence: "Constraint violations dominate
    // everything ... ranked last [among compliant options], never removed,
    // then score." With two constraint violators in this twelve-bid set
    // (Two Rivers and Fieldstone Plumbing Co.), "last" is no longer
    // guaranteed to mean the single last index -- Fieldstone can (and here
    // does) sort even lower than Two Rivers among the violators themselves
    // -- so the precise, always-true claim is that no compliant bid's index
    // exceeds Two Rivers' own.
    const tworiversIndex = ranked.findIndex((entry) => entry.bidId === 'bid-tworivers');
    const lastCompliantIndex = Math.max(
      ...ranked.map((entry, index) => (entry.constraintViolated ? -1 : index)),
    );
    expect(lastCompliantIndex).toBeLessThan(tworiversIndex);
  });

  it('bid-tworivers cannot rank first under any of a wide sweep of weightings, because a hard-constraint violation is not a matter of degree', () => {
    const sweep: BidComparisonCriteriaWeights[] = [
      { adjustedTotal: 100, scopeCompleteness: 0, paymentRisk: 0, scheduleFit: 0, warranty: 0 },
      { adjustedTotal: 0, scopeCompleteness: 100, paymentRisk: 0, scheduleFit: 0, warranty: 0 },
      { adjustedTotal: 0, scopeCompleteness: 0, paymentRisk: 100, scheduleFit: 0, warranty: 0 },
      { adjustedTotal: 0, scopeCompleteness: 0, paymentRisk: 0, scheduleFit: 100, warranty: 0 },
      { adjustedTotal: 0, scopeCompleteness: 0, paymentRisk: 0, scheduleFit: 0, warranty: 100 },
      { adjustedTotal: 20, scopeCompleteness: 20, paymentRisk: 20, scheduleFit: 20, warranty: 20 },
      ROUND1_CRITERIA_WEIGHTS,
      ROUND2_CRITERIA_WEIGHTS,
    ];
    for (const weights of sweep) {
      expect(scoreBids(weights)[0]?.bidId).not.toBe('bid-tworivers');
    }
  });
});

describe('scoreBids: round2 hard-constraint beat (Two Rivers Mechanical scores highest, is still refused)', () => {
  it('gives Two Rivers Mechanical the top RAW score of all twelve bids under ROUND2_CRITERIA_WEIGHTS, flagged as a constraint violator, while Northgate Plumbing -- the highest-scoring COMPLIANT bid -- is what the sorted board (and the recommended award) actually leads with; both facts come from the scorer, not an assertion', () => {
    const ranked = scoreBids(ROUND2_CRITERIA_WEIGHTS);

    // Fact 1: by raw score alone (ignoring the sort's constraint-first
    // tiebreak), bid-tworivers is the highest scorer of all twelve.
    const byRawScore = [...ranked].sort((a, b) => b.score - a.score);
    expect(byRawScore[0]?.bidId).toBe('bid-tworivers');
    expect(byRawScore[0]?.constraintViolated).toBe(true);

    // Fact 2: the actual recommended award -- ranked[0] after the real
    // hard-constraint sort -- is Northgate Plumbing, compliant.
    expect(ranked[0]?.bidId).toBe('bid-northgate');
    expect(ranked[0]?.constraintViolated).toBe(false);
    expect(ranked[0]?.bidId).toBe(ROUND2_RECOMMENDED_BID_ID);

    // The exact scored totals `scoreBids` computes. This is the fixture's
    // own design-check reproduction, NOT production scoring: `scoreCaseState`
    // has a coverage concept this helper lacks and disagrees with it on any
    // bid whose coverage is incomplete (Cedar & Sons, Westbrook Mechanical
    // Contractors, Brightwater Mechanical). The two agree on every
    // scope-complete bid and on the overall ordering, which is all this
    // helper exists to establish. No user-visible string may quote either
    // set -- see the note above `DECISION_TEXT_ROUND2`.
    expect(ranked.find((entry) => entry.bidId === 'bid-tworivers')?.score).toBe(0.91);
    expect(ranked.find((entry) => entry.bidId === 'bid-northgate')?.score).toBe(0.72);
    expect(ranked.find((entry) => entry.bidId === 'bid-cedar')?.score).toBe(0.31);
  });

  it('reweighting toward bid.warranty + bid.payment_risk gives Two Rivers Mechanical the lead over every compliant bid on raw score -- a lead it does not yet have under round 1, where Northgate Plumbing genuinely outscores it too, not merely outranks it', () => {
    const round1 = scoreBids(ROUND1_CRITERIA_WEIGHTS);
    const round2 = scoreBids(ROUND2_CRITERIA_WEIGHTS);

    const tworiversRound1 = round1.find((entry) => entry.bidId === 'bid-tworivers')?.score ?? -1;
    const northgateRound1 = round1.find((entry) => entry.bidId === 'bid-northgate')?.score ?? -1;
    // Round1's cost-heavy weighting keeps the protected hard constraint from
    // ever having to do visible work at the very top of the board: Northgate
    // is the genuine top RAW scorer here, Two Rivers included, so round2 is
    // where the constraint first has something to actually overrule.
    expect(tworiversRound1).toBeLessThan(northgateRound1);

    const tworiversRound2 = round2.find((entry) => entry.bidId === 'bid-tworivers')?.score ?? -1;
    const northgateRound2 = round2.find((entry) => entry.bidId === 'bid-northgate')?.score ?? -1;
    const cedarRound2 = round2.find((entry) => entry.bidId === 'bid-cedar')?.score ?? -1;
    expect(tworiversRound2).toBeGreaterThan(northgateRound2);
    expect(tworiversRound2).toBeGreaterThan(cedarRound2);
    // The reweight genuinely moves Two Rivers' own score up, not just its
    // rank relative to others.
    expect(tworiversRound2).toBeGreaterThan(tworiversRound1);
  });
});

describe('scoreBids: the schedule-urgency direction, tried and rejected on narrative grounds', () => {
  it("scores Cedar & Sons first under a schedule-heavy weighting (schedule fit 75), despite its higher adjusted total and worse scope completeness and payment risk -- documented here as the one lever that CAN move the award off Northgate Plumbing, and NOT what round2 ships (see this file's module header)", () => {
    // At this fixture set's twelve-bid scale, a merely schedule-leaning
    // weighting is not enough on its own to overtake Northgate Plumbing's
    // own now-genuinely-strong showing across the wider field (a lower
    // schedule-fit weight than this once sufficed at three bids); this
    // weighting is more schedule-dominant than the original three-bid
    // version to still make the same documented point.
    const scheduleHeavy: BidComparisonCriteriaWeights = {
      adjustedTotal: 5,
      scopeCompleteness: 10,
      paymentRisk: 5,
      scheduleFit: 75,
      warranty: 5,
    };
    const ranked = scoreBids(scheduleHeavy);
    expect(ranked[0]?.bidId).toBe('bid-cedar');
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("reweighting toward bid.warranty + bid.payment_risk (ROUND2_CRITERIA_WEIGHTS' own direction) never lets Cedar & Sons catch Northgate Plumbing, at any tested intensity -- confirming that direction cannot produce an award-level crossover either", () => {
    const moderate = ROUND2_CRITERIA_WEIGHTS;
    const extreme: BidComparisonCriteriaWeights = {
      adjustedTotal: 0,
      scopeCompleteness: 0,
      paymentRisk: 50,
      scheduleFit: 0,
      warranty: 50,
    };
    for (const weights of [moderate, extreme]) {
      const ranked = scoreBids(weights);
      const northgate = ranked.find((entry) => entry.bidId === 'bid-northgate')?.score ?? -1;
      const cedar = ranked.find((entry) => entry.bidId === 'bid-cedar')?.score ?? -1;
      expect(northgate).toBeGreaterThan(cedar);
    }
  });
});

describe('scoreBids: round 1 arithmetic and shared normalization rules', () => {
  it("scores Northgate Plumbing first under round 1's cost-heavy default weighting (adjusted total 45 / scope completeness 20 / payment risk 15 -- three of the criteria Northgate leads on)", () => {
    const ranked = scoreBids(ROUND1_CRITERIA_WEIGHTS);
    expect(ranked[0]?.bidId).toBe('bid-northgate');
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it('treats an explicit-unknown warranty term (Cedar & Sons) as neutral -- 0.5, strictly between the worst (0) and best (1) KNOWN warranty scores in the twelve-bid pool -- never as a 0-month warranty', () => {
    const cedar = BID_FACTS.find((bid) => bid.bidId === 'bid-cedar');
    expect(cedar?.warrantyMonths).toBeNull();
    const allWarrantyWeight: BidComparisonCriteriaWeights = {
      adjustedTotal: 0,
      scopeCompleteness: 0,
      paymentRisk: 0,
      scheduleFit: 0,
      warranty: 100,
    };
    const ranked = scoreBids(allWarrantyWeight);
    const cedarScore = ranked.find((entry) => entry.bidId === 'bid-cedar')?.score;
    // Normalized against the FULL twelve-bid pool (bid-tworivers included,
    // per packages/core/src/scoring.ts's own buildScale), bid-tworivers'
    // 36-month term is the best known term (score 1) and several also-ran
    // bids share the worst known term, 12 months (score 0) -- Ironclad
    // Plumbing & Mechanical is one of them. Northgate Plumbing's own
    // 24-month term is neither extreme: at twelve bids, several other bids
    // (Parkside Plumbing Group, Crestview Mechanical Services, Old Mill
    // Plumbing & Heating) also carry a 24-month term, so Northgate's own
    // isolated warranty score is the SAME neutral 0.5 Cedar & Sons' explicit
    // unknown produces -- proving the neutral treatment sits strictly
    // between the pool's true worst and best known figures, not merely
    // between whatever two bids happen to be named in the demo narrative.
    const ironcladScore = ranked.find((entry) => entry.bidId === 'bid-ironclad')?.score;
    const tworiversScore = ranked.find((entry) => entry.bidId === 'bid-tworivers')?.score;
    const northgateScore = ranked.find((entry) => entry.bidId === 'bid-northgate')?.score;
    expect(ironcladScore).toBe(0);
    expect(tworiversScore).toBe(1);
    expect(northgateScore).toBe(0.5);
    expect(cedarScore).toBe(0.5);
  });
});

/**
 * The crossover above is real arithmetic, but it only reaches a viewer if
 * the *case* a person actually starts is weighted the way round 1's
 * narration says it is -- `home-energy-guardian.test.ts`'s own module
 * header explains exactly why this join matters and what it once caught.
 * This is the same join for this pack.
 */
describe('the pack default weighting and round 1 narration agree', () => {
  function defaultWeight(criterionId: string): number {
    const criterion = BID_COMPARISON_MANIFEST.criteria.defaults.find(
      (entry) => entry.id === criterionId,
    );
    if (criterion === undefined) {
      throw new Error(`test setup: the pack no longer declares criterion "${criterionId}"`);
    }
    return criterion.weight;
  }

  it("narrates the weighting the pack actually ships as ROUND1_CRITERIA_WEIGHTS, so this file's round1 beat and the pack default cannot silently drift apart", () => {
    expect(ROUND1_CRITERIA_WEIGHTS).toEqual({
      adjustedTotal: defaultWeight('bid.adjusted_total'),
      scopeCompleteness: defaultWeight('bid.scope_completeness'),
      paymentRisk: defaultWeight('bid.payment_risk'),
      scheduleFit: defaultWeight('bid.schedule_fit'),
      warranty: defaultWeight('bid.warranty'),
    });
  });

  it("ranks the bid round 1 recommends first under the pack's own default criterion weights", () => {
    const ranked = scoreBids({
      adjustedTotal: defaultWeight('bid.adjusted_total'),
      scopeCompleteness: defaultWeight('bid.scope_completeness'),
      paymentRisk: defaultWeight('bid.payment_risk'),
      scheduleFit: defaultWeight('bid.schedule_fit'),
      warranty: defaultWeight('bid.warranty'),
    });
    expect(ranked[0]?.bidId).toBe(ROUND1_RECOMMENDED_BID_ID);
  });

  it('ranks the bid round 2 actually recommends first under its own reweighted criteria', () => {
    const ranked = scoreBids(ROUND2_CRITERIA_WEIGHTS);
    expect(ranked[0]?.bidId).toBe(ROUND2_RECOMMENDED_BID_ID);
  });
});

/**
 * The gate that was missing when the prose below shipped false.
 *
 * `DECISION_TEXT_ROUND1` once told the person reading the recommendation
 * that Fieldstone Plumbing Co.'s $268,000.00 was "the single lowest quoted
 * total of all twelve," and that of the other nine bids "none has an
 * adjusted total below Northgate's." Both are false against the fixtures
 * checked into this repository -- Cedar & Sons quotes $223,500.00, and
 * Fieldstone's $268,000.00 IS below Northgate's $276,000.00 -- and the first
 * was contradicted by `DECISION_TEXT_ROUND1_DRAFT`, the constant declared
 * immediately above it, which says so plainly. Every gate in the repo was
 * green: the arithmetic tests never read the prose, and the prose tests
 * never checked the arithmetic.
 *
 * So this suite reads both. It pins the facts these sentences rest on, and
 * then it reads the shipped strings back for the retired claims, because a
 * fact test alone would not have caught a sentence asserting the opposite of
 * a fact.
 */
describe('the shipped synthesis prose agrees with the fixtures it describes', () => {
  const quotedTotalByBidId = new Map(
    BID_FIXTURE_NAMES.map((bidId) => {
      const result = readBid({ bidId });
      if (result.status !== 'ok') {
        throw new Error(`test setup: readBid("${bidId}") returned "${result.status}"`);
      }
      return [bidId, result.data.total.amount] as const;
    }),
  );

  function factsFor(bidId: string): (typeof BID_FACTS)[number] {
    const facts = BID_FACTS.find((entry) => entry.bidId === bidId);
    if (facts === undefined) {
      throw new Error(`test setup: BID_FACTS no longer carries "${bidId}"`);
    }
    return facts;
  }

  it('leaves the lowest RAW quote with Cedar & Sons -- the bid whose gaps the scope beat exists to price in', () => {
    const lowestQuoted = [...quotedTotalByBidId.entries()].reduce((lowest, entry) =>
      entry[1] < lowest[1] ? entry : lowest,
    );
    expect(lowestQuoted[0]).toBe('bid-cedar');
    // Not merely lowest: lower than the bid the prose used to call lowest.
    expect(lowestQuoted[1]).toBeLessThan(quotedTotalByBidId.get('bid-fieldstone') ?? 0);
  });

  it('leaves the lowest scope-ADJUSTED total with Fieldstone Plumbing Co., the only bid under Northgate once every bid is on the same basis', () => {
    const lowestAdjusted = [...BID_FACTS].sort((a, b) => a.adjustedTotal - b.adjustedTotal)[0];
    expect(lowestAdjusted?.bidId).toBe('bid-fieldstone');

    const northgateAdjusted = factsFor('bid-northgate').adjustedTotal;
    const under = BID_FACTS.filter((facts) => facts.adjustedTotal < northgateAdjusted).map(
      (facts) => facts.bidId,
    );
    expect(under).toEqual(['bid-fieldstone']);
  });

  /** Every user-visible string an `ExecutionResult` carries, flattened -- the claims a specialist states, the limitations it records, and the summary on each piece of evidence it cites. */
  function visibleStrings(context: ExecutionResult): string[] {
    return [
      ...context.claims.map((claim) => claim.statement),
      ...context.limitations,
      ...context.evidenceResults.map((evidence) => evidence.summary),
    ];
  }

  it('never restates either retired claim in any string a person actually reads', () => {
    const shipped = [
      DECISION_TEXT_ROUND1_DRAFT,
      DECISION_TEXT_ROUND1,
      DECISION_TEXT_ROUND2,
      PROPOSED_AWARD_ROUND1.rationale,
      PROPOSED_AWARD_ROUND2.rationale,
      ...visibleStrings(SCOPE_CONTEXT),
      ...visibleStrings(PRICE_CONTEXT),
      ...visibleStrings(CREDENTIAL_CONTEXT),
      ...visibleStrings(SCHEDULE_CONTEXT),
      ...visibleStrings(CHALLENGE_CONTEXT),
    ].join(' \n ');

    // "Fieldstone is the lowest quoted total" -- false; Cedar & Sons is.
    expect(shipped).not.toMatch(/Fieldstone[^.]*lowest quoted/i);
    expect(shipped).not.toMatch(/single lowest quoted total/i);
    // "nothing is under Northgate's adjusted total" -- false; Fieldstone is.
    expect(shipped).not.toMatch(/none has an adjusted total below/i);
  });
});
