import { CheckIcon, ChevronDownIcon, CircleAlertIcon, LockIcon } from 'lucide-react';
import { useState } from 'react';
import type { CaseWorkflowStage, CaseWorkflowStageId } from '../app/case-workflow.js';
import { Button } from '@/components/ui/button';

export interface CaseWorkflowStepperProps {
  readonly stages: readonly CaseWorkflowStage[];
  readonly activeStageId: CaseWorkflowStageId;
  readonly onStageChange: (stageId: CaseWorkflowStageId) => void;
}

function stageAccessibleState(stage: CaseWorkflowStage): string {
  if (stage.state === 'complete') return 'complete';
  if (stage.state === 'unavailable') return 'unavailable';
  if (stage.state === 'current') return 'current';
  return 'available';
}

export function CaseWorkflowStepper({
  stages,
  activeStageId,
  onStageChange,
}: CaseWorkflowStepperProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const activeIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === activeStageId),
  );
  const active = stages[activeIndex] ?? stages[0];
  const total = stages.length;

  if (active === undefined) {
    return <></>;
  }

  return (
    <section
      data-testid="case-workflow-stepper"
      aria-label="Case progress"
      className="relative shrink-0 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]"
    >
      <Button
        type="button"
        variant="ghost"
        data-testid="case-workflow-stepper-toggle"
        aria-expanded={open}
        aria-controls="case-workflow-step-list"
        aria-label={`${active.label}, step ${String(activeIndex + 1)} of ${String(total)}`}
        onClick={() => setOpen((value) => !value)}
        className="h-auto w-full justify-between rounded-none px-[var(--space-4)] py-[var(--space-3)] text-left"
      >
        <span className="flex min-w-0 flex-col items-start gap-[var(--space-0-5)]">
          <span className="text-[length:var(--font-size-xs)] font-normal text-[color:var(--color-ink-muted)]">
            {`Step ${String(activeIndex + 1)} of ${String(total)}`}
          </span>
          <span className="font-semibold text-[color:var(--color-ink)]">{active.label}</span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={
            open ? 'size-5 rotate-180 transition-transform' : 'size-5 transition-transform'
          }
        />
      </Button>

      <div className="h-1 bg-[color:var(--color-surface-sunken)]" aria-hidden="true">
        <div
          className="h-full bg-[color:var(--color-brand)] transition-[width]"
          style={{ width: `${String(((activeIndex + 1) / Math.max(total, 1)) * 100)}%` }}
        />
      </div>

      {open ? (
        <ol
          id="case-workflow-step-list"
          className="grid gap-[var(--space-1)] border-t border-[color:var(--color-border)] p-[var(--space-2)]"
        >
          {stages.map((stage, index) => {
            const disabled = stage.state === 'unavailable';
            const selected = stage.id === activeStageId;
            return (
              <li key={stage.id}>
                <Button
                  type="button"
                  variant={selected ? 'secondary' : 'ghost'}
                  data-testid={`case-workflow-step-${stage.id}`}
                  disabled={disabled}
                  aria-current={selected ? 'step' : undefined}
                  aria-label={`${stage.label}, ${stageAccessibleState(stage)}`}
                  onClick={() => {
                    onStageChange(stage.id);
                    setOpen(false);
                  }}
                  className="w-full justify-start"
                >
                  <span
                    className="inline-flex size-5 items-center justify-center"
                    aria-hidden="true"
                  >
                    {stage.state === 'complete' ? (
                      <CheckIcon className="size-4 text-[color:var(--color-status-satisfied-ink)]" />
                    ) : stage.state === 'unavailable' ? (
                      <LockIcon className="size-4" />
                    ) : stage.state === 'current' ? (
                      <CircleAlertIcon className="size-4 text-[color:var(--color-status-active-ink)]" />
                    ) : (
                      <span>{String(index + 1)}</span>
                    )}
                  </span>
                  <span>{stage.label}</span>
                </Button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
