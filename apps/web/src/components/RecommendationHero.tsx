/**
 * The answer-first hero (`docs/decisions/
 * 0004-consumer-workspace-information-architecture.md`, decision item 1;
 * `docs/change-sets/2026-08-30-generic-decision-workspace.md` §38, §39,
 * §64). This is the ONE region that says what Sift currently thinks and
 * what, if anything, the user needs to do about it -- replacing three
 * previously-separate, previously-adjacent regions that could (and did)
 * disagree with each other in the same glance: the retired
 * `WorkspaceStatusHeader` (a four-stage tracker + next-step banner),
 * `RecommendationCard` ("Our pick: READY FOR REVIEW"), and `ApprovalCard`
 * ("Your decision: No proposal is pending review yet.") rendered as
 * adjacent siblings. ADR 0004 names this exact contradiction as the defect
 * this component exists to close: "Collapsing them into one region removes
 * the seam: there is one place that says what Sift currently thinks and
 * what, if anything, the user needs to do about it, and it cannot disagree
 * with itself because it is one region, not two."
 *
 * `status` (a `WorkspaceStatus` from `workspace-status.ts`) is the single
 * state machine driving what renders below the headline -- this component
 * owns no derivation logic of its own, only the layout and the decision of
 * *which* already-real data to show for a given phase. `RecommendationCard`
 * and `ApprovalCard` are reused verbatim (not reimplemented): both already
 * correctly render their own populated states, and `ApprovalCard` in
 * particular has NO `actor` prop at all -- reusing it here, rather than
 * hand-rolling new approve/reject/revise controls, is what keeps
 * docs/engineering-principles.md's "human approval stays human-only" guarantee intact without
 * this file needing to re-earn it. Per change-set §5 ("Do not render an
 * empty conceptual region merely because CaseState contains a corresponding
 * field"), this component mounts each of the four real Sift regions it
 * composes -- `LiveRunStatus`, `RecommendationCard`, `ApprovalCard`, and the
 * "Review findings" action -- only when there is something real to show:
 * a `null` recommendation with no withheld draft renders no
 * `RecommendationCard` at all rather than its own "No recommendation yet"
 * copy, and a `null` proposal renders no `ApprovalCard` at all rather than
 * its own "No proposal is pending review yet." copy. `LiveRunStatus` now
 * enforces this same rule internally (see its own file header), so it is
 * always safe to mount unconditionally here.
 */
import type { Ref } from 'react';
import type {
  DecisionProposal,
  PublicActivityEvent,
  Recommendation,
  Source,
} from '@sift/contracts';
import { Button } from '@/components/ui/button';
import { ApprovalCard, type ApprovalCardReview } from './ApprovalCard.js';
import { RecommendationCard, type RecommendationWithheld } from './RecommendationCard.js';
import { LiveRunStatus, type LiveRunStatusReceipt } from './LiveRunStatus.js';
import { SpecialistActivityPanel } from './SpecialistActivityPanel.js';
import type { WorkspaceStatus } from './workspace-status.js';

export interface RecommendationHeroProps {
  status: WorkspaceStatus;
  recommendation: Recommendation | null;
  withheld: RecommendationWithheld | null;
  sources: Record<string, Source>;
  proposal: DecisionProposal | null;
  /** Resolved label for the proposal's favoured option, when available. */
  approvalOptionLabel?: string | undefined;
  onReview: (review: ApprovalCardReview) => void;
  reviewPending: boolean;
  reviewError: string | null;
  onRequestInvestigation: () => void;
  requestPending: boolean;
  requestDisabled: boolean;
  requestError: string | null;
  onReviewFindingsClick: () => void;
  liveRunReceipt: LiveRunStatusReceipt | null;
  liveEvents: PublicActivityEvent[];
  onInspectRun: (runId: string) => void;
  /**
   * Optional DOM ref onto this component's own outer region. Exists so a
   * caller can scroll this exact region into view and move real keyboard
   * focus to it -- the `review_question` dock action on a decided case does
   * exactly that in `App.tsx`'s `handleDockAction` rather than inventing a
   * new view or a modal, because this region already IS the answer to
   * "review what was decided": it already renders the decided headline plus
   * `RecommendationCard`/`ApprovalCard` for any case with a settled
   * proposal. `tabIndex={-1}` below is what makes that a valid `.focus()`
   * target without joining the page's normal Tab order, and the existing
   * `aria-labelledby` gives it a real accessible name (this region's own
   * headline) so a screen reader announces something meaningful the moment
   * focus lands here programmatically, rather than silently doing nothing.
   */
  containerRef?: Ref<HTMLDivElement>;
  /**
   * Optional DOM ref onto the `ApprovalCard` region nested inside this one,
   * forwarded to its own `containerRef`. Same mechanism as `containerRef`
   * above, aimed one region deeper: the `confirm_shortlist` dock action --
   * the one `humanOnly` move Sift derives -- brings the person to the
   * Approve/Reject/Request-revision controls specifically, which can sit
   * well below the fold of this region in a 390px pane. It moves focus
   * there and does nothing else; no automatic path may approve a
   * consequential decision (docs/engineering-principles.md), and `ApprovalCard` has no `actor`
   * prop through which one could try.
   *
   * `undefined` whenever `proposal` is `null`, since no `ApprovalCard`
   * renders then -- `App.tsx`'s `handleConfirmShortlist` falls back to this
   * region's own `containerRef` in that case.
   */
  approvalRef?: Ref<HTMLElement>;
}

export function RecommendationHero({
  status,
  recommendation,
  withheld,
  sources,
  proposal,
  approvalOptionLabel,
  onReview,
  reviewPending,
  reviewError,
  onRequestInvestigation,
  requestPending,
  requestDisabled,
  requestError,
  onReviewFindingsClick,
  liveRunReceipt,
  liveEvents,
  onInspectRun,
  containerRef,
  approvalRef,
}: RecommendationHeroProps) {
  const showRecommendation = recommendation !== null || withheld !== null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      data-testid="recommendation-hero"
      aria-labelledby="recommendation-hero-headline"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-lg)] bg-card p-[var(--space-4)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {/* Remounts (and replays `.status-change-enter`) whenever the phase
          itself changes -- the same "a real state transition deserves a
          felt moment" convention the retired next-step banner used, now
          applied to the one headline that replaces it. */}
      <div
        key={status.phase}
        data-testid="recommendation-hero-status"
        data-phase={status.phase}
        role="status"
        className="status-change-enter flex flex-col gap-[var(--space-1)]"
      >
        <h2 id="recommendation-hero-headline" data-testid="recommendation-hero-headline">
          {status.headline}
        </h2>
        {status.detail ? (
          <p
            data-testid="recommendation-hero-detail"
            className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
          >
            {status.detail}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button
          type="button"
          data-testid="request-investigation"
          aria-busy={requestPending}
          disabled={requestPending || requestDisabled}
          onClick={onRequestInvestigation}
          size="sm"
          // Primary emphasis only while nothing has been looked into yet --
          // once real content exists below, this becomes a secondary,
          // always-available "look again" control rather than competing
          // with the phase's own real next action (Approve/Reject/Revise,
          // or Review findings).
          variant={status.phase === 'not_started' ? 'default' : 'secondary'}
          className="min-h-[var(--size-touch-target-min)]"
        >
          {requestPending ? 'Starting investigation…' : 'Have Sift investigate'}
        </Button>

        {status.action?.kind === 'review_findings' ? (
          <Button
            type="button"
            data-testid="recommendation-hero-review-findings"
            onClick={onReviewFindingsClick}
            size="sm"
            variant="default"
            className="min-h-[var(--size-touch-target-min)]"
          >
            {status.action.label}
          </Button>
        ) : null}
      </div>

      {requestError ? (
        <p
          role="alert"
          data-testid="request-investigation-error"
          className="text-[length:var(--font-size-sm)]"
          style={{ color: 'var(--color-status-error-ink)' }}
        >
          {requestError}
        </p>
      ) : null}

      <LiveRunStatus receipt={liveRunReceipt} events={liveEvents} />

      {/*
        Who actually did the work. `LiveRunStatus` answers "where is this run"
        in one line; this names the specialists underneath it and what each
        one settled. It renders nothing until a specialist has reported, so a
        case that has never been investigated is unaffected.

        Scoped to the live run when there is one: without `runId` the panel
        would accumulate every specialist across every round, which reads as
        a growing pile rather than "here is who looked at this."
      */}
      <SpecialistActivityPanel
        events={liveEvents}
        {...(liveRunReceipt?.runId !== undefined ? { runId: liveRunReceipt.runId } : {})}
      />

      {liveRunReceipt?.runId !== undefined ? (
        <Button
          type="button"
          data-testid="open-runtime-inspector"
          onClick={() => onInspectRun(liveRunReceipt.runId!)}
          variant="secondary"
          size="sm"
          className="min-h-[var(--size-touch-target-min)] self-start"
        >
          Inspect run
        </Button>
      ) : null}

      {showRecommendation ? (
        <RecommendationCard
          recommendation={recommendation}
          withheld={withheld}
          sources={sources}
          // From this region's own state machine, never re-derived from the
          // proposal here: the headline above and the status chip inside
          // the card are then two renderings of one decision, which is the
          // ADR 0004 guarantee. Without it the card kept announcing "READY
          // FOR REVIEW" directly beneath a "Decided." headline (release
          // baseline `decided-chatgpt-pane-640-darwin.png`), because
          // `Recommendation.status` stays `'ready'` once a human answers.
          settledDecision={status.settledDecision ?? null}
        />
      ) : null}

      {proposal !== null ? (
        <ApprovalCard
          proposal={proposal}
          optionLabel={approvalOptionLabel}
          onReview={onReview}
          reviewPending={reviewPending}
          error={reviewError}
          {...(approvalRef === undefined ? {} : { containerRef: approvalRef })}
        />
      ) : null}
    </div>
  );
}
