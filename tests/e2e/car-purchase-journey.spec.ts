/**
 * The complete "Choose Our Next Car" demo journey, run against the real
 * production Express + Vite build and the real six-node Strands Graph
 * (docs/specs/demos-and-submission.md "Required sequence";
 * `apps/agent/src/runtime/car-purchase-scenario.ts`'s proven reference
 * trajectory). Runs identically across all four configured viewport
 * projects (`playwright.config.ts`).
 *
 * Covers: launch -> 4 seeded candidates -> round-1 investigation streamed
 * live over SSE -> a recommendation with cited sources -> a criteria
 * reweight (the real `updateCriteria` command, invalidating the
 * recommendation live) -> a custom concern defined through the visible
 * `CustomConcernForm` -> round-2 investigation -> a revised recommendation
 * -> human-only approval of the pending proposal.
 *
 * Rewritten for `docs/decisions/
 * 0004-consumer-workspace-information-architecture.md`: the answer-first
 * `RecommendationHero` (merging the retired `WorkspaceStatusHeader`,
 * `RecommendationCard`, and `ApprovalCard` into one region) replaces the old
 * "current focus" card and stacked recommendation/approval regions; the
 * comparison table moved to the always-expanded `WorkspaceViewSwitcher`
 * (Quick Pick / List / Compare / Board tabs); the Decision Pack badge and
 * the raw chronological activity ledger ("Sift's work so far") both left
 * the consumer surface entirely. Each removed region is proven gone with an
 * explicit negative assertion below, not silently dropped, per this task's
 * own rule for preserving regression value on a deliberate removal.
 *
 * Rewritten again for `docs/decisions/0008-two-mode-product-architecture.md`:
 * "Manage options" (the disclosure ADR 0004 renamed "Compare the options"
 * to) is dismantled entirely, in BOTH layouts -- `OptionEditor` now lives in
 * a modal Sheet opened from `WorkspaceAppBar`'s always-visible "Add option"
 * control (`sift.openManageOptionsSheet()`/`closeManageOptionsSheet()`
 * below), never left open across unrelated steps the way the old inline
 * disclosure safely was. "What Sift found" moved the same way, onto the app
 * bar's "Findings" control (`sift.openFindingsSheet()`). At `desktop-1440`
 * this spec exercises ADR 0008's web-app mode (a persistent left
 * `WorkspaceSidebar` beside the main column) rather than a merely-wider
 * pane; the three narrow projects exercise pane mode, where the surviving
 * disclosures (priorities, notes, still-checking, add-a-question) are
 * unchanged from ADR 0004.
 *
 * "Criteria reweight" has no dedicated visible control yet (confirmed: no
 * criteria-editing UI exists anywhere in `apps/web/src/components` today --
 * `updateCriteria` is reachable only through the WebMCP tool catalog and
 * this same `/api/cases/:caseId/commands/updateCriteria` HTTP route). Real
 * WebMCP is genuinely unavailable in stock Chromium (`WebMcpStatus`'s
 * `adapter.supported()` check, asserted directly below), so this spec
 * exercises the identical command contract a WebMCP tool call would use via
 * `postCommand` (see `pages/sift-page.ts`'s header comment) and then proves
 * the browser reflects that external mutation live over SSE, with no click
 * and no reload -- the concrete, observable meaning of docs/engineering-principles.md's "shared
 * human-agent control".
 */
import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import {
  assertPrimaryTouchTargets,
  assertRecommendationHeroAboveTheFold,
  assertExpandedLayoutUsesWidth,
  assertRightPaneIntegrity,
  disableAnimations,
  expectNamedScreenshot,
} from './helpers/layout-assertions.js';
import { dynamicScreenshotMasks, withVolatileRegionsHidden } from './helpers/visual-masks.js';
import {
  CAR_PURCHASE_CANDIDATE_IDS,
  CAR_PURCHASE_CRITERION_IDS,
  getCaseState,
  isNarrowLayout,
  SiftPage,
  postCommand,
} from './pages/sift-page.js';

test.describe('Choose our next car -- full demo journey', () => {
  test('launch, investigate, recommend, reweight, custom concern, revise, approve', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);
    const masks = dynamicScreenshotMasks(page);
    // The real six-node Strands Graph genuinely fans four specialist nodes
    // out in parallel (car-purchase-engine.ts's `drainGraphToActivity`) --
    // confirmed by an actual failed double-run: three independent round-1
    // investigations against the same fixture converged on an identical
    // final case state and an identical *set* of 87 activity events every
    // time, but the exact interleaved *order* those events streamed in
    // genuinely differed run to run (real concurrent async completion
    // timing, not a bug). `LiveRunStatus`'s phase breadcrumb (built by
    // walking that same arrival order) varies in *line count*, not just
    // content -- so a plain `mask` is not enough (it paints over an existing
    // box without changing that box's size); every screenshot captured after
    // round 1 starts wraps the capture in `withVolatileRegionsHidden`, which
    // removes it from layout for the duration of the capture and restores it
    // immediately after (see `visual-masks.ts`'s header comment for the full
    // causal chain -- including the actual failed-double-run evidence, and
    // why `ActivityTimeline` needed the identical treatment before ADR 0004
    // moved it off the consumer surface entirely -- and why forcing
    // artificial ordering onto a genuinely concurrent Strands Graph is not
    // the correct fix here). Home Energy Guardian's Swarm, by contrast,
    // hands off between specialists strictly sequentially
    // (`HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS`), which is why
    // `home-energy-guardian-journey.spec.ts` needs no equivalent treatment.

    // --- Launch ---
    await sift.open();
    await assertNoSeriousAxeViolations(page, 'initial load (launcher)');
    await assertRightPaneIntegrity(page, [
      'demo-launcher-car-purchase',
      'demo-launcher-home-energy-guardian',
    ]);
    await expectNamedScreenshot(
      page,
      page.getByTestId('demo-launcher'),
      'initial-launcher.png',
      { testId: 'demo-launcher', text: 'Start a Sift case' },
      { maxDiffPixelRatio: 0.01 },
    );

    const { caseId } = await sift.launchCarPurchase();
    expect(caseId).toMatch(/.+/);

    // Real WebMCP is genuinely unavailable in this browser -- the page must
    // say so and stay fully usable through visible controls (webmcp.md
    // "Browser adapter"; docs/engineering-principles.md "Non-negotiable product truths").
    await expect(page.getByTestId('webmcp-status-unsupported')).toBeVisible();

    // --- 4 seeded candidates. "Manage options" (ADR 0004's rename of
    // "Compare the options") is gone entirely (ADR 0008): options are now
    // reached only through the app bar's "Add option" Sheet in both modes,
    // so the seeded count is proven from the app bar's own live status
    // line rather than opening anything. ---
    await expect(page.getByTestId('workspace-app-bar-option-count')).toHaveText(
      `${CAR_PURCHASE_CANDIDATE_IDS.length} options`,
    );

    // Fully settled, non-racing checkpoint: case loaded, seeded, nothing
    // investigated yet -- a stable baseline before any async run starts.
    // `RecommendationHero` (ADR 0004 item 1) is the one region that says
    // what Sift currently thinks; its `not_started` phase is the honest
    // "nothing looked into yet" signal that replaces the retired
    // "What Sift is doing" / `current-focus-empty` card below.
    await expect(page.getByTestId('recommendation-hero-status')).toHaveAttribute(
      'data-phase',
      'not_started',
    );
    await expect(page.getByTestId('recommendation-hero-headline')).toHaveText(
      "Nothing's been looked into yet.",
    );

    // --- Negative assertions: regions ADR 0004 deliberately removed from
    // the consumer surface stay removed. Preserved here (rather than simply
    // deleted along with the old positive checks) so a regression that
    // reintroduces any of them is still caught. ---
    // The "What Sift is doing" / `activeFocus` card: structurally dead code
    // (nothing ever wrote a non-null `activeFocus` in production) deleted
    // outright, per ADR 0004 decision item 5.
    await expect(page.getByTestId('current-focus')).toHaveCount(0);
    await expect(page.getByTestId('current-focus-empty')).toHaveCount(0);
    // The Decision Pack badge/id/compiled-hash and the case-status badge:
    // moved to developer-only detail entirely, per ADR 0004 decision item 1.
    await expect(page.getByTestId('workspace-app-bar-pack-badge')).toHaveCount(0);
    await expect(page.getByTestId('workspace-app-bar-run-status')).toHaveCount(0);

    // ADR 0004 decision item 6: the answer must be reachable without
    // scrolling at each canonical narrow width -- the machine-checked
    // above-the-fold invariant added specifically because this property
    // regressed once already, silently.
    await assertRecommendationHeroAboveTheFold(page);
    // No-op at 390/430/480. At desktop this is the assertion whose absence
    // let the whole workspace ship as a 448px column in an empty 1440px
    // window -- see ADR 0007 for why every other gate stayed green.
    await assertExpandedLayoutUsesWidth(page, 'case-workspace');

    // ADR 0008: the two layouts are genuinely different shells, not the same
    // stack merely made wider -- proven directly, not just inferred from the
    // width assertion above. Web-app mode gets a persistent left
    // `WorkspaceSidebar` (priorities/still-checking) the pane never has;
    // pane mode keeps the narrow disclosure stack ADR 0004 already
    // established, which web-app mode has none of at all (its equivalent
    // content lives in the main-column toolbar's Sheets instead).
    if (!isNarrowLayout(page)) {
      await expect(page.getByTestId('workspace-expanded-layout')).toBeVisible();
      await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
      await expect(page.getByTestId('disclosure-decision-profile')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('workspace-sidebar')).toHaveCount(0);
    }

    // ADR 0009: filters are the ONE region that must be byte-identical in
    // both shells, which is why they left the expanded-only sidebar for a
    // sheet mounted as global chrome. This is the assertion whose absence
    // let filtering ship as an expanded-mode-only capability -- and, worse,
    // as durable state nothing read. Asserted UNCONDITIONALLY, outside the
    // layout branch above, precisely because "the same in both modes" is
    // the property under test.

    // A second identity string, for the reason `bid-comparison-journey.spec.ts`'s
    // own `seeded-case.png` call documents in full: when that pack's case grew
    // from three options to twelve, `maxDiffPixelRatio: 0.01` absorbed the
    // entire change at five of six viewports and the gate stayed green
    // against baselines depicting the old count. The pixel threshold is not
    // the thing to fix -- what was missing is a machine-checked statement of
    // what the baseline DEPICTS. Derived, never typed, so it moves with the
    // fixture set.
    await expectNamedScreenshot(
      page,
      page.getByTestId('case-workspace'),
      'seeded-case.png',
      [
        { testId: 'recommendation-hero-headline', text: "Nothing's been looked into yet." },
        {
          testId: 'workspace-app-bar-option-count',
          text: `${String(CAR_PURCHASE_CANDIDATE_IDS.length)} options`,
        },
      ],
      { mask: masks, maxDiffPixelRatio: 0.01 },
    );

    // Deliberately AFTER the capture above: the filter surface is Review-owned
    // now (ADR 0016), and navigating there first would make a baseline called
    // `seeded-case` depict Review rather than the state a person lands on.
    await sift.goToWorkflowStage('review');
    await expect(page.getByTestId('workspace-filter-bar')).toBeVisible();
    await expect(page.getByTestId('workspace-filter-open')).toBeVisible();

    // --- Workspace view switcher (ADR 0004 item 5; ADR 0005): always
    // expanded, never a disclosure -- renders directly below
    // `RecommendationHero` and replaces the old unconditional comparison
    // table.
    //
    // Compare is no longer the DEFAULT tab -- task A10 changed the opening
    // view to Quick Pick because an always-fully-expanded attribute table
    // made a freshly seeded 390px workspace ~3379px tall, working directly
    // against change-set §64's "reduce apparent complexity". So this step
    // now selects Compare explicitly rather than assuming it is open. The
    // switch is one tap on the always-visible tab strip; nothing became
    // unreachable.
    //
    // At narrow widths Compare shows a head-to-head pair rather than all 4
    // candidates, so this proves the real narrowed behavior instead of the
    // old unconditional-table behavior. ---
    await expect(page.getByTestId('workspace-view-switcher')).toBeVisible();
    await sift.selectWorkspaceView('compare');
    await expect(page.getByTestId('workspace-view-content-compare')).toBeVisible();
    await expect(
      page.getByTestId(`option-compare-view-header-${CAR_PURCHASE_CANDIDATE_IDS[0]}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`option-compare-view-header-${CAR_PURCHASE_CANDIDATE_IDS[1]}`),
    ).toBeVisible();

    // Narrowing is now genuinely width-dependent, so this assertion is too.
    // Task B3 replaced `OptionCompareView`'s hardcoded `layout="narrow"`
    // with real width detection (`useWidthMode`), which is what change-set
    // §27 asks for: head-to-head in the canonical right pane, multi-column
    // when there is room. Asserting the narrow note at every viewport would
    // now be asserting the old hardcoded defect.
    //
    // This branched on a hardcoded `<= 480` while the rest of this same file
    // already called `isNarrowLayout`. When the product boundary moved to
    // 800, the literal stayed behind and this took the expanded branch at the
    // 640px ChatGPT pane -- demanding zero narrow notes from a layout that is
    // correctly narrow there. `isNarrowLayout` reads the product's own
    // constant, so the two cannot disagree again.
    if (isNarrowLayout(page)) {
      await expect(page.getByTestId('option-compare-view-narrow-note')).toContainText(
        `2 of ${CAR_PURCHASE_CANDIDATE_IDS.length}`,
      );
    } else {
      // Expanded: every candidate is a column, and no narrowing note is
      // rendered at all (never render what cannot be true).
      await expect(page.getByTestId('option-compare-view-narrow-note')).toHaveCount(0);
      for (const candidateId of CAR_PURCHASE_CANDIDATE_IDS) {
        await expect(page.getByTestId(`option-compare-view-header-${candidateId}`)).toBeVisible();
      }
    }

    // Switching to List proves all 4 seeded candidates genuinely render
    // somewhere in the workspace, not narrowed -- the direct DOM-presence
    // proof the old comparison-table loop made, now against the view that
    // actually shows every option unconditionally.
    await sift.selectWorkspaceView('list');
    for (const candidateId of CAR_PURCHASE_CANDIDATE_IDS) {
      await expect(page.getByTestId(`option-list-view-card-${candidateId}`)).toBeVisible();
    }
    // Returns to the default tab before continuing -- every later
    // screenshot in this journey should show the workspace as a real user
    // would first reach it, not a tab this test happened to select last.
    await sift.selectWorkspaceView('compare');

    // "Manage options" (ADR 0008): no longer an inline disclosure row --
    // `OptionEditor` now lives inside the app bar's "Add option" Sheet, a
    // real modal dialog. Unlike the old disclosure, it is not safe to leave
    // open across the rest of the journey (its overlay would intercept the
    // "Request investigation" click below), so this opens it just for this
    // check and closes it again immediately after.
    await sift.openManageOptionsSheet();
    for (const candidateId of CAR_PURCHASE_CANDIDATE_IDS) {
      await expect(page.getByTestId(`option-editor-option-${candidateId}`)).toBeVisible();
    }

    // Option-editor edit/cancel row: real rendered geometry, not just
    // className presence -- entering and leaving edit mode here is a pure
    // local-UI-state toggle (`OptionEditor.tsx`'s `startEdit`/`startNew`),
    // no `upsertOption` command fires, so it leaves no trace on the case and
    // does not affect any later screenshot. This is also the only way to
    // observe `option-editor-save` and `option-editor-cancel` rendered
    // together in the same flex row, which is exactly the state that had
    // the two buttons at mismatched heights before tonight's fix.
    await page.getByTestId(`option-editor-edit-${CAR_PURCHASE_CANDIDATE_IDS[0]}`).click();
    await expect(page.getByTestId('option-editor-cancel')).toBeVisible();
    await assertPrimaryTouchTargets(page, ['option-editor-save', 'option-editor-cancel']);
    await page.getByTestId('option-editor-cancel').click();
    await expect(page.getByTestId('option-editor-cancel')).toBeHidden();
    await sift.closeManageOptionsSheet();

    // --- Round 1: real live streaming investigation ---
    const round1 = await sift.requestInvestigation();
    // Mid-investigation state: `LiveRunStatus`, now embedded directly in
    // `RecommendationHero`, is already populating live from real streamed
    // events (not a static end state) -- the answer-first hero's own proof
    // that something is happening, without needing to open anything.
    await expect(page.getByTestId('live-run-status')).toBeVisible();
    // The raw chronological activity ledger ("Sift's work so far") that
    // used to live in its own disclosure row here is developer-only content
    // now (ADR 0004 item 3/4) -- confirmed gone from the consumer surface
    // entirely, not merely closed.
    await expect(page.getByTestId('disclosure-work-so-far')).toHaveCount(0);
    await expect(page.getByTestId('activity-timeline')).toHaveCount(0);
    await assertNoSeriousAxeViolations(page, 'mid-investigation');
    await assertRightPaneIntegrity(page, ['request-investigation', 'workspace-app-bar-reset-demo']);

    // The Add option Sheet stays genuinely reachable and usable while a run
    // streams live -- opened and closed again here rather than left open
    // across the whole journey (see the "Manage options" step above for
    // why), so this still proves real rendered geometry for
    // `option-editor-new`/`option-editor-save`/`option-editor-edit-*`
    // mid-investigation, not merely that they are skipped because the sheet
    // happens to be closed.
    await sift.openManageOptionsSheet();
    await assertPrimaryTouchTargets(page, [
      'option-editor-new',
      'option-editor-save',
      `option-editor-edit-${CAR_PURCHASE_CANDIDATE_IDS[0]}`,
    ]);
    await sift.closeManageOptionsSheet();

    // Runtime Inspector: `open-runtime-inspector` only becomes visible once
    // a run has been requested (`liveRunStatusReceipt?.runId`, `App.tsx`),
    // which just happened above -- this is the first point in the journey
    // it is genuinely reachable. Real rendered geometry for the view
    // selector tabs and "Refresh" (all fixed for 44px touch targets tonight
    // -- design-system.md names the view selector verbatim). It is now a
    // Sheet overlay, not a route swap (round-2 design review: "show these
    // in ... a side sliding sheet"), closed via the Sheet's own close
    // control -- opening/closing still fires no case command, so it does
    // not disturb the investigation running underneath or any later
    // screenshot.
    await page.getByTestId('open-runtime-inspector').click();
    await expect(page.getByTestId('runtime-inspector')).toBeVisible();
    await assertPrimaryTouchTargets(page, [
      'sheet-close',
      'runtime-inspector-tab-overview',
      'runtime-inspector-tab-timeline',
      'runtime-inspector-refresh',
    ]);
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('runtime-inspector')).not.toBeVisible();
    await expect(page.getByTestId('case-workspace')).toBeVisible();

    await sift.waitForInvestigationCompleted(round1.runId);
    await sift.waitForRecommendationReady();

    // Recommendation carries a rationale and cited, source-linked evidence.
    await expect(page.getByTestId('recommendation-card-rationale')).not.toBeEmpty();
    await expect(page.getByTestId('recommendation-card-sources')).toBeVisible();
    const round1SourceCount = await page
      .getByTestId('recommendation-card-sources')
      .locator('li')
      .count();
    expect(round1SourceCount).toBeGreaterThan(0);

    // Pin the workspace view immediately before capturing.
    //
    // `case-workspace` includes the view switcher, so the captured image
    // depends on which tab is active -- and by this point the journey has
    // clicked through several. Diffing two failed baselines showed exactly
    // that: one run captured List, another Compare, from the same test. The
    // view is persisted state now (Task A11), written by a command that can
    // legitimately lose a sequence race against the live run, so "whichever
    // tab happens to be active" is genuinely nondeterministic here.
    //
    // Selecting one explicitly removes the variable by construction rather
    // than tolerating it. This does not weaken the assertion: every tab
    // still has its own dedicated coverage earlier in this same journey, and
    // the baseline now captures a defined state instead of an accidental one.
    await sift.selectWorkspaceView('quick_pick');
    await withVolatileRegionsHidden(page, () =>
      expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'recommendation-ready.png',
        { testId: 'recommendation-card-status', text: 'Ready for review' },
        { maxDiffPixelRatio: 0.01 },
      ),
    );

    // --- Criteria reweight: the real command route, no click, no reload ---
    const beforeReweight = await getCaseState(page.request, caseId);
    const reweightResponse = await postCommand(page.request, caseId, 'updateCriteria', {
      expectedSequence: beforeReweight['eventSequence'],
      operations: [
        { op: 'reweight', criterionId: CAR_PURCHASE_CRITERION_IDS.drivingComfort, weight: 25 },
        { op: 'reweight', criterionId: CAR_PURCHASE_CRITERION_IDS.ownershipCost, weight: 15 },
      ],
    });
    expect(reweightResponse.ok(), await reweightResponse.text()).toBe(true);

    // The browser -- already open, subscribed via SSE -- reflects this
    // external mutation live: the existing recommendation is invalidated.
    await expect(page.getByTestId('recommendation-card-status')).toContainText('Stale', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('recommendation-card-stale-note')).toBeVisible();

    // A stable, fully-settled pause point (nothing is in flight -- round 2
    // has not been requested yet).
    await withVolatileRegionsHidden(page, () =>
      expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'recommendation-stale.png',
        { testId: 'recommendation-card-status', text: 'Stale' },
        { maxDiffPixelRatio: 0.01 },
      ),
    );

    // --- Custom concern: the visible-control equivalent of sift_define_case_attribute ---
    await sift.submitCustomConcern({
      slug: 'rear_facing_seat_behind_driver',
      label: 'Rear-facing seat fits behind the driver',
      reason:
        'A second child arrives in three months, so a rear-facing seat has to go behind the driver without pushing the driver seat forward.',
      valueType: 'boolean',
      evidenceExpectation: 'verification',
      comparison: 'target',
    });

    // A user-origin concern is auto-confirmed (packages/core/src/extensions.ts) --
    // no separate confirmation step is required before it takes effect.
    const afterConcern = await getCaseState(page.request, caseId);
    expect(
      (
        afterConcern['caseExtensions'] as { id: string; definition: { confirmation: string } }[]
      ).some((extension) => extension.definition.confirmation === 'confirmed'),
    ).toBe(true);

    // Closed before round 2's click below: in web-app mode "Add a question"
    // is a real modal Sheet (ADR 0008) left open by `submitCustomConcern`
    // (it only fills and submits, never closes what it opened), which would
    // otherwise intercept the "Request investigation" click and hang the
    // journey. Pane mode's disclosure has no modal to close.
    await sift.closeAddConcern();

    // --- Round 2: independently detected from the confirmed concern (car-purchase-engine.ts) ---
    const round2 = await sift.requestInvestigation();
    expect(round2.runId).not.toBe(round1.runId);
    await sift.waitForInvestigationCompleted(round2.runId);
    await sift.waitForRecommendationReady();

    // --- Revised recommendation + human-only approval ---
    // Approval controls are Decide-owned now (ADR 0016; the change set:
    // "Approval controls belong to Decide"). A pending proposal is exactly
    // what makes Decide reachable, so this is navigation, not a workaround.
    await sift.goToWorkflowStage('decide');
    await expect(page.getByTestId('approval-card-pending')).toBeVisible();
    await assertNoSeriousAxeViolations(page, 'awaiting human approval');

    // Evidence exists for real by this point (both rounds' evidence has
    // landed), but every evidence card now lives inside the "What Sift
    // found" review Sheet, not inline (round-2 design review) -- opened
    // just for this touch-target check, then closed again before the
    // baseline screenshot below, which must show the normal workspace, not
    // a Sheet overlay on top of it.
    await sift.openFindingsSheet();
    await assertPrimaryTouchTargets(page, [
      // The same `evidence-card-disposition-option-*` testid repeats per
      // card; `assertPrimaryTouchTargets` checks the first match, which is
      // representative of every card since they share one ToggleGroup config.
      'evidence-card-disposition-option-included',
      'evidence-card-disposition-option-excluded',
      'evidence-card-disposition-option-questioned',
    ]);
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('findings-sheet')).not.toBeVisible();

    await assertRightPaneIntegrity(page, ['approval-card-approve', 'approval-card-reject']);

    // As above: the Add option Sheet stays reachable while a proposal is
    // pending, checked and closed again rather than left open through the
    // screenshot below.
    await sift.openManageOptionsSheet();
    await assertPrimaryTouchTargets(page, [
      'option-editor-new',
      'option-editor-save',
      `option-editor-edit-${CAR_PURCHASE_CANDIDATE_IDS[0]}`,
    ]);
    await sift.closeManageOptionsSheet();

    // The approval card is Decide-owned, and this capture's whole identity is
    // "a decision is waiting on you" -- so stand on Decide before the shot.
    // Earlier steps in this journey navigate to Review and Analysis, so the
    // active stage at this point is not implied by the one set above.
    await sift.goToWorkflowStage('decide');
    await withVolatileRegionsHidden(page, () =>
      expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'awaiting-approval.png',
        { testId: 'approval-card-pending', text: 'Your approval needed' },
        { maxDiffPixelRatio: 0.01 },
      ),
    );

    await sift.approveProposal();
    await expect(page.getByTestId('approval-card-settled')).toBeVisible();
    await withVolatileRegionsHidden(page, () =>
      expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'decided.png',
        { testId: 'approval-card-stamp', text: 'Approved' },
        { maxDiffPixelRatio: 0.01 },
      ),
    );

    const finalState = await getCaseState(page.request, caseId);
    expect(finalState['status']).toBe('decided');
    expect((finalState['proposal'] as { status: string } | null)?.status).toBe('approved');

    guard.assertClean();
  });

  /**
   * ADR 0010's end-to-end proof: the browse card is an index entry and the
   * profile is the detail page.
   *
   * Two regressions this gate exists to catch, both of which shipped once:
   *
   *  1. A card that leads with identity fields. Narrow List used to read
   *     only `attributeGroups[0]`, so at 390px a card showed make, model,
   *     model year, trim, body style and drivetrain -- six restatements of
   *     its own title -- and no price at all. This asserts a card carries
   *     the pack's DECLARED prominent facts and does NOT repeat the label.
   *  2. Detail with nowhere to go. Every per-attribute provenance field
   *     (`status`, `origin`, `sourceIds`, `confidence`, `updatedAt`) was
   *     rendered nowhere in the product; `sift_get_option_details` gave the
   *     model a full profile a person could not see.
   *
   * Runs unbranched at every viewport: the profile is global chrome, so
   * "reachable in both modes" is the property under test.
   */
  test('a browse card leads with the pack-declared facts, and opens a profile carrying the detail', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.open();
    await sift.launchCarPurchase();
    await sift.selectWorkspaceView('list');

    const firstCard = page.locator('[data-testid^="option-list-view-card-"]').first();
    await expect(firstCard).toBeVisible();
    const optionId = (await firstCard.getAttribute('data-testid'))!.replace(
      'option-list-view-card-',
      '',
    );

    // The card carries a compact signal summary rather than three stacked
    // prose sections. The exact phrase below is what those sections used to
    // repeat, six times per card, and its absence is the trimming holding.
    await expect(page.getByTestId(`option-card-signals-${optionId}`)).toBeVisible();
    await expect(firstCard).not.toHaveText(/needs stronger evidence/i);

    await sift.openOptionProfile(optionId);
    const sheet = page.getByTestId('option-profile-sheet');

    // The profile shows what no card does: real per-attribute provenance.
    // Asserted through a testid rather than copy, so rewording the sentence
    // does not silently turn this gate off.
    await expect(page.getByTestId('option-profile-title')).toBeVisible();
    await expect(page.getByTestId('option-profile-signals')).toBeVisible();
    await expect(
      sheet.locator('[data-testid^="option-profile-attribute-status-"]').first(),
    ).toBeVisible();

    // A profile carries strictly more attribute rows than its card carries
    // facts -- the whole point of splitting index from detail. Counted, not
    // assumed, and derived from the page rather than hard-coded against seed
    // data this spec does not own.
    const cardFactCount = await firstCard
      .locator('[data-testid^="option-list-view-fact-"]')
      .count();
    const profileRowCount = await sheet
      .locator('[data-testid^="option-profile-attribute-"]:not([data-testid*="-status-"])')
      .count();
    expect(profileRowCount).toBeGreaterThan(cardFactCount);

    await sift.closeOptionProfile();
    await expect(sheet).not.toBeVisible();

    guard.assertClean();
  });

  /**
   * ADR 0009's end-to-end proof, and a genuine regression gate rather than a
   * rendering check.
   *
   * Before this change, `WorkspaceFilter` was written by the filter controls
   * and read by NOBODY -- a repo-wide grep matched the schema, the writer,
   * and the control that produced it, and nothing else. Every control on
   * screen wrote durable state that changed no pixel. A test that only
   * asserted "the control renders and a filter is persisted" would have
   * passed against that defect, which is exactly why this asserts the
   * OPTION LIST ITSELF narrows and then comes back.
   *
   * Runs at every configured viewport, unbranched, because "identical in
   * both modes" is the property ADR 0009 exists to guarantee -- at 390-480px
   * this capability previously did not exist at all.
   */
  test('filters narrow the real option list, and removing the chip restores it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.open();
    await sift.launchCarPurchase();

    // The List view renders one card per visible option, which is the
    // surface a filter must actually move.
    await sift.selectWorkspaceView('list');
    const optionCards = page.locator('[data-testid^="option-list-view-card-"]');

    const resultCount = page.getByTestId('workspace-filter-result-count');
    await expect(resultCount).toBeVisible();
    // No filters applied yet: a bare total, never an "N of M" reading.
    await expect(resultCount).not.toContainText(' of ');

    // The bar's own unfiltered total is the source for how many cards must
    // be on screen, so this never hard-codes a seed count it does not own.
    //
    // Deliberately `toHaveCount` (which retries) rather than reading
    // `locator.count()` into a variable: `count()` resolves ONCE, with no
    // auto-waiting, so under four parallel workers it samples the list
    // before React has rendered a single card and returns 0. That is
    // exactly how the first version of this test failed -- green in
    // isolation, red every time the full spec ran -- and it is the failure
    // mode docs/engineering-principles.md's "avoid fixed sleeps" rule exists to prevent.
    const seededCount = Number(/^(\d+)/.exec((await resultCount.textContent()) ?? '')?.[1]);
    expect(seededCount).toBeGreaterThan(1);
    await expect(optionCards).toHaveCount(seededCount);

    // Take whatever the first facet group offers rather than hard-coding a
    // make or a drivetrain: `planWorkspaceFilters` orders controls by how
    // much they can actually narrow THIS case's real seeded data, so the
    // first facet chip is by construction a real, narrowing choice. Naming a
    // specific value here would couple this gate to seed data it does not
    // own.
    await sift.openFilterSheet();
    const firstFacetChip = page
      .getByTestId('workspace-filter-sheet')
      .locator('[data-testid*="-option-0"]')
      .first();
    await expect(firstFacetChip).toBeVisible();
    await firstFacetChip.click();
    await sift.closeFilterSheet();

    // The bar now explains the narrowing, and the list genuinely obeys it.
    const chip = page.locator('[data-testid^="workspace-filter-chip-"]').first();
    await expect(chip).toBeVisible();
    await expect(page.getByTestId('workspace-filter-active-count')).toHaveText('1');
    await expect(resultCount).toContainText(' of ');

    // THE assertion this whole test exists for: the rendered list obeys the
    // filter. Before this change `WorkspaceFilter` was persisted and read by
    // nothing, so the count below would have stayed at `seededCount` while
    // every other assertion here still passed.
    const filteredCount = Number(/^(\d+)/.exec((await resultCount.textContent()) ?? '')?.[1]);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(seededCount);
    await expect(optionCards).toHaveCount(filteredCount);

    // Removing the chip from the bar -- without reopening the sheet -- is
    // the whole reason the applied filters are shown outside it.
    await page.locator('[data-testid^="workspace-filter-chip-remove-"]').first().click();
    await expect(page.getByTestId('workspace-filter-active-count')).toHaveCount(0);
    await expect(resultCount).not.toContainText(' of ');
    await expect(optionCards).toHaveCount(seededCount);

    guard.assertClean();
  });
});
