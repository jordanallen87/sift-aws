/**
 * Region 4, "Evidence and comparison" (docs/specs/product.md "Workspace
 * layout") -- the option-entry half. Lets the user manually add or edit up
 * to five candidate options (product.md "Explicit scope cuts": "users may
 * manually enter up to five car candidates and paste structured listing or
 * offer details"), one `DynamicAttributeField` per pack-declared or
 * case-defined (`custom.*`) attribute applicable to this option kind.
 *
 * Calls `commands.upsertOption` on the exact same `SiftCommands` instance the
 * `sift_upsert_option` WebMCP tool calls (docs/engineering-principles.md "Visible UI controls and
 * WebMCP callbacks use the same command implementation") -- there is no
 * parallel save path.
 *
 * ## Typed values and read values, kept apart
 *
 * On a pack whose options are bids, this form also hosts
 * `BidDocumentImport` -- a real document, read by the server's deterministic
 * extractor, becomes an option the person then corrects here. That makes
 * this the one place in the app where a value somebody TYPED and a value
 * something READ sit in the same fields, so two rules hold throughout:
 *
 *  1. Every field still carrying an imported value is marked as such, and
 *     the mark disappears the moment the person edits that field -- because
 *     at that point it is their value, not the document's.
 *  2. Saving does not launder a proposal into an assertion. An untouched
 *     imported value is re-sent with the `origin`/`status`/`confidence`/
 *     `sourceIds` the extraction gave it (`OptionAttributeInputSchema`
 *     carries all four), and an attribute the document did not state is
 *     re-sent as an explicit `status: 'unknown'` so the record of "this
 *     document was searched and did not say" survives the save. Only what
 *     the person actually typed goes up as their own `origin: 'user'`
 *     assertion, which is the handler's default for an attribute carrying
 *     no provenance.
 */
import { useMemo, useState } from 'react';
import { MAX_CASE_ENTITIES } from '@sift/contracts';
import type {
  AttributeDefinition,
  AttributeRecord,
  AttributeValue,
  EntityRecord,
  UpsertOptionInput,
} from '@sift/contracts';
import { useSiftCommands } from '../app/AppProviders.js';
import { BidDocumentImport } from './BidDocumentImport.js';
import {
  formatConfidence,
  supportsBidDocumentImport,
  type BidDocumentImportSummary,
} from './bid-document-import.js';
import { DynamicAttributeField } from './DynamicAttributeField.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface OptionEditorProps {
  caseId: string;
  /**
   * Resolves the `expectedSequence` this write must carry, at SUBMIT time.
   *
   * A plain `expectedSequence: number` prop was a render-time value used for
   * a submit-time decision, and the gap between the two is real: the pane's
   * canonical snapshot refreshes on a coalescing throttle, so between the
   * events of a live run it is legitimately behind the server and this form
   * would send a sequence the case had already moved past -- a visible,
   * unexplainable failure for the person, on a write nothing had actually
   * invalidated. `App.tsx`'s `resolveExpectedSequence` answers with the
   * sequence the server confirms, reading it only when the client knows it
   * is behind.
   */
  resolveExpectedSequence: () => Promise<number>;
  /** The `EntityRecord.kind` this editor manages, e.g. `"car"`. */
  optionKind: string;
  /** Singular pack presentation label, e.g. `"car"` (`CompiledDecisionPack.presentation.optionLabel`). */
  optionLabel: string;
  attributeDefinitions: AttributeDefinition[];
  options: EntityRecord[];
  /**
   * How many options this case may hold. Defaults to the contract's own
   * `MAX_CASE_ENTITIES`, never a number invented here: this prop used to
   * default to 5, which nothing else in the system agreed with, so the Bid
   * Comparison pack -- which seeds twelve -- rendered an Add form that
   * refused every entry on a case the engine accepted without complaint.
   */
  maxOptions?: number;
}

interface FormState {
  optionId: string | null;
  label: string;
  values: Record<string, AttributeValue | undefined>;
}

/**
 * What an import left in the form, for exactly as long as the person leaves
 * it untouched.
 *
 * `records` holds every attribute the extraction wrote -- the ones it read
 * AND the ones it explicitly could not -- keyed by `definitionId`. An entry
 * is removed the instant the person edits that field, which is what makes
 * both the on-screen mark and the provenance carried on save truthful
 * rather than sticky.
 */
interface ImportedState {
  optionId: string;
  filename: string;
  records: Record<string, AttributeRecord>;
  /** The option's own label came off the document too (the contractor's name, or the file's name when it states none). */
  labelFromDocument: boolean;
}

type OptionAttributeDraft = UpsertOptionInput['option']['attributes'][number];

function blankForm(): FormState {
  return { optionId: null, label: '', values: {} };
}

/**
 * The mark that keeps a READ value distinguishable from a TYPED one while
 * both sit in the same form.
 *
 * It is attached to the field itself rather than shown once at the top,
 * because "some of these came off a document" is not something a person can
 * act on -- "this number came off the document, at 90% confidence, and
 * nobody has checked it" is. It disappears as soon as the field is edited
 * (`releaseImportedField`), since from that moment the value is the
 * person's own.
 *
 * `record` is `undefined` for the option's label, which comes off the
 * document too but is not an `AttributeRecord` and carries no confidence of
 * its own.
 */
function ImportedValueNote({
  testId,
  filename,
  record,
}: {
  testId: string;
  filename: string;
  record: AttributeRecord | undefined;
}) {
  const unread = record?.status === 'unknown';
  const confidence =
    record?.confidence === undefined ? '' : `, ${formatConfidence(record.confidence)}`;
  return (
    <p
      data-testid={testId}
      className="flex flex-wrap items-center gap-[var(--space-1)] text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
    >
      {/* `outline` carries no status colour: a value read off an unverified
          document must not borrow the tone the rest of the app uses for a
          settled one. */}
      <Badge variant="outline">
        {unread ? 'Not stated in the document' : 'Read from the document'}
      </Badge>
      <span>
        {unread
          ? `"${filename}" did not state this. Nothing is recorded here; type it if you know it.`
          : `Read from "${filename}"${confidence}. Not verified. Edit it to record it as your own.`}
      </span>
    </p>
  );
}

function formFromEntity(entity: EntityRecord): FormState {
  const values: Record<string, AttributeValue | undefined> = {};
  for (const [definitionId, record] of Object.entries(entity.attributes)) {
    values[definitionId] = record.value;
  }
  return { optionId: entity.id, label: entity.label, values };
}

export function OptionEditor({
  caseId,
  resolveExpectedSequence,
  optionKind,
  optionLabel,
  attributeDefinitions,
  options,
  maxOptions = MAX_CASE_ENTITIES,
}: OptionEditorProps) {
  const commands = useSiftCommands();
  const [form, setForm] = useState<FormState>(blankForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedState | null>(null);
  /**
   * Every option this editor has imported in this session, added to the
   * `options` prop when telling the import which ids the case already had.
   * The prop is a throttled snapshot and can legitimately still be missing
   * an option imported moments ago -- without this, importing twice in quick
   * succession would identify the first import's option as the second's.
   */
  const [importedOptionIds, setImportedOptionIds] = useState<string[]>([]);

  const applicableDefinitions = useMemo(
    () => attributeDefinitions.filter((definition) => definition.appliesTo.includes(optionKind)),
    [attributeDefinitions, optionKind],
  );

  const caseIsFull = options.length >= maxOptions;
  const atCapacity = form.optionId === null && caseIsFull;

  /**
   * The import is offered while adding, and stays while the person corrects
   * the option it just created (so its summary of what was and was not read
   * is still on screen beside the fields). Editing some OTHER pre-existing
   * option is a different job, and the affordance is gone there -- an import
   * always creates a new option, so offering it mid-edit would silently
   * abandon the edit in progress.
   */
  const showDocumentImport =
    supportsBidDocumentImport(optionKind) &&
    (form.optionId === null || form.optionId === imported?.optionId);

  function startNew() {
    setForm(blankForm());
    setError(null);
    setImported(null);
  }

  function startEdit(entity: EntityRecord) {
    setForm(formFromEntity(entity));
    setError(null);
    setImported(null);
  }

  /** Forgets the import's claim over one field: the person has now typed there, so the value is theirs. */
  function releaseImportedField(definitionId: string) {
    setImported((prev) => {
      if (prev?.records[definitionId] === undefined) return prev;
      const { [definitionId]: _released, ...rest } = prev.records;
      return { ...prev, records: rest };
    });
  }

  function handleImported(summary: BidDocumentImportSummary) {
    // Straight into editing what the server actually wrote -- never a
    // client-side reconstruction of it -- so the person is correcting the
    // real record.
    setForm(formFromEntity(summary.option));
    setError(null);
    setImportedOptionIds((prev) => [...prev, summary.option.id]);
    setImported({
      optionId: summary.option.id,
      filename: summary.filename,
      records: summary.option.attributes,
      labelFromDocument: true,
    });
  }

  /**
   * One attribute of the option being saved.
   *
   * An untouched imported value keeps the provenance the extraction gave it,
   * and an untouched unread field stays explicitly unknown. Anything else --
   * including an imported value the person has since edited -- carries no
   * provenance at all, which is what makes the handler record it as the
   * person's own `origin: 'user'`/`status: 'asserted'` entry.
   */
  function draftAttribute(
    definitionId: string,
    value: AttributeValue | undefined,
    record: AttributeRecord | undefined,
  ): OptionAttributeDraft | null {
    if (record === undefined) {
      return value === undefined ? null : { definitionId, value };
    }
    if (record.status === 'unknown') {
      // Re-sent, not dropped: `upsertOption` REPLACES the attribute map, so
      // omitting this would erase the case's record that the document was
      // read and did not state this field -- and leave nothing behind
      // pointing at the document that was searched.
      return value === undefined
        ? { definitionId, status: 'unknown', origin: record.origin, sourceIds: record.sourceIds }
        : { definitionId, value };
    }
    if (value === undefined) return null;
    return {
      definitionId,
      value,
      origin: record.origin,
      status: record.status,
      sourceIds: record.sourceIds,
      ...(record.confidence !== undefined ? { confidence: record.confidence } : {}),
    };
  }

  function handleSubmit() {
    if (form.label.trim().length === 0 || saving) return;
    setSaving(true);
    setError(null);
    const records = imported?.records ?? {};
    const definitionIds = new Set([...Object.keys(form.values), ...Object.keys(records)]);
    const attributes: OptionAttributeDraft[] = [];
    for (const definitionId of definitionIds) {
      const draft = draftAttribute(definitionId, form.values[definitionId], records[definitionId]);
      if (draft !== null) attributes.push(draft);
    }

    resolveExpectedSequence()
      .then((expectedSequence) =>
        commands.upsertOption({
          caseId,
          expectedSequence,
          ...(form.optionId !== null ? { optionId: form.optionId } : {}),
          option: { label: form.label.trim(), kind: optionKind, attributes },
        }),
      )
      .then(() => {
        setSaving(false);
        setForm(blankForm());
        setImported(null);
      })
      .catch((caught: unknown) => {
        setSaving(false);
        setError(caught instanceof Error ? caught.message : 'Could not save this option.');
      });
  }

  return (
    <section
      data-testid="option-editor"
      aria-labelledby="option-editor-heading"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-4)]"
    >
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        {/* Naive "+s" pluralization, not a fixed "candidates" suffix: the previous
            `{optionLabel} candidates` composition assumed `optionLabel` was always a bare
            singular noun like "car" -- for the car-purchase pack, whose own `optionLabel` is
            itself "Saved car" (a Decision Pack terminology choice, not a bare noun), that
            produced a literal doubled heading ("Candidate vehicle candidates" before the rename;
            still a mismatched "Saved car candidates" after it). Appending "s" to whatever
            `optionLabel` the active pack declares reads correctly for every pack in this
            repository (car -> cars, Saved car -> Saved cars, Response option -> Response
            options) without needing a second `optionLabelPlural` prop threaded through from
            `App.tsx`. */}
        <h2 id="option-editor-heading" className="capitalize">
          {optionLabel}s
        </h2>
        <Button
          type="button"
          data-testid="option-editor-new"
          variant="secondary"
          size="sm"
          className="min-h-[var(--size-touch-target-min)]"
          disabled={atCapacity}
          onClick={startNew}
        >
          Add {optionLabel}
        </Button>
      </div>

      {options.length === 0 ? (
        <p
          data-testid="option-editor-empty"
          className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          No candidates entered yet. Add up to {maxOptions} manually below.
        </p>
      ) : (
        <ul data-testid="option-editor-list" className="flex flex-col gap-[var(--space-1)]">
          {options.map((entity) => (
            <li
              key={entity.id}
              data-testid={`option-editor-option-${entity.id}`}
              // bg-muted: a recessed row inside this bg-card region (same
              // mechanism as OptionComparison's zebra-striped rows).
              className="list-item-enter flex items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-muted px-[var(--space-2)] py-[var(--space-1)]"
            >
              <span className="text-[length:var(--font-size-sm)] text-[var(--color-ink)]">
                {entity.label}
              </span>
              <Button
                type="button"
                data-testid={`option-editor-edit-${entity.id}`}
                // secondary, overridden to bg-card, not the untouched
                // "secondary" or "ghost" defaults: this row is already
                // bg-muted, and both `secondary`'s flat fill (the same
                // bg-muted value) and `ghost`'s fill-only-on-hover/focus
                // would be invisible against it at rest. A touch device has
                // no hover state, so an at-rest-invisible affordance is a
                // real usability gap here, not just a sizing one. bg-card is
                // the same surface-contrast escape hatch ApprovalCard.tsx's
                // own "secondary" buttons already use to stay visible
                // against a non-default surface.
                variant="secondary"
                size="xs"
                // min-w, not just min-h: this button's short "Edit" label
                // plus `size="xs"`'s own `px-2` padding otherwise resolves to
                // a real content width well under 44px (confirmed directly
                // by Playwright's own `boundingBox()` in the e2e journey
                // specs -- a jsdom class-presence test cannot catch a
                // dimension driven by content width like this one).
                className="min-h-[var(--size-touch-target-min)] min-w-[var(--size-touch-target-min)] bg-card text-card-foreground hover:bg-card/90"
                onClick={() => {
                  startEdit(entity);
                }}
              >
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}

      {atCapacity ? (
        <p
          data-testid="option-editor-max-reached"
          role="status"
          className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          You have reached the {maxOptions}-{optionLabel} demo limit. Edit an existing candidate
          instead, or exclude one to make room.
        </p>
      ) : null}

      {showDocumentImport ? (
        <BidDocumentImport
          caseId={caseId}
          resolveExpectedSequence={resolveExpectedSequence}
          optionLabel={optionLabel}
          attributeDefinitions={attributeDefinitions}
          knownOptionIds={[...options.map((entity) => entity.id), ...importedOptionIds]}
          caseIsFull={caseIsFull}
          maxOptions={maxOptions}
          onImported={handleImported}
        />
      ) : null}

      <form
        data-testid="option-editor-form"
        // `form-measure`: inert at narrow width; at the widened desktop shell
        // it stops every field stretching to 1280px, which made short inputs
        // like "Option label" read as broken rather than roomy.
        className="form-measure flex flex-col gap-[var(--space-2)]"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className="flex flex-col gap-[var(--space-1)]">
          <Label
            htmlFor="option-editor-label"
            className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
          >
            Option label
          </Label>
          <Input
            id="option-editor-label"
            type="text"
            value={form.label}
            disabled={saving}
            onChange={(event) => {
              const raw = event.target.value;
              setForm((prev) => ({ ...prev, label: raw }));
              setImported((prev) => (prev === null ? prev : { ...prev, labelFromDocument: false }));
            }}
            // border-0: see EvidenceCard.tsx's identical comment -- a real
            // native <input> user-agent border otherwise shows through
            // unsuppressed.
            className="border-0"
          />
          {imported?.labelFromDocument === true ? (
            <ImportedValueNote
              testId="option-editor-imported-label"
              filename={imported.filename}
              record={undefined}
            />
          ) : null}
        </div>

        {applicableDefinitions.map((definition) => {
          const record = imported?.records[definition.id];
          return (
            <div key={definition.id} className="flex flex-col gap-[var(--space-1)]">
              <DynamicAttributeField
                definition={definition}
                value={form.values[definition.id]}
                disabled={saving}
                onChange={(value) => {
                  setForm((prev) => ({
                    ...prev,
                    values: { ...prev.values, [definition.id]: value },
                  }));
                  releaseImportedField(definition.id);
                }}
              />
              {record !== undefined && imported !== null ? (
                <ImportedValueNote
                  testId={`option-editor-imported-${definition.id}`}
                  filename={imported.filename}
                  record={record}
                />
              ) : null}
            </div>
          );
        })}

        {imported !== null && Object.keys(imported.records).length > 0 ? (
          <p
            data-testid="option-editor-import-caution"
            role="status"
            className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
          >
            {`Values still marked as read from "${imported.filename}" are saved as that document's proposal, with its confidence, and stay unverified. Anything you type here is saved as your own entry.`}
          </p>
        ) : null}

        {error ? (
          <Alert role="alert" data-testid="option-editor-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-[var(--space-2)]">
          <Button
            type="submit"
            data-testid="option-editor-save"
            aria-busy={saving}
            disabled={saving || form.label.trim().length === 0}
            className="min-h-[var(--size-touch-target-min)] flex-1"
          >
            {saving ? 'Saving…' : form.optionId !== null ? 'Save changes' : `Save ${optionLabel}`}
          </Button>
          {form.optionId !== null ? (
            <Button
              type="button"
              data-testid="option-editor-cancel"
              variant="secondary"
              className="min-h-[var(--size-touch-target-min)]"
              disabled={saving}
              onClick={startNew}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
