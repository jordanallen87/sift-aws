/**
 * The normal, non-demo "Compare vehicles" journey
 * (docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md; spec
 * brief §22 "Playwright"): a real user browses the bundled, offline vehicle
 * catalog, builds a shortlist, creates a real persisted `car-purchase` case
 * from it, adds listing-specific facts to a candidate, changes a criterion,
 * adds a custom concern, and confirms the case survives a reload -- all
 * through the same real Express + Vite production build and real HTTP
 * routes the deterministic demo journeys already run against, and all
 * fully deterministic: every vehicle search result comes from the static,
 * checked-in catalog file, never live/random data.
 *
 * Deliberately does NOT call `requestInvestigation` -- ADR 0003 §4 (also
 * covered directly at the unit/integration level in
 * `car-purchase-engine.test.ts` and `catalog-case-integration.test.ts`):
 * guided investigation only runs against the deterministic demo case, so a
 * catalog-built case's own hero moment here is everything *around*
 * investigation (browse, shortlist, compare, enrich, criteria, concerns,
 * persistence), matching what the product actually offers today.
 */
import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import {
  assertExpandedLayoutUsesWidth,
  assertRecommendationHeroAboveTheFold,
  assertRightPaneIntegrity,
  disableAnimations,
  expectNamedScreenshot,
} from './helpers/layout-assertions.js';
import { CAR_PURCHASE_CRITERION_IDS, getCaseState, SiftPage } from './pages/sift-page.js';

test.describe('Compare vehicles -- normal, non-demo catalog journey', () => {
  test('browse, shortlist, create case, enrich a candidate, reweight criteria, add a concern, reload', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    // --- Launcher -> catalog ---
    await sift.open();
    await assertNoSeriousAxeViolations(page, 'initial load (launcher)');

    await sift.openVehicleCatalog();
    // Waits for the initial, unfiltered search to fully settle (a real,
    // debounced network fetch -- never a fixed sleep) before asserting or
    // screenshotting, so this state is never captured mid-"Searching…".
    await expect(page.getByTestId('vehicle-catalog-results-list')).toBeVisible();
    await assertNoSeriousAxeViolations(page, 'vehicle catalog (initial browse)');
    await assertRightPaneIntegrity(page, [
      'vehicle-catalog-start-comparison',
      'vehicle-catalog-back',
    ]);
    // No-op at 390/430/480; at desktop this is what stops the browse screen
    // silently regressing to the narrow pane centred in dead space (ADR 0007).
    await assertExpandedLayoutUsesWidth(page, 'vehicle-catalog-flow');
    await expectNamedScreenshot(
      page,
      page.getByTestId('vehicle-catalog-flow'),
      'vehicle-catalog-initial.png',
      { testId: 'vehicle-catalog-flow', text: 'Compare vehicles' },
      { maxDiffPixelRatio: 0.01 },
    );

    // --- Search and shortlist real, deterministic catalog vehicles ---
    // Each search waits for the results list to actually reflect the typed
    // query (real debounced network state, matched by visible text) before
    // grabbing "the first card" -- otherwise a fast click can land on the
    // still-rendered *previous* (unfiltered) result set.
    const resultsList = page.getByTestId('vehicle-catalog-results-list');

    await page.getByLabel('Search', { exact: true }).fill('Camry');
    await expect(resultsList.locator('li').first()).toContainText('Camry');
    await resultsList.locator('li').first().getByRole('button', { name: /add/i }).click();
    await expect(page.getByTestId('shortlist-count')).toContainText('1 of');

    await page.getByLabel('Search', { exact: true }).fill('Corolla');
    await expect(resultsList.locator('li').first()).toContainText('Corolla');
    await resultsList.locator('li').first().getByRole('button', { name: /add/i }).click();
    await expect(page.getByTestId('shortlist-count')).toContainText('2 of');

    // The bar summarises the shortlist in one row; its entries live in the
    // panel, so open it before asserting on them.
    await sift.expandShortlist();
    await expect(page.getByTestId('vehicle-catalog-shortlist-list').locator('li')).toHaveCount(2);

    // --- Create the real, persisted case from the shortlist ---
    const { caseId } = await sift.startVehicleComparison();
    expect(caseId).toMatch(/.+/);

    const afterCreate = await getCaseState(request, caseId);
    expect(afterCreate['entities']).toHaveLength(2);
    // A catalog-built case is never seeded with the deterministic demo's
    // literal fixture ids.
    const entities = afterCreate['entities'] as { id: string; label: string }[];
    for (const entity of entities) {
      expect(entity.id).not.toMatch(/^candidate-/);
    }
    expect(afterCreate['recommendation']).toBeNull();

    // `RecommendationHero` (ADR 0004 item 1) mounts unconditionally, so this
    // real, non-demo case creation flow reaches the same above-the-fold
    // invariant `docs/decisions/0004-consumer-workspace-information-
    // architecture.md` decision item 6 requires for the two hero demo
    // journeys.
    await assertRecommendationHeroAboveTheFold(page);

    // --- See those exact vehicles in the "Add option" Sheet (ADR 0008;
    // supersedes "Manage options"/"Compare the options" -- `OptionEditor`
    // now lives in a modal Sheet reached from the app bar, in both
    // layouts, rather than an inline disclosure) ---
    await sift.openManageOptionsSheet();
    // The roster is now a collapsed `<Collapsible>` (`OptionEditor.tsx`) --
    // opening it is what puts `option-editor-list`/`option-editor-edit-*` in
    // the DOM.
    await page.getByTestId('option-editor-list-trigger').click();
    for (const entity of entities) {
      await expect(page.getByTestId('option-editor-list')).toContainText(entity.label);
    }
    await assertNoSeriousAxeViolations(page, 'case workspace, add-option sheet open');

    // --- Add listing-specific information to one candidate (the existing
    // OptionEditor -- spec brief §11) ---
    const firstEntity = entities[0]!;
    await page.getByTestId(`option-editor-edit-${firstEntity.id}`).click();
    const priceField = page.getByTestId('dynamic-attribute-field-car.advertised_price');
    await expect(priceField).toBeVisible();
    await priceField.getByLabel(/amount/i).fill('28500');
    await page.getByLabel('Mileage').fill('12');
    await page.getByTestId('option-editor-save').click();
    await expect(page.getByTestId('option-editor-form')).not.toContainText('Saving');
    // Closed before the criteria reweight/custom-concern steps below: the
    // Sheet is a real modal (ADR 0008) and would otherwise intercept the
    // custom concern region's own trigger control.
    await sift.closeManageOptionsSheet();

    await expect
      .poll(async () => {
        const state = await getCaseState(request, caseId);
        const updated = (state['entities'] as { id: string; attributes: unknown }[]).find(
          (e) => e.id === firstEntity.id,
        );
        const attributes = updated?.attributes as
          Record<string, { value?: { amount?: number } }> | undefined;
        return attributes?.['car.advertised_price']?.value?.amount;
      })
      .toBe(28500);

    // --- Change a criterion, through the control a person actually uses ---
    //
    // This was a direct `POST /commands/updateCriteria`, because no criteria
    // UI existed when the journey was written. That mutated the case behind
    // the page's back and left its cached snapshot behind the case, so the
    // very next UI write -- the custom concern below -- raced it and this
    // test failed about one run in three with a 409 on `defineCaseAttribute`
    // and a misleading 30s "the server never answered" timeout.
    //
    // Driving the reweight through `CriteriaEditor` removes the divergence
    // rather than waiting it out, and covers the real control at the same
    // time.
    await sift.reweightCriteria({ [CAR_PURCHASE_CRITERION_IDS.ownershipCost]: 45 });

    // --- Add a custom concern absent from the installed pack (spec brief
    // "A concern absent from the pack can still become a typed custom.*
    // case extension"). ---
    await sift.submitCustomConcern({
      slug: 'has_sunroof',
      label: 'Has a sunroof',
      reason: 'The household specifically wants a sunroof on their next car.',
      valueType: 'boolean',
      evidenceExpectation: 'assertion',
      comparison: 'none',
    });

    const beforeReload = await getCaseState(request, caseId);
    expect(
      (beforeReload['caseExtensions'] as { definition: { id: string } }[]).some(
        (ext) => ext.definition.id === 'custom.has_sunroof',
      ),
    ).toBe(true);

    // --- Reload persistence (mirrors reload-persistence.spec.ts's own
    // rigor: a genuine full-page reload, not a soft client-side
    // transition). ---
    await page.reload();
    await expect(page.getByTestId('workspace-app-bar')).toBeVisible({ timeout: 15_000 });
    await sift.openManageOptionsSheet();
    await page.getByTestId('option-editor-list-trigger').click();
    for (const entity of entities) {
      await expect(page.getByTestId('option-editor-list')).toContainText(entity.label);
    }
    const afterReload = await getCaseState(request, caseId);
    expect(afterReload['id']).toBe(caseId);
    expect(
      (afterReload['caseExtensions'] as { definition: { id: string } }[]).some(
        (ext) => ext.definition.id === 'custom.has_sunroof',
      ),
    ).toBe(true);
    const reweightedCriterion = (afterReload['criteria'] as { id: string; weight: number }[]).find(
      (c) => c.id === CAR_PURCHASE_CRITERION_IDS.ownershipCost,
    );
    expect(reweightedCriterion?.weight).toBe(45);

    guard.assertClean();
  });

  test('Back returns to the plain launcher without creating a case', async ({ page }) => {
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.open();
    await sift.openVehicleCatalog();
    await page.getByTestId('vehicle-catalog-back').click();
    await expect(page.getByTestId('demo-launcher')).toBeVisible();
    await expect(page.getByTestId('vehicle-catalog-flow')).not.toBeVisible();

    guard.assertClean();
  });
});
