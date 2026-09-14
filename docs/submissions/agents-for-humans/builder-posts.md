# Builder posts — Agents for Humans

**Where these go:** builder.aws.com (AWS Builder Center), as separate Blog Posts.

**Why they exist:** the hackathon rules let a submission that advances to Stage Two earn up to
0.6 additional points by publishing a builder.aws Blog Post about the build. Each post is worth
0.2 points, up to three posts. Every title below already contains "Agents for Humans" per the
rule's title requirement.

**Before publishing:** Jordan should read each draft in full before it goes out. These are written
in first person under his name, and they describe things he did — a wrong comment he read and
repeated, a model swap he made, a bug he found in his own evidence log. He should confirm every
claim still matches what's true by the time he publishes, not just what was true when this was
drafted (2026-09-14).

---

## Post 1: Agents for Humans: the day I found out my agent never called a model

I built a bid-comparison agent on the Strands Agents SDK. It runs a `Swarm` of six specialists, a
`GoalLoop` that can reject its own draft, interventions that guide, confirm, and deny tool calls,
lifecycle hooks that stream to a Runtime Inspector, and OpenTelemetry spans that come straight out
of the SDK's own tracer. All of that is real, working code. And for most of the build, none of it
ever called a model.

Every response — every specialist's decision, every handoff, every synthesis draft — came out of a
scripted `Model` subclass called `ScriptedModelProvider`. It answers from pre-written turns keyed
to a "beat" id instead of doing inference. I knew that part. What I didn't know for a while was
that I'd told myself the wrong story about why, and I'd gotten that story from a comment I never
checked against the code.

There's a header comment at the top of `apps/agent/src/runtime/model-provider.ts` that used to say
the file's Bedrock path was "not wired into any production path," and that "their only callers are
in `model-provider.test.ts`." I read that, believed it, and repeated it — in notes, in my own head,
in how I described the project to myself. It sounded right. It had the shape of an honest
limitation, the kind of thing I'd want to admit if it were true.

It wasn't true. `apps/agent/src/server.ts:240` calls `resolveModelProvider` directly, building a
real `BedrockModel` whenever `SIFT_BID_DOCUMENT_READER_ENABLED` is set. I'd added that route
earlier and never gone back to update the comment describing the file it lived in. The comment was
dated, confident, and wrong, and it stayed wrong long enough that I started treating it as
established fact instead of a claim I should go verify.

I found the mismatch by tracing the flag through the server rather than by trusting the comment —
grepping for `resolveModelProvider`'s callers instead of reading its own description of itself.
When I fixed it, I didn't just swap the wording. I left the old sentences in, quoted, right above
the correction, with a note explaining why: a confident, dated, false comment is worse than no
comment, because no comment doesn't get repeated as fact. Deleting the wrong version quietly would
have hidden the actual lesson, which is that I need to check code against comments more often than
I check comments against code.

Once I knew the wiring itself was real, I wanted the inference behind it to be real too — not
theoretically reachable, but something I'd actually watched succeed. My first attempt used an
Anthropic model on Bedrock, since that's what the runtime spec names as the default
(`global.anthropic.claude-sonnet-4-6`). It failed immediately:

```
ResourceNotFoundException: Model use case details have not been submitted for this account.
Fill out the Anthropic use case details form before using the model.
```

That's an AWS account-level gate, not a bug in my code. I could have filled out the form and
waited. Instead I switched the model id to Amazon's own family — `amazon.nova-lite-v1:0` — which
carries no such gate on this account and, as a side effect, costs less per call. So that's what the
bid-document reader actually calls now, not because I have a preference between model families, but
because one of them worked immediately and the other one didn't.

I want to be precise about scope here, because it would be easy to overstate this. The hero
bid-comparison trajectory — the one you'd see in a demo recording — is still scripted, on purpose,
so it runs identically with no network access and no credentials, which is what the release gates
require. The live Bedrock path lives on exactly one route: the opt-in bid-document reader, gated
behind `SIFT_BID_DOCUMENT_READER_ENABLED`, off by default. It's real, and it's narrow, and both of
those things are true at once.

The way I check this now, instead of trusting a comment — including this one, eventually — is
`scripts/verify-bedrock.ts`. It loads config the same way the server does, builds a real
`BedrockModel` through the same `resolveModelProvider` function the server calls, sends one short
prompt through a real Strands `Agent`, and prints what happened instead of what I hoped happened.
The last time I ran it:

```
pnpm verify:bedrock
[sift] verify:bedrock: modelId=amazon.nova-lite-v1:0 region=us-east-1
[sift] verify:bedrock OK -- modelId=amazon.nova-lite-v1:0 region=us-east-1 latencyMs=486
```

That's a number from an actual round trip to Bedrock, not a sentence I wrote once and stopped
checking. The whole point of building that script was to stop being the kind of person who finds
out three weeks later that a comment was wrong the whole time.

---

## Post 2: Agents for Humans: Swarm or Graph, and why I used both

The first time I wired `GoalLoop` into the bid-comparison Swarm, it didn't see the text I expected.
`GoalLoop` is supposed to read an agent's own output and reject it when validation fails — in this
pack, a recommendation that ranks bids on raw quoted totals instead of scope-normalized ones. I had
the validator reading a plain text block off the response. It kept passing drafts it should have
failed.

The reason: every node inside a Strands `Swarm` gets its `structuredOutputSchema` built
automatically by the SDK — an optional `agentId`, a `message`, and an optional `context` — instead
of whatever schema I might otherwise have written for it. My validator needed to read
`handoff.message` inside a `strands_structured_output` tool-use block, not a `TextBlock`. Nothing
was wrong with `GoalLoop` itself. I was wrong about the shape a Swarm node's output actually takes.

There's a second constraint that shaped the code the same week: `GoalLoop` supports exactly one
instance per `Agent`. `decision-synthesizer` needed its own validator, separate from anything else
in the Swarm, so it's constructed as its own distinct `Agent` — invoked as an agent-tool from
inside the Swarm rather than folded into whichever specialist happens to finish last. That's not a
stylistic choice. It's what the SDK's one-`GoalLoop`-per-agent limit forces.

Both of those were debugging problems, and they're the reason I ended up understanding the two
multi-agent topologies as well as I do. Sift uses both: `Swarm` and `Graph`, both imported from
`@strands-agents/sdk/multiagent`. The choice between them wasn't a preference. It followed from
whether the next step in a run is a decision or a document.

Bid comparison runs `scope-analyst`, `price-analyst`, `credential-checker`, `schedule-analyst`,
`source-challenger`, and `decision-synthesizer` as a `Swarm`, because price verification and
credential checking can genuinely proceed independently of each other — each reads its own bid
document, and neither result changes what the other needs. Home Energy Guardian is a `Swarm` for
the same underlying reason: which specialist should run next depends on what the rate and weather
evidence actually turns up, so the order is a routing decision, not a fixed sequence.

Car purchase is a `Graph`, because its dependency structure doesn't change at runtime: deal and
ownership-cost specialists feed `source-challenger`, safety and household-fit specialists feed the
same `source-challenger`, and both paths converge on `decision-synthesizer`. There's no routing
decision being made — the edges are fixed before the run starts. Using a `Graph` there instead of a
`Swarm` isn't a downgrade. It's the honest data structure for a shape that doesn't need to route.

`AgentSkills`, Context Injector, and `GoalLoop` aren't things I built and named after Strands to
sound legitimate — they import directly from `@strands-agents/sdk/vended-plugins/skills`,
`/context-injector`, and `/goal`. That's checkable in one line: open the import statement and see
where it points.

Here's the part I want to be precise about, because it's the part most likely to get overstated.
The trajectory in a recorded demo is deterministic — the same handoffs, the same event counts,
every run — because the release gates require the product to work with no network access, and they
assert an exact event sequence offline. That determinism comes from the scripted `Model`, not from
the `Swarm` faking anything.

What's real is everything around that model call. The `Swarm` actually schedules six nodes,
actually enforces `repetitiveHandoffDetectionWindow`, actually emits `MultiAgentHandoffEvent` from
its own SDK code, and actually hands each tool call to the registered interventions before it runs.
In a measured bid-comparison run: 6 nodes, 6 stages, 5 handoffs, 28 context injections — numbers
that come from the Swarm's own bookkeeping, not from anything I computed by hand. What I won't
claim is that the model chose those handoffs. It didn't. The model's responses were scripted ahead
of time, so the routing decision, in the hero demo, was written down in advance. The routing
mechanism is real Strands behavior. The routing decision, this time, wasn't the model's.

One more thing I had to get right on purpose, not by accident: the `Swarm` has its own built-in
repeated-handoff detector — `repetitiveHandoffDetectionWindow` and
`repetitiveHandoffMinUniqueAgents` — that fails the whole run with a `FAILED` result if it trips.
Sift has a softer one of its own, `RetrySteering`, which guides a specialist after three
consecutive tool calls produce no new evidence. If the Swarm's hard detector tripped before Sift's
softer one did, a demo beat that's supposed to recover gracefully — repeated scope-differ calls,
then a `Guide`, then a handoff — would instead end the whole run in failure. So I configured the
Swarm's window wider than Sift's three-call threshold, deliberately, so it only ever acts as an
outer safety net and Sift's own steering gets there first, every time.

---

## Post 3: Agents for Humans: making a Strands agent prove it's really Strands

I have a document in this repo called `claim-evidence-matrix.md`. Its job is to map every Strands
capability I claim to a log line someone else can pull from a running instance of the app and check
themselves. Writing it caught something I would otherwise have shipped as true without ever having
seen it happen.

One row says interventions produce all three outcomes: Guide, Confirm, and Deny. `ScopeAuthorization`
— the handler that denies a tool call outside a specialist's grant — had been registered in both the
Swarm and the Graph from early on. But until 2026-09-05, no specialist in either demo trajectory
ever actually reached for a tool it wasn't allowed to use. So Deny had fired exactly zero times
outside a unit test that patched a model provider on purpose to force it. A live run I pulled
before I caught this had 308 events: 104 `proceed`, 1 `guide`, zero `deny`. I had been claiming a
capability that had never once appeared in the running product.

The fix wasn't in the intervention code — that part was already correct. It was in the trajectory.
I changed the scripted beat so `anomaly-investigator`, having measured a 42% usage anomaly, reaches
for `household-event-lookup` — a tool the compiled pack grants only to `home-systems-analyst`. Now
the guard actually refuses that call before it executes, and the exported log has a real
`intervention.deny` event to point at, with the tool name attached.

That's the shape of the whole observability layer here, not just that one row: it exists so I don't
have to ask anyone to take a sentence of mine on faith.

The mechanism is Strands' own lifecycle hooks — `BeforeToolCallEvent`, `AfterToolCallEvent`,
`BeforeModelCallEvent`, `AfterModelCallEvent`, `BeforeNodeCallEvent`, `NodeResultEvent`,
`MultiAgentHandoffEvent`. Every one of those is a real event the SDK fires, not something I
invented and named to sound like one. I attach handlers to them, normalize the payload into a
common shape, and push each event onto a queue tagged with a single trace id Sift mints once per
run. The result is one ordered log — tool calls, model calls, node starts and finishes, Swarm
handoffs, skill activations, interventions, GoalLoop attempts — that exports as a single JSON file
and reads like a transcript of what actually happened, not a summary of what the UI decided to
show.

The single strongest piece of evidence in that log isn't anything I built. It's something I didn't.
Every OpenTelemetry span in an export carries `"otel.scope": "strands-agents"`. That string is the
instrumentation scope baked into the SDK's own tracer — I registered a `NodeTracerProvider` and
called the SDK's own `setupTracer`, but I didn't write the spans, and I didn't choose that scope
name. In one measured run — `run-8e8b57d5`, the one that appears in the demo video — the export
carries 433 runtime events and 105 spans. Running `jq` over every span's `otel.scope` value in that
file returns exactly one distinct string: `strands-agents`. A local class I wrote and named after
Strands cannot produce that field. Only the real SDK's own tracer can, because the scope name is
compiled into it, not passed in by whoever calls it.

One more thing the log does on purpose: it says what it left out. Every export carries a
redaction manifest alongside the events, naming each field it withheld and why — model and user
content is stored as a length and a digest, never the text itself, so the log can't leak a prompt
even to someone who has full access to it. That's not just a comment describing the intent, either;
there's an automated test suite (`debug.test.ts`) that plants secret-looking values on purpose and
asserts they never show up verbatim in an export. The proof isn't just what's present. It's honest
about what isn't, which matters if you want the rest of it believed.

The trace id is what turns all of this from a pile of events into an actual explanation. Sift mints
one per run and stamps it on every tool call, model call, node transition, handoff, and span that
run produces, across however many specialists get involved. So when a Swarm handoff happens, I can
line up the exact `BeforeToolCallEvent`/`AfterToolCallEvent` pairs and OTel spans that surround it
and see, in order, what the specialist actually did before it handed off — not a summary I wrote
afterward, the real sequence.

That's the actual point of building this, past having a working demo. Anyone can write a paragraph
claiming their agent uses a framework seriously. What's harder to fake is a log a reader can pull
themselves — hit the export endpoint, run one `jq` filter, and see whether the field is actually
there. I'd rather someone check the `otel.scope` value than take my word for an architecture
diagram. The claim-evidence matrix exists so a judge, or anyone else, doesn't have to trust me.
They can read the run.
