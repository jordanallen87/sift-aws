# Debugging and Observability Specification

## Purpose

Sift must make adaptive agent behavior inspectable enough to debug locally, prove hackathon claims, and understand a deployed failure without reproducing it from prose logs.

The normal activity timeline explains behavior to a user. The **Runtime Inspector** exposes engineering detail for the same run. Both are projections of one correlated telemetry stream; neither displays private chain-of-thought.

## Consumer and developer projections

Change-set §33 states the requirement directly: the consumer workspace and the Runtime Inspector must project from the *same* underlying events — "Same underlying event. Two projections. This is important. Avoid creating parallel truth sources." (§35). The consumer surface (`product.md`) answers "what does this mean for my decision"; the Runtime Inspector answers "what exactly did the system do." Content that stays developer-only and never appears on the consumer surface by default: `commandId`, `runId`, the compiled pack hash, specialist ID, skill ID, the raw chronological activity ledger, and the E0–E3 evidence-level vocabulary (change-set §34/§48).

`apps/web/src/components/activity-labels.ts` is the implementation of this split — a single exhaustive label registry mapping internal `PublicActivityEventType` values to consumer copy, with a defensive fallback so an unrecognized internal value can never leak to the consumer surface as a raw dotted token. It is the extension point for new mappings this projection needs (research/evidence-conflict language, Question/obligation language, presentation-vs-criterion distinctions per change-set §54), not a mechanism to be rebuilt in parallel. See `product.md`'s "Consumer and developer projections" for the consumer-facing contract this section's telemetry feeds.

Official references:

- [Strands observability](https://strandsagents.com/docs/user-guide/observability-evaluation/observability/)
- [Strands OpenTelemetry traces](https://strandsagents.com/docs/user-guide/observability-evaluation/traces/)
- [Strands metrics](https://strandsagents.com/docs/user-guide/observability-evaluation/metrics/)
- [Strands TypeScript hooks](https://strandsagents.com/docs/user-guide/concepts/agents/hooks/)
- [AgentCore Observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability.html)

## Instrumentation architecture

The Strands TypeScript SDK is instrumented through both native OpenTelemetry and lifecycle hooks.

```text
Strands hooks ───────────────┐
Strands OTEL spans ─────────┤
Sift domain events ──────────┤
HTTP/SSE/storage events ────┼─> TelemetryNormalizer ─> Redactor ─> runtime_events
Graph/Swarm events ─────────┤                                  ├─> Runtime Inspector SSE
interventions/plugins ──────┤                                  ├─> JSON run bundle
session/snapshot events ────┘                                  └─> optional OTLP exporter
```

Every request, run, model call, tool call, Graph node, Swarm handoff, skill activation, intervention, GoalLoop attempt, context injection, case event, and session operation carries available correlation fields:

```ts
interface RuntimeCorrelation {
  traceId: string
  spanId?: string
  parentSpanId?: string
  requestId?: string
  caseId: string
  runId: string
  sessionId?: string
  obligationId?: string
  agentId?: string
}
```

Sift adds case, run, pack ID/version/hash, obligation, case-extension origin, and fixture/live attributes to Strands spans. W3C `traceparent` is propagated between Railway and AgentCore so the local gateway and remote runtime remain one trace when possible.

One run has exactly one `traceId`. The value stored on the `runs` row — what the Overview renders under "Trace" — is the same value every `runtime_events` row for that run carries, so copying it from the Overview genuinely selects that run's events and nothing else. The trace is minted once, by the Graph or Swarm that produces the events (`car-purchase-graph.ts` / `home-energy-swarm.ts`); the engine records the id its own events carry rather than minting a second one (`car-purchase-engine.ts:1199-1210`, `home-energy-engine.ts:861-871`). Asserted at the persisted-data level for both hero packs in `apps/agent/src/runtime/car-purchase-engine.test.ts` and `apps/agent/src/runtime/home-energy-engine.test.ts`.

Rows written before that change keep the stale run `trace_id` they were given. No migration rewrites them: correlation that was never recorded is not manufactured after the fact, so an old run's Overview "Trace" still names an id no event carries. The invariant holds for every run recorded from this change forward.

## Runtime event contract

```ts
interface RuntimeDebugEvent extends RuntimeCorrelation {
  schemaVersion: '1.0'
  sequence: number
  timestamp: string
  category:
    | 'case'
    | 'agent'
    | 'model'
    | 'tool'
    | 'skill'
    | 'graph'
    | 'swarm'
    | 'intervention'
    | 'goal'
    | 'context'
    | 'session'
    | 'http'
    | 'storage'
    | 'error'
  name: string
  phase: 'start' | 'update' | 'finish' | 'error'
  level: 'debug' | 'info' | 'warn' | 'error'
  durationMs?: number
  tokenUsage?: { input: number; output: number; total: number }
  estimatedCostUsd?: number
  summary: string
  attributes: Record<string, unknown>
  payload?: unknown
  stateDiff?: JsonPatchOperation[]
  redactions: Array<{ path: string; reason: string }>
}
```

`sequence` is monotonic within a run. Event payloads are size-bounded. Large tool/model payloads are summarized with a content hash and optional artifact reference.

### `durationMs`, `tokenUsage`, and `estimatedCostUsd`

All three are optional, and each is **omitted rather than defaulted** — an absent `tokenUsage` states "this provider reported no usage", which is a different and more honest fact than a zeroed one (`apps/agent/src/runtime/event-normalizer.ts:224-228`).

- **`tokenUsage` is a per-call delta, not a running total.** `AfterModelCallEvent` carries no usage field; usage lives on the agent's Strands `Meter` as `agent.metrics.accumulatedUsage`, which is cumulative for the whole agent. Because `routes/debug.ts` **sums** `tokenUsage` across a run's events for its Overview (`debug.ts:208-215`), stamping the cumulative figure on each event would multiply the run total. What is recorded is therefore the delta since that agent's previous model call — the real cost of that one call, summing back to the real run total (`event-normalizer.ts:242-290`, `:344-354`). One tracker belongs to one `Agent`, because Graph and Swarm nodes are separate agents with separate meters. An all-zero delta is read as "not reported" and the field is dropped.
- **`durationMs` is a measured interval.** Neither hook event carries a timestamp, and the SDK's own tool timing is keyed by tool *name*, which cannot be attributed when two concurrent calls hit the same tool. So duration is a real wall-clock interval between the actual `Before*` and `After*` hook firings, keyed by `toolUseId` for tools, and omitted entirely when no matching start was observed. It is measured, never assumed, and never a constant (`event-normalizer.ts:271-280`, `:355-366`).
- **`estimatedCostUsd` is deliberately never populated, by anything.** A cost figure needs a price per input/output token for the exact model that served the call. `@strands-agents/sdk@1.14.0` publishes no price table, Sift carries no pricing configuration, and Bedrock's per-model rates are not reachable from a fixture-mode run. Multiplying a real token count by a remembered rate would produce a number that *looks* sourced and is not. The field stays in the contract, and `routes/debug.ts` reports `estimatedCostUsd: null` on the Overview unless some event genuinely carried one (`debug.ts:216-219`, `:244`), so the Inspector shows a token line with no cost line. **This is a decision, not a gap** (`event-normalizer.ts:199-220`); the one place to compute it, if a sourced price table is ever added to Sift config, is from the token delta above plus `event.model.modelId`.

## Required captured behavior

### Invocation and model

- invocation start/finish/error;
- model ID, parameters, latency, token usage, retry count, and schema-validation result;
- message roles and size summaries;
- sanitized system prompt and input/output payload in deterministic fixture mode;
- hash and safe summary by default for user-entered live data.

### Tools

- tool name, normalized arguments, start/finish/error, duration, source IDs, result size, and evidence delta;
- cancellation and timeout;
- Tool Ledger repetition/no-progress calculation;
- intervention decision that preceded execution.

### WebMCP tool calls

**Status: implemented.** Every case-scoped WebMCP tool's callback invokes the identical `SiftCommands` method the matching UI control calls (see `webmcp.md`, `architecture.md`) — correct under docs/engineering-principles.md's shared-command-implementation rule; it does not create a second command path. ADR 0006 decision 8's origin marker closes the "which caller triggered this" gap on top of that one path: every command-backed tool tags its call with `{ origin: 'webmcp' }` (`register-sift-tools.ts`'s `buildCaseScopedCommandTool`, one shared call site), `SiftCommands` sends it as an `X-Sift-Command-Origin` request header (a sibling to the existing `X-Sift-Command-Id`/`Idempotency-Key` headers), and the server records it onto the activity trail's `safeDetails.origin` for every emitted activity event tied to that command. A visible UI control calling the same `SiftCommands` method directly simply omits the header, so a WebMCP-issued command's activity events carry `safeDetails.origin: 'webmcp'` while a direct UI click's do not. `ActivityTimeline` (reused inside the Runtime Inspector's Activity tab) already renders every `safeDetails` key generically, so the marker is genuinely visible today wherever that event's details are shown.

**Runs carry the same marker, on the run record itself.** `sift_request_investigation` is the one tool that *starts a run*, and it reaches the server through `POST /api/cases/:caseId/run` (`routes/runs.ts`, a different route and service from `routes/commands.ts`/`CommandService` — see `run-service.ts`'s header comment). That route reads the identical `X-Sift-Command-Origin` header through the identical `readCommandOrigin` reader and closed `COMMAND_ORIGINS` vocabulary, and `RunService.requestInvestigation` records it in two places: the durable `runs.origin` column (nullable, no default), and the run's `run.queued` activity event's `safeDetails.origin`, in the same shape `CommandService.emitActivity` writes. So "this assistant's tool call caused this entire run" is answerable two ways — by run id, from the run record, and from the replayable public stream — and a run started by a click is durably distinguishable from one started by a WebMCP tool call. Provenance is stated once, at creation: `RunStatusUpdate` carries no origin, so no later lifecycle write can rewrite or clear it, and an idempotent retry never restates the origin of a run it did not cause. **An absent header records nothing**: a NULL `runs.origin` and an omitted `safeDetails` mean "the caller stated no origin", which is deliberately not the same fact as `user`, and is never collapsed into one.

**A dedicated origin filter and badge are now built — and they degrade honestly.** `GET /api/debug/runs/:runId` (and its export sibling) accept `?origin=`, validated against the same closed `COMMAND_ORIGINS` vocabulary the `X-Sift-Command-Origin` header reader enforces; a value outside it is answered `400 VALIDATION` rather than silently returning an unfiltered Timeline (`apps/agent/src/routes/debug.ts:319-332`, `:271`). The Overview carries `countsByOrigin`, computed from the whole run so selecting an origin never collapses the vocabulary to the one already selected (`debug.ts:193`, `:205-206`, `:241`). In the UI, a Timeline item whose event states a recognized origin renders a labelled badge and a `data-origin` attribute (`apps/web/src/components/RuntimeInspector.tsx:303-345`), and the origin control is offered only when the run's `countsByOrigin` is non-empty (`RuntimeInspector.tsx:873`).

**What is still missing is the producer, not the surface.** A runtime event's one home for this marker is `attributes.origin`, and nothing writes it yet: origin is recorded on the `runs.origin` column and on activity `safeDetails.origin`, while `event-normalizer.ts` and `store/runtime-event-store.ts` set nothing of the kind on `runtime_events`. So on a real run today the badge and the origin control render nothing at all — which is the designed behavior, not a failure: an event that states no origin is reported as stating none, is never defaulted to `user`, and a run predating origin propagation reports `countsByOrigin: {}` rather than having provenance invented for it (`debug.ts:164-180`; `RuntimeInspector.tsx:186-195`). Both surfaces are written to read correctly before and after a producer lands, so adding one is a producer-side change only.

**This is observability only, never authorization either way:** nothing reads this field to make a policy decision, and human-only verbs (`reviewProposal`) stay unreachable from WebMCP because the tool catalog never exposes them — independent of this marker (change-set §34: "WebMCP tool calls; registered tools; tool inputs/results").

### Standing Watch (dev view)

**Specified, not yet implemented.** Full rationale in docs/decisions/0015-standing-watch-and-background-triggers.md. The consumer surfaces this telemetry feeds are specified in `product.md`'s "Standing Watch" section; this is the developer-view half, held to the same "same underlying event, two projections" rule the rest of this document already states.

- **Model provider identity, per run.** Every run's Overview must state which model actually served it — `scripted` (the deterministic fixture provider every run in this build uses today, per `strands-runtime.md`'s "Models and configuration" section, "every run, local and deployed, is scripted") or, once the live Bedrock path is wired, `bedrock:{modelId}` with its region (e.g. `bedrock:global.anthropic.claude-sonnet-4-6 (us-east-1)`). This is not a new fact to compute — it is the same `SIFT_MODEL_ID`/`AWS_REGION`/`resolveModelProvider` configuration `strands-runtime.md` already names, surfaced onto the one place a person looks to answer "was that actually a model call." **When the Bedrock flag is on, opening the dev view mid-run must show this identity before the run completes** — a person watching a live demo needs to be able to toggle to the dev view and see a real model being called while it is happening, not only in a post-hoc summary. Token counts and latency are already specified above ("`durationMs`, `tokenUsage`, and `estimatedCostUsd`") and need no new mechanism for a watch-initiated run; they are per-call facts regardless of what started the call.
- **Watch-specific Timeline rows.** `watch.checked` (runtime-only per docs/decisions/0015's event table), plus the normalized debug-event form of the public `watch.fired`/`watch.triaged`/`watch.suppressed` events, appear in the Timeline with a `category` of `'watch'` (extending the existing `RuntimeDebugEvent.category` union above) — filterable and exportable exactly like every other category, never a second telemetry mechanism.
- **A pending background interrupt is inspectable, not only visible as "needs you."** The `pending_interrupts` row backing a case's `watching_needs_you` state (`architecture.md`, `product.md`) resolves to its own Timeline entry: which tool call is paused, which watch caused it, and the same `intervention.confirm`-shaped reason a foreground `ConsequenceGuard` pause already renders — the mechanism differs (`HumanInTheLoop` versus `ConsequenceGuard`, docs/decisions/0015 Decision 1) but the Inspector's rendering of "why is this paused" does not need to.
- **AgentCore Observability / CloudWatch correlation** appears only when the run actually executed on AgentCore (`SIFT_EXECUTION_TARGET=agentcore`) — the Overview's trace section gains a CloudWatch deep link precisely when a real AgentCore trace/session/request id was returned for that run, matching "OpenTelemetry and AgentCore" below. **Stated plainly, not left to be inferred: this correlation is absent for every locally-executed or Railway-local-target run**, watch-initiated or not, because there is no AgentCore invocation to correlate to. A run's Overview must not render a CloudWatch link, real or placeholder, when no such invocation occurred.

### Adaptive runtime

- available and activated skills;
- specialist invocation;
- Graph node start/stop, dependency, and outcome;
- Swarm handoff source, target, reason, evidence delta, and cycle counter;
- Context Injector field names, version, and content hash;
- GoalLoop attempt, validator result, feedback category, and exhaustion;
- `Proceed`, `Guide`, `Confirm`, `Deny`, and `Transform` events with handler and reason.
- pack-authoring skill activation, catalog/scaffold/validate/test/diff/publish tool calls, compiler diagnostics, and human publication confirmation when authoring is enabled.

**Both hero packs now produce `goal` events.** `normalizeGoalValidation` emits `goal.validated` on a passing attempt and `goal.validation_failed` on a rejection, carrying the real attempt number, the validator's own feedback, and an `exhausted` marker on a final rejection (`event-normalizer.ts:590-596`). The home-energy Swarm already emitted these (`home-energy-swarm.ts:1065`); the car pack ran a genuine GoalLoop and recorded **nothing** about it, leaving `goal` the one required category with no producer on the WebMCP hero pack. It now reads the same real `goalLoop.lastResult(agent)` and emits one event per real attempt (`car-purchase-graph.ts:686-724`).

**Intervention outcomes are all recorded; they are not all recorded at the same level.** `intervention.proceed` normalizes at `level: 'debug'`; `guide`, `confirm`, and `transform` stay at `info` and `deny` at `warn` (`event-normalizer.ts:561-567`). Six handlers run on every tool call and most of them proceed — one real car run recorded 122 `proceed` events out of 245 — which buried the handoffs, steering, and denials the Inspector is read for. Those rows are the audit trail proving each guard genuinely ran on each call, so they are **demoted, never deleted**: they keep their full handler/stage/subject attributes and remain one `?level=debug` away, exactly as `context.injected` already is. Deleting them would destroy real evidence to make a list shorter.

### Domain and persistence

- command, actor, idempotency key hash, expected/actual event sequence, and result;
- canonical case events and JSON Patch-compatible before/after state diff;
- obligation/readiness/recommendation transitions;
- SQLite transaction, migration, busy/lock error, and duration;
- session/snapshot save, restore, and version;
- SSE connection, replay cursor, reconnect, and dropped-client error.
- public-activity projection, command/run correlation, client replay acknowledgement, resync instruction, and polling-fallback transition.
- case extension definition, origin, confirmation state, affected dependency paths, and resulting invalidation.

## Runtime Inspector UI

Server-side debug routes are gated correctly by `SIFT_DEBUG_ENABLED` (`apps/agent/src/routes/debug.ts`; disabled returns `404` for all of them, matching "Acceptance requirements" below). **The client-side entry point is implemented, and is not env-var-gated at all**: `CaseHeader` carries a small, always-visible "Developer view" icon control (`data-testid="case-header-developer-view"`, `onOpenDeveloperView`) next to Help and Reset, reachable the moment any case is open — it needs no prior run or other activity, unlike the pre-existing "Inspect run" control on `RecommendationHero`/`LiveRunStatus`, which still exists unchanged and still only renders once a live/recent run receipt exists. Both open the same `RuntimeInspector` (§34's "reuse the existing Runtime Inspector wherever possible"): the header control opens it generally (`runId: null`), while "Inspect run" opens it pre-targeted at a specific run. This closes the gap change-set §36 asked for (an intentional developer/inspect entry point reachable with no prior activity) — matching `product.md`'s "Workspace layout" item 5. The inspector itself, once opened, replaces the case body within the right pane and includes a clear return action; it is not a desktop-only modal.

Required views, and current status — three of the six are built:

1. **Overview** — status, trace/run/session IDs, duration, model/tool calls, tokens, estimated cost, errors, active obligation, and runtime target. **Implemented.** Estimated cost renders as absent, permanently and by design — see "`durationMs`, `tokenUsage`, and `estimatedCostUsd`" above.
2. **Timeline** — chronological events with category, agent, level, free-text, and WebMCP-origin filters. Selecting an event opens its structured safe payload, including its real `redactions` (path/reason, never the withheld value) and, where the underlying event carries one, its `stateDiff`. **Implemented**, including `focusEventId`-driven "open straight to this event" navigation from a consumer activity item's `debugEventId`. All five filters are query parameters on the real route, not a client-side `.filter()` over an already-loaded array (which would disagree with the whole-run Overview beside it), and they compose conjunctively so narrowing by level never widens a text search (`debug.ts:267-274`; `RuntimeInspector.tsx:432-441`). See "Timeline filter scope" and "Volume" below for two deliberate limits.
3. **Execution** — compact Graph/Swarm node and handoff view showing the active path, loops, redirects, and duration. **Implemented** as `apps/web/src/components/RunGraphView.tsx`, mounted as the Inspector's "Execution" tab (`runtime-inspector-tab-execution`, `RuntimeInspector.tsx:584`). It reads only `category: 'graph'` and `category: 'swarm'` runtime events and derives everything from them — no pack topology, specialist roster, or node ordering is hard-coded, so a pack that changes its graph changes this view rather than being misdescribed by it (`RunGraphView.tsx:182-278`). What it shows: stages (nodes that started before anything in the current wave finished are one parallel stage; the first start after a finish opens the next), each node's real status — including a node that started and never finished, rendered as **still running**, and a finish status that is neither `COMPLETED` nor `FAILED` reported verbatim rather than rounded up — a Swarm revisit as a second, later stage rather than merged into the first, the Swarm handoff chain with each real reason and evidence delta, and run-level notices (`swarm.cycle_detected`, `swarm.timeout`) that belong to no single node.

   **What it does not show, and why: real graph edges.** The car pack's `Graph` genuinely declares edges in code (`car-purchase-graph.ts:644-650`), but the emitted node events carry only `nodeId` and `status` (`car-purchase-graph.ts:279-304`) — no dependency is recorded anywhere in `runtime_events`. Stage ordering here is therefore an **ordering fact derived from the event stream, not a declared dependency**, and no edges are drawn between stages. The only arrow on the surface is inside a Swarm handoff row, where `from`/`to` are real recorded attributes, and even there the arrow is `aria-hidden` decoration over spoken text (`RunGraphView.tsx:358-362`). Closing this properly means a producer recording the declared edge set, not a renderer inferring one.

   **Per-node duration is also not shown.** `durationMs` is measured on model and tool calls, not on `graph`/`swarm` node events (`car-purchase-graph.ts:279-304` stamps no duration), so there is no node duration to render and none was invented. The requirement's "duration" clause is therefore unmet within an otherwise implemented view.

4. **State** — canonical case-event list and before/after diff for criteria, evidence, obligations, readiness, recommendation, and approval. **Not yet implemented** as a dedicated view; the Timeline's per-event `stateDiff` disclosure (above) is real but is not the same as this dedicated before/after State view.
5. **Context** — activated skills, allowed tools, injected context field names/hashes, model parameters, and validator feedback. **Not yet implemented.**
6. **Errors** — grouped failures with fingerprints, stack trace in local development, related span/events, and focused reproduction command when known. **Not yet implemented** as a dedicated view; errors are visible within Overview/Timeline today.

Global inspector actions, and current status:

- copy trace, run, case, and session IDs — **not implemented.**
- pause/resume live event following — **not implemented.**
- jump from a user-facing activity item to its debug event — **implemented** (see "Acceptance requirements" below).
- download a sanitized `sift-run-<runId>.json` bundle — **implemented.** `GET /api/debug/runs/:runId/export` (`debug.ts:520-557`) returns a JSON bundle carrying `schemaVersion`, `runId`, `exportedAt`, the filters that produced it, the whole-run `overview`, the exported events, and a redaction manifest, served as an attachment with a `Content-Disposition` filename whose run id is reduced to `[A-Za-z0-9._-]` so a caller-supplied path segment can never break out of the header (`debug.ts:445-455`). It accepts the **same five filters** as the Timeline route, so what you export is what you were looking at, and an invalid filter is a `400` rather than a silently unfiltered — and therefore much larger — bundle (`debug.ts:286-369`, `:492-493`). It is offered in the UI only when there is a run in hand (`RuntimeInspector.tsx:626-639`); the developer entry point can open with none.
- copy a concise debugging summary suitable for Claude Code — **not implemented.**

"Export applies the same redactor again and records its redaction manifest" is satisfied literally: the route re-runs `event-normalizer.ts`'s own `redactValue` — the same function `runtime-event-store.ts` applies at write time, not a second implementation that could drift — over every exported event's `attributes`, `payload`, and `stateDiff`, and reports the persisted manifest plus anything this pass withheld (`debug.ts:404-443`). In normal operation the second pass finds nothing new, because the store already redacted at write time; it is what lets the bundle state a manifest for the exact bytes it emitted.

### Timeline filter scope

`?q=` matches only the text a Timeline item actually renders: `summary`, event `name`, `category`, and `agentId` (`debug.ts:262-265`). It deliberately does **not** search `attributes` or `payload`. Those carry redacted and size-bounded content the UI does not display, and a filter that confirms the presence of a string it will not show you is a disclosure channel around the redactor, not a search box. Free text and agent are both bounded at 200 characters and rejected with `400` beyond it, so a hostile query string cannot turn into an unbounded per-event scan (`debug.ts:250-251`, `:334-366`).

`?agent=` offers only agents the run genuinely named: `overview.agentIds` is computed from the whole unfiltered run (`debug.ts:204`, `:240`), so the UI builds the control from real values rather than a guessed vocabulary, and renders no control at all for a run whose events name no agent. A blank value reads as "no filter", not as an agent whose id is the empty string.

### Volume

The Timeline is **paged, not virtualised**. One real car run is roughly 245 runtime events and the spec caps a run at 10,000; the view renders a fixed 50-event window of the ordered events with explicit Earlier/Later controls, keeping the DOM node count constant no matter how large the run is — the property "virtualized" is actually asking for (`RuntimeInspector.tsx:171`, `:477-479`, `:953-990`). The window follows `focusEventId` rather than fighting it, so jumping to an exact debug event moves the window to the page containing it and the `data-focused="true"` item is genuinely in the DOM; when a filter would hide the focused event entirely, the Timeline says so and offers to clear the filters instead of showing an unrelated list.

Paging rather than scroll-position-driven windowing is a deliberate choice, recorded here so it is not read as an unfinished virtualiser: item heights are genuinely variable (a redaction manifest and a `stateDiff` disclosure each grow an item), measured heights are the one thing jsdom cannot provide, and a scroll-driven implementation would therefore ship with only pixel-blind tests behind it. Paging is keyboard-reachable, announceable, and honestly testable.

The 390 px layout uses a single view selector and stacked event details. It must not rely on a side-by-side trace tree and payload panel.

The normal workspace consumes the smaller `PublicActivityEvent` projection in `architecture.md`; the Inspector consumes the full debug stream. Every public event with `debugEventId` must resolve to exactly one safe debug event. The two streams may have different sequences but share case, command, run, obligation, and agent correlation.

## Redaction and access

- `SIFT_DEBUG_ENABLED=false` disables debug routes and UI in non-demo deployments.
- `SIFT_DEBUG_PAYLOAD_MODE=fixture-full|metadata-only` defaults to `metadata-only`; the Railway hackathon fixture can use `fixture-full` only because its seeded cases contain no private data.
- `SIFT_DEBUG_RETENTION_DAYS` defaults to `7` and cannot exceed `30` in this build.
- `SIFT_TRACING_ENABLED` defaults to `true` and registers Sift's OpenTelemetry `TracerProvider` at boot so the Strands SDK's own spans are captured into `runtime_events`; `false` leaves the global OTel API unregistered and every Strands span is created and discarded, as before. Capture is in-process only and opens no socket.
- Standard `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` enable an external exporter without changing Sift event persistence. **Implemented** (2026-09-04): setting `OTEL_EXPORTER_OTLP_ENDPOINT` attaches a `BatchSpanProcessor` + `OTLPTraceExporter` alongside Sift's own SQLite span processor; unset, no exporter is constructed and no network call is made. See "OpenTelemetry and AgentCore" below.
- Public hackathon deployment enables the inspector only for fictional fixture cases. User-entered cases expose metadata and hashes but not raw listing notes or model content.
- Environment variables, authorization headers, cookies, credentials, account identifiers, and configured secret patterns are always removed before persistence.
- Private model reasoning is never requested or stored. If a provider returns reasoning metadata, Sift records only availability, token count, and a hash unless policy explicitly permits more.
- Stack traces include source paths only in local development. Public traces show error type, safe message, fingerprint, and relevant application frame names.
- Export applies the same redactor again and records its redaction manifest.

## Retention and bounds

- Keep the newest 100 runs or seven days of runtime events, whichever is smaller, in the hackathon deployment.
- Cap one run at 10,000 events and one persisted payload at 64 KiB after redaction.
- Bound each SSE client's pending queue. A slow client receives a persisted `stream.resync_required` marker and reloads from snapshot rather than silently losing state.
- When capped, emit `telemetry.truncated` and preserve summary counters.
- Canonical case events are not deleted by telemetry retention.

## OpenTelemetry and AgentCore

Local and Railway execution configure Strands `setupTracer()` with a Sift SQLite span processor for the inspector and an optional OTLP exporter configured through standard OTEL environment variables.

**Implemented 2026-09-04** (`apps/agent/src/runtime/otel-span-recorder.ts`, proven by `apps/agent/src/runtime/otel-span-recorder.test.ts`).

`@strands-agents/sdk@1.14.0` is already OTEL-instrumented — `dist/src/multiagent/graph.js` and `swarm.js` call `tracer.startMultiAgentSpan()`/`startNodeSpan()`/`endNodeSpan()`/`withSpanContext()` on every run, and `Agent` does the same for agent, agent-loop, model, and tool spans. Those spans were created and discarded because no `TracerProvider` was registered. Sift now registers a real `NodeTracerProvider` at boot (`server.ts`, gated by `SIFT_TRACING_ENABLED`, default `true`), calls the SDK's own `setupTracer({ provider })`, and installs a `SiftSpanRecorder` `SpanProcessor` that writes each ended span into `runtime_events` with:

- the real OTel `span_id` and `parent_span_id`, so a consumer renders the true parent/child tree (one `invoke_graph` root → six `execute_node` children → `invoke_agent` → `execute_agent_loop_cycle` → `chat`/`execute_tool`, five levels deep, ~75 spans for one car run);
- a real `durationMs` taken from `ReadableSpan.duration`, the OTel SDK's own measured `HrTime` delta — trustworthy for timing in a way the lifecycle-hook timestamps deliberately are not;
- the **run's** `traceId` in `trace_id`, preserving "one run has exactly one `traceId`" above, with the real OTel trace id recorded verbatim in `attributes['otel.trace_id']`.

Run attribution is honest, never guessed: `RunService.requestInvestigation` wraps `engine.trigger(...)` in `runInSpanScope(runId, …)`, which puts the run id on the active OTel context; `NodeTracerProvider.register()`'s `AsyncLocalStorageContextManager` carries it into every span the SDK starts inside that engine's call tree. A span started outside any run scope is **dropped**, because `runtime_events.run_id` is a real foreign key against `runs.id` and there is no honest value to invent. Span rows are numbered in a disjoint sequence band (`SPAN_SEQUENCE_BASE`) so they never collide with the normalized stream's own per-run counter, and are written per run in one `appendMany` transaction.

Redaction holds: span **events** and **links** are never persisted (only counted — span events carry `gen_ai.*.message` bodies verbatim); content-shaped attribute keys and oversized strings are stored as `{ chars, sha256 }`; and everything surviving passes through the same Redactor stage (`runtime-event-store.ts`'s `redactValue`) as every other runtime event. `tokenUsage`/`estimatedCostUsd` are deliberately left unset on span rows so the Overview's summed totals are not double-counted against the normalized `model.call` events.

**Still not implemented, and deliberately not claimed:** `setupMeter()`/OTEL metrics; W3C `traceparent` propagation between Railway and AgentCore; and the "Sift adds case, run, pack ID/version/hash, obligation, case-extension origin, and fixture/live attributes to Strands spans" sentence above — those correlation fields are recorded on the Sift `runtime_events` row (`run_id`, `case_id`, `obligation_id`, `agent_id`), not injected into the span itself, because `Graph`/`Swarm`/`Agent` `traceAttributes` are fixed at construction time inside `car-purchase-graph.ts`/`home-energy-swarm.ts`.

AgentCore execution propagates trace headers and records returned trace/session/request IDs. When AWS credentials and permissions allow, deployed verification confirms that the invocation appears in AgentCore/CloudWatch observability. CloudWatch is the production infrastructure view; the Sift inspector remains the domain-correlated product/debug view.

## Acceptance requirements

- Every required hero trajectory event is visible in the inspector and trace export.
- Clicking a visible activity item opens the exact correlated debug event. **Status: implemented, both halves.** `RuntimeInspector` accepts a `focusEventId` (a consumer activity item's `debugEventId`) and opens directly to the matching Timeline entry, scrolling to and marking the matching item `data-focused="true"`. The trigger lives inside the Runtime Inspector itself, as a third **Activity** tab (`Overview`/`Timeline`/`Activity`) that reuses `ActivityTimeline` verbatim (retired from the top-level consumer surface per ADR 0004, but not deleted — only mounted inside the Inspector now). Any item carrying both a `runId` and a `debugEventId` renders an "Inspect event" button that calls `App.tsx`'s `handleInspectEvent`, re-targeting the same open Inspector to that event's Timeline entry.
- Tool arguments/results, state diffs, steering reasons, handoffs, tokens, and timing are truthful and ordered.
- Secrets and seeded redaction canaries never appear in the database, HTTP response, SSE stream, exported bundle, screenshot, trace console, or test artifact.
- Restarting Railway preserves the completed run and inspector history.
- Disabling debug mode (`SIFT_DEBUG_ENABLED=false`) returns `404` for all debug endpoints. **This gating is server-side only today**: `CaseHeader`'s "Developer view" control is unconditional — it carries no client-side check of debug-enabled state and is rendered whenever a case is open, regardless of `SIFT_DEBUG_ENABLED`. Opening the inspector with debug disabled reaches a server that 404s its data requests rather than a hidden control; the control itself is not currently gated to match the server. This is a real, disclosed gap against the "hides the inspector control" half of this requirement, not implemented behavior.
- Real-time acceptance proves ordered queued/running/tool/evidence/steering/completion events, reconnect replay, duplicate suppression, slow-client resync, and snapshot/polling equivalence.
- A command issued through a registered WebMCP tool is visibly distinguishable from an identical command issued through its matching UI control, in both the activity stream (`safeDetails.origin`) and the Runtime Inspector — without introducing a second command path or a divergence from docs/engineering-principles.md's shared-command-implementation rule. **Met through the activity stream and the run record; the Inspector's own origin badge and `?origin=` filter are built but have no producer yet**, because no code writes `attributes.origin` onto a `runtime_events` row. See "WebMCP tool calls" above for exactly which half is which.
- The consumer surface and the Runtime Inspector never disagree about the same underlying event (see "Consumer and developer projections" above); a component or contract test asserts that a given `PublicActivityEventType` always maps to the same consumer label through `activity-labels.ts`, with no code path bypassing that mapping to render a raw internal token on the consumer surface.
