/**
 * `POST /api/cases/:caseId/bid-documents/read` end to end: the async model
 * step (`runtime/bid-document-reader.ts`) plus the existing, synchronous
 * `CommandService.submitBidDocument` it hands a successful reading to.
 *
 * Does NOT use the shared `fixtures/http-harness.ts` (every other
 * `routes/*.test.ts` file's harness): that harness's `createHttpTestHarness`
 * has no way to inject a `BidDocumentReaderDeps` (a real model would make
 * this whole suite non-deterministic and network-dependent, exactly what
 * `docs/specs/testing.md` forbids), and this task's scope is additive-only
 * to that shared fixture. `createReaderHarness` below reproduces its exact
 * wiring (`buildApp` + a real, temporary, migrated SQLite database) with one
 * addition: an optional injected `reader`, driven in these tests by a real
 * `ScriptedModelProvider` (`runtime/model-provider.ts`) -- no network, fully
 * deterministic, the same double `bid-document-reader.test.ts` already uses
 * to prove `readBidDocumentWithModel` itself.
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { Model, type BaseModelConfig, type ModelStreamEvent } from '@strands-agents/sdk';
import type { CommandReceipt, HttpErrorBody } from '@sift/contracts';
import { MAX_BID_DOCUMENT_BYTES } from '@sift/contracts';
import { asJson } from '../fixtures/http-types.js';
import {
  createRegistryWithSyntheticPack,
  createSequentialIdGenerator,
  fixedClock,
} from '../fixtures/synthetic-pack.js';
import { buildApp } from '../app.js';
import { createTestDatabase, type TestDatabase } from '../db/connection.js';
import { applyMigrations } from '../db/migrate.js';
import { CommandService } from '../services/command-service.js';
import { RunService, SqliteRunStore } from '../services/run-service.js';
import { SqliteActivityStore } from '../store/activity-store.js';
import { SqliteCaseStore } from '../store/sqlite-case-store.js';
import { SqliteRuntimeEventStore } from '../store/runtime-event-store.js';
import type { BidDocumentReaderDeps } from './bid-documents.js';
import { ScriptedModelProvider, type ScriptedTurn } from '../runtime/model-provider.js';

interface ReaderHarness {
  readonly server: Server;
  readonly database: TestDatabase;
  readonly caseStore: SqliteCaseStore;
  cleanup(): void;
}

async function createReaderHarness(reader?: BidDocumentReaderDeps): Promise<ReaderHarness> {
  const database = createTestDatabase();
  applyMigrations(database.sqlite);

  const caseStore = new SqliteCaseStore(database);
  const activityStore = new SqliteActivityStore(database);
  const runStore = new SqliteRunStore(database);
  const runtimeEventStore = new SqliteRuntimeEventStore(database);
  const registry = createRegistryWithSyntheticPack();
  const idGenerator = createSequentialIdGenerator();

  const commandService = new CommandService({
    caseStore,
    activityStore,
    registry,
    clock: fixedClock,
    idGenerator,
  });
  const runService = new RunService({
    caseStore,
    activityStore,
    runStore,
    clock: fixedClock,
    idGenerator,
  });

  const app = buildApp({
    database,
    caseStore,
    activityStore,
    registry,
    commandService,
    runService,
    runStore,
    runtimeEventStore,
    clock: fixedClock,
    ...(reader !== undefined ? { bidDocumentReader: reader } : {}),
  });

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    server,
    database,
    caseStore,
    cleanup: () => {
      server.closeAllConnections();
      server.close();
      database.cleanup();
    },
  };
}

/** A real `ScriptedModelProvider`, pre-selected onto the one beat `readBidDocumentWithModel` always invokes -- no network, fully deterministic. Mirrors `bid-document-reader.test.ts`'s own identical helper. */
function scriptedModel(turns: ScriptedTurn[]): ScriptedModelProvider {
  const provider = new ScriptedModelProvider({ beats: { read: turns } });
  provider.setBeat('read');
  return provider;
}

/** A fully populated, schema-valid reading -- the same shape `bid-document-reader.test.ts`'s `VALID_READING` uses. */
const VALID_READING = {
  contractorName: 'Northgate Plumbing',
  licenseNumber: 'PL-4417-NG',
  total: { amount: 276_000, currency: 'USD' },
  depositPercent: 25,
  startInWeeks: 3,
  durationWorkingDays: 45,
  warranty: { termMonths: 24, statedInWriting: true },
  lineItems: [
    {
      scopeItemId: 'demo-existing',
      label: 'Demo of existing restroom and locker-room fixtures',
      amount: { amount: 22_500, currency: 'USD' },
    },
  ],
};

describe('POST /api/cases/:caseId/bid-documents/read', () => {
  let harness: ReaderHarness | undefined;

  afterEach(() => {
    harness?.cleanup();
    harness = undefined;
  });

  async function startDemo(): Promise<{ caseId: string; expectedSequence: number }> {
    if (harness === undefined) throw new Error('harness not initialized');
    const response = await request(harness.server)
      .post('/api/cases/demo')
      .set('Idempotency-Key', 'cmd-start')
      .send({ demoId: 'car-purchase' });
    const receipt = asJson<CommandReceipt>(response.body);
    return { caseId: receipt.caseId, expectedSequence: receipt.acceptedSequence };
  }

  it('refuses cleanly, and writes nothing to the case, when no model is configured', async () => {
    harness = await createReaderHarness(undefined);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-1')
      .send({ caseId, expectedSequence, filename: 'northgate-bid.pdf', text: 'some bid prose' });

    expect(response.status).toBe(503);
    const body = asJson<HttpErrorBody>(response.body);
    expect(body.error.code).toBe('UNAVAILABLE');
    expect(body.error.message).toContain('model');
    expect(body.error.message.toLowerCase()).toContain('json');

    const snapshot = harness.caseStore.load(caseId);
    expect(snapshot?.entities).toHaveLength(0);
    expect(snapshot?.sources).toHaveLength(0);
    expect(snapshot?.eventSequence).toBe(expectedSequence);
  });

  it('creates an option from a good model reading, with LOWER confidence, the original PDF filename on the Source, and origin: agent_proposed (never verified)', async () => {
    const reader: BidDocumentReaderDeps = {
      model: scriptedModel([
        { toolCalls: [{ name: 'strands_structured_output', input: VALID_READING }] },
      ]),
      modelId: 'test-model-v1',
    };
    harness = await createReaderHarness(reader);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-2')
      .send({
        caseId,
        expectedSequence,
        filename: 'northgate-bid.pdf',
        text: 'Northgate Plumbing hereby bids $276,000 for the restroom renovation...',
      });

    expect(response.status).toBe(200);
    const receipt = asJson<CommandReceipt>(response.body);
    const snapshot = receipt.snapshot!;

    expect(snapshot.entities).toHaveLength(1);
    const entity = snapshot.entities[0];
    expect(entity?.label).toBe('Northgate Plumbing');

    // Every field the extractor read carries the SINGLE lower model-read
    // confidence (0.4), never the deterministic extractor's own tiers
    // (0.6/0.7/0.9) -- and origin/status stay exactly what a proposal from
    // an unverified reading may claim.
    const totalAttribute = entity?.attributes['bid.quoted_total'];
    expect(totalAttribute?.origin).toBe('agent_proposed');
    expect(totalAttribute?.status).toBe('supported');
    expect(totalAttribute?.status).not.toBe('verified');
    expect(totalAttribute?.confidence).toBe(0.4);
    const depositAttribute = entity?.attributes['bid.deposit_percent'];
    expect(depositAttribute?.confidence).toBe(0.4);

    const source = snapshot.sources[0];
    expect(source?.origin).toBe('user_submitted');
    expect(source?.verification).toBe('unverified');
    // Titled with the ORIGINAL PDF filename, not a synthesised JSON name.
    expect(source?.title).toBe('northgate-bid.pdf');
    expect(source?.tags).toEqual(['bid-document', 'application/pdf', 'model-read']);
    expect(source?.excerpt).toContain('test-model-v1');
    expect(source?.excerpt?.toLowerCase()).toContain('unverified');
  });

  it('returns a typed validation failure, and creates no option, when the model reading is empty', async () => {
    const reader: BidDocumentReaderDeps = {
      model: scriptedModel([{ toolCalls: [{ name: 'strands_structured_output', input: {} }] }]),
      modelId: 'test-model-v1',
    };
    harness = await createReaderHarness(reader);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-3')
      .send({
        caseId,
        expectedSequence,
        filename: 'blank.pdf',
        text: 'a document with nothing this reader recognises as a bid',
      });

    expect(response.status).toBe(400);
    const body = asJson<HttpErrorBody>(response.body);
    expect(body.error.code).toBe('VALIDATION');

    const snapshot = harness.caseStore.load(caseId);
    expect(snapshot?.entities).toHaveLength(0);
    expect(snapshot?.eventSequence).toBe(expectedSequence);
  });

  it('returns a clean error response, not a crash, when the model throws -- 503 UNAVAILABLE, not 400, because this is the deployment failing to reach its model', async () => {
    // An empty beat: `ScriptedModelProvider.stream()` throws synchronously
    // ("no scripted responses registered") the moment it is invoked, the
    // same mechanism `bid-document-reader.test.ts` uses to simulate a
    // failed model call -- `readBidDocumentWithModel`'s own `try`/`catch`
    // turns that into a typed `{ ok: false, kind: 'invocation_failed' }`,
    // which this route now maps to `503 UNAVAILABLE` (see the dedicated
    // "missing AWS credentials" test below for the exact real-world defect
    // this corrects), never `400 VALIDATION` -- the model was never
    // reached, so this is not a fact about the document `broken.pdf` names.
    const reader: BidDocumentReaderDeps = {
      model: scriptedModel([]),
      modelId: 'test-model-v1',
    };
    harness = await createReaderHarness(reader);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-4')
      .send({ caseId, expectedSequence, filename: 'broken.pdf', text: 'some bid prose' });

    expect(response.status).toBe(503);
    const body = asJson<HttpErrorBody>(response.body);
    expect(body.error.code).toBe('UNAVAILABLE');

    const snapshot = harness.caseStore.load(caseId);
    expect(snapshot?.entities).toHaveLength(0);
  });

  it('returns 503 UNAVAILABLE, not 400, when the model throws because AWS credentials are absent -- the exact deployment defect this kind exists to fix', async () => {
    // `SIFT_BID_DOCUMENT_READER_ENABLED=true` with no reachable AWS
    // credentials is an ORDINARY deployment condition, not an edge case --
    // and before `ReadBidDocumentFailureKind` existed, this route reported
    // it as `400 VALIDATION`, "Could not read \"harborline-bid.pdf\" as a
    // bid.", telling a contractor their PDF was the problem when the
    // server could not reach its own model. This test reproduces that exact
    // failure (the literal AWS SDK message for missing credentials) with a
    // fake `Model` that throws directly, not through `ScriptedModelProvider`
    // beat exhaustion -- see `bid-document-reader.test.ts`'s matching
    // `ThrowingModel` test for the same double one layer down.
    class ThrowingModel extends Model<BaseModelConfig> {
      private config: BaseModelConfig = { modelId: 'throwing-model' };
      override updateConfig(modelConfig: BaseModelConfig): void {
        this.config = { ...this.config, ...modelConfig };
      }
      override getConfig(): BaseModelConfig {
        return this.config;
      }
      // eslint-disable-next-line @typescript-eslint/require-await, require-yield -- must match `Model.stream`'s async-generator signature; the throw below needs neither await nor yield.
      override async *stream(): AsyncIterable<ModelStreamEvent> {
        throw new Error('Could not load credentials from any providers');
      }
    }

    const reader: BidDocumentReaderDeps = {
      model: new ThrowingModel(),
      modelId: 'test-model-v1',
    };
    harness = await createReaderHarness(reader);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-4b')
      .send({
        caseId,
        expectedSequence,
        filename: 'harborline-bid.pdf',
        text: 'Harborline Roofing hereby bids $88,000...',
      });

    expect(response.status).toBe(503);
    const body = asJson<HttpErrorBody>(response.body);
    expect(body.error.code).toBe('UNAVAILABLE');
    // The headline must say the MODEL/deployment failed, never that the
    // document could not be read -- the exact wording this task exists to
    // fix.
    expect(body.error.message).not.toContain('Could not read');
    expect(body.error.message.toLowerCase()).toContain('model');
    expect(body.error.message.toLowerCase()).toContain('deployment');
    // The real exception message -- genuinely useful to whoever runs this
    // deployment -- must still reach `details`, exactly as before.
    expect(body.error.details).toEqual([
      'model invocation failed for "harborline-bid.pdf": Could not load credentials from any providers',
    ]);

    const snapshot = harness.caseStore.load(caseId);
    expect(snapshot?.entities).toHaveLength(0);
    expect(snapshot?.eventSequence).toBe(expectedSequence);
  });

  it('refuses an oversized document at the schema boundary, before any model call', async () => {
    harness = await createReaderHarness(undefined);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-5')
      .send({
        caseId,
        expectedSequence,
        filename: 'huge.pdf',
        text: 'a'.repeat(MAX_BID_DOCUMENT_BYTES + 1),
      });

    expect(response.status).toBe(400);
    // Refused as VALIDATION even with no reader configured at all -- the
    // schema boundary rejects this before the "no model configured" check
    // is ever reached.
    expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
  });

  it('returns 400 without an Idempotency-Key header (validation)', async () => {
    harness = await createReaderHarness(undefined);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .send({ caseId, expectedSequence, filename: 'x.pdf', text: 'some bid prose' });

    expect(response.status).toBe(400);
    expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
  });

  it('returns 400 when the body caseId does not match the URL caseId (validation)', async () => {
    harness = await createReaderHarness(undefined);
    const { caseId, expectedSequence } = await startDemo();

    const response = await request(harness.server)
      .post(`/api/cases/${caseId}/bid-documents/read`)
      .set('Idempotency-Key', 'cmd-read-6')
      .send({
        caseId: 'a-different-case-id',
        expectedSequence,
        filename: 'x.pdf',
        text: 'some bid prose',
      });

    expect(response.status).toBe(400);
    expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
  });
});
