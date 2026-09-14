/**
 * `GET /ping` / `POST /invocations` (docs/specs/strands-runtime.md
 * "AgentCore contract"), against the real `CommandService`/`RunService`
 * command layer through `fixtures/http-harness.ts`'s real Express
 * application + real temporary SQLite database -- the same harness and
 * style `routes/commands.test.ts`/`routes/runs.test.ts` already use.
 */
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandReceipt, HttpConflictResponse, HttpErrorBody } from '@sift/contracts';
import { COMMAND_NAMES } from './commands.js';
import { asJson } from '../fixtures/http-types.js';
import { createHttpTestHarness, type HttpTestHarness } from '../fixtures/http-harness.js';
import { AGENTCORE_COMMAND_NAMES } from './agentcore.js';

interface PingBody {
  status: string;
  time_of_last_update: number;
}

interface InvocationEnvelope<T> {
  response: T;
  status: 'success';
}

describe('AgentCore contract: GET /ping / POST /invocations', () => {
  let harness: HttpTestHarness | undefined;

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

  describe('GET /ping', () => {
    it('returns exactly {status: "Healthy", time_of_last_update: <unix seconds>}', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server).get('/ping');

      expect(response.status).toBe(200);
      const body = asJson<PingBody>(response.body);
      expect(Object.keys(body).sort()).toEqual(['status', 'time_of_last_update']);
      expect(body.status).toBe('Healthy');
      expect(Number.isInteger(body.time_of_last_update)).toBe(true);
    });

    it('never advances time_of_last_update across repeated pings (AWS: "Do not set time_of_last_update to the current time on every ping")', async () => {
      harness = await createHttpTestHarness();

      const first = await request(harness.server).get('/ping');
      const second = await request(harness.server).get('/ping');

      expect(asJson<PingBody>(second.body).time_of_last_update).toBe(
        asJson<PingBody>(first.body).time_of_last_update,
      );
    });
  });

  describe('POST /invocations: structural authority boundary', () => {
    it('AGENTCORE_COMMAND_NAMES is exactly COMMAND_NAMES minus reviewProposal and reviewCaseExtension', () => {
      const expected = COMMAND_NAMES.filter(
        (name) => name !== 'reviewProposal' && name !== 'reviewCaseExtension',
      );
      expect([...AGENTCORE_COMMAND_NAMES].sort()).toEqual([...expected].sort());
    });

    it('rejects commandName "reviewProposal" as a schema validation failure, never reaching CommandService', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-1')
        .send({
          caseId,
          commandName: 'reviewProposal',
          input: {
            proposalId: 'does-not-matter',
            actor: 'human',
            decision: 'approve',
            expectedSequence,
          },
        });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
      // The case must be completely unaffected -- no proposal was reviewed.
      expect(harness.caseStore.load(caseId)?.eventSequence).toBe(expectedSequence);
    });

    it('rejects commandName "reviewCaseExtension" as a schema validation failure', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-2')
        .send({
          caseId,
          commandName: 'reviewCaseExtension',
          input: { extensionId: 'does-not-matter', decision: 'accept', expectedSequence },
        });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });
  });

  describe('POST /invocations: real command dispatch', () => {
    it('dispatches a real command (selectPack) into CommandService and durably persists the result', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-3')
        .send({
          caseId,
          commandName: 'selectPack',
          input: { packId: 'car-purchase', expectedSequence },
        });

      expect(response.status).toBe(200);
      const envelope = asJson<InvocationEnvelope<CommandReceipt>>(response.body);
      expect(envelope.status).toBe('success');
      expect(envelope.response.caseId).toBe(caseId);
      expect(harness.caseStore.load(caseId)?.eventSequence).toBe(
        envelope.response.acceptedSequence,
      );
    });

    it('requires an Idempotency-Key header for a mutating commandName call', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .send({
          caseId,
          commandName: 'selectPack',
          input: { packId: 'car-purchase', expectedSequence },
        });

      expect(response.status).toBe(400);
    });

    // Probes the conflict with `selectPack`, deliberately, not an
    // arbitrarily-chosen command: on the case `startDemo()` just seeded,
    // `CommandService.selectPack` (`services/command-service.ts`) has
    // exactly one failure branch reachable before its `loadForMutation`
    // sequence check ever runs -- `SelectPackInputSchema` parse failure --
    // and *zero* `policyFailure(...)` call anywhere in its body (confirmed
    // by reading the method: unlike `updateCriteria`, which does gate on
    // `pack.criteria.allowUserDefined`/`protectedCriterionIds`, `selectPack`
    // never calls `policyFailure` or throws `PolicyViolationError`). A
    // stale `expectedSequence` is therefore the *only* thing that can make
    // this specific request fail, and it always fails the same way: a real
    // sequence mismatch inside `loadForMutation`, which is checked before
    // pack resolution, so a valid `packId` never even gets a chance to
    // matter. `routes/commands.test.ts`'s own "returns 409 with the latest
    // snapshot for a stale expectedSequence (conflict)" test already
    // establishes this exact same `selectPack`-on-a-seeded-demo-case
    // pattern as this codebase's own idiom for isolating conflict behavior
    // -- and reserves a *separate* command (`updateCriteria`, removing a
    // protected criterion) for its "returns 403 for a policy violation"
    // test, right next to it. So the response asserted below is not merely
    // "usually" 409; it is structurally the single reachable outcome for
    // this request, verified by reading the handler rather than assumed --
    // asserting the full `HttpConflictResponseSchema` envelope (not just
    // the status code) below makes that guarantee visible in the test
    // itself, not just in this comment.
    it('returns a 409 conflict envelope with the latest snapshot for a stale expectedSequence', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-4')
        .send({
          caseId,
          commandName: 'selectPack',
          input: { packId: 'car-purchase', expectedSequence: expectedSequence + 5 },
        });

      expect(response.status).toBe(409);
      const body = asJson<HttpConflictResponse>(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.expectedSequence).toBe(expectedSequence + 5);
      expect(body.error.actualSequence).toBe(expectedSequence);
      expect(body.snapshot.id).toBe(caseId);
      expect(body.snapshot.eventSequence).toBe(expectedSequence);
    });

    it('is idempotent over HTTP: retrying the same Idempotency-Key returns the same accepted sequence', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();
      const body = {
        caseId,
        commandName: 'selectPack',
        input: { packId: 'car-purchase', expectedSequence },
      };

      const first = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-5')
        .send(body);
      const second = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-5')
        .send(body);

      expect(
        asJson<InvocationEnvelope<CommandReceipt>>(second.body).response.acceptedSequence,
      ).toBe(asJson<InvocationEnvelope<CommandReceipt>>(first.body).response.acceptedSequence);
    });
  });

  describe('POST /invocations: input defaulting when the input field is omitted', () => {
    it("defaults input to {} for a commandName dispatch (still requiring the command's own required fields)", async () => {
      harness = await createHttpTestHarness();
      const { caseId } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-no-input')
        .send({ caseId, commandName: 'selectPack' });

      // No crash from spreading a missing `input` -- CommandService's own
      // schema validation rejects the now-missing required `packId`/
      // `expectedSequence` fields instead.
      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });
  });

  describe('POST /invocations: requestInvestigation dispatch (RunService, the real engine)', () => {
    it('creates a real, durably recorded run via action: "requestInvestigation"', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-6')
        .send({ caseId, action: 'requestInvestigation', input: { expectedSequence } });

      expect(response.status).toBe(200);
      const envelope = asJson<InvocationEnvelope<{ runId: string }>>(response.body);
      expect(envelope.status).toBe('success');
      const runId = envelope.response.runId;
      expect(runId).toBeTruthy();

      const row = harness.database.sqlite
        .prepare('SELECT status FROM runs WHERE id = ?')
        .get(runId) as { status: string } | undefined;
      expect(row?.status).toBe('queued');
    });

    it('requires an Idempotency-Key header for action: "requestInvestigation" too, not just commandName dispatch', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .send({ caseId, action: 'requestInvestigation', input: { expectedSequence } });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });

    it('defaults input to {} for action: "requestInvestigation" (still requiring expectedSequence via RequestInvestigationInputSchema)', async () => {
      harness = await createHttpTestHarness();
      const { caseId } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-no-input-run')
        .send({ caseId, action: 'requestInvestigation' });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });

    it('rejects commandName and action supplied together as a validation failure', async () => {
      harness = await createHttpTestHarness();
      const { caseId, expectedSequence } = await startDemo();

      const response = await request(harness.server)
        .post('/invocations')
        .set('Idempotency-Key', 'cmd-invoke-7')
        .send({
          caseId,
          commandName: 'selectPack',
          action: 'requestInvestigation',
          input: { expectedSequence },
        });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /invocations: default read-only case context', () => {
    it('returns the real case snapshot when neither commandName nor action is given', async () => {
      harness = await createHttpTestHarness();
      const { caseId } = await startDemo();

      const response = await request(harness.server).post('/invocations').send({ caseId });

      expect(response.status).toBe(200);
      const envelope = asJson<InvocationEnvelope<{ id: string }>>(response.body);
      expect(envelope.status).toBe('success');
      expect(envelope.response.id).toBe(caseId);
    });

    it('returns 404 for an unknown case', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server)
        .post('/invocations')
        .send({ caseId: 'does-not-exist' });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /invocations: reachable through AgentCore (no custom headers)', () => {
    // AgentCore Runtime's InvokeAgentRuntime API forwards no custom request
    // headers (routes/http-support.ts's `readCommandId` header comment), so
    // every request in this block deliberately never calls `.set('Idempotency-Key', ...)`
    // and instead relies solely on the `idempotencyKey` body field.
    //
    // `car-purchase`, not `bid-comparison`: `createHttpTestHarness()` wires
    // `createRegistryWithSyntheticPack()` (fixtures/synthetic-pack.ts), whose
    // `PackRegistry` has only the synthetic `car-purchase` manifest
    // registered -- the same demo id this file's own top-level `startDemo()`
    // helper already uses. A real `bid-comparison` pack exists
    // (`command-service.bid-document.test.ts`), but only via a bespoke
    // `CommandService` wired to its own registry, not this shared HTTP
    // harness; registering it here too is out of scope for this task.

    it('starts a demo via action "startDemo" using a body idempotencyKey instead of the header, and the created case is reachable by caseId afterward', async () => {
      harness = await createHttpTestHarness();

      const startResponse = await request(harness.server)
        .post('/invocations')
        .send({
          action: 'startDemo',
          input: { demoId: 'car-purchase' },
          idempotencyKey: 'agentcore-start-1',
        });

      expect(startResponse.status).toBe(200);
      const startEnvelope = asJson<InvocationEnvelope<CommandReceipt>>(startResponse.body);
      expect(startEnvelope.status).toBe('success');
      expect(startEnvelope.response.caseId).toBeTruthy();
      const caseId = startEnvelope.response.caseId;

      const readResponse = await request(harness.server).post('/invocations').send({ caseId });

      expect(readResponse.status).toBe(200);
      const readEnvelope = asJson<InvocationEnvelope<{ id: string }>>(readResponse.body);
      expect(readEnvelope.status).toBe('success');
      expect(readEnvelope.response.id).toBe(caseId);
    });

    it('is idempotent over the body idempotencyKey for action "startDemo": retrying the same key returns the same caseId', async () => {
      harness = await createHttpTestHarness();
      const body = {
        action: 'startDemo',
        input: { demoId: 'car-purchase' },
        idempotencyKey: 'agentcore-start-2',
      };

      const first = await request(harness.server).post('/invocations').send(body);
      const second = await request(harness.server).post('/invocations').send(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(asJson<InvocationEnvelope<CommandReceipt>>(second.body).response.caseId).toBe(
        asJson<InvocationEnvelope<CommandReceipt>>(first.body).response.caseId,
      );
    });

    it('accepts a body idempotencyKey instead of the header for action "requestInvestigation" too', async () => {
      harness = await createHttpTestHarness();

      const startResponse = await request(harness.server)
        .post('/invocations')
        .send({
          action: 'startDemo',
          input: { demoId: 'car-purchase' },
          idempotencyKey: 'agentcore-start-3',
        });
      const started = asJson<InvocationEnvelope<CommandReceipt>>(startResponse.body).response;

      const response = await request(harness.server)
        .post('/invocations')
        .send({
          caseId: started.caseId,
          action: 'requestInvestigation',
          input: { expectedSequence: started.acceptedSequence },
          idempotencyKey: 'agentcore-invest-1',
        });

      expect(response.status).toBe(200);
      const envelope = asJson<InvocationEnvelope<{ runId: string }>>(response.body);
      expect(envelope.status).toBe('success');
      expect(envelope.response.runId).toBeTruthy();
    });

    it('rejects action "startDemo" together with a caseId as a schema validation failure', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server)
        .post('/invocations')
        .send({
          action: 'startDemo',
          caseId: 'does-not-matter',
          input: { demoId: 'car-purchase' },
          idempotencyKey: 'agentcore-start-4',
        });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });

    it('returns 400 for action "startDemo" when neither the header nor the body idempotencyKey is present', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server)
        .post('/invocations')
        .send({ action: 'startDemo', input: { demoId: 'car-purchase' } });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });

    it('rejects a malformed body idempotencyKey the same way readCommandId rejects a malformed header', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server)
        .post('/invocations')
        .send({
          action: 'startDemo',
          input: { demoId: 'car-purchase' },
          idempotencyKey: 'bad key!',
        });

      expect(response.status).toBe(400);
      expect(asJson<HttpErrorBody>(response.body).error.code).toBe('VALIDATION');
    });
  });

  describe('POST /invocations: malformed input', () => {
    it('returns 400 for a non-object (array) JSON body', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server).post('/invocations').send([1, 2, 3]);

      expect(response.status).toBe(400);
    });

    it('returns 400 when caseId is missing', async () => {
      harness = await createHttpTestHarness();

      const response = await request(harness.server).post('/invocations').send({});

      expect(response.status).toBe(400);
    });
  });
});
