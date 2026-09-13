/**
 * The pure half of `BidDocumentImport.tsx` -- format derivation, the
 * client-side size check, and the reading of what the server actually wrote
 * back -- kept out of the component for the same reason
 * `attribute-value-format.ts` and `option-profile.ts` are: these are
 * decisions with edge cases worth testing directly rather than through a
 * rendered form.
 *
 * ## Where the summary comes from, and why not from the extractor
 *
 * `packages/scenarios/src/tools/bid-document-extractor.ts` returns a rich
 * per-field envelope (`{ value, confidence, basis }`), and this module
 * deliberately does NOT re-run it. Two reasons, in order of weight:
 *
 *  1. The browser is not where that reading happened. `submitBidDocument`
 *     runs the extractor server-side and persists the result; re-running it
 *     here would be a second implementation of the same reading, free to
 *     drift from the one the case actually holds, and a summary that
 *     disagreed with the stored record would be worse than no summary.
 *  2. `apps/web` has no dependency on `@sift/scenarios` and should not grow
 *     one for a display concern -- that package is Node-side tooling.
 *
 * So the summary is read back off `CommandReceipt.snapshot`, which is the
 * case as the server left it. That carries `value`, `confidence`, `status`,
 * `origin` and `sourceIds` per attribute record -- everything the UI needs
 * to say what was read and how strongly.
 *
 * The one thing it does NOT carry is the extractor's own `basis` sentence:
 * `AttributeRecordSchema` (`packages/contracts/src/attributes.ts`) has no
 * field for it, so it is not persisted anywhere the client can reach. This
 * module therefore states the basis the record itself can support -- read
 * from this document, at this confidence, recorded as a proposal and not
 * verified -- and never invents prose attributed to a reader that did not
 * write it. Restoring the real sentence is a contracts + handler change
 * (carry `basis` onto the record, or return the extraction on the receipt),
 * not something to paper over here.
 */
import {
  BID_DOCUMENT_FORMATS,
  MAX_BID_DOCUMENT_BYTES,
  type AttributeDefinition,
  type AttributeRecord,
  type BidDocumentFormat,
  type CaseState,
  type EntityRecord,
} from '@sift/contracts';

/**
 * The `EntityRecord.kind` this import applies to.
 *
 * Hardcoded, with the reason stated rather than hidden: `submitBidDocument`
 * is a bid-specific command -- its handler writes `kind: 'bid'` outright
 * (`BID_ENTITY_KIND`, `apps/agent/src/services/command-service.ts`) and maps
 * the extraction onto five `bid.*` attribute ids -- but no package this app
 * depends on exports that constant. `@sift/contracts` deliberately declares
 * no bid entity kind (its own comment: inventing a name no spec backs is
 * worse than none), and `apps/web` cannot import from `apps/agent`.
 *
 * What keeps this honest is WHERE it is compared: against the active pack's
 * own first declared entity id, which `App.tsx` resolves from the installed
 * `CompiledDecisionPack` and passes down as `optionKind`. So the gate is
 * still "does this case's pack model bids", read from the pack -- the
 * literal below is only the name that pack and this command already agree
 * on. A second bid pack declaring the same entity kind gets the affordance
 * for free; a pack that does not, never sees it.
 */
export const BID_OPTION_KIND = 'bid';

/** Whether the case's own pack-declared option kind is one `submitBidDocument` can actually write. See `BID_OPTION_KIND`. */
export function supportsBidDocumentImport(optionKind: string): boolean {
  return optionKind === BID_OPTION_KIND;
}

const EXTENSION_FORMATS: readonly (readonly [string, BidDocumentFormat])[] = [
  ['.json', 'application/json'],
  ['.csv', 'text/csv'],
];

/**
 * MIME types a browser/OS may report for the two accepted formats. Several
 * per format on purpose: `file.type` is whatever the operating system's own
 * registry says, and for CSV in particular that is commonly
 * `application/vnd.ms-excel` on a machine with Excel installed.
 */
const MIME_FORMATS: readonly (readonly [string, BidDocumentFormat])[] = [
  ['application/json', 'application/json'],
  ['text/json', 'application/json'],
  ['text/csv', 'text/csv'],
  ['application/csv', 'text/csv'],
  ['text/comma-separated-values', 'text/csv'],
];

/**
 * The format a chosen file declares, or `null` when it declares none this
 * command accepts.
 *
 * Extension first, MIME second: the extension is what the person typed when
 * they saved the file, while `File.type` is the OS's guess about it and is
 * routinely empty (a file dragged from an archive) or wrong (see
 * `MIME_FORMATS`). Returning `null` rather than defaulting to JSON is the
 * whole point -- the caller must then ASK, because silently guessing the
 * format of a document is exactly the kind of invented fact this product
 * refuses: a CSV read as JSON does not fail loudly, it produces an option
 * with nothing read at all.
 */
export function bidDocumentFormatFromFile(
  fileName: string,
  mimeType: string | undefined,
): BidDocumentFormat | null {
  const lowerName = fileName.toLowerCase();
  for (const [extension, format] of EXTENSION_FORMATS) {
    if (lowerName.endsWith(extension)) return format;
  }
  const lowerMime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  for (const [mime, format] of MIME_FORMATS) {
    if (lowerMime === mime) return format;
  }
  return null;
}

/**
 * A file format Sift can *recognise* but deliberately does not read.
 *
 * `word` (`.doc`/`.docx`) and `text` (`.txt`/`text/plain`) share one reason:
 * the document in front of the extractor would be prose, and a
 * deterministic extractor cannot honestly read prose -- see
 * `BID_DOCUMENT_FORMATS` in `packages/contracts/src/commands.ts`, which
 * makes exactly this argument for `text/plain` already. `excel`
 * (`.xls`/`.xlsx`) shares the practical half of the same reason: a
 * worksheet is not the CSV format Sift reads until it has been exported as
 * one.
 *
 * `pdf` used to belong to this list too, and no longer does: a PDF's text
 * layer is also prose, but Sift now has a way to read prose honestly -- a
 * model, reached through `POST /api/cases/:caseId/bid-documents/read`
 * (`pdf-bid-document.ts`, `ReadBidDocumentInputSchema`) -- rather than
 * pretending a deterministic extractor could. That is a genuinely different
 * situation from a Word document or plain text, which get no such reading,
 * so a PDF gets its own `ChosenBidDocumentFile` outcome (`{ pdf: true }`)
 * instead of sharing this one.
 */
export type UnreadableBidDocumentKind = 'word' | 'excel' | 'text';

/**
 * What `classifyChosenBidDocumentFile` found. Four outcomes, not three:
 * "Sift cannot tell what this is" (`unknown`), "Sift can tell exactly what
 * this is, and refuses to read it" (`unreadable`), "Sift can tell exactly
 * what this is, and a model can read it" (`pdf`), and an ordinary readable
 * format. `unknown` is answered by picking a format; `unreadable` is not
 * answered by picking anything; `pdf` is answered by importing it, which
 * routes through a different command entirely (`BidDocumentImport.tsx`'s
 * own header explains why).
 */
export type ChosenBidDocumentFile =
  | { format: BidDocumentFormat }
  | { pdf: true }
  | { unreadable: UnreadableBidDocumentKind }
  | { unknown: true };

/**
 * The one extension Sift reads only through a model, never through
 * `bidDocumentFormatFromFile`'s deterministic table above: a PDF's text
 * layer is neither `application/json` nor `text/csv`, so it was never a
 * candidate for that table, and checking it here -- ahead of
 * `UNREADABLE_EXTENSIONS` -- keeps the same "every kind this module knows
 * about is checked by extension before anything falls back to MIME"
 * precedence that table's own comment already establishes.
 */
const PDF_EXTENSIONS: readonly string[] = ['.pdf'];

/** MIME type for a PDF, checked only when the name carries no usable extension -- same "extension first, MIME second" precedence as everywhere else in this module. */
const PDF_MIME_TYPES: readonly string[] = ['application/pdf'];

/**
 * Extensions of formats Sift recognises but does not read. Extension only,
 * deliberately: unlike `MIME_FORMATS` above, this table has no MIME entry
 * for `word` or `excel`, because their common MIME types collide with the
 * one `MIME_FORMATS` already claims for CSV (`application/vnd.ms-excel` is
 * what a machine with Excel installed reports for an actual `.csv` export,
 * not only for a real `.xls` file -- see that table's own comment). The
 * extension tells the two apart; the MIME type does not, so only the
 * extension is trusted for these two kinds.
 */
const UNREADABLE_EXTENSIONS: readonly (readonly [string, UnreadableBidDocumentKind])[] = [
  ['.doc', 'word'],
  ['.docx', 'word'],
  ['.xls', 'excel'],
  ['.xlsx', 'excel'],
  ['.txt', 'text'],
];

/** MIME types checked for the two unreadable kinds whose MIME type is unambiguous. See `UNREADABLE_EXTENSIONS` for why `word` and `excel` have no entry here. */
const UNREADABLE_MIME_TYPES: readonly (readonly [string, UnreadableBidDocumentKind])[] = [
  ['text/plain', 'text'],
];

/**
 * Classifies a chosen file into the four outcomes `handleFileChange` acts
 * on.
 *
 * Checks the PDF and unreadable extensions *before* calling
 * `bidDocumentFormatFromFile`, not after -- a real `.xls` file commonly
 * reports `application/vnd.ms-excel` as its `file.type`, which is the same
 * MIME type `bidDocumentFormatFromFile` trusts as a CSV alias (for a
 * machine that mis-reports an actual `.csv` export the same way). Asking
 * that function first would let a real spreadsheet slip through as
 * "readable CSV" on that MIME collision alone. Checking the extension for
 * every kind this function knows about -- readable, model-readable, or not
 * readable at all -- before either falls back to MIME keeps the same
 * "extension first, MIME second" precedence `bidDocumentFormatFromFile`
 * states for itself.
 */
export function classifyChosenBidDocumentFile(
  fileName: string,
  mimeType: string | undefined,
): ChosenBidDocumentFile {
  const lowerName = fileName.toLowerCase();
  if (PDF_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) return { pdf: true };
  for (const [extension, kind] of UNREADABLE_EXTENSIONS) {
    if (lowerName.endsWith(extension)) return { unreadable: kind };
  }

  const format = bidDocumentFormatFromFile(fileName, mimeType);
  if (format !== null) return { format };

  const lowerMime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (PDF_MIME_TYPES.includes(lowerMime)) return { pdf: true };
  for (const [mime, kind] of UNREADABLE_MIME_TYPES) {
    if (lowerMime === mime) return { unreadable: kind };
  }
  return { unknown: true };
}

const UNREADABLE_KIND_LABELS: Record<UnreadableBidDocumentKind, string> = {
  word: 'a Word document',
  excel: 'a spreadsheet',
  text: 'a plain text document',
};

/**
 * The message shown for a recognised-but-unreadable file: named and
 * reasoned rather than a bare refusal, because a person choosing a Word
 * document has done nothing wrong and deserves the real reason and the real
 * next step, not a "choose a format" prompt that has nothing correct to
 * offer them.
 *
 * Deliberately does not say "not yet" or anything else that promises this
 * will change: reading a bid out of a Word document or a plain text file
 * means inventing a reading nobody checked, which is not a gap this
 * extractor is working towards closing (see `UnreadableBidDocumentKind`).
 * A PDF once got the same sentence and no longer does -- see that type's
 * own comment for why it earned a real reading instead.
 */
export function unreadableBidDocumentMessage(
  fileName: string,
  kind: UnreadableBidDocumentKind,
): string {
  const reason =
    kind === 'excel'
      ? 'a worksheet is not the CSV format Sift reads until it has been exported as one'
      : 'reading a bid out of it means interpreting prose, and Sift only ever states what a document says -- never a guess at it';
  return `"${fileName}" is ${UNREADABLE_KIND_LABELS[kind]}, and Sift cannot read it -- ${reason}. Export or save the bid as JSON or CSV, or type its values into the form above.`;
}

/**
 * The `accept` attribute for the file input. Lists the two readable formats
 * by extension and canonical MIME type (so a picker filters correctly
 * whichever it keys on), the PDF extension and MIME type (a model reads
 * that one -- `pdf-bid-document.ts`), and the recognised-but-unreadable
 * extensions and MIME types -- those stay *choosable* in the OS file
 * dialog, so a person picking a Word document reaches
 * `unreadableBidDocumentMessage` instead of finding the file simply missing
 * from the list.
 */
export const BID_DOCUMENT_ACCEPT = [
  '.json',
  '.csv',
  ...BID_DOCUMENT_FORMATS,
  ...PDF_EXTENSIONS,
  ...PDF_MIME_TYPES,
  ...UNREADABLE_EXTENSIONS.map(([extension]) => extension),
  ...UNREADABLE_MIME_TYPES.map(([mime]) => mime),
].join(',');

/**
 * UTF-8 byte length, matching `SubmittedBidDocumentSchema`'s own cap check
 * byte for byte. `String.prototype.length` counts UTF-16 code units and
 * would under-count every non-ASCII character, so a document this client
 * called "just under the cap" could still be refused by the server -- the
 * exact 400 this check exists to replace with a sentence.
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Human-readable KiB, for a cap expressed in bytes. Deterministic and locale-independent, matching `attribute-value-format.ts`'s reasoning for avoiding `Intl`. */
function kibibytes(bytes: number): string {
  return `${Math.round((bytes / 1024) * 10) / 10} KB`;
}

/**
 * The refusal sentence for a document over `MAX_BID_DOCUMENT_BYTES`, or
 * `null` when it fits. Names both real numbers: a message that says only
 * "too large" leaves the person with nothing to act on.
 */
export function bidDocumentSizeRefusal(text: string): string | null {
  const bytes = utf8ByteLength(text);
  if (bytes <= MAX_BID_DOCUMENT_BYTES) return null;
  return `This document is ${kibibytes(bytes)}, over the ${kibibytes(MAX_BID_DOCUMENT_BYTES)} limit for one document. Nothing was sent. Split it, or trim it to the bid itself.`;
}

/** One attribute the import wrote, as the case now holds it. `value === undefined` means the document did not state it -- never a zero, never a placeholder. */
export interface ImportedBidAttribute {
  definitionId: string;
  label: string;
  record: AttributeRecord;
  /** Whether the pack marks this attribute required (`AttributeDefinition.required`), which is what makes an unread one worth flagging. */
  required: boolean;
}

export interface BidDocumentImportSummary {
  /** The option the import created, exactly as the server wrote it -- what the editor then prefills from. */
  option: EntityRecord;
  /** The submitted document's own name. Echoed, never re-derived. */
  filename: string;
  /** Fields the document stated, each carrying the confidence the extractor assigned. */
  read: ImportedBidAttribute[];
  /** Required fields the document did not state. Listed first and separately: this is the half a person is most likely to miss. */
  unreadRequired: ImportedBidAttribute[];
  /** Optional fields the document did not state. */
  unreadOptional: ImportedBidAttribute[];
}

/**
 * Reads back what `submitBidDocument` wrote, from the snapshot its receipt
 * carries.
 *
 * Filters to `origin: 'agent_proposed'` records because those are precisely
 * the ones this command writes -- a value read off a document is a proposal,
 * never the person's own assertion. That filter is exact here rather than
 * approximate: this import only ever CREATES an option (the UI never sends
 * `optionId`), so the new entity's attribute map holds nothing but what the
 * extraction just produced. If a later increment adds re-reading onto an
 * existing option, the handler MERGES, and this would need to narrow further
 * -- by the document's own `Source.id` in `sourceIds`, which every record it
 * writes already carries.
 *
 * Returns `null` when the receipt carried no snapshot, or when no new option
 * appears in it: there is no honest summary to show in that case, and
 * inventing one from the request we sent would describe a reading nobody
 * performed.
 */
export function summarizeBidDocumentImport(args: {
  snapshot: CaseState | undefined;
  /** Option ids already on the case before this import, so the one it created can be told apart. */
  knownOptionIds: readonly string[];
  filename: string;
  attributeDefinitions: readonly AttributeDefinition[];
}): BidDocumentImportSummary | null {
  const { snapshot, knownOptionIds, filename, attributeDefinitions } = args;
  if (snapshot === undefined) return null;

  const known = new Set(knownOptionIds);
  // Scanned newest-first (the store appends), so importing a second document
  // before the pane's snapshot prop has caught up still describes the second
  // one. A manual reverse loop rather than `findLast`: this package's
  // `lib` is ES2022 (`apps/web/tsconfig.json`), where that method does not
  // exist.
  let option: EntityRecord | undefined;
  for (let index = snapshot.entities.length - 1; index >= 0; index -= 1) {
    const candidate = snapshot.entities[index];
    if (candidate !== undefined && !known.has(candidate.id)) {
      option = candidate;
      break;
    }
  }
  if (option === undefined) return null;

  const requiredById = new Map(
    attributeDefinitions.map((definition) => [definition.id, definition.required]),
  );
  // Ordered by the pack's own attribute order, so the summary reads in the
  // same sequence as the form underneath it rather than in whatever order
  // `Object.entries` happens to yield.
  const order = new Map(attributeDefinitions.map((definition, index) => [definition.id, index]));

  const proposed: ImportedBidAttribute[] = Object.values(option.attributes)
    .filter((record) => record.origin === 'agent_proposed')
    .map((record) => ({
      definitionId: record.definitionId,
      label: record.label,
      record,
      required: requiredById.get(record.definitionId) ?? false,
    }))
    .sort(
      (left, right) =>
        (order.get(left.definitionId) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.definitionId) ?? Number.MAX_SAFE_INTEGER),
    );

  return {
    option,
    filename,
    read: proposed.filter((entry) => entry.record.status !== 'unknown'),
    unreadRequired: proposed.filter((entry) => entry.record.status === 'unknown' && entry.required),
    unreadOptional: proposed.filter(
      (entry) => entry.record.status === 'unknown' && !entry.required,
    ),
  };
}

/** `Confidence 90%` -- the same phrasing and rounding `OptionProfileSheet.tsx` already uses for a record's confidence, so one number is never described two ways. */
export function formatConfidence(confidence: number): string {
  return `Confidence ${Math.round(confidence * 100)}%`;
}
