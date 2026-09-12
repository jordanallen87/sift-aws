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
      <CaseWorkflowStepper stages={stages} activeStageId="analysis" onStageChange={vi.fn()} />,
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
});
