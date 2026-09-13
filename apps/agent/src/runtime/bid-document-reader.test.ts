import { describe, expect, it } from 'vitest';
import { Model, type BaseModelConfig, type ModelStreamEvent } from '@strands-agents/sdk';
import {
  MAX_BID_DOCUMENT_BYTES,
  MAX_MODEL_READ_LINE_ITEMS,
  ModelReadBidDocumentSchema,
} from '@sift/contracts';
import { ScriptedModelProvider, type ScriptedTurn } from './model-provider.js';
import { READ_BID_DOCUMENT_PROMPT, readBidDocumentWithModel } from './bid-document-reader.js';

/**
 * A fully populated, schema-valid reading -- mirrors
 * `packages/scenarios/fixtures/bids/bid-northgate.json`'s own field names
 * and values so a reader of this test can see, at a glance, that the model
 * contract really does mirror the canonical fixture shape
 * `bid-document-reader.ts`'s header describes.
 */
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
    {
      label: 'Rough-in supply piping to all restroom and locker-room fixture locations',
      amount: { amount: 48_000, currency: 'USD' },
    },
  ],
};

/** A real `ScriptedModelProvider`, pre-selected onto one named beat, standing in for the injected model dependency -- no network, fully deterministic. */
function scriptedModel(turns: ScriptedTurn[]): ScriptedModelProvider {
  const provider = new ScriptedModelProvider({ beats: { read: turns } });
  provider.setBeat('read');
  return provider;
}

describe('readBidDocumentWithModel', () => {
  it('maps a well-formed model reading to an ok result carrying the canonical document', async () => {
    const model = scriptedModel([
      { toolCalls: [{ name: 'strands_structured_output', input: VALID_READING }] },
    ]);

    const result = await readBidDocumentWithModel({
      filename: 'northgate-bid.pdf',
      text: 'Northgate Plumbing hereby bids $276,000 for the restroom renovation...',
      model,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.document).toEqual(VALID_READING);
  });

  it('maps a partial reading (some fields genuinely omitted) to an ok result with exactly those fields present', async () => {
    const partialReading = {
      contractorName: 'Cedar Restoration',
      total: { amount: 190_000, currency: 'USD' },
    };
    const model = scriptedModel([
      { toolCalls: [{ name: 'strands_structured_output', input: partialReading }] },
    ]);

    const result = await readBidDocumentWithModel({
      filename: 'cedar-bid.pdf',
      text: 'Cedar Restoration bids $190,000...',
      model,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok:true');
    expect(result.document).toEqual(partialReading);
  });

  it('returns a typed failure, never a throw, when the model never produces valid structured output', async () => {
    // A single text-only turn: the SDK's own structured-output enforcement
    // (see this module's header comment, and strands-adapter.test.ts's
    // documented, empirically-verified behavior) forces a retry rather than
    // resolving with an invalid/missing structuredOutput -- with only one
    // scripted turn queued, the retry finds the beat exhausted and the
    // provider itself throws. That throw must never escape this function --
    // it must map to `kind: 'invocation_failed'`, the same discriminator a
    // genuinely unreachable/unauthenticated model produces (see the
    // dedicated test below), never `invalid_reading`: nothing about this
    // scenario is a fact about the DOCUMENT.
    const model = scriptedModel([{ text: 'I am unable to read this file as a bid.' }]);

    await expect(
      readBidDocumentWithModel({
        filename: 'garbled.pdf',
        text: 'some illegible prose',
        model,
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: 'invocation_failed',
      reason: expect.stringContaining('model invocation failed') as unknown,
    });
  });

  it('returns kind: invocation_failed, with the real error message in reason, when the model itself throws (e.g. missing AWS credentials)', async () => {
    // Not a `ScriptedModelProvider` beat-exhaustion throw (the test above)
    // but a `Model` whose `stream()` throws directly, on the first call --
    // exactly the shape a real `BedrockModel` produces when this deployment
    // has `SIFT_BID_DOCUMENT_READER_ENABLED=true` but no reachable AWS
    // credentials (this module's header, "the SDK's own structured-output
    // enforcement"; and the defect this `kind` exists to fix: see
    // `routes/bid-documents.ts`'s handling of this exact kind). The message
    // text is the literal one Bedrock's SDK produces for that condition.
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

    const result = await readBidDocumentWithModel({
      filename: 'harborline-bid.pdf',
      text: 'Harborline Roofing bids $88,000...',
      model: new ThrowingModel(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.kind).toBe('invocation_failed');
    expect(result.reason).toContain('Could not load credentials from any providers');
  });

  it('returns a typed failure when the model reads zero fields and zero line items', async () => {
    const model = scriptedModel([
      { toolCalls: [{ name: 'strands_structured_output', input: {} }] },
    ]);

    const result = await readBidDocumentWithModel({
      filename: 'blank.pdf',
      text: 'a document with nothing this reader recognises as a bid',
      model,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.kind).toBe('nothing_read');
    expect(result.reason).toContain('read nothing');
  });

  it('short-circuits with a typed failure before invoking the model when the document text is empty', async () => {
    // An empty beat: if the model were invoked at all, `setBeat` with no
    // queued turns would throw "no scripted responses registered" instead
    // of the expected failure reason, so this also proves the model call
    // never happens.
    const model = new ScriptedModelProvider({ beats: {} });

    const result = await readBidDocumentWithModel({
      filename: 'empty.txt',
      text: '   ',
      model,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'rejected',
      reason: 'document "empty.txt" is empty',
    });
  });

  it('short-circuits with a typed failure before invoking the model when the document exceeds the byte cap', async () => {
    const model = new ScriptedModelProvider({ beats: {} });
    const oversized = 'a'.repeat(MAX_BID_DOCUMENT_BYTES + 1);

    const result = await readBidDocumentWithModel({
      filename: 'huge.txt',
      text: oversized,
      model,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok:false');
    expect(result.kind).toBe('rejected');
    expect(result.reason).toContain(`${MAX_BID_DOCUMENT_BYTES}-byte cap`);
  });

  it('returns a typed failure immediately when the signal is already aborted, without invoking the model', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new ScriptedModelProvider({ beats: {} });

    const result = await readBidDocumentWithModel({
      filename: 'x.txt',
      text: 'hello',
      model,
      signal: controller.signal,
    });

    expect(result).toEqual({
      ok: false,
      kind: 'rejected',
      reason: 'cancelled before the model was invoked',
    });
  });

  // --- kind: 'invalid_reading' is deliberately not covered here ---
  //
  // Same empirically-verified reason `strands-adapter.test.ts` documents for
  // the structurally identical gap on `ExecutionResultSchema` (search that
  // file for "Deliberately not covered here"): `StructuredOutputTool`
  // (`@strands-agents/sdk`'s `structured-output-tool.js`) validates every
  // `strands_structured_output` tool call against the *exact same*
  // `ModelReadBidDocumentSchema` object this module re-parses below, and
  // `Agent._extractStructuredOutput` only ever populates
  // `AgentResult.structuredOutput` from a tool result whose `status` is
  // `'success'` -- which that validation can only produce by that schema's
  // `.parse()` already having succeeded. A model that calls the tool with
  // input the schema rejects never produces a resolved `structuredOutput`
  // at all: the SDK either re-prompts for another turn (consuming another
  // scripted beat turn, and throwing `invocation_failed` if the beat runs
  // out -- verified empirically the same way, against the real installed
  // `@strands-agents/sdk@1.14.0`) or, once a retry has been forced, throws
  // `StructuredOutputError` itself. Both outcomes are `invocation_failed`,
  // never a resolved-but-invalid `structuredOutput`. `parsed.success ===
  // false` below is therefore unreachable through this function's only
  // supported entry point (a real `Agent`, real schema, real model) and
  // stays defense in depth, exactly as its own comment already says --
  // never a lie this test suite pretends to exercise.
});

describe('READ_BID_DOCUMENT_PROMPT', () => {
  it('instructs the model to omit a field rather than guess at it', () => {
    const prompt = READ_BID_DOCUMENT_PROMPT.toLowerCase();
    expect(prompt).toContain('omit');
    expect(prompt).toContain('guess');
    // The actual instruction, not just the two words appearing separately.
    expect(READ_BID_DOCUMENT_PROMPT).toMatch(/guess(ing)? is (strictly )?worse than omitting/i);
  });

  it('instructs the model to disregard instructions embedded in the document text', () => {
    expect(READ_BID_DOCUMENT_PROMPT.toLowerCase()).toContain('untrusted');
    expect(READ_BID_DOCUMENT_PROMPT.toLowerCase()).toContain('ignore');
  });
});

describe('ModelReadBidDocumentSchema', () => {
  it('accepts a completely empty object -- every field is optional', () => {
    expect(ModelReadBidDocumentSchema.safeParse({}).success).toBe(true);
  });

  it('accepts the full canonical reading unchanged', () => {
    const parsed = ModelReadBidDocumentSchema.safeParse(VALID_READING);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(VALID_READING);
    }
  });

  it('rejects a depositPercent above 100 -- a field the document could not plausibly have stated', () => {
    expect(ModelReadBidDocumentSchema.safeParse({ depositPercent: 150 }).success).toBe(false);
  });

  it('rejects a negative depositPercent', () => {
    expect(ModelReadBidDocumentSchema.safeParse({ depositPercent: -1 }).success).toBe(false);
  });

  it('rejects a startInWeeks past the plausibility cap', () => {
    expect(ModelReadBidDocumentSchema.safeParse({ startInWeeks: 10_000 }).success).toBe(false);
  });

  it('rejects a total.amount past the plausibility cap', () => {
    const result = ModelReadBidDocumentSchema.safeParse({
      total: { amount: 1_000_000_000, currency: 'USD' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a currency that is not a three-letter ISO 4217 code', () => {
    const result = ModelReadBidDocumentSchema.safeParse({
      total: { amount: 100, currency: 'dollars' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a warranty term past the plausibility cap', () => {
    const result = ModelReadBidDocumentSchema.safeParse({ warranty: { termMonths: 10_000 } });
    expect(result.success).toBe(false);
  });

  it('rejects a top-level field the model was never asked for', () => {
    const result = ModelReadBidDocumentSchema.safeParse({ madeUpField: 'invented' });
    expect(result.success).toBe(false);
  });

  it('rejects a lineItems array over the cap', () => {
    const tooMany = Array.from({ length: MAX_MODEL_READ_LINE_ITEMS + 1 }, (_unused, index) => ({
      label: `item ${index}`,
      amount: { amount: 100, currency: 'USD' },
    }));
    expect(ModelReadBidDocumentSchema.safeParse({ lineItems: tooMany }).success).toBe(false);
  });

  it('accepts a lineItems array at exactly the cap', () => {
    const atCap = Array.from({ length: MAX_MODEL_READ_LINE_ITEMS }, (_unused, index) => ({
      label: `item ${index}`,
      amount: { amount: 100, currency: 'USD' },
    }));
    expect(ModelReadBidDocumentSchema.safeParse({ lineItems: atCap }).success).toBe(true);
  });

  it('accepts a line item with no scopeItemId', () => {
    const result = ModelReadBidDocumentSchema.safeParse({
      lineItems: [{ label: 'unnamed scope', amount: { amount: 500, currency: 'USD' } }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a line item missing its required amount', () => {
    const result = ModelReadBidDocumentSchema.safeParse({
      lineItems: [{ label: 'no price stated' }],
    });
    expect(result.success).toBe(false);
  });
});
