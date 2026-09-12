/**
 * Semantic page-object wrapper over the real right-pane workspace
 * (docs/planning/plans/2026-08-26-pax-hackathon-build.md Task 12:
 * "`SiftPage` exposes semantic methods for launch, investigate, ... review
 * proposal, ..., and read case context"). Every method drives the exact
 * same visible controls a real user clicks -- there is no shortcut that
 * bypasses `SiftCommands`/the real HTTP routes.
 *
 * `postCommand`/`getCaseState` below are the WebMCP-equivalent path: they
 * hit the exact same `/api/cases/:caseId/commands/:commandName` route
 * `apps/web/src/api/sift-client.ts` (and therefore every visible control and
 * every WebMCP tool callback) sends every command through
 * (docs/engineering-principles.md "Visible UI controls and WebMCP callbacks use the same command
 * implementation") -- used for the two real product beats that currently
 * have no dedicated visible control (`updateCriteria` -- there is no
 * criteria-editing UI yet, only the WebMCP tool and this same HTTP route)
 * and, in the error-recovery spec, to construct a genuine, deterministic
 * `409 CONFLICT`. Real production browsers without WebMCP support (every
 * stock Chromium, confirmed via `WebMcpStatus`'s `adapter.supported()`
 * check -- see `model-context/adapter.ts`'s own header comment: "No runtime
 * WebMCP polyfill ... is added anywhere in this module or task") cannot
 * register `document.modelContext` tools at all, so this is the honest way
 * to exercise "a key WebMCP call" from Playwright without fabricating
 * browser support that does not exist.
 */
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';

import { isNarrowWidth } from '../../../apps/web/src/hooks/width-mode-constants.js';
import { FIRST_RUN_GUIDE_STORAGE_KEY } from '../../../apps/web/src/app/first-run-storage.js';

/**
 * Real, stable car-purchase fixture candidate ids (`packages/scenarios/src/seeds.ts`), in the same
 * order `CaseState.entities` is actually built in (`CAR_PURCHASE_CANDIDATE_IDS.map(...)` there,
 * confirmed directly) -- unlike Home Energy Guardian's id lists below, this array's declared order
 * already matches the real entity order, so it is safe to index directly (e.g. `[0]`/`[1]`) for
 * `OptionCompareView`'s narrow-layout head-to-head selection (see
 * `HOME_ENERGY_RESPONSE_OPTION_ENTITY_ORDER`'s own comment for why that distinction matters).
 */
export const CAR_PURCHASE_CANDIDATE_IDS = [
  'candidate-rav4',
  'candidate-crv',
  'candidate-cx5',
  'candidate-outback',
] as const;

/** Real pack-declared criterion ids the proven scenario trajectory reweights (`apps/agent/src/runtime/car-purchase-scenario.ts`). */
export const CAR_PURCHASE_CRITERION_IDS = {
  drivingComfort: 'pref.driving_comfort',
  ownershipCost: 'pref.ownership_cost',
} as const;

/** Real, stable Home Energy Guardian fixture response-option entity ids (`packages/scenarios/src/seeds.ts` `buildHomeEnergyResponseOptionEntities`; confirmed directly against the real running app). */
export const HOME_ENERGY_RESPONSE_OPTION_IDS = [
  'change-rate-plan',
  'monitor-one-cycle',
  'request-energy-audit',
  'request-hvac-inspection',
] as const;

/**
 * The real order `CaseState.entities` is built in -- `buildHomeEnergyResponseOptionEntities`
 * (`packages/scenarios/src/seeds.ts`) maps directly over `packages/scenarios/fixtures/energy/
 * response-options.json`'s own declared array order, which is `monitor-one-cycle,
 * change-rate-plan, request-energy-audit, request-hvac-inspection` -- distinct from
 * `HOME_ENERGY_RESPONSE_OPTION_IDS` above (an alphabetized convenience listing, not a claim about
 * entity order). This distinction did not matter before `OptionCompareView` existed: the retired
 * `OptionComparison` table rendered every option as a column regardless of order. It matters now
 * because `OptionCompareView`'s narrow-layout head-to-head selection (`pickHeadToHeadOptions`)
 * renders `options.slice(0, 2)` whenever nothing is focused yet (`docs/decisions/
 * 0004-consumer-workspace-information-architecture.md`'s `WorkspaceViewSwitcher`, always mounted
 * with `layout="narrow"` today) -- a test asserting *which two* options the Compare tab shows by
 * default must use this real entity order, not the alphabetized one above.
 */
export const HOME_ENERGY_RESPONSE_OPTION_ENTITY_ORDER = [
  'monitor-one-cycle',
  'change-rate-plan',
  'request-energy-audit',
  'request-hvac-inspection',
] as const;

/** Real pack-declared criterion ids the proven scenario trajectory reweights (`apps/agent/src/runtime/home-energy-guardian-scenario.ts`). */
export const HOME_ENERGY_CRITERION_IDS = {
  cost: 'energy.cost',
  conservation: 'energy.conservation',
} as const;

/** The one obligation id Home Energy Guardian's round-2 investigation targets (`home-energy-engine.ts`'s `determineHomeEnergyRound`; `home-energy-guardian-scenario.ts`'s own round-2 `requestInvestigation` call). See `postRunRequest` below for why this id must be supplied explicitly for round 2. */
export const HOME_ENERGY_RESPONSE_OPTIONS_OBLIGATION_ID = 'energy.response_options';

/**
 * Real, stable Bid Comparison fixture entity ids (`packages/scenarios/src/seeds.ts`
 * `buildBidComparisonEntities`), confirmed directly against the real running app. Unlike
 * `HOME_ENERGY_RESPONSE_OPTION_IDS` above, this array needs no separate "real entity order"
 * export: `buildBidComparisonEntities` maps directly over `BID_FIXTURE_NAMES`
 * (`packages/scenarios/src/tools/bid-reader.ts`), whose own declared order already IS this
 * array's order (`bid-reader.test.ts` pins it) -- so it is safe to index directly (e.g.
 * `[0]`/`[1]`) for `OptionCompareView`'s narrow-layout head-to-head selection, the same way
 * `CAR_PURCHASE_CANDIDATE_IDS` is.
 *
 * Deliberately hand-listed rather than imported from `BID_FIXTURE_NAMES`, exactly like every
 * other id list in this file: the journey spec asserts the real seeded case's entity ids
 * against this array, and an import would make that assertion tautological -- a bid silently
 * dropped from (or added to) the pack would stop being a test failure.
 *
 * The first three are the bids the scripted narrative names individually; the remaining nine
 * are the also-ran bids that make this a realistic twelve-bidder public bid tab.
 */
export const BID_COMPARISON_ENTITY_IDS = [
  'bid-northgate',
  'bid-cedar',
  'bid-tworivers',
  'bid-summit',
  'bid-ironclad',
  'bid-parkside',
  'bid-westbrook',
  'bid-anchor',
  'bid-crestview',
  'bid-fieldstone',
  'bid-brightwater',
  'bid-oldmill',
] as const;

/** Every real obligation id `packages/packs/src/bid-comparison.ts` declares, in the manifest's own declared order. */
export const BID_COMPARISON_OBLIGATION_IDS = [
  'bid.scope_normalization',
  'bid.price_verification',
  'bid.credential_verification',
  'bid.schedule_feasibility',
  'bid.award_recommendation',
] as const;

/** The one obligation id Bid Comparison's `dependsOnCriteria: true` synthesis carries (`packages/packs/src/bid-comparison.ts`) -- the only obligation a criteria reweight may reopen. */
export const BID_COMPARISON_AWARD_RECOMMENDATION_OBLIGATION_ID = 'bid.award_recommendation';

/** Real pack-declared criterion ids `packages/packs/src/bid-comparison.ts`'s `criteria.defaults` carries, including the one protected hard constraint (`bid.credentials_valid`, `protectedCriterionIds`). */
export const BID_COMPARISON_CRITERION_IDS = {
  adjustedTotal: 'bid.adjusted_total',
  scopeCompleteness: 'bid.scope_completeness',
  paymentRisk: 'bid.payment_risk',
  scheduleFit: 'bid.schedule_fit',
  warranty: 'bid.warranty',
  credentialsValid: 'bid.credentials_valid',
} as const;

/**
 * `docs/decisions/0008-two-mode-product-architecture.md`'s narrow/expanded boundary.
 *
 * This was a local `= 480` literal whose comment claimed it mirrored the app's own constant.
 * It did not: when the product's boundary moved to 800, this copy stayed at 480 and six e2e
 * tests started looking for `workspace-expanded-*` testids at the 640px viewport, where the
 * app now correctly renders the narrow layout. The value is imported from the product now, so
 * "mirrors" is enforced by the module graph rather than by a comment.
 *
 * A plain viewport-width check remains a faithful, real-browser equivalent of the app's own
 * `matchMedia` query -- no stubbing needed the way a jsdom component test would.
 */
export { NARROW_MAX_WIDTH_PX } from '../../../apps/web/src/hooks/width-mode-constants.js';

/** The product's real first-run-guide storage key, imported rather than duplicated -- see `seedFirstRunGuideDismissed` below. */
export { FIRST_RUN_GUIDE_STORAGE_KEY };

/**
 * The product's own `PublicActivityEventType` -> consumer label/tone lookup, imported rather than
 * duplicated (matching `NARROW_MAX_WIDTH_PX`/`FIRST_RUN_GUIDE_STORAGE_KEY` above) -- used by
 * `bid-comparison-journey.spec.ts` to assert the real, product-declared "Action blocked" label for
 * `intervention.denied` rather than a copy of that string that could silently drift from
 * `activity-labels.ts`'s own (product.md terminology table, verbatim) mapping.
 */
export { getActivityLabel } from '../../../apps/web/src/components/activity-labels.js';

/** `true` at the narrow/pane-mode viewports (390/430/480/640), `false` at `expanded-820` and `desktop-1440`. */
export function isNarrowLayout(page: Page): boolean {
  return isNarrowWidth(page.viewportSize()?.width ?? 0);
}

/**
 * Marks this browsing context as one that has already been shown the
 * first-run guide, using the product's OWN storage key
 * (`apps/web/src/app/first-run-storage.ts`) rather than a copy of the
 * string -- if the key ever moves, this breaks at compile time instead of
 * silently letting a modal reopen across 144 tests.
 *
 * `addInitScript` runs before any page script on every navigation in this
 * context, including reloads, so a spec that reloads mid-journey
 * (`reload-persistence.spec.ts`) stays seeded too. The `try`/`catch`
 * mirrors the product's own handling: a context with storage disabled must
 * not throw here either.
 */
export async function seedFirstRunGuideDismissed(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    try {
      localStorage.setItem(key, 'seen');
    } catch {
      // Storage unavailable in this context -- the guide will show, which
      // is the product's own documented behaviour there.
    }
  }, FIRST_RUN_GUIDE_STORAGE_KEY);
}

export interface LaunchedCase {
  caseId: string;
}

export interface CustomConcernInput {
  slug: string;
  label: string;
  reason: string;
  valueType?: 'string' | 'number' | 'boolean' | 'enum';
  evidenceExpectation?: 'assertion' | 'verification';
  comparison?: 'none' | 'target' | 'higher_better' | 'lower_better';
}

function randomCommandId(commandName: string): string {
  return `e2e-${commandName}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Issues one real command through the exact HTTP route `SiftCommands`/WebMCP tools use, with a fresh idempotency key. See this file's header comment for why this is the honest way to exercise a "key WebMCP call" from Playwright. */
export async function postCommand(
  request: APIRequestContext,
  caseId: string,
  commandName: string,
  body: Record<string, unknown>,
  commandId: string = randomCommandId(commandName),
): Promise<APIResponse> {
  return request.post(`/api/cases/${encodeURIComponent(caseId)}/commands/${commandName}`, {
    data: { ...body, caseId },
    headers: { 'Idempotency-Key': commandId },
  });
}

/**
 * Issues a real `POST /api/cases/:caseId/run` request -- the exact same
 * route `SiftCommands.requestInvestigation`/the visible "Request
 * investigation" button (`App.tsx`'s `handleRequestInvestigation`) both call
 * -- with an explicit `obligationId`. This is the honest way to drive Home
 * Energy Guardian's round-2 investigation from Playwright: confirmed
 * directly against the real running app, once round 1 satisfies every one
 * of the pack's obligations, there is no longer any *open* obligation left
 * for the generic, no-argument "Request investigation" click to
 * auto-select -- the real server returns a genuine `400`
 * ("No obligation is available to investigate ... No open obligation
 * remains to select") for that click at that point, and `ReadinessPanel` is
 * purely read-only (no per-obligation "investigate" control anywhere in
 * `apps/web/src/components` to target one explicitly). `obligationId` is a
 * real, documented field of the same `RequestInvestigationInput` contract
 * (`sift-client.ts`) the visible control already uses -- this exercises it
 * directly rather than bypassing it, exactly like this file's other
 * `post*` helpers (see this file's header comment). See
 * `home-energy-guardian-journey.spec.ts`'s header comment for the full
 * reasoning and `SiftPage.waitForRecommendationRationaleContains` below for
 * why this path also cannot be awaited through `LiveRunStatus`.
 */
export async function postRunRequest(
  request: APIRequestContext,
  caseId: string,
  body: Record<string, unknown>,
  commandId: string = randomCommandId('run'),
): Promise<APIResponse> {
  return request.post(`/api/cases/${encodeURIComponent(caseId)}/run`, {
    data: { ...body, caseId },
    headers: { 'Idempotency-Key': commandId },
  });
}

/** Reads the real canonical `CaseState` via `GET /api/cases/:caseId` -- the same route the WebMCP `sift_get_case_context` tool's own case data ultimately mirrors. */
export async function getCaseState(
  request: APIRequestContext,
  caseId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`/api/cases/${encodeURIComponent(caseId)}`);
  expect(response.ok(), `GET /api/cases/${caseId} failed with status ${response.status()}`).toBe(
    true,
  );
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Fetches every real `PublicActivityEvent` recorded for `caseId` via the exact
 * `GET /api/cases/:caseId/events?mode=poll` route (`apps/agent/src/routes/events.ts`) the app's
 * own browser uses for its documented polling-fallback transport -- the genuinely public,
 * sanitized activity stream (docs/engineering-principles.md "Persist a replayable sanitized
 * public activity stream ... separately from ... detailed runtime events"), NOT the developer-only
 * `GET /api/debug/runs/:runId` the Runtime Inspector reads.
 *
 * Used in `bid-comparison-journey.spec.ts` to prove a real `intervention.denied` ("Action
 * blocked") landed in this stream. A live DOM assertion cannot do this honestly here: this
 * deterministic test server runs with no `demoPacingMs` (0, matching every other gate in this
 * suite), so a whole six-specialist Swarm round streams and settles in well under 100ms end to
 * end -- confirmed directly against the real running app (`price-analyst`'s `license-lookup`
 * denial and its very next tool call land two sequence numbers apart in the same burst) -- so any
 * live-DOM read of the single most-recent-event region (`LiveRunStatus`) would be racing a
 * sub-100ms transition rather than asserting a real, settled state. This route is the same
 * transport a real polling-fallback browser session would read after the run settles, so it is
 * the honest way to prove the event landed, not a bypass of the real contract.
 */
export async function getPublicActivityEvents(
  request: APIRequestContext,
  caseId: string,
): Promise<Record<string, unknown>[]> {
  const response = await request.get(
    `/api/cases/${encodeURIComponent(caseId)}/events?mode=poll&afterSequence=0`,
  );
  expect(
    response.ok(),
    `GET /api/cases/${caseId}/events?mode=poll failed with status ${response.status()}`,
  ).toBe(true);
  const body = (await response.json()) as { events: Record<string, unknown>[] };
  return body.events;
}

export class SiftPage {
  constructor(readonly page: Page) {}

  /**
   * The standard launch path: a returning visitor, arriving at the
   * launcher.
   *
   * `seedFirstRunGuideDismissed` is what makes it a *returning* visitor.
   * Every spec here runs in a fresh browser context with empty
   * `localStorage`, which is precisely the state `App.tsx` reads as "this
   * person has never seen Sift" -- so without this, `FirstRunGuide` (a
   * modal Radix Dialog) would open over the workspace in every one of this
   * suite's journeys and `aria-hidden` the pane underneath it.
   *
   * Deliberately a seeded storage key and not a build flag, an env var, or
   * a query parameter: the product must have exactly one code path, and a
   * "hide the onboarding" switch that exists only for tests is a behaviour
   * no real user can reach. Writing the same key a real returning visitor
   * already has in their browser exercises the real production branch.
   * `first-run-guide.spec.ts` omits it and drives the genuine first visit,
   * including dismissing the guide through the real UI.
   */
  async open(): Promise<void> {
    await seedFirstRunGuideDismissed(this.page);
    await this.page.goto('/');
    await expect(this.page.getByTestId('demo-launcher')).toBeVisible();
  }

  /**
   * The genuine first visit: no seeded dismissal, so `FirstRunGuide` opens
   * on the first case this context starts. Used only by
   * `first-run-guide.spec.ts`.
   */
  async openAsFirstTimeVisitor(): Promise<void> {
    await this.page.goto('/');
    await expect(this.page.getByTestId('demo-launcher')).toBeVisible();
  }

  /** Dismisses the first-run guide the way a person does -- its own "Got it" button -- and waits for it to actually go. */
  async dismissFirstRunGuide(): Promise<void> {
    await this.page.getByTestId('first-run-guide-dismiss').click();
    await expect(this.page.getByTestId('first-run-guide')).toBeHidden();
  }

  /** Clicks "Choose our next car" and waits for the real `POST /api/cases/demo` response, returning its `caseId`. */
  async launchCarPurchase(): Promise<LaunchedCase> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/cases/demo') && res.request().method() === 'POST',
      ),
      this.page.getByTestId('demo-launcher-car-purchase').click(),
    ]);
    const body = (await response.json()) as { caseId: string };
    await expect(this.page.getByTestId('case-workspace')).toBeVisible();
    return { caseId: body.caseId };
  }

  /** Clicks the primary "Compare vehicles" launcher action (ADR 0003) and waits for the `VehicleCatalogFlow` shell to become visible -- no case exists yet at this point. */
  async openVehicleCatalog(): Promise<void> {
    await this.page.getByTestId('demo-launcher-compare-vehicles').click();
    await expect(this.page.getByTestId('vehicle-catalog-flow')).toBeVisible();
  }

  /**
   * Adds one catalog search result to the shortlist by its exact
   * `data-testid` vehicle id suffix (e.g. `addVehicleToShortlist('veh-...')`
   * for `vehicle-add-veh-...`). Waits for its results-list card to exist
   * first -- the search results are real, debounced, network-driven state,
   * never a fixed sleep.
   *
   * Confirmation is the row's own Add control flipping to its added state,
   * not a shortlist entry: the shortlist is a collapsed bar whose list Radix
   * unmounts until it is expanded, so asserting on `shortlist-item-*` here
   * would force every caller to open the panel just to add a vehicle. Use
   * `expandShortlist()` when the entry itself is the thing under test.
   */
  async addVehicleToShortlist(vehicleId: string): Promise<void> {
    const addButton = this.page.getByTestId(`vehicle-add-${vehicleId}`);
    await expect(addButton).toBeVisible();
    await addButton.click();
    await expect(addButton).toBeDisabled();
    await expect(this.page.getByTestId('vehicle-catalog-shortlist')).toBeVisible();
  }

  /**
   * Opens the shortlist bar's panel, which is where its per-vehicle entries
   * and Remove controls live. Idempotent: already-expanded is a no-op, so a
   * test can call it without tracking the bar's state.
   */
  async expandShortlist(): Promise<void> {
    const trigger = this.page.getByTestId('shortlist-bar-trigger');
    await expect(trigger).toBeVisible();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click();
    }
    await expect(this.page.getByTestId('vehicle-catalog-shortlist-list')).toBeVisible();
  }

  /** Clicks "Start comparison" and waits for the real `POST /api/cases` response, returning its `caseId`. The subsequent per-vehicle `upsertOption` calls happen after this resolves; callers that need to wait for the full case body should also wait for `case-workspace`. */
  async startVehicleComparison(): Promise<LaunchedCase> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => new URL(res.url()).pathname === '/api/cases' && res.request().method() === 'POST',
      ),
      this.page.getByTestId('vehicle-catalog-start-comparison').click(),
    ]);
    const body = (await response.json()) as { caseId: string };
    await expect(this.page.getByTestId('case-workspace')).toBeVisible();
    return { caseId: body.caseId };
  }

  /**
   * Clicks "Investigate my energy bill" and waits for the real
   * `POST /api/cases/energy-bill-feed-check` response -- the deterministic
   * bill-feed gate this button always goes through now, not
   * `POST /api/cases/demo` directly (`DemoLauncher.tsx`'s own header
   * comment). Its success body is an `EnergyBillFeedCheckResult`, so the
   * `caseId` this returns comes from `body.receipt.caseId`, not a bare
   * top-level field -- the default click's real 42%-above-baseline fixture
   * always clears the threshold and opens a case, so `receipt` is always
   * present here.
   */
  async launchHomeEnergyGuardian(): Promise<LaunchedCase> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          res.url().includes('/api/cases/energy-bill-feed-check') &&
          res.request().method() === 'POST',
      ),
      this.page.getByTestId('demo-launcher-home-energy-guardian').click(),
    ]);
    const body = (await response.json()) as { receipt?: { caseId: string } };
    if (body.receipt === undefined) {
      throw new Error(
        'launchHomeEnergyGuardian: the bill-feed gate did not open a case (unexpected -- the default click always uses the anomalous fixture).',
      );
    }
    await expect(this.page.getByTestId('case-workspace')).toBeVisible();
    return { caseId: body.receipt.caseId };
  }

  /**
   * Clicks "Compare these bids" and waits for the real `POST /api/cases/demo` response, returning
   * its `caseId`. Structurally identical to `launchCarPurchase` above -- `bid-comparison` goes
   * through the same plain `startDemo` path `DemoLauncher.tsx`'s own header comment describes;
   * only `home-energy-guardian` diverts through the deterministic bill-feed gate.
   */
  async launchBidComparison(): Promise<LaunchedCase> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) => res.url().includes('/api/cases/demo') && res.request().method() === 'POST',
      ),
      this.page.getByTestId('demo-launcher-bid-comparison').click(),
    ]);
    const body = (await response.json()) as { caseId: string };
    await expect(this.page.getByTestId('case-workspace')).toBeVisible();
    return { caseId: body.caseId };
  }

  /**
   * Clicks "Request investigation" and returns the real `runId` from the
   * successful `POST /api/cases/:caseId/run` response, so a caller can
   * unambiguously wait for *this* run (not a stale "Completed" left over
   * from an earlier one) via `waitForInvestigationCompleted`.
   *
   * Waits specifically for an *ok* response, not merely a matching URL:
   * `App.tsx`'s `handleRequestInvestigation` automatically retries once on
   * a real `409 CONFLICT` (a genuine, expected race in the real-time
   * system -- the browser's SSE-delivered `eventSequence` can be one event
   * behind the server the instant this control is pressed), so the first
   * response on this URL is not always the one that actually carries a
   * `runId`.
   */
  async requestInvestigation(): Promise<{ runId: string }> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (res) =>
          /\/api\/cases\/[^/]+\/run$/.test(res.url()) &&
          res.request().method() === 'POST' &&
          res.ok(),
      ),
      this.page.getByTestId('request-investigation').click(),
    ]);
    const body = (await response.json()) as { runId: string };
    return { runId: body.runId };
  }

  /**
   * Waits for run `runId` to reach a real terminal "completed" status, then
   * confirms the browser's own live status region reflects it too.
   *
   * This method used to poll `live-run-status-run-id`'s own text content
   * specifically so a stale "Completed" phase left over from a *previous*
   * run (round 1, while this method is really waiting on round 2) could
   * never satisfy the wait. `docs/decisions/
   * 0004-consumer-workspace-information-architecture.md` decision item 3
   * removed that text from the DOM entirely -- `LiveRunStatus.tsx` no longer
   * renders `commandId`/`runId` as visible text at all (both are
   * Developer-view-only content now; see that component's own header
   * comment) -- so there is nothing left to read to disambiguate one run's
   * "Completed" badge from another's by text alone.
   *
   * The honest, unambiguous replacement: `GET /api/debug/runs/:runId`
   * (`apps/agent/src/routes/debug.ts`) is the exact same real HTTP route the
   * Runtime Inspector's own `useRuntimeInspector` hook calls, keyed
   * unambiguously by the real `runId` this method already receives -- no
   * DOM-visible identifier is needed to correlate it correctly, which is a
   * *stronger* correlation guarantee than the removed text ever was, not a
   * weaker stand-in for it. Once the server confirms this exact run reached
   * a terminal state, this also waits for the UI's own `live-run-status-
   * phase` text to catch up to "Completed" -- still a real, observable
   * proof that the browser's live SSE subscription reflects it, not merely
   * that the server-side record does.
   */
  async waitForInvestigationCompleted(runId: string): Promise<void> {
    await expect
      .poll(
        async () => {
          // A transient transport failure is not an answer about the run, so
          // it is treated the same way a non-ok response already is: return
          // null and let the poll ask again. Without this the whole spec died
          // on a single `read ECONNRESET` against this debug route while the
          // full suite ran four workers in parallel -- a connection the
          // server dropped under load, reported as though the investigation
          // had failed. This is deliberately NOT a blanket catch that hides a
          // real problem: the poll still fails after its 30s ceiling with the
          // message below, and the UI assertion that follows still has to
          // pass on its own. It is the same lesson as the 409 that a
          // `response.ok()` filter once hid behind a 30-second timeout --
          // report the real cause, retry only what is genuinely transient.
          let response;
          try {
            response = await this.page.request.get(`/api/debug/runs/${encodeURIComponent(runId)}`);
          } catch {
            return null;
          }
          if (!response.ok()) return null;
          const body = (await response.json()) as { overview: { status: string } };
          return body.overview.status;
        },
        { timeout: 30_000, message: `run "${runId}" did not reach "completed" status in time` },
      )
      .toBe('completed');

    await expect(this.page.getByTestId('live-run-status-phase')).toHaveText(/completed/i, {
      timeout: 30_000,
    });
  }

  async waitForRecommendationReady(): Promise<void> {
    await expect(this.page.getByTestId('recommendation-card-status')).toContainText(
      'Ready for review',
      {
        timeout: 30_000,
      },
    );
  }

  /**
   * Waits for `RecommendationCard` to report "Ready for review" again with a
   * rationale containing `expectedSubstring` -- the honest, real,
   * SSE-driven completion signal for an investigation issued through
   * `postRunRequest` rather than a browser click. `waitForInvestigationCompleted`
   * above cannot be used for that case: its final UI-observable check reads
   * `live-run-status-phase`, which reflects `App.tsx`'s `liveRunStatusReceipt`
   * (`lastRunReceipt ?? derivedRunReceipt`) -- `lastRunReceipt` is
   * client-local React state only ever set inside `handleRequestInvestigation`
   * from `commands.requestInvestigation(...).then(...)` (the browser-click
   * path), and it takes priority over `derivedRunReceipt` once set. A run
   * requested directly over HTTP, outside that call (this file's
   * `postRunRequest`), never touches `lastRunReceipt` -- so once an earlier
   * browser-click run has set it once this session, `LiveRunStatus` stays
   * correlated to *that* run's `runId` and never transitions to reflect a
   * later `postRunRequest`-issued run at all (confirmed directly against the
   * real running app). The recommendation card, by contrast, is driven
   * purely from the canonical `CaseState` snapshot streamed over SSE,
   * exactly like the criteria-reweight step every journey spec already
   * exercises -- this is genuinely the same "no click, no reload, reflected
   * live" proof, not a weaker substitute for it.
   */
  async waitForRecommendationRationaleContains(expectedSubstring: string): Promise<void> {
    await expect(this.page.getByTestId('recommendation-card-status')).toContainText(
      'Ready for review',
      { timeout: 30_000 },
    );
    await expect(this.page.getByTestId('recommendation-card-rationale')).toContainText(
      expectedSubstring,
      { timeout: 30_000 },
    );
  }

  /**
   * Opens a closed-by-default `DisclosureSection` row (ADR 0002, round-2
   * design review: "answer-first, everything else one tap away") by its
   * `testId` suffix, e.g. `openDisclosure('decision-profile')` for
   * `disclosure-decision-profile`. A no-op if the row is already open
   * (native `<details>` state, checked directly rather than assumed).
   *
   * ADR 0008 (`docs/decisions/0008-two-mode-product-architecture.md`)
   * dismantled the bottom-of-page disclosure stack into differentiated
   * top-of-page chrome: "Manage options" (`disclosure-options`) no longer
   * exists in EITHER layout -- see `openManageOptionsSheet` below -- and
   * "What Sift found" (`disclosure-findings`) no longer exists either -- see
   * `openFindingsSheet` below. `disclosure-add-note` and
   * `disclosure-add-concern` are gone too: both are app-bar create-menu
   * items now, in both layouts (see `openViaCreateMenu`). What survives is
   * `disclosure-decision-profile`, and only in pane/narrow mode; at expanded
   * width the same content moved into a main-column toolbar Sheet with no
   * disclosure counterpart at all, which is why `openDecisionProfile` below
   * is the one helper here that still needs a layout branch. Callers that
   * must work in both layouts use it rather than calling this method
   * directly.
   */
  async openDisclosure(testId: string): Promise<void> {
    const details = this.page.getByTestId(`disclosure-${testId}`);
    const isOpen = await details
      .evaluate((el) => (el as HTMLDetailsElement).open)
      .catch(() => false);
    if (!isOpen) {
      await this.page.getByTestId(`disclosure-${testId}-summary`).click();
    }
    await expect(details).toHaveJSProperty('open', true);
  }

  /** The `openDisclosure` counterpart -- closes a `DisclosureSection` row if it is currently open. A no-op otherwise. */
  async closeDisclosure(testId: string): Promise<void> {
    const details = this.page.getByTestId(`disclosure-${testId}`);
    const isOpen = await details
      .evaluate((el) => (el as HTMLDetailsElement).open)
      .catch(() => false);
    if (isOpen) {
      await this.page.getByTestId(`disclosure-${testId}-summary`).click();
    }
    await expect(details).toHaveJSProperty('open', false);
  }

  /**
   * Selects one tab of `WorkspaceViewSwitcher` -- Quick Pick / List / Compare
   * / Board (`docs/decisions/0004-consumer-workspace-information-architecture.md`
   * decision item 5) -- and waits for that tab's own content region to
   * become visible. Unlike `openDisclosure`, this region is always
   * expanded, never a disclosure row; it renders directly below
   * `RecommendationHero` in both layouts (ADR 0008 moved "Manage options"
   * and "What Sift found" into the app bar/alert banner above it, but never
   * touched this switcher's own position).
   */
  async selectWorkspaceView(mode: 'quick_pick' | 'list' | 'compare' | 'board'): Promise<void> {
    await this.page.getByTestId(`workspace-view-tab-${mode}`).click();
    await expect(this.page.getByTestId(`workspace-view-content-${mode}`)).toBeVisible();
  }

  /**
   * Opens a Sheet by clicking its named trigger, unless it is already open.
   * Every Sheet in this app is a real modal dialog (Radix `Dialog`,
   * focus-trapped, with a blocking overlay): once open, its own trigger
   * control usually sits BEHIND that overlay (e.g. `WorkspaceAppBar`'s "Add
   * option" button, or the main-column toolbar buttons `openDecisionProfile`/
   * `openNotes`/`openAddConcern` use), so a plain unconditional `.click()`
   * would fail its own actionability check the second time a caller opens
   * the same Sheet in one test (e.g. `submitCustomConcern`'s retry path in
   * `error-recovery.spec.ts`, called after an earlier `fillAndSubmitCustomConcern`
   * left the Sheet open). Checking first, exactly like `openDisclosure`
   * already does for `<details>`, makes every `open*` method below safe to
   * call repeatedly.
   */
  private async openSheetVia(triggerTestId: string, sheetTestId: string): Promise<void> {
    const sheet = this.page.getByTestId(sheetTestId);
    if (await sheet.isVisible().catch(() => false)) return;
    await this.page.getByTestId(triggerTestId).click();
    await expect(sheet).toBeVisible();
  }

  /** The `openSheetVia` counterpart -- closes a Sheet via its own close control, unless it is already closed. */
  private async closeSheet(sheetTestId: string): Promise<void> {
    const sheet = this.page.getByTestId(sheetTestId);
    if (!(await sheet.isVisible().catch(() => false))) return;
    await this.page.getByTestId('sheet-close').click();
    await expect(sheet).not.toBeVisible();
  }

  /**
   * Opens a Sheet reached through `WorkspaceAppBar`'s create menu.
   *
   * "Add option", "Add a note" and "Add a question" used to be three separate
   * surfaces: a direct app-bar button for the first, and for the other two a
   * `disclosure-add-note`/`disclosure-add-concern` row in pane mode with a
   * main-column toolbar button (`workspace-expanded-open-*`) in web-app mode.
   * The project owner asked for the two create actions to leave the bottom of
   * the content stack ("Add a note and add a question should be in either the
   * header or footer toolbars - not at the bottom of the stack") and for the
   * header to collapse into one row using menus. All three now live in one
   * `DropdownMenu` on the app bar.
   *
   * That removes the layout branch these helpers used to carry: the app bar
   * is global chrome mounted once, above the narrow/expanded split, so this
   * is identical at every viewport -- the same reason `openFindingsSheet`
   * never needed one.
   *
   * The menu is dismissed by its own item activation, but the resulting Sheet
   * is a focus-trapped modal whose overlay then covers the trigger, so the
   * already-open check `openSheetVia` documents applies here too.
   *
   * Opening is a confirmed toggle, not a fire-and-forget click, and that is
   * the one thing this helper does that `openSheetVia` does not need to.
   * Observed once, at `right-pane-430`, as a 120-second hang: the previous
   * step had just closed the Findings Sheet, and the trigger press that
   * followed never opened the menu at all (the failure screenshot shows the
   * normal workspace -- no menu, no sheet, nothing mid-transition). A Radix
   * `Dialog` returns focus to its own trigger and lifts the
   * `pointer-events: none` guard it puts on `document.body` in a cleanup
   * effect that runs after `not.toBeVisible()` is already satisfiable, so a
   * press landing inside that window can be swallowed. The old code then
   * waited out the entire test budget for a menu item whose menu had never
   * opened.
   *
   * `toPass` presses again if the menu did not appear, which is exactly what
   * a person does with a button that did not take. It cannot mask a genuinely
   * missing control: a trigger or menu that never renders still fails, and
   * the item click and Sheet assertion below are unchanged.
   */
  private async openViaCreateMenu(itemTestId: string, sheetTestId: string): Promise<void> {
    const sheet = this.page.getByTestId(sheetTestId);
    if (await sheet.isVisible().catch(() => false)) return;
    const trigger = this.page.getByTestId('workspace-app-bar-create-menu');
    const menu = this.page.getByTestId('workspace-app-bar-create-menu-content');
    await expect(async () => {
      if (!(await menu.isVisible().catch(() => false))) {
        // Settle to a known-closed state before clicking. Without this, a
        // menu that was merely SLOW to open (contended machine, 2s inner
        // timeout) is misread as "did not open", and the retry's click
        // toggles shut the menu the first click had just opened -- leaving
        // the open/closed state a function of how many retries happened to
        // run. That is the race behind the intermittent
        // `awaiting-approval` screenshot failures, where the dropdown is
        // captured hanging open over the recommendation: the assertion that
        // the menu is hidden after the reweight genuinely passes, and a
        // still-in-flight toggle from an earlier retry reopens it
        // afterwards. Escape on an already-closed menu is a no-op.
        await this.page.keyboard.press('Escape');
        await expect(menu).toBeHidden({ timeout: 2_000 });
        await trigger.click();
      }
      // 5s, not 2s: long enough that a slow open is waited out rather than
      // retried into a toggle.
      await expect(menu).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 20_000 });
    await this.page.getByTestId(itemTestId).click();
    await expect(sheet).toBeVisible();
  }

  /**
   * Opens the "Add option" Sheet (ADR 0008; supersedes the retired "Manage
   * options" disclosure) via `WorkspaceAppBar`'s always-present "Add option"
   * control. Identical in both layouts -- the app bar is global chrome
   * mounted once, above the narrow/expanded split, so unlike
   * `openDecisionProfile`/`openNotes`/`openAddConcern` below this needs no
   * layout branch.
   *
   * Unlike the old inline disclosure, this Sheet is a real modal and is NOT
   * safe to leave open across unrelated steps of a journey (a later click
   * on, say, "Request investigation" would be intercepted by the overlay).
   * Callers open it immediately before the `OptionEditor` content they need
   * and close it again with `closeManageOptionsSheet` before continuing.
   */
  async openManageOptionsSheet(): Promise<void> {
    await this.openViaCreateMenu('workspace-app-bar-add-option', 'workspace-add-option-sheet');
  }

  /** The `openManageOptionsSheet` counterpart -- closes the Sheet via its own close control. */
  async closeManageOptionsSheet(): Promise<void> {
    await this.closeSheet('workspace-add-option-sheet');
  }

  /**
   * Opens the filter Sheet (ADR 0009) from the `FilterBar`'s always-visible
   * "Filters" control.
   *
   * Needs no layout branch, and that is the entire point of the ADR: the
   * filter surface is global chrome mounted once above the narrow/expanded
   * split, exactly like the app bar. Its predecessor lived inside
   * `WorkspaceSidebar`, which renders `null` below 481px, so this capability
   * did not exist in pane mode at all.
   *
   * A real modal -- not safe to leave open across unrelated steps, for the
   * same overlay-interception reason `openManageOptionsSheet` documents.
   * This project has already lost 120 seconds of a desktop-1440 run to
   * exactly that mistake with a different sheet.
   */
  async openFilterSheet(): Promise<void> {
    await this.openSheetVia('workspace-filter-open', 'workspace-filter-sheet');
  }

  /** The `openFilterSheet` counterpart -- closes the Sheet via its own close control. */
  async closeFilterSheet(): Promise<void> {
    await this.closeSheet('workspace-filter-sheet');
  }

  /**
   * Opens one option's detail profile (ADR 0010) from a browse card's
   * "View details" control.
   *
   * The human counterpart to the `sift_get_option_details` WebMCP tool,
   * which had been handing ChatGPT a complete per-option profile that no
   * screen showed. Layout-independent for the same reason the filter sheet
   * is: mounted once as global chrome above the narrow/expanded split.
   */
  async openOptionProfile(optionId: string): Promise<void> {
    await this.openSheetVia(`option-card-open-profile-${optionId}`, 'option-profile-sheet');
  }

  /** The `openOptionProfile` counterpart -- closes the Sheet via its own close control. */
  async closeOptionProfile(): Promise<void> {
    await this.closeSheet('option-profile-sheet');
  }

  /**
   * Opens the "your priorities" content -- the FULL `DecisionProfileView`
   * (including `personalConcerns`/`missing`/`suggestedQuestions`, which
   * `WorkspaceSidebar`'s own cut-down priorities list excludes) -- and
   * returns a `Locator` scoped to whichever container now holds it, so
   * callers can query inside it (e.g. for a specific `li`) without caring
   * which layout rendered it.
   *
   * Layout-aware (ADR 0008): pane mode (<=480px) keeps the pre-existing
   * `disclosure-decision-profile` row; web-app mode (>480px) has no such
   * disclosure at all -- the same content is reached only through the
   * main-column toolbar's "Your priorities" button, which opens a Sheet.
   */
  async openDecisionProfile(): Promise<Locator> {
    if (isNarrowLayout(this.page)) {
      await this.openDisclosure('decision-profile');
      return this.page.getByTestId('disclosure-decision-profile');
    }
    await this.openSheetVia(
      'workspace-expanded-open-decision-profile',
      'workspace-decision-profile-sheet',
    );
    return this.page.getByTestId('workspace-decision-profile-sheet');
  }

  /** The `openDecisionProfile` counterpart. A no-op in pane mode's disclosure form (matching `closeDisclosure`'s own idempotence) since leaving that row open is harmless there -- only web-app mode's Sheet is a real modal that must be closed before an unrelated control elsewhere on the page can be clicked. */
  async closeDecisionProfile(): Promise<void> {
    if (isNarrowLayout(this.page)) {
      await this.closeDisclosure('decision-profile');
      return;
    }
    await this.closeSheet('workspace-decision-profile-sheet');
  }

  /**
   * Opens "Decision readiness" (`ReadinessPanel`) -- pane mode's pre-existing
   * `disclosure-still-checking` row, or web-app mode's Sheet, reached through
   * `WorkspaceSidebar`'s own `workspace-sidebar-still-checking-button` trigger (`onOpenQuestions`).
   * The identical layout branch `openDecisionProfile` above documents, for the identical reason:
   * ADR 0008 kept the narrow disclosure in place but moved the same content behind a Sheet-opening
   * button in the wider shell rather than a second inline disclosure.
   */
  async openReadiness(): Promise<Locator> {
    if (isNarrowLayout(this.page)) {
      await this.openDisclosure('still-checking');
      return this.page.getByTestId('disclosure-still-checking');
    }
    await this.openSheetVia(
      'workspace-sidebar-still-checking-button',
      'workspace-still-checking-sheet',
    );
    return this.page.getByTestId('workspace-still-checking-sheet');
  }

  /** The `openReadiness` counterpart -- see `closeDecisionProfile` above for why only the Sheet form is a real modal that must be closed before an unrelated control elsewhere on the page can be clicked. */
  async closeReadiness(): Promise<void> {
    if (isNarrowLayout(this.page)) {
      await this.closeDisclosure('still-checking');
      return;
    }
    await this.closeSheet('workspace-still-checking-sheet');
  }

  /**
   * Opens the notes region (`CaseNotes` + `AddNoteForm`) -- the create
   * menu's "Add a note" item, so identical at every viewport, unlike
   * `openDecisionProfile` above.
   *
   * `AddNoteForm` is mounted in exactly one place, so its own
   * `#add-note-form-body`/`add-note-form-submit`/`add-note-form-success` are
   * safe global lookups once this has opened the Sheet that contains them.
   * `CaseNotes`' `case-notes` is NOT: at narrow widths the pane's content
   * stack renders one inline and this Sheet renders a second, so while it is
   * open the document genuinely holds two. Callers reading notes back scope
   * to `workspace-notes-sheet` (see `generic-decision-workspace-journey.spec.ts`).
   */
  async openNotes(): Promise<void> {
    await this.openViaCreateMenu('workspace-app-bar-add-note', 'workspace-notes-sheet');
  }

  /** The `openNotes` counterpart -- closes the Sheet via its own close control, and a no-op if it is already closed. Required before any click elsewhere on the page: this is a real modal at every viewport now, not a disclosure that was harmless to leave open in pane mode. */
  async closeNotes(): Promise<void> {
    await this.closeSheet('workspace-notes-sheet');
  }

  /**
   * Opens the "Add a question" / custom-concern region
   * (`workspace-add-concern-sheet`, holding `CustomConcernForm` plus any
   * pending `CaseExtensionReviewCard`) -- the create menu's third item, so
   * again identical at every viewport.
   *
   * Always safe to call regardless of pending-extension state, and safe to
   * call twice: `openViaCreateMenu` returns early when the Sheet is already
   * open, which `error-recovery.spec.ts`'s retry path depends on.
   */
  async openAddConcern(): Promise<void> {
    await this.openViaCreateMenu('workspace-app-bar-add-concern', 'workspace-add-concern-sheet');
  }

  /** Opens the "Adjust priorities" Sheet (`CriteriaEditor`) via the app bar's create menu, identically at every viewport. */
  async openPriorities(): Promise<void> {
    await this.openViaCreateMenu('workspace-app-bar-priorities', 'workspace-priorities-sheet');
  }

  /**
   * Reweights criteria through the real control a person uses, and waits for
   * the command the page itself issues.
   *
   * Specs used to reweight by POSTing `updateCriteria` out of band, because
   * no criteria UI existed. That left the page's cached snapshot behind the
   * case it was about to write to, and the next UI write raced it: the
   * catalog journey failed roughly one run in three with a 409 on an
   * unrelated `defineCaseAttribute`. Driving the reweight through the page
   * removes the out-of-band mutation, so there is no divergence to race.
   */
  async reweightCriteria(weights: Record<string, number>): Promise<void> {
    await this.openPriorities();
    for (const [criterionId, weight] of Object.entries(weights)) {
      await this.page.getByTestId(`criteria-editor-weight-${criterionId}`).fill(String(weight));
    }
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/commands/updateCriteria') &&
        response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await this.page.getByTestId('criteria-editor-save').click();
    const response = await responsePromise;
    if (!response.ok()) {
      throw new Error(
        `updateCriteria was rejected with ${String(response.status())}: ${(
          await response.text()
        ).slice(0, 400)}`,
      );
    }
    await expect(this.page.getByTestId('workspace-priorities-sheet')).toBeHidden();
    // The Sheet closing is not the end of the interaction. "Adjust
    // priorities" is reached through the app bar's "Add or adjust" dropdown,
    // and Radix returns focus to that trigger when the Sheet unmounts. Under
    // a loaded run (the full suite uses four workers) the menu could still be
    // painted when the next screenshot was taken, which is exactly how this
    // surfaced: `awaiting-approval.png` failed in the full e2e stage with the
    // menu covering the recommendation, while the same spec passed three for
    // three in isolation. Waiting on the menu's real dismissal -- not a
    // sleep, and not a retry around the screenshot -- removes the race at its
    // source, the same way `reweightCriteria` itself replaced the out-of-band
    // POST that used to race the page's cached snapshot.
    await expect(this.page.getByTestId('workspace-app-bar-create-menu-content')).toBeHidden();
  }

  /** The `openAddConcern` counterpart -- see `closeNotes` above for why closing is no longer optional in pane mode. */
  async closeAddConcern(): Promise<void> {
    await this.closeSheet('workspace-add-concern-sheet');
  }

  /** Opens findings from the expanded app bar or, in the guided narrow pane, its Analysis stage. Both controls open the same sheet. */
  async openFindingsSheet(): Promise<void> {
    const appBarTrigger = this.page.getByTestId('workspace-app-bar-findings');
    let triggerTestId = 'workspace-app-bar-findings';
    if (!(await appBarTrigger.isVisible().catch(() => false))) {
      const analysisTrigger = this.page.getByTestId('case-stage-analysis-open-findings');
      if (!(await analysisTrigger.isVisible().catch(() => false))) {
        const stepper = this.page.getByTestId('case-workflow-stepper');
        await stepper.getByTestId('case-workflow-stepper-toggle').click();
        await stepper.getByRole('button', { name: /^Analysis, / }).click();
      }
      triggerTestId = 'case-stage-analysis-open-findings';
    }
    await this.openSheetVia(triggerTestId, 'findings-sheet');
  }

  /** Fills and submits `CustomConcernForm` without asserting the outcome -- used directly by tests that expect a real error (`error-recovery.spec.ts`); `submitCustomConcern` below is the success-asserting convenience wrapper every other spec uses. Opens the layout-appropriate "Add a question" region first via `openAddConcern` (ADR 0008). */
  async fillAndSubmitCustomConcern(input: CustomConcernInput): Promise<void> {
    await this.openAddConcern();
    const form = this.page.getByTestId('custom-concern-form');
    await form.getByLabel('Concern id').fill(input.slug);
    await form.getByLabel('Label', { exact: true }).fill(input.label);
    if (input.valueType) await form.getByLabel('Value type').selectOption(input.valueType);
    if (input.evidenceExpectation) {
      await form.getByLabel('Evidence expectation').selectOption(input.evidenceExpectation);
    }
    if (input.comparison) await form.getByLabel('Comparison').selectOption(input.comparison);
    await form.getByLabel('Why this matters to you').fill(input.reason);
    await form.getByTestId('custom-concern-form-submit').click();
  }

  /**
   * The visible-control equivalent of `sift_define_case_attribute`
   * (`CustomConcernForm.tsx`). A `user`-origin submission is auto-confirmed
   * server-side (`packages/core/src/extensions.ts`), so no separate
   * confirmation step is required afterward.
   *
   * Two real, ordered waits, not one -- observed once flaking under
   * full-suite 8-worker parallelism (`vehicle-catalog-journey` at
   * `right-pane-390`, standalone and full-suite re-runs both green
   * afterward: genuine contention, not a logic race). `CustomConcernForm`'s
   * `success` state (read from `custom-concern-form-success`) is set only
   * inside `commands.defineCaseAttribute(...).then(...)`, i.e. strictly
   * after `POST /api/cases/:caseId/commands/defineCaseAttribute`
   * (`api/sift-client.ts`) resolves -- and, once set, stays visible (no
   * auto-hide/timeout clears it; confirmed by reading the component) until
   * a later submission. So the real risk under contention is not the
   * banner disappearing before Playwright observes it -- it is the whole
   * request-to-render chain (server round trip + React commit) taking
   * longer than a short default assertion timeout. `responsePromise` is
   * armed *before* `fillAndSubmitCustomConcern` performs the click (so it
   * cannot miss a response that lands before it would otherwise start
   * listening) and awaited first: a real, bounded wait on the literal
   * network completion of the command this banner depends on, giving a
   * precise "the server never answered in time" failure instead of a
   * generic "the banner never appeared" one when the server side is what is
   * actually slow under load. The banner visibility check itself keeps its
   * full assertion (exact `data-testid`, still required to appear) with a
   * longer bound to match -- neither wait replaces or weakens the other.
   */
  async submitCustomConcern(input: CustomConcernInput): Promise<void> {
    // Deliberately NOT filtered on `response.ok()`.
    //
    // Requiring a 2xx here meant a REJECTED write matched nothing, so the
    // wait ran its full 30s and reported "the server never answered" about a
    // server that had answered immediately and said no. That is the single
    // most misleading shape a test failure can take: it sends whoever reads
    // it looking at latency when the actual answer is a status code, and it
    // costs 30 seconds per occurrence to say nothing.
    //
    // Matching any response to this endpoint and asserting the status
    // afterwards keeps exactly the same guarantee and turns a blind timeout
    // into the real reason.
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/commands/defineCaseAttribute') &&
        response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await this.fillAndSubmitCustomConcern(input);
    const response = await responsePromise;
    if (!response.ok()) {
      throw new Error(
        `defineCaseAttribute was rejected with ${String(response.status())}: ${(
          await response.text()
        ).slice(0, 400)}`,
      );
    }
    await expect(
      this.page.getByTestId('custom-concern-form').getByTestId('custom-concern-form-success'),
    ).toBeVisible({ timeout: 30_000 });
  }

  async approveProposal(): Promise<void> {
    await this.page.getByTestId('approval-card-approve').click();
    await expect(this.page.getByTestId('approval-card-stamp')).toContainText('Approved');
  }
}
