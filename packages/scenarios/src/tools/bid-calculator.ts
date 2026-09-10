/**
 * Fixture tool: "bid calculator"
 * (docs/bid-comparison/plan.md "Specialists and skills": `price-analyst`
 * tools `bid-reader`/`bid-calculator`, obligation `bid.price_verification`).
 *
 * The deterministic arithmetic behind the bid-comparison demo's central
 * finding: Cedar & Sons' $223,500 quote looks $52,500 cheaper than
 * Northgate's $276,000 only because it is silent on three required scope
 * items (permits/inspections, the shower-valve rough-in, debris haul-away).
 * Once plug numbers for those three items ($18,000 / $31,500 / $6,000) are
 * supplied, Cedar's *adjusted* total is $279,000 -- now the higher bid. The
 * ranking flips on arithmetic anyone can follow on camera. (This pack's
 * fixture set scaled from three bids to twelve on 2026-09-08; two more bids
 * in the larger set -- Westbrook Mechanical Contractors and Brightwater
 * Mechanical -- have their own single-item version of the same gap, priced
 * by this exact function the same way.)
 *
 * Reuses `scope-differ.ts`'s `diffBidScope` for "which required items does
 * this bid leave absent" rather than re-deriving that set difference a
 * second time -- the same "exactly one implementation of a computation"
 * discipline `bill-feed-gate.ts` follows by reusing `energy-calculator.ts`'s
 * `determineAnomaly` instead of re-deriving the anomaly threshold check.
 *
 * Honesty rule (the product's core thesis, docs/bid-comparison/plan.md
 * "Explicit unknown"): a required item this bid leaves absent, with no
 * caller-supplied plug number for it, makes `adjustedTotal` an *explicit
 * unknown* -- represented as its own `{ status: 'unknown', reason,
 * missingPlugNumberForScopeItemIds }` variant, never silently coerced to
 * the quoted total (which would make an incomplete bid look artificially
 * cheap -- the exact failure mode this pack exists to catch) and never
 * defaulted to treating the missing item as a $0 cost. A supplied plug of
 * exactly `0` is a deliberate "priced at no charge" answer and is checked
 * with the `in` operator, not truthiness, so it is never confused with "no
 * plug number given".
 *
 * `paymentRisk` bands are research-backed deposit-percent thresholds,
 * defined here exactly once as named exported constants
 * (`PAYMENT_RISK_NORMAL_MAX_PERCENT`, `PAYMENT_RISK_ELEVATED_MAX_PERCENT`)
 * per docs/bid-comparison/plan.md: "over 33% is a red flag, over 50% is
 * alarming".
 *
 * `warrantyMonths` is passed through from the bid fixture's own
 * `warranty.termMonths` (`number | null`) untouched -- `null` (Cedar's bid
 * states a warranty but no term in writing) must never be coalesced to `0`
 * anywhere in this file; there is no `?? 0` on this field.
 */
import { isBidFixtureName, type MoneyAmount } from './bid-reader.js';
import { loadFixture } from './fixture-loader.js';
import { diffBidScope } from './scope-differ.js';
import {
  cancelledResult,
  isAborted,
  notFoundResult,
  okResult,
  type ToolEvidenceItem,
  type ToolResult,
} from './tool-result.js';

export const BID_CALCULATOR_TOOL_ID = 'bid-calculator';

/** <= this deposit percent is normal payment risk. Docs/bid-comparison/plan.md: "over 33% is a red flag". */
export const PAYMENT_RISK_NORMAL_MAX_PERCENT = 33;
/** <= this deposit percent (and above `PAYMENT_RISK_NORMAL_MAX_PERCENT`) is elevated payment risk; above it is high. Docs/bid-comparison/plan.md: "over 50% is alarming". */
export const PAYMENT_RISK_ELEVATED_MAX_PERCENT = 50;

export type PaymentRiskBand = 'normal' | 'elevated' | 'high';

/** Pure: the one definition of the deposit-percent -> payment-risk band mapping. */
export function derivePaymentRisk(depositPercent: number): PaymentRiskBand {
  if (depositPercent <= PAYMENT_RISK_NORMAL_MAX_PERCENT) {
    return 'normal';
  }
  if (depositPercent <= PAYMENT_RISK_ELEVATED_MAX_PERCENT) {
    return 'elevated';
  }
  return 'high';
}

export interface KnownAdjustedTotal {
  status: 'known';
  value: MoneyAmount;
}

export interface UnknownAdjustedTotal {
  status: 'unknown';
  reason: string;
  missingPlugNumberForScopeItemIds: string[];
}

export type AdjustedTotalResult = KnownAdjustedTotal | UnknownAdjustedTotal;

export interface BidCalculatorResult {
  bidId: string;
  contractorName: string;
  quotedTotal: MoneyAmount;
  adjustedTotal: AdjustedTotalResult;
  requiredItemCount: number;
  pricedItemCount: number;
  absentItemIds: string[];
  scopeCompleteness: number;
  depositPercent: number;
  paymentRisk: PaymentRiskBand;
  warrantyMonths: number | null;
  evidence: ToolEvidenceItem[];
}

export interface BidCalculatorInput {
  bidId: string;
  /**
   * Dollar plug numbers, in the bid's own currency, for required scope
   * items `scope-differ.ts` finds absent from this bid -- keyed by
   * `scopeItemId`. An absent item with no entry here leaves `adjustedTotal`
   * an explicit unknown; see the file docstring's honesty-rule note on why
   * this is checked with `in`, not truthiness.
   */
  plugNumbers?: Record<string, number>;
  signal?: AbortSignal;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Pure: no disk I/O, no dependency on which fixture (or non-fixture bid)
 * the caller obtained `quotedTotal`/`absentItemIds` from. Exported, the
 * same discipline `scope-differ.ts`'s `diffBidScope` and this file's own
 * `derivePaymentRisk` follow, so the `absentItemIds.length === 0` fast
 * path -- which returns the quoted total untouched by `round2`, rather
 * than the general path's `round2(quotedTotal.amount + 0)` -- is directly
 * unit-testable against a hand-built sub-cent `quotedTotal`. The real bid
 * fixtures never carry a sub-cent total, so that fast path is otherwise
 * unreachable in a way any fixture-driven test could observe.
 */
export function computeAdjustedTotal(
  quotedTotal: MoneyAmount,
  absentItemIds: string[],
  plugNumbers: Record<string, number>,
): AdjustedTotalResult {
  if (absentItemIds.length === 0) {
    return { status: 'known', value: { ...quotedTotal } };
  }

  const missingPlugNumberForScopeItemIds = absentItemIds.filter((id) => !(id in plugNumbers));
  if (missingPlugNumberForScopeItemIds.length > 0) {
    return {
      status: 'unknown',
      reason: `no plug number supplied for ${missingPlugNumberForScopeItemIds.length} of ${absentItemIds.length} absent required scope item(s): ${missingPlugNumberForScopeItemIds.join(', ')}`,
      missingPlugNumberForScopeItemIds,
    };
  }

  // Every id in `absentItemIds` passed the `in` check above, so
  // `plugNumbers[id]` is a real supplied number here, never `undefined`.
  const plugTotal = absentItemIds.reduce((sum, id) => sum + plugNumbers[id]!, 0);
  return {
    status: 'known',
    value: { amount: round2(quotedTotal.amount + plugTotal), currency: quotedTotal.currency },
  };
}

function bidCalculatorSourceId(bidId: string, concern: string): string {
  return `source-bid-calculator-${bidId}-${concern}`;
}

function buildAdjustedTotalEvidence(
  result: Omit<BidCalculatorResult, 'evidence'>,
): ToolEvidenceItem {
  const sourceId = bidCalculatorSourceId(result.bidId, 'adjusted-total');

  if (result.adjustedTotal.status === 'unknown') {
    return {
      sourceId,
      level: 'E3',
      verdict: 'degraded',
      summary: `${result.contractorName}'s bid quotes $${formatCurrency(result.quotedTotal.amount)} as its stated total, but the adjusted total is unknown: ${result.adjustedTotal.reason}.`,
    };
  }

  if (result.absentItemIds.length === 0) {
    return {
      sourceId,
      level: 'E3',
      verdict: 'pass',
      summary: `${result.contractorName}'s bid quotes $${formatCurrency(result.quotedTotal.amount)} and prices all ${result.requiredItemCount} required scope items -- no plug-number adjustment needed.`,
    };
  }

  return {
    sourceId,
    level: 'E3',
    verdict: 'pass',
    summary: `${result.contractorName}'s bid quotes $${formatCurrency(result.quotedTotal.amount)}; adjusted for ${result.absentItemIds.length} unpriced required item(s) using the supplied plug numbers, the adjusted total is $${formatCurrency(result.adjustedTotal.value.amount)}.`,
  };
}

function buildEvidence(result: Omit<BidCalculatorResult, 'evidence'>): ToolEvidenceItem[] {
  const scopeCompletenessEvidence: ToolEvidenceItem = {
    sourceId: bidCalculatorSourceId(result.bidId, 'scope-completeness'),
    level: 'E3',
    verdict: 'pass',
    summary: `${result.contractorName} prices ${result.pricedItemCount} of ${result.requiredItemCount} required scope items (${(result.scopeCompleteness * 100).toFixed(1)}% scope completeness).`,
  };

  const paymentRiskEvidence: ToolEvidenceItem = {
    sourceId: bidCalculatorSourceId(result.bidId, 'payment-risk'),
    level: 'E3',
    verdict: 'pass',
    summary: `${result.contractorName} requires a ${result.depositPercent}% deposit -- ${result.paymentRisk} payment risk (normal <= ${PAYMENT_RISK_NORMAL_MAX_PERCENT}%, elevated up to ${PAYMENT_RISK_ELEVATED_MAX_PERCENT}%, high above that).`,
  };

  const warrantyEvidence: ToolEvidenceItem =
    result.warrantyMonths === null
      ? {
          sourceId: bidCalculatorSourceId(result.bidId, 'warranty'),
          level: 'E1',
          verdict: 'degraded',
          summary: `${result.contractorName}'s warranty term is not stated in writing -- an explicit unknown, not a 0-month warranty.`,
        }
      : {
          sourceId: bidCalculatorSourceId(result.bidId, 'warranty'),
          level: 'E1',
          verdict: 'pass',
          summary: `${result.contractorName} states a ${result.warrantyMonths}-month workmanship warranty in writing.`,
        };

  return [
    buildAdjustedTotalEvidence(result),
    scopeCompletenessEvidence,
    paymentRiskEvidence,
    warrantyEvidence,
  ];
}

export function calculateBidEconomics(input: BidCalculatorInput): ToolResult<BidCalculatorResult> {
  if (isAborted(input.signal)) {
    return cancelledResult(BID_CALCULATOR_TOOL_ID);
  }

  if (!isBidFixtureName(input.bidId)) {
    return notFoundResult(
      BID_CALCULATOR_TOOL_ID,
      input.bidId,
      `no bid fixture found for bidId "${input.bidId}"`,
    );
  }

  const job = loadFixture('job');
  const bid = loadFixture(input.bidId);

  if (isAborted(input.signal)) {
    return cancelledResult(BID_CALCULATOR_TOOL_ID);
  }

  const diff = diffBidScope(job, bid);
  const plugNumbers = input.plugNumbers ?? {};
  const adjustedTotal = computeAdjustedTotal(bid.total, diff.absentItemIds, plugNumbers);
  const scopeCompleteness = round4(diff.pricedItemCount / diff.requiredItemCount);
  const paymentRisk = derivePaymentRisk(bid.depositPercent);

  const partial: Omit<BidCalculatorResult, 'evidence'> = {
    bidId: bid.bidId,
    contractorName: bid.contractorName,
    quotedTotal: { ...bid.total },
    adjustedTotal,
    requiredItemCount: diff.requiredItemCount,
    pricedItemCount: diff.pricedItemCount,
    absentItemIds: diff.absentItemIds,
    scopeCompleteness,
    depositPercent: bid.depositPercent,
    paymentRisk,
    warrantyMonths: bid.warranty.termMonths,
  };

  return okResult(BID_CALCULATOR_TOOL_ID, { ...partial, evidence: buildEvidence(partial) });
}
