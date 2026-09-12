/**
 * Fixture tool: "bid document extractor".
 *
 * Reads a bid document a PERSON brought into a case -- their own file, not
 * one of the twelve checked-in fixtures `bid-reader.ts` loads -- and returns
 * the fields it could actually read, each with a confidence, plus an
 * explicit list of the fields it could NOT read. It is the server-side half
 * of the gap documented on `SubmitBidDocumentInputSchema`
 * (`@sift/contracts`): before it, the only way a bid reached a case was a
 * form of scalar fields or a fixture file checked into this repository.
 *
 * **Deterministic. No model, no network, no clock, no filesystem.** The
 * same bytes always produce the same result, which is what makes this
 * feature testable at all and what makes the demo path honest -- nothing
 * here "understands" a document; it reads named fields out of a declared
 * format and says plainly which ones were not there.
 *
 * --- What it may and may not do ---
 *
 * A field the document does not state is reported as MISSING. It is never
 * defaulted, never zeroed, and never inferred from a neighbouring field:
 * `depositPercent` absent means "this document does not say", not "no
 * deposit", exactly as `packages/packs/src/bid-comparison.ts` argues at
 * length for `bid.warranty_months` ("silently defaulting a missing term to
 * zero would assert a fact the bid document never actually states"). The
 * one derivation it performs -- a `total` summed from the document's own
 * line items when the document states line items but no total -- is
 * arithmetic over stated numbers, is marked with a lower confidence
 * (`DERIVED_FIELD_CONFIDENCE`), and says so in its own `basis` string. No
 * confidence is ever 1.0: a value read off an unverified document is a
 * proposal about a fact, never a settled one.
 *
 * --- Result envelope ---
 *
 * Follows this directory's `ToolResult`/`okResult`/`notFoundResult`
 * conventions unchanged. `ok` means the tool read the document and the
 * result says what it found and what it did not. `not_found` means the
 * document did not resolve into a bid AT ALL -- it is not valid JSON, it is
 * a CSV with no usable header, it is over a cap -- and carries the
 * filename as its `query`, the same way `bid-reader.ts` returns `not_found`
 * with the `bidId` that resolved to no fixture. A partially readable
 * document is never `not_found`: that is precisely the `ok` result with a
 * non-empty `missingRequiredFields`.
 *
 * --- Caps (architecture.md: "Tool inputs ... are size-bounded") ---
 *
 *  - `MAX_BID_DOCUMENT_BYTES` (256 KiB, imported from `@sift/contracts` so
 *    the command schema and this tool can never disagree about the number)
 *    bounds the document itself, re-checked here so calling the tool
 *    directly is as safe as going through the command.
 *  - `MAX_EXTRACTED_LINE_ITEMS` (200) bounds how many line items one
 *    document may contribute. Exceeding it is a REFUSAL, not a truncation:
 *    silently dropping priced scope would both hide work the bid covers and
 *    make any total derived from the remaining rows quietly wrong.
 */
import { MAX_BID_DOCUMENT_BYTES, type BidDocumentFormat } from '@sift/contracts';
import type { MoneyAmount } from './bid-reader.js';
import {
  cancelledResult,
  isAborted,
  notFoundResult,
  okResult,
  type ToolEvidenceItem,
  type ToolResult,
} from './tool-result.js';

export const BID_DOCUMENT_EXTRACTOR_TOOL_ID = 'bid-document-extractor';

/**
 * The most line items one submitted document may contribute. The checked-in
 * fixture schema (`fixture-loader.ts`'s `BidSchema`) caps a curated demo bid
 * at 20; a real trade-package bid tab exported from an estimating system
 * runs longer, so this is deliberately generous while still bounded. See
 * this module's header for why exceeding it refuses rather than truncates.
 */
export const MAX_EXTRACTED_LINE_ITEMS = 200;

/** A value the document states directly, in a field of the expected name and type. Never 1.0 -- see the module header. */
export const STATED_FIELD_CONFIDENCE = 0.9;

/**
 * A value the document states but qualifies -- today, exactly one case: a
 * warranty term present in the document with `statedInWriting: false`. The
 * term was read; whether it is contractually binding was not.
 */
export const QUALIFIED_FIELD_CONFIDENCE = 0.6;

/** A value derived by arithmetic over values the document states (a total summed from its own line items), rather than read from a field of its own. */
export const DERIVED_FIELD_CONFIDENCE = 0.7;

/** Currency assumed for an amount written with a `$` sign and no explicit code. The ONLY symbol this tool maps; any other currency must be stated as an ISO 4217 code. */
const DOLLAR_SIGN_CURRENCY = 'USD';

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

/**
 * Every field this tool knows how to look for. Deliberately the vocabulary
 * of things a bid DOCUMENT states about itself -- not the full
 * `bid-comparison` attribute set. `bid.adjusted_total`,
 * `bid.scope_completeness`, `bid.license_status`,
 * `bid.insurance_named_insured_match` and `bid.credentials_valid` are
 * absent on purpose: none of them is stated by a bid. They are derived by
 * `bid-calculator.ts`/`scope-differ.ts` or looked up in a registry by
 * `license-lookup.ts`, and a reader that claimed to have "not found" them
 * in a document would be reporting on a search it never performed.
 */
export const BID_DOCUMENT_FIELDS = [
  'contractorName',
  'licenseNumber',
  'total',
  'depositPercent',
  'startInWeeks',
  'durationWorkingDays',
  'warrantyMonths',
] as const;
export type BidDocumentField = (typeof BID_DOCUMENT_FIELDS)[number];

/**
 * The fields a bid must state to be comparable at all. Mirrors
 * `packages/packs/src/bid-comparison.ts`'s own `required` flags for the
 * attributes these map onto -- `bid.warranty_months` is `required: false`
 * there for the reason that manifest spells out, so `warrantyMonths` is
 * absent here too and is reported through `missingOptionalFields` instead.
 */
export const REQUIRED_BID_DOCUMENT_FIELDS: readonly BidDocumentField[] = [
  'contractorName',
  'licenseNumber',
  'total',
  'depositPercent',
  'startInWeeks',
  'durationWorkingDays',
];

export interface ExtractedValue<T> {
  readonly value: T;
  /** 0-1, never 1.0. See the confidence constants above for the three values this tool assigns and why. */
  readonly confidence: number;
  /** How the value was obtained, in one short phrase, for the evidence summary and the UI's "where did this come from" affordance. */
  readonly basis: string;
}

export interface ExtractedLineItem {
  /** Absent when the document prices an item without naming a scope id -- a CSV with no `scopeItemId` column, for instance. Never invented. */
  readonly scopeItemId?: string;
  readonly label: string;
  readonly amount: MoneyAmount;
}

/** Every field the tool managed to read. An absent key means the document did not state it; the corresponding name appears in one of the two `missing*` lists. */
export interface ExtractedBidFields {
  readonly contractorName?: ExtractedValue<string>;
  readonly licenseNumber?: ExtractedValue<string>;
  readonly total?: ExtractedValue<MoneyAmount>;
  readonly depositPercent?: ExtractedValue<number>;
  readonly startInWeeks?: ExtractedValue<number>;
  readonly durationWorkingDays?: ExtractedValue<number>;
  readonly warrantyMonths?: ExtractedValue<number>;
}

export interface BidDocumentExtractionResult {
  /** The `Source.id` the document is (or will be) stored under. Every value above is traceable to exactly this id -- see `BidDocumentExtractorInput.sourceId`. */
  readonly sourceId: string;
  readonly filename: string;
  readonly format: BidDocumentFormat;
  readonly documentBytes: number;
  readonly fields: ExtractedBidFields;
  readonly lineItems: readonly ExtractedLineItem[];
  /** Required fields (`REQUIRED_BID_DOCUMENT_FIELDS`) the document did not state, in declaration order. Empty when the document was fully readable. */
  readonly missingRequiredFields: readonly BidDocumentField[];
  /** Optional fields the document did not state, in declaration order. Reported separately so a caller can tell "this bid is not comparable yet" from "this bid simply has no warranty term written down". */
  readonly missingOptionalFields: readonly BidDocumentField[];
  readonly evidence: ToolEvidenceItem[];
}

export interface BidDocumentExtractorInput {
  /**
   * The `Source.id` the submitted document is stored under.
   *
   * REQUIRED, and required for a reason worth stating: the product rule is
   * that nothing extracted may exist without a source id pointing at the
   * document it came from. Taking the id as an input rather than
   * synthesizing one makes that rule structural -- this tool cannot be
   * called at all without naming the source its output will be attributed
   * to, and `command-service.ts` passes the very id it is about to persist
   * the `Source` under, so the evidence item and every attribute record's
   * `sourceIds` point at the same real record.
   */
  readonly sourceId: string;
  readonly filename: string;
  readonly format: BidDocumentFormat;
  readonly text: string;
  readonly signal?: AbortSignal;
}

// --- shared helpers ---

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or `undefined`. Rejects `NaN`/`Infinity` and every non-number, including numeric strings -- a document that writes `"25"` where a number belongs has not stated a number. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A non-empty trimmed string, or `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function stated<T>(value: T, basis: string): ExtractedValue<T> {
  return { value, confidence: STATED_FIELD_CONFIDENCE, basis };
}

/** The currency every line item shares, or `undefined` when they disagree (or there are none) -- a total may not be summed across currencies. */
function commonCurrency(lineItems: readonly ExtractedLineItem[]): string | undefined {
  const first = lineItems[0];
  if (first === undefined) return undefined;
  return lineItems.every((item) => item.amount.currency === first.amount.currency)
    ? first.amount.currency
    : undefined;
}

/** Sums line items to a total. Rounded to cents so a chain of floating-point additions cannot produce `276000.00000000003`. */
function sumLineItems(
  lineItems: readonly ExtractedLineItem[],
): ExtractedValue<MoneyAmount> | undefined {
  const currency = commonCurrency(lineItems);
  if (currency === undefined) return undefined;
  const sum = lineItems.reduce((total, item) => total + item.amount.amount, 0);
  return {
    value: { amount: Math.round(sum * 100) / 100, currency },
    confidence: DERIVED_FIELD_CONFIDENCE,
    basis: `summed from the document's own ${lineItems.length} line item${lineItems.length === 1 ? '' : 's'}; the document states no total of its own`,
  };
}

// --- application/json ---

/**
 * Reads the bid shape the checked-in fixtures use
 * (`packages/scenarios/fixtures/bids/bid-northgate.json`). Deliberately
 * field-by-field and defensive rather than `BidSchema.safeParse`: that
 * schema is all-or-nothing and would reject a real, partially complete
 * document outright, when reporting exactly which required fields are
 * missing is the entire point of this tool.
 */
function extractJsonFields(document: Record<string, unknown>): {
  fields: ExtractedBidFields;
  lineItems: ExtractedLineItem[];
} {
  const lineItems = readJsonLineItems(document['lineItems']);

  const contractorName = nonEmptyString(document['contractorName']);
  const licenseNumber = nonEmptyString(document['licenseNumber']);
  const depositPercent = finiteNumber(document['depositPercent']);
  const startInWeeks = finiteNumber(document['startInWeeks']);
  const durationWorkingDays = finiteNumber(document['durationWorkingDays']);

  const fields: ExtractedBidFields = {
    ...(contractorName !== undefined
      ? { contractorName: stated(contractorName, 'stated in the document field "contractorName"') }
      : {}),
    ...(licenseNumber !== undefined
      ? { licenseNumber: stated(licenseNumber, 'stated in the document field "licenseNumber"') }
      : {}),
    ...readJsonTotal(document['total'], lineItems),
    // A percentage outside 0-100 is not a deposit percentage; treating it as
    // one would import an unreadable number as if it had been read.
    ...(depositPercent !== undefined && depositPercent >= 0 && depositPercent <= 100
      ? { depositPercent: stated(depositPercent, 'stated in the document field "depositPercent"') }
      : {}),
    ...(startInWeeks !== undefined && startInWeeks >= 0
      ? { startInWeeks: stated(startInWeeks, 'stated in the document field "startInWeeks"') }
      : {}),
    ...(durationWorkingDays !== undefined && durationWorkingDays >= 0
      ? {
          durationWorkingDays: stated(
            durationWorkingDays,
            'stated in the document field "durationWorkingDays"',
          ),
        }
      : {}),
    ...readJsonWarrantyMonths(document['warranty']),
  };

  return { fields, lineItems };
}

function readJsonTotal(
  raw: unknown,
  lineItems: readonly ExtractedLineItem[],
): Pick<ExtractedBidFields, 'total'> {
  if (isRecord(raw)) {
    const amount = finiteNumber(raw['amount']);
    const currency = nonEmptyString(raw['currency']);
    if (amount !== undefined && currency !== undefined && ISO_4217_PATTERN.test(currency)) {
      return { total: stated({ amount, currency }, 'stated in the document field "total"') };
    }
  }
  // No stated total: the sum of the document's own line items is arithmetic
  // over stated numbers, not an invention -- but it is a weaker claim than a
  // total the document wrote down, and is marked as such.
  const derived = lineItems.length > 0 ? sumLineItems(lineItems) : undefined;
  return derived !== undefined ? { total: derived } : {};
}

function readJsonWarrantyMonths(raw: unknown): Pick<ExtractedBidFields, 'warrantyMonths'> {
  if (!isRecord(raw)) return {};
  const termMonths = finiteNumber(raw['termMonths']);
  // `termMonths: null` is exactly the `bid-cedar.json` case: a bid that
  // mentions a warranty but states no term. That is an unknown term, never
  // a zero-month warranty.
  if (termMonths === undefined || termMonths < 0) return {};
  const statedInWriting = raw['statedInWriting'] === true;
  return {
    warrantyMonths: {
      value: termMonths,
      confidence: statedInWriting ? STATED_FIELD_CONFIDENCE : QUALIFIED_FIELD_CONFIDENCE,
      basis: statedInWriting
        ? 'stated in writing in the document field "warranty.termMonths"'
        : 'stated in the document field "warranty.termMonths", but not marked as stated in writing',
    },
  };
}

function readJsonLineItems(raw: unknown): ExtractedLineItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ExtractedLineItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const label = nonEmptyString(entry['label']);
    const amountRecord = entry['amount'];
    if (label === undefined || !isRecord(amountRecord)) continue;
    const amount = finiteNumber(amountRecord['amount']);
    const currency = nonEmptyString(amountRecord['currency']);
    if (amount === undefined || currency === undefined || !ISO_4217_PATTERN.test(currency)) {
      continue;
    }
    const scopeItemId = nonEmptyString(entry['scopeItemId']);
    items.push({
      ...(scopeItemId !== undefined ? { scopeItemId } : {}),
      label,
      amount: { amount, currency },
    });
  }
  return items;
}

// --- text/csv ---

/**
 * Splits one CSV line into fields, honouring RFC 4180 double-quoting: a
 * quoted field may contain commas and newlines-free text, and `""` inside a
 * quoted field is a literal quote. Small on purpose -- a bid line-item
 * export is a flat table, and a full CSV dialect engine here would be more
 * behaviour than this tool can honestly claim to support.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** Header aliases, all matched case-insensitively after stripping spaces, underscores and hyphens. */
const CSV_COLUMN_ALIASES = {
  scopeItemId: ['scopeitemid', 'scopeid', 'itemid', 'item'],
  label: ['label', 'description', 'scope', 'scopeitem'],
  amount: ['amount', 'price', 'cost', 'total'],
  currency: ['currency', 'currencycode'],
} as const;
type CsvColumn = keyof typeof CSV_COLUMN_ALIASES;

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_-]/g, '');
}

function findColumn(headers: readonly string[], column: CsvColumn): number {
  const aliases: readonly string[] = CSV_COLUMN_ALIASES[column];
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

/**
 * Parses one CSV amount cell. Accepts an optional leading `$` and thousands
 * separators (`$22,500.00`), and an optional trailing or leading ISO 4217
 * code (`22500 USD`). Returns the number and, when the cell itself named
 * one, the currency.
 */
function parseCsvAmount(cell: string): { amount: number; currency?: string } | undefined {
  const trimmed = cell.trim();
  if (trimmed === '') return undefined;

  let rest = trimmed;
  let currency: string | undefined;

  const codeMatch = /(?:^([A-Z]{3})\s+)|(?:\s+([A-Z]{3})$)/.exec(rest);
  if (codeMatch !== null) {
    currency = codeMatch[1] ?? codeMatch[2];
    rest = rest.replace(codeMatch[0], '').trim();
  }
  if (rest.startsWith('$')) {
    currency = currency ?? DOLLAR_SIGN_CURRENCY;
    rest = rest.slice(1).trim();
  }
  rest = rest.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(rest)) return undefined;
  const amount = Number(rest);
  if (!Number.isFinite(amount)) return undefined;
  return currency !== undefined ? { amount, currency } : { amount };
}

interface CsvFailure {
  readonly message: string;
}

/**
 * Reads a line-item table. A CSV bid export states line items and nothing
 * else -- no contractor name, no licence number, no schedule -- so every
 * other required field comes back missing, which is the honest answer
 * rather than a defect.
 */
function extractCsvLineItems(text: string): ExtractedLineItem[] | CsvFailure {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headerLine = lines[0];
  if (headerLine === undefined) {
    return { message: 'the document is empty' };
  }

  const headers = splitCsvLine(headerLine);
  const labelIndex = findColumn(headers, 'label');
  const amountIndex = findColumn(headers, 'amount');
  if (labelIndex < 0 || amountIndex < 0) {
    return {
      message:
        'the header row names no label column and/or no amount column (expected one of "label"/"description"/"scope" and one of "amount"/"price"/"cost"/"total")',
    };
  }
  const scopeItemIdIndex = findColumn(headers, 'scopeItemId');
  const currencyIndex = findColumn(headers, 'currency');

  const rows = lines.slice(1);
  if (rows.length > MAX_EXTRACTED_LINE_ITEMS) {
    return {
      message: `the document states ${rows.length} line items, above the ${MAX_EXTRACTED_LINE_ITEMS}-item cap; it is refused rather than truncated, because dropping priced scope would hide work the bid covers`,
    };
  }

  const items: ExtractedLineItem[] = [];
  for (const [offset, row] of rows.entries()) {
    const cells = splitCsvLine(row);
    const rowNumber = offset + 2; // 1-based, and row 1 is the header.
    const label = nonEmptyString(cells[labelIndex]);
    if (label === undefined) {
      return { message: `row ${rowNumber} states no label` };
    }
    const parsed = parseCsvAmount(cells[amountIndex] ?? '');
    if (parsed === undefined) {
      // Never skipped: an unreadable money cell silently dropped would make
      // every total derived from the remaining rows quietly wrong.
      return { message: `row ${rowNumber} ("${label}") states no readable amount` };
    }
    const columnCurrency =
      currencyIndex >= 0 ? nonEmptyString(cells[currencyIndex])?.toUpperCase() : undefined;
    const currency = parsed.currency ?? columnCurrency;
    if (currency === undefined || !ISO_4217_PATTERN.test(currency)) {
      return {
        message: `row ${rowNumber} ("${label}") states an amount with no currency; add a currency column with an ISO 4217 code, or write the amount as "$1,234.00" or "1234.00 USD"`,
      };
    }
    const scopeItemId = scopeItemIdIndex >= 0 ? nonEmptyString(cells[scopeItemIdIndex]) : undefined;
    items.push({
      ...(scopeItemId !== undefined ? { scopeItemId } : {}),
      label,
      amount: { amount: parsed.amount, currency },
    });
  }

  if (items.length === 0) {
    return { message: 'the document states a header row but no line items' };
  }
  return items;
}

// --- result assembly ---

function partitionMissing(fields: ExtractedBidFields): {
  missingRequiredFields: BidDocumentField[];
  missingOptionalFields: BidDocumentField[];
} {
  const missingRequiredFields: BidDocumentField[] = [];
  const missingOptionalFields: BidDocumentField[] = [];
  for (const field of BID_DOCUMENT_FIELDS) {
    if (fields[field] !== undefined) continue;
    if (REQUIRED_BID_DOCUMENT_FIELDS.includes(field)) {
      missingRequiredFields.push(field);
    } else {
      missingOptionalFields.push(field);
    }
  }
  return { missingRequiredFields, missingOptionalFields };
}

function buildEvidence(
  sourceId: string,
  filename: string,
  readCount: number,
  missingRequiredFields: readonly BidDocumentField[],
  lineItemCount: number,
): ToolEvidenceItem[] {
  const missingClause =
    missingRequiredFields.length === 0
      ? 'every required field was stated'
      : `${missingRequiredFields.length} required field${missingRequiredFields.length === 1 ? '' : 's'} not stated (${missingRequiredFields.join(', ')})`;
  return [
    {
      sourceId,
      // E1: one document, read directly, corroborated by nothing. A
      // submitted document is unverified by construction
      // (`Source.verification: 'unverified'`), so it can never be more than
      // this on its own.
      level: 'E1',
      verdict: missingRequiredFields.length === 0 ? 'pass' : 'degraded',
      summary: `Read "${filename}": ${readCount} field${readCount === 1 ? '' : 's'} and ${lineItemCount} line item${lineItemCount === 1 ? '' : 's'} extracted; ${missingClause}.`,
    },
  ];
}

/**
 * Reads one submitted bid document. See the module header for the envelope
 * contract, the caps, and why nothing here fabricates a missing field.
 */
export function extractBidDocument(
  input: BidDocumentExtractorInput,
): ToolResult<BidDocumentExtractionResult> {
  if (isAborted(input.signal)) {
    return cancelledResult(BID_DOCUMENT_EXTRACTOR_TOOL_ID);
  }

  const documentBytes = utf8ByteLength(input.text);
  if (documentBytes > MAX_BID_DOCUMENT_BYTES) {
    return notFoundResult(
      BID_DOCUMENT_EXTRACTOR_TOOL_ID,
      input.filename,
      `document is ${documentBytes} bytes, above the ${MAX_BID_DOCUMENT_BYTES}-byte cap`,
    );
  }
  if (input.text.trim() === '') {
    return notFoundResult(BID_DOCUMENT_EXTRACTOR_TOOL_ID, input.filename, 'document is empty');
  }

  let fields: ExtractedBidFields;
  let lineItems: readonly ExtractedLineItem[];

  if (input.format === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      return notFoundResult(
        BID_DOCUMENT_EXTRACTOR_TOOL_ID,
        input.filename,
        'document is not valid JSON',
      );
    }
    if (!isRecord(parsed)) {
      return notFoundResult(
        BID_DOCUMENT_EXTRACTOR_TOOL_ID,
        input.filename,
        'document is valid JSON but is not a bid object',
      );
    }
    const rawLineItems = parsed['lineItems'];
    if (Array.isArray(rawLineItems) && rawLineItems.length > MAX_EXTRACTED_LINE_ITEMS) {
      return notFoundResult(
        BID_DOCUMENT_EXTRACTOR_TOOL_ID,
        input.filename,
        `document states ${rawLineItems.length} line items, above the ${MAX_EXTRACTED_LINE_ITEMS}-item cap; it is refused rather than truncated, because dropping priced scope would hide work the bid covers`,
      );
    }
    const extracted = extractJsonFields(parsed);
    fields = extracted.fields;
    lineItems = extracted.lineItems;
  } else {
    const csv = extractCsvLineItems(input.text);
    if (!Array.isArray(csv)) {
      return notFoundResult(BID_DOCUMENT_EXTRACTOR_TOOL_ID, input.filename, csv.message);
    }
    lineItems = csv;
    // A line-item table states a total only implicitly, as the sum of its
    // own rows. Nothing else about the bid is stated at all, so every other
    // required field is honestly missing.
    const total = sumLineItems(csv);
    fields = total !== undefined ? { total } : {};
  }

  if (isAborted(input.signal)) {
    return cancelledResult(BID_DOCUMENT_EXTRACTOR_TOOL_ID);
  }

  const { missingRequiredFields, missingOptionalFields } = partitionMissing(fields);
  const readCount =
    BID_DOCUMENT_FIELDS.length - missingRequiredFields.length - missingOptionalFields.length;

  return okResult(BID_DOCUMENT_EXTRACTOR_TOOL_ID, {
    sourceId: input.sourceId,
    filename: input.filename,
    format: input.format,
    documentBytes,
    fields,
    lineItems,
    missingRequiredFields,
    missingOptionalFields,
    evidence: buildEvidence(
      input.sourceId,
      input.filename,
      readCount,
      missingRequiredFields,
      lineItems.length,
    ),
  });
}
