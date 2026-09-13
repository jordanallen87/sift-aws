import { describe, expect, it } from 'vitest';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';
import type { AttributeDefinition, AttributeRecord, EntityRecord } from '@sift/contracts';
import {
  bidDocumentFormatFromFile,
  bidDocumentSizeRefusal,
  classifyChosenBidDocumentFile,
  formatConfidence,
  summarizeBidDocumentImport,
  supportsBidDocumentImport,
  unreadableBidDocumentMessage,
  utf8ByteLength,
} from './bid-document-import.js';
import { buildFixtureCaseState } from '../test/fixtures.js';

const TIMESTAMP = '2026-09-01T00:00:00.000Z';

function definition(id: string, label: string, required: boolean): AttributeDefinition {
  return {
    id,
    label,
    valueType: 'number',
    required,
    appliesTo: ['bid'],
    evidenceExpectation: 'assertion',
    comparison: 'lower_better',
    sensitive: false,
  };
}

function readRecord(id: string, label: string, confidence: number): AttributeRecord {
  return {
    definitionId: id,
    label,
    value: { type: 'number', value: 12 },
    origin: 'agent_proposed',
    sourceIds: ['source-doc-1'],
    confidence,
    status: 'supported',
    updatedAt: TIMESTAMP,
  };
}

function unreadRecord(id: string, label: string): AttributeRecord {
  return {
    definitionId: id,
    label,
    origin: 'agent_proposed',
    sourceIds: ['source-doc-1'],
    status: 'unknown',
    updatedAt: TIMESTAMP,
  };
}

function bidEntity(id: string, attributes: AttributeRecord[]): EntityRecord {
  return {
    id,
    kind: 'bid',
    label: 'Northgate Builders',
    attributes: Object.fromEntries(attributes.map((record) => [record.definitionId, record])),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

describe('supportsBidDocumentImport', () => {
  it('offers the import on a pack whose declared option kind is the one the command writes', () => {
    expect(supportsBidDocumentImport('bid')).toBe(true);
  });

  it('withholds it from every other pack', () => {
    expect(supportsBidDocumentImport('car')).toBe(false);
    expect(supportsBidDocumentImport('option')).toBe(false);
  });
});

describe('bidDocumentFormatFromFile', () => {
  it('derives the format from the file extension', () => {
    expect(bidDocumentFormatFromFile('bid-northgate.json', '')).toBe('application/json');
    expect(bidDocumentFormatFromFile('line-items.csv', '')).toBe('text/csv');
  });

  it('ignores extension case', () => {
    expect(bidDocumentFormatFromFile('BID.JSON', '')).toBe('application/json');
  });

  // The real case this covers: a machine with Excel installed reports a .csv
  // as `application/vnd.ms-excel`. The name the person saved the file under
  // is the better evidence.
  it('prefers the extension over a MIME type the operating system got wrong', () => {
    expect(bidDocumentFormatFromFile('bid.csv', 'application/vnd.ms-excel')).toBe('text/csv');
  });

  it('falls back to the MIME type when the name carries no usable extension', () => {
    expect(bidDocumentFormatFromFile('bid-export', 'application/json')).toBe('application/json');
    expect(bidDocumentFormatFromFile('bid-export', 'text/csv; charset=utf-8')).toBe('text/csv');
  });

  // Never guess: the caller must ask instead. A CSV read as JSON does not
  // fail loudly, it imports an option with nothing read at all.
  it('returns null rather than guessing when neither the name nor the MIME type says', () => {
    expect(bidDocumentFormatFromFile('bid-notes.txt', 'text/plain')).toBeNull();
    expect(bidDocumentFormatFromFile('bid', undefined)).toBeNull();
  });
});

describe('classifyChosenBidDocumentFile', () => {
  it('classifies the two readable formats exactly as bidDocumentFormatFromFile does', () => {
    expect(classifyChosenBidDocumentFile('bid-northgate.json', '')).toEqual({
      format: 'application/json',
    });
    expect(classifyChosenBidDocumentFile('line-items.csv', '')).toEqual({ format: 'text/csv' });
  });

  // A PDF is model-readable, not unreadable -- see `ChosenBidDocumentFile`'s
  // own comment for why it gets a outcome of its own rather than sharing
  // `UnreadableBidDocumentKind` with Word/Excel/plain text.
  it('names a PDF by extension, as its own outcome, not "unreadable"', () => {
    expect(classifyChosenBidDocumentFile('bid.pdf', '')).toEqual({ pdf: true });
  });

  it('names a PDF by MIME type when the name carries no usable extension', () => {
    expect(classifyChosenBidDocumentFile('bid-export', 'application/pdf')).toEqual({
      pdf: true,
    });
  });

  it('names a Word document by extension', () => {
    expect(classifyChosenBidDocumentFile('bid.docx', '')).toEqual({ unreadable: 'word' });
    expect(classifyChosenBidDocumentFile('bid.doc', '')).toEqual({ unreadable: 'word' });
  });

  it('names a spreadsheet by extension', () => {
    expect(classifyChosenBidDocumentFile('bid.xlsx', '')).toEqual({ unreadable: 'excel' });
    expect(classifyChosenBidDocumentFile('bid.xls', '')).toEqual({ unreadable: 'excel' });
  });

  // The real-world collision this guards against: a machine with Excel
  // installed reports a genuine .xls file as `application/vnd.ms-excel`,
  // which is the very MIME type `bidDocumentFormatFromFile` trusts as a
  // CSV alias for an actual .csv export. The extension must win, or a real
  // spreadsheet gets read as text and sent as "CSV".
  it('trusts the .xls extension over a MIME type that would otherwise read as CSV', () => {
    expect(classifyChosenBidDocumentFile('bid.xls', 'application/vnd.ms-excel')).toEqual({
      unreadable: 'excel',
    });
  });

  it('names a plain text file by extension or by MIME type', () => {
    expect(classifyChosenBidDocumentFile('bid-notes.txt', 'text/plain')).toEqual({
      unreadable: 'text',
    });
    expect(classifyChosenBidDocumentFile('bid-notes', 'text/plain')).toEqual({
      unreadable: 'text',
    });
  });

  it('is case-insensitive on the extension', () => {
    expect(classifyChosenBidDocumentFile('BID.PDF', '')).toEqual({ pdf: true });
  });

  it('calls a file with no usable extension and no recognised MIME type unknown, not unreadable', () => {
    expect(classifyChosenBidDocumentFile('bid-export', '')).toEqual({ unknown: true });
    expect(classifyChosenBidDocumentFile('bid', undefined)).toEqual({ unknown: true });
  });

  it('calls an empty filename with no MIME type unknown', () => {
    expect(classifyChosenBidDocumentFile('', undefined)).toEqual({ unknown: true });
  });
});

describe('unreadableBidDocumentMessage', () => {
  it('names the file and gives a real next step, for every unreadable kind', () => {
    for (const kind of ['word', 'excel', 'text'] as const) {
      const message = unreadableBidDocumentMessage('bid.docx', kind);
      expect(message).toContain('"bid.docx"');
      expect(message).toContain('JSON or CSV');
      expect(message).toContain('form above');
    }
  });

  // The one promise this message must never make: that unreadable today
  // means readable tomorrow.
  it('never says the format is unsupported only "yet"', () => {
    for (const kind of ['word', 'excel', 'text'] as const) {
      expect(unreadableBidDocumentMessage('bid.docx', kind).toLowerCase()).not.toContain('yet');
    }
  });
});

describe('utf8ByteLength / bidDocumentSizeRefusal', () => {
  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect('é'.length).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
  });

  it('accepts a document at the cap', () => {
    expect(bidDocumentSizeRefusal('a'.repeat(MAX_BID_DOCUMENT_BYTES))).toBeNull();
  });

  it('refuses a document over the cap with both real numbers in the message', () => {
    const refusal = bidDocumentSizeRefusal('a'.repeat(MAX_BID_DOCUMENT_BYTES + 1));
    expect(refusal).toContain('256 KB');
    expect(refusal).toContain('Nothing was sent.');
  });

  // The regression the byte check exists for: a string SHORTER than the cap
  // in characters can still be over it in bytes, which is what the server
  // measures.
  it('refuses a multi-byte document whose character count is under the cap', () => {
    const text = 'é'.repeat(MAX_BID_DOCUMENT_BYTES - 10);
    expect(text.length).toBeLessThan(MAX_BID_DOCUMENT_BYTES);
    expect(bidDocumentSizeRefusal(text)).not.toBeNull();
  });
});

describe('summarizeBidDocumentImport', () => {
  const definitions = [
    definition('bid.quoted_total', 'Quoted total', true),
    definition('bid.deposit_percent', 'Deposit requested', true),
    definition('bid.warranty_months', 'Warranty term', false),
  ];

  function summarize(entities: EntityRecord[], knownOptionIds: string[] = []) {
    return summarizeBidDocumentImport({
      snapshot: buildFixtureCaseState({ entities }),
      knownOptionIds,
      filename: 'bid-northgate.json',
      attributeDefinitions: definitions,
    });
  }

  it('splits what the document stated from what it did not, marking the required gaps', () => {
    const summary = summarize([
      bidEntity('option-new', [
        readRecord('bid.quoted_total', 'Quoted total', 0.9),
        unreadRecord('bid.deposit_percent', 'Deposit requested'),
        unreadRecord('bid.warranty_months', 'Warranty term'),
      ]),
    ]);

    expect(summary?.read.map((entry) => entry.definitionId)).toEqual(['bid.quoted_total']);
    expect(summary?.read[0]?.record.confidence).toBe(0.9);
    expect(summary?.unreadRequired.map((entry) => entry.definitionId)).toEqual([
      'bid.deposit_percent',
    ]);
    expect(summary?.unreadOptional.map((entry) => entry.definitionId)).toEqual([
      'bid.warranty_months',
    ]);
  });

  it("orders the read fields by the pack's own attribute order, not object key order", () => {
    const summary = summarize([
      bidEntity('option-new', [
        readRecord('bid.warranty_months', 'Warranty term', 0.6),
        readRecord('bid.quoted_total', 'Quoted total', 0.9),
        readRecord('bid.deposit_percent', 'Deposit requested', 0.9),
      ]),
    ]);

    expect(summary?.read.map((entry) => entry.definitionId)).toEqual([
      'bid.quoted_total',
      'bid.deposit_percent',
      'bid.warranty_months',
    ]);
  });

  it('describes only what the extraction proposed, never a record some other origin wrote', () => {
    const packRecord: AttributeRecord = {
      ...readRecord('bid.deposit_percent', 'Deposit requested', 0.9),
      origin: 'user',
      status: 'asserted',
    };
    const summary = summarize([
      bidEntity('option-new', [readRecord('bid.quoted_total', 'Quoted total', 0.9), packRecord]),
    ]);

    expect(summary?.read.map((entry) => entry.definitionId)).toEqual(['bid.quoted_total']);
  });

  it('finds the option this import created, ignoring the ones already on the case', () => {
    const summary = summarize(
      [
        bidEntity('option-existing', [readRecord('bid.quoted_total', 'Quoted total', 0.9)]),
        bidEntity('option-new', [readRecord('bid.quoted_total', 'Quoted total', 0.9)]),
      ],
      ['option-existing'],
    );

    expect(summary?.option.id).toBe('option-new');
  });

  it("describes the newest unknown option when the pane's own list is behind", () => {
    const summary = summarize([
      bidEntity('option-first-import', [readRecord('bid.quoted_total', 'Quoted total', 0.9)]),
      bidEntity('option-second-import', [readRecord('bid.quoted_total', 'Quoted total', 0.9)]),
    ]);

    expect(summary?.option.id).toBe('option-second-import');
  });

  // No snapshot, or nothing new in it, means there is no honest summary to
  // show -- rebuilding one from the request we sent would describe a reading
  // nobody performed.
  it('returns null rather than inventing a summary when the receipt carried no snapshot', () => {
    expect(
      summarizeBidDocumentImport({
        snapshot: undefined,
        knownOptionIds: [],
        filename: 'bid-northgate.json',
        attributeDefinitions: definitions,
      }),
    ).toBeNull();
  });

  it('returns null when the snapshot holds no option this import could have created', () => {
    expect(summarize([bidEntity('option-existing', [])], ['option-existing'])).toBeNull();
  });
});

describe('formatConfidence', () => {
  it('matches the phrasing already used for a record confidence elsewhere in the app', () => {
    expect(formatConfidence(0.9)).toBe('Confidence 90%');
    expect(formatConfidence(0.615)).toBe('Confidence 62%');
  });
});
