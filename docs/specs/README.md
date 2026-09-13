# Sift Hackathon Specification Set

Status: approved implementation baseline  
Date: 2026-08-26  
Target events: OpenAI WebMCP Challenge and AWS Agents for Humans Hackathon

Sift is a supervised adaptive decision workspace. A person and an agent work in the same browser-visible case, while a bounded Strands runtime investigates unresolved obligations, changes techniques when evidence warrants it, and pauses whenever human authority is required.

This directory is the canonical product and engineering specification for the hackathon build. Implementers must read this file and every linked specification before changing product code.

Accepted cross-cutting rationale is recorded in [ADR 0001](../decisions/0001-hackathon-runtime-storage-and-heroes.md) (runtime, storage, and hero selection), [ADR 0002](../decisions/0002-answer-first-workspace-layout.md) (answer-first layout), [ADR 0003](../decisions/0003-vehicle-catalog-and-normal-case-creation.md) (vehicle catalog and normal case creation), [ADR 0004](../decisions/0004-consumer-workspace-information-architecture.md) (consumer workspace information architecture and the consumer/developer projection boundary), [ADR 0005](../decisions/0005-workspace-view-state-and-option-views.md) (`WorkspaceViewState` and the four generic option views), and [ADR 0006](../decisions/0006-webmcp-two-way-collaboration-contract.md) (the WebMCP read/write/presentation/execution authority split).

Every planned Praetor, Strata19, and Think OS adaptation is tracked in the [source reuse map](../reuse-source-map.md), including canonical source, intended Sift destination, reuse posture, and attribution requirements.

Current competition requirements and Sift-specific draft material live in [the submission packet index](../submissions/README.md). These packets are preparation artifacts only and must be refreshed against Devpost before final submission.

## Specification map

1. [Product and scope](./product.md) — audience, experience, scope cuts, success criteria, and UI.
2. [System architecture](./architecture.md) — runtime boundaries, code layout, persistence, deployment, and security.
3. [Decision Packs and routing](./packs-and-routing.md) — the pack schema, deterministic routing envelope, obligations, and the two hero packs.
4. [WebMCP contract](./webmcp.md) — browser tools, shared command behavior, dynamic registration, and cancellation.
5. [Strands runtime](./strands-runtime.md) — agents, skills, graphs, interventions, state, and evidence production.
6. [Debugging and observability](./debugging-and-observability.md) — Runtime Inspector, Strands/OpenTelemetry correlation, redaction, retention, and trace export.
7. [Testing and self-healing](./testing.md) — automated verification, scenario DSL, trace assertions, release gates, and Claude repair protocol.
8. [Demos and submission](./demos-and-submission.md) — fixture-backed demo scripts, video beats, and submission readiness.
9. [Why Sift instead of a direct model answer](./value-proposition.md) — product moat, limits of one-shot model use, and the observable proof required in each demo.
10. [Decision Pack authoring and adaptability](./pack-authoring.md) — canonical vocabulary, extensible case data, the pack compiler, authoring skill, and conformance contract.

## Binding product decisions

- The implementation is a new TypeScript project in this repository. It selectively reuses concepts and small visual primitives from Praetor and Think OS; it does not fork either application.
- The human-facing and code-facing term is **Decision Pack**, shortened to **Pack** when unambiguous. `DecisionPackManifest` is authorable source; `CompiledDecisionPack` is the installed runtime artifact.
- A **Case** is one durable instance of a problem. It is pinned to one pack ID, version, and compiled hash.
- One generic deterministic engine manages obligations and readiness. Strands supplies adaptive reasoning and execution inside the engine's boundaries.
- Sift is a **generic AI-assisted decision workspace**, not a car-shopping product with an engine underneath. A person and ChatGPT collaboratively discover options, define what matters, research them, add previously-unanticipated comparison dimensions, manipulate how the decision is visualized, resolve unknowns, and ultimately reach a human-controlled decision — `product.md`'s consumer mental model (Decision Profile, Options, Research, Notes, Questions, Recommendation, Decision) applies to any comparison-shaped decision, not only vehicle purchase.
- The three supported demos are **Choose Our Next Car**, **Bid Comparison**, and **Home Energy Guardian** — polished implementations of the generic workspace, not the boundary of what the architecture supports. Later packs (laptops, apartments, and similar shopping/selection decisions) are explicitly not precluded by this build even though none ship in it.
- Choose Our Next Car is the WebMCP-first submission demo. Bid Comparison is the AWS/Strands-first submission demo and the Agents for Humans hero as of 2026-09-07 (see [ADR 0017](../decisions/0017-bid-comparison-professional-agents-hero.md), which supersedes ADR 0001's original hero choice). Home Energy Guardian remains a second, fully implemented and tested bounded-Swarm demo but is no longer the submission hero. The current heroes share one engine but have deliberately different interaction models and video narratives — they are not redesigned to converge on one shape (`docs/decisions/0004-consumer-workspace-information-architecture.md` through `0006-webmcp-two-way-collaboration-contract.md`).
- SQLite is the canonical Sift data store. JSONL is an exported verification format, not primary persistence.
- A first-class Runtime Inspector exposes correlated, sanitized agent and domain telemetry inside the application.
- Automatic multi-pack composition, runtime self-modifying packs, authentication, billing, collaboration, a graphical Pack Studio, and a general-purpose entity editor are excluded from the hackathon build. A bounded local `pack-authoring` skill and CLI are included so people can draft, validate, test, and explicitly publish their own declarative packs.
- Pack schemas provide common defaults without closing the case data model. Users can add typed case-specific criteria, attributes, and questions; the engine preserves their origin, evidence expectations, and invalidation effects.
- The UI is event-driven from the first implementation milestone. Accepted commands return run correlation immediately, and truthful case/runtime events update the visible right-pane experience throughout execution.
- The website is the primary product. ChatGPT is the conversational collaborator through its WebMCP-capable in-app browser.
- Final consequential decisions are made through an explicit human action in the Sift UI. Agents may investigate, guide, and propose; they may not approve their own proposals.
- Every demo beat must be represented by an automated scenario assertion. A passing unit suite alone is not release evidence.

## Requirement identifiers

All implementation tasks and automated scenarios must cite one or more requirement IDs.

| ID | Requirement |
| --- | --- |
| PAX-P01 | A user can create or open a case and see its selected Decision Pack, readiness, evidence, activity, recommendation, and pending human action. |
| PAX-P02 | The same application command is used for human UI actions and WebMCP tool invocations. |
| PAX-P03 | Pack routing is explainable, constrained to registered versions, and user-overridable. |
| PAX-P04 | A case remains pinned to its selected pack ID, version, and compiled hash; changing packs after evidence exists requires a new case. |
| PAX-P05 | The engine selects one unresolved obligation at a time using deterministic priority inputs. |
| PAX-P06 | Strands dynamically activates relevant skills and specialists for the current obligation. |
| PAX-P07 | Interventions can proceed, guide, confirm, or deny execution and must emit visible audit events. |
| PAX-P08 | Claims are source-linked; stale, failed, or degraded evidence cannot silently satisfy an obligation. |
| PAX-P09 | A recommendation cannot become ready until every required obligation meets its evidence rule or records accepted uncertainty. |
| PAX-P10 | The system may propose a recommendation but cannot approve a consequential decision on the user's behalf. |
| PAX-P11 | Both demo scenarios run deterministically from checked-in fixtures without external network access. |
| PAX-P12 | An opt-in live suite verifies the configured Bedrock model and deployed runtime without replacing deterministic release tests. |
| PAX-P13 | The complete verification gate emits machine-readable evidence suitable for an automated repair loop. |
| PAX-P14 | The project deploys as a public web application plus a TypeScript Strands service compatible with Amazon Bedrock AgentCore Runtime. |
| PAX-P15 | The repository contains the license, README, architecture diagram source, setup instructions, demo instructions, and submission copy required by both events. |
| PAX-P16 | The canonical UI works at a 390–480 px ChatGPT right-pane width without horizontal scrolling, obscured controls, clipped status, or reliance on a full-page layout. |
| PAX-P17 | The Energy demo visibly and truthfully exercises Strands AgentSkills, Swarm handoffs, steering interventions, context injection, GoalLoop validation, streaming events, and session/snapshot recovery. |
| PAX-P18 | The car-buying demo visibly exercises dynamic WebMCP registration, current-option context, shared UI/tool commands, recommendation invalidation, and human-only shortlist approval. |
| PAX-P19 | At least one plausible premature model conclusion is rejected by deterministic readiness or output validation, followed by an observable corrective trajectory and a source-linked result. |
| PAX-P20 | The Runtime Inspector exposes chronological and correlated case events, Strands hooks, OpenTelemetry spans, Graph/Swarm transitions, skills, interventions, model/tool metadata, state diffs, sessions, errors, token usage, and latency. |
| PAX-P21 | Debug telemetry is structured, filterable, streamable, exportable, trace-correlated, retention-bounded, and sanitized; it never exposes credentials or private chain-of-thought. |
| PAX-P22 | The canonical store is migrated SQLite on a Railway `/data` volume, with transactional case events/snapshots, replayable public activity, runs, idempotency, and runtime telemetry; the deployed service proves persistence across restart. |
| PAX-P23 | The autonomous build creates a new Railway project and service through the authenticated CLI, provisions storage and variables, deploys, creates a public domain, and runs deployed smoke and Playwright verification. |
| PAX-P24 | The normal workspace is a truthful real-time experience: commands return correlation receipts, ordered SSE events render intermediate agent/tool/skill/steering/evidence states, reconnect uses `Last-Event-ID`, and polling preserves the last valid state as a fallback. |
| PAX-P25 | Packs define strongly validated defaults while cases accept typed user-defined criteria, attributes, and evidence questions without changing the installed pack; extensions preserve origin, provenance, uncertainty, and dependency invalidation. |
| PAX-P26 | A real `pack-authoring` Strands skill plus bounded authoring tools can draft, validate, test, diff, and request human publication of a non-executable Decision Pack; the unauthenticated public deployment keeps authoring disabled. |
| PAX-P27 | Runtime agents may adapt a case-specific run plan only within the compiled pack's skills, specialists, tools, orchestration bounds, evidence rules, and human-authority policies. |
| PAX-P28 | A user can browse a bundled, offline vehicle catalog, build a 2-5 vehicle shortlist, and start a real, persisted `car-purchase` case from it (`startCase` + `upsertOption`) using the exact same commands visible controls and WebMCP callbacks already share; catalog facts, listing/dealer facts, and case data remain distinct fact classes, and a catalog-built case that cannot run guided investigation fails that specific request honestly rather than fabricating a result. |

## Precedence

If specifications disagree, the narrower specification governs its named subsystem. This index governs cross-cutting product decisions. Tests may clarify a requirement but may not weaken or silently redefine it.

## Source material

The design intentionally draws from:

- Murmur's typed entities, pack manifests/compiler, proposal boundary, decision reducer, and persistent run model in `/Users/jordanallen/IdeaProjects/think-os`.
- Strata19's obligations, evidence ledger, convergence gate, approval cards, readiness cards, and engine-progress UI in `/Users/jordanallen/IdeaProjects/praetor`.
- The WebMCP browser API under `document.modelContext` and its human-in-the-loop design goals.
- Strands TypeScript skills, agents-as-tools, Graph orchestration, hooks, OpenTelemetry, interventions, snapshots, sessions, and AgentCore deployment contract.

No source project is a runtime dependency. Reused code must be copied deliberately, reduced to its required contract, attributed in the repository, and covered by Sift tests.
