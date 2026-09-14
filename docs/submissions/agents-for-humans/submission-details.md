# Agents for Humans Hackathon — Sift Submission Details

Status: local preparation packet; nothing has been sent to Devpost.  
Official data source: authenticated Devpost MCP responses fetched 2026-08-27 UTC.  
Official pages: [challenge](https://agentsforhumans.devpost.com/) · [rules](https://agentsforhumans.devpost.com/rules) · [resources](https://agentsforhumans.devpost.com/resources)

Release gate: complete the [shared release checklist](../shared-release-checklist.md) and the [exhaustive Agents for Humans requirements checklist](./requirements-checklist.md). The shorter checklist at the end of this packet is only a summary.

## Event snapshot

- Host: Amazon.
- Status at fetch: submissions open.
- Recommended track: **Professional Agents** (changed 2026-09-07 with the hero, see "Recommended Sift positioning" below and [ADR 0017](../../decisions/0017-bid-comparison-professional-agents-hero.md)).
- Submission window opened: August 10, 2026 at 9:00 a.m. PT.
- Submission deadline: September 14, 2026 at 5:00 p.m. PT / 8:00 p.m. ET (`2026-09-15T00:00:00Z`).
- Judging: September 15 through October 8, 2026.
- Winners scheduled: October 14, 2026.
- No public-voting period was returned.

## Eligibility snapshot

The Devpost eligibility response states:

> Above legal age of majority in country of residence

> Specific countries/territories excluded: Argentina, Australia, Belarus, Brazil, Crimea, Cuba, Donetsk People’s Republic, Hong Kong, Indonesia, Iran Islamic Republic of, Italy, Korea Democratic People's Republic of, Luhansk People’s Republic, Malaysia, Philippines, Quebec, Russia, Singapore, Syrian Arab Republic, Thailand, United Arab Emirates, Vietnam

It also reports all occupations allowed, no company requirement, and no required team. Verify every team member against the full official rules before submission.

## What must be built and submitted

The official brief asks for a new AI agent built with Strands Agents SDK that does real work for people and handles a real task end to end.

Track choices:

- **Everyday Agents:** daily life, home, money, health, errands, and family; the strongest run quietly and surface only for real decisions.
- **Professional Agents:** repetitive, judgment-heavy professional work.
- **Good Neighbor Agents:** work benefiting neighborhoods, nonprofits, schools, libraries, or local groups.

Required deliverables:

- A text description explaining what the project does, who it serves, and how it works.
- A public source repository containing all source, assets, setup instructions, README, and an MIT or Apache license visible in the repository About area.
- A required architecture diagram upload in PDF, PPT, PPTX, PNG, JPG, or JPEG format, maximum 35 MiB.
- A demo video no longer than five minutes that shows the working project and explains the problem, audience, and why it matters.
- An AWS Builder ID.
- A truthful Built With section that clearly names Strands Agents SDK.

A live demo and AgentCore deployment are not required, but the official judging description says either strengthens the Technological Implementation score. Sift should provide both Railway live access and AgentCore deployment/correlation when credentials allow.

## Current official form fields

| ID | Field | Required | Sift answer/status |
| --- | --- | --- | --- |
| `27729` | Submitter Type | Yes | Participant must select Individual, Team of Individuals, or Organization. |
| `27730` | Country of Residence | Yes | Participant supplies the truthful country. |
| `27731` | Organization name | No | Complete only when applicable. |
| `27732` | Competition Track | Yes | Recommended answer: `Professional Agents`. |
| `27733` | Public code repository URL | Yes | `https://github.com/jordanallen87/sift-aws` — **not yet usable: the repository is private as of 2026-09-07** (`gh repo view jordanallen87/sift-aws --json visibility,licenseInfo`: `"visibility":"PRIVATE"`, `"licenseInfo":{"key":"mit","name":"MIT License","nickname":""}`). An MIT `LICENSE` file is present at the repository root (verified via `ls LICENSE` and `head -3 LICENSE`), but the repository itself must be made public (`gh repo edit jordanallen87/sift-aws --visibility public`) before this field can be truthfully completed — an outstanding **release blocker**. |
| `27734` | Architecture diagram | Yes | Upload final PNG or PDF; do not treat a URL answer as the file upload. |
| `27735` | AWS Builder ID | Yes | Participant must supply. |
| `27736` | Live demo URL | No | Strongly recommended; use verified Railway URL. |
| `28191` | Testing instructions | No | Strongly recommended; provide fixture and live paths. |
| `27737` | Bonus Builder post URL | No | Publish on `builder.aws.com` before the deadline if pursuing bonus points. The current field description contains an apparently unrelated hashtag; verify the live rules before publishing. |

Global Devpost project fields also require a title, tagline, description, built-with list, and public video URL.

## Official judging criteria

| Criterion | Official description | Sift proof to foreground |
| --- | --- | --- |
| Technological Implementation | How thoroughly and skillfully does the project use Strands Agents? Does the code reflect genuine effort and a working, non-trivial implementation? A live demo and/or Amazon Bedrock AgentCore deployment will strengthen this score. | Real AgentSkills, bounded Swarm handoffs, interventions, Context Injector, GoalLoop, sessions/snapshots, Strands TypeScript lifecycle hooks normalized into the Runtime Inspector, scripted deterministic tests, and AgentCore when available. |
| Design | Does the project deliver a complete, coherent product experience and not just a technical proof of concept? | Calm right-pane UI, truthful real-time activity, reviewable evidence, explicit waiting/blocked states, and human confirmation rather than a terminal trace. |
| Potential Impact | Does the project make a credible, specific case for solving a real problem for a real audience, and does the solution actually address that problem based on what's demonstrated? | Bid comparison serves the small trade shop and the homeowner -- the end of a real, AI-served market that every incumbent skips -- and addresses the part incumbents decline to touch: refusing to rank an unfair comparison. Home Energy Guardian additionally proves the quiet-background case. |
| Creativity & Originality | Is this a creative, non-obvious use of Strands Agents and does the team demonstrate genuine understanding of the problem space they're working in? | A supervised adaptive system measures evidence progress, rejects plausible premature answers, and changes agent/skill/tool trajectory under deterministic governance. The non-obvious move is inverting the category: where every incumbent races to produce a ranking, Sift uses Strands to establish that it has not yet earned the right to produce one. |
| Presentation | Does the video clearly demonstrate the project working end-to-end? Does the pitch communicate what problem is solved, who it's for, and why it matters? Is the overall presentation easy to follow? | One causal story: twelve bids, a refused ranking, the scope gaps named in plain words, the arithmetic that flips the apparent low bid into the more expensive one, and an award the agent recommends but never makes. Every beat is legible without construction knowledge. |

## Prize snapshot

Official total prize pool: $40,000 USD.

| Prize | Winners | Amount each |
| --- | --- | --- |
| Grand Prize | 1 | $10,000 |
| Everyday Agents — Golden Agent | 1 | $5,000 |
| Everyday Agents — Silver Agent | 1 | $3,000 |
| Everyday Agents — Bronze Agent | 1 | $2,000 |
| Professional Agents — Golden/Silver/Bronze | 3 | $5,000 / $3,000 / $2,000 |
| Good Neighbor Agents — Golden/Silver/Bronze | 3 | $5,000 / $3,000 / $2,000 |

The Grand Prize also lists an AWS social feature and a meeting with AWS technical experts. Track prizes list an AWS social feature.

## Recommended Sift positioning

### Title

Sift

### One-line summary

Sift is a supervised adaptive agent system that refuses to rank competing bids until they are actually comparable -- normalizing scope, holding the gaps open as explicit unknowns, and handing the award decision to the person who has to sign it.

### Track

**Professional Agents.** The track asks for "an agent that makes someone dramatically better at the work they already do -- professionals, makers, creators, small-business owners" targeting "repetitive, judgment-heavy tasks that eat their day." Comparing subcontractor bids is precisely that task, and the segment is precisely the one the existing tools do not serve (see [`docs/bid-comparison/prior-art.md`](../../bid-comparison/prior-art.md)).

### Problem

You get twelve bids for the same job -- an ordinary count for a public trade-package solicitation, not a hand-picked handful. One is tens of thousands cheaper. Almost nobody can tell whether that is a better deal or simply less work priced -- because bids are not comparable as delivered. Each one draws its own scope boundary, and the cheapest is usually cheapest partly because it is silent about something.

There is a real AI market for this, and we should not pretend otherwise: bid leveling is called table stakes for competitive preconstruction teams in 2026, and MeltPlan, Struvia, Buildr and Procore all ship it. Every one of those products targets mid-size to large commercial general contractors inside a preconstruction workflow. The homeowner with three quotes, and the two-to-ten-person trade shop that cannot justify a preconstruction platform, have spreadsheets and gut feel.

What none of those tools do is the part that actually matters: they produce a comparison and leave the judgment to you. "Verify and adjust" is their stated pitch. They will happily rank an unfair comparison.

### Solution

Sift takes twelve plumbing bids for a school's restroom and locker-room renovation -- a realistic public-bid-tab count, not a hand-picked handful -- and puts them on a single scope basis before it will rank anything. A Strands Swarm reads the bids, normalizes scope, verifies the price arithmetic, checks licences and insurance, and tests schedule feasibility. Sift measures evidence progress around the Swarm.

The pivotal moment is a refusal. The synthesis draft ranks the bids on their raw quoted totals -- the obvious answer, and the one every incumbent produces. GoalLoop rejects it, because the bids are not on a common scope basis and ranking them would be false. What the person sees is not a leaderboard but a sentence: I cannot rank these yet, and here is exactly what is missing.

The domain already has a word for the missing piece -- a **plug number** -- and Sift models it as a first-class explicit unknown that blocks readiness rather than defaulting to zero. Once the three unpriced items are plugged, the arithmetic is visible to anyone watching: the $223,500 bid is silent on permits and inspections ($18,000), the shower-valve rough-in ($31,500), and debris haul-away ($6,000). Adjusted, it is $279,000 -- more than the $276,000 bid it appeared to beat by $52,500. The ranking flips on addition a viewer can follow.

Credentials are a hard constraint rather than a weighted criterion, so a bid whose insurance certificate names a different entity than the licence holder cannot be scored past that discrepancy no matter how well it does elsewhere. And awarding a contract is real money, so `propose_award` is gated: Sift recommends, the person awards, and that boundary is structural rather than a setting.

None of this is asserted rather than implemented. Every recommendation's confidence is a stated function of two measured quantities -- how much of what the person said matters was actually established, and how far the leader leads -- both reported alongside it so the arithmetic can be checked. A factor nobody researched lowers that confidence without ever being counted against an option. A measurement whose sources contradict each other is marked contested, and Sift says when the leader's lead depends on it. Where the Swarm's own favorite is not the option the person's criteria put first, the product states the disagreement in plain words instead of resolving it silently in either direction.

### Why Strands is essential

> **Every claim in this list is mapped to a log record a judge can pull themselves** -- see [`claim-evidence-matrix.md`](./claim-evidence-matrix.md), which gives the implementing file, the test that fails if the claim stops being true, and the exact event name and count in an exported run. The shortest version: every OpenTelemetry span in that export carries `"otel.scope": "strands-agents"`, the instrumentation scope of the SDK's own tracer, which a local class named after Strands cannot produce.

- AgentSkills progressively load the technique the active obligation needs -- scope normalization, price arithmetic, credential verification, schedule analysis.
- A real bounded Swarm moves among scope, price, credential, schedule, source-challenge, and synthesis specialists. The Swarm, its step and timeout bounds, its repetitive-handoff detection and every `MultiAgentHandoffEvent` are genuine SDK behaviour; the trajectory itself is deterministic, because the model's responses are served by a scripted `Model` implementation so the release gates can assert an exact event sequence with no network and no credentials. Do not describe the handoffs as chosen by the model at inference time.
- Interventions use `Guide`, `Confirm`, and `Deny` to redirect work and preserve authority. `Deny` is load-bearing here rather than decorative: the price analyst reaches for the licence registry, a tool the pack grants only to the credential checker, and is refused before it runs.
- Context Injector supplies current criteria weights, unresolved scope gaps, and remaining budgets on each turn.
- GoalLoop rejects the plausible premature ranking and provides bounded corrective feedback -- the single most important beat in the demo, and a genuine Strands mechanism rather than a UI state.
- Sessions and snapshots preserve execution across the award confirmation and service reconstruction.
- Strands TypeScript lifecycle hooks -- `BeforeToolCallEvent`/`AfterToolCallEvent`/`BeforeModelCallEvent`/`AfterModelCallEvent` on every agent, `BeforeNodeCallEvent`/`NodeResultEvent` on the Swarm, and `MultiAgentHandoffEvent` on each real handoff -- feed the user activity stream and the detailed Runtime Inspector without exposing chain-of-thought, correlated by a Sift-minted trace id that ties an activity event to its runtime event and state diff.
- AgentCore provides the AWS execution target when deployed.

### Distinguishing claim

Most agents are optimized to finish. Sift is optimized to know when the agent has not earned the right to answer yet.

## Required hero demonstration

The full shot-by-shot script is [`demo-script-bid.md`](./demo-script-bid.md), written against a product that was driven rather than read. The five-minute causal chain:

1. **0:00–0:30 — the problem.** Twelve plumbing bids for a school renovation -- a realistic public-bid-tab count. The cheapest is $52,500 under the eventual winner. Is it a better deal, or is it pricing less work?
2. **0:30–1:20 — a real Strands Swarm.** Six specialists, real SDK handoff events along a deterministic trajectory, four AgentSkills. Two interventions visible as they land: the scope analyst is **redirected** by `Guide` after circling, and an **"Action blocked"** appears when the price analyst reaches for a tool this pack grants only to the credential checker.
3. **1:20–2:00 — the refusal.** GoalLoop rejects the first synthesis, which ranked on raw totals. Not badly written — false, because the bids are not on a common scope basis. Every incumbent will happily rank an unfair comparison; this one will not.
4. **2:00–2:45 — the arithmetic.** Cedar is silent on permits ($18,000), the shower-valve rough-in ($31,500) and haul-away ($6,000). Adjusted: $279,000 against Northgate's $276,000. The cheapest bid was the most expensive one, on addition a viewer can follow.
5. **2:45–3:15 — it still will not call two questions closed.** Fail-closed evidence keeps `bid.scope_normalization` and `bid.credential_verification` open on degraded verdicts, even with a winner named.
6. **3:15–3:55 — priorities, and a constraint that outranks a winning score.** Reweight toward warranty and deposit and Two Rivers scores highest of all twelve (0.9132, rendered "91%", against the winner's "72%"). It still does not win — its insurance names "TRM Holdings LLC", not its licence holder — and the product **flags rather than eliminates** it: **"#11 of 12"**, the 91% still showing, "Flagged, not removed — still ranked, and still yours to decide." Fieldstone Plumbing Co. carries the same flag on a second, distinct ground at "#12 of 12"."
7. **3:55–4:25 — the human boundary.** `propose_award` is gated by `Confirm`; the proposal sits pending with no approving actor until a person acts on camera.
8. **4:25–4:50 — implementation proof.** The Runtime Inspector, tailing live: 433 runtime events in that first run, 6 swarm nodes, 5 handoffs, 28 context injections, and 105 spans — every one of them carrying the SDK's own instrumentation scope.
9. **4:50–5:00 — close.** "Most agents are optimized to finish. This one is optimized to know when it hasn't earned the right to answer yet."

**Versatility beat, if time allows in a separate take:** Home Energy Guardian opens its own case from a bill feed with nobody asking — the quiet-background property this pack structurally does not have, and which is not claimed for it.

## Testing instructions draft

1. Open the public Railway URL and launch **Investigate my energy bill**.
2. Start the deterministic scenario and observe the anomaly, rate, and weather work update in real time.
3. Verify the first monitoring draft is visibly withheld.
4. Verify repeated/no-progress weather work causes a `Guide` and Swarm handoff to `home-systems-analyst`.
5. Verify the thermostat evidence is source-linked and the recommendation changes after reweighting criteria through **Add or adjust → Adjust priorities**.
6. At confirmation, verify the session snapshot exists, restart/reconstruct the runtime, and verify restoration without lost case events.
7. Confirm the agent cannot approve or schedule the inspection.
8. Open Runtime Inspector and correlate the visible activity with its exact Strands lifecycle-hook event, via the activity item's own "Inspect event" control (the Sift-minted trace id plus `debugEventId`).
9. Review `artifacts/verification/latest/report.json` from `pnpm verify:release`.

Replace this draft with the exact public URL, scenario control labels, AgentCore endpoint/correlation instructions, and observed results after deployment.

## Built-with draft

- Strands Agents SDK for TypeScript
- Amazon Bedrock — **verified live 2026-09-14, list with the scope below.** The Bedrock provider
  (`apps/agent/src/runtime/model-provider.ts`, using the SDK's real `BedrockModel`) is now reached by
  a real production code path: `POST /api/cases/:caseId/bid-documents/read`
  (`apps/agent/src/routes/bid-documents.ts`), gated behind `SIFT_BID_DOCUMENT_READER_ENABLED=true`,
  constructs a real `BedrockModel` at `apps/agent/src/server.ts:240` via `resolveModelProvider`. A
  live call against **Amazon Nova Lite** (`amazon.nova-lite-v1:0`), region `us-east-1`, read an
  unstructured bid document and returned a validated reading in 2.5 seconds, HTTP 200 — see
  `claim-evidence-matrix.md`. Nova, not Anthropic's model, because Anthropic models on Bedrock are
  currently blocked on this account pending AWS's "Anthropic use case details" form, and Nova is
  ungated and cheaper. The scope is narrow: this is the opt-in document-reading path, not the hero
  bid-comparison Swarm, which still constructs its scripted provider unconditionally. See
  `docs/specs/strands-runtime.md` "What actually ships".
- Amazon Bedrock AgentCore, only if actually deployed
- TypeScript
- React
- Vite
- Tailwind CSS
- Express
- Zod
- WebMCP
- SQLite / better-sqlite3 / Drizzle
- Playwright
- Docker
- Railway

**OpenTelemetry is now part of this list (2026-09-04).** Sift registers a real `NodeTracerProvider` through the Strands SDK's own `setupTracer({ provider })` and records the spans the SDK already emits into `runtime_events`, with real `span_id`/`parent_span_id` links and span-measured durations (`apps/agent/src/runtime/otel-span-recorder.ts`, installed at startup by `apps/agent/src/server.ts`). A standard `OTLPTraceExporter` additionally attaches, via a real `BatchSpanProcessor`, whenever `OTEL_EXPORTER_OTLP_ENDPOINT` is set; unset (the default), no exporter is constructed and nothing opens a socket. The lifecycle-hook correlation is unchanged and still real: hook events normalized in `apps/agent/src/runtime/event-normalizer.ts` under a Sift-minted `traceId`. Still not claimed: `setupMeter()`/OTEL metrics, W3C `traceparent` propagation to AgentCore/CloudWatch specifically, and any CloudWatch/AgentCore Observability correlation for this OTel span path. See `docs/submissions/webmcp/claim-evidence-matrix.md` rows E8/E9.

## Architecture diagram requirements

The submitted export must visibly distinguish:

- ChatGPT and WebMCP browser interaction;
- Railway web/API gateway and persistent SQLite volume;
- deterministic Sift evidence/readiness/authority engine;
- compiled Decision Pack and case/run plan;
- Strands AgentSkills, Graph/Swarm, interventions, Context Injector, GoalLoop, sessions, and hooks;
- local versus AgentCore execution target;
- Sift-minted trace/correlation ids linking hook events to the Runtime Inspector, plus the real OpenTelemetry span path (`NodeTracerProvider` → `SiftSpanRecorder` → `runtime_events`, with a conditional `OTLPTraceExporter` gated on `OTEL_EXPORTER_OTLP_ENDPOINT`) — but **no** CloudWatch/AgentCore Observability correlation for that span path, because none is implemented (see the note under Built-with draft for the exact boundary);
- human-only approval boundary.

## Bonus Builder post

Recommended article angle:

> Agents for Humans: Building an Agent That Knows When Not to Answer

Cover the real Strands trajectory, why deterministic readiness sits outside the model, how steering responds to evidence delta, AgentCore deployment, observability, and what the automated scenario caught during development. Publish before the deadline and verify the current live rule/hashtag instructions.

## Final checklist

- [ ] Confirm registration and eligibility in Devpost.
- [ ] Select `Professional Agents` in the final form.
- [x] Add the public repository URL and visible MIT license — **done.** `https://github.com/jordanallen87/sift-aws` was verified PUBLIC on 2026-09-14 by an unauthenticated fetch (HTTP 200, i.e. what a judge without access sees), and GitHub detects the root `LICENSE` as MIT so it renders in the About panel. The earlier note here calling this a release blocker was true on 2026-09-07 and is now stale.
- [ ] Add the AWS Builder ID.
- [ ] Export and upload the required architecture diagram.
- [ ] Add the verified Railway URL.
- [ ] Deploy and verify AgentCore when credentials permit; describe any honest blocker.
- [ ] Record exact setup and deterministic testing instructions.
- [ ] Record a public demo video no longer than five minutes.
- [ ] Show the working product rather than slides or mockups.
- [ ] Name Strands Agents SDK prominently in Built With, description, README, and video.
- [ ] Publish and link the optional Builder post if pursuing bonus points.
- [ ] Run `pnpm verify:release` and link the report from the README.
- [ ] Submit before September 14 at 5:00 p.m. PT.
- [ ] Freeze the submitted repository, live deployment, form, and video after the deadline.
