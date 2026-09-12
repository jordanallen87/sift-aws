/**
 * The always-visible filter row above the results -- the half of the
 * project owner's instruction that is NOT the modal: "put this in some
 * sort of dialog or modal? And just show the applied filters?"
 *
 * ## Why this row exists separately from the sheet
 *
 * A filter modal on its own hides its own state. The shape every
 * mainstream shopping site converged on (Airbnb, Zillow, Etsy) is two
 * pieces: a `Filters` button carrying an active count, and a row of applied
 * chips each with a real ✕, both visible without opening anything. That is
 * what makes a filtered list legible -- a person can see WHY they are
 * looking at three cars instead of five, and undo exactly one of the
 * reasons, without reopening a modal to hunt for the control they set.
 *
 * Two earlier rounds of this UI were rejected by the project owner as
 * "crammed" and "nothing familiar." This row is the familiar part.
 *
 * ## The assistant's narrowing gets a chip too, and for the same reason
 *
 * `sift_set_view` lets the model narrow the list to a literal set of options
 * ("show her just those three"). That is a second, independent narrowing
 * alongside the person's own filters, and it arrives from SOMEONE ELSE --
 * which makes showing it here not a nicety but the thing that keeps the
 * feature honest. A narrowing nobody can see is a lie: three cards with no
 * explanation reads as "there are three cars," and a person who believes
 * that is worse off than if the model could not narrow at all.
 *
 * So it gets the identical treatment a filter gets -- a chip stating what
 * happened, a real ✕ that undoes it, and a result count that keeps naming
 * the true total -- with two deliberate differences:
 *
 *  - it is drawn differently (a dashed, untinted chip with an assistant
 *    glyph, not the solid tint a human-set filter uses), because provenance
 *    is the entire point: this is not something you did;
 *  - it does not count toward the `Filters` button badge, which is a promise
 *    that opening the sheet shows you those controls. The assistant's
 *    narrowing has no control in there, so counting it would send someone
 *    hunting for something that is not present.
 *
 * ## The dead-empty results defect this closes
 *
 * When filters exclude everything, an unexplained empty results area is
 * the worst outcome available: it looks identical to a case with no saved
 * options, or to a broken load. So the zero-match state is stated in plain
 * words right here ("No saved cars match these filters.") with `Clear all`
 * inline beside it -- the escape hatch sits with the explanation, not three
 * scrolls away.
 *
 * ## Honest counts, honest nouns
 *
 * Every number is caller-supplied and derived from real data:
 * `matchingCount` comes from `applyWorkspaceFilters`, `totalCount` is the
 * case's saved-option count, and each chip comes from
 * `describeAppliedFilters`. The noun comes from the ACTIVE PACK's own
 * `PresentationDefinition` (`optionLabel`/`optionLabelPlural` -- "Saved
 * car"/"Saved cars" for car-purchase, "Response option"/"Response options"
 * for home-energy-guardian), lowercased for mid-sentence use and otherwise
 * untouched: a pack author owns that wording, so this file neither
 * capitalises nor re-pluralises it, and falls back to a neutral
 * "option"/"options" when no pack is resolved yet rather than guessing a
 * domain noun.
 *
 * ## Presentation, never a decision mutation (change-set §54 / ADR 0005 #1)
 *
 * Purely presentational: no context, no fetching, no command calls.
 * Removing a chip or pressing `Clear all` emits the COMPLETE next
 * `WorkspaceFilter[]` and nothing else -- never a `CaseEvent`, never an
 * `eventSequence` advance, never a `Criterion` weight or target.
 */
import { SlidersHorizontalIcon, SparklesIcon, XIcon } from 'lucide-react';
import type {
  AttributeDefinition,
  EntityRecord,
  PresentationDefinition,
  WorkspaceFilter,
} from '@sift/contracts';
import {
  applyAssistantNarrowing,
  describeAppliedFilters,
  isFilterableAttribute,
  upsertFilter,
} from './workspace-filters.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface FilterBarProps {
  /** Compact right-pane presentation: icon-only trigger plus the truthful result count. */
  compact?: boolean;
  /** `CaseState.attributeDefinitions`. When none of them is filterable this component renders nothing at all. */
  attributeDefinitions: AttributeDefinition[];
  /** The case's real saved options -- read only so a `money` chip can recover the currency its own values declared. */
  options: EntityRecord[];
  /** The exact `WorkspaceViewState.filters` slice, or `[]`. */
  filters: WorkspaceFilter[];
  /** Fires with the COMPLETE next filters array (never a delta) when a chip is removed or everything is cleared. */
  onFiltersChange: (filters: WorkspaceFilter[]) => void;
  /** Opens `FilterSheet`. What "open" means stays with the orchestrator. */
  onOpenFilters: () => void;
  /** How many options survive the CURRENT filters -- the caller computes it with `applyWorkspaceFilters`. */
  matchingCount: number;
  /** Total saved options. */
  totalCount: number;
  /** The active pack's `PresentationDefinition`, or `null` before a pack is resolved. The same prop `WorkspaceViewSwitcher` already takes. */
  presentation: PresentationDefinition | null;
  /** The exact `WorkspaceViewState.visibleOptionIds` slice -- the option set the assistant narrowed to through `sift_set_view`. `undefined` means it has narrowed nothing, which is the ordinary case. */
  assistantVisibleOptionIds?: string[] | undefined;
  /** Fires when the person dismisses the assistant's narrowing (its own ✕, or `Clear all`). Like `onFiltersChange`, this component only reports the intent -- persisting it stays with the orchestrator. */
  onClearAssistantNarrowing?: (() => void) | undefined;
}

/**
 * One applied filter, readable and removable without opening the sheet.
 *
 * The ✕ carries a full accessible name ("Remove filter: AWD only"), never
 * a bare "×": a screen-reader user tabbing a row of five identical
 * "Remove" buttons has no way to tell which one undoes which decision.
 *
 * `shrink-0` + `max-w-full` is deliberate and load-bearing at 390px. A
 * production pass on this project already caught the opposite arrangement
 * once, where flex shrink squeezed real labels down to "S…"; a chip here
 * wraps onto its own line at full row width instead, and `truncate` (with
 * the complete text still in `title`) only ever engages for a value longer
 * than the entire pane.
 */
function AppliedFilterChip({
  fieldId,
  label,
  onRemove,
}: {
  fieldId: string;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      data-testid={`workspace-filter-chip-${fieldId}`}
      className="inline-flex min-h-[var(--size-touch-target-min)] max-w-full shrink-0 items-center gap-[var(--space-1)] rounded-[var(--radius-pill)] bg-[color:var(--color-status-active-bg)] py-[var(--space-0-5)] pl-[var(--space-3)] text-[length:var(--font-size-sm)] text-[color:var(--color-status-active-ink)]"
    >
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      {/*
       * The tooltip text is this button's `aria-label` verbatim, chip label
       * included: a row can hold several ✕ glyphs that differ only by which
       * chip they sit inside, so a bare "Remove" would be the one string a
       * pointer user cannot act on. It is still only a repeat of the name
       * the button already carries.
       */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid={`workspace-filter-chip-remove-${fieldId}`}
            aria-label={`Remove filter: ${label}`}
            onClick={onRemove}
            className="flex h-[var(--size-touch-target-min)] w-[var(--size-touch-target-min)] shrink-0 items-center justify-center rounded-[var(--radius-full)] transition-opacity duration-[var(--duration-fast)] hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{`Remove filter: ${label}`}</TooltipContent>
      </Tooltip>
    </span>
  );
}

/**
 * The assistant's narrowing, stated as someone else's doing.
 *
 * Drawn deliberately unlike `AppliedFilterChip` above -- dashed and untinted
 * rather than solid-tinted, with an assistant glyph -- so a glance separates
 * "I narrowed this" from "the assistant narrowed this." Same 44px target and
 * same fully-named ✕ as its sibling, because the escape hatch matters more
 * here, not less: this is the narrowing the person did not choose.
 */
function AssistantNarrowingChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span
      data-testid="workspace-filter-assistant-chip"
      className="inline-flex min-h-[var(--size-touch-target-min)] max-w-full shrink-0 items-center gap-[var(--space-1)] rounded-[var(--radius-pill)] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-sunken)] py-[var(--space-0-5)] pl-[var(--space-3)] text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
    >
      <SparklesIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      {/* Same rule as `AppliedFilterChip` above: the tooltip is this
          button's own accessible name, not a second, shorter one. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="workspace-filter-assistant-chip-remove"
            aria-label={`Remove: ${label}`}
            onClick={onRemove}
            className="flex h-[var(--size-touch-target-min)] w-[var(--size-touch-target-min)] shrink-0 items-center justify-center rounded-[var(--radius-full)] transition-opacity duration-[var(--duration-fast)] hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{`Remove: ${label}`}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export function FilterBar({
  compact = false,
  attributeDefinitions,
  options,
  filters,
  onFiltersChange,
  onOpenFilters,
  matchingCount,
  totalCount,
  presentation,
  assistantVisibleOptionIds,
  onClearAssistantNarrowing,
}: FilterBarProps) {
  const assistantIsNarrowing = assistantVisibleOptionIds !== undefined;
  // No filterable attribute anywhere in the pack/case means there is no
  // filtering to explain, so this renders no chrome at all rather than an
  // inert button over an empty chip row. Keyed on the DECLARATION, not on
  // what the current options happen to contain, so the entry point does not
  // blink in and out as options are added.
  //
  // The assistant's narrowing overrides that silence. A pack with nothing
  // filterable can still have its list narrowed by `sift_set_view`, and
  // returning `null` there would put the page right back in the state this
  // component exists to prevent: a shortened list with no stated reason.
  const hasFilterableAttribute = attributeDefinitions.some(isFilterableAttribute);
  if (!hasFilterableAttribute && !assistantIsNarrowing) return null;

  // `describeAppliedFilters` is the single source of truth for "what is
  // applied", not `filters.length`: it already drops any filter naming an
  // attribute this pack version no longer declares, which is exactly the
  // set `applyWorkspaceFilters` also ignores. Counting a stale filter in
  // the badge would claim an active narrowing that is provably not
  // happening.
  const chips = describeAppliedFilters(filters, attributeDefinitions, options);
  const hasApplied = chips.length > 0;

  const singularNoun = presentation?.optionLabel.toLowerCase() ?? 'option';
  const pluralNoun = presentation?.optionLabelPlural.toLowerCase() ?? 'options';
  // The noun agrees with the case's total, which is the only count that can
  // legitimately be 1 on its own ("1 saved car"); a filtered reading is
  // always "N of M", where M governs ("0 of 5 saved cars", "1 of 1 saved car").
  const noun = totalCount === 1 ? singularNoun : pluralNoun;

  // Resolved against the case's REAL saved options, never taken as the raw
  // id array's length: a `visibleOptionIds` persisted before an option was
  // deleted still names it, and "narrowed to 3" while two of those three no
  // longer exist would be a fabricated number in the one row that exists to
  // be honest about why the list is short. Same reader `App.tsx` narrows the
  // rendered list with, so the chip's number cannot drift from the page.
  const assistantVisibleCount = assistantIsNarrowing
    ? applyAssistantNarrowing(options, assistantVisibleOptionIds).length
    : 0;
  const assistantNoun = assistantVisibleCount === 1 ? singularNoun : pluralNoun;
  const assistantLabel = `Assistant narrowed to ${assistantVisibleCount} ${assistantNoun}`;

  /**
   * The zero-match sentence has to name EVERY active reason, not the first
   * one. Two narrowings can be in force at once, and a person told only
   * "no saved cars match these filters" while the assistant is also holding
   * the list down to two options would clear every filter, see nothing
   * change, and reasonably conclude the product is broken.
   */
  const zeroMatchText = !assistantIsNarrowing
    ? `No ${pluralNoun} match these filters.`
    : !hasApplied
      ? // The assistant is the sole narrowing and nothing survived it, which
        // means every option it named is gone -- so say that, rather than
        // blaming filters the person has not set.
        `The assistant narrowed this view to ${pluralNoun} that are no longer here.`
      : `No ${pluralNoun} match these filters among the ${assistantVisibleCount} the assistant narrowed to.`;

  const resultText =
    !hasApplied && !assistantIsNarrowing
      ? `${totalCount} ${noun}`
      : matchingCount === 0
        ? zeroMatchText
        : `${matchingCount} of ${totalCount} ${noun}`;

  return (
    <div
      data-testid="workspace-filter-bar"
      className={
        compact
          ? 'flex flex-wrap items-center gap-[var(--space-2)]'
          : 'flex flex-col gap-[var(--space-2)]'
      }
      aria-label="Filters"
      role="group"
    >
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        {/*
         * Only when the sheet behind it has controls to show. This row can
         * now render for the assistant's narrowing alone (see the early
         * return above), and a `Filters` button opening an empty sheet is
         * the dead control the rest of this component is built to avoid.
         */}
        {hasFilterableAttribute ? (
          <Button
            type="button"
            data-testid="workspace-filter-open"
            variant="secondary"
            size={compact ? 'icon-lg' : 'default'}
            aria-label={compact ? 'Filter options' : undefined}
            onClick={onOpenFilters}
            className={
              compact
                ? 'min-h-[var(--size-touch-target-min)] min-w-[var(--size-touch-target-min)]'
                : 'min-h-[var(--size-touch-target-min)] gap-[var(--space-2)] px-[var(--space-3)]'
            }
          >
            <SlidersHorizontalIcon aria-hidden="true" />
            {compact ? null : <span>Filters</span>}
            {hasApplied ? (
              <Badge
                data-testid="workspace-filter-active-count"
                className="shrink-0"
                style={{
                  backgroundColor: 'var(--color-status-active-ink)',
                  color: 'var(--color-surface)',
                }}
              >
                {/*
                 * `chips.length`, deliberately excluding the assistant's
                 * narrowing: this badge is a promise about what opening the
                 * sheet will show you, and the sheet has no control for it.
                 */}
                {chips.length}
              </Badge>
            ) : null}
          </Button>
        ) : null}

        {/*
         * A live, always-present count -- the sentence that tells a person
         * whether they are looking at everything or a subset, and (when a
         * filter excludes everything) why the results area below is empty.
         * `aria-live="polite"` because this text changes underneath a user
         * who is pressing chips, not as the result of navigating to it.
         */}
        <span
          data-testid="workspace-filter-result-count"
          aria-live="polite"
          className="min-w-0 text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          {resultText}
        </span>
      </div>

      {/*
       * `Clear all` lives at the END OF THE CHIP ROW, not in the button row
       * above. It reads as "clear these", so it has to sit with the things
       * it clears -- and putting it in the button row with `ml-auto` was
       * visibly wrong in the running product at 390px: the row wrapped and
       * left a lone right-aligned "Clear all" floating on its own line above
       * the single chip it applied to, connected to nothing.
       *
       * As the last item of the wrapping chip row it is correct at every
       * width, needs no `ml-auto`, and can never strand itself.
       */}
      {hasApplied || assistantIsNarrowing ? (
        <div
          data-testid="workspace-filter-chips"
          className="flex flex-wrap items-center gap-[var(--space-2)]"
        >
          {/*
           * The assistant's chip leads the row. It is the narrowing the
           * person did not set, so it is the one they most need to find --
           * and putting it after a run of their own filters is exactly where
           * it would be skimmed past.
           */}
          {assistantIsNarrowing ? (
            <AssistantNarrowingChip
              label={assistantLabel}
              onRemove={() => onClearAssistantNarrowing?.()}
            />
          ) : null}
          {chips.map((chip) => (
            <AppliedFilterChip
              key={chip.fieldId}
              fieldId={chip.fieldId}
              label={chip.label}
              onRemove={() => {
                onFiltersChange(upsertFilter(filters, chip.fieldId, null));
              }}
            />
          ))}
          {/*
           * Only offered when the person has filters of their own to clear.
           * With the assistant's chip standing alone, its own ✕ already says
           * everything a second "Clear all" beside it would.
           */}
          {hasApplied ? (
            <Button
              type="button"
              data-testid="workspace-filter-clear-all"
              variant="ghost"
              onClick={() => {
                // The COMPLETE next array, and genuinely empty: this clears
                // any stale filter too, even one with no chip of its own.
                onFiltersChange([]);
                // And the assistant's narrowing with it. "Clear all" sits at
                // the end of the row that shows both chips, so clearing only
                // one of them would leave a visibly shortened list under a
                // control that just claimed to have cleared everything.
                if (assistantIsNarrowing) onClearAssistantNarrowing?.();
              }}
              className="min-h-[var(--size-touch-target-min)] px-[var(--space-3)]"
            >
              Clear all
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
