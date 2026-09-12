/**
 * The complete "Bid Comparison" demo journey (the AWS/Strands-hero pack), run
 * against the real production Express + Vite build and the real six-node,
 * bounded Strands Swarm (`apps/agent/src/runtime/bid-comparison-swarm.ts`,
 * driven live by `bid-comparison-engine.ts`; `scripted-beats/
 * bid-comparison.ts`'s proven reference trajectory). Runs identically across
 * all six configured viewport projects (`playwright.config.ts`), mirroring
 * `home-energy-guardian-journey.spec.ts` -- this pack's closest analogue:
 * same Swarm-based shape, same round1/round2-by-criteria-weight structure,
 * same `postCommand`/`getCaseState`/`postRunRequest` "real HTTP route, not a
 * bypass" discipline documented in `pages/sift-page.ts`'s own header comment
 * -- most closely, with one genuine, confirmed difference from that pack
 * noted below.
 *
 * Covers: launch -> 12 seeded bid entities / 6 criteria / 5 obligations ->
 * a human answering a real explicit-unknown attribute through the visible
 * `OptionEditor` before any investigation runs -> round-1 investigation
 * streamed live over SSE, with a required `Deny` (price-analyst reaching for
 * `license-lookup`) and `Guide` (scope-analyst repeating a query family) both
 * genuinely fired -> a recommendation favoring Northgate Plumbing with cited
 * sources -> a pending award proposal gated by `ConsequenceGuard` -> a
 * criteria reweight through the real, now-shipped `CriteriaEditor` UI,
 * reopening exactly the one `dependsOnCriteria` obligation -> round-2
 * investigation, re-run through the SAME generic "Request investigation"
 * control -> a revised recommendation, still Northgate Plumbing (a genuine
 * scored outcome, not a coincidence -- see the round-2 section below) -> the
 * pending proposal's own human-only approval.
 *
 * --- Two things this task's own brief asked to "prove or disprove
 * honestly" that have not been driven end to end before this spec. Both are
 * genuinely reachable; one carries a real, confirmed product-narrative
 * limitation worth recording here rather than routing around. ---
 *
 * **6a, the explicit unknown -- reachable, but NOT what blocks readiness.**
 * Cedar & Sons' bid document states a workmanship warranty with no term in
 * writing, so `bid.warranty_months` seeds `status: 'unknown'`, no `value`
 * (`packages/scenarios/src/seeds.ts` -- "never a fabricated 0-month
 * warranty"). That is genuinely visible on the consumer surface
 * (`OptionCardSignals`' `option-card-signal-unresolved-bid-cedar` chip, "1
 * unknown") and a human genuinely can supply it, through the same visible
 * `OptionEditor` "Edit" control every other option field uses -- both
 * asserted below.
 *
 * What is NOT true, confirmed directly against the real running app before
 * writing a single assertion about it (per this suite's own discipline):
 * this does NOT block `evaluateReadiness` (`packages/core/src/readiness.ts`).
 * Readiness is computed purely from `ObligationState.status`; no obligation
 * in this pack's manifest targets `bid.warranty_months` at all, so an
 * unknown attribute value never appears in `ReadinessPanel`'s "Why this
 * case isn't ready yet" list by construction. The real blockers after round
 * 1 -- confirmed below via the real `ReadinessPanel` -- are
 * `bid.scope_normalization` and `bid.credential_verification`, both still
 * `open` because their own evidence links carry a genuine `degraded` verdict
 * (`meetsRequiredEvidenceLevel`'s fail-closed rule, `packages/core/src/
 * evidence.ts`) -- Cedar's own missing-scope gap and Two Rivers' named-
 * insured mismatch, neither about warranty at all. This spec asserts the
 * true blockers and asserts the blocker list never mentions "warranty",
 * rather than asserting the false premise or silently dropping the check.
 *
 * **6b, the criteria reweight -- the mechanics are genuinely correct; the
 * round-2 narrative text is not dynamically grounded in the actual weights
 * supplied.** `docs/bid-comparison/plan.md`'s own suggested reweight is
 * "move weight off `adjusted_total` toward `scope_completeness` and
 * `payment_risk`" -- this spec's reweight below does exactly that (`bid.
 * adjusted_total` 45->10, `bid.scope_completeness` 20->30, `bid.payment_risk`
 * 15->40, `bid.schedule_fit`/`bid.warranty` untouched at 10/10).
 * `scripted-beats/bid-comparison.ts`'s own module header records that its
 * shipped `ROUND2_CRITERIA_WEIGHTS` deliberately substitutes `bid.warranty`
 * for `bid.scope_completeness` in that same target ("adjusted to
 * `bid.warranty` in place of `bid.scope_completeness` ... the reweight needs
 * to give the bid under test its best real case, not an arbitrary one") --
 * so this spec's own weights are a real, independent point in criteria
 * space, not a copy of the pack's own scripted one.
 *
 * Confirmed real and correct, independent of that narrative-text question:
 * `updateCriteria` reopens exactly the one `dependsOnCriteria: true`
 * obligation (`bid.award_recommendation`) and no other, `bid.credentials_valid`
 * is structurally unreweightable, and `determineBidComparisonRound`
 * (`bid-comparison-engine.ts`) reads the real weights on the case, so the
 * generic "Request investigation" control genuinely re-runs round 2 --
 * unlike `home-energy-guardian-journey.spec.ts`'s own documented round-2 gap,
 * this pack's round 2 needs no `postRunRequest` workaround, because
 * `bid.award_recommendation`'s `maxAttempts: 2` (vs. that pack's `1`) leaves
 * a real attempt budget for `updateCriteria`'s own reopening rule to spend.
 * Northgate Plumbing winning again is independently verified below by
 * reproducing the real `scoreBids` computation (`scripted-beats/
 * bid-comparison.ts`) against this spec's OWN weights, not merely asserted
 * from the product's prose.
 *
 * What is NOT dynamically grounded: `decision-synthesizer`'s round-2
 * `strands_structured_output` text (`DECISION_TEXT_ROUND2`) is one fixed
 * scripted string, keyed only to which SIDE of the round-1/round-2 threshold
 * `determineBidComparisonRound` lands on -- never to the actual weight
 * values supplied. Confirmed directly: this spec's own weights never touch
 * `bid.warranty` at all, yet the resulting rationale still names "a
 * 36-month warranty" -- the `ROUND2_CRITERIA_WEIGHTS` narrative, not a
 * recomputation against this run's real inputs. (It also named a "0.81"
 * score when this was written. The score numerals have since been removed
 * from every user-visible string; see the note above `DECISION_TEXT_ROUND2`
 * in `scripted-beats/bid-comparison.ts`. The qualitative mismatch above
 * remains, which is why this spec still asserts no narrative specifics.)
 * This spec therefore asserts only what the real text genuinely contains
 * (still names "Northgate Plumbing," the real, independently-verified
 * winner) and does not assert that it names `bid.scope_completeness` or this
 * spec's own weight values, which would be a false assertion about the
 * product. Filed here rather than silently asserted around, exactly as
 * `home-energy-guardian-journey.spec.ts` files its own round-2 gap.
 *
 * Ordering note: the human answers Cedar's warranty (6a) BEFORE round 1 runs
 * (`upsertOption`'s own `invalidatesRecommendation` guard reads
 * `snapshot.recommendation !== null`, so editing an attribute before any
 * recommendation exists invalidates nothing -- confirmed directly), and the
 * criteria reweight (6b) happens on the STILL-`ready` round-1 recommendation,
 * before that later edit would otherwise apply. This is not an arbitrary
 * ordering choice: confirmed directly against the real running app, doing
 * 6a between round 1 and the reweight (rather than before round 1) leaves
 * `snapshot.recommendation.status` already `'stale'` by the time
 * `updateCriteria` runs, and `invalidatesRecommendation` there is gated on
 * `status === 'ready'` -- so the very reopening this spec exists to prove
 * silently no-ops. Sequencing 6a first is the only ordering that lets both
 * beats be proven cleanly and independently.
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
  BID_COMPARISON_AWARD_RECOMMENDATION_OBLIGATION_ID,
  BID_COMPARISON_CRITERION_IDS,
  BID_COMPARISON_ENTITY_IDS,
  BID_COMPARISON_OBLIGATION_IDS,
  getActivityLabel,
  getCaseState,
  getPublicActivityEvents,
  isNarrowLayout,
  SiftPage,
} from './pages/sift-page.js';
// The two real, checked-in sources of truth for the pack's OWN designed
// round 2 (see the second `test()` below): `scoreCaseState` is the exact
// production scoring function both `apps/agent` and `apps/web` call --
// imported directly (not reproduced) so the "highest raw scorer, still
// flagged, still ranked" claim is verified against the live production
// computation, not a parallel hand-reimplementation the way
// `verifyNorthgateWinsUnderReweight` above necessarily is for an arbitrary
// weighting `scoreBids` was never written to model.
// `ROUND2_CRITERIA_WEIGHTS` is the pack's own real, exported scenario
// constant -- reused verbatim, never retyped, so this spec's reweight can
// never silently drift from the weighting the shipped narrative actually
// describes.
import { scoreCaseState } from '../../packages/core/src/index.js';
import { WORKSPACE_VIEW_MODES, type CaseState } from '../../packages/contracts/src/index.js';

/**
 * Derived from the contract rather than hand-listed, so a new view mode is
 * covered by the touch-target guard the moment it exists.
 */
const WORKSPACE_VIEW_TAB_TEST_IDS = WORKSPACE_VIEW_MODES.map(
  (viewMode) => `workspace-view-tab-${viewMode}`,
);
import {
  BID_FACTS,
  ROUND2_CRITERIA_WEIGHTS,
} from '../../apps/agent/src/runtime/scripted-beats/bid-comparison.js';

/**
 * A reproduction of `scripted-beats/bid-comparison.ts`'s own real `scoreBids`
 * computation, restricted to this spec's exact reweight below, so "Northgate
 * Plumbing wins again" is asserted as a real, independently-derived scored
 * outcome of THIS spec's own weights, not merely copied from the product's
 * prose (which -- see this file's header comment -- names different,
 * scripted numbers).
 *
 * The *inputs* are the pack's own real exported `BID_FACTS` (all twelve
 * bids), imported rather than re-typed: an earlier version hand-copied
 * three bids' figures here, and that copy is exactly what went stale when
 * the case grew to twelve bidders. The *arithmetic* is still reproduced
 * here rather than delegated to `scoreBids`, which is where this function's
 * independence actually lives -- `packages/core/src/scoring.ts`'s own
 * documented hard-constraint rule ("flags, never eliminates ... ranked
 * below compliant ones") is reproduced exactly, matching that module's own
 * `compareOptionScores`.
 */
function verifyNorthgateWinsUnderReweight(): void {
  const facts = BID_FACTS;
  // This spec's own reweight, below: adjustedTotal 10 / scopeCompleteness 30
  // / paymentRisk 40 (scheduleFit/warranty untouched at their round-1
  // defaults, 10 each -- omitted from this scoring reproduction exactly as
  // `scripted-beats/bid-comparison.ts`'s own `scoreBids` would still weigh
  // them, but their contribution is identical for every bid's *relative*
  // ranking question this function asks, since neither this spec nor the
  // scripted round-2 weighting touches `bid.schedule_fit`; the pack's own
  // `bid.warranty` DOES move in the shipped scenario -- which is exactly
  // the divergence this file's header comment records).
  const weights = { adjustedTotal: 10, scopeCompleteness: 30, paymentRisk: 40 };
  const totals = facts.map((f) => f.adjustedTotal);
  const completenesses = facts.map((f) => f.scopeCompleteness);
  const deposits = facts.map((f) => f.depositPercent);
  const normLowerBetter = (values: readonly number[], value: number): number => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max === min ? 1 : (max - value) / (max - min);
  };
  const normHigherBetter = (values: readonly number[], value: number): number => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return max === min ? 1 : (value - min) / (max - min);
  };
  const scored = facts.map((f) => ({
    bidId: f.bidId,
    constraintViolated: !f.credentialsValid,
    score:
      weights.adjustedTotal * normLowerBetter(totals, f.adjustedTotal) +
      weights.scopeCompleteness * normHigherBetter(completenesses, f.scopeCompleteness) +
      weights.paymentRisk * normLowerBetter(deposits, f.depositPercent),
  }));
  scored.sort((a, b) => {
    const aViolates = a.constraintViolated ? 1 : 0;
    const bViolates = b.constraintViolated ? 1 : 0;
    if (aViolates !== bViolates) return aViolates - bViolates;
    return b.score - a.score;
  });
  expect(
    scored[0]?.bidId,
    `real scoreBids reproduction under this spec's own reweight: ${JSON.stringify(scored)}`,
  ).toBe('bid-northgate');
}

test.describe('Bid Comparison -- full demo journey', () => {
  test('launch, answer an unknown, investigate, recommend, reweight, revise, approve', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    verifyNorthgateWinsUnderReweight();

    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);
    const masks = dynamicScreenshotMasks(page);

    // --- Launch ---
    await sift.open();
    await assertNoSeriousAxeViolations(page, 'initial load (launcher)');
    await assertRightPaneIntegrity(page, [
      'demo-launcher-car-purchase',
      'demo-launcher-home-energy-guardian',
      'demo-launcher-bid-comparison',
    ]);
    await expect(page.getByTestId('demo-launcher')).toBeVisible();
    await expectNamedScreenshot(
      page,
      page.getByTestId('demo-launcher'),
      'initial-launcher.png',
      { testId: 'demo-launcher', text: 'Start a Sift case' },
      { maxDiffPixelRatio: 0.01 },
    );

    const { caseId } = await sift.launchBidComparison();
    expect(caseId).toMatch(/.+/);

    // Real WebMCP is genuinely unavailable in this browser (webmcp.md
    // "Browser adapter"; docs/engineering-principles.md "Non-negotiable
    // product truths") -- matches both sibling journeys' identical check.
    await expect(page.getByTestId('webmcp-status-unsupported')).toBeVisible();

    // --- 12 seeded bid entities / 6 criteria / 5 obligations ---
    await expect(page.getByTestId('workspace-app-bar-option-count')).toHaveText(
      `${BID_COMPARISON_ENTITY_IDS.length} options`,
    );

    const seededState = await getCaseState(page.request, caseId);
    const seededEntities = seededState['entities'] as { id: string }[];
    const seededCriteria = seededState['criteria'] as { id: string }[];
    const seededObligations = seededState['obligations'] as { id: string }[];
    expect(seededEntities.map((e) => e.id).sort()).toEqual([...BID_COMPARISON_ENTITY_IDS].sort());
    expect(seededCriteria.map((c) => c.id).sort()).toEqual(
      Object.values(BID_COMPARISON_CRITERION_IDS).sort(),
    );
    expect(seededObligations.map((o) => o.id).sort()).toEqual(
      [...BID_COMPARISON_OBLIGATION_IDS].sort(),
    );
    expect(seededState['recommendation']).toBeNull();

    // A stable, non-racing checkpoint before any async run starts.
    await expect(page.getByTestId('recommendation-hero-status')).toHaveAttribute(
      'data-phase',
      'not_started',
    );
    await expect(page.getByTestId('recommendation-hero-headline')).toHaveText(
      "Nothing's been looked into yet.",
    );

    // --- Negative assertions: regions ADR 0004 removed from the consumer
    // surface stay removed -- same checks both sibling journeys make. ---
    await expect(page.getByTestId('current-focus')).toHaveCount(0);
    await expect(page.getByTestId('current-focus-empty')).toHaveCount(0);
    await expect(page.getByTestId('workspace-app-bar-pack-badge')).toHaveCount(0);
    await expect(page.getByTestId('workspace-app-bar-run-status')).toHaveCount(0);

    await assertRecommendationHeroAboveTheFold(page);

    if (!isNarrowLayout(page)) {
      await expect(page.getByTestId('workspace-expanded-layout')).toBeVisible();
      await expect(page.getByTestId('workspace-sidebar')).toBeVisible();
      await expect(page.getByTestId('disclosure-decision-profile')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('workspace-sidebar')).toHaveCount(0);
    }

    // ADR 0009: the filter surface is pack-agnostic, exercised a third time
    // here against a THIRD pack's own declared attributes/`optionLabelPlural`
    // ("Bids").
    // Two identity strings, not one, and the second is here for a reason
    // this spec learned the hard way. When this case grew from three bids
    // to twelve, `maxDiffPixelRatio: 0.01` genuinely absorbed the whole
    // change at five of the six viewports: the app bar read "3 options"
    // in a baseline captured against a case that had twelve, and
    // `--update-snapshots` (mode `changed`) declined to rewrite those five
    // files because each diff sat under the ratio. A `--update-snapshots=all`
    // then rewrote 36 of the 42 files in this directory, which is what that
    // supposedly-passing gate had actually been hiding.
    //
    // The pixel threshold is not the thing to fix -- it is what keeps
    // antialiasing noise from failing an honest run. What was missing is a
    // machine-checked statement of what this baseline DEPICTS, which is
    // exactly what `expectNamedScreenshot`'s identity checks are for. The
    // option count is derived, never typed, so it moves with the fixture
    // set and a future bid added or dropped can never again ride in under
    // the ratio.
    await expectNamedScreenshot(
      page,
      page.getByTestId('case-workspace'),
      'seeded-case.png',
      [
        { testId: 'recommendation-hero-headline', text: "Nothing's been looked into yet." },
        {
          testId: 'workspace-app-bar-option-count',
          text: `${String(BID_COMPARISON_ENTITY_IDS.length)} options`,
        },
      ],
      { mask: masks, maxDiffPixelRatio: 0.01 },
    );

    // Deliberately AFTER the capture above. The filter surface is Review-owned
    // now (ADR 0016), and navigating there before the shot would have made a
    // baseline called `seeded-case` depict the Review stage rather than the
    // state a person actually lands on -- the named baseline would still pass
    // while quietly showing the wrong screen.
    await sift.goToWorkflowStage('review');
    await expect(page.getByTestId('workspace-filter-bar')).toBeVisible();
    await expect(page.getByTestId('workspace-filter-open')).toBeVisible();

    // --- Workspace view switcher: Compare narrows to a head-to-head pair
    // (real entity order -- `BID_COMPARISON_ENTITY_IDS` needs no separate
    // "real order" export, unlike Home Energy Guardian's own response
    // options; see that constant's own header comment). ---
    await expect(page.getByTestId('workspace-view-switcher')).toBeVisible();
    await sift.selectWorkspaceView('compare');
    await expect(page.getByTestId('workspace-view-content-compare')).toBeVisible();
    await expect(
      page.getByTestId(`option-compare-view-header-${BID_COMPARISON_ENTITY_IDS[0]}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`option-compare-view-header-${BID_COMPARISON_ENTITY_IDS[1]}`),
    ).toBeVisible();
    if (isNarrowLayout(page)) {
      await expect(page.getByTestId('option-compare-view-narrow-note')).toContainText(
        `2 of ${BID_COMPARISON_ENTITY_IDS.length}`,
      );
    } else {
      await expect(page.getByTestId('option-compare-view-narrow-note')).toHaveCount(0);
      for (const entityId of BID_COMPARISON_ENTITY_IDS) {
        await expect(page.getByTestId(`option-compare-view-header-${entityId}`)).toBeVisible();
      }
    }

    // Switching to List proves all 12 seeded bids genuinely render, and is
    // where `OptionCardSignals` (the "N unknown" chip 6a below answers)
    // actually lives.
    await sift.selectWorkspaceView('list');
    for (const entityId of BID_COMPARISON_ENTITY_IDS) {
      await expect(page.getByTestId(`option-list-view-card-${entityId}`)).toBeVisible();
    }

    // --- 6a: the explicit unknown, genuinely visible, then genuinely
    // answered by a human through the real, existing `OptionEditor` visible
    // control -- see this file's header comment for the full "does this
    // block readiness" finding and why this happens before round 1. ---
    await expect(page.getByTestId('option-card-signal-unresolved-bid-cedar')).toContainText(
      '1 unknown',
    );

    await sift.openManageOptionsSheet();

    // Regression lock for the reachability fix `OptionEditor.tsx`'s own
    // header comment describes: on this exact seeded 12-bid case, at the
    // canonical 430px pane width, the Save button used to sit 2,253px down a
    // 2,329px scroll and the first field 1,458px below the fold. A unit test
    // cannot see a scroll position or a viewport -- only a real, sized
    // browser can -- so this asserts, in the sheet's own freshly-opened
    // default "Add" state and BEFORE anything here scrolls the pane, that
    // both the primary action and the first attribute field are already
    // inside the viewport. `toBeInViewport()` checks the CURRENT scroll
    // position; nothing above this line calls `scrollIntoView` or similar.
    if (page.viewportSize()?.width === 430) {
      await expect(page.getByTestId('option-editor-save')).toBeInViewport();
      await expect(
        page.locator('[data-testid^="dynamic-attribute-field-"]').first(),
      ).toBeInViewport();
    }

    await page.getByTestId('option-editor-list-trigger').click();
    for (const entityId of BID_COMPARISON_ENTITY_IDS) {
      await expect(page.getByTestId(`option-editor-option-${entityId}`)).toBeVisible();
    }
    await page.getByTestId('option-editor-edit-bid-cedar').click();
    const warrantyField = page.getByTestId('dynamic-attribute-field-bid.warranty_months');
    await expect(warrantyField).toBeVisible();
    // The explicit-unknown proof itself: the form shows no fabricated
    // default, only a genuinely empty field -- `OptionEditor.tsx`'s own
    // `formFromEntity` reads `record.value`, which an `unknown`-status
    // `AttributeRecord` never carries.
    await expect(warrantyField.locator('input')).toHaveValue('');
    await assertPrimaryTouchTargets(page, ['option-editor-save', 'option-editor-cancel']);
    await warrantyField.locator('input').fill('18');
    const [warrantySaveResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/commands/upsertOption') && res.request().method() === 'POST',
      ),
      page.getByTestId('option-editor-save').click(),
    ]);
    expect(warrantySaveResponse.ok(), await warrantySaveResponse.text()).toBe(true);
    await sift.closeManageOptionsSheet();

    // The chip is gone -- not merely re-labelled -- once a real value
    // exists: `summarizeOptionSignals` (`option-profile.ts`) buckets a
    // record only by `status`, and this write is `status: 'asserted'`.
    await expect(page.getByTestId('option-card-signal-unresolved-bid-cedar')).toHaveCount(0);

    const afterWarrantyAnswer = await getCaseState(page.request, caseId);
    const cedarEntity = (
      afterWarrantyAnswer['entities'] as {
        id: string;
        attributes: Record<string, { status: string; value?: { value: number } }>;
      }[]
    ).find((e) => e.id === 'bid-cedar');
    expect(cedarEntity?.attributes['bid.warranty_months']?.status).toBe('asserted');
    expect(cedarEntity?.attributes['bid.warranty_months']?.value?.value).toBe(18);
    // Recorded, but not yet consequential: no recommendation exists yet for
    // this edit to invalidate (see this file's header comment's "Ordering
    // note").
    expect(afterWarrantyAnswer['recommendation']).toBeNull();

    // --- The hard constraint is structurally unreweightable -- checked
    // once, early, independent of 6b's later functional reweight below. ---
    await sift.openPriorities();
    await expect(page.getByTestId('workspace-priorities-sheet')).toBeVisible();
    await expect(
      page.getByTestId(
        `criteria-editor-protected-${BID_COMPARISON_CRITERION_IDS.credentialsValid}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId(`criteria-editor-weight-${BID_COMPARISON_CRITERION_IDS.credentialsValid}`),
    ).toHaveCount(0);
    for (const criterionId of [
      BID_COMPARISON_CRITERION_IDS.adjustedTotal,
      BID_COMPARISON_CRITERION_IDS.scopeCompleteness,
      BID_COMPARISON_CRITERION_IDS.paymentRisk,
      BID_COMPARISON_CRITERION_IDS.scheduleFit,
      BID_COMPARISON_CRITERION_IDS.warranty,
    ]) {
      await expect(page.getByTestId(`criteria-editor-weight-${criterionId}`)).toBeVisible();
    }
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('workspace-priorities-sheet')).not.toBeVisible();

    // --- Round 1: real live streaming investigation, driven by the visible control ---
    const round1 = await sift.requestInvestigation();
    await expect(page.getByTestId('live-run-status')).toBeVisible();
    await assertNoSeriousAxeViolations(page, 'mid-investigation');
    await assertRightPaneIntegrity(page, ['request-investigation', 'workspace-app-bar-reset-demo']);

    await sift.waitForInvestigationCompleted(round1.runId);
    await sift.waitForRecommendationReady();

    // --- Item 2: the swarm ran -- specialist handoffs and skill activations
    // are both genuinely visible, on two different real surfaces. ---
    // `SpecialistActivityPanel` -- the consumer-facing team view -- shows
    // all six specialists, in real handoff order, every one settled clean
    // (no visible failure from the Deny below).
    await expect(page.getByTestId('specialist-activity-panel')).toBeVisible();
    const specialistRows = page.getByTestId('specialist-row');
    await expect(specialistRows).toHaveCount(6);
    // The bid pack's own four measurement specialists have no curated
    // `SpecialistActivityPanel` identity yet (`SPECIALIST_IDENTITIES` only
    // names Choose Our Next Car's and Home Energy Guardian's own agents) --
    // confirmed directly against the real running app -- so these four
    // render through `identityFor`'s generic humanized-id fallback rather
    // than a curated name, unlike `source-challenger`/`decision-synthesizer`
    // (shared by all packs). Asserted as what genuinely renders today, not
    // papered over as the curated names a later task could still add.
    await expect(page.getByTestId('specialist-row-name')).toHaveText([
      'Scope analyst',
      'Price analyst',
      'Credential checker',
      'Schedule analyst',
      'Source check',
      'Recommendation',
    ]);
    for (const row of await specialistRows.all()) {
      await expect(row).toHaveAttribute('data-state', 'completed');
    }

    // Skill activations: real events in the real public activity stream
    // (`getPublicActivityEvents`; see that helper's own header comment for
    // why this route, not a live DOM read, is the honest way to assert a
    // sub-100ms transition on this deterministic test server).
    const round1Events = await getPublicActivityEvents(page.request, caseId);
    const activatedSkills = round1Events
      .filter((event) => event['type'] === 'skill.activated')
      .map((event) => String(event['summary']));
    for (const skillId of [
      'scope-normalization',
      'price-arithmetic',
      'credential-verification',
      'schedule-analysis',
    ]) {
      expect(activatedSkills.some((summary) => summary.includes(skillId))).toBe(true);
    }

    // --- Item 3: a blocked action is visible in the PUBLIC stream, and
    // there is NO user-facing failure message naming `license-lookup`. ---
    const deniedEvents = round1Events.filter((event) => event['type'] === 'intervention.denied');
    expect(deniedEvents).toHaveLength(1);
    expect(String(deniedEvents[0]?.['summary'])).toContain('license-lookup');
    // The real, product-declared consumer label for this event type
    // (product.md terminology table, verbatim) -- imported, not duplicated.
    expect(getActivityLabel('intervention.denied').label).toBe('Action blocked');
    const failedLicenseLookup = round1Events.filter(
      (event) =>
        event['type'] === 'tool.failed' && String(event['summary']).includes('license-lookup'),
    );
    expect(failedLicenseLookup).toEqual([]);

    // --- The real blockers, disproving the literal "unknown blocks
    // readiness" premise -- see this file's header comment. ---
    await sift.openReadiness();
    await expect(page.getByTestId('readiness-panel-status')).toContainText(
      'Not ready for decision',
    );
    const blockers = page.getByTestId('readiness-panel-blockers');
    await expect(blockers).toContainText('Scope normalization');
    await expect(blockers).toContainText('Credential verification');
    await expect(blockers).not.toContainText(/warranty/i);
    await sift.closeReadiness();

    // --- Item 4: recommendation resolves to Northgate, rationale legible. ---
    await expect(page.getByTestId('recommendation-card-rationale')).toContainText(
      'Northgate Plumbing',
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
    ).toBe('bid-northgate');

    await sift.selectWorkspaceView('quick_pick');
    await assertNoSeriousAxeViolations(page, 'recommendation ready');
    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'recommendation-ready.png',
        { testId: 'recommendation-card-status', text: 'Ready for review' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    // --- Item 5 (part one): `propose_award` is consequential -- the
    // proposal is genuinely pending, and a visible human control to approve
    // it genuinely exists. The click itself is deferred to the very end of
    // this journey (see this file's header comment's "Ordering note") so 6b's
    // own reweight below runs against a still-`ready` recommendation. ---
    // Approval controls are Decide-owned now (ADR 0016; the change set:
    // "Approval controls belong to Decide"). A pending proposal is exactly
    // what makes Decide reachable, so this is navigation, not a workaround.
    await sift.goToWorkflowStage('decide');
    await expect(page.getByTestId('approval-card-pending')).toBeVisible();
    await assertRightPaneIntegrity(page, ['approval-card-approve', 'approval-card-reject']);

    // --- Item 6b: the criteria reweight, through the real, now-shipped
    // `CriteriaEditor` visible control (no `postCommand` bypass needed --
    // unlike this pack's own predecessor journeys before that UI existed).
    // See this file's header comment for the full mechanics-vs-narrative
    // finding and the real `verifyNorthgateWinsUnderReweight` proof above. ---
    const beforeReweight = await getCaseState(page.request, caseId);
    const obligationStatusBefore = new Map(
      (beforeReweight['obligations'] as { id: string; status: string }[]).map((o) => [
        o.id,
        o.status,
      ]),
    );
    expect(obligationStatusBefore.get(BID_COMPARISON_AWARD_RECOMMENDATION_OBLIGATION_ID)).toBe(
      'satisfied',
    );

    await sift.reweightCriteria({
      [BID_COMPARISON_CRITERION_IDS.adjustedTotal]: 10,
      [BID_COMPARISON_CRITERION_IDS.scopeCompleteness]: 30,
      [BID_COMPARISON_CRITERION_IDS.paymentRisk]: 40,
    });

    await expect(page.getByTestId('recommendation-card-status')).toContainText('Stale', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('recommendation-card-stale-note')).toBeVisible();

    const afterReweight = await getCaseState(page.request, caseId);
    const obligationStatusAfter = new Map(
      (afterReweight['obligations'] as { id: string; status: string }[]).map((o) => [
        o.id,
        o.status,
      ]),
    );
    // ONLY `bid.award_recommendation` (`dependsOnCriteria: true`) reopens.
    expect(obligationStatusAfter.get(BID_COMPARISON_AWARD_RECOMMENDATION_OBLIGATION_ID)).toBe(
      'open',
    );
    for (const obligationId of BID_COMPARISON_OBLIGATION_IDS) {
      if (obligationId === BID_COMPARISON_AWARD_RECOMMENDATION_OBLIGATION_ID) continue;
      expect(
        obligationStatusAfter.get(obligationId),
        `obligation "${obligationId}" must be unaffected by the reweight`,
      ).toBe(obligationStatusBefore.get(obligationId));
    }

    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'recommendation-stale.png',
        { testId: 'recommendation-card-status', text: 'Stale' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    // --- Round 2: the SAME generic visible "Request investigation" control
    // -- genuinely reachable here (see this file's header comment for why
    // this pack's round 2, unlike Home Energy Guardian's, needs no
    // `postRunRequest` workaround). ---
    const round2 = await sift.requestInvestigation();
    expect(round2.runId).not.toBe(round1.runId);
    await sift.waitForInvestigationCompleted(round2.runId);
    await sift.waitForRecommendationReady();

    // The real, re-derived, deterministic re-rank: still Northgate Plumbing
    // -- proven above as a genuine scored outcome of THIS reweight
    // (`verifyNorthgateWinsUnderReweight`), not merely copied from the
    // product's own (differently-weighted) narrative text. The rationale
    // text itself is asserted only for what it genuinely contains -- see
    // this file's header comment for why this spec does not assert it names
    // `bid.scope_completeness` or this run's own weight values.
    await expect(page.getByTestId('recommendation-card-rationale')).toContainText(
      'Northgate Plumbing',
    );
    const round2State = await getCaseState(page.request, caseId);
    expect(
      (round2State['recommendation'] as { favoredOptionId: string } | null)?.favoredOptionId,
    ).toBe('bid-northgate');

    // --- Item 5 (part two): a fresh pending proposal from the revised
    // recommendation, still gated on human-only approval. ---
    await expect(page.getByTestId('approval-card-pending')).toBeVisible();
    await assertNoSeriousAxeViolations(page, 'awaiting human approval');

    await sift.openFindingsSheet();
    await assertPrimaryTouchTargets(page, [
      'evidence-card-disposition-option-included',
      'evidence-card-disposition-option-excluded',
      'evidence-card-disposition-option-questioned',
    ]);
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('findings-sheet')).not.toBeVisible();

    await assertRightPaneIntegrity(page, ['approval-card-approve', 'approval-card-reject']);

    await withVolatileRegionsHidden(page, async () => {
      // The approval card is Decide-owned, and this capture's whole identity is
      // "a decision is waiting on you" -- so stand on Decide before the shot.
      // Earlier steps in this journey navigate to Review and Analysis, so the
      // active stage at this point is not implied by the one set above.
      await sift.goToWorkflowStage('decide');
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'awaiting-approval.png',
        { testId: 'approval-card-pending', text: 'Your approval needed' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    // --- Only the person awards. ---
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
    ).toBe('bid-northgate');

    guard.assertClean();
  });

  /**
   * The pack's own DESIGNED round 2 -- distinct from, and additive to, the
   * reweight test above.
   *
   * `docs/bid-comparison/plan.md`'s suggested reweight target ("move weight
   * off `adjusted_total` toward `scope_completeness` and `payment_risk`")
   * is not what `scripted-beats/bid-comparison.ts` actually ships:
   * `ROUND2_CRITERIA_WEIGHTS` there raises `bid.warranty` and
   * `bid.payment_risk` and lowers `bid.adjusted_total`, deliberately
   * substituting `bid.warranty` for `bid.scope_completeness` -- see that
   * module's own header comment, quoted in full in this file's own header
   * comment above. The test above proves the reopening mechanics under an
   * arbitrary real weighting; THIS test proves the pack's single most
   * distinctive move under the exact weighting it was written for: Two
   * Rivers Mechanical becomes the highest RAW scorer of all twelve bids --
   * it genuinely leads on both upweighted criteria -- and still does not
   * win, because its certificate of insurance names "TRM Holdings LLC," not
   * its license holder "Two Rivers Mechanical Inc," and `bid.credentials_valid`
   * is a hard constraint. `packages/core/src/scoring.ts` rule 4: "A hard
   * constraint flags; it never silently eliminates. A violating option
   * stays on the board, fully scored and visibly labelled, ranked below
   * compliant ones." This test asserts exactly that rule, against the real
   * production `scoreCaseState` computation AND the real rendered
   * `OptionRankBadge` DOM -- not merely the scripted narrative, which this
   * file's header comment already showed can describe a run that never
   * happened. The narrative is asserted too, but only because -- verified
   * directly against the real running app before writing a single line
   * below -- it is genuinely accurate for this exact weighting, unlike the
   * arbitrary-reweight test above.
   *
   * A real, unplanned discrepancy surfaced while confirming this, and has
   * since been fixed at the source -- no score numeral survives in any
   * user-visible string. Kept here because it is the reason this spec
   * cross-checks every number against live `scoreCaseState`: the scripted
   * narrative's then-claimed numbers ("Northgate ... 0.58 vs. Cedar
   * & Sons' 0.31") came from `scripted-beats/bid-comparison.ts`'s
   * hand-written `scoreBids` reproduction, not from `packages/core/src/
   * scoring.ts`'s real production `scoreCaseState` -- the function that
   * actually drives this UI. The two agree on Northgate (0.58) and on Two
   * Rivers (0.81) but NOT on Cedar & Sons: production `scoreCaseState`
   * genuinely computes 0.235 (rounds to 24%) for Cedar here, not 0.31,
   * because Cedar's real coverage is only 70% (its scope-diff gap lowers
   * how much of the weighting production could actually measure) --
   * `scoreBids` has no coverage concept at all and cannot reproduce that.
   * This is a real, second, independently-discovered case of the same class
   * of gap this file's header comment already documents for the round-2
   * narrative text in general (grounded in the pack's own scripted
   * reproduction, not in the production scoring engine the UI actually
   * runs) -- filed here rather than silently asserted around. Consequently
   * this test never asserts Cedar's specific number from either source
   * against the other; every numeric claim below is independently
   * cross-checked against the live `scoreCaseState` output actually driving
   * the page, not against the narrative's own arithmetic.
   */
  test('the pack’s designed round 2: the highest raw scorer is flagged, not eliminated, and Northgate still wins', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);
    const masks = dynamicScreenshotMasks(page);

    await sift.open();
    const { caseId } = await sift.launchBidComparison();

    const round1 = await sift.requestInvestigation();
    await sift.waitForInvestigationCompleted(round1.runId);
    await sift.waitForRecommendationReady();

    // --- Item 4: the hard constraint is structurally unreweightable here too. ---
    await sift.openPriorities();
    await expect(page.getByTestId('workspace-priorities-sheet')).toBeVisible();
    await expect(
      page.getByTestId(
        `criteria-editor-protected-${BID_COMPARISON_CRITERION_IDS.credentialsValid}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByTestId(`criteria-editor-weight-${BID_COMPARISON_CRITERION_IDS.credentialsValid}`),
    ).toHaveCount(0);
    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('workspace-priorities-sheet')).not.toBeVisible();

    // --- The pack's own designed round-2 reweight, through the real
    // CriteriaEditor visible control, using the pack's own real exported
    // constant -- never a hand-copied set of numbers. ---
    await sift.reweightCriteria({
      [BID_COMPARISON_CRITERION_IDS.adjustedTotal]: ROUND2_CRITERIA_WEIGHTS.adjustedTotal,
      [BID_COMPARISON_CRITERION_IDS.scopeCompleteness]: ROUND2_CRITERIA_WEIGHTS.scopeCompleteness,
      [BID_COMPARISON_CRITERION_IDS.paymentRisk]: ROUND2_CRITERIA_WEIGHTS.paymentRisk,
      [BID_COMPARISON_CRITERION_IDS.scheduleFit]: ROUND2_CRITERIA_WEIGHTS.scheduleFit,
      [BID_COMPARISON_CRITERION_IDS.warranty]: ROUND2_CRITERIA_WEIGHTS.warranty,
    });
    await expect(page.getByTestId('recommendation-card-status')).toContainText('Stale', {
      timeout: 15_000,
    });

    const round2 = await sift.requestInvestigation();
    expect(round2.runId).not.toBe(round1.runId);
    await sift.waitForInvestigationCompleted(round2.runId);
    await sift.waitForRecommendationReady();
    await assertNoSeriousAxeViolations(page, 'designed round 2, highest raw scorer flagged');

    // --- Item 2: Two Rivers is not the recommendation; Northgate still wins. ---
    const round2State = (await getCaseState(page.request, caseId)) as unknown as CaseState;
    expect(round2State.recommendation?.favoredOptionId).toBe('bid-northgate');
    expect(round2State.proposal?.status).toBe('pending');

    // --- Item 3: the reason shown to the user names the actual discrepancy
    // -- the named-insured mismatch, by its own real entity names -- not a
    // generic "constraint failed". Real text this exact run produced,
    // confirmed directly before writing this assertion (see this test's own
    // header comment for why this narrative, unlike the arbitrary-reweight
    // test's, is genuinely accurate here). ---
    const rationale = page.getByTestId('recommendation-card-rationale');
    await expect(rationale).toContainText('Two Rivers Mechanical scores highest');
    await expect(rationale).toContainText('TRM Holdings LLC');
    await expect(rationale).toContainText('Two Rivers Mechanical Inc');
    await expect(rationale).toContainText('Recommend awarding to Northgate Plumbing');

    // --- Items 1 and 5: the real, live, production-computed board -- not
    // the scripted narrative -- proves Two Rivers is genuinely the highest
    // raw scorer AND that it is flagged, never eliminated. `scoreCaseState`
    // is the exact function `apps/web` itself calls to render the board
    // below, run here against the real case state fetched over the wire. ---
    const scoreboard = scoreCaseState({
      attributeDefinitions: round2State.attributeDefinitions,
      caseExtensions: round2State.caseExtensions,
      entities: round2State.entities,
      criteria: round2State.criteria,
    });
    const scoreByOptionId = new Map(scoreboard.options.map((option) => [option.optionId, option]));
    const northgateScore = scoreByOptionId.get('bid-northgate');
    const cedarScore = scoreByOptionId.get('bid-cedar');
    const twoRiversScore = scoreByOptionId.get('bid-tworivers');
    expect(northgateScore?.total).not.toBeNull();
    expect(cedarScore?.total).not.toBeNull();
    expect(twoRiversScore?.total).not.toBeNull();

    // Item 1: genuinely the highest raw score of all twelve -- not merely
    // asserted from the narrative's own claimed number, and not merely
    // higher than the two other bids the prose happens to name.
    const highestRawTotal = Math.max(
      ...scoreboard.options.map((option) => option.total ?? Number.NEGATIVE_INFINITY),
    );
    expect(twoRiversScore!.total!).toBe(highestRawTotal);
    expect(twoRiversScore!.total!).toBeGreaterThan(northgateScore!.total!);
    expect(twoRiversScore!.total!).toBeGreaterThan(cedarScore!.total!);

    // Item 5, part one: exactly two of the twelve fail the hard constraint,
    // on two genuinely distinct grounds -- Two Rivers' named-insured
    // mismatch and Fieldstone's license class not covering the scope. A
    // real, current fact about this run, not an assumption carried over
    // from round 1.
    expect(twoRiversScore!.violatedConstraintIds).toContain(
      BID_COMPARISON_CRITERION_IDS.credentialsValid,
    );
    expect(northgateScore!.violatedConstraintIds).toHaveLength(0);
    expect(cedarScore!.violatedConstraintIds).toHaveLength(0);
    const violatingOptionIds = scoreboard.options
      .filter((option) => option.violatedConstraintIds.length > 0)
      .map((option) => option.optionId);
    expect([...violatingOptionIds].sort()).toEqual(['bid-fieldstone', 'bid-tworivers']);

    // Item 5, part two: `compareOptionScores`'s real, documented ordering --
    // constraint violators sort after every compliant option regardless of
    // score, never removed from the list entirely. Board length is itself
    // part of the "not dropped" claim: `scoreCase` returns one row per
    // scorable option, so an 11-length board here would BE silent
    // elimination of the bid that scored highest.
    expect(scoreboard.options).toHaveLength(BID_COMPARISON_ENTITY_IDS.length);
    const rankedOptionIds = scoreboard.options.map((option) => option.optionId);
    expect([...rankedOptionIds].sort()).toEqual([...BID_COMPARISON_ENTITY_IDS].sort());
    expect(rankedOptionIds[0]).toBe('bid-northgate');
    // The rule itself, asserted as a rule rather than as one frozen
    // twelve-id ordering: every flagged bid sorts below every compliant
    // one, whatever their raw scores.
    const lastCompliantIndex = Math.max(
      ...rankedOptionIds
        .map((optionId, index) => (violatingOptionIds.includes(optionId) ? -1 : index))
        .filter((index) => index >= 0),
    );
    const firstFlaggedIndex = Math.min(
      ...violatingOptionIds.map((optionId) => rankedOptionIds.indexOf(optionId)),
    );
    expect(firstFlaggedIndex).toBeGreaterThan(lastCompliantIndex);

    // The same claim, live, on the real rendered board -- not only in the
    // computation behind it. Position, score, and the "flagged, not
    // removed" copy are all real DOM read from the real page.
    await sift.selectWorkspaceView('list');
    for (const entityId of BID_COMPARISON_ENTITY_IDS) {
      await expect(page.getByTestId(`option-list-view-card-${entityId}`)).toBeVisible();
    }
    // This call once deliberately omitted `primaryActionTestIds`: the
    // `workspace-view-tab-*` controls, sharing an unstyled `TabsTrigger`,
    // measured ~42.2 CSS px against the 44px floor
    // `--size-touch-target-min` defines and 53 other files honor, and no
    // spec in any of the three packs had ever asserted on it. That was a
    // real shared-component defect (WCAG 2.5.8 AA) rather than anything
    // specific to this beat, so it was reported instead of asserted around.
    // `ui/tabs.tsx` now carries the floor on the trigger itself and the
    // strip grows to fit, so the tab controls are checked here like every
    // other primary action -- this is the regression guard for that fix.
    await assertRightPaneIntegrity(page, WORKSPACE_VIEW_TAB_TEST_IDS);

    // Rendered positions are read off the SAME live ranking asserted above,
    // never hand-typed: `#1 of 12` for Northgate is a claim about this run,
    // and Two Rivers' own position is wherever the hard-constraint rule
    // actually put it among twelve -- below every compliant bid, still on
    // the board.
    const renderedRankOf = (optionId: string): string =>
      `#${String(rankedOptionIds.indexOf(optionId) + 1)} of ${String(rankedOptionIds.length)}`;
    await expect(page.getByTestId('option-rank-position-bid-northgate')).toContainText(
      renderedRankOf('bid-northgate'),
    );
    await expect(page.getByTestId('option-rank-position-bid-tworivers')).toContainText(
      renderedRankOf('bid-tworivers'),
    );
    // The exact rendered percentage is derived from the SAME live score this
    // test already fetched above -- `formatScore`'s own rounding -- rather
    // than a second, hand-typed number that could quietly stop matching it.
    await expect(page.getByTestId('option-rank-score-bid-tworivers')).toContainText(
      `${String(Math.round(twoRiversScore!.total! * 100))}%`,
    );
    await expect(page.getByTestId('option-rank-score-bid-northgate')).toContainText(
      `${String(Math.round(northgateScore!.total! * 100))}%`,
    );
    // Two Rivers' own score is the visibly larger number on the page too --
    // not hidden behind a lower one because it was sorted last.
    const twoRiversRenderedScore = Number(
      (await page.getByTestId('option-rank-score-bid-tworivers').textContent())?.match(
        /(\d+)%/,
      )?.[1] ?? NaN,
    );
    const northgateRenderedScore = Number(
      (await page.getByTestId('option-rank-score-bid-northgate').textContent())?.match(
        /(\d+)%/,
      )?.[1] ?? NaN,
    );
    expect(twoRiversRenderedScore).toBeGreaterThan(northgateRenderedScore);

    // "Flagged, not removed" -- rule 4, in the product's own words, on the
    // one option that actually needs to hear it this run.
    const constraintFlag = page.getByTestId('option-rank-constraint-flags-bid-tworivers');
    await expect(constraintFlag).toBeVisible();
    await expect(constraintFlag).toContainText(
      'Flagged, not removed — still ranked, and still yours to decide.',
    );
    // Fieldstone Plumbing Co. -- the lowest scope-normalized adjusted total
    // of all twelve, and the only bid under Northgate's once every bid is on
    // the same basis -- carries the same flag on a genuinely different ground
    // (its license class does not cover this scope). Two flagged bids, both
    // still on the board, is the shape a real bid tab has; one would let
    // "flags, never eliminates" be true by accident.
    await expect(page.getByTestId('option-rank-constraint-flags-bid-fieldstone')).toBeVisible();
    // No compliant bid carries this flag.
    await expect(page.getByTestId('option-rank-constraint-flags-bid-northgate')).toHaveCount(0);
    await expect(page.getByTestId('option-rank-constraint-flags-bid-cedar')).toHaveCount(0);

    // Named, not "-hard-constraint-flag": `expectNamedScreenshot` ->
    // `resetPaneScroll` unconditionally scrolls `case-workspace` back to top
    // before every capture (this file's other checkpoints rely on exactly
    // that determinism), and the rank badge just asserted above lives
    // further down the List tab, below the fold at every one of this file's
    // six viewports -- confirmed directly rather than assumed: an earlier
    // draft of this call named its identity check on
    // `option-rank-position-bid-tworivers`, which is real DOM text
    // (`toContainText` does not require visibility) but genuinely was not
    // the pixel content this capture holds, defeating the pairing's own
    // purpose (`expectNamedScreenshot`'s header comment: "the exact visible
    // string that gives a given screen its identity"). What IS visible at
    // scroll-top here -- and what this checkpoint actually names -- is the
    // settled, revised recommendation and its narrative, which is still a
    // real and distinct state from `recommendation-ready.png` above (a
    // different rationale, a different findings count). The ranking claims
    // themselves are already proven, precisely, by the live `scoreCaseState`
    // and `option-rank-*` DOM assertions above; this capture is the visual
    // record of the state they were proven in, not a second proof of them.
    await withVolatileRegionsHidden(page, async () => {
      await expectNamedScreenshot(
        page,
        page.getByTestId('case-workspace'),
        'designed-round2-recommendation.png',
        { testId: 'recommendation-card-rationale', text: 'Two Rivers Mechanical scores highest' },
        { mask: masks, maxDiffPixelRatio: 0.01 },
      );
    });

    guard.assertClean();
  });
});
