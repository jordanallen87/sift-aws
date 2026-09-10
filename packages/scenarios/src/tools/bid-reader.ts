/**
 * Fixture tool: "bid reader"
 * (docs/bid-comparison/plan.md "Specialists and skills": `scope-analyst`,
 * `price-analyst`, `schedule-analyst`, and `source-challenger` all read
 * `bid-reader`).
 *
 * Given a bid id, returns that one subcontractor bid's raw facts straight
 * from its own bid fixture (`bid-northgate.json` / `bid-cedar.json` /
 * `bid-tworivers.json`): contractor name, licence number, quoted total,
 * itemized line items, deposit percent, warranty terms, schedule, and
 * allowances. Thin, like `bill-reader.ts`/`tariff-lookup.ts` -- one
 * traceable document, one E1 evidence item, no cross-document arithmetic.
 * That arithmetic (which required items a bid leaves absent, the plug-
 * adjusted total, payment risk) lives in `scope-differ.ts` and
 * `bid-calculator.ts`, which each load their own bid fixture directly
 * rather than routing through this reader -- the same split
 * `energy-calculator.ts` and `bill-reader.ts` keep in the Home Energy
 * Guardian pack (a "calculator" reads raw fixtures for math; a "reader"
 * shapes the same document for display).
 *
 * `BID_FIXTURE_NAMES`/`BidFixtureName`/`isBidFixtureName` are this pack's
 * one definition of "which bid ids exist" -- `scope-differ.ts` and
 * `bid-calculator.ts` both import and reuse them rather than re-declaring
 * the same twelve-id list a second (or third) time. A bid's own `bidId`
 * field is always identical to its fixture name (`job.biddersInvited` lists
 * these same twelve strings), so no separate short-alias id is invented.
 */
import {
  loadFixture,
  type Bid,
  type BidAllowance,
  type BidLineItem,
  type BidWarranty,
} from './fixture-loader.js';
import {
  cancelledResult,
  isAborted,
  notFoundResult,
  okResult,
  type ToolEvidenceItem,
  type ToolResult,
} from './tool-result.js';

export const BID_READER_TOOL_ID = 'bid-reader';

export interface MoneyAmount {
  amount: number;
  currency: string;
}

/**
 * The twelve bid fixtures this pack registers -- see the file docstring.
 * Scaled from three to twelve (2026-09-08) to match how many bids a real
 * commercial/public trade-package solicitation routinely draws through a
 * plan room, not a hand-picked handful: `bid-northgate`/`bid-cedar`/
 * `bid-tworivers` remain the three the scripted narrative names individually
 * (the recommendation, the scope-normalization beat, and the round-2 hard-
 * constraint beat, respectively); the other nine are also-ran bids that
 * fill out a realistic bid tab without disturbing any of those three beats.
 */
export const BID_FIXTURE_NAMES = [
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
] as const;
export type BidFixtureName = (typeof BID_FIXTURE_NAMES)[number];

export function isBidFixtureName(value: string): value is BidFixtureName {
  return (BID_FIXTURE_NAMES as readonly string[]).includes(value);
}

export interface BidReaderResult {
  bidId: string;
  jobId: string;
  contractorName: string;
  licenseNumber: string;
  total: MoneyAmount;
  lineItems: BidLineItem[];
  depositPercent: number;
  warranty: BidWarranty;
  startInWeeks: number;
  durationWorkingDays: number;
  allowances: BidAllowance[];
  evidence: ToolEvidenceItem[];
}

export interface BidReaderInput {
  bidId: string;
  signal?: AbortSignal;
}

function bidSourceId(bidId: string): string {
  return `source-${bidId}`;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEvidence(bid: Bid): ToolEvidenceItem[] {
  return [
    {
      sourceId: bidSourceId(bid.bidId),
      level: 'E1',
      verdict: 'pass',
      summary: `${bid.contractorName} (${bid.bidId}): $${formatCurrency(bid.total.amount)} total across ${bid.lineItems.length} line item${bid.lineItems.length === 1 ? '' : 's'}, ${bid.depositPercent}% deposit.`,
    },
  ];
}

function toResult(bid: Bid): BidReaderResult {
  return {
    bidId: bid.bidId,
    jobId: bid.jobId,
    contractorName: bid.contractorName,
    licenseNumber: bid.licenseNumber,
    total: { ...bid.total },
    lineItems: bid.lineItems.map((item) => ({ ...item, amount: { ...item.amount } })),
    depositPercent: bid.depositPercent,
    warranty: { ...bid.warranty },
    startInWeeks: bid.startInWeeks,
    durationWorkingDays: bid.durationWorkingDays,
    allowances: bid.allowances.map((allowance) => ({
      ...allowance,
      amount: { ...allowance.amount },
    })),
    evidence: buildEvidence(bid),
  };
}

export function readBid(input: BidReaderInput): ToolResult<BidReaderResult> {
  if (isAborted(input.signal)) {
    return cancelledResult(BID_READER_TOOL_ID);
  }

  if (!isBidFixtureName(input.bidId)) {
    return notFoundResult(
      BID_READER_TOOL_ID,
      input.bidId,
      `no bid fixture found for bidId "${input.bidId}"`,
    );
  }

  const bid = loadFixture(input.bidId);

  if (isAborted(input.signal)) {
    return cancelledResult(BID_READER_TOOL_ID);
  }

  return okResult(BID_READER_TOOL_ID, toResult(bid));
}
