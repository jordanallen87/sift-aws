/**
 * The persistent orientation shell: the band at the top of the companion
 * pane's frame, and the reason a person never has to scroll back through a
 * conversation to work out where they are.
 *
 * It answers six questions, and it is designed around the fact that a novice
 * arriving at any single screenshot of this product should be able to answer
 * all six:
 *
 * 1. **What decision am I making?** — the case title and the pack running it.
 * 2. **What phase am I in?** — in words a person recognises, not the state
 *    machine's vocabulary. "Understanding what you need", never "discovery".
 * 3. **What has been covered?** — counts, and a bar computed from those same
 *    counts. A stored percentage beside its own numerator and denominator is
 *    a third fact that can disagree with the other two.
 * 4. **What is in focus, and what just changed?** — omitted entirely rather
 *    than filled with a placeholder when there is genuinely nothing to say.
 * 5. **What should I do next?** — always present. This is the one line that
 *    is never allowed to be empty.
 * 6. **How do I reach the outcome?** — so the journey has a visible end
 *    rather than feeling like an open-ended interrogation.
 *
 * ## One row, and what is not allowed behind the expander
 *
 * Answering six questions used to cost four stacked lines and a full-width
 * progress bar — most of a phone screen spent on orientation before a single
 * option was visible. Three of the six now share one row (phase · coverage ·
 * next step), the bar is a hairline on the shell's own bottom edge, and the
 * rest sits behind a closed-by-default disclosure.
 *
 * Two lines are deliberately exempt from that, because collapsing them would
 * change what the product *claims*, not merely how much room it takes:
 *
 * - `orientation-provisional` says the thing on screen rests on an
 *   incomplete picture. It is the qualification on every other statement in
 *   the pane, including the compressed row directly above it.
 * - `orientation-unverifiable` says a concern the person raised has nothing
 *   Sift can check. A limit that only appears once someone opens a
 *   disclosure is a limit the product has decided not to state.
 *
 * The rule they share: a line that *warns* is never collapsed, so the
 * visible row can never contradict what the expander is hiding. Everything
 * behind the expander — the current focus, the last change, what Sift is
 * working on, the route to the outcome — is elaboration; none of it can turn
 * out to qualify the row. Nothing is truncated either: a whole line moves
 * behind the disclosure rather than an ellipsis eating the end of a
 * sentence, which is the version a person cannot tell they are missing.
 *
 * The open/closed state is intentionally not persisted. A remembered
 * disclosure means two people looking at the same case see two different
 * panes, and a screenshot of one of them stops being evidence of what Sift
 * shows.
 *
 * ## What is pinned, which is a narrower question than what is shown
 *
 * The rule above says those two lines are always *visible*. It never said
 * they had to be *pinned*, and for a while this component treated the two
 * as the same thing, because they lived in the same box. Measured at 390px
 * on an 844px pane, that box was 133.56px tall collapsed and 183.94px with
 * the disclosure open: a fifth to a quarter of the pane spent, for the
 * whole session, on two paragraphs of prose that do not change while a
 * person works — and every card below them passing underneath that block
 * forever.
 *
 * So the pinned element is now the compact row alone (phase · coverage ·
 * next step, plus the disclosure trigger that row doubles as). The two
 * qualifications and the expanded detail render immediately below it, in
 * the same reading order, in normal flow — unconditionally, with the same
 * testids, the same text, no truncation and no second disclosure. Nothing
 * moved behind anything.
 *
 * The rationale above is unchanged and still binding: a qualification
 * nobody opened is a claim made without one, so neither line may be
 * collapsed, clipped, or made conditional on a control. What changed is
 * only that they scroll with the content they qualify instead of occupying
 * the viewport for the rest of the session. A person reading the pane top
 * to bottom meets them in exactly the same place; a person who has scrolled
 * past them has read them.
 *
 * The one thing that must stay true of that split: the pinned row must not
 * be able to say something the unpinned lines contradict. It cannot — the
 * row states phase, coverage and next step, and both qualifications are
 * about the *result*, which the row does not mention. When the two did
 * contradict each other ("Ready for your decision" over "0 of 5 covered"),
 * the fix was `provisionalReason`'s sentence, not proximity.
 *
 * ## Sticky positioning
 *
 * `position: sticky` rather than `fixed`, and the scroll container is the
 * case workspace's own scrolling region (`case-workspace-scroll` in
 * `App.tsx`) — not the document, which no longer scrolls at all now that the
 * workspace is a fixed-height pane shell. Sticky keeps this element in flow,
 * so the content below it is genuinely offset rather than merely appearing
 * to be, and it pins against the top of that region.
 *
 * This component therefore renders two siblings rather than one box: the
 * sticky `<section>`, and the unpinned block beneath it. They are siblings
 * and not nested for a mechanical reason, not a stylistic one — a sticky
 * element cannot escape its own parent's box, so an inner sticky row inside
 * a wrapper that also held the qualifications would unpin the moment that
 * wrapper scrolled past, which is precisely the behaviour being removed.
 * Both are children of `case-workspace-scroll`'s flex column, so the block
 * below inherits that column's gap rather than inventing spacing.
 *
 * The reason recorded here previously was "Sift renders inside an iframe in
 * the companion case, and a `fixed` element inside an iframe positions
 * against the iframe viewport." That premise was measured in the real
 * ChatGPT pane and is false: Sift is a top-level document there
 * (`window.self === window.top`), and nothing in the ancestor chain
 * establishes a containing block that would trap a fixed child. Sticky is
 * still the right choice for this element, for the flow reason above — but
 * not for that reason. See `App.tsx`'s shell root and
 * `docs/specs/architecture.md` "Companion frame".
 */
import { useId, useState, type Ref } from 'react';
import type { DiscoveryCoverage } from '@sift/contracts';

export interface DecisionOrientation {
  readonly decisionTitle: string;
  readonly packName: string;
  /** The machine's phase id, kept for testids and styling hooks. */
  readonly phase: string;
  /** The same phase in words a person recognises. This is what renders. */
  readonly phaseLabel: string;
  readonly coverage: DiscoveryCoverage;
  /** What Sift is currently asking about or working on. `null` when genuinely nothing is. */
  readonly currentFocus: string | null;
  /** The last thing that actually changed about the decision. `null` before anything has. */
  readonly latestChange: string | null;
  /** Always present: the pane is never a dead end. */
  readonly nextStepLabel: string;
  readonly routeToOutcome: string;
  /** True when something was deferred, so any result built on this is not the whole picture. */
  readonly provisional: boolean;
  /**
   * Why this is provisional, in the person's words. `null` when it is not.
   *
   * A single boolean was not enough once a second reason appeared. A seeded
   * demo case reaches a ready recommendation without anyone answering a
   * question, so the shell rendered "Ready for your decision" directly above
   * "0 of 5 covered" — two true statements whose pairing reads as a lie.
   * Naming the reason turns a contradiction into a qualification, which is
   * what it actually is.
   */
  readonly provisionalReason?: string | null;
}

/**
 * What Sift is actually working on, in the person's terms.
 *
 * Added because the RunPlan had an HTTP route and two activity events and
 * no surface at all: the plan revised, the event fired, and the pane showed
 * nothing a person could point at. A diagnostic pass scored the turn that
 * was meant to show the revision at 2 for exactly that reason.
 *
 * `null` when there is no plan yet, which is honest — most of discovery
 * happens before Sift has anything to work on.
 */
export interface WorkInFlight {
  readonly plannedItems: number;
  readonly optionsUnderInvestigation: number;
  /** Concerns nothing in the pack can check. Shown because an unknown a person raised is not a detail. */
  readonly unverifiableConcerns: number;
  readonly planVersion: number;
}

export interface DecisionOrientationShellProps {
  readonly orientation: DecisionOrientation;
  readonly layout: 'narrow' | 'expanded';
  /**
   * Whether this shell names the decision, or leaves that to something
   * above it.
   *
   * `WorkspaceAppBar` renders the case title immediately above this shell
   * in the live workspace, so repeating it here put the same words on
   * screen twice in a row -- visible the moment the shell was rendered for
   * a real case, and invisible to every unit test, which renders the shell
   * alone. Defaults to `true` so the shell is self-sufficient wherever
   * nothing else names the decision.
   */
  readonly showDecisionTitle?: boolean;
  /**
   * Whether this shell is the pinned orientation, or whether something above
   * it already is.
   *
   * Same shape of problem as `showDecisionTitle`, one level up: ADR 0016's
   * guided stepper is itself "an orientation and navigation control," and at
   * narrow width it sits directly above this shell OUTSIDE the scrolling
   * region -- so pinning both stacks two orientation bars on the pane this
   * product is actually used in. That is not merely redundant: the app bar,
   * the stepper and this shell together pinned enough of a 640px pane that
   * `request-investigation` ended up behind it while a run streamed and the
   * hero grew, which `assertRightPaneIntegrity` caught.
   *
   * Defaults to `true` so the shell stays self-sufficient wherever nothing
   * above it is pinned.
   */
  readonly pinned?: boolean;
  readonly workInFlight?: WorkInFlight | null;
  /**
   * A handle on this shell's own outer element, for a caller that needs to
   * measure it.
   *
   * The one caller is `App.tsx`, and what it needs is this shell's rendered
   * height: because the shell parks at the top of `case-workspace-scroll`,
   * that height is exactly the inset the scroll container's
   * `scroll-padding-top` has to carry so a `scrollIntoView({block: 'start'})`
   * does not land its target underneath this element. Height is not derivable
   * from the props -- it changes with `layout`, with the font a host renders
   * in, and with how many lines the summary row wraps to at 390px -- so it
   * has to be read off the real box, which means the caller needs a
   * reference to it.
   *
   * It lands on the sticky `<section>` specifically, which since the
   * qualifications moved out of it is the *only* part of this component that
   * ever covers scrolled content. The unpinned block below is ordinary flow
   * content and must not be counted: including it would push every
   * scrolled-to region down by a block that is not there to obscure it.
   * (Which is also why the disclosure no longer changes this number.)
   *
   * Optional, and the shell neither reads nor reacts to it: it is a
   * pass-through, exactly like `WorkspaceAppBar`'s `helpButtonRef`, and this
   * component renders and behaves identically with it omitted.
   */
  readonly containerRef?: Ref<HTMLElement>;
}

export function DecisionOrientationShell({
  orientation,
  layout,
  showDecisionTitle = true,
  pinned = true,
  workInFlight = null,
  containerRef,
}: DecisionOrientationShellProps): React.JSX.Element {
  const { coverage } = orientation;
  const total = coverage.requiredTotal;
  const resolved = coverage.requiredResolved;

  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const showsWorkInFlight = workInFlight !== null && workInFlight.plannedItems > 0;
  // No expander when the disclosure would be empty: a control that opens
  // onto nothing is a control that lied about having something.
  const hasDetails =
    orientation.currentFocus !== null ||
    orientation.latestChange !== null ||
    showsWorkInFlight ||
    orientation.routeToOutcome !== '';

  const showsUnverifiable = workInFlight !== null && workInFlight.unverifiableConcerns > 0;
  // Whether the unpinned block below the row has anything on screen. It is
  // never unmounted (see its own comment), but an empty box is still a flex
  // item in `case-workspace-scroll`'s column, and a zero-height flex item
  // sits between two `gap-4`s -- 32px of nothing where there should be 16.
  // `display: none` generates no box at all, so no gap either.
  const showsBelowRow = showsUnverifiable || orientation.provisional || detailsOpen;

  // The three answers a person needs at a glance, on one line. Wrapped in a
  // flex row rather than concatenated into a single string so each keeps its
  // own testid -- and so the separators can be hidden from a screen reader,
  // which would otherwise read "middle dot" between every clause.
  const summaryRow = (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-[var(--space-0-5)] text-left">
      <span
        data-testid="orientation-phase"
        className="text-[length:var(--text-sm)] font-medium text-[color:var(--color-foreground)]"
      >
        {orientation.phaseLabel}
      </span>

      {/*
        Hidden entirely when there is nothing to count. "0 of 0 covered" is
        not a smaller truth than a real ratio, it is noise -- and a progress
        bar that can never move invites a person to wonder what they did
        wrong.
      */}
      {total > 0 && (
        <>
          <Separator />
          <span
            data-testid="orientation-coverage"
            className="text-[length:var(--text-xs)] tabular-nums text-[color:var(--color-muted-foreground)]"
          >
            {resolved} of {total} covered
          </span>
        </>
      )}

      <Separator />
      <span
        data-testid="orientation-next-step"
        className="text-[length:var(--text-sm)] font-medium text-[color:var(--color-foreground)]"
      >
        <span className="font-normal text-[color:var(--color-muted-foreground)]">Next: </span>
        {orientation.nextStepLabel}
      </span>
    </span>
  );

  return (
    <>
      {/*
        A labelled region, deliberately not a `<header>`. `WorkspaceAppBar`
        already owns the page's single banner landmark, and a second one is a
        real axe violation (landmark-no-duplicate-banner) as well as a worse
        experience: a screen-reader user looking for "the banner" should find
        one thing, not two. `role="region"` with a name is the correct
        landmark for a labelled section, and it is still directly navigable.

        This is the pinned half, and the only half: everything that follows
        it scrolls. See "What is pinned" at the top of this file.
      */}
      <section
        ref={containerRef}
        aria-label="Decision status"
        data-testid="decision-orientation-shell"
        className={[
          pinned ? 'sticky top-0 z-20' : '',
          'flex flex-col gap-[var(--space-1)]',
          'border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]',
          layout === 'expanded'
            ? 'px-[var(--space-6)] py-[var(--space-3)]'
            : 'px-[var(--space-4)] py-[var(--space-3)]',
          // Respects the iframe's safe area on a device with a notch, so the
          // first line of the shell is never clipped by the host chrome.
          'pt-[max(var(--space-3),env(safe-area-inset-top))]',
        ].join(' ')}
      >
        {showDecisionTitle && (
          <div className="flex items-baseline justify-between gap-[var(--space-2)]">
            <h1
              data-testid="orientation-decision"
              className="truncate text-[length:var(--text-base)] font-semibold text-[color:var(--color-foreground)]"
            >
              {orientation.decisionTitle}
            </h1>
            <span
              data-testid="orientation-pack"
              className="shrink-0 text-[length:var(--text-xs)] text-[color:var(--color-muted-foreground)]"
            >
              {orientation.packName}
            </span>
          </div>
        )}

        {hasDetails ? (
          <button
            type="button"
            data-testid="orientation-details-toggle"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => {
              setDetailsOpen((open) => !open);
            }}
            // The whole row is the trigger, the way `DisclosureSection`'s
            // `<summary>` is: a compact chevron on its own would be a target
            // well under 44px in a pane people use with a thumb, and adding a
            // 44px-tall control would spend back the vertical space this
            // compression just recovered.
            className="flex w-full cursor-pointer items-baseline gap-[var(--space-2)] rounded-[var(--radius-sm)] border-0 bg-transparent p-0 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {summaryRow}
            <span
              aria-hidden="true"
              className={[
                'shrink-0 text-[length:var(--text-xs)] text-[color:var(--color-muted-foreground)]',
                'transition-transform duration-[var(--duration-fast)] ease-[var(--ease-standard)]',
                detailsOpen ? 'rotate-90' : '',
              ].join(' ')}
            >
              ›
            </span>
          </button>
        ) : (
          <div className="flex w-full items-baseline gap-[var(--space-2)]">{summaryRow}</div>
        )}

        {/*
          The progress bar, moved onto the shell's own bottom edge so it costs
          no line of its own. Still a real `progressbar` with the same counts
          printed in the row above it -- absolutely positioned, so it adds
          nothing to the shell's height.
        */}
        {total > 0 && (
          <div
            data-testid="orientation-progress"
            role="progressbar"
            aria-valuenow={resolved}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="Required topics covered"
            className="absolute inset-x-0 bottom-0 h-[var(--space-0-5)] overflow-hidden bg-[color:var(--color-muted)]"
          >
            <div
              className="h-full bg-[color:var(--color-primary)]"
              // Computed from the very counts printed above it. `total === 0`
              // is a real state (a pack with no declared topics), and dividing
              // by it would render a NaN width.
              style={{ width: total === 0 ? '0%' : `${String((resolved / total) * 100)}%` }}
            />
          </div>
        )}
      </section>

      {/*
        Everything the shell says that is not the pinned row: the two
        qualifications, then the expanded detail. Same order on screen as
        when they lived inside the sticky box, immediately beneath it, and
        still aligned to the row's own text edge -- what changed is that
        they scroll.

        Never unmounted, for the reason the detail region already documents
        below: the testids here are read through `textContent` by the e2e
        and journey suites, and a node that disappears turns a layout change
        into a contract change. `hidden` (so: no box at all) rather than an
        empty visible div, because an empty flex item in
        `case-workspace-scroll`'s column still sits between two 16px gaps.
      */}
      <div
        data-testid="orientation-body"
        hidden={!showsBelowRow}
        className={
          showsBelowRow
            ? [
                'flex flex-col gap-[var(--space-1)]',
                // The row's own horizontal padding, repeated so a
                // qualification starts at the same x as the clause it
                // qualifies rather than at the pane's content edge.
                layout === 'expanded' ? 'px-[var(--space-6)]' : 'px-[var(--space-4)]',
                // Pulls the block up against the row's hairline. The
                // scroll column's 16px gap is the spacing between separate
                // pieces of content; these lines are a continuation of the
                // one directly above them, and reading as a detached
                // paragraph is what made them look optional.
                '-mt-[var(--space-2)]',
              ].join(' ')
            : undefined
        }
      >
        {/*
          A concern nothing can check is not a footnote. It is the one thing
          the person asked about that Sift has to say it cannot answer, and
          burying it -- behind a disclosure included -- would be the quiet
          fabrication this product exists to avoid. Unpinning is not burying:
          it renders whenever it is true, with no control in front of it.
        */}
        {showsUnverifiable && workInFlight !== null && (
          <p
            data-testid="orientation-unverifiable"
            className="text-[length:var(--text-xs)] text-[color:var(--color-warning-foreground,var(--color-foreground))]"
          >
            {workInFlight.unverifiableConcerns} thing
            {workInFlight.unverifiableConcerns === 1 ? '' : 's'} you raised{' '}
            {workInFlight.unverifiableConcerns === 1 ? 'has' : 'have'} nothing Sift can check — you
            will need to judge {workInFlight.unverifiableConcerns === 1 ? 'it' : 'them'} yourself.
          </p>
        )}

        {/*
          Rendered unconditionally for the same reason: it is the
          qualification on the row directly above it, and a qualification
          nobody opened is a claim made without one. Still true of a line that
          scrolls -- a person reaches it by reading, not by pressing anything.
        */}
        {orientation.provisional && (
          <p
            data-testid="orientation-provisional"
            className="text-[length:var(--text-xs)] text-[color:var(--color-warning-foreground,var(--color-foreground))]"
          >
            {orientation.provisionalReason ??
              'Provisional — something was deferred, so this is not the whole picture yet.'}
          </p>
        )}

        {/*
          Hidden with the `hidden` attribute rather than by unmounting. Every
          line below carries a `data-testid` the e2e and journey suites read
          through `textContent`, which works on a hidden node but not on one
          that no longer exists -- so compressing the pane stays a layout
          change instead of quietly becoming a contract change. The display
          class is applied only when open, because a Tailwind `display`
          utility would otherwise out-rank the UA stylesheet's
          `[hidden] { display: none }` and leave the region visible.

          Its trigger is up in the sticky row and controls it by `id`, which
          is why opening the disclosure no longer changes the pinned height.
        */}
        <div
          id={detailsId}
          data-testid="orientation-details"
          hidden={!detailsOpen}
          className={
            detailsOpen ? 'flex flex-col gap-[var(--space-1)] pt-[var(--space-1)]' : undefined
          }
        >
          {orientation.currentFocus !== null && (
            <p
              data-testid="orientation-focus"
              className="text-[length:var(--text-sm)] text-[color:var(--color-foreground)]"
            >
              <span className="text-[color:var(--color-muted-foreground)]">In focus: </span>
              {orientation.currentFocus}
            </p>
          )}

          {orientation.latestChange !== null && (
            <p
              data-testid="orientation-latest-change"
              className="text-[length:var(--text-xs)] text-[color:var(--color-muted-foreground)]"
            >
              {orientation.latestChange}
            </p>
          )}

          {showsWorkInFlight && workInFlight !== null && (
            <p
              data-testid="orientation-work-in-flight"
              className="text-[length:var(--text-xs)] text-[color:var(--color-muted-foreground)]"
            >
              Sift is looking into {workInFlight.plannedItems} thing
              {workInFlight.plannedItems === 1 ? '' : 's'}
              {workInFlight.optionsUnderInvestigation > 0
                ? ` across ${String(workInFlight.optionsUnderInvestigation)} option${workInFlight.optionsUnderInvestigation === 1 ? '' : 's'}`
                : ''}
              .
            </p>
          )}

          <p
            data-testid="orientation-route"
            className="text-[length:var(--text-xs)] text-[color:var(--color-muted-foreground)]"
          >
            {orientation.routeToOutcome}
          </p>
        </div>
      </div>
    </>
  );
}

/** The `·` between the row's three clauses. Hidden from assistive technology, which would otherwise read "middle dot" between every clause. */
function Separator(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="text-[color:var(--color-border)]">
      ·
    </span>
  );
}
