import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { StartCaseInput, StartDemoInput } from '@sift/contracts';
import { createSiftClient, SiftClientError } from './sift-client.js';

const BASE_URL = 'http://sift.test';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

const baseReceipt = {
  commandId: 'cmd-1',
  caseId: 'case-1',
  acceptedSequence: 1,
};

describe('createSiftClient', () => {
  it('posts startDemo to /api/cases/demo and returns a validated CommandReceipt', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(baseReceipt);
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const receipt = await client.startDemo({ demoId: 'car-purchase' });

    expect(receipt).toEqual(baseReceipt);
    expect(capturedBody).toMatchObject({ demoId: 'car-purchase' });
  });

  it('rejects an invalid demoId locally, without making a network request', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, () => {
        throw new Error('startDemo must not reach the network with invalid input');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const invalidInput = { demoId: 'not-a-real-demo' } as unknown as StartDemoInput;

    await expect(client.startDemo(invalidInput)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('posts startCase to /api/cases and returns a validated CommandReceipt', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE_URL}/api/cases`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(baseReceipt);
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const receipt = await client.startCase({ packId: 'car-purchase' });

    expect(receipt).toEqual(baseReceipt);
    expect(capturedBody).toMatchObject({ packId: 'car-purchase' });
  });

  it('rejects an invalid startCase input locally, without making a network request', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases`, () => {
        throw new Error('startCase must not reach the network with invalid input');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const invalidInput = {} as unknown as StartCaseInput;

    await expect(client.startCase(invalidInput)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('posts checkEnergyBillFeed to /api/cases/energy-bill-feed-check and returns a validated EnergyBillFeedCheckResult ("no case opened")', async () => {
    let capturedBody: unknown;
    const noCaseResult = {
      commandId: 'cmd-1',
      billFeedId: 'normal',
      caseOpened: false,
      percentAboveBaseline: 4.42,
      thresholdPercent: 15,
      reason: 'Your bill looks normal this month; no case opened.',
    };
    server.use(
      http.post(`${BASE_URL}/api/cases/energy-bill-feed-check`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(noCaseResult);
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const result = await client.checkEnergyBillFeed({ billFeedId: 'normal' });

    expect(result).toEqual(noCaseResult);
    expect(capturedBody).toMatchObject({ billFeedId: 'normal' });
  });

  it('posts checkEnergyBillFeed and returns a validated EnergyBillFeedCheckResult carrying a receipt ("case opened")', async () => {
    const openedResult = {
      commandId: 'cmd-1',
      billFeedId: 'anomalous',
      caseOpened: true,
      percentAboveBaseline: 42,
      thresholdPercent: 15,
      reason: 'Materially abnormal. Opening a case.',
      receipt: baseReceipt,
    };
    server.use(
      http.post(`${BASE_URL}/api/cases/energy-bill-feed-check`, () =>
        HttpResponse.json(openedResult),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const result = await client.checkEnergyBillFeed({ billFeedId: 'anomalous' });

    expect(result).toEqual(openedResult);
  });

  it('rejects an invalid checkEnergyBillFeed input locally, without making a network request', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/energy-bill-feed-check`, () => {
        throw new Error('checkEnergyBillFeed must not reach the network with invalid input');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const invalidInput = { billFeedId: 'made-up' } as unknown as Parameters<
      ReturnType<typeof createSiftClient>['checkEnergyBillFeed']
    >[0];

    await expect(client.checkEnergyBillFeed(invalidInput)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('posts requestInvestigation to /api/cases/:caseId/run and returns a RunReceipt', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/run`, () =>
        HttpResponse.json({ ...baseReceipt, runId: 'run-1' }),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const receipt = await client.requestInvestigation({ caseId: 'case-1', expectedSequence: 1 });

    expect(receipt.runId).toBe('run-1');
  });

  it('posts readBidDocument to /api/cases/:caseId/bid-documents/read, not the generic command endpoint', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/bid-documents/read`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(baseReceipt);
      }),
      http.post(`${BASE_URL}/api/cases/case-1/commands/readBidDocument`, () => {
        throw new Error('readBidDocument must not post to the generic command endpoint');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const receipt = await client.readBidDocument({
      caseId: 'case-1',
      expectedSequence: 1,
      filename: 'bid-northgate.pdf',
      text: 'Quoted total: $48,200',
    });

    expect(receipt).toEqual(baseReceipt);
    expect(capturedBody).toMatchObject({
      caseId: 'case-1',
      filename: 'bid-northgate.pdf',
      text: 'Quoted total: $48,200',
    });
  });

  it('rejects an invalid readBidDocument input locally, without making a network request', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/bid-documents/read`, () => {
        throw new Error('readBidDocument must not reach the network with invalid input');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });

    await expect(
      client.readBidDocument({
        caseId: 'case-1',
        expectedSequence: 1,
        filename: 'bid-northgate.pdf',
        text: '', // below the schema's `.min(1)`
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('surfaces a 503 UNAVAILABLE from readBidDocument verbatim, for a deployment with no model configured', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/bid-documents/read`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'UNAVAILABLE',
              message:
                'Reading a PDF bid document requires a model, and this deployment has none configured for it (SIFT_BID_DOCUMENT_READER_ENABLED is not enabled). Import the bid as a JSON or CSV file instead, or type its values in directly.',
              retryable: false,
            },
          },
          { status: 503 },
        ),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });

    await expect(
      client.readBidDocument({
        caseId: 'case-1',
        expectedSequence: 1,
        filename: 'bid-northgate.pdf',
        text: 'Quoted total: $48,200',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'UNAVAILABLE',
      message:
        'Reading a PDF bid document requires a model, and this deployment has none configured for it (SIFT_BID_DOCUMENT_READER_ENABLED is not enabled). Import the bid as a JSON or CSV file instead, or type its values in directly.',
    });
  });

  it.each([
    ['selectPack', { caseId: 'case-1', packId: 'car-purchase', expectedSequence: 1 }],
    ['focusOption', { caseId: 'case-1', optionId: 'opt-1', expectedSequence: 1 }],
    ['focusEvidence', { caseId: 'case-1', evidenceId: 'ev-1', expectedSequence: 1 }],
    [
      'updateCriteria',
      {
        caseId: 'case-1',
        expectedSequence: 1,
        operations: [{ op: 'reweight', criterionId: 'crit-1', weight: 50 }],
      },
    ],
    [
      'reviewProposal',
      {
        caseId: 'case-1',
        proposalId: 'prop-1',
        actor: 'human',
        decision: 'approve',
        expectedSequence: 1,
      },
    ],
    [
      'setEvidenceDisposition',
      {
        caseId: 'case-1',
        evidenceId: 'ev-1',
        disposition: 'excluded',
        reason: 'duplicate of another source',
        expectedSequence: 1,
      },
    ],
    [
      'requestRevision',
      {
        caseId: 'case-1',
        proposalId: 'prop-1',
        instructions: 'reweight comfort',
        expectedSequence: 1,
      },
    ],
  ] as const)('posts %s to the generic per-case command endpoint', async (methodName, input) => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/commands/${methodName}`, () =>
        HttpResponse.json(baseReceipt),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const method = client[methodName] as (value: typeof input) => Promise<unknown>;
    const receipt = await method(input);

    expect(receipt).toEqual(baseReceipt);
  });

  it('throws a SiftClientError carrying the parsed error code and status on a non-OK response', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/commands/selectPack`, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'stale sequence', retryable: true } },
          { status: 409 },
        ),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });

    await expect(
      client.selectPack({ caseId: 'case-1', packId: 'car-purchase', expectedSequence: 0 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      retryable: true,
    });
  });

  it('falls back to a generic SiftClientError when a non-OK response body does not match the error contract', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/commands/selectPack`, () =>
        HttpResponse.text('internal server error', { status: 500 }),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });

    await expect(
      client.selectPack({ caseId: 'case-1', packId: 'car-purchase', expectedSequence: 0 }),
    ).rejects.toMatchObject({
      status: 500,
      retryable: true,
      code: undefined,
    });
  });

  it('rejects with a SiftClientError when the server returns a malformed receipt', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, () => HttpResponse.json({ not: 'a receipt' })),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });

    await expect(client.startDemo({ demoId: 'car-purchase' })).rejects.toBeInstanceOf(
      SiftClientError,
    );
  });

  it('sends a fresh client-generated command id header on every call', async () => {
    const seenIds: string[] = [];
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, ({ request }) => {
        seenIds.push(request.headers.get('x-sift-command-id') ?? '');
        return HttpResponse.json(baseReceipt);
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    await client.startDemo({ demoId: 'car-purchase' });
    await client.startDemo({ demoId: 'car-purchase' });

    expect(seenIds).toHaveLength(2);
    expect(seenIds[0]).toBeTruthy();
    expect(new Set(seenIds).size).toBe(2);
  });

  it('honors an explicit commandId override on both the header and Idempotency-Key', async () => {
    let seenCommandId: string | null = null;
    let seenIdempotencyKey: string | null = null;
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, ({ request }) => {
        seenCommandId = request.headers.get('x-sift-command-id');
        seenIdempotencyKey = request.headers.get('idempotency-key');
        return HttpResponse.json(baseReceipt);
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    await client.startDemo({ demoId: 'car-purchase' }, { commandId: 'tool-call-42' });

    expect(seenCommandId).toBe('tool-call-42');
    expect(seenIdempotencyKey).toBe('tool-call-42');
  });

  it('rejects with an UNAVAILABLE/retryable SiftClientError when the signal is already aborted', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, () => {
        throw new Error('an already-aborted request must never reach the network');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.startDemo({ demoId: 'car-purchase' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it('rejects with an UNAVAILABLE/retryable SiftClientError when the signal aborts mid-request', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/demo`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json(baseReceipt);
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const controller = new AbortController();
    const pending = client.startDemo({ demoId: 'car-purchase' }, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it('forwards the signal so a genericCommand call can also be aborted', async () => {
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/commands/focusOption`, () => {
        throw new Error('an already-aborted request must never reach the network');
      }),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.focusOption(
        { caseId: 'case-1', optionId: 'candidate-rav4', expectedSequence: 0 },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
  });

  it('propagates a non-abort fetch failure as-is rather than mislabeling it UNAVAILABLE', async () => {
    const client = createSiftClient({
      baseUrl: BASE_URL,
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });

    await expect(client.startDemo({ demoId: 'car-purchase' })).rejects.toThrow('Failed to fetch');
  });

  it('parses a real 409 conflict body into code/actualSequence/snapshot rather than a generic failure', async () => {
    const snapshot = {
      schemaVersion: '1.0' as const,
      id: 'case-1',
      title: 'Choose our next family car',
      status: 'draft' as const,
      pack: {
        id: 'car-purchase',
        version: '1.0.0',
        compiledHash: 'a'.repeat(64),
        selectedBy: 'user' as const,
        reasons: ['User selected this Decision Pack'],
      },
      attributeDefinitions: [],
      entities: [],
      criteria: [],
      obligations: [],
      caseExtensions: [],
      claims: [],
      sources: [],
      evidenceLinks: [],
      recommendation: null,
      proposal: null,
      activeFocus: null,
      selectedOptionId: null,
      selectedEvidenceId: null,
      eventSequence: 4,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:05:00.000Z',
    };
    server.use(
      http.post(`${BASE_URL}/api/cases/case-1/commands/focusOption`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'CONFLICT',
              message: 'Expected sequence 1 does not match the current sequence 4.',
              retryable: true,
              expectedSequence: 1,
              actualSequence: 4,
            },
            snapshot,
          },
          { status: 409 },
        ),
      ),
    );

    const client = createSiftClient({ baseUrl: BASE_URL });

    await expect(
      client.focusOption({ caseId: 'case-1', optionId: 'candidate-rav4', expectedSequence: 1 }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      retryable: true,
      details: {
        expectedSequence: 1,
        actualSequence: 4,
        snapshot,
      },
    });
  });
});
