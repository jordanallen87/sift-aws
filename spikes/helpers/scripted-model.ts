/**
 * Local copy of Sift's `ScriptedModelProvider` (mirrors, byte-for-byte in
 * spirit, `apps/agent/src/runtime/model-provider.ts` -- read-only reference,
 * never imported directly since spikes/ is not a pnpm workspace member and
 * must not modify or depend on tracked files). A real Strands `Model`
 * subclass (`extends Model<BaseModelConfig>`) that returns canned turns with
 * zero network access, so every spike in this directory drives the actual
 * Strands `Agent` loop / tool-calling / structured-output machinery with a
 * scripted double standing in only for the model provider.
 *
 * Trimmed relative to the tracked original: no multi-beat queue keying (each
 * spike only needs one straight-line queue of turns), no `turnDelayMs`
 * pacing, no injected `IdGenerator` (uses an internal monotonic counter).
 * Kept: the exact `ModelStreamEvent` sequence shape (`ModelMessageStartEvent`
 * -> per-tool-call `ModelContentBlockStart/Delta/Stop` -> optional text
 * block -> `ModelMessageStopEvent` -> `ModelMetadataEvent`), because that
 * shape is what the real `Agent` loop parses.
 */
import {
  Model,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  ModelMetadataEvent,
  type BaseModelConfig,
  type JSONValue,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
  type Usage,
} from '@strands-agents/sdk';

export interface ScriptedToolCall {
  name: string;
  toolUseId?: string;
  input: JSONValue;
}

export interface ScriptedTurn {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  usage?: Usage;
}

export interface ScriptedModelProviderConfig {
  turns: ScriptedTurn[];
  modelId?: string;
}

/**
 * A real Strands `Model` implementation whose responses are scripted ahead
 * of time, one turn per `stream()` call, in the order given. Never calls a
 * network model provider.
 */
export class ScriptedModelProvider extends Model<BaseModelConfig> {
  private config: BaseModelConfig;
  private readonly turns: ScriptedTurn[];
  private cursor = 0;
  private toolUseCounter = 0;

  /** Every call this provider has served, in order, including the exact `messages` array and `StreamOptions` the agent sent -- so a spike can assert plugin/steering-injected content genuinely reached the model input. */
  readonly callLog: { messages: Message[]; options?: StreamOptions }[] = [];

  constructor(config: ScriptedModelProviderConfig) {
    super();
    this.turns = config.turns;
    this.config = { modelId: config.modelId ?? 'sift-spike-scripted-model' };
  }

  /** Number of `stream()` calls already served. */
  callCount(): number {
    return this.cursor;
  }

  override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  override getConfig(): BaseModelConfig {
    return this.config;
  }

  // `async` is required by the override signature, not by the body: a plain `*stream()`
  // returns `Iterable`, and only `async *` satisfies the base class's
  // `AsyncIterable<ModelStreamEvent>` return type. This scripted provider resolves every
  // turn synchronously from an in-memory array, so it has nothing to await -- a real
  // provider awaiting a network call would.
  // eslint-disable-next-line @typescript-eslint/require-await -- see comment above.
  override async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const index = this.cursor;
    const turn = this.turns[index];
    if (turn === undefined) {
      throw new Error(
        `ScriptedModelProvider: exhausted after ${index} call(s); add more turns for this spike`,
      );
    }
    this.cursor += 1;
    this.callLog.push({ messages, ...(options !== undefined ? { options } : {}) });

    yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' });

    const toolCalls = turn.toolCalls ?? [];
    for (const call of toolCalls) {
      const toolUseId = call.toolUseId ?? `scripted-tool-use-${++this.toolUseCounter}`;
      yield new ModelContentBlockStartEvent({
        type: 'modelContentBlockStartEvent',
        start: { type: 'toolUseStart', name: call.name, toolUseId },
      });
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'toolUseInputDelta', input: JSON.stringify(call.input) },
      });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
    }

    if (turn.text !== undefined && turn.text.length > 0) {
      yield new ModelContentBlockStartEvent({ type: 'modelContentBlockStartEvent' });
      yield new ModelContentBlockDeltaEvent({
        type: 'modelContentBlockDeltaEvent',
        delta: { type: 'textDelta', text: turn.text },
      });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
    }

    yield new ModelMessageStopEvent({
      type: 'modelMessageStopEvent',
      stopReason: toolCalls.length > 0 ? 'toolUse' : 'endTurn',
    });

    yield new ModelMetadataEvent({
      type: 'modelMetadataEvent',
      usage: turn.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
  }
}
