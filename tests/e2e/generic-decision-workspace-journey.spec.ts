/**
 * The §61 generic decision workspace journey
 * (`docs/change-sets/2026-08-30-generic-decision-workspace.md` §61; Task
 * J1). Distinct from `car-purchase-journey.spec.ts`/
 * `home-energy-guardian-journey.spec.ts` (the two hero demo trajectories)
 * and `vehicle-catalog-journey.spec.ts` (the plain catalog-only flow): this
 * spec exists to prove the *generic workspace* concepts §61 lists --
 * WebMCP-driven presentation, shared selection, dynamic custom fields,
 * research, notes, and consumer/developer correlation -- travel together in
 * one real, ordered session. It reuses `SiftPage`/`postCommand`/
 * `getCaseState` exactly as the existing journeys do; it does not invent a
 * second driving style.
 *
 * --- Two disclosed departures from §61's literal wording ---
 *
 * 1. "Open normal comparison start" (step 1) is realized here as the
 *    primary demo launcher entry point (`sift.launchCarPurchase()`), not
 *    `VehicleCatalogFlow`'s "Compare vehicles" non-demo path. Confirmed
 *    directly by reading `vehicle-catalog-journey.spec.ts`'s own header
 *    comment: "guided investigation only runs against the deterministic
 *    demo case" -- a catalog-built case cannot run `requestInvestigation`
 *    at all (the generic "Request investigation" click 400s once there is
 *    no seeded obligation, and there is no scripted engine trajectory for
 *    it). §61 steps 17-18 ("update criterion," "verify recommendation
 *    invalidation") are meaningless without an already-`ready`
 *    recommendation to invalidate, which only the demo case can produce.
 *    "Normal" is read here as "the ordinary consumer entry point," in
 *    contrast with step 19's later, deliberately separate "Developer view"
 *    entry point -- not as "non-demo."
 * 2. A round-1 investigation is requested immediately after launch, before
 *    steps 2-4 (search/add/verify), rather than after them. This is a
 *    disclosed reordering, not a renumbering: the real scripted Strands
 *    Graph fixture (`car-purchase-engine.ts`) is proven only against the
 *    pack's exact four seeded candidates, and this journey needed round 1
 *    to have already produced a `ready` recommendation before the step-17
 *    reweight for that step to mean anything -- running it first (against
 *    the untouched seeded set) avoids feeding the fixture a fifth,
 *    unscripted candidate while still preserving every one of §61's 22
 *    numbered beats later in the same session.
 *
 * --- A real product gap this journey found, and then closed (step 8) ---
 *
 * When this journey was first written, `sift_configure_comparison` (and its
 * honest `postCommand('setView', ...)` equivalent) genuinely persisted
 * `WorkspaceViewState.compare`/`visibleAttributeIds` -- `CommandService.setView`
 * routes through `CaseStore.updateSelection()` and a reload reflected it
 * exactly -- but `WorkspaceViewSwitcher.tsx` read none of those fields and
 * forwarded none of them to `OptionCompareView`, whose `visibleOptionIds`/
 * `visibleAttributeIds`/`pinnedAttributeIds` props were real, implemented,
 * and passed by nobody. So a WebMCP configure call durably narrowed the
 * case's persisted view state and the open page never moved -- directly
 * short of change-set §58's demo requirement ("page visibly reconfigures
 * without click automation") and DoD item 48.
 *
 * This spec asserted that broken behavior honestly rather than faking a
 * green step, which is how it got found and fixed. The wiring now exists,
 * and step 8 below asserts the requirement instead of the defect: the
 * excluded column is genuinely gone, and the table states in as many words
 * that a filtered-out option is not eliminated (§54).
 *
 * The lesson is worth keeping: every one of these was a seam where each
 * half was individually correct and nothing connected them, so no unit test
 * on either side could have caught it.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoSeriousAxeViolations } from './helpers/axe.js';
import { installConsoleGuard } from './helpers/console-guard.js';
import {
  assertNoHorizontalOverflow,
  assertRightPaneIntegrity,
  disableAnimations,
} from './helpers/layout-assertions.js';
import {
  CAR_PURCHASE_CRITERION_IDS,
  getCaseState,
  SiftPage,
  postCommand,
} from './pages/sift-page.js';

/**
 * `docs/decisions/0008-two-mode-product-architecture.md` dismantled the
 * "Manage options"/"What Sift found" disclosures entirely (both layouts now
 * reach `OptionEditor`/`FindingsSheet` only through `WorkspaceAppBar`'s
 * "Add option"/"Findings" Sheets, via `sift.openManageOptionsSheet()`/
 * `openFindingsSheet()`), and moved "your priorities" into a main-column
 * toolbar Sheet in web-app mode while leaving pane mode's disclosure
 * untouched. "Add a note" and "Add a question" have since left both of
 * those shapes: they are two of the three items in the app bar's create
 * menu, identical at every viewport. This spec runs at all six projects,
 * including `desktop-1440`, so it drives every one of those regions through
 * `sift.openDecisionProfile()`/`openNotes()`/`openAddConcern()` (and their
 * `close*` counterparts) rather than `openDisclosure(...)` directly, so each
 * step reaches the control the way a real user would in whichever layout is
 * under test.
 */

/** Presses Tab (bounded) until `target` is focused -- mirrors `keyboard-accessibility.spec.ts`'s own local helper; not shared since each spec's target/context differs. */
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

test.describe('generic decision workspace -- §61 journey', () => {
  test('WebMCP presentation, shared selection, dynamic custom fields, research, notes, dev correlation', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await disableAnimations(page);
    const guard = installConsoleGuard(page);
    const sift = new SiftPage(page);

    await sift.open();
    await assertNoSeriousAxeViolations(page, 'initial load (launcher)');

    // --- §61 step 1: "Open normal comparison start," driven by a real
    // keyboard path (gate: "keyboard use," "valid focus order") rather than
    // a plain `.click()` -- see `sift.launchCarPurchase()` for the
    // equivalent mouse path every other journey uses. ---
    const launchTarget = page.getByTestId('demo-launcher-car-purchase');
    await tabUntilFocused(page, launchTarget);
    await expect(launchTarget).toBeFocused();
    const [launchResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/cases/demo') && res.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(launchResponse.ok(), await launchResponse.text()).toBe(true);
    const { caseId } = (await launchResponse.json()) as { caseId: string };
    await expect(page.getByTestId('case-workspace')).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // --- Bridge (not a numbered §61 step; see header comment #2): round 1
    // against the untouched seeded set, so step 17-18's reweight has a real
    // `ready` recommendation to invalidate. ---
    const round1 = await sift.requestInvestigation();
    await sift.waitForInvestigationCompleted(round1.runId);
    await sift.waitForRecommendationReady();
    await assertNoSeriousAxeViolations(page, 'recommendation ready');

    // --- §61 step 2: "Tell the in-memory WebMCP test bridge to search
    // catalog." Real WebMCP is genuinely unavailable in stock Chromium
    // (confirmed directly, matching every other journey in this suite --
    // `webmcp-status-unsupported` below); `sift_search_catalog`'s own
    // adapter (`catalog-search-adapter.ts`) resolves to exactly one real
    // network boundary for this pack, `GET /api/catalog/vehicles` through
    // `catalog-client.ts`. Hitting that boundary directly is this suite's
    // established honest WebMCP-equivalent (`sift-page.ts`'s own header
    // comment; `postCommand` already does this for every WRITE tool this
    // suite exercises) -- genuinely the same request the tool's own
    // `execute()` would issue, not a fabrication of browser support that
    // does not exist. ---
    await expect(page.getByTestId('webmcp-status-unsupported')).toBeVisible();
    const catalogSearch = await page.request.get('/api/catalog/vehicles?query=Camry');
    expect(catalogSearch.ok(), await catalogSearch.text()).toBe(true);
    const catalogBody = (await catalogSearch.json()) as {
      records: { id: string; year: number; make: string; model: string; trim: string }[];
      total: number;
    };
    expect(catalogBody.records.length).toBeGreaterThan(0);
    const foundVehicle = catalogBody.records[0]!;
    const newOptionLabel =
      `${foundVehicle.year} ${foundVehicle.make} ${foundVehicle.model} ${foundVehicle.trim}`.trim();

    // --- §61 step 3: "Add several options." The demo case seeds 4 of the
    // pack's own 5-option cap (`OptionEditor`'s `maxOptions`); "several"
    // honestly reduces to "one more, at the cap" rather than fabricating
    // room that does not exist -- disclosed here, not silently narrowed. ---
    await sift.openManageOptionsSheet();
    const beforeAddState = await getCaseState(page.request, caseId);
    const carKind = (beforeAddState['entities'] as { kind: string }[])[0]!.kind;
    // Adding is the sheet's own default state now (`OptionEditor.tsx`) --
    // `option-editor-new` no longer exists, so there is no separate control
    // to click before filling the label.
    await page.locator('#option-editor-label').fill(newOptionLabel);
    const upsertResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/commands/upsertOption') && res.request().method() === 'POST',
    );
    await page.getByTestId('option-editor-save').click();
    const upsertResponse = await upsertResponsePromise;
    expect(upsertResponse.ok(), await upsertResponse.text()).toBe(true);

    // --- §61 step 4: "Verify page updates." --- Closed before the app-bar
    // check below: ADR 0008's "Add option" Sheet is a real modal, and its
    // own live option count (superseding the retired "Manage options"
    // disclosure meta) is the app bar's `workspace-app-bar-option-count`.
    // The roster is now a collapsed `<Collapsible>` (`OptionEditor.tsx`) --
    // opening it is what puts `option-editor-list` in the DOM.
    await page.getByTestId('option-editor-list-trigger').click();
    await expect(page.getByTestId('option-editor-list')).toContainText(newOptionLabel);
    await sift.closeManageOptionsSheet();
    await expect(page.getByTestId('workspace-app-bar-option-count')).toHaveText('5 options');
    await assertNoHorizontalOverflow(page);

    const afterAddState = await getCaseState(page.request, caseId);
    const newOption = (afterAddState['entities'] as { id: string; label: string }[]).find(
      (entity) => entity.label === newOptionLabel,
    )!;
    expect(newOption).toBeDefined();

    // --- §61 step 5: "Open Quick Pick." Quick Pick is the real default tab
    // (Task A10, change-set §64) -- already open, not a click. ---
    await expect(page.getByTestId('workspace-view-content-quick_pick')).toBeVisible();
    await expect(page.getByTestId('quick-pick-view')).toBeVisible();

    // --- §61 step 6: "Change shortlist state." `quick-pick-shortlist` calls
    // through the same `focusOption` command a Compare-view focus click uses
    // (App.tsx's `handleQuickPickShortlist`), a real persisted effect this
    // proves via `getCaseState`, not merely local UI state.
    //
    // This block used to assert `quick-pick-card-candidate-rav4` on the
    // stated assumption that "Quick Pick's order matches `CaseState.entities`
    // order, so position 0 is the first seeded candidate". That assumption is
    // no longer true and should not be: the tab is labelled "Best Match", and
    // it now genuinely walks the deterministic ranking rather than insertion
    // order. Retargeted rather than re-pinned to whichever option happens to
    // rank first, which would only move the same brittleness. Reading the id
    // off the card actually on screen and asserting the SAME id persisted is
    // a strictly stronger proof of this step's real subject -- that the
    // button shortlists the option the person is looking at. ---
    const quickPickCard = page.locator('[data-testid^="quick-pick-card-"]').first();
    await expect(quickPickCard).toBeVisible();
    const shownOptionId = (await quickPickCard.getAttribute('data-testid'))?.replace(
      'quick-pick-card-',
      '',
    );
    expect(shownOptionId).toBeTruthy();

    // Retargeted, and strictly stronger than what it replaced. This block
    // used to click "Shortlist" and assert `selectedOptionId` -- but that
    // button only ever *focused* the option, so the step proved a
    // presentation change while reading as a decision. Quick Pick now
    // records a canonical, undoable judgment, and disposition is
    // deliberately separate from focus: keeping a candidate for a closer
    // look is not the same act as pointing the pane at it, and it is not
    // shortlist confirmation either.
    //
    // The subject is unchanged -- the button acts on the option the person
    // is actually looking at, and the effect is canonical -- but the
    // observable is now a durable judgment rather than a highlight.
    await expect(page.getByTestId('quick-pick-keep')).toBeVisible();
    await page.getByTestId('quick-pick-keep').click();
    await expect
      .poll(async () => {
        const state = await getCaseState(page.request, caseId);
        const discovery = state['discovery'] as
          { dispositions?: { entityId: string; disposition: string }[] } | undefined;
        return discovery?.dispositions?.find((record) => record.entityId === shownOptionId)
          ?.disposition;
      })
      .toBe('keep');

    // --- §61 step 7: "Open Compare." A real visible-control tab switch --
    // the exact same `setView` command a `sift_set_view` WebMCP call would
    // reach (App.tsx's `handleViewModeChange`). ---
    await sift.selectWorkspaceView('compare');
    await assertNoHorizontalOverflow(page);

    // Waits for the persisted view to actually catch up (not merely the
    // optimistic local echo) before building step 8's own `setView` call on
    // top of it -- avoids a genuine two-writer sequence race between the
    // tab click's own in-flight command and this journey's next command.
    let beforeConfigureState: Record<string, unknown> = {};
    await expect
      .poll(async () => {
        beforeConfigureState = await getCaseState(page.request, caseId);
        return (beforeConfigureState['view'] as { mode?: string } | null)?.mode;
      })
      .toBe('compare');

    // --- §61 step 8: "Configure rows through WebMCP." Mirrors
    // `sift_configure_comparison`'s own exact call
    // (`register-sift-tools.ts`'s `buildConfigureComparisonTool`: merge onto
    // the current view, then `commands.setView`) -- deliberately EXCLUDES
    // `candidate-crv` from `compare.optionIds` to make the header-comment
    // gap concretely testable. ---
    const attributeDefs = (
      beforeConfigureState['attributeDefinitions'] as {
        id: string;
        appliesTo: string[];
      }[]
    ).filter((definition) => definition.appliesTo.includes(carKind));
    const rowIds = attributeDefs.slice(0, 2).map((definition) => definition.id);
    const configureResponse = await postCommand(page.request, caseId, 'setView', {
      expectedSequence: beforeConfigureState['eventSequence'],
      view: {
        mode: 'compare',
        compare: { optionIds: ['candidate-rav4', newOption.id] },
        visibleAttributeIds: rowIds,
      },
    });
    expect(configureResponse.ok(), await configureResponse.text()).toBe(true);

    // Persistence half of the gap: the command genuinely took effect.
    const afterConfigureState = await getCaseState(page.request, caseId);
    const persistedView = afterConfigureState['view'] as { compare?: { optionIds: string[] } };
    expect(persistedView.compare).toEqual({ optionIds: ['candidate-rav4', newOption.id] });

    // Rendering half: the page genuinely consumes the persisted narrowing.
    //
    // This assertion was deliberately INVERTED after it first ran. When this
    // journey was written, `WorkspaceViewSwitcher` passed none of
    // `OptionCompareView`'s real `visibleOptionIds`/`visibleAttributeIds`/
    // `pinnedAttributeIds` props, so a `setView` call persisted correctly and
    // the table ignored it -- and this test honestly asserted that broken
    // behavior rather than faking a green step. Finding it that way is what
    // got it fixed: change-set §58 names this exact interaction ("UI demo
    // moment: model reconfigures table") as a hero WebMCP beat, and DoD item
    // 48 requires the demo to visibly prove model-controlled presentation.
    // The wiring now exists, so the assertion asserts the requirement.
    await expect(page.getByTestId('option-compare-view-focus-candidate-crv')).toHaveCount(0);

    // Change-set §54: presentation is not decision mutation. An option
    // filtered out of the comparison must never read as *eliminated* -- the
    // table says so in as many words, so a narrowed view cannot be misread
    // as a judgment the human never made.
    await expect(page.getByTestId('option-compare-view-filtered-note')).toBeVisible();

    // --- §61 step 9: "Select an option in page." Uses `candidate-rav4`,
    // which the narrowing above deliberately KEPT, so this step exercises a
    // column that is genuinely rendered at every viewport project including
    // the narrow head-to-head layout. ---
    await page.getByTestId('option-compare-view-focus-candidate-rav4').click();

    // --- §61 step 10: "Verify case context contains exact selection." ---
    await expect
      .poll(async () => (await getCaseState(page.request, caseId))['selectedOptionId'])
      .toBe('candidate-rav4');

    // --- §61 step 11: "Add an unusual concern through WebMCP." Mirrors
    // `sift_define_case_attribute` with `origin: 'user'` -- the tool's own
    // documented behavior for "a WebMCP call made in response to the
    // user's explicit request" (`DefineCaseAttributeInputSchema`'s own
    // comment), which auto-confirms server-side. ---
    const customFieldLabel = 'Has factory roof rails for a cargo box';
    const beforeConcernState = await getCaseState(page.request, caseId);
    const defineResponse = await postCommand(page.request, caseId, 'defineCaseAttribute', {
      expectedSequence: beforeConcernState['eventSequence'],
      origin: 'user',
      definition: {
        id: 'custom.roof_rails',
        label: customFieldLabel,
        valueType: 'boolean',
        appliesTo: [carKind],
        evidenceExpectation: 'assertion',
        comparison: 'none',
        reason: 'The household needs factory roof rails to mount a cargo box for camping trips.',
      },
    });
    expect(defineResponse.ok(), await defineResponse.text()).toBe(true);

    const afterConcernState = await getCaseState(page.request, caseId);
    expect(
      (
        afterConcernState['caseExtensions'] as {
          definition: { id: string; confirmation: string };
        }[]
      ).some(
        (extension) =>
          extension.definition.id === 'custom.roof_rails' &&
          extension.definition.confirmation === 'confirmed',
      ),
    ).toBe(true);

    // --- §61 step 12: "Verify custom field appears." A confirmed case
    // extension now surfaces in BOTH places it should: "What you're looking
    // for" (`DecisionProfileView`'s "Personal concerns", projected from
    // `CaseState.caseExtensions` by `decision-profile.ts`) and, since the
    // step-8 fix, as a first-class Compare row marked "Custom".
    // This assertion covers the Decision Profile surface; the Compare-row
    // surface is covered by `OptionCompareView`'s own unit tests, which can
    // exercise a confirmed extension directly without threading one through
    // this journey's scripted fixture. ---
    const profileSection = await sift.openDecisionProfile();
    const concernRow = profileSection.locator('li', { hasText: customFieldLabel });
    await expect(concernRow).toBeVisible();
    await expect(concernRow).toContainText('Added by you');
    await assertNoSeriousAxeViolations(page, 'decision profile open, custom field visible');
    await sift.closeDecisionProfile();

    // --- §61 step 13: "Add research/source." No dedicated visible control
    // exists yet (same documented-gap category as `updateCriteria` in
    // `car-purchase-journey.spec.ts`) -- mirrors `sift_submit_source`. ---
    const beforeSourceState = await getCaseState(page.request, caseId);
    const submitSourceResponse = await postCommand(page.request, caseId, 'submitSource', {
      expectedSequence: beforeSourceState['eventSequence'],
      source: {
        url: 'https://example.com/2026-camry-roof-rail-spec-sheet',
        title: '2026 Toyota Camry factory options and accessories sheet',
        retrievedAt: new Date().toISOString(),
        claims: [],
      },
    });
    expect(submitSourceResponse.ok(), await submitSourceResponse.text()).toBe(true);
    const afterSourceState = await getCaseState(page.request, caseId);
    const submittedSource = (afterSourceState['sources'] as { id: string; title: string }[]).find(
      (source) => source.title === '2026 Toyota Camry factory options and accessories sheet',
    )!;
    expect(submittedSource).toBeDefined();

    // --- §61 step 14: "Populate custom field." Mirrors
    // `sift_set_option_attribute` -- `origin: 'agent_proposed'`,
    // `status: 'supported'` (a model may never claim `'verified'`; only a
    // human attestation, `origin: 'user'`, may -- `attributeStatusOriginError`
    // in `packages/core/src/attributes.ts`). Populates the newly-added
    // option specifically. ---
    const beforeSetAttrState = await getCaseState(page.request, caseId);
    const setAttrResponse = await postCommand(page.request, caseId, 'setOptionAttribute', {
      expectedSequence: beforeSetAttrState['eventSequence'],
      optionId: newOption.id,
      attribute: {
        definitionId: 'custom.roof_rails',
        value: { type: 'boolean', value: true },
        origin: 'agent_proposed',
        status: 'supported',
        sourceIds: [submittedSource.id],
      },
    });
    expect(setAttrResponse.ok(), await setAttrResponse.text()).toBe(true);

    const afterSetAttrState = await getCaseState(page.request, caseId);
    const populatedEntity = (
      afterSetAttrState['entities'] as {
        id: string;
        attributes: Record<string, { value?: { value?: boolean }; status?: string }>;
      }[]
    ).find((entity) => entity.id === newOption.id)!;
    expect(populatedEntity.attributes['custom.roof_rails']?.value?.value).toBe(true);
    expect(populatedEntity.attributes['custom.roof_rails']?.status).toBe('supported');

    // --- §61 step 15: "Verify unknown remains where unsupported." A
    // different, never-populated option genuinely has no value for this
    // field -- the honest "unknown," not a fabricated default. ---
    const unpopulatedEntity = (
      afterSetAttrState['entities'] as { id: string; attributes: Record<string, unknown> }[]
    ).find((entity) => entity.id === 'candidate-outback')!;
    expect(unpopulatedEntity.attributes['custom.roof_rails']).toBeUndefined();

    // --- §61 step 16: "Add note." Real visible `AddNoteForm`. ---
    //
    // `AddNoteForm` is mounted in exactly one place (the Notes Sheet), so
    // `#add-note-form-body`/`add-note-form-submit`/`add-note-form-success`
    // stay safe as global lookups. `CaseNotes` -- the READ half -- is NOT:
    // at narrow widths the pane's own content stack renders one inline
    // (`App.tsx`) and the Sheet renders a second, so while this Sheet is
    // open there are genuinely two `case-notes` sections in the document.
    // The note is therefore read back from the Sheet this step just opened,
    // which is the one surface that carries it at every viewport (expanded
    // mode has no inline copy at all). See this run's report for the
    // duplicate-mount defect itself -- scoping here is the honest
    // assertion, not a way of accepting the duplication.
    await sift.openNotes();
    const noteBody = 'Grandma insists on a sunroof, but nobody else in the household cares.';
    await page.locator('#add-note-form-body').fill(noteBody);
    const addNoteResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/commands/addNote') && res.request().method() === 'POST',
    );
    await page.getByTestId('add-note-form-submit').click();
    const addNoteResponse = await addNoteResponsePromise;
    expect(addNoteResponse.ok(), await addNoteResponse.text()).toBe(true);
    await expect(page.getByTestId('add-note-form-success')).toBeVisible();
    // Page-level, not scoped to the sheet. The sheet is the WRITE surface --
    // it mounts `AddNoteForm` alone -- and the note itself renders in the
    // content column behind it, which is the only `case-notes` in the
    // document. That split is deliberate: `sift_add_note` is a real WebMCP
    // tool, so a note has to be visible without a person opening a sheet, and
    // `pnpm test:host`'s "host action visible in pane" check asserts exactly
    // that. This assertion was scoped to the sheet while the sheet still
    // rendered its own copy of the list.
    await expect(page.getByTestId('case-notes')).toContainText(noteBody);
    await assertNoHorizontalOverflow(page);
    // Closed before the Developer view entry point (step 19) below: the
    // Notes Sheet is a real modal at every viewport now that it is reached
    // from the app bar's create menu, and it would otherwise intercept that
    // click.
    await sift.closeNotes();

    // --- §61 step 17: "Update criterion." Same real, no-dedicated-UI route
    // `car-purchase-journey.spec.ts` uses. ---
    const beforeReweightState = await getCaseState(page.request, caseId);
    const reweightResponse = await postCommand(page.request, caseId, 'updateCriteria', {
      expectedSequence: beforeReweightState['eventSequence'],
      operations: [
        { op: 'reweight', criterionId: CAR_PURCHASE_CRITERION_IDS.drivingComfort, weight: 5 },
      ],
    });
    expect(reweightResponse.ok(), await reweightResponse.text()).toBe(true);

    // --- §61 step 18: "Verify recommendation invalidation." Reflected
    // live over SSE, no click, no reload -- the same shared-control proof
    // every other journey in this suite makes. ---
    await expect(page.getByTestId('recommendation-card-status')).toContainText('Stale', {
      timeout: 15_000,
    });

    // --- §61 step 19: "Enter Developer view." The dedicated entry point
    // (Task A5) -- opens with no run in hand, so it lands on the Activity
    // tab (`RuntimeInspector.tsx`'s own documented default). ---
    await page.getByTestId('workspace-app-bar-developer-view').click();
    await expect(page.getByTestId('runtime-inspector')).toBeVisible();
    await expect(page.getByTestId('runtime-inspector-activity')).toBeVisible();
    await assertNoSeriousAxeViolations(page, 'developer view, activity tab');

    // --- §61 step 20: "Verify technical trail matches consumer event."
    // Round 1's activity items carry both `runId` and `debugEventId`, so
    // at least one renders a real "Inspect event" control
    // (`ActivityTimeline.tsx`); clicking it jumps this same Inspector to
    // Timeline, focused on the exact correlated runtime event. ---
    const inspectEventButton = page
      .getByTestId('runtime-inspector-activity')
      .locator('[data-testid^="activity-item-inspect-event-"]')
      .first();
    await expect(inspectEventButton).toBeVisible();
    await inspectEventButton.click();
    await expect(page.getByTestId('runtime-inspector-timeline')).toBeVisible();
    const focusedTimelineItem = page.locator(
      '[data-testid^="runtime-inspector-timeline-item-"][data-focused="true"]',
    );
    await expect(focusedTimelineItem).toBeVisible();
    await expect(focusedTimelineItem).toHaveAttribute('data-run-id', round1.runId);

    await page.getByTestId('sheet-close').click();
    await expect(page.getByTestId('runtime-inspector')).not.toBeVisible();
    await assertNoHorizontalOverflow(page);

    // --- §61 step 21: "Reload." A genuine full-page reload. ---
    await page.reload();
    await expect(page.getByTestId('workspace-app-bar')).toBeVisible({ timeout: 15_000 });

    // --- §61 step 22: "Verify durable state survived." Every mutation this
    // journey made, re-read from a fresh load: the 5th option, the
    // reweighted criterion, the confirmed custom field and its populated
    // value, the unpopulated option's honest unknown, the note, the last
    // selection, and the persisted view mode. ---
    await sift.openManageOptionsSheet();
    await page.getByTestId('option-editor-list-trigger').click();
    await expect(page.getByTestId('option-editor-list')).toContainText(newOptionLabel);
    await sift.closeManageOptionsSheet();
    await assertNoHorizontalOverflow(page);
    await assertRightPaneIntegrity(page, [
      'workspace-app-bar-reset-demo',
      'workspace-app-bar-developer-view',
    ]);

    const afterReloadState = await getCaseState(page.request, caseId);
    expect(afterReloadState['id']).toBe(caseId);
    const reweightedCriterion = (
      afterReloadState['criteria'] as { id: string; weight: number }[]
    ).find((criterion) => criterion.id === CAR_PURCHASE_CRITERION_IDS.drivingComfort);
    expect(reweightedCriterion?.weight).toBe(5);
    expect(
      (
        afterReloadState['caseExtensions'] as { definition: { id: string; confirmation: string } }[]
      ).some(
        (extension) =>
          extension.definition.id === 'custom.roof_rails' &&
          extension.definition.confirmation === 'confirmed',
      ),
    ).toBe(true);
    const reloadedNewOption = (
      afterReloadState['entities'] as {
        id: string;
        attributes: Record<string, { value?: { value?: boolean } }>;
      }[]
    ).find((entity) => entity.id === newOption.id)!;
    expect(reloadedNewOption.attributes['custom.roof_rails']?.value?.value).toBe(true);
    const reloadedOutback = (
      afterReloadState['entities'] as { id: string; attributes: Record<string, unknown> }[]
    ).find((entity) => entity.id === 'candidate-outback')!;
    expect(reloadedOutback.attributes['custom.roof_rails']).toBeUndefined();
    expect(
      (afterReloadState['notes'] as { body: string }[]).some((note) => note.body === noteBody),
    ).toBe(true);
    // `candidate-rav4`, per step 9 -- the option the step-8 narrowing kept
    // visible. (This read `candidate-crv` while step 9 clicked the column
    // that a then-unwired Compare view left on screen; both moved together
    // when the narrowing was wired up.)
    expect(afterReloadState['selectedOptionId']).toBe('candidate-rav4');
    expect((afterReloadState['view'] as { mode?: string } | null)?.mode).toBe('compare');

    guard.assertClean();
  });
});
