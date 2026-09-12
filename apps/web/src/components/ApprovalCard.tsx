/**
 * Region 6, "Recommendation and approval" (docs/specs/product.md "Workspace
 * layout") -- the approval half. Renders a real `DecisionProposal`
 * (packages/contracts/src/case.ts) with explicit approve/revise/reject
 * controls.
 *
 * Adapted from
 * `praetor:apps/web/src/components/strata19/inline/renderers/ApprovalGateCard.tsx`'s
 * "one clear primary action" idea -- "the approve/reject control itself is
 * the envelope's single `primaryAction`; the card never invents a second
 * one, which is also how 'no self-approval' stays enforceable server-side
 * rather than being a UI convention" (docs/reuse-source-map.md) -- see
 * docs/reuse-attribution.md. Here, Approve and Reject both read as
 * meaningful, weighted actions (`Button` `variant="default"` /
 * `variant="destructive"`); Request revision remains available but visually
 * secondary, matching product.md's requirement for "explicit
 * approve/revise/reject controls" while keeping one clear default. The
 * settled-state stamp is a solid tinted fill rather than a bordered
 * signature element -- docs/engineering-principles.md's flat-design mandate applies even to this
 * "a human stamps the case; the agent never does" moment
 * (docs/design-system.md); background-color contrast alone carries the
 * weight a border used to.
 *
 * HUMAN-ONLY APPROVAL, ENFORCED STRUCTURALLY, NOT BY CONVENTION:
 * architecture.md "Security and authority": "`reviewProposal` rejects
 * requests whose `actor` is not `human`." This component goes further than
 * merely defaulting to `'human'` -- `ApprovalCardProps` has NO `actor`
 * field at all, so there is no prop an integrating caller could pass to
 * override or spoof it, and `onReview`'s own parameter type pins
 * `actor: 'human'` as a literal (not the general `Actor` union from
 * `@sift/contracts`, which also allows `'agent'`). Every call site inside
 * this file constructs that literal directly; grep this file for `actor:`
 * to see there is exactly one value it can ever be. See
 * `ApprovalCard.test.tsx`'s "human-only approval" describe block, which
 * spies on `onReview` and asserts every call across approve/reject/revise
 * carries `actor: 'human'`, plus a compile-time type assertion that
 * `ApprovalCardProps` has no `actor` key at all.
 */
import { useState } from 'react';
import type { Ref } from 'react';
import type { DecisionProposal, ReviewProposalDecision } from '@sift/contracts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { STATUS_TONE_META, type StatusTone } from './activity-labels.js';

export interface ApprovalCardReview {
  actor: 'human';
  decision: ReviewProposalDecision;
  instructions?: string;
  reason?: string;
}

export interface ApprovalCardProps {
  /** `null` when no proposal is pending review yet. */
  proposal: DecisionProposal | null;
  /** The case's recommended option label, when the caller can resolve it. */
  optionLabel?: string | undefined;
  onReview: (review: ApprovalCardReview) => void;
  /** True while a review submission is in flight; disables all controls. */
  reviewPending?: boolean;
  /** A recoverable error from a failed review submission. The proposal and controls stay visible so the human can retry. */
  error?: string | null;
  /**
   * Optional DOM ref onto this component's own outer region, so a caller can
   * scroll it into view and move real keyboard focus to it. The
   * `confirm_shortlist` dock action -- the one `humanOnly` move Sift derives
   * -- does exactly that in `App.tsx`'s `handleDockAction`: it brings the
   * person to these controls and stops, because no automatic path may
   * approve a consequential decision (docs/engineering-principles.md). This ref grants no new
   * power to do so; `ApprovalCardProps` still has no `actor` field, and
   * `submit()` below is still the only place `actor: 'human'` is
   * constructed.
   *
   * `tabIndex={-1}` on the `<section>` is what makes it a valid `.focus()`
   * target without joining the page's normal Tab order; the existing
   * `aria-labelledby` ("Your decision") gives it a real accessible name, so
   * a screen reader announces something meaningful when focus lands here
   * programmatically instead of silently doing nothing.
   */
  containerRef?: Ref<HTMLElement>;
}

const SETTLED_STATUS_META: Record<
  Exclude<DecisionProposal['status'], 'pending'>,
  { label: string; tone: StatusTone }
> = {
  approved: { label: 'Approved', tone: 'satisfied' },
  rejected: { label: 'Rejected', tone: 'error' },
  revision_requested: { label: 'Revision requested', tone: 'accepted-uncertainty' },
};

interface RevisionFormState {
  open: boolean;
  instructions: string;
}

export function ApprovalCard({
  proposal,
  optionLabel,
  onReview,
  reviewPending = false,
  error = null,
  containerRef,
}: ApprovalCardProps) {
  const [revisionForm, setRevisionForm] = useState<RevisionFormState>({
    open: false,
    instructions: '',
  });

  function submit(
    decision: ReviewProposalDecision,
    details: { instructions?: string; reason?: string } = {},
  ) {
    // The ONLY place `actor` is constructed. Always the literal 'human' --
    // never sourced from a prop, form field, or any other caller-controlled
    // value.
    onReview({ actor: 'human', decision, ...details });
  }

  const approveLabel = optionLabel ? `Select ${optionLabel}` : 'Select recommendation';

  return (
    <section
      ref={containerRef}
      tabIndex={-1}
      data-testid="approval-card"
      aria-labelledby="approval-card-heading"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-card p-[var(--space-4)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <h2 id="approval-card-heading">Your decision</h2>

      {error ? (
        <Alert variant="destructive" data-testid="approval-card-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {proposal === null ? (
        <p
          data-testid="approval-card-empty"
          className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
        >
          No proposal is pending review yet.
        </p>
      ) : proposal.status !== 'pending' ? (
        (() => {
          const settledMeta = SETTLED_STATUS_META[proposal.status];
          const meta = STATUS_TONE_META[settledMeta.tone];
          return (
            <div
              data-testid="approval-card-settled"
              className="flex flex-col items-start gap-[var(--space-2)]"
            >
              {/* The "stamp" signature element (docs/design-system.md): a
                  human stamps the case, the agent never does. Flat by
                  design -- a solid tinted fill, not a bordered badge, is
                  the whole signal. */}
              <div
                data-testid="approval-card-stamp"
                className="stamp-enter label-caps inline-block -rotate-3 rounded-[var(--radius-xs)] px-[var(--space-3)] py-[var(--space-1-5)]"
                style={{ color: meta.ink, backgroundColor: meta.bg }}
              >
                {settledMeta.label}
              </div>
              {proposal.revisionInstructions ? (
                <p
                  data-testid="approval-card-revision-instructions"
                  className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
                >
                  {proposal.revisionInstructions}
                </p>
              ) : null}
              {proposal.reviewReason ? (
                // The reviewer's own stated reason for approving, rejecting,
                // or requesting revision (`DecisionProposal.reviewReason`,
                // packages/contracts/src/case.ts) -- optional and frequently
                // absent, so this renders nothing at all rather than an
                // empty region when there is none (product.md "Empty
                // regions"). "You said:" attributes it to the human, not
                // Sift -- the same voice `decision-orientation.ts`'s
                // `latestChangeOf` already uses for the person's own words.
                // `break-words` (not `whitespace-nowrap`) is what keeps a
                // long reason (up to 2000 schema-valid characters) wrapping
                // inside the card instead of overflowing at the 390/430px
                // canonical widths.
                <p
                  data-testid="approval-card-review-reason"
                  className="whitespace-pre-wrap break-words text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
                >
                  You said: {proposal.reviewReason}
                </p>
              ) : null}
            </div>
          );
        })()
      ) : (
        <div
          data-testid="approval-card-pending"
          className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] p-[var(--space-3)]"
          style={{ backgroundColor: STATUS_TONE_META.ready.bg }}
        >
          <Badge
            className="label-caps w-fit gap-[var(--space-1)] rounded-[var(--radius-pill)] px-[var(--space-2)] py-[var(--space-0-5)]"
            style={{ color: STATUS_TONE_META.ready.ink, backgroundColor: 'var(--color-surface)' }}
          >
            Your approval needed
          </Badge>

          {!revisionForm.open ? (
            // `form-measure`: these are the case's consequential controls, so
            // they stay full-bleed in the narrow pane where that reads as
            // emphasis. At the widened desktop shell an 1180px-wide
            // A generic command reads as a stretched layout rather than a decisive
            // action, and a control's width should suggest its weight, not
            // the container's.
            //
            // The label names the actual recommendation when the case can
            // resolve one. The generic fallback remains true for every pack;
            // neither version changes the underlying decision semantics.
            <div className="form-measure flex flex-col gap-[var(--space-2)]">
              <Button
                type="button"
                data-testid="approval-card-approve"
                aria-busy={reviewPending}
                disabled={reviewPending}
                onClick={() => {
                  submit('approve');
                }}
                variant="default"
                className="min-h-[var(--size-touch-target-min)]"
              >
                {reviewPending ? 'Submitting…' : approveLabel}
              </Button>

              <div className="flex flex-wrap gap-[var(--space-2)]">
                <Button
                  type="button"
                  data-testid="approval-card-reject"
                  disabled={reviewPending}
                  onClick={() => {
                    submit('reject');
                  }}
                  variant="secondary"
                  className="min-h-[var(--size-touch-target-min)] flex-1"
                >
                  Pass
                </Button>
                <Button
                  type="button"
                  data-testid="approval-card-request-revision"
                  disabled={reviewPending}
                  onClick={() => {
                    setRevisionForm({ open: true, instructions: '' });
                  }}
                  variant="secondary"
                  // The pending panel behind this button is itself a
                  // tinted `ready` surface (STATUS_TONE_META.ready.bg) --
                  // Button's default `secondary` fill
                  // (--color-surface-sunken) sits only a hair lighter than
                  // that tint and reads as no button at all. `bg-card`
                  // (pure white) restores real contrast the same way the
                  // "Your approval needed" badge above already pops off
                  // this same backdrop.
                  className="min-h-[var(--size-touch-target-min)] flex-1 bg-card text-card-foreground hover:bg-card/90"
                >
                  Continue investigation
                </Button>
              </div>
            </div>
          ) : (
            <form
              data-testid="approval-card-revision-form"
              className="flex flex-col gap-[var(--space-2)]"
              onSubmit={(event) => {
                event.preventDefault();
                if (revisionForm.instructions.trim().length === 0) {
                  return;
                }
                submit('request_revision', { instructions: revisionForm.instructions.trim() });
                setRevisionForm({ open: false, instructions: '' });
              }}
            >
              <Label
                htmlFor="approval-card-revision-instructions"
                className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
              >
                What should Sift revise?
              </Label>
              <Textarea
                id="approval-card-revision-instructions"
                data-testid="approval-card-revision-instructions-input"
                value={revisionForm.instructions}
                onChange={(event) => {
                  setRevisionForm({ open: true, instructions: event.target.value });
                }}
                required
                rows={3}
                className="min-h-[var(--size-touch-target-min)] border-0"
              />
              <div className="flex flex-wrap gap-[var(--space-2)]">
                <Button
                  type="submit"
                  data-testid="approval-card-revision-submit"
                  disabled={reviewPending || revisionForm.instructions.trim().length === 0}
                  variant="default"
                  className="min-h-[var(--size-touch-target-min)] flex-1"
                >
                  Submit revision request
                </Button>
                <Button
                  type="button"
                  data-testid="approval-card-revision-cancel"
                  disabled={reviewPending}
                  onClick={() => {
                    setRevisionForm({ open: false, instructions: '' });
                  }}
                  variant="secondary"
                  // Same contrast fix as "Request revision" above -- this
                  // form is rendered inside the same tinted `ready` panel.
                  className="min-h-[var(--size-touch-target-min)] bg-card text-card-foreground hover:bg-card/90"
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
