import { describe, expect, it } from 'vitest';
import { deriveCaseWorkflow } from './case-workflow.js';

describe('deriveCaseWorkflow', () => {
  it('returns the five guided stages in their canonical order', () => {
    const workflow = deriveCaseWorkflow({
      intakeComplete: false,
      prioritiesComplete: false,
      analysisStarted: false,
      analysisComplete: false,
      reviewComplete: false,
      decisionAvailable: false,
      decided: false,
    });

    expect(workflow.stages.map((stage) => stage.id)).toEqual([
      'intake',
      'priorities',
      'analysis',
      'review',
      'decide',
    ]);
    expect(workflow.recommendedStageId).toBe('intake');
  });

  it('recommends analysis when intake and priorities are complete', () => {
    const workflow = deriveCaseWorkflow({
      intakeComplete: true,
      prioritiesComplete: true,
      analysisStarted: true,
      analysisComplete: false,
      reviewComplete: false,
      decisionAvailable: false,
      decided: false,
    });

    expect(workflow.recommendedStageId).toBe('analysis');
    expect(workflow.stages.find((stage) => stage.id === 'analysis')?.state).toBe('current');
    expect(workflow.stages.find((stage) => stage.id === 'decide')?.state).toBe('unavailable');
  });

  it('recommends Decide when a proposal is available and marks it complete after decision', () => {
    const pending = deriveCaseWorkflow({
      intakeComplete: true,
      prioritiesComplete: true,
      analysisStarted: true,
      analysisComplete: true,
      reviewComplete: true,
      decisionAvailable: true,
      decided: false,
    });
    const settled = deriveCaseWorkflow({
      intakeComplete: true,
      prioritiesComplete: true,
      analysisStarted: true,
      analysisComplete: true,
      reviewComplete: true,
      decisionAvailable: true,
      decided: true,
    });

    expect(pending.recommendedStageId).toBe('decide');
    expect(settled.stages.at(-1)?.state).toBe('complete');
  });

  // The regression that made the stepper unusable on a real case: stage
  // availability was computed purely from upstream prerequisites, and
  // `analysisStarted` was accepted as a fact and then never read. A case that
  // had genuinely produced evidence, findings and a recommendation still
  // reported Analysis as `unavailable` whenever a discovery topic went
  // unresolved, so the person could not reach their own findings at all.
  it('keeps a stage reachable once its own work exists, even if an upstream prerequisite is not satisfied', () => {
    const workflow = deriveCaseWorkflow({
      intakeComplete: false,
      prioritiesComplete: false,
      analysisStarted: true,
      analysisComplete: true,
      reviewComplete: false,
      decisionAvailable: false,
      decided: false,
    });

    const stateOf = (id: string) => workflow.stages.find((stage) => stage.id === id)?.state;
    expect(stateOf('analysis')).toBe('complete');
    expect(stateOf('review')).not.toBe('unavailable');
    expect(workflow.recommendedStageId).toBe('review');
  });

  it('reads analysisStarted: an investigation under way is the recommended stage before it finishes', () => {
    const running = deriveCaseWorkflow({
      intakeComplete: false,
      prioritiesComplete: false,
      analysisStarted: true,
      analysisComplete: false,
      reviewComplete: false,
      decisionAvailable: false,
      decided: false,
    });
    const notStarted = deriveCaseWorkflow({
      intakeComplete: false,
      prioritiesComplete: false,
      analysisStarted: false,
      analysisComplete: false,
      reviewComplete: false,
      decisionAvailable: false,
      decided: false,
    });

    expect(running.recommendedStageId).toBe('analysis');
    expect(running.stages.find((stage) => stage.id === 'analysis')?.state).toBe('current');
    // The same facts with the run flag off must NOT land on analysis -- that is
    // what proves the flag is genuinely read rather than incidentally true.
    expect(notStarted.recommendedStageId).toBe('intake');
    expect(notStarted.stages.find((stage) => stage.id === 'analysis')?.state).toBe('unavailable');
  });

  it('does not back-fill Review as complete just because a proposal exists', () => {
    const pendingProposal = deriveCaseWorkflow({
      intakeComplete: true,
      prioritiesComplete: true,
      analysisStarted: true,
      analysisComplete: true,
      reviewComplete: false,
      decisionAvailable: true,
      decided: false,
    });

    const review = pendingProposal.stages.find((stage) => stage.id === 'review');
    // Revisitable, not falsely finished -- the person has not reviewed anything
    // yet. Decide is still where their attention belongs, because a pending
    // proposal is the action awaiting them.
    expect(review?.state).toBe('available');
    expect(pendingProposal.recommendedStageId).toBe('decide');

    const settled = deriveCaseWorkflow({
      intakeComplete: true,
      prioritiesComplete: true,
      analysisStarted: true,
      analysisComplete: true,
      reviewComplete: true,
      decisionAvailable: true,
      decided: true,
    });
    expect(settled.stages.find((stage) => stage.id === 'review')?.state).toBe('complete');
  });
});
