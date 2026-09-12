import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';
import {
  BID_DOCUMENT_EXTRACTOR_TOOL_ID,
  BID_DOCUMENT_FIELDS,
  DERIVED_FIELD_CONFIDENCE,
  MAX_EXTRACTED_LINE_ITEMS,
  QUALIFIED_FIELD_CONFIDENCE,
  REQUIRED_BID_DOCUMENT_FIELDS,
  STATED_FIELD_CONFIDENCE,
  extractBidDocument,
  type BidDocumentExtractionResult,
} from './bid-document-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIDS_FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'bids');

/** The real, checked-in `bid-northgate.json` bytes -- the happy path reads an actual bid document, not a hand-written stub of one. */
const NORTHGATE_JSON = readFileSync(join(BIDS_FIXTURES_DIR, 'bid-northgate.json'), 'utf8');

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

function expectOk(result: {
  status: string;
}): asserts result is { status: 'ok'; data: BidDocumentExtractionResult } {
  expect(result.status).toBe('ok');
}

const SOURCE_ID = 'source-1';

function extract(
  overrides: Partial<Parameters<typeof extractBidDocument>[0]> = {},
): ReturnType<typeof extractBidDocument> {
  return extractBidDocument({
    sourceId: SOURCE_ID,
    filename: 'bid.json',
    format: 'application/json',
    text: NORTHGATE_JSON,
    ...overrides,
  });
}

describe('extractBidDocument (application/json)', () => {
  it('reads every stated field off a real bid document (happy path)', () => {
    const result = extract();
    expectOk(result);
    const data = result.data;

    expect(result.toolId).toBe(BID_DOCUMENT_EXTRACTOR_TOOL_ID);
    expect(data.fields.contractorName?.value).toBe('Northgate Plumbing');
    expect(data.fields.licenseNumber?.value).toBe('PL-4417-NG');
    expect(data.fields.total?.value).toEqual({ amount: 276000, currency: 'USD' });
    expect(data.fields.depositPercent?.value).toBe(25);
    expect(data.fields.startInWeeks?.value).toBe(3);
    expect(data.fields.durationWorkingDays?.value).toBe(45);
    expect(data.fields.warrantyMonths?.value).toBe(24);
    expect(data.lineItems).toHaveLength(8);
    expect(data.lineItems[0]).toEqual({
      scopeItemId: 'demo-existing',
      label: 'Demo of existing restroom and locker-room fixtures, piping, and abandoned risers',
      amount: { amount: 22500, currency: 'USD' },
    });
    expect(data.missingRequiredFields).toEqual([]);
    expect(data.missingOptionalFields).toEqual([]);
    expect(data.documentBytes).toBe(Buffer.byteLength(NORTHGATE_JSON, 'utf8'));
  });

  it('gives every stated value a confidence below certainty, and traces it to the submitted document', () => {
    const result = extract();
    expectOk(result);

    for (const field of BID_DOCUMENT_FIELDS) {
      const extracted = result.data.fields[field];
      if (extracted === undefined) continue;
      expect(extracted.confidence).toBe(STATED_FIELD_CONFIDENCE);
      expect(extracted.confidence).toBeLessThan(1);
      expect(extracted.basis.length).toBeGreaterThan(0);
    }
    expect(result.data.sourceId).toBe(SOURCE_ID);
    expect(result.data.evidence).toHaveLength(1);
    expect(result.data.evidence[0]?.sourceId).toBe(SOURCE_ID);
    expect(result.data.evidence[0]?.level).toBe('E1');
    expect(result.data.evidence[0]?.verdict).toBe('pass');
  });

  it('drops a warranty term to a qualified confidence when it is not stated in writing', () => {
    const document = JSON.parse(NORTHGATE_JSON) as Record<string, unknown>;
    document['warranty'] = { present: true, termMonths: 12, statedInWriting: false };
    const result = extract({ text: JSON.stringify(document) });
    expectOk(result);

    expect(result.data.fields.warrantyMonths?.value).toBe(12);
    expect(result.data.fields.warrantyMonths?.confidence).toBe(QUALIFIED_FIELD_CONFIDENCE);
  });

  it('leaves a null warranty term unknown rather than reading it as zero months', () => {
    const document = JSON.parse(NORTHGATE_JSON) as Record<string, unknown>;
    document['warranty'] = { present: true, termMonths: null, statedInWriting: false };
    const result = extract({ text: JSON.stringify(document) });
    expectOk(result);

    expect(result.data.fields.warrantyMonths).toBeUndefined();
    expect(result.data.missingOptionalFields).toEqual(['warrantyMonths']);
    // Never a zero, never a fabricated default.
    expect(JSON.stringify(result.data.fields)).not.toContain('"warrantyMonths"');
  });

  it('derives a total from the document own line items when no total is stated, at a lower confidence', () => {
    const document = JSON.parse(NORTHGATE_JSON) as Record<string, unknown>;
    delete document['total'];
    const result = extract({ text: JSON.stringify(document) });
    expectOk(result);

    expect(result.data.fields.total?.value).toEqual({ amount: 276000, currency: 'USD' });
    expect(result.data.fields.total?.confidence).toBe(DERIVED_FIELD_CONFIDENCE);
    expect(result.data.fields.total?.basis).toContain('summed');
  });

  it('reports every required field it could not read, and reads the ones it could (missing required fields)', () => {
    const result = extract({
      text: JSON.stringify({ contractorName: 'Half A Bid', depositPercent: 10 }),
    });
    expectOk(result);

    expect(result.data.fields.contractorName?.value).toBe('Half A Bid');
    expect(result.data.fields.depositPercent?.value).toBe(10);
    expect(result.data.missingRequiredFields).toEqual([
      'licenseNumber',
      'total',
      'startInWeeks',
      'durationWorkingDays',
    ]);
    expect(result.data.missingOptionalFields).toEqual(['warrantyMonths']);
    // Every name reported missing really is absent from `fields`.
    for (const field of [
      ...result.data.missingRequiredFields,
      ...result.data.missingOptionalFields,
    ]) {
      expect(result.data.fields[field]).toBeUndefined();
    }
    expect(result.data.evidence[0]?.verdict).toBe('degraded');
  });

  it('refuses a field written with the wrong type rather than coercing it', () => {
    const result = extract({
      text: JSON.stringify({ depositPercent: '25', startInWeeks: 'three', total: 276000 }),
    });
    expectOk(result);

    expect(result.data.fields.depositPercent).toBeUndefined();
    expect(result.data.fields.startInWeeks).toBeUndefined();
    expect(result.data.fields.total).toBeUndefined();
  });

  it('refuses a deposit percentage outside 0-100', () => {
    const result = extract({ text: JSON.stringify({ depositPercent: 250 }) });
    expectOk(result);
    expect(result.data.fields.depositPercent).toBeUndefined();
    expect(result.data.missingRequiredFields).toContain('depositPercent');
  });

  it('returns not_found for a document that is not valid JSON (malformed)', () => {
    const result = extract({ text: '{ "contractorName": ' });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.query).toBe('bid.json');
    expect(result.message).toContain('not valid JSON');
  });

  it('returns not_found for valid JSON that is not a bid object', () => {
    const result = extract({ text: '[1, 2, 3]' });
    expect(result.status).toBe('not_found');
  });
});

describe('extractBidDocument (text/csv)', () => {
  const CSV = [
    'scopeItemId,label,amount,currency',
    'demo-existing,Demo of existing fixtures,22500,USD',
    'rough-in-supply,"Rough-in supply piping, all locations",48000,USD',
  ].join('\n');

  it('reads a line-item table and sums it into a derived total (happy path)', () => {
    const result = extract({ format: 'text/csv', filename: 'bid.csv', text: CSV });
    expectOk(result);

    expect(result.data.lineItems).toEqual([
      {
        scopeItemId: 'demo-existing',
        label: 'Demo of existing fixtures',
        amount: { amount: 22500, currency: 'USD' },
      },
      {
        scopeItemId: 'rough-in-supply',
        label: 'Rough-in supply piping, all locations',
        amount: { amount: 48000, currency: 'USD' },
      },
    ]);
    expect(result.data.fields.total?.value).toEqual({ amount: 70500, currency: 'USD' });
    expect(result.data.fields.total?.confidence).toBe(DERIVED_FIELD_CONFIDENCE);
  });

  it('reports every other required field as unreadable, because a line-item table states none of them', () => {
    const result = extract({ format: 'text/csv', filename: 'bid.csv', text: CSV });
    expectOk(result);

    expect(result.data.missingRequiredFields).toEqual([
      'contractorName',
      'licenseNumber',
      'depositPercent',
      'startInWeeks',
      'durationWorkingDays',
    ]);
  });

  it('accepts a dollar sign and thousands separators, and a trailing ISO code', () => {
    const result = extract({
      format: 'text/csv',
      filename: 'bid.csv',
      text: ['description,price', 'Demo,"$22,500.00"', 'Rough-in,48000 USD'].join('\n'),
    });
    expectOk(result);

    expect(result.data.lineItems.map((item) => item.amount)).toEqual([
      { amount: 22500, currency: 'USD' },
      { amount: 48000, currency: 'USD' },
    ]);
    expect(result.data.lineItems[0]?.scopeItemId).toBeUndefined();
  });

  it('returns not_found when the header row names no label or no amount column (malformed)', () => {
    const result = extract({
      format: 'text/csv',
      filename: 'bid.csv',
      text: ['foo,bar', '1,2'].join('\n'),
    });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.message).toContain('header row');
  });

  it('refuses a row whose amount cannot be read rather than silently dropping priced scope', () => {
    const result = extract({
      format: 'text/csv',
      filename: 'bid.csv',
      text: ['label,amount,currency', 'Demo,22500,USD', 'Rough-in,TBD,USD'].join('\n'),
    });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.message).toContain('row 3');
  });

  it('refuses an amount with no currency anywhere rather than assuming one', () => {
    const result = extract({
      format: 'text/csv',
      filename: 'bid.csv',
      text: ['label,amount', 'Demo,22500'].join('\n'),
    });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.message).toContain('no currency');
  });

  it('returns not_found for a header row with no rows under it', () => {
    const result = extract({
      format: 'text/csv',
      filename: 'bid.csv',
      text: 'label,amount,currency',
    });
    expect(result.status).toBe('not_found');
  });
});

describe('extractBidDocument size caps', () => {
  it('refuses a document above MAX_BID_DOCUMENT_BYTES', () => {
    const oversize = `{"note":"${'a'.repeat(MAX_BID_DOCUMENT_BYTES)}"}`;
    const result = extract({ text: oversize });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.message).toContain(`${MAX_BID_DOCUMENT_BYTES}-byte cap`);
  });

  it('measures the cap in UTF-8 bytes, not UTF-16 code units', () => {
    // Each `€` is one code unit but three UTF-8 bytes, so a string well
    // under the cap by `.length` is well over it by bytes.
    const text = `{"note":"${'€'.repeat(MAX_BID_DOCUMENT_BYTES / 2)}"}`;
    expect(text.length).toBeLessThan(MAX_BID_DOCUMENT_BYTES);
    const result = extract({ text });
    expect(result.status).toBe('not_found');
  });

  it('accepts a document exactly at the cap', () => {
    const filler = 'a'.repeat(MAX_BID_DOCUMENT_BYTES - '{"contractorName":""}'.length);
    const text = `{"contractorName":"${filler}"}`;
    expect(Buffer.byteLength(text, 'utf8')).toBe(MAX_BID_DOCUMENT_BYTES);
    const result = extract({ text });
    expectOk(result);
    expect(result.data.documentBytes).toBe(MAX_BID_DOCUMENT_BYTES);
  });

  it('refuses a JSON document above MAX_EXTRACTED_LINE_ITEMS rather than truncating it', () => {
    const lineItems = Array.from({ length: MAX_EXTRACTED_LINE_ITEMS + 1 }, (_unused, index) => ({
      scopeItemId: `item-${index}`,
      label: `Item ${index}`,
      amount: { amount: 100, currency: 'USD' },
    }));
    const result = extract({ text: JSON.stringify({ contractorName: 'Big Bid', lineItems }) });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.message).toContain(`${MAX_EXTRACTED_LINE_ITEMS}-item cap`);
    expect(result.message).toContain('refused rather than truncated');
  });

  it('accepts a JSON document exactly at MAX_EXTRACTED_LINE_ITEMS', () => {
    const lineItems = Array.from({ length: MAX_EXTRACTED_LINE_ITEMS }, (_unused, index) => ({
      scopeItemId: `item-${index}`,
      label: `Item ${index}`,
      amount: { amount: 100, currency: 'USD' },
    }));
    const result = extract({ text: JSON.stringify({ lineItems }) });
    expectOk(result);
    expect(result.data.lineItems).toHaveLength(MAX_EXTRACTED_LINE_ITEMS);
  });

  it('refuses a CSV above MAX_EXTRACTED_LINE_ITEMS rather than truncating it', () => {
    const rows = Array.from(
      { length: MAX_EXTRACTED_LINE_ITEMS + 1 },
      (_unused, index) => `item-${index},Item ${index},100,USD`,
    );
    const result = extract({
      format: 'text/csv',
      filename: 'bid.csv',
      text: ['scopeItemId,label,amount,currency', ...rows].join('\n'),
    });
    expect(result.status).toBe('not_found');
    if (result.status !== 'not_found') throw new Error('unreachable');
    expect(result.message).toContain(`${MAX_EXTRACTED_LINE_ITEMS}-item cap`);
  });

  it('returns not_found for an empty document', () => {
    const result = extract({ text: '   ' });
    expect(result.status).toBe('not_found');
  });
});

describe('extractBidDocument cancellation', () => {
  it('returns cancelled when the signal has already fired', () => {
    const result = extract({ signal: signalAbortingOnRead(1) });
    expect(result.status).toBe('cancelled');
  });

  it('returns cancelled when the signal fires after parsing', () => {
    const result = extract({ signal: signalAbortingOnRead(2) });
    expect(result.status).toBe('cancelled');
  });
});

describe('extractBidDocument determinism', () => {
  it('produces byte-identical results for identical input', () => {
    expect(JSON.stringify(extract())).toBe(JSON.stringify(extract()));
  });

  it('declares every required field as a member of the full field vocabulary', () => {
    for (const field of REQUIRED_BID_DOCUMENT_FIELDS) {
      expect(BID_DOCUMENT_FIELDS).toContain(field);
    }
    // Every field is reported in exactly one of the two missing lists when
    // nothing at all can be read, so no field can be silently forgotten.
    const result = extract({ text: '{}' });
    expectOk(result);
    expect([
      ...result.data.missingRequiredFields,
      ...result.data.missingOptionalFields,
    ]).toHaveLength(BID_DOCUMENT_FIELDS.length);
  });
});
