/**
 * A real WebMCP browser session, shared by `pnpm test:host` and
 * `pnpm test:journey` (ADR 0013, ADR 0014).
 *
 * Chrome 152 ships WebMCP natively in Blink (`document.modelContext`) and
 * exposes a `WebMCP` CDP domain. This module is the one place that knows
 * how to open such a browser, keep an accurate picture of which tools the
 * page currently offers, and invoke one the way a host would. Both gates
 * build on it so there is a single answer to "what does a host see", and
 * no second, slightly-different copy to drift.
 *
 * It deliberately does not know anything about Sift. It knows about hosts.
 */
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_RUN_GUIDE_STORAGE_KEY } from '../../apps/web/src/app/first-run-storage.js';

/** A tool as the host sees it — the CDP `WebMCP.Tool` shape. */
export interface HostTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  /** `invokeTool` is frame-scoped, not page-scoped. */
  frameId: string;
}

export interface ToolResponse {
  invocationId: string;
  status: 'Completed' | 'Canceled' | 'Error';
  output?: unknown;
  errorText?: string;
}

/** The `ok`/`data` envelope every Sift tool returns. */
export interface ToolEnvelope {
  ok: boolean;
  message?: string;
  data?: unknown;
}

export interface TranscriptEntry {
  at: string;
  event: string;
  detail: unknown;
}

/**
 * Locates a Chrome that might carry WebMCP.
 *
 * Deliberately never falls back to Playwright's bundled Chromium. That
 * build is on a different channel and cadence, and testing a browser with
 * no WebMCP at all would produce exactly the empty green run these gates
 * exist to prevent.
 */
export function findChrome(): string | null {
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

/** Reads a tool response into its envelope, tolerating either encoding. */
export function readEnvelope(response: ToolResponse): ToolEnvelope {
  const output = response.output;
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as ToolEnvelope;
    } catch {
      return { ok: false, message: output };
    }
  }
  if (typeof output === 'object' && output !== null) {
    return output as ToolEnvelope;
  }
  return { ok: false, message: response.errorText ?? 'no output' };
}

export interface HostSessionOptions {
  /** Chrome binary; defaults to `findChrome()`. */
  chromePath?: string;
  /** Pane width. Sift's canonical surface is a 390-480px right pane. */
  viewport?: { width: number; height: number };
}

export class HostSessionUnavailableError extends Error {}

/**
 * An open browser that is acting as a WebMCP host.
 *
 * `tools` is kept live from `toolsAdded`/`toolsRemoved` rather than polled,
 * so a caller can assert on registration and deregistration as events
 * rather than as a snapshot that might have been taken at the wrong moment.
 */
export class HostSession {
  readonly transcript: TranscriptEntry[] = [];
  readonly tools = new Map<string, HostTool>();
  private readonly responses = new Map<string, ToolResponse>();

  private constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly cdp: CDPSession,
    readonly chromePath: string,
  ) {}

  static async open(options: HostSessionOptions = {}): Promise<HostSession> {
    const chromePath = options.chromePath ?? findChrome();
    if (chromePath === null) {
      throw new HostSessionUnavailableError(
        'No Google Chrome found. WebMCP ships in Chrome 152+; set SIFT_CHROME_PATH to a ' +
          "Chrome binary that has it. Refusing to fall back to Playwright's bundled " +
          'Chromium, which has no WebMCP at all.',
      );
    }

    // A throwaway profile, never the developer's own: signed into nothing,
    // sharing no state with a real browser profile.
    const profileDir = mkdtempSync(join(tmpdir(), 'sift-host-'));
    const context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromePath,
      // Headless by default so a run does not seize the developer's screen
      // with a browser window per journey. This is safe precisely because
      // this harness refuses to pass an empty run: `findChrome` still
      // insists on a real Chrome (never Playwright's bundled Chromium,
      // which has no WebMCP), and every turn asserts against real WebMCP
      // tool calls -- so if headless ever stopped exposing WebMCP, these
      // gates fail loudly rather than going quietly green.
      //
      // Set `SIFT_JOURNEY_HEADED=1` to watch a run, which is what you want
      // when a turn fails and you need to see where the pane actually was.
      headless: process.env['SIFT_JOURNEY_HEADED'] !== '1',
      args: [
        '--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: options.viewport ?? { width: 430, height: 900 },
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
    const session = new HostSession(context, page, cdp, chromePath);
    session.listen();

    try {
      await cdp.send('WebMCP.enable' as never);
    } catch (error) {
      await context.close();
      throw new HostSessionUnavailableError(
        `This Chrome has no WebMCP CDP domain (${String(error).split('\n')[0]}). WebMCP landed ` +
          'in Chrome 152; upgrade Chrome or point SIFT_CHROME_PATH at one that has it.',
      );
    }

    return session;
  }

  private listen(): void {
    this.cdp.on('WebMCP.toolsAdded' as never, (params: unknown) => {
      for (const tool of (params as { tools: HostTool[] }).tools) this.tools.set(tool.name, tool);
    });
    this.cdp.on('WebMCP.toolsRemoved' as never, (params: unknown) => {
      for (const tool of (params as { tools: { name: string }[] }).tools)
        this.tools.delete(tool.name);
    });
    this.cdp.on('WebMCP.toolInvoked' as never, (params: unknown) => {
      this.transcript.push({ at: new Date().toISOString(), event: 'toolInvoked', detail: params });
    });
    this.cdp.on('WebMCP.toolResponded' as never, (params: unknown) => {
      const response = params as ToolResponse;
      this.responses.set(response.invocationId, response);
      this.transcript.push({
        at: new Date().toISOString(),
        event: 'toolResponded',
        detail: params,
      });
    });
  }

  /** Invokes a tool the way a host would, and waits for its `toolResponded`. */
  async invoke(toolName: string, input: Record<string, unknown> = {}): Promise<ToolResponse> {
    const tool = this.tools.get(toolName);
    if (tool === undefined) {
      return {
        status: 'Error',
        invocationId: '',
        errorText: `not registered with the host: ${toolName}`,
      };
    }
    const { invocationId } = (await this.cdp.send(
      'WebMCP.invokeTool' as never,
      { frameId: tool.frameId, toolName, input } as never,
    )) as { invocationId: string };

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = this.responses.get(invocationId);
      if (response !== undefined) return response;
      await this.page.waitForTimeout(250);
    }
    return { status: 'Error', invocationId, errorText: 'timed out awaiting toolResponded' };
  }

  /** `invoke`, already unwrapped to the envelope callers actually read. */
  async call(toolName: string, input: Record<string, unknown> = {}): Promise<ToolEnvelope> {
    return readEnvelope(await this.invoke(toolName, input));
  }

  /** Drops and re-establishes the host's view, as a reconnect would. */
  async reconnect(): Promise<void> {
    this.tools.clear();
    await this.cdp.send('WebMCP.disable' as never);
    await this.page.waitForTimeout(500);
    await this.cdp.send('WebMCP.enable' as never);
    await this.page.waitForTimeout(2_000);
  }

  /** Whether the page exposes the browser's own WebMCP surface. */
  async surface(): Promise<{ present: string; registerTool: string }> {
    return this.page.evaluate(() => {
      const host = (document as Document & { modelContext?: { registerTool?: unknown } })
        .modelContext;
      return { present: typeof host, registerTool: typeof host?.registerTool };
    });
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}
