import { CheckIcon, ChevronDownIcon, CircleAlertIcon, LockIcon } from 'lucide-react';
import { useState } from 'react';
import type { CaseWorkflowStage, CaseWorkflowStageId } from '../app/case-workflow.js';
import { Button } from '@/components/ui/button';

export interface CaseWorkflowStepperProps {
  readonly stages: readonly CaseWorkflowStage[];
  readonly activeStageId: CaseWorkflowStageId;
  readonly onStageChange: (stageId: CaseWorkflowStageId) => void;
  /**
   * Which presentation to render. ADR 0016 specifies both and only the
   * narrow one was built: "At narrow width the persistent header shows only
   * the current step, ordinal progress, and a compact progress affordance...
   * Wider layouts may show all labels when they fit."
   *
   * Until this existed the whole guided workflow was invisible above 800px
   * -- a desktop window got the pre-redesign layout and no stepper at all,
   * which is not a smaller version of the design but an absence of it.
   */
  readonly layout: 'narrow' | 'expanded';
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
  layout,
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

  // Expanded: all five labels on one row, because they fit. The ordinal
  // ("step 3 of 5") is dropped -- with every step visible and its own state
  // rendered, counting them for the reader adds nothing the row does not
  // already say. Narrow keeps the ordinal precisely because the other four
  // are hidden.
  if (layout === 'expanded') {
    return (
      <section
        data-testid="case-workflow-stepper"
        aria-label="Case progress"
        className="relative shrink-0 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)] px-[var(--space-6)] py-[var(--space-2)]"
      >
        <ol className="flex flex-wrap items-center gap-[var(--space-1)]">
          {stages.map((stage, index) => (
            <li key={stage.id} className="flex items-center gap-[var(--space-1)]">
              <Button
                type="button"
                variant={stage.id === activeStageId ? 'secondary' : 'ghost'}
                data-testid={`case-workflow-step-${stage.id}`}
                disabled={stage.state === 'unavailable'}
                aria-current={stage.id === activeStageId ? 'step' : undefined}
                aria-label={`${stage.label}, ${stageAccessibleState(stage)}`}
                onClick={() => {
                  onStageChange(stage.id);
                }}
                size="sm"
              >
                <span className="inline-flex size-5 items-center justify-center" aria-hidden="true">
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
              {index < total - 1 ? (
                <span
                  aria-hidden="true"
                  className="text-[color:var(--color-ink-muted)] select-none"
                >
                  ›
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    );
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
