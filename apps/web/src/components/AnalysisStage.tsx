import { ActivityIcon, LibraryIcon, SearchCheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface AnalysisStageProps {
  readonly findingsNeedingReview: number;
  readonly sourceCount: number;
  readonly activityCount: number;
  readonly onOpenFindings: () => void;
  readonly onOpenSources: () => void;
  readonly onOpenActivity: () => void;
}

export function AnalysisStage({
  findingsNeedingReview,
  sourceCount,
  activityCount,
  onOpenFindings,
  onOpenSources,
  onOpenActivity,
}: AnalysisStageProps): React.JSX.Element {
  return (
    <section
      data-testid="case-stage-analysis"
      aria-labelledby="case-stage-analysis-title"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-card p-[var(--space-4)]"
    >
      <div>
        <h2
          id="case-stage-analysis-title"
          className="font-display text-[length:var(--font-size-xl)]"
        >
          Analysis
        </h2>
        <p className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]">
          Follow what Sift checked, then review the evidence behind its conclusions.
        </p>
      </div>
      <div className="grid gap-[var(--space-2)]">
        <Button
          type="button"
          data-testid="case-stage-analysis-open-findings"
          variant="secondary"
          onClick={onOpenFindings}
          className="justify-start"
        >
          <SearchCheckIcon aria-hidden="true" />
          {findingsNeedingReview === 0
            ? 'No flagged findings'
            : `Review ${String(findingsNeedingReview)} flagged finding${findingsNeedingReview === 1 ? '' : 's'}`}
        </Button>
        <Button
          type="button"
          data-testid="case-stage-analysis-open-sources"
          variant="secondary"
          onClick={onOpenSources}
          className="justify-start"
        >
          <LibraryIcon aria-hidden="true" />
          {sourceCount === 0
            ? 'No sources yet'
            : `Open ${String(sourceCount)} source${sourceCount === 1 ? '' : 's'}`}
        </Button>
        <Button
          type="button"
          data-testid="case-stage-analysis-open-activity"
          variant="secondary"
          aria-label="View investigation activity"
          onClick={onOpenActivity}
          className="justify-start"
        >
          <ActivityIcon aria-hidden="true" />
          {activityCount > 0
            ? `${String(activityCount)} activity update${activityCount === 1 ? '' : 's'}`
            : 'Investigation activity'}
        </Button>
      </div>
    </section>
  );
}
