/**
 * The turn-based journey harness (ADR 0014).
 *
 * ## The gap this closes
 *
 * Sift had two journey harnesses and neither could see what the other saw.
 *
 * `scripts/test-persona.ts` walks a person through a decision turn by turn
 * and asserts hard on case state — but it calls commands directly, in
 * process, and renders nothing. It reported a passing family journey while
 * adaptive discovery had **no input path in the product at all**: the
 * dock's question button only switched views, so a person could not answer
 * anything in the pane. Every assertion it made was true and the product
 * was unusable.
 *
 * `tests/e2e/*.spec.ts` renders the real product, but as long linear specs.
 * They assert what a step should look like; they do not, turn by turn, ask
 * whether the screen and the server still agree.
 *
 * This harness runs a journey **through the rendered pane in a real WebMCP
 * browser** and, after every turn, evaluates three separate things:
 *
 * | Kind | Question |
 * | --- | --- |
 * | `data` | Is the case state on the server what this turn should have produced? |
 * | `ui` | Does the pane show what a person should now see? |
 * | `agreement` | Do those two describe the same case? |
 *
 * The third kind is the one neither existing harness has, and it is where
 * the interesting failures live: state advanced but the pane is stale, or
 * the pane displays something the state does not support. A journey that
 * passes `data` and `ui` independently can still be showing a person a
 * number the server disagrees with.
 *
 * ## Turns have an actor
 *
 * A turn is taken either by the **person**, acting through visible controls
 * in the pane, or by the **assistant**, acting through a real WebMCP tool
 * call in a real host. Both routes reach the same command implementation
 * (docs/engineering-principles.md), and running them in one interleaved journey is the only way
 * to test that claim rather than assert it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import type { HostSession, ToolEnvelope } from './host-session.js';

export type CheckKind = 'data' | 'ui' | 'agreement';

export interface Check {
  kind: CheckKind;
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Collects a turn's checks.
 *
 * Every method takes the observed value and says plainly what was expected,
 * so a failure reads as a sentence rather than as `expected true to be
 * false`. `detail` is written on pass as well as fail — a passing run is
 * the evidence artifact, and "26 tools" is worth recording even when it is
 * what we wanted.
 */
export class Checks {
  readonly results: Check[] = [];

  private add(kind: CheckKind, label: string, ok: boolean, detail: string): void {
    this.results.push({ kind, label, ok, detail });
  }

  /** The server's case state is what this turn should have produced. */
  data(label: string, ok: boolean, detail: string): void {
    this.add('data', label, ok, detail);
  }

  /** The pane shows what a person should now see. */
  ui(label: string, ok: boolean, detail: string): void {
    this.add('ui', label, ok, detail);
  }

  /** The screen and the server describe the same case. */
  agreement(label: string, ok: boolean, detail: string): void {
    this.add('agreement', label, ok, detail);
  }

  /** Convenience for the common "these two should be equal" shape. */
  agreeOn(label: string, fromState: unknown, fromScreen: unknown): void {
    const ok = String(fromState) === String(fromScreen);
    this.agreement(
      label,
      ok,
      ok
        ? `both say ${String(fromState)}`
        : `state says ${String(fromState)}, screen says ${String(fromScreen)}`,
    );
  }

  get failures(): Check[] {
    return this.results.filter((check) => !check.ok);
  }
}

/** The case state as `GET /api/cases/:caseId` returns it. */
export type CaseSnapshot = Record<string, unknown>;

export interface TurnContext {
  readonly page: Page;
  readonly host: HostSession;
  readonly baseUrl: string;
  /** Set once the journey has created a case. */
  caseId: string;
  /** The server's current view of the case. */
  state(): Promise<CaseSnapshot>;
  /** Calls a WebMCP tool in the real host. */
  call(tool: string, input?: Record<string, unknown>): Promise<ToolEnvelope>;
  /**
   * Calls a write tool, supplying the `expectedSequence` the case is
   * actually at. Every Sift write requires one, which is what stops a host
   * changing a case it has not read.
   */
  write(tool: string, input?: Record<string, unknown>): Promise<ToolEnvelope>;
  /** Waits until the case stops changing, rather than for a fixed time. */
  settle(): Promise<void>;
  /**
   * Text content of a testid, or null when the element is not in the DOM.
   *
   * Reads `textContent`, which a hidden element still has. Use this to ask
   * what the page *holds*; use `visibleText` to ask what a person can
   * actually read.
   */
  text(testId: string): Promise<string | null>;
  /**
   * Text content of a testid, or null when a person cannot see it.
   *
   * The distinction is not academic. `DecisionOrientationShell` collapses
   * its secondary lines with the `hidden` attribute rather than unmounting
   * them, so every testid stays in the DOM and `text()` keeps returning
   * their content — a `ui` check written against `text()` reported that
   * "the pane says what just changed" while the person saw nothing at all.
   * A `ui` check is a claim about what is on screen, so it belongs on this.
   */
  visibleText(testId: string): Promise<string | null>;
  /** Whether a testid is currently visible. */
  visible(testId: string): Promise<boolean>;
  /** A note for the UX review — an observation, not a pass/fail. */
  observe(note: string): void;
}

export interface Turn {
  id: string;
  /** Who is acting: a person in the pane, or an assistant through WebMCP. */
  actor: 'person' | 'assistant';
  /** What they are doing, in their own words. */
  intent: string;
  act(ctx: TurnContext): Promise<void>;
  checks(ctx: TurnContext, check: Checks): Promise<void>;
}

export interface Journey {
  id: string;
  title: string;
  /** What this journey exists to prove, in one sentence. */
  proves: string;
  turns: Turn[];
}

export interface TurnResult {
  id: string;
  actor: Turn['actor'];
  intent: string;
  checks: Check[];
  observations: string[];
  screenshot: string;
  eventSequence: number | null;
  durationMs: number;
  error?: string;
}

export interface JourneyResult {
  id: string;
  title: string;
  proves: string;
  ok: boolean;
  caseId: string;
  turns: TurnResult[];
}

function sequenceOf(state: CaseSnapshot): number | null {
  const value = state['eventSequence'];
  return typeof value === 'number' ? value : null;
}

/**
 * Waits until the host can name the case that is open, and binds it.
 *
 * The workspace becoming visible and the case becoming *addressable* are
 * different moments: the pane renders from its own optimistic state while
 * the case-scoped tools are still registering. Reading `caseId` at the
 * first moment produced an empty string and every later check in the
 * journey inherited it — the whole run failed on one missing wait.
 */
export async function bindCase(ctx: TurnContext, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const context = (await ctx.call('sift_get_case_context')).data as
      { caseId?: string } | undefined;
    const caseId = (context?.caseId ?? '').trim();
    if (caseId !== '') {
      ctx.caseId = caseId;
      return;
    }
    await ctx.page.waitForTimeout(500);
  }
}

/**
 * Opens the guided-stage stepper and moves the case to `stageId`, exactly as
 * a person clicking through `CaseWorkflowStepper` would
 * (`apps/web/src/app/case-workflow.ts`'s stage-ownership table, ADR 0016).
 *
 * Since `ab75200` ("the guided stages now apply at every width, and
 * actually gate content"), each stage's regions render only while that
 * stage is active (or, per the ADR's escape hatch, while the stage is
 * altogether unreachable) — so a region owned by a stage the case has
 * already moved past, like Review's Quick Pick or Priorities' Decision
 * Profile, is not on screen until a person actually steps back to it.
 *
 * The stepper renders two ways depending on viewport
 * (`CaseWorkflowStepper.tsx`): at the journey's narrow width
 * (`host-session.ts`, 430px) it is a collapsed toggle with no step buttons
 * in the DOM until opened; at a wide viewport every step is already a
 * button in one row. This tries the step button directly first and only
 * reaches for the toggle when it is not already on screen, so it works
 * unmodified at either width.
 *
 * A stage a person cannot yet reach (`state: 'unavailable'`) renders its
 * button disabled. Clicking a disabled button would hang on Playwright's
 * actionability wait, so this checks `isEnabled` first and returns `false`
 * rather than doing that — a caller can tell "nothing to click" apart from
 * "clicked it".
 */
export async function openWorkflowStage(ctx: TurnContext, stageId: string): Promise<boolean> {
  const step = ctx.page.getByTestId(`case-workflow-step-${stageId}`);
  if (
    (await step.count()) === 0 ||
    !(await step
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    const toggle = ctx.page.getByTestId('case-workflow-stepper-toggle');
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
      await step
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => undefined);
    }
  }
  if (
    (await step.count()) === 0 ||
    !(await step
      .first()
      .isEnabled()
      .catch(() => false))
  ) {
    return false;
  }
  await step.first().click();
  return true;
}

/**
 * Runs one journey to completion.
 *
 * A failing check does **not** stop the journey. A turn that leaves the
 * product in a wrong-but-usable state usually produces a more informative
 * failure three turns later, and stopping at the first one hides that.
 * A thrown error does stop it, because everything after is meaningless.
 */
export async function runJourney(
  journey: Journey,
  host: HostSession,
  baseUrl: string,
  outDir: string,
): Promise<JourneyResult> {
  const turnDir = join(outDir, journey.id);
  mkdirSync(turnDir, { recursive: true });

  // Every journey starts from a person who has never been here.
  //
  // The browser remembers the case it last had open (`active-case-storage.ts`),
  // so the second journey in a run navigated to the base URL and got the
  // *first* journey's workspace restored instead of the launcher.
  //
  // Clearing on the app's own page is not enough: loading it starts a
  // restore that writes the key back *after* the clear, so the next
  // navigation restores again. `/health` is the same origin without the
  // SPA, which gives access to `localStorage` with nothing running that
  // could repopulate it.
  await host.page
    .goto(`${baseUrl}/health`, { waitUntil: 'domcontentloaded' })
    .catch(() => undefined);
  await host.page
    .evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // A browser that refuses storage access is still a valid host.
      }
    })
    .catch(() => undefined);

  let observations: string[] = [];
  const ctx: TurnContext = {
    page: host.page,
    host,
    baseUrl,
    caseId: '',
    async state() {
      if (this.caseId === '') return {};
      const response = await fetch(`${baseUrl}/api/cases/${encodeURIComponent(this.caseId)}`);
      if (!response.ok) return {};
      return (await response.json()) as CaseSnapshot;
    },
    async call(tool, input = {}) {
      return host.call(tool, input);
    },
    async write(tool, input = {}) {
      const current = await this.state();
      return host.call(tool, {
        caseId: this.caseId,
        expectedSequence: sequenceOf(current) ?? 0,
        ...input,
      });
    },
    async settle() {
      // Waits for the case to stop moving rather than for a clock. Two
      // consecutive identical reads is the signal; a fixed sleep either
      // wastes time or races an SSE frame that has not landed.
      let previous = -1;
      let stable = 0;
      for (let tick = 0; tick < 90; tick += 1) {
        const sequence = sequenceOf(await this.state()) ?? -1;
        stable = sequence === previous ? stable + 1 : 0;
        previous = sequence;
        if (stable >= 2) break;
        await host.page.waitForTimeout(500);
      }
      // One more paint after the last event, so UI checks read a settled
      // pane rather than one mid-render.
      await host.page.waitForTimeout(600);
    },
    async text(testId) {
      const locator = host.page.getByTestId(testId);
      if ((await locator.count()) === 0) return null;
      return (await locator.first().textContent())?.trim() ?? null;
    },
    async visibleText(testId) {
      const locator = host.page.getByTestId(testId);
      if ((await locator.count()) === 0) return null;
      const first = locator.first();
      if (!(await first.isVisible().catch(() => false))) return null;
      return (await first.textContent())?.trim() ?? null;
    },
    async visible(testId) {
      const locator = host.page.getByTestId(testId);
      return (await locator.count()) > 0 && (await locator.first().isVisible());
    },
    observe(note) {
      observations.push(note);
    },
  };

  const results: TurnResult[] = [];
  let ok = true;

  for (const [index, turn] of journey.turns.entries()) {
    observations = [];
    const startedAt = Date.now();
    const checks = new Checks();
    let error: string | undefined;

    try {
      await turn.act(ctx);
      await ctx.settle();
      await turn.checks(ctx, checks);
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }

    const screenshot = join(turnDir, `${String(index).padStart(2, '0')}-${turn.id}.png`);
    await host.page.screenshot({ path: screenshot }).catch(() => undefined);

    const state = await ctx.state();
    results.push({
      id: turn.id,
      actor: turn.actor,
      intent: turn.intent,
      checks: checks.results,
      observations: [...observations],
      screenshot,
      eventSequence: sequenceOf(state),
      durationMs: Date.now() - startedAt,
      ...(error === undefined ? {} : { error }),
    });

    const failed = checks.failures;
    const marker = error !== undefined ? 'ERROR' : failed.length > 0 ? 'FAIL' : 'PASS';
    console.log(
      `  [${marker}] ${turn.id} (${turn.actor}) — ${checks.results.length - failed.length}/${checks.results.length} checks`,
    );
    for (const check of failed) {
      console.log(`      ✗ ${check.kind}: ${check.label} — ${check.detail}`);
    }
    if (error !== undefined) console.log(`      ! ${error}`);
    for (const note of observations) console.log(`      · ux: ${note}`);

    if (error !== undefined || failed.length > 0) ok = false;
    if (error !== undefined) break;
  }

  return {
    id: journey.id,
    title: journey.title,
    proves: journey.proves,
    ok,
    caseId: ctx.caseId,
    turns: results,
  };
}

/** Writes the machine-readable report plus a readable per-turn summary. */
export function writeJourneyReport(
  outDir: string,
  runId: string,
  baseUrl: string,
  results: JourneyResult[],
): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'report.json'),
    `${JSON.stringify({ runId, baseUrl, journeys: results, ok: results.every((r) => r.ok) }, null, 2)}\n`,
  );

  const lines: string[] = [`# Journey run ${runId}`, '', `Against \`${baseUrl}\`.`, ''];
  for (const journey of results) {
    lines.push(
      `## ${journey.title} — ${journey.ok ? 'PASS' : 'FAIL'}`,
      '',
      `${journey.proves}`,
      '',
    );
    lines.push('| Turn | Actor | Intent | Checks | Failed |', '| --- | --- | --- | --- | --- |');
    for (const turn of journey.turns) {
      const failed = turn.checks.filter((check) => !check.ok);
      lines.push(
        `| \`${turn.id}\` | ${turn.actor} | ${turn.intent} | ${turn.checks.length} | ${failed.length === 0 ? '—' : failed.map((f) => f.label).join('; ')} |`,
      );
    }
    lines.push('');
    const observations = journey.turns.flatMap((turn) =>
      turn.observations.map((note) => `- \`${turn.id}\` — ${note}`),
    );
    if (observations.length > 0) {
      lines.push('### UX observations', '', ...observations, '');
    }
  }
  writeFileSync(join(outDir, 'summary.md'), `${lines.join('\n')}\n`);
}
