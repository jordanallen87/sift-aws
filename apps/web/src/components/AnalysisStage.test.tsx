import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisStage } from './AnalysisStage.js';

describe('AnalysisStage', () => {
  it('groups findings, sources, and activity under Analysis with truthful counts', async () => {
    const user = userEvent.setup();
    const onOpenFindings = vi.fn();
    const onOpenSources = vi.fn();
    const onOpenActivity = vi.fn();
    render(
      <AnalysisStage
        findingsNeedingReview={3}
        sourceCount={20}
        activityCount={12}
        onOpenFindings={onOpenFindings}
        onOpenSources={onOpenSources}
        onOpenActivity={onOpenActivity}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Analysis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review 3 flagged findings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open 20 sources' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View investigation activity' }));
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
  });
});
