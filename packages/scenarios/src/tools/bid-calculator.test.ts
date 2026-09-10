import { describe, expect, it } from 'vitest';
import {
  BID_CALCULATOR_TOOL_ID,
  PAYMENT_RISK_ELEVATED_MAX_PERCENT,
  PAYMENT_RISK_NORMAL_MAX_PERCENT,
  calculateBidEconomics,
  computeAdjustedTotal,
  derivePaymentRisk,
  type BidCalculatorResult,
  type KnownAdjustedTotal,
} from './bid-calculator.js';

/** See listing-reader.test.ts for the full rationale. */
function signalAbortingOnRead(n: number): AbortSignal {
  let reads = 0;
  return {
    get aborted() {
      reads += 1;
      return reads >= n;
    },
  } as unknown as AbortSignal;
}

function expectOk<T>(result: { status: string }): asserts result is { status: 'ok'; data: T } {
  expect(result.status).toBe('ok');
}

// The three demo plug numbers from docs/bid-comparison/plan.md, keyed by the
// exact scope item id each one prices -- Northgate's own real priced
// amount for that item, scaled to this pack's commercial-scale fixtures:
// permits/inspections $18,000, shower-valve rough-in $31,500, debris
// haul-away $6,000. Sum: $55,500.
const CEDAR_PLUG_NUMBERS = {
  'permits-inspections': 18000,
  'shower-valve-rough-in': 31500,
  'debris-haul-away': 6000,
};

describe('BID_CALCULATOR_TOOL_ID', () => {
  it('names the tool id exactly, at the documented literal value', () => {
    // Hardcoded, not `expect(BID_CALCULATOR_TOOL_ID).toBe(BID_CALCULATOR_TOOL_ID)` --
    // comparing the constant to itself can never fail no matter what value
    // it holds, which is exactly the kind of test gap that let a mutant
    // collapse this constant to "" survive elsewhere in this file.
    expect(BID_CALCULATOR_TOOL_ID).toBe('bid-calculator');
  });
});

describe('computeAdjustedTotal (pure)', () => {
  it('with zero absent items, returns the quoted total UNTOUCHED by round2 -- not recomputed through round2(amount + 0)', () => {
    // A sub-cent amount distinguishes the `absentItemIds.length === 0`
    // fast-path spread-copy return from the general path's
    // `round2(quotedTotal.amount + 0)`, which would round 100.004 down to
    // 100. The real bid fixtures never carry a sub-cent total, so this
    // fast path is otherwise unreachable through `calculateBidEconomics`.
    const result = computeAdjustedTotal({ amount: 100.004, currency: 'USD' }, [], {});
    expect(result).toEqual({ status: 'known', value: { amount: 100.004, currency: 'USD' } });
  });

  it('with one or more absent items, computes the plug-adjusted total via round2', () => {
    const result = computeAdjustedTotal({ amount: 100, currency: 'USD' }, ['item-a'], {
      'item-a': 50.005,
    });
    expect(result).toEqual({ status: 'known', value: { amount: 150.01, currency: 'USD' } });
  });
});

describe('derivePaymentRisk', () => {
  it('names the two threshold constants exactly once, at the documented values', () => {
    expect(PAYMENT_RISK_NORMAL_MAX_PERCENT).toBe(33);
    expect(PAYMENT_RISK_ELEVATED_MAX_PERCENT).toBe(50);
  });

  it('is "normal" at and below 33%', () => {
    expect(derivePaymentRisk(0)).toBe('normal');
    expect(derivePaymentRisk(25)).toBe('normal');
    expect(derivePaymentRisk(33)).toBe('normal');
  });

  it('is "elevated" strictly above 33% and at or below 50%', () => {
    expect(derivePaymentRisk(34)).toBe('elevated');
    expect(derivePaymentRisk(45)).toBe('elevated');
    expect(derivePaymentRisk(50)).toBe('elevated');
  });

  it('is "high" strictly above 50%', () => {
    expect(derivePaymentRisk(51)).toBe('high');
    expect(derivePaymentRisk(100)).toBe('high');
  });
});

describe('calculateBidEconomics -- Northgate (no absent items)', () => {
  it('adjustedTotal equals the quoted $276,000.00 total exactly, since nothing is absent to plug', () => {
    const result = calculateBidEconomics({ bidId: 'bid-northgate' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.quotedTotal).toEqual({ amount: 276000, currency: 'USD' });
    expect(result.data.adjustedTotal.status).toBe('known');
    expect((result.data.adjustedTotal as KnownAdjustedTotal).value).toEqual({
      amount: 276000,
      currency: 'USD',
    });
    expect(result.data.scopeCompleteness).toBe(1);
    expect(result.data.absentItemIds).toEqual([]);
  });

  it('is "normal" payment risk at a 25% deposit', () => {
    const result = calculateBidEconomics({ bidId: 'bid-northgate' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.depositPercent).toBe(25);
    expect(result.data.paymentRisk).toBe('normal');
  });

  it('passes through the real 24-month warranty', () => {
    const result = calculateBidEconomics({ bidId: 'bid-northgate' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.warrantyMonths).toBe(24);
  });
});

describe('calculateBidEconomics -- Cedar & Sons (the flip)', () => {
  it('reports 5 of 8 required items priced -- scopeCompleteness 0.625', () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.requiredItemCount).toBe(8);
    expect(result.data.pricedItemCount).toBe(5);
    expect(result.data.scopeCompleteness).toBe(0.625);
    expect(new Set(result.data.absentItemIds)).toEqual(
      new Set(['permits-inspections', 'shower-valve-rough-in', 'debris-haul-away']),
    );
  });

  it('quotes $223,500.00 as its stated total', () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.quotedTotal).toEqual({ amount: 223500, currency: 'USD' });
  });

  it('yields an explicit UNKNOWN adjusted total -- never a silently-optimistic $223,500 -- when no plug numbers are supplied for its 3 absent items', () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.adjustedTotal.status).toBe('unknown');
    if (result.data.adjustedTotal.status !== 'unknown') {
      throw new Error('expected adjustedTotal.status to be "unknown"');
    }
    expect(new Set(result.data.adjustedTotal.missingPlugNumberForScopeItemIds)).toEqual(
      new Set(['permits-inspections', 'shower-valve-rough-in', 'debris-haul-away']),
    );
    expect(result.data.adjustedTotal.reason.length).toBeGreaterThan(0);
    // The reason names all 3 missing ids, comma-separated, in the job's
    // own required-scope order (shower valve rough-in, then permits, then
    // debris haul-away) -- pinning the real separator so a mutant that
    // empties `.join(', ')` to `.join('')` cannot survive by still
    // matching three independent `toContain` checks.
    expect(result.data.adjustedTotal.reason).toContain(
      'shower-valve-rough-in, permits-inspections, debris-haul-away',
    );
    // Never coalesced to the quoted total or to 0 -- there is no "value" key
    // on the unknown variant at all.
    expect(result.data.adjustedTotal).not.toHaveProperty('value');
  });

  it('still yields an explicit unknown when only SOME of the 3 absent items have a supplied plug number', () => {
    const result = calculateBidEconomics({
      bidId: 'bid-cedar',
      plugNumbers: { 'permits-inspections': 1200, 'shower-valve-rough-in': 2100 },
    });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.adjustedTotal.status).toBe('unknown');
    if (result.data.adjustedTotal.status !== 'unknown') {
      throw new Error('expected adjustedTotal.status to be "unknown"');
    }
    expect(result.data.adjustedTotal.missingPlugNumberForScopeItemIds).toEqual([
      'debris-haul-away',
    ]);
  });

  it('treats a supplied plug number of exactly 0 as a real answer, not a missing one (checked with "in", not truthiness)', () => {
    const result = calculateBidEconomics({
      bidId: 'bid-cedar',
      plugNumbers: { ...CEDAR_PLUG_NUMBERS, 'debris-haul-away': 0 },
    });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.adjustedTotal.status).toBe('known');
    // 223500 + 18000 + 31500 + 0 = 273000
    expect((result.data.adjustedTotal as KnownAdjustedTotal).value).toEqual({
      amount: 273000,
      currency: 'USD',
    });
  });

  it(
    'THE DEMO FLIP: with the real plug numbers ($18,000 / $31,500 / $6,000 = $55,500), ' +
      "Cedar's adjusted total is $279,000.00 -- MORE than Northgate's $276,000.00 quoted total",
    () => {
      const cedar = calculateBidEconomics({ bidId: 'bid-cedar', plugNumbers: CEDAR_PLUG_NUMBERS });
      const northgate = calculateBidEconomics({ bidId: 'bid-northgate' });
      expectOk<BidCalculatorResult>(cedar);
      expectOk<BidCalculatorResult>(northgate);

      expect(cedar.data.adjustedTotal.status).toBe('known');
      const cedarAdjusted = (cedar.data.adjustedTotal as KnownAdjustedTotal).value;
      expect(cedarAdjusted).toEqual({ amount: 279000, currency: 'USD' });

      expect(northgate.data.adjustedTotal.status).toBe('known');
      const northgateAdjusted = (northgate.data.adjustedTotal as KnownAdjustedTotal).value;
      expect(northgateAdjusted).toEqual({ amount: 276000, currency: 'USD' });

      // Before adjustment, Cedar's raw quote ($223,500) looks cheaper than
      // Northgate's ($276,000).
      expect(cedar.data.quotedTotal.amount).toBeLessThan(northgate.data.quotedTotal.amount);

      // The whole point of this pack: after adjustment, the ranking flips.
      expect(cedarAdjusted.amount).toBeGreaterThan(northgateAdjusted.amount);
      expect(cedarAdjusted.amount).toBe(279000);
      expect(northgateAdjusted.amount).toBe(276000);
    },
  );

  it('is "elevated" payment risk at a 45% deposit', () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.depositPercent).toBe(45);
    expect(result.data.paymentRisk).toBe('elevated');
  });

  it('reports warrantyMonths as null (explicit unknown), never coalesced to 0', () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.warrantyMonths).toBeNull();
    expect(result.data.warrantyMonths).not.toBe(0);
  });
});

describe('calculateBidEconomics -- evidence summaries carry the real figures', () => {
  it("Cedar's evidence includes the unknown-adjusted-total reason, scope completeness percentage, elevated deposit risk, and the explicit no-warranty-term finding", () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar' });
    expectOk<BidCalculatorResult>(result);
    expect(result.data.evidence).toHaveLength(4);
    for (const item of result.data.evidence) {
      expect(item.summary.trim()).not.toBe('');
    }

    const adjustedTotalItem = result.data.evidence.find((item) =>
      item.sourceId.endsWith('-adjusted-total'),
    );
    expect(adjustedTotalItem?.level).toBe('E3');
    expect(adjustedTotalItem?.verdict).toBe('degraded');
    expect(adjustedTotalItem?.summary).toContain('$223,500.00');
    expect(adjustedTotalItem?.summary).toContain('unknown');

    const scopeItem = result.data.evidence.find((item) =>
      item.sourceId.endsWith('-scope-completeness'),
    );
    expect(scopeItem?.level).toBe('E3');
    expect(scopeItem?.verdict).toBe('pass');
    expect(scopeItem?.summary).toContain('5 of 8');
    expect(scopeItem?.summary).toContain('62.5%');

    const paymentRiskItem = result.data.evidence.find((item) =>
      item.sourceId.endsWith('-payment-risk'),
    );
    expect(paymentRiskItem?.level).toBe('E3');
    expect(paymentRiskItem?.verdict).toBe('pass');
    expect(paymentRiskItem?.summary).toContain('45%');
    expect(paymentRiskItem?.summary).toContain('elevated');

    const warrantyItem = result.data.evidence.find((item) => item.sourceId.endsWith('-warranty'));
    expect(warrantyItem?.level).toBe('E1');
    expect(warrantyItem?.verdict).toBe('degraded');
    expect(warrantyItem?.summary).toContain('not stated in writing');
    // The summary may explain the rule ("not a 0-month warranty") but must
    // never assert a 0-month warranty as fact, the way the pass-case
    // phrasing below ("states a 24-month ... warranty") would.
    expect(warrantyItem?.summary).not.toContain('states a 0-month');
  });

  it("Cedar's evidence with the real plug numbers cites the adjusted $279,000.00 figure and a passing verdict", () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar', plugNumbers: CEDAR_PLUG_NUMBERS });
    expectOk<BidCalculatorResult>(result);
    const adjustedTotalItem = result.data.evidence.find((item) =>
      item.sourceId.endsWith('-adjusted-total'),
    );
    expect(adjustedTotalItem?.level).toBe('E3');
    expect(adjustedTotalItem?.verdict).toBe('pass');
    expect(adjustedTotalItem?.summary).toContain('$223,500.00');
    expect(adjustedTotalItem?.summary).toContain('$279,000.00');
  });

  it("Northgate's evidence states a passing 24-month warranty and no adjustment needed", () => {
    const result = calculateBidEconomics({ bidId: 'bid-northgate' });
    expectOk<BidCalculatorResult>(result);
    const adjustedTotalItem = result.data.evidence.find((item) =>
      item.sourceId.endsWith('-adjusted-total'),
    );
    expect(adjustedTotalItem?.verdict).toBe('pass');
    expect(adjustedTotalItem?.summary).toContain('$276,000.00');
    expect(adjustedTotalItem?.summary).toContain('no plug-number adjustment needed');

    const warrantyItem = result.data.evidence.find((item) => item.sourceId.endsWith('-warranty'));
    expect(warrantyItem?.verdict).toBe('pass');
    expect(warrantyItem?.summary).toContain('24-month');
  });

  it('tags every evidence item E1 or E3, never a lower/uncomputed level', () => {
    const result = calculateBidEconomics({ bidId: 'bid-tworivers' });
    expectOk<BidCalculatorResult>(result);
    for (const evidenceItem of result.data.evidence) {
      expect(['E1', 'E3']).toContain(evidenceItem.level);
    }
  });
});

describe('calculateBidEconomics -- determinism, not_found, and cancellation', () => {
  it('is deterministic: identical input twice produces deep-equal output', () => {
    const first = calculateBidEconomics({ bidId: 'bid-cedar', plugNumbers: CEDAR_PLUG_NUMBERS });
    const second = calculateBidEconomics({ bidId: 'bid-cedar', plugNumbers: CEDAR_PLUG_NUMBERS });
    expect(second).toEqual(first);
  });

  it('is deterministic across the unknown-adjusted-total branch too', () => {
    const first = calculateBidEconomics({ bidId: 'bid-cedar' });
    const second = calculateBidEconomics({ bidId: 'bid-cedar' });
    expect(second).toEqual(first);
  });

  it('returns a deterministic not_found result for an unknown bidId, without throwing', () => {
    const result = calculateBidEconomics({ bidId: 'bid-does-not-exist' });
    if (result.status !== 'not_found') {
      throw new Error(`expected status "not_found", got "${result.status}"`);
    }
    expect(result.toolId).toBe(BID_CALCULATOR_TOOL_ID);
    expect(result.query).toBe('bid-does-not-exist');
    // The message is what a caller would actually see; pin it, not just
    // its presence, so it cannot be silently emptied to "".
    expect(result.message).toContain('bid-does-not-exist');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns a cancelled result when called with an already-aborted signal, before computing anything', () => {
    const controller = new AbortController();
    controller.abort();
    const result = calculateBidEconomics({ bidId: 'bid-cedar', signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect((result as { toolId: string }).toolId).toBe(BID_CALCULATOR_TOOL_ID);
  });

  it('checks the signal BEFORE validating bidId -- an already-aborted call is cancelled even with an unknown bidId', () => {
    // If the first abort check were skipped (or its early return removed),
    // execution would instead reach the `isBidFixtureName` check below it
    // and return `not_found` for "bid-does-not-exist" before ever reaching
    // the second abort check -- silently converting a cancellation into a
    // normal input error.
    const controller = new AbortController();
    controller.abort();
    const result = calculateBidEconomics({
      bidId: 'bid-does-not-exist',
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
  });

  it('checks the signal again mid-flight and honors a late abort', () => {
    const result = calculateBidEconomics({ bidId: 'bid-cedar', signal: signalAbortingOnRead(2) });
    expect(result.status).toBe('cancelled');
  });
});
