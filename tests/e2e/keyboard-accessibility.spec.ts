/**
 * Keyboard operation and accessibility coverage (docs/engineering-principles.md "Playwright
 * visual verification": "keyboard use", "valid focus order"; "Run axe in
 * every required state" -- covers the launcher and mid-investigation
 * states in addition to `car-purchase-journey.spec.ts`'s own scans).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import { disableAnimations } from './helpers/layout-assertions.js';
import { SiftPage } from './pages/sift-page.js';

/** Presses Tab (bounded) until `target` is focused, or fails with a clear message -- avoids a magic single-Tab assumption about exactly how many focusable ancestors precede the target. */
async function tabUntilFocused(page: Page, target: Locator, maxPresses = 15): Promise<void> {
  for (let attempt = 0; attempt < maxPresses; attempt += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  const isFocused = await target.evaluate((el) => el === document.activeElement);
  expect(isFocused, `Tab order did not reach the target control within ${maxPresses} presses`).toBe(
    true,
  );
}

test.describe('keyboard operation and accessibility', () => {
  test('the launcher is reachable and operable by keyboard alone, and passes an axe scan', async ({
    page,
  }) => {
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);
    await sift.open();

    await assertNoSeriousAxeViolations(page, 'launcher (initial load)');

    const target = page.getByTestId('demo-launcher-car-purchase');
    await tabUntilFocused(page, target);
    await expect(target).toBeFocused();

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/cases/demo') && res.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page.getByTestId('case-workspace')).toBeVisible();

    guard.assertClean();
  });

  test('the custom concern form and the pending approval are both fully keyboard-operable', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.open();
    await sift.launchCarPurchase();
    const round1 = await sift.requestInvestigation();
    await assertNoSeriousAxeViolations(page, 'mid-investigation');
    await sift.waitForInvestigationCompleted(round1.runId);
    await sift.waitForRecommendationReady();

    // "Add a question" is now one item of the app bar's create menu, and
    // the app bar is global chrome mounted once above the narrow/expanded
    // split -- so this is the same two keystroke-reachable controls (menu
    // trigger, then menu item) at every viewport, opening the same modal
    // Sheet. It used to be a closed-by-default disclosure row in pane mode
    // and a main-column toolbar Sheet in web-app mode, which is why the
    // Escape below used to be conditional.
    await sift.openAddConcern();

    // --- Fill CustomConcernForm using real keystrokes, not `.fill()` ---
    const form = page.getByTestId('custom-concern-form');
    await form.getByLabel('Concern id').focus();
    await page.keyboard.type('rear_facing_seat_behind_driver');
    await form.getByLabel('Label', { exact: true }).focus();
    await page.keyboard.type('Rear-facing seat fits behind the driver');
    await form.getByLabel('Value type').selectOption('boolean');
    await form.getByLabel('Evidence expectation').selectOption('verification');
    await form.getByLabel('Why this matters to you').focus();
    await page.keyboard.type(
      'A second child arrives in three months, so a rear-facing seat has to go behind the driver.',
    );

    const submit = form.getByTestId('custom-concern-form-submit');
    await tabUntilFocused(page, submit);
    await page.keyboard.press('Enter');
    await expect(form.getByTestId('custom-concern-form-success')).toBeVisible();

    // The "Add a question" region is a real modal Sheet at EVERY viewport
    // now that it is a create-menu item, so it is closed here via Escape,
    // not a click -- keeps this journey fully keyboard-operable end to end,
    // and a still-open modal would otherwise intercept the "Request
    // investigation" click below.
    //
    // This was guarded by `if (!isNarrowLayout(page))` while pane mode
    // reached the same form through a non-modal disclosure row. When that
    // row became a create-menu item the guard silently stopped closing a
    // modal that now exists at 390/430/480/640 too, and round 2's click
    // spent the whole 120s test budget being swallowed by the Sheet's
    // overlay. Unconditional, because the surface is unconditional.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-add-concern-sheet')).not.toBeVisible();

    // --- Round 2, then keyboard-activated approval ---
    const round2 = await sift.requestInvestigation();
    await sift.waitForInvestigationCompleted(round2.runId);
    await sift.waitForRecommendationReady();

    // A real, bounded wait on the exact thing the rest of this test is
    // about, and not a redundant one: neither line above actually waits for
    // round 2's *result* to reach this browser.
    //
    // `waitForRecommendationReady` cannot, here. Unlike
    // `car-purchase-journey.spec.ts`, this journey never reweights a
    // criterion, so round 1's recommendation is never invalidated and the
    // card still reads "Ready for review" when round 2 is requested -- the
    // assertion passes instantly, against round-1 state.
    // `waitForInvestigationCompleted` cannot either: it reads the run's own
    // status and `live-run-status-phase`, both of which say "completed"
    // while the revised snapshot is still in flight.
    // `foldRound2` (`car-purchase-engine.ts`) appends `proposal.proposed`
    // before the run's completion activity, so the proposal is genuinely
    // real by then -- the browser simply learns about it over a separate
    // SSE case-snapshot delivery. On a loaded machine that lands after
    // `toBeVisible`'s default 5s, and the test then reported "no approval
    // card" for a proposal that existed and was merely still arriving.
    // Approval controls are Decide-owned now (ADR 0016; the change set:
    // "Approval controls belong to Decide"). A pending proposal is exactly
    // what makes Decide reachable, so this is navigation, not a workaround.
    await sift.goToWorkflowStage('decide');
    await expect(page.getByTestId('approval-card-pending')).toBeVisible({ timeout: 30_000 });

    const approveButton = page.getByTestId('approval-card-approve');
    await expect(approveButton).toBeVisible();
    await approveButton.focus();
    await expect(approveButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('approval-card-stamp')).toContainText('Approved');

    guard.assertClean();
  });
});
