import { describe, expect, it } from 'vitest';
import {
  BID_FIXTURE_NAMES,
  BID_READER_TOOL_ID,
  isBidFixtureName,
  readBid,
  type BidReaderResult,
} from './bid-reader.js';

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

describe('isBidFixtureName', () => {
  it('accepts exactly the twelve real bid ids', () => {
    expect(BID_FIXTURE_NAMES).toEqual([
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
    ]);
    for (const bidId of BID_FIXTURE_NAMES) {
      expect(isBidFixtureName(bidId)).toBe(true);
    }
  });

  it('rejects an unknown id', () => {
    expect(isBidFixtureName('bid-does-not-exist')).toBe(false);
  });
});

describe('readBid', () => {
  it('reads the real Northgate bid: $276,000.00 total, 25% deposit, 24-month warranty', () => {
    const result = readBid({ bidId: 'bid-northgate' });
    expectOk<BidReaderResult>(result);
    expect(result.data.contractorName).toBe('Northgate Plumbing');
    expect(result.data.licenseNumber).toBe('PL-4417-NG');
    expect(result.data.total).toEqual({ amount: 276000, currency: 'USD' });
    expect(result.data.depositPercent).toBe(25);
    expect(result.data.warranty).toEqual({
      present: true,
      termMonths: 24,
      statedInWriting: true,
      note: '24-month workmanship warranty stated in the written bid document.',
    });
    expect(result.data.lineItems).toHaveLength(8);
  });

  it('reads the real Cedar bid: $223,500.00 total, 45% deposit, and a null (not 0) warranty termMonths', () => {
    const result = readBid({ bidId: 'bid-cedar' });
    expectOk<BidReaderResult>(result);
    expect(result.data.contractorName).toBe('Cedar & Sons');
    expect(result.data.total).toEqual({ amount: 223500, currency: 'USD' });
    expect(result.data.depositPercent).toBe(45);
    // The core "never coalesce an explicit unknown to 0" invariant, pinned
    // at the reader layer too: Cedar's warranty has no stated term.
    expect(result.data.warranty.termMonths).toBeNull();
    expect(result.data.warranty.termMonths).not.toBe(0);
    // Cedar's bid is missing 3 of the 8 required scope items.
    expect(result.data.lineItems).toHaveLength(5);
  });

  it('reads the real Two Rivers bid: $288,750.00 total, 36-month warranty', () => {
    const result = readBid({ bidId: 'bid-tworivers' });
    expectOk<BidReaderResult>(result);
    expect(result.data.contractorName).toBe('Two Rivers Mechanical');
    expect(result.data.total).toEqual({ amount: 288750, currency: 'USD' });
    expect(result.data.warranty.termMonths).toBe(36);
  });

  it('reads all nine also-ran bids without error, each pricing at least one required scope item', () => {
    for (const bidId of [
      'bid-summit',
      'bid-ironclad',
      'bid-parkside',
      'bid-westbrook',
      'bid-anchor',
      'bid-crestview',
      'bid-fieldstone',
      'bid-brightwater',
      'bid-oldmill',
    ] as const) {
      const result = readBid({ bidId });
      expectOk<BidReaderResult>(result);
      expect(result.data.lineItems.length).toBeGreaterThan(0);
      expect(result.data.total.amount).toBeGreaterThan(0);
    }
  });

  it('produces one E1 evidence item whose summary names the real dollar total and deposit percent', () => {
    const result = readBid({ bidId: 'bid-northgate' });
    expectOk<BidReaderResult>(result);
    expect(result.data.evidence).toHaveLength(1);
    const [item] = result.data.evidence;
    expect(item?.level).toBe('E1');
    expect(item?.verdict).toBe('pass');
    expect(item?.sourceId).toBe('source-bid-northgate');
    // Pinned dollar figure and formatting -- an evidence summary that could
    // be emptied to "" with the suite still green is not evidence.
    expect(item?.summary).toContain('$276,000.00');
    expect(item?.summary).toContain('25% deposit');
  });

  it('returns a deterministic not_found result for an unknown bidId, without throwing', () => {
    const result = readBid({ bidId: 'bid-does-not-exist' });
    if (result.status !== 'not_found') {
      throw new Error(`expected status "not_found", got "${result.status}"`);
    }
    expect(result.toolId).toBe(BID_READER_TOOL_ID);
    expect(result.query).toBe('bid-does-not-exist');
  });

  it('is deterministic: identical input twice produces deep-equal output', () => {
    const first = readBid({ bidId: 'bid-cedar' });
    const second = readBid({ bidId: 'bid-cedar' });
    expect(second).toEqual(first);
  });

  it('returns a cancelled result when called with an already-aborted signal, before loading anything', () => {
    const controller = new AbortController();
    controller.abort();
    const result = readBid({ bidId: 'bid-northgate', signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect((result as { toolId: string }).toolId).toBe(BID_READER_TOOL_ID);
  });

  it('checks the signal again mid-flight and honors a late abort', () => {
    const result = readBid({ bidId: 'bid-northgate', signal: signalAbortingOnRead(2) });
    expect(result.status).toBe('cancelled');
  });
});
