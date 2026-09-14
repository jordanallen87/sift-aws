/**
 * The first-run guide (`apps/web/src/components/FirstRunGuide.tsx`), driven
 * as a genuine first-time visitor.
 *
 * Every other spec in this suite launches through `SiftPage.open()`, which
 * seeds the real production "already seen" storage key so the modal does
 * not cover 144 unrelated journeys (see that method's own comment for why
 * that is a seeded key and not a test-only build flag). This file is the
 * one that does NOT seed it: it uses `openAsFirstTimeVisitor()` and
 * exercises the real appear/dismiss/stay-dismissed behaviour in a real
 * browser, at every viewport this product is judged at.
 */
import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import { assertNoHorizontalOverflow, disableAnimations } from './helpers/layout-assertions.js';
import { FIRST_RUN_GUIDE_STORAGE_KEY, SiftPage } from './pages/sift-page.js';

test.describe('first-run guide', () => {
  test('appears on a first case, explains how to talk to the assistant, and fits the pane', async ({
    page,
  }) => {
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.openAsFirstTimeVisitor();
    // Nothing before a case exists -- the guide explains a workspace.
    await expect(page.getByTestId('first-run-guide')).toBeHidden();

    await sift.launchCarPurchase();

    const guide = page.getByTestId('first-run-guide');
    await expect(guide).toBeVisible();
    await expect(guide.getByText('How Sift works')).toBeVisible();

    // The half of the content this surface exists for: copy-pasteable
    // phrases, each backed by a genuinely registered tool, and the
    // authority boundary stated in the product rather than the README.
    await expect(guide.getByTestId('how-sift-works-phrases')).toBeVisible();
    await expect(
      guide.getByTestId('how-sift-works-phrase-sift-request-investigation'),
    ).toBeVisible();
    await expect(guide.getByTestId('how-sift-works-phrase-sift-explain-ranking')).toBeVisible();
    await expect(guide.getByTestId('how-sift-works-authority')).toContainText('cannot approve');

    // Named exactly as the pane's own controls render them. This assertion
    // used to expect "Ask Sift to look into this", which is the one thing it
    // exists to rule out: the guide said that while the control itself
    // (`RecommendationHero.tsx`) has always read "Have Sift investigate", so
    // the guide was naming a button no one could find. The label below is
    // read off that control, which is the canonical one.
    await expect(guide.getByText('Have Sift investigate')).toBeVisible();

    // The dismiss control is reachable without scrolling: it lives outside
    // the sheet's scrolling body precisely so this holds at 390px.
    await expect(page.getByTestId('first-run-guide-dismiss')).toBeInViewport();

    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page, 'first-run guide (open over a fresh case)');

    guard.assertClean();
  });

  test('is dismissed by its own control, and never returns for this browser', async ({ page }) => {
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.openAsFirstTimeVisitor();
    await sift.launchCarPurchase();
    await expect(page.getByTestId('first-run-guide')).toBeVisible();

    await sift.dismissFirstRunGuide();

    // Focus goes to the Help control, which reopens the same content --
    // not to `<body>`, which is where Radix's own restore lands it (the
    // launcher button that opened this case is long unmounted).
    await expect(page.getByTestId('help-button')).toBeFocused();

    // The dismissal is durable, and it is the real production key.
    expect(
      await page.evaluate((key) => localStorage.getItem(key), FIRST_RUN_GUIDE_STORAGE_KEY),
    ).not.toBeNull();

    // A reload does not re-nag.
    await page.reload();
    await expect(page.getByTestId('case-workspace')).toBeVisible();
    await expect(page.getByTestId('first-run-guide')).toBeHidden();

    // Neither does "Reset demo", which creates a genuinely new case (a new
    // `caseId`, `App.tsx`'s `handleResetDemo`) and so re-runs the very
    // effect that decides whether to show the guide -- the exact "a judge
    // who resets five times sees it once" case.
    const [resetResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/cases/demo') && res.request().method() === 'POST',
      ),
      page.getByTestId('workspace-app-bar-reset-demo').click(),
    ]);
    expect(resetResponse.ok()).toBe(true);
    await expect(page.getByTestId('case-workspace')).toBeVisible();
    await expect(page.getByTestId('first-run-guide')).toBeHidden();

    guard.assertClean();
  });

  test('is fully keyboard-operable and closes on Escape', async ({ page }) => {
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.openAsFirstTimeVisitor();
    await sift.launchCarPurchase();
    const guide = page.getByTestId('first-run-guide');
    await expect(guide).toBeVisible();

    // Radix moves focus into the dialog on open, and traps it there.
    await expect
      .poll(async () => guide.evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');
      expect(
        await guide.evaluate((el) => el.contains(document.activeElement)),
        'focus escaped the first-run guide',
      ).toBe(true);
    }

    // Escape closes it, and counts as a dismissal.
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('case-workspace')).toBeVisible();
    await expect(guide).toBeHidden();

    guard.assertClean();
  });

  test('the same content stays reachable from the Help control afterwards', async ({ page }) => {
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.openAsFirstTimeVisitor();
    await sift.launchCarPurchase();
    await sift.dismissFirstRunGuide();

    await page.getByTestId('help-button').click();
    const help = page.getByTestId('help-sheet');
    await expect(help).toBeVisible();
    await expect(help.getByTestId('how-sift-works-phrases')).toBeVisible();
    await expect(help.getByTestId('how-sift-works-authority')).toBeVisible();

    guard.assertClean();
  });

  test('does not promise assistant interaction in a browser with no WebMCP host', async ({
    page,
  }) => {
    // Every browser Playwright drives here is a stock Chromium with no
    // `document.modelContext`, so this is the real unsupported branch --
    // the same `adapter.supported()` signal `WebMcpStatus` reads, not a
    // stub.
    await disableAnimations(page);
    const sift = new SiftPage(page);

    await sift.openAsFirstTimeVisitor();
    await sift.launchCarPurchase();

    const lead = page.getByTestId('first-run-guide').getByTestId('how-sift-works-phrases-lead');
    await expect(lead).toContainText('no WebMCP host');
    await expect(page.getByTestId('webmcp-status-unsupported')).toBeAttached();
  });
});
