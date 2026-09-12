/**
 * Brings a person's OWN bid document into the case, from the page, through
 * the same `submitBidDocument` command a WebMCP caller would reach
 * (docs/engineering-principles.md "Visible UI controls and WebMCP callbacks
 * use the same command implementation").
 *
 * The server side of this -- the command schema, the deterministic
 * extractor, the handler that records what it read -- already existed and is
 * tested; before this component a person at the keyboard still had only two
 * ways to get a bid into a case: retype it one scalar at a time, or be given
 * a fixture checked into the repository. A real file had no way in.
 *
 * ## The one rule this component exists to hold
 *
 * **An extracted value is a proposal, and must never be shown as settled.**
 * Everything this command writes lands as `origin: 'agent_proposed'` with
 * the extractor's own confidence, and never `status: 'verified'` -- so every
 * value this component shows is labelled as read from the document, carries
 * its confidence, and says it has not been verified. The fields the document
 * did NOT state are given the same prominence as the ones it did, because
 * that half is what a person skimming a filled-in form would otherwise
 * never notice.
 *
 * Concretely, the chrome here deliberately avoids the `satisfied` status
 * tone and its checkmark (`activity-labels.ts`): a document was read, which
 * is not the same as a fact being established, and borrowing the tone the
 * rest of the app uses for "this passed" would quietly assert exactly what
 * the command refuses to.
 *
 * ## No multipart upload
 *
 * Both accepted formats are text, and the command takes `document.text`, so
 * the file is read in the browser with `FileReader` and travels as an
 * ordinary JSON command. There is no upload endpoint to build, and nothing
 * about a chosen file reaches the server except its name, its declared
 * format, and its text.
 *
 * ## Two ways in, one payload
 *
 * A real file picker and a paste area produce the same three fields. The
 * format is derived from the file when a file is chosen
 * (`bidDocumentFormatFromFile`) and asked for when it cannot be
 * (`bid-document-import.ts` explains why a guess is worse than a question);
 * a paste has no file to derive from at all, so it is always chosen
 * explicitly. The size cap is checked here in UTF-8 bytes before anything is
 * sent, so an over-size document gets a sentence naming both numbers rather
 * than a 400 from a schema the person cannot see.
 */
import { useId, useState, type ChangeEvent } from 'react';
import {
  MAX_BID_DOCUMENT_BYTES,
  type AttributeDefinition,
  type BidDocumentFormat,
} from '@sift/contracts';
import { useSiftCommands } from '../app/AppProviders.js';
import { SiftClientError } from '../api/sift-client.js';
import { formatAttributeValue } from './attribute-value-format.js';
import { STATUS_TONE_META } from './activity-labels.js';
import {
  BID_DOCUMENT_ACCEPT,
  bidDocumentFormatFromFile,
  bidDocumentSizeRefusal,
  formatConfidence,
  summarizeBidDocumentImport,
  utf8ByteLength,
  type BidDocumentImportSummary,
  type ImportedBidAttribute,
} from './bid-document-import.js';
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
  const [text, setText] = useState('');
  const [reading, setReading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [summary, setSummary] = useState<BidDocumentImportSummary | null>(null);
  const [importedWithoutDetail, setImportedWithoutDetail] = useState<string | null>(null);

  const bytes = utf8ByteLength(text);
  const canSubmit =
    !caseIsFull &&
    !submitting &&
    !reading &&
    text.trim().length > 0 &&
    filename.trim().length > 0 &&
    format !== '';

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

    const derived = bidDocumentFormatFromFile(file.name, file.type);
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

  function handleSubmit() {
    // `format === ''` first, not merely as part of `canSubmit`: it is the one
    // check that also NARROWS the union for the command payload below.
    if (format === '' || !canSubmit) return;

    // Checked here, in UTF-8 bytes, against the contract's own cap -- the
    // person gets a sentence instead of a 400, and no oversized body is put
    // on the wire at all.
    const oversize = bidDocumentSizeRefusal(text);
    if (oversize !== null) {
      setError(oversize);
      setErrorDetails([]);
      return;
    }

    setSubmitting(true);
    clearOutcome();

    resolveExpectedSequence()
      .then((expectedSequence) =>
        commands.submitBidDocument({
          caseId,
          expectedSequence,
          // No `optionId`: this affordance always ADDS an option. Re-reading a
          // corrected document onto an existing one is a real capability of
          // the command, but it is a different question ("which option is
          // this the same bid as?") and giving it no answer here keeps the
          // summary below exactly describable -- everything on the created
          // option came from this document.
          document: { filename: filename.trim(), format, text },
        }),
      )
      .then((receipt) => {
        setSubmitting(false);
        const next = summarizeBidDocumentImport({
          snapshot: receipt.snapshot,
          knownOptionIds,
          filename: filename.trim(),
          attributeDefinitions,
        });
        if (next === null) {
          // The write succeeded but the receipt carried no snapshot we could
          // read the new option out of. Say that, rather than describing an
          // extraction from the request we sent -- which would be this
          // component reporting on a reading it never saw.
          setImportedWithoutDetail(
            `"${filename.trim()}" was imported. This pane could not read back what was recorded from it -- open the ${optionLabel} to check each value.`,
          );
          return;
        }
        setSummary(next);
        onImported(next);
      })
      .catch((caught: unknown) => {
        setSubmitting(false);
        setErrorDetails(errorDetailLines(caught));
        setError(caught instanceof Error ? caught.message : 'That document could not be imported.');
      });
  }

  function startAnother() {
    setSummary(null);
    setFilename('');
    setFormat('');
    setFormatDerivedFrom(null);
    setFormatUnknownFor(null);
    setText('');
    clearOutcome();
  }

  function renderReadAttribute(entry: ImportedBidAttribute) {
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
          {/* "Read from the document", never a checkmark or a satisfied tone
              -- see this file's header. `outline` is the badge variant with
              no status colour of its own. */}
          <Badge variant="outline">Read from the document</Badge>
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
          <p className={hintClassName}>
            {`Sift read ${current.read.length} value${current.read.length === 1 ? '' : 's'} off this document and could not read ${unreadCount}. Nothing below is verified -- check each value against the document before you rely on it.`}
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
              {current.read.map(renderReadAttribute)}
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
          Choose a JSON or CSV bid, or paste one. Sift reads what the document states and records
          each value as a proposal with its own confidence -- never as your own entry, and never as
          verified. Anything the document does not state is left empty, not filled in with a guess.
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
              JSON or CSV. The file is read in your browser and sent as text.
            </p>
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
