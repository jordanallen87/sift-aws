/**
 * The workspace's overlay/presentation state, held in one Zustand store
 * instead of ~17 `useState` calls near the top of `App.tsx`.
 *
 * WHY A STORE AT ALL. Every value here is read or written from somewhere
 * far away from where it is declared: the app bar opens Findings, the alert
 * banner opens Findings, the hero opens Findings, and the sheet itself is
 * mounted 400 lines below all three. Held as `useState`, each of those is a
 * separate `() => setFindingsSheetOpen(true)` threaded down as a prop, and
 * the only way to know what the whole overlay layer can do is to read the
 * component top to bottom. Named actions make the call sites say what they
 * mean and make this file the one place the answer lives.
 *
 * WHY THIS SLICE AND NOT THE REST OF `App.tsx`. What is here is exactly the
 * state that decides which overlay is showing and what it is showing it
 * about. It is deliberately NOT:
 *
 *  - server-synced state (`activeCaseId`, `installedPacks`), which has a
 *    canonical source and must keep deriving from it;
 *  - async status (`*Pending`/`*Error`, `workInFlight`), which belongs next
 *    to the request that owns its lifetime;
 *  - optimistic echoes of `CaseState` (`optimisticViewMode`,
 *    `optimisticFilters`, `quickPickPosition`, `boardPlacement`), which are
 *    temporary local guesses that a real snapshot overwrites.
 *
 * Mixing those in would make the store a second source of truth for things
 * the server already owns -- the failure this file exists to avoid, not one
 * to centralise.
 *
 * WHY NOTHING HERE MAY EVER PERSIST. docs/decisions/0005-workspace-view-
 * state-and-option-views.md draws a hard line between presentation and
 * decision state: "presentation filtering != criterion mutation ... a key
 * correctness requirement." Durable presentation state (view mode, focused
 * option, visible comparison rows) already has a home -- it lives on
 * `CaseState.view` and is written through `updateSelection()`, which
 * deliberately cannot advance `eventSequence`. THIS store is the other
 * half: the per-browser, per-session layer that is not shared with the
 * model and has no server representation at all. Whether a sheet is open is
 * not a fact about the decision. So nothing in this file may grow a fetch,
 * a command call, or a `localStorage` write; a value that needs to survive
 * a reload or reach ChatGPT belongs on `CaseState.view` instead, through
 * the command path ADR 0005 decision 1 specifies.
 */
import { create } from 'zustand';
import type { CaseWorkflowStageId } from './case-workflow.js';

/**
 * The values, split out from the actions below purely so `INITIAL_UI_STATE`
 * can be typed against exactly the fields that have a starting value.
 */
export interface UiOverlayState {
  /**
   * Runtime Inspector. `runtimeInspectorOpen` is the single mount gate;
   * `inspectingRunId` is `null` when it was opened generally (the app bar's
   * "Developer view", no run in hand) and `inspectingDebugEventId` is
   * `undefined` for every entry point except "Inspect event". The three are
   * only ever written together, by the four actions below, so they cannot
   * drift into a state like "open, no run, but focused on a run's event".
   */
  readonly runtimeInspectorOpen: boolean;
  readonly inspectingRunId: string | null;
  readonly inspectingDebugEventId: string | undefined;
  /** The first-run guide, opened once per browser by `App`'s own effect. */
  readonly firstRunGuideOpen: boolean;
  /**
   * Set when the first-run guide is dismissed, cleared once focus reaches
   * the app bar's Help control. It is a request that outlives the render it
   * was made in -- the guide can be dismissed before the app bar exists --
   * which is why it is state and not a direct `.focus()` call.
   */
  readonly helpFocusPending: boolean;
  readonly findingsSheetOpen: boolean;
  readonly manageOptionsSheetOpen: boolean;
  readonly stillCheckingSheetOpen: boolean;
  readonly decisionProfileSheetOpen: boolean;
  readonly notesSheetOpen: boolean;
  readonly addConcernSheetOpen: boolean;
  readonly prioritiesSheetOpen: boolean;
  readonly filterSheetOpen: boolean;
  readonly blindSpotSheetOpen: boolean;
  readonly referenceLibraryOpen: boolean;
  /**
   * Which option's detail profile is open, by id -- NOT the option record.
   * Holding the id means the open sheet re-derives from each new snapshot,
   * so a live run that adds evidence about this option updates the sheet
   * under the reader instead of freezing a copy taken when it opened.
   */
  readonly profileOptionId: string | null;
  /**
   * The workflow stage a person navigated to, overriding the one derived
   * from case state. `null` means "follow the recommendation" -- an absent
   * override, not a stage.
   */
  readonly workflowStageOverride: CaseWorkflowStageId | null;
}

export interface UiState extends UiOverlayState {
  readonly openDeveloperView: () => void;
  readonly inspectRun: (runId: string) => void;
  readonly inspectRunEvent: (runId: string, debugEventId: string) => void;
  readonly closeRuntimeInspector: () => void;

  readonly openFirstRunGuide: () => void;
  readonly closeFirstRunGuide: () => void;
  readonly requestHelpFocus: () => void;
  readonly clearHelpFocus: () => void;

  readonly openFindings: () => void;
  readonly closeFindings: () => void;
  readonly openManageOptions: () => void;
  readonly closeManageOptions: () => void;
  readonly openStillChecking: () => void;
  readonly closeStillChecking: () => void;
  readonly openDecisionProfile: () => void;
  readonly closeDecisionProfile: () => void;
  readonly openNotes: () => void;
  readonly closeNotes: () => void;
  readonly openAddConcern: () => void;
  readonly closeAddConcern: () => void;
  readonly openPriorities: () => void;
  readonly closePriorities: () => void;
  readonly openFilters: () => void;
  readonly closeFilters: () => void;
  readonly openBlindSpotReview: () => void;
  readonly closeBlindSpotReview: () => void;
  readonly openReferenceLibrary: () => void;
  readonly closeReferenceLibrary: () => void;

  readonly openOptionProfile: (optionId: string) => void;
  readonly closeOptionProfile: () => void;
  readonly setWorkflowStage: (stageId: CaseWorkflowStageId | null) => void;
}

/**
 * Every field's starting value in one object, so `resetUiStore()` below
 * cannot fall behind the store as fields are added.
 */
const INITIAL_UI_STATE: UiOverlayState = {
  runtimeInspectorOpen: false,
  inspectingRunId: null,
  inspectingDebugEventId: undefined,
  firstRunGuideOpen: false,
  helpFocusPending: false,
  findingsSheetOpen: false,
  manageOptionsSheetOpen: false,
  stillCheckingSheetOpen: false,
  decisionProfileSheetOpen: false,
  notesSheetOpen: false,
  addConcernSheetOpen: false,
  prioritiesSheetOpen: false,
  filterSheetOpen: false,
  blindSpotSheetOpen: false,
  referenceLibraryOpen: false,
  profileOptionId: null,
  workflowStageOverride: null,
};

export const useUiStore = create<UiState>()((set) => ({
  ...INITIAL_UI_STATE,

  // The Inspector's four entry points each set all three fields rather than
  // only the one they care about. Opening to a run must clear a focused
  // event left behind by an earlier "Inspect event", or the sheet reopens
  // scrolled to an event from a different run.
  openDeveloperView: () =>
    set({ runtimeInspectorOpen: true, inspectingRunId: null, inspectingDebugEventId: undefined }),
  inspectRun: (runId) =>
    set({ runtimeInspectorOpen: true, inspectingRunId: runId, inspectingDebugEventId: undefined }),
  inspectRunEvent: (runId, debugEventId) =>
    set({
      runtimeInspectorOpen: true,
      inspectingRunId: runId,
      inspectingDebugEventId: debugEventId,
    }),
  closeRuntimeInspector: () =>
    set({ runtimeInspectorOpen: false, inspectingRunId: null, inspectingDebugEventId: undefined }),

  openFirstRunGuide: () => set({ firstRunGuideOpen: true }),
  closeFirstRunGuide: () => set({ firstRunGuideOpen: false }),
  requestHelpFocus: () => set({ helpFocusPending: true }),
  clearHelpFocus: () => set({ helpFocusPending: false }),

  openFindings: () => set({ findingsSheetOpen: true }),
  closeFindings: () => set({ findingsSheetOpen: false }),
  openManageOptions: () => set({ manageOptionsSheetOpen: true }),
  closeManageOptions: () => set({ manageOptionsSheetOpen: false }),
  openStillChecking: () => set({ stillCheckingSheetOpen: true }),
  closeStillChecking: () => set({ stillCheckingSheetOpen: false }),
  openDecisionProfile: () => set({ decisionProfileSheetOpen: true }),
  closeDecisionProfile: () => set({ decisionProfileSheetOpen: false }),
  openNotes: () => set({ notesSheetOpen: true }),
  closeNotes: () => set({ notesSheetOpen: false }),
  openAddConcern: () => set({ addConcernSheetOpen: true }),
  closeAddConcern: () => set({ addConcernSheetOpen: false }),
  openPriorities: () => set({ prioritiesSheetOpen: true }),
  closePriorities: () => set({ prioritiesSheetOpen: false }),
  openFilters: () => set({ filterSheetOpen: true }),
  closeFilters: () => set({ filterSheetOpen: false }),
  openBlindSpotReview: () => set({ blindSpotSheetOpen: true }),
  closeBlindSpotReview: () => set({ blindSpotSheetOpen: false }),
  openReferenceLibrary: () => set({ referenceLibraryOpen: true }),
  closeReferenceLibrary: () => set({ referenceLibraryOpen: false }),

  openOptionProfile: (optionId) => set({ profileOptionId: optionId }),
  // Closing clears the id rather than leaving a stale option selected
  // behind a shut sheet -- the sheet's `open` is derived from the id.
  closeOptionProfile: () => set({ profileOptionId: null }),
  setWorkflowStage: (stageId) => set({ workflowStageOverride: stageId }),
}));

/**
 * Returns every field to its initial value.
 *
 * A Zustand store is a module singleton, so unlike `useState` it survives
 * Testing Library's `cleanup()` and would carry an open sheet from one test
 * into the next. `apps/web/src/test/setup.ts` calls this between tests. The
 * application itself never needs it: a browser reload is the only thing
 * that resets session-scoped presentation state, and that reloads the
 * module too.
 */
export function resetUiStore(): void {
  useUiStore.setState(INITIAL_UI_STATE);
}
