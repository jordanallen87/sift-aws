# Sift

**Sift is a decision workspace where a person and an AI assistant drive the same case together.**

You are choosing between five cars, or working out why your power bill doubled. Sift holds that
decision as one live, shared object: your criteria, the candidates, the evidence gathered so far,
and what is still unknown. You can work on it through the visible page. An AI assistant — ChatGPT,
Claude, or any [WebMCP](#webmcp)-capable host — can work on the same case at the same time, through
the same commands, and you both watch it change in real time.

The part that makes it trustworthy is what the model is _not_ allowed to do. A deterministic
TypeScript core — not the model — owns case state, evidence validity, readiness, and the ranking
itself. Every number attached to a recommendation is computed from your criteria and the evidence
actually gathered, not asserted in prose. The model can research, propose, and explain. It cannot
approve a decision, and [none of the 26 WebMCP tools it is given can either](#no-tool-can-approve-a-decision).

Sift ships two versioned **Decision Packs**, each pinned by ID/version/compiled hash on the case
that uses it:

- **Choose Our Next Car** — compare shortlisted vehicles and dealer offers before buying. The
  WebMCP-first hero, built on a real Strands Graph.
- **Home Energy Guardian** — investigate why a utility bill changed. The AWS/Strands-first hero,
  built on a bounded Strands Swarm with specialist handoffs.

This is a dual-hackathon submission (the OpenAI WebMCP Challenge and the AWS Agents for Humans
Hackathon).

**Live deployment: <https://sift-hackathon-production.up.railway.app>**

---

## Contents

- [Quickstart](#quickstart)
- [The three demos](#the-three-demos)
- [WebMCP](#webmcp)
- [Architecture](#architecture)
- [How the ranking works](#how-the-ranking-works)
- [Testing and verification](#testing-and-verification)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Documentation map](#documentation-map)
- [License](#license)

---

## Quickstart

### Prerequisites

| Requirement     | Version                                                               | Notes                                                                                             |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Node.js         | `>=20` (`engines` in `package.json`); developed and tested on Node 22 | The Docker image uses `node:22-bookworm-slim`. There is no `.nvmrc`; any Node 20+ works.          |
| pnpm            | `11.24.0`, pinned via `packageManager`                                | `corepack enable` picks the pinned version up automatically.                                      |
| C/C++ toolchain | any working one                                                       | `better-sqlite3` compiles a native addon during install. See [Troubleshooting](#troubleshooting). |

Nothing else is required. Sift runs entirely offline after install — no API keys, no AWS account,
no network access.

### Install

```bash
git clone https://github.com/jordanallen87/sift-aws.git
cd sift-aws
pnpm install
cp .env.example .env
```

`.env.example` documents every supported variable (execution target, data directory, debug and
authoring toggles, model ID, AWS region, public origin). **Every default is correct for local
development** — you do not need to fill anything in, and there are no secrets to supply.

### Run it

Sift runs as two processes in development: the Express/Strands agent service, and the Vite dev
server for the React app, which proxies `/api/*` to the agent.

Terminal 1 — the agent/API service. It listens on port `8080` and runs its SQLite migrations
automatically and idempotently on every boot:

```bash
pnpm --filter @sift/agent start
```

You should see:

```text
[sift] agent listening on port 8080 (executionTarget=local, dataDir=.sift-data, migrationsApplied=0, migrationsAlreadyApplied=3)
```

Terminal 2 — the web app:

```bash
pnpm --filter @sift/web dev
```

**Open the URL Vite prints.** It is normally <http://localhost:5173>, but Vite silently moves to the
next free port if `5173` is taken and prints the one it actually used — read the terminal rather
than assuming.

To sanity-check the agent independently:

```bash
curl http://localhost:8080/ping
# {"status":"Healthy","time_of_last_update":1788496579}
```

### Or run it as one process

In production — and in the Docker image — there is no separate dev server: the agent serves the web
app's built bundle from its own origin. To reproduce that locally, build first, then start only the
agent and open <http://localhost:8080>:

```bash
pnpm --filter @sift/web build
pnpm --filter @sift/agent start
```

### What the browser remembers

Two things, both in `localStorage`, both scoped to the one browser, and neither of them case
content.

**`sift:activeCaseId`** (`apps/web/src/app/active-case-storage.ts`) is a pointer to the case that
was last open. On the next load Sift confirms that id still resolves against
`GET /api/cases/:caseId` and reopens it — so **a returning browser lands on the case, not the
launcher.** That is deliberate, not a bug: a right-hand pane gets closed and reopened constantly,
and losing your place every time would be worse. Only the id is stored; every field of the case is
re-fetched from the server rather than trusted from local state. If the id no longer resolves
(deleted case, a stale id from a different data directory), the pointer is cleared and you get the
launcher.

The consequence catches people out, so it is worth stating plainly: there is no in-app "back to the
launcher" control. **Reset demo** in the workspace toolbar (`aria-label="Reset demo"`, testid
`workspace-app-bar-reset-demo`) restarts that pack's demo case from its fixture under a _new_ case
id — a clean slate, not a way out. To get the launcher back, clear `sift:activeCaseId` (devtools →
Application → Local Storage) or open the app in a fresh browsing context.

**`sift:firstRunGuideSeen`** (`apps/web/src/app/first-run-storage.ts`) records that this browser has
already been shown the first-run guide. The guide appears once, on your first case in that browser,
and is marked seen the moment it opens rather than when it is dismissed — so a reload, a reset, or a
closed tab cannot make it reappear. The identical content stays permanently reachable from the
**"?"** Help control (`aria-label="Help and instructions"`) in the top row of every top-level
screen; both surfaces render one shared module,
[`apps/web/src/components/HowSiftWorks.tsx`](apps/web/src/components/HowSiftWorks.tsx).

---

## The three demos

Open the app. The launcher shows one primary action, **"Compare vehicles"**, and below it, under
**"Or try a finished example,"** the three finished demos.

### Choose Our Next Car (the WebMCP hero)

Click **"Choose our next car"**. This starts the car-purchase case from its checked-in fixture — a
fresh case ID every time. Then click **"Request investigation"** to drive the live Strands Graph.

The answer-first hero, the workspace view switcher (Quick Pick / List / Compare / Board), the
readiness state, and the findings all update in real time from the same server-sent event stream.
You can edit criteria and candidates and review the resulting recommendation as it forms.

### Compare these bids (the AWS/Strands hero)

Click **"Compare these bids"**. Three plumbing bids for one bathroom remodel: Northgate at
$18,400, Cedar & Sons at $14,900, Two Rivers at $19,250. One is $3,500 cheaper. The question the
pack exists to answer is whether that is a better deal or simply less work priced.

This runs a real bounded Strands Swarm across six specialists — scope analyst, price analyst,
credential checker, schedule analyst, source challenger, decision synthesizer. **All four Strands
control-flow beats fire in a single first run**, which is what makes it the hero:

- **A tool call is refused.** `price-analyst` reaches for `license-lookup`, a tool this pack grants
  only to `credential-checker`, and a real `ScopeAuthorization` intervention denies it before it
  runs. The activity stream says _"Action blocked"_ — and deliberately does **not** report a tool
  failure, because a refusal is not an error.
- **An agent is redirected mid-run.** `scope-analyst` compares the same pair of bids twice with no
  new angle, `RetrySteering` sends it to the third bid, and the specialist row reads
  _"Redirected once"_.
- **The obvious answer is rejected.** The first synthesis ranks the bids on their raw quoted totals.
  The real `GoalLoop` validator throws it out — not because it is badly written, but because the
  bids are not on a common scope basis, so ranking them would be false.
- **A consequential action stops for a human.** `propose_award` is gated by a real
  `ConsequenceGuard`. The proposal sits pending with no approving actor until a person acts. Sift
  recommends; you award.

Then the arithmetic anyone can follow: Cedar's $14,900 is silent on permits and inspections
($1,200), the shower-valve rough-in ($2,100), and debris haul-away ($400). Scope-normalized, it is
**$18,600 — more than the $18,400 bid it appeared to beat.**

Two things are worth doing yourself. First, note that Sift names a winner and **still refuses to
close two questions**: Cedar's scope comparison came back incomplete and Two Rivers' insurance
certificate names a different company than its licence holder. Evidence here is fail-closed, so a
degraded answer does not get to count as settled. Second, open **Add or adjust → Adjust
priorities**, raise warranty term and payment risk, and re-run. Two Rivers now scores highest of
the three — 81%, the largest number on the page — and still does not win, because credentials are a
hard constraint rather than a preference. It is not hidden either: it stays ranked at #3 of 3 with
its score showing and the words _"Flagged, not removed — still ranked, and still yours to decide."_

### Home Energy Guardian (a Strands Swarm that opens its own case)

Click **"Investigate my energy bill"**. A bill has posted at $248.50 against a weather-normalized
baseline of $175.00 — 42% over — and the case is already open before anyone is asked anything.

This runs a real bounded Strands Swarm across six specialists rather than a Graph. Four things in
it are easy to claim and hard to fake, and all four happen on every run:

- **A draft is refused.** `decision-synthesizer`'s first recommendation cites no source, the real
  `GoalLoop` validator rejects it, and the corrected retry is what reaches the case. You will see
  _"Recommendation draft rejected on attempt 1."_ in the activity stream, followed by the
  recommendation that replaced it.
- **An agent is redirected mid-run.** `weather-analyst` repeats a query family, a real
  `RetrySteering` intervention catches it, and the specialist row reports _"Redirected once"_.
- **The ranking changes when you change what matters.** Open **Add or adjust → Adjust priorities**,
  move the weights from cost-heavy toward long-term waste reduction, save, and ask Sift to look
  again. Round 1 recommends monitoring for one more cycle at 80%; round 2 recommends the HVAC
  inspection at 87%, and says which criterion decided it.
- **A consequential action stops for a human.** A real `ConsequenceGuard` gate means Sift will
  propose booking an inspection and never book one.

The reweight is worth doing yourself: it is the whole argument. The measured findings — tariff
attribution, weather normalization, the thermostat sensor-drift event — stay satisfied, because
changing what you value does not un-measure anything. Only the synthesis is redone.

### The Runtime Inspector

Any of the three demos can be opened up. Click the **"Developer view"** icon in the case header (always
available once a case is open, no run required), or **"Inspect run"** in the hero once a run is
active, which pre-targets the inspector at that specific run.

It shows real Strands TypeScript lifecycle-hook events — `BeforeToolCallEvent`, `AfterToolCallEvent`,
`BeforeModelCallEvent`, `AfterModelCallEvent`, plus `BeforeNodeCallEvent` / `NodeResultEvent` and
the Swarm's `MultiAgentHandoffEvent` — correlated by a Sift-minted trace id, with state diffs and
redactions applied. An activity item's "Inspect event" control jumps to its exact timeline entry.

Sift also registers a real OpenTelemetry `NodeTracerProvider` through the Strands SDK's own
`setupTracer({ provider })` (`apps/agent/src/runtime/otel-span-recorder.ts`, on by default, disable
with `SIFT_TRACING_ENABLED=false`), so the spans the SDK already emits are persisted into the same
`runtime_events` table with their real `span_id` / `parent_span_id` and span-measured durations —
roughly 75 spans for one car run. Setting `OTEL_EXPORTER_OTLP_ENDPOINT` additionally exports them
onward; unset, nothing opens a socket and a fixture run stays fully offline.

This ships as Overview + Timeline + **Execution** + Activity. The Execution tab (`RunGraphView`)
derives the run's stages from the recorded runtime events rather than drawing a fixed picture, so
it shows what that particular investigation actually did — for the car Graph, six nodes across
three stages with the first four genuinely concurrent.

The State / Context / Errors views described in
[`docs/specs/debugging-and-observability.md`](docs/specs/debugging-and-observability.md) are
tracked follow-on work, not yet built, and `setupMeter()` / OTEL metrics and W3C `traceparent`
propagation remain unbuilt.

### Beyond the demos: the vehicle catalog

Sift is a usable vehicle-comparison product on its own, not only a scripted demo. **"Compare
vehicles"** browses a bundled, fully offline catalog of real published vehicle specifications —
year, make, model, trim, body style, drivetrain, powertrain, combined fuel economy — sourced from
the EPA's public-domain fueleconomy.gov dataset (see [`docs/reuse-attribution.md`](docs/reuse-attribution.md)).
Build a 2–5 vehicle shortlist and start a real, persisted `car-purchase` case from it, using the
exact same commands the visible UI and WebMCP share (`startCase`, then one `upsertOption` per
vehicle). From there you can add listing facts, change criteria, submit sources, and record
findings.

One honest boundary: guided investigation (`requestInvestigation`) currently runs only against the
deterministic example case. On a catalog-built case it fails fast with a clear explanation rather
than crashing or fabricating a result. Every other capability works identically on both kinds of
case. See [`docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md`](docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md).

---

## WebMCP

Sift registers structured tools on `document.modelContext` — the WebMCP browser API — so an agent
host can operate the live page directly. Critically, **every WebMCP tool callback invokes the same
`SiftCommands` method the matching visible control invokes.** There is no WebMCP-only mutation path
and no second command implementation to drift.

### You need a WebMCP-capable browser

`document.modelContext` is not present in a stock browser. In a normal Chrome, Firefox, or Safari
tab, Sift detects the missing API and shows a non-blocking **"WebMCP unavailable in this browser"**
notice; the page stays fully usable through its visible controls. That is correct, tested fallback
behavior — not a bug, and not something to debug.

To actually exercise WebMCP you need one of:

1. **ChatGPT's WebMCP-capable in-app browser** — including ChatGPT desktop's right-hand pane. See
   [Opening Sift in ChatGPT desktop](#opening-sift-in-chatgpt-desktop).
2. **Chrome 152 or newer**, which ships WebMCP natively in Blink and exposes a `WebMCP` CDP domain,
   launched with the feature flags:

   ```text
   --enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport
   ```

`pnpm test:host` launches exactly that, with a throwaway profile — never your own — and drives the
page through the CDP `WebMCP` domain. It refuses to fall back to Playwright's bundled Chromium,
which has no WebMCP at all, and exits non-zero rather than reporting a hollow pass. Set
`SIFT_CHROME_PATH` if your Chrome is not in a standard location.

`pnpm webmcp:bridge` goes further: it is a stdio MCP server that maps MCP `tools/list` onto the
page's live WebMCP registrations and `tools/call` onto `WebMCP.invokeTool`, so **any** MCP client
can drive the real page with the real tool descriptions. See [Testing and verification](#testing-and-verification).

### Opening Sift in ChatGPT desktop

ChatGPT desktop's right-hand browser pane takes a URL directly, and Sift's 390–480px layout is
aimed at exactly that width. Point the pane at `http://localhost:8080` for a local single-process
build (see [Or run it as one process](#or-run-it-as-one-process)) or at the public URL, and it loads
like any other page.

One caveat first, because it decides how much weight to put on the rest of this section: this has
been checked by hand on macOS, and **the repository has no automated gate for ChatGPT desktop.**
Chrome 152+ is the only host verified end to end here, by `pnpm test:host`. A page cannot tell hosts
apart — `document.modelContext` is `document.modelContext` — so the page-side contract is the same
one those tests cover, but "it works in ChatGPT desktop" is a hand-checked setup note in this
README, not a tested claim.

**The footer strip is the diagnostic.** Once a case is open, Sift renders one line at the bottom of
the pane ([`apps/web/src/components/WebMcpStatus.tsx`](apps/web/src/components/WebMcpStatus.tsx))
straight from the real `adapter.supported()` check — there is no second, cosmetic indicator to
mislead you:

- **"WebMCP ready — a connected assistant can operate this page."** `document.modelContext` is
  present and Sift's tools are registered against it. This is what a correct setup looks like.
- **"WebMCP unavailable in this browser — every action is still available here."** The host has no
  WebMCP surface. That is the entire diagnosis: nothing you say to the assistant will reach the
  page, and reloading will not change it. Everything visible still works. See
  [Troubleshooting](#troubleshooting).

The strip renders in the case workspace, not on the launcher, so start or resume a case before
reading it.

#### Recording or demoing the pane

Two habits are worth adopting before you screen-share, both ordinary hygiene rather than anything
Sift requires:

- **Start a Temporary Chat**, so the session is not written to your conversation history.
- **Collapse the conversation sidebar**, so your chat titles are not on screen.

Both are ChatGPT application actions rather than Sift ones. Their current key bindings are listed
under ChatGPT's own keyboard-shortcut settings and are remappable per user, so this README names the
actions rather than the keystrokes.

#### What to ask it

Nothing in the pane tells an assistant what it can do — the 26 tools are not discoverable by looking
at the page, and only the 3 global read tools exist before a case is open. Sift therefore ships a
vetted list of example phrases in
[`apps/web/src/components/HowSiftWorks.tsx`](apps/web/src/components/HowSiftWorks.tsx), each
annotated with the tool it actually reaches. The annotation is type-checked, not documentary:
`phrase.tools` is typed against `SIFT_WEBMCP_TOOL_NAMES`, so an example citing a capability Sift
does not register fails `tsc`. The same list renders in the product, in the first-run guide and
behind the Help control. Three of them:

| Say                                                     | Tool it reaches              | What happens in the pane                                                   |
| ------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| "Look into the safety record on these."                 | `sift_request_investigation` | Starts a real investigation run; sourced findings arrive as they land.     |
| "What's driving the ranking?"                           | `sift_explain_ranking`       | Reads out Sift's own scoring, criterion by criterion, instead of guessing. |
| "Make ownership cost matter more than driving comfort." | `sift_update_criteria`       | Reweights the criteria, and marks whatever that invalidates.               |

Your own click and the assistant's call land on the same case, in the same pane, with no reload
between them — that is the shared-command claim, and it is what
[`pnpm test:journey`](#opt-in-suites-that-need-something-real) exists to check rather than assert.

### The tool catalog

**26 tools.** The single source of truth is `SIFT_WEBMCP_TOOL_NAMES` in
[`apps/web/src/model-context/register-sift-tools.ts`](apps/web/src/model-context/register-sift-tools.ts);
the count and the exact name list are asserted by `webmcp-contract.test.ts`, and the UI renders the
count from the same constant so the two cannot drift. Three tools are global and live for the whole
page session; the other 23 are registered and unregistered as a case becomes active.

| Category                    | Count | Tools                                                                                                                                                             |
| --------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read and context            | 7     | `sift_get_case_context`, `sift_list_packs`, `sift_get_option_details`, `sift_list_research`, `sift_list_notes`, `sift_get_decision_guide`, `sift_explain_ranking` |
| Options and candidates      | 3     | `sift_search_catalog`, `sift_upsert_option`, `sift_set_option_attribute`                                                                                          |
| Criteria and framing        | 3     | `sift_select_pack`, `sift_update_criteria`, `sift_define_case_attribute`                                                                                          |
| Evidence and notes          | 3     | `sift_submit_source`, `sift_set_evidence_disposition`, `sift_add_note`                                                                                            |
| Investigation and runs      | 2     | `sift_request_investigation`, `sift_request_revision`                                                                                                             |
| View and presentation       | 5     | `sift_set_view`, `sift_configure_comparison`, `sift_focus_option`, `sift_focus_evidence`, `sift_focus_question`                                                   |
| Adaptive discovery dialogue | 3     | `sift_get_interaction_context`, `sift_request_interaction`, `sift_record_discovery`                                                                               |

The spec assigns each tool one of four authority classes — READ (9), WRITE (10), PRESENTATION (5),
EXECUTION (2) — documented per tool in [`docs/specs/webmcp.md`](docs/specs/webmcp.md).

### No tool can approve a decision

This is a structural guarantee, not a prompt instruction, and it is asserted by tests rather than
claimed in prose.

The only method that can approve a decision proposal is `reviewProposal`
(`packages/core/src/policy.ts`), which is human-actor-only and whose sole caller is the visible
`ApprovalCard` control. **`register-sift-tools.ts` never calls it from any of the 26 tools.** The
nearby tools are shaped so a model cannot even ask:

- `sift_request_revision` calls `requestRevision`. Its input schema has no `decision` and no
  `actor` field — it can attach a revision request, never resolve one.
- `sift_record_discovery` records model inferences as _proposals only_; `actor: 'agent'` and
  `op: 'propose'` are hard-coded by Sift and absent from the tool's input schema.
- `sift_request_interaction` asks Sift to render a question to the human. It cannot supply markup or
  preselect an answer.
- `sift_get_interaction_context` returns `humanOnlyActions` explicitly, so the model is _told_ what
  it may not do rather than left to infer it.

Four test files assert this, most directly `apps/web/src/model-context/webmcp-contract.test.ts` →
`No tool can approve or reject a decision proposal`, which invokes every registered tool and
asserts `reviewProposal` is never reached.

---

## Architecture

Sift is a pnpm TypeScript monorepo.

```text
sift/
  apps/
    web/         React 19 + Vite right-pane app; WebMCP tool registration
    agent/       Express + Strands TypeScript service; also serves the built web app in production
  packages/
    contracts/   Zod schemas and shared API/event types
    core/        Pure case reducer, routing, obligations, evidence, readiness, scoring
    packs/       Decision Pack compiler, registry, built-in manifests, authoring tools
    catalog/     Bundled EPA vehicle dataset and bounded query functions
    scenarios/   Fixture data, scripted tools and model, scenario runner, trajectory assertions
    demo-studio/ Narration-led demo manifest validation and timing (demo tooling, not product runtime)
    trace-map/   Dependency-free projection of safe runtime signals into a run map; built and
                 tested, but not yet consumed by the Runtime Inspector UI
  tests/         contract, integration, scenario, e2e (Playwright), and opt-in live suites
  scripts/       verification orchestration, the sift CLI, report generation
  docs/          specs, ADRs, architecture diagram, submission materials
```

### The boundary that matters

Three responsibilities are deliberately kept apart:

- **The browser** owns visible interaction and WebMCP registration. It holds no authority.
- **The Express/Strands service** owns agent execution, intervention handling, and persistence.
- **`packages/core`** owns routing, obligations, evidence, readiness, and scoring. It imports no
  React, no Express, no Strands, no model provider, and no filesystem — so the rules that decide
  what is true about a case can be tested without a model, a browser, or a network.

Every canonical mutation is an append-only domain event, committed transactionally to SQLite
alongside its derived snapshot (`better-sqlite3` + Drizzle migrations, WAL mode). Two further
streams are written separately and **cannot mutate case state**: a sanitized `activity_events`
stream that feeds the real-time UI over server-sent events, and `runtime_events`, which feeds the
Runtime Inspector.

The canonical UI target is a 390–480px ChatGPT right pane, not a desktop dashboard scaled down
afterwards.

Full detail — the command/event flow, the canonical `CaseState` shape, the SSE contract, the
persistence schema, and the security boundaries — is in
[`docs/specs/architecture.md`](docs/specs/architecture.md). A rendered diagram is at
[`docs/architecture.png`](docs/architecture.png) (source [`docs/architecture.mmd`](docs/architecture.mmd),
regenerate with `pnpm docs:diagram`).

### Pack authoring

A local, bounded `pack-authoring` CLI (`pnpm sift pack:author`, gated behind
`SIFT_AUTHORING_ENABLED=true`) drafts, validates, tests, diffs, and — only with explicit human
confirmation — publishes a new Decision Pack. It is disabled by default and in the public
deployment. See [`docs/specs/pack-authoring.md`](docs/specs/pack-authoring.md).

---

## How the ranking works

Ask most AI shopping tools why something came first and you get a paragraph the model wrote. Sift
computes the ranking deterministically in `packages/core` from your criteria and the evidence
actually gathered, and shows its work line by line: what each criterion contributed, which way it
was scored, and what it could not score at all. Change a weight and the order moves immediately,
with no model call.

Four rules matter more than the arithmetic:

- **An unknown is never a zero.** An option nobody finished researching is not ranked last
  _because_ nobody finished researching it. Missing evidence lowers the stated **coverage**, never
  the score — so "82% of your criteria, measured across 45% of what matters" reads as the weaker
  claim it is.
- **A hard requirement flags; it never silently eliminates.** An option that fails something you
  called non-negotiable stays on the board, fully scored and clearly labelled, ranked last.
  Removing it on your behalf is not the software's call.
- **A disputed fact is not a settled one.** When sources contradict, the value still counts but is
  marked contested — and Sift tells you when the leader's lead actually _depends_ on it, verified
  by removing that criterion and checking whether the order flips.
- **Refuse rather than invent.** Mixed currencies, incomparable units, and free-text judgments are
  reported as not comparable instead of coerced into a number.

The same engine validates the model's own recommendation. When the model's favorite is not the
option your criteria put first, Sift says so plainly and caps its own confidence rather than
quietly overriding the model or quietly agreeing with it. On the shipped car demo it does exactly
that. See [`docs/decisions/0012-deterministic-scoring-and-insights.md`](docs/decisions/0012-deterministic-scoring-and-insights.md).

### A generic engine, not a car tool

A **Decision Pack** supplies the vocabulary, defaults, and orchestration for one class of decision;
a **case** is one person's use of a pinned pack version. The three built-in packs are not the limit of
the architecture.

Inside a comparison-shaped case, the workspace offers four ways to work — **Quick Pick**
(one-at-a-time triage), **List**, **Compare** (a configurable table, head-to-head at narrow
widths), and **Board** (movable status columns) — switchable by the person or by the assistant
through WebMCP, sharing one view state so the two stay in sync.

When someone raises a concern the pack never anticipated — _"I work on my laptop in the car and
need the console to support that"_ — Sift creates a typed, provenance-tracked custom comparison
field on the spot rather than forcing it into free text. The field renders beside native fields,
the assistant can populate it with sourced research, and an unsupported subjective judgment stays
honestly unknown rather than becoming a fabricated value.

---

## Testing and verification

### The release gate

```bash
pnpm verify
```

runs the ordered stages defined in `scripts/verify.ts`, fails fast on the first real failure, and
always writes a machine-readable report to `artifacts/verification/latest/report.json` (plus
`summary.md` on failure). It requires **no network access** once dependencies and Playwright
browsers are installed. The stages, all real:

| Stage              | What it runs                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `format:check`     | Prettier                                                                                               |
| `lint`             | ESLint at `--max-warnings=0`, plus a custom source scanner                                             |
| `typecheck`        | `tsc --noEmit` across the workspace                                                                    |
| `test:unit`        | the full Vitest suite                                                                                  |
| `test:coverage`    | the same suite, enforcing `vitest.config.ts` thresholds (branches 90%, functions/lines/statements 95%) |
| `test:pack`        | Decision Pack compiler and conformance                                                                 |
| `test:integration` | routes, store, DB, Strands adapter, engines                                                            |
| `test:contract`    | the WebMCP tool contract and the AgentCore routes                                                      |
| `test:scenario`    | deterministic hero-scenario trajectory assertions                                                      |
| `test:e2e`         | Playwright, after a real production build                                                              |

```bash
pnpm verify:release
```

runs `pnpm verify`, then `pnpm test:mutation` (real Stryker mutation testing), a production build
check, a Docker build contract check (honestly skipped with a reason if the `docker` CLI is absent,
never silently passed), and `pnpm test:submission`. It writes a separate report to
`artifacts/verification/release-latest/report.json` so both remain independently inspectable.

Any stage can be run on its own — `pnpm test:unit`, `pnpm lint`, `pnpm typecheck`, and so on.
`pnpm test:e2e` builds the production bundle and runs Playwright against the real Express server at
`390x844`, `430x900`, `480x900`, and `1440x1000`.

### Opt-in suites that need something real

These are excluded from `pnpm verify` because they need a browser, a network, or a deployment.

**`pnpm test:host`** — real-host WebMCP acceptance. Drives Chrome 152+ (see [WebMCP](#webmcp))
against a running instance:

```bash
SIFT_HOST_URL=https://sift-hackathon-production.up.railway.app pnpm test:host
```

It checks tool discovery before and after a case exists, that JSON schemas reach the host, that a
person's click is visible to the host and the host's write is visible in the pane without a reload,
that a write with no `expectedSequence` is refused, that no tool in the catalog can approve a
decision, an investigation from request to recommendation, reload persistence, and re-registration
after a host reconnect. Evidence lands in `artifacts/host-acceptance/<runId>/`.

It states its own two limits: it is **Chrome, not ChatGPT** (a page cannot tell hosts apart, so the
page-side contract is identical, but naming a product needs a session in that product), and **no
model chose anything** — the script picks every call.

**`pnpm test:journey`** — four turn-based journeys through the rendered pane in the same real
WebMCP browser. After every turn it evaluates three things separately:

| Kind        | Question                                               |
| ----------- | ------------------------------------------------------ |
| `data`      | Is the case state what this turn should have produced? |
| `ui`        | Does the pane show what a person should now see?       |
| `agreement` | Do those two describe the same case?                   |

```bash
SIFT_HOST_URL=http://localhost:8080 pnpm test:journey
SIFT_HOST_URL=http://localhost:8080 pnpm test:journey webmcp-hero
```

A turn is taken by the **person**, through visible controls, or by the **assistant**, through a real
WebMCP call. Interleaving them on one case is the only way to test the shared-command claim rather
than assert it. The journeys are `webmcp-hero`, `aws-hero`, `shared-control`, and `family-novice`.
Output lands in `artifacts/journey/<runId>/`.

**`pnpm webmcp:bridge`** — lets a _real model_ drive the page, which no scripted harness can. Point
any MCP client at it:

```jsonc
{
  "mcpServers": {
    "sift-page": {
      "command": "pnpm",
      "args": ["-s", "webmcp:bridge"],
      "env": { "SIFT_HOST_URL": "http://localhost:8080" },
    },
  },
}
```

It is a development tool, not part of the product, and it hands a model real control of a real
page: point it at a local build, not at anything whose state you care about.

**`pnpm test:deployed`** — exercises a live deployment rather than a local build:

```bash
SIFT_DEPLOYED_URL=https://sift-hackathon-production.up.railway.app pnpm test:deployed
```

It checks health and static assets, a real fixture case and investigation run, Runtime Inspector
availability, same-origin CORS, and — its core assertion — that a case survives a real Railway
redeploy byte-identically.

**`pnpm test:persona`** — three scripted people (a family novice, a landscaping business owner, and
someone arriving with one vehicle in mind) walked through the real stack in process, then checked
against eleven deterministic hard gates. The executor answers whatever Sift actually asks rather
than replaying fixed input, so the landscaping journey diverges from the family journey because the
pack's topics diverge, not because two scripts differ. It never invents a usability score — a run
with no diagnostic pass reports `scored: false` — and never reports a gate it could not check as
passing: accessibility, console/network, and unsupported-claim gates report `not_evaluated` with a
reason, because an in-process run has no browser console and no axe tree.

**`pnpm test:submission`** — the automated half of `docs/submissions/`. It checks that required
submission files exist, that README commands match real `package.json` scripts, that `LICENSE` is
present and MIT, that `.env.example` contains no likely secrets, that the architecture diagram
source and export exist, that fixture and reuse attribution is real, that both hero scenario
reports exist and passed, that the latest `pnpm verify` report's Git SHA matches the current commit,
and that required public URL fields are set. It never marks eligibility, country, submitter type,
or other personal and legal attestations complete — those stay human-only gates in the checklists
under `docs/submissions/`.

### Honest gaps

`pnpm test:observability` and `pnpm test:live` are **declared stubs**. They print an honest "not yet
implemented" message and exit `0`. Do not treat either as release evidence. See
[`docs/specs/testing.md`](docs/specs/testing.md) for the full intended verification pyramid and
which layers are real today.

---

## Deployment

The production image (`Dockerfile`) is a single-stage `node:22-bookworm-slim` build. It is
deliberately not multi-stage: `better-sqlite3` is a native addon compiled during `pnpm install`, and
the agent runs TypeScript directly via `tsx`, so the runtime container needs the same
toolchain-built `node_modules` either way. The image installs `python3`/`make`/`g++`, runs
`pnpm install --frozen-lockfile`, builds `apps/web` so `express.static` has a real bundle, and
starts the agent on port `8080`. Migrations run idempotently on every boot, including every restart
and redeploy.

The live deployment is on Railway, created with the Railway CLI:

```bash
railway whoami
railway up --new --name sift-hackathon --json -y --detach
railway volume add --mount-path /data --json
railway variable set SIFT_DATA_DIR=/data --json
railway domain --port 8080 --json
```

**Public URL: <https://sift-hackathon-production.up.railway.app>**

Current identifiers (workspace "JAllen's Projects"):

| Resource    | Name                                        | ID                                     |
| ----------- | ------------------------------------------- | -------------------------------------- |
| Project     | `sift-hackathon`                            | `1c02545d-5ed3-4ac6-82dc-fad2e09e8999` |
| Service     | `pax-hackathon`                             | `e98affa7-2756-4f5a-bbae-d3e84a06ced7` |
| Environment | `production`                                | `9e0c95c9-2f33-431a-93c3-1a592a069d00` |
| Volume      | `pax-hackathon-volume` (mounted at `/data`) | `477985d7-abfe-4216-8281-fa01b3e7b508` |

> **On the `pax-` names above.** The product was renamed from Pax to Sift on 2026-08-30. The Railway
> _project_ and its public domain have since been renamed to match, but the **service and volume
> deliberately keep their original names** — renaming live infrastructure mid-submission risks more
> than it tidies. These identifiers are recorded as they actually are, not as the product name would
> suggest. The database file inside the volume _was_ renamed (`pax.sqlite` → `sift.sqlite`);
> `apps/agent/src/db/connection.ts` adopts the existing file on first boot after the rename, so no
> deployed data was lost.

The deployment runs `SIFT_EXECUTION_TARGET=local`, which executes the Strands adapter in-process.
`SIFT_EXECUTION_TARGET=agentcore` is supported and points execution at a deployed Amazon Bedrock
AgentCore runtime instead, over the AgentCore `/ping` and `/invocations` contract. **This deployment
runs `local` because no AWS credentials were available at deploy time** — an honest, documented
external blocker rather than a missing feature. Both hero packs run end to end on the deployment as
it stands.

---

## Troubleshooting

**WebMCP tools do not appear / `document.modelContext` is undefined.**
Expected in any ordinary browser. WebMCP is not a polyfillable library; the browser has to
implement it. Use ChatGPT's WebMCP-capable in-app browser, or Chrome 152+ launched with
`--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport`. Sift's
"WebMCP unavailable in this browser" notice is the correct, tested fallback. See [WebMCP](#webmcp).

**Sift opens straight into a case instead of the launcher.**
Deliberate. The browser stores a pointer to the last open case under `sift:activeCaseId` in
`localStorage` and reopens it. "Reset demo" restarts the demo under a new case id rather than
returning you to the launcher — clear that key, or use a fresh browsing context, to get the launcher
back. See [What the browser remembers](#what-the-browser-remembers).

**`pnpm test:host` says no Google Chrome found.**
It refuses to fall back to Playwright's bundled Chromium, which has no WebMCP and would produce a
hollow green run. Point `SIFT_CHROME_PATH` at a Chrome 152+ binary.

**`better-sqlite3` fails to build during `pnpm install`.**
It compiles a native addon and needs a working C/C++ toolchain. On macOS: `xcode-select --install`.
On Debian/Ubuntu: `python3`, `make`, and `g++` — exactly what the Dockerfile installs. Node 20+ is
required.

**Port already in use.**
The agent defaults to `8080`; override with `PORT`, and update `apps/web/vite.config.ts`'s proxy
target to match. The Vite dev server defaults to `5173` but silently moves to the next free port
and prints the real URL — always read the terminal rather than assuming `5173`.

**The page is blank or 404s at `/` when only the agent is running.**
The agent serves `apps/web`'s static bundle only when `apps/web/dist` exists. Either run the Vite
dev server (which proxies `/api` for you), or run `pnpm --filter @sift/web build` first.

**`pnpm install --frozen-lockfile` fails after editing a `package.json` by hand.**
Run `pnpm install` without the flag to regenerate `pnpm-lock.yaml`, then re-run with the flag to
confirm it is reproducible.

**Do I need API keys, an AWS account, or network access?**
No. Fixture mode executes the complete product offline after install. All three demos, the
vehicle catalog, the deterministic scoring engine, the Runtime Inspector, and the entire
`pnpm verify` gate all run with no network and no credentials. AWS is only needed for the optional
`agentcore` execution target.

---

## Documentation map

| Path                                                             | What it holds                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`docs/specs/README.md`](docs/specs/README.md)                   | Canonical spec index and the precedence rule if two documents disagree |
| [`docs/specs/architecture.md`](docs/specs/architecture.md)       | Command/event flow, `CaseState`, SSE contract, persistence, security   |
| [`docs/specs/webmcp.md`](docs/specs/webmcp.md)                   | Every WebMCP tool, its schema, and its authority class                 |
| [`docs/specs/strands-runtime.md`](docs/specs/strands-runtime.md) | Graph, Swarm, skills, interventions, sessions                          |
| [`docs/specs/testing.md`](docs/specs/testing.md)                 | The intended verification pyramid and what is real today               |
| [`docs/decisions/`](docs/decisions)                              | Architecture decision records                                          |
| [`docs/submissions/`](docs/submissions)                          | Hackathon submission materials and requirement checklists              |
| [`docs/reuse-attribution.md`](docs/reuse-attribution.md)         | Every piece of code or data adapted from another source                |

If this README and a spec disagree, the spec wins — see the precedence rule in
[`docs/specs/README.md`](docs/specs/README.md).

---

## License

MIT — see [`LICENSE`](LICENSE).
