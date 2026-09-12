/**
 * Tests for the workspace's overlay store (./ui-store.ts).
 *
 * The store is exercised through `getState()` rather than through a
 * rendered component on purpose: what is under test here is the state
 * machine -- which fields an action writes, and just as importantly which
 * ones it leaves alone -- not the wiring from a button to it. `App.test.tsx`
 * already covers the wiring, by opening each sheet from its real control.
 *
 * `resetUiStore()` runs between tests because a Zustand store is a module
 * singleton: without it, the sheet one test opens is still open in the next.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetUiStore, useUiStore } from './ui-store.js';

/** Every boolean overlay flag, paired with the actions that raise and lower it. */
const OVERLAY_FLAGS = [
  ['findingsSheetOpen', 'openFindings', 'closeFindings'],
  ['manageOptionsSheetOpen', 'openManageOptions', 'closeManageOptions'],
  ['stillCheckingSheetOpen', 'openStillChecking', 'closeStillChecking'],
  ['decisionProfileSheetOpen', 'openDecisionProfile', 'closeDecisionProfile'],
  ['notesSheetOpen', 'openNotes', 'closeNotes'],
  ['addConcernSheetOpen', 'openAddConcern', 'closeAddConcern'],
  ['prioritiesSheetOpen', 'openPriorities', 'closePriorities'],
  ['filterSheetOpen', 'openFilters', 'closeFilters'],
  ['blindSpotSheetOpen', 'openBlindSpotReview', 'closeBlindSpotReview'],
  ['referenceLibraryOpen', 'openReferenceLibrary', 'closeReferenceLibrary'],
  ['firstRunGuideOpen', 'openFirstRunGuide', 'closeFirstRunGuide'],
] as const;

describe('useUiStore', () => {
  beforeEach(() => {
    resetUiStore();
  });

  it('starts with every overlay closed and nothing focused', () => {
    const state = useUiStore.getState();

    for (const [flag] of OVERLAY_FLAGS) {
      expect(state[flag]).toBe(false);
    }
    expect(state.runtimeInspectorOpen).toBe(false);
    expect(state.inspectingRunId).toBeNull();
    expect(state.inspectingDebugEventId).toBeUndefined();
    expect(state.helpFocusPending).toBe(false);
    expect(state.profileOptionId).toBeNull();
    expect(state.workflowStageOverride).toBeNull();
  });

  describe.each(OVERLAY_FLAGS)('%s', (flag, openAction, closeAction) => {
    it('opens and closes', () => {
      useUiStore.getState()[openAction]();
      expect(useUiStore.getState()[flag]).toBe(true);

      useUiStore.getState()[closeAction]();
      expect(useUiStore.getState()[flag]).toBe(false);
    });

    // The reason the store is one store rather than a flag per component:
    // a shared object is only safe if writing one field provably cannot
    // disturb another. Every other overlay must be exactly as it was.
    it('leaves every other overlay untouched', () => {
      const before = useUiStore.getState();
      useUiStore.getState()[openAction]();
      const after = useUiStore.getState();

      for (const [otherFlag] of OVERLAY_FLAGS) {
        if (otherFlag === flag) continue;
        expect(after[otherFlag]).toBe(before[otherFlag]);
      }
      expect(after.runtimeInspectorOpen).toBe(before.runtimeInspectorOpen);
      expect(after.profileOptionId).toBe(before.profileOptionId);
      expect(after.workflowStageOverride).toBe(before.workflowStageOverride);
      expect(after.helpFocusPending).toBe(before.helpFocusPending);
    });
  });

  it('keeps a second open sheet from closing the first', () => {
    useUiStore.getState().openFindings();
    useUiStore.getState().openFilters();

    expect(useUiStore.getState().findingsSheetOpen).toBe(true);
    expect(useUiStore.getState().filterSheetOpen).toBe(true);

    useUiStore.getState().closeFilters();

    expect(useUiStore.getState().findingsSheetOpen).toBe(true);
    expect(useUiStore.getState().filterSheetOpen).toBe(false);
  });

  describe('option profile', () => {
    it('round-trips the option id it was opened with', () => {
      useUiStore.getState().openOptionProfile('option-cedar');

      expect(useUiStore.getState().profileOptionId).toBe('option-cedar');
    });

    it('re-targets an already-open profile rather than needing a close first', () => {
      useUiStore.getState().openOptionProfile('option-cedar');
      useUiStore.getState().openOptionProfile('option-northgate');

      expect(useUiStore.getState().profileOptionId).toBe('option-northgate');
    });

    // The sheet's `open` is derived from the id, so a close that left the id
    // behind would reopen the sheet on the stale option the next time
    // anything re-rendered.
    it('clears the id when closed', () => {
      useUiStore.getState().openOptionProfile('option-cedar');
      useUiStore.getState().closeOptionProfile();

      expect(useUiStore.getState().profileOptionId).toBeNull();
    });
  });

  describe('workflow stage override', () => {
    it('round-trips the stage it was set to', () => {
      useUiStore.getState().setWorkflowStage('analysis');

      expect(useUiStore.getState().workflowStageOverride).toBe('analysis');
    });

    // `null` is not a stage: it means "no override", which is what returns
    // the stepper to the stage derived from case state.
    it('accepts null to return to the recommended stage', () => {
      useUiStore.getState().setWorkflowStage('decide');
      useUiStore.getState().setWorkflowStage(null);

      expect(useUiStore.getState().workflowStageOverride).toBeNull();
    });

    it('does not open or close any overlay', () => {
      useUiStore.getState().openFindings();
      useUiStore.getState().setWorkflowStage('review');

      expect(useUiStore.getState().findingsSheetOpen).toBe(true);
      expect(useUiStore.getState().filterSheetOpen).toBe(false);
    });
  });

  describe('runtime inspector', () => {
    it('opens the general developer view with no run or event in hand', () => {
      useUiStore.getState().openDeveloperView();

      const state = useUiStore.getState();
      expect(state.runtimeInspectorOpen).toBe(true);
      expect(state.inspectingRunId).toBeNull();
      expect(state.inspectingDebugEventId).toBeUndefined();
    });

    it('round-trips the run id it was opened on', () => {
      useUiStore.getState().inspectRun('run-42');

      const state = useUiStore.getState();
      expect(state.runtimeInspectorOpen).toBe(true);
      expect(state.inspectingRunId).toBe('run-42');
      expect(state.inspectingDebugEventId).toBeUndefined();
    });

    it('round-trips both ids when opened on a specific event', () => {
      useUiStore.getState().inspectRunEvent('run-42', 'debug-event-7');

      const state = useUiStore.getState();
      expect(state.runtimeInspectorOpen).toBe(true);
      expect(state.inspectingRunId).toBe('run-42');
      expect(state.inspectingDebugEventId).toBe('debug-event-7');
    });

    // The whole reason these three fields move together: reopening on a run
    // must not inherit the focused event of a different run.
    it('clears a previously focused event when reopened on a run', () => {
      useUiStore.getState().inspectRunEvent('run-42', 'debug-event-7');
      useUiStore.getState().inspectRun('run-43');

      const state = useUiStore.getState();
      expect(state.inspectingRunId).toBe('run-43');
      expect(state.inspectingDebugEventId).toBeUndefined();
    });

    it('clears a previously focused run when reopened as the general view', () => {
      useUiStore.getState().inspectRunEvent('run-42', 'debug-event-7');
      useUiStore.getState().openDeveloperView();

      const state = useUiStore.getState();
      expect(state.inspectingRunId).toBeNull();
      expect(state.inspectingDebugEventId).toBeUndefined();
    });

    it('clears all three fields on close', () => {
      useUiStore.getState().inspectRunEvent('run-42', 'debug-event-7');
      useUiStore.getState().closeRuntimeInspector();

      const state = useUiStore.getState();
      expect(state.runtimeInspectorOpen).toBe(false);
      expect(state.inspectingRunId).toBeNull();
      expect(state.inspectingDebugEventId).toBeUndefined();
    });

    it('leaves the sheets alone', () => {
      useUiStore.getState().openFindings();
      useUiStore.getState().inspectRun('run-42');

      expect(useUiStore.getState().findingsSheetOpen).toBe(true);
    });
  });

  describe('help focus', () => {
    it('raises and clears the pending flag', () => {
      useUiStore.getState().requestHelpFocus();
      expect(useUiStore.getState().helpFocusPending).toBe(true);

      useUiStore.getState().clearHelpFocus();
      expect(useUiStore.getState().helpFocusPending).toBe(false);
    });

    it('is independent of the first-run guide that raises it', () => {
      useUiStore.getState().openFirstRunGuide();
      useUiStore.getState().requestHelpFocus();
      useUiStore.getState().closeFirstRunGuide();

      expect(useUiStore.getState().firstRunGuideOpen).toBe(false);
      expect(useUiStore.getState().helpFocusPending).toBe(true);
    });
  });

  describe('resetUiStore', () => {
    it('returns every field to its initial value', () => {
      useUiStore.getState().openFindings();
      useUiStore.getState().openFilters();
      useUiStore.getState().inspectRunEvent('run-42', 'debug-event-7');
      useUiStore.getState().openOptionProfile('option-cedar');
      useUiStore.getState().setWorkflowStage('decide');
      useUiStore.getState().requestHelpFocus();

      resetUiStore();

      const state = useUiStore.getState();
      for (const [flag] of OVERLAY_FLAGS) {
        expect(state[flag]).toBe(false);
      }
      expect(state.runtimeInspectorOpen).toBe(false);
      expect(state.inspectingRunId).toBeNull();
      expect(state.inspectingDebugEventId).toBeUndefined();
      expect(state.profileOptionId).toBeNull();
      expect(state.workflowStageOverride).toBeNull();
      expect(state.helpFocusPending).toBe(false);
    });

    it('leaves the actions callable', () => {
      resetUiStore();
      useUiStore.getState().openFindings();

      expect(useUiStore.getState().findingsSheetOpen).toBe(true);
    });
  });
});
