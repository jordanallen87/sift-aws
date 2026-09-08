/**
 * SPIKE 5: `MemoryManager` (`@strands-agents/sdk`, re-exported from the main
 * entry point per `index.d.ts`'s `export { MemoryManager } from
 * './memory/index.js'` -- there is no separate `/memory` subpath export)
 * constructed with `TestMemoryStore`
 * (`@strands-agents/sdk/vended-memory-stores/test-memory-store`).
 *
 * Goal: confirm (a) `add` then `search` round-trips an entry through a
 * programmatic `MemoryManager`, and (b) the injection middleware folds
 * retrieved memory into the model input for a fresh user turn, verified by
 * inspecting the SCRIPTED model's own received `messages` -- not just that
 * injection is "on".
 *
 * `TestMemoryStore` persists to `~/.strands/memory/<name>.json` by default;
 * this spike passes `persist: false` so it never touches the real
 * filesystem (an ephemeral `InMemoryStorage` backend per the store's own
 * doc comment), appropriate for a throwaway, side-effect-free spike.
 */
import { describe, expect, it } from 'vitest';
import { Agent, MemoryManager } from '@strands-agents/sdk';
import { TestMemoryStore } from '@strands-agents/sdk/vended-memory-stores/test-memory-store';
import { ScriptedModelProvider } from './helpers/scripted-model.js';

describe('spike: MemoryManager + TestMemoryStore', () => {
  it('add() then search() round-trips an entry (programmatic, no Agent involved)', async () => {
    const store = new TestMemoryStore({ name: 'spike-notes', writable: true, persist: false });
    const manager = new MemoryManager({ stores: [store], injection: false });

    await manager.add('The user prefers a hybrid SUV under $35,000.');
    const results = await manager.search('what kind of vehicle does the user want?');

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((entry) => entry.content.includes('hybrid SUV'))).toBe(true);
  });

  it('injection middleware folds retrieved memory into the model input on a fresh user turn, with the scripted model', async () => {
    const store = new TestMemoryStore({ name: 'spike-notes-injection', writable: true, persist: false });
    const manager = new MemoryManager({
      stores: [store],
      searchToolConfig: false,
      addToolConfig: false,
      injection: true, // default: trigger 'userTurn', maxEntries 5
    });

    await manager.add('The user prefers a hybrid SUV under $35,000.');

    const model = new ScriptedModelProvider({
      turns: [{ text: 'Based on your preferences, I recommend the RAV4 Hybrid.' }],
    });

    const agent = new Agent({
      id: 'car-advisor',
      model,
      printer: false,
      plugins: [manager],
    });

    // FINDING: the default injection query is adaptive -- the latest user
    // message's own text, searched lexically (token-overlap, per
    // `TestMemoryStore.search`'s doc comment: "Recall is lexical: results
    // are ranked by how many query tokens overlap an entry's content" -- NOT
    // semantic search). A query sharing no token with the stored entry
    // (verified empirically: 'What car should I get?' against 'The user
    // prefers a hybrid SUV under $35,000.') gets zero search results and
    // therefore injects nothing. The user turn below deliberately echoes a
    // word from the stored memory ('hybrid') so lexical recall actually
    // finds it -- this is not a contrived requirement, it is how
    // `TestMemoryStore` + the default adaptive query genuinely behave.
    await agent.invoke('Any updates on that hybrid I asked about?');

    expect(model.callLog).toHaveLength(1);
    const sentMessages = model.callLog[0]?.messages ?? [];
    // Content block instances discriminate on `type: 'textBlock'` (per
    // `types/messages.d.ts`'s `TextBlock` class), not `'text'` -- confirmed
    // empirically the same way spike 2 found `'toolResultBlock'`.
    const injectedTextReachedModel = sentMessages.some((message) =>
      message.content.some((block) => block.type === 'textBlock' && block.text.includes('hybrid SUV')),
    );
    expect(injectedTextReachedModel).toBe(true);

    // The fold is ephemeral and per-call, as documented
    // (`message-injection.js`: "the agent's durable history is never
    // touched"): the agent's OWN stored `messages` should still hold only
    // the plain user ask, not the injected `<memory>` block.
    const durableUserMessage = agent.messages.find((message) => message.role === 'user');
    expect(durableUserMessage?.content).toHaveLength(1);
  });
});
