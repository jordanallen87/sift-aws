#!/usr/bin/env tsx
/**
 * `pnpm test:host` — the real-host WebMCP acceptance run
 * (docs/submissions/webmcp/host-acceptance.md, docs/specs/testing.md
 * "External hosts", ADR 0013).
 *
 * ## Why this exists, and what changed
 *
 * `docs/specs/testing.md` used to say the WebMCP host "cannot be run in
 * repository CI", so release evidence took a *manual* host smoke record.
 * That was true of every host available when it was written. It is no
 * longer true: Chrome 152 ships WebMCP natively in Blink
 * (`document.modelContext`) **and** exposes a `WebMCP` CDP domain —
 * `enable`, `invokeTool`, `cancelInvocation`, and the `toolsAdded` /
 * `toolsRemoved` / `toolInvoked` / `toolResponded` events. That is a real
 * host with a real control surface, so the session below is automated
 * rather than transcribed by hand.
 *
 * ## What this proves, precisely
 *
 * A real browser — not the in-repo `ModelContextAdapter` test double —
 * discovers the tools this page registers, reads their JSON schemas, calls
 * them, and receives their envelopes. Registration, deregistration on case
 * switch, both-direction state control, reload persistence, and host
 * reconnect all run against the shipped bundle.
 *
 * ## What this does NOT prove, and must never be written up as proving
 *
 * 1. **This is not ChatGPT.** It is Chrome's own WebMCP implementation. A
 *    page cannot tell one WebMCP host from another, so the *page-side*
 *    contract proven here is the same contract ChatGPT would exercise —
 *    but any claim naming a specific product still needs a session in that
 *    product.
 * 2. **No model chose anything.** This script picks the tool calls. It
 *    proves the tools are callable and correct, not that a model finds
 *    them, sequences them sensibly, or reads their descriptions the way a
 *    person would want.
 *
 * Both limits are recorded in the emitted evidence, so a reader of the
 * artifact cannot mistake one for the other.
 *
 * ## Running it
 *
 *   SIFT_HOST_URL=https://… pnpm test:host
 *
 * Opt-in, never part of `pnpm verify` / `pnpm verify:release` (both must
 * run with no network and no browser download). A missing URL or a browser
 * without WebMCP is reported as a failure of a gate you chose to run — not
 * a skip, and never a pass.
 */
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_RUN_GUIDE_STORAGE_KEY } from '../apps/web/src/app/first-run-storage.js';

const ARTIFACT_ROOT = fileURLToPath(new URL('../artifacts/host-acceptance', import.meta.url));

/** The catalog `webmcp-contract.test.ts` pins, split the way the page registers it. */
const GLOBAL_TOOLS = ['sift_get_case_context', 'sift_list_packs', 'sift_get_interaction_context'];
const EXPECTED_TOTAL_TOOLS = 26;

interface HostCheck {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
}

/**
 * A tool as the host sees it. Mirrors the CDP `WebMCP.Tool` type; `frameId`
 * matters because `invokeTool` is frame-scoped, not page-scoped.
 */
interface HostTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  frameId: string;
}

interface ToolResponse {
  invocationId: string;
  status: 'Completed' | 'Canceled' | 'Error';
  output?: unknown;
  errorText?: string;
}

const checks: HostCheck[] = [];

function record(name: string, status: HostCheck['status'], detail: string): void {
  checks.push({ name, status, detail });
  console.log(`[sift] test:host [${status === 'pass' ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
}

/**
 * Locates a Chrome that might carry WebMCP. Deliberately does not fall back
 * to Playwright's bundled Chromium: the bundled build is a different
 * channel on a different cadence, and silently testing a browser that
 * cannot host WebMCP would produce exactly the empty green run this gate
 * exists to prevent.
 */
function findChrome(): string | null {
  const override = process.env['SIFT_CHROME_PATH'];
  if (override !== undefined && override.trim() !== '') {
    return existsSync(override) ? override : null;
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** Calls one tool the way a host would, and waits for its `toolResponded`. */
function makeCaller(
  cdp: CDPSession,
  page: Page,
  tools: Map<string, HostTool>,
  responses: Map<string, ToolResponse>,
) {
  return async function call(toolName: string, input: Record<string, unknown> = {}) {
    const tool = tools.get(toolName);
    if (tool === undefined) {
      return {
        status: 'Error' as const,
        invocationId: '',
        errorText: `not registered: ${toolName}`,
      };
    }
    const { invocationId } = (await cdp.send(
      'WebMCP.invokeTool' as never,
      {
        frameId: tool.frameId,
        toolName,
        input,
      } as never,
    )) as { invocationId: string };

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const response = responses.get(invocationId);
      if (response !== undefined) return response;
      await page.waitForTimeout(250);
    }
    return {
      status: 'Error' as const,
      invocationId,
      errorText: 'timed out awaiting toolResponded',
    };
  };
}

/** Reads the `ok`/`data` envelope every Sift tool returns. */
function envelope(response: ToolResponse): { ok: boolean; message?: string; data?: unknown } {
  const output = response.output;
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as { ok: boolean };
    } catch {
      return { ok: false, message: output };
    }
  }
  if (typeof output === 'object' && output !== null) {
    return output as { ok: boolean };
  }
  return { ok: false, message: response.errorText ?? 'no output' };
}

async function main(): Promise<void> {
  const baseUrl = process.env['SIFT_HOST_URL'];
  if (baseUrl === undefined || baseUrl.trim() === '') {
    console.error(
      '[sift] test:host: SIFT_HOST_URL is not set. This gate drives a real WebMCP browser ' +
        'against a running Sift instance — set it to the origin to test (e.g. ' +
        'http://localhost:8080 or the deployed URL) and rerun.',
    );
    process.exit(1);
  }
  const url = baseUrl.replace(/\/+$/, '');

  const chromePath = findChrome();
  if (chromePath === null) {
    console.error(
      '[sift] test:host: no Google Chrome found. WebMCP ships in Chrome 152+; set ' +
        'SIFT_CHROME_PATH to a Chrome binary that has it. Refusing to fall back to ' +
        "Playwright's bundled Chromium, which would test a browser with no WebMCP at all.",
    );
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(ARTIFACT_ROOT, runId);
  mkdirSync(outDir, { recursive: true });

  // A throwaway profile, never the developer's own. The host session is
  // signed into nothing and shares no state with a real browser profile.
  const profileDir = mkdtempSync(join(tmpdir(), 'sift-host-'));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromePath,
      // Headless by default, for the same reason as `journey/host-session.ts`:
      // an acceptance run should not take over the screen. `findChrome` still
      // refuses Playwright's bundled Chromium, and every check here asserts a
      // real WebMCP tool call, so a headless Chrome without WebMCP fails this
      // gate loudly instead of passing on nothing.
      //
      // Set `SIFT_JOURNEY_HEADED=1` to watch the run.
      headless: process.env['SIFT_JOURNEY_HEADED'] !== '1',
      args: [
        '--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 430, height: 900 },
    });

    // The first-run guide is a modal, and a modal covers the page it is
    // explaining. A real WebMCP host driving this page is, by definition, not
    // a first-time human visitor -- it is an agent operating a workspace
    // someone already opened -- so it starts as a returning visitor here, the
    // same stance `tests/e2e/pages/sift-page.ts` takes.
    //
    // This is not cosmetic. Without it the guide intercepts pointer events
    // and `test:host` -- the 14/14 real-Chrome acceptance run that is this
    // submission's strongest evidence -- fails on a timeout with the modal
    // named as the interceptor. The key is imported from the product rather
    // than copied, so it cannot drift.
    await context.addInitScript((key: string) => {
      try {
        window.localStorage.setItem(key, 'seen');
      } catch {
        // Private windows throw on access; the guide degrades to shown,
        // which is the safe direction for a human and only costs a retry here.
      }
    }, FIRST_RUN_GUIDE_STORAGE_KEY);

    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.newCDPSession(page);

    const tools = new Map<string, HostTool>();
    const responses = new Map<string, ToolResponse>();
    const transcript: { at: string; event: string; detail: unknown }[] = [];

    cdp.on('WebMCP.toolsAdded' as never, (params: unknown) => {
      for (const tool of (params as { tools: HostTool[] }).tools) tools.set(tool.name, tool);
    });
    cdp.on('WebMCP.toolsRemoved' as never, (params: unknown) => {
      for (const tool of (params as { tools: { name: string }[] }).tools) tools.delete(tool.name);
    });
    cdp.on('WebMCP.toolResponded' as never, (params: unknown) => {
      const response = params as ToolResponse;
      responses.set(response.invocationId, response);
      transcript.push({ at: new Date().toISOString(), event: 'toolResponded', detail: response });
    });
    cdp.on('WebMCP.toolInvoked' as never, (params: unknown) => {
      transcript.push({ at: new Date().toISOString(), event: 'toolInvoked', detail: params });
    });

    // --- Precondition: is this actually a WebMCP host? ---
    try {
      await cdp.send('WebMCP.enable' as never);
    } catch (error) {
      console.error(
        `[sift] test:host: this Chrome has no WebMCP CDP domain (${String(error).split('\n')[0]}). ` +
          'WebMCP landed in Chrome 152; upgrade Chrome or point SIFT_CHROME_PATH at one that has it.',
      );
      process.exit(1);
    }

    const call = makeCaller(cdp, page, tools, responses);

    // --- 1. The page loads and the pane renders ---
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('demo-launcher').waitFor({ state: 'visible', timeout: 30_000 });
    // `document.modelContext` is the browser's own WebMCP surface. It is not
    // in this script's DOM lib (the web app declares it locally in
    // `apps/web/src/model-context/adapter.ts`), so the shape is narrowed
    // here rather than left as `any` — the whole point of this check is that
    // the property really exists at runtime.
    const surface = await page.evaluate(() => {
      const host = (document as Document & { modelContext?: { registerTool?: unknown } })
        .modelContext;
      return { present: typeof host, registerTool: typeof host?.registerTool };
    });
    if (surface.present === 'object' && surface.registerTool === 'function') {
      record('host surface', 'pass', 'document.modelContext with registerTool() is present');
    } else {
      record('host surface', 'fail', `document.modelContext is ${surface.present}`);
    }

    // --- 2. Tool discovery before a case exists ---
    await page.waitForTimeout(2_000);
    const globalNames = [...tools.keys()].sort();
    if (globalNames.join(',') === [...GLOBAL_TOOLS].sort().join(',')) {
      record(
        'discovery (no case)',
        'pass',
        `exactly the 3 global tools: ${globalNames.join(', ')}`,
      );
    } else {
      record(
        'discovery (no case)',
        'fail',
        `expected the 3 global tools, host saw ${globalNames.join(', ')}`,
      );
    }

    const withSchema = [...tools.values()].filter((t) => t.inputSchema !== undefined).length;
    record(
      'tool schemas',
      withSchema > 0 ? 'pass' : 'fail',
      `${withSchema}/${tools.size} tools carried an inputSchema to the host`,
    );

    // --- 3. A read-only tool call, before any case exists ---
    const packs = await call('sift_list_packs', {});
    const packsBody = envelope(packs);
    const packCount = Array.isArray(packsBody.data) ? packsBody.data.length : 0;
    if (packs.status === 'Completed' && packsBody.ok && packCount >= 2) {
      record('sift_list_packs', 'pass', `${packCount} packs returned through the host`);
    } else {
      record(
        'sift_list_packs',
        'fail',
        `status=${packs.status} ${JSON.stringify(packsBody).slice(0, 200)}`,
      );
    }

    // --- 4. Start a case from the visible launcher ---
    await page.getByTestId('demo-launcher-car-purchase').click();
    await page.getByTestId('case-workspace').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: join(outDir, '01-case-started.png') });

    if (tools.size === EXPECTED_TOTAL_TOOLS) {
      record('discovery (case open)', 'pass', `${tools.size} tools registered once a case existed`);
    } else {
      record(
        'discovery (case open)',
        'fail',
        `expected ${EXPECTED_TOTAL_TOOLS}, host saw ${tools.size}`,
      );
    }

    // --- 5. The host reads the case that is on screen ---
    //
    // `eventSequence` is not incidental here. Every write tool requires an
    // `expectedSequence`, so a host physically cannot mutate this case
    // without first reading it — optimistic concurrency doubles as the
    // reason a host and a person cannot silently overwrite each other.
    const readCase = async () => {
      const body = envelope(await call('sift_get_case_context', {}));
      const data = body.data as { caseId?: string; eventSequence?: number } | undefined;
      return { ok: body.ok, body, caseId: data?.caseId ?? '', sequence: data?.eventSequence };
    };

    const first = await readCase();
    const caseId = first.caseId.trim();
    if (first.ok && caseId !== '') {
      record(
        'sift_get_case_context',
        'pass',
        `host read caseId ${caseId} at sequence ${String(first.sequence)}`,
      );
    } else {
      record('sift_get_case_context', 'fail', JSON.stringify(first.body).slice(0, 250));
    }

    // --- 6. A person acts in the pane; the host's next read reflects it ---
    const keep = page.getByTestId('quick-pick-keep');
    let humanActionDetail = 'quick-pick-keep was not on screen in this state';
    let humanActionOk = false;
    if ((await keep.count()) > 0) {
      await keep.first().click();
      await page.waitForTimeout(2_500);
      const after = await readCase();
      humanActionOk =
        typeof after.sequence === 'number' &&
        typeof first.sequence === 'number' &&
        after.sequence > first.sequence;
      humanActionDetail = humanActionOk
        ? `a click in the pane advanced the case the host reads: eventSequence ${String(first.sequence)} → ${String(after.sequence)}`
        : `eventSequence did not advance (${String(first.sequence)} → ${String(after.sequence)})`;
    }
    record('human action visible to host', humanActionOk ? 'pass' : 'fail', humanActionDetail);

    // --- 7. The host cannot write blind ---
    //
    // Same tool, same case, no `expectedSequence`. It must be refused by
    // schema validation before it reaches any command handler; a host that
    // has not read the case cannot change it.
    const blind = envelope(await call('sift_add_note', { caseId, note: { body: 'blind write' } }));
    record(
      'blind write refused',
      blind.ok ? 'fail' : 'pass',
      blind.ok
        ? 'RELEASE BLOCKER — a write with no expectedSequence was accepted'
        : `refused: ${String(blind.message ?? '').slice(0, 90)}`,
    );

    // --- 8. The host acts; the pane reflects it without a reload ---
    const current = await readCase();
    const noteBody = `host-acceptance ${runId}`;
    const noted = envelope(
      await call('sift_add_note', {
        caseId,
        expectedSequence: current.sequence ?? 0,
        note: { body: noteBody },
      }),
    );
    await page.waitForTimeout(2_500);
    const noteVisible = await page.getByText(noteBody, { exact: false }).count();
    if (noted.ok && noteVisible > 0) {
      record(
        'host action visible in pane',
        'pass',
        'the note the host wrote rendered without a reload',
      );
    } else {
      record(
        'host action visible in pane',
        'fail',
        `tool ok=${String(noted.ok)} (${String(noted.message ?? '').slice(0, 80)}), occurrences in pane=${noteVisible}`,
      );
    }

    // --- 9. No tool can approve a consequential decision ---
    const approvers = [...tools.keys()].filter((name) =>
      /review_proposal|approve|accept_recommendation|confirm_decision/i.test(name),
    );
    record(
      'no approval tool',
      approvers.length === 0 ? 'pass' : 'fail',
      approvers.length === 0
        ? 'the catalog exposes no tool that can approve a decision'
        : `RELEASE BLOCKER — host can reach: ${approvers.join(', ')}`,
    );

    // --- 10. The host asks for an investigation ---
    const beforeRun = await readCase();
    const run = envelope(
      await call('sift_request_investigation', {
        caseId,
        expectedSequence: beforeRun.sequence ?? 0,
      }),
    );
    // The receipt carries the new `CaseState`, not a run id. The stronger
    // claim is that the host can *watch* the work it started, so poll:
    // `activeRun` is only populated while a specialist holds an obligation,
    // and a single sample after the fact sees either nothing yet or a
    // finished run. Both the in-flight sighting and the final outcome are
    // recorded, because they answer different questions.
    let runIdReturned = '';
    let recommendation: unknown = null;
    for (let tick = 0; tick < 60; tick += 1) {
      const snapshot = envelope(await call('sift_get_case_context', {})).data as
        { activeRun?: { runId?: string }; recommendation?: unknown } | undefined;
      if (runIdReturned === '' && snapshot?.activeRun?.runId !== undefined) {
        runIdReturned = snapshot.activeRun.runId;
      }
      if (snapshot?.recommendation != null) {
        recommendation = snapshot.recommendation;
        break;
      }
      await page.waitForTimeout(1_000);
    }
    record(
      'sift_request_investigation',
      run.ok && recommendation !== null ? 'pass' : 'fail',
      run.ok
        ? `run accepted; host watched activeRun.runId ${runIdReturned || '(never sampled in flight)'} and read the finished recommendation: ${recommendation === null ? 'none' : 'present'}`
        : JSON.stringify(run).slice(0, 250),
    );
    await page.screenshot({ path: join(outDir, '02-investigation.png') });

    // --- 11. Reload: does the case survive, and do tools re-register? ---
    tools.clear();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('case-workspace').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    const afterReload = envelope(await call('sift_get_case_context', {}));
    const reloadedCaseId = (afterReload.data as { caseId?: string } | undefined)?.caseId ?? '';
    record(
      'reload persistence',
      reloadedCaseId === caseId && caseId !== '' ? 'pass' : 'fail',
      `caseId after reload: ${reloadedCaseId || '(none)'} (was ${caseId})`,
    );
    record(
      're-registration after reload',
      tools.size === EXPECTED_TOTAL_TOOLS ? 'pass' : 'fail',
      `${tools.size} tools re-registered`,
    );

    // --- 12. Host disconnect and reconnect ---
    tools.clear();
    await cdp.send('WebMCP.disable' as never);
    await page.waitForTimeout(500);
    await cdp.send('WebMCP.enable' as never);
    await page.waitForTimeout(2_000);
    record(
      'host reconnect',
      tools.size === EXPECTED_TOTAL_TOOLS ? 'pass' : 'fail',
      `${tools.size} tools re-announced to a freshly enabled host`,
    );

    await page.screenshot({ path: join(outDir, '03-final.png') });

    const failed = checks.filter((check) => check.status === 'fail');
    writeFileSync(
      join(outDir, 'report.json'),
      `${JSON.stringify(
        {
          runId,
          url,
          startedAt: runId,
          browser: chromePath,
          browserVersion: context.browser()?.version() ?? 'unknown',
          host: 'Chrome native WebMCP (document.modelContext) driven over the CDP WebMCP domain',
          proves: [
            'a real browser discovered, schema-read, invoked, and received results from this page',
            'registration, re-registration after reload, and re-announcement after host reconnect',
            'state control in both directions between the pane and the host',
          ],
          doesNotProve: [
            'anything about ChatGPT specifically — this is Chrome, not that product',
            'that a model finds, sequences, or understands these tools; this script chose every call',
          ],
          caseId,
          runIdReturned,
          toolsDiscovered: [...tools.keys()].sort(),
          checks,
          transcript,
          ok: failed.length === 0,
        },
        null,
        2,
      )}\n`,
    );

    console.log(
      `\n[sift] test:host: ${checks.length - failed.length}/${checks.length} checks passed`,
    );
    console.log(`[sift] evidence: artifacts/host-acceptance/${runId}/`);
    if (failed.length > 0) process.exit(1);
  } finally {
    await context?.close();
  }
}

await main();
