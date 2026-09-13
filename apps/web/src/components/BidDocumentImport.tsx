/**
 * Brings a person's OWN bid document into the case, from the page, through
 * whichever of the two commands actually matches how it was read
 * (docs/engineering-principles.md "Visible UI controls and WebMCP callbacks
 * use the same command implementation" -- both commands this component can
 * call are the same ones a WebMCP caller would reach).
 *
 * The server side of this -- the command schemas, the deterministic
 * extractor, the model reading, the handlers that record what each one read
 * -- already existed and is tested; before this component a person at the
 * keyboard still had only two ways to get a bid into a case: retype it one
 * scalar at a time, or be given a fixture checked into the repository. A
 * real file had no way in.
 *
 * ## The one rule this component exists to hold
 *
 * **A read value is a proposal, and must never be shown as settled.**
 * Everything either command writes lands as `origin: 'agent_proposed'` with
 * a real confidence, and never `status: 'verified'` -- so every value this
 * component shows is labelled as read from the document, carries its
 * confidence, and says it has not been verified. The fields the document
 * did NOT state are given the same prominence as the ones it did, because
 * that half is what a person skimming a filled-in form would otherwise
 * never notice.
 *
 * Concretely, the chrome here deliberately avoids the `satisfied` status
 * tone and its checkmark (`activity-labels.ts`): a document was read, which
 * is not the same as a fact being established, and borrowing the tone the
 * rest of the app uses for "this passed" would quietly assert exactly what
 * either command refuses to.
 *
 * ## No multipart upload -- for either command
 *
 * JSON and CSV are text, and `submitBidDocument` takes `document.text`, so
 * a chosen file is read in the browser with `FileReader` and travels as an
 * ordinary JSON command. A PDF is not text, but the ROUTE it travels to
 * still takes text, never a file: its text LAYER is extracted in the
 * browser too (`pdf-bid-document.ts`, `pdfjs-dist`), and only that extracted
 * text -- never the PDF's own bytes -- ever leaves this page. Neither
 * command has an upload endpoint to build, and nothing about a chosen file
 * reaches the server except its name and, depending on which command
 * applies, its declared format or nothing but text.
 *
 * ## Two ways in, two possible commands
 *
 * A real file picker and a paste area produce the same fields. For JSON/CSV
 * the format is derived from the file when a file is chosen
 * (`classifyChosenBidDocumentFile`) and asked for when it cannot be
 * (`bid-document-import.ts` explains why a guess is worse than a question);
 * a paste has no file to derive from at all, so it is always chosen
 * explicitly. The size cap is checked here in UTF-8 bytes before anything is
 * sent, so an over-size document gets a sentence naming both numbers rather
 * than a 400 from a schema the person cannot see -- and that same check
 * applies to a PDF's extracted text too (`extractPdfDocumentText` already
 * enforces it once, at extraction time; this is the second, defensive check
 * every submission gets, in case the text was hand-edited afterward).
 *
 * ## A third outcome: recognised, and refused
 *
 * A chosen file is not only "a format we read" or "a format we cannot
 * place" -- it can be a format Sift names outright and still will not read
 * (a Word document, a spreadsheet, plain text; see
 * `UnreadableBidDocumentKind`). Telling a person their Word document just
 * has the wrong format selected would be false: no format selection fixes
 * it, since nothing here parses one. So that file is never handed to
 * `FileReader` at all -- its bytes would only become mojibake in the paste
 * box -- and no format is preselected, because there is no reading to
 * propose a format for. The person is told plainly and pointed at their
 * real options: export the bid as JSON or CSV, or use the form above.
 *
 * ## A fourth outcome: a PDF, read by a model through a different command
 *
 * A PDF used to sit in that same "recognised, and refused" bucket, and no
 * longer does (`ChosenBidDocumentFile`'s own comment). Choosing one instead
 * extracts its text layer client-side and, on submit, calls
 * `commands.readBidDocument` -- `POST /api/cases/:caseId/bid-documents/read`
 * -- never `commands.submitBidDocument`. That split is not a UI
 * convenience; it follows the server directly. `submitBidDocument`'s
 * extractor is deterministic and reads only labelled JSON/CSV fields, and
 * `CommandService` is synchronous by design (its own doc comment), so it
 * cannot call a model. A PDF has no labelled fields at all -- only prose --
 * so reading one honestly requires a model, and that model call has to
 * happen BEFORE a command, in the one route built for it
 * (`ReadBidDocumentInputSchema`; a successful reading still ends up going
 * through the identical, synchronous `submitBidDocument` server-side, just
 * with the model's reading in place of a person's own file). This
 * component surfaces that split honestly rather than papering over it:
 * `pdfSource` (below) tracks which path is live, the format field
 * disappears entirely for a PDF (there is no format to confirm), and the
 * resulting summary says a MODEL read the document, not Sift's own
 * extractor -- see `renderSummary`.
 */
import { useId, useState, type ChangeEvent } from 'react';
import {
  MAX_BID_DOCUMENT_BYTES,
  type AttributeDefinition,
  type BidDocumentFormat,
  type CommandReceipt,
} from '@sift/contracts';
import { useSiftCommands } from '../app/AppProviders.js';
import { SiftClientError } from '../api/sift-client.js';
import { formatAttributeValue } from './attribute-value-format.js';
import { STATUS_TONE_META } from './activity-labels.js';
import {
  BID_DOCUMENT_ACCEPT,
  bidDocumentSizeRefusal,
  classifyChosenBidDocumentFile,
  formatConfidence,
  summarizeBidDocumentImport,
  unreadableBidDocumentMessage,
  utf8ByteLength,
  type BidDocumentImportSummary,
  type ImportedBidAttribute,
  type UnreadableBidDocumentKind,
} from './bid-document-import.js';
import { extractPdfDocumentText } from './pdf-bid-document.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface BidDocumentImportProps {
  caseId: string;
  /** Resolved at SUBMIT time, never at render time -- see `OptionEditor`'s own prop for the race this closes. */
  resolveExpectedSequence: () => Promise<number>;
  /** Singular pack presentation label, e.g. `"bid"`. */
  optionLabel: string;
  /** The case's attribute definitions, read only for each attribute's `required` flag when saying which unread fields matter. */
  attributeDefinitions: AttributeDefinition[];
  /** Option ids already on the case, so the option this import creates can be told apart in the returned snapshot. */
  knownOptionIds: readonly string[];
  /** True when the case already holds its maximum options -- an import creates one, so it cannot proceed. */
  caseIsFull: boolean;
  maxOptions: number;
  /** Called once the server has written the option, with what it actually wrote. The editor uses this to put the person into correcting it. */
  onImported: (summary: BidDocumentImportSummary) => void;
}

// Native <select>, not the Radix `Select` primitive, for the same reason
// `DynamicAttributeField.tsx` states: Radix renders no underlying <select>
// for `user-event`'s `selectOptions()` to drive, and this control has to be
// keyboard- and test-operable. Styled to `ui/input.tsx`'s own flat recipe so
// it reads as the same family of control.
const selectClassName =
  'min-h-[var(--size-touch-target-min)] h-9 w-full min-w-0 rounded-[var(--radius-sm)] border-0 bg-muted px-3 py-1 text-[length:var(--font-size-base)] outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60';

const hintClassName = 'text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]';

const FORMAT_LABELS: Record<BidDocumentFormat, string> = {
  'application/json': 'JSON (.json)',
  'text/csv': 'CSV (.csv)',
};

/** The `open` tone -- an unanswered question, which is exactly what an unread field is. Deliberately not `blocked` (nothing failed) and never `satisfied`. */
const unreadTone = STATUS_TONE_META.open;

/**
 * Pulls the human-readable reasons off a failed command.
 *
 * `submitBidDocument` reports a document it could not read as a bid with the
 * extractor's own reason in `details` (`command-service.ts`'s
 * `validationFailure(..., [extraction.message])`). Dropping that would leave
 * the person with "could not be read" and no way to tell a malformed file
 * from a CSV with no header row.
 */
function errorDetailLines(caught: unknown): string[] {
  if (!(caught instanceof SiftClientError)) return [];
  const details: unknown = caught.details;
  if (!Array.isArray(details)) return [];
  // Re-typed as `unknown[]` rather than filtered directly: `Array.isArray`
  // narrows an `unknown` to `any[]`, and every element read off it would then
  // be an implicit `any` this repo's type-checked lint rules reject.
  const lines: string[] = [];
  for (const detail of details as unknown[]) {
    if (typeof detail === 'string') lines.push(detail);
  }
  return lines;
}

export function BidDocumentImport({
  caseId,
  resolveExpectedSequence,
  optionLabel,
  attributeDefinitions,
  knownOptionIds,
  caseIsFull,
  maxOptions,
  onImported,
}: BidDocumentImportProps) {
  const commands = useSiftCommands();
  const fieldPrefix = useId();
  const [filename, setFilename] = useState('');
  // `''` is "not chosen yet", which is a real state and not a default: a
  // format nobody has stated must block the submit rather than resolve to
  // whichever member happens to be first.
  const [format, setFormat] = useState<BidDocumentFormat | ''>('');
  const [formatDerivedFrom, setFormatDerivedFrom] = useState<string | null>(null);
  const [formatUnknownFor, setFormatUnknownFor] = useState<string | null>(null);
  // A file Sift can NAME but will not read -- a PDF, a Word document, a
  // spreadsheet, plain text. Kept apart from `formatUnknownFor`: that one
  // is answered by picking a format, this one is not answered by picking
  // anything, so the two get different messages (`unreadableBidDocumentMessage`).
  const [unreadableFile, setUnreadableFile] = useState<{
    fileName: string;
    kind: UnreadableBidDocumentKind;
  } | null>(null);
  // The filename of a PDF whose browser-extracted text currently fills
  // `text` below. Non-null means: `handleSubmit` calls `commands.
  // readBidDocument`, not `commands.submitBidDocument` (this file's header,
  // "A fourth outcome"); there is no format for the person to confirm (a
  // PDF's text layer is neither of `BID_DOCUMENT_FORMATS`), so the format
  // field is not shown at all while this is set; and the eventual summary
  // says a MODEL read the document, not Sift's own extractor
  // (`summaryReadByModel` below, `renderSummary`).
  const [pdfSource, setPdfSource] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [summary, setSummary] = useState<BidDocumentImportSummary | null>(null);
  // Whether the option `summary` describes came from a model's reading of a
  // PDF rather than Sift's own deterministic extractor. Captured at the
  // moment `handleSubmit` sends the command (`runImport`'s `readByModel`
  // parameter), not read off `pdfSource` when the summary renders -- by
  // then a person could already have started a second, different import.
  const [summaryReadByModel, setSummaryReadByModel] = useState(false);
  const [importedWithoutDetail, setImportedWithoutDetail] = useState<string | null>(null);

  const bytes = utf8ByteLength(text);
  const canSubmit =
    !caseIsFull &&
    !submitting &&
    !reading &&
    text.trim().length > 0 &&
    filename.trim().length > 0 &&
    (pdfSource !== null || format !== '');

  function clearOutcome() {
    setError(null);
    setErrorDetails([]);
    setImportedWithoutDetail(null);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    clearOutcome();
    setSummary(null);
    setFilename(file.name);
    // Reset here, unconditionally -- every branch below either leaves this
    // cleared or (the `pdf` branch alone) sets it again once it has
    // something real to name. Without this reset, choosing a JSON file
    // right after a PDF would leave `handleSubmit` still routed to
    // `readBidDocument`.
    setPdfSource(null);

    const classified = classifyChosenBidDocumentFile(file.name, file.type);

    if ('pdf' in classified) {
      // A PDF is Sift's one MODEL-readable format -- see this file's
      // header, "A fourth outcome". There is no format to preselect or ask
      // for (a PDF is neither of `BID_DOCUMENT_FORMATS`), and the file is
      // never handed to `FileReader`: its text layer comes from
      // `pdfjs-dist` (`extractPdfDocumentText`), not from reading its raw
      // bytes as a string.
      setFormat('');
      setFormatDerivedFrom(null);
      setFormatUnknownFor(null);
      setUnreadableFile(null);
      setPdfSource(file.name);
      setText('');
      setReading(true);
      extractPdfDocumentText(file)
        .then((result) => {
          setReading(false);
          if (!result.ok) {
            // A scan, an over-size reading, or a file `pdfjs-dist` could not
            // parse at all -- `extractPdfDocumentText`'s own `message` is
            // already the real sentence for whichever one this was; nothing
            // here rewrites or generalizes it (this file's own
            // `errorDetailLines` follows the identical rule for a server
            // rejection).
            setPdfSource(null);
            setError(result.message);
            setErrorDetails([]);
            return;
          }
          setText(result.text);
        })
        .catch((caught: unknown) => {
          // Defense in depth: `extractPdfDocumentText` is documented never
          // to reject (its own header). This exists so a bug that defied
          // that contract still lands on a real sentence rather than an
          // unhandled rejection.
          setReading(false);
          setPdfSource(null);
          setError(
            caught instanceof Error ? caught.message : `"${file.name}" could not be read as a PDF.`,
          );
        });
      return;
    }

    if ('unreadable' in classified) {
      // A format Sift recognises but deliberately does not read -- see
      // `unreadableBidDocumentMessage`. No format is preselected (there is
      // no reading here to propose one from) and the file is never handed
      // to `FileReader`: reading a spreadsheet's binary bytes as text would
      // only put mojibake where a real paste belongs.
      setFormat('');
      setFormatDerivedFrom(null);
      setFormatUnknownFor(null);
      setUnreadableFile({ fileName: file.name, kind: classified.unreadable });
      setText('');
      return;
    }

    setUnreadableFile(null);
    const derived = 'format' in classified ? classified.format : null;
    setFormat(derived ?? '');
    setFormatDerivedFrom(derived === null ? null : file.name);
    setFormatUnknownFor(derived === null ? file.name : null);

    // Read as text, not as an upload: see this file's header. The result is
    // held in state exactly as read -- never trimmed, re-encoded, or
    // "cleaned up" -- so what the extractor reads is the file's own bytes.
    setReading(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setReading(false);
      setText('');
      setError(`"${file.name}" could not be read from disk. Nothing was sent.`);
    };
    reader.onload = () => {
      setReading(false);
      setText(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(file);
  }

  /**
   * The tail shared by both submit paths: the defensive over-size recheck
   * (this file's header, "Two ways in, two possible commands"), the
   * `submitting` pending state the button's own label already covers
   * ("Reading document…" -- accurate whether that means an instant local
   * parse or a model call that takes real seconds), and the identical
   * receipt handling either command's `CommandReceipt` gets. `sendCommand`
   * is a thunk, not an already-started `Promise`, so a document over the
   * cap is caught before either command is even called.
   */
  function runImport(
    trimmedFilename: string,
    readByModel: boolean,
    sendCommand: () => Promise<CommandReceipt>,
  ) {
    const oversize = bidDocumentSizeRefusal(text);
    if (oversize !== null) {
      setError(oversize);
      setErrorDetails([]);
      return;
    }

    setSubmitting(true);
    clearOutcome();

    sendCommand()
      .then((receipt) => {
        setSubmitting(false);
        const next = summarizeBidDocumentImport({
          snapshot: receipt.snapshot,
          knownOptionIds,
          filename: trimmedFilename,
          attributeDefinitions,
        });
        if (next === null) {
          // The write succeeded but the receipt carried no snapshot we could
          // read the new option out of. Say that, rather than describing an
          // extraction from the request we sent -- which would be this
          // component reporting on a reading it never saw.
          setImportedWithoutDetail(
            `"${trimmedFilename}" was imported. This pane could not read back what was recorded from it -- open the ${optionLabel} to check each value.`,
          );
          return;
        }
        setSummaryReadByModel(readByModel);
        setSummary(next);
        onImported(next);
      })
      .catch((caught: unknown) => {
        setSubmitting(false);
        setErrorDetails(errorDetailLines(caught));
        setError(caught instanceof Error ? caught.message : 'That document could not be imported.');
      });
  }

  function handleSubmit() {
    if (!canSubmit) return;
    const trimmedFilename = filename.trim();

    if (pdfSource !== null) {
      // The PDF path: no format to narrow against, and a different command
      // entirely -- see this file's header, "A fourth outcome".
      runImport(trimmedFilename, true, () =>
        resolveExpectedSequence().then((expectedSequence) =>
          commands.readBidDocument({
            caseId,
            expectedSequence,
            // No `optionId`, for the identical reason `submitBidDocument`
            // below sends none: this affordance always ADDS an option.
            filename: trimmedFilename,
            text,
          }),
        ),
      );
      return;
    }

    // `format === ''` checked here, not merely folded into `canSubmit`: it
    // is the one check that also NARROWS the union for `submitBidDocument`'s
    // payload below.
    if (format === '') return;
    runImport(trimmedFilename, false, () =>
      resolveExpectedSequence().then((expectedSequence) =>
        commands.submitBidDocument({
          caseId,
          expectedSequence,
          // No `optionId`: this affordance always ADDS an option. Re-reading a
          // corrected document onto an existing one is a real capability of
          // the command, but it is a different question ("which option is
          // this the same bid as?") and giving it no answer here keeps the
          // summary below exactly describable -- everything on the created
          // option came from this document.
          document: { filename: trimmedFilename, format, text },
        }),
      ),
    );
  }

  function startAnother() {
    setSummary(null);
    setSummaryReadByModel(false);
    setFilename('');
    setFormat('');
    setFormatDerivedFrom(null);
    setFormatUnknownFor(null);
    setUnreadableFile(null);
    setPdfSource(null);
    setText('');
    clearOutcome();
  }

  function renderReadAttribute(entry: ImportedBidAttribute, readByModel: boolean) {
    const { record } = entry;
    return (
      <li
        key={entry.definitionId}
        data-testid={`bid-document-import-read-${entry.definitionId}`}
        className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-muted px-[var(--space-2)] py-[var(--space-1)]"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-1)]">
          <span className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]">
            {entry.label}
          </span>
          <span className="text-[length:var(--font-size-base)] text-[var(--color-ink)]">
            {record.value === undefined ? 'No value recorded' : formatAttributeValue(record.value)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          {/* "Read from the document" or "Read by a model", never a
              checkmark or a satisfied tone -- see this file's header.
              `outline` is the badge variant with no status colour of its
              own. Which text applies is the one place, at field
              granularity, that a model reading is told apart from Sift's
              own extractor; `renderSummary`'s own paragraph says it again
              at the top of the whole list. */}
          <Badge variant="outline">
            {readByModel ? 'Read by a model' : 'Read from the document'}
          </Badge>
          <span className={hintClassName}>
            {record.confidence === undefined
              ? 'No confidence recorded. Not verified.'
              : `${formatConfidence(record.confidence)}. Not verified.`}
          </span>
        </div>
      </li>
    );
  }

  function renderUnreadAttribute(entry: ImportedBidAttribute) {
    return (
      <li
        key={entry.definitionId}
        data-testid={`bid-document-import-unread-${entry.definitionId}`}
        className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)]"
        style={{ backgroundColor: unreadTone.bg, color: unreadTone.ink }}
      >
        <div className="flex flex-wrap items-center gap-[var(--space-1)]">
          <span className="text-[length:var(--font-size-base)]">{entry.label}</span>
          {entry.required ? <Badge variant="outline">Required</Badge> : null}
        </div>
        {/* No value, no placeholder, no dash that could be mistaken for one
            -- the document did not state this, so the case holds nothing for
            it and the sentence says so outright. */}
        <span className="text-[length:var(--font-size-sm)]">
          Not stated in this document. Nothing was recorded for it.
        </span>
      </li>
    );
  }

  function renderSummary(current: BidDocumentImportSummary) {
    const unreadCount = current.unreadRequired.length + current.unreadOptional.length;
    const readByModel = summaryReadByModel;
    const readCountLabel = `${current.read.length} value${current.read.length === 1 ? '' : 's'}`;
    return (
      <div
        data-testid="bid-document-import-summary"
        role="status"
        className="flex flex-col gap-[var(--space-3)]"
      >
        <div className="flex flex-col gap-[var(--space-1)]">
          <h4 data-testid="bid-document-import-summary-heading">
            {`Imported "${current.filename}" as "${current.option.label}"`}
          </h4>
          {/* Names the actual reader -- "A model read" or "Sift read" --
              rather than one word for both: this is the one sentence a
              person reads before anything else in this pane, and a PDF's
              reading deserves to be told apart from Sift's own
              deterministic extractor right here, not only per field below
              (`renderReadAttribute`). */}
          <p className={hintClassName} data-testid="bid-document-import-summary-reader">
            {readByModel
              ? `A model read ${readCountLabel} off this document and could not read ${unreadCount}. Nothing below is verified -- check each value against the document before you rely on it.`
              : `Sift read ${readCountLabel} off this document and could not read ${unreadCount}. Nothing below is verified -- check each value against the document before you rely on it.`}
          </p>
        </div>

        <div className="flex flex-col gap-[var(--space-1)]">
          <h5>{`Read from the document (${current.read.length})`}</h5>
          {current.read.length === 0 ? (
            <p data-testid="bid-document-import-read-none" className={hintClassName}>
              Nothing was read from this document.
            </p>
          ) : (
            <ul
              data-testid="bid-document-import-read"
              className="flex flex-col gap-[var(--space-1)]"
            >
              {current.read.map((entry) => renderReadAttribute(entry, readByModel))}
            </ul>
          )}
        </div>

        {/* Given exactly the same heading level, order, and weight as the
            read half. A person skimming a filled-in form will not notice
            what is missing unless it is stated as plainly as what is
            present. */}
        <div className="flex flex-col gap-[var(--space-1)]">
          <h5>
            {current.unreadRequired.length > 0
              ? `Not read -- ${current.unreadRequired.length} required (${unreadCount} in total)`
              : `Not read (${unreadCount})`}
          </h5>
          {unreadCount === 0 ? (
            <p data-testid="bid-document-import-unread-none" className={hintClassName}>
              This document stated every field Sift looks for.
            </p>
          ) : (
            <ul
              data-testid="bid-document-import-unread"
              className="flex flex-col gap-[var(--space-1)]"
            >
              {current.unreadRequired.map(renderUnreadAttribute)}
              {current.unreadOptional.map(renderUnreadAttribute)}
            </ul>
          )}
        </div>

        <Button
          type="button"
          data-testid="bid-document-import-another"
          variant="secondary"
          className="min-h-[var(--size-touch-target-min)]"
          onClick={startAnother}
        >
          Import another document
        </Button>
      </div>
    );
  }

  return (
    <section
      data-testid="bid-document-import"
      aria-labelledby={`${fieldPrefix}-heading`}
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-card p-[var(--space-3)]"
    >
      <div className="flex flex-col gap-[var(--space-1)]">
        <h3 id={`${fieldPrefix}-heading`}>Import a bid document</h3>
        <p className={hintClassName}>
          Choose a JSON, CSV, or PDF bid, or paste one. A JSON or CSV file is read by Sift's own
          extractor; a PDF has no labelled fields, so it is read by a model instead. Either way,
          every value comes back as a proposal with its own confidence -- never as your own entry,
          and never as verified. Anything the document does not state is left empty, not filled in
          with a guess.
        </p>
      </div>

      {summary !== null ? (
        renderSummary(summary)
      ) : (
        <form
          data-testid="bid-document-import-form"
          className="flex flex-col gap-[var(--space-2)]"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div className="flex flex-col gap-[var(--space-1)]">
            <Label htmlFor={`${fieldPrefix}-file`} className={hintClassName}>
              Bid document file
            </Label>
            {/* A real <input type="file">, not a styled <div> with a click
                handler: only the native control is reachable by keyboard and
                announced as a file input by a screen reader. */}
            <Input
              id={`${fieldPrefix}-file`}
              data-testid="bid-document-import-file"
              type="file"
              accept={BID_DOCUMENT_ACCEPT}
              disabled={submitting || caseIsFull}
              aria-describedby={`${fieldPrefix}-file-hint`}
              className="min-h-[var(--size-touch-target-min)] border-0"
              onChange={handleFileChange}
            />
            <p id={`${fieldPrefix}-file-hint`} className={hintClassName}>
              JSON, CSV, or PDF. Every one of them is read in your browser -- JSON/CSV are sent as
              plain text; a PDF's text is extracted here first, then sent to a model to read.
            </p>
            {unreadableFile !== null ? (
              <p
                data-testid="bid-document-import-file-unreadable"
                role="status"
                className={hintClassName}
              >
                {unreadableBidDocumentMessage(unreadableFile.fileName, unreadableFile.kind)}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-[var(--space-1)]">
            <Label htmlFor={`${fieldPrefix}-text`} className={hintClassName}>
              Or paste the document
            </Label>
            <Textarea
              id={`${fieldPrefix}-text`}
              data-testid="bid-document-import-text"
              value={text}
              rows={4}
              disabled={submitting}
              className="min-h-[var(--size-touch-target-min)] border-0"
              onChange={(event) => {
                clearOutcome();
                setText(event.target.value);
              }}
            />
            <p data-testid="bid-document-import-size" className={hintClassName}>
              {`${bytes} of ${MAX_BID_DOCUMENT_BYTES} bytes`}
            </p>
          </div>

          <div className="flex flex-col gap-[var(--space-1)]">
            <Label htmlFor={`${fieldPrefix}-filename`} className={hintClassName}>
              Document name
            </Label>
            <Input
              id={`${fieldPrefix}-filename`}
              data-testid="bid-document-import-filename"
              type="text"
              value={filename}
              disabled={submitting}
              className="min-h-[var(--size-touch-target-min)] border-0"
              onChange={(event) => {
                clearOutcome();
                setFilename(event.target.value);
              }}
            />
            <p className={hintClassName}>
              Kept as the document&apos;s name on this case, and used as the {optionLabel}&apos;s
              name when the document does not state who wrote it.
            </p>
          </div>

          {pdfSource !== null ? (
            // A PDF has no format to confirm -- see this file's header, "A
            // fourth outcome" -- so this whole field is replaced by a plain
            // status sentence rather than a `<select>` with nothing correct
            // to offer. Two sentences, not one, because "extracting" and
            // "ready to send to a model" are different moments a person
            // might submit into: the button stays disabled through the
            // first (`canSubmit`'s own `!reading`) and becomes available at
            // the second.
            <p
              data-testid={
                reading ? 'bid-document-import-pdf-extracting' : 'bid-document-import-pdf-ready'
              }
              role="status"
              className={hintClassName}
            >
              {reading
                ? `Extracting text from "${pdfSource}"…`
                : `"${pdfSource}" will be read by a model when you import it, not by Sift's own extractor -- see the text above. Nothing is verified until you check it.`}
            </p>
          ) : (
            <div className="flex flex-col gap-[var(--space-1)]">
              <Label htmlFor={`${fieldPrefix}-format`} className={hintClassName}>
                Document format
              </Label>
              <select
                id={`${fieldPrefix}-format`}
                data-testid="bid-document-import-format"
                className={selectClassName}
                value={format}
                disabled={submitting}
                onChange={(event) => {
                  clearOutcome();
                  // A correction is the person's own statement about the
                  // document, so the "derived from the file" note stops
                  // applying the moment they change it.
                  setFormatDerivedFrom(null);
                  setFormatUnknownFor(null);
                  setUnreadableFile(null);
                  setFormat(event.target.value as BidDocumentFormat | '');
                }}
              >
                <option value="">Choose a format</option>
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {formatDerivedFrom !== null ? (
                <p data-testid="bid-document-import-format-derived" className={hintClassName}>
                  {`Taken from "${formatDerivedFrom}". Change it if that is wrong.`}
                </p>
              ) : null}
              {formatUnknownFor !== null ? (
                <p
                  data-testid="bid-document-import-format-unknown"
                  role="status"
                  className={hintClassName}
                >
                  {`Sift cannot tell what format "${formatUnknownFor}" is. Choose it above -- reading a CSV as JSON would import nothing at all, quietly.`}
                </p>
              ) : null}
            </div>
          )}

          {caseIsFull ? (
            <p data-testid="bid-document-import-full" role="status" className={hintClassName}>
              {`This case already holds its maximum of ${maxOptions} options, and importing a document adds one. Remove an option to make room.`}
            </p>
          ) : null}

          {error !== null ? (
            <Alert data-testid="bid-document-import-error" variant="destructive">
              <AlertDescription>
                <span>{error}</span>
                {errorDetails.length > 0 ? (
                  <ul data-testid="bid-document-import-error-details">
                    {errorDetails.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {importedWithoutDetail !== null ? (
            <p data-testid="bid-document-import-no-detail" role="status" className={hintClassName}>
              {importedWithoutDetail}
            </p>
          ) : null}

          <Button
            type="submit"
            data-testid="bid-document-import-submit"
            aria-busy={submitting}
            disabled={!canSubmit}
            className="min-h-[var(--size-touch-target-min)]"
          >
            {submitting ? 'Reading document…' : 'Import document'}
          </Button>
        </form>
      )}
    </section>
  );
}
