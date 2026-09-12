# Guided Case Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the existing Sift consumer pane into a narrow-first five-step guided workflow without changing canonical state, commands, persistence, runtime orchestration, or WebMCP contracts.

**Architecture:** A pure workflow projection derives recommended/current stage and availability from existing state. A presentational stepper controls local navigation. Existing components keep their callbacks and are composed under their owning stage; narrow mode receives the guided flow first while expanded mode retains its current layout until separately reviewed.

**Tech Stack:** React 19, TypeScript, Tailwind v4 tokens, Vitest/Testing Library, Playwright.

**Spec:** `docs/change-sets/2026-09-10-guided-case-workflow.md` and `docs/decisions/0016-guided-case-workflow.md`

## Global Constraints

- No public schema, API, persistence, command, runtime, or WebMCP contract changes.
- Canonical acceptance width is 390–480 px with no horizontal scrolling.
- One filled primary action per region; Sift Green is the normal action color.
- Stage navigation never mutates case state.
- Existing domain callbacks remain the only mutation path.

---

### Task 1: Workflow projection

**Files:**
- Create: `apps/web/src/app/case-workflow.ts`
- Test: `apps/web/src/app/case-workflow.test.ts`

**Interfaces:**
- Consumes: existing workspace status and boolean facts already derived in `App.tsx`.
- Produces: `CaseWorkflowStageId`, `CaseWorkflowStage`, and `deriveCaseWorkflow(...)`.

- [ ] Write tests proving the five-stage order, ready/blocked/completed projection, and that proposal state recommends Decide.
- [ ] Run the focused test and confirm it fails because the module does not exist.
- [ ] Implement the pure projection with no React or command dependencies.
- [ ] Run the focused test and confirm it passes.

### Task 2: Narrow stepper

**Files:**
- Create: `apps/web/src/components/CaseWorkflowStepper.tsx`
- Test: `apps/web/src/components/CaseWorkflowStepper.test.tsx`

**Interfaces:**
- Consumes: `CaseWorkflowStage[]`, active stage id, and `onStageChange(stageId)`.
- Produces: an accessible compact stepper with ordinal progress and an expandable complete step list.

- [ ] Write component tests for current-step naming, disabled future stages, completed-step navigation, and keyboard-accessible controls.
- [ ] Run the focused test and confirm it fails because the component does not exist.
- [ ] Implement the compact narrow stepper using existing UI primitives and design tokens.
- [ ] Run the focused test and confirm it passes.

### Task 3: Compact option controls

**Files:**
- Modify: `apps/web/src/components/FilterBar.tsx`
- Modify: `apps/web/src/components/WorkspaceViewSwitcher.tsx`
- Test: `apps/web/src/components/FilterBar.test.tsx`
- Test: `apps/web/src/components/WorkspaceViewSwitcher.test.tsx`

**Interfaces:**
- Consumes: existing filter/view props and callbacks unchanged.
- Produces: icon-first narrow controls with accessible names and tooltips; existing expanded presentation remains available.

- [ ] Write failing narrow-layout tests for icon-only labels and one-row composition semantics.
- [ ] Implement the minimal responsive presentation changes without changing callbacks.
- [ ] Run both focused component suites.

### Task 4: Stage composition

**Files:**
- Create: `apps/web/src/components/AnalysisStage.tsx`
- Test: `apps/web/src/components/AnalysisStage.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Test: `apps/web/src/app/App.test.tsx`

**Interfaces:**
- Consumes: existing findings/source/activity open callbacks, run state, option workspace, readiness, and proposal callbacks.
- Produces: narrow-only staged composition; expanded composition remains unchanged.

- [ ] Write failing tests for stage ownership and non-mutation during navigation.
- [ ] Implement Analysis entry points and App-level local stage navigation.
- [ ] Relocate existing narrow-mode components without changing their data or callbacks.
- [ ] Run focused App and stage tests.

### Task 5: Copy, evidence grouping, and action hierarchy

**Files:**
- Modify: `apps/web/src/components/WorkspaceAppBar.tsx`
- Test: `apps/web/src/components/WorkspaceAppBar.test.tsx`
- Modify: `apps/web/src/components/FindingsSheet.tsx`
- Test: `apps/web/src/components/FindingsSheet.test.tsx`
- Modify: `apps/web/src/components/ReferenceLibrary.tsx`
- Test: `apps/web/src/components/ReferenceLibrary.test.tsx`
- Modify: `apps/web/src/components/ApprovalCard.tsx`
- Test: `apps/web/src/components/ApprovalCard.test.tsx`

**Interfaces:**
- Existing props and callbacks remain unchanged unless the App-only composition no longer needs a global entry point.

- [ ] Write failing tests for truthful counts, duplicate publisher suppression, precise approval labels, and normal-action color hierarchy.
- [ ] Implement the copy and presentation changes.
- [ ] Run the focused component suites.

### Task 6: Browser acceptance

**Files:**
- Modify: `tests/e2e/pages/sift-page.ts`
- Modify: `tests/e2e/bid-comparison-journey.spec.ts`
- Update: affected files under `tests/e2e/bid-comparison-journey.spec.ts-snapshots/`
- Modify: `docs/specs/product.md`
- Modify: `docs/specs/testing.md`
- Modify: `docs/design-system.md`

- [ ] Add semantic journey assertions for all five steps, the compact controls, and unchanged decision behavior.
- [ ] Verify 390, 430, and 480 px overflow and accessibility.
- [ ] Update deterministic screenshots only after semantic assertions pass.
- [ ] Update canonical product, testing, and design-system documentation to reflect the shipped behavior.
- [ ] Run focused tests, typecheck, lint, format check, and the bid-comparison E2E journey.
