# About Project — Devpost "About Project" field

Paste-ready. Headings are Devpost's standard seven. Written first person, plain, no pitch.
Every number here was measured against a running build on 2026-09-13, not estimated.

---

## Inspiration

I wanted to see whether an agent could be built to say "not yet."

The test case is bid comparison. You get twelve bids for the same job, one is $52,500 cheaper than
the next, and you can't tell whether that's a better deal or just less work priced — because bids
aren't comparable as delivered. Each one draws its own scope boundary, and the cheapest is usually
cheapest partly because it's silent about something.

Bid leveling already exists as a product category. MeltPlan, Struvia, Buildr and Procore all ship
it, all aimed at mid-to-large commercial GCs inside a preconstruction workflow. What none of them
do is refuse. They produce a comparison and hand you the judgment — "verify and adjust" is the
stated pitch. They will rank an unfair comparison without comment.

That's the behavior I wanted to change, and it turns out to be a hard agent-design problem rather
than a UI problem: an agent that withholds an answer is indistinguishable from a broken one unless
the system can say precisely why it withheld it.

## What it does

Sift puts twelve plumbing bids for a school renovation on a single scope basis before it will rank
anything.

A Strands Swarm reads the bids, normalizes scope, verifies the price arithmetic, checks licences
and insurance, and tests schedule feasibility. Then the part I care about: the synthesis draft
ranks on raw quoted totals — the obvious answer — and **GoalLoop rejects it**, because the bids
aren't on a common scope basis yet, so ranking them would be false. The run emits
`goal.validation_failed` followed by `goal.validated` in the same pass.

Once the gaps are priced in, the arithmetic is checkable by hand. The $223,500 bid is silent on
permits and inspections ($18,000), shower-valve rough-in ($31,500), and debris haul-away ($6,000).
Adjusted, it's $279,000 — more than the $276,000 bid it appeared to beat by $52,500.

Two behaviors hold throughout:

**Credentials are a hard constraint, not a weighted criterion.** Reweight toward warranty and
deposit and Two Rivers Mechanical scores highest of all twelve — 91%, against the winner's 72%. It
still doesn't win, because its insurance certificate names "TRM Holdings LLC" rather than its
licence holder. The product flags it rather than removing it: "#11 of 12", the 91% still displayed,
"Flagged, not removed — still ranked, and still yours to decide." A second bid carries the same
flag on a different ground at #12.

**The agent recommends; the person awards.** `propose_award` is gated by a `Confirm` intervention.
The proposal sits pending with no approving actor until a human acts.

## How we built it

The system is split so that the part that must be trustworthy is also verifiable.

**`packages/core` is pure TypeScript.** Scoring, readiness, policy, and the state reducer live
there. It declares exactly one dependency (`@sift/contracts`) and its source contains no model
call, no network, no filesystem, no environment read. That's what makes "the ranking is arithmetic
the model never touches" a claim you can check rather than one you have to believe.

**And you can watch it happen.** The demo video's penultimate beat is the live call, not a description of one: a PDF goes in on camera, and the screen reports "A model read 6 values off this document and could not read 2", with the quoted total marked *Read from the document, Confidence 40%, Not verified*, and the credential field left empty because the document does not state it. The model proposes, declines to invent, and never claims verified.

**What the model does and does not do, stated plainly.** The Strands orchestration is real and
executes for real: `Swarm`/`Graph`, the vended plugins, the interventions, the lifecycle hooks and the
OpenTelemetry spans are all genuine SDK behaviour. The hero demo's model *responses*, however, are
served by a scripted `Model` implementation, so that trajectory is deterministic and reproducible — the
same 433 events every run, with no network and no credentials, which is what the release gates require.
The handoffs you see in the demo are therefore real Swarm handoff events along a fixed trajectory, not
routing the model chose at inference time.

Separately, a live `BedrockModel` path is now reached in production, not just unit-tested: the opt-in
bid-document reader (`SIFT_BID_DOCUMENT_READER_ENABLED=true`, `apps/agent/src/server.ts:240`) built a
real `BedrockModel` through `resolveModelProvider` and read an unstructured bid PDF's text into a
proposed option — real field extraction, real inference, HTTP 200 in 2.5 seconds. I ran Amazon Nova
Lite (`amazon.nova-lite-v1:0`) rather than Anthropic's model on Bedrock because the Anthropic models are
currently blocked on this AWS account pending their "Anthropic use case details" form; Nova has no such
gate and is also cheaper, so it's what I actually used. Every attribute that call produced came back
`origin: "agent_proposed"` and `status: "supported"` — never `verified` — because `packages/core/src/attributes.ts`
rejects a `verified` claim from anything but `origin: 'user'`. The model can propose; only a person can
attest. That boundary held on the first real inference call I ran against it.

What's still true: the hero bid-comparison Swarm does not use this path. `bid-comparison-engine.ts`
still constructs its scripted provider unconditionally, so the trajectory you watch in the demo is
still fixture-driven, on purpose, for the reasons above.

**Everything non-deterministic sits behind a Strands adapter,** using the SDK where it does real
work:

- Two multi-agent topologies from `@strands-agents/sdk/multiagent`, chosen per problem shape:
  a bounded **`Swarm`** for work whose ordering is a routing decision rather than a fixed pipeline — six specialists across
  scope, price, credential, schedule, source check and synthesis (6 nodes, 6 stages, 5 handoffs in
  a measured run), used by bid comparison and Home Energy Guardian — and a **`Graph`** where the
  order is fixed, used by car purchase.
- **`AgentSkills`** loading the technique the active obligation needs. It, the Context Injector and
  GoalLoop below are the SDK's own vended plugins (`@strands-agents/sdk/vended-plugins/skills`,
  `/context-injector`, `/goal`) — not Sift abstractions wearing Strands names, which an import line
  settles in a second.
- **Interventions** that are load-bearing, not decorative. `Guide` redirects the scope analyst when
  it repeats a query family with no new angle. `Deny` refuses the price analyst's reach for the
  licence registry — a tool this pack grants only to the credential checker — before it runs.
  `Confirm` gates the award.
- **Context Injector** supplying current weights, unresolved scope gaps, and remaining budgets each
  turn (28 injections in that run).
- **GoalLoop** with `maxAttempts: 2` and a callable validator.
- **Lifecycle hooks** (`BeforeToolCallEvent`/`AfterToolCallEvent`, `BeforeNodeCallEvent`/
  `NodeResultEvent`, `MultiAgentHandoffEvent`) feeding the activity stream and a Runtime Inspector
  without exposing chain-of-thought.

**The human-only boundary is structural rather than configured.** `packages/core/src/policy.ts`
rejects any approval whose actor isn't `human`, and the AgentCore command surface excludes the
review commands by construction rather than by check.

**The Strands usage is independently checkable.** `claim-evidence-matrix.md` maps each capability
to its implementing file, the test that fails if the claim stops being true, and the event name and
count in an exported run (`GET /api/debug/runs/:runId/export`). Re-verified on the run that appears
in the demo video (`run-8e8b57d5`): 433 runtime events, 28 context injections, 4 skill activations,
and 105 spans — every one of which carries `"otel.scope": "strands-agents"`, the SDK's own
instrumentation scope, with no other value present anywhere in the export. A local class named
after Strands cannot produce that.

The pack also declares the real rules its domain is governed by — FAR 13.104(b), N.C. Gen. Stat.
§ 143-132, comparable Idaho/Pennsylvania/Louisiana thresholds, licence and insurance scope
requirements — each with its citation, what Sift verifies itself, and what remains the human's
responsibility.

Sift additionally registers 26 tools over WebMCP; a real Chrome 152 build discovered, schema-read,
invoked and received results from the deployed page across 14 automated checks.

## Challenges we ran into

**The obvious fix was the wrong one.** Internal source IDs were leaking into the rationale users
read. Stripping them from the text would have quietly broken two other things: the goal validator
requires at least one citation to accept a synthesis, and the citation extractor scans that same
string to build the UI's citation chips. One string was serving validation, extraction and display
at once. The fix was to separate the display boundary and leave validation running on the raw text.

**A deterministic fixture is too fast to watch.** Scripted model turns return instantly, so a
complete six-specialist investigation finished in about six seconds. I added a pacing knob that
changes wall-clock only — identical events, counts and ordering — which takes the same run to 62.7
seconds when you need to see it happen.

**I built a gate nobody could pass.** The blind-spot review was offered whenever the required
topics were answered, without checking whether the pack declared any contextual check to review.
For the bid pack, which declares none, the app's primary action opened a panel saying there was
nothing in it. The source file's own comment reads "The pane must never be a dead end" — I'd
reached one through the front door.

**A test was protecting the bug.** An end-to-end spec asserted the help panel read "Ask Sift to
look into this", under a comment claiming the labels matched the real controls. They never had;
the button reads "Have Sift investigate." The assertion was faithfully locking in the defect.

## Accomplishments that we're proud of

The refusal is real and reproducible. It's a genuine Strands mechanism with a failed goal
validation followed by a passing one in the same run, on a ranking that every comparable product
would have shipped as an answer.

The deterministic core held. Under repeated pressure to let one useful effectful thing in, it still
declares one dependency and touches nothing external.

Flagging instead of eliminating. A bid that scores highest and still can't win, shown with its
winning score intact and the reason stated, is the honest form of a hard constraint and noticeably
harder to build than silently dropping it.

Every capability claim is traceable to a log record a judge can pull independently, rather than to
a paragraph asserting it.

## What we learned

**Green tests are not a working product.** The last round of defects all came from operating the
running product, never from reading code. 5,300 unit tests and 222 end-to-end tests proved the
machinery worked; none of them proved the experience did. Visual baselines detect *change*, not
*badness*, so a screen that has always been wrong passes indefinitely.

**Documentation drifts toward flattery.** The architecture diagram placed budget enforcement inside
the subgraph labelled "pure functions: no model, no I/O," contradicting the project's central
technical claim. Re-deriving it against the code rather than trusting the prior audit found three
false claims.

**"Not yet" has to be designed for.** Most of the hardest interface decisions were about making a
refusal read as rigor rather than failure.

## What's next for Sift

- Deploy the verified Strands execution path onto Amazon Bedrock AgentCore. The `/ping` and
  `/invocations` routes are implemented and tested against the local target; no AWS credentials
  existed in this build environment, so I'm stating that rather than claiming a deployment I didn't
  make.
- Contextual checks for the bid pack — bid bonds, prevailing wage, retainage. The mechanism exists;
  this pack declares none yet.
- Extend the pack-declared regulatory layer to more jurisdictions, with the same
  citation-and-responsibility discipline.
- More packs on the same spine. Neither the deterministic core nor the Strands adapter knows
  anything about plumbing — a pack is data.

---

## Built With (Devpost tags, comma-separated)

```
strands-agents-sdk, typescript, react, vite, tailwindcss, radix-ui, express, node.js, zod, drizzle-orm, sqlite, better-sqlite3, opentelemetry, webmcp, playwright, vitest, docker, railway, amazon-bedrock, amazon-nova
```

Every tag above is a real, load-bearing dependency, verified against `package.json` on 2026-09-13:
`@strands-agents/sdk` ^1.14.0, TypeScript ^6.0.3, React 19, Vite (via `@vitejs/plugin-react` ^6.1.0),
Tailwind CSS ^4.3.3, `radix-ui` ^1.6.7, Express ^5.2.1, Zod ^4.4.3, `drizzle-orm` ^0.45.2,
`better-sqlite3` ^13.0.3, `@opentelemetry/api` ^1.9.1, `@playwright/test` ^1.62.1, Vitest ^4.1.11,
plus the repo's own `Dockerfile` and the Railway deployment. `amazon-bedrock` and `amazon-nova`
reach the service through the same SDK, via its `BedrockModel` class — not a separate npm
dependency — and are verified live rather than by `package.json`: on 2026-09-14, with
`SIFT_BID_DOCUMENT_READER_ENABLED=true`, `POST /api/cases/:caseId/bid-documents/read` constructed a
real `BedrockModel` for **Amazon Nova Lite** (`amazon.nova-lite-v1:0`) on **Amazon Bedrock**, region
`us-east-1`, and returned a genuine model-read bid in 2.5 seconds. See "How we built it" above and
`claim-evidence-matrix.md` for the full record.

### One tag deliberately omitted

**Amazon Bedrock AgentCore.** The `/ping` and `/invocations` routes are implemented and verified
against the local target, but `release-metadata.json` records `agentCore.deployed: false` — no AWS
credentials existed in this build environment. Add this tag only if you deploy before submitting.

**Amazon Bedrock is no longer on this list.** As of 2026-09-14 it is a real, verified tag: live
inference reaches the bid-document-reading path described above. The scope is honest, not total —
the hero bid-comparison trajectory you watch in the demo is still deterministic by design, for the
release gates' no-network, no-credentials requirement, and does not use Bedrock. The tag is truthful
for the capability it names; it does not claim the hero trajectory is model-chosen.

Judges do check these against the repository. The AgentCore omission is recoverable later; a claim
that does not survive inspection is not.
