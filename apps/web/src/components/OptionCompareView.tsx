/**
 * The rebuilt Compare / Table view (docs/change-sets/2026-08-30-generic-decision-workspace.md
 * §11) that supersedes `OptionComparison.tsx`'s unconditional "every option is a column, every
 * applicable attribute is a row" rendering. `docs/decisions/0005-workspace-view-state-and-option-
 * views.md` Decision 5 states the defect this component exists to fix directly: `OptionComparison`
 * "has no prop, piece of local state, or hook anywhere in the file that could narrow either axis"
 * -- yet §11 requires that "the model must be able to configure which fields/rows appear" (e.g.
 * "Show me the three finalists and only the things that matter most to me") and §58 stages this as
 * a deliberate WebMCP demo moment: ChatGPT "limits candidates; sets visible rows... page visibly
 * reconfigures without click automation."
 *
 * `visibleOptionIds`/`visibleAttributeIds`/`pinnedAttributeIds` are therefore real, independent
 * props -- not internal component state -- because ADR 0005 Decision 5 requires the narrowing
 * source of truth to live in `WorkspaceViewState` (written by a WebMCP presentation tool through
 * `updateSelection()`) and merely be *read* here. Per §54/§32 ("UI action vs decision mutation"):
 * narrowing what is visible is presentation, never a criteria mutation, so this component only
 * ever reads/renders a caller-supplied projection -- it never computes or persists anything itself
 * (this file has no fetching, no context, no command dispatch, matching `OptionComparison.tsx`'s
 * "purely presentational" contract).
 *
 * Narrow vs. expanded (§7, ADR 0005 Decision 4) are two distinct information architectures, not
 * one table scaled by CSS: "at 390px a two-option head-to-head comparison may be far more usable"
 * than a multi-column table. `layout` is an explicit caller-supplied prop -- this component never
 * calls `matchMedia` itself, per this task's own instruction and ADR 0005 Decision 4's observation
 * that no width-detection mechanism exists yet in `apps/web/src`; that mechanism, and the decision
 * of which literal breakpoint maps to which `layout` value, belongs to the caller that owns
 * `WorkspaceViewState`, not to this presentational leaf.
 *
 * Custom (`custom.*`) fields render as first-class rows (§26): a small "Custom" marker indicates
 * "added for your comparison" without ever leaking the raw id into visible text -- `definition.
 * label` is rendered everywhere, exactly as ADR 0005 Decision 6 requires ("their raw ids never
 * reach consumer UI").
 *
 * Reused from `OptionComparison.tsx` verbatim in spirit (not by import -- that file exports no
 * shared helper): the `attributeGroups`-driven grouping fallback, the "Unknown" (never blank)
 * missing-value rule, and the `overflow-x-auto`-inside-its-own-container scroll discipline so the
 * comparison table -- not the page -- scrolls sideways (§49 "no horizontal page overflow").
 *
 * Two seam defects closed here (this component's own props were already individually correct;
 * nothing upstream connected them):
 *
 * 1. `visibleOptionIds`/`visibleAttributeIds`/`pinnedAttributeIds` were real props no caller ever
 *    populated -- `sift_configure_comparison` genuinely persisted `WorkspaceViewState`, but
 *    `WorkspaceViewSwitcher` mounted this component passing none of them, so the model's
 *    reconfiguration silently never reached the page (§58's demo moment). See
 *    `WorkspaceViewSwitcher.tsx`'s own header comment for the App.tsx -> WorkspaceViewSwitcher ->
 *    here wiring and the `compare.optionIds` vs. top-level `visibleOptionIds` field decision.
 *    `filteredOutOptionCount`/`option-compare-view-filtered-note` below is the accompanying §54
 *    guard: a column `visibleOptionIds` narrows out must read as "not shown in this view," never as
 *    "eliminated."
 * 2. `caseExtensions` (`CaseState.caseExtensions`) was never passed in at all, so a confirmed
 *    case-defined concern had real values but never became a comparison row. `caseExtensions` is
 *    merged into `attributeDefinitions` (confirmed only) before the existing custom-id rendering
 *    logic below runs, so no separate marking step was needed.
 *
 * Two further signal defects closed here (a later pass over this otherwise-sound table -- grouped
 * rows, zebra striping, real column headers were already correct and are untouched):
 *
 * 3. **Identity rows restated the column header.** Columns are headed with the option's full label
 *    ("2022 Toyota RAV4 XLE Hybrid AWD"); the first rows underneath were then Make / Model / Trim --
 *    the same string, decomposed, carrying no DIFFERENCE a comparison table exists to show. Fixed by
 *    reusing `isIdentityAttribute` (`../lib/evidence-expectation.js`) -- the exact judgment
 *    `QuickPickView.tsx`/`OptionListView.tsx` already use to keep an option's own identity fields out
 *    of their strengths/concerns lists -- to exclude identity attributes from `narrowedDefinitions`'s
 *    DEFAULT branch only (`visibleAttributeIds === undefined`). Compare is configurable
 *    (`sift_configure_comparison` writes `visibleAttributeIds`/`pinnedAttributeIds` through
 *    `WorkspaceViewState`), so an identity row is never made unreachable: an explicit
 *    `visibleAttributeIds` list still shows exactly what it names (the existing branch, untouched),
 *    and an identity id present in `pinnedAttributeIds` survives the default-branch filter too --
 *    pinning is itself a deliberate "put this back" request and must never be silently dropped.
 *    (`car.model_year` -- also part of the same header string -- is deliberately NOT filtered: it is
 *    `valueType: 'number'` with `comparison: 'higher_better'` in the car-purchase pack, so
 *    `isIdentityAttribute` correctly reads it as genuine comparison-relevant data -- a newer model
 *    year is actually a reason to prefer one option -- not a bare label. That is `isIdentityAttribute`'s
 *    own judgment, reused verbatim rather than second-guessed here.)
 * 4. **All-equal rows outweighed genuine differences.** A row where every currently rendered option
 *    resolves to the identical formatted value (e.g. `car.standard_features` -- identical across all
 *    four demo candidates in `packages/scenarios/fixtures/car-purchase/candidate-listings.json` --
 *    which also happens to be the single longest row on the page) carries no comparison signal but
 *    occupied the same visual weight as a row with real differences. `computeAllEqualDisplayByAttributeId`
 *    detects this (only when >= 2 options are actually rendered, and only when every one of them has a
 *    *resolved* value -- an all-`Unknown` row means "no one has an answer yet," a distinct evidence-gap
 *    problem, not "everyone agrees"). Such a row collapses by default to one muted, italicized cell
 *    spanning every option column plus a "Same for all" badge -- obvious at a glance, and the data is
 *    never deleted: a per-row toggle (`CompareRow`'s `expanded` state, local to this component --
 *    display-only UI state, not case state, so it needs no caller wiring) reveals the ordinary
 *    per-option cells on demand and can be collapsed again just as easily.
 */
import { useMemo, useState } from 'react';
import type {
  AttributeDefinition,
  CaseExtension,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { formatAttributeValue } from './attribute-value-format.js';
import { isIdentityAttribute } from '../lib/evidence-expectation.js';
import { Badge } from '@/components/ui/badge';

export interface OptionCompareViewProps {
  options: EntityRecord[];
  attributeDefinitions: AttributeDefinition[];
  /**
   * Confirmed-or-pending case-level custom concerns (`CaseState.caseExtensions`).
   * Defect 2 fix: only entries with `definition.confirmation === 'confirmed'` are
   * merged in as real comparison rows, alongside `attributeDefinitions` -- a
   * still-`pending` (or `rejected`) extension is a proposal awaiting human
   * review, not yet an agreed comparison dimension (change-set §21/§27).
   * Defaults to an empty array so every existing caller (and every earlier
   * test in this file) that never passes this prop keeps rendering exactly
   * as before. Because `CaseExtension.definition.id` always carries the
   * `custom.` prefix (`CaseAttributeIdSchema`), a merged-in extension
   * automatically picks up the existing `isCustomAttributeId` "Custom" badge
   * and label-not-id rendering below -- no separate marking logic needed.
   */
  caseExtensions?: CaseExtension[];
  /** `CompiledDecisionPack.presentation`, or `null` if not yet available. */
  presentation: PresentationDefinition | null;
  selectedOptionId: string | null;
  /**
   * Narrows which option columns render. `undefined` shows every option -- the
   * backward-compatible default (§11 "configurable visible rows" is additive,
   * not required). The caller (`WorkspaceViewSwitcher`) decides which
   * persisted `WorkspaceViewState` field feeds this -- see that file's own
   * header comment for the `compare.optionIds` vs. top-level `visibleOptionIds`
   * decision; this component stays agnostic of `CaseState.view` entirely.
   */
  visibleOptionIds?: string[] | undefined;
  /** Narrows which attribute rows render (both pinned and grouped). `undefined` shows every applicable attribute. */
  visibleAttributeIds?: string[] | undefined;
  /** Rendered first, ahead of the grouped table, and visually distinguished. Order follows this array, not `attributeDefinitions` order, so the caller controls pin priority. */
  pinnedAttributeIds?: string[] | undefined;
  /** Caller-decided information architecture (ADR 0005 Decision 4) -- this component never calls `matchMedia`. */
  layout: 'narrow' | 'expanded';
  /** Fired when a user or WebMCP-driven caller focuses an option's column header, or clears the focus (`null`) when the already-selected header is clicked again -- see `OptionListView.tsx`'s header comment's "toggle button must be able to un-press" section. Shared-focus plumbing (§30) lives in the caller; this component only reports the intent. */
  onFocusOption?: (optionId: string | null) => void;
}

interface AttributeGroupView {
  id: string;
  label: string;
  definitions: AttributeDefinition[];
}

const FALLBACK_GROUP_ID = 'all-attributes';
const UNGROUPED_GROUP_ID = 'other-attributes';
const CUSTOM_ATTRIBUTE_ID_PREFIX = 'custom.';

/** `attributes.ts`'s `custom.` id namespace comment warns "this id is rendered directly in the generic UI" with no humanizing step -- this is the check that stops that from happening here (ADR 0005 Decision 6). */
function isCustomAttributeId(id: string): boolean {
  return id.startsWith(CUSTOM_ATTRIBUTE_ID_PREFIX);
}

/** Same fallback/grouping shape `OptionComparison.tsx` uses, operating on whatever definition subset the caller (via `visibleAttributeIds`) and pin extraction leave over -- an empty input renders no groups at all rather than one heading with zero rows underneath. */
function buildGroups(
  definitions: AttributeDefinition[],
  presentation: PresentationDefinition | null,
): AttributeGroupView[] {
  if (definitions.length === 0) return [];

  if (presentation === null || presentation.attributeGroups.length === 0) {
    return [{ id: FALLBACK_GROUP_ID, label: 'All attributes', definitions }];
  }

  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const covered = new Set<string>();
  const groups: AttributeGroupView[] = [];

  for (const group of presentation.attributeGroups) {
    const groupDefinitions = group.attributeIds
      .map((id) => byId.get(id))
      .filter((definition): definition is AttributeDefinition => definition !== undefined);
    for (const definition of groupDefinitions) covered.add(definition.id);
    if (groupDefinitions.length > 0) {
      groups.push({ id: group.id, label: group.label, definitions: groupDefinitions });
    }
  }

  const remaining = definitions.filter((definition) => !covered.has(definition.id));
  if (remaining.length > 0) {
    groups.push({ id: UNGROUPED_GROUP_ID, label: 'Other', definitions: remaining });
  }
  return groups;
}

/** `undefined` (the "show everything" default) passes `options` through untouched; otherwise re-projects to exactly the given ids, in the given order, silently dropping any id no longer present rather than crashing on stale WebMCP-supplied ids. */
function narrowOptions(
  options: EntityRecord[],
  visibleOptionIds: string[] | undefined,
): EntityRecord[] {
  if (visibleOptionIds === undefined) return options;
  const byId = new Map(options.map((option) => [option.id, option]));
  return visibleOptionIds
    .map((id) => byId.get(id))
    .filter((option): option is EntityRecord => option !== undefined);
}

/**
 * Narrow layout's head-to-head selection rule (this task's own prompt asks for the reasoning to
 * be reported, so it is spelled out here too): with 2 or fewer already-visible options there is
 * nothing to choose between, so all of them show. With more than 2, shared focus (§30 -- "if
 * ChatGPT focuses RAV4, the page should visibly focus RAV4") takes priority over plain list order:
 * the currently selected option is always one of the two shown, paired with the first other option
 * in `options` order, so the pairing is deterministic and testable rather than picking "most
 * different" or similar unstated heuristics. With no selection at all, the first two in order show.
 */
function pickHeadToHeadOptions(
  options: EntityRecord[],
  selectedOptionId: string | null,
): EntityRecord[] {
  if (options.length <= 2) return options;

  const selectedIndex =
    selectedOptionId === null ? -1 : options.findIndex((option) => option.id === selectedOptionId);
  if (selectedIndex === -1) return options.slice(0, 2);

  const selected = options[selectedIndex]!;
  const other = options.find((_option, index) => index !== selectedIndex);
  return other === undefined ? [selected] : [selected, other];
}

/**
 * Problem 2's detection pass: the shared formatted display value for every attribute definition
 * where every currently *rendered* option (post narrow-layout head-to-head pairing, not the full
 * option set -- "these two agree" is exactly as real a de-emphasis signal as "all four agree," so
 * narrow layout gets the same treatment rather than being silently exempted) resolves to the exact
 * same formatted string. A row is only ever eligible when every rendered option has a *resolved*
 * value: if even one is still unknown, this is an evidence gap ("no one has an answer yet"), not
 * agreement, and is left out of the returned map entirely so it renders as an ordinary row (an
 * absent map entry means "not all-equal," reusing the row's existing missing-value handling).
 * Requires at least two rendered options -- with only one there is nothing to differ from, so
 * "every option has the same value" would be true of literally every row and collapse the whole
 * table without saying anything real.
 */
function computeAllEqualDisplayByAttributeId(
  definitions: AttributeDefinition[],
  renderedOptions: EntityRecord[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  if (renderedOptions.length < 2) return result;

  for (const definition of definitions) {
    let shared: string | undefined;
    let allResolvedAndEqual = true;
    for (const option of renderedOptions) {
      const value = option.attributes[definition.id]?.value;
      if (value === undefined) {
        allResolvedAndEqual = false;
        break;
      }
      const display = formatAttributeValue(value);
      if (shared === undefined) {
        shared = display;
      } else if (display !== shared) {
        allResolvedAndEqual = false;
        break;
      }
    }
    if (allResolvedAndEqual && shared !== undefined) {
      result.set(definition.id, shared);
    }
  }
  return result;
}

interface CompareRowProps {
  definition: AttributeDefinition;
  pinned: boolean;
  isStriped: boolean;
  renderedOptions: EntityRecord[];
  /**
   * The shared formatted value when Problem 2's judgment finds every rendered option resolves to
   * this identical value; `undefined` for an ordinary row (real per-option differences, or any
   * unresolved cell). Presence of this, not a separate boolean, is the row's "all-equal" signal --
   * one value that cannot itself drift out of sync with the boolean it would otherwise need to
   * accompany.
   */
  allEqualDisplay: string | undefined;
  /** Only meaningful when `allEqualDisplay !== undefined`: whether the user toggled this specific all-equal row open to see the (identical) per-option cells anyway. Always `false` for an ordinary row. */
  expanded: boolean;
  onToggleExpanded: (definitionId: string) => void;
}

/** No `border-t`: alternating `bg-muted` tint (or the pinned tint) carries the row-legibility job instead, matching `OptionComparison.tsx`'s "no cell/row borders" convention. */
function CompareRow({
  definition,
  pinned,
  isStriped,
  renderedOptions,
  allEqualDisplay,
  expanded,
  onToggleExpanded,
}: CompareRowProps) {
  const custom = isCustomAttributeId(definition.id);
  const allEqual = allEqualDisplay !== undefined;
  const rowClassName = pinned ? 'bg-[var(--color-brand-tint)]' : isStriped ? 'bg-muted' : undefined;
  // Collapsed by default (`allEqual && !expanded`): the value area renders as one spanning cell
  // instead of N repeated ones, which is what actually stops a long identical string ("Standard
  // features") from dominating the table -- a single cell gets the table's full width to wrap into,
  // where each of N narrow per-option cells would each wrap the same text onto more lines and force
  // the row just as tall as before. `expanded` (toggled per row, see `onToggleExpanded`) restores the
  // ordinary per-option cells -- still visually muted, since the values are still non-differentiating
  // -- so a person can always drop back to "one row per option" without losing anything.
  const showCollapsedCell = allEqual && !expanded;

  return (
    <tr
      data-testid={`option-compare-view-row-${definition.id}`}
      data-pinned={pinned ? 'true' : 'false'}
      data-all-equal={allEqual ? 'true' : 'false'}
      className={rowClassName}
    >
      <th
        scope="row"
        // `align-top` + wrapping, deliberately not truncation. Live
        // verification at 430px caught this: the label was `truncate`d,
        // but truncation needs an overflow context the `th` never
        // established, so long labels ("True out-the-door price", "Cargo
        // volume behind second row") visually overlapped the adjacent
        // value cell rather than clipping -- unreadable, and worse than
        // either wrapping or clipping. Wrapping is the right fix rather
        // than adding `overflow-hidden`: in a comparison table an
        // ellipsized attribute name ("Estimated 5-year mainten...") leaves
        // the reader unable to tell what the number beside it measures,
        // which is precisely the question this view exists to answer.
        className="p-[var(--space-2)] align-top text-[length:var(--font-size-sm)] font-normal break-words text-[var(--color-ink-secondary)]"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-[var(--space-1)]">
          <span className="min-w-0 break-words">{definition.label}</span>
          {custom ? (
            <Badge
              variant="outline"
              data-testid={`option-compare-view-custom-badge-${definition.id}`}
              className="label-caps shrink-0 px-[var(--space-1)] py-0 text-[var(--color-ink-secondary)]"
              title="Added for your comparison"
            >
              Custom
            </Badge>
          ) : null}
          {allEqual ? (
            <Badge
              variant="outline"
              data-testid={`option-compare-view-same-badge-${definition.id}`}
              className="label-caps shrink-0 px-[var(--space-1)] py-0 text-[var(--color-ink-muted)]"
              title="Every option shown here has the same value for this attribute"
            >
              Same for all
            </Badge>
          ) : null}
          {allEqual ? (
            // A real, reversible affordance -- not a decorative label. Reuses the existing
            // link-style convention this codebase already applies to inline actionable text
            // (`EvidenceCard.tsx`/`RecommendationCard.tsx`'s `text-[var(--color-brand)] underline`),
            // rather than inventing a new "this is clickable" signal for this one row type.
            <button
              type="button"
              data-testid={`option-compare-view-row-toggle-${definition.id}`}
              aria-expanded={expanded}
              onClick={() => {
                onToggleExpanded(definition.id);
              }}
              className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[length:var(--font-size-xs)] text-[var(--color-brand)] underline underline-offset-2"
            >
              {expanded ? 'Show as one row' : 'Show separately'}
            </button>
          ) : null}
        </span>
      </th>
      {showCollapsedCell ? (
        <td
          colSpan={renderedOptions.length}
          data-testid={`option-compare-view-collapsed-cell-${definition.id}`}
          className="p-[var(--space-2)] text-[length:var(--font-size-sm)] italic text-[var(--color-ink-muted)]"
        >
          {allEqualDisplay}
        </td>
      ) : (
        renderedOptions.map((option) => {
          const record = option.attributes[definition.id];
          const display =
            record?.value !== undefined ? formatAttributeValue(record.value) : 'Unknown';
          // An all-equal row's cells are never actually "Unknown" here (see
          // `computeAllEqualDisplayByAttributeId`'s resolved-value requirement), so the
          // muted-vs-unknown styling branches never collide -- `allEqual` italicizes/mutes an
          // expanded-by-choice all-equal row's real values; the unknown-value branch below still
          // covers an ordinary row's genuinely missing cells exactly as before.
          const style = allEqual
            ? { color: 'var(--color-ink-muted)', fontStyle: 'italic' as const }
            : record?.value === undefined
              ? { color: 'var(--color-ink-muted)' }
              : undefined;
          return (
            <td
              key={option.id}
              data-testid={`option-compare-view-cell-${definition.id}-${option.id}`}
              className="p-[var(--space-2)] text-[length:var(--font-size-sm)]"
              style={style}
            >
              {display}
            </td>
          );
        })
      )}
    </tr>
  );
}

export function OptionCompareView({
  options,
  attributeDefinitions,
  caseExtensions = [],
  presentation,
  selectedOptionId,
  visibleOptionIds,
  visibleAttributeIds,
  pinnedAttributeIds,
  layout,
  onFocusOption,
}: OptionCompareViewProps) {
  const displayedOptions = useMemo(
    () => narrowOptions(options, visibleOptionIds),
    [options, visibleOptionIds],
  );

  // Defect 1 (§54 "presentation filtering ≠ decision mutation"): an option
  // that `visibleOptionIds` narrowed out of `options` entirely must never
  // read as eliminated -- it is a display choice, not a verdict on the
  // option. Distinct from `hiddenOptionCount` below (which only covers the
  // narrow-layout head-to-head auto-pairing of an *already-visible* set):
  // this counts options the caller's own configuration removed from view.
  const filteredOutOptionCount = options.length - displayedOptions.length;

  const isHeadToHead = layout === 'narrow';
  const renderedOptions = useMemo(
    () =>
      isHeadToHead ? pickHeadToHeadOptions(displayedOptions, selectedOptionId) : displayedOptions,
    [isHeadToHead, displayedOptions, selectedOptionId],
  );
  const hiddenOptionCount = displayedOptions.length - renderedOptions.length;

  // Defect 2 (§21/§27): confirmed case-level custom concerns become real
  // comparison rows, first-class beside pack-native attributes. Only
  // `confirmed` extensions qualify -- a `pending` one is still awaiting
  // human review and is not yet an agreed comparison dimension, and a
  // `rejected` one was actively declined. See this file's `caseExtensions`
  // prop doc for why no separate "mark as custom" step is needed here: the
  // existing `custom.` id-prefix check below already covers it.
  const confirmedExtensionDefinitions = useMemo<AttributeDefinition[]>(() => {
    const existingIds = new Set(attributeDefinitions.map((definition) => definition.id));
    return caseExtensions
      .filter(
        (extension) =>
          extension.definition.confirmation === 'confirmed' &&
          !existingIds.has(extension.definition.id),
      )
      .map((extension) => extension.definition);
  }, [attributeDefinitions, caseExtensions]);

  const allDefinitions = useMemo(
    () => [...attributeDefinitions, ...confirmedExtensionDefinitions],
    [attributeDefinitions, confirmedExtensionDefinitions],
  );

  const applicableDefinitions = useMemo(() => {
    const relevantKinds = new Set(options.map((option) => option.kind));
    return allDefinitions.filter((definition) =>
      definition.appliesTo.some((kind) => relevantKinds.has(kind)),
    );
  }, [options, allDefinitions]);

  const narrowedDefinitions = useMemo(() => {
    if (visibleAttributeIds !== undefined) {
      const visibleIdSet = new Set(visibleAttributeIds);
      return applicableDefinitions.filter((definition) => visibleIdSet.has(definition.id));
    }
    // Problem 1 (this task): an identity/label descriptor (`isIdentityAttribute` -- e.g.
    // `car.make`/`car.model`/`car.trim`) merely restates what the column header above it already
    // says, so it is excluded from the DEFAULT visible set only -- this branch runs precisely when
    // no explicit `visibleAttributeIds` request exists. An id present in `pinnedAttributeIds` is
    // exempted from this filter even in the default branch: pinning is itself a deliberate,
    // explicit "put this back" request (exactly like naming it in `visibleAttributeIds` above), and
    // this component's own contract (see `pinnedAttributeIds`'s prop doc) is "never silently drop a
    // row someone deliberately pinned."
    const pinnedIdSet = new Set(pinnedAttributeIds ?? []);
    return applicableDefinitions.filter(
      (definition) => pinnedIdSet.has(definition.id) || !isIdentityAttribute(definition),
    );
  }, [applicableDefinitions, visibleAttributeIds, pinnedAttributeIds]);

  const pinnedDefinitions = useMemo(() => {
    if (pinnedAttributeIds === undefined || pinnedAttributeIds.length === 0) return [];
    const byId = new Map(narrowedDefinitions.map((definition) => [definition.id, definition]));
    return pinnedAttributeIds
      .map((id) => byId.get(id))
      .filter((definition): definition is AttributeDefinition => definition !== undefined);
  }, [narrowedDefinitions, pinnedAttributeIds]);

  const unpinnedDefinitions = useMemo(() => {
    const pinnedIdSet = new Set(pinnedDefinitions.map((definition) => definition.id));
    return narrowedDefinitions.filter((definition) => !pinnedIdSet.has(definition.id));
  }, [narrowedDefinitions, pinnedDefinitions]);

  const groups = useMemo(
    () => buildGroups(unpinnedDefinitions, presentation),
    [unpinnedDefinitions, presentation],
  );

  // Problem 2 (this task): computed once over `narrowedDefinitions` (the full set feeding both the
  // pinned and grouped `.map()` calls below -- a `Map.get` by id works regardless of which of those
  // two render paths a given definition ends up on) and `renderedOptions` (the options actually on
  // screen, so narrow layout's head-to-head pair gets evaluated on its own pair, not the full,
  // possibly-narrowed-further option set). See `computeAllEqualDisplayByAttributeId`'s own doc
  // comment for the resolved-value and >= 2-rendered-options requirements.
  const allEqualDisplayByAttributeId = useMemo(
    () => computeAllEqualDisplayByAttributeId(narrowedDefinitions, renderedOptions),
    [narrowedDefinitions, renderedOptions],
  );

  // Per-row, user-toggled "show this all-equal row's per-option cells anyway" state. Deliberately
  // local `useState`, not a prop: unlike `visibleOptionIds`/`visibleAttributeIds`/
  // `pinnedAttributeIds` above (real `WorkspaceViewState`, shared with a WebMCP-driven ChatGPT
  // session per this file's header comment), whether one row is currently expanded or collapsed is
  // ephemeral display state with no case-state or cross-session meaning -- nothing forwards it into
  // this component the way `App.tsx`/`WorkspaceViewSwitcher` forward the real narrowing props, and
  // nothing needs to. A definition id no longer present after re-narrowing simply becomes an inert
  // entry in this set (never read again), rather than needing explicit pruning.
  const [expandedAllEqualRowIds, setExpandedAllEqualRowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleAllEqualRowExpanded = (definitionId: string) => {
    setExpandedAllEqualRowIds((current) => {
      const next = new Set(current);
      if (next.has(definitionId)) {
        next.delete(definitionId);
      } else {
        next.add(definitionId);
      }
      return next;
    });
  };

  // A running counter over pinned rows first, then every grouped row in render
  // order, precomputed once rather than mutated during JSX (pinned rows and
  // grouped rows render from two separate `.map()` calls below).
  const stripeIndexByAttributeId = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    for (const definition of pinnedDefinitions) {
      map.set(definition.id, index);
      index += 1;
    }
    for (const group of groups) {
      for (const definition of group.definitions) {
        map.set(definition.id, index);
        index += 1;
      }
    }
    return map;
  }, [pinnedDefinitions, groups]);

  return (
    <section
      data-testid="option-compare-view"
      aria-labelledby="option-compare-view-heading"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-4)]"
    >
      <h2 id="option-compare-view-heading">Compare the options</h2>

      {renderedOptions.length === 0 ? (
        <p
          data-testid="option-compare-view-empty"
          className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          Add at least one candidate to see a side-by-side comparison.
        </p>
      ) : (
        <>
          {filteredOutOptionCount > 0 ? (
            <p
              data-testid="option-compare-view-filtered-note"
              className="text-[length:var(--font-size-xs)] text-[var(--color-ink-secondary)]"
            >
              Showing {displayedOptions.length} of {options.length} options in this comparison.
              Options not shown here are not eliminated -- they're just not part of this view.
            </p>
          ) : null}

          {isHeadToHead && hiddenOptionCount > 0 ? (
            <p
              data-testid="option-compare-view-narrow-note"
              className="text-[length:var(--font-size-xs)] text-[var(--color-ink-secondary)]"
            >
              Showing a head-to-head of {renderedOptions.length} of {displayedOptions.length}{' '}
              options. Switch to expanded view or narrow the comparison to see the rest.
            </p>
          ) : null}

          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={
              isHeadToHead
                ? 'Head-to-head comparison table -- scroll horizontally if needed'
                : 'Comparison table -- scroll horizontally to see every option'
            }
          >
            <table
              data-testid="option-compare-view-table"
              data-layout={layout}
              // `table-fixed` in head-to-head, and only there. Live
              // verification at 430px found the real defect this guards
              // against: with the browser's default auto table layout, the
              // attribute-label column sizes itself to its longest label
              // ("Both dog travel crates fit behind the second row without
              // folding either seat") and measured 468px inside a 366px
              // pane -- wider than the whole viewport on its own. The page
              // itself did not scroll sideways (the wrapper's overflow-x
              // contained it correctly), so nothing failed; the user simply
              // saw a column of attribute names and had to scroll right to
              // reach a single value, which defeats the entire point of
              // head-to-head at narrow width (change-set §7). `truncate` on
              // the label was already present but inert, because truncation
              // needs a constrained width to act on. Fixed layout gives the
              // column a real bound so the two option columns are visible
              // without scrolling. Expanded layout deliberately keeps auto
              // sizing: there the table is meant to be wider than the pane
              // and scroll inside its own container.
              className={`w-full border-collapse text-left ${isHeadToHead ? 'table-fixed' : ''}`}
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className={`p-[var(--space-2)] text-[length:var(--font-size-sm)] ${
                      isHeadToHead ? 'w-[38%]' : ''
                    }`}
                  >
                    <span className="visually-hidden">Attribute</span>
                  </th>
                  {renderedOptions.map((option) => {
                    const isSelected = option.id === selectedOptionId;
                    return (
                      <th
                        key={option.id}
                        scope="col"
                        data-testid={`option-compare-view-header-${option.id}`}
                        className="p-[var(--space-2)] text-[length:var(--font-size-sm)]"
                        style={
                          isSelected
                            ? {
                                color: 'var(--color-status-ready-ink)',
                                backgroundColor: 'var(--color-status-ready-bg)',
                              }
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          data-testid={`option-compare-view-focus-${option.id}`}
                          // Toggle, not always-select: clicking the
                          // already-selected header clears the selection --
                          // see `onFocusOption`'s own doc comment above.
                          onClick={() => onFocusOption?.(isSelected ? null : option.id)}
                          aria-pressed={isSelected}
                          className="w-full min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit]"
                        >
                          {option.label}
                          {isSelected ? (
                            <span className="label-caps ml-[var(--space-1)]">Selected</span>
                          ) : null}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {pinnedDefinitions.length > 0 ? (
                <tbody data-testid="option-compare-view-pinned">
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={renderedOptions.length + 1}
                      data-testid="option-compare-view-pinned-heading"
                      className="label-caps p-[var(--space-1)] text-[var(--color-brand-strong)]"
                    >
                      Pinned
                    </th>
                  </tr>
                  {pinnedDefinitions.map((definition) => (
                    <CompareRow
                      key={definition.id}
                      definition={definition}
                      pinned
                      isStriped={(stripeIndexByAttributeId.get(definition.id) ?? 0) % 2 === 1}
                      renderedOptions={renderedOptions}
                      allEqualDisplay={allEqualDisplayByAttributeId.get(definition.id)}
                      expanded={expandedAllEqualRowIds.has(definition.id)}
                      onToggleExpanded={toggleAllEqualRowExpanded}
                    />
                  ))}
                </tbody>
              ) : null}

              {groups.map((group) => (
                <tbody key={group.id}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={renderedOptions.length + 1}
                      data-testid={`option-compare-view-group-${group.id}`}
                      className="label-caps p-[var(--space-1)] text-[var(--color-ink-secondary)]"
                    >
                      {group.label}
                    </th>
                  </tr>
                  {group.definitions.map((definition) => (
                    <CompareRow
                      key={definition.id}
                      definition={definition}
                      pinned={false}
                      isStriped={(stripeIndexByAttributeId.get(definition.id) ?? 0) % 2 === 1}
                      renderedOptions={renderedOptions}
                      allEqualDisplay={allEqualDisplayByAttributeId.get(definition.id)}
                      expanded={expandedAllEqualRowIds.has(definition.id)}
                      onToggleExpanded={toggleAllEqualRowExpanded}
                    />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
