/**
 * The persistent top app bar for the generic decision workspace.
 *
 * Origin: the project owner's own review of the shipped workspace singled
 * out the bottom-of-page disclosure row as the concrete defect this
 * component fixes -- "These bottom sections should be at the top, but not
 * in this format. Buttons, icon buttons, alerts, etc. For example, if it
 * finds things, wouldn't we want to surface that at the top and stand out
 * so the user clicks on it? Right now you've got it at the bottom -- they'll
 * never even see it... You literally just crammed everything into a
 * collapsible section." Before this component, "What Sift found," "Add
 * something Sift should check," case identity, and case controls were five
 * visually identical `DisclosureSection` rows at the very end of the page --
 * a write action, a create action, and a findings count buried at exactly
 * the point a user is least likely to keep scrolling. This component and
 * its sibling `WorkspaceAlertBanner` are the fix: real, differentiated,
 * always-visible chrome pinned to the top of both the narrow pane and the
 * expanded "shopping site" web-app view (the same owner direction: "this is
 * supposed to have a web app view too... It's supposed to emulate a
 * shopping website at full width").
 *
 * This component is purely presentational (no data fetching, no context,
 * no command dispatch) -- it owns no state and calls nothing but the
 * callback props it is given, exactly like `CaseHeader.tsx`, whose
 * title/connection-status/developer-view/reset-demo responsibilities it
 * supersedes as the primary top-of-page chrome. `CaseHeader.tsx` itself is
 * deliberately left untouched by this task -- the integrating orchestrator
 * (not this file) decides whether/when `App.tsx` swaps one for the other,
 * so every `data-testid` here is prefixed `workspace-app-bar-`, distinct
 * from `case-header-*`, so the two can coexist without collision during
 * that transition.
 *
 * Two responsibilities beyond the old header's three (title, connection,
 * reset/dev-view):
 *
 * - **"Add option"** and **"Findings N"** move from bottom-of-page write/
 *   read actions to top-of-page, always-visible controls with real visual
 *   weight -- directly answering the owner's "add action at the top" and
 *   "stand out so the user clicks on it" requests. `findingsCount` renders
 *   as a real `Badge` chip at every count (never conditionally hidden), but
 *   is deliberately de-emphasised at `0` (ghost/muted) and given the
 *   `accepted-uncertainty` status tint the moment there is something to
 *   review, matching `docs/design-system.md`'s own grouping of "states that
 *   need attention" as `blocked`, `accepted-uncertainty`, `ready` --
 *   `accepted-uncertainty` (ochre) reads as "notice this" without
 *   `blocked`'s specific "stuck on a human" meaning or `ready`'s
 *   already-claimed "awaiting your approval" meaning (`ApprovalCard.tsx`).
 * - **`optionCount`** renders as a compact secondary line beside the
 *   connection badge -- the same "compact status summary" idea
 *   `docs/specs/product.md` §59's Case identity region describes ("4
 *   vehicles · Comparing · 2 things need attention"), which the shipped
 *   `CaseHeader` never actually implemented (its own header comment records
 *   that gap explicitly). It is not in the task's approved ASCII sketch, but
 *   is a required prop; this is the smallest addition consistent with that
 *   sketch rather than a bolted-on extra region.
 *
 * `layout` is an explicit caller-supplied prop, never computed here via
 * `matchMedia` -- the same discipline `OptionCompareView.tsx`/
 * `OptionListView.tsx`/`OptionBoardView.tsx` already established ("this
 * component never calls matchMedia itself... that mechanism... belongs to
 * the caller that owns `WorkspaceViewState`, not to this presentational
 * leaf"). The narrow/expanded split changes concrete rendering, not just
 * CSS: at `expanded` every control that has room gets a real label; at
 * `narrow` "Add option," "Findings," and "Reset demo" collapse to icon-only
 * buttons (still real, un-hidden, >=44px controls, per
 * `docs/design-system.md`'s touch-target section) because five fully
 * labelled controls cannot fit a 390px row without wrapping into a second
 * line that would itself compete with the page below it. "Developer view"
 * and Help stay icon-only at every width -- exactly how the approved
 * sketch renders them (`[?] [>_]`) even in its "expanded" example, and
 * exactly how `CaseHeader.tsx` already treats both today.
 *
 * The connection-status treatment (dot + pill, `active` tone for
 * live/reconnecting with a pulse while reconnecting, `error` tone for
 * offline) is a deliberate visual match for `CaseHeader.tsx`'s own
 * `CONNECTION_META`, re-expressed through `STATUS_TONE_META`
 * (`activity-labels.ts`) rather than inlined `var(--color-status-*)`
 * strings, per this task's explicit instruction to follow the
 * `STATUS_TONE_META` pattern `RecommendationCard.tsx`/`ApprovalCard.tsx`
 * already use. `connectionState` intentionally omits `CaseHeader`'s
 * `'polling'` value -- the task's own prop contract specifies exactly
 * `'live' | 'reconnecting' | 'offline'`, and this component has no polling-
 * specific affordance to attach a fourth state to.
 *
 * Help is not a callback prop: `<HelpButton />` is already a fully
 * self-contained, prop-less control (its own trigger button plus its own
 * uncontrolled `Sheet`, per `HelpButton.tsx`'s header comment) reused
 * verbatim from `CaseHeader.tsx`'s identical usage, rather than re-built or
 * threaded through a new `onOpenHelp` callback this component's approved
 * prop list never asked for.
 *
 * ---
 *
 * **Post-ship visual repair (owner click-through at 430px width) -- three
 * fixes, all inside this file, no prop-contract change:**
 *
 * 1. **Findings badge attachment.** The narrow-layout Findings control used
 *    to render its count as an `absolute -top-1 -right-1` corner overlay on
 *    a `size="icon"` ghost button. That is a standard "notification badge"
 *    pattern, and the box math was correct (measured live: the badge's
 *    bottom edge lands almost exactly at the search icon's top edge), but
 *    it reads as detached anyway, because a ghost button has no visible
 *    fill/boundary and its 16px icon glyph is centered inside a 44px hit
 *    box -- the badge ends up floating in that invisible padding "dead
 *    zone" above and right of the glyph, nowhere near anything the eye
 *    reads as "the control." There is nothing to visually attach *to*.
 *    Fixed by dropping the absolute overlay entirely and laying the count
 *    out **inline**, in normal flex flow, directly beside the icon --
 *    exactly the "inline count beside the icon" alternative this task's
 *    brief names, and exactly the technique the *expanded*-layout badge
 *    already used correctly (that one was never broken). The control is no
 *    longer forced into a fixed square (`size="icon"`); it is sized by its
 *    own content (icon + gap + count chip) with only a touch-target *floor*
 *    (`TOUCH_TARGET`, not `TOUCH_TARGET_ICON`'s added `min-w`), so the count
 *    is always physically touching the icon it belongs to, at every width,
 *    by construction rather than by offset arithmetic against invisible
 *    padding.
 * 2. **Narrow toolbar decoding load.** Five undifferentiated icon buttons in
 *    a row forces a reader to inspect each glyph to find the two that
 *    matter. The row is now two explicit visual clusters separated by a
 *    `Separator` (docs/design-system.md's existing divider primitive, not a
 *    new one): **primary** (Add option, Findings -- unchanged strength:
 *    filled/tinted, full 44px icon box) and **secondary** (Help, Developer
 *    view, Reset demo -- all recede together: smaller glyphs, `icon-sm`
 *    visual footprint still floored at the same 44px hit area via
 *    `TOUCH_TARGET_ICON`, muted ink). The task's own defect description
 *    names Help and Developer view as "secondary" by example, not as an
 *    exhaustive pair; Reset demo is exactly as non-primary (a demo/utility
 *    control, not a shopping action) and was previously the visually
 *    *loudest* element in the row (`variant="secondary"`, a filled chip) --
 *    leaving it out of the recede treatment would trade "five
 *    undifferentiated icons" for "one accidentally-loudest icon," not fix
 *    the crowding. `HelpButton` cannot be resized from here (it is a
 *    separate, prop-less, self-contained component -- see above), but it
 *    was already ghost/muted at `size-5`, i.e. already visually consistent
 *    with the other two once they recede to match. No capability moves
 *    behind a menu or becomes harder to reach (ADR 0008): every control
 *    stays a direct, always-mounted, single-click target in both layouts;
 *    only relative visual weight changes. Grouping (not hiding) is the
 *    chosen fix because a real overflow menu would need a new interactive
 *    disclosure primitive this task's file-ownership boundary does not
 *    include, and would force every currently-flat `getByTestId(...)`
 *    assertion in the sibling test file into an "open the menu first" shape
 *    for no behavioural gain -- the crowding complaint is about *visual*
 *    differentiation, which grouping solves directly.
 * 3. **`reconnecting` pill prominence.** `CaseHeader.tsx` (the component
 *    this one supersedes) already draws the correct distinction, and
 *    docs/design-system.md §"reconnecting / replaying / polling fallback"
 *    already documents it: a genuinely-transient reconnect attempt gets the
 *    loud `active` tone with a pulse; a settled **polling fallback** --
 *    still delivering real data, nothing broken -- gets the calm, muted
 *    `open` tone with no animation. This component's prop contract
 *    (`'live' | 'reconnecting' | 'offline'`, per this task's locked
 *    interface) has no fourth `'polling'` value to carry that distinction,
 *    so every non-live, non-offline moment -- including a long-settled,
 *    perfectly healthy polling fallback -- arrived here as `'reconnecting'`
 *    and, before this fix, was rendered with the loud, perpetually-pulsing
 *    `active` treatment forever. An animation that claims "actively
 *    retrying right now" and never resolves is not an honest signal, and a
 *    shopping site does not need alarm-toned chrome for "still getting you
 *    data, just not over the fastest channel." `reconnecting` now renders
 *    with the same calm `open` tone and no pulse that design-system.md
 *    already assigns to polling fallback specifically -- the signal is
 *    never hidden (the pill and its "Reconnecting…" label still render,
 *    unconditionally, exactly like every other state), it is only no
 *    longer overstated. See `docs/build-log.md`'s dated entry for the
 *    upstream finding (confirmed live against the running dev server) that
 *    the real, five-state connection hook this maps from is otherwise
 *    reporting the truth -- `App.tsx`'s own `mapAppBarConnectionState` is
 *    not a bug, so this fix is entirely a rendering-prominence change
 *    inside this file, not a prop or caller change.
 *
 * ---
 *
 * **Second post-ship repair: "Add option" becomes a create MENU.**
 *
 * The project owner's follow-up review made two related complaints. First,
 * about the two remaining create surfaces: "Add a note and add a question
 * should be in either the header or footer toolbars -- not at the bottom of
 * the stack." Both were still `DisclosureSection` rows at the very end of the
 * narrow content column, which is the exact defect this component was built
 * to fix for "Add option" and "What Sift found"; they were simply not in the
 * original fix's scope. Second, about this row itself: "The header is
 * consuming more space than it needs to. Need to see if we can figure out
 * how to get all of this into one row. I think it's possible by using things
 * like menus."
 *
 * Those two pull in opposite directions -- three create actions cannot each
 * take a slot in a row that is already tight at 390px -- and a menu is what
 * resolves them, which is also what was asked for by name. The single "Add
 * option" button is now a `DropdownMenu` trigger ("Add or adjust") over
 * three items: **Add option**, **Add a note**, and **Add a question**. Each
 * item calls a plain callback prop, exactly as the button did; this component
 * still owns no state and still fetches nothing. The pane gets *shorter*
 * (two bottom-of-stack disclosure rows deleted) while the header grows by
 * nothing at all -- the trigger occupies the same slot the old button did.
 *
 * This is not a reversal of fix 2's decision above ("Grouping (not hiding) is
 * the chosen fix... a real overflow menu would need a new interactive
 * disclosure primitive this task's file-ownership boundary does not
 * include"). That decision was about *secondary* controls whose problem was
 * purely visual differentiation, and it stands -- Help, Developer view and
 * Reset demo are still flat, always-mounted, single-click targets. This menu
 * groups the three *create* actions, which is a different problem (there is
 * genuinely no room for three), and the primitive it needs now exists:
 * `ui/dropdown-menu.tsx`, whose own header comment carries the accessibility
 * contract in full.
 *
 * ADR 0008's "every capability must be reachable in both [modes]" is met by
 * construction rather than by a layout branch: the trigger renders in both
 * layouts (labelled "Add" at expanded, icon-only with a tooltip at narrow,
 * exactly like the button it replaces) and holds the same three items at
 * every width. Nothing became wide-only, nothing became pointer-only --
 * Radix supplies arrow keys, typeahead, Enter/Space and Escape-restores-
 * focus, all asserted behaviourally in the sibling test file rather than
 * assumed.
 *
 * ---
 *
 * **Third post-ship repair: tooltips say what a control DOES, not just its
 * name -- and now show at every width.**
 *
 * The project owner, watching the bar run live: "we need to have tooltips in
 * a lot of places... hovering over them -- I'd want to know what each does."
 * The gap was real but not "missing tooltips" -- every control already had
 * one (the erstwhile `GlyphTooltip`, narrow-only). The actual defect was that
 * a tooltip's text was always the control's `aria-label` *verbatim* -- e.g.
 * "Findings, 0" -- which names the control but never says what a "finding"
 * IS or what clicking it shows a first-time viewer (a hackathon judge with no
 * prior context). Repeating the name back to someone who is already reading
 * it is not an answer to "what does this do."
 *
 * `ControlTooltip` (renamed from `GlyphTooltip` -- see below) fixes this by
 * adding a short, plain-language DESCRIPTION as a second line, while leaving
 * every control's accessible NAME completely untouched:
 *
 * - The `aria-label` on every wrapped `<Button>` is byte-for-byte identical
 *   to what it was before this repair. WCAG 2.5.3 ("Label in Name") and this
 *   file's own established convention -- the tooltip's first line is the
 *   name verbatim, so voice control and the visible label can never drift --
 *   both hold exactly as they did.
 * - The description is NOT a second accessible name (that would risk two
 *   different "names" reaching two different users, which is the thing
 *   2.5.3 exists to prevent). It reaches assistive tech the same way
 *   `ui/tooltip.tsx`'s header comment already documents Radix wiring every
 *   tooltip: `aria-describedby`, and only `aria-describedby`, pointed at the
 *   (visible, hover/focus-gated) `TooltipContent` -- never `aria-labelledby`.
 *   Nothing new was built for this; it is the primitive's existing, audited
 *   behaviour, now carrying one more line of real content.
 * - The two lines are rendered as a single joined string (`` `${label}\n
 *   ${description}` ``, `whitespace-pre-line` to keep the visual break) --
 *   NOT as two separate sibling elements. That is not a style preference:
 *   probed directly against this app's real `toHaveAccessibleDescription`
 *   stack (`dom-accessibility-api`, the same engine `jest-dom` uses), two
 *   adjacent `<span>`s with no literal character between them compute to a
 *   description with NO space -- `"Findings, 0Things Sift flagged..."` --
 *   because nothing in the DOM subtree actually contains a space character
 *   for the flattening algorithm to find. A real newline character is a real
 *   character every implementation preserves (and every screen reader reads
 *   as a pause), so it is the one join that is correct by construction
 *   rather than by browser accident.
 *
 * **Tooltips are now unconditional -- `enabled` is gone.** The old
 * `enabled={!isExpanded}` gate existed because at expanded width the name
 * was already visible as text, and a tooltip that only repeated that name
 * was pure noise. That reasoning no longer covers the whole tooltip: the
 * DESCRIPTION line is new information nowhere else on the page shows, at
 * *any* width, so suppressing the tooltip at expanded width would hide the
 * one thing this repair exists to add. The name line stays in the content at
 * every width too, rather than branching the tooltip's shape on `isExpanded`
 * -- one unconditional two-line format for every control is simpler to
 * reason about and test than a format that silently changes shape depending
 * on layout, and at narrow width (no visible text at all) that first line is
 * still load-bearing exactly as it always was.
 *
 * This does knowingly reintroduce, at expanded width only, the exact
 * "repeats a label already on screen" redundancy the narrow/expanded gate
 * was built to avoid -- e.g. hovering the visibly-labelled "Findings"
 * button now also shows "Findings, 0" as the tooltip's first line. That
 * redundancy is judged acceptable now for two reasons the original gate did
 * not have to weigh: it buys a single content shape instead of two (less
 * code, less to keep in sync), and it is genuinely minor -- one short,
 * already-visible word repeated once, ahead of a full new sentence of actual
 * information. `WorkspaceAppBar.test.tsx`'s old "does not repeat a label the
 * expanded row already shows" test asserted the opposite of this new,
 * deliberate behaviour and has been rewritten (see that file) rather than
 * quietly weakened -- it now asserts the tooltip both appears at expanded
 * width AND carries the new description, which is the actual contract this
 * repair establishes.
 *
 * **Reset demo's copy is behaviour, not guesswork.** `App.tsx`'s
 * `handleResetDemo` calls `commands.startDemo({ demoId })` with the *current*
 * case's own pack id and, on success, swaps `activeCaseId` to the freshly
 * returned case -- it does not confirm, and it does not offer any path back
 * to the case that was just replaced (`docs/build-log.md`'s own dated entry:
 * "'Reset demo' restarts the same pack"). So `RESET_DEMO_DESCRIPTION` says
 * exactly that: nothing here survives the click, and the click itself is not
 * gated behind a confirmation this component could point to instead.
 *
 * **Rename: `GlyphTooltip` -> `ControlTooltip`.** The old name and its own
 * header comment specifically justified narrow-only wrapping by naming the
 * case it existed for -- "a control that is currently rendering as a bare
 * glyph." That justification is gone now that every control in this row is
 * wrapped at every width, glyph or not, so the name describing *when* it
 * applied would have gone stale the moment `enabled` did. `ControlTooltip`
 * names what it actually does now: attaches a name+description tooltip to
 * any control, unconditionally.
 */
import type { Ref } from 'react';
import type { PackCompliance } from '@sift/contracts';
import {
  ChevronDownIcon,
  CircleQuestionMarkIcon,
  LibraryIcon,
  NotebookPenIcon,
  PlusIcon,
  ArrowLeftIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  SlidersHorizontalIcon,
  TerminalIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpButton } from './HelpButton.js';
import { STATUS_TONE_META, type StatusTone } from './activity-labels.js';

export type WorkspaceAppBarConnectionState = 'live' | 'reconnecting' | 'offline';

export interface WorkspaceAppBarProps {
  title: string;
  connectionState: WorkspaceAppBarConnectionState;
  /** Real, current count -- always rendered as a badge, including `0` (de-emphasised, never hidden; see header comment). */
  findingsCount: number;
  /** Opens the case's reference library. Optional: a caller that has not wired it renders no control rather than a dead one. */
  onOpenReferenceLibrary?: (() => void) | undefined;
  /** How many sources the case holds, shown so the control reports something real rather than an unexplained icon. */
  referenceCount?: number | undefined;
  /** Real, current option count, rendered as the compact secondary status line beside the connection badge. */
  optionCount: number;
  /** The create menu's first item. Same contract as the button it replaces: open the caller's "add an option" surface. */
  onAddOption: () => void;
  /** The create menu's second item -- opens the caller's "add a note" surface (formerly a bottom-of-stack disclosure row). */
  onAddNote: () => void;
  /** The create menu's third item -- opens the caller's "add a question" surface (formerly a bottom-of-stack disclosure row). */
  onAddConcern: () => void;
  /**
   * Opens the weights surface. Optional, and rendered as nothing rather
   * than as a disabled control when a caller has not wired it -- the same
   * rule `onOpenReferenceLibrary` follows.
   *
   * It lives in the bar rather than in `WorkspaceSidebar`'s Priorities
   * region because the sidebar does not render at all in the narrow pane,
   * and the narrow pane is where this product is actually used.
   */
  onAdjustPriorities?: (() => void) | undefined;
  /** Returns to the demo launcher so a different decision can be started. Omitted (and the item unrendered) when there is nowhere to go back to. */
  onSwitchDecision?: (() => void) | undefined;
  onReviewFindings: () => void;
  onOpenDeveloperView: () => void;
  /** Omitted entirely (not merely disabled) when the caller has no reset affordance to offer -- matches `docs/specs/product.md`'s "Empty regions" rule against rendering a control with nothing behind it. */
  onResetDemo?: () => void;
  /** True while a reset-demo command is in flight; disables and relabels the reset control. Meaningless (ignored) when `onResetDemo` is not supplied. */
  resetPending?: boolean;
  /**
   * Optional handle on the Help control's own button, forwarded straight to
   * `HelpButton`. `App.tsx` passes it so `FirstRunGuide` -- a dialog that
   * opens on its own, with no trigger for Radix to restore focus to -- can
   * hand focus back to the one control that reopens the same content. Every
   * other prop here is behaviour this bar owns; this one is a pass-through,
   * so the bar neither reads nor reacts to it.
   */
  helpButtonRef?: Ref<HTMLButtonElement>;
  /**
   * The active case's declared compliance content, forwarded straight to
   * `HelpButton` (and from there to `HowSiftWorksContent`). Optional and
   * omitted-safe: `App.tsx` is the only caller that can supply it (it alone
   * computes `activePack` from the live case + installed pack list), and a
   * caller with nothing to pass produces a Help sheet with no "What gets
   * checked" section rather than an empty one -- see
   * `HowSiftWorksContentProps.compliance`'s own doc comment for the full
   * "render nothing" reasoning.
   */
  compliance?: PackCompliance | null | undefined;
  layout: 'narrow' | 'expanded';
}

/**
 * Connection-state -> label/tone/pulse. Mirrors `CaseHeader.tsx`'s
 * `CONNECTION_META` for `live`/`offline`, but deliberately *diverges* from
 * `CaseHeader`'s `reconnecting` entry (see this file's header comment, fix
 * 3): `CaseHeader` has a real fourth `'polling'` state to carry "settled,
 * healthy fallback" separately from "actively retrying," so it can afford
 * to give `reconnecting` the loud, pulsing `active` treatment. This
 * component's locked three-state prop contract collapses both meanings onto
 * `reconnecting`, so `reconnecting` here uses `open` -- design-system.md's
 * own documented tone for the *polling-fallback* case specifically -- with
 * no pulse, because that is the calmer, still-true-either-way reading:
 * "not on the fastest channel," not "something is actively wrong."
 */
const CONNECTION_META: Record<
  WorkspaceAppBarConnectionState,
  { label: string; tone: StatusTone; pulse: boolean }
> = {
  live: { label: 'Live', tone: 'active', pulse: false },
  reconnecting: { label: 'Reconnecting…', tone: 'open', pulse: false },
  offline: { label: 'Offline', tone: 'error', pulse: false },
};

/** Shared >=44px CSS-pixel hit area (`docs/design-system.md`'s touch-target section, backed by `--size-touch-target-min`) -- applied to every actionable control below regardless of its visual size. */
const TOUCH_TARGET = 'min-h-[var(--size-touch-target-min)]';
const TOUCH_TARGET_ICON = `${TOUCH_TARGET} min-w-[var(--size-touch-target-min)]`;

/**
 * The create menu trigger's accessible name, and (at narrow width) its
 * tooltip. Deliberately longer than its visible "Add" label: an icon-only
 * `+` announced as just "Add" tells a screen-reader or voice-control user
 * nothing about what gets added, and WCAG 2.5.3 ("Label in Name") only
 * requires the visible text to be CONTAINED in the accessible name, which
 * "Add" is.
 */
const CREATE_MENU_LABEL = 'Add or adjust';
const PRIORITIES_LABEL = 'Adjust priorities';
const SWITCH_DECISION_LABEL = 'Start a different decision';

/**
 * Tooltip DESCRIPTIONS (second line, plain-language, second person) -- see
 * this file's header comment, "Third post-ship repair," for the accessible-
 * name/description split these pair with, and for why `Reset demo`'s copy in
 * particular is grounded in `App.tsx`'s real `handleResetDemo` behaviour
 * rather than assumed.
 *
 * Voice follows `activity-labels.ts`'s established rule: plain, concrete,
 * non-jargon words a first-time viewer (a hackathon judge with zero prior
 * context) already knows -- never "obligation," "disposition," "readiness,"
 * or an evidence-level code, and never the raw mechanism ("command," "run")
 * where a plain-English effect says the same thing.
 */
const CREATE_MENU_DESCRIPTION =
  'Add an option, a note, or a question — or change how much each factor matters to you.';
const FINDINGS_DESCRIPTION = 'Things Sift flagged that need a second look from you.';
const REFERENCES_DESCRIPTION = 'The sources behind what Sift found.';
const DEVELOPER_VIEW_DESCRIPTION = 'The raw, step-by-step timeline of everything Sift did.';
/**
 * Grounded in `App.tsx`'s real `handleResetDemo`, not guessed: it calls
 * `commands.startDemo({ demoId })` for the case's own pack and swaps
 * `activeCaseId` to the new case the moment that resolves -- no confirmation
 * step exists anywhere in that path, and there is no control anywhere in
 * this product that can bring back the case that was just replaced.
 */
const RESET_DEMO_DESCRIPTION =
  "Starts this demo over from scratch — nothing here is saved, and you can't undo it.";

/**
 * Attaches a name+description tooltip to any control in this row,
 * unconditionally, at every width -- see this file's header comment ("Third
 * post-ship repair") for why the earlier narrow-only `enabled` gate (and
 * this helper's earlier name, `GlyphTooltip`) no longer fit once tooltips
 * started carrying a second line of information nowhere else on the page
 * shows.
 *
 * `label` is deliberately the control's `aria-label` verbatim, per
 * `ui/tooltip.tsx`'s own convention: the two can then never drift, and a
 * voice-control user can say the words they see (WCAG 2.5.3, "Label in
 * Name"). `description` is genuinely new information, never a name --
 * it reaches assistive tech through the same, unmodified `aria-describedby`
 * wiring `ui/tooltip.tsx`'s header comment already documents Radix providing
 * (never `aria-labelledby`), so it can never be mistaken for a second name.
 * Nothing below depends on the tooltip opening at all: every wrapped control
 * already carries a real accessible name on its own and stays fully usable
 * with this wrapper deleted, exactly as `ui/tooltip.tsx` requires.
 *
 * The two lines join as ONE string with a real `\n`, not as two sibling
 * elements -- verified against this app's own `toHaveAccessibleDescription`
 * stack that two adjacent nodes with no literal character between them
 * compute to a description with no space at all (`"NameDescription"`), so a
 * plain string join is the one technique that is correct by construction
 * rather than by browser accident. `whitespace-pre-line` is what turns that
 * one real newline back into the visible second line.
 *
 * `side="bottom"` for the same reason `HelpButton` uses it: this is the top
 * row of the pane, so a top-side panel would only be flipped by collision
 * handling anyway.
 */
function ControlTooltip({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description: string;
  readonly children: React.ReactElement;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="whitespace-pre-line">
        {`${label}\n${description}`}
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceAppBar({
  title,
  connectionState,
  findingsCount,
  onOpenReferenceLibrary,
  referenceCount = 0,
  optionCount,
  onAddOption,
  onAddNote,
  onAddConcern,
  onAdjustPriorities,
  onSwitchDecision,
  onReviewFindings,
  onOpenDeveloperView,
  onResetDemo,
  resetPending = false,
  helpButtonRef,
  compliance,
  layout,
}: WorkspaceAppBarProps) {
  const connection = CONNECTION_META[connectionState];
  const connectionMeta = STATUS_TONE_META[connection.tone];
  const isExpanded = layout === 'expanded';

  const hasFindings = findingsCount > 0;
  // See header comment: `accepted-uncertainty` is this component's chosen
  // "needs your attention" tint the moment there is something to review;
  // `neutral` (the same muted/subtle pairing `activity-labels.ts` reserves
  // for "nothing has happened yet") is the de-emphasised zero-count state --
  // still a real, clickable control, never removed from the row.
  const findingsMeta = STATUS_TONE_META[hasFindings ? 'accepted-uncertainty' : 'neutral'];

  return (
    <header
      data-testid="workspace-app-bar"
      data-layout={layout}
      // `--z-sticky`/`--shadow-soft` are tokens.css's own named-for-this
      // purpose values ("case header, primary action bar" / "sticky
      // header/action bar" respectively) -- this is the first component to
      // actually claim that intended role. Sticky positioning is the
      // literal mechanism for "these should be at the top" staying true
      // even after the user has scrolled the workspace body below it.
      className="sticky top-0 z-[var(--z-sticky)] flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-3)] shadow-[var(--shadow-soft)]"
    >
      <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
        {/* The symbol, beside the case title, as the workspace's only
            persistent statement of whose software this is. Sift's canonical
            surface is a pane docked inside somebody else's product, where
            there is no browser chrome, no tab strip and no page header to
            supply that -- the case title names the decision, and nothing
            names the tool.

            Measured before it was added rather than after, because this row
            is genuinely tight (see fix 2 above). At 390px the bar already
            wraps into two rows -- identity above, toolbar below -- and the
            identity row uses 156 of the 358px available to it. A 24px mark
            plus a `--space-2` gap grows that row to ~188px and leaves the
            bar's height, the toolbar's row and the title's own truncation
            point unchanged; nothing moves and no control loses its place.

            `shrink-0` next to the title's existing `min-w-0 truncate` is
            what keeps that true for a long title: the title absorbs the
            squeeze by truncating, exactly as it does today, instead of
            crushing the mark.

            The one-colour `sift-mark.svg` (`symbol-green`), not the
            multi-tone `symbol-primary`, and not `symbol-core`:
            docs/brand/BRAND-GUIDE.md "Small sizes" calls for the one-colour
            symbol below ~48px, and `symbol-core-*` -- which the same section
            recommends below ~64px -- turns out to be a single-path master
            that renders as a bare crescent rather than a legible S, so it is
            not usable in the product as exported. 24px (`--space-6`) is
            where the particle field was still reading cleanly when the
            variants were rendered and inspected side by side.

            `alt=""`: the `<h1>` beside it is the accessible name of this
            banner, and it names the case, which is what someone arriving
            here needs. The product is already named by the document title.
            A branded image announcing "Sift" ahead of every case title is
            noise a sighted user can skip and a screen-reader user cannot.

            `width`/`height` are the viewBox's, for aspect ratio before load
            (`h-[...] w-auto` sets the real size) -- see `DemoLauncher`. */}
        <div className="flex min-w-0 items-center gap-[var(--space-2)]">
          <img
            src="/brand/sift-mark.svg"
            alt=""
            width={290}
            height={277}
            data-testid="workspace-app-bar-brand-mark"
            className="h-[var(--space-6)] w-auto shrink-0"
          />
          <h1
            data-testid="workspace-app-bar-title"
            className="min-w-0 truncate text-[length:var(--font-size-lg)]"
          >
            {title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <Badge
            data-testid="workspace-app-bar-connection-status"
            role="status"
            className="label-caps w-fit gap-[var(--space-1)] rounded-[var(--radius-pill)] px-[var(--space-2)] py-[var(--space-0-5)]"
            style={{ color: connectionMeta.ink, backgroundColor: connectionMeta.bg }}
          >
            <span
              aria-hidden="true"
              className={`h-[6px] w-[6px] shrink-0 rounded-full ${connection.pulse ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: connectionMeta.ink }}
            />
            {connection.label}
          </Badge>
          <span
            data-testid="workspace-app-bar-option-count"
            className="text-[length:var(--font-size-xs)] text-[var(--color-ink-muted)]"
          >
            {optionCount} {optionCount === 1 ? 'option' : 'options'}
          </span>
        </div>
      </div>

      <div
        role="toolbar"
        aria-label="Workspace actions"
        className="flex shrink-0 flex-wrap items-center gap-[var(--space-2)]"
      >
        {/* Primary cluster: the two content-changing shopping actions this
            task's brief names explicitly. Full-strength styling (filled for
            Add option, tinted-on-active for Findings) -- unchanged by this
            repair (see fix 2 in the header comment). */}
        <div className="flex shrink-0 items-center gap-[var(--space-1-5)]">
          {/* One trigger, three create actions -- see this file's header
              comment (second post-ship repair) for why this is a menu now
              and why that does not contradict fix 2's grouping decision.
              `ControlTooltip` sits OUTSIDE `DropdownMenuTrigger` so both
              Radix layers anchor to the one real `Button` element
              underneath; it fires at every width now (third post-ship
              repair) since the description line is new information even
              where the trigger already shows visible "Add" text. */}
          <DropdownMenu
            // `modal={false}` on purpose. Every item here opens a `Sheet`
            // (a Radix Dialog), and a modal menu closing in the same tick a
            // modal dialog opens makes two `react-remove-scroll` locks fight
            // over `document.body` -- the documented failure mode being a
            // body left at `pointer-events: none` with nothing on the page
            // clickable. A non-modal menu keeps arrow keys, typeahead,
            // Escape, outside-click dismissal and focus restoration (all
            // asserted in this file's sibling test); it only drops the
            // scroll lock and the `aria-hidden` blanket over the rest of the
            // page, neither of which a three-item create menu needs.
            modal={false}
          >
            <ControlTooltip label={CREATE_MENU_LABEL} description={CREATE_MENU_DESCRIPTION}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  data-testid="workspace-app-bar-create-menu"
                  // Radix supplies `aria-haspopup="menu"`/`aria-expanded`; it
                  // does not supply a name, so this stays explicit.
                  aria-label={CREATE_MENU_LABEL}
                  variant="default"
                  size={isExpanded ? 'sm' : 'icon'}
                  className={isExpanded ? TOUCH_TARGET : TOUCH_TARGET_ICON}
                >
                  <PlusIcon aria-hidden="true" className="size-4" />
                  {isExpanded ? 'Add' : null}
                  {isExpanded ? (
                    <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
            </ControlTooltip>
            {/* `align="end"`: this trigger sits at the right edge of the row
                in both layouts, so an end-aligned panel opens inward instead
                of being shifted back in by collision handling. */}
            <DropdownMenuContent
              align="end"
              data-testid="workspace-app-bar-create-menu-content"
              aria-label={CREATE_MENU_LABEL}
            >
              <DropdownMenuItem
                data-testid="workspace-app-bar-add-option"
                // `onSelect`, not `onClick`: Radix fires it for pointer AND
                // keyboard activation, so an Enter/Space user is not a
                // second code path that can silently rot.
                onSelect={onAddOption}
              >
                <PlusIcon aria-hidden="true" />
                Add option
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="workspace-app-bar-add-note" onSelect={onAddNote}>
                <NotebookPenIcon aria-hidden="true" />
                Add a note
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="workspace-app-bar-add-concern" onSelect={onAddConcern}>
                <CircleQuestionMarkIcon aria-hidden="true" />
                Add a question
              </DropdownMenuItem>
              {/* Not a create action, which is why the menu is named "Add or
                  adjust" rather than "Add to this case". It lives here
                  because the bar is genuinely full at 390px -- see the
                  header's note on crowding -- and a seventh always-mounted
                  icon overflowed the pane by 34px. This is a new capability
                  arriving behind a menu, not an existing one being moved
                  there, so ADR 0008's "no capability moves behind a menu"
                  rule is untouched. */}
              {onAdjustPriorities !== undefined ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    data-testid="workspace-app-bar-priorities"
                    onSelect={onAdjustPriorities}
                  >
                    <SlidersHorizontalIcon aria-hidden="true" />
                    {PRIORITIES_LABEL}
                  </DropdownMenuItem>
                </>
              ) : null}
              {/* Same placement reasoning as Adjust priorities directly
                  above: a new capability arriving behind an already-full
                  bar, not an existing one being demoted, so ADR 0008's "no
                  capability moves behind a menu" rule is untouched.
                  Without it there is no way out of a case at all -- "Reset
                  demo" restarts the same pack, and the launcher only renders
                  when no case is active, whose id survives reloads in
                  localStorage. */}
              {onSwitchDecision !== undefined ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    data-testid="workspace-app-bar-switch-decision"
                    onSelect={onSwitchDecision}
                  >
                    <ArrowLeftIcon aria-hidden="true" />
                    {SWITCH_DECISION_LABEL}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <ControlTooltip
            label={`Findings, ${String(findingsCount)}`}
            description={FINDINGS_DESCRIPTION}
          >
            <Button
              type="button"
              data-testid="workspace-app-bar-findings"
              // A single accessible name carrying the count in both layouts --
              // the visible `Badge` count below is always `aria-hidden` (see
              // its own comment) so the number is never announced twice.
              aria-label={`Findings, ${findingsCount}`}
              onClick={onReviewFindings}
              variant="ghost"
              // `size="sm"` at every width, not `isExpanded ? 'sm' : 'icon'` --
              // see fix 1 in the header comment. The control is sized by its
              // own inline content (icon, optional label, count chip) instead
              // of a fixed square, so the count chip is always laid out
              // touching the icon by construction; `TOUCH_TARGET` supplies
              // the height floor `sm`'s own `h-8` doesn't reach on its own.
              size="sm"
              className={`gap-[var(--space-1)] ${TOUCH_TARGET} ${isExpanded ? '' : 'px-[var(--space-2)]'}`}
              style={
                hasFindings
                  ? { color: findingsMeta.ink, backgroundColor: findingsMeta.bg }
                  : undefined
              }
            >
              <SearchCheckIcon aria-hidden="true" className="size-4" />
              {isExpanded ? 'Findings' : null}
              <Badge
                data-testid="workspace-app-bar-findings-count"
                aria-hidden="true"
                className="label-caps rounded-[var(--radius-pill)] px-[var(--space-1-5)] py-0"
                style={{ color: findingsMeta.ink, backgroundColor: 'var(--color-surface)' }}
              >
                {findingsCount}
              </Badge>
            </Button>
          </ControlTooltip>

          {/* The reference library: the case's collected research, and the
              durable half of what the model remembers about this decision.
              Sits beside Findings because they answer adjacent questions --
              "what did Sift conclude" and "what did Sift read" -- and both
              are global chrome, reachable identically in both layouts.
              Absent, not disabled, when no caller wired it. */}
          {onOpenReferenceLibrary !== undefined ? (
            <ControlTooltip
              label={`References, ${String(referenceCount)}`}
              description={REFERENCES_DESCRIPTION}
            >
              <Button
                type="button"
                data-testid="workspace-app-bar-references"
                onClick={onOpenReferenceLibrary}
                aria-label={`References, ${referenceCount}`}
                variant="ghost"
                size="sm"
                className={`gap-[var(--space-1)] ${TOUCH_TARGET} ${isExpanded ? '' : 'px-[var(--space-2)]'}`}
              >
                <LibraryIcon aria-hidden="true" className="size-4" />
                {isExpanded ? 'References' : null}
                <Badge
                  data-testid="workspace-app-bar-references-count"
                  aria-hidden="true"
                  className="label-caps rounded-[var(--radius-pill)] px-[var(--space-1-5)] py-0"
                >
                  {referenceCount}
                </Badge>
              </Button>
            </ControlTooltip>
          ) : null}
        </div>

        {/* `decorative` (Radix's default) keeps this out of the a11y tree --
            it is a purely visual grouping cue, not a semantic boundary a
            screen reader needs to announce. Height is an inline `style`,
            not a `className`, on purpose: `ui/separator.tsx`'s own base
            classes set `data-[orientation=vertical]:h-full`, a
            data-attribute-conditioned selector whose specificity beats a
            plain `h-6` class regardless of source order (confirmed live --
            a plain `className="h-6"` override rendered at a measured 0px
            height, because `h-full`'s `100%` had no definite parent height
            to resolve against). An inline style always wins the cascade, so
            it is the only override that is not fragile against that
            specificity quirk. */}
        <Separator orientation="vertical" style={{ height: 'var(--space-6)' }} />

        {/* Secondary cluster: Help, Developer view, Reset demo -- utility/
            informational controls, not shopping actions. Deliberately
            receded (smaller glyphs, muted ink) so the primary cluster keeps
            visual priority in the narrow row; see fix 2 in the header
            comment for why Reset demo is grouped here too even though the
            defect text named only Help/Developer view by example. Nothing
            here is hidden or moved behind a menu -- every control stays a
            single, always-mounted, directly clickable element in both
            layouts, per ADR 0008's "every capability must be reachable in
            both [modes]." */}
        <div className="flex shrink-0 items-center gap-[var(--space-1)]">
          <HelpButton
            {...(helpButtonRef !== undefined ? { ref: helpButtonRef } : {})}
            compliance={compliance}
          />

          {/* Icon-only at every width, so this one was already wrapped
              unconditionally before the third post-ship repair made every
              other control in the row match it. */}
          <ControlTooltip label="Developer view" description={DEVELOPER_VIEW_DESCRIPTION}>
            <Button
              type="button"
              data-testid="workspace-app-bar-developer-view"
              aria-label="Developer view"
              onClick={onOpenDeveloperView}
              variant="ghost"
              size="icon-sm"
              className={`${TOUCH_TARGET_ICON} shrink-0 text-[var(--color-ink-secondary)] hover:text-foreground`}
            >
              <TerminalIcon aria-hidden="true" className="size-4" />
            </Button>
          </ControlTooltip>

          {onResetDemo ? (
            <ControlTooltip label="Reset demo" description={RESET_DEMO_DESCRIPTION}>
              <Button
                type="button"
                data-testid="workspace-app-bar-reset-demo"
                aria-label="Reset demo"
                aria-busy={resetPending}
                disabled={resetPending}
                onClick={onResetDemo}
                // Expanded keeps the original labelled `secondary` (filled
                // chip) treatment; collapsed-to-icon-only at narrow recedes to
                // the same ghost/muted look as Help and Developer view, so the
                // secondary cluster reads as one consistent group rather than
                // one loud icon among two quiet ones.
                variant={isExpanded ? 'secondary' : 'ghost'}
                size={isExpanded ? 'sm' : 'icon-sm'}
                className={
                  isExpanded
                    ? TOUCH_TARGET
                    : `${TOUCH_TARGET_ICON} text-[var(--color-ink-secondary)] hover:text-foreground`
                }
              >
                {isExpanded ? (
                  resetPending ? (
                    'Resetting…'
                  ) : (
                    'Reset demo'
                  )
                ) : (
                  <RotateCcwIcon aria-hidden="true" className="size-4" />
                )}
              </Button>
            </ControlTooltip>
          ) : null}
        </div>
      </div>
    </header>
  );
}
