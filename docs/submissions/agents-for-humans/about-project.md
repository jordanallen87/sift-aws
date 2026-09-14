## Inspiration

I wanted to build an agent that could say "not yet."

Bid comparison was the test case. Twelve bids come in for the same job. One is $52,500 cheaper than
the next. You can't tell whether that's a better deal or just less work, because bids don't arrive
comparable. Each one draws its own scope line, and the cheap one is usually cheap because it left
something out.

Bid levelling is already a product category. MeltPlan, Struvia, Buildr and Procore all sell it. None
of them refuse. They produce a ranking and hand you the judgment — "verify and adjust" is the pitch.
They'll rank an unfair comparison without mentioning that it's unfair.

That's what I wanted to change. It turned out to be an agent problem, not a UI one. An agent that
won't answer looks broken, unless it can say exactly why it stopped.

## What it does

Sift puts twelve plumbing bids for a school renovation on one scope basis before it ranks anything.

A Strands Swarm reads the bids, normalizes scope, checks the price arithmetic, verifies licences and
insurance, and tests the schedule. Then the part I care about. The synthesis drafts the obvious
answer — rank by quoted total — and GoalLoop throws it out, because the bids aren't on a common
basis yet, so that ranking would be false. The run emits `goal.validation_failed`, then
`goal.validated`, in the same pass.

Once the gaps are priced in you can check the maths by hand. The $223,500 bid says nothing about
permits ($18,000), the shower-valve rough-in ($31,500), or haul-away ($6,000). Add them and it's
$279,000. That's more than the $276,000 bid it appeared to beat.

Two things hold all the way through.

**Credentials are a hard constraint, not a weighting.** Reweight toward warranty and deposit and Two
Rivers scores highest of all twelve: 91%, against the winner's 72%. It still doesn't win. Its
insurance names "TRM Holdings LLC", not its licence holder. Sift flags it instead of dropping it —
"#11 of 12", the 91% still showing, "Flagged, not removed — still ranked, and still yours to decide."

**The agent recommends. The person awards.** `propose_award` is gated by a `Confirm` intervention.
The proposal sits pending, with no approving actor, until someone acts.

## How we built it

The part that has to be trustworthy is the part you can check.

`packages/core` is pure TypeScript. Scoring, readiness, policy and the state reducer live there. One
dependency. No model call, no network, no filesystem, no environment read. That's what makes "the
ranking is arithmetic the model never touches" something you can verify instead of something you
have to believe.

Everything non-deterministic sits behind a Strands adapter:

- Two multi-agent topologies from `@strands-agents/sdk/multiagent`. A bounded `Swarm` where ordering
  is a routing problem — six specialists, 6 nodes, 5 handoffs — for bids and home energy. A `Graph`
  where the order is fixed, for car purchase.
- `AgentSkills`, `ContextInjector` and `GoalLoop`, all from the SDK's own vended plugins. An import
  line settles whether they're really Strands or my own thing wearing the name.
- Interventions that do real work. `Guide` redirects the scope analyst when it circles the same two
  bids. `Deny` refuses the price analyst's reach for the licence registry, a tool this pack grants
  only to the credential checker. `Confirm` gates the award.
- Lifecycle hooks feeding the activity stream and a Runtime Inspector, without exposing
  chain-of-thought.

**What the model does, and what it doesn't.** The orchestration is real and runs for real. The hero
demo's model responses are scripted, so that trajectory is deterministic: the same 433 events every
run, offline, with no credentials, which is what the release gates need. So the handoffs you watch
are real SDK handoff events along a fixed path, not routing the model chose at inference time.

Real inference does run, on one path. The bid-document reader builds a real `BedrockModel` and reads
an unstructured PDF. I used Amazon Nova Lite, because Anthropic models are blocked on this account
pending AWS's use-case form, and Nova is cheaper anyway. You can watch it in the demo: it read six
values off the document, said plainly that it couldn't read two, and marked every one
`agent_proposed` at 40% confidence, not verified. `packages/core/src/attributes.ts` rejects a
`verified` claim from anything but a user. The model proposes. Only a person attests.

**All of it is checkable.** `claim-evidence-matrix.md` maps each capability to its implementing
file, the test that fails if the claim stops being true, and the event count in an exported run. On
the run that appears in the video: 433 runtime events, 28 context injections, 4 skill activations,
105 spans — every span carrying `"otel.scope": "strands-agents"`, with no other value anywhere in
the export. A class named after Strands can't produce that.

## Challenges we ran into

**The obvious fix was the wrong one.** Internal source IDs were leaking into the rationale people
read. Stripping them would have broken two other things: the goal validator needs a citation to
accept a synthesis, and the citation chips are built by scanning that same string. One string was
doing validation, extraction and display at once. The fix went at the display boundary, with
validation left running on the raw text.

**I built a gate nobody could pass.** The blind-spot review was offered whenever the required topics
were answered, without checking whether the pack declared any check to review. The bid pack declares
none, so the app's primary action opened a panel with nothing in it. That file's own comment reads
"The pane must never be a dead end." I'd reached one through the front door.

**A test was protecting the bug.** An end-to-end spec asserted the help panel read "Ask Sift to look
into this", under a comment claiming the labels matched the real controls. They never had. The
button says "Have Sift investigate." The test was faithfully locking in the defect.

## Accomplishments that we're proud of

The refusal is real and reproducible — a failed goal validation followed by a passing one, in the
same run, on a ranking every comparable product would have shipped as an answer.

The deterministic core held. Under repeated pressure to let one useful effectful thing in, it still
declares one dependency and touches nothing outside itself.

Flagging instead of eliminating. A bid that scores highest and still can't win, shown with its
winning score intact and the reason stated, is the honest form of a hard constraint. It's also
harder to build than dropping it quietly.

## What we learned

**Green tests aren't a working product.** The last round of defects all came from using the running
product, never from reading code. 5,300 unit tests and 222 end-to-end tests proved the machinery
worked. None of them proved the experience did. Visual baselines catch change, not badness, so a
screen that has always been wrong passes forever.

**Documentation drifts toward flattery.** The architecture diagram put budget enforcement inside the
subgraph labelled "pure functions: no model, no I/O", contradicting the project's central technical
claim. Re-deriving it against the code found three more false statements.

**"Not yet" has to be designed for.** Most of the hard interface decisions were about making a
refusal read as rigor rather than failure.

## What's next for Sift

- Deploy onto Amazon Bedrock AgentCore. `/ping` and `/invocations` are implemented and answer on the
  live deployment. Credentials exist now, so the honest reason this isn't done is that I didn't do
  it.
- Contextual checks for the bid pack: bid bonds, prevailing wage, retainage. The mechanism exists;
  this pack declares none yet.
- More jurisdictions in the pack-declared regulatory layer, with the same citation-and-responsibility
  discipline.
- More packs on the same spine. Neither the core nor the adapter knows anything about plumbing. A
  pack is data.
