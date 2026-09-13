/**
 * Builds the Sift Express `Application`.
 *
 * Extends the health-only skeleton with the full HTTP service described in
 * docs/specs/architecture.md ("HTTP service"): `GET /api/packs`,
 * `POST /api/cases/demo`, `GET /api/cases/:caseId`,
 * `GET /api/cases/:caseId/events` (SSE + polling fallback),
 * `POST /api/cases/:caseId/commands/:commandName`,
 * `POST /api/cases/:caseId/run`, `GET /api/debug/runs/:runId` (the
 * Runtime Inspector's Overview + Timeline query route), and
 * `GET /ping` / `POST /invocations` (`routes/agentcore.ts` -- see that
 * file's header comment for the real, doc-verified AgentCore contract;
 * `/invocations` dispatches into the exact same `CommandService`/
 * `RunService` command layer every other route here uses, not a separate
 * implementation). The debug SSE/export routes (`GET
 * /api/debug/runs/:runId/events`, `GET /api/debug/runs/:runId/export`)
 * remain separate, later work.
 *
 * `buildApp` deliberately has no `listen()` side effect — `server.ts` is
 * the only place that binds a port, so integration tests (see
 * `app.test.ts`) can mount the returned `Application` directly against
 * supertest without opening a real socket.
 *
 * Every dependency (`caseStore`, `activityStore`, `registry`,
 * `commandService`, `runService`) is accepted pre-built rather than
 * constructed here, exactly like `database` already was — this keeps
 * `buildApp` a pure composition root that both `server.ts` (real SQLite
 * stores, `runtime-ports.ts`'s system `Clock`/`IdGenerator`) and HTTP
 * integration tests (real SQLite stores with deterministic fakes, or
 * `MemoryCaseStore`/`InMemoryActivityStore` for pure in-process tests) can
 * wire independently.
 *
 * `GET /api/debug/runs/:runId` (`routes/debug.ts`, this task) closes the
 * Runtime Inspector query-route gap this module's comment used to call out
 * ("the `/api/debug/runs/*` Runtime Inspector routes are separate, later
 * work") for its Overview + Timeline slice; `runStore`/`runtimeEventStore`
 * are the two additional dependencies it needs, and `debugEnabled`
 * (`SIFT_DEBUG_ENABLED`, config.ts) gates it exactly like
 * debugging-and-observability.md requires ("Disabling debug mode returns
 * `404` for all debug endpoints").
 *
 * --- Static web app hosting (docs/specs/architecture.md "Deployment":
 * "Express serves the Vite production build and the Sift API from the same
 * origin") ---
 *
 * Registered last, after every `/api/*`/`/health` route: `@sift/web`'s built
 * `dist/` (`apps/web/vite.config.ts`'s own `build.outDir: 'dist'`) is served
 * as static assets via a single `express.static(WEB_DIST_DIR)` -- default
 * options, so `GET /` serves `dist/index.html` (Express's normal directory-
 * index behavior) and every real built asset (`/assets/*.js`, `/assets/*.css`,
 * fonts) is served from its real path. The directory is resolved relative to
 * *this source file* (mirroring `server.ts`'s identical
 * `fileURLToPath(new URL('../skills', ...))` pattern for `skillsRootDir`),
 * so it resolves correctly whether this module runs directly from
 * `apps/agent/src` (the `tsx src/server.ts` `start` script) or from a future
 * compiled `apps/agent/dist` that preserves the same `apps/agent/<x>` <->
 * `apps/web/dist` sibling layout.
 *
 * Deliberately NOT a SPA catch-all fallback: `App.tsx` has no client-side
 * router at all (`product.md` "Primary experience": one page, exactly one
 * real route, `/`) -- there is no second app route a request to some other
 * path could legitimately mean. An earlier version of this file added a
 * catch-all that served `index.html` for any unmatched `GET`, which was
 * genuinely wrong: it silently turned every unknown route into a fake `200`
 * instead of a real `404` (caught by this task's own `app.test.ts`
 * "responds 404 for an unknown route" -- a real regression, not a
 * hypothetical one). `express.static` alone already serves `/` correctly
 * and correctly falls through (`next()`) to Express's own 404 handling for
 * anything else, which is the honest, correct contract here.
 *
 * Guarded by `existsSync`: `apps/web/dist` does not exist in every context
 * `buildApp` runs in (e.g. `app.test.ts`'s HTTP integration tests never run
 * `pnpm --filter @sift/web build` first) -- when it is missing, this block is
 * skipped entirely rather than mounting `express.static` against a
 * nonexistent root, so every existing `/api/*`-only test keeps working
 * unchanged.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import type { PackRegistry } from '@sift/packs';
import type { Clock } from '@sift/core';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';
import type { SiftDatabase } from './db/connection.js';
import { createAgentCoreRouter } from './routes/agentcore.js';
import { createHealthRouter } from './routes/health.js';
import { createBidDocumentsRouter, type BidDocumentReaderDeps } from './routes/bid-documents.js';
import { createCasesRouter } from './routes/cases.js';
import { createCatalogRouter } from './routes/catalog.js';
import { createCommandsRouter } from './routes/commands.js';
import { createDebugRouter } from './routes/debug.js';
import { createEventsRouter } from './routes/events.js';
import { createPacksRouter } from './routes/packs.js';
import { createRunsRouter } from './routes/runs.js';
import type { RunPlanService } from './services/run-plan-service.js';
import { sendError } from './routes/http-support.js';
import type { CommandService } from './services/command-service.js';
import type { RunService, RunStore } from './services/run-service.js';
import type { ActivityStore } from './store/activity-store.js';
import type { CaseStore } from './store/case-store.js';
import type { RuntimeEventStore } from './store/runtime-event-store.js';

export interface BuildAppDeps {
  database: SiftDatabase;
  caseStore: CaseStore;
  activityStore: ActivityStore;
  registry: PackRegistry;
  commandService: CommandService;
  runService: RunService;
  /**
   * The continuous RunPlan (`services/run-plan-service.ts`), backing
   * `GET /api/cases/:caseId/run-plan`. Optional so a build without plans
   * wired serves every other route unchanged.
   */
  runPlanService?: RunPlanService;
  /** Backs `GET /api/debug/runs/:runId`'s run status/trace/session lookup. */
  runStore: RunStore;
  /** Backs `GET /api/debug/runs/:runId`'s Overview/Timeline event data. */
  runtimeEventStore: RuntimeEventStore;
  /** `SIFT_DEBUG_ENABLED` (config.ts). Defaults to `true`; `false` makes every `/api/debug/*` route respond `404`. */
  debugEnabled?: boolean;
  /** Sources `GET /ping`'s `time_of_last_update` (`routes/agentcore.ts`) -- every Sift timestamp comes from an injected `Clock`, never `Date.now()` directly (docs/engineering-principles.md). */
  clock: Clock;
  /** Passed through to `createEventsRouter` — overridable in tests so an SSE test does not need to wait out a real 15s heartbeat interval. */
  sseHeartbeatIntervalMs?: number;
  /** Passed through to `createEventsRouter` — overridable in tests exercising the slow-consumer resync path without needing genuine socket backpressure. */
  sseMaxQueueLength?: number;
  /** Overridable in tests so the `existsSync(...)`/`express.static(...)` static-hosting branch below can be proven against a real (but disposable, test-local) directory without depending on whether `apps/web` has actually been built in this environment. Defaults to the real sibling `apps/web/dist` directory. */
  webDistDir?: string;
  /**
   * Backs `POST /api/cases/:caseId/bid-documents/read`
   * (`routes/bid-documents.ts`). `undefined` unless
   * `SIFT_BID_DOCUMENT_READER_ENABLED=true` (config.ts) -- `server.ts` is
   * the only caller that ever constructs a real one
   * (`resolveModelProvider`/`createBedrockModel`,
   * `runtime/model-provider.ts`); a test injects a `ScriptedModelProvider`
   * double instead. When `undefined`, that route always answers an honest
   * refusal rather than ever attempting a model call, per architecture.md's
   * "no network, no AWS credentials" requirement for the complete local
   * demo.
   */
  bidDocumentReader?: BidDocumentReaderDeps;
}

const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * `express.json()`'s own default body-size limit is 100 KB -- well BELOW
 * `MAX_BID_DOCUMENT_BYTES` (256 KiB, `@sift/contracts`), the cap
 * `SubmitBidDocumentInputSchema`/`ReadBidDocumentInputSchema` already
 * declare for a submitted bid document's `text`. Left at the default, a
 * legitimate document between 100 KB and that cap never reaches either
 * schema at all: `body-parser` itself throws `PayloadTooLargeError` before
 * any route runs, which this app's own error-handling middleware (below)
 * can only report as a generic `500 INTERNAL` -- turning an ordinary,
 * schema-anticipated "too large" case into an unhandled-looking crash
 * response instead of the clean `400 VALIDATION` these schemas' own
 * `.refine()` checks are supposed to produce. Sized to the same cap plus
 * headroom for the rest of a request's JSON envelope (`caseId`,
 * `filename`, `expectedSequence`, the `readBy` marker, ...) -- all of
 * which are individually bounded well under this -- rather than an
 * unrelated, independently-chosen number.
 */
const JSON_REQUEST_BODY_LIMIT_BYTES = MAX_BID_DOCUMENT_BYTES + 8_192;

export function buildApp(deps: BuildAppDeps): Application {
  const app = express();

  app.use(express.json({ limit: JSON_REQUEST_BODY_LIMIT_BYTES }));
  app.use(createHealthRouter({ database: deps.database }));
  app.use(createPacksRouter({ registry: deps.registry }));
  app.use(createCatalogRouter());
  app.use(createCasesRouter({ commandService: deps.commandService, caseStore: deps.caseStore }));
  app.use(createCommandsRouter({ commandService: deps.commandService }));
  app.use(
    createBidDocumentsRouter({
      commandService: deps.commandService,
      ...(deps.bidDocumentReader !== undefined ? { reader: deps.bidDocumentReader } : {}),
    }),
  );
  app.use(
    createRunsRouter({
      runService: deps.runService,
      ...(deps.runPlanService !== undefined ? { runPlanService: deps.runPlanService } : {}),
    }),
  );
  app.use(
    createAgentCoreRouter({
      commandService: deps.commandService,
      runService: deps.runService,
      caseStore: deps.caseStore,
      clock: deps.clock,
    }),
  );
  app.use(
    createDebugRouter({
      runStore: deps.runStore,
      runtimeEventStore: deps.runtimeEventStore,
      enabled: deps.debugEnabled ?? true,
    }),
  );
  app.use(
    createEventsRouter({
      caseStore: deps.caseStore,
      activityStore: deps.activityStore,
      ...(deps.sseHeartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: deps.sseHeartbeatIntervalMs }
        : {}),
      ...(deps.sseMaxQueueLength !== undefined
        ? { sseMaxQueueLength: deps.sseMaxQueueLength }
        : {}),
    }),
  );

  const webDistDir = deps.webDistDir ?? WEB_DIST_DIR;
  if (existsSync(webDistDir)) {
    app.use(express.static(webDistDir));
  }

  // Final error-handling middleware (docs/specs/testing.md "HTTP
  // integration tests": "internal-error coverage"). A route handler that
  // throws synchronously is forwarded here automatically by Express;
  // `service-result.ts`'s own header comment documents that a genuine
  // internal error is deliberately left to propagate as a thrown `Error`
  // rather than a typed `ServiceFailure`, precisely so it lands here as a
  // real `500` instead of being silently reclassified as a `4xx`. The real
  // error is logged server-side but never included in the response body,
  // consistent with architecture.md "Security and authority": responses
  // must not leak internals.
  // Express identifies error-handling middleware by arity (4 declared
  // parameters) -- `_next` must stay declared even though this handler
  // never calls it (there is nothing further downstream to delegate to).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[sift] unhandled request error:', err);
    sendError(res, 500, 'INTERNAL', 'An unexpected internal error occurred.', false);
  });

  return app;
}
