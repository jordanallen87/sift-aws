import { describe, expect, it } from 'vitest';
import { loadFixture } from './fixture-loader.js';
import {
  SCOPE_DIFFER_TOOL_ID,
  compareBidScope,
  diffBidScope,
  type ScopeDifferResult,
} from './scope-differ.js';

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

const JOB = {
  requiredScopeLineItems: [
    { scopeItemId: 'demo-existing', label: 'Demo of existing tub, tile surround, and fixtures' },
    {
      scopeItemId: 'permits-inspections',
      label: 'Plumbing permit filing and inspection scheduling',
    },
    { scopeItemId: 'debris-haul-away', label: 'Haul-away and disposal of demolition debris' },
  ],
};

describe('diffBidScope (pure)', () => {
  it('classifies a required item with no matching line item at all as "absent"', () => {
    const diff = diffBidScope(JOB, {
      bidId: 'bid-test',
      contractorName: 'Test Co',
      lineItems: [{ scopeItemId: 'demo-existing', amount: { amount: 1500, currency: 'USD' } }],
    });
    const permits = diff.items.find((item) => item.scopeItemId === 'permits-inspections');
    expect(permits?.status).toBe('absent');
    expect(permits).not.toHaveProperty('amount');
    expect(diff.absentItemIds).toEqual(
      expect.arrayContaining(['permits-inspections', 'debris-haul-away']),
    );
    expect(diff.absentItemCount).toBe(2);
    expect(diff.pricedItemCount).toBe(1);
  });

  it('distinguishes a line item priced at exactly $0 ("priced_at_zero") from a genuinely absent item -- the core distinction this tool exists to make', () => {
    const diff = diffBidScope(JOB, {
      bidId: 'bid-test',
      contractorName: 'Test Co',
      lineItems: [
        { scopeItemId: 'demo-existing', amount: { amount: 1500, currency: 'USD' } },
        // Explicitly included at no charge -- not the same as never mentioning it.
        { scopeItemId: 'permits-inspections', amount: { amount: 0, currency: 'USD' } },
      ],
    });
    const permits = diff.items.find((item) => item.scopeItemId === 'permits-inspections');
    expect(permits?.status).toBe('priced_at_zero');
    expect(permits?.amount).toEqual({ amount: 0, currency: 'USD' });

    const debris = diff.items.find((item) => item.scopeItemId === 'debris-haul-away');
    expect(debris?.status).toBe('absent');
    expect(debris).not.toHaveProperty('amount');

    // priced_at_zero counts as priced, not absent.
    expect(diff.pricedItemCount).toBe(2);
    expect(diff.absentItemCount).toBe(1);
    expect(diff.absentItemIds).toEqual(['debris-haul-away']);
  });

  it('classifies a normally priced (> $0) line item as "priced"', () => {
    const diff = diffBidScope(JOB, {
      bidId: 'bid-test',
      contractorName: 'Test Co',
      lineItems: [{ scopeItemId: 'demo-existing', amount: { amount: 1500, currency: 'USD' } }],
    });
    const demo = diff.items.find((item) => item.scopeItemId === 'demo-existing');
    expect(demo?.status).toBe('priced');
    expect(demo?.amount).toEqual({ amount: 1500, currency: 'USD' });
  });

  it('is deterministic: identical input twice produces deep-equal output', () => {
    const bid = {
      bidId: 'bid-test',
      contractorName: 'Test Co',
      lineItems: [{ scopeItemId: 'demo-existing', amount: { amount: 1500, currency: 'USD' } }],
    };
    expect(diffBidScope(JOB, bid)).toEqual(diffBidScope(JOB, bid));
  });
});

describe('SCOPE_DIFFER_TOOL_ID', () => {
  it('names the tool id exactly, at the documented literal value', () => {
    // Hardcoded, not `expect(SCOPE_DIFFER_TOOL_ID).toBe(SCOPE_DIFFER_TOOL_ID)` --
    // comparing the constant to itself can never fail no matter what value it
    // holds, which is exactly the kind of test gap that let a mutant collapse
    // this constant to "" survive elsewhere in this file.
    expect(SCOPE_DIFFER_TOOL_ID).toBe('scope-differ');
  });
});

describe('compareBidScope', () => {
  it('reports Northgate and Two Rivers as pricing all 8 required scope items -- no absences', () => {
    const job = loadFixture('job');
    const result = compareBidScope({ bidIds: ['bid-northgate', 'bid-tworivers'] });
    expectOk<ScopeDifferResult>(result);
    expect(result.data.requiredScopeLineItems).toHaveLength(8);
    // Each entry carries the job's real scopeItemId/label, not an
    // undefined or empty-object placeholder -- `toHaveLength` alone cannot
    // tell an array of 8 real items from an array of 8 blanks.
    expect(result.data.requiredScopeLineItems).toEqual(job.requiredScopeLineItems);

    const northgate = result.data.bids.find((bid) => bid.bidId === 'bid-northgate');
    expect(northgate?.requiredItemCount).toBe(8);
    expect(northgate?.pricedItemCount).toBe(8);
    expect(northgate?.absentItemCount).toBe(0);
    expect(northgate?.absentItemIds).toEqual([]);

    const twoRivers = result.data.bids.find((bid) => bid.bidId === 'bid-tworivers');
    expect(twoRivers?.absentItemCount).toBe(0);
  });

  it('reports Cedar as missing exactly permits-inspections, shower-valve-rough-in, and debris-haul-away', () => {
    const result = compareBidScope({ bidIds: ['bid-cedar'] });
    expectOk<ScopeDifferResult>(result);
    const [cedar] = result.data.bids;
    expect(cedar?.bidId).toBe('bid-cedar');
    expect(cedar?.requiredItemCount).toBe(8);
    expect(cedar?.pricedItemCount).toBe(5);
    expect(cedar?.absentItemCount).toBe(3);
    expect(new Set(cedar?.absentItemIds)).toEqual(
      new Set(['permits-inspections', 'shower-valve-rough-in', 'debris-haul-away']),
    );
  });

  it("defaults to every bidder in job.json's biddersInvited when bidIds is omitted", () => {
    const job = loadFixture('job');
    const result = compareBidScope();
    expectOk<ScopeDifferResult>(result);
    expect(result.data.bids.map((bid) => bid.bidId).sort()).toEqual([...job.biddersInvited].sort());
  });

  it("names the actual missing item labels in Cedar's evidence summary, not just a count", () => {
    const result = compareBidScope({ bidIds: ['bid-cedar'] });
    expectOk<ScopeDifferResult>(result);
    const [item] = result.data.evidence;
    expect(item?.level).toBe('E3');
    expect(item?.verdict).toBe('degraded');
    expect(item?.sourceId).toBe('source-scope-diff-bid-cedar');
    expect(item?.summary).toContain('Plumbing permit filing and inspection scheduling');
    expect(item?.summary).toContain(
      'Shower valve rough-in and blocking for the gymnasium locker-room showers',
    );
    expect(item?.summary).toContain('Haul-away and disposal of demolition debris');
    expect(item?.summary).toContain('3 of 8');
    // The three missing labels joined by "; ", in job order, and nothing
    // else in between -- proves the "absent" filter this evidence text is
    // built from actually excludes the 5 priced items (a filter that kept
    // every item, or a separator emptied to "", would each still pass the
    // three independent `toContain` checks above but would break this
    // exact contiguous substring).
    expect(item?.summary).toContain(
      'Shower valve rough-in and blocking for the gymnasium locker-room showers; ' +
        'Plumbing permit filing and inspection scheduling; ' +
        'Haul-away and disposal of demolition debris',
    );
    // None of Cedar's 5 actually-priced item labels leak into the "missing" list.
    expect(item?.summary).not.toContain(
      'Demo of existing restroom and locker-room fixtures, piping, and abandoned risers',
    );
    expect(item?.summary).not.toContain('Set and connect all restroom and locker-room fixtures');
  });

  it("passes for Northgate's evidence with no absences", () => {
    const result = compareBidScope({ bidIds: ['bid-northgate'] });
    expectOk<ScopeDifferResult>(result);
    const [item] = result.data.evidence;
    expect(item?.level).toBe('E3');
    expect(item?.verdict).toBe('pass');
    expect(item?.sourceId).toBe('source-scope-diff-bid-northgate');
    expect(item?.summary).toContain('Northgate Plumbing');
    expect(item?.summary).toContain('all 8 required scope items');
  });

  it('returns a deterministic not_found result for an unknown bidId, without throwing', () => {
    const result = compareBidScope({ bidIds: ['bid-does-not-exist'] });
    if (result.status !== 'not_found') {
      throw new Error(`expected status "not_found", got "${result.status}"`);
    }
    expect(result.toolId).toBe(SCOPE_DIFFER_TOOL_ID);
    expect(result.query).toBe('bid-does-not-exist');
    // The message is what a caller would actually see; pin it, not just its
    // presence, so it cannot be silently emptied to "".
    expect(result.message).toContain('bid-does-not-exist');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('is deterministic: identical input twice produces deep-equal output', () => {
    const first = compareBidScope({ bidIds: ['bid-cedar', 'bid-northgate'] });
    const second = compareBidScope({ bidIds: ['bid-cedar', 'bid-northgate'] });
    expect(second).toEqual(first);
  });

  it('returns a cancelled result when called with an already-aborted signal', () => {
    const controller = new AbortController();
    controller.abort();
    const result = compareBidScope({ signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect((result as { toolId: string }).toolId).toBe(SCOPE_DIFFER_TOOL_ID);
  });

  it('checks the signal BEFORE validating bidIds -- an already-aborted call is cancelled even when bidIds also contains an unknown id', () => {
    // If the first abort check were skipped (or its early return removed),
    // execution would instead reach the bidId-validation loop below it and
    // return `not_found` for "bid-does-not-exist" before ever reaching the
    // second abort check -- silently converting a cancellation into a
    // normal input error, and doing the job/bidId work the abort exists to
    // avoid.
    const controller = new AbortController();
    controller.abort();
    const result = compareBidScope({
      bidIds: ['bid-does-not-exist'],
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
  });

  it('checks the signal again mid-flight and honors a late abort', () => {
    const result = compareBidScope({ signal: signalAbortingOnRead(2) });
    expect(result.status).toBe('cancelled');
  });
});
