# Claim–evidence matrix — Agents for Humans

Every advanced Strands capability Sift claims, mapped to the code that implements it, the automated test that fails if it stops being true, and **the exact line in an exported run log that proves it happened**.

The judging criterion this document exists to answer is "does the code reflect genuine, non-trivial use of Strands Agents?" — so the burden here is higher than "it is imported somewhere." Each row names a log record a judge can pull from the running service and read for themselves.

A capability with no row here is one we do not claim.

---

## How to get the log yourself

One run produces the whole table. Against the deployed service:

```bash
URL=http://127.0.0.1:8080   # or the deployed URL

# 1. Open the hero case.
CASE=$(curl -s -X POST "$URL/api/cases/demo" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: proof-$(date +%s)" \
  -d '{"demoId":"bid-comparison"}' | jq -r '.caseId')

# 2. Run the investigation through the AgentCore-contract transport.
SEQ=$(curl -s "$URL/api/cases/$CASE" | jq -r '.eventSequence')
RUN=$(curl -s -X POST "$URL/invocations" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: proof-run-$(date +%s)" \
  -d "{\"caseId\":\"$CASE\",\"action\":\"requestInvestigation\",\"input\":{\"expectedSequence\":$SEQ}}" \
  | jq -r '.response.runId')

# 3. Download the complete, redaction-manifested run log.
curl -s "$URL/api/debug/runs/$RUN/export" -o run.json
jq '.overview.countsByCategory' run.json
```

The same log is available in the product itself: **Inspect run → Export**, which writes the identical `schemaVersion`-stamped JSON.

A reference capture taken 2026-09-05 against the deployed service — run `run-3fdce5d2-bd12-4aae-adce-119f92edeac2`, 308 events, 375 KB — is the source of every count quoted below.

**The single most direct piece of evidence in that file:** every OpenTelemetry span carries

```json
"otel.scope": "strands-agents"
```

That is the instrumentation scope of the Strands SDK's own tracer. Sift did not author those spans or their names; it registered a `NodeTracerProvider` and recorded what the SDK already emitted. A local class pretending to be Strands cannot produce that field.

---

## The hero run, measured

Captured 2026-09-07 from a real local run of the **`bid-comparison`** pack through `POST /invocations` — run `run-f74fb1e4-9924-4e88-b402-936c750d87de`, **394 events, 485 KB**, redaction manifest present. Every number below is `jq` output from that file, not an estimate.

| Category | Events |
| --- | --- |
| `intervention` | 137 |
| `model` | 84 |
| `tool` | 82 |
| `agent` | 41 |
| `context` | 25 |
| `swarm` | 18 |
| `skill` | 4 |
| `goal` | 2 |
| `case` | 1 |

**All four Strands control-flow beats in one round-1 run**, which the energy pack needs two rounds to reach:

| Event | Count | Agent | Subject |
| --- | --- | --- | --- |
| `intervention.deny` | 1 | `price-analyst` | `license-lookup` |
| `intervention.guide` | 1 | `scope-analyst` | `scope-differ` |
| `intervention.confirm` | 1 | `decision-synthesizer` | `propose_award` |
| `goal.validation_failed` → `goal.validated` | 1 each | `decision-synthesizer` | — |
| `intervention.proceed` | 134 | — | — |

That last row matters: the interventions are evaluated on **every** tool call, and 134 of 137 were allowed through. The three that were not are decisions, not decoration.

**Swarm, skills, context:** `swarm.node_started` × 6, `swarm.node_completed` × 6, `swarm.handoff` × 5, `skill.activated` × 4, `context.injected` × 25.

**Tools, by name:** `bid-reader` × 10, `license-lookup` × 8, `scope-differ` × 8, `bid-calculator` × 6, `propose_award` × 2, plus the SDK's own `skills` × 8 and `strands_structured_output` × 14.

**The single strongest line in the file.** 96 OpenTelemetry spans, and:

```bash
jq '[.events[]|select(.name|startswith("span."))|.attributes["otel.scope"]]|unique' bid-run.json
["strands-agents"]
```

One distinct value across every span: the instrumentation scope of the Strands SDK's own tracer. Sift registered a `NodeTracerProvider` and recorded what the SDK already emitted. A local class named after Strands cannot produce that field.

Span breakdown: `chat` × 28, `execute_agent_loop_cycle` × 28, `execute_tool` × 26, `invoke_agent` × 7, `execute_node` × 6, `invoke_swarm` × 1.


## A. Strands runtime capabilities

| # | Claim | Implementation | Automated proof | Log evidence in an exported run | Limitation |
|---|---|---|---|---|---|
| S1 | The real SDK is used, not a local look-alike. | `apps/agent/package.json` pins `@strands-agents/sdk@^1.14.0`; `runtime/plugins.ts` imports `AgentSkills`, `ContextInjector`, `GoalLoop` from the package's own vended-plugin paths | `runtime/plugins.test.ts`, `strands-adapter.test.ts` | Every `span.*` event carries `"otel.scope": "strands-agents"` | — |
| S2 | `AgentSkills` progressive activation is real. | `runtime/plugins.ts`; skills declared per specialist in the compiled pack | scenario report: 4 × `skill_activated`, each bound to its obligation | `skill.activated` × 4; `tool.skills` × 8 (the SDK's own skills tool being called) | Skills are pack-declared; an unanticipated skill needs a pack edit |
| S3 | A real bounded Swarm runs six specialists, emitting real SDK handoff events along a deterministic trajectory. | `runtime/home-energy-swarm.ts` (`Swarm` from `@strands-agents/sdk/multiagent`) | `home-energy-swarm.test.ts`; scenario report: 6 × `specialist_invoked`, 1 × `swarm_handoff` | `swarm.node_started` × 6, `swarm.node_completed` × 6, `swarm.handoff` × 5 | Bounded by node count and wall-clock; not open-ended |
| S4 | A real Strands Graph runs the vehicle pack. | `runtime/car-purchase-graph.ts` | `car-purchase-graph.test.ts`; the car scenario report carries a dedicated `graph_node` assertion kind the energy report does not (39 assertions, all passing) | Export a car run: graph node execution appears as `span.execute_node`. Note this span name is shared with the Swarm — the Graph-specific proof is the `graph_node` assertion, not the span | Fixed edges by design — that is the difference from S3 |
| S5 | `Context Injector` gives every specialist the current case projection. | `runtime/plugins.ts` `ContextInjector` | scenario report: `context_injected` with fields `[activeObligation, evidenceInventory, criteria]` | `context.injected` × 19, summary `"Injected case context (5 field(s))."` | — |
| S6 | `GoalLoop` can reject a plausible answer and force a corrected retry, bounded at 2 attempts. | `runtime/plugins.ts` `GoalLoop`, `maxAttempts: 2`, callable validator | scenario report: `goal_validation_failed` **and** `goal_recovered` | `goal.validation_failed` then `goal.validated`, both `agentId: decision-synthesizer` | Two attempts, then the draft is withheld rather than retried forever |
| S7 | Structured output goes through the SDK's own mechanism, not prose parsing. | Typed specialist results returned through Strands' `StructuredOutputTool` | `home-energy-swarm.test.ts` drives real `strands_structured_output` tool calls and asserts the parsed `ExecutionResult` shape that comes back | `tool.strands_structured_output` × 14 — the SDK's own tool name, which Sift never authored | The scripted provider supplies the payload; what the SDK does with it (tool dispatch, schema validation) is real |
| S8 | Interventions produce all three outcomes — `Guide`, `Confirm`, **and** `Deny`. | `runtime/interventions.ts`: `RetrySteering`, `ConsequenceGuard`, `ScopeAuthorization` | scenario report carries all three: `guide` / `confirm` / `deny`, each named with its handler | `intervention.guide` (`handler: RetrySteering`), `intervention.confirm` (`ConsequenceGuard`), `intervention.deny` (`ScopeAuthorization`, `subject: household-event-lookup`), plus `intervention.proceed` × 104 | **`deny` requires a build at or after `8554dbc`.** Until 2026-09-05 no trajectory triggered it and it fired only in a unit test — see the note below |
| S9 | Sessions and snapshots are real, and a run can be reconstructed. | `runtime/session-adapter.ts` (real `SessionManager` + `LocalFileStorage`) | `session-adapter.test.ts` real filesystem round trip; scenario report `snapshotRestorations` | `session.snapshot_saved` / `session.snapshot_restored` — **not present in the single-investigation reference run above** (verified: 0 of each). These fire on the round-2 confirmation path, so reproduce them by completing the reweight-and-approve journey rather than one `requestInvestigation` | Local file storage; not a distributed session store |
| S10 | Native OTel tracing feeds the Runtime Inspector. | `runtime/otel-span-recorder.ts` — `installSiftTracing()` builds a real `NodeTracerProvider`, calls `provider.register()` and the SDK's `setupTracer({ provider })` | `otel-span-recorder.test.ts` asserts the real 5-level span tree | 76 events carry a real `otel.span_id` / `otel.parent_span_id`: `span.invoke_agent` × 7, `span.execute_node` × 6, `span.execute_agent_loop_cycle` × 21, `span.chat` × 21, `span.execute_tool` × 20 | No OTEL metrics and no W3C `traceparent` propagation — neither is claimed |
| S11 | The service satisfies the AgentCore runtime HTTP contract. | `routes/agentcore.ts` — `GET /ping`, `POST /invocations` | `agentcore.test.ts` | `curl $URL/ping` → `{"status":"Healthy","time_of_last_update":…}`; the run above was itself driven through `/invocations` | The contract is served and exercised; **AgentCore itself is not deployed** — no AWS credentials. See `release-metadata.json` `agentCore.deployed: false` |
| S12 | A real Amazon Bedrock inference call runs in production, not just in a unit test — on one opt-in route, not the hero trajectory. | `apps/agent/src/server.ts:240` constructs a real `BedrockModel` via `resolveModelProvider` (`apps/agent/src/runtime/model-provider.ts`) only when `SIFT_BID_DOCUMENT_READER_ENABLED=true`; `apps/agent/src/routes/bid-documents.ts`'s `POST /api/cases/:caseId/bid-documents/read` calls it through `apps/agent/src/runtime/bid-document-reader.ts` | `bid-documents.test.ts` and `bid-document-reader.test.ts` exercise the route/reader against a scripted provider double | Verified live 2026-09-14 against **Amazon Nova Lite** (`amazon.nova-lite-v1:0`) on Amazon Bedrock, region `us-east-1`: HTTP 200 in 2.5s. The model created one new option — label "Harborview Mechanical LLC" — with `bid.quoted_total` (`{money, amount 241800, USD}`) and `bid.deposit_percent` populated. Every extracted attribute carried `origin: "agent_proposed"`, `status: "supported"`, `confidence: 0.4`, and a `sourceIds` link — never `verified`, per `packages/core/src/attributes.ts`'s rule that only `origin: 'user'` may claim `verified`. The case's event sequence advanced from 19 to 20 | Opt-in and off by default (`SIFT_BID_DOCUMENT_READER_ENABLED` defaults to `false`). Nova, not Anthropic's model, because Anthropic models on Bedrock are currently blocked on this AWS account pending its "Anthropic use case details" form; Nova is ungated and cheaper. **This is not the hero path** — `bid-comparison-engine.ts:450` still wires `modelFor: scriptedModelFor(providers)` unconditionally, so the Swarm's handoffs remain a fixed, scripted trajectory, not model-chosen |

### The `Deny` caveat, stated plainly

`ScopeAuthorization` was registered in both the Swarm and the Graph from the beginning, but until 2026-09-05 no specialist in either demo trajectory ever attempted an ungranted tool — so `deny` fired only inside a unit test that patched a model provider on purpose. It appeared in no scenario report and on no screen. Verified against a live deployed run before the fix: 308 events, interventions were `104 proceed + 1 guide`, zero `deny`.

It is genuinely reachable now: `anomaly-investigator`, having measured the 42% anomaly, reaches for `household-event-lookup` — a tool the compiled pack grants to `home-systems-analyst` — and the guard refuses the call before it executes. What is scripted is the model's overreach, an ordinary real-world failure mode; what does the denying is real code reading the real compiled pack.

**A log pulled from a deployment older than `8554dbc` will not contain `intervention.deny`.** Check which build you are reading before citing this row.

---

## B. Authority boundary

| # | Claim | Implementation | Automated proof | Log / live evidence | Limitation |
|---|---|---|---|---|---|
| B1 | The agent can never approve a consequential decision. | `packages/core/src/policy.ts` `reviewProposal` rejects any `decision.actor !== 'human'` | scenario report: `forbidden_event_absent` — "no proposal was ever approved with actor `agent`" | No `proposal.reviewed` event with `actor: agent` exists in any run | Inspects a client-supplied field; the structural guarantee is B2 |
| B2 | An autonomous caller cannot approve **through the transport an autonomous caller would use**. | `routes/agentcore.ts` — `AGENTCORE_COMMAND_NAMES` excludes `reviewProposal` and `reviewCaseExtension` | `agentcore.test.ts` | `POST /invocations` with `commandName: "reviewProposal"` → `400 VALIDATION`, and the error enumerates the 17 verbs it *does* accept | Structural: the enum member does not exist. There is no flag to re-enable |
| B3 | A consequential tool call is gated on a human before it is recorded. | `ConsequenceGuard` `Confirm` on `propose_inspection` | scenario report `intervention` (`confirm`) | `intervention.confirm`, `handler: ConsequenceGuard` | The pack declares which tools are consequential |
| B4 | A specialist cannot use a tool outside its compiled grant. | `ScopeAuthorization`, driven from `pack.specialists[].allowedTools` | `home-energy-swarm.test.ts` "the shipped round1 trajectory has anomaly-investigator reach outside its grant" | `intervention.deny`; the denied tool is the only one whose `tool.*` event never reaches `status: "success"` | See the `Deny` caveat above |

---

## C. What the log deliberately does **not** contain

| # | Claim | Implementation | Evidence |
|---|---|---|---|
| R1 | Model and user content is never persisted verbatim. | `redactValue` in `event-normalizer.ts` | Every export carries a `redactionManifest` naming each withheld path and why — e.g. `attributes.system_prompt`, *"model or user content is persisted as a length and digest, never verbatim"* |
| R2 | No credentials, authorization headers, cookies, or raw private reasoning are recorded. | Same redaction pass | `debug.test.ts` secret-canary tests; the manifest is the visible half |
| R3 | Chain-of-thought is not displayed. | Public activity stream carries actions, outcomes and state changes only | `PUBLIC_ACTIVITY_EVENT_TYPES` has no reasoning-bearing member |

The redaction manifest is worth a judge's attention in its own right: the log proves what was withheld and why, rather than silently omitting it.

---

## D. Honest gaps

- **AgentCore is not deployed.** The contract is served and exercised; no AWS credentials existed in the build environment. `aws sts get-caller-identity` → `NoCredentials`.
- **No CloudWatch correlation**, for the same reason. The architecture diagram deliberately draws none.
- **The hero trajectory has no live model inference path.** `bid-comparison-engine.ts` and both other engines construct their scripted provider unconditionally, so every hero run — local and deployed — is scripted. The scripted provider is a real Strands `Model` subclass driving the genuine agent loop, tool-calling and structured-output validation, so **the orchestration in every row above is real**; what is absent from the hero path specifically is a call to Bedrock. Separately, `createBedrockModel`/`resolveModelProvider` (row S12) are exercised by a real production route as of 2026-09-14 — the opt-in bid-document reader, not the hero Swarm. See `docs/specs/strands-runtime.md` "What actually ships".
- **The deployed build can lag the repository.** Nothing in the product reports which commit is live. Confirm the deployment before citing a log against a specific row.
