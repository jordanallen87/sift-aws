/**
 * Model provider selection: a real `BedrockModel` for live runs
 * (`SIFT_MODEL_ID`/`AWS_REGION`, docs/specs/strands-runtime.md "Models and
 * configuration") and a deterministic `ScriptedModelProvider` test double
 * for CI ("Deterministic tests use a scripted `ModelProvider` test double
 * and never call Bedrock").
 *
 * **Corrected 2026-09-14: `resolveModelProvider` IS reached in production.**
 * `server.ts:240` calls it to build the bid-document reader whenever
 * `SIFT_BID_DOCUMENT_READER_ENABLED=true`, and that path was verified end to
 * end against Amazon Bedrock on 2026-09-14: Amazon Nova Lite
 * (`amazon.nova-lite-v1:0`, `us-east-1`) read a bid document's text and
 * created a real option on the case, every extracted attribute carrying
 * `origin: 'agent_proposed'` and never `verified`.
 *
 * The previous version of this comment said the opposite -- "not wired into
 * any production path", "their only callers are in `model-provider.test.ts`"
 * -- and stayed wrong long enough to be read as fact and repeated downstream.
 * It is called out rather than quietly deleted because a confident, dated,
 * false comment is worse than no comment.
 *
 * Still true: all three hero engines construct their scripted provider
 * unconditionally (`bid-comparison-engine.ts:450`'s
 * `modelFor: scriptedModelFor(providers)`, `home-energy-engine.ts`'s
 * identical call, `car-purchase-engine.ts`'s
 * `buildCarPurchaseScriptedProviders()`), with no branch on config or
 * credential availability -- so every hero *trajectory* is deterministic,
 * which is what the release gates require.
 * This is stated here rather than left to be inferred from a grep, because
 * the phrase "for live runs" above otherwise reads as a description of
 * shipped behavior. Wiring the live path is genuinely unfinished work
 * blocked on AWS credentials; see docs/specs/strands-runtime.md
 * "What actually ships".
 *
 * `ScriptedModelProvider` is a real Strands `Model` subclass (extends the
 * abstract `Model<BaseModelConfig>` from `@strands-agents/sdk`, implements
 * `updateConfig`/`getConfig`/`stream`) -- not a look-alike standing in for
 * one. Passing an instance as `AgentConfig.model` drives the *actual*
 * Strands `Agent` loop, tool-calling machinery, and structured-output
 * validation (`agent/agent.js`'s `StructuredOutputTool` mechanism) with
 * zero network access, by yielding the same `ModelStreamEvent` sequence a
 * real provider would.
 *
 * Response queues are named by scenario "beat" (`setBeat(beatId)`), not by
 * a single global call index -- a later task scripting a full deterministic
 * demo trajectory (multiple specialists, multiple obligations, multiple
 * model turns per specialist) needs to select which queue of turns the
 * provider draws from at each conceptual step, not just "the next call in
 * one flat list".
 */
import {
  BedrockModel,
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
import type { IdGenerator } from '@sift/core';

/** One scripted tool call within a `ScriptedTurn`. `toolUseId` is auto-generated (via the injected `IdGenerator`) when omitted. */
export interface ScriptedToolCall {
  name: string;
  toolUseId?: string;
  input: JSONValue;
}

/** One scripted model response: text, one or more tool calls, or both. An empty turn (`{}`) is a valid no-op text response. */
export interface ScriptedTurn {
  text?: string;
  toolCalls?: ScriptedToolCall[];
  usage?: Usage;
}

export interface ScriptedModelProviderConfig {
  /** Response queues keyed by scenario beat id. Each beat's turns are consumed in order, one per `stream()` call while that beat is active. */
  beats: Record<string, ScriptedTurn[]>;
  /** Deterministic ID source for auto-generated `toolUseId`s. Defaults to an internal monotonic counter -- still fully deterministic, just not shared with the rest of the run's ID space. */
  idGenerator?: IdGenerator;
  modelId?: string;
  /**
   * Milliseconds to wait before serving each turn. **Defaults to 0, and
   * every test and gate leaves it there** -- determinism and suite runtime
   * are unaffected.
   *
   * It exists for one honest reason. A scripted turn returns instantly,
   * because there is no inference to wait for: a complete six-specialist
   * Home Energy investigation emits 81 public activity events in ~1.05s
   * end to end (measured against the deployed service). A real Bedrock
   * turn takes seconds, so the *shape* a person would actually watch --
   * specialists arriving one at a time, a log filling in -- is collapsed
   * into a blink by the fixture, not by the product. Pacing restores that
   * shape for a demo recording. It adds latency to a model call that would
   * really have latency; it does not fabricate work, and every event, count
   * and ordering is identical with it on or off.
   */
  turnDelayMs?: number;
}

function defaultIdGenerator(): IdGenerator {
  let counter = 0;
  return {
    next: (prefix) => `${prefix ?? 'id'}-${++counter}`,
  };
}

/**
 * A real Strands `Model` implementation whose responses are scripted ahead
 * of time per named "beat", for deterministic tests and fixture-mode demo
 * trajectories. Never calls a network model provider.
 */
export class ScriptedModelProvider extends Model<BaseModelConfig> {
  private config: BaseModelConfig;
  private readonly beats: Map<string, ScriptedTurn[]>;
  private readonly cursors = new Map<string, number>();
  private readonly idGenerator: IdGenerator;
  private turnDelayMs: number;
  private currentBeat: string | undefined;

  /** Every call this provider has served, in order, including the exact `messages` array and `StreamOptions` (system prompt, tool specs) the agent sent -- for test assertions that plugin-injected content (skill metadata, Context Injector text) genuinely reached the model input. */
  readonly callLog: { beat: string; messages: Message[]; options?: StreamOptions }[] = [];

  constructor(config: ScriptedModelProviderConfig) {
    super();
    this.beats = new Map(Object.entries(config.beats));
    this.idGenerator = config.idGenerator ?? defaultIdGenerator();
    this.turnDelayMs = config.turnDelayMs ?? 0;
    this.config = { modelId: config.modelId ?? 'sift-scripted-model' };
  }

  /** Sets the per-turn pacing delay after construction, so a bundle of providers built by a shared factory can be paced as a group. 0 disables it. */
  setTurnDelayMs(ms: number): void {
    this.turnDelayMs = Math.max(0, ms);
  }

  /** Selects which beat's response queue the next `stream()` call draws from. Must be called before every conceptual step that invokes the agent. */
  setBeat(beat: string): void {
    this.currentBeat = beat;
  }

  /** The number of turns already consumed from `beat`'s queue. */
  cursorFor(beat: string): number {
    return this.cursors.get(beat) ?? 0;
  }

  override updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  override getConfig(): BaseModelConfig {
    return this.config;
  }

  // The `require-await` suppression that used to sit here is gone on purpose:
  // with `turnDelayMs` this method genuinely awaits, so the claim it carried --
  // "nothing to genuinely await, by design" -- stopped being true.
  override async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    if (this.currentBeat === undefined) {
      throw new Error(
        'ScriptedModelProvider: setBeat(beatId) must be called before invoking the agent',
      );
    }
    if (this.turnDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.turnDelayMs));
    }
    const beat = this.currentBeat;
    const queue = this.beats.get(beat);
    if (queue === undefined) {
      throw new Error(`ScriptedModelProvider: no scripted responses registered for beat "${beat}"`);
    }
    const index = this.cursorFor(beat);
    const turn = queue[index];
    if (turn === undefined) {
      throw new Error(`ScriptedModelProvider: beat "${beat}" exhausted after ${index} call(s)`);
    }
    this.cursors.set(beat, index + 1);
    this.callLog.push({ beat, messages, ...(options !== undefined ? { options } : {}) });

    yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' });

    const toolCalls = turn.toolCalls ?? [];
    for (const call of toolCalls) {
      const toolUseId = call.toolUseId ?? this.idGenerator.next('scripted-tool-use');
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

export interface BedrockModelOptions {
  modelId: string;
  awsRegion: string;
}

/** Builds a real `BedrockModel` from Sift's validated config (`SIFT_MODEL_ID`/`AWS_REGION` -- strands-runtime.md "Models and configuration"). Never used by a deterministic test. */
export function createBedrockModel(options: BedrockModelOptions): BedrockModel {
  return new BedrockModel({ modelId: options.modelId, region: options.awsRegion });
}

/** Selects the real model provider for a run: the given `scripted` double when present (deterministic tests and fixture-mode demos), otherwise a real `BedrockModel` built from `bedrock` config. */
export function resolveModelProvider(
  bedrock: BedrockModelOptions,
  scripted?: ScriptedModelProvider,
): Model<BaseModelConfig> {
  return scripted ?? createBedrockModel(bedrock);
}
