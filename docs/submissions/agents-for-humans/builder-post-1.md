**Title:** Agents for Humans: building Sift, an agent that knows when not to answer

**Description (479/512):** How I built Sift for Agents for Humans: a Strands agent for decisions a person has to sign. Six specialists in a Strands Swarm compare twelve plumbing bids, and a GoalLoop throws out the first draft because it ranked bids that weren't comparable. Scoring runs in a pure TypeScript core the model never touches. Amazon Nova Lite on Bedrock reads a PDF and admits what it couldn't. Deploying to Amazon Bedrock AgentCore caught a bug my tests missed. The award still needs a person.

---

The first draft my agent wrote was the one every bid tool on the market would have shipped.

Twelve plumbing bids for a school renovation. The synthesizer ranked them on quoted totals, put
Cedar & Sons on top at $223,500, and wrote a tidy recommendation. It read well. It was wrong. Cedar's
bid says nothing about permits, the shower-valve rough-in, or debris haul-away, and the other eleven
bids price all three. Rank on quoted totals and you reward the bid that left the most out.

Sift throws that draft away. This post is how I got there: what I built on the Strands Agents SDK,
where Amazon Bedrock comes in, what broke when I deployed to Amazon Bedrock AgentCore, and what I
still won't claim.

## The problem

Ask a chatbot which of twelve bids to take and you'll have an answer in ten seconds. If you're the
one signing the award, you can't use it. Ask why the third bid lost and it makes something up.
Change one priority and it starts over, with a different answer and the same confidence. And it
never tells you the bids aren't comparable yet. It just ranks them.

So I built the thing around the model. You say what matters. Sift works out what has to be
established before an answer is allowed, goes and establishes it, says plainly what it couldn't, and
leaves the decision with you.

## First decision: what the model is allowed to touch

Scoring, ranking, readiness and the state reducer live in `packages/core`: pure TypeScript, one
dependency, no model call, no network, no filesystem, no environment reads. Everything
non-deterministic sits behind a Strands adapter. The agents propose. The core does the arithmetic.

That boundary pays for itself all through this post. It's why I can tell you to check the maths by
hand. It's why an unknown is never scored as a zero: missing data lowers coverage, never a bid's
score. And it's why a constraint can outrank a score. Reweight toward warranty and deposit and Two
Rivers Mechanical scores highest of all twelve, 91% against the winner's 72%. It still doesn't win,
because its insurance names a different company than its licence. Sift doesn't drop it. It stays
ranked, 91% showing, with the reason next to it. If you're signing, that's the row you most need to
see.

The same engine runs three decision packs: subcontractor bids, a car purchase, a household energy
bill. A pack is data. Neither the core nor the Strands adapter knows anything about plumbing.

## Swarm where the order is a routing question, Graph where it isn't

Both come from `@strands-agents/sdk/multiagent`, and Sift uses both.

Bid comparison is a `Swarm` of six specialists: `scope-analyst`, `price-analyst`,
`credential-checker`, `schedule-analyst`, `source-challenger` and `decision-synthesizer`. The order
of work is a routing question. A quoted price means nothing until scope is normalized, so what the
scope analyst finds decides what the price analyst is handed. Car purchase is a `Graph`, because its
edges are known before the run starts. There's nothing to route, so the honest structure is a fixed
one.

The plugins are the SDK's own: `AgentSkills`, `ContextInjector` and `GoalLoop`, imported from
`@strands-agents/sdk/vended-plugins/skills`, `/context-injector` and `/goal`. The engine picks the next obligation from the current evidence
and loads only the skill that obligation needs. As findings land, what it does next changes.

## The draft that gets thrown out

`decision-synthesizer` runs with a `GoalLoop`. Its validator is a plain function with two checks.
The recommendation has to cite at least one source. And it has to rank on scope-normalized adjusted
totals, which in practice means it has to reach Cedar's own adjusted figure.

Attempt one fails the second check. Sift turns the SDK's failure into a `goal.validation_failed`
event, and the activity feed says "Draft withheld" with the missing requirement underneath. The
feedback goes back to the synthesizer. Attempt two prices in the gaps: permits $18,000, shower-valve
rough-in $31,500, haul-away $6,000. Cedar lands at $279,000 against Northgate's $276,000. The bid
that looked $52,500 cheaper is $3,000 more expensive. `goal.validated` follows in the same run.

Getting that validator right taught me my first Strands lesson. It kept passing drafts it should
have failed, because I had it reading a plain text block. The SDK builds every Swarm node's output as
structured output, and the recommendation lives in `handoff.message`, inside a
`strands_structured_output` tool-use block. `GoalLoop` was fine. I was wrong about the shape.

The second lesson: two handoff detectors will race. The `Swarm` has its own repeated-handoff
detection, and it fails the whole run if it trips. Sift has a softer one that guides a specialist
when its tool calls stop turning up new evidence. If the Swarm's detector fired first, a moment
designed to recover would just die. So the Swarm's window is set wider, and Sift's steering always
gets there first.

## Interventions, and the Deny that had never fired

Sift uses all three intervention outcomes. `Guide` redirects the scope analyst when it circles the
same two bids. `Deny` refuses the price analyst's reach for the licence registry, a tool the pack
grants only to the credential checker. `Confirm` gates `propose_award`: the proposal sits pending,
with no approving actor, until a person acts.

I nearly shipped one of those as a claim with nothing behind it. I keep a claim-evidence matrix that
maps every Strands capability I claim to a log line someone else can pull and check. Writing it, I
found `Deny` had fired zero times outside a unit test built to force it. The handler was registered
and correct, but no specialist in the demo trajectories ever reached for a tool it wasn't allowed. A
run I pulled had 308 events: 104 proceeds, one guide, no denies. The fix was in the trajectory, not
the intervention code, and now the export has a real `intervention.deny` event to point at.

## Proving it's really Strands

Strands' own lifecycle hooks (`BeforeToolCallEvent`, `AfterModelCallEvent`,
`MultiAgentHandoffEvent` and the rest) feed one ordered event log, stamped with a trace id Sift mints
per run. That log drives the activity feed and a Runtime Inspector, and it exports as one JSON file.
It carries no chain-of-thought. Model and user content is stored as a length and a digest, never the
text.

The best evidence in it is something I didn't write. The run in my demo has 433 runtime events and
105 OpenTelemetry spans, and every span carries `"otel.scope": "strands-agents"`. I registered the
tracer provider and called the SDK's own setup. The scope name is compiled into the SDK. A class I
wrote and named after Strands couldn't produce it.

## Bedrock: the one path with real inference

Here's the part that's easy to overstate, so I'll be exact. The main demo runs on scripted model
responses, so the trajectory is deterministic: the same 433 events every run, offline, with no
credentials. My release gates need that. The Swarm, the handoff events, the GoalLoop rejection and
the interventions are real SDK mechanics. The text being judged is fixed, and the model didn't
choose the handoffs.

Real inference runs on one path. The bid-document reader builds a real `BedrockModel` and reads an
unstructured PDF. Anthropic models were blocked on my account pending AWS's use-case form, so I used
Amazon Nova Lite, which is cheaper anyway. In the demo it reads six values off the document, says
plainly that it couldn't read two, and marks every one `agent_proposed` at 40% confidence.
`packages/core` rejects a `verified` claim from anything but a user. The model proposes. Only a
person attests.

I tried going further, with a flag (off by default) that runs the whole Swarm live on Bedrock. It
fails about 1.4 seconds in with "Model produced invalid sequence as part of ToolUse", on both Nova
Lite and Nova Pro. I haven't root-caused it, so the flag stays off.

## Shipping it to AgentCore

The last stretch was deploying the agent service as an Amazon Bedrock AgentCore Runtime. AgentCore
wants an arm64 container listening on port 8080 that answers `/ping` and `/invocations`. The service
already had both routes. It still took four fixes, and only the first one was about my machine.

- Docker wouldn't start on my laptop, so I built the arm64 image in AWS CodeBuild from the repo's
  own Dockerfile and pushed it to Amazon ECR.
- The runtime crashed on its first start. The service tried to create its data directory next to the
  app, where it had no write permission. Pointing `SIFT_DATA_DIR` at `/tmp` fixed it.
- Then every call that changed anything failed. Sift requires an idempotency key on mutating
  requests and only read it from a header. AgentCore's invoke API forwards no custom headers. Every
  test passed, because every test sent the header. The key can now travel in the request body, and
  there are tests that call the service the way AgentCore does.
- The runtime had no way to open a case, so `/invocations` gained a `startDemo` action.

After that, through AgentCore's own `InvokeAgentRuntime` API, it opened the twelve-bid case, ran the
full Strands investigation, and returned a ready recommendation for Northgate, with the Cedar scope
correction in its rationale.

What I won't claim: the web app still runs its investigations in-process rather than through
AgentCore, and I haven't correlated AgentCore's traces with the Runtime Inspector yet. Both are next.

## What I'd tell myself at the start

Green tests aren't a working product. I had 5,300 unit tests and 222 end-to-end tests, and the last
round of real defects all came from using the product. One end-to-end test was faithfully locking in
a bug: it asserted a help-panel label that never matched the real button.

And "not yet" has to be designed for. A withheld draft looks like a failure unless the screen says
what it's waiting for. Most of the hard interface work was making a refusal read as rigor.

The agent recommended Northgate. A person awarded it. That's the split I was building for.
