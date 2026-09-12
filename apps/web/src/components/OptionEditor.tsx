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
 * ## Typed values and inherited values, kept apart
 *
 * This form is the one place in the app where a value somebody TYPED and a
 * value that arrived some other way sit in the very same fields. Values
 * arrive two ways: off a document (on a pack whose options are bids, this
 * form also hosts `BidDocumentImport`, whose server-side deterministic
 * extractor turns a real file into an option the person then corrects), or
 * off the case itself when an existing option is opened for editing. Both
 * are governed by one rule, in two halves:
 *
 *  1. Every field still carrying a value the person did not type is marked
 *     as such, and the mark disappears the moment they edit that field --
 *     because at that point it is their value, not the document's or the
 *     case's.
 *  2. Saving does not launder someone else's value into the person's own
 *     assertion. An untouched value is re-sent with the
 *     `origin`/`status`/`confidence`/`sourceIds` it already carried
 *     (`OptionAttributeInputSchema` carries all four), and an attribute a
 *     document was searched for and did not state is re-sent as an explicit
 *     `status: 'unknown'` so that record survives the save. Only what the
 *     person actually typed goes up as their own `origin: 'user'`
 *     assertion, which is the handler's default for an attribute carrying
 *     no provenance.
 *
 * Half 2 originally covered the import path alone, and the gap was a live
 * defect -- see `BaselineState` for what pressing Edit and then Save used
 * to do to a seeded case.
 */
import { useMemo, useState } from 'react';
import { ChevronUpIcon } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
 * The records this form started from, for exactly as long as the person
 * leaves each one untouched.
 *
 * `records` holds every attribute the form was populated FROM -- an
 * imported document's extraction (the values it read AND the ones it
 * explicitly could not), or an existing option's already-recorded
 * attributes. An entry is removed the instant the person edits that field,
 * which is what makes both the on-screen mark and the provenance carried on
 * save truthful rather than sticky.
 *
 * ## Why this covers editing, not just importing
 *
 * This started life as `ImportedState`, tracking only the import path, and
 * the omission was a real defect rather than a gap in coverage: pressing
 * "Edit" on an existing option and then "Save" -- typing nothing --
 * re-sent every attribute with no provenance at all, so the handler
 * recorded all of them as the person's own `origin: 'user'` assertions.
 * On a seeded Bid Comparison case that silently rewrote ten `origin:'pack'`
 * records, dropping every `sourceIds` link to the bid document, the licence
 * registry, and the calculator's own working -- and `scoring.ts` weighs an
 * asserted value exactly like a verified one, so the ranking then rested on
 * numbers nobody had typed and nothing backed.
 *
 * The rule is the same in both directions and is now stated once: a value
 * you did not touch keeps the provenance it came with; a value you typed is
 * yours.
 */
interface BaselineState {
  optionId: string | null;
  /**
   * The document these records were read from, when the baseline came from
   * an import. `null` for an existing option being edited, whose records
   * came off the case rather than out of a file the person just chose.
   */
  filename: string | null;
  records: Record<string, AttributeRecord>;
  /** The option's own label came off the document too (the contractor's name, or the file's name when it states none). */
  labelFromDocument: boolean;
}

type OptionAttributeDraft = UpsertOptionInput['option']['attributes'][number];

function blankForm(): FormState {
  return { optionId: null, label: '', values: {} };
}

/**
 * The mark that keeps an INHERITED value distinguishable from a TYPED one
 * while both sit in the same form.
 *
 * It is attached to the field itself rather than shown once at the top,
 * because "some of these came from somewhere else" is not something a
 * person can act on -- "this number came off the document, at 90%
 * confidence, and nobody has checked it" is. It disappears as soon as the
 * field is edited (`releaseField`), since from that moment the value is the
 * person's own.
 *
 * `record` is `undefined` for the option's label, which comes off the
 * document too but is not an `AttributeRecord` and carries no confidence of
 * its own.
 */
function InheritedValueNote({
  testId,
  filename,
  record,
}: {
  testId: string;
  /** The document the value was read from, or `null` when it was already on the case. */
  filename: string | null;
  record: AttributeRecord | undefined;
}) {
  const unread = record?.status === 'unknown';
  const confidence =
    record?.confidence === undefined ? '' : `, ${formatConfidence(record.confidence)}`;
  const sourceCount = record?.sourceIds?.length ?? 0;

  // Three different provenances, three different true sentences. The
  // "already on the case" branch is what an edit shows, and it has to be
  // honest about the one thing the person can change by typing here: the
  // value stops being sourced and becomes theirs.
  let badge: string;
  let sentence: string;
  if (filename !== null) {
    badge = unread ? 'Not stated in the document' : 'Read from the document';
    sentence = unread
      ? `"${filename}" did not state this. Nothing is recorded here; type it if you know it.`
      : `Read from "${filename}"${confidence}. Not verified. Edit it to record it as your own.`;
  } else if (unread) {
    badge = 'Recorded as unknown';
    sentence = 'Nothing is recorded here. Type it if you know it.';
  } else {
    badge = 'Already on this case';
    const backing =
      sourceCount === 0
        ? 'It cites no source'
        : `It cites ${String(sourceCount)} ${sourceCount === 1 ? 'source' : 'sources'}`;
    sentence = `${backing}. Leave it alone to keep that; type here to replace it with your own entry.`;
  }

  return (
    <p
      data-testid={testId}
      className="flex flex-wrap items-center gap-[var(--space-1)] text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
    >
      {/* `outline` carries no status colour: a value read off an unverified
          document must not borrow the tone the rest of the app uses for a
          settled one. */}
      <Badge variant="outline">{badge}</Badge>
      <span>{sentence}</span>
    </p>
  );
}

/**
 * Loads an existing option into the form, keeping its records alongside the
 * bare values.
 *
 * The records half is what stops a save from laundering them: the form
 * shows `record.value`, but an untouched field is written back with the
 * `origin`/`status`/`confidence`/`sourceIds` it already had rather than as
 * a fresh assertion by whoever opened the form.
 */
function formFromEntity(entity: EntityRecord): { form: FormState; baseline: BaselineState } {
  const values: Record<string, AttributeValue | undefined> = {};
  for (const [definitionId, record] of Object.entries(entity.attributes)) {
    values[definitionId] = record.value;
  }
  return {
    form: { optionId: entity.id, label: entity.label, values },
    baseline: {
      optionId: entity.id,
      filename: null,
      records: { ...entity.attributes },
      labelFromDocument: false,
    },
  };
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
  const [baseline, setBaseline] = useState<BaselineState | null>(null);
  /**
   * Controlled rather than Radix-default so it can be forced open after an
   * import: the summary of what was and was not read lives inside this
   * panel, and collapsing it on success would hide the one thing the person
   * most needs to check against the fields it just filled in.
   */
  const [importOpen, setImportOpen] = useState(false);
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

  /**
   * The fields split by where their value is supposed to come from.
   *
   * `evidenceExpectation: 'source'` means a raw fact stated somewhere --
   * the quoted total, the deposit, the warranty term -- which a person
   * reading the document can simply type. `'verification'` means a value
   * something works out and checks: the scope-normalized adjusted total,
   * scope completeness, whether the certificate's named insured matches the
   * licence holder. Rendering all ten as one undifferentiated stack of
   * empty boxes asked whoever opened this form to hand-compute the very
   * numbers the pack exists to derive -- and `scoring.ts` weighs a typed
   * guess exactly as heavily as a checked value, so the invitation was not
   * harmless.
   *
   * They stay editable, because correcting one is legitimate on an option
   * that already has it. They are just no longer presented as the ordinary
   * price of adding a bid.
   */
  const statedDefinitions = useMemo(
    () => applicableDefinitions.filter((d) => d.evidenceExpectation !== 'verification'),
    [applicableDefinitions],
  );
  const derivedDefinitions = useMemo(
    () => applicableDefinitions.filter((d) => d.evidenceExpectation === 'verification'),
    [applicableDefinitions],
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
   *
   * `filename !== null` is what distinguishes those two cases and is load
   * bearing. The condition used to read `form.optionId === imported?.optionId`
   * against a state set ONLY by a completed import. Folding that state into
   * the more general `BaselineState` (which an ordinary edit also populates)
   * silently made the comparison true for EVERY edit, so the affordance
   * stopped being withdrawn at all -- caught by a test written against the
   * behaviour this comment describes, not by the type checker. Only an
   * import-sourced baseline carries a filename.
   */
  const editingAnImportedOption =
    baseline !== null && baseline.filename !== null && form.optionId === baseline.optionId;
  const showDocumentImport =
    supportsBidDocumentImport(optionKind) && (form.optionId === null || editingAnImportedOption);

  function startNew() {
    setForm(blankForm());
    setError(null);
    setBaseline(null);
  }

  function startEdit(entity: EntityRecord) {
    const loaded = formFromEntity(entity);
    setForm(loaded.form);
    setError(null);
    setBaseline(loaded.baseline);
  }

  /**
   * Forgets the baseline's claim over one field: the person has now typed
   * there, so the value is theirs and goes up carrying no provenance.
   */
  function releaseField(definitionId: string) {
    setBaseline((prev) => {
      if (prev?.records[definitionId] === undefined) return prev;
      const { [definitionId]: _released, ...rest } = prev.records;
      return { ...prev, records: rest };
    });
  }

  function handleImported(summary: BidDocumentImportSummary) {
    // Straight into editing what the server actually wrote -- never a
    // client-side reconstruction of it -- so the person is correcting the
    // real record.
    setForm(formFromEntity(summary.option).form);
    setError(null);
    setImportOpen(true);
    setImportedOptionIds((prev) => [...prev, summary.option.id]);
    setBaseline({
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
    const records = baseline?.records ?? {};
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
        setBaseline(null);
      })
      .catch((caught: unknown) => {
        setSaving(false);
        setError(caught instanceof Error ? caught.message : 'Could not save this option.');
      });
  }

  const editing = form.optionId !== null;
  const editingLabel = editing
    ? (options.find((entity) => entity.id === form.optionId)?.label ?? form.label)
    : '';

  /** One field plus whatever note its inherited value has earned. */
  function renderField(definition: (typeof applicableDefinitions)[number]) {
    const record = baseline?.records[definition.id];
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
            releaseField(definition.id);
          }}
        />
        {record !== undefined && baseline !== null ? (
          <InheritedValueNote
            testId={`option-editor-imported-${definition.id}`}
            filename={baseline.filename}
            record={record}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section
      data-testid="option-editor"
      aria-labelledby="option-editor-heading"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-4)]"
    >
      {/*
        The form comes first, and the roster of options already on the case
        comes last, collapsed.

        The original order was the reverse -- heading, then every existing
        option with an Edit button, then the import, then the form -- which
        on the Bid Comparison pack's own twelve-bid case put the "Save" this
        sheet exists to reach 2,253px down a 2,329px scroll, three screens
        below the fold at the canonical 430px pane width. The "Add Bid"
        button at the top was worse than useless: it reset a form 1,458px
        below the viewport, so pressing it produced no visible change at all
        and read as a dead control. Someone opening "Add option" is there to
        add one; the twelve they already have are reference material.
      */}
      <h2 id="option-editor-heading" className="sr-only">
        {editing ? `Edit ${optionLabel}` : `Add a ${optionLabel}`}
      </h2>

      {editing ? (
        <div
          data-testid="option-editor-editing-banner"
          className="flex flex-wrap items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-muted px-[var(--space-2)] py-[var(--space-1)]"
        >
          <span className="text-[length:var(--font-size-sm)] text-[var(--color-ink)]">
            {`Editing ${editingLabel}`}
          </span>
          <Button
            type="button"
            data-testid="option-editor-cancel"
            variant="secondary"
            size="xs"
            className="min-h-[var(--size-touch-target-min)] min-w-[var(--size-touch-target-min)] bg-card text-card-foreground hover:bg-card/90"
            disabled={saving}
            onClick={startNew}
          >
            Cancel
          </Button>
        </div>
      ) : null}

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

      {/*
        Offered above the form as the other way to do the same job, but
        behind a disclosure rather than expanded.

        Expanded it is 694px of file picker, paste box, name, format and
        explanation -- which, placed first, simply swapped one buried
        primary action for another and pushed the type-it-yourself fields
        off the bottom of a 707px pane. One line here keeps both routes
        visible at once: the fields start immediately below, and the import
        is one tap away for whoever has the file.
      */}
      {showDocumentImport ? (
        <Collapsible
          open={importOpen}
          onOpenChange={setImportOpen}
          className="flex flex-col gap-[var(--space-2)]"
        >
          <CollapsibleTrigger
            data-testid="option-editor-import-trigger"
            className="group flex min-h-[var(--size-touch-target-min)] items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-muted px-[var(--space-2)] text-left text-[length:var(--font-size-sm)] text-[var(--color-ink)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <span>{`Import a ${optionLabel.toLowerCase()} document instead`}</span>
            <ChevronUpIcon
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
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
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <form
        id="option-editor-form"
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
              setBaseline((prev) => (prev === null ? prev : { ...prev, labelFromDocument: false }));
            }}
            // border-0: see EvidenceCard.tsx's identical comment -- a real
            // native <input> user-agent border otherwise shows through
            // unsuppressed.
            className="border-0"
          />
          {baseline?.labelFromDocument === true ? (
            <InheritedValueNote
              testId="option-editor-imported-label"
              filename={baseline.filename}
              record={undefined}
            />
          ) : null}
        </div>

        {statedDefinitions.map((definition) => renderField(definition))}

        {derivedDefinitions.length > 0 ? (
          <div
            data-testid="option-editor-derived-group"
            className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)] border-t border-[var(--color-border)] pt-[var(--space-3)]"
          >
            <div className="flex flex-col gap-[var(--space-1)]">
              <h3 className="text-[length:var(--font-size-sm)] font-[var(--font-weight-medium)] text-[var(--color-ink)]">
                What Sift works out
              </h3>
              <p className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]">
                {/* Phrased to be true in both states this group renders in:
                    empty while adding, and already filled while editing.
                    "Leave them blank" only made sense in the first. */}
                Sift works these out from the documents and checks on this case, rather than reading
                them off a bid. Anything you type here replaces that with your own claim — and the
                ranking weighs a typed claim exactly as heavily as a checked one.
              </p>
            </div>
            {derivedDefinitions.map((definition) => renderField(definition))}
          </div>
        ) : null}

        {baseline !== null &&
        baseline.filename !== null &&
        Object.keys(baseline.records).length > 0 ? (
          <p
            data-testid="option-editor-import-caution"
            role="status"
            className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
          >
            {`Values still marked as read from "${baseline.filename}" are saved as that document's proposal, with its confidence, and stay unverified. Anything you type here is saved as your own entry.`}
          </p>
        ) : null}

        {error ? (
          <Alert role="alert" data-testid="option-editor-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </form>

      {/*
        Reference material, not the task: collapsed by default so the form
        above it starts on screen. Open it to correct one that is already
        recorded.
      */}
      {options.length === 0 ? (
        <p
          data-testid="option-editor-empty"
          className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          {/* "above", not the original "below": the form moved to the top of
              this section, so the old wording now pointed the wrong way. */}
          No candidates entered yet. Add up to {maxOptions} using the form above.
        </p>
      ) : (
        <Collapsible className="flex flex-col gap-[var(--space-2)]">
          <CollapsibleTrigger
            data-testid="option-editor-list-trigger"
            className="group flex min-h-[var(--size-touch-target-min)] items-center justify-between gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2)] text-left text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {/* Names the target rather than the action: Radix supplies the
                expanded/collapsed state, and a "Show"/"Hide" label would
                fight `aria-expanded` and go stale against it. */}
            <span>{`${String(options.length)} ${optionLabel.toLowerCase()}${options.length === 1 ? '' : 's'} on this case`}</span>
            <ChevronUpIcon
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
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
          </CollapsibleContent>
        </Collapsible>
      )}

      {/*
        Pinned to the bottom of the sheet's own scrollport, so the action
        this sheet exists for is reachable at every scroll position instead
        of only at the very end of the content. `-mx`/`-mb` let the bar span
        the section's full width and sit flush with its padded edge; the
        opaque `bg-card` is what stops fields scrolling through it.
      */}
      <div className="sticky bottom-0 -mx-[var(--space-4)] -mb-[var(--space-4)] mt-[var(--space-1)] bg-card px-[var(--space-4)] pt-[var(--space-2)] pb-[var(--space-4)]">
        <Button
          type="submit"
          form="option-editor-form"
          data-testid="option-editor-save"
          aria-busy={saving}
          // `atCapacity` is only ever true while ADDING (it is false the
          // moment `form.optionId` is set), so this blocks a save the server
          // would reject anyway without ever blocking an edit. The old
          // layout disabled the "Add" button instead, which left the form
          // and its Save fully live underneath -- so a full case let you
          // type a whole option and only told you on submit.
          disabled={saving || atCapacity || form.label.trim().length === 0}
          className="min-h-[var(--size-touch-target-min)] w-full"
        >
          {saving ? 'Saving…' : editing ? 'Save changes' : `Save ${optionLabel}`}
        </Button>
      </div>
    </section>
  );
}
