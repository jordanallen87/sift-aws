/**
 * Local/Railway entry point (docs/specs/architecture.md "Deployment":
 * Express serves the API — and eventually the built web app — from one
 * origin). Loads config, runs pending migrations (idempotent — safe on
 * every boot, including every Railway restart/redeploy), builds the
 * Express app via `app.ts`, and listens.
 *
 * `PORT` follows the standard Node/Railway convention (Railway injects it
 * automatically; architecture.md separately notes the AgentCore Strands
 * image listens on `8080`, used here as the local default too) rather than
 * being one of the `.env.example`-documented `SIFT_*` variables validated in
 * `config.ts` — see `config.ts`'s module comment for why.
 *
 * `startServer` returns the started `server`/`app`/`database`/`config`
 * instead of only having a side effect, so tests (`server.test.ts`) can
 * start a real instance on an ephemeral port (`{ port: 0 }`) against an
 * isolated temporary data directory and close it deterministically,
 * without depending on this module's `isMain()`-guarded top-level run.
 */
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Application } from 'express';
import {
  compileBidComparisonPack,
  compileCarPurchasePack,
  compileHomeEnergyGuardianPack,
  PackRegistry,
} from '@sift/packs';
import {
  buildBidComparisonEntities,
  buildBidComparisonSources,
  buildCarPurchaseCandidateEntities,
  buildCarPurchaseSources,
  buildHomeEnergyResponseOptionEntities,
  buildHomeEnergySources,
} from '@sift/scenarios';
import { buildApp } from './app.js';
import { loadConfig, type SiftConfig } from './config.js';
import type { SiftDatabase } from './db/connection.js';
import { migrate, type MigrateResult } from './db/migrate.js';
import { carPurchaseCapabilityCatalog } from './runtime/car-purchase-scenario.js';
import { createCarPurchaseEngine } from './runtime/car-purchase-engine.js';
import {
  bidComparisonCapabilityCatalog,
  createBidComparisonEngine,
} from './runtime/bid-comparison-engine.js';
import {
  createHomeEnergyEngine,
  homeEnergyCapabilityCatalog,
} from './runtime/home-energy-engine.js';
import { installSiftTracing, type SiftTracingHandle } from './runtime/otel-span-recorder.js';
import { resolveModelProvider } from './runtime/model-provider.js';
import { createSystemClock, createSystemIdGenerator } from './runtime-ports.js';
import { CommandService } from './services/command-service.js';
import { RunPlanService } from './services/run-plan-service.js';
import { SqliteRunPlanStore } from './store/run-plan-store.js';
import { RunService, SqliteRunStore, type InvestigationEngine } from './services/run-service.js';
import { SqliteActivityStore } from './store/activity-store.js';
import { SqliteCaseStore } from './store/sqlite-case-store.js';
import { SqliteRuntimeEventStore } from './store/runtime-event-store.js';

const DEFAULT_PORT = 8080;

export interface StartServerOptions {
  /** Overrides `config.dataDir` — used by tests to point at an isolated temporary directory. */
  dataDir?: string;
  /** Overrides the listen port (`0` binds an OS-assigned ephemeral port, used by tests). Defaults to `PORT` env var, then 8080. */
  port?: number;
}

export interface StartedServer {
  app: Application;
  database: SiftDatabase;
  server: Server;
  config: SiftConfig;
  migration: MigrateResult;
  /**
   * The registered OpenTelemetry tracer provider and Sift span recorder
   * (`runtime/otel-span-recorder.ts`), or `undefined` when
   * `SIFT_TRACING_ENABLED=false`. Registration is process-global (the OTel
   * API is), so a test that starts a server must `shutdown()` this alongside
   * closing the server and database, exactly as it already does for those.
   */
  tracing?: SiftTracingHandle;
}

export function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const config = loadConfig();
  const dataDir = options.dataDir ?? config.dataDir;
  const port = options.port ?? Number(process.env['PORT'] ?? DEFAULT_PORT);

  const { database, result: migration } = migrate(dataDir);

  const caseStore = new SqliteCaseStore(database);
  const activityStore = new SqliteActivityStore(database);
  const clock = createSystemClock();
  const idGenerator = createSystemIdGenerator();
  const registry = new PackRegistry();
  // The real `car-purchase` and `home-energy-guardian` Decision Packs,
  // compiled and registered at boot so a real browser session's
  // `POST /api/cases/demo` (`demoId: "car-purchase"` or
  // `"home-energy-guardian"`) and `POST /api/cases/:caseId/run` have
  // something real to run against -- registering `car-purchase` this way
  // was a genuine, confirmed gap an earlier task closed alongside that
  // pack's live run engine (see the dated `docs/build-log.md` entry:
  // without a registered pack, no live case could ever be created at all).
  // `home-energy-guardian`'s identical gap (it was never compiled or
  // registered here at all, so `POST /api/cases/demo {demoId:
  // "home-energy-guardian"}` 404'd even though `apps/web`'s `DemoLauncher`
  // already offered the "Investigate my energy bill" card) is this task's
  // own closure of the same class of bug for the second hero pack.
  const carPurchasePack = compileCarPurchasePack(carPurchaseCapabilityCatalog(), clock);
  registry.register(carPurchasePack);
  const homeEnergyGuardianPack = compileHomeEnergyGuardianPack(
    homeEnergyCapabilityCatalog(),
    clock,
  );
  registry.register(homeEnergyGuardianPack);
  // `bid-comparison`'s identical gap (it was built, compiled-pack-tested,
  // and Swarm-tested but never compiled/registered here at all, so
  // `POST /api/cases/demo {demoId: "bid-comparison"}` 404'd even before a
  // launcher card existed to click) is this task's own closure of the same
  // class of bug for the third pack.
  const bidComparisonPack = compileBidComparisonPack(bidComparisonCapabilityCatalog(), clock);
  registry.register(bidComparisonPack);
  const skillsRootDir = fileURLToPath(new URL('../skills', import.meta.url));

  const runStore = new SqliteRunStore(database);
  const runtimeEventStore = new SqliteRuntimeEventStore(database);
  // Turns on capture of the OpenTelemetry spans the Strands SDK already
  // emits on every Graph/Swarm/agent/model/tool call, writing them into the
  // same `runtime_events` table the Runtime Inspector reads. Purely
  // in-process unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set, so a fixture run
  // stays fully offline. See `runtime/otel-span-recorder.ts`.
  const tracing = config.tracingEnabled
    ? installSiftTracing({ runtimeEventStore, runStore })
    : undefined;
  const carPurchaseEngine = createCarPurchaseEngine({
    caseStore,
    activityStore,
    runStore,
    runtimeEventStore,
    registry,
    clock,
    idGenerator,
    skillsRootDir,
  });
  const homeEnergyEngine = createHomeEnergyEngine({
    caseStore,
    activityStore,
    runStore,
    runtimeEventStore,
    registry,
    clock,
    idGenerator,
    skillsRootDir,
    demoPacingMs: config.demoPacingMs,
  });
  const bidComparisonEngine = createBidComparisonEngine({
    caseStore,
    activityStore,
    runStore,
    runtimeEventStore,
    registry,
    clock,
    idGenerator,
    skillsRootDir,
    demoPacingMs: config.demoPacingMs,
  });
  const engines: Readonly<Record<string, InvestigationEngine>> = {
    [carPurchasePack.identity.id]: carPurchaseEngine,
    [homeEnergyGuardianPack.identity.id]: homeEnergyEngine,
    [bidComparisonPack.identity.id]: bidComparisonEngine,
  };

  // The continuous RunPlan. Constructed before `commandService` because
  // the command service is what tells it a person changed something.
  const runPlanService = new RunPlanService({
    caseStore,
    planStore: new SqliteRunPlanStore(database),
    activityStore,
    registry,
    clock,
    idGenerator,
  });

  const commandService = new CommandService({
    caseStore,
    activityStore,
    registry,
    clock,
    idGenerator,
    runPlanRevisor: runPlanService,
    // Real gap closed alongside each pack's live run engine
    // (docs/build-log.md): instantiateCase always seeds entities: [], so
    // without this a freshly started demo case had no candidates/response
    // options for a live "Investigate" click to ever run against or for the
    // resulting recommendation to resolve to a renderable entity.
    demoSeedEntities: {
      'car-purchase': buildCarPurchaseCandidateEntities,
      'home-energy-guardian': buildHomeEnergyResponseOptionEntities,
      'bid-comparison': buildBidComparisonEntities,
    },
    // Real gap closed alongside `demoSeedEntities` above: every pack's
    // seeded entities cite `sourceIds` on their attributes, but nothing
    // wrote the `Source` rows those citations point at -- a freshly started
    // case held real cited sourceIds while every attribute's citation
    // resolved to nothing. All three packs are wired, each via its own
    // seed-data builder (`@sift/scenarios`'s `seeds.ts`): `buildCarPurchaseSources`/
    // `buildHomeEnergySources` mirror `buildBidComparisonSources`'s own
    // "same underlying build as its entities builder, split" pattern.
    demoSeedSources: {
      'car-purchase': buildCarPurchaseSources,
      'home-energy-guardian': buildHomeEnergySources,
      'bid-comparison': buildBidComparisonSources,
    },
  });
  const runService = new RunService({
    caseStore,
    activityStore,
    runStore,
    clock,
    idGenerator,
    engines,
    runPlanService,
  });

  // Strictly opt-in, per architecture.md's "no network, no AWS credentials"
  // requirement for the complete local demo (`config.ts`'s
  // `bidDocumentReaderEnabled` doc comment has the full reasoning). Only
  // when enabled is a real model actually constructed here -- via
  // `resolveModelProvider`, never a `BedrockModel` built inline -- and only
  // then does `POST /api/cases/:caseId/bid-documents/read`
  // (`routes/bid-documents.ts`) ever attempt a model call at all; every
  // other deployment leaves this `undefined` and that route always answers
  // its own honest refusal instead.
  const bidDocumentReader = config.bidDocumentReaderEnabled
    ? {
        model: resolveModelProvider({ modelId: config.modelId, awsRegion: config.awsRegion }),
        modelId: config.modelId,
      }
    : undefined;

  const app = buildApp({
    database,
    caseStore,
    activityStore,
    registry,
    commandService,
    runService,
    runPlanService,
    runStore,
    runtimeEventStore,
    clock,
    debugEnabled: config.debugEnabled,
    ...(bidDocumentReader !== undefined ? { bidDocumentReader } : {}),
  });

  return new Promise((resolvePromise) => {
    const server = app.listen(port, () => {
      resolvePromise({
        app,
        database,
        server,
        config,
        migration,
        ...(tracing !== undefined ? { tracing } : {}),
      });
    });
  });
}

function isMain(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  startServer()
    .then(({ config, migration, server }) => {
      const address = server.address();
      const port = address !== null && typeof address !== 'string' ? address.port : DEFAULT_PORT;
      console.log(
        `[sift] agent listening on port ${port} ` +
          `(executionTarget=${config.executionTarget}, dataDir=${config.dataDir}, ` +
          `migrationsApplied=${migration.applied.length}, migrationsAlreadyApplied=${migration.alreadyApplied.length})`,
      );
    })
    .catch((error: unknown) => {
      console.error('[sift] agent failed to start:', error);
      process.exitCode = 1;
    });
}
