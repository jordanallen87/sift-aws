/**
 * Real-browser coverage for the bid-document import flow
 * (`apps/web/src/components/BidDocumentImport.tsx`, reached from
 * `OptionEditor.tsx`'s `option-editor-import-trigger` Collapsible), which
 * had zero e2e coverage before this file -- only jsdom
 * (`BidDocumentImport.test.tsx`, `pdf-bid-document.test.ts`,
 * `apps/agent/src/routes/bid-documents.test.ts`).
 *
 * That gap matters specifically because of ONE class of defect jsdom cannot
 * see at all: a real layout regression, recorded in `OptionEditor.tsx`'s own
 * header comment, where the "Add Bid" sheet's Save button sat 2,253px down a
 * 2,329px scroll -- below the fold -- on this exact seeded 12-bid case at
 * the canonical 430px pane width. jsdom has no layout engine, so no unit
 * test could have caught that, or could catch a recurrence of it. This spec
 * exercises the one state the existing regression lock
 * (`bid-comparison-journey.spec.ts`) never covers: the import panel OPEN,
 * which alone adds roughly 694px of file picker/paste box/name/format
 * fields to that same sheet (`OptionEditor.tsx`'s own comment on that
 * panel's size) -- exactly the shape of state that produced the original
 * bug. See "Layout reachability" below.
 *
 * Everything else here drives the real app against the real server the
 * Playwright harness starts (`playwright.config.ts`'s `webServer`) --
 * `submitBidDocument`'s real deterministic extractor
 * (`packages/scenarios/src/tools/bid-document-extractor.ts`), the real
 * `POST /api/cases/:caseId/commands/submitBidDocument` route, and the real
 * `OptionEditor` prefill it feeds into. No mock, no bypass.
 *
 * The PDF path (`readBidDocument`, `POST /api/cases/:caseId/
 * bid-documents/read`) is deliberately NOT exercised here. It requires a
 * configured model (`SIFT_BID_DOCUMENT_READER_ENABLED`); the test harness
 * runs with none configured, and driving even the cheap 503 refusal
 * honestly would mean assembling a real PDF file, feeding it through
 * `pdfjs-dist`'s real worker in a real page (`extractPdfDocumentText`,
 * `apps/web/src/components/pdf-bid-document.ts`) via `setInputFiles`, and
 * only THEN reaching the route that answers 503 -- a real, separate feature
 * surface, not a cheap addition to this file, and out of scope for what
 * this task asked for. Left out rather than faked.
 *
 * One layout helper this spec deliberately does NOT call, confirmed
 * directly rather than assumed: `assertNoStickyOverlap`/
 * `assertRightPaneIntegrity` (`layout-assertions.ts`) walk every
 * `position: fixed`/`sticky` element and exempt only ANCESTORS of the
 * protected control. `ui/sheet.tsx`'s own `SheetOverlay` -- the translucent
 * `fixed inset-0` backdrop every open Sheet renders -- is a SIBLING of the
 * Sheet's content (`SheetPortal` renders `<SheetOverlay /><SheetContent>`
 * side by side), never an ancestor of anything inside that content, so it
 * is never exempted; and because it is `fixed inset-0`, it geometrically
 * "overlaps" every control inside every Sheet in this entire app, always.
 * Verified directly against this exact state (`page.evaluate` walking the
 * same fixed/sticky sweep that helper runs, right here in this panel): it
 * reports the overlay covering `option-editor-save`, at equal z-index to
 * the Sheet's own content but earlier in DOM order -- i.e. painted BEHIND
 * it, not over it, exactly as the passing screenshot at that same instant
 * shows. No existing spec had ever pointed either helper at a control living
 * inside a Sheet before this one (confirmed by inspection: every existing
 * call site names a top-level app-bar/approval-card/tab control), so this
 * is a real, previously-unexercised blind spot in that helper for
 * modal-nested content -- not a defect in this product's Sheet, and not
 * something to paper over by weakening this spec's own assertions. This
 * spec instead reaches for the other named helper, `assertPrimaryTouchTargets`
 * (no sticky-overlap sweep, so it does not share this blind spot), plus a
 * direct `toBeInViewport()` check, for the same "genuinely reachable and
 * hittable" claim.
 */
import { expect, test } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import { assertPrimaryTouchTargets, disableAnimations } from './helpers/layout-assertions.js';
import { BID_COMPARISON_ENTITY_IDS, getCaseState, SiftPage } from './pages/sift-page.js';

/** The document this spec imports. Every field is one `BID_DOCUMENT_ATTRIBUTE_MAP` (`command-service.ts`) actually maps onto a `bid.*` attribute the pack declares, and every value below is asserted against verbatim -- both in the UI and in the real server-persisted case. */
const IMPORT_FILENAME = 'import-test-bid.json';
const IMPORT_DOCUMENT_TEXT = JSON.stringify({
  contractorName: 'Import Test Contractors',
  total: { amount: 123456, currency: 'USD' },
  depositPercent: 12,
  startInWeeks: 3,
  durationWorkingDays: 45,
  warranty: { termMonths: 24, statedInWriting: true },
});

/** `definitionId` -> the exact rendered value string `formatAttributeValue`/the extractor's own confidence produce, real numbers this spec put in, not placeholders. */
const EXPECTED_READ_VALUES: Record<string, string> = {
  'bid.quoted_total': '$123,456',
  'bid.deposit_percent': '12 %',
  'bid.start_weeks': '3 weeks',
  'bid.duration_days': '45 days',
  'bid.warranty_months': '24 months',
};

/** The same five attributes, as the raw input value `DynamicAttributeField` renders once `OptionEditor` is prefilled from the import (number fields only -- `bid.quoted_total` is a two-input money field, asserted separately by its own `aria-label`s). */
const EXPECTED_NUMBER_INPUT_VALUES: Record<string, string> = {
  'bid.deposit_percent': '12',
  'bid.start_weeks': '3',
  'bid.duration_days': '45',
  'bid.warranty_months': '24',
};

test.describe('Bid document import', () => {
  test('imports a pasted bid document into real attribute values with read-from-document provenance, reachable at this viewport', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.open();
    const { caseId } = await sift.launchBidComparison();

    await sift.openManageOptionsSheet();

    // Opened by KEYBOARD, not a click: `CollapsibleTrigger` renders a real
    // native `<button>` (Radix `Collapsible.Trigger`), so a focused Enter
    // press is the same activation a keyboard-only person reaches it with,
    // not a mouse-only shortcut this spec invented.
    const importTrigger = page.getByTestId('option-editor-import-trigger');
    await expect(importTrigger).toBeVisible();
    await importTrigger.focus();
    await page.keyboard.press('Enter');

    const importPanel = page.getByTestId('bid-document-import');
    await expect(importPanel).toBeVisible();

    await assertNoSeriousAxeViolations(page, 'bid document import panel opened');

    // --- Layout reachability -- the regression that actually bit. ---
    // `option-editor-save` is pinned `position: sticky; bottom: 0`
    // specifically so it "stays reachable at every scroll position instead
    // of only at the very end of the content" (`OptionEditor.tsx`'s own
    // comment on that div). Asserted here, with the ~694px-tall import
    // panel now open and BEFORE anything below scrolls the pane, so this is
    // a genuine claim about what a real, sized browser shows the instant
    // the panel opens -- not merely that the element exists somewhere in
    // the DOM, which is all a jsdom test could ever check.
    await expect(page.getByTestId('option-editor-save')).toBeInViewport();

    // Both the import's own submit control and the editor's sticky Save:
    // a real >=44x44 CSS-pixel target, inside the viewport. Reuses this
    // suite's existing touch-target helper rather than inventing a parallel
    // mechanism -- `assertPrimaryTouchTargets` measures via
    // `locator.boundingBox()`, which scrolls each target into view first, so
    // this also proves `bid-document-import-submit` -- genuinely further
    // down this now-tall panel -- can be scrolled to and hit, not just that
    // it is present somewhere below the fold. (See this file's header
    // comment for why `assertNoStickyOverlap`/`assertRightPaneIntegrity`'s
    // sticky-overlap sweep is not also used here.)
    await assertPrimaryTouchTargets(page, ['bid-document-import-submit', 'option-editor-save']);

    await page.getByTestId('bid-document-import-filename').fill(IMPORT_FILENAME);
    await page.getByTestId('bid-document-import-text').fill(IMPORT_DOCUMENT_TEXT);
    await page.getByTestId('bid-document-import-format').selectOption('application/json');

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/commands/submitBidDocument') && res.request().method() === 'POST',
      ),
      page.getByTestId('bid-document-import-submit').click(),
    ]);
    expect(response.ok(), await response.text()).toBe(true);

    // --- The import's own summary: real values, not "something rendered". ---
    await expect(page.getByTestId('bid-document-import-summary-heading')).toHaveText(
      `Imported "${IMPORT_FILENAME}" as "Import Test Contractors"`,
    );
    await expect(page.getByTestId('bid-document-import-summary-reader')).toHaveText(
      'Sift read 5 values off this document and could not read 0. Nothing below is verified -- ' +
        'check each value against the document before you rely on it.',
    );
    await expect(page.getByTestId('bid-document-import-unread-none')).toHaveText(
      'This document stated every field Sift looks for.',
    );

    for (const [definitionId, expectedValue] of Object.entries(EXPECTED_READ_VALUES)) {
      const row = page.getByTestId(`bid-document-import-read-${definitionId}`);
      await expect(row).toContainText(expectedValue);
      await expect(row).toContainText('Read from the document');
      await expect(row).toContainText('Confidence 90%. Not verified.');
    }

    // --- The SAME real values, prefilled into the editor, each carrying its
    // own `option-editor-imported-*` read-from-document provenance note --
    // not a second, disconnected copy of the summary above. ---
    await expect(page.getByTestId('option-editor-editing-banner')).toContainText(
      'Editing Import Test Contractors',
    );
    await expect(page.locator('#option-editor-label')).toHaveValue('Import Test Contractors');
    await expect(page.getByTestId('option-editor-imported-label')).toContainText(
      `Read from "${IMPORT_FILENAME}"`,
    );

    const quotedTotalField = page.getByTestId('dynamic-attribute-field-bid.quoted_total');
    await expect(quotedTotalField.getByLabel('Quoted total amount')).toHaveValue('123456');
    await expect(quotedTotalField.getByLabel('Quoted total currency')).toHaveValue('USD');

    for (const [definitionId, expectedInputValue] of Object.entries(EXPECTED_NUMBER_INPUT_VALUES)) {
      await expect(
        page.getByTestId(`dynamic-attribute-field-${definitionId}`).locator('input'),
      ).toHaveValue(expectedInputValue);
    }

    for (const definitionId of Object.keys(EXPECTED_READ_VALUES)) {
      const note = page.getByTestId(`option-editor-imported-${definitionId}`);
      await expect(note).toContainText(`Read from "${IMPORT_FILENAME}"`);
      await expect(note).toContainText('Confidence 90%');
      await expect(note).toContainText('Not verified. Edit it to record it as your own.');
    }

    // --- Cross-checked against the real, server-persisted case -- not only
    // what the page happens to render. ---
    const afterImport = await getCaseState(page.request, caseId);
    const entities = afterImport['entities'] as {
      id: string;
      label: string;
      attributes: Record<string, { value?: unknown; origin: string; status: string }>;
    }[];
    const imported = entities.find((entity) => entity.label === 'Import Test Contractors');
    expect(imported, 'the imported bid must exist on the real, server-side case').toBeDefined();
    expect(imported!.attributes['bid.quoted_total']?.value).toEqual({
      type: 'money',
      amount: 123456,
      currency: 'USD',
    });
    expect(imported!.attributes['bid.deposit_percent']?.value).toEqual({
      type: 'number',
      value: 12,
      unit: '%',
    });
    expect(imported!.attributes['bid.start_weeks']?.value).toEqual({
      type: 'number',
      value: 3,
      unit: 'weeks',
    });
    expect(imported!.attributes['bid.duration_days']?.value).toEqual({
      type: 'number',
      value: 45,
      unit: 'days',
    });
    expect(imported!.attributes['bid.warranty_months']?.value).toEqual({
      type: 'number',
      value: 24,
      unit: 'months',
    });
    // Never `'user'`/`'verified'`: a read value is a proposal, and this is
    // the one rule `BidDocumentImport.tsx`'s own header comment says this
    // whole component exists to hold.
    expect(imported!.attributes['bid.quoted_total']?.origin).toBe('agent_proposed');
    expect(imported!.attributes['bid.quoted_total']?.status).toBe('supported');
    expect((afterImport['entities'] as unknown[]).length).toBe(
      BID_COMPARISON_ENTITY_IDS.length + 1,
    );

    guard.assertClean();
  });

  /**
   * The zero-field guard (`command-service.ts` `submitBidDocument`): a
   * document that PARSES as valid JSON but states none of the fields this
   * extractor recognises must refuse honestly, not create a candidate named
   * after the file and holding nothing -- the real defect
   * `command-service.ts`'s own header comment records ("pasting valid JSON
   * with `quoted_total`/`contractor` instead of `total`/`contractorName`
   * reported a successful import and left behind a candidate ... holding
   * five attributes and not one value"). Same wrong-key-names document that
   * regression test uses server-side
   * (`command-service.bid-document.test.ts`), driven here through the real
   * browser form instead of the service directly.
   */
  test('a well-formed document with no recognizable bid fields refuses honestly, and creates no phantom option', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    // The one expected failure this test deliberately manufactures --
    // everything else still fails the guard, exactly like
    // `error-recovery.spec.ts`'s identical use of this escape hatch.
    guard.allowApiFailure(
      (url, status) => url.includes('/commands/submitBidDocument') && status === 400,
    );

    const sift = new SiftPage(page);
    await sift.open();
    const { caseId } = await sift.launchBidComparison();

    const beforeState = await getCaseState(page.request, caseId);
    const beforeEntityCount = (beforeState['entities'] as unknown[]).length;

    await sift.openManageOptionsSheet();
    await page.getByTestId('option-editor-import-trigger').click();
    await expect(page.getByTestId('bid-document-import')).toBeVisible();

    const filename = 'wrong-shape-bid.json';
    // Plausible-looking, well-formed JSON, every key under a name this
    // extractor does not recognise -- identical shape to the server-side
    // regression test's own fixture.
    await page.getByTestId('bid-document-import-filename').fill(filename);
    await page.getByTestId('bid-document-import-text').fill(
      JSON.stringify({
        contractor: 'Harborline Mechanical',
        quoted_total: { amount: 268400, currency: 'USD' },
        deposit_percent: 20,
      }),
    );
    await page.getByTestId('bid-document-import-format').selectOption('application/json');

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/commands/submitBidDocument') && res.request().method() === 'POST',
      ),
      page.getByTestId('bid-document-import-submit').click(),
    ]);
    expect(response.status()).toBe(400);

    // The real, honest message -- `command-service.ts`'s own wording,
    // verbatim -- not a generic failure banner.
    const errorAlert = page.getByTestId('bid-document-import-error');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(`Nothing in "${filename}" could be read as a bid.`);
    await expect(page.getByTestId('bid-document-import-error-details')).toContainText(
      'The document parsed, but none of the fields a bid states were found in it.',
    );

    // No phantom option: the panel never reaches its summary state, the
    // option count in the app bar is unchanged, and -- the real proof --
    // the server-side case gained no entity at all.
    await expect(page.getByTestId('bid-document-import-summary')).toHaveCount(0);
    await expect(page.getByTestId('workspace-app-bar-option-count')).toHaveText(
      `${BID_COMPARISON_ENTITY_IDS.length} options`,
    );
    const afterState = await getCaseState(page.request, caseId);
    expect((afterState['entities'] as unknown[]).length).toBe(beforeEntityCount);

    guard.assertClean();
  });
});
