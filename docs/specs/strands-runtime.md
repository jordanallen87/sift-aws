# Strands Runtime Specification

Official implementation references:

- [TypeScript SDK](https://github.com/strands-agents/sdk-typescript)
- [Skills](https://strandsagents.com/docs/user-guide/concepts/plugins/skills/)
- [Interventions and steering](https://strandsagents.com/docs/user-guide/concepts/agents/interventions/)
- [Swarm](https://strandsagents.com/docs/user-guide/concepts/multi-agent/swarm/)
- [Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/)
- [Context Injector](https://strandsagents.com/docs/user-guide/concepts/plugins/context-injector/)
- [GoalLoop](https://strandsagents.com/docs/user-guide/concepts/plugins/goal-loop/)
- [Sessions and snapshots](https://strandsagents.com/docs/user-guide/concepts/agents/session-management/)
- [AgentCore TypeScript deployment](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/)

## Responsibility boundary

Strands decides how to investigate a selected obligation. It does not decide which canonical case events are valid, whether evidence satisfies a required level, or whether a human decision is approved.

The core engine supplies a bounded `ExecutionRequest`; the Strands adapter returns a validated `ExecutionResult` and a trace. The case reducer remains the authority for state changes.

## Engine loop

```text
load case
derive obligations
evaluate readiness
if ready: prepare proposal and stop
select highest-value unresolved obligation
construct bounded execution request from compiled Decision Pack and case extensions
invoke Strands agent or graph under interventions
validate structured result
append evidence and activity events
recompute readiness
pause, repeat, or stop
```

The loop is bounded by per-obligation attempts, per-run tool calls, wall-clock duration, and estimated model cost.

Default bounds:

- three attempts per obligation unless the pack specifies fewer;
- twelve tool calls per run;
- six graph node executions per run;
- 120-second model request timeout;
- five-minute total run timeout;
- no automatic paid external tools in the hackathon implementation.

## Execution request

```ts
interface ExecutionRequest {
  runId: string
  caseId: string
  pack: { id: string; version: string; compiledHash: string }
  obligation: ObligationState
  caseSummary: CaseSummary
  caseExtensions: CaseExtensionSummary[]
  availableSkills: string[]
  availableSpecialists: string[]
  allowedTools: string[]
  priorAttempts: AttemptSummary[]
  limits: ExecutionLimits
}
```

Only the minimum source excerpts needed for the obligation enter model context. Full fixture files remain behind tools.

## Agents

### Router agent

Returns registered Decision Pack candidates through a Zod structured-output schema. Invalid or unknown candidates are discarded. Deterministic routing supplies fallback behavior.

### Case orchestrator

Receives one obligation, chooses a relevant skill and specialist, invokes tools or agent-tools, and returns structured claims, evidence references, limitations, and suggested next status.

### Specialists

Specialists are Strands agents exposed as tools to the orchestrator. Each has a narrow prompt and tool subset. The two runtime packs define:

- `deal-analyst`;
- `ownership-cost-analyst`;
- `safety-reliability-analyst`;
- `household-fit-analyst`;
- `usage-analyst`;
- `rate-analyst`;
- `source-challenger`;
- `decision-synthesizer`.

These are actual Strands agents, not labels applied to one generic completion. Fixture mode replaces external data and model output, but it still executes the real Graph/Swarm and agent boundaries.

Specialists cannot write case state. They return structured observations to the orchestrator.

The car-buying demo uses this orchestrator and a deterministic Strands Graph because listing normalization, parallel comparison, challenge, and synthesis have a known dependency topology. The Energy demo uses a bounded Strands Swarm because the next specialist depends on what rate, weather, and household evidence explains.

## Skills

Skills use Strands `AgentSkills` progressive disclosure. The agent initially receives name and description metadata. Full instructions load only when the skill is activated.

Skill `allowed-tools` metadata is not treated as enforcement. Sift intersects:

```text
compiled-pack-declared tools
∩ specialist-declared tools
∩ server registry tools
∩ current policy allowance
```

The resulting set is the only tool set passed to the agent.

Every skill activation emits `skill.activated` with skill ID, obligation ID, agent ID, and reason. A skill change emits both deactivation and activation events.

## Orchestration

Most obligation moves use the orchestrator with one specialist as an agent-tool. The two synthesis moments use a programmatically constructed Strands Graph:

```text
deal + ownership-cost specialists ─┐
                                   ├─> source challenger ─> decision synthesizer
safety + household-fit specialists ┘
```

Graph construction is code-driven from validated compiled pack declarations. The model does not generate executable graph definitions. Graphs set `maxSteps`, timeouts, and concurrency explicitly.

### Energy Swarm

The Energy investigation team contains `anomaly-investigator`, `rate-analyst`, `weather-analyst`, `home-systems-analyst`, `source-challenger`, and `decision-synthesizer`. Structured handoffs carry the active obligation, evidence delta, limitations, and requested next expertise.

The Swarm sets `maxSteps`, execution timeout, node timeout, and repetitive-handoff detection. A handoff emits `swarm.handoff`; start, completion, timeout, and cycle detection emit corresponding normalized runtime events. A scripted model drives the real Strands Swarm machinery in deterministic tests.

The Strands `Swarm`'s own `repetitiveHandoffDetectionWindow`/`repetitiveHandoffMinUniqueAgents` configuration returns a `FAILED` multi-agent result when tripped; it does not redirect gracefully. Sift's own `RetrySteering` no-progress detector (three consecutive calls with no evidence delta) must trip strictly before the Swarm's own repetitive-handoff window would, so the required "repeated weather work → `Guide` → handoff to `home-systems-analyst`" trajectory always resolves through Sift's soft redirect rather than risking the Swarm's hard failure path. Configure `repetitiveHandoffDetectionWindow`/`repetitiveHandoffMinUniqueAgents` generously (wider than Sift's three-call threshold) so it functions only as an outer safety net.

Handoffs use the Swarm's built-in structured-output routing: each node agent receives an automatically constructed Zod schema with an optional `agentId`, a `message`, and an optional `context` field, and the Swarm hands off to `agentId` when present or treats `message` as the final response otherwise. Sift's evidence delta, obligation ID, and limitations travel inside the serialized JSON `context` field of that handoff schema; the event normalizer reads `context` to emit `swarm.handoff` with `from`, `to`, `reason`, and `evidenceDelta`.

The Swarm does not decide that the case is ready. It returns candidate evidence and a proposed artifact to the core readiness gate.

## Case-specific run planning

The compiled pack defines the permitted execution envelope. Before each move, the case orchestrator produces a structured `RunPlan`:

```ts
interface RunPlan {
  obligationId: string
  hypothesis?: string
  specialistIds: string[]
  skillIds: string[]
  toolIds: string[]
  orderedSteps: Array<{
    kind: 'specialist' | 'tool' | 'validate' | 'request_human_evidence'
    ref: string
    purpose: string
  }>
  stopConditions: string[]
}
```

The core validates every reference against the compiled pack and current policy before execution. The model may revise this run plan after evidence or steering, but it cannot change the pack, introduce a capability, delete a required question, or widen a budget.

Case-defined criteria and attributes enter through Context Injector. If a new concern can be handled by installed capabilities, the orchestrator targets it. If it cannot, the run plan must request human evidence or preserve explicit uncertainty.

## Research behavior

Specialist agents research only through installed tools. Strands and the model do not receive implicit internet access.

- Deterministic demos use fixture-backed listing, bill, tariff, weather, automotive-source, calculator, and household-event tools.
- Optional live car cases may use bounded public automotive adapters and structured sources submitted by the user or ChatGPT.
- A general search provider is optional and, if installed, must return source IDs, retrieval metadata, excerpts, and limits through a validated tool contract.
- `source-challenger` evaluates provenance, recency, contradictions, and claim support before submitted research can satisfy an obligation.
- Research agents return evidence proposals only. The core decides whether the evidence is admissible and what becomes stale.

## Context injection

The runtime uses the Strands Context Injector to supply current case facts on every model turn without appending them to durable conversation history:

- active obligation and completion rule;
- current evidence inventory and staleness;
- remaining attempts, tool calls, time, and cost budget;
- user criteria and authorization posture;
- allowed tools, skills, and specialists.

Every injection emits a normalized `context.injected` event containing field names and a content hash, never private source bodies. Tests assert that updated criteria appear on the next turn and that stale case context does not remain authoritative.

Injected context includes pack-defined and case-defined criteria and attributes with origin labels. Agent-proposed case extensions remain explicitly unconfirmed until a human accepts them.

## GoalLoop output validation

GoalLoop wraps recommendation artifact generation, not the entire engine. Its callable validator checks source linkage, resolved required obligations or accepted uncertainty, allowed confidence, separation of fact and hypothesis, and absence of forbidden effects.

`maxAttempts` is two. A rejection emits `goal.validation_failed` with machine-readable reasons and a visible `Draft withheld` activity item. Exhaustion produces a blocked recommendation; it never silently publishes the last invalid draft.

A Strands `GoalLoop` plugin attaches to one `Agent` instance and validates that agent's own invocation output; only one `GoalLoop` is supported per agent. `decision-synthesizer` is therefore constructed as its own distinct `Agent`, invoked as an agent-tool from the Graph or Swarm, carrying its own `GoalLoop` instance configured with a programmatic `Validator` function (not the orchestrator's or any other specialist's agent instance). This keeps GoalLoop scoped to recommendation-artifact generation as required, and avoids exceeding the one-GoalLoop-per-agent limit.

## Interventions and steering

Sift registers ordered TypeScript intervention handlers:

1. `ScopeAuthorization` — denies an undeclared tool or case scope.
2. `ConsequenceGuard` — confirms a consequential proposal and denies forbidden effects.
3. `BudgetGuard` — confirms or denies work exceeding configured limits.
4. `RetrySteering` — guides after repeated failures or duplicate searches.
5. `EvidenceQualitySteering` — guides outputs missing source references or presenting unsupported certainty.
6. `OutputSanitizer` — transforms displayable text to remove unsupported control content while preserving structured data.

The narrow steering handler uses `Proceed`, `Guide`, and `Confirm`. General guards use the wider intervention vocabulary when `Deny` or `Transform` is required.

`Confirm` is a Strands `InterventionAction` valid only on `beforeToolCall`. `ConsequenceGuard` therefore cannot be a free-floating mid-run checkpoint; it must gate a specific tool call the orchestrator invokes to create a consequential artifact (for example `propose_recommendation` in the car pack or `create_inspection_proposal` in the energy pack). The orchestrator calls that tool only when it intends to hand a proposal to the deterministic core; `ConsequenceGuard`'s `beforeToolCall` handler is what pauses execution and requests human confirmation before the call proceeds.

### Standing Watch: `HumanInTheLoop` composes with `ConsequenceGuard`

**Specified, not yet implemented.** Full rationale in docs/decisions/0015-standing-watch-and-background-triggers.md Decision 1. A pack's declaration of which tools are consequential does not change for a background run — `PolicyDefinition`/`ToolDeclaration.effect` stay the single, deterministic, core-owned source of that fact, exactly as today. What changes is the **mechanism** enforcing the pause, selected by the run's origin:

- A **foreground** run (a click, or a WebMCP tool call made while a browser is attached) keeps using `ConsequenceGuard` (`apps/agent/src/runtime/interventions.ts`) unchanged — `intervention.confirm`, answered synchronously, `resolveConfirmation` available for deterministic tests.
- A **watch-initiated (background)** run has no live consumer to answer a confirm, and the pause must survive a process restart or an AgentCore Runtime idle timeout. It uses the SDK's `HumanInTheLoop` (`@strands-agents/sdk/vended-interventions/hitl`) instead: the default mode pauses the agent with `stopReason: 'interrupt'`, the interrupt state persists through the run's own `SessionManager` snapshot (the `'session'` preset's field list includes `'interrupts'`, confirmed in `docs/research/strands-spikes.md`'s spike 1), and resuming is `agent.invoke([new InterruptResponseContent({ interruptId, response })])` in a later process — there is no separate `resume()` method in the installed SDK version.

One `consequentialToolIds`/`forbiddenToolIds` declaration; two handlers, chosen at run construction by origin, never both registered on the same agent instance because a run has exactly one origin. `strands-adapter.ts`'s existing per-run intervention-list construction is the seam: selecting `ConsequenceGuard` or `HumanInTheLoop` there, keyed on run origin, is additive to that construction, not a rewrite of it. `pending_interrupts` (`architecture.md` "Standing Watch scheduler") is the durable, case-scoped record of an unresolved `HumanInTheLoop` pause — what lets the case workspace show "something needs your attention" without decoding a Strands session file.

### Cedar authorization: proven, flag-gated, not the default

**Proven in `docs/research/strands-spikes.md` spike 2; not wired into the hero path.** `CedarAuthorization` (`@strands-agents/sdk/vended-interventions/cedar`) evaluates a tool call against Cedar policy text with a `principalResolver` reading `invocationState`, and fails closed (denies) when the resolver cannot identify a principal. The spike's own policy example is `bid-comparison`'s real deny case, verbatim: `price-analyst` must not call `license-lookup`, while `credential-checker` may. `ScopeAuthorization` remains the shipped deny mechanism for every build this specification covers (docs/decisions/0015 Decision 2) — rewiring the mechanism behind an already-tested, baselined deny beat is a risk this build declines to take for a presentational gain. Cedar is documented here as a real, proven, AWS-native alternative available behind configuration (`SIFT_AUTHORIZATION_MODE=scope|cedar`, named but not implemented), and as evidence for a submission that wants to name it, not as running code.

Every intervention emits:

```ts
interface InterventionEvent {
  type: 'intervention.proceed' | 'intervention.guide' | 'intervention.confirm' | 'intervention.deny' | 'intervention.transform'
  handler: string
  runId: string
  obligationId: string
  stage: 'before_tool' | 'after_model'
  subject: string
  reason: string
  timestamp: string
}
```

The activity UI renders the action and reason. It does not expose hidden model reasoning.

## Retry steering rules

Deterministic context providers track tool name, normalized arguments, result status, source IDs, and evidence delta.

`RetrySteering` returns `Guide` when any condition is true:

- the same normalized tool call failed twice;
- three consecutive calls produced no new source or claim;
- a tool is requested after its obligation attempt budget is exhausted;
- a search repeats a prior query family without explaining a new angle.

The guidance identifies an allowed alternative technique from the active skill. If no technique remains, the engine records accepted uncertainty when allowed or pauses as blocked. Steering may change the run plan, active skill, specialist, or allowed next step; it may not mutate the compiled pack.

### Standing Watch: vended LLM steering does watch triage, never tool-call guarding

**Specified, not yet implemented.** Full rationale in docs/decisions/0015-standing-watch-and-background-triggers.md Decision 3. `RetrySteering` and a watch's triage step both use Strands steering machinery, and they never contend, because they act in different phases:

- `RetrySteering` guards tool calls **during** a run, registered as an `InterventionHandler` on the orchestrator/specialist agent, evaluating each `beforeToolCall` against the deterministic `ToolLedger` — exactly as described above, unchanged.
- Watch **triage** — is a detected change material enough to justify starting a background run at all — happens **before** any run exists, using the SDK's vended `LLMSteeringHandler` (`@strands-agents/sdk/vended-interventions/steering`, proven in `docs/research/strands-spikes.md` spike 4) as a single-shot, separately-modelled triage agent invoked by the scheduler dispatcher: its own inner `Agent`, its own model, no shared mutable state with whatever agent a resulting run might later construct. A custom `SteeringContextProvider` (spike 4's `FakeFeedDeltaProvider` pattern) supplies "what changed since the case's last run" as the triage prompt's context. Its `'guide'` output cancels nothing, because it gates no tool call of its own — it produces a proposed subset of `WatchDeclaration.reopens` plus a plain-language note, which is a triage **verdict**, not a steering **action** on a live agent loop.

They cannot both fire on one tool call: triage never gates a tool call, and `RetrySteering` never runs before a run exists. A run that triage approves is an ordinary bounded orchestrator/specialist execution with `RetrySteering` registered on it exactly as any other run has, on a tightened `BudgetGuard` (`WatchDeclaration.budget`). This is a structural fact about which agent each handler is registered on, not a coincidence of current configuration — a future change that registered `LLMSteeringHandler`-based triage on the same agent `RetrySteering` guards would violate this section, not merely surprise a reader of it.

## Evidence output

The orchestrator's structured output is:

```ts
interface ExecutionResult {
  obligationId: string
  disposition: 'evidence_found' | 'no_evidence' | 'needs_human' | 'blocked'
  claims: Array<{
    statement: string
    stance: 'supports' | 'opposes' | 'neutral'
    confidence: number
    sourceIds: string[]
  }>
  evidenceResults: Array<{
    sourceId: string
    level: 'E0' | 'E1' | 'E2' | 'E3'
    verdict: 'pass' | 'fail' | 'error' | 'degraded' | 'skipped'
    summary: string
  }>
  limitations: string[]
  suggestedStatus: 'open' | 'satisfied' | 'accepted_uncertainty' | 'blocked'
}
```

The core validates that sources exist, confidence is within zero and one, evidence levels are permitted for the tool, and the suggested status is compatible with the obligation rule. Invalid output becomes a failed attempt and a visible validation event.

## Sessions and snapshots

Each case uses one Strands orchestrator session. Only the orchestrator receives a session manager; nested graph agents do not create independent session managers.

- Local: `SessionManager` with `LocalFileStorage` imported from `@strands-agents/sdk/storage` (not the deprecated root-level `FileStorage` export) under `.sift-data/sessions`.
- AgentCore: `SessionManager` with `S3Storage` and a case-scoped prefix.
- Save multi-agent state after each node.
- Create an immutable snapshot before a human confirmation and after a recommendation proposal.
- The Energy deterministic scenario must restart the adapter after the confirmation snapshot, restore it, and continue from the same handoff/session position.

Canonical Sift events remain separate from Strands session snapshots. Restoring a Strands snapshot cannot roll back a human decision or delete evidence.

## Pack authoring agent and skill

Pack authoring is a separate developer-mode Strands session. A `pack-author` agent activates the real `pack-authoring` AgentSkill and receives only the bounded authoring tools defined in `pack-authoring.md`.

It may interview an author, inspect the installed capability catalog, draft declarative files, run compiler/conformance checks, and explain failures. It cannot execute arbitrary authored code, access normal case sources, publish without a human confirmation event, or modify an installed pack version. `SIFT_AUTHORING_ENABLED=false` prevents construction of this agent and its routes in the public hackathon deployment.

Every authoring action emits the same normalized skill, tool, intervention, validation, and human-confirmation events as decision runs, using `authoringSessionId` in addition to normal trace correlation.

## Models and configuration

- Configured runtime provider: Amazon Bedrock.
- Default model: `global.anthropic.claude-sonnet-4-6`.
- Override: `SIFT_MODEL_ID`.
- Region: `AWS_REGION`, default `us-east-1`.
- Deterministic tests use a scripted `ModelProvider` test double and never call Bedrock.
- Live tests use low temperature, bounded tokens, and invariant assertions rather than exact prose matching.

**What actually ships, as of 2026-09-05.** The Bedrock provider is built and unit-tested
(`apps/agent/src/runtime/model-provider.ts`'s `createBedrockModel`/`resolveModelProvider`, backed by
the real `BedrockModel` class from `@strands-agents/sdk`) but **is not reached by any production code
path**. Both hero engines construct their scripted provider unconditionally —
`home-energy-engine.ts` passes `modelFor: scriptedModelFor(providers)` and `car-purchase-engine.ts`
calls `buildCarPurchaseScriptedProviders()` — with no branch on `SIFT_MODEL_ID`, `AWS_REGION`, or
credential availability. `resolveModelProvider`'s only callers are in
`model-provider.test.ts`. So "default runtime provider" above describes the configured intent and the
code that exists to honor it, not the behavior of a running deployment: **every run, local and
deployed, is scripted**.

This is deliberate for the deterministic release gates (CLAUDE.md: "Fixture mode must execute the
complete product without network access after installation", and a local fake "may replace the model
and external data, but it may not replace the Strands orchestration being claimed" — which holds
here, since the scripted provider is a real Strands `Model` subclass driving the actual `Agent`
loop, tool-calling, and structured-output validation). It is **not** deliberate that no live path is
wired at all; that remains genuinely unfinished work, blocked on AWS credentials that do not exist in
this build environment. Anything published about Sift must therefore not claim a live Bedrock
inference path — see `docs/submissions/agents-for-humans/submission-details.md`'s Built-with entry,
which is qualified accordingly.

## AgentCore contract

The service exposes:

- `GET /ping` returning `{ status: "Healthy", time_of_last_update: number }`;
- `POST /invocations` accepting the AgentCore binary request body and returning the invocation result envelope.

The Docker image exposes port `8080`, runs as a non-root user, includes a health check, and contains no development credentials.
