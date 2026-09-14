/**
 * Stage 1 of the demo video: drive the real bid-comparison workflow once, in
 * one continuous take, and write down exactly when each beat happened.
 *
 * This records; it does not assert. `tests/e2e/bid-comparison-journey.spec.ts`
 * is what proves the flow works, at six viewports, against baselines. If a
 * selector here goes stale the recording looks wrong and this script says so,
 * but the gate that fails a bad build is the e2e suite, not this file.
 *
 * Two things about the capture that were established by measurement, not
 * assumption:
 *
 *  - `--force-device-scale-factor=2` with a 480x940 viewport and a 960x1880
 *    `recordVideo.size` yields a *crisp* 960x1880 recording of the real
 *    480px right-pane layout. Without that flag the same size setting
 *    composites a 480-wide frame into a 960-wide canvas and leaves the rest
 *    grey -- Playwright never upscales.
 *  - Beat 8's footage is recorded out of order, immediately after round one.
 *    The Runtime Inspector shows the *latest* run, and by the end of the
 *    journey that is round two, a short synthesis-only pass. The run with the
 *    whole Swarm in it is round one, so it has to be filmed before the
 *    reweight starts another. `render.ts` puts it back in narration order.
 *
 * Run against a server started separately with SIFT_DEMO_PACING_MS=2000, which
 * stretches the six-specialist investigation to about a minute of real time so
 * there is something to point a camera at. Pacing changes wall-clock only:
 * identical events, counts and ordering.
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, TAKE_DIR, type Mark, type Timeline } from './manifest.js';

const PORT = process.env['SIFT_CAPTURE_PORT'] ?? '8099';
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME =
  process.env['SIFT_CHROME_PATH'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The canonical right-pane width. A maximized desktop window misrepresents this product. */
const VIEWPORT = { width: 480, height: 940 } as const;
const VIDEO_SIZE = { width: 960, height: 1880 } as const;
const SCROLLER = '[data-testid="case-workspace-scroll"]';

const manifest = loadManifest();
const marks: Mark[] = [];
const observed: Record<string, string> = {};
let t0 = 0;

const now = (): number => Date.now() - t0;
const stamp = (): string => `${(now() / 1000).toFixed(1)}s`;

function beginBeat(id: string): void {
  marks.push({ id, startMs: now(), endMs: now() });
  console.log(`[${stamp()}] begin ${id}`);
}

function endBeat(): void {
  const open = marks[marks.length - 1];
  if (open === undefined) throw new Error('endBeat called before beginBeat');
  marks[marks.length - 1] = { ...open, endMs: now() };
  console.log(`[${stamp()}] end   ${open.id} (${((now() - open.startMs) / 1000).toFixed(1)}s)`);
}

async function hold(page: Page, seconds: number): Promise<void> {
  await page.waitForTimeout(seconds * 1000);
}

/**
 * Every in-page snippet below is handed to Playwright as a *string*, not as a
 * function. tsx compiles with esbuild's `keepNames`, which rewrites named inner
 * functions to call a `__name` helper that exists in Node and not in the page;
 * a serialized closure containing one dies on `ReferenceError: __name is not
 * defined`. A string is never compiled, so it cannot carry the helper.
 */
/**
 * Eases the workspace's inner scroller between two positions over a real
 * duration, so the footage has motion in it rather than a series of jump cuts.
 * The page scroller is not the one that moves; this container is.
 */
async function glide(page: Page, from: number, to: number, seconds: number): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    var el = document.querySelector('${SCROLLER}');
    if (!el) { resolve(); return; }
    var began = performance.now();
    var tick = function () {
      var p = Math.min(1, (performance.now() - began) / ${String(seconds * 1000)});
      var eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      el.scrollTop = ${String(from)} + (${String(to)} - ${String(from)}) * eased;
      if (p < 1) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  })`);
}

async function jump(page: Page, top: number): Promise<void> {
  await page.evaluate(
    `(function () { var el = document.querySelector('${SCROLLER}');
       if (el) el.scrollTop = ${String(top)}; })()`,
  );
  await page.waitForTimeout(350);
}

async function closeAnySheet(page: Page): Promise<void> {
  const close = page.getByTestId('sheet-close');
  if ((await close.count()) > 0 && (await close.first().isVisible())) {
    await close.first().click();
    await page.waitForTimeout(600);
  }
}

/** Moves the workflow stepper to a named step; the view tabs and the pending proposal live on different ones. */
async function goToStep(page: Page, step: 'analysis' | 'review' | 'decide'): Promise<void> {
  const toggle = page.getByTestId('case-workflow-stepper-toggle');
  if ((await toggle.count()) === 0) return;
  await toggle.click();
  await page.waitForTimeout(700);
  const target = page.getByTestId(`case-workflow-step-${step}`);
  if ((await target.count()) > 0) {
    await target.click();
    await page.waitForTimeout(1_200);
  }
}

/**
 * Centres an element rather than merely bringing it into view.
 * `scrollIntoViewIfNeeded` parks a target hard against the top edge, which put
 * beat 7's approval control -- the one human-only action in the whole demo --
 * just above the fold for the length of the beat.
 */
async function centre(page: Page, testId: string): Promise<boolean> {
  // Deliberately not `scrollIntoView`: that scrolls every scrollable ancestor,
  // including the document, which shifted the whole pane up and sheared the
  // app bar off the top of the frame. Moving only the workspace container
  // leaves the chrome where it belongs.
  const found = await page.evaluate<boolean>(
    `(function () {
       var el = document.querySelector('[data-testid="${testId}"]');
       var box = document.querySelector('${SCROLLER}');
       if (!el || !box) return false;
       var e = el.getBoundingClientRect(), b = box.getBoundingClientRect();
       box.scrollTop += (e.top - b.top) - (b.height - e.height) / 2;
       return true;
     })()`,
  );
  await page.waitForTimeout(700);
  return found;
}

async function note(page: Page, key: string, selector: string): Promise<void> {
  const text = await page
    .evaluate<string>(
      `(function () { var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
         return el ? el.textContent : ''; })()`,
    )
    .catch(() => '');
  observed[key] = text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

async function main(): Promise<void> {
  rmSync(TAKE_DIR, { recursive: true, force: true });
  mkdirSync(TAKE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(
    join(tmpdir(), `sift-demo-profile-${String(Date.now())}`),
    {
      executablePath: CHROME,
      args: [
        // Chrome 152+. Without these the notice above the dock reads "WebMCP
        // unavailable in this browser" for the length of the video -- true,
        // but a fact about the capture browser, not about the product.
        '--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
        '--force-device-scale-factor=2',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { ...VIEWPORT },
      recordVideo: { dir: TAKE_DIR, size: { ...VIDEO_SIZE } },
    },
  );
  // A judge watching a demo is not a first-time visitor standing in front of
  // the first-run guide, which is a modal over the thing being filmed.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem('sift:firstRunGuideSeen', 'seen');
    } catch {
      /* private windows throw; the guide would just show */
    }
  });
  const page = context.pages()[0] ?? (await context.newPage());
  t0 = Date.now();

  // ----------------------------------------------------------------- 1
  // Opens on the launcher so the pack tiles are on screen while the narration
  // says "three packs, one engine" -- the claim and the pixels together.
  beginBeat('b1-what');
  await page.goto(BASE);
  await page.getByText('Start a Sift case').waitFor({ timeout: 30_000 });
  await hold(page, 9);
  await note(page, 'launcher', 'body');
  await page.getByRole('button', { name: /Compare these bids/ }).click();
  await page.getByText('Bid Comparison').first().waitFor({ timeout: 30_000 });
  await hold(page, 8);
  endBeat();

  // ----------------------------------------------------------------- 4
  // The twelve bids and their money are NOT on the Analysis stage: its whole
  // scroll height is about 200px and it carries no option cards at all. The
  // cards live behind the Review stage's List view.
  await goToStep(page, 'review');
  const listEarly = page.getByTestId('workspace-view-tab-list');
  if ((await listEarly.count()) > 0) {
    await listEarly.click();
    await hold(page, 1.5);
  }
  beginBeat('b4-case');
  await jump(page, 620);
  await hold(page, 3);
  await glide(page, 620, 1150, 8);
  await hold(page, 5);
  await note(page, 'twelveBids', SCROLLER);
  await glide(page, 1150, 1900, 3);
  endBeat();

  // ---------------------------------------------------------------- 5a
  await goToStep(page, 'analysis');
  beginBeat('b5a-swarm');
  await page.getByTestId('request-investigation').click();
  await hold(page, 2);
  await glide(page, 0, 340, 2.5);
  await hold(page, 12);
  await glide(page, 340, 560, 3);
  await hold(page, 7);
  endBeat();

  // ---------------------------------------------------------------- 5b
  // Held until the run is genuinely finished, so "completed, redirected once"
  // is on the scope analyst's row while the narration points at it.
  await page
    .getByTestId('specialist-activity-live')
    .filter({ hasText: 'All 6 specialists finished' })
    .waitFor({ timeout: 150_000 })
    .catch(() => console.log('  (completion status never landed; continuing)'));
  await hold(page, 2);
  await glide(page, 560, 300, 2);
  beginBeat('b5b-guide');
  await note(page, 'specialistPanel', '[data-testid="specialist-activity-panel"]');
  await hold(page, 16);
  endBeat();

  // ---------------------------------------------------------------- 6
  // The Deny and the GoalLoop refusal are NOT in the case workspace -- the
  // only place `ActivityTimeline` renders is the Runtime Inspector's Activity
  // tab, so that is where the camera has to be for these two beats.
  await page.getByTestId('open-runtime-inspector').first().click();
  await hold(page, 2);
  await page.getByTestId('runtime-inspector-tab-activity').click();
  await hold(page, 2.5);
  const items = page.getByTestId('runtime-inspector-activity').locator('li');
  // Item ids carry a per-run UUID, so these have to be found by their content.
  const blocked = items.filter({ hasText: 'not in the declared allowlist' }).first();
  if ((await blocked.count()) > 0) await blocked.scrollIntoViewIfNeeded();
  await hold(page, 1);
  beginBeat('b6-deny');
  await note(page, 'actionBlocked', '[data-testid="runtime-inspector-activity"]');
  await hold(page, 21);
  endBeat();

  // ---------------------------------------------------------------- 7
  const withheld = items.filter({ hasText: 'rejected on attempt' }).first();
  if ((await withheld.count()) > 0) await withheld.scrollIntoViewIfNeeded();
  await hold(page, 1);
  beginBeat('b7-goalloop');
  await hold(page, 34);
  endBeat();

  // ---------------------------------------------------------------- 12
  // Filmed here, out of order: the inspector shows the *latest* run, and by
  // the end of the journey that is round two, a short synthesis-only pass.
  // The run carrying the whole Swarm is round one. render.ts puts it back.
  beginBeat('b12-proof');
  for (const [tab, seconds] of [
    ['overview', 9],
    ['execution', 10],
    ['timeline', 9],
  ] as const) {
    const locator = page.getByTestId(`runtime-inspector-tab-${tab}`);
    if ((await locator.count()) === 0) continue;
    await locator.click();
    await hold(page, 2);
    await note(page, `inspector-${tab}`, '[role="dialog"]');
    await hold(page, seconds - 2);
  }
  endBeat();
  await closeAnySheet(page);

  // ---------------------------------------------------------------- 8
  await jump(page, 0);
  await hold(page, 1);
  beginBeat('b8-arithmetic');
  await hold(page, 3);
  await glide(page, 0, 900, 11);
  await hold(page, 3);
  await glide(page, 900, 1750, 8);
  await hold(page, 2);
  await note(page, 'recommendation', SCROLLER);
  endBeat();

  // ---------------------------------------------------------------- 9
  await jump(page, 0);
  await hold(page, 1);
  beginBeat('b9-failclosed');
  const findings = page.getByTestId('workspace-alert-banner-action-findings');
  if ((await findings.count()) > 0) {
    await hold(page, 3);
    await note(page, 'findingsBanner', '[data-testid="workspace-alert-banner"]');
    await findings.click();
    await hold(page, 6);
    await page.mouse.wheel(0, 420);
    await hold(page, 9);
  } else {
    await hold(page, 19);
  }
  endBeat();
  await closeAnySheet(page);

  // -------------------------------------------------------------- 10a
  await page.getByTestId('workspace-app-bar-create-menu').click();
  await hold(page, 1.2);
  await page.getByRole('menuitem', { name: /Adjust priorities/ }).click();
  await hold(page, 2);
  beginBeat('b10a-reweight');
  await hold(page, 2);
  // ROUND2_CRITERIA_WEIGHTS. The round-2 rationale is a fixed scripted string
  // keyed to this weighting; any other weighting still ranks correctly but the
  // prose on screen would be describing a different run.
  const weights: readonly (readonly [string, string])[] = [
    ['bid.adjusted_total', '15'],
    ['bid.scope_completeness', '10'],
    ['bid.payment_risk', '40'],
    ['bid.schedule_fit', '5'],
    ['bid.warranty', '30'],
  ];
  for (const [id, value] of weights) {
    await page.getByTestId(`criteria-editor-weight-${id}`).fill(value);
    await hold(page, 1.6);
  }
  await hold(page, 9);
  await note(page, 'criteriaSheet', '[role="dialog"]');
  endBeat();

  // -------------------------------------------------------------- 10b
  await page.getByRole('button', { name: /Save weights/ }).click();
  await hold(page, 1.5);
  await closeAnySheet(page);
  await page.getByTestId('request-investigation').click();
  await hold(page, 15);
  await jump(page, 0);
  await goToStep(page, 'review');
  const listTab = page.getByTestId('workspace-view-tab-list');
  if ((await listTab.count()) > 0) {
    await listTab.click();
    await hold(page, 1.5);
  }
  await centre(page, 'option-rank-constraint-flags-bid-tworivers');
  beginBeat('b10b-flagged');
  await note(page, 'twoRiversFlag', '[data-testid="option-rank-constraint-flags-bid-tworivers"]');
  await hold(page, 19);
  endBeat();

  // ---------------------------------------------------------------- 11
  // The decision itself, and the beat the whole video exists to reach: the
  // pending proposal, a person pressing the approval, and the case flipping
  // to Decided. Filmed long so none of the three is a blink.
  await goToStep(page, 'decide');
  await centre(page, 'approval-card-approve');
  beginBeat('b11-decide');
  await note(page, 'approvalCard', SCROLLER);
  await hold(page, 12);
  const approve = page.getByTestId('approval-card-approve');
  if ((await approve.count()) > 0) {
    await approve.click();
    await hold(page, 5);
    await jump(page, 0);
    await hold(page, 8);
    await note(page, 'decided', SCROLLER);
  } else {
    console.log('  (no approval control found -- the decision beat is empty)');
    await hold(page, 13);
  }
  endBeat();

  // ---------------------------------------------------------------- 13
  beginBeat('b13-close');
  await jump(page, 0);
  await hold(page, 13);
  endBeat();

  const video = page.video();
  const rawPath = video === null ? null : await video.path();
  await context.close();

  // Beats whose visual is a still (an exhibit image or a source file) have no
  // footage by design, so they are not expected in the take.
  const declared = new Set(manifest.beats.filter((b) => !('still' in b)).map((b) => b.id));
  const recorded = new Set(marks.map((m) => m.id));
  for (const id of declared) if (!recorded.has(id)) throw new Error(`beat never filmed: ${id}`);

  const finalPath = join(TAKE_DIR, 'take.webm');
  if (rawPath !== null) renameSync(rawPath, finalPath);

  const timeline: Timeline = {
    recordedAt: new Date().toISOString(),
    video: finalPath,
    paneWidth: VIDEO_SIZE.width,
    paneHeight: VIDEO_SIZE.height,
    marks,
    observed,
  };
  writeFileSync(join(TAKE_DIR, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  console.log(`\ntake: ${finalPath}`);
  console.log(`marks: ${String(marks.length)}, total ${(now() / 1000).toFixed(1)}s`);
}

await main();
