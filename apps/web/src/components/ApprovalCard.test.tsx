import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { DecisionProposal } from '@sift/contracts';
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';

function buildProposal(overrides: Partial<DecisionProposal> = {}): DecisionProposal {
  return {
    id: 'proposal-1',
    recommendationId: 'recommendation-1',
    status: 'pending',
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

// Compile-time proof, not just a runtime convention: `ApprovalCardProps`
// exposes no `actor` field at all, so no caller can pass one through to be
// spoofed. If a future edit ever adds an `actor` prop to this component,
// this line stops typechecking and `pnpm --filter @sift/web typecheck`
// fails.
type AssertNoActorProp = 'actor' extends keyof ApprovalCardProps
  ? 'FAIL: ApprovalCardProps must never expose an actor field'
  : true;
const assertNoActorProp: AssertNoActorProp = true;
void assertNoActorProp;

describe('ApprovalCard', () => {
  it('renders the initial/empty state when no proposal is pending', () => {
    render(<ApprovalCard proposal={null} onReview={vi.fn()} />);
    expect(screen.getByTestId('approval-card-empty')).toHaveTextContent(
      /no proposal is pending review yet/i,
    );
  });

  it('renders the pending state with concrete approval controls', () => {
    render(<ApprovalCard proposal={buildProposal()} onReview={vi.fn()} />);

    expect(screen.getByTestId('approval-card-pending')).toHaveTextContent(/your approval needed/i);
    expect(screen.getByRole('button', { name: 'Select recommendation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue investigation' })).toBeInTheDocument();
  });

  it('names the recommended option when the caller provides one', () => {
    render(
      <ApprovalCard
        proposal={buildProposal()}
        optionLabel="Northgate Plumbing"
        onReview={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select Northgate Plumbing' })).toBeInTheDocument();
  });

  describe('human-only approval (architecture.md "reviewProposal rejects requests whose actor is not human")', () => {
    it('calls onReview with actor: "human" hardcoded when approving', async () => {
      const user = userEvent.setup();
      const onReview = vi.fn();
      render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

      await user.click(screen.getByRole('button', { name: 'Select recommendation' }));

      expect(onReview).toHaveBeenCalledTimes(1);
      expect(onReview).toHaveBeenCalledWith({ actor: 'human', decision: 'approve' });
    });

    it('calls onReview with actor: "human" hardcoded when rejecting', async () => {
      const user = userEvent.setup();
      const onReview = vi.fn();
      render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

      await user.click(screen.getByRole('button', { name: 'Pass' }));

      expect(onReview).toHaveBeenCalledWith({ actor: 'human', decision: 'reject' });
    });

    it('calls onReview with actor: "human" hardcoded when requesting revision', async () => {
      const user = userEvent.setup();
      const onReview = vi.fn();
      render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

      await user.click(screen.getByRole('button', { name: 'Continue investigation' }));
      await user.type(
        screen.getByTestId('approval-card-revision-instructions-input'),
        'Please re-check the trade-in value.',
      );
      await user.click(screen.getByRole('button', { name: 'Submit revision request' }));

      expect(onReview).toHaveBeenCalledWith({
        actor: 'human',
        decision: 'request_revision',
        instructions: 'Please re-check the trade-in value.',
      });
    });

    it('every recorded onReview call across all three decisions carries actor: "human", never anything else', async () => {
      const user = userEvent.setup();
      const onReview = vi.fn<ApprovalCardProps['onReview']>();
      const { rerender } = render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

      await user.click(screen.getByRole('button', { name: 'Select recommendation' }));
      rerender(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);
      await user.click(screen.getByRole('button', { name: 'Pass' }));
      rerender(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);
      await user.click(screen.getByRole('button', { name: 'Continue investigation' }));
      await user.type(
        screen.getByTestId('approval-card-revision-instructions-input'),
        'Double-check mileage.',
      );
      await user.click(screen.getByRole('button', { name: 'Submit revision request' }));

      expect(onReview.mock.calls).toHaveLength(3);
      for (const call of onReview.mock.calls) {
        expect(call[0].actor).toBe('human');
      }
    });
  });

  it('requires non-empty instructions before a revision request can be submitted', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

    await user.click(screen.getByRole('button', { name: 'Continue investigation' }));
    expect(screen.getByRole('button', { name: 'Submit revision request' })).toBeDisabled();

    await user.type(screen.getByTestId('approval-card-revision-instructions-input'), 'a');
    expect(screen.getByRole('button', { name: 'Submit revision request' })).not.toBeDisabled();
  });

  it('ignores a direct form submit event carrying only whitespace instructions (defense in depth beyond the disabled button)', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

    await user.click(screen.getByRole('button', { name: 'Continue investigation' }));
    await user.type(screen.getByTestId('approval-card-revision-instructions-input'), '   ');
    fireEvent.submit(screen.getByTestId('approval-card-revision-form'));

    expect(onReview).not.toHaveBeenCalled();
    // The form stays open rather than silently discarding the attempt.
    expect(screen.getByTestId('approval-card-revision-form')).toBeInTheDocument();
  });

  it('allows cancelling the revision form without submitting', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(<ApprovalCard proposal={buildProposal()} onReview={onReview} />);

    await user.click(screen.getByRole('button', { name: 'Continue investigation' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('approval-card-revision-form')).not.toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });

  it('disables all controls and shows a busy state while a review is pending', () => {
    render(<ApprovalCard proposal={buildProposal()} onReview={vi.fn()} reviewPending />);

    const approveButton = screen.getByTestId('approval-card-approve');
    expect(approveButton).toBeDisabled();
    expect(approveButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('approval-card-reject')).toBeDisabled();
    expect(screen.getByTestId('approval-card-request-revision')).toBeDisabled();
  });

  it.each([
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
    ['revision_requested', 'Revision requested'],
  ] as const)(
    'renders a visually distinct settled "stamp" state for status %s',
    (status, expectedLabel) => {
      render(<ApprovalCard proposal={buildProposal({ status })} onReview={vi.fn()} />);

      const settled = screen.getByTestId('approval-card-settled');
      expect(settled).toBeInTheDocument();
      expect(screen.getByTestId('approval-card-stamp')).toHaveTextContent(expectedLabel);
      // No pending controls remain once a decision has settled.
      expect(screen.queryByTestId('approval-card-pending')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Select recommendation' }),
      ).not.toBeInTheDocument();
    },
  );

  it('shows revision instructions on a settled revision_requested proposal', () => {
    render(
      <ApprovalCard
        proposal={buildProposal({
          status: 'revision_requested',
          revisionInstructions: 'Re-check the trade-in value.',
        })}
        onReview={vi.fn()}
      />,
    );
    expect(screen.getByTestId('approval-card-revision-instructions')).toHaveTextContent(
      'Re-check the trade-in value.',
    );
  });

  describe('reviewer reason (the reason a human gave for their decision -- packages/contracts/src/case.ts DecisionProposal.reviewReason)', () => {
    it.each([
      ['approved' as const, 'We already booked our own technician.'],
      ['rejected' as const, 'We already booked our own technician.'],
    ])(
      "shows the reviewer's stated reason on a settled %s proposal, attributed to the reviewer",
      (status, reviewReason) => {
        render(
          <ApprovalCard proposal={buildProposal({ status, reviewReason })} onReview={vi.fn()} />,
        );
        const reason = screen.getByTestId('approval-card-review-reason');
        // "You said:" is this product's existing voice for attributing text to
        // the human, not the system -- see decision-orientation.ts's
        // `latestChangeOf`. A bare reproduction of the reason with no
        // attribution would read as Sift's own words.
        expect(reason).toHaveTextContent(/you said/i);
        expect(reason).toHaveTextContent(reviewReason);
      },
    );

    it('renders nothing -- no empty region, no placeholder -- when reviewReason is absent', () => {
      render(<ApprovalCard proposal={buildProposal({ status: 'approved' })} onReview={vi.fn()} />);
      expect(screen.queryByTestId('approval-card-review-reason')).not.toBeInTheDocument();
    });

    it('wraps a long (near the 2000-char schema limit) reason instead of overflowing', () => {
      const longReason = 'We already booked our own technician. '.repeat(50).slice(0, 1999);
      render(
        <ApprovalCard
          proposal={buildProposal({ status: 'rejected', reviewReason: longReason })}
          onReview={vi.fn()}
        />,
      );
      const reason = screen.getByTestId('approval-card-review-reason');
      expect(reason).toHaveTextContent(longReason.slice(0, 40));
      // Wrapping, not truncating clipping: no nowrap/pre and no fixed width
      // that would force horizontal scroll at 390/430px.
      expect(reason.className).not.toMatch(/whitespace-nowrap/);
    });
  });

  it('renders a recoverable error while the pending proposal and controls remain usable', () => {
    render(
      <ApprovalCard
        proposal={buildProposal()}
        onReview={vi.fn()}
        error="Could not submit your review. Please try again."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/could not submit your review/i);
    expect(screen.getByRole('button', { name: 'Select recommendation' })).toBeEnabled();
  });

  it('has no axe violations across empty, pending, revising, settled, and error states', async () => {
    const { container: empty } = render(<ApprovalCard proposal={null} onReview={vi.fn()} />);
    expect(await axe(empty)).toHaveNoViolations();

    const { container: pending } = render(
      <ApprovalCard proposal={buildProposal()} onReview={vi.fn()} />,
    );
    expect(await axe(pending)).toHaveNoViolations();

    const { container: settled } = render(
      <ApprovalCard proposal={buildProposal({ status: 'approved' })} onReview={vi.fn()} />,
    );
    expect(await axe(settled)).toHaveNoViolations();

    const { container: errored } = render(
      <ApprovalCard proposal={buildProposal()} onReview={vi.fn()} error="Submission failed." />,
    );
    expect(await axe(errored)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk', () => {
    const { overflowRisks } = renderAtNarrowWidth(
      <ApprovalCard proposal={buildProposal()} onReview={vi.fn()} />,
    );
    expect(overflowRisks).toEqual([]);
  });
});
