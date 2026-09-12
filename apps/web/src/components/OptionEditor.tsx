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
 */
import { useMemo, useState } from 'react';
import { MAX_CASE_ENTITIES } from '@sift/contracts';
import type { AttributeDefinition, AttributeValue, EntityRecord } from '@sift/contracts';
import { useSiftCommands } from '../app/AppProviders.js';
import { DynamicAttributeField } from './DynamicAttributeField.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

function blankForm(): FormState {
  return { optionId: null, label: '', values: {} };
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

  const applicableDefinitions = useMemo(
    () => attributeDefinitions.filter((definition) => definition.appliesTo.includes(optionKind)),
    [attributeDefinitions, optionKind],
  );

  const atCapacity = form.optionId === null && options.length >= maxOptions;

  function startNew() {
    setForm(blankForm());
    setError(null);
  }

  function startEdit(entity: EntityRecord) {
    setForm(formFromEntity(entity));
    setError(null);
  }

  function handleSubmit() {
    if (form.label.trim().length === 0 || saving) return;
    setSaving(true);
    setError(null);
    const attributes = Object.entries(form.values)
      .filter((entry): entry is [string, AttributeValue] => entry[1] !== undefined)
      .map(([definitionId, value]) => ({ definitionId, value }));

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
              setForm((prev) => ({ ...prev, label: event.target.value }));
            }}
            // border-0: see EvidenceCard.tsx's identical comment -- a real
            // native <input> user-agent border otherwise shows through
            // unsuppressed.
            className="border-0"
          />
        </div>

        {applicableDefinitions.map((definition) => (
          <DynamicAttributeField
            key={definition.id}
            definition={definition}
            value={form.values[definition.id]}
            disabled={saving}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, values: { ...prev.values, [definition.id]: value } }));
            }}
          />
        ))}

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
