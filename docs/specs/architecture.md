# System Architecture Specification

## Architecture summary

Sift is a pnpm TypeScript monorepo with a React/Vite browser application, an Express Strands service, and small shared packages for contracts, deterministic decision logic, Decision Packs, and scenario fixtures.

The browser owns visible case interaction and WebMCP registration. The service owns Strands agents, adaptive execution, intervention handling, and run persistence. Pure domain packages own routing, obligations, evidence, readiness, and proposal rules so they can be tested without a model, browser, database, or network.

## Repository structure

```text
sift/
  apps/
    web/                    React/Vite right-pane website and WebMCP registration
    agent/                  Express + Strands TypeScript service and static web host
  packages/
    contracts/              Zod schemas and shared API/event types
    core/                   Pure case reducer, routing, obligations, evidence, readiness, scoring
    packs/                  Compiler, registry, built-in manifests, authoring tools
    catalog/                Bundled vehicle catalog, bounded queries, pack-attribute mapping
    scenarios/              Fixture data, scripted tools, scenario runner, assertions
  tests/
    contract/               WebMCP and HTTP contract suites
    integration/            Real package/service integration with fake model and tools
    scenarios/              Machine-readable end-to-end demo specifications
    e2e/                    Playwright browser journeys and accessibility checks
    live/                   Opt-in Bedrock and deployed-runtime smoke tests
  scripts/                  Verification orchestration and report generation
  artifacts/verification/  Ignored generated reports, traces, screenshots, and videos
  docs/                     Specs, architecture diagram, guides, and submission materials
```

No file in `packages/core` may import React, Express, Strands, a model provider, or filesystem storage.

## Technology choices

- Node.js 20 or newer.
- pnpm workspaces.
- TypeScript in strict mode.
- React 19 and Vite for the browser app.
- Tailwind CSS for styling, with a small Sift token layer.
- Express for the agent service because the official TypeScript AgentCore deployment path uses Express and the `/ping` plus `/invocations` contract.
- `@strands-agents/sdk` for the runtime.
- Zod for all external and persisted boundaries. Zod validates the stable envelope, discriminated attribute values, declared pack fields, and tool/model contracts; it does not impose a closed list of domain attributes on a case.
- Vitest, React Testing Library, MSW, fast-check, and Playwright for testing.
- SQLite through `better-sqlite3` and Drizzle migrations for canonical Sift persistence.
- Strands `SessionManager` with `LocalFileStorage` locally and `S3Storage` in AgentCore deployment.
- Server-sent events for truthful browser activity and case updates from the first implementation milestone. Polling is an allowed fallback when a deployment proxy prevents SSE.

## Runtime components

### Browser application

The web app renders canonical `CaseState`, registers WebMCP tools, calls the shared API client, and subscribes to case events. It contains no model prompts and never decides readiness itself.

### Shared command client

Every user or WebMCP mutation calls a named command through the same interface:

```ts
interface SiftCommands {
  startDemo(input: StartDemoInput): Promise<CommandReceipt>
  startCase(input: StartCaseInput): Promise<CommandReceipt>
  selectPack(input: SelectPackInput): Promise<CommandReceipt>
  upsertOption(input: UpsertOptionInput): Promise<CommandReceipt>
  focusOption(input: FocusOptionInput): Promise<CommandReceipt>
  defineCaseAttribute(input: DefineCaseAttributeInput): Promise<CommandReceipt>
  reviewCaseExtension(input: ReviewCaseExtensionInput): Promise<CommandReceipt>
  focusEvidence(input: FocusEvidenceInput): Promise<CommandReceipt>
  updateCriteria(input: UpdateCriteriaInput): Promise<CommandReceipt>
  submitSource(input: SubmitSourceInput): Promise<CommandReceipt>
  requestInvestigation(input: RequestInvestigationInput): Promise<RunReceipt>
  reviewProposal(input: ReviewProposalInput): Promise<CommandReceipt>
  setEvidenceDisposition(input: SetEvidenceDispositionInput): Promise<CommandReceipt>
  requestRevision(input: RequestRevisionInput): Promise<CommandReceipt>
}

interface CommandReceipt {
  commandId: string
  caseId: string
  acceptedSequence: number
  runId?: string
  snapshot?: CaseSnapshot
}
```

The React controls and WebMCP callbacks consume the same `SiftCommands` instance. No WebMCP-only mutation path is permitted.

### HTTP service

The service exposes:

- `GET /health` for the web deployment;
- `GET /api/packs`;
- `POST /api/cases/demo`;
- `POST /api/cases` — normal, non-demo case creation pinned to any registered pack id (docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md);
- `GET /api/cases/:caseId`;
- `GET /api/cases/:caseId/events` as SSE;
- `POST /api/cases/:caseId/commands/:commandName`;
- `POST /api/cases/:caseId/run`;
- `GET /api/debug/runs/:runId`;
- `GET /api/debug/runs/:runId/events` as SSE;
- `GET /api/debug/runs/:runId/export`;
- `GET /api/catalog/years`, `GET /api/catalog/makes`, `GET /api/catalog/models`, `GET /api/catalog/body-styles`, `GET /api/catalog/vehicles`, `GET /api/catalog/vehicles/:id` — read-only, bounded, offline vehicle catalog queries (docs/decisions/0003), backed by `@sift/catalog`;
- `GET /api/cases` — **specified, not yet implemented** (docs/decisions/0015-standing-watch-and-background-triggers.md, "Prerequisites"): a bounded summary of every case (id, title, pack, watch/attention state, last-activity timestamp), the read model a case list needs and the only one that does not exist yet among the routes on this list;
- `GET /api/events` — **specified, not yet implemented** (ADR 0015): a global SSE stream carrying enough of each case's summary to keep a case list live without one connection per case. Today's `GET /api/cases/:caseId/events` remains the per-case detail stream; this is additive, not a replacement;
- `GET /ping` for AgentCore;
- `POST /invocations` for AgentCore.

Every route validates input and output through schemas from `packages/contracts`.

### Deterministic core

The core provides pure functions:

```ts
routePack(input, registry): RoutingDecision
instantiateCase(pack, seed): CaseState
deriveObligations(caseState): ObligationState[]
selectNextObligation(caseState): ObligationSelection
applyCaseEvent(caseState, event): CaseState
evaluateReadiness(caseState): ReadinessResult
reviewProposal(caseState, decision): CaseState
scoreCaseState(caseState): CaseScoreboard
deriveInsights(board): Insight[]
```

The model may supply structured candidate events, but only `applyCaseEvent` can change canonical state.

#### Scoring and insights

A ranking is a claim about a case, so it belongs to the core alongside state, evidence validity, and
readiness. `scoreCaseState` produces a `CaseScoreboard`: every option ranked, each with a
per-criterion line carrying a normalized score, a status, a plain-English reason, the underlying
value, and that value's evidential standing. `deriveInsights` is a pure function of the board.

Both are pure — no filesystem, network, clock, or randomness — so the same inputs always produce the
identical board, including the ordering. That is what lets a re-render after a reweight be trusted
as the consequence of the reweight rather than of anything else, and it is why the browser computes
the board locally from the snapshot it already holds rather than fetching it. `apps/agent` and
`apps/web` call the same function: two implementations that agree today can drift, and the failure
mode is a workspace showing one leader while the recommendation names another.

The engine is governed by six honesty rules, each of which exists because the obvious implementation
gets it wrong in a way nobody notices:

1. **An unknown is never a zero.** Missing data lowers `coverage`, never `total`. `total` is the
   weighted mean over scored criteria only. Scoring an unresearched option as 0 turns "we did not
   look" into "it is bad".
2. **The attribute owns what "better" means.** `AttributeDefinition.comparison` is authoritative
   over `Criterion.direction` when they differ; a criterion phrased as a benefit over a cost
   measurement is an ordinary pattern, not an error. Every line states the direction it scored by.
3. **Enums are not ordinal until a pack says so**, via `AttributeDefinition.orderedValues` — values
   in ascending order along their natural scale, with `comparison` supplying the direction. A value
   absent from that list is unscorable, not worst.
4. **A hard constraint flags; it never silently eliminates.** A violating option stays on the board,
   fully scored and visibly labelled, ranked below every compliant one. Constraints are evaluated
   absolutely, never relatively.
5. **Refuse rather than invent.** Mixed currencies, mismatched units, free text, and unlisted enum
   grades are reported as not comparable.
6. **A disputed fact is not a settled one.** A `conflicted` value still scores but is marked
   `disputed`; a single contested part marks a whole composite; and an insight fires only when the
   leader's lead actually depends on it.

`Criterion.composedOfAttributes` lets a composite criterion be measured from several attributes,
each normalized by its own `comparison`, with the partial basis stated when some parts are
unestablished.

A recommendation's `confidence`, `facts`, and `limitations` are derived from the board rather than
asserted. When a model-proposed favorite is not the deterministic leader, the proposal stands, the
disagreement is stated in `limitations`, and confidence is capped — silently overwriting the model's
pick and silently accepting it both hide a real disagreement.

See `docs/decisions/0012-deterministic-scoring-and-insights.md`.

### Strands adapter

The adapter converts a selected obligation and compiled pack into a bounded case-specific run plan, invokes the appropriate Strands agent, Graph, or Swarm, records hook/intervention events, validates structured outputs, and submits candidate evidence events to the core.

Strands messages and private model reasoning are not canonical case data. Only validated events are persisted.

## Canonical data model

```ts
interface CaseState {
  schemaVersion: '1.0'
  id: string
  title: string
  status: 'draft' | 'decided'
  pack: {
    id: string
    version: string
    compiledHash: string
    selectedBy: 'user' | 'router'
    reasons: string[]
  }
  attributeDefinitions: AttributeDefinition[]
  entities: EntityRecord[]
  criteria: Criterion[]
  obligations: ObligationState[]
  claims: Claim[]
  sources: Source[]
  evidenceLinks: EvidenceLink[]
  notes: CaseNote[]
  recommendation: Recommendation | null
  proposal: DecisionProposal | null
  activeFocus: ActiveFocus | null
  selectedOptionId: string | null
  selectedEvidenceId: string | null
  view: WorkspaceViewState | null
  eventSequence: number
  createdAt: string
  updatedAt: string
}
```

`status` is a two-value type (ADR 0004 decision 4). The four other values a prior revision of this contract declared — `investigating`, `waiting`, `ready`, `failed` — are removed: no production code path ever assigned them (the only writes were `'draft'` at case creation and `'decided'` on approval), and `product.md`'s lifecycle language is now task-shaped (Find/Shortlist/Compare/Review/Decide) rather than status-badge-driven.

**`CaseNote` (change-set §28/§51) is implemented.** `CaseNoteSchema` (`packages/contracts/src/case.ts`) is `{ id, body, kind: 'observation' | 'research' | 'question' | 'preference' | 'reminder', origin: 'user' | 'agent_proposed', authoredBy, optionIds: string[], obligationId?, sourceIds: string[], createdAt }` — a real, first-class, event-sourced record (`note.added`, `events.ts`) that is deliberately outside the evidence pipeline. `origin`/`authoredBy` reuse `CaseAttributeDefinition`'s origin vocabulary (`CASE_ATTRIBUTE_ORIGINS`) rather than the broader `ATTRIBUTE_ORIGINS` — a pack never writes a note. **A note never automatically becomes evidence, by construction, not by convention:** `CommandService.addNote` appends only the `note.added` event and has no code path that reads or writes any obligation, evidence link, case extension, or recommendation — adding one can never satisfy an obligation, change readiness, or invalidate a `ready` recommendation. Unlike `sources`/`view`/the selection ids (below), a note flows through `append()`, not `updateSelection()`: it is a real domain event, not a presentation-only escape-hatch field. A human may later act on what a note says by submitting real evidence (`submitSource`, a separate, explicit command); nothing about `CaseNote` itself can silently become evidence.

`view` (`WorkspaceViewState`, defined in `docs/decisions/0005-workspace-view-state-and-option-views.md`) carries the shared, model-writable workspace view state — mode (`quick_pick | list | compare | board`), focused option/evidence/question, visible/pinned option and attribute selections, sort, filters, and per-view configuration such as Compare's candidate set or Board's columns. The field exists in `CaseStateSchema`, and its durable write path is implemented: `SelectionPatch` carries a `view` field, and `CommandService.setView` (`apps/agent/src/services/command-service.ts`) routes it through `updateSelection()` — never `append()` — so a view change persists across reload and structurally cannot advance `eventSequence` or invalidate a recommendation (proven by a store-contract test that appends a ready recommendation first, then asserts both are byte-identical after the view patch). The primary workspace view switcher (`WorkspaceViewSwitcher`) reads and drives this state today, and every PRESENTATION-class WebMCP tool (`sift_set_view`, `sift_configure_comparison`, `sift_focus_question`) reaches this same durable command — none of them hold view state only in browser-session memory; see `webmcp.md`'s per-tool "Effect" statements for the exact per-tool contract.

Pack-defined attributes and case-defined `custom.*` attributes use the shared `AttributeValue` discriminated union in `pack-authoring.md`. The pack provides common typed defaults; the case may persist new typed definitions, criteria, and derived obligations when the compiled extension policy permits them. Required pack obligations and protected criteria remain immutable.

All timestamps in deterministic tests come from an injected `Clock`. IDs come from an injected `IdGenerator`.

## Command and event flow

1. A UI action or WebMCP callback sends a validated command with an idempotency key and client-generated `commandId`.
2. The service loads the latest case and checks the expected `eventSequence`.
3. The command handler emits one or more domain events.
4. Events append and the derived snapshot updates atomically in SQLite.
5. The service returns a `CommandReceipt` promptly and publishes committed events to subscribers. Run-starting commands include `runId`; the UI never invents progress while waiting.
6. A run command selects the next obligation and passes a read-only snapshot to the Strands adapter.
7. Runtime activity events stream immediately; validated evidence events update canonical state and emit their resulting snapshot sequence.
8. Readiness is recomputed after every evidence, uncertainty, or policy event.

Commands use optimistic concurrency. A stale `eventSequence` produces HTTP `409` with the latest snapshot; clients refresh rather than replaying an unexamined mutation.

#### Bystander events and sequence-independent commands

`expectedSequence` exists to refuse a mutation "written against a stale view" (`webmcp.md`, "Cancellation and concurrency"). Case-wide equality is a proxy for that question, and it is not a perfect one: it cannot tell a competing **write** apart from a **bystander** event that merely moved the case's counter. Since the runtime streams a run's events as the graph progresses, an ordinary investigation advances the sequence steadily for seconds at a time, and a person acting during that window was being refused for work they were only watching.

No client can close that window. The SSE activity stream carries its own separate counter (`activity_events.sequence` is unrelated to `case_events.sequence`), so a browser must re-read the canonical snapshot to learn the case sequence at all, and the run can append again between that read and the request landing. `apps/web`'s `useCaseEvents().resolveEventSequence()` performs exactly that read in the window where the client knows it is behind, which removes the great majority of these refusals; the remainder is structural.

So a small, explicitly enumerated set of commands is **sequence-independent**: their effect depends on no case state a bystander event could change, so a caller that is *behind* is accepted and the append is anchored to the case's current sequence. A caller that is *ahead* — a sequence the case has never reached — is still refused, and `CaseStore.append()` still performs its own atomic check inside the transaction, so a genuine interleave is still refused.

Two commands qualify today (`CommandService.loadForIndependentMutation`, which carries the per-command justification):

- **`addNote`** — a note satisfies no obligation, links to no evidence, and never invalidates a recommendation, so no event can make the note someone just wrote the wrong note. Its only case references (`optionIds`, `obligationId`) are validated against the current snapshot.
- **`setCandidateDisposition`** — carries the complete desired value of one candidate's own disposition rather than a delta, is last-writer-wins per candidate by construction (undo is the forward command `unreviewed`), and derives `previousDisposition` from the current snapshot, so a behind caller produces a *more* accurate record than a stale read would.

Every other command keeps strict equality. This is an opt-in, not a relaxed default: a command that reads the case to decide what to write — `reviewProposal`, `setEvidenceDisposition`, `updateCriteria`, `upsertOption`, `setOptionAttribute`, `defineCaseAttribute` — does not qualify.

#### Per-case run serialization

**Specified, not yet implemented** (docs/decisions/0015-standing-watch-and-background-triggers.md, "Prerequisites"). `RunService.requestInvestigation` (`apps/agent/src/services/run-service.ts`) already starts an engine detached from the HTTP request it accepted — `void runInSpanScope(runId, () => this.deps.engines?.[snapshot.pack.id]?.trigger(...))` — and nothing today prevents two such runs on the same case interleaving, because every existing caller has been a single person clicking one control at a time. That stops being true the moment anything other than a click can start a run: a watch-initiated background run racing a person's own click on the same case is the first genuinely new failure mode Standing Watch introduces, and it must be closed before that feature ships, not discovered from it.

The required shape is a per-case queue — at most one active run per case, later requests for the same case wait or are rejected with a reason rather than interleaving — with a global concurrency cap bounding total background work across every case at once (a household's five open jobs, each with watches, must not be able to saturate the process). This is scheduling discipline over the existing `InvestigationEngine.trigger` call, not a new execution engine; a queued-but-not-yet-started run is exactly the `run.queued` activity phase this contract already has a name for.

### Two persistence paths: `append()` versus `updateSelection()`

Sift has exactly two ways to durably change a case, and which one a command handler calls is what makes change-set §54's rule ("presentation filtering ≠ criterion mutation") true by construction rather than by convention (ADR 0005 decision 1):

- **`append()`** is the sole write path for canonical decision events. It appends one or more rows to `case_events`, advances `eventSequence`, runs the event through `applyCaseEvent`, and is the only path any recommendation-staleness or readiness-invalidation logic is wired to observe. Every command in `SiftCommands` other than `focusOption`/`focusEvidence` calls `append()`.
- **`updateSelection()`** (backed by a `SelectionPatch`) is a deliberate, separately-documented escape hatch for `CaseState` fields no `CaseEvent` variant ever touches: `selectedOptionId`, `selectedEvidenceId`, `activeFocus`, `sources`, and `view`. It patches the field(s) directly and persists the resulting snapshot, but it does **not** append a `case_events` row and does **not** advance `eventSequence`; there is no domain event to record. It still honors the same optimistic-concurrency (`expectedSequence`) and idempotency-key deduplication `append()` uses, sharing the same `idempotency_keys` table, so a retried WebMCP presentation call is still safe under duplicate delivery.

The consequence is structural, not conventional: a change routed through `updateSelection()` cannot reach recommendation-invalidation logic, because that code path is never invoked for a selection-only patch. This is why `focusOption`/`focusEvidence` today — and the `setView` command backing `WorkspaceViewState` writes — can be called freely and repeatedly without human confirmation, unlike `sift_update_criteria` or `sift_submit_source`: it is not possible for a presentation-only call to silently become a decision mutation, regardless of how a tool description is worded. Every PRESENTATION-class WebMCP tool (`sift_set_view`, `sift_configure_comparison`, `sift_focus_question`) reaches `setView`; see `webmcp.md` for the exact per-tool contract.

`focusOption`/`focusEvidence` are pure attention-cursor changes with no decision-relevant effect ("visible selection state only... does not change ranking or evidence" per `webmcp.md`), and a submitted source's own record is distinct from any `evidence.accepted` event its content may separately produce. This means a case reconstructed purely by replaying `case_events` from empty will not recover selection/focus/view state or raw submitted-source records — acceptable because normal reads (`GET /api/cases/:caseId`, `sift_get_case_context`) always serve the persisted snapshot, never a from-scratch replay, and no required demo assertion depends on these fields surviving a pure event-log reconstruction. Do not extend this exception to any field that affects evidence, readiness, or the recommendation.

## Real-time event contract

The normal workspace and Runtime Inspector are live projections of persisted or normalized events, not simulated loading copy.

```ts
interface PublicActivityEvent {
  schemaVersion: '1.0'
  eventId: string
  sequence: number
  timestamp: string
  caseId: string
  commandId?: string
  runId?: string
  obligationId?: string
  agentId?: string
  type:
    | 'command.accepted'
    | 'run.queued'
    | 'run.started'
    | 'run.completed'
    | 'run.failed'
    | 'specialist.started'
    | 'specialist.completed'
    | 'skill.activated'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'intervention.guided'
    | 'intervention.confirmation_required'
    | 'evidence.accepted'
    | 'evidence.conflicted'
    | 'obligation.updated'
    | 'recommendation.invalidated'
    | 'recommendation.ready'
    | 'draft.withheld'
    | 'case.snapshot'
  phase: 'queued' | 'active' | 'waiting' | 'completed' | 'failed'
  summary: string
  safeDetails?: Record<string, JsonValue>
  debugEventId?: string
}
```

Rules:

- The main case stream replays from `Last-Event-ID`; duplicate event IDs are ignored client-side.
- Event sequence is monotonic within the case. Run debug sequence remains monotonic within the run and is correlated by IDs.
- On disconnect, the UI preserves the last valid snapshot, shows reconnect state, fetches the latest snapshot, and resumes from the last received event.
- Polling fallback retrieves snapshot plus events after the last sequence; it must produce the same visible state as SSE.
- Public summaries describe actions and evidence without chain-of-thought. Model text may stream only as explicitly labeled draft/final prose; hidden reasoning never streams.
- The Runtime Inspector opens its detailed SSE connection only while visible. The normal workspace always receives the smaller public activity stream.
- Slow-consumer buffering is bounded. When replay is no longer available, the service emits a resync instruction and the client reloads the canonical snapshot.

## Adaptive discovery

Recorded in full as [ADR 0009](../decisions/0009-adaptive-decision-experience.md).

### Discovery is canonical case state

`CaseState.discovery` holds a `DiscoveryState`: the topics this case has
covered, the blind-spot review, the Quick Pick dispositions, and any bounded
interaction currently on screen. It changes only through `CaseEvent`s —
`discovery.topic_updated`, `discovery.interaction_requested`,
`discovery.interaction_answered`, `discovery.blind_spot_reviewed`, and
`candidate.disposition_set` — so the pane's coverage indicator, ChatGPT's
next-turn readback, and the persona harness's turn diff are three views of
one record rather than three copies that can disagree.

The field is optional, and a case carries no `discovery` key until something
actually happens in discovery. An absent key reads as "this case has not
started discovery", which is true.

### Ownership

| Actor | May write | May never write |
| --- | --- | --- |
| Person | Any topic status, any importance tier, any Quick Pick disposition, blind-spot completion, shortlist confirmation | — |
| Model | `inferred_pending` topic values only, and bounded interaction requests | `confirmed`, `must_work`, any disposition, blind-spot completion, shortlist confirmation |
| Core | Derived coverage, readiness, next moves, required view | Anything a person owns |
| Pack | Topic templates, option seeds, interaction grammar, blind-spot prompts | Any case-specific value |

The model's half of that table is enforced twice. Four rules are structural
(see `packages/contracts/src/discovery.ts`) — an illegal state has no
representation. Three more depend on current state and so live in
`packages/core/src/discovery.ts`'s `planDiscoveryResponse`, which rejects a
mapping onto a topic the pack does not declare, one that does not apply to
this case, and one a person has already confirmed.

### Derivation is pure

```ts
compileDiscoveryTopics(caseState, pack): DiscoveryTopicState[];
deriveDiscoveryReadiness(caseState, pack): DiscoveryReadiness;
deriveNextMoves(caseState, pack): NextMove[];
planDiscoveryResponse(caseState, response, actor, pack, now): DiscoveryResponsePlan;
```

None of these read a clock, a random source, or a model. Identical state
always produces identical readiness, allowed moves, and required pane view,
which is what makes reload restore a person's exact place rather than an
approximation of it.

`deriveNextMoves` returns a strict cascade — confirm what is pending, finish
required discovery, check blind spots, discover, triage, compare, decide —
because each stage's output is the next stage's input. Two ordering rules are
deliberate and load-bearing:

- **A pending inference outranks every new question.** Moving on while an
  unconfirmed reading sits on the case is how an inference hardens into a
  fact, and the person never gets the moment where they would have said
  "that is not what I meant".
- **The blind-spot review outranks a remaining optional question**, because
  it is the one thing still standing between the person and discovery.

### Coverage

`DiscoveryCoverage` carries counts only — no stored ratio. A percentage
persisted beside its own numerator and denominator is a third fact that can
disagree with the other two; the pane derives it.

A required topic is *resolved* when it is `confirmed` or `not_applicable`.
`deferred` is not an answer, and `inferred_pending` is never resolved
whatever its confidence.

## Companion frame

The narrow pane's persistent frame is two components either side of one
dominant artifact:

- `DecisionOrientationShell` (top): decision, pack, phase in a person's
  words, coverage counts with a bar computed from them, current focus,
  latest change, next step, route to the outcome, and a provisional marker.
- `ContextActionDock` (bottom): at most two actions, taken from
  `deriveNextMoves`. A human-only move is visibly marked, because
  `NextMove`'s structural guarantee that it carries no `toolName` is
  invisible to the person using the product.

Neither is `position: fixed`, and the dock is no longer `position: sticky`
either. The case workspace is a fixed-height pane shell: the root is exactly
`100dvh`, a flex column that does not itself scroll; `WorkspaceAppBar` and
`ContextActionDock` are non-shrinking bands at the two edges; and one
`overflow-y: auto` region between them is the only thing that scrolls.
`DecisionOrientationShell` stays `sticky top-0` and now pins against that
region. Both bands carry safe-area padding.

Only the shell's compact row (phase · coverage · next step, and the
disclosure trigger it doubles as) is that sticky element. Its two
qualification lines — the answer is provisional, and a concern the person
raised has nothing Sift can check — plus the expanded detail render
immediately beneath it in normal flow: unconditionally visible, in the same
reading order, behind no control, but scrolling with the content they
qualify instead of holding 133.56px (183.94px expanded) of a 390px pane for
the whole session. Pinned chrome measures 72px in both states after the
split. `case-workspace-scroll`'s `scroll-padding-top` is measured from that
sticky element alone, so a `scrollIntoView({block: 'start'})` still lands
clear of it (`assertScrollIntoViewClearsStickyChrome`).

This replaces an earlier rule — "both use `position: sticky`, not `fixed`,
because Sift renders inside an iframe in the companion case and a `fixed`
element positions against the iframe viewport" — whose premise was measured
and found false. In the real ChatGPT pane Sift is a top-level document
(`window.self === window.top`), and no ancestor of the dock sets
`transform`/`filter`/`perspective`/`will-change`/`contain`/`backdrop-filter`,
so nothing establishes a containing block that would trap a fixed child. The
rule also did not do what it claimed: the dock was `sticky bottom-0` as the
last child of the scrolling document, where a sticky box has nothing below it
to be held against, so it never pinned — a person met it only at the very
bottom of the scroll.

The shell is the fix rather than a switch to `fixed`, and deliberately so: no
bottom-padding arithmetic is needed to keep the dock off the last row of
content, browser scroll anchoring keeps working inside the scrolling region,
and the layout behaves identically if Sift ever genuinely is embedded in an
iframe. The premise stops mattering instead of being replaced by a different
one.


## The continuous RunPlan

A `RunPlan` (`apps/agent/src/runtime/run-plan.ts`) is what Sift intends to do about a case right now, why, and what it deliberately is not doing. It is **derived, never authored**: `buildRunPlan` is a pure function of (case state, compiled pack, budgets), so the same case always produces the same plan and a plan can be recomputed from a reloaded snapshot rather than restored from an in-memory queue.

### Item kinds and depth

| Kind | Depth | Writes | Available |
| --- | --- | --- | --- |
| `enrich_candidate` | `shallow` | `enrichment` | As soon as candidates exist, before any triage |
| `check_concern` | `deep` | `evidence` | Only for a candidate a person marked `keep` or `unsure` |

Shallow work is a catalog read: it costs nothing a person would object to and writes nothing they own, so it runs while discovery is still settling. Deep work is aimed only at options a person has actually kept.

### Rules the schema makes unrepresentable

- A `deep` item must carry a `triageBasis`, and `TriageBasis.disposition` is `'keep' | 'unsure'`. `pass` and `unreviewed` are real dispositions and neither is an authorization, so there is no value expressing "deep work authorized by a candidate nobody reviewed."
- `RunPlanItem.writes` is `'evidence' | 'enrichment' | 'none'`. Discovery answers, dispositions, the shortlist, and the decision are not members of the union, so runtime work cannot declare it will write them.
- A concern with no matching capability in `pack.resolvedCapabilities.specialistIds` is recorded in `plan.unverifiable` with a reason. It never becomes an item.

### Revision

`reviseRunPlan(previous, ctx, cause)` re-derives and diffs. An item is **reused** when its signature and `inputsHash` are unchanged and it was accepted; **staled** (re-planned, its accepted result discarded) when the hash changed; **cancelled** when the current state no longer justifies it.

`inputsHash` covers exactly the state a result depended on:

- `enrich_candidate` — the candidate and the pinned pack.
- `check_concern` — the concern, the candidate, and the confirmed answers to the pack topics whose `mapsToCriterionIds` include that concern.

That asymmetry is the product's central claim in one line: adding a concern reuses every earlier result, while changing an answer re-runs only the checks that answer feeds.

The cause is supplied by the command that changed the case (`setCandidateDisposition` → `triage_changed`, `updateDiscovery` → `discovery_changed`), never reconstructed by diffing. A revision that adds, stales, and cancels nothing mints no version at all.

`RUN_PLAN_ITEM_STATUSES` has no `stale` member: staleness is a transition recorded in `revision.staledSignatures`, not a resting state, so `items` never holds two entries claiming the same work.

### Surfaces

- `GET /api/cases/:caseId/run-plan` → `{ plan, history }`. History is returned with the current plan because the two are only meaningful together.
- `plan.created` and `plan.revised` are public activity events. The `plan.revised` summary names the trigger and what was reused; its `safeDetails` carry `reused`/`added`/`rerun`/`cancelled` counts so a consumer renders them without re-deriving.

## Standing Watch scheduler

**Specified, not yet implemented.** Full rationale in docs/decisions/0015-standing-watch-and-background-triggers.md; this section is the architecture-level contract that decision commits to.

A case's `bid-comparison` pack (only that pack — see ADR 0015's "Pack scope") may declare `watches[]` (`packs-and-routing.md`). Once a case exists, the scheduler is what keeps evaluating those declarations after the case's first recommendation, without a person clicking anything. It runs **in-process with Express**, not as a separate worker or queue service — a second deployable is unjustified operational surface for a hackathon build, and Railway's single-writable-replica constraint (below) already means there is exactly one process that could run it.

All of its state is rows, never in-memory timers:

- **`watches`** — one row per case × declared watch id, carrying the watch's cursor into its feed, `lastCheckedAt`, `lastFiredAt`, and status (`active | suppressed | disabled`). This is the durable form of "what is this case watching, and how far did it get."
- **`pending_interrupts`** — one row per unresolved `HumanInTheLoop` background confirmation (docs/decisions/0015 Decision 1): run id, watch id, tool name, reason, `createdAt`, nullable `resolvedAt`/`response`. This is what lets the case workspace answer "is something waiting on me" without decoding a Strands session snapshot.
- **`read_markers`** — one row per case (`lastSeenActivitySequence`, `updatedAt`). This product has no accounts or multi-user collaboration (`product.md`, "Explicit scope cuts"), so a read marker is per-case, not per-case-per-viewer.

On boot, the scheduler rehydrates every `active` `watches` row and resumes ticking; a Railway restart or an AgentCore Runtime idle timeout is therefore not a special case the scheduler has to detect, only an ordinary boot.

**One dispatcher, three trigger kinds** (`packs-and-routing.md` names the exact declaration shape):

| Kind | Arrives by | Dispatcher behavior |
| --- | --- | --- |
| `push` | A feed event | Notified by a listener; does not poll |
| `time` | A stored deadline passing | A tick compares the deadline to the injected `Clock` |
| `query` | Nothing pushes; must be asked | A tick polls the declared feed on the watch's interval |

Every tick — of any kind — is **idempotent, keyed by (watchId, cursor)**. A tick reads its feed for entries after the row's current `cursor`; any resulting `CaseEvent`/activity-event writes and the cursor's advance commit in one transaction, the same append-and-advance-atomically discipline every other command in this document already follows. A crash before that commit leaves the cursor unmoved, so the next tick safely reprocesses the same window through the existing `idempotency_keys` machinery; a crash after it leaves the cursor already advanced, so the next tick correctly finds nothing new. "The service restarted mid-tick" and "the service ticked twice and found nothing" are indistinguishable from outside — which is what makes a double tick after a restart harmless rather than merely unlikely.

A predicate evaluating true is a deterministic, core-owned fact (`packs-and-routing.md`'s `WatchDeclaration.predicate`) and produces `watch.fired`. Whether the change is *material* is a separate, model-owned triage step (docs/decisions/0015 Decision 5), bounded by a tightened `BudgetGuard`, that runs only after a trigger has genuinely fired — never on every tick, and never as a substitute for the deterministic predicate.

## Persistence

SQLite is the canonical local and Railway store. The implementation uses `better-sqlite3`, Drizzle migrations, foreign keys, WAL mode, and a bounded busy timeout. It runs as one writable Railway application replica for the hackathon.

Required tables:

```text
cases               latest derived snapshot and pinned pack ID/version/hash
case_events         append-only canonical domain events
activity_events     append-only sanitized public case stream with per-case sequence
runs                 execution status, focus, bounds, trace/session IDs
idempotency_keys     command result deduplication
runtime_events       sanitized hooks, spans, logs, diffs, and errors
run_plans            one row per RunPlan version, keyed (plan_id, version)
watches              specified, not yet implemented (ADR 0015): per-case watch registration, feed cursor, lastCheckedAt/lastFiredAt, status
pending_interrupts   specified, not yet implemented (ADR 0015): unresolved background HumanInTheLoop confirmations
read_markers         specified, not yet implemented (ADR 0015): one row per case, lastSeenActivitySequence
schema_migrations    applied migration ledger
```

`watches`, `pending_interrupts`, and `read_markers` are named here as the tables docs/decisions/0015-standing-watch-and-background-triggers.md commits to; none exist in the current schema. They are ordinary migrated tables, not a new persistence technology — see "Standing Watch scheduler" above for what each row means and why ticks against them are idempotent.

`run_plans` keeps every version rather than overwriting the current one: the plan's claim is historical ("a new concern revised work already under way, and here is what was reused"), and a table holding only the latest plan could state that but never show it. Re-saving an existing `(plan_id, version)` is rejected. The store's one mutation, `updateItemStatuses`, can reach nothing but an item's `status`/`updatedAt`, so what a version intended cannot be rewritten.

Case-event append and snapshot replacement occur in one transaction. `(case_id, sequence)` and idempotency keys are unique. `activity_events` gives the normal UI one replayable public sequence across commands and runs; it is derived from committed domain or normalized runtime activity and cannot mutate the case. Detailed runtime telemetry is operational evidence and also cannot directly mutate canonical case state.

Local storage defaults to `.sift-data/sift.sqlite`. Railway uses `/data/sift.sqlite` on a persistent volume. Local Strands session files live under `.sift-data/strands-sessions`; Railway uses `/data/strands-sessions`. AgentCore may use S3 session storage, but canonical case writes return through the Railway service.

### Legacy database adoption on boot

Sift was called Pax until 2026-08-30, and the deployed Railway service holds a real, populated database at the pre-rename path (`/data/pax.sqlite`) on its persistent volume. Renaming the canonical filename without a migration step would silently open a fresh, empty `sift.sqlite` beside the untouched legacy file — the deployment would appear to have lost every case, rather than failing loudly, which is exactly the failure mode `docs/audits/2026-08-30-generic-decision-workspace-audit.md` §8 (the rename blast-radius audit) warns must be handled deliberately and verified against the live deployment, not assumed. This is implemented, not merely specified: on every boot, before opening the canonical database file, the service checks for an existing `sift.sqlite`; if one exists it is used unconditionally. Only when no `sift.sqlite` exists yet and a legacy `pax.sqlite` is present does adoption run: the legacy file is opened, its WAL is checkpointed (`wal_checkpoint(TRUNCATE)`) so no recently committed pages are stranded in a `pax.sqlite-wal` sidecar the renamed file would never be opened with, and it is then renamed in place to `sift.sqlite`. A stale legacy file found beside an already-adopted `sift.sqlite` is left on disk untouched rather than deleted — destroying data on the basis of a filename guess is not this step's call to make. Adoption is idempotent: it is a no-op on a fresh checkout with neither file, and a no-op on every boot after the first successful adoption.

Scenario and release commands export normalized JSONL event/trace bundles from SQLite into `artifacts/verification/`. JSONL is not the runtime source of truth.

## Deployment

The first public deployment is a newly created Railway project and one Railway service. Express serves the Vite production build and the Sift API from the same origin. This minimizes CORS, configuration, and demo failure risk and uses a Railway volume mounted at `/data` for SQLite and local Strands sessions.

The AWS submission adds an AgentCore execution target without changing the browser contract:

```text
ChatGPT right pane -> Railway web/API gateway -> local Strands adapter or AgentCore runtime
```

- `SIFT_EXECUTION_TARGET=local|agentcore` selects execution. `local` is the development and deterministic-demo default.
- The AgentCore Strands image listens on port `8080` and implements `/ping` and `/invocations`.
- Railway remains the public WebMCP origin and proxies execution to AgentCore when configured.
- `SIFT_DATA_DIR` defaults to `.sift-data` locally and `/data` on Railway.
- `SIFT_AUTHORING_ENABLED` defaults to `false`. Local `pack:author` commands enable it explicitly with a bounded draft root; the public hackathon service keeps it false and exposes no writable authoring route.
- Deployed browser requests remain same-origin. If a separate origin is introduced, CORS allows only `SIFT_PUBLIC_ORIGIN`.
- Missing AWS credentials must not prevent the complete local deterministic demo and release suite. They may block only opt-in live deployment verification and must be reported honestly.
- Railway authentication is available. The autonomous build must create a fresh project/service, deploy, generate a public domain, attach `/data`, set production variables, run migrations, and verify persistence across restart rather than merely writing deployment instructions.

## Security and authority

- Fixture tools are read-only except canonical Sift commands.
- Agents never receive filesystem, shell, email, purchase, booking, or arbitrary HTTP tools.
- The developer-mode `pack-author` agent receives only draft-root-confined authoring tools, never arbitrary shell or filesystem access. Pack source is declarative and cannot carry executable adapters.
- Pack manifests declare tools, effects, extension policy, and approval posture; the runtime validates the declaration against a compiled registry.
- A model cannot add a tool by naming it in output.
- Case extensions may add typed data and questions but cannot add executable capabilities, remove required obligations, or weaken policies.
- `reviewProposal` rejects requests whose `actor` is not `human`.
- A recommendation and an approved decision are distinct states.
- Tool inputs, outputs, model responses, and persisted snapshots are size-bounded and schema-validated.
- Browser content is treated as untrusted input. Tool descriptions and model prompts instruct the runtime to ignore instructions embedded in source documents.
- Logs omit credentials and raw private reasoning. Demo fixtures contain no personal information.

## Reuse boundary

Sift may adapt styling and small presentational structures from Strata19's readiness, approval, engine-progress, activity, and source cards. It must not import Praetor packages by filesystem path or reproduce the full Strata19 workspace shell.

Sift may adapt Murmur's pack manifest, entity relationships, proposal semantics, and decision-stage concepts. It must not depend on Murmur's Prisma database, Mastra runtime, authentication, React Native UI, or APIs.
