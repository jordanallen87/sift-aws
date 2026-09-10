/**
 * The complete "Home Energy Guardian" demo journey, run against the real
 * production Express + Vite build and the real six-node, bounded Strands
 * Swarm (`apps/agent/src/runtime/home-energy-swarm.ts`, driven live by
 * `home-energy-engine.ts`; `home-energy-guardian-scenario.ts`'s proven
 * reference trajectory). Runs identically across all four configured
 * viewport projects (`playwright.config.ts`), mirroring
 * `car-purchase-journey.spec.ts` exactly in structure and command-route
 * discipline (see that file's and `pages/sift-page.ts`'s header comments for
 * the shared rules this spec also follows: no shortcut around the real HTTP
 * routes, `postCommand`/`postRunRequest` exercise the identical contract a
 * WebMCP tool call or a visible control would use).
 *
 * Covers: launch -> 4 seeded response options -> round-1 investigation
 * streamed live over SSE -> a recommendation favoring `monitor-one-cycle`
 * with cited sources -> a criteria reweight (the real `updateCriteria`
 * command, invalidating the recommendation live, no click, no reload) ->
 * round-2 investigation -> a revised recommendation favoring
 * `request-hvac-inspection` -> a pending proposal gated by
 * `ConsequenceGuard` -> human-only approval.
 *
 * --- A genuine, honestly-encountered gap: round 2 has no visible-control path ---
 *
 * Confirmed directly against the real running app (clicked through with a
 * live Playwright browser before writing any assertion below, per this
 * task's own discipline): round 1 satisfies every one of Home Energy
 * Guardian's five obligations (`energy.anomaly`, `energy.rate_change`,
 * `energy.weather`, `energy.household_change`, `energy.response_options`).
 * Unlike `car-purchase`, whose round 2 the existing sibling spec drives
 * through a plain click on the generic "Request investigation" button
 * because submitting a custom concern reopens an obligation for it to
 * auto-select, Home Energy Guardian's required trajectory has no such step
 * -- after the reweight below, every obligation remains `satisfied`, so
 * that same generic click genuinely fails with a real `400`
 * ("No obligation is available to investigate ... No open obligation
 * remains to select"), and `ReadinessPanel` (the only other place any
 * obligation is rendered) exposes no "investigate this" control. This is a
 * real product gap, not a test artifact -- there is currently no way for a
 * human, through this app's visible UI alone, to re-open Home Energy
 * Guardian's investigation once its one obligation has already been
 * satisfied once. Filed here rather than silently routed around: round 2 is
 * driven below via `postRunRequest`, the exact same
 * `POST /api/cases/:caseId/run` route and `RequestInvestigationInput`
 * contract (including its real, documented `obligationId` field) the
 * visible control itself calls -- genuinely the same command
 * implementation, not a bypass of it (docs/engineering-principles.md "Visible UI controls and
 * WebMCP callbacks use the same command implementation") -- see
 * `sift-page.ts`'s `postRunRequest`/`waitForRecommendationRationaleContains`
 * for the full mechanics.
 *
 * Rewritten for `docs/decisions/
 * 0004-consumer-workspace-information-architecture.md`, then again for
 * `docs/decisions/0008-two-mode-product-architecture.md` -- see
 * `car-purchase-journey.spec.ts`'s own header comment for the full list of
 * information-architecture changes both hero journeys share (the
 * answer-first `RecommendationHero`, the always-expanded
 * `WorkspaceViewSwitcher` replacing the old unconditional comparison table,
 * the Decision Pack badge and raw activity ledger leaving the consumer
 * surface, "Manage options"/"What Sift found" dismantled into the app bar's
 * "Add option"/"Findings" Sheets in both layouts, and the web-app-mode
 * `WorkspaceSidebar` this spec's `desktop-1440` project now exercises).
 * Each removed region is proven gone with an explicit negative assertion
 * below.
 */
import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import {
  assertPrimaryTouchTargets,
  assertRecommendationHeroAboveTheFold,
  assertRightPaneIntegrity,
  disableAnimations,
  expectNamedScreenshot,
} from './helpers/layout-assertions.js';
import { dynamicScreenshotMasks, withVolatileRegionsHidden } from './helpers/visual-masks.js';
import {
  getCaseState,
  HOME_ENERGY_CRITERION_IDS,
  HOME_ENERGY_RESPONSE_OPTION_ENTITY_ORDER,
  HOME_ENERGY_RESPONSE_OPTION_IDS,
  HOME_ENERGY_RESPONSE_OPTIONS_OBLIGATION_ID,
  isNarrowLayout,
  SiftPage,
  postCommand,
  postRunRequest,
} from './pages/sift-page.js';

test.describe('switching between decisions', () => {
  // The demo script's closing beat asks the recorder to "switch demos --
  // reset to Choose our next car", and until 2026-09-05 the product could
  // not do it: "Reset demo" restarts the *same* pack, the launcher renders
  // only when no case is active, and the active case id is restored from
  // localStorage on every load. Anyone evaluating the deployed app saw
  // whichever pack they opened first and no other, for the life of that
  // browser profile.
  test('a person can leave one decision and start the other, without clearing site data', async ({
    page,
  }) => {
    const sift = new SiftPage(page);

    await sift.openAsFirstTimeVisitor();
    await sift.launchHomeEnergyGuardian();
    // The first-run guide is a modal over the bar on a first visit.
    await sift.dismissFirstRunGuide();
    await expect(page.getByTestId('workspace-app-bar')).toBeVisible();

    await page.getByTestId('workspace-app-bar-create-menu').click();
    await page.getByTestId('workspace-app-bar-switch-decision').click();

    // Back at the launcher, with both packs offered again.
    await expect(page.getByTestId('demo-launcher')).toBeVisible();

    // And the other pack genuinely starts, rather than the launcher being a
    // dead end that reopens the case we just left.
    await sift.launchCarPurchase();
    await expect(page.getByTestId('workspace-app-bar')).toBeVisible();
    // "Choose our next car" is the launcher's button label; the case it
    // creates is titled from the pack identity, "Vehicle Selection".
    await expect(page.getByTestId('workspace-app-bar')).toContainText('Vehicle Selection');
  });
});

test.describe('Home Energy Guardian -- full demo journey', () => {
  test('launch, investigate, recommend, reweight, revise, approve', async ({ page }) => {
    test.setTimeout(120_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);
    // Every post-run capture below wraps in `withVolatileRegionsHidden`,
    // exactly as `car-purchase-journey.spec.ts` does.
    //
    // This spec previously claimed the opposite, on the grounds that Home
    // Energy Guardian's Swarm hands off strictly sequentially
    // (`HOME_ENERGY_SEQUENTIAL_SPECIALIST_IDS`) and that a plain timestamp
    // `mask` therefore sufficed -- "confirmed empirically by multiple clean,
    // zero-diff repeated runs". That claim was **falsified by an actual
    // failure** during a full `pnpm verify`: `recommendation-ready.png` at
    // `right-pane-390` expected 390x5726 and received 390x5901, a 175px
    // HEIGHT difference (0.02 of all pixels). A height delta is content
    // reflow, not antialiasing -- `LiveRunStatus`'s phase breadcrumb varies
    // in line COUNT, and a `mask` paints over a box without changing its
    // size, so masking can never absorb it.
    //
    // Sequential handoff makes the specialist ORDER deterministic; it does
    // not make the breadcrumb's rendered height deterministic. Raising
    // `maxDiffPixelRatio` would have hidden this rather than fixed it, and
    // would have blunted the gate for every other diff too.
    const masks = dynamicScreenshotMasks(page);

    // --- Launch ---
    await sift.open();
    await assertNoSeriousAxeViolations(page, 'initial load (launcher)');
    await assertRightPaneIntegrity(page, [
      'demo-launcher-car-purchase',
      'demo-launcher-home-energy-guardian',
    ]);
    await expect(page.getByTestId('demo-launcher')).toBeVisible();
    await expectNamedScreenshot(
      page,
      page.getByTestId('demo-launcher'),
      'initial-launcher.png',
      { testId: 'demo-launcher', text: 'Start a Sift case' },
      { maxDiffPixelRatio: 0.01 },
    );

    const { caseId } = await sift.launchHomeEnergyGuardian();
    expect(caseId).toMatch(/.+/);

    // Real WebMCP is genuinely unavailable in this browser -- the page must
    // say so and stay fully usable through visible controls (webmcp.md
    // "Browser adapter"; docs/engineering-principles.md "Non-negotiable product truths").
    await expect(page.getByTestId('webmcp-status-unsupported')).toBeVisible();

    // --- 4 seeded response options (ADR 0004: "Manage options" -- renamed
    // from "Compare the options" -- is a closed-by-default disclosure row;
    // the seeded count is proven from its own live meta summary rather than
    // the options list itself, which is not yet in the DOM's visible flow). ---
    // The "Manage options" disclosure and its meta summary are gone (ADR
    // 0008): options are now reached through the app bar in both modes, so
    // the live seeded count is proven from the app bar's own status line.
    await expect(page.getByTestId('workspace-app-bar-option-count')).toHaveText(
      `${HOME_ENERGY_RESPONSE_OPTION_IDS.length} options`,
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
    // the consumer surface stay removed (see `car-purchase-journey.spec.ts`
    // for the same checks and their full rationale). ---
    await expect(page.getByTestId('current-focus')).toHaveCount(0);
    await expect(page.getByTestId('current-focus-empty')).toHaveCount(0);
    await expect(page.getByTestId('workspace-app-bar-pack-badge')).toHaveCount(0);
    await expect(page.getByTestId('workspace-app-bar-run-status')).toHaveCount(0);

    // ADR 0004 decision item 6: above-the-fold invariant.
    await assertRecommendationHeroAboveTheFold(page);

    // ADR 0008: the two layouts are genuinely different shells -- see
    // `car-purchase-journey.spec.ts` for the full rationale (this journey
    // mirrors it exactly).
    if (!isNarrowLayout(page)) {
      await expect(page.getByTestId('workspace-expanded-layout')).toBeVisible();
      await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
      await expect(page.getByTestId('disclosure-decision-profile')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('workspace-sidebar')).toHaveCount(0);
    }

    // ADR 0009, asserted in the SECOND pack's journey too: the filter
    // surface is pack-agnostic. `home-energy-guardian` declares its own
    // attributes and its own `optionLabel`/`optionLabelPlural`, so this
    // proves the bar renders from whatever the active pack actually
    // declares rather than from anything car-shaped.
    await expect(page.getByTestId('workspace-filter-bar')).toBeVisible();
    await expect(page.getByTestId('workspace-filter-open')).toBeVisible();

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
          text: `${String(HOME_ENERGY_RESPONSE_OPTION_IDS.length)} options`,
        },
      ],
      { mask: masks, maxDiffPixelRatio: 0.01 },
    );

    // --- Workspace view switcher (ADR 0004 item 5; ADR 0005) -- see
    // `car-purchase-journey.spec.ts` for the full rationale on why Compare
    // narrows to a head-to-head pair at every viewport today. The pair it
    // picks (`options.slice(0, 2)` with nothing focused yet) follows the
    // *real* entity order the fixture builds (`monitor-one-cycle`,
    // `change-rate-plan`), not `HOME_ENERGY_RESPONSE_OPTION_IDS`'s own
    // alphabetized listing -- see `HOME_ENERGY_RESPONSE_OPTION_ENTITY_ORDER`'s
    // header comment in `sift-page.ts`. ---
    // Compare is selected explicitly: task A10 made Quick Pick the opening
    // view (see `car-purchase-journey.spec.ts` for the height rationale),
    // so assuming Compare is already open would assert a default this
    // product deliberately no longer has.
    await expect(page.getByTestId('workspace-view-switcher')).toBeVisible();
    await sift.selectWorkspaceView('compare');
    await expect(page.getByTestId('workspace-view-content-compare')).toBeVisible();
    await expect(
      page.getByTestId(`option-compare-view-header-${HOME_ENERGY_RESPONSE_OPTION_ENTITY_ORDER[0]}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`option-compare-view-header-${HOME_ENERGY_RESPONSE_OPTION_ENTITY_ORDER[1]}`),
    ).toBeVisible();
    // Width-dependent, for the same reason documented in
    // `car-purchase-journey.spec.ts`: task B3 gave `OptionCompareView` real
    // width detection instead of a hardcoded narrow layout, so head-to-head
    // is the canonical right-pane behavior and multi-column is what §27 asks
    // for when there is room.
    // Uses the product's own boundary via `isNarrowLayout`, not a hardcoded
    // literal -- see the equivalent note in `car-purchase-journey.spec.ts`
    // for the drift that cost.
    if (isNarrowLayout(page)) {
      await expect(page.getByTestId('option-compare-view-narrow-note')).toContainText(
        `2 of ${HOME_ENERGY_RESPONSE_OPTION_IDS.length}`,
      );
    } else {
      await expect(page.getByTestId('option-compare-view-narrow-note')).toHaveCount(0);
      for (const optionId of HOME_ENERGY_RESPONSE_OPTION_IDS) {
        await expect(page.getByTestId(`option-compare-view-header-${optionId}`)).toBeVisible();
      }
    }

    // Switching to List proves all 4 seeded response options genuinely
    // render somewhere in the workspace, not narrowed.
    await sift.selectWorkspaceView('list');
    for (const optionId of HOME_ENERGY_RESPONSE_OPTION_IDS) {
      await expect(page.getByTestId(`option-list-view-card-${optionId}`)).toBeVisible();
    }
    await sift.selectWorkspaceView('compare');

    // "Manage options" (ADR 0008): `OptionEditor` now lives inside the app
    // bar's "Add option" Sheet, a real modal dialog -- opened just for this
    // check and closed again immediately after (see
    // `car-purchase-journey.spec.ts` for the full rationale).
    await sift.openManageOptionsSheet();
    for (const optionId of HOME_ENERGY_RESPONSE_OPTION_IDS) {
      await expect(page.getByTestId(`option-editor-option-${optionId}`)).toBeVisible();
    }

    // Option-editor edit/cancel row: real rendered geometry, not just
    // className presence -- entering and leaving edit mode here is a pure
    // local-UI-state toggle (`OptionEditor.tsx`'s `startEdit`/`startNew`),
    // no `upsertOption` command fires, so it leaves no trace on the case and
    // does not affect any later screenshot. This is also the only way to
    // observe `option-editor-save` and `option-editor-cancel` rendered
    // together in the same flex row, which is exactly the state that had
    // the two buttons at mismatched heights before tonight's fix.
    await page.getByTestId(`option-editor-edit-${HOME_ENERGY_RESPONSE_OPTION_IDS[0]}`).click();
    await expect(page.getByTestId('option-editor-cancel')).toBeVisible();
    await assertPrimaryTouchTargets(page, ['option-editor-save', 'option-editor-cancel']);
    await page.getByTestId('option-editor-cancel').click();
    await expect(page.getByTestId('option-editor-cancel')).toBeHidden();
    await sift.closeManageOptionsSheet();

    // --- Round 1: real live streaming investigation, driven by the visible control ---
    const round1 = await sift.requestInvestigation();
    // `LiveRunStatus`, now embedded directly in `RecommendationHero`, is
    // already populating live from real streamed events -- no need to open
    // anything to see it, unlike the retired "Sift's work so far" disclosure
    // row this journey used to open/close here specifically to keep its own
    // (very tall, for this pack's two-round trajectory) content out of every
    // later screenshot. That row -- and the raw chronological activity
    // ledger it wrapped -- is developer-only content now (ADR 0004 item
    // 3/4), confirmed gone from the consumer surface entirely.
    await expect(page.getByTestId('live-run-status')).toBeVisible();
    await expect(page.getByTestId('disclosure-work-so-far')).toHaveCount(0);
    await expect(page.getByTestId('activity-timeline')).toHaveCount(0);
    await assertNoSeriousAxeViolations(page, 'mid-investigation');
    await assertRightPaneIntegrity(page, ['request-investigation', 'workspace-app-bar-reset-demo']);

    // The Add option Sheet stays genuinely reachable and usable while a run
    // streams live -- see `car-purchase-journey.spec.ts` for the full
    // rationale for opening/closing it here rather than leaving it open.
    await sift.openManageOptionsSheet();
    await assertPrimaryTouchTargets(page, [
      'option-editor-new',
      'option-editor-save',
      `option-editor-edit-${HOME_ENERGY_RESPONSE_OPTION_IDS[0]}`,
    ]);
    await sift.closeManageOptionsSheet();

    // Runtime Inspector: `open-runtime-inspector` only becomes visible once
    // a run has been requested (`liveRunStatusReceipt?.runId`, `App.tsx`),
    // which just happened above -- this is the first point in the journey
    // it is genuinely reachable. Real rendered geometry for the view
    // selector tabs and "Refresh" (all fixed for 44px touch targets
    // tonight -- design-system.md names the view selector verbatim). It is
    // now a Sheet overlay, not a route swap (round-2 design review: "show
    // these in ... a side sliding sheet"), closed via the Sheet's own
    // close control -- opening/closing still fires no case command, so it
    // does not disturb the investigation running underneath or any later
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

    // Recommendation carries a rationale and cited, source-linked evidence,
    // and (per the real proven scenario trajectory) favors monitoring for
    // one more billing cycle at the pack's default 80/20 cost-favoring
    // weighting (energy.cost 80 / energy.conservation 20).
    await expect(page.getByTestId('recommendation-card-rationale')).toContainText(
      'monitor-one-cycle',
    );
    await expect(page.getByTestId('recommendation-card-sources')).toBeVisible();
    const round1SourceCount = await page
      .getByTestId('recommendation-card-sources')
      .locator('li')
      .count();
    expect(round1SourceCount).toBeGreaterThan(0);

    const round1State = await getCaseState(page.request, caseId);
    expect(
      (round1State['recommendation'] as { favoredOptionId: string } | null)?.favoredOptionId,
    ).toBe('monitor-one-cycle');

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
    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'recommendation-ready.png',
        { testId: 'recommendation-card-status', text: 'Ready for review' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    // --- Criteria reweight: the real command route, no click, no reload ---
    const beforeReweight = await getCaseState(page.request, caseId);
    const reweightResponse = await postCommand(page.request, caseId, 'updateCriteria', {
      expectedSequence: beforeReweight['eventSequence'],
      operations: [
        { op: 'reweight', criterionId: HOME_ENERGY_CRITERION_IDS.cost, weight: 20 },
        { op: 'reweight', criterionId: HOME_ENERGY_CRITERION_IDS.conservation, weight: 80 },
      ],
    });
    expect(reweightResponse.ok(), await reweightResponse.text()).toBe(true);

    // The browser -- already open, subscribed via SSE -- reflects this
    // external mutation live: the existing recommendation is invalidated.
    // This is genuinely the same "shared human-agent control" proof
    // car-purchase's own spec makes with `updateCriteria`.
    await expect(page.getByTestId('recommendation-card-status')).toContainText('Stale', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('recommendation-card-stale-note')).toBeVisible();

    // A stable, fully-settled pause point (nothing is in flight -- round 2
    // has not been requested yet) -- see this file's header comment for why
    // this replaces a genuinely racy "mid-round-2" capture.
    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'recommendation-stale.png',
        { testId: 'recommendation-card-status', text: 'Stale' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    // --- Round 2: no visible control can reach this obligation any more (see header comment) ---
    const afterReweight = await getCaseState(page.request, caseId);
    const round2Response = await postRunRequest(page.request, caseId, {
      obligationId: HOME_ENERGY_RESPONSE_OPTIONS_OBLIGATION_ID,
      expectedSequence: afterReweight['eventSequence'],
    });
    expect(round2Response.ok(), await round2Response.text()).toBe(true);
    const round2Body = (await round2Response.json()) as { runId: string };
    expect(round2Body.runId).not.toBe(round1.runId);

    // --- Revised recommendation, reflected live purely from streamed CaseState ---
    await sift.waitForRecommendationRationaleContains('request-hvac-inspection');

    const round2State = await getCaseState(page.request, caseId);
    expect(
      (round2State['recommendation'] as { favoredOptionId: string } | null)?.favoredOptionId,
    ).toBe('request-hvac-inspection');

    // --- Pending proposal, gated by ConsequenceGuard server-side, awaiting human-only approval ---
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
      `option-editor-edit-${HOME_ENERGY_RESPONSE_OPTION_IDS[0]}`,
    ]);
    await sift.closeManageOptionsSheet();

    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'awaiting-approval.png',
        { testId: 'approval-card-pending', text: 'Your approval needed' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    await sift.approveProposal();
    await expect(page.getByTestId('approval-card-settled')).toBeVisible();
    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'decided.png',
        { testId: 'approval-card-stamp', text: 'Approved' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    const finalState = await getCaseState(page.request, caseId);
    expect(finalState['status']).toBe('decided');
    expect((finalState['proposal'] as { status: string } | null)?.status).toBe('approved');
    expect(
      (finalState['recommendation'] as { favoredOptionId: string } | null)?.favoredOptionId,
    ).toBe('request-hvac-inspection');

    guard.assertClean();
  });
});
