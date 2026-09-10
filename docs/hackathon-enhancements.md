# Winning the AWS hackathon — enhancement evaluation

Written 2026-09-07, seven days before the Agents for Humans deadline (September 14, 5:00 p.m. PT).
Everything below was evaluated against the product at `f4e6ef2`, where `pnpm verify` passes all ten
stages. Each item carries an effort estimate — **S** ≤ 1 day, **M** 2–3 days, **L** 4+ days — and
the rubric criteria it moves. Items marked **VERIFIED GAP** were confirmed by grepping the source
today, not assumed.

## The frame

The rubric has five criteria. Two of them we are already strong on and can only lose ground on by
breaking things: **Technological Implementation** (real Strands, measured in a 394-event export)
and **Design** (a real right-pane product, which most submissions will not have — logs are not a
UI). The three where there is room are **Potential Impact**, **Creativity & Originality**, and
**Presentation**, and the Presentation gap is entirely human-only work (video, redeploy).

The one structural weakness we have named honestly and not fixed: **nothing in the product
decides, on its own, that work needs doing.** The Everyday track's defining sentence is agents that
"run quietly in the background and only ping you when there's a real decision to make." We chose
the Professional track partly because it does not ask for that. But the Grand Prize is
cross-track, and a judge reading "supervised adaptive agent" is going to expect the agent to
notice something. Right now, a person clicks a button every single time.

That is the headline item.

---

## 1. The headline: Standing Watch

**What it is.** Each pack ships a declaration of what it keeps an eye on after the first answer,
what counts as material, what bounded work to do when something changes, and how loudly to tell
the person. The runtime runs a genuine scheduler that evaluates those watches, does the work
through the same Swarm with the same interventions, and surfaces the result in the pane — quietly
by default, loudly only when the decision itself is affected.

**Why it wins.** It converts the product's one structural weakness into its most distinctive
feature, on the axis judges are explicitly told to weigh. It uses *more* Strands, not less. And it
is the natural extension of what we already refuse to fake: the deterministic core still decides
authority, the model still never awards, and the person still makes the call.

### The honesty line, first

Earlier docs said, correctly, that a fake "we noticed your quotes came in" watcher would be
exactly the staged autonomy this project refuses. That remains true. The distinction:

- **A real scheduler over a fixture feed is honest.** Every tool in the product already reads
  fixtures in fixture mode; a feed is no different. What must be real is the *loop* — a clock,
  ticks, evaluation, bounded work, events. Tests use an injectable clock. The UI labels fixture
  time as fixture time, the same way `SIFT_DEMO_PACING_MS` is labelled.
- **What must never appear:** "monitoring your inbox," "watching your email," or any copy that
  implies a live external source that does not exist. The product says what it is checking and
  where that data came from.

### The design, concretely

**Pack declaration** (`watches[]` on the manifest, compiled and hashed like everything else):

```ts
{
  id: 'bid.revised_bid_arrives',
  feed: 'bids-inbox',                       // fixture feed now; real source later, same contract
  trigger: 'new_or_changed_document',       // deterministic predicate, owned by the core
  triage: 'model',                          // optional: the model judges materiality (bounded)
  work: {
    reopen: ['bid.scope_normalization', 'bid.award_recommendation'],
    specialist: 'scope-analyst',
    budget: { toolCalls: 12, modelCalls: 6 } // BudgetGuard, tightened for background work
  },
  interrupt: 'ping_if_decision_changes'     // default policy; person can change it
}
```

Suggested watches for the bid pack, each backed by a time-indexed fixture:

| Watch | Fixture event | What happens | Interrupt |
| --- | --- | --- | --- |
| Revised bid arrives | Cedar re-issues with permits priced at T+2 | Scope re-normalized; Cedar's adjusted total drops to $16,100; **ranking flips back** | ping — the decision changed |
| Licence / insurance status | Two Rivers corrects its named insured at T+3 | Hard constraint clears; Two Rivers, already the highest scorer under the person's weights, becomes eligible; **recommendation changes again** | ping |
| Bid validity window | Northgate's 30-day price hold lapses at T+5 | Obligation `bid.price_verification` reopens as stale | note — no decision yet |
| Registry re-check, no change | Nightly tick | `watch.checked`, collapsed in the stream | silent |

The second row is the best beat in the whole product. The person did nothing. The world changed.
The agent noticed, did bounded work, and the highest-scoring bid — which it had refused to
recommend on a credentials discrepancy — became eligible. It *still* does not award. It pings.

**Who decides what.** Two decisions, two owners, kept separate on purpose:

- *Is this change worth doing work on?* — the model, via a small triage agent, bounded by
  `BudgetGuard`. Subjective, as the user said it would be. Its output is a proposed reopening and
  a plain-language note.
- *Is this worth interrupting a human?* — the deterministic core, from three facts it already
  computes: did the favoured option change, did readiness change, did a hard constraint flip.
  Crossed with the person's interrupt policy. The model never gets to ping.

**Runtime events** (new categories, alongside the existing ones): `watch.checked`,
`watch.fired`, `watch.triaged`, `watch.suppressed` (fired, but policy said stay quiet — this one
matters for the story: "it noticed and chose not to bother you").

**Strands use it adds:** background runs under a tightened `BudgetGuard`; `ContextInjector`
carrying "what the person has already seen" so the note describes only the delta; a `GoalLoop`
validator on the triage note whose rule is "cite the specific document that changed, or be
rejected" — the same discipline as the synthesis validator, now applied to autonomy.

**UI**, in order of value:

1. **Freshness on the recommendation** — "Current as of 2 min ago · watching 3 things." Stale
   becomes a visible state, not a silent one.
2. **"Since you were away"** — a digest card at the top of a case with unseen watch events.
   Three lines maximum. The thing a judge screenshots.
3. **Interrupt policy** under *Add or adjust*: "Interrupt me — only if the decision changes / on
   any change / never, I'll check." A person editing their own vigilance level is the quiet-agent
   thesis made into a control.
4. The activity stream already handles the rest: collapsed quiet checks, the existing findings
   band for pings.

**Testing.** Scenario assertions with a fake clock advancing through the fixture timeline,
asserting `watch.fired` → bounded run → recommendation change → *no* proposal auto-approval.
E2E with a dev-only "advance fixture time" control, labelled as such. Mutation gate on the
interrupt-policy decision, since it is a decision rule that governs human attention.

**Effort: L.** Contracts, compiler, scheduler, events, two engines untouched but one extended,
fixtures, UI, tests, baselines, docs. **The minimum honest slice is M:** one feed, one watch (the
revised-bid arrival), the freshness indicator, and the digest card. Ship that; the licence-status
watch is the stretch that makes the video.

**Rubric:** Impact ↑↑, Creativity ↑↑, Design ↑, Technological ↑. Also reopens the Everyday
framing for the same pack, if the track choice is ever revisited.

---

## 2. Show what already exists and is invisible

Zero product risk. Each of these is a capability we built, tested, and never put on screen.

| # | What | Why it matters | Effort |
| --- | --- | --- | --- |
| 2.1 | **Sessions and snapshots on camera.** Kill the service mid-run, restart, resume. Proven in tests; never shown. | Rubric names it. A restart is the most convincing 15 seconds of "this is real" available. | S |
| 2.2 | **BudgetGuard, visibly.** Wired into both the Swarm and the Graph (`bid-comparison-swarm.ts`, `car-purchase-graph.ts`); surfaced only faintly. A budget bar in the dev view: tool calls used / allowed, model calls, tokens. | "Bounded" is a claim until a judge can see the bound. | S |
| 2.3 | **Structured output, visibly.** 14 `tool.strands_structured_output` events per run. One dev-view row showing the schema-validated result. | Rubric names it. | S |
| 2.4 | **The source challenger's work.** It re-verifies claims against sources. Show what it tried to disprove and failed to. | "Adversarial self-check" reads as creativity; it is already there. | S |
| 2.5 | **Confidence arithmetic.** Already rendered. Put it in the video and say the sentence: "confidence is a function of two measured numbers, both shown." | Original, true, ours. | — |

---

## 3. Product enhancements, ranked by leverage

### 3.1 Supply a plug number — **VERIFIED GAP** (S–M)

There is no UI for it. `grep -rli plug apps/web/src` finds nothing relevant. The product's whole
thesis is "an absent scope item with no plug number stays an explicit unknown," and the person
cannot interact with that moment: the scripted trajectory supplies the numbers. A sheet listing
Cedar's three absent items with "Enter a number / Mark unknown" per row, and the adjusted total
recomputing live from $223,500 → unknown → $279,000 as they type, is the single most legible beat we
could add. Deterministic, no model call, already-modelled state.

**Rubric:** Impact ↑, Design ↑, Presentation ↑↑.

### 3.2 "What would change my mind" — sensitivity (S–M)

Deterministic and cheap: for the current weights, which single fact, if different, flips the
recommendation, and by how much. "If Cedar priced permits, it wins by $200." "If Two Rivers
corrects its insurance, it wins outright." `deriveInsights` in `packages/core/src/scoring.ts`
already computes which criterion decided it; this extends that to counterfactuals. Pairs perfectly
with Standing Watch — the sensitivity list *is* the list of things worth watching.

**Rubric:** Creativity ↑↑, Impact ↑. Judges love an agent that says what would change its answer.

### 3.3 Scope matrix view (S)

The bid-levelling table the incumbents have — items × bids, priced / absent / priced-at-zero —
with our difference: absent items render as **unknown**, not blank or $0, until a plug number
exists. The generic Compare view exists; a pack-specific scope matrix is the domain-native
rendering. Very legible at 390px if each bid is a column and each item a row.

**Rubric:** Design ↑, Impact ↑ (it looks like the tool a contractor would actually use).

### 3.4 Clear a finding as a human (verify, then S–M)

The round-2 rationale promises: *"Correcting the named-insured discrepancy on Two Rivers'
certificate would reopen this recommendation."* Is there a UI path for a person to say "I
confirmed TRM Holdings is Two Rivers' registered DBA"? If not, the product promises something it
cannot do. If yes, it is a strong beat: human supplies a verification with `origin: 'user'`, the
hard constraint clears, the recommendation changes. **Check this before recording either way.**

### 3.5 Decision memo export (S)

A Markdown/PDF "why we chose Northgate" with the evidence trail, adjusted totals, the two open
findings, and the human approval line. The Professional track wants deliverables; a contractor
sends this to the client. Zero model involvement — it is the case state, rendered.

**Rubric:** Impact ↑, Design ↑.

### 3.6 A fourth bid arrives mid-case (M)

Add-a-bid through the UI (the option editor exists) — and it feeds Standing Watch naturally. Even
without the watch layer, "add a bid, watch scope normalization reopen, watch the ranking absorb
it" is a live demonstration that the engine is not a fixture player.

### 3.7 Pack routing, exercised — **VERIFIED GAP** (M)

`packages/core/src/routing.ts` and `discovery.ts` (756 lines) exist and are tested. **Nothing in
the product calls them** — `selectPack` appears only in a fixture contract. The spec
(`packs-and-routing.md`) describes a person describing a decision and the engine choosing the
pack. A launcher that takes a sentence ("I have three roofing quotes") and routes to the bid pack,
with the routing reasons shown, would exercise real shipped code. Without a live model this is
deterministic routing over declared triggers, which is honest and demonstrable.

### 3.8 Wire the live Bedrock path — **VERIFIED GAP** (S to wire, needs AWS to test)

`createBedrockModel` and `resolveModelProvider` in `model-provider.ts` still have no production
caller; both engines construct the scripted provider unconditionally. This is a *disclosed*
weakness in the completion report. Wiring `SIFT_MODEL_PROVIDER=bedrock` through both engines is a
day; proving it needs credentials. If you have an AWS account, this plus 3.9 is the largest single
Technological Implementation move available.

### 3.9 AgentCore deployment (M, blocked on credentials + Builder ID)

The rubric says in so many words: "A live demo and/or Amazon Bedrock AgentCore deployment will
strengthen this score." `/ping` and `/invocations` are served and exercised locally. This is the
one item where the blocker is purely external and the payoff is written into the rubric.

### 3.10 A second Professional pack in an hour, on camera (S, uses existing authoring)

`apps/agent/src/authoring/` ships the pack-authoring skill. Scaffold "compare three HVAC
replacement quotes" from the bid pack live, validate, run it. Proves the engine is general without
building anything new. Human-only publication stays human-only.

---

## 4. Presentation (human-only, and the biggest unclaimed points)

| # | Item | Status |
| --- | --- | --- |
| 4.1 | **Railway redeploy.** Live URL is ~15 commits behind and has no bid pack. A judge who clicks it today sees the old product. | Needs your go |
| 4.2 | **Hero video** from `demo-script-bid.md`, with the dev-view toggle mid-run. | Not recorded |
| 4.3 | **Energy video** — a re-voice away from usable; it is the versatility beat. | Draft exists |
| 4.4 | **AWS Builder post** (bonus points). | Not written |
| 4.5 | **Architecture diagram** updated for three packs (+ Standing Watch if built). | Stale |
| 4.6 | **WebMCP host smoke test** recorded in `release-metadata.json`. | Not done |

---

## 5. Issues and gaps found during this evaluation

Recorded as asked. Each was confirmed today unless marked "from earlier."

1. **No background loop exists anywhere in the runtime.** `grep -rlE "setInterval|scheduler|watch"`
   returns only `model-provider.ts` (the pacing delay) and `events.ts` (SSE). The energy bill-feed
   check is a gate a person invokes, not a poller — the docs were corrected to say so on
   2026-09-05. Any "quietly in the background" claim we make today is about *when it interrupts*,
   not about *whether it acts unprompted*. Standing Watch is the fix; until then, do not use the
   word "monitors."
2. **No plug-number UI** (3.1). The thesis has no control.
3. **Pack routing is dead code in the product** (3.7). Implemented, tested, never called.
4. **Live model path unwired** (3.8). Disclosed, not fixed.
5. **No AgentCore deployment.** External blocker.
6. **Single active case only.** No case list, no home screen. The product cannot show two
   decisions side by side, which makes the "supervised system" framing feel like a demo, not a
   tool. A case list is S–M and is a prerequisite for Standing Watch to have anywhere to put "3
   cases, 1 needs you."
7. **No deliverable for the person** (3.5). The output of the product is a screen.
8. **Round-2 narration is fixture-keyed.** Fixed for score numerals; the qualitative prose is
   still written for one weighting. Inherent to fixture mode and documented in the demo script —
   but it means the reweight beat must be performed exactly as scripted.
9. **Two obligations end `open` with no obvious path to close them by hand** (3.4). Verify.
10. **`BudgetGuard` is wired but nearly invisible** (2.2). Bounded is claimed, not shown.
11. **The parked touch-target gap** on `activity-item-inspect-run-*` (from earlier, in the
    completion report). Adjacent to the tabs fix I made today; not the same control.
12. **Intermittent full-`verify` flake** (from earlier, `BLOCKED.md`). Not reproducible in
    isolation; not seen in today's three full runs. Still open.
13. **`CaseScoreboard.warnings` renders nowhere** (from earlier). Neither pack emits one.
14. **Railway is stale** (4.1).

None of these is a correctness bug in what ships. All of them are the difference between "a
verified demo" and "a product a judge believes someone would use."

---

## 6. What I would actually do with seven days

Ordered. Stop wherever the clock says.

1. **Railway redeploy** — half a day including `test:deployed`. Removes the risk that a judge
   sees the wrong product. Your call to authorize.
2. **Plug-number UI** (3.1) — one day. Puts the thesis under the person's fingers.
3. **Standing Watch, minimum slice** (1) — three days. One feed, the revised-bid watch, freshness
   indicator, digest card, scenario + e2e coverage. Feature-flagged so energy and car are
   untouched.
4. **Sensitivity** (3.2) — one day. It is also the watch list, so it makes 3 look designed.
5. **Record.** Hero video with all of the above; energy re-voice if there is time.
6. Stretch, in order: licence-status watch (the flip-back beat), scope matrix (3.3), decision memo
   (3.5), Bedrock wiring if credentials appear (3.8/3.9).

## 7. What not to do

- Do not add a pack. Three is enough; a fourth dilutes the hero.
- Do not fake a feed. A fixture feed with a real scheduler, labelled, is honest. "Monitoring your
  email" is not.
- Do not let the model ping. Triage is the model's; interruption is the core's.
- Do not touch the energy or car trajectories. They are green, baselined, and the versatility beat.
- Do not spend a day on the Everyday-vs-Professional question again. Build Standing Watch; it
  makes the pack strong in either track and strongest for the Grand Prize.

---

# Addendum, 2026-09-07 evening — research before building

Three pushes from the user, answered against the installed SDK (`@strands-agents/sdk@1.14.0`,
read from `node_modules`, not from memory) and against our own runtime.

## A. Listener or loop?

Both, unified as **triggers** — and the distinction is real, not semantic:

| Change arrives by… | Right primitive | Example |
| --- | --- | --- |
| **Push** — something happens and tells us | listener on a feed event | a revised bid is submitted; a registry status changes |
| **Time** — nothing happens, and that is the change | scheduler with an injectable clock | a 30-day price hold lapses; a bid goes stale |
| **Query** — the source does not push and we must ask | scheduler that polls, cheaply and rarely | a licence registry with no webhook |

A pack declares triggers; the runtime owns one dispatcher that feeds all three into the same
place. In fixture mode the feed is a time-indexed fixture and the clock is fake in tests; the
dispatcher is real.

**What our runtime already has.** `RunService.requestInvestigation` starts the engine with
`void runInSpanScope(runId, () => engine.trigger(...))` — runs are **already detached** from the
request. Background execution is not new work; a non-click caller of `requestInvestigation` is.

**What it does not have — four verified gaps that become bugs the moment triggers exist:**

1. **No per-case run guard.** Nothing prevents two runs on one case interleaving. A person
   clicking while a watch fires is the first thing that will happen on camera. Needs a per-case
   queue (serialize) with a global concurrency cap (numerous agents, bounded).
2. **SSE is per-case only** (`/api/cases/:caseId/events`). A case list saying "3 watched, 1 needs
   you" needs a global stream or a `/api/cases` summary endpoint — neither exists.
3. **No read marker.** "Since you were away" needs to know what the person has seen. Nothing
   records it.
4. **Two identical `Clock` interfaces** in `packages/core` (`attributes.ts`, `evidence.ts`). Harmless
   today; the scheduler should use one, so unify first.

## B. Strands features that fit Standing Watch — read from the SDK, not assumed

We use `Agent`, `Swarm`, `Graph`, hooks, `AgentSkills`, `ContextInjector`, `GoalLoop`, sessions,
OTel, structured output. The SDK ships considerably more that we have never touched, and several
pieces are almost purpose-built for this:

| SDK export | What it is | Where it lands |
| --- | --- | --- |
| **`vended-interventions/hitl`** — `HumanInTheLoop` | Pauses before a tool call; **defaults to interrupt/resume "for stateless deployments"**: the agent stops with `stopReason: 'interrupt'`, the caller later calls `agent.resume(interruptResponses)`. Has `allowedTools`, trust-for-session, and an **LLM risk classifier** (`createLlmRiskClassifier`). | **The background agent asks a human and waits.** A watch fires, work runs, `propose_award` is reached, the agent interrupts, the snapshot persists, the pane shows the pending ask, the person answers hours later, the run resumes. This is the single strongest Strands beat available to us and we have never called it. Our `ConsequenceGuard` decides *which* tools are consequential; HITL becomes the *mechanism*. |
| **`vended-interventions/cedar`** — `CedarAuthorization` | Tool authorization from **Cedar policies** (AWS's policy language), with schema generation from tool definitions, a `principalResolver` that is **fail-closed** ("return `undefined` to deny"), and session context (`hour_utc`, `call_count`). | The `Deny` beat becomes **policy as data**: "price-analyst may not call license-lookup" written in Cedar, evaluated by the SDK. Background agents get a tighter principal than foreground ones — the same tool, different policy, because nobody is watching. For an AWS judge this is unusually legible. |
| **`vended-interventions/steering`** — `LLMSteeringHandler` + `SteeringContextProvider` | Just-in-time guidance on `beforeToolCall`; providers "track agent activity and supply context data"; default provider is a `ToolLedgerProvider`. | **The triage mechanism, vended.** A `FeedDeltaProvider` supplies "what changed since the last run"; the handler decides whether the change is material enough to proceed. This is the subjective judgment the user described, in the SDK's own shape — and it stays a *steering* decision, never an *authority* one. |
| **`memory` — `MemoryManager`** plugin + `vended-memory-stores/*` | Cross-session memory: `search_memory`/`add_memory` tools, an injection middleware that folds retrieved memory into each model call, OTel spans per operation, pluggable stores (file, test, Bedrock Knowledge Base). | "What the person has already seen and decided" as agent memory rather than a hand-built context blob. The digest note describes only the delta because the agent *remembers* the baseline. Bedrock Knowledge Base as the store is an AgentCore-shaped upgrade path. |
| **`a2a`** — `A2AServer`, `A2AAgent`, `A2AExecutor`, `a2a/express` | Agent-to-Agent protocol: expose an agent as a network service (agent card, task store, `maxContexts`), call remote agents as if local. **Marked experimental by the SDK.** | "Numerous agents in the background" made literal: the watch/triage agent runs as its own A2A service, addressable, with its own task store — the Swarm calls it through `A2AAgent`. Also exactly the shape an AgentCore deployment wants. Prove it works with the scripted `Model` before committing; it may not. |
| **`vended-plugins/context-offloader`** | Offloads oversized tool results to storage, leaves a preview + reference. | Real bid documents are long. Not a demo beat; a correctness one if we ever ingest real PDFs. |
| **`storage`, `storage/search`, `session/s3-storage`** | Unified byte storage used by sessions, memory, offloading; keyword search default. | One `Storage` for snapshots, memory, and offloaded documents; S3 when deployed. |

**Verified today:** nothing in `apps/agent` handles `stopReason: 'interrupt'` or calls `resume()`.
A `SessionManager` is used in the energy scenario runtime. So interrupt/resume is genuinely
unexplored and genuinely available.

**First spike, before any build:** a 100-line test that runs a scripted-`Model` agent with
`HumanInTheLoop` on one tool, asserts `stopReason === 'interrupt'`, persists the session,
restores it in a fresh process, calls `resume()`, and asserts the tool then executes. If that
passes, Standing Watch's human boundary is built on the SDK's own primitive. If it fails against
the scripted provider, we know on day one.

## C. Features only an agent can do

The user's push: surface what is *only* possible because of agents, or would take a person
forever. Ranked by how honestly we can demonstrate it:

1. **Vigilance across many cases at once.** Five open jobs, fifteen bids, each with three triggers
   — a human cannot watch that; a person does not even try. A case list with live "watching /
   needs you" state, several watches firing in one demo, is the clearest agent-only capability
   we can show, and it is deterministic to stage from fixtures.
2. **A background agent that pauses for a human and resumes later** (HITL interrupt/resume).
   Software that *waits* for you, with the work already done, is not something a spreadsheet
   does.
3. **Adversarial self-verification** — the source challenger re-deriving claims against sources.
   Already exists; a human never re-checks their own comparison.
4. **Scope normalization across unstructured bids.** Three bids, eight items, exclusions,
   allowances, plug numbers — an hour of careful reading per job, done in seconds *with the work
   shown*. **Honesty note:** in fixture mode the extraction is canned; the *diffing and
   normalization* are real deterministic tools. Show extraction as agent work only if the Bedrock
   path is wired and a real document is read on camera.
5. **The delta note.** "Cedar revised its bid; permits are now priced; the ranking flipped back;
   nothing else changed." Written by the model from memory + feed delta, validated by GoalLoop to
   cite the changed document. Summarizing *what changed and why it matters* across sources is the
   canonical agent task.
6. **Sensitivity.** Deterministic, but nobody does it by hand: "which single fact flips this?"

Things that are *not* agent-only and should not be pitched as such: the arithmetic, the ranking,
the criteria reweight. Those are the deterministic core, and their honesty is the point.

## D. Why not do most of it — and how to keep it coherent

Most items are S. With parallel agents and seven days, most are buildable. The constraint is not
typing speed; it is **coherence** and **verification cost** — every UI change means six-viewport
baselines inspected by eye, every runtime change means the scenario and mutation gates, and the
tree cannot be committed under agents mid-write.

The way to do most of it without it reading as a feature pile is one spine:

> **A decision is not a snapshot. It is a living case with unknowns, and the agent's job is to
> keep it honest over time.**

Every feature is then one of five moves on that spine:

| Move | Features |
| --- | --- |
| The **world** resolves an unknown | Standing Watch (triggers, triage, bounded work, HITL pause) |
| The **person** resolves an unknown | Plug-number sheet (3.1); clear-a-finding (3.4) |
| The agent says **which unknown matters most** | Sensitivity (3.2) — which is also the watch list |
| The UI shows **where unknowns live and what changed** | Scope matrix (3.3); freshness + digest; case list |
| The case produces its **record** | Decision memo (3.5) |

Underneath, infrastructure that makes the above more real but is not a feature of its own:
Cedar for tool policy, MemoryManager for what-the-person-has-seen, A2A for the background agent
as a service, Bedrock/AgentCore if credentials appear. **Cut from the coherent set:** pack
routing (3.7) and second-pack-in-an-hour (3.10) — both true, both a different story.

**Sequencing for parallel agents, with the collision rules learned this session** (no
`git add -A` while agents run; kill 8080 before any Playwright run; open every regenerated
baseline):

1. **Day 1 — spikes, in parallel, no product code:** HITL interrupt/resume with the scripted
   Model; Cedar policy evaluating the existing Deny case; A2A server + client with a scripted
   agent. Each returns pass/fail with evidence. Decide the mechanism set from results, not hopes.
2. **Day 2 — foundations, serialized because they touch shared files:** unify `Clock`; per-case
   run queue with a global cap; `/api/cases` summary + a global event stream; read markers.
3. **Days 3–5 — features in parallel, one agent each, disjoint files:** trigger contracts +
   dispatcher + fixtures; plug-number sheet; sensitivity in `scoring.ts`; scope matrix; case list
   + digest + freshness; decision memo. Each lands with its own tests. Integration happens on the
   bid pack only; energy and car stay untouched.
4. **Day 6 — the licence-status watch, HITL pause, and the full journey e2e.** The flip-back beat.
5. **Day 7 — verify, redeploy, record.**

Real-time surfacing costs nothing extra: watch events are runtime events; they project into the
same activity stream the pane already tails, and the dev view already live-tails at 400 ms. The
only new plumbing is the global stream for the case list.

## E. Additional gaps found during this research

15. **No per-case run guard** (A.1). Latent today; a real bug once anything other than a click
    can start a run.
16. **No `/api/cases` list endpoint and no global event stream** (A.2).
17. **No read marker** (A.3).
18. **Duplicate `Clock` interfaces** in core (A.4).
19. **Interrupt/resume never exercised** — the SDK's stateless human-in-the-loop mechanism is
    unused, while we hand-rolled a confirmation guard. Not wrong; a missed opportunity.
20. **Cedar unused** — the AWS policy language ships in the SDK we already depend on, and our
    Deny beat is a hand-written allow-list.
