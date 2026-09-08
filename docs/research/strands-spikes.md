# Strands SDK feature spikes (2026-09-07)

Throwaway feasibility spikes proving (or disproving) four never-before-used
`@strands-agents/sdk@1.14.0` features against this project's own scripted
`Model` test double, plus a `MemoryManager` smoke check. All code lives under
`spikes/` (untracked, not a pnpm workspace member -- see
`pnpm-workspace.yaml`, which globs only `apps/*` and `packages/*`). No
tracked file was modified. Nothing here is wired into the product; this is
research only.

**Result: all 5 spikes PASS.** 10/10 tests green, all against the project's
own real Strands `Model` subclass pattern (never a live model call).

```
cd /Users/jordanallen/IdeaProjects/pax
npx vitest run --config spikes/vitest.config.ts        # all 5 files, 10 tests
npx vitest run --config spikes/vitest.config.ts spikes/01-hitl-interrupt-resume.test.ts
```

Root's `vitest.config.ts` uses `test.projects` globs that don't reach
`spikes/`, so a bare `npx vitest run spikes/<file>` from the repo root
matches zero projects -- `spikes/vitest.config.ts` (a small standalone
config, `root: spikes/`) is required, exactly as the task anticipated.
`--dir spikes` also works once that config is passed.

## Setup: a standalone `npm install` under `spikes/`

Two of the four target features (Cedar, A2A) depend on **optional peer
dependencies of `@strands-agents/sdk`** that are not installed at the
workspace root: `@a2a-js/sdk`, `@cedar-policy/cedar-wasm`, and
`@cedar-policy/mcp-schema-generator-wasm`. The workspace also uses pnpm's
strict, non-hoisted `node_modules` layout, so even `@strands-agents/sdk`
and `zod` themselves are not resolvable by walking up from `spikes/` to the
repo root (`node_modules/@strands-agents` and `node_modules/zod` do not
exist at the root; they only exist inside `apps/agent/node_modules` and
`packages/*/node_modules` as pnpm-managed symlinks).

Since `spikes/` is excluded from `pnpm-workspace.yaml`'s globs, it was safe
to give it its own standalone `package.json` + `npm install` (plain npm, not
pnpm) with its own `node_modules` and `package-lock.json`, both untracked
and confined to `spikes/`. This never touched the root `pnpm-lock.yaml` or
root `package.json`. `spikes/package.json` pins `@strands-agents/sdk` to the
exact installed workspace version (`1.14.0`) plus the two Cedar wasm
packages, `@a2a-js/sdk`, and `express` (needed for
`@strands-agents/sdk/a2a/express`). `npm install` resolved cleanly: 142
packages, no peer-dependency errors.

`spikes/helpers/scripted-model.ts` is a trimmed local copy of
`apps/agent/src/runtime/model-provider.ts`'s `ScriptedModelProvider` (read
for reference only, never imported -- spikes/ must not depend on tracked
files): a real `Model<BaseModelConfig>` subclass that yields the same
`ModelStreamEvent` sequence a live provider would, from an in-order queue of
canned turns, with zero network access. Every spike below drives the real
Strands `Agent` loop with this double standing in only for the model.

## Cross-cutting SDK finding: content-block discriminators

Every content block class (`ToolResultBlock`, `TextBlock`, etc.) exposes a
`type` discriminator on the RUNTIME instance that is **not** the same shape
`JSON.stringify`/`toJSON()` produces. At runtime: `{ type: 'toolResultBlock',
status, content, toolUseId }` and `{ type: 'textBlock', text }` (flat
fields). Only `toJSON()` wraps these as `{ toolResult: {...} }` /
`{ text: ... }` for wire serialization. Every spike below that inspects
`agent.messages` or a scripted model's `callLog[i].messages` had to branch on
`block.type === 'toolResultBlock'` / `'textBlock'`, not on a `toolResult`/
`text` key or a JSON-shaped guess -- confirmed empirically (first drafts of
spikes 2 and 5 failed on exactly this, then were fixed against
`types/messages.d.ts`'s actual class declarations).

---

## Spike 1 -- HITL interrupt/resume across a real process restart

**File:** `spikes/01-hitl-interrupt-resume.test.ts` -- **3/3 PASS**

**Verdict:** Works exactly as documented, first try (no API surprises), with
the scripted model. `HumanInTheLoop`'s default (no `ask`) interrupt/resume
mode pauses a real `Agent`, a real `SessionManager` + `LocalFileStorage`
round-trips the interrupted state through the real filesystem, and a
genuinely new `Agent` instance (simulating a process restart) resumes and
either executes or permanently blocks the tool depending on the human's
response.

**Minimal working shape:**

```ts
import { Agent, InterruptResponseContent, SessionManager, tool } from '@strands-agents/sdk';
import { LocalFileStorage } from '@strands-agents/sdk/storage';
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl';

// Process 1
const sessionManagerA = new SessionManager({ sessionId: 'case-1', storage: new LocalFileStorage(dir) });
const agentA = new Agent({
  model, // ScriptedModelProvider, scripted to emit one propose_award tool call
  sessionManager: sessionManagerA,
  tools: [proposeAwardTool],
  interventions: [new HumanInTheLoop()], // default: ALL tools require approval, interrupt/resume mode
});
const first = await agentA.invoke('Award the bid.');
// first.stopReason === 'interrupt'; the tool did NOT run
const interruptId = first.interrupts![0].id;
await sessionManagerA.saveSnapshot({ target: agentA, isLatest: true });

// Process 2 (genuinely new instances, same on-disk session dir)
const sessionManagerB = new SessionManager({ sessionId: 'case-1', storage: new LocalFileStorage(dir) });
const agentB = new Agent({ model: freshModel, sessionManager: sessionManagerB, tools: [proposeAwardTool], interventions: [new HumanInTheLoop()] });
await sessionManagerB.restoreSnapshot({ target: agentB }); // true
const resumed = await agentB.invoke([new InterruptResponseContent({ interruptId, response: true })]);
// resumed.stopReason !== 'interrupt'; the tool DID run
```

**Gotchas / exact API shapes:**
- There is **no separate `Agent#resume()` method** in this SDK version.
  Resuming is just `agent.invoke([...])` with an `InterruptResponseContent[]`
  (or `InterruptResponseContentData[]`) as the args -- one of the variants of
  `InvokeArgs` (`types/agent.d.ts`). The task prompt's "call `resume(...)`"
  is therefore `agent.invoke([new InterruptResponseContent({ interruptId,
  response })])`.
- `HumanInTheLoop`'s default `evaluate` accepts `true` / `'y'` / `'yes'`
  (case-insensitive) as approval; anything else (`false` used here) is a
  denial. Denial does not throw -- the agent proceeds to its next scripted
  turn with a cancellation tool-result in its history, same shape as a Cedar
  deny (see spike 2).
- `AgentResult.interrupts` (populated only when `stopReason === 'interrupt'`)
  is the unanswered-interrupt list; `interrupts[0].id` is the value
  `InterruptResponseContent` needs.
- `SessionManager.saveSnapshot`/`restoreSnapshot` use `takeSnapshot({
  preset: 'session' })` internally (confirmed by reading
  `session-manager.js` directly), and the `'session'` preset's field list
  (`snapshot.d.ts`'s `SNAPSHOT_PRESETS`) includes `'interrupts'` alongside
  `'messages'`/`'state'`/`'modelState'`/`'systemPrompt'` -- so the pending
  interrupt state genuinely survives the round trip through disk, not just
  the conversation history.
- `SessionManager`'s default `saveLatestOn: 'invocation'` already persists
  `snapshot_latest` when `invoke()` returns for ANY `stopReason`, including
  `'interrupt'` -- an explicit `saveSnapshot` call is not strictly required,
  but this spike calls it anyway to match `session-adapter.ts`'s own
  `saveCaseSnapshot` pattern rather than depend on an implicit default.

**Scripted vs. live:** 100% scripted-model compatible. No live model needed
anywhere in this flow -- the interrupt mechanism operates entirely on the
tool-call layer, below the model.

---

## Spike 2 -- Cedar authorization

**File:** `spikes/02-cedar-authorization.test.ts` -- **3/3 PASS** (2/3 on
first run; one assertion needed fixing per the content-block-discriminator
finding above, not an SDK behavior surprise)

**Verdict:** Works. `CedarAuthorization` with a `principalResolver` reading
`invocationState` correctly permits one agent principal and denies another
against the same tool, and fails closed when the resolver can't identify a
principal.

**Minimal working shape:**

```ts
import { Agent, tool } from '@strands-agents/sdk';
import { CedarAuthorization } from '@strands-agents/sdk/vended-interventions/cedar';

const POLICIES = `
permit(principal == Agent::"credential-checker", action == Action::"license-lookup", resource);
forbid(principal == Agent::"price-analyst", action == Action::"license-lookup", resource);
`;

const cedar = new CedarAuthorization({
  policies: POLICIES,
  principalResolver: (invocationState) => {
    const id = invocationState['callerAgentId'];
    return typeof id === 'string' ? { type: 'Agent', id } : undefined; // undefined => fail-closed deny
  },
});

const agent = new Agent({ model, tools: [licenseLookupTool], interventions: [cedar] });
await agent.invoke('Look up the license.', { invocationState: { callerAgentId: 'credential-checker' } }); // permitted
await agent.invoke('Look up the license.', { invocationState: { callerAgentId: 'price-analyst' } });      // denied
```

**Gotchas / exact API shapes:**
- **Action = tool name** (unnamespaced `Action::"<toolName>"`), **Resource
  is unconstrained** -- confirmed by `cedar.ts`'s own doc comment and by the
  policy above working with a bare `resource` (no `==` constraint).
- `cedar.js` unconditionally imports BOTH `@cedar-policy/cedar-wasm/nodejs`
  (`isAuthorized`/`checkParsePolicySet`/`validate`) AND
  `@cedar-policy/mcp-schema-generator-wasm` (`* as
  mcpSchemaGeneratorWasm`) at module top level, even though this spike never
  calls `CedarAuthorization.create()` or supplies a `tools`/`schema` config
  for auto schema generation. Both packages must be installed for the
  `cedar` submodule to import at all, not just for schema features.
- The deny surface is **not an interrupt and not a thrown exception** under
  the default `onError: 'throw'` (that setting governs handler *errors*,
  e.g. a malformed policy, not a policy-driven `Deny` decision). A deny is a
  synchronous `InterventionAction` (`beforeToolCall` is NOT async on
  `CedarAuthorization`, unlike `HumanInTheLoop`) that cancels the tool call
  before it runs. The cancellation reaches the model as a `toolResultBlock`
  with `status: 'error'` and content text `"DENIED: Access denied by Cedar
  policy: policy1"` -- confirmed empirically by printing `agent.messages`.
- `principalResolver` returning `undefined` fails closed (denies), per the
  config's own doc comment -- confirmed empirically with an
  `invocationState` carrying no recognizable caller id.

**Scripted vs. live:** 100% scripted-model compatible -- Cedar evaluation is
pure policy logic below the model layer, identical to HITL in that respect.

---

## Spike 3 -- A2A round-trip

**File:** `spikes/03-a2a-roundtrip.test.ts` -- **1/1 PASS**

**Verdict:** Works. An in-process `A2AExpressServer` wrapping a
scripted-model `Agent`, bound to an OS-assigned ephemeral port (`port: 0`),
correctly serves a second, independent `A2AAgent` client's `invoke()` call
and returns the scripted response.

**Minimal working shape:**

```ts
import { Agent } from '@strands-agents/sdk';
import { A2AAgent } from '@strands-agents/sdk/a2a';
import { A2AExpressServer } from '@strands-agents/sdk/a2a/express';

const serverAgent = new Agent({ id: 'bid-advisor', model /* scripted */ });
const server = new A2AExpressServer({
  agentFactory: () => serverAgent, // NOT the deprecated `agent:` field -- see gotcha below
  name: 'Bid Advisor',
  host: '127.0.0.1',
  port: 0,
});
const abortController = new AbortController();
void server.serve({ signal: abortController.signal }); // resolves once listening starts
// poll server.port until non-zero, then:
const client = new A2AAgent({ url: `http://127.0.0.1:${server.port}` });
const result = await client.invoke('Which contractor should we pick?');
abortController.abort();
```

**Gotchas / exact API shapes:**
- `A2AServerConfig.agent` is **deprecated**. Passing it logs, at runtime:
  `"Passing a single 'agent' to A2AExecutor is deprecated and will be
  removed in a future version. A single agent serializes all requests; pass
  an agentFactory (a callable taking the contextId) instead to isolate
  conversations per context."` -- observed directly in vitest's stderr on
  this spike's first draft. `agentFactory: (contextId) => InvokableAgent` is
  the current, non-deprecated shape and produces no warning; used above.
- The module DOES honestly log its experimental status at import time:
  `protocol=<a2a> | experimental, breaking changes in the underlying sdk may
  require breaking changes in this module` (also observed in stderr, present
  even after switching to `agentFactory`). This is the SDK's own disclosure,
  not a bug.
- `A2AExpressServer` needed `express` as a real dependency (not just a peer
  declaration) -- installed explicitly in `spikes/package.json` since it
  isn't hoisted to the workspace root.
- No missing-peer-dep breakage once `@a2a-js/sdk` and `express` were
  installed: import, construction, `serve()`, and the client round trip all
  worked without further coaxing.

**Scripted vs. live:** 100% scripted-model compatible on the SERVER side --
the A2A transport layer is agent-agnostic; it just proxies `invoke`/`stream`
calls over HTTP/JSON-RPC to whatever `InvokableAgent` the factory returns.
No live model needed for this proof.

---

## Spike 4 -- LLM steering with a custom `SteeringContextProvider`

**File:** `spikes/04-llm-steering-context-provider.test.ts` -- **1/1 PASS**
(passed on first run)

**Verdict:** Works, and -- important for the "will this need a live model"
question -- **the steering handler's own evaluation model can itself be a
`ScriptedModelProvider`**, fully decoupled from the parent agent's model.
Guidance from a custom, non-hook-driven context provider (a simulated
external "feed delta") reaches the steering LLM's prompt and its `'guide'`
decision reaches the parent agent as a cancelled tool call.

**Minimal working shape:**

```ts
import { Agent, tool } from '@strands-agents/sdk';
import { LLMSteeringHandler, type SteeringContextData, type SteeringContextProvider } from '@strands-agents/sdk/vended-interventions/steering';

class FakeFeedDeltaProvider implements SteeringContextProvider {
  readonly name = 'feedDelta';
  observeAgent(): void {} // required by the interface; nothing to hook here -- data arrives externally
  get context(): SteeringContextData {
    return { type: 'feedDelta', delta: 'Cedar & Sons submitted a revised bid; permits now priced' };
  }
}

const steeringModel = new ScriptedModelProvider({
  turns: [{ toolCalls: [{ name: 'strands_structured_output', input: { type: 'guide', reason: '...' } }] }],
});
const steeringHandler = new LLMSteeringHandler({
  systemPrompt: 'You steer a bid-comparison agent...',
  model: steeringModel,                    // the steering handler's OWN model, separate from the parent's
  contextProviders: [new FakeFeedDeltaProvider()],
});

const parentAgent = new Agent({ model: parentModel, tools: [checkPermitsTool], interventions: [steeringHandler] });
await parentAgent.invoke('Check whether permits are priced into the Cedar & Sons bid.');
```

**Gotchas / exact API shapes:**
- The steering decision surface is a **three-way discriminated union**:
  `'proceed' | 'guide' | 'confirm'` (`beforeToolCall` returns `Proceed |
  Guide | Confirm`, never `Deny`/`Transform` -- `SteeringHandler`'s
  narrowed return type). `LLMSteeringHandler` produces this by building an
  **inner `Agent`** internally
  (`structuredOutputSchema: z.object({ type: enum(['proceed','guide','confirm']), reason: string })`)
  and invoking it fresh per call (no shared mutable state, so it's safe on
  multiple parent agents) -- read directly from `handlers/llm.js`.
- Scripting that inner agent deterministically means scripting a
  `strands_structured_output` tool call (the SDK's internal structured-output
  mechanism), the exact same convention already used throughout
  `apps/agent/src/runtime/*.test.ts` for `structuredOutputSchema` fixtures
  (e.g. `car-purchase-graph.test.ts`) -- confirmed by grepping the existing
  test suite before writing this spike, not guessed.
- `SteeringHandlerConfig.contextProviders` accepts ANY `SteeringContextProvider`,
  not just the SDK's own `ToolLedgerProvider` -- a fully custom class
  implementing the 3-member interface (`name`, `observeAgent`, `context`
  getter) works with no special registration.
- **`'guide'` on `beforeToolCall` CANCELS the tool call** -- it does not let
  it proceed with an annotation. Confirmed by reading
  `interventions/registry.js` directly: `event.cancel = "GUIDANCE:
  ${feedback}"`. So "guidance reaches the agent before its next tool call"
  concretely means: the agent's CURRENTLY-ATTEMPTED tool call is blocked,
  and the guidance text is what the agent sees (as a `toolResultBlock` with
  `status: 'error'`) when producing its next attempt.
- `LLMSteeringHandler.model` is fully independent per instance -- verified
  the parent agent's model (`parentModel`) and the steering handler's model
  (`steeringModel`) each kept separate, correctly-ordered call logs (parent:
  2 calls: initial attempt + post-guidance follow-up; steering: 1 call).

**Scripted vs. live:** 100% scripted-model compatible, for BOTH models in
the pair (parent agent's and the steering handler's own). This was the
spike most likely to need a live model (an LLM literally makes the steering
decision) and it did not.

---

## Spike 5 -- `MemoryManager` + `TestMemoryStore`

**File:** `spikes/05-memory-manager.test.ts` -- **2/2 PASS** (1/2 on first
run; the injection assertion needed the same content-block-discriminator fix
as spike 2, AND a genuine behavioral finding below about lexical recall)

**Verdict:** Works. `add()` then `search()` round-trips an entry through a
programmatic `MemoryManager`, and the injection middleware genuinely folds
retrieved memory into the SCRIPTED model's per-call input -- verified by
inspecting the model's own received `messages`, not just that injection
config is "on".

**Minimal working shape:**

```ts
import { Agent, MemoryManager } from '@strands-agents/sdk'; // re-exported from the MAIN entry point, no `/memory` subpath
import { TestMemoryStore } from '@strands-agents/sdk/vended-memory-stores/test-memory-store';

const store = new TestMemoryStore({ name: 'notes', writable: true, persist: false }); // persist:false -> ephemeral, no real filesystem I/O
const manager = new MemoryManager({ stores: [store], injection: false });
await manager.add('The user prefers a hybrid SUV under $35,000.');
const results = await manager.search('what kind of vehicle does the user want?'); // token-overlap match on "user"

// Injection, attached to a real Agent + scripted model:
const injectingManager = new MemoryManager({ stores: [store2], injection: true }); // default trigger: 'userTurn', maxEntries: 5
const agent = new Agent({ model, plugins: [injectingManager] });
await agent.invoke('Any updates on that hybrid I asked about?');
// model.callLog[0].messages' user message now carries TWO text blocks:
// the original ask, and a folded "<memory><entry source="...">...</entry></memory>" block
```

**Gotchas / exact API shapes:**
- `MemoryManager` is exported from the SDK's **main entry point**
  (`@strands-agents/sdk`), not a `/memory` subpath -- there is no
  `"./memory"` entry in `package.json#exports` at all; only
  `"./vended-memory-stores/*"` is a real subpath.
- `TestMemoryStore` recall is **lexical (token-overlap), not semantic** --
  its own doc comment says this explicitly, and it is a real, easy-to-miss
  behavioral gotcha: a query sharing zero tokens with a stored entry gets
  zero results and therefore injects nothing, even though the entry is
  obviously "relevant" to a human reader. First draft of this spike's
  injection test used the query `'What car should I get?'` against the
  stored entry `'The user prefers a hybrid SUV under $35,000.'` -- zero
  shared tokens, zero results, no injection, and the test failed with no
  exception (fail-open behavior, see below) until the invoking message was
  changed to genuinely share a token (`'hybrid'`) with the stored content.
- Injection is **ephemeral and per-call, never touches durable history** --
  confirmed both by `message-injection.js`'s own doc comment and
  empirically: `agent.messages` (the durable, would-be-persisted
  conversation) still shows the user message with exactly one content
  block after the call, while the SCRIPTED MODEL actually received two (the
  ask plus the folded `<memory>` block) -- `model.callLog[0].messages`
  differs from `agent.messages` by design.
- The default injection trigger is `'userTurn'`: it fires only on a fresh
  plain user ask (a `user` message with no `toolResult` content), not on an
  autonomous tool-result turn -- relevant if a future real integration tries
  to inject mid-tool-loop and silently gets skipped.
- Every failure mode here (empty/no-match search, a throwing `query`
  callback, a throwing `format` callback) is documented as **fail-open**:
  injection is silently skipped and the model call proceeds unaugmented,
  rather than erroring the whole invocation. Worth remembering if this
  lands in the product -- a broken memory store degrades silently, not
  loudly.

**Scripted vs. live:** 100% scripted-model compatible. Memory
storage/retrieval and the injection middleware are both below the model
layer; no live model needed.

---

## Summary table

| # | Feature | Files | Tests | Verdict | Needs live model? |
|---|---|---|---|---|---|
| 1 | HITL interrupt/resume + real session restart | `spikes/01-hitl-interrupt-resume.test.ts` | 3/3 | PASS | No |
| 2 | Cedar authorization (dynamic principal) | `spikes/02-cedar-authorization.test.ts` | 3/3 | PASS | No |
| 3 | A2A round-trip (in-process server) | `spikes/03-a2a-roundtrip.test.ts` | 1/1 | PASS | No (server side; transport is agent-agnostic) |
| 4 | LLM steering + custom context provider | `spikes/04-llm-steering-context-provider.test.ts` | 1/1 | PASS | No -- even the steering LLM itself scripts cleanly |
| 5 | MemoryManager + TestMemoryStore | `spikes/05-memory-manager.test.ts` | 2/2 | PASS | No |

All four target features, plus the memory smoke check, are genuinely usable
against this project's real scripted `Model` double with zero network
access -- nothing here required a live Bedrock/Anthropic/OpenAI call to
prove out. The two features with real external dependencies (Cedar's wasm
packages, A2A's `@a2a-js/sdk` + `express`) install cleanly as optional peer
deps once explicitly added; neither is present at the workspace root today,
so bringing either into the actual product would need those added to
`apps/agent/package.json` (a real, tracked dependency change, not attempted
here).
