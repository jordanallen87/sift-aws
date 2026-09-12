export const CASE_WORKFLOW_STAGE_IDS = [
  'intake',
  'priorities',
  'analysis',
  'review',
  'decide',
] as const;

export type CaseWorkflowStageId = (typeof CASE_WORKFLOW_STAGE_IDS)[number];
export type CaseWorkflowStageState = 'complete' | 'current' | 'available' | 'unavailable';

export interface CaseWorkflowStage {
  readonly id: CaseWorkflowStageId;
  readonly label: string;
  readonly state: CaseWorkflowStageState;
}

export interface CaseWorkflowFacts {
  readonly intakeComplete: boolean;
  readonly prioritiesComplete: boolean;
  readonly analysisStarted: boolean;
  readonly analysisComplete: boolean;
  /**
   * Review's own work is possible: there is something to triage or compare.
   *
   * Distinct from `reviewComplete`, and the same kind of fact
   * `analysisStarted` already is. It exists because Review OWNS Quick Pick,
   * List, Compare, Board and filters (ADR 0016's stage-ownership table), and
   * those are usable from the moment a case has options -- long before a
   * recommendation exists. Without this, availability derived purely from
   * `analysisComplete` made Review unreachable on every un-investigated case,
   * so gating the option views on the stage that owns them would have taken
   * Keep/Unsure/Pass away entirely rather than giving it a home.
   */
  readonly reviewStarted: boolean;
  readonly reviewComplete: boolean;
  readonly decisionAvailable: boolean;
  readonly decided: boolean;
}

export interface CaseWorkflow {
  readonly recommendedStageId: CaseWorkflowStageId;
  readonly stages: readonly CaseWorkflowStage[];
}

const LABELS: Record<CaseWorkflowStageId, string> = {
  intake: 'Intake',
  priorities: 'Priorities',
  analysis: 'Analysis',
  review: 'Review',
  decide: 'Decide',
};

export function deriveCaseWorkflow(facts: CaseWorkflowFacts): CaseWorkflow {
  const completed: Record<CaseWorkflowStageId, boolean> = {
    intake: facts.intakeComplete,
    priorities: facts.prioritiesComplete,
    analysis: facts.analysisComplete,
    review: facts.reviewComplete,
    decide: facts.decided,
  };

  // A stage is reachable when its prerequisites are met OR when its own work
  // has demonstrably begun or finished. The second half matters: prerequisites
  // are derived from live case state, so an unresolved discovery topic can flip
  // `intakeComplete` back to false long after an investigation has produced
  // evidence, findings and a recommendation. Without it, a case that plainly
  // HAS analysis reports Analysis as locked and the person cannot reach their
  // own findings. This is also what makes ADR 0016's "completed steps are
  // revisitable" true rather than aspirational.
  const available: Record<CaseWorkflowStageId, boolean> = {
    intake: true,
    priorities: facts.intakeComplete || facts.prioritiesComplete,
    analysis:
      (facts.intakeComplete && facts.prioritiesComplete) ||
      facts.analysisStarted ||
      facts.analysisComplete,
    review: facts.analysisComplete || facts.reviewStarted || facts.reviewComplete,
    decide: facts.decisionAvailable || facts.decided,
  };

  let recommendedStageId: CaseWorkflowStageId = 'intake';
  if (facts.intakeComplete) recommendedStageId = 'priorities';
  if (facts.intakeComplete && facts.prioritiesComplete) recommendedStageId = 'analysis';
  // An investigation that is under way is where the person's attention belongs,
  // even before it has produced a recommendation.
  if (facts.analysisStarted && !facts.analysisComplete) recommendedStageId = 'analysis';
  if (facts.analysisComplete) recommendedStageId = 'review';
  // A proposal awaiting a person is the action, so it is the recommended
  // stage on its own. It deliberately does NOT require `reviewComplete`:
  // review stays revisitable and merely `available`, rather than being
  // back-filled as complete by the existence of the proposal.
  if (facts.decisionAvailable) recommendedStageId = 'decide';
  if (facts.decided) recommendedStageId = 'decide';

  return {
    recommendedStageId,
    stages: CASE_WORKFLOW_STAGE_IDS.map((id) => ({
      id,
      label: LABELS[id],
      state: completed[id]
        ? 'complete'
        : id === recommendedStageId
          ? 'current'
          : available[id]
            ? 'available'
            : 'unavailable',
    })),
  };
}
