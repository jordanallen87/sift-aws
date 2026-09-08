/**
 * SPIKE 3: A2A round-trip (`A2AServer`/`A2AExpressServer`/`A2AAgent` from
 * `@strands-agents/sdk/a2a` and `@strands-agents/sdk/a2a/express`).
 *
 * Goal: start an in-process A2A server wrapping a scripted-model `Agent` on
 * an ephemeral port, call it via `A2AAgent` from a second, independent
 * process-side client, and assert a result returns. The SDK marks the A2A
 * module experimental (`a2a/index.d.ts`: "The A2A protocol is experimental,
 * so breaking changes in the underlying SDK may require breaking changes in
 * this module") -- this spike reports any warnings, missing peer deps, or
 * breakage honestly rather than papering over them.
 *
 * Requires `@a2a-js/sdk` (an optional peer dep of `@strands-agents/sdk`, NOT
 * installed at the workspace root) and `express` (also optional at the SDK
 * level, though already a direct dependency of `@sift/agent` -- just not
 * hoisted to the workspace root under pnpm's strict node_modules layout).
 * Both come from `spikes/package.json`'s standalone `npm install`.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { Agent } from '@strands-agents/sdk';
import { A2AAgent } from '@strands-agents/sdk/a2a';
import { A2AExpressServer } from '@strands-agents/sdk/a2a/express';
import { ScriptedModelProvider } from './helpers/scripted-model.js';

let server: A2AExpressServer | undefined;
let abortController: AbortController | undefined;

afterEach(async () => {
  abortController?.abort();
  server = undefined;
  abortController = undefined;
});

describe('spike: A2A round-trip (in-process server, ephemeral port)', () => {
  it('serves a scripted-model Agent over A2A and a client Agent proxy gets a result back', async () => {
    const serverModel = new ScriptedModelProvider({
      turns: [{ text: 'The best contractor is Cedar & Sons based on the lowest adjusted total.' }],
    });
    const serverAgent = new Agent({
      id: 'bid-advisor',
      name: 'Bid Advisor',
      model: serverModel,
      printer: false,
    });

    // Port 0 -> OS-assigned ephemeral port; `A2AExpressServer.port` reflects
    // the actual bound port after `serve()` resolves (per
    // `express-server.d.ts`'s `port` getter doc comment).
    // `agentFactory` (not the deprecated single `agent:`) is the
    // currently-recommended shape: `agent:` logs "Passing a single 'agent'
    // to A2AExecutor is deprecated ... pass an agentFactory (a callable
    // taking the contextId) instead" at runtime (confirmed empirically,
    // this file's earlier draft used `agent:` and the warning appeared in
    // vitest's stderr). At construction time the factory is invoked once
    // with a placeholder context id to derive agent-card metadata (per
    // `A2AServerConfig.agentFactory`'s doc comment), so every real context
    // gets this same one scripted-model agent for this spike's purposes.
    server = new A2AExpressServer({
      agentFactory: () => serverAgent,
      name: 'Bid Advisor',
      description: 'Recommends the best subcontractor bid.',
      host: '127.0.0.1',
      port: 0,
    });

    abortController = new AbortController();
    const served = server.serve({ signal: abortController.signal });

    // `serve()` resolves once listening starts per its own doc comment
    // ("Starts the HTTP server and begins listening"); race it against a
    // short poll of `.port` becoming non-zero in case `serve()`'s promise
    // only settles on shutdown instead.
    await Promise.race([
      served.catch(() => undefined),
      new Promise<void>((resolve) => {
        const check = (): void => {
          if (server && server.port !== 0) {
            resolve();
            return;
          }
          setTimeout(check, 10);
        };
        check();
      }),
    ]);

    expect(server.port).toBeGreaterThan(0);

    const client = new A2AAgent({ url: `http://127.0.0.1:${server.port}` });
    const result = await client.invoke('Which contractor should we pick?');

    expect(result.stopReason).toBeDefined();
    expect(result.toString().length).toBeGreaterThan(0);
    expect(result.toString()).toContain('Cedar & Sons');
  });
});
