import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaseWorkflowStepper } from './CaseWorkflowStepper.js';
import type { CaseWorkflowStage } from '../app/case-workflow.js';

const stages: CaseWorkflowStage[] = [
  { id: 'intake', label: 'Intake', state: 'complete' },
  { id: 'priorities', label: 'Priorities', state: 'complete' },
  { id: 'analysis', label: 'Analysis', state: 'current' },
  { id: 'review', label: 'Review', state: 'unavailable' },
  { id: 'decide', label: 'Decide', state: 'unavailable' },
];

describe('CaseWorkflowStepper', () => {
  it('names the current stage and ordinal progress without showing a five-tab strip', () => {
    render(
      <CaseWorkflowStepper
        layout="narrow"
        stages={stages}
        activeStageId="analysis"
        onStageChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analysis, step 3 of 5/i })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lets a person revisit a completed step and prevents unavailable navigation', async () => {
    const user = userEvent.setup();
    const onStageChange = vi.fn();
    render(
      <CaseWorkflowStepper
        layout="narrow"
        stages={stages}
        activeStageId="analysis"
        onStageChange={onStageChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /analysis, step 3 of 5/i }));
    expect(screen.getByRole('button', { name: /^review, unavailable$/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^intake, complete$/i }));

    expect(onStageChange).toHaveBeenCalledWith('intake');
  });

  describe('expanded layout', () => {
    // The gap this suite exists to close: while the stepper was narrow-only,
    // every one of these was simply absent above 800px and no test could
    // see it, because the component was never rendered at that width.
    it('shows all five labels at once, with no compact dropdown to open', () => {
      render(
        <CaseWorkflowStepper
          layout="expanded"
          stages={stages}
          activeStageId="analysis"
          onStageChange={vi.fn()}
        />,
      );

      for (const stage of stages) {
        expect(screen.getByTestId(`case-workflow-step-${stage.id}`)).toBeVisible();
      }
      // Every label visible makes the ordinal redundant, and the toggle has
      // nothing left to reveal.
      expect(screen.queryByTestId('case-workflow-stepper-toggle')).not.toBeInTheDocument();
      expect(screen.queryByText(/step \d of \d/i)).not.toBeInTheDocument();
    });

    it('marks the active stage as the current step for assistive technology', () => {
      render(
        <CaseWorkflowStepper
          layout="expanded"
          stages={stages}
          activeStageId="analysis"
          onStageChange={vi.fn()}
        />,
      );

      expect(screen.getByTestId('case-workflow-step-analysis')).toHaveAttribute(
        'aria-current',
        'step',
      );
      expect(screen.getByTestId('case-workflow-step-intake')).not.toHaveAttribute('aria-current');
    });

    it('disables a stage whose prerequisites are not met, and leaves reachable ones operable', async () => {
      const onStageChange = vi.fn();
      const user = userEvent.setup();
      render(
        <CaseWorkflowStepper
          layout="expanded"
          stages={stages}
          activeStageId="analysis"
          onStageChange={onStageChange}
        />,
      );

      expect(screen.getByTestId('case-workflow-step-review')).toBeDisabled();
      await user.click(screen.getByTestId('case-workflow-step-intake'));
      expect(onStageChange).toHaveBeenCalledWith('intake');
    });

    it('announces each stage state in its accessible name, not by colour alone', () => {
      render(
        <CaseWorkflowStepper
          layout="expanded"
          stages={stages}
          activeStageId="analysis"
          onStageChange={vi.fn()}
        />,
      );

      expect(screen.getByTestId('case-workflow-step-intake')).toHaveAttribute(
        'aria-label',
        'Intake, complete',
      );
      expect(screen.getByTestId('case-workflow-step-analysis')).toHaveAttribute(
        'aria-label',
        'Analysis, current',
      );
      expect(screen.getByTestId('case-workflow-step-review')).toHaveAttribute(
        'aria-label',
        'Review, unavailable',
      );
    });
  });
});
