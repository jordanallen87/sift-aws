/**
 * SPIKE 4: LLM steering (`LLMSteeringHandler` from
 * `@strands-agents/sdk/vended-interventions/steering`) with a custom
 * `SteeringContextProvider` supplying a fake external "feed delta".
 *
 * Goal: prove a custom context provider's data reaches the steering LLM's
 * evaluation prompt, that the steering handler's own model can itself be a
 * `ScriptedModelProvider` (deterministic, no live model), and that a
 * `'guide'` decision's feedback text reaches the PARENT agent -- as a
 * cancelled tool call carrying "GUIDANCE: <feedback>" -- before the parent's
 * next tool-call attempt.
 *
 * Key finding from reading `handlers/llm.js` directly: the steering
 * decision surface is a three-way discriminated union --
 * `'proceed' | 'guide' | 'confirm'` -- produced by an INNER Strands `Agent`
 * the handler builds itself
 * (`structuredOutputSchema: z.object({ type: enum, reason: string })`), so
 * scripting it deterministically means scripting a `strands_structured_output`
 * tool call (the SDK's internal structured-output mechanism, confirmed by
 * grepping `apps/agent/src/runtime/*.test.ts` for the same pattern), not a
 * plain text turn.
 *
 * Also confirmed by reading `interventions/registry.js` directly: a `guide`
 * decision on `beforeToolCall` sets `event.cancel = "GUIDANCE: ${feedback}"`
 * -- it CANCELS the tool call (does not let it proceed with an annotation),
 * so "guidance reaches the agent before its next tool call" means the
 * agent's currently-attempted tool call is blocked and the guidance is what
 * it sees when deciding what to do next.
 */
import { describe, expect, it } from 'vitest';
import { Agent, tool } from '@strands-agents/sdk';
import {
  LLMSteeringHandler,
  type SteeringContextData,
  type SteeringContextProvider,
} from '@strands-agents/sdk/vended-interventions/steering';
import type { LocalAgent } from '@strands-agents/sdk';
import { z } from 'zod';
import { ScriptedModelProvider } from './helpers/scripted-model.js';

const FEED_DELTA_TEXT = 'Cedar & Sons submitted a revised bid; permits now priced';

/**
 * Custom `SteeringContextProvider`: supplies a fake external "feed delta" --
 * data the steering handler could not know just from watching agent
 * lifecycle hooks (unlike the SDK's own `ToolLedgerProvider`, which derives
 * its context purely from `beforeToolCall`/`afterToolCall` hooks on the
 * agent it observes). `observeAgent` is a required method on the interface
 * (`context-provider.d.ts`), even though this provider has nothing to
 * subscribe to -- its data comes from outside the agent's own lifecycle.
 */
class FakeFeedDeltaProvider implements SteeringContextProvider {
  readonly name = 'feedDelta';
  private delta: string | undefined;

  observeAgent(_agent: LocalAgent): void {
    // No hooks needed -- this provider's data arrives from an external feed,
    // not from watching this agent's own tool/model calls.
  }

  /** Simulates a delta arriving on an external feed after construction. */
  publish(delta: string): void {
    this.delta = delta;
  }

  get context(): SteeringContextData {
    return { type: 'feedDelta', delta: this.delta ?? null };
  }
}

function buildCheckPermitsTool(executed: { count: number }) {
  return tool({
    name: 'check_permits',
    description: 'Checks whether permits are priced into a bid.',
    inputSchema: z.object({ bidId: z.string() }),
    callback: (input) => {
      executed.count += 1;
      return { bidId: input.bidId, permitsPriced: false };
    },
  });
}

describe('spike: LLMSteeringHandler + custom SteeringContextProvider', () => {
  it('scripted steering model returns "guide"; the feed-delta guidance reaches the parent agent before its next tool call', async () => {
    const executed = { count: 0 };

    const feedDeltaProvider = new FakeFeedDeltaProvider();
    feedDeltaProvider.publish(FEED_DELTA_TEXT);

    // The steering handler's OWN model -- entirely separate from the parent
    // agent's model. Scripted to deterministically return a `guide` decision
    // via the SDK's internal structured-output tool-call convention.
    const steeringModel = new ScriptedModelProvider({
      turns: [
        {
          toolCalls: [
            {
              name: 'strands_structured_output',
              input: {
                type: 'guide',
                reason: `Feed update: ${FEED_DELTA_TEXT}. Re-check before proceeding.`,
              },
            },
          ],
        },
      ],
    });

    const steeringHandler = new LLMSteeringHandler({
      systemPrompt:
        'You steer a bid-comparison agent. If the feed-delta context shows a relevant update, guide the agent to account for it before it proceeds.',
      model: steeringModel,
      contextProviders: [feedDeltaProvider],
    });

    const parentModel = new ScriptedModelProvider({
      turns: [
        { toolCalls: [{ name: 'check_permits', input: { bidId: 'bid-cedar-sons' } }] },
        {
          text: 'Noted the revised bid: permits are now priced. Recommending Cedar & Sons.',
        },
      ],
    });

    const parentAgent = new Agent({
      id: 'bid-comparison-agent',
      model: parentModel,
      printer: false,
      tools: [buildCheckPermitsTool(executed)],
      interventions: [steeringHandler],
    });

    const result = await parentAgent.invoke(
      'Check whether permits are priced into the Cedar & Sons bid.',
    );

    // The steering handler's inner agent was invoked exactly once, driven by
    // OUR scripted steering model -- not a live model.
    expect(steeringModel.callCount()).toBe(1);

    // The tool call the steering handler evaluated was cancelled (guide on
    // beforeToolCall cancels, per `registry.js`), so the fixture tool never
    // actually ran.
    expect(executed.count).toBe(0);

    expect(result.stopReason).not.toBe('interrupt');

    // The parent model was called twice: once producing the (cancelled)
    // tool call, once more after seeing the cancellation-with-guidance
    // tool-result message.
    expect(parentModel.callLog).toHaveLength(2);

    const secondCallMessages = parentModel.callLog[1]?.messages ?? [];
    const guidanceReachedModel = secondCallMessages.some((message) =>
      message.content.some(
        (block) =>
          block.type === 'toolResultBlock' &&
          block.content.some((c) => 'text' in c && c.text?.includes(FEED_DELTA_TEXT)),
      ),
    );
    expect(guidanceReachedModel).toBe(true);

    // And the guidance text is genuinely present as a "GUIDANCE: ..." cancel
    // message in the agent's own durable conversation history too.
    const guidanceMessage = parentAgent.messages.find((message) =>
      message.content.some(
        (block) =>
          block.type === 'toolResultBlock' &&
          block.status === 'error' &&
          block.content.some((c) => 'text' in c && c.text?.startsWith('GUIDANCE:')),
      ),
    );
    expect(guidanceMessage).toBeDefined();
  });
});
