/**
 * SPIKE 2: Cedar authorization (`CedarAuthorization` from
 * `@strands-agents/sdk/vended-interventions/cedar`).
 *
 * Goal: prove a Cedar policy can permit one agent principal to call a tool
 * and forbid another, with the principal supplied dynamically via
 * `principalResolver` reading `invocationState` (rather than a static
 * `principal`), against this project's scripted `Model` double.
 *
 * Requires `@cedar-policy/cedar-wasm` and
 * `@cedar-policy/mcp-schema-generator-wasm` (both optional peer deps of
 * `@strands-agents/sdk`, NOT installed at the workspace root -- see
 * `spikes/package.json`'s standalone `npm install`). `cedar.js` imports both
 * unconditionally at module load (`isAuthorized`/`checkParsePolicySet`/
 * `validate` from cedar-wasm, `* as mcpSchemaGeneratorWasm`), so even a spike
 * that never generates a schema needs both packages resolvable.
 */
import { describe, expect, it } from 'vitest';
import { Agent, tool } from '@strands-agents/sdk';
import { CedarAuthorization } from '@strands-agents/sdk/vended-interventions/cedar';
import { z } from 'zod';
import { ScriptedModelProvider } from './helpers/scripted-model.js';

/** One Cedar policy set for this spike: `credential-checker` may call `license-lookup`; `price-analyst` may not. Action = tool name (unnamespaced `Action::"..."`), matching `cedar.ts`'s documented mapping ("Action = tool name, Resource = unconstrained"). */
const POLICIES = `
permit(
  principal == Agent::"credential-checker",
  action == Action::"license-lookup",
  resource
);

forbid(
  principal == Agent::"price-analyst",
  action == Action::"license-lookup",
  resource
);
`;

function buildLicenseLookupTool(executed: { count: number }) {
  return tool({
    name: 'license-lookup',
    description: "Reads a contractor's license status from a fixture registry.",
    inputSchema: z.object({ licenseNumber: z.string() }),
    callback: (input) => {
      executed.count += 1;
      return { licenseNumber: input.licenseNumber, status: 'active' };
    },
  });
}

/** Reads the calling agent's id from `invocationState.callerAgentId`, mirroring a multi-tenant setup where the principal is not known until invoke time. Returns `undefined` (fail-closed deny, per `CedarAuthorizationConfig.principalResolver`'s doc comment) for an unrecognized caller. */
function resolvePrincipal(invocationState: Record<string, unknown>): { type: string; id: string } | undefined {
  const callerAgentId = invocationState['callerAgentId'];
  if (typeof callerAgentId !== 'string') return undefined;
  return { type: 'Agent', id: callerAgentId };
}

describe('spike: Cedar authorization with a dynamic principalResolver', () => {
  it('permits credential-checker to call license-lookup', async () => {
    const executed = { count: 0 };
    const model = new ScriptedModelProvider({
      turns: [
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'LIC-9001' } }] },
        { text: 'License LIC-9001 is active.' },
      ],
    });
    const cedar = new CedarAuthorization({ policies: POLICIES, principalResolver: resolvePrincipal });
    const agent = new Agent({
      id: 'credential-checker',
      model,
      printer: false,
      tools: [buildLicenseLookupTool(executed)],
      interventions: [cedar],
    });

    const result = await agent.invoke('Look up the license.', {
      invocationState: { callerAgentId: 'credential-checker' },
    });

    expect(result.stopReason).not.toBe('interrupt');
    expect(executed.count).toBe(1);
  });

  it('denies price-analyst calling license-lookup: the tool does NOT run, and the deny surfaces as a cancelled tool call the model sees', async () => {
    const executed = { count: 0 };
    const model = new ScriptedModelProvider({
      turns: [
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'LIC-9001' } }] },
        // Follow-up turn: the model sees the tool result carrying the Cedar
        // deny reason (Deny -> `event.cancel = reason`, shown to the model
        // per `interventions/actions.d.ts`) and responds in natural language.
        { text: 'I am not authorized to look up licenses; escalating to credential-checker.' },
      ],
    });
    const cedar = new CedarAuthorization({ policies: POLICIES, principalResolver: resolvePrincipal });
    const agent = new Agent({
      id: 'price-analyst',
      model,
      printer: false,
      tools: [buildLicenseLookupTool(executed)],
      interventions: [cedar],
    });

    const result = await agent.invoke('Look up the license.', {
      invocationState: { callerAgentId: 'price-analyst' },
    });

    expect(result.stopReason).not.toBe('interrupt');
    expect(executed.count).toBe(0);

    // The deny is NOT an interrupt and NOT a thrown exception under the
    // default `onError: 'throw'` (that governs handler *errors*, not a
    // policy-driven Deny) -- it is a synchronous `InterventionAction` that
    // cancels the tool call before it runs. Confirm the cancellation reason
    // reached the model as a tool-result error the assistant could act on.
    // Content block instances discriminate on `type: 'toolResultBlock'` with
    // flattened `status`/`content`/`toolUseId` fields; the `{ toolResult:
    // {...} }` wrapper shape only appears from `toJSON()` (confirmed against
    // `types/messages.d.ts`'s `ToolResultBlock` class and by inspecting
    // `agent.messages` at runtime, which does NOT match that JSON shape).
    const toolResultMessage = agent.messages.find((message) =>
      message.content.some((block) => block.type === 'toolResultBlock'),
    );
    expect(toolResultMessage).toBeDefined();
    const toolResultBlock = toolResultMessage?.content.find(
      (block): block is { type: 'toolResultBlock'; status: string; content: { text?: string }[] } =>
        block.type === 'toolResultBlock',
    );
    expect(toolResultBlock?.status).toBe('error');
    expect(toolResultBlock?.content?.[0]?.text).toMatch(/denied/i);
  });

  it('fails closed when principalResolver cannot resolve a principal (unrecognized caller)', async () => {
    const executed = { count: 0 };
    const model = new ScriptedModelProvider({
      turns: [
        { toolCalls: [{ name: 'license-lookup', input: { licenseNumber: 'LIC-9001' } }] },
        { text: 'Unable to authorize this request.' },
      ],
    });
    const cedar = new CedarAuthorization({ policies: POLICIES, principalResolver: resolvePrincipal });
    const agent = new Agent({
      id: 'unknown-agent',
      model,
      printer: false,
      tools: [buildLicenseLookupTool(executed)],
      interventions: [cedar],
    });

    const result = await agent.invoke('Look up the license.', {
      invocationState: {}, // no callerAgentId -> resolvePrincipal returns undefined
    });

    expect(result.stopReason).not.toBe('interrupt');
    expect(executed.count).toBe(0);
  });
});
