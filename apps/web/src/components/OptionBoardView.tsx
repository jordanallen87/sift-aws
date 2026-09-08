/**
 * The Board / Kanban view (docs/change-sets/2026-08-30-generic-decision-workspace.md §12) that
 * answers "Where does each option currently stand?" -- a decision-narrowing question distinct from
 * `OptionCompareView`'s "how do these options differ?" (§11) and List's "tell me about each
 * option" (§10). ADR 0005 Decision 2 states the same distinction directly: the four option views
 * are "not four cosmetic renderings of one data set" but four different decision tasks.
 *
 * Placement is entirely caller-supplied (`optionColumnIds`, a flat optionId -> columnId map)
 * rather than computed or persisted here -- this component is purely presentational (no fetching,
 * no context, no command dispatch), matching `OptionCompareView.tsx`'s contract exactly.
 * `WorkspaceViewState.board.columns[].optionIds` (packages/contracts/src/case.ts) is the eventual
 * canonical source of that placement once wired; whoever owns that wiring flattens it into this
 * simpler `optionId -> columnId` shape the same way `OptionCompareView` is handed a flat
 * `visibleOptionIds` rather than reconstructing its own narrowing.
 *
 * **Human authority (§12).** "Moving an option must preserve human authority... Do not silently
 * eliminate a candidate based solely on a model judgment." This is enforced by construction, not
 * by convention: there is no local state anywhere in this file that repositions a card. The move
 * control is fully controlled by `optionColumnIds` via props -- changing it fires
 * `onMoveOption(optionId, toColumnId)` and otherwise changes nothing on screen until the caller
 * re-renders with an updated `optionColumnIds`. That is the same "report intent, never decide"
 * shape `OptionCompareView`'s `onFocusOption` already uses.
 *
 * **"Ruled out" is a working arrangement, not a verdict.** The default `out` column's label was
 * "Out" (the change set's own wording at §12); a shopping-UX terminology pass renamed it to
 * "Ruled out" -- plain shopping-site register (row 11, shopping-ux-research.md) -- while keeping
 * the column's own `id: 'out'` unchanged (a machine contract, not visible copy). It still carries
 * a `hint` -- "Set aside for now. This is your call, not a verdict -- move it back anytime." --
 * rendered under the column heading, because §12 requires that an option here is NOT presented as
 * objectively eliminated; the more decisive-sounding label makes that reassurance hint load-bearing
 * rather than optional. A caller-supplied `columns` override may supply its own `hint` (or omit
 * one); this component never invents wording for a column it did not define itself.
 *
 * **Keyboard-accessible move control is mandatory, drag is optional (§49).** "Board changes must
 * not rely solely on drag-and-drop." This implementation does not attempt drag at all -- only a
 * native `<select>` "move to..." control per card, which is fully keyboard-operable (Tab, arrow
 * keys, type-ahead, Enter) with no bespoke keyboard handling required. A plain `<select>` was
 * chosen over the Radix-backed `Select` in `components/ui/select.tsx` deliberately: the Radix
 * control renders its options list in a portal, which is unnecessary ceremony for a short,
 * same-column list of choices, and it gives component tests a real, unflaky target
 * (`userEvent.selectOptions`) instead of simulating pointer capture inside a portal.
 * `OptionCompareView.tsx`'s focus control is likewise a plain `<button>`, not a shadcn component,
 * for the same reason -- this stays consistent with that precedent.
 *
 * **Narrow-viewport layout decision (390-480px is canonical, §7/§49).** Columns scroll inside the
 * board's own horizontally-scrolling container -- the same `overflow-x-auto`-inside-its-own-
 * `role="region"` pattern `OptionCompareView.tsx`'s table wrapper and `FindingsSheet.tsx`'s Kanban
 * tab already use -- rather than stacking columns vertically. Reasoning:
 *   1. Consistency: this repository already has two established sibling components solving
 *      exactly this problem ("no horizontal PAGE overflow" while the content itself still scrolls)
 *      the same way; a third, divergent pattern (vertical stacking) would add a needless second
 *      convention for an already-solved problem.
 *   2. A Kanban board's core value is seeing several columns' relative population at a glance --
 *      "where does each option currently stand?" (§12). Vertical stacking would hide every column
 *      but the first behind a scroll; horizontal paging at least keeps column headers visible as
 *      a scroll affordance and lets a quick swipe reveal "Favorites" next to "Ruled out".
 *   3. Each column has a fixed, modest width (well under the 390px narrow floor), so this
 *      component introduces no hard-coded width wider than the canonical narrow pane. The actual
 *      *scrolling* is real-browser layout behavior exercised by the Playwright cross-viewport
 *      suite, not something jsdom can measure -- see `narrow-viewport.tsx`'s own header comment.
 *
 * Custom (`custom.*`) attribute ids never reach visible text (the same §26 principle
 * `OptionCompareView` applies, even though board cards do not carry its "Custom" badge -- only
 * `definition.label` ever renders here); nor do raw entity or column ids -- `option.label` and
 * `column.label` render everywhere a person can read, id strings appear only inside
 * `data-testid`/`id`/`value` attributes, never as text content.
 *
 * **Card content: a headline stat, a couple of supporting facts, and a signal row.** Where List's
 * cards crammed, Board's starved -- two to four "Label: value" lines, *no headline stat at all*, and
 * a title that truncated mid-word ("2022 Toyota RAV4 XLE Hyb…"). All three are fixed here:
 *   1. **The label never truncates.** It may wrap onto a second line; it may not become an
 *      unreadable stub. This defect has shipped once already, so `OptionBoardView.test.tsx` asserts
 *      the absence of the truncation class directly rather than trusting the markup to stay put.
 *   2. **A headline stat leads the card** (`board-headline-{optionId}`) -- the first id
 *      `pickCardAttributeIds` (`./option-profile.js`) returns for this option's kind, rendered at
 *      display size with its label above it, the same identity -> stat reading order
 *      `OptionListView`'s card uses. A card that says only "where does this stand" without saying
 *      what the thing costs/rates/measures cannot support the glance §12 asks it to support.
 *   3. **A compact signal row** (`OptionCardSignals`) puts this option's strength/concern/unknown
 *      counts on the card, with a "View details" affordance to the full profile beside it -- the
 *      same row and the same affordance List uses, so the two grids stay one family.
 *
 * **Attribute selection is shared, not derived here.** `pickFacts` used to walk
 * `attributeDefinitions` in raw caller order. It now walks `pickCardAttributeIds`'s order instead --
 * pack `presentation.prominentAttributeIds` first, then heaviest `Criterion.appliesToAttribute`
 * weight, then money-first plus declaration order -- so a board card leads with the same facts a
 * list card and the option profile lead with, by construction rather than by coincidence. Identity
 * attributes (`isIdentityAttribute`) are excluded inside that shared picker, which is what keeps a
 * card titled "2022 Toyota RAV4 XLE Hybrid AWD" from spending its entire budget re-stating
 * "Make: Toyota / Model: RAV4 / Trim: XLE Hybrid AWD". `pickFacts` keeps exactly one behaviour of
 * its own: an attribute with no value on this option is skipped rather than rendered as "Unknown" --
 * a compact card favours facts that are actually known over an inventory of what is missing (List,
 * per §10, is the place for that).
 *
 * **Earlier card-hierarchy pass, still in force.** (2) Facts rendered as one flat, same-size,
 * same-color "Label: value" line with no visual
 * priority between the two halves. Each fact now splits into two `<span>`s -- the label smaller
 * (`--font-size-xs`) and in the existing muted `--color-ink-secondary` token, the value keeping the
 * card's base size but gaining `--font-weight-medium` and the full-strength `--color-ink` token --
 * the same "label small/muted, value emphasised" relationship `OptionListView.tsx`'s fact row already
 * establishes. (3) Columns were bare headings with cards floating directly on the section's own white
 * background, and the default "Out" column's `hint` paragraph stacked on top of a second, generic
 * "Nothing here yet." line whenever Out was empty -- the visual imbalance ("Out... alone carries a
 * long explanatory paragraph") the design pass called out. Columns now render as a tinted `bg-muted`
 * "bin" (`--color-surface-sunken`) so white `bg-card` option cards visibly pop out of their column --
 * the identical figure/ground relationship `tokens.css`'s own revision note already establishes at
 * the page level ("pure white cards on the tinted paper background"), applied one level in -- and an
 * empty column renders exactly one caption line (the column's own `hint` when it has one, the generic
 * "Nothing here yet." otherwise), never both stacked. None of this touches `optionColumnIds`,
 * `onMoveOption`, or the keyboard-accessible `<select>`'s markup/behavior -- see the "human authority"
 * and "Keyboard-accessible move control" sections above, both fully unchanged by this pass. Selected-
 * card styling and the "Selected" indicator now read their ink/bg pair from `STATUS_TONE_META.ready`
 * (`./activity-labels.js`) instead of hand-written `var(--color-status-ready-*)` strings -- the same
 * shared status-tone registry `RecommendationCard.tsx`/`ApprovalCard.tsx` already use for every other
 * "ready for your attention" treatment in the app, so this is one more consumer of that single
 * registry rather than a component-local duplicate of the same three values.
 *
 * **Narrow vs. expanded (§7, ADR 0005 Decision 4, product.md's "List and Board currently render one
 * layout across both width modes" gap).** `layout` is a caller-supplied prop, not something this
 * component detects itself -- the same "caller owns width detection, view stays pure" contract
 * `OptionCompareView` and `OptionListView` already use; `WorkspaceViewSwitcher` resolves it once via
 * `useWidthMode` and passes it down identically to all three. §7 names Board's expanded brief
 * directly: "larger board... more status columns visible simultaneously." Two changes follow:
 *   1. **Column layout.** Narrow keeps today's behavior exactly: fixed `w-[220px]` columns in a
 *      horizontally-scrolling flex row (`board-scroll-region`'s `overflow-x-auto`), unchanged.
 *      Expanded switches the columns to a single-row CSS grid (`repeat(N, minmax(240px, 1fr))`,
 *      `N` = the real column count) instead: each column keeps the same 240px floor so a card never
 *      gets too cramped to read, but the `1fr` share lets columns actually grow to fill whatever
 *      width the expanded pane offers, so the whole board (commonly 3-4 columns) is visible at once
 *      without scrolling on a genuinely wide viewport -- "more status columns simultaneously rather
 *      than requiring horizontal scrolling," this task's own wording. `board-scroll-region` still
 *      wraps both layouts: an unusually large custom `columns` list can still legitimately need to
 *      scroll even in expanded mode, and that is the same "scroll inside its own container, never the
 *      page" discipline this component already used, not a new exception.
 *   2. **Facts-per-card budget.** `MAX_FACTS_PER_CARD` is layout-dependent the same way
 *      `OptionListView`'s prominent-attribute cap is: narrow keeps the original 2-fact cap; expanded
 *      raises it, because the wider columns above genuinely have "room for more per card" (this
 *      task's own wording) rather than merely more whitespace around the same two facts.
 * The keyboard-operable move `<select>` is untouched by any of this -- it is not layout-conditional
 * code at all, only the surrounding column container and per-card fact budget are, so it keeps
 * working identically (same markup, same event) in both modes, matching change-set §49's "must not
 * rely solely on drag-and-drop" requirement exactly as before.
 */
import { useMemo } from 'react';
import type {
  AttributeDefinition,
  Criterion,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { formatAttributeValue } from './attribute-value-format.js';
import { STATUS_TONE_META } from './activity-labels.js';
import { OptionCardSignals } from './OptionCardSignals.js';
import { OptionRankBadge } from './OptionRankBadge.js';
import { pickCardAttributeIds } from './option-profile.js';
import { selectOptionRanking, type WorkspaceScoreboard } from './case-scoreboard.js';

export interface OptionBoardColumn {
  id: string;
  label: string;
  /** Optional short clarifying caption rendered under the column heading -- used by the default "Out" column so it reads as the user's working arrangement rather than a verdict (§12). Never invented by this component; only rendered when the caller (pack, model, or the built-in default) supplies one. */
  hint?: string;
}

export interface OptionBoardViewProps {
  options: EntityRecord[];
  attributeDefinitions: AttributeDefinition[];
  /** `CompiledDecisionPack.presentation`, or `null` if not yet available. Its `prominentAttributeIds` is the pack author's own answer to "what should a card lead with" and outranks every derived signal (see `pickCardAttributeIds`). */
  presentation: PresentationDefinition | null;
  /** The case's criteria. Read only to rank attributes by the heaviest `appliesToAttribute` weight when the pack declares no `prominentAttributeIds`. Never mutated, never scored against -- a board card is a way of looking at an option, never a change to it. */
  criteria: Criterion[];
  /** Maps optionId -> the id of the column it currently sits in. An option with no entry, or whose entry names a column id not present in the effective `columns`, falls back to the first column -- every option renders in exactly one column, never silently dropped (§12). */
  optionColumnIds: Record<string, string>;
  /** Falls back to `DEFAULT_BOARD_COLUMNS` (Comparing / Favorites / Need to check / Ruled out) when omitted or empty, per §12 "should be configurable where appropriate" -- a pack or the model may supply its own set. */
  columns?: OptionBoardColumn[];
  /** Maps optionId -> a short caller-supplied reason surfaced on its card (§12's "Dealer offer conflicts with advertised price"). Never invented here -- an option with no entry (or an empty string) renders no reason text at all. */
  reasons?: Record<string, string>;
  selectedOptionId: string | null;
  /**
   * The deterministic scoreboard for this case (`buildWorkspaceScoreboard`).
   *
   * Optional, and `undefined` renders no ranking at all rather than an empty
   * rank slot. Rendered at `compact` density here: a 220px column has no room
   * for the coverage meter, and the card already leads with a headline stat
   * that a second display-size number would compete with. Density changes how
   * much reinforcement the claim gets, never which facts appear.
   *
   * Read-only, like `criteria` above it. Where an option SITS on this board is
   * the user's working arrangement (§12); where it RANKS is arithmetic. The
   * two are deliberately independent -- a ranking never moves a card, and
   * moving a card never changes a rank.
   */
  scoreboard?: WorkspaceScoreboard | undefined;
  /** Caller-decided information architecture (ADR 0005 Decision 4) -- this component never calls `matchMedia` itself. See the header comment's "Narrow vs. expanded" section for exactly what changes at each value. */
  layout: 'narrow' | 'expanded';
  /** Reports an intended move. This component never applies the move itself -- see the header comment's "human authority" note; the caller decides whether/how to persist it. */
  onMoveOption: (optionId: string, toColumnId: string) => void;
  /** Fired when a card is focused, or `null` when the already-selected card is clicked again to clear the selection -- see `OptionListView.tsx`'s header comment's "toggle button must be able to un-press" section for why this exists. */
  onFocusOption: (optionId: string | null) => void;
  /** Opens the full per-option profile. Optional on purpose: when a caller has no profile surface to open, the affordance is not rendered at all -- a dead control is worse than no control. */
  onOpenProfile?: ((optionId: string) => void) | undefined;
}

// The TOTAL fact budget per card, headline stat included -- narrow therefore
// renders one headline plus one supporting fact, expanded one headline plus
// three. Narrow keeps the original number exactly; expanded's grid columns
// (see the header comment's "Narrow vs. expanded" section) are genuinely
// wider, so this cap is raised rather than leaving the extra room unused --
// "room for more per card".
const MAX_FACTS_PER_CARD_NARROW = 2;
const MAX_FACTS_PER_CARD_EXPANDED = 4;
// Narrow-only: expanded columns are sized by the CSS grid template built in
// the component body instead (see `columnsContainerStyle`), not this fixed
// class.
const COLUMN_WIDTH_CLASS = 'w-[220px]';

export const DEFAULT_BOARD_COLUMNS: OptionBoardColumn[] = [
  { id: 'considering', label: 'Comparing' },
  { id: 'top_choices', label: 'Favorites' },
  { id: 'need_to_verify', label: 'Need to check' },
  {
    id: 'out',
    label: 'Ruled out',
    hint: 'Set aside for now. This is your call, not a verdict -- move it back anytime.',
  },
];

interface OptionFact {
  id: string;
  label: string;
  display: string;
}

/**
 * "A couple of decision-relevant facts" (§12) -- the first `maxFacts` attributes, in the shared
 * `pickCardAttributeIds` prominence order (pack `presentation.prominentAttributeIds`, then heaviest
 * `Criterion.appliesToAttribute` weight, then money-first plus declaration order; identity
 * attributes excluded throughout), that have a defined value on this option.
 *
 * The picker is asked for every eligible id rather than just `maxFacts` of them, then this function
 * takes the first `maxFacts` that actually have a value. That ordering matters: asking for exactly
 * `maxFacts` ids would let a single unanswered high-priority attribute silently shrink the card to
 * one fact, whereas the shipped behaviour -- "walk the priority order and take the known ones" -- is
 * preserved exactly, only over a better order than raw `attributeDefinitions` sequence.
 *
 * Definitions with no value are skipped rather than shown as "Unknown": a compact card favours facts
 * that are actually known over an inventory of what is missing (List view, per §10, is the place for
 * that, and the signal row's "N unknowns" count already says how much is missing without listing
 * it). `maxFacts` is the caller's layout-dependent budget -- see the header comment's "Narrow vs.
 * expanded" section.
 */
function pickFacts(
  option: EntityRecord,
  attributeDefinitions: AttributeDefinition[],
  presentation: PresentationDefinition | null,
  criteria: Criterion[],
  maxFacts: number,
): OptionFact[] {
  const orderedIds = pickCardAttributeIds(
    attributeDefinitions,
    presentation,
    criteria,
    option.kind,
    attributeDefinitions.length,
  );
  const definitionsById = new Map(
    attributeDefinitions.map((definition) => [definition.id, definition]),
  );

  const facts: OptionFact[] = [];
  for (const attributeId of orderedIds) {
    const definition = definitionsById.get(attributeId);
    if (definition === undefined) continue;
    const record = option.attributes[definition.id];
    if (record?.value === undefined) continue;
    facts.push({
      id: definition.id,
      label: definition.label,
      display: formatAttributeValue(record.value),
    });
    if (facts.length >= maxFacts) break;
  }
  return facts;
}

/** Resolves which of `columns` (always non-empty -- callers pass the already-defaulted list) an option currently belongs to, falling back to the first column for a missing or stale (unknown-column-id) assignment. */
function resolveColumnId(
  optionId: string,
  optionColumnIds: Record<string, string>,
  columns: OptionBoardColumn[],
): string {
  const assigned = optionColumnIds[optionId];
  if (assigned !== undefined && columns.some((column) => column.id === assigned)) {
    return assigned;
  }
  return columns[0]!.id;
}

function groupOptionsByColumn(
  options: EntityRecord[],
  optionColumnIds: Record<string, string>,
  columns: OptionBoardColumn[],
): Map<string, EntityRecord[]> {
  const groups = new Map<string, EntityRecord[]>(columns.map((column) => [column.id, []]));
  for (const option of options) {
    const columnId = resolveColumnId(option.id, optionColumnIds, columns);
    groups.get(columnId)?.push(option);
  }
  return groups;
}

export function OptionBoardView({
  options,
  attributeDefinitions,
  presentation,
  criteria,
  optionColumnIds,
  columns,
  reasons,
  selectedOptionId,
  scoreboard,
  layout,
  onMoveOption,
  onFocusOption,
  onOpenProfile,
}: OptionBoardViewProps) {
  const effectiveColumns =
    columns !== undefined && columns.length > 0 ? columns : DEFAULT_BOARD_COLUMNS;

  const groupedOptions = useMemo(
    () => groupOptionsByColumn(options, optionColumnIds, effectiveColumns),
    [options, optionColumnIds, effectiveColumns],
  );

  const maxFactsPerCard =
    layout === 'expanded' ? MAX_FACTS_PER_CARD_EXPANDED : MAX_FACTS_PER_CARD_NARROW;

  // Narrow: the original horizontally-scrolling flex row of fixed-width
  // columns, untouched. Expanded: a single-row CSS grid sized to the real
  // column count, so columns grow (via `1fr`) to fill the wider pane instead
  // of staying pinned at 220px -- see the header comment's "Narrow vs.
  // expanded" section for why a plain Tailwind class can't express this (the
  // column count, and therefore the track count, is only known at render
  // time from `effectiveColumns.length`).
  const columnsContainerClassName =
    layout === 'expanded' ? 'grid gap-[var(--space-3)]' : 'flex gap-[var(--space-3)]';
  const columnsContainerStyle =
    layout === 'expanded'
      ? { gridTemplateColumns: `repeat(${effectiveColumns.length}, minmax(240px, 1fr))` }
      : undefined;
  // §12's "consistent, calm visual container" fix (see the header comment's
  // "Card visual hierarchy" section): every column now renders as a tinted
  // `bg-muted` (`--color-surface-sunken`) "bin" instead of a bare heading
  // with cards floating directly on the section's own white background --
  // white `bg-card` option cards (below) pop out of it instead of column and
  // card sharing the identical white the section already sits on.
  const columnClassName =
    layout === 'expanded'
      ? 'flex min-w-0 flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] bg-muted p-[var(--space-3)]'
      : `flex ${COLUMN_WIDTH_CLASS} shrink-0 flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] bg-muted p-[var(--space-3)]`;

  return (
    <section
      data-testid="option-board-view"
      aria-labelledby="board-heading"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-4)]"
    >
      <h2 id="board-heading">Where your options stand</h2>

      <div
        data-testid="board-scroll-region"
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Board columns -- scroll horizontally to see every column"
      >
        <div
          data-testid="board-columns"
          data-layout={layout}
          className={columnsContainerClassName}
          style={columnsContainerStyle}
        >
          {effectiveColumns.map((column) => {
            const columnOptions = groupedOptions.get(column.id) ?? [];
            return (
              <div
                key={column.id}
                data-testid={`board-column-${column.id}`}
                className={columnClassName}
              >
                <div className="flex flex-col gap-[var(--space-0-5)]">
                  <h3 className="label-caps text-[var(--color-ink-secondary)]">
                    {`${column.label} (${columnOptions.length})`}
                  </h3>
                  {column.hint !== undefined ? (
                    <p
                      data-testid={`board-column-hint-${column.id}`}
                      className="text-[length:var(--font-size-xs)] text-[var(--color-ink-secondary)]"
                    >
                      {column.hint}
                    </p>
                  ) : null}
                </div>

                {columnOptions.length === 0 ? (
                  // Consistency fix (see the header comment's "Card visual
                  // hierarchy" section): a column that already carries a
                  // `hint` (the default "Out" column's reassurance that it
                  // is "not a verdict") does NOT also stack the generic
                  // "Nothing here yet." line underneath it -- the hint
                  // already IS that column's honest explanation for
                  // emptiness, so repeating a second, generic one directly
                  // beneath it added bulk without adding information and
                  // made Out visually heavier than every other empty column.
                  // Every column's empty state is now exactly one caption
                  // line: the pack/column-supplied hint when one exists,
                  // "Nothing here yet." otherwise.
                  column.hint === undefined ? (
                    <p
                      data-testid={`board-column-empty-${column.id}`}
                      className="text-[length:var(--font-size-xs)] text-[var(--color-ink-muted)]"
                    >
                      Nothing here yet.
                    </p>
                  ) : null
                ) : (
                  <ul
                    data-testid={`board-column-list-${column.id}`}
                    className="flex flex-col gap-[var(--space-2)]"
                  >
                    {columnOptions.map((option) => {
                      const isSelected = option.id === selectedOptionId;
                      // Split, never re-select: the headline is simply the
                      // first fact `pickFacts` already returned in the shared
                      // prominence order, promoted out of the list into its own
                      // display-size callout. Nothing here widens *which*
                      // attributes appear, only where on the card one of them
                      // lands.
                      const [headlineFact, ...supportingFacts] = pickFacts(
                        option,
                        attributeDefinitions,
                        presentation,
                        criteria,
                        maxFactsPerCard,
                      );
                      const reason = reasons?.[option.id];
                      const moveSelectId = `board-move-select-${option.id}`;

                      return (
                        <li
                          key={option.id}
                          data-testid={`board-card-${option.id}`}
                          data-selected={isSelected ? 'true' : 'false'}
                          // A white `bg-card` tile inside the now-tinted
                          // `bg-muted` column (see `columnClassName` above)
                          // -- the figure/ground pairing that makes a card
                          // read as a distinct object sitting IN its column
                          // rather than floating loose. Selected still
                          // overrides ink and fill with the shared `ready`
                          // status tone via `STATUS_TONE_META` -- the same
                          // registry `RecommendationCard.tsx`/
                          // `ApprovalCard.tsx` use -- rather than the
                          // hand-written `var(--color-status-ready-*)`
                          // strings this line used before.
                          className="flex flex-col gap-[var(--space-1-5)] rounded-[var(--radius-md)] bg-card p-[var(--space-2-5)] text-[length:var(--font-size-sm)]"
                          style={
                            isSelected
                              ? {
                                  color: STATUS_TONE_META.ready.ink,
                                  backgroundColor: STATUS_TONE_META.ready.bg,
                                }
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            data-testid={`board-focus-${option.id}`}
                            // Toggle, not always-select: clicking the
                            // already-selected card clears the selection --
                            // see `onFocusOption`'s own doc comment above.
                            onClick={() => onFocusOption(isSelected ? null : option.id)}
                            aria-pressed={isSelected}
                            // `min-h-[var(--size-touch-target-min)]` keeps
                            // this row a real >=44px hit area even though
                            // its content is a single line of text -- the
                            // same "row is just text, but the tap target is
                            // still 44px via padding" contract
                            // `DisclosureSection.tsx`'s row buttons already
                            // use.
                            className="flex min-h-[var(--size-touch-target-min)] w-full min-w-0 cursor-pointer items-center gap-[var(--space-1)] border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit]"
                          >
                            {/* No `truncate`, deliberately and permanently:
                                this is the one thing on the card a person must
                                be able to read in full, and it shipped once as
                                "2022 Toyota RAV4 XLE Hyb…". `break-words` lets
                                a long unbroken token wrap rather than force the
                                column wider. */}
                            <span className="min-w-0 flex-1 font-[var(--font-weight-semibold)] break-words">
                              {option.label}
                            </span>
                            {isSelected ? (
                              <span
                                className="label-caps inline-flex shrink-0 items-center gap-[var(--space-0-5)]"
                                style={{ color: STATUS_TONE_META.ready.ink }}
                              >
                                <span aria-hidden="true">{STATUS_TONE_META.ready.icon}</span>
                                Selected
                              </span>
                            ) : null}
                          </button>

                          {/* Where this option stands, directly under its
                              name and above the headline stat -- the same
                              reading order the List card uses, so the two
                              grids stay one family. Compact density: see the
                              `scoreboard` prop's own comment. */}
                          <OptionRankBadge
                            optionId={option.id}
                            ranking={
                              scoreboard === undefined
                                ? null
                                : selectOptionRanking(scoreboard, option.id)
                            }
                            density="compact"
                          />

                          {headlineFact !== undefined ? (
                            // The headline stat the shipped card never had --
                            // label above, value at display size, so the one
                            // number a person glances for is legible without
                            // reading the card. Typographic emphasis only,
                            // never a status colour: design-system.md reserves
                            // saturated colour for the nine status tokens, and
                            // a stat is a plain fact, not a state.
                            <div
                              data-testid={`board-headline-${option.id}`}
                              className="flex min-w-0 flex-col"
                            >
                              <span className="label-caps text-[var(--color-ink-secondary)]">
                                {headlineFact.label}
                              </span>
                              <span className="font-[family-name:var(--font-display)] text-[length:var(--font-size-md)] leading-[var(--line-height-tight)] font-bold break-words text-[inherit]">
                                {headlineFact.display}
                              </span>
                            </div>
                          ) : null}

                          {supportingFacts.length > 0 ? (
                            // Label/value hierarchy fix (see the header
                            // comment): the label renders smaller and in the
                            // existing muted `--color-ink-secondary` token;
                            // the value keeps the card's base size but gains
                            // `--font-weight-medium` and the full-strength
                            // `--color-ink` token, so it visibly outranks its
                            // own label instead of both halves reading as one
                            // flat, same-weight line.
                            <ul
                              data-testid={`board-facts-${option.id}`}
                              className="flex flex-col gap-[var(--space-0-5)]"
                            >
                              {supportingFacts.map((fact) => (
                                // `break-words`, not `truncate`: a board column
                                // is only 220px, so a pack with descriptive
                                // labels ("Addresses the root cause") clips
                                // away the very words that say which value
                                // this is. Wrapping costs a line; clipping
                                // costs the meaning.
                                <li key={fact.id} className="min-w-0 break-words">
                                  <span className="text-[length:var(--font-size-xs)] text-[var(--color-ink-secondary)]">
                                    {fact.label}:
                                  </span>{' '}
                                  <span className="font-[var(--font-weight-medium)] text-[var(--color-ink)]">
                                    {fact.display}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {reason !== undefined && reason.length > 0 ? (
                            <p
                              data-testid={`board-reason-${option.id}`}
                              className="text-[length:var(--font-size-xs)] text-[var(--color-ink-secondary)]"
                            >
                              {reason}
                            </p>
                          ) : null}

                          {/* The same compact count row and the same profile
                              affordance List's cards carry -- see
                              `OptionCardSignals`'s header comment for the
                              zero-count omission rule. */}
                          <OptionCardSignals
                            option={option}
                            attributeDefinitions={attributeDefinitions}
                          />

                          {onOpenProfile !== undefined ? (
                            <button
                              type="button"
                              data-testid={`option-card-open-profile-${option.id}`}
                              onClick={() => onOpenProfile(option.id)}
                              // The accessible name names the option, so a
                              // screen-reader user moving button to button
                              // across a whole board hears which card they are
                              // on; the visible words are the first words of
                              // that name, satisfying WCAG 2.5.3 "Label in
                              // Name".
                              aria-label={`View details for ${option.label}`}
                              className="inline-flex min-h-[var(--size-touch-target-min)] cursor-pointer items-center self-start border-0 bg-transparent p-0 text-[length:var(--font-size-xs)] font-[var(--font-weight-medium)] text-[var(--color-brand)] underline underline-offset-2"
                            >
                              View details
                            </button>
                          ) : null}

                          <div className="flex flex-col gap-[var(--space-0-5)]">
                            <label htmlFor={moveSelectId} className="visually-hidden">
                              {`Move ${option.label} to a different column`}
                            </label>
                            <select
                              id={moveSelectId}
                              data-testid={`board-move-${option.id}`}
                              value={resolveColumnId(option.id, optionColumnIds, effectiveColumns)}
                              onChange={(event) => onMoveOption(option.id, event.target.value)}
                              // `bg-muted` (not `bg-card`): the same "a field
                              // reads as editable via a distinct muted fill
                              // against the white card it sits on" contract
                              // `ui/input.tsx`/`ui/select.tsx` already use --
                              // now load-bearing here too, since the card
                              // itself switched from `bg-muted` to `bg-card`
                              // above and a `bg-card` select would otherwise
                              // sit flush, invisible, against it (the global
                              // reset in `global.css` deliberately strips
                              // every native `<select>` border).
                              className="min-h-[var(--size-touch-target-min)] rounded-[var(--radius-sm)] bg-muted px-[var(--space-1)] py-[var(--space-0-5)] text-[length:var(--font-size-xs)]"
                            >
                              {effectiveColumns.map((targetColumn) => (
                                <option key={targetColumn.id} value={targetColumn.id}>
                                  {targetColumn.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
