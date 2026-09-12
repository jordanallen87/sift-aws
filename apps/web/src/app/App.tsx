/**
 * The route-free launcher/workspace shell (locked file map:
 * `apps/web/src/app/App.tsx  Route-free launcher/workspace shell`).
 *
 * product.md's "Primary experience" describes one page, not a multi-page
 * site: "The page contains a seeded demo launcher and the active case
 * workspace." There is no router -- `App` is a plain state machine. While
 * `activeCaseId === null`, `launcherMode` picks between `DemoLauncher`
 * (`startDemo`/two example cases) and `VehicleCatalogFlow`
 * (`startCase` + `upsertOption`, docs/decisions/0003-vehicle-catalog-and-
 * normal-case-creation.md's "Compare vehicles" primary entry point); either
 * one calling back with a real receipt sets `activeCaseId` and renders the
 * live case workspace below.
 *
 * The workspace is wired to real data: `useCaseEvents` (the real SSE/poll-
 * fallback subscription) supplies the canonical `CaseState` snapshot and
 * ordered `PublicActivityEvent[]` every region below renders from;
 * `registerSiftTools` mounts the full WebMCP catalog only while a case is
 * active, re-registering its case-scoped tools whenever the active case
 * changes; every visible control calls through the one shared
 * `SiftCommands` instance from `useSiftCommands()` -- there is no parallel
 * mutation path (docs/engineering-principles.md "Visible UI controls and WebMCP callbacks use
 * the same command implementation").
 *
 * TWO-MODE LAYOUT (rewritten this task per `docs/decisions/
 * 0008-two-mode-product-architecture.md`, replacing the single "one column
 * that gets wider" stack the ADR's own screenshot -- five identical
 * collapsible rows crammed at the bottom of the page -- was built on top
 * of). The project owner's verdict, quoted directly in the ADR: "These
 * bottom sections should be at the top, but not in this format... if it
 * finds things, wouldn't we want to surface that at the top and stand out
 * so the user clicks on it? Right now you've got it at the bottom - they'll
 * never even see it... You literally just crammed everything into a
 * collapsible section." And on the product as a whole: "It's supposed to
 * emulate a shopping website at full width. When it's in the side pane,
 * it's in WebMCP mode."
 *
 * `layout = useWidthMode()` is read exactly ONCE, here, and threaded down
 * as a plain prop -- the same discipline `WorkspaceAppBar.tsx`/
 * `WorkspaceAlertBanner.tsx`/`WorkspaceSidebar.tsx`/`OptionCompareView.tsx`
 * already establish ("this component never calls matchMedia itself"). jsdom
 * has no `matchMedia`, so every test in this file that does not explicitly
 * `vi.stubGlobal('matchMedia', ...)` exercises the `narrow` branch below --
 * expanded-mode behavior is covered by the tests that do stub it (see
 * `stubExpandedLayout()`).
 *
 * GLOBAL CHROME (both modes, rendered once, above the layout branch):
 *
 *  1. `WorkspaceAppBar` -- supersedes `CaseHeader` (title, connection
 *     status, reset, developer view) AND absorbs two former bottom-of-page
 *     actions with real top-of-page visual weight: "Add option" (formerly
 *     the "Manage options" disclosure wrapping `OptionEditor`) and
 *     "Findings" (formerly the "What Sift found" disclosure-as-button).
 *     `CaseHeader.tsx` itself is UNCHANGED and still exported/tested on its
 *     own (`CaseHeader.test.tsx`) -- nothing else in the app renders it any
 *     more (confirmed: `grep -rn '<CaseHeader' apps/web/src` matches only
 *     this file's own former usage and that component's own test file), so
 *     it is orphaned-but-intact, not deleted, exactly as this task requires.
 *  2. `WorkspaceAlertBanner` -- real, differentiated alerts DERIVED from
 *     canonical state (`alertItems` below): findings needing review, a
 *     recommendation ready for decision, a pending agent-proposed case
 *     extension, or a lost connection. Renders nothing at all when none of
 *     those are true -- never a fabricated "all clear" notice.
 *  3. `WebMcpStatus` / `ErrorState` -- unchanged content and behavior, only
 *     moved below the alert banner so the "stand out" chrome the owner
 *     asked for is never separated from the app bar by quieter status text.
 *  4. `RecommendationHero` -- unchanged: still the answer-first hero, still
 *     the first substantial content after the chrome above, in both modes,
 *     verified by the same DOM-order test this task updates rather than
 *     removes.
 *
 * WEB APP MODE (`layout === 'expanded'`, ADR 0008 decision 2) -- a
 * persistent left `WorkspaceSidebar` beside a main column holding the
 * primary view switcher:
 *
 *  - Sidebar: priorities (`decisionProfile`, read-only ranked list) and a
 *    "Still checking" count/button. Both were disclosure rows before ADR
 *    0008, which moved them into the persistent column a "shopping site"
 *    shell is expected to have.
 *
 *    Filters USED to live here too, and no longer do (ADR 0009). Two
 *    reasons, both found by looking at the running product: the filter list
 *    ran longer than the main column at 1440, and -- more seriously --
 *    `WorkspaceSidebar` renders `null` at `layout: 'narrow'`, so filters
 *    living in it meant pane/WebMCP mode had NO filter entry point at all,
 *    contradicting ADR 0008's "still has to have the same functionalities."
 *    They now live in a `FilterSheet` mounted as global chrome, opened from
 *    a `FilterBar` that both shells render above their view switcher.
 *  - Main column: a small utility toolbar (this file's own plain buttons,
 *    not a locked component -- `workspace-expanded-open-*` testids) for the
 *    three regions that have no natural sidebar slot -- "What you're
 *    looking for" (the FULL `DecisionProfileView`, including the
 *    context/personalConcerns/missing/suggestedQuestions fields the
 *    sidebar's own header comment explicitly excludes from its cut-down
 *    priorities list), "Notes", and "Add something Sift should check" --
 *    each opening its own controlled `Sheet` built from this file's owned
 *    JSX, then `WorkspaceViewSwitcher` (unchanged).
 *
 * PANE MODE (`layout === 'narrow'`) -- the existing single-column stack,
 * MINUS the two regions promoted into the app bar above (options, findings)
 * PLUS the alert banner. The owner: "I'm not opposed to the collapsable
 * type design, but this isn't how it's supposed to work" -- the objection
 * is to *everything* being a collapsible, not to collapsibles existing, so
 * `WorkspaceViewSwitcher`, then closed-by-default `DisclosureSection` rows
 * for "What you're looking for," "Notes"/"Add a note," "Still checking,"
 * and "Add something Sift should check" remain exactly as they were.
 *
 * WHERE EACH OF THE FIVE ORIGINAL BOTTOM DISCLOSURES WENT (ADR 0008's own
 * literal quoted list, in order):
 *
 *  - "What you're looking for" -> sidebar priorities (expanded) / unchanged
 *    disclosure (narrow); the FULL profile is also reachable via a sheet in
 *    expanded mode (see above).
 *  - Filters -> `FilterBar` + `FilterSheet`, identical in BOTH modes
 *    (ADR 0009). `visibleOptions` below is what makes them do anything at
 *    all; before it, every filter control wrote durable state no code read.
 *  - "Add a note" -> the app bar's create menu, in BOTH modes, opening a
 *    dedicated "Add a note" sheet. Reading notes is unchanged: `CaseNotes`
 *    still renders inline in the narrow column (and returns `null` on an
 *    empty case), and the expanded main-column toolbar's "Notes" sheet still
 *    shows `CaseNotes` + `AddNoteForm` together. Only the WRITE half moved --
 *    see "Second follow-up" below.
 *  - "What Sift found" -> `WorkspaceAppBar`'s "Findings" control plus the
 *    alert banner's findings item, in BOTH modes -- the one region this
 *    task's brief explicitly requires to leave the bottom-of-stack pattern
 *    even in pane mode, since it is "the single most valuable event in the
 *    product" (ADR 0008).
 *  - "Still checking" -> sidebar button + sheet (expanded) / unchanged
 *    disclosure (narrow).
 *  - "Add something Sift should check" -> the app bar's create menu, in BOTH
 *    modes, opening `workspace-add-concern-sheet`. The alert banner's own
 *    "Sift proposed something" action (`handleReviewPendingExtension`) opens
 *    that same one sheet -- see "Second follow-up" below for why it is no
 *    longer layout-aware.
 *
 * SECOND FOLLOW-UP (the project owner, reviewing the shipped narrow pane):
 * "Add a note and add a question should be in either the header or footer
 * toolbars -- not at the bottom of the stack," and "the header is consuming
 * more space than it needs to... I think it's possible by using things like
 * menus." Those two are answered together: `WorkspaceAppBar`'s single "Add
 * option" button became a create MENU over three items -- Add option, Add a
 * note, Add a question -- so the header grows by nothing while two full
 * `DisclosureSection` rows leave the bottom of the narrow column for good.
 * Each item opens a controlled `Sheet` declared with the others below.
 *
 * Three consequences worth naming, because each removed something real:
 *
 *  - The narrow "add-concern" disclosure's `defaultOpen={pendingExtension !==
 *    null}` self-opening and its "1 needs your review" `meta` are gone with
 *    the row. Neither signal is lost: `WorkspaceAlertBanner` already carried
 *    the same fact at the TOP of the stack (strictly more visible than a
 *    `<summary>` at the bottom of it), and its action now reveals the
 *    `CaseExtensionReviewCard` itself in one click.
 *  - `handleReviewPendingExtension` is therefore no longer layout-aware. It
 *    used to scroll the already-auto-open narrow disclosure into view instead
 *    of opening the sheet, purely to avoid mounting a SECOND
 *    `CustomConcernForm`/`CaseExtensionReviewCard` over the same extension
 *    and double-registering their testids. With the disclosure gone the sheet
 *    is the only home for that region, so both layouts take one identical
 *    path and the hazard cannot occur.
 *  - The expanded main-column toolbar's "Add a question" button is gone too:
 *    the create menu renders in both layouts over the same sheet, so a second
 *    expanded-only entry point would be pure duplication. "Notes" and "Your
 *    priorities" stay -- neither has a create-menu equivalent.
 *
 * "Manage options" (`OptionEditor`) was never one of the five the owner's
 * screenshot named -- it already sat right below the hero, not at the
 * bottom -- but it is unambiguously "a create action... disguised as a
 * disclosure row" in the ADR's own general sense (`WorkspaceAppBar`'s own
 * header comment attributes its "Add option" control to the owner's "add
 * action at the top" language), so this task promotes it too, uniformly, in
 * BOTH modes, into the app bar's "Add option" button opening one controlled
 * `Sheet` -- eliminating the disclosure row entirely rather than running two
 * parallel entry points to the same `OptionEditor` instance (which would
 * double-mount its `option-editor-new` testid whenever both were open at
 * once).
 *
 * Retired from this file entirely, per ADR 0004:
 *  - `WorkspaceStatusHeader` (the four-stage tracker + next-step banner) --
 *    folded into `RecommendationHero`/`workspace-status.ts`.
 *  - The "What Sift is doing" / `activeFocus` current-focus card (item 7 of
 *    this task's brief; ADR 0004 decision item 5). `CaseState.activeFocus`
 *    is written only as `null` by every production code path (`create-
 *    case.ts`, `reducer.ts`) -- this file's old rendering of it was
 *    unreachable dead code whose only visible branch was a permanently-true
 *    "Nothing is being actively investigated right now." Deleted outright,
 *    not replaced with a fabricated substitute: nothing may render from
 *    `activeFocus` again until a real production writer exists for it.
 *  - "Sift's work so far" (`ActivityTimeline`, the raw chronological
 *    activity ledger) as an unconditional consumer-surface region -- ADR
 *    0004 item 3/4 moves it to developer content. It still exists and still
 *    renders real data, just not here: it is the Runtime Inspector's own
 *    Activity tab now (Task A5/I2b, see below), fed `caseScopedActivityEvents`.
 *
 * The Runtime Inspector is a Sheet overlay, not a route/full-body swap:
 * `RuntimeInspector` renders as a sibling of the normal workspace (mounted
 * only while `runtimeInspectorOpen` is true) rather than replacing it, so
 * the case body stays visible underneath. Task A5 gives it a real,
 * explicit, discoverable entry point that needs no prior activity to reach
 * (`CaseHeader`'s "Developer view" control, `openDeveloperView`) --
 * before this task, the ONLY way in was the run-scoped "Inspect run"
 * control (`RecommendationHero`/`LiveRunStatus`, still present and
 * unchanged), which stays hidden until a run has actually happened this
 * session. It is extended, not duplicated (§34): `runId` can now be `null`
 * (opened generally) as well as a specific run, and its new Activity tab
 * reuses `ActivityTimeline` itself, not a second ledger. Task I2b threads
 * the missing trigger half of I2 ("a consumer event opens its exact runtime
 * event") all the way through: `ActivityTimeline`'s own "Inspect event"
 * button (rendered only when an item carries a `debugEventId`) calls
 * `inspectRunEvent`, which re-targets the same open Inspector to that
 * event's exact Timeline entry via `focusEventId`.
 *
 * `readiness` is computed by calling the REAL `evaluateReadiness` from
 * `@sift/core` directly. This app never re-implements readiness, satisfying
 * docs/engineering-principles.md's "The deterministic core, not an LLM, owns ... readiness."
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  CompiledDecisionPackSchema,
  DEMO_IDS,
  PRESENTATION_ONLY_ACTIVITY_DETAIL,
  type CommandReceipt,
  type CompiledDecisionPack,
  type EvidenceDisposition,
  type PublicActivityEvent,
  type WorkspaceFilter,
  type WorkspaceViewMode,
  type WorkspaceViewState,
} from '@sift/contracts';
import { deriveDiscoveryReadiness, deriveNextMoves, evaluateReadiness } from '@sift/core';
import { SiftClientError } from '../api/sift-client.js';
import { readStoredCaseId, writeStoredCaseId, clearStoredCaseId } from './active-case-storage.js';
import { hasSeenFirstRunGuide, markFirstRunGuideSeen } from './first-run-storage.js';
import { DemoLauncher } from '../components/DemoLauncher.js';
import { VehicleCatalogFlow } from '../components/VehicleCatalogFlow.js';
import { DisclosureSection } from '../components/DisclosureSection.js';
import { RecommendationHero } from '../components/RecommendationHero.js';
import type { CandidateDisposition, InteractionResponse, NextMove } from '@sift/contracts';
import type { ApprovalCardReview } from '../components/ApprovalCard.js';
import { deriveActiveRunId, deriveWorkspaceStatus } from '../components/workspace-status.js';
import { ReadinessPanel } from '../components/ReadinessPanel.js';
import { FindingsSheet } from '../components/FindingsSheet.js';
import { BlindSpotReviewSheet } from '../components/BlindSpotReviewSheet.js';
import { OptionEditor } from '../components/OptionEditor.js';
import { LensSwitcher } from '../components/LensSwitcher.js';
import { WorkspaceViewSwitcher } from '../components/WorkspaceViewSwitcher.js';
import { DecisionProfileView } from '../components/DecisionProfileView.js';
import {
  DecisionOrientationShell,
  type WorkInFlight,
} from '../components/DecisionOrientationShell.js';
import { summarizeRunPlanResponse } from './run-plan-summary.js';
import { buildScoringAlerts } from './scoring-alerts.js';
import { buildInteractionForTopic } from './build-interaction.js';
import { DiscoveryInteraction } from '../components/DiscoveryInteraction.js';
import { ContextActionDock } from '../components/ContextActionDock.js';
import { buildDecisionOrientation } from '../components/decision-orientation.js';
import { deriveDecisionProfile } from '../components/decision-profile.js';
import { CaseNotes } from '../components/CaseNotes.js';
import { AddNoteForm } from '../components/AddNoteForm.js';
import { CustomConcernForm } from '../components/CustomConcernForm.js';
import { CriteriaEditor } from '../components/CriteriaEditor.js';
import { CaseExtensionReviewCard } from '../components/CaseExtensionReviewCard.js';
import type { LiveRunStatusReceipt } from '../components/LiveRunStatus.js';
import { WebMcpStatus } from '../components/WebMcpStatus.js';
import { ErrorState } from '../components/ErrorState.js';
import { RuntimeInspector } from '../components/RuntimeInspector.js';
import { FirstRunGuide } from '../components/FirstRunGuide.js';
import {
  WorkspaceAppBar,
  type WorkspaceAppBarConnectionState,
} from '../components/WorkspaceAppBar.js';
import {
  WorkspaceAlertBanner,
  type WorkspaceAlertBannerItem,
} from '../components/WorkspaceAlertBanner.js';
import { WorkspaceSidebar } from '../components/WorkspaceSidebar.js';
import { FilterBar } from '../components/FilterBar.js';
import { FilterSheet } from '../components/FilterSheet.js';
import { applyAssistantNarrowing, applyWorkspaceFilters } from '../components/workspace-filters.js';
import { OptionProfileSheet } from '../components/OptionProfileSheet.js';
import { CaseInsightsPanel } from '../components/CaseInsightsPanel.js';
import { buildWorkspaceScoreboard, selectOptionRanking } from '../components/case-scoreboard.js';
import { ReferenceLibrarySheet } from '../components/ReferenceLibrary.js';
import { AnalysisStage } from '../components/AnalysisStage.js';
import { CaseWorkflowStepper } from '../components/CaseWorkflowStepper.js';
import { deriveOptionProfile } from '../components/option-profile.js';
import {
  deriveCaseWorkflow,
  type CaseWorkflowStageId,
  type CaseWorkflowStageState,
} from './case-workflow.js';
import { useWidthMode } from '../hooks/use-width-mode.js';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useApiConfig, useSiftCommands, useWebMcpAdapter } from './AppProviders.js';
import { useUiStore } from './ui-store.js';
import { useCaseEvents, type CaseEventsConnectionState } from '../hooks/use-case-events.js';
import {
  registerSiftTools,
  type SiftToolRegistrationHandle,
} from '../model-context/register-sift-tools.js';

// Matches the real server contract exactly (`apps/agent/src/routes/packs.ts`
// `ListPacksResponseSchema`: `{ packs: CompiledDecisionPack[] }`, a `.strict()`
// wrapper object, never a bare array). A prior version of this schema was a
// bare `z.array(CompiledDecisionPackSchema)` -- a genuine, silent client/
// server contract mismatch (confirmed directly against the real running
// app): `safeParse` on the real `{ packs: [...] }` payload always failed,
// and the failure was swallowed by this fetch's own deliberately-lenient
// `if (parsed.success) setInstalledPacks(...)` degrade-gracefully path (see
// that effect's own comment below), so `installedPacks` silently stayed `[]`
// forever in every real (non-test) session -- `activePack` was always
// `null`, the Compare view (`OptionComparison` at the time; superseded by
// `WorkspaceViewSwitcher`/`OptionCompareView`, see this file's own header
// comment) always fell back to one ungrouped "All attributes" row instead
// of the pack's real named groups, and `OptionEditor`'s `optionKind`/
// `optionLabel` always fell back to the
// generic `'option'` default, which matches none of `car-purchase`'s
// declared attributes' `appliesTo: ['candidate']` -- so the manual
// candidate-entry form (product.md "Explicit scope cuts": "users may
// manually enter up to five car candidates ... ") silently rendered zero
// attribute fields for every real user. Caught by
// `vehicle-catalog-journey.spec.ts` (this task), which is the first
// Playwright spec to actually open `OptionEditor`'s attribute fields against
// the real server rather than a component test's own hand-built props or a
// (also incorrectly bare-array) mocked `/api/packs` MSW handler.
const InstalledPacksResponseSchema = z
  .object({ packs: z.array(CompiledDecisionPackSchema) })
  .strict();

/**
 * Reconstructs a fallback `LiveRunStatusReceipt` from replayed
 * `PublicActivityEvent`s, for the moment before any command has been sent
 * *this browser lifetime* -- a fresh page load or hard reload. Without
 * this, `lastRunReceipt` (session-local `useState`, only ever set inside a
 * live command's own promise-resolution handlers) naturally starts `null`
 * and stays `null` regardless of how much real history the case actually
 * has, even though `events` already carries that full replayed history and
 * is what Readiness correctly derives its own post-reload state from --
 * producing a hero that looks like nothing has ever happened directly
 * above a Readiness panel that correctly shows a fully decided case.
 *
 * Walks `events` from the most recent backward for the latest event that
 * carries a `runId` (preferred, matching `LiveRunStatus`'s own correlation
 * preference). Only the run-starting event itself carries both `commandId`
 * and `runId` together (see `run-service.ts`'s `run.queued` append) --
 * every later event in that run (specialist/tool/completion events) carries
 * only `runId` -- so this also searches the full history for the real
 * originating `commandId` of that same run rather than fabricating one.
 * Falls back to the most recent event carrying only a `commandId` (a
 * command that has not yet started a run), matching
 * `LiveRunStatus.tsx`'s own documented "brief window before a run-starting
 * command has an established `runId`" case. Returns `null` when `events`
 * has nothing to derive from -- a genuinely fresh case must still show the
 * real empty state, not a fabricated receipt.
 *
 * Task A9 (`docs/planning/plans/2026-08-30-generic-decision-workspace.md`
 * Phase A): the commandId-only fallback above must NOT surface fixture/demo
 * seeding as if it were a real completed command the human asked for. Live
 * inspection at 430px caught the hero rendering "Nothing's been looked into
 * yet." directly above a "completed" status block reading `Added option
 * "2022 Subaru Outback Premium AWD"` -- individually true, contradictory
 * together. Root cause, confirmed directly in `apps/agent/src/services/
 * command-service.ts`'s `startDemo`/`startCase`: case creation AND every
 * seeded entity are appended under ONE shared `commandId` (the case's own
 * `case.created` event, always the earliest event with a `commandId`), and
 * none of it carries a `runId` -- seeding is not an investigation run. So
 * when the most recent commandId-only event's id still matches that very
 * first (case-creation) commandId, nothing beyond fixture/demo seeding has
 * ever happened in this case, and this function returns `null` instead --
 * exactly the same "nothing real to show" answer the hero's own headline
 * gives. A real, distinct command the user issues afterward (e.g. manually
 * adding an option before ever requesting an investigation) carries its own,
 * different `commandId` and is unaffected by this check.
 */
function deriveReceiptFromEvents(events: PublicActivityEvent[]): LiveRunStatusReceipt | null {
  const bySequence = [...events].sort((a, b) => a.sequence - b.sequence);

  for (let i = bySequence.length - 1; i >= 0; i -= 1) {
    const runId = bySequence[i]?.runId;
    if (runId !== undefined) {
      const originating = bySequence.find(
        (event) => event.runId === runId && event.commandId !== undefined,
      );
      return { commandId: originating?.commandId ?? runId, runId };
    }
  }

  const creationCommandId = bySequence.find((event) => event.commandId !== undefined)?.commandId;

  for (let i = bySequence.length - 1; i >= 0; i -= 1) {
    const event = bySequence[i];
    // A presentation-only command (`setView`/`focusOption`/`focusEvidence`
    // -- the three that write through `updateSelection` and append no
    // `CaseEvent`) never answers the question this block exists to answer:
    // "what did Sift last do about my decision." Found in the running
    // product at 390px the moment filters started writing `setView` on every
    // chip press -- picking "Body style: compact crossover SUV" surfaced
    // "Latest command / Set workspace view to "quick_pick". / Completed"
    // directly under a hero still reading "Nothing's been looked into yet."
    //
    // Same shape as the seeding exclusion below, discovered the same way: an
    // individually-true status line that is a non-sequitur where it lands.
    // The event itself is untouched and still fully visible in the activity
    // stream and Runtime Inspector -- this only declines to PROMOTE it.
    if (event?.safeDetails?.[PRESENTATION_ONLY_ACTIVITY_DETAIL] === true) continue;
    const commandId = event?.commandId;
    if (commandId !== undefined) {
      if (commandId === creationCommandId) return null;
      return { commandId };
    }
  }

  return null;
}

// `WorkspaceAppBar`'s `WorkspaceAppBarConnectionState` union
// (`'live' | 'reconnecting' | 'offline'`) is narrower than the real hook's
// five-state `CaseEventsConnectionState` -- it has no separate tokens for
// "still establishing the first connection" or "SSE unsupported, degraded
// to polling." Both collapse onto `reconnecting`: from the reader's point
// of view, "we don't have a live stream right now but we're getting you
// data another way" reads the same either way, and `WorkspaceAppBar`'s own
// contract has no fourth tone to attach a polling-specific meaning to (this
// is an explicit, disclosed simplification, not an oversight -- the locked
// component's prop union is the ceiling here).
function mapAppBarConnectionState(
  state: CaseEventsConnectionState,
): WorkspaceAppBarConnectionState {
  if (state === 'live' || state === 'offline') return state;
  return 'reconnecting';
}

/**
 * Applies the person's standing intent about the assistant's option
 * narrowing to a `WorkspaceViewState` payload about to be written.
 *
 * Shared by BOTH view writers below (`drainViewWrites` and
 * `drainFilterWrites`), which is the entire point: each rebuilds the full
 * view by spreading the last-seen snapshot, so a `visibleOptionIds` the
 * person has already dismissed would otherwise be re-persisted by whichever
 * of them happens to write next. `intendedViewRef` exists precisely to stop
 * one writer rolling the other back, and this keeps that guarantee true for
 * the model-owned field too.
 *
 * The key is REMOVED rather than set to an empty array: `[]` is a real,
 * schema-valid "show none of them" (see `applyAssistantNarrowing`), so
 * writing it would replace one narrowing with a stricter one instead of
 * lifting it.
 */
function applyIntendedNarrowing(
  intent: {
    clearedAssistantNarrowing?: boolean;
    lensAttributeIds?: readonly string[] | null;
  },
  view: WorkspaceViewState,
): WorkspaceViewState {
  let next = view;

  // A lens decides which ATTRIBUTES are shown; the assistant narrowing below
  // decides which OPTIONS are. They are independent fields and both must
  // survive a write made by the other writer, which is why both are applied
  // here rather than at either call site.
  if (intent.lensAttributeIds !== undefined) {
    if (intent.lensAttributeIds === null) {
      const { visibleAttributeIds: _allFields, ...withoutLens } = next;
      next = withoutLens;
    } else {
      next = { ...next, visibleAttributeIds: [...intent.lensAttributeIds] };
    }
  }

  if (intent.clearedAssistantNarrowing !== true) return next;
  const { visibleOptionIds: _dismissed, ...withoutNarrowing } = next;
  return withoutNarrowing;
}

export function App() {
  const commands = useSiftCommands();
  const apiConfig = useApiConfig();
  const webMcpAdapter = useWebMcpAdapter();
  // Read exactly once, per this file's own header comment -- every region
  // below that cares about narrow-vs-expanded takes `layout` as a plain
  // value, never calls `useWidthMode()`/`matchMedia` itself.
  const layout = useWidthMode();

  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  // Pre-case launcher mode (docs/decisions/0003-vehicle-catalog-and-normal-
  // case-creation.md): only meaningful while `activeCaseId === null`. Starts
  // on the plain launcher; "Compare vehicles" switches to the catalog/
  // shortlist flow without creating anything yet.
  const [launcherMode, setLauncherMode] = useState<'launcher' | 'catalog'>('launcher');
  // Reload persistence (product.md real-time contract: a mid-case reload
  // must restore state from the server, not local state). Only a *pointer*
  // to which case was open is ever read from `localStorage` synchronously
  // here, at initial state -- it is not trusted as the active case until
  // the verification effect below confirms the id still resolves against
  // the real server. `null` means either nothing was stored, or nothing is
  // being restored (both render the plain launcher immediately).
  const [restoringCaseId, setRestoringCaseId] = useState<string | null>(() => readStoredCaseId());
  const [installedPacks, setInstalledPacks] = useState<CompiledDecisionPack[]>([]);
  /**
   * What Sift is currently working on, read from `GET /api/cases/:id/run-plan`.
   *
   * `null` until a plan exists, which is most of discovery — a case has no
   * plan until someone asks for an investigation. A transient failure here
   * degrades to `null` rather than blocking the workspace: the plan is a
   * derived projection and the pane is fully usable without it.
   */
  const [workInFlight, setWorkInFlight] = useState<WorkInFlight | null>(null);
  const [lastRunReceipt, setLastRunReceipt] = useState<LiveRunStatusReceipt | null>(null);
  // Everything from here to `setWorkflowStage` below is overlay/presentation
  // state, and it lives in `useUiStore` (./ui-store.ts) rather than in this
  // component. Which overlay is showing is decided by the app bar, the alert
  // banner, the hero, the dock, the workflow stepper and the sheets
  // themselves; as `useState` that meant one `() => setXOpen(true)` prop per
  // entry point and no single place that said what the overlay layer can do.
  //
  // Each value is read through its OWN narrow selector, never
  // `useUiStore()` wholesale: a whole-store read re-renders this component
  // on every unrelated UI change, which would make the store a regression
  // rather than an improvement. Action selectors are free -- an action's
  // identity never changes, so subscribing to one can never fire a render.
  //
  // Nothing here is persisted or sent anywhere, by design: see the store's
  // own header for why ADR 0005 puts durable presentation state on
  // `CaseState.view` instead, and this session-scoped layer nowhere at all.
  //
  // Runtime Inspector (Task A5 extends this beyond the pre-existing
  // run-scoped "Inspect run" trigger): `runtimeInspectorOpen` is the single
  // mount gate -- true whenever the Sheet should be showing at all, whether
  // opened generally (`CaseHeader`'s "Developer view" control, no run in
  // hand) or scoped to a specific run/event. `inspectingRunId` is `null`
  // for the general case, matching `RuntimeInspector`'s own now-nullable
  // `runId` prop. `inspectingDebugEventId` is the exact correlated runtime
  // event to jump straight to (Task I2b's "Inspect event" trigger,
  // `RuntimeInspector`'s `focusEventId` prop) -- `undefined` for every
  // other entry point. The four actions below (Task A5 / I2b) are the only
  // way in or out, so those three fields cannot drift apart -- `inspectRun`
  // after an `inspectRunEvent` clears the stale event, rather than reopening
  // the Inspector scrolled to an event from a different run.
  const runtimeInspectorOpen = useUiStore((state) => state.runtimeInspectorOpen);
  const inspectingRunId = useUiStore((state) => state.inspectingRunId);
  const inspectingDebugEventId = useUiStore((state) => state.inspectingDebugEventId);
  const openDeveloperView = useUiStore((state) => state.openDeveloperView);
  const inspectRun = useUiStore((state) => state.inspectRun);
  const inspectRunEvent = useUiStore((state) => state.inspectRunEvent);
  const closeRuntimeInspector = useUiStore((state) => state.closeRuntimeInspector);
  /**
   * The first-run guide (`components/FirstRunGuide.tsx`): the same "How
   * Sift works" content the Help control gives, shown without being asked
   * for, on the first case this browser ever opens.
   *
   * Owned here rather than inside the component for the same reason every
   * other overlay's `open` flag is: the *decision* to show it depends on
   * `activeCaseId`, which lives here. The component itself is a pure
   * controlled `Sheet`.
   */
  const firstRunGuideOpen = useUiStore((state) => state.firstRunGuideOpen);
  const openFirstRunGuide = useUiStore((state) => state.openFirstRunGuide);
  const closeFirstRunGuide = useUiStore((state) => state.closeFirstRunGuide);
  /**
   * Where focus goes when the guide closes: the app bar's Help control.
   *
   * `FirstRunGuide` opens on its own, so Radix has no trigger to restore
   * focus to -- it restores to whatever was focused when the dialog opened,
   * which is the launcher button that this very case unmounted. Measured in
   * a real browser, that left focus on `<body>`, making a keyboard user Tab
   * from the top of the document after dismissing. Help is the honest
   * destination: always mounted while a case is open, and the control that
   * reopens exactly the content just dismissed.
   */
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  /** Set when the first-run guide is dismissed, cleared once focus reaches the Help control -- see the effect below. */
  const helpFocusPending = useUiStore((state) => state.helpFocusPending);
  const requestHelpFocus = useUiStore((state) => state.requestHelpFocus);
  const clearHelpFocus = useUiStore((state) => state.clearHelpFocus);
  const findingsSheetOpen = useUiStore((state) => state.findingsSheetOpen);
  const openFindings = useUiStore((state) => state.openFindings);
  const closeFindings = useUiStore((state) => state.closeFindings);
  // ADR 0008 sheet-based entry points -- each replaces (expanded mode) or
  // supplements (narrow mode, via the app bar's now-uniform "Add option")
  // a former bottom-of-page disclosure. All five are mounted unconditionally
  // (matching `FindingsSheet`'s own pre-existing "always mounted, controlled
  // by `open`" pattern) and Radix does not render `SheetContent` into the
  // DOM at all while `open` is false, so none of these collide with the
  // narrow-mode disclosures that render the SAME underlying components --
  // see this file's own header comment for why "Manage options" has no
  // narrow-mode disclosure any more specifically to avoid that collision.
  const manageOptionsSheetOpen = useUiStore((state) => state.manageOptionsSheetOpen);
  const openManageOptions = useUiStore((state) => state.openManageOptions);
  const closeManageOptions = useUiStore((state) => state.closeManageOptions);
  const stillCheckingSheetOpen = useUiStore((state) => state.stillCheckingSheetOpen);
  const openStillChecking = useUiStore((state) => state.openStillChecking);
  const closeStillChecking = useUiStore((state) => state.closeStillChecking);
  const decisionProfileSheetOpen = useUiStore((state) => state.decisionProfileSheetOpen);
  const openDecisionProfile = useUiStore((state) => state.openDecisionProfile);
  const closeDecisionProfile = useUiStore((state) => state.closeDecisionProfile);
  const notesSheetOpen = useUiStore((state) => state.notesSheetOpen);
  const openNotes = useUiStore((state) => state.openNotes);
  const closeNotes = useUiStore((state) => state.closeNotes);
  // The create menu's "Add a question" surface. Its "Add a note" sibling
  // reuses `notesSheetOpen` above rather than owning a second write-only
  // sheet.
  //
  // An earlier revision of this comment claimed the inline `CaseNotes` sat
  // inside `layout === 'expanded'`. It did not -- it was in the narrow else
  // branch, and pairing it with a shared sheet double-mounted the component
  // and its DOM ids. The inline copy is gone now (see the note where it used
  // to render), so one sheet is the whole story at every width.
  const addConcernSheetOpen = useUiStore((state) => state.addConcernSheetOpen);
  const openAddConcern = useUiStore((state) => state.openAddConcern);
  const closeAddConcern = useUiStore((state) => state.closeAddConcern);
  const prioritiesSheetOpen = useUiStore((state) => state.prioritiesSheetOpen);
  const openPriorities = useUiStore((state) => state.openPriorities);
  const closePriorities = useUiStore((state) => state.closePriorities);
  // Filters live in a sheet reachable from BOTH layouts, not in the
  // expanded-only sidebar they used to occupy (ADR 0009). That placement is
  // what makes filtering exist at all in pane/WebMCP mode, where
  // `WorkspaceSidebar` renders `null` outright.
  const filterSheetOpen = useUiStore((state) => state.filterSheetOpen);
  const openFilters = useUiStore((state) => state.openFilters);
  const closeFilters = useUiStore((state) => state.closeFilters);
  // Which option's detail profile is open, by id -- NOT the option record
  // itself. Holding the id means the open sheet re-derives from each new
  // snapshot, so a live run that adds evidence about this option updates the
  // sheet under the reader instead of freezing a copy taken when it opened.
  const profileOptionId = useUiStore((state) => state.profileOptionId);
  const openOptionProfile = useUiStore((state) => state.openOptionProfile);
  const closeOptionProfile = useUiStore((state) => state.closeOptionProfile);
  // The case's reference library -- every `Source` on the case, tagged and
  // browsable. Global chrome like the other sheets: it is the model's
  // durable memory made legible, and must be reachable in both layouts.
  const referenceLibraryOpen = useUiStore((state) => state.referenceLibraryOpen);
  const openReferenceLibrary = useUiStore((state) => state.openReferenceLibrary);
  const closeReferenceLibrary = useUiStore((state) => state.closeReferenceLibrary);
  const workflowStageOverride = useUiStore((state) => state.workflowStageOverride);
  const setWorkflowStage = useUiStore((state) => state.setWorkflowStage);
  const [resetPending, setResetPending] = useState(false);
  const [runRequestPending, setRunRequestPending] = useState(false);
  const [runRequestError, setRunRequestError] = useState<string | null>(null);
  const [proposalReviewPending, setProposalReviewPending] = useState(false);
  const [proposalReviewError, setProposalReviewError] = useState<string | null>(null);
  const [dispositionPendingId, setDispositionPendingId] = useState<string | null>(null);
  const [dispositionError, setDispositionError] = useState<string | null>(null);
  /**
   * A failed discovery interaction, surfaced rather than swallowed.
   *
   * The bare `.catch(() => undefined)` this replaces hid a schema rejection
   * for an entire debugging session: the button did nothing, the console
   * said nothing, and the only symptom was a question that never appeared.
   */
  const [interactionError, setInteractionError] = useState<string | null>(null);
  /**
   * The contextual blind-spot review (`BlindSpotReviewSheet`), reached from
   * the dock's `review_blind_spots` move.
   *
   * Sheet-mounted rather than always-inline for the same reason
   * `FindingsSheet` is: the review is a bounded pass a person is invited
   * into and returned from, not a permanent region. `blindSpotReviewError`
   * exists for the same reason `interactionError` does -- a rejected command
   * here must say so on screen rather than leaving a control that appears to
   * work and does not.
   */
  const blindSpotSheetOpen = useUiStore((state) => state.blindSpotSheetOpen);
  const openBlindSpotReview = useUiStore((state) => state.openBlindSpotReview);
  const closeBlindSpotReview = useUiStore((state) => state.closeBlindSpotReview);
  const [blindSpotReviewPending, setBlindSpotReviewPending] = useState(false);
  const [blindSpotReviewError, setBlindSpotReviewError] = useState<string | null>(null);
  const {
    snapshot,
    events,
    connectionState,
    error: streamError,
    resolveEventSequence,
  } = useCaseEvents({ caseId: activeCaseId, ...apiConfig });

  // Primary workspace view switcher state (ADR 0004 item 5; ADR 0005;
  // Task A11). `CommandService.setView` (`apps/agent/src/services/
  // command-service.ts`) now genuinely persists `WorkspaceViewState`
  // through `updateSelection()`, so `CaseState.view` is a real, durable
  // source of truth once anything has set it -- and this file must derive
  // its rendered view from that field rather than from an independent
  // local `useState`, or the two silently disagree (global constraint 5:
  // "consumer and developer views are two projections of the same events,
  // never two sources of truth"; the same principle applies to the two
  // *directions* a single view can be set from). Before this task, `App`
  // held `viewMode` purely as local state -- individually correct (it drove
  // real UI), and the backend command was also individually correct (it
  // genuinely persisted), but together they meant a `sift_set_view` WebMCP
  // call could report success while the open page never moved.
  //
  // `snapshot?.view?.mode` (both `.optional()` and `.nullable()` on
  // `CaseState.view` -- see `packages/contracts/src/case.ts`) is therefore
  // the primary source once a case has ever had a view set; a case that has
  // never set one has no `view` at all, and `'quick_pick'` remains the
  // correct fallback default (Task A10, change-set §64 "reduce apparent
  // complexity" -- see that task's own reasoning, preserved below).
  // `optimisticViewMode` gives a user-initiated tap on the tab strip
  // immediate visual feedback without waiting on a round trip; the
  // reconciliation effect below clears it the moment the persisted value
  // actually catches up, so it never becomes a second permanent source of
  // truth (the brief's own explicit "optimistic local update reconciled
  // against the persisted value is fine; two permanently independent
  // states are not").
  //
  // `handleViewModeChange` below writes through the real `setView` command
  // (`commands.setView`, `SiftCommands` / `apps/web/src/api/sift-client.ts`)
  // -- the exact same command implementation a `sift_set_view` WebMCP call
  // reaches once that tool is wired to it too, rather than its own
  // in-memory-only session state (see `register-sift-tools.ts`'s own header
  // comment for that separate, not-yet-closed gap, which is outside this
  // file's ownership). It sends the FULL `WorkspaceViewState` the command
  // contract requires (`SetViewInput.view` is the complete object, not a
  // partial patch -- matching how `CaseState.view` itself is stored),
  // spreading the currently-persisted view first so a plain mode change
  // never clobbers other view fields (e.g. a Compare configuration a
  // WebMCP `sift_configure_comparison` call previously set). A failed write
  // is a fire-and-forget miss, matching `handleFocusOption` immediately
  // below: ADR 0005 designed presentation commands to be "safe to be called
  // freely and repeatedly without human confirmation," so this does not
  // earn its own blocking error UI the way a decision-mutating command
  // does; the optimistic override above simply stays in effect until this
  // file's own case-scoped remount (`key={activeCaseId}`, further below).
  //
  // Defaults to `'quick_pick'`, not `'compare'` (Task A10, change-set §64
  // "reduce apparent complexity"): the regenerated 390px baseline measured
  // ~3379px tall, and the always-fully-expanded Compare attribute table --
  // rendered unconditionally as *the default view a freshly opened case
  // shows* -- was the single largest contributor. Quick Pick renders one
  // option at a time, which is both a legitimate first-class triage view in
  // its own right (ADR 0005) and, as a side effect, the shortest of the
  // four. Nothing becomes unreachable: every view, including Compare, is
  // still exactly one tap away on the always-visible tab strip immediately
  // below the hero (`WorkspaceViewSwitcher`'s own contract never hides a
  // tab). Collapsing Compare's own attribute groups by default was the
  // other legitimate option per this task's brief; defaulting away from
  // Compare was chosen instead because it fixes the actual measured
  // regression (the *default* first-paint height) without adding new
  // accordion/expand-collapse interaction surface to a view that, once a
  // user deliberately chooses it, is reasonably expected to show everything.
  const persistedViewMode = snapshot?.view?.mode;
  const [optimisticViewMode, setOptimisticViewMode] = useState<WorkspaceViewMode | null>(null);
  const viewMode = optimisticViewMode ?? persistedViewMode ?? 'quick_pick';

  // Compare view configuration -- the other half of this same "persisted
  // WorkspaceViewState never reaches the rendered page" seam `viewMode`
  // above already closes for `mode`. `sift_configure_comparison`/
  // `sift_set_view` genuinely persist `CaseState.view.compare.optionIds`/
  // `visibleAttributeIds`/`pinnedAttributeIds` through the real `setView`
  // command (see that command's own tests), and `OptionCompareView`
  // genuinely implements those as real narrowing props -- but until this
  // fix nothing here read `snapshot.view` and passed them to
  // `WorkspaceViewSwitcher`, so a real `sift_configure_comparison` WebMCP
  // call (§58's own named demo moment) reported success while the rendered
  // table never moved. No optimistic-override treatment is needed here the
  // way `viewMode` gets one: these three are read-and-forward only (nothing
  // in this file writes them locally), so they simply track whatever is
  // currently persisted, `undefined` when a case has never configured
  // Compare at all -- `OptionCompareView` already renders its full,
  // unnarrowed table for `undefined`, so an unconfigured case looks exactly
  // as it did before this fix.
  //
  // `compare.optionIds` (not the top-level `visibleOptionIds`, which
  // overlaps in intent) is deliberately what governs the Compare table's
  // visible option set -- see `WorkspaceViewSwitcher.tsx`'s own header
  // comment for the full reasoning (the tool named in §58's demo moment,
  // `sift_configure_comparison`, writes exactly this field; ADR 0005's
  // "Consequences" section names it explicitly for this purpose).
  const compareOptionIds = snapshot?.view?.compare?.optionIds;
  const compareVisibleAttributeIds = snapshot?.view?.visibleAttributeIds;
  const comparePinnedAttributeIds = snapshot?.view?.pinnedAttributeIds;

  // Reconciliation: adopt the persisted view only when it genuinely CHANGES,
  // never merely when it happens to equal the local override.
  //
  // The earlier rule ("clear the override once persisted catches up") caused
  // a real, reproducible defect that the visual gate caught: the workspace
  // would silently revert to a previously-selected tab. Two runs of the same
  // journey rendered different tabs — one Compare, one List — because after
  // the override was cleared, `viewMode` fell back to `persistedViewMode`
  // alone, and any later re-delivery of an older snapshot (a poll or SSE
  // refresh that raced the write) flipped the view back underneath the user.
  //
  // The `setView` write is especially likely to lose that race during an
  // active investigation: it carries `expectedSequence`, the run is
  // advancing `eventSequence` continuously, so a conflict is normal and the
  // persisted view never catches up at all. Combined with the swallowed
  // rejection below, the UI could show a tab the user did not choose with no
  // signal that anything failed.
  //
  // Tracking the last persisted value and reacting only to a genuine
  // transition keeps both directions working: a real external change (a
  // WebMCP `sift_set_view` from ChatGPT, or another viewer) still moves the
  // page, while a stale re-delivery of the value we already had does not.
  const lastPersistedViewMode = useRef<WorkspaceViewMode | undefined>(persistedViewMode);
  useEffect(() => {
    if (persistedViewMode === lastPersistedViewMode.current) return;
    lastPersistedViewMode.current = persistedViewMode;
    // A genuine remote/durable change wins over a local override.
    setOptimisticViewMode(null);
  }, [persistedViewMode]);

  // Quick Pick's queue position over `snapshot.entities`, in the same
  // session-local spirit as `viewMode` above (`WorkspaceViewState.quickPick`
  // has no real writer yet either).
  const [quickPickPosition, setQuickPickPosition] = useState(0);
  // Board placement, session-local for the same disclosed reason as
  // `viewMode` above: `WorkspaceViewState.board` exists in the contract but
  // has no command that writes it yet. Deliberately NOT derived from case
  // state -- where an option sits on the board is the user's working
  // arrangement, not a verdict the engine has reached about it
  // (change-set §12), so it must never be inferred from readiness or
  // recommendation status.
  const [boardPlacement, setBoardPlacement] = useState<Record<string, string>>({});
  const handleMoveOption = useCallback((optionId: string, toColumnId: string) => {
    setBoardPlacement((prev) => ({ ...prev, [optionId]: toColumnId }));
  }, []);

  const handleDemoStarted = useCallback((receipt: CommandReceipt) => {
    setActiveCaseId(receipt.caseId);
    setLastRunReceipt(null);
  }, []);

  const handleCaseCreated = useCallback((receipt: CommandReceipt) => {
    setActiveCaseId(receipt.caseId);
    setLastRunReceipt(null);
    setLauncherMode('launcher');
  }, []);

  // Installed Decision Pack catalog -- fetched once (independent of the
  // active case) and reused both for the `sift_list_packs` WebMCP tool and
  // `WorkspaceViewSwitcher`'s pack presentation metadata. `GET /api/packs`
  // has no dedicated `SiftCommands` method (it is a read-only route, per
  // architecture.md's "HTTP service" list); a transient failure here
  // degrades gracefully -- the comparison view falls back to one flat
  // attribute group and `sift_list_packs` simply reports zero installed
  // packs rather than blocking the rest of the workspace.
  useEffect(() => {
    let cancelled = false;
    const baseUrl = apiConfig.baseUrl ?? '';
    const fetchImpl = apiConfig.fetchImpl ?? fetch;
    fetchImpl(`${baseUrl}/api/packs`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(`status ${response.status}`)),
      )
      .then((payload: unknown) => {
        if (cancelled) return;
        const parsed = InstalledPacksResponseSchema.safeParse(payload);
        if (parsed.success) setInstalledPacks(parsed.data.packs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiConfig]);

  // The RunPlan, refreshed whenever the case's activity sequence moves.
  //
  // Keyed on `eventSequence` rather than polling: every command that can
  // change the plan also advances the case, so this refetches exactly when
  // there is something new to show and never in between.
  useEffect(() => {
    const caseId = snapshot?.id;
    if (caseId === undefined) {
      setWorkInFlight(null);
      return;
    }
    let cancelled = false;
    const baseUrl = apiConfig.baseUrl ?? '';
    const fetchImpl = apiConfig.fetchImpl ?? fetch;
    fetchImpl(`${baseUrl}/api/cases/${encodeURIComponent(caseId)}/run-plan`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (cancelled) return;
        const summary = summarizeRunPlanResponse(payload);
        setWorkInFlight(summary);
      })
      .catch(() => {
        if (!cancelled) setWorkInFlight(null);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot?.id, snapshot?.eventSequence, apiConfig]);

  // Reload-restore verification: a stored caseId is never trusted directly
  // (product.md "Canonical snapshots update only from committed case
  // events") -- it is confirmed against the real `GET /api/cases/:caseId`
  // route first. A case that no longer resolves (deleted, a stale id from a
  // previous server/data directory, ...) clears the stored pointer and
  // falls through to the plain launcher rather than leaving the workspace
  // stuck showing a perpetual loading state.
  useEffect(() => {
    if (restoringCaseId === null) return;
    let cancelled = false;
    const baseUrl = apiConfig.baseUrl ?? '';
    const fetchImpl = apiConfig.fetchImpl ?? fetch;
    fetchImpl(`${baseUrl}/api/cases/${encodeURIComponent(restoringCaseId)}`)
      .then((response) => {
        if (cancelled) return;
        if (response.ok) {
          setActiveCaseId(restoringCaseId);
        } else {
          clearStoredCaseId();
        }
        setRestoringCaseId(null);
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredCaseId();
        setRestoringCaseId(null);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately runs once per mount (`restoringCaseId`'s initial value is
    // only ever set once, from `readStoredCaseId()`) -- this effect's own
    // `setRestoringCaseId(null)` calls do not re-trigger it because they
    // move the value to `null`, which the guard above short-circuits on.
  }, [restoringCaseId, apiConfig]);

  // Persists the active case pointer (not its content -- see
  // `active-case-storage.ts`'s header comment) so the effect above can
  // restore it on a later reload. Also fires on a reset-demo/return-to-
  // launcher transition, correctly overwriting or clearing the stored
  // pointer.
  useEffect(() => {
    if (activeCaseId !== null) {
      writeStoredCaseId(activeCaseId);
    } else if (restoringCaseId === null) {
      // Only clears once restoration (if any) has settled -- clearing while
      // `restoringCaseId` is still non-null would erase the very pointer
      // the verification effect above is about to check.
      clearStoredCaseId();
    }
  }, [activeCaseId, restoringCaseId]);

  // WebMCP registration (webmcp.md "Registration lifecycle"): global read
  // tools register once per (adapter, commands) identity; `getActiveCase`/
  // `listPacks` read fresh values via refs on every call rather than
  // re-registering the two global tools on every snapshot/pack-list change.
  /**
   * The highest `eventSequence` the server has confirmed, taken from command
   * receipts rather than from the event stream.
   *
   * `snapshot` arrives over SSE (or the polling fallback), so immediately
   * after a command it is one behind. A `CommandReceipt.acceptedSequence` is
   * the server's authoritative sequence *after* that command, and it is
   * available the moment the call resolves. Presentation writes consult this
   * so an ordinary human sequence -- press Keep, then press Compare -- does
   * not send a stale `expectedSequence` and take an avoidable 409.
   */
  const lastAcceptedSequenceRef = useRef(0);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const activeCaseIdRef = useRef(activeCaseId);
  activeCaseIdRef.current = activeCaseId;

  /**
   * The `expectedSequence` every human-initiated command in this file sends.
   *
   * The two sources it combines are the only two that are authoritative, and
   * neither is sufficient alone:
   *
   * - `resolveEventSequence()` (`use-case-events.ts`) is the case's real
   *   `eventSequence`, re-read from the server in the window where the
   *   coalesced snapshot refresh has not caught up with an event the stream
   *   already delivered. That covers advances this client did not cause --
   *   a run streaming its events as the graph progresses, or a WebMCP writer
   *   working the same case.
   * - `lastAcceptedSequenceRef` covers the opposite case, which no read can:
   *   the receipt for a command THIS client just sent is newer than any
   *   snapshot the stream has had time to deliver.
   *
   * Both are values the server has already confirmed, so this never invents a
   * sequence and never hides a real conflict -- a write that genuinely raced
   * another writer still gets its 409. What it removes is the class of 409
   * that was purely an artifact of this client's own refresh schedule: press
   * a button a moment after an investigation finishes and the command failed,
   * visibly, for no reason the person could see or act on.
   *
   * Deliberately NOT applied to `register-sift-tools.ts`. A WebMCP tool's
   * `expectedSequence` is supplied by the model, and it means "the case
   * context I read before deciding to write this" -- bumping it to something
   * fresher would accept a write built on a view that really had gone stale,
   * which is the exact thing the field exists to refuse (webmcp.md
   * "Cancellation and concurrency").
   */
  const resolveExpectedSequence = useCallback(async (): Promise<number> => {
    const observed = await resolveEventSequence();
    return Math.max(observed, lastAcceptedSequenceRef.current);
  }, [resolveEventSequence]);

  // Serializes view writes so the LAST intent wins, not the last response.
  //
  // Three failed repair attempts got here, and the evidence that settled it
  // was two baseline images showing different tabs: the page was genuinely
  // bistable between List and Compare. The cause is not rendering timing and
  // not snapshot staleness -- it is that rapid tab switches issue concurrent
  // `setView` writes with no ordering. Select Compare then List and both are
  // in flight; whichever response lands last decides the persisted view, so
  // the older intent can overwrite the newer one. (A conflict retry, tried
  // first, made this strictly worse by adding a round-trip for the older
  // write to lose even later.)
  //
  // A single in-flight writer that always drains to the newest requested
  // view removes the race by construction: at most one request outstanding,
  // and when it settles the loop re-issues only if the user has since asked
  // for something else. The final persisted value therefore always equals
  // the last thing the person actually chose.
  const desiredViewRef = useRef<WorkspaceViewMode | null>(null);
  const viewWriteInFlightRef = useRef(false);

  // The person's standing intent for `WorkspaceViewState`, shared by BOTH
  // writers below and deliberately never cleared once set.
  //
  // The two writers stay separate single-flight queues (the mode writer is
  // hardened against the reproduced race described above and is not worth
  // re-opening), but they were each rebuilding the FULL `WorkspaceViewState`
  // by spreading `snapshotRef.current.view` -- a snapshot that lags whatever
  // the other writer has in flight. So the filter writer would compute
  // `mode` from a stale snapshot and persist it, silently undoing a view
  // change the user had just made.
  //
  // That was disclosed here as an accepted residual limitation, and it was
  // genuinely harmless while nothing READ `filters` -- persisting a stale
  // mode alongside a filter nobody applied changed no pixel. Making filters
  // real (`visibleOptions`) turned it into a visible defect with a
  // one-sentence repro: **switch to List, apply a filter, and the workspace
  // jumps back to Best Match.** Caught by the new e2e journey failing
  // consistently under four parallel workers while passing in isolation --
  // the timing signature of a genuine race, not a flaky selector.
  //
  // Reading intent from here instead of from the snapshot makes each write
  // carry the newest value of BOTH fields, so neither writer can roll the
  // other back regardless of which response lands first.
  //
  // `clearedAssistantNarrowing` is the third member, and it joined for
  // exactly the reason the second one did. `visibleOptionIds` is a durable
  // field the MODEL writes; when the person dismisses it, both writers
  // above still rebuild their payload by spreading `current.view`, which
  // still carries it. Without the clear being shared intent, switching tabs
  // a moment later would spread the dismissed narrowing straight back out
  // of the snapshot and silently undo the person's dismissal -- the same
  // "one writer rolls the other back" defect, one field over.
  //
  // A flag rather than a value because the human side of this field has
  // exactly one move (remove it); setting it belongs to the model. It is
  // cleared again the moment a genuinely new narrowing is persisted (see
  // the reconciliation effect below), so it can never become a standing
  // veto on the model ever narrowing again.
  const intendedViewRef = useRef<{
    mode?: WorkspaceViewMode;
    filters?: WorkspaceFilter[];
    clearedAssistantNarrowing?: boolean;
    // A lens selection, carried in the SAME shared-intent ref every other
    // view writer reads, for the reason this ref exists at all: each writer
    // spreads `snapshotRef.current.view`, so a lens change written by one
    // and a mode change written by another would each clobber the other's
    // field. `null` is a real, distinct value here -- "show all fields",
    // which must clear `visibleAttributeIds` rather than leave it absent
    // (absent means "no intent recorded", and the two are not the same).
    lensAttributeIds?: readonly string[] | null;
  }>({});

  const drainViewWrites = useCallback(async () => {
    if (viewWriteInFlightRef.current) return;
    viewWriteInFlightRef.current = true;
    try {
      while (desiredViewRef.current !== null) {
        const mode = desiredViewRef.current;
        const caseId = activeCaseIdRef.current;
        const current = snapshotRef.current;
        if (caseId === null || current === null) {
          desiredViewRef.current = null;
          return;
        }
        // `filters` comes from shared intent when the person has set any,
        // so this write cannot roll back an in-flight filter change.
        const intendedFilters = intendedViewRef.current.filters;
        const view = applyIntendedNarrowing(intendedViewRef.current, {
          ...(current.view ?? {}),
          ...(intendedFilters !== undefined ? { filters: intendedFilters } : {}),
          mode,
        });
        // The freshest sequence either side knows about -- see
        // `resolveExpectedSequence`.
        const expectedSequence = await resolveExpectedSequence();
        try {
          await commands.setView({ caseId, expectedSequence, view });
        } catch {
          // One retry against the freshest sequence, then give up quietly.
          //
          // The retry was added when Quick Pick became canonical. Before
          // that, "Shortlist" wrote through `updateSelection()` and never
          // advanced `eventSequence`, so the stale-sequence conflict this
          // comment already disclosed was rare enough to live with. Keep,
          // Pass, and Unsure append real events, which makes an ordinary
          // human sequence -- press Keep, then press Compare -- land a view
          // write with a sequence that is one behind. Silently dropping that
          // one makes a tab look broken, which is a different and worse
          // thing than an unpersisted preference.
          //
          // `snapshotRef.current` is re-read rather than reused: by the time
          // the first attempt failed, the event that invalidated it has
          // usually already arrived over SSE.
          const refreshed = snapshotRef.current;
          const retrySequence =
            refreshed === null
              ? lastAcceptedSequenceRef.current
              : Math.max(refreshed.eventSequence, lastAcceptedSequenceRef.current);
          // `>`, not `!==`: the first attempt already went out on the
          // freshest sequence `resolveExpectedSequence` could obtain, so a
          // re-read that comes back LOWER (the snapshot has not caught up
          // yet) is not a newer view to retry against -- resending on it
          // would only earn a second, certain conflict.
          if (retrySequence > expectedSequence) {
            try {
              await commands.setView({
                caseId,
                expectedSequence: retrySequence,
                view: applyIntendedNarrowing(intendedViewRef.current, {
                  ...(refreshed?.view ?? {}),
                  ...(intendedFilters !== undefined ? { filters: intendedFilters } : {}),
                  mode,
                }),
              });
            } catch {
              // Still swallowed, and still deliberately NOT a revert. The
              // person is looking at the view they chose; this command routes
              // through `updateSelection()` and changes no decision state at
              // all (change-set §54), so an error toast would be noise about
              // something that did not affect them. The real cost is that an
              // unpersisted choice may not survive a reload -- a stated
              // limitation, not a hidden one.
            }
          }
        }
        // Only clear if nothing newer arrived while this write was in flight.
        if (desiredViewRef.current === mode) desiredViewRef.current = null;
      }
    } finally {
      viewWriteInFlightRef.current = false;
    }
  }, [commands, resolveExpectedSequence]);

  const handleViewModeChange = useCallback(
    (mode: WorkspaceViewMode) => {
      setOptimisticViewMode(mode);
      intendedViewRef.current.mode = mode;
      desiredViewRef.current = mode;
      void drainViewWrites();
    },
    [drainViewWrites],
  );

  // `WorkspaceSidebar`'s filter controls (ADR 0008 decision 3, change-set
  // §54, ADR 0005 decision 1): "every change calls `onFiltersChange` with
  // the COMPLETE next `WorkspaceFilter[]`... this component never calls a
  // command itself" (`WorkspaceSidebar.tsx`'s own header comment). This
  // writes through the exact same `commands.setView`/`updateSelection()`
  // path `viewMode` above already uses -- narrowing which already-known
  // options are VISIBLE can never advance `eventSequence` or touch
  // criteria/weights.
  //
  // A SEPARATE serialized single-flight writer, not a generalization of
  // `desiredViewRef`/`drainViewWrites` above: that mechanism is already
  // hardened against a real, reproduced race (three failed repair attempts,
  // see its own comment) and this task does not touch it. Filters get their
  // own queue/in-flight ref, mirroring the identical "last intent always
  // wins, at most one request outstanding" shape. A mode write and a filter
  // write racing each other is a known, disclosed residual limitation --
  // both spread `snapshotRef.current.view`, which can lag the other
  // writer's own in-flight change -- exactly the same class of limitation
  // the mode writer's own comment already discloses for a stale
  // `expectedSequence`.
  const persistedFilters = snapshot?.view?.filters;
  const [optimisticFilters, setOptimisticFilters] = useState<WorkspaceFilter[] | null>(null);
  const filters = optimisticFilters ?? persistedFilters ?? [];

  // Content-based (not reference-based) comparison, unlike
  // `lastPersistedViewMode` above: a fresh snapshot poll always constructs a
  // brand-new `filters` ARRAY even when its contents are unchanged, so
  // reference equality (correct for `WorkspaceViewMode`, a primitive) would
  // treat every routine poll as "genuinely changed" here and clear a
  // just-set optimistic filter before its own write has had any chance to
  // round-trip -- the exact flicker/revert bug the mode writer's own
  // comment describes, just triggered by polling cadence instead of a race.
  const lastPersistedFiltersKey = useRef<string>(JSON.stringify(persistedFilters ?? []));
  useEffect(() => {
    const key = JSON.stringify(persistedFilters ?? []);
    if (key === lastPersistedFiltersKey.current) return;
    lastPersistedFiltersKey.current = key;
    setOptimisticFilters(null);
  }, [persistedFilters]);

  const desiredFiltersRef = useRef<WorkspaceFilter[] | null>(null);
  const filtersWriteInFlightRef = useRef(false);

  const drainFilterWrites = useCallback(async () => {
    if (filtersWriteInFlightRef.current) return;
    filtersWriteInFlightRef.current = true;
    try {
      while (desiredFiltersRef.current !== null) {
        const nextFilters = desiredFiltersRef.current;
        const caseId = activeCaseIdRef.current;
        const current = snapshotRef.current;
        if (caseId === null || current === null) {
          desiredFiltersRef.current = null;
          return;
        }
        // `mode` is a required field of `WorkspaceViewState` (unlike every
        // other member, which is optional) -- a case that has never set a
        // view has no `current.view` to spread from at all, so this always
        // supplies the exact same 'quick_pick' fallback the read side
        // already uses (`viewMode` above, Task A10) rather than producing
        // an invalid patch with no `mode`.
        // `mode` comes from shared intent first, falling back to the
        // snapshot and finally to the same `'quick_pick'` default the read
        // side uses. Reading the snapshot ALONE here is what let a filter
        // press silently undo a just-made view change -- see
        // `intendedViewRef`'s comment for the repro.
        const view = applyIntendedNarrowing(intendedViewRef.current, {
          ...(current.view ?? {}),
          mode: intendedViewRef.current.mode ?? current.view?.mode ?? 'quick_pick',
          filters: nextFilters,
        });
        // The freshest sequence either side knows about -- see
        // `resolveExpectedSequence`.
        const expectedSequence = await resolveExpectedSequence();
        try {
          await commands.setView({ caseId, expectedSequence, view });
        } catch {
          // Swallowed deliberately, same reasoning as the view-mode writer
          // above: a stale `expectedSequence` during a live run is expected
          // and this command changes no decision state, so the visible
          // filters (still reflecting the user's real choice via
          // `optimisticFilters`) do not need a blocking error surface.
        }
        if (desiredFiltersRef.current === nextFilters) desiredFiltersRef.current = null;
      }
    } finally {
      filtersWriteInFlightRef.current = false;
    }
  }, [commands, resolveExpectedSequence]);

  const handleFiltersChange = useCallback(
    (nextFilters: WorkspaceFilter[]) => {
      setOptimisticFilters(nextFilters);
      intendedViewRef.current.filters = nextFilters;
      desiredFiltersRef.current = nextFilters;
      // Changing the filters changes the queue Quick Pick is walking, so its
      // position has to return to the start of the NEW queue. Without this, a
      // user three cars into a five-car triage who narrows to two cars lands
      // past the end of the filtered queue and sees the "you've reviewed
      // everything" end state over a list they have not seen at all --
      // `QuickPickView` renders exactly that for `position >= options.length`
      // (`QuickPickView.tsx:180`). Restarting the queue is also what every
      // faceted browse UI does when the result set changes underneath it.
      setQuickPickPosition(0);
      void drainFilterWrites();
    },
    [drainFilterWrites],
  );

  // The assistant's own narrowing (`WorkspaceViewState.visibleOptionIds`,
  // written by `sift_set_view`) -- the second reader this file was missing,
  // and the exact twin of the `compare.optionIds` seam §58 closed. The
  // field was persisted by a real WebMCP call and implemented as a real
  // narrowing prop by `OptionListView`/`OptionCompareView`, but nothing
  // here read it, so "show her just those two" collected a success receipt
  // while the page did not move.
  //
  // It is read-and-forward with ONE local move: dismissal. The person can
  // say "no, show me everything again" without going back to chat, and
  // because the field is durable that dismissal has to persist (see
  // `handleClearAssistantNarrowing` below), not merely hide locally.
  const persistedVisibleOptionIds = snapshot?.view?.visibleOptionIds;
  const [assistantNarrowingDismissed, setAssistantNarrowingDismissed] = useState(false);

  // Content-based key, for the identical reason `lastPersistedFiltersKey`
  // above uses one: every poll rebuilds this array even when its contents
  // are unchanged, so reference equality would read routine polling as a
  // genuine change and undo the dismissal before its write round-trips.
  //
  // Reacting only to a REAL transition is what keeps the dismissal from
  // becoming permanent: the moment the model narrows again -- a different
  // set, after the person cleared the last one -- the key changes, both the
  // local override and the shared write intent are released, and the new
  // narrowing renders.
  const persistedNarrowingKey = JSON.stringify(persistedVisibleOptionIds ?? null);
  const lastPersistedNarrowingKey = useRef(persistedNarrowingKey);
  useEffect(() => {
    if (persistedNarrowingKey === lastPersistedNarrowingKey.current) return;
    lastPersistedNarrowingKey.current = persistedNarrowingKey;
    setAssistantNarrowingDismissed(false);
    intendedViewRef.current.clearedAssistantNarrowing = false;
  }, [persistedNarrowingKey]);

  const assistantVisibleOptionIds = assistantNarrowingDismissed
    ? undefined
    : persistedVisibleOptionIds;

  const handleClearAssistantNarrowing = useCallback(() => {
    setAssistantNarrowingDismissed(true);
    intendedViewRef.current.clearedAssistantNarrowing = true;
    // Deliberately reusing the FILTER writer's queue rather than opening a
    // third one. Both existing writers are single-flight queues over the
    // same `WorkspaceViewState`, and this dismissal is a chip press in the
    // same row as the filter chips -- so it takes the same path they do,
    // carrying the filters unchanged while `applyIntendedNarrowing` strips
    // the dismissed field. A third queue would add a third way for these
    // writes to race each other, which is the one thing this area of the
    // file has already paid for twice.
    desiredFiltersRef.current = filters;
    // Same reason `handleFiltersChange` restarts the queue: the set Quick
    // Pick is walking just got longer, and a position past the old end
    // would show the "you've reviewed everything" state over options the
    // person has not seen.
    setQuickPickPosition(0);
    void drainFilterWrites();
  }, [drainFilterWrites, filters]);

  // THE READER THAT MAKES EVERY FILTER CONTROL MEAN SOMETHING.
  //
  // Until this line existed, `WorkspaceFilter` was written by the filter
  // controls, persisted durably through `setView`, and read by NOBODY -- a
  // repo-wide grep matched only the schema, this file's writer, and the
  // control that produced it. Toggling "AWD only" changed stored state and
  // changed nothing a person could see.
  //
  // Scope is deliberate and narrow: this narrows the OPTION BROWSING
  // SURFACE only (`WorkspaceViewSwitcher`, the one prop every view reads).
  // It is deliberately NOT applied to `RecommendationHero`, readiness,
  // `CaseNotes`, or `OptionEditor`:
  //
  //  - a recommendation Sift already reached about an option must stay
  //    visible even while a filter hides that option from the list, or the
  //    product appears to silently retract its own answer;
  //  - a note referencing a hidden option would lose its subject;
  //  - the "Add option" editor reads existing options to avoid duplicates,
  //    which a filtered list would defeat.
  //
  // ADR 0005 (Consequences) requires Compare specifically to be driven by
  // `filters`; applying them to every option view is a superset of that,
  // chosen because a filter bar that silently affected only one tab is
  // exactly the "nothing familiar" problem this round of work exists to fix.
  const allOptions = useMemo(() => snapshot?.entities ?? [], [snapshot?.entities]);
  const filterableDefinitions = useMemo(
    () => snapshot?.attributeDefinitions ?? [],
    [snapshot?.attributeDefinitions],
  );
  // TWO independent narrowings, composed -- an option has to survive BOTH.
  //
  // The assistant's `visibleOptionIds` is a literal SET it named; the
  // person's `filters` are a RULE they stated. Neither is a special case of
  // the other, so neither may quietly win: composing them is what makes
  // "only the AWD ones" still mean something after the model has already
  // narrowed to three, and vice versa.
  //
  // Applied first, purely for readability of the count that follows -- the
  // functions are pure and order-independent (proven in
  // `workspace-filters.test.ts`). Both are presentation only: this can no
  // more reach scoring, readiness, or the recommendation than a filter can,
  // and for the same structural reason (see the note above about which
  // surfaces deliberately do NOT read this).
  //
  // The result is honest ONLY because `FilterBar` states both reasons the
  // list is short and offers a way out of each; a narrowing the person
  // cannot see or undo would be worse than not implementing it at all.
  const assistantNarrowedOptions = useMemo(
    () => applyAssistantNarrowing(allOptions, assistantVisibleOptionIds),
    [allOptions, assistantVisibleOptionIds],
  );
  const visibleOptions = useMemo(
    () => applyWorkspaceFilters(assistantNarrowedOptions, filters, filterableDefinitions),
    [assistantNarrowedOptions, filters, filterableDefinitions],
  );

  // Hoisted above this component's `activeCaseId === null` early return
  // (the launcher branch) together with `openProfile` below it: a
  // `useMemo` placed after a conditional return changes hook order
  // between renders, which React answers by rendering nothing at all.
  // Both depend only on `installedPacks`/`snapshot`, declared far above.
  const activePack = installedPacks.find((pack) => pack.identity.id === snapshot?.pack.id) ?? null;

  /**
   * The lens the person is looking through, and the handler that changes it.
   *
   * Derived, never tracked: the active lens is whichever declared lens's
   * attribute set matches the persisted `visibleAttributeIds`, so a lens set
   * by a WebMCP `sift_set_view` call from ChatGPT shows as selected here
   * too. Tracking it in local state instead would make the pane and the
   * assistant disagree about what is on screen, which is the exact class of
   * bug ADR 0005 exists to prevent.
   *
   * Order-insensitive comparison: `setView` round-trips the array through
   * the server, and a lens is a SET of fields. Comparing element-wise would
   * silently deselect a lens whose own order the server ever returned
   * differently.
   */
  const packLenses = activePack?.lenses ?? [];
  const persistedVisibleAttributeIds = snapshot?.view?.visibleAttributeIds;
  const activeLensId =
    persistedVisibleAttributeIds === undefined
      ? null
      : (packLenses.find(
          (lens) =>
            lens.attributeIds.length === persistedVisibleAttributeIds.length &&
            lens.attributeIds.every((id) => persistedVisibleAttributeIds.includes(id)),
        )?.id ?? null);

  const handleLensChange = useCallback(
    (lensId: string | null) => {
      const lens = lensId === null ? null : (packLenses.find((l) => l.id === lensId) ?? null);
      // `null` for "All fields" is a real intent, distinct from "no intent":
      // it must CLEAR `visibleAttributeIds` so the case returns to the state
      // it had before anyone picked a lens.
      intendedViewRef.current.lensAttributeIds = lens === null ? null : lens.attributeIds;
      // Reuses the filter writer rather than adding a third single-flight
      // queue racing the other two. Both fields land in one `setView`, which
      // is strictly safer than a separate writer would be -- and a lens
      // changes which FIELDS are shown, never which options, so unlike a
      // filter change it cannot strand the Quick Pick queue position.
      desiredFiltersRef.current = intendedViewRef.current.filters ?? filters;
      void drainFilterWrites();
    },
    [packLenses, filters, drainFilterWrites],
  );

  /**
   * The persistent frame's two halves, both derived rather than tracked.
   *
   * `deriveNextMoves` is the single source of "what should I do next" -- the
   * same list the WebMCP `sift_get_interaction_context` tool returns -- so
   * the pane and the model cannot disagree about it. The dock renders at
   * most the first two.
   */
  const decisionOrientation = useMemo(
    () => (snapshot === null ? null : buildDecisionOrientation(snapshot, activePack)),
    [snapshot, activePack],
  );
  const nextMoves = useMemo(
    () => (snapshot === null || activePack === null ? [] : deriveNextMoves(snapshot, activePack)),
    [snapshot, activePack],
  );

  /**
   * How far down `case-workspace-scroll`'s "optimal viewing region" has to
   * start, so that scrolling something to the top of the pane does not park
   * it underneath the sticky chrome that is already there.
   *
   * `DecisionOrientationShell`'s pinned row is `position: sticky; top: 0`
   * inside that scroller (see its own "Sticky positioning" section). That is
   * correct and stays: it keeps the row in flow, and content passing *under*
   * it while a person free-scrolls is what a sticky header is for. The defect is
   * narrower and only shows up when the product scrolls on the person's
   * behalf. `handleReviewDecidedCase` and `handleConfirmShortlist` below both
   * call `scrollIntoView({block: 'start'})`, which aligns the target's top
   * edge with the scrollport's top edge -- which is precisely where the shell
   * is parked. Measured in Chromium at 430px, on the real
   * `confirm_shortlist` dock button ("Confirm what moves forward", the one
   * control in the product wearing a "Your decision" badge): the hero landed
   * at `top: -0.25` with the shell spanning `0.19 -> 133.75`, so its first
   * 134px sat behind the shell and its heading -- "Leading so far: 2022
   * Toyota RAV4 XLE Hybrid AWD", the entire point of going there -- was
   * *completely* hidden, at `15.75 -> 66.13`. Focus landed on it too, so a
   * screen-reader user was placed on a region a sighted user could not see.
   *
   * `scroll-padding-top` on the scroll container, rather than
   * `scroll-margin-top` on each target: it is one declaration on the element
   * that owns the scrollport instead of one per target that a future target
   * can forget, and it applies to every way a box gets scrolled into that
   * region -- `scrollIntoView`, focus, fragment navigation -- not only to the
   * two call sites known to be broken today.
   *
   * The value is measured rather than declared because the shell's height is
   * genuinely variable: it changes with `layout`, with the host's font, and
   * with how many lines the summary row wraps to in a 390px pane. A constant
   * would be right in one state and wrong in the others, which is how this
   * class of bug comes back. Verified after the fix by the same measurement:
   * `coveredPx: 0`, heading visible.
   *
   * What it no longer changes with is the shell's own disclosure. The two
   * qualification lines and the expanded detail now render *below* the
   * sticky element instead of inside it (`DecisionOrientationShell`'s "What
   * is pinned" -- they are still unconditionally visible, they simply scroll
   * with the content they qualify), so `containerRef` lands on a box that is
   * exactly the pinned chrome and nothing else. Re-measured at 390px on a
   * case carrying a provisional qualification: 133.56px collapsed and
   * 183.94px expanded before, 72px in both states after. The unpinned block
   * must stay out of this number -- it never covers a scrolled-to region, so
   * counting it would push every one of them down by a band of clear space.
   *
   * `ResizeObserver` is feature-detected because jsdom -- the environment the
   * component tests run in -- does not implement it. There it is simply
   * absent, the effect measures once and stops, and the measurement is `0`
   * anyway since jsdom computes no layout. Nothing about this is load-bearing
   * in a unit test; the regression that guards it is a real-browser one
   * (`assertScrollIntoViewClearsStickyChrome`).
   */
  const orientationShellRef = useRef<HTMLElement | null>(null);
  const [workspaceScrollPaddingPx, setWorkspaceScrollPaddingPx] = useState(0);
  const orientationShellRendered =
    decisionOrientation !== null && snapshot?.discovery !== undefined;
  useEffect(() => {
    const node = orientationShellRef.current;
    if (!orientationShellRendered || node === null) {
      setWorkspaceScrollPaddingPx(0);
      return;
    }
    const measure = (): void => {
      setWorkspaceScrollPaddingPx(node.getBoundingClientRect().height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [orientationShellRendered, layout]);

  /**
   * The blind-spot prompts this case is actually being offered, in pack
   * order, resolved from the same `deriveDiscoveryReadiness` the dock's
   * `review_blind_spots` move and the WebMCP interaction context already
   * use (`applicableBlindSpotIds`). Derived in the browser from `@sift/core`
   * for the reason `case-scoreboard.ts` documents for the scoreboard: the
   * rule lives in core, so the pane cannot apply a second, drifting version
   * of "which checks apply to this case".
   *
   * These become `offeredPromptIds` verbatim when the review is completed --
   * a recorded review has to name what the person was genuinely shown.
   */
  const applicableBlindSpotPrompts = useMemo(() => {
    if (snapshot === null || activePack === null) return [];
    const applicable = new Set(
      deriveDiscoveryReadiness(snapshot, activePack).applicableBlindSpotIds,
    );
    return (activePack.discovery?.blindSpots ?? []).filter((prompt) => applicable.has(prompt.id));
  }, [snapshot, activePack]);

  // The human counterpart to `sift_get_option_details`, the WebMCP tool that
  // has been handing ChatGPT a complete per-option profile this whole time
  // while no screen showed one. Re-derived from the live snapshot on every
  // change (see `profileOptionId` above for why the id, not the record, is
  // what state holds).
  //
  // Deliberately built from `snapshot`, never from `visibleOptions`: a
  // filter narrows what you are BROWSING, and it must not be able to blank
  // out a detail view you already have open. `deriveOptionProfile` returns
  // `null` for an unknown id, which is also what a removed option should
  // produce -- an honest absence rather than an empty shell.
  const openProfile = useMemo(
    () =>
      snapshot === null || profileOptionId === null
        ? null
        : deriveOptionProfile(snapshot, profileOptionId, activePack?.presentation ?? null),
    [snapshot, profileOptionId, activePack],
  );

  // The deterministic ranking (ADR 0012), computed IN THE BROWSER from the
  // snapshot this component already holds rather than fetched. That is not an
  // optimization: `scoreCaseState` is pure and cheap, so a reweight arriving
  // over SSE re-renders the ranking in the same frame as every other
  // snapshot-derived value -- no request, no cache to invalidate, and no
  // window in which the visible order disagrees with the visible weights.
  // It is also the SAME function `apps/agent` calls when it validates a
  // recommendation, so the workspace can never show one leader while the
  // recommendation names another.
  //
  // Built from `snapshot`, deliberately never from `visibleOptions`: a rank
  // is a claim about the whole candidate set, and recomputing it over a
  // filtered subset would silently renumber "#2 of 4" to "#1 of 2" the moment
  // someone hid a car -- a different claim, made without saying so.
  const scoreboard = useMemo(() => buildWorkspaceScoreboard(snapshot), [snapshot]);

  // Read through the shared selector rather than off the board directly, so
  // the "no ranking when there is nothing to rank" gate lives in exactly one
  // place for all three surfaces that render it.
  const openProfileRanking = useMemo(
    () => (profileOptionId === null ? null : selectOptionRanking(scoreboard, profileOptionId)),
    [scoreboard, profileOptionId],
  );

  const installedPacksRef = useRef(installedPacks);
  installedPacksRef.current = installedPacks;

  const [toolHandle, setToolHandle] = useState<SiftToolRegistrationHandle | null>(null);
  // A parallel ref, disposed directly from the cleanup function below rather
  // than through `setToolHandle`'s functional-updater form: React does not
  // guarantee a state updater callback passed to a setter invoked *during
  // unmount cleanup* actually runs (the fiber is being torn down, so there
  // is no next render to compute state for) -- relying on it here would
  // make `disposeAll()` unreliable on unmount specifically, exactly the
  // lifecycle moment webmcp.md's "Abort the previous registration
  // controller whenever ... the component unmounts" most needs to hold.
  const toolHandleRef = useRef<SiftToolRegistrationHandle | null>(null);

  useEffect(() => {
    let disposed = false;
    // This controller exists before registration's first await, so React
    // Strict Mode's development-only setup -> cleanup -> setup cycle can
    // cancel a partially-registered generation before the replacement tries
    // to register the same stable WebMCP tool names.
    const registrationController = new AbortController();
    registerSiftTools({
      adapter: webMcpAdapter,
      commands,
      signal: registrationController.signal,
      getActiveCase: () => snapshotRef.current,
      listPacks: () => installedPacksRef.current,
    })
      .then((handle) => {
        if (disposed) {
          handle.disposeAll();
          return;
        }
        toolHandleRef.current = handle;
        setToolHandle(handle);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      registrationController.abort();
      toolHandleRef.current?.disposeAll();
      toolHandleRef.current = null;
      setToolHandle(null);
    };
    // Deliberately depends only on [webMcpAdapter, commands], not
    // snapshot/installedPacks -- `getActiveCase`/`listPacks` read those
    // fresh via the refs above on every call instead of retriggering
    // registration on every snapshot/pack-list change.
  }, [webMcpAdapter, commands]);

  // Case-scoped tools re-register (aborting the previous generation) every
  // time the active case changes -- including a reset (a fresh caseId) or a
  // return to the launcher (`null`).
  useEffect(() => {
    toolHandle?.setActiveCase(activeCaseId).catch(() => undefined);
  }, [toolHandle, activeCaseId]);

  // Never leaves the Inspector open across a reset-demo/case change -- a
  // stale `runId`/`debugEventId` from a case that no longer applies would
  // otherwise still be showing when the new case's workspace renders.
  useEffect(() => {
    closeRuntimeInspector();
  }, [activeCaseId, closeRuntimeInspector]);

  /**
   * Which case THIS instance of `App` has already decided the guide for.
   *
   * Two things force the guard. `markFirstRunGuideSeen()` is a side effect
   * on the effect's FIRST pass, so React's StrictMode double-invoke would
   * otherwise reach the "already seen" branch on its second pass and shut
   * the guide it had just opened. And the open flag now lives in a module
   * singleton (`useUiStore`), which a remount does not clear the way the
   * former `useState` did -- so the effect has to be able to say "not this
   * time" as well as "now", and the ref is what stops those two facts from
   * cancelling each other out.
   */
  const firstRunDecidedForCaseRef = useRef<string | null>(null);

  /**
   * Shows the first-run guide once, ever, per browser.
   *
   * Keyed on `activeCaseId` and not on mount, because the guide explains a
   * workspace -- naming controls that do not exist yet on the launcher
   * screen would be worse than saying nothing, and the project owner asked
   * for it "when the user starts a new case."
   *
   * `markFirstRunGuideSeen()` runs HERE, at the moment it opens, rather
   * than in the dismiss handler. Dismissal is not the only way out of a
   * modal: a reload, a "Reset demo", or a closed tab all leave it
   * un-dismissed, and marking on dismissal would let every one of those
   * re-nag. A judge who resets five times must see this once. Nothing is
   * lost by the stricter rule, because the identical content stays
   * permanently reachable from the Help control in the app bar (see
   * `HelpButton.tsx`).
   *
   * `hasSeenFirstRunGuide()` swallows a throwing `localStorage` and reports
   * `false`, so a private window shows the guide and simply cannot remember
   * that it did -- the harmless direction to fail in.
   */
  useEffect(() => {
    if (activeCaseId === null) return;
    if (firstRunDecidedForCaseRef.current === activeCaseId) return;
    firstRunDecidedForCaseRef.current = activeCaseId;
    if (hasSeenFirstRunGuide()) {
      closeFirstRunGuide();
      return;
    }
    markFirstRunGuideSeen();
    openFirstRunGuide();
  }, [activeCaseId, openFirstRunGuide, closeFirstRunGuide]);

  const handleDismissFirstRunGuide = useCallback(() => {
    // Idempotent with the effect above -- kept so a storage write that
    // failed at open time (a transient quota error) gets one more chance
    // before this browser is nagged again.
    markFirstRunGuideSeen();
    closeFirstRunGuide();
    requestHelpFocus();
  }, [closeFirstRunGuide, requestHelpFocus]);

  // The guide can be dismissed before the workspace has finished loading,
  // and the app bar -- which owns the Help control focus is handed back to
  // -- only renders once `snapshot` is non-null. Dismiss in that window and
  // `helpButtonRef.current` is genuinely null, so `FirstRunGuide`'s
  // `onCloseAutoFocus` hands back to Radix, which sends focus to `<body>`:
  // a keyboard user is left nowhere, with no visible cause, and nothing
  // ever recovers it because the Help control mounts afterwards.
  //
  // This claims the focus once the control actually exists. It fires only
  // after a real dismissal, and clears itself immediately, so it can never
  // steal focus from something a person chose later.
  useEffect(() => {
    if (!helpFocusPending) return;
    const target = helpButtonRef.current;
    if (target === null) return;
    if (document.activeElement !== target) target.focus();
    clearHelpFocus();
  }, [helpFocusPending, snapshot, clearHelpFocus]);

  // A stage a person navigated to belongs to the case they navigated it on.
  // `workflowStageOverride` lives in the module-singleton UI store, so it
  // outlives the workspace's `key={activeCaseId}` remount -- harmless while
  // the stepper gated nothing, and wrong now that it gates the whole
  // workspace: switching or resetting a decision would otherwise open the new
  // case parked on a step whose prerequisites that case has never met, with
  // the stepper drawing a locked step as the current one. Clearing it returns
  // the new case to its own derived recommendation. Presentation state only --
  // no command, no `eventSequence` (ADR 0005).
  useEffect(() => {
    setWorkflowStage(null);
  }, [activeCaseId, setWorkflowStage]);

  const readiness = useMemo(() => (snapshot ? evaluateReadiness(snapshot) : null), [snapshot]);

  // `lastRunReceipt` (session-local) takes priority once a real command has
  // been sent this browser lifetime; before that -- a fresh load or a
  // reload -- fall back to a receipt derived from the case's own replayed
  // history. See `deriveReceiptFromEvents`.
  //
  // Scoped to `activeCaseId` here, not just handed the raw `events` array:
  // on "Reset demo" (`handleResetDemo` below), `setActiveCaseId(newId)` and
  // `setLastRunReceipt(null)` can commit and render before `useCaseEvents`'s
  // own internal `events` state (keyed by `caseId`) has cleared for the
  // outgoing case, so for one frame `events` can still hold the *previous*
  // case's history. Filtering by each event's own `caseId` here (rather than
  // trusting the hook's timing) keeps the derived fallback from ever
  // reflecting a case other than the one currently active.
  const derivedRunReceipt = useMemo(
    () => deriveReceiptFromEvents(events.filter((event) => event.caseId === activeCaseId)),
    [events, activeCaseId],
  );
  const liveRunStatusReceipt = lastRunReceipt ?? derivedRunReceipt;

  // The Runtime Inspector's Activity tab (Task A5: "the activity ledger
  // moves here") gets the same case-scoped filter `derivedRunReceipt`
  // above uses, for the identical reason: on a case switch, `events` can
  // briefly still hold the outgoing case's history for one frame.
  const caseScopedActivityEvents = useMemo(
    () => events.filter((event) => event.caseId === activeCaseId),
    [events, activeCaseId],
  );

  // Returns to the launcher. The storage effect above already handles the
  // pointer ("Also fires on a reset-demo/return-to-launcher transition") --
  // that transition simply had no control to trigger it until now, so a
  // person who opened one demo was stuck in it for the life of the browser
  // profile.
  const handleSwitchDecision = useCallback(() => {
    setActiveCaseId(null);
    setLastRunReceipt(null);
  }, []);

  const handleResetDemo = useCallback(() => {
    if (snapshot === null) return;
    const demoId = DEMO_IDS.find((id) => id === snapshot.pack.id);
    if (demoId === undefined) return;
    setResetPending(true);
    commands
      .startDemo({ demoId })
      .then((receipt) => {
        setResetPending(false);
        setActiveCaseId(receipt.caseId);
        setLastRunReceipt(null);
      })
      .catch(() => {
        setResetPending(false);
      });
  }, [commands, snapshot]);

  const handleRequestInvestigation = useCallback(
    (obligationId?: string) => {
      if (snapshot === null || activeCaseId === null) return;
      setRunRequestPending(true);
      setRunRequestError(null);

      // A conflict here (a stale `expectedSequence`) is a real, expected
      // occurrence of the real-time system, not just a test artifact: the
      // browser's own SSE-delivered snapshot can be one event behind the
      // server at the exact instant this control is pressed (e.g. right
      // after confirming a case-specific concern). architecture.md's
      // conflict envelope exists precisely so a caller can recover without
      // asking the human to do anything: "Conflicts return the latest
      // sequence so ChatGPT can call sift_get_case_context before retrying."
      // This performs that same recovery for the visible control -- one
      // automatic retry using the server-reported `actualSequence` -- before
      // ever surfacing an error to the human.
      const attempt = (expectedSequence: number, alreadyRetried: boolean): void => {
        commands
          .requestInvestigation({
            caseId: activeCaseId,
            expectedSequence,
            ...(obligationId !== undefined ? { obligationId } : {}),
          })
          .then((receipt) => {
            setRunRequestPending(false);
            setLastRunReceipt({ commandId: receipt.commandId, runId: receipt.runId });
          })
          .catch((caught: unknown) => {
            if (
              !alreadyRetried &&
              caught instanceof SiftClientError &&
              caught.code === 'CONFLICT'
            ) {
              const details = caught.details as { actualSequence?: unknown } | undefined;
              if (typeof details?.actualSequence === 'number') {
                attempt(details.actualSequence, true);
                return;
              }
            }
            setRunRequestPending(false);
            setRunRequestError(
              caught instanceof Error ? caught.message : 'Could not request an investigation.',
            );
          });
      };
      // The first attempt already goes out on the freshest sequence this
      // client can obtain (`resolveExpectedSequence`), so the retry above is
      // now what its own comment always said it was -- recovery from a
      // genuine race with another writer -- rather than routine cleanup after
      // this client's own snapshot lag.
      void resolveExpectedSequence().then((expectedSequence) => {
        attempt(expectedSequence, false);
      });
    },
    [commands, snapshot, activeCaseId, resolveExpectedSequence],
  );

  const handleReviewProposal = useCallback(
    (review: ApprovalCardReview) => {
      if (!snapshot?.proposal || activeCaseId === null) return;
      const proposalId = snapshot.proposal.id;
      setProposalReviewPending(true);
      setProposalReviewError(null);
      resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.reviewProposal({
            caseId: activeCaseId,
            proposalId,
            actor: review.actor,
            decision: review.decision,
            expectedSequence,
            ...(review.instructions !== undefined ? { instructions: review.instructions } : {}),
            ...(review.reason !== undefined ? { reason: review.reason } : {}),
          }),
        )
        .then(() => {
          setProposalReviewPending(false);
        })
        .catch((caught: unknown) => {
          setProposalReviewPending(false);
          setProposalReviewError(
            caught instanceof Error ? caught.message : 'Could not submit this review.',
          );
        });
    },
    [commands, snapshot, activeCaseId, resolveExpectedSequence],
  );

  const handleSetDisposition = useCallback(
    (evidenceId: string, disposition: EvidenceDisposition, reason: string) => {
      if (snapshot === null || activeCaseId === null) return;
      setDispositionPendingId(evidenceId);
      setDispositionError(null);
      resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.setEvidenceDisposition({
            caseId: activeCaseId,
            evidenceId,
            disposition,
            reason,
            expectedSequence,
          }),
        )
        .then(() => {
          setDispositionPendingId(null);
        })
        .catch((caught: unknown) => {
          setDispositionPendingId(null);
          setDispositionError(
            caught instanceof Error ? caught.message : 'Could not update this evidence item.',
          );
        });
    },
    [commands, snapshot, activeCaseId, resolveExpectedSequence],
  );

  // Real WebMCP-parity focus wiring (change-set §30 "WebMCP should control
  // focus"): the same `focusOption` command a `sift_focus_option` tool call
  // uses (docs/engineering-principles.md "Visible UI controls and WebMCP callbacks use the same
  // command implementation"). Deliberately fire-and-forget with no pending/
  // error UI state of its own: ADR 0005 designed `focusOption` to route
  // through `updateSelection()` specifically so a presentation-only action
  // like this is "safe to be called freely and repeatedly without human
  // confirmation" (ADR 0005 consequences) -- a dropped click here is a
  // missed visual focus update, not a lost decision, so it does not earn a
  // new blocking error surface the way `requestInvestigation`/
  // `reviewProposal`/`setEvidenceDisposition` do.
  // `optionId: string | null` -- `null` clears the focused option
  // (FocusOptionInputSchema's own doc comment, packages/contracts/src/
  // commands.ts). The three option views compute `null` themselves when the
  // clicked card is already the selected one, so this handler stays a plain
  // pass-through: it does not itself decide select vs. clear, matching every
  // other command handler in this file that reports intent rather than
  // deciding it.
  const handleFocusOption = useCallback(
    (optionId: string | null) => {
      if (snapshot === null || activeCaseId === null) return;
      void resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.focusOption({ caseId: activeCaseId, optionId, expectedSequence }),
        )
        .catch(() => undefined);
    },
    [commands, snapshot, activeCaseId, resolveExpectedSequence],
  );

  const handleQuickPickAdvance = useCallback(() => {
    setQuickPickPosition((position) => position + 1);
  }, []);

  /**
   * A Quick Pick judgment, persisted.
   *
   * Before this, Keep/Pass/Unsure only moved a local counter and "Shortlist"
   * merely focused the option -- the person's judgment vanished on reload
   * and ChatGPT could not read it back on its next turn, which made the
   * whole bidirectional claim untrue at exactly the beat the demo rests on.
   *
   * `unreviewed` is how undo is expressed: it puts the candidate back in the
   * queue as a normal forward command, so the history of what someone
   * considered and rejected stays in the event log rather than being erased.
   */
  const handleQuickPickDisposition = useCallback(
    (optionId: string, disposition: CandidateDisposition) => {
      if (snapshot === null || activeCaseId === null) return;
      resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.setCandidateDisposition({
            caseId: activeCaseId,
            expectedSequence,
            actor: 'human',
            entityId: optionId,
            disposition,
          }),
        )
        .then((receipt) => {
          lastAcceptedSequenceRef.current = Math.max(
            lastAcceptedSequenceRef.current,
            receipt.acceptedSequence,
          );
        })
        .catch(() => undefined);
      // Undo puts the candidate back in the queue rather than moving past
      // it; every other judgment advances.
      if (disposition !== 'unreviewed') handleQuickPickAdvance();
    },
    [commands, snapshot, activeCaseId, handleQuickPickAdvance, resolveExpectedSequence],
  );

  /**
   * Taking a move from the action dock.
   *
   * The dock offers what `deriveNextMoves` says is valid, and each move
   * names the view it needs. A human-only move -- confirming a shortlist,
   * deciding -- carries no `toolName` by contract, and this handler does not
   * perform it either: it brings the person to the view where the real,
   * human-only control lives. Nothing here can approve anything.
   */
  /**
   * Puts the next question on screen.
   *
   * Everything in the request is read from the compiled pack -- the prompt
   * is the topic's own question, the options its declared seeds, the
   * escapes the ones it allows. Nothing is generated here.
   *
   * This closed the gap that made adaptive discovery unanswerable in the
   * running product: the dock rendered the next question as a button that
   * only switched views, so a person could not answer anything in the pane.
   */
  const handleAskTopic = useCallback(
    (topicId: string) => {
      const current = snapshotRef.current;
      if (current === null || activePack === null) return;
      const request = buildInteractionForTopic({
        pack: activePack,
        topicId,
        id: `interaction-${topicId}-${String(current.eventSequence)}`,
        now: new Date().toISOString(),
      });
      if (request === null) return;
      // Intake owns "pending discovery interactions" (ADR 0016), so the
      // question this command opens renders there. Navigating with it is what
      // keeps the dock's `answer_topic`/`confirm_inference` moves answering
      // something a person can see: without it, a move pressed from Analysis
      // would post a real question onto a step the person is not standing on.
      // Presentation state only -- `setWorkflowStage` writes to `ui-store`,
      // never to the server (ADR 0005).
      setWorkflowStage('intake');
      setInteractionError(null);
      resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.requestInteraction({
            caseId: current.id,
            expectedSequence,
            interaction: request,
          }),
        )
        .then((receipt) => {
          lastAcceptedSequenceRef.current = Math.max(
            lastAcceptedSequenceRef.current,
            receipt.acceptedSequence,
          );
        })
        .catch((error: unknown) => {
          // Surfaced, not swallowed. A bare `.catch(() => undefined)` here
          // hid a schema rejection for an entire debugging session: the
          // button did nothing and the console said nothing.
          setInteractionError(
            error instanceof Error
              ? `Sift could not open that question: ${error.message}`
              : 'Sift could not open that question.',
          );
        });
    },
    [activePack, commands, resolveExpectedSequence, setWorkflowStage],
  );

  const handleInteractionResponse = useCallback(
    (response: InteractionResponse) => {
      const current = snapshotRef.current;
      if (current === null) return;
      resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.submitInteractionResponse({
            caseId: current.id,
            expectedSequence,
            response,
          }),
        )
        .then((receipt) => {
          lastAcceptedSequenceRef.current = Math.max(
            lastAcceptedSequenceRef.current,
            receipt.acceptedSequence,
          );
        })
        .catch(() => undefined);
    },
    [commands, resolveExpectedSequence],
  );

  // Scroll/focus target for the `review_question` dock action -- see
  // `handleReviewDecidedCase` immediately below. `RecommendationHero`'s own
  // outer region (`data-testid="recommendation-hero"`) is the target, via
  // the `containerRef` prop it accepts for exactly this. Declared here,
  // ahead of `handleDockAction`, because `handleReviewDecidedCase` must
  // exist before `handleDockAction`'s dependency array below references it.
  const recommendationHeroRef = useRef<HTMLDivElement>(null);

  /**
   * The `review_question` dock move: `deriveNextMoves`'s one review-only
   * move, and the ONLY move it offers on a decided case -- so this is the
   * dock's primary (and only) button on the final screen of both hero
   * journeys. There is nothing new to build for it: `RecommendationHero`
   * directly below already renders the decided headline plus
   * `RecommendationCard`/`ApprovalCard` for the settled decision, so the
   * honest action is bringing the person to it rather than inventing a new
   * view or a modal. `scrollIntoView` makes it visible; `.focus()` (onto a
   * `tabIndex={-1}` target `RecommendationHero` exposes for exactly this)
   * makes the same action work for a keyboard/screen-reader user, who would
   * otherwise have no way to tell the click did anything at all.
   */
  const handleReviewDecidedCase = useCallback(() => {
    const target = recommendationHeroRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus();
  }, []);

  /**
   * Scroll/focus target for the `confirm_shortlist` dock action -- the same
   * mechanism `recommendationHeroRef` above uses, aimed one region deeper.
   * `ApprovalCard` (inside `RecommendationHero`) exposes a `containerRef`
   * and a `tabIndex={-1}` outer `<section>` for exactly this; its
   * `aria-labelledby` heading is "Your decision", so a screen reader
   * announces the right thing the moment focus lands.
   */
  const approvalCardRef = useRef<HTMLElement>(null);

  /**
   * The `confirm_shortlist` dock move: the only `humanOnly` move
   * `deriveNextMoves` derives, rendered with the dock's "Your decision"
   * badge, and previously the single most important dead button in the
   * product -- its `requiredView` is `'confirmation'`, which is not a
   * `WorkspaceViewMode` at all, so no view switch could ever have served it.
   *
   * It navigates. It does not act. The controls this move points at
   * (`ApprovalCard`'s Approve / Reject / Request revision) are already on
   * the page whenever this move exists, and docs/engineering-principles.md is explicit that no
   * automatic path may approve a consequential decision: "The model may
   * propose candidate events and recommendations. It may never approve a
   * consequential decision." A dock button that pressed Approve on the
   * person's behalf would defeat the exact claim the "Your decision" badge
   * beside it makes. So this brings the person to the control and stops.
   *
   * The hero is the fallback because `confirm_shortlist` is derived from
   * `recommendation.status === 'ready'` alone -- it can be offered before a
   * `DecisionProposal` exists, and `RecommendationHero` renders no
   * `ApprovalCard` at all in that state. Landing on the region that does
   * carry the recommendation is still an answer to "where is this?";
   * silently doing nothing is not.
   */
  const handleConfirmShortlist = useCallback(() => {
    // Decide owns the approval controls (ADR 0016; change set: "Approval
    // controls belong to Decide"), so this move navigates there first. The
    // guard is the same condition that makes Decide available at all -- a
    // `confirm_shortlist` derived from `recommendation.status === 'ready'`
    // can be offered before any proposal exists, and sending a person to a
    // locked step would be worse than the hero fallback below.
    if (snapshotRef.current?.proposal != null) setWorkflowStage('decide');
    // Still measured from whatever is mounted RIGHT NOW: the stage change
    // above lands on the next render, so on the frame a person leaves an
    // upstream step this falls back to the hero -- which is always on screen,
    // always carries the recommendation, and sits directly above the approval
    // card the next render mounts under it.
    const target: HTMLElement | null = approvalCardRef.current ?? recommendationHeroRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus();
  }, [setWorkflowStage]);

  /**
   * The `review_blind_spots` dock move: the last gate before discovery
   * (`deriveDiscoveryReadiness` blocks on `blind_spot_review_incomplete`
   * until it is done), and the dock's PRIMARY button once every required
   * topic is answered.
   *
   * Every layer of this already existed except the screen -- the
   * `completeBlindSpotReview` command, its event, its reducer branch, and
   * the readiness blocker -- so the honest fix is to render the pack's own
   * prompts and call that command, not to invent a second notion of what a
   * blind-spot review is. See `BlindSpotReviewSheet`'s own header.
   */
  const handleReviewBlindSpots = useCallback(() => {
    setBlindSpotReviewError(null);
    openBlindSpotReview();
  }, [openBlindSpotReview]);

  const handleCompleteBlindSpotReview = useCallback(
    (selectedPromptIds: string[]) => {
      const current = snapshotRef.current;
      if (current === null) return;
      const offeredPromptIds = applicableBlindSpotPrompts.map((prompt) => prompt.id);
      if (offeredPromptIds.length === 0) return;
      setBlindSpotReviewError(null);
      setBlindSpotReviewPending(true);
      resolveExpectedSequence()
        .then((expectedSequence) =>
          commands.completeBlindSpotReview({
            caseId: current.id,
            expectedSequence,
            // The literal, never a variable: `CompleteBlindSpotReviewInput`
            // refuses any other actor, and nobody but the person can say what
            // they did not think of.
            actor: 'human',
            offeredPromptIds,
            selectedPromptIds,
          }),
        )
        .then((receipt) => {
          lastAcceptedSequenceRef.current = Math.max(
            lastAcceptedSequenceRef.current,
            receipt.acceptedSequence,
          );
          closeBlindSpotReview();
        })
        .catch((error: unknown) => {
          // Surfaced in the sheet, not swallowed -- the same rule
          // `interactionError` exists for.
          setBlindSpotReviewError(
            error instanceof Error
              ? `Sift could not record that review: ${error.message}`
              : 'Sift could not record that review.',
          );
        })
        .finally(() => {
          setBlindSpotReviewPending(false);
        });
    },
    [applicableBlindSpotPrompts, commands, resolveExpectedSequence, closeBlindSpotReview],
  );

  const handleDockAction = useCallback(
    (move: NextMove) => {
      // A question is answered in place, not by navigating somewhere.
      if (
        (move.kind === 'answer_topic' || move.kind === 'confirm_inference') &&
        move.topicId !== undefined
      ) {
        handleAskTopic(move.topicId);
        return;
      }

      // The one review-only move (see `handleReviewDecidedCase`'s own
      // comment): brings the person to the region that already carries the
      // answer instead of navigating to a view at all.
      if (move.kind === 'review_question') {
        handleReviewDecidedCase();
        return;
      }

      // The one human-only move: brings the person to the approval control
      // and never touches it. See `handleConfirmShortlist`.
      if (move.kind === 'confirm_shortlist') {
        handleConfirmShortlist();
        return;
      }

      // The last gate before discovery, and the only move whose surface is
      // a sheet rather than a region already on the page.
      if (move.kind === 'review_blind_spots') {
        handleReviewBlindSpots();
        return;
      }

      const viewForMove: Partial<Record<string, WorkspaceViewMode>> = {
        quick_pick: 'quick_pick',
        compare_retained: 'compare',
        discover_candidates: 'list',
      };
      const mode = viewForMove[move.kind];
      if (mode !== undefined) {
        // Review owns every option view (ADR 0016), so a move that switches
        // views has to arrive at the step that renders them -- otherwise the
        // dock's primary button would change a view nobody is looking at.
        // Guarded on having something to review, which is exactly what makes
        // Review reachable (`reviewStarted`); with nothing to review the
        // stage gate is already showing the views wherever the person is.
        if ((snapshotRef.current?.entities.length ?? 0) > 0) setWorkflowStage('review');
        handleViewModeChange(mode);
        return;
      }
      if (move.kind === 'discover_candidates' || move.kind === 'await_investigation') {
        handleRequestInvestigation();
      }
    },
    [
      handleViewModeChange,
      handleRequestInvestigation,
      handleAskTopic,
      handleReviewDecidedCase,
      handleConfirmShortlist,
      handleReviewBlindSpots,
      setWorkflowStage,
    ],
  );

  const handleQuickPickKeep = useCallback(
    (optionId: string) => {
      handleQuickPickDisposition(optionId, 'keep');
    },
    [handleQuickPickDisposition],
  );
  const handleQuickPickPass = useCallback(
    (optionId: string) => {
      handleQuickPickDisposition(optionId, 'pass');
    },
    [handleQuickPickDisposition],
  );
  const handleQuickPickUnsure = useCallback(
    (optionId: string) => {
      handleQuickPickDisposition(optionId, 'unsure');
    },
    [handleQuickPickDisposition],
  );
  const handleQuickPickUndo = useCallback(
    (optionId: string) => {
      handleQuickPickDisposition(optionId, 'unreviewed');
    },
    [handleQuickPickDisposition],
  );

  /** Canonical Quick Pick judgments, projected for the view. Derived from case state, never held locally. */
  const quickPickDispositions = useMemo<Record<string, CandidateDisposition>>(() => {
    const map: Record<string, CandidateDisposition> = {};
    for (const record of snapshot?.discovery?.dispositions ?? []) {
      map[record.entityId] = record.disposition;
    }
    return map;
  }, [snapshot]);

  // The alert banner's "Sift proposed something" action (ADR 0008). No
  // longer layout-aware: the narrow "add-concern" disclosure it used to
  // scroll into view no longer exists, so `workspace-add-concern-sheet` is
  // the single home for `CustomConcernForm`/`CaseExtensionReviewCard` in
  // both layouts and the old double-mount hazard cannot occur. See this
  // file's header comment ("Second follow-up") for the full reasoning.
  // Named rather than inlined at the alert-banner item below because this
  // file's own header comment refers to it by name when it explains why the
  // action stopped being layout-aware.
  const handleReviewPendingExtension = openAddConcern;

  if (activeCaseId === null) {
    if (restoringCaseId !== null) {
      // Avoids a launcher-then-workspace flash while the reload-restore
      // verification effect above confirms the stored case still resolves.
      return (
        <div
          data-testid="case-workspace-restoring"
          aria-busy="true"
          aria-live="polite"
          className="page-shell loading-pulse flex min-h-screen items-center justify-center bg-background p-[var(--space-4)] text-[var(--color-ink-secondary)]"
        >
          Restoring your case…
        </div>
      );
    }
    if (launcherMode === 'catalog') {
      return (
        <VehicleCatalogFlow
          onCaseCreated={handleCaseCreated}
          onCancel={() => setLauncherMode('launcher')}
        />
      );
    }
    return (
      <DemoLauncher
        onDemoStarted={handleDemoStarted}
        onCompareVehicles={() => setLauncherMode('catalog')}
      />
    );
  }

  const optionKind = activePack?.entities[0]?.id ?? 'option';
  const optionLabel = activePack?.presentation.optionLabel ?? 'option';
  const optionLabelPlural = activePack?.presentation.optionLabelPlural ?? `${optionLabel}s`;
  const applicableKinds =
    activePack !== null ? activePack.entities.map((entity) => entity.id) : [optionKind];

  // Decision Profile ("What you're looking for," change-set §15/§16;
  // spec-audit finding, addressed this task): a PURE projection of already-
  // canonical case state -- `deriveDecisionProfile` reads only
  // `snapshot.criteria`/`attributeDefinitions`/`caseExtensions`; nothing new
  // is stored, satisfying §15's explicit "not a second source of truth."
  // `activePack?.decisionGuide` (`CompiledDecisionPack.decisionGuide`,
  // packs.ts) supplies the real pack-authored guidance that populates
  // `suggestedQuestions`' `pack_guide` source -- both hero packs now declare
  // one, and it is genuinely reachable here via the same `activePack`
  // resolution every other pack-driven region on this page already uses, so
  // this is wired for real rather than reported as a gap. `DecisionProfileView`
  // itself is untouched (owned by another task) -- gating an empty profile
  // out of the DOM entirely happens here, at the orchestration level, the
  // same pattern this file already uses for `CaseExtensionReviewCard` (ADR
  // 0004 item 2: an empty conceptual region must be absent, not a card
  // announcing its own emptiness -- `DecisionProfileView`'s own internal
  // empty-state copy exists for a caller that has a real reason to show it
  // regardless, which this orchestration is not).
  //
  // Personal concerns render read-only here (`onConfirmConcern`/
  // `onRejectConcern` both omitted): `CaseExtensionReviewCard`, already
  // wired above (further below in this file) for the one currently-pending
  // agent-proposed extension, is the existing, tested review surface for
  // exactly this action. Wiring a SECOND independent confirm/reject control
  // here, over the same underlying `CaseExtension` records, would risk two
  // controls racing each other over one review decision for no requirement
  // this task names -- a deliberate, disclosed scope limit, not an
  // oversight (see this task's report).
  const decisionProfile = snapshot
    ? deriveDecisionProfile(snapshot, activePack?.decisionGuide)
    : null;
  const decisionProfileIsEmpty =
    decisionProfile === null ||
    (decisionProfile.mustHave.length === 0 &&
      decisionProfile.important.length === 0 &&
      decisionProfile.niceToHave.length === 0 &&
      decisionProfile.context.length === 0 &&
      decisionProfile.personalConcerns.length === 0 &&
      decisionProfile.missing.length === 0 &&
      decisionProfile.suggestedQuestions.length === 0);

  const evidenceItems = snapshot
    ? snapshot.evidenceLinks.map((link) => ({
        evidenceLink: link,
        claim:
          link.claimId !== undefined
            ? snapshot.claims.find((c) => c.id === link.claimId)
            : undefined,
        source:
          link.sourceId !== undefined
            ? snapshot.sources.find((s) => s.id === link.sourceId)
            : undefined,
      }))
    : null;

  const sources = snapshot ? Object.fromEntries(snapshot.sources.map((s) => [s.id, s])) : {};

  const pendingExtension =
    snapshot?.caseExtensions.find(
      (ext) =>
        ext.definition.origin === 'agent_proposed' && ext.definition.confirmation === 'pending',
    ) ?? null;

  const lastEvent = events.at(-1) ?? null;
  const withheld =
    snapshot !== null && snapshot.recommendation === null && lastEvent?.type === 'draft.withheld'
      ? { unresolvedRequiredCount: readiness?.blockers.length ?? 0 }
      : null;

  // Disclosure-row live summaries (ADR 0002: "nothing is hidden -- every
  // row's live state is visible without opening it"). Computed here, not
  // inside DisclosureSection or the wrapped child components, which stay
  // generic/unaware of their position in the workspace.
  const optionsCount = snapshot?.entities.length ?? 0;
  const decisionProfileConcernCount = decisionProfile
    ? decisionProfile.mustHave.length +
      decisionProfile.important.length +
      decisionProfile.niceToHave.length +
      decisionProfile.context.length
    : 0;
  const decisionProfileMeta =
    decisionProfileConcernCount > 0
      ? `${decisionProfileConcernCount} priorit${decisionProfileConcernCount === 1 ? 'y' : 'ies'} set`
      : undefined;
  const remainingObligationCount =
    readiness !== null
      ? readiness.active.length + readiness.blocked.length + readiness.open.length
      : 0;
  const stillCheckingMeta =
    readiness === null
      ? undefined
      : readiness.ready
        ? 'All checked'
        : `${remainingObligationCount} still open`;
  // Derived from the newest run's own lifecycle (`deriveActiveRunId`), not
  // from whatever phase the single most recent event happens to carry: a
  // real run's `tool.completed`/`skill.activated`/`specialist.completed`
  // events all report `phase: 'completed'` mid-run, so the old
  // last-event-phase test flickered false roughly every other event and the
  // hero reverted to "Nothing's been looked into yet." in the middle of an
  // investigation. Case-scoped for the same reason `derivedRunReceipt` is
  // (a case switch can leave the outgoing case's events in `events` for one
  // frame).
  const isRunActive = deriveActiveRunId(caseScopedActivityEvents) !== null;

  // "What Sift found" urgency signal (round-2 design review): a real count
  // of findings that are not fully verified or have aged past their
  // validity window -- never a fabricated "unread" count. Deliberately
  // excludes `evidence.conflicted` correlation, which the public activity
  // stream does not currently thread back onto individual evidence items
  // (see docs/build-log.md's dated entry for this task).
  const flaggedFindingsCount =
    evidenceItems?.filter((item) => item.evidenceLink.verdict !== 'pass' || item.evidenceLink.stale)
      .length ?? 0;

  // The favoured option's own label, resolved from the case's entities so
  // the answer-first hero can state the answer instead of labelling the
  // region "Current recommendation" with the option named nowhere on
  // screen (see `workspace-status.ts`'s `favoredOptionLabel`).
  const favoredOptionLabel = snapshot?.entities.find(
    (entity) => entity.id === snapshot.recommendation?.favoredOptionId,
  )?.label;

  const workspaceStatus = deriveWorkspaceStatus({
    isRunActive,
    recommendation: snapshot?.recommendation ?? null,
    proposal: snapshot?.proposal ?? null,
    flaggedFindingsCount,
    withheld: withheld !== null,
    ...(favoredOptionLabel === undefined ? {} : { favoredOptionLabel }),
  });

  const requiredDiscoveryTopics =
    snapshot?.discovery?.topics.filter((topic) => topic.necessity === 'required') ?? [];
  const requiredDiscoveryTotal = requiredDiscoveryTopics.length;
  const requiredDiscoveryResolved = requiredDiscoveryTopics.filter(
    (topic) => topic.status === 'confirmed' || topic.status === 'not_applicable',
  ).length;
  const intakeComplete =
    snapshot !== null &&
    snapshot.entities.length > 0 &&
    requiredDiscoveryResolved >= requiredDiscoveryTotal;
  const workflow = deriveCaseWorkflow({
    intakeComplete,
    prioritiesComplete: (snapshot?.criteria.length ?? 0) > 0,
    // Evidence is analysis output, so its presence is proof the stage has
    // done work even when no run is active and the activity feed is empty
    // (a restored case, or a snapshot loaded fresh from the server). Without
    // this the stage locks behind its own results: a case holding findings
    // reports Analysis as unavailable and the person cannot open them.
    analysisStarted:
      isRunActive ||
      caseScopedActivityEvents.length > 0 ||
      (snapshot?.evidenceLinks.length ?? 0) > 0,
    analysisComplete: snapshot?.recommendation !== null && snapshot?.recommendation !== undefined,
    // Review's own work is possible as soon as there is something to triage
    // or compare. See `CaseWorkflowFacts.reviewStarted`: without it, Review
    // stays `unavailable` until a recommendation exists, and the stage that
    // OWNS Quick Pick/List/Compare/Board/filters would be unreachable on
    // every case that has not been investigated yet.
    reviewStarted: optionsCount > 0 || (snapshot?.discovery?.dispositions.length ?? 0) > 0,
    // Review is NOT complete merely because a proposal exists. These two were
    // the same expression, so the instant analysis produced a proposal the
    // stepper marked Review done and jumped to Decide -- the person was never
    // routed to the stage that owns Quick Pick, List, Compare, Board, filters
    // and readiness gaps (ADR 0016's stage ownership table). Reviewing stays
    // open to you until you actually settle the decision.
    reviewComplete:
      snapshot?.proposal !== null &&
      snapshot?.proposal !== undefined &&
      snapshot.proposal.status !== 'pending',
    decisionAvailable: snapshot?.proposal !== null && snapshot?.proposal !== undefined,
    decided:
      snapshot?.proposal !== null &&
      snapshot?.proposal !== undefined &&
      snapshot.proposal.status !== 'pending',
  });
  const activeWorkflowStageId = workflowStageOverride ?? workflow.recommendedStageId;

  /**
   * THE STAGE GATE (ADR 0016's stage-ownership table, made real).
   *
   * Before this, the stepper navigated nowhere: only `AnalysisStage` read
   * `activeWorkflowStageId`, so Intake and Priorities rendered byte-identical
   * screens and the five steps were decoration over one flat workspace. Each
   * region below now renders for the stage the ADR says owns it:
   *
   *   Intake     -- pack identity, option inventory, required setup, pending
   *                 discovery interactions
   *   Priorities -- criteria/importance, questions, the Decision Profile
   *   Analysis   -- findings, sources/citations, activity (`AnalysisStage`)
   *   Review     -- Quick Pick/List/Compare/Board, lenses, filters,
   *                 readiness gaps
   *   Decide     -- the proposal and its approve/reject/revise controls
   *
   * THE ESCAPE HATCH, and why it is not a loophole. The change set is
   * absolute that "wider layouts ... may not contain capabilities that the
   * right pane cannot reach," and the same rule has to hold across stages:
   * moving a region behind a step a person cannot press would delete it, not
   * relocate it. ADR 0016 also says "future steps may be visible but
   * unavailable when their prerequisites are not satisfied" -- so an
   * `unavailable` stage is exactly the case where its content has nowhere to
   * go. `stageOwns` therefore shows a stage's regions when that stage is
   * active OR when it cannot currently be visited at all. The gate is a
   * relocation everywhere the destination exists, and a no-op in the states
   * where the destination does not -- which makes "nothing becomes
   * unreachable" true by construction rather than by case analysis.
   *
   * This is presentation only. It reads `activeWorkflowStageId` (session
   * state in `ui-store.ts`, which may never persist or reach the server) and
   * the derived stage states; no command, schema, or `eventSequence` is
   * involved, and every relocated control keeps its existing callback and
   * `data-testid` (ADR 0005; change set "Compatibility boundary").
   */
  const workflowStageStates = new Map<CaseWorkflowStageId, CaseWorkflowStageState>(
    workflow.stages.map((stage) => [stage.id, stage.state]),
  );
  const stageOwns = (stageId: CaseWorkflowStageId): boolean =>
    activeWorkflowStageId === stageId || workflowStageStates.get(stageId) === 'unavailable';

  // `WorkspaceAlertBanner` items (ADR 0008 decision 2/req 2 of this task):
  // DERIVED from real, already-canonical state -- never fabricated. Each
  // condition below is the exact same signal an existing region already
  // renders from (flaggedFindingsCount drives the app bar's findings badge
  // and used to drive the "What Sift found" disclosure meta; `pendingExtension`
  // already gates `CaseExtensionReviewCard` below; `connectionState` is the
  // hook's own raw five-state union, not the app bar's collapsed three-state
  // version, so this only fires on a genuine `offline`, not a transient
  // `connecting`/`reconnecting` blip the app bar's own pulsing badge already
  // communicates). An empty array here renders nothing at all --
  // `WorkspaceAlertBanner` returns `null` outright for `items: []`.
  //
  // Deliberately NOT included: a `workspaceStatus.phase === 'pending_approval'`
  // item. One used to live here, with `tone: 'ready'` and `message:
  // workspaceStatus.headline` reused verbatim from the hero. It was removed
  // because that message duplicated `RecommendationHero`'s own headline
  // word-for-word -- the exact same sentence rendered twice, once as a
  // ~48px banner chip and again as the hero's headline in the very next
  // region, with the hero also carrying the actual Approve/Reject/Revise
  // `ApprovalCard` controls the banner never had. Beyond the redundancy, the
  // banner pushed `RecommendationHero` down by that ~48px, working against
  // ADR 0004's requirement that the recommendation region's top edge fall
  // within the first viewport height at narrow widths. Removing it costs
  // nothing the hero doesn't already say.
  const alertItems: WorkspaceAlertBannerItem[] = [];
  if (flaggedFindingsCount > 0) {
    alertItems.push({
      id: 'findings',
      tone: 'attention',
      message: `${flaggedFindingsCount} finding${flaggedFindingsCount === 1 ? '' : 's'} need${flaggedFindingsCount === 1 ? 's' : ''} your attention.`,
      actionLabel: 'Review findings',
      onAction: openFindings,
    });
  }
  if (pendingExtension !== null) {
    alertItems.push({
      id: 'pending-extension',
      tone: 'attention',
      message: 'Sift proposed something new to check on this case.',
      actionLabel: 'Review',
      onAction: handleReviewPendingExtension,
    });
  }
  if (connectionState === 'offline') {
    alertItems.push({
      id: 'connection-offline',
      tone: 'attention',
      message: 'Connection lost. Sift will keep trying to reconnect.',
    });
  }
  // Scoring warnings, which say what could *not* be ranked and why.
  // Derivation and its cap live in `scoring-alerts.ts` so they are testable
  // without mounting the workspace.
  alertItems.push(...buildScoringAlerts(scoreboard.board.warnings));

  return (
    <div
      // Keyed by `activeCaseId` (manual QA finding, this task): several
      // case-scoped children below -- `OptionEditor`, `CustomConcernForm`,
      // `CaseExtensionReviewCard` -- own local `useState` (in-progress form
      // fields, a submission `success`/`error` flag) that is otherwise never
      // reset by a prop change alone, since React reuses the same component
      // instance across a re-render with no identity change. Keying the
      // whole workspace by the case it belongs to forces every case-scoped
      // child to remount -- resetting all such local state, including this
      // file's own `viewMode`/`quickPickPosition` -- exactly when the
      // active case actually changes.
      key={activeCaseId}
      data-testid="case-workspace"
      /*
       * A fixed-height pane shell: exactly one viewport tall, a flex
       * column, and NOT itself scrollable. The app bar and the action dock
       * are `shrink-0` bands at the two edges; `case-workspace-scroll`
       * between them is the only thing that scrolls.
       *
       * This corrects a wrong assumption rather than preserving it. The
       * dock and the orientation shell were both `position: sticky` on the
       * stated grounds that "Sift renders inside an iframe in the companion
       * case," where a `fixed` element would position against the iframe
       * viewport and cover the last line of content. Measured in the real
       * ChatGPT pane, that is not what happens: `window.self ===
       * window.top` (a top-level document, not an iframe), and no ancestor
       * of the dock sets `transform`/`filter`/`perspective`/`will-change`/
       * `contain`/`backdrop-filter`, so nothing establishes a containing
       * block that would trap a fixed child. The real defect was different
       * and worse: the dock was `sticky bottom-0` as the LAST child of a
       * ~2176px document, and a sticky element has nothing to be held
       * against once it is the final box in its container -- so it never
       * pinned at all. You only ever met it by scrolling to the very
       * bottom. It has never worked.
       *
       * A `100dvh` flex column rather than `position: fixed` chrome,
       * deliberately: there is no bottom-padding arithmetic keeping the
       * dock off the last row, browser scroll anchoring keeps working
       * inside the middle, and the shell behaves identically if Sift ever
       * genuinely IS embedded in an iframe. The fragile assumption stops
       * mattering instead of being replaced by a different one.
       *
       * `page-enter` stays: `fade-slide-in` animates `transform`, which
       * would matter if this element had `position: fixed` descendants (it
       * would become their containing block for the duration of the
       * animation), but every overlay here -- both `Sheet`s and
       * `RuntimeInspector` -- is portalled to `<body>` by Radix, and the
       * only in-flow pinning left is `position: sticky` inside the
       * scroller, which a transformed ancestor does not affect.
       */
      className="page-shell page-enter flex h-[100dvh] flex-col"
    >
      {/*
        The top band. Outside the scroller, so the app bar genuinely stays
        put -- previously it was `sticky top-0` inside a document that
        scrolled as a whole, which pins correctly but still let the case
        title and every app-bar control scroll away the moment the pane's
        own chrome was involved. The padding lives here rather than on the
        shell root so the scroller below owns its own edges, and this band's
        own `padding-bottom` -- not a `padding-top` on the scroller -- is
        what separates the bar from the first row of content (see there for
        why that distinction is load-bearing).
      */}
      <div className="shrink-0 p-[var(--space-4)]">
        {snapshot ? (
          <WorkspaceAppBar
            title={snapshot.title}
            connectionState={mapAppBarConnectionState(connectionState)}
            findingsCount={flaggedFindingsCount}
            // The Analysis stage owns findings and references at every width
            // now (ADR 0016: they "stop consuming global app-bar priority and
            // gain an explicit conceptual home"). Leaving them here as well
            // gave the expanded layout two entry points to the same sheet,
            // one of which contradicted the stage that claims to own them.
            showAnalysisControls={false}
            optionCount={optionsCount}
            onAddOption={openManageOptions}
            onAddNote={openNotes}
            onAddConcern={openAddConcern}
            onAdjustPriorities={openPriorities}
            onSwitchDecision={handleSwitchDecision}
            onReviewFindings={openFindings}
            onOpenReferenceLibrary={openReferenceLibrary}
            referenceCount={snapshot?.sources.length ?? 0}
            onOpenDeveloperView={openDeveloperView}
            onResetDemo={handleResetDemo}
            resetPending={resetPending}
            helpButtonRef={helpButtonRef}
            compliance={activePack?.compliance ?? null}
            layout={layout}
          />
        ) : (
          <div
            data-testid="case-workspace-loading"
            aria-busy="true"
            aria-live="polite"
            className="loading-pulse flex items-center justify-center rounded-[var(--radius-md)] bg-card p-[var(--space-4)] text-[var(--color-ink-secondary)]"
          >
            Loading case…
          </div>
        )}
      </div>

      {/* Both layouts now, per ADR 0016's own "wider layouts may show all
        labels when they fit". While this was narrow-only the entire guided
        workflow was invisible above 800px: a desktop window got the
        pre-redesign layout, which is an absence of the design rather than a
        wider version of it. */}
      {snapshot !== null ? (
        <CaseWorkflowStepper
          stages={workflow.stages}
          activeStageId={activeWorkflowStageId}
          onStageChange={setWorkflowStage}
          layout={layout}
        />
      ) : null}

      {/*
        The one scrolling region.

        `min-h-0` is load-bearing next to `flex-1`: a flex item defaults to
        `min-height: auto`, which refuses to shrink below its content, so
        without it this box grows to its content height and pushes the dock
        back off the bottom of the shell -- the same failure `SheetBody`
        already documents.

        The shell's padding moved here rather than staying on the root for
        two reasons: on the root, the scrollbar would be inset inside the
        padding, and the top/bottom padding would sit outside the scroll
        and so never move with the content.

        No `padding-top`, though, and that is deliberate rather than an
        oversight: the band above supplies the 16px gap with its own
        `padding-bottom` instead. Chrome parks a `position: sticky` child at
        the scroll container's PADDING edge, not its border edge, so a
        `pt-4` here left a 16px window between the app bar and
        `DecisionOrientationShell` (which is `sticky top-0`) through which
        scrolled-away content stayed visible as a torn sliver. Measured, not
        guessed: with `padding-top: 16px` the shell parked at y=163 against
        a scrollport starting at y=147. With the gap moved into the band the
        shell parks flush at the scrollport top and nothing shows above it,
        and the spacing at rest is unchanged.

        `overflow-x-hidden` keeps `global.css`'s page-level overflow
        backstop ("no region may introduce horizontal page scrolling at
        390-480px") in force. That rule lives on `html, body`, which is no
        longer the scroll container for this content; without repeating it
        here, a too-wide child would grow a horizontal scrollbar inside the
        pane instead of being clipped.
      */}
      <div
        data-testid="case-workspace-scroll"
        // Measured, not declared -- see `workspaceScrollPaddingPx` above for
        // why this exists and why the number cannot be a constant. `0` when
        // no sticky shell is rendered, which is the same as not setting it.
        style={{ scrollPaddingTop: `${String(workspaceScrollPaddingPx)}px` }}
        className="flex min-h-0 flex-1 flex-col gap-[var(--space-4)] overflow-y-auto overflow-x-hidden px-[var(--space-4)] pb-[var(--space-4)]"
      >
        {/*
        Rendered only for a case that has genuinely begun adaptive discovery.

        A seeded demo case arrives with candidates already present and no
        discovery at all, and forcing this shell onto one produces
        contradictions rather than orientation: it read "Narrowing down what
        you found" above "0 of 0 covered" above "Next: What this vehicle is
        for", which is three statements about three different journeys. The
        app bar and the recommendation hero already orient a seeded case;
        the shell has nothing true to add to one, so it says nothing.

        Found by rendering it and looking, not by a unit test -- every
        individual field was correct in isolation.
      */}
        {/*
        The pending interaction, rendered wherever the case has one.
        `submitInteractionResponse` clears it, so this appears and
        disappears purely from case state -- no local "is a question open"
        flag that a reload could disagree with.
      */}
        {stageOwns('intake') && snapshot?.discovery?.pendingInteraction != null && (
          <DiscoveryInteraction
            request={snapshot.discovery.pendingInteraction}
            onRespond={handleInteractionResponse}
            layout={layout}
          />
        )}

        {orientationShellRendered && decisionOrientation !== null && (
          <DecisionOrientationShell
            orientation={decisionOrientation}
            containerRef={orientationShellRef}
            layout={layout}
            workInFlight={workInFlight}
            // `WorkspaceAppBar` directly above already names the decision.
            // Repeating it here stacked the same words twice, which no unit
            // test could see because they render the shell on its own.
            showDecisionTitle={false}
            // The guided stepper is the pinned orientation wherever it
            // renders (narrow only), so this shell scrolls there rather than
            // pinning a second orientation bar beneath it -- see the `pinned`
            // prop's own comment for the overflow that caused.
            pinned={layout !== 'narrow'}
          />
        )}

        <WorkspaceAlertBanner items={alertItems} layout={layout} />

        {/*
          `WebMcpStatus` used to render here, third in the content column,
          directly above the answer. It is a persistent statement about the
          host -- true before the case starts and still true after it ends --
          and it never changes in response to anything the person does, so it
          was spending prime vertical space, every scroll, on a sentence that
          is read once. It now sits in the footer strip beside the action
          dock, which is where the project owner asked for it. Nothing else
          moved.
        */}

        {/*
          Suppressed while the connection state already explains itself. A
          dropped dev server put two banners on screen at once: the amber
          "Connection lost. Sift will keep trying to reconnect." above, and
          directly beneath it a red one reading, in full, "Failed to fetch"
          -- the browser's own `TypeError` message for a refused request,
          shown to a person as though it were a sentence, with no retry
          control and nothing to do about it. The banner above is the true
          and actionable one; this one only repeated it in developer
          vocabulary. A stream error that is NOT a connection failure still
          surfaces here, because then it is telling the person something the
          connection badge does not.
        */}
        {streamError !== null &&
        connectionState !== 'offline' &&
        connectionState !== 'reconnecting' ? (
          <ErrorState message={streamError} />
        ) : null}

        {/*
          INTAKE owns "Pack identity, required setup, options, missing
          inputs, pending discovery interactions" (ADR 0016). Four of those
          five already existed and were reachable from global chrome (the app
          bar names the pack's compliance, its create menu adds an option);
          what Intake had was nothing of its own, which is why stepping
          between Intake and Priorities rendered the same screen. This states
          the two facts the stage is about -- how many options the case holds
          and how much required setup is still open -- and offers the one
          action that changes them. It adds no command and no state: the
          button is the same `openManageOptions` the app bar's create menu
          calls, over the same single `OptionEditor` sheet.
        */}
        {stageOwns('intake') && snapshot !== null ? (
          <section
            data-testid="case-stage-intake"
            aria-labelledby="case-stage-intake-title"
            className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-card p-[var(--space-4)]"
          >
            <div>
              <h2
                id="case-stage-intake-title"
                className="font-display text-[length:var(--font-size-xl)]"
              >
                Intake
              </h2>
              <p className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]">
                {activePack === null
                  ? 'What this decision is about, and what Sift still needs.'
                  : `${activePack.identity.name} — what this decision is about, and what Sift still needs.`}
              </p>
            </div>
            {/* Counts that name what they count (change set, "Copy
              requirements"), never a bare number. */}
            <p
              data-testid="case-stage-intake-option-count"
              className="text-[length:var(--font-size-sm)]"
            >
              {optionsCount === 0
                ? `No ${optionLabelPlural} added yet`
                : `${String(optionsCount)} ${optionsCount === 1 ? optionLabel : optionLabelPlural} on this case`}
            </p>
            {requiredDiscoveryTotal > 0 ? (
              <p
                data-testid="case-stage-intake-required-setup"
                className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
              >
                {`${String(requiredDiscoveryResolved)} of ${String(requiredDiscoveryTotal)} required question${requiredDiscoveryTotal === 1 ? '' : 's'} answered`}
              </p>
            ) : null}
            <Button
              type="button"
              data-testid="case-stage-intake-add-option"
              variant="secondary"
              onClick={openManageOptions}
              className="justify-start self-start"
            >
              {`Add ${optionLabel}`}
            </Button>
          </section>
        ) : null}

        {/*
          PRIORITIES owns "criteria, constraints, importance, questions,
          Decision Profile" (ADR 0016). The Decision Profile itself keeps its
          existing two homes -- the narrow `decision-profile` disclosure and
          the expanded toolbar's sheet button, both gated to this stage below
          -- because relocating a working surface twice is churn, not design.
          What was missing is the half of the stage that is not a read-only
          projection: `CriteriaEditor` (the only surface in the product that
          can change what the decision optimises for) and "Add a question"
          were reachable ONLY from the app bar's menus, which say nothing
          about which step they belong to. Same callbacks, same sheets.
        */}
        {stageOwns('priorities') && snapshot !== null ? (
          <section
            data-testid="case-stage-priorities"
            aria-labelledby="case-stage-priorities-title"
            className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-card p-[var(--space-4)]"
          >
            <div>
              <h2
                id="case-stage-priorities-title"
                className="font-display text-[length:var(--font-size-xl)]"
              >
                Priorities
              </h2>
              <p className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]">
                What matters in this decision, how much, and what you still want asked.
              </p>
            </div>
            <p
              data-testid="case-stage-priorities-count"
              className="text-[length:var(--font-size-sm)]"
            >
              {decisionProfileConcernCount === 0
                ? 'No priorities set yet'
                : `${String(decisionProfileConcernCount)} priorit${decisionProfileConcernCount === 1 ? 'y' : 'ies'} set`}
            </p>
            <div className="grid gap-[var(--space-2)]">
              <Button
                type="button"
                data-testid="case-stage-priorities-adjust"
                variant="secondary"
                onClick={openPriorities}
                className="justify-start"
              >
                Adjust priorities
              </Button>
              <Button
                type="button"
                data-testid="case-stage-priorities-add-question"
                variant="secondary"
                onClick={openAddConcern}
                className="justify-start"
              >
                Add a question
              </Button>
            </div>
          </section>
        ) : null}

        {/* Stage ownership in ADR 0016 is width-independent: Analysis owns
          findings, sources and activity at every width, so this renders
          wherever that stage is active rather than only in the pane. */}
        {stageOwns('analysis') ? (
          <AnalysisStage
            findingsNeedingReview={flaggedFindingsCount}
            sourceCount={snapshot?.sources.length ?? 0}
            activityCount={caseScopedActivityEvents.length}
            onOpenFindings={openFindings}
            onOpenSources={openReferenceLibrary}
            onOpenActivity={openDeveloperView}
          />
        ) : null}

        {/*
          THE RECOMMENDATION HERO STAYS ALWAYS-VISIBLE. Deliberate, and the
          one region this task does NOT hand to a stage. Four reasons, in
          order of how binding they are:

          1. `assertRecommendationHeroAboveTheFold`
             (`tests/e2e/helpers/layout-assertions.ts`) asserts
             `recommendation-hero` is VISIBLE and that its top edge falls
             within the first viewport height at every viewport <= 480px. Four
             journey specs call it, and they call it mid-journey -- e.g.
             `vehicle-catalog-journey` right after the case opens, where the
             active stage is Intake. A stage-owned hero fails ADR 0004's
             invariant outright in every stage but one. That alone settles it.

          2. It is not one stage's content. Its contents straddle three rows
             of ADR 0016's table: "Have Sift investigate" plus `LiveRunStatus`
             plus `SpecialistActivityPanel` plus "Inspect run" are Analysis's
             "investigation request/status ... activity"; `RecommendationCard`
             and `ApprovalCard` are Decide's "recommendation summary,
             proposal, explicit human approval". No single stage owns the box.

          3. ADR 0004 built this region by collapsing three regions that could
             disagree with each other into one that cannot. Splitting it back
             apart by stage reopens exactly that seam.

          4. It is the answer. ADR 0016 calls the stepper "an orientation and
             navigation control over existing case state"; revisiting an
             upstream step must not cost a person the answer they already
             have, or the step list becomes a reason not to look back.

          What IS stage-owned is the approval control inside it, and only
          that: the change set is verbatim that "approval controls belong to
          Decide," so `proposal` -- the single prop that mounts `ApprovalCard`
          -- is passed only while Decide is the active stage. Everything else
          in the hero, the headline included, is unconditional. Nothing is
          lost by it: a pending proposal is precisely what makes Decide
          available and recommended (`decisionAvailable` above), so a person
          meets the controls on arrival, and from any other step the stepper
          renders Decide as the current step while the headline overhead still
          says a decision is waiting. `handleConfirmShortlist` navigates there
          too, so the dock's one human-only move still lands on the control.
        */}
        <RecommendationHero
          status={workspaceStatus}
          recommendation={snapshot?.recommendation ?? null}
          withheld={withheld}
          sources={sources}
          proposal={stageOwns('decide') ? (snapshot?.proposal ?? null) : null}
          approvalOptionLabel={favoredOptionLabel}
          onReview={handleReviewProposal}
          reviewPending={proposalReviewPending}
          reviewError={proposalReviewError}
          onRequestInvestigation={() => handleRequestInvestigation()}
          requestPending={runRequestPending}
          requestDisabled={snapshot === null}
          requestError={runRequestError}
          onReviewFindingsClick={openFindings}
          liveRunReceipt={liveRunStatusReceipt}
          liveEvents={events}
          onInspectRun={inspectRun}
          containerRef={recommendationHeroRef}
          approvalRef={approvalCardRef}
        />

        {/* What the deterministic scoreboard found -- rendered once, outside
          both layout branches, for the same reason the alert banner and the
          hero are: it is a summary of the whole case rather than a region
          either shell owns. `CaseInsightsPanel` returns `null` outright when
          the engine found nothing, so an uninteresting case grows no empty
          region (product.md's "Empty regions" rule). */}
        <CaseInsightsPanel insights={scoreboard.insights} layout={layout} />

        {layout === 'expanded' ? (
          // Web app mode (ADR 0008 decision 2): a persistent left sidebar
          // (priorities/filters/still-checking) beside a main column holding
          // a small utility toolbar for the regions with no sidebar slot,
          // then the primary view switcher. See this file's own header
          // comment for the full "where did region X go" mapping.
          <div
            data-testid="workspace-expanded-layout"
            // 300px, not 240px: a live-browser check against the real
            // `car-purchase` pack found `WorkspaceSidebar`'s priority rows
            // (full pack-authored sentences like "Driver assistance
            // effectiveness rating," not the ADR mock's single-word "Safety")
            // truncating hard at 240px. `WorkspaceSidebar.tsx` itself is
            // locked, so the fix lives here, at the column width this file
            // owns.
            className="grid grid-cols-[300px_minmax(0,1fr)] items-start gap-x-[var(--space-6)]"
          >
            {/* The sidebar is persistent CONTEXT, not stage content, so it is
              not gated: the change set allows exactly this -- "wider layouts
              may reveal more context but may not contain capabilities that
              the right pane cannot reach." Its read-only priorities list and
              its "Still checking" count are both reachable in the pane
              (Priorities' Decision Profile, Review's readiness disclosure),
              so nothing here is expanded-only, and a 300px column that
              emptied itself on four steps out of five would make the desktop
              layout jump rather than guide. The MAIN column below is gated
              identically at both widths. */}
            <WorkspaceSidebar
              layout={layout}
              decisionProfile={decisionProfile}
              openQuestionsCount={remainingObligationCount}
              onOpenQuestions={openStillChecking}
            />
            <div className="flex min-w-0 flex-col gap-[var(--space-4)]">
              <div
                role="toolbar"
                aria-label="More workspace regions"
                className="flex flex-wrap items-center gap-[var(--space-2)]"
              >
                {/* The sidebar only renders `mustHave`/`important`/
                  `niceToHave` (its own header comment names the exclusion
                  explicitly); this reaches the FULL profile, including
                  `context`/`personalConcerns`/`missing`/`suggestedQuestions`,
                  which would otherwise be unreachable in expanded mode --
                  same "every capability reachable in both modes" constraint
                  the app bar's "Add option"/"Findings" controls satisfy for
                  their own regions. Gated like the narrow disclosure above
                  it (ADR 0004 item 2: absent, not merely empty). */}
                {stageOwns('priorities') && !decisionProfileIsEmpty && decisionProfile !== null ? (
                  <Button
                    type="button"
                    data-testid="workspace-expanded-open-decision-profile"
                    variant="secondary"
                    size="sm"
                    onClick={openDecisionProfile}
                  >
                    Your priorities
                  </Button>
                ) : null}
                <Button
                  type="button"
                  data-testid="workspace-expanded-open-notes"
                  variant="secondary"
                  size="sm"
                  onClick={openNotes}
                >
                  Notes
                </Button>
                {/* "Add a question" is deliberately NOT a button here any
                  more: it is one of the app bar's three create-menu items,
                  rendered identically in both layouts over this same sheet,
                  so a second expanded-only entry point would be duplication
                  rather than reachability. "Notes" above stays because it is
                  the READ surface (`CaseNotes`), which the create menu does
                  not offer and which narrow renders inline instead. */}
              </div>

              {/* REVIEW owns "Quick Pick, List, Compare, Board, filters,
                option profiles, readiness gaps" (ADR 0016) and the change set
                is verbatim that "Keep / Unsure / Pass and comparison views
                belong to Review." Same three regions, same props, same
                callbacks -- only the condition is new, and it is the same
                condition the pane branch below uses. */}
              {stageOwns('review') ? (
                <>
                  <FilterBar
                    attributeDefinitions={filterableDefinitions}
                    options={allOptions}
                    filters={filters}
                    onFiltersChange={handleFiltersChange}
                    onOpenFilters={openFilters}
                    matchingCount={visibleOptions.length}
                    totalCount={allOptions.length}
                    presentation={activePack?.presentation ?? null}
                    assistantVisibleOptionIds={assistantVisibleOptionIds}
                    onClearAssistantNarrowing={handleClearAssistantNarrowing}
                  />

                  {/* Which FACTS the view below draws, alongside the switcher
                    that picks its SHAPE. Renders nothing for a pack that
                    declares no lenses. */}
                  <LensSwitcher
                    lenses={packLenses}
                    activeLensId={activeLensId}
                    onLensChange={handleLensChange}
                  />

                  <WorkspaceViewSwitcher
                    mode={viewMode}
                    onModeChange={handleViewModeChange}
                    // The FILTERED list -- see the `visibleOptions` comment above
                    // for why this one prop is narrowed and the hero/notes/editor
                    // deliberately are not.
                    options={visibleOptions}
                    attributeDefinitions={snapshot?.attributeDefinitions ?? []}
                    caseExtensions={snapshot?.caseExtensions ?? []}
                    presentation={activePack?.presentation ?? null}
                    selectedOptionId={snapshot?.selectedOptionId ?? null}
                    onFocusOption={handleFocusOption}
                    compareOptionIds={compareOptionIds}
                    compareVisibleAttributeIds={compareVisibleAttributeIds}
                    comparePinnedAttributeIds={comparePinnedAttributeIds}
                    quickPickPosition={quickPickPosition}
                    quickPickDispositions={quickPickDispositions}
                    onQuickPickKeep={handleQuickPickKeep}
                    onQuickPickPass={handleQuickPickPass}
                    onQuickPickUnsure={handleQuickPickUnsure}
                    onQuickPickUndo={handleQuickPickUndo}
                    onQuickPickFocusChange={() => undefined}
                    // Real `Criterion[]`, so a card can rank its few facts by what
                    // the person actually said matters whenever a pack declares no
                    // `prominentAttributeIds` of its own.
                    criteria={snapshot?.criteria ?? []}
                    // The FULL board, not one narrowed to `visibleOptions` -- see
                    // the `scoreboard` memo above for why a rank must not be
                    // recomputed over a filtered subset.
                    scoreboard={scoreboard}
                    onOpenProfile={openOptionProfile}
                    boardPlacement={boardPlacement}
                    onMoveOption={handleMoveOption}
                  />
                </>
              ) : null}

              {/* The same read surface the pane keeps in its own column
                below. Both branches mount it because the two are mutually
                exclusive -- only one is ever in the document -- so this is one
                `CaseNotes` at runtime, not two. Expanded needs it for the
                same reason narrow does: `sift_add_note` is a real WebMCP
                tool, and a note an assistant writes has to be visible without
                a person opening anything. */}
              <CaseNotes notes={snapshot?.notes ?? []} options={snapshot?.entities ?? []} />
            </div>
          </div>
        ) : (
          // Pane mode: the existing single-column stack, minus the two
          // regions promoted into the app bar above (options, findings) --
          // see this file's own header comment for the full mapping.
          <>
            {/* Review's regions, gated exactly as the expanded branch above
              gates its own copies -- ADR 0016's ownership table is
              width-independent, so the pane and the web app agree about which
              step owns the option views. */}
            {stageOwns('review') ? (
              <>
                {/* Same filter entry point as web-app mode, and the reason the
              filter surface moved out of the sidebar at all: this component
              tree has no sidebar, so filters previously did not exist here
              in any form (ADR 0009). */}
                <LensSwitcher
                  lenses={packLenses}
                  activeLensId={activeLensId}
                  onLensChange={handleLensChange}
                />

                <WorkspaceViewSwitcher
                  mode={viewMode}
                  onModeChange={handleViewModeChange}
                  options={visibleOptions}
                  attributeDefinitions={snapshot?.attributeDefinitions ?? []}
                  caseExtensions={snapshot?.caseExtensions ?? []}
                  presentation={activePack?.presentation ?? null}
                  selectedOptionId={snapshot?.selectedOptionId ?? null}
                  onFocusOption={handleFocusOption}
                  compareOptionIds={compareOptionIds}
                  compareVisibleAttributeIds={compareVisibleAttributeIds}
                  comparePinnedAttributeIds={comparePinnedAttributeIds}
                  quickPickPosition={quickPickPosition}
                  quickPickDispositions={quickPickDispositions}
                  onQuickPickKeep={handleQuickPickKeep}
                  onQuickPickPass={handleQuickPickPass}
                  onQuickPickUnsure={handleQuickPickUnsure}
                  onQuickPickUndo={handleQuickPickUndo}
                  onQuickPickFocusChange={() => undefined}
                  criteria={snapshot?.criteria ?? []}
                  scoreboard={scoreboard}
                  onOpenProfile={openOptionProfile}
                  boardPlacement={boardPlacement}
                  onMoveOption={handleMoveOption}
                  toolbarLeading={
                    <FilterBar
                      compact
                      attributeDefinitions={filterableDefinitions}
                      options={allOptions}
                      filters={filters}
                      onFiltersChange={handleFiltersChange}
                      onOpenFilters={openFilters}
                      matchingCount={visibleOptions.length}
                      totalCount={allOptions.length}
                      presentation={activePack?.presentation ?? null}
                      assistantVisibleOptionIds={assistantVisibleOptionIds}
                      onClearAssistantNarrowing={handleClearAssistantNarrowing}
                    />
                  }
                />
              </>
            ) : null}

            {stageOwns('priorities') && !decisionProfileIsEmpty && decisionProfile !== null ? (
              <DisclosureSection
                testId="decision-profile"
                title="Your priorities"
                meta={decisionProfileMeta}
              >
                <DecisionProfileView profile={decisionProfile} />
              </DisclosureSection>
            ) : null}

            {/* The one `CaseNotes` mount in the product, and the reason it is
              here rather than inside the Notes sheet.

              It is the READ surface, and it has to be visible without opening
              anything, because a note is not only something a person writes.
              A WebMCP host can call `sift_add_note`, and "the agent wrote
              something and you can see it" is a shared-state proof this
              product actually makes. `pnpm test:host`'s "host action visible
              in pane" check asserts exactly that against a real Chrome
              WebMCP host.

              I briefly moved it into the sheet, on a mistaken reading that
              narrow had no way to read notes. Narrow always had this inline
              copy; what it lacked was an ADD path once the create menu
              replaced the old disclosure row. Moving the read surface behind
              a sheet fixed nothing and broke the host check, which failed
              with `occurrences in pane=0` -- the tool succeeded and a person
              would have seen nothing.

              So: this renders the notes, the create menu's sheet writes them,
              and there is exactly one of each. `CaseNotes` returns `null`
              with no notes, so this costs nothing on an empty case. */}
            <CaseNotes notes={snapshot?.notes ?? []} options={snapshot?.entities ?? []} />

            {/* "Add a note" and "Add a question" used to be two more
              disclosure rows here, at the very end of the column. Both are
              app-bar create-menu items now, opening the sheets declared
              below -- the owner's own instruction ("Add a note and add a
              question should be in either the header or footer toolbars --
              not at the bottom of the stack") and the reason this column is
              two full rows shorter at rest. `CaseNotes` above is unaffected:
              it is the read half, and it still renders nothing at all on a
              case with no notes. */}
            {/* Review owns "readiness gaps" (ADR 0016). Expanded reaches the
              same `ReadinessPanel` through the sidebar's "Still checking"
              button, which is ungated persistent context -- see there. */}
            {stageOwns('review') ? (
              <DisclosureSection
                testId="still-checking"
                title="Decision readiness"
                meta={stillCheckingMeta}
              >
                <ReadinessPanel readiness={readiness} loading={snapshot === null} />
              </DisclosureSection>
            ) : null}
          </>
        )}

        {dispositionError ? <ErrorState message={dispositionError} /> : null}
        {interactionError ? <ErrorState message={interactionError} /> : null}
      </div>

      {/*
        Overlays, and then the dock. Every `Sheet` below (including
        `RuntimeInspector`, which is one) renders through a Radix portal
        into `<body>`, so none of them is a flex child of this shell in
        practice -- a closed sheet contributes no DOM here at all, and an
        open one is a `position: fixed` overlay outside this subtree. They
        stay declared here, outside the scroller, because that is where
        their state belongs, not because their position depends on it.
      */}
      <FindingsSheet
        open={findingsSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeFindings();
        }}
        items={evidenceItems ?? []}
        onSetDisposition={handleSetDisposition}
        dispositionPendingId={dispositionPendingId}
      />

      {/* The contextual blind-spot review, reached from the dock's
          `review_blind_spots` move (`handleReviewBlindSpots`). Mounted here
          with the other sheets, and controlled the same way -- Radix renders
          nothing into the DOM while `open` is false, so a case that never
          reaches the review is completely unaffected by it. */}
      <BlindSpotReviewSheet
        open={blindSpotSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeBlindSpotReview();
        }}
        prompts={applicableBlindSpotPrompts}
        onComplete={handleCompleteBlindSpotReview}
        pending={blindSpotReviewPending}
        error={blindSpotReviewError}
      />

      {/* Sheet-based entry points for ADR 0008's dismantled create/detail
          regions -- see this file's own header comment for why each of
          these five is mounted unconditionally (always controlled by
          `open`, never duplicated alongside a narrow-mode disclosure over
          the same underlying component). */}
      {/* Mounted unconditionally, like every sheet below it, and NOT inside
          either layout branch: the filter surface is the one region that
          must be identical in both modes (ADR 0009), so it is global chrome
          rather than something each shell renders its own copy of. */}
      {/* The per-option detail surface, mounted as global chrome for the
          same reason the filter sheet is: both grids open it, in both
          layouts, so neither shell owns a copy. Closing clears the id
          rather than leaving a stale option selected behind a shut sheet. */}
      <OptionProfileSheet
        open={profileOptionId !== null}
        onOpenChange={(open) => {
          if (!open) closeOptionProfile();
        }}
        profile={openProfile}
        presentation={activePack?.presentation ?? null}
        ranking={openProfileRanking}
      />

      <ReferenceLibrarySheet
        open={referenceLibraryOpen}
        onOpenChange={(open) => {
          if (!open) closeReferenceLibrary();
        }}
        sources={snapshot?.sources ?? []}
        // `claims`/`evidenceLinks` are REQUIRED, not decorative: they are
        // the only way to tell a REFERENCE (kept because it is relevant)
        // from EVIDENCE (it answers a specific question). Passing them
        // empty would label every evidence source a bare reference --
        // a false claim about the case, not a cosmetic downgrade.
        claims={snapshot?.claims ?? []}
        evidenceLinks={snapshot?.evidenceLinks ?? []}
      />

      <FilterSheet
        open={filterSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeFilters();
        }}
        attributeDefinitions={filterableDefinitions}
        options={allOptions}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        matchingCount={visibleOptions.length}
        totalCount={allOptions.length}
      />

      <Sheet
        open={manageOptionsSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeManageOptions();
        }}
      >
        <SheetContent data-testid="workspace-add-option-sheet">
          <SheetHeader>
            <SheetTitle>{`Add ${optionLabel}`}</SheetTitle>
          </SheetHeader>
          {/*
            `pb-0`, uniquely among the sheets here: `OptionEditor` ends in a
            `sticky bottom-0` save bar, and `SheetBody`'s default 16px
            bottom padding sits BELOW the scrollport edge that bar sticks
            to -- so form text scrolled through a 16px strip underneath it.
            The bar carries that bottom spacing itself instead.
          */}
          <SheetBody className="pb-0">
            <OptionEditor
              caseId={activeCaseId}
              resolveExpectedSequence={resolveExpectedSequence}
              optionKind={optionKind}
              optionLabel={optionLabel}
              attributeDefinitions={snapshot?.attributeDefinitions ?? []}
              options={snapshot?.entities ?? []}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet
        open={stillCheckingSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeStillChecking();
        }}
      >
        <SheetContent data-testid="workspace-still-checking-sheet">
          <SheetHeader>
            <SheetTitle>Still checking</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <ReadinessPanel readiness={readiness} loading={snapshot === null} />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet
        open={decisionProfileSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeDecisionProfile();
        }}
      >
        <SheetContent data-testid="workspace-decision-profile-sheet">
          <SheetHeader>
            <SheetTitle>Your priorities</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {decisionProfile !== null ? <DecisionProfileView profile={decisionProfile} /> : null}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/*
        The single notes surface, and the create menu's "Add a note" target.

        There were briefly two: this one, and a write-only `Add a note` sheet
        mounting `AddNoteForm` alone. That split left a real hole. The
        `workspace-expanded-open-notes` button below renders only inside
        `layout === 'expanded'`, and the create-menu change had already
        removed the narrow layout's `disclosure-add-note` row -- so between
        390px and 640px, which is the canonical pane and ChatGPT's real side
        pane, a person could add a note and had no way left to read the ones
        already there. ADR 0008 requires every capability to be reachable in
        both modes.

        One surface fixes it: existing notes and the add form together, opened
        identically at every width from the app bar, which is global chrome.
      */}
      <Sheet
        open={notesSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeNotes();
        }}
      >
        <SheetContent data-testid="workspace-notes-sheet">
          <SheetHeader>
            <SheetTitle>Notes</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-[var(--space-4)]">
            {/* Write-only. The list lives in the content column above, where
              it is visible without opening anything -- rendering it here too
              would put two `case-notes` sections and two identical
              `id="case-notes-heading"` values in the document at once. */}
            <AddNoteForm caseId={activeCaseId} resolveExpectedSequence={resolveExpectedSequence} />
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/*
        Weights. The only surface in the product that can change what the
        decision actually optimises for -- before this existed, the reweight
        both demo scripts turn on was reachable only through WebMCP or a
        console call against the same command endpoint.
      */}
      <Sheet
        open={prioritiesSheetOpen}
        onOpenChange={(open) => {
          if (!open) closePriorities();
        }}
      >
        <SheetContent data-testid="workspace-priorities-sheet">
          <SheetHeader>
            <SheetTitle>Priorities</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-[var(--space-4)]">
            <CriteriaEditor
              caseId={activeCaseId}
              criteria={snapshot?.criteria ?? []}
              // The pack's protected-criterion list is not projected into
              // `CaseState`, and it does not need to be: a protected
              // criterion is a hard constraint, which `CriteriaEditor`
              // already refuses to offer as a weight. Anything the server
              // still rejects surfaces as a real error on the form rather
              // than being predicted here from a second source of truth.
              protectedCriterionIds={[]}
              resolveExpectedSequence={resolveExpectedSequence}
              onDone={closePriorities}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet
        open={addConcernSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeAddConcern();
        }}
      >
        <SheetContent data-testid="workspace-add-concern-sheet">
          <SheetHeader>
            <SheetTitle>Add a question</SheetTitle>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-[var(--space-4)]">
            <CustomConcernForm
              caseId={activeCaseId}
              resolveExpectedSequence={resolveExpectedSequence}
              applicableKinds={applicableKinds}
            />
            {pendingExtension !== null ? (
              <CaseExtensionReviewCard
                caseId={activeCaseId}
                resolveExpectedSequence={resolveExpectedSequence}
                extension={pendingExtension}
              />
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/*
        The first-run guide. Mounted alongside the other overlays and
        portalled to `<body>` by Radix like all of them, so it sits above
        the whole pane rather than inside the scrolling column, and cannot
        be scrolled past. `App.tsx` decides once per browser that it should
        open (see the effect above); every exit path funnels back through
        `handleDismissFirstRunGuide`.
      */}
      <FirstRunGuide
        open={firstRunGuideOpen}
        onDismiss={handleDismissFirstRunGuide}
        returnFocusTo={helpButtonRef}
        compliance={activePack?.compliance ?? null}
      />

      {runtimeInspectorOpen ? (
        <RuntimeInspector
          runId={inspectingRunId}
          {...(inspectingDebugEventId !== undefined
            ? { focusEventId: inspectingDebugEventId }
            : {})}
          onClose={closeRuntimeInspector}
          apiConfig={apiConfig}
          events={caseScopedActivityEvents}
          onInspectEvent={inspectRunEvent}
        />
      ) : null}

      {/*
        The bottom band: an ordinary `shrink-0` flex child of the shell, no
        longer `position: sticky`. It is last in the flow and it is pinned,
        because the shell is exactly one viewport tall and the scroller
        above it has already taken all the remaining space -- so the dock
        cannot be pushed off the bottom, and it cannot cover the last row of
        content either, since that content scrolls inside a box that ends
        where the dock begins.

        The old comment here claimed sticky was chosen because "Sift renders
        inside an iframe" where `fixed` would position against the iframe
        viewport. That was factually wrong -- the pane is a top-level
        document -- and, worse, the sticky it justified never pinned
        anything, because a sticky element that is the last child of the
        scrolling container has nothing left to be held against. See this
        component's own header comment and the shell root above.
      */}
      {/*
        The footer status strip, directly above the action dock.

        Above and not below, for two reasons. The dock carries
        `pb-[max(var(--space-3),env(safe-area-inset-bottom))]` on the
        assumption that it is the last thing in the shell; putting anything
        under it strands that padding as a gap and makes the strip, not the
        action, the element clearing the home indicator. And the primary
        action belongs at the bottom edge where a thumb reaches it -- pushing
        it up to make room for a line of status text inverts the priority of
        the two.

        Rendered OUTSIDE the dock's `snapshot?.discovery !== undefined`
        conditional, because "is WebMCP available in this browser" is a
        required visible state (docs/specs/webmcp.md, "Browser adapter") that
        does not depend on a case having discovery yet -- it has to hold on a
        freshly created case too, which nesting it would have quietly broken.

        `shrink-0` for the same reason the dock carries it: this is a flex
        child of the `100dvh` shell, and without it the scrolling region
        above would compress the strip to nothing instead of letting it hold
        its own line.
      */}
      <div
        className={[
          'shrink-0 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]',
          layout === 'expanded'
            ? 'px-[var(--space-6)] py-[var(--space-2)]'
            : 'px-[var(--space-4)] py-[var(--space-2)]',
        ].join(' ')}
      >
        <WebMcpStatus adapter={webMcpAdapter} />
      </div>

      {snapshot?.discovery !== undefined && (
        <ContextActionDock moves={nextMoves} onAct={handleDockAction} layout={layout} />
      )}
    </div>
  );
}
