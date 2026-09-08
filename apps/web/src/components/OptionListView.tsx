/**
 * List view (`docs/change-sets/2026-08-30-generic-decision-workspace.md` §10) -- the option view
 * that answers *"Tell me about each option."* ADR 0005 (`docs/decisions/
 * 0005-workspace-view-state-and-option-views.md`) Decision 2 states why this is a distinct
 * decision task, not a fourth cosmetic skin over the same table: Compare (§11, `OptionCompareView`)
 * answers "how do these options differ," Board (§12, `OptionBoardView`) answers "where does each
 * option currently stand," and List answers neither -- it is a self-contained card per option.
 *
 * ## The card is the prominent slice of the profile, not a summary of everything
 *
 * The original card rendered a headline price, eight identity/spec fields in a two-column grid, a
 * wrapped "standard features" line, and three stacked insight sections ("What we like" / "What to
 * watch for" / "Still researching") -- roughly 25 lines. Four of those in the expanded grid was
 * four walls of text, and in the seeded case every "watch for" line ended with the identical phrase
 * "still needs stronger evidence", so the wall carried almost no information per line. The project
 * owner's framing: "the way you have these grids setup - it's cramming a lot of information in them
 * when we should keep that focused and keep the extra detail in the profiles."
 *
 * So a card now holds exactly five things, in reading order:
 *
 *   1. the option's own label, never truncated;
 *   2. where it stands (`OptionRankBadge`) -- its position, its score, and the
 *      share of the weighting that score rests on;
 *   3. one headline stat -- the first entry `pickCardAttributeIds` returns;
 *   4. two to three more prominent facts;
 *   5. one compact signal row (`OptionCardSignals`) of counts, and a "View details" affordance.
 *
 * ## The ranking is rendered, not computed
 *
 * Item 2 is the deterministic scoreboard (`packages/core/src/scoring.ts`),
 * which until now only the recommendation consumed -- so the first question
 * a person opens the workspace with ("which of these is ahead, and how sure
 * is that?") was the one thing these cards did not answer. This component
 * calls `selectOptionRanking` and hands the result to `OptionRankBadge`;
 * every rule about what a rank may and may not claim lives there, and no
 * scoring logic of any kind lives here. The `scoreboard` prop is optional, so
 * a caller that has not wired the board renders exactly the card it had
 * before rather than an empty rank slot.
 *
 * Everything the three deleted sections used to spell out -- which attribute, what status, what
 * origin, which sources, which evidence bar it missed -- now lives in the per-option profile, which
 * has the room to explain it. The card's job is to make a person want to open that.
 *
 * ## Attribute selection is shared, not re-derived here
 *
 * `pickCardAttributeIds` (`./option-profile.ts`) picks which facts a card leads with, so the card
 * is by construction "the prominent slice of the profile" and the two cannot drift about what
 * matters. Its precedence: the pack's own `presentation.prominentAttributeIds`, then the heaviest
 * `Criterion.appliesToAttribute` weight (what the *person* said matters), then money-first plus
 * declaration order; identity attributes are excluded throughout.
 *
 * **This replaced a real shipped defect.** The deleted local `pickProminentDefinitions` read only
 * `presentation.attributeGroups[0]` at narrow width. For the shipped `car-purchase` pack that group
 * is `basics`, so a 390px card showed make / model / model year / trim / body style / drivetrain --
 * six restatements of the card's own title -- and no price at all, in the ChatGPT pane that is this
 * product's primary surface. `prominentAttributeIds` exists precisely so a pack author can say
 * which fields a card leads with independently of how the full detail view is sectioned.
 *
 * The one remaining local lever is the `prominentAttributeIds` **prop**: an explicit,
 * caller-supplied list (a WebMCP presentation tool, or a future `WorkspaceViewState.list` field)
 * still outranks everything, because it is an instruction rather than a derivation. It deliberately
 * skips the identity-attribute exclusion too -- that exclusion protects the *default* selection
 * from spending a card's budget on restatements, and has no business overriding a caller that
 * explicitly asked for a field by id.
 *
 * **Honest unknowns (§10, docs/engineering-principles.md).** A prominent attribute with no value renders "Unknown",
 * muted the same way `OptionCompareView`'s cells and `QuickPickView`'s highlight row do -- never
 * blank, never invented. A `string_list` long enough to blow out the card is capped at
 * `MAX_LIST_VALUES_SHOWN` entries plus an explicit "+N more", never silently truncated.
 *
 * **Custom (`custom.*`) fields (§26).** Rendered by `definition.label` everywhere, exactly like
 * `OptionCompareView.tsx` and `OptionBoardView.tsx` -- the raw `custom.` id is never rendered as
 * visible text, only inside `data-testid` attributes -- and carry the same subtle outlined `Custom`
 * badge (title "Added for your comparison") `OptionCompareView.tsx` uses for its comparison rows.
 *
 * **The label must never truncate.** The focus button used to carry `truncate`, which is how a
 * sibling view shipped a card titled `2022 Toyota RAV4 XLE Hyb…`. A label may wrap onto a second
 * line; it may not become an unreadable stub. There is no `truncate` anywhere on this card's
 * heading, and `OptionListView.test.tsx` asserts that directly, because this defect has shipped
 * once already.
 *
 * **Selected-state treatment (§62).** A selected card gets the same `--color-status-ready-ink`/
 * `--color-status-ready-bg` tint and inline "Selected" label `OptionCompareView`'s header cell and
 * `OptionBoardView`'s card already use, so the four views read as one family.
 *
 * **A toggle button must be able to un-press (accessibility fix).** The card's focus button
 * carries `aria-pressed={isSelected}`, which is a promise to assistive technology that the button
 * toggles. Before this fix the click handler always called `onFocusOption(option.id)`, so a card
 * could be pressed but never un-pressed -- a real dead end (there was no way to clear the
 * selection) and an honest `aria-pressed` lie (the control could not do what its own ARIA state
 * claimed). The handler now passes `null` -- "clear the selection"
 * (`FocusOptionInputSchema.optionId`'s own doc comment, `packages/contracts/src/commands.ts`) --
 * when the clicked card is already selected, and the option's real id otherwise, so the button's
 * pressed state and its actual toggle behavior finally agree.
 *
 * **Purely presentational.** No fetching, no context, no command dispatch -- every input is a
 * caller-supplied projection, and `onFocusOption`/`onOpenProfile` only report intent. A card never
 * appends a `CaseEvent`, advances `eventSequence`, or touches a `Criterion`; it reads `criteria`
 * solely to rank which attributes matter (change-set §54 / ADR 0005 #1).
 *
 * **Narrow vs. expanded (§7, ADR 0005 Decision 4).** `layout` is a caller-supplied prop, never
 * detected here (`WorkspaceViewSwitcher` owns `useWidthMode`). Two genuinely different structures
 * follow from it, not one grid stretched by CSS:
 *   1. **Card arrangement.** Narrow stacks cards in a single column; expanded renders them in the
 *      shared responsive `.option-grid` utility (`apps/web/src/styles/global.css`), so several full
 *      cards are visible side by side -- §7's "more options visible simultaneously".
 *   2. **Prominent-fact budget.** Expanded takes one more fact per card
 *      (`MAX_CARD_ATTRIBUTES_EXPANDED`) than narrow, because it has the width to read it. Both caps
 *      are deliberately small: the point of this view is no longer density, it is focus.
 */
import { useMemo } from 'react';
import type {
  AttributeDefinition,
  Criterion,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { formatAttributeValue } from './attribute-value-format.js';
import { Badge } from '@/components/ui/badge';
import { OptionCardSignals } from './OptionCardSignals.js';
import { OptionRankBadge } from './OptionRankBadge.js';
import { pickCardAttributeIds } from './option-profile.js';
import { selectOptionRanking, type WorkspaceScoreboard } from './case-scoreboard.js';

export interface OptionListViewProps {
  options: EntityRecord[];
  attributeDefinitions: AttributeDefinition[];
  /** `CompiledDecisionPack.presentation`, or `null` if not yet available. Its `prominentAttributeIds` is the pack author's own answer to "what should a card lead with" and outranks every derived signal (see `pickCardAttributeIds`). */
  presentation: PresentationDefinition | null;
  /** The case's criteria. Read only to rank attributes by the heaviest `appliesToAttribute` weight when the pack declares no `prominentAttributeIds` -- what the person said matters is the next best signal after what the pack author said. Never mutated, never scored against. */
  criteria: Criterion[];
  selectedOptionId: string | null;
  /** Narrows which option cards render. `undefined` shows every option -- the backward-compatible default, matching `OptionCompareView`'s identical convention. */
  visibleOptionIds?: string[];
  /** Explicit caller-chosen prominent attribute ids, outranking the pack/criteria derivation for every rendered card. `undefined` or empty falls through to `pickCardAttributeIds`. See the header comment for why an explicit instruction also bypasses the identity-attribute exclusion. */
  prominentAttributeIds?: string[];
  /**
   * The deterministic scoreboard for this case (`buildWorkspaceScoreboard`).
   *
   * Optional, and `undefined` renders no ranking at all rather than an empty
   * rank slot -- a caller that has not wired the board yet gets exactly the
   * card it had before. The narrower gate ("nothing to rank") is not this
   * component's to remember either: `selectOptionRanking` returns `null` for
   * an unrankable case and `OptionRankBadge` renders `null` for that, so
   * there is one place the rule lives rather than one per view.
   *
   * Read-only, like `criteria` beside it. A card never scores anything, never
   * appends a `CaseEvent`, and never advances `eventSequence`.
   */
  scoreboard?: WorkspaceScoreboard | undefined;
  /** Caller-decided information architecture (ADR 0005 Decision 4) -- this component never calls `matchMedia` itself. */
  layout: 'narrow' | 'expanded';
  /** Fired when a user or WebMCP-driven caller focuses a card, or clears the focused card (`null`) by clicking it a second time. This component never decides focus itself -- see the header comment's "toggle button must be able to un-press" section. */
  onFocusOption: (optionId: string | null) => void;
  /** Opens the full per-option profile. Optional on purpose: when a caller has no profile surface to open, the affordance is not rendered at all -- a dead control is worse than no control. */
  onOpenProfile?: ((optionId: string) => void) | undefined;
}

const CUSTOM_ATTRIBUTE_ID_PREFIX = 'custom.';
// One headline stat plus two (narrow) or three (expanded) supporting facts.
// Deliberately far below the old 6/10: the defect being fixed was density, and
// a wider pane is a reason to show one more fact, not a licence to go back to a
// wall of specs. Anything past this belongs in the profile.
const MAX_CARD_ATTRIBUTES_NARROW = 3;
const MAX_CARD_ATTRIBUTES_EXPANDED = 4;

/** Identical check to `OptionCompareView.tsx`'s `isCustomAttributeId` -- `attributes.ts`'s `custom.` id namespace comment warns this id is otherwise "rendered directly in the generic UI" with no humanizing step (ADR 0005 Decision 6). */
function isCustomAttributeId(id: string): boolean {
  return id.startsWith(CUSTOM_ATTRIBUTE_ID_PREFIX);
}

/** Same "show everything by default, silently drop stale ids" contract as `OptionCompareView.tsx`'s `narrowOptions`. */
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
 * The bounded, ordered attribute ids one card renders.
 *
 * Only two branches, and the second is not written here: an explicit
 * caller-supplied list wins (filtered to definitions that actually apply to
 * this option's kind, so a stale id from an older pack version is skipped
 * rather than rendered as a blank row), otherwise the shared
 * `pickCardAttributeIds` decides. There is deliberately no local re-derivation
 * of pack/criteria precedence -- that lives in `./option-profile.ts` so a
 * card's facts and a profile's leading facts cannot disagree.
 */
function resolveCardAttributeIds(
  option: EntityRecord,
  attributeDefinitions: AttributeDefinition[],
  presentation: PresentationDefinition | null,
  criteria: Criterion[],
  prominentAttributeIds: string[] | undefined,
  limit: number,
): string[] {
  if (prominentAttributeIds !== undefined && prominentAttributeIds.length > 0) {
    const applicableIds = new Set(
      attributeDefinitions
        .filter((definition) => definition.appliesTo.includes(option.kind))
        .map((definition) => definition.id),
    );
    const explicit = prominentAttributeIds.filter((id) => applicableIds.has(id));
    if (explicit.length > 0) return explicit.slice(0, limit);
  }
  return pickCardAttributeIds(attributeDefinitions, presentation, criteria, option.kind, limit);
}

interface CardFact {
  definitionId: string;
  label: string;
  /** The value text actually rendered -- already capped for an over-long `string_list` (see `MAX_LIST_VALUES_SHOWN`), never the full uncapped join. */
  display: string;
  /**
   * Count of additional `string_list` entries beyond `display`'s capped preview, rendered as an
   * explicit "+N more" suffix. Zero for every non-list value and for a list at or under the cap.
   * docs/engineering-principles.md's "an unknown stays explicitly unknown; never invent a value or a placeholder"
   * extends naturally to "never silently truncate without saying so".
   */
  overflowCount: number;
  known: boolean;
  custom: boolean;
}

// A `string_list` value can run to a dozen-plus entries. Rendered in full, one fact could wrap
// across several lines and undo the entire point of the focused card.
const MAX_LIST_VALUES_SHOWN = 4;

/** Every selected attribute id becomes exactly one fact -- known values format through the shared formatter, missing values render the explicit "Unknown" string (§10, docs/engineering-principles.md), never blank or invented. A selected id with no matching definition is dropped rather than rendered as an empty row. */
function buildFacts(
  option: EntityRecord,
  attributeIds: string[],
  definitionsById: Map<string, AttributeDefinition>,
): CardFact[] {
  const facts: CardFact[] = [];
  for (const attributeId of attributeIds) {
    const definition = definitionsById.get(attributeId);
    if (definition === undefined) continue;

    const value = option.attributes[definition.id]?.value;
    const known = value !== undefined;

    let display: string;
    let overflowCount = 0;
    if (known && value.type === 'string_list' && value.values.length > MAX_LIST_VALUES_SHOWN) {
      display = value.values.slice(0, MAX_LIST_VALUES_SHOWN).join(', ');
      overflowCount = value.values.length - MAX_LIST_VALUES_SHOWN;
    } else {
      display = known ? formatAttributeValue(value) : 'Unknown';
    }

    facts.push({
      definitionId: definition.id,
      label: definition.label,
      display,
      overflowCount,
      known,
      custom: isCustomAttributeId(definition.id),
    });
  }
  return facts;
}

interface OptionListCardProps {
  option: EntityRecord;
  attributeDefinitions: AttributeDefinition[];
  presentation: PresentationDefinition | null;
  criteria: Criterion[];
  prominentAttributeIds: string[] | undefined;
  scoreboard: WorkspaceScoreboard | undefined;
  layout: 'narrow' | 'expanded';
  isSelected: boolean;
  onFocusOption: (optionId: string | null) => void;
  onOpenProfile: ((optionId: string) => void) | undefined;
}

function OptionListCard({
  option,
  attributeDefinitions,
  presentation,
  criteria,
  prominentAttributeIds,
  scoreboard,
  layout,
  isSelected,
  onFocusOption,
  onOpenProfile,
}: OptionListCardProps) {
  const definitionsById = useMemo(
    () => new Map(attributeDefinitions.map((definition) => [definition.id, definition])),
    [attributeDefinitions],
  );

  const facts = useMemo(() => {
    const limit = layout === 'expanded' ? MAX_CARD_ATTRIBUTES_EXPANDED : MAX_CARD_ATTRIBUTES_NARROW;
    const attributeIds = resolveCardAttributeIds(
      option,
      attributeDefinitions,
      presentation,
      criteria,
      prominentAttributeIds,
      limit,
    );
    return buildFacts(option, attributeIds, definitionsById);
  }, [
    option,
    attributeDefinitions,
    presentation,
    criteria,
    prominentAttributeIds,
    layout,
    definitionsById,
  ]);

  // Split, never re-select: the headline is simply the first fact in the order
  // the shared picker already returned (the pack author's own first
  // `prominentAttributeIds` entry, or the heaviest-weighted criterion's
  // attribute, or the money-first fallback). Promoting it is a layout decision
  // about facts that were already chosen, never a second selection pass.
  const [headlineFact, ...gridFacts] = facts;

  return (
    <li
      data-testid={`option-list-view-card-${option.id}`}
      data-selected={isSelected ? 'true' : 'false'}
      className="flex flex-col gap-[var(--space-2-5)] rounded-[var(--radius-md)] bg-muted p-[var(--space-3)]"
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
        data-testid={`option-list-view-focus-${option.id}`}
        // A second click on the already-selected card clears the selection
        // (`onFocusOption(null)`) instead of re-selecting it -- see the
        // header comment's "toggle button must be able to un-press" section
        // for why `aria-pressed` demanded this.
        onClick={() => onFocusOption(isSelected ? null : option.id)}
        aria-pressed={isSelected}
        // No `truncate` here, deliberately and permanently: an option's label
        // is the one thing on the card a person must be able to read in full,
        // and this product has already shipped a card titled
        // "2022 Toyota RAV4 XLE Hyb…" once. `break-words` lets a long unbroken
        // token wrap instead of forcing the card wider than the 390px pane.
        // `py-2-5` keeps the box a real >=44px touch target
        // (`--size-touch-target-min`, testing.md) without a fixed height.
        className="w-full min-w-0 cursor-pointer border-0 bg-transparent px-0 py-[var(--space-2-5)] text-left font-[family-name:var(--font-display)] text-[length:var(--font-size-md)] font-semibold break-words text-[inherit]"
      >
        {option.label}
        {isSelected ? <span className="label-caps ml-[var(--space-1)]">Selected</span> : null}
      </button>

      {/* Where this option actually stands, directly under its name.
          Deliberately BELOW the label rather than above it: this card's own
          reading order starts with "the option's own label, never
          truncated", and a block of numbers ahead of the name would bury the
          one thing that identifies the card. Everything about what it does
          and does not claim -- an unranked option is not last, a flagged
          constraint is not an elimination, a disputed measurement is not a
          settled one -- lives in `OptionRankBadge`, not here. */}
      <OptionRankBadge
        optionId={option.id}
        ranking={scoreboard === undefined ? null : selectOptionRanking(scoreboard, option.id)}
      />

      {/* The headline stat. Same testid scheme as an ordinary grid fact
          (`option-list-view-fact-{optionId}-{defId}`) -- this is still one of the pack's own
          prominent facts, only relocated and re-styled -- so a test written against a given
          attribute keeps working regardless of where on the card it lands. Typographic emphasis
          only (size/weight/display font), deliberately no status colour: design-system.md reserves
          saturated colour for the nine semantic status tokens, and a stat is a plain fact, not a
          state. */}
      {headlineFact !== undefined ? (
        <div
          data-testid={`option-list-view-fact-${option.id}-${headlineFact.definitionId}`}
          className="flex min-w-0 flex-col gap-[var(--space-0-5)]"
        >
          <span className="label-caps flex min-w-0 items-center gap-[var(--space-1)] text-[var(--color-ink-secondary)]">
            {headlineFact.label}
            {headlineFact.custom ? (
              <Badge
                variant="outline"
                data-testid={`option-list-view-fact-custom-badge-${option.id}-${headlineFact.definitionId}`}
                className="label-caps shrink-0 px-[var(--space-1)] py-0 text-[var(--color-ink-secondary)]"
                title="Added for your comparison"
              >
                Custom
              </Badge>
            ) : null}
          </span>
          <span
            className="font-[family-name:var(--font-display)] text-[length:var(--font-size-lg)] leading-[var(--line-height-tight)] font-bold break-words"
            style={{ color: headlineFact.known ? 'var(--color-ink)' : 'var(--color-ink-muted)' }}
          >
            {headlineFact.display}
            {headlineFact.overflowCount > 0 ? (
              <span
                className="text-[length:var(--font-size-sm)] font-normal"
                style={{ color: 'var(--color-ink-muted)' }}
              >{` +${headlineFact.overflowCount} more`}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* The supporting facts: a real `<dl>` -- small muted caps label (`<dt>`) stacked over an
          emphasised value (`<dd>`) -- two columns wide, so a reader scans values rather than
          parsing "Label: value" clauses. `min-w-0` on every cell keeps a long unbroken value from
          forcing the column, and therefore the card, wider than the 390px canonical viewport. */}
      {gridFacts.length > 0 ? (
        <dl
          data-testid={`option-list-view-facts-${option.id}`}
          className="m-0 grid grid-cols-2 gap-x-[var(--space-3)] gap-y-[var(--space-2)]"
        >
          {gridFacts.map((fact) => (
            <div
              key={fact.definitionId}
              data-testid={`option-list-view-fact-${option.id}-${fact.definitionId}`}
              className="flex min-w-0 flex-col gap-[var(--space-0-5)]"
            >
              {/* `items-start`, not `items-center`: the label may now wrap to
                  a second line, and a centred custom badge beside a two-line
                  label floats in the middle of it. */}
              <dt className="label-caps flex min-w-0 items-start gap-[var(--space-1)] text-[var(--color-ink-secondary)]">
                {/* No `truncate`, for the same reason the option's own label
                    above carries none: a fact's LABEL is the only thing
                    identifying which value is being shown, so clipping it
                    destroys the row's meaning while the value below it
                    remains -- "…, No" tells a reader nothing.
                    Found in the running product with the second pack, where
                    "Addresses the root cause" clipped to "Addresses the root
                    ca…" in a 202px column it missed by ten pixels. The
                    car-purchase pack simply happens to have short labels, so
                    a domain-specific card would never have surfaced this. */}
                <span className="min-w-0 break-words">{fact.label}</span>
                {fact.custom ? (
                  <Badge
                    variant="outline"
                    data-testid={`option-list-view-fact-custom-badge-${option.id}-${fact.definitionId}`}
                    className="label-caps shrink-0 px-[var(--space-1)] py-0 text-[var(--color-ink-secondary)]"
                    title="Added for your comparison"
                  >
                    Custom
                  </Badge>
                ) : null}
              </dt>
              <dd
                className="m-0 text-[length:var(--font-size-sm)] font-medium break-words"
                style={{ color: fact.known ? 'var(--color-ink)' : 'var(--color-ink-muted)' }}
              >
                {fact.display}
                {fact.overflowCount > 0 ? (
                  <span
                    className="font-normal"
                    style={{ color: 'var(--color-ink-muted)' }}
                  >{` +${fact.overflowCount} more`}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* One line of counts where three tinted sections and up to eighteen sentences used to be --
          see `OptionCardSignals`'s own header comment for why, and for the zero-count omission. */}
      <OptionCardSignals option={option} attributeDefinitions={attributeDefinitions} />

      {/* Only rendered when the caller actually has a profile surface to open. */}
      {onOpenProfile !== undefined ? (
        <button
          type="button"
          data-testid={`option-card-open-profile-${option.id}`}
          onClick={() => onOpenProfile(option.id)}
          // The accessible name names the option, so a screen-reader user
          // moving button to button through a grid of cards hears which one
          // they are on; the visible words are the first words of that name,
          // satisfying WCAG 2.5.3 "Label in Name".
          aria-label={`View details for ${option.label}`}
          // Same in-place text-link treatment `EvidenceCard.tsx`/
          // `OptionCompareView.tsx` already use for a secondary,
          // non-destructive disclosure control -- brand ink, underlined --
          // rather than a fifth button style. `min-h` keeps it a real >=44px
          // target even though its label is one short line.
          className="inline-flex min-h-[var(--size-touch-target-min)] cursor-pointer items-center self-start border-0 bg-transparent px-0 text-[length:var(--font-size-sm)] font-medium text-[var(--color-brand)] underline underline-offset-2"
        >
          View details
        </button>
      ) : null}
    </li>
  );
}

export function OptionListView({
  options,
  attributeDefinitions,
  presentation,
  criteria,
  selectedOptionId,
  visibleOptionIds,
  prominentAttributeIds,
  scoreboard,
  layout,
  onFocusOption,
  onOpenProfile,
}: OptionListViewProps) {
  const displayedOptions = useMemo(
    () => narrowOptions(options, visibleOptionIds),
    [options, visibleOptionIds],
  );

  // Narrow keeps a single stacked column. Expanded switches to the shared
  // `.option-grid` utility (`apps/web/src/styles/global.css`) -- a responsive
  // `auto-fill` grid, not a hand-rolled breakpoint here -- so several full
  // cards are visible side by side, the "more options visible simultaneously"
  // half of §7's expanded-mode brief.
  const cardsClassName =
    layout === 'expanded' ? 'option-grid' : 'flex flex-col gap-[var(--space-3)]';

  return (
    <section
      data-testid="option-list-view"
      aria-labelledby="option-list-view-heading"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-4)]"
    >
      <h2 id="option-list-view-heading">Tell me about each option</h2>

      {displayedOptions.length === 0 ? (
        <p
          data-testid="option-list-view-empty"
          className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          Add at least one candidate to see details for each option.
        </p>
      ) : (
        <ul data-testid="option-list-view-cards" data-layout={layout} className={cardsClassName}>
          {displayedOptions.map((option) => (
            <OptionListCard
              key={option.id}
              option={option}
              attributeDefinitions={attributeDefinitions}
              presentation={presentation}
              criteria={criteria}
              prominentAttributeIds={prominentAttributeIds}
              scoreboard={scoreboard}
              layout={layout}
              isSelected={option.id === selectedOptionId}
              onFocusOption={onFocusOption}
              onOpenProfile={onOpenProfile}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
