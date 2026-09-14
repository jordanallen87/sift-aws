# Agents for Humans: Swarm or Graph, and why I used both

Sift runs three decision packs on one engine. Two run as a Strands `Swarm`, one as a `Graph`. Both
come from `@strands-agents/sdk/multiagent`, and which one a pack gets isn't a preference. It
follows from whether the next step in a run is a decision or a document.

## Where the order is a routing question: Swarm

Bid comparison runs six specialists as a `Swarm`: `scope-analyst`, `price-analyst`,
`credential-checker`, `schedule-analyst`, `source-challenger`, `decision-synthesizer`. The order of
work is a routing question. Scope has to be normalized before a quoted price means anything,
because a bid that's silent on required scope isn't cheaper, it's incomplete. What the scope
analyst finds decides what the price analyst is handed. Home Energy Guardian is a `Swarm` for the
same reason: which specialist goes next depends on what the rate and weather evidence turns up.

## Where the order is fixed: Graph

Car purchase is a `Graph`, because its dependency structure doesn't change at runtime. The deal and
ownership-cost specialists feed `source-challenger`, so do the safety and household-fit
specialists, and both paths converge on `decision-synthesizer`. There's no routing decision to
make. The edges are known before the run starts. Using a `Graph` there isn't a downgrade. It's the
honest structure for a shape that doesn't need to route.

The plugins are the SDK's own. `AgentSkills`, `ContextInjector` and `GoalLoop` import from
`@strands-agents/sdk/vended-plugins/skills`, `/context-injector` and `/goal`. If you want to know
whether they're really Strands, open the import line.

## The part that's easiest to overstate

The trajectory you'd see in a recorded demo is deterministic. Same handoffs, same event counts,
every run, because the release gates require the product to work with no network and no
credentials. That determinism comes from a scripted `Model` subclass, not from the `Swarm` faking
anything.

What's real is everything around the model call. The `Swarm` schedules the six nodes, emits
`MultiAgentHandoffEvent` itself, enforces its own repeated-handoff detection, and hands every tool
call to the registered interventions before it runs. In a measured run: 6 nodes, 6 stages, 5
handoffs, 28 context injections. That's the Swarm's own bookkeeping, not numbers I computed by
hand. What I won't claim is that the model chose those handoffs. The routing mechanism is real. The
routing decision wasn't the model's.

Late in the build I tried closing that gap behind a flag, `SIFT_LIVE_SWARM_ENABLED`, off by
default. Turned on, it reaches Bedrock for real, then fails about 1.4 seconds in with "Model
produced invalid sequence as part of ToolUse". Same error, same node, on Nova Lite and Nova Pro. I
haven't root-caused it yet, so the deterministic trajectory is still the only one that runs end to
end, and the flag stays off.

## Two things the SDK taught me the hard way

**A Swarm node's output isn't a text block.** The first time I wired `GoalLoop` into the bid Swarm,
the validator kept passing drafts it should have failed. I had it reading a plain text block off
the response. But every Swarm node gets its `structuredOutputSchema` built by the SDK: an optional
`agentId`, a `message`, an optional `context`. The recommendation lives in `handoff.message` inside
a `strands_structured_output` tool-use block. Nothing was wrong with `GoalLoop`. I was wrong about
the shape.

**Two handoff detectors will race.** The `Swarm` has its own repeated-handoff detector,
`repetitiveHandoffDetectionWindow` and `repetitiveHandoffMinUniqueAgents`, and it fails the whole
run if it trips. Sift has a softer one, `RetrySteering`, which guides a specialist when a run of
tool calls produces no new evidence. If the Swarm's hard detector fired first, a demo beat that's
meant to recover would just die. So the Swarm's window is set wider than Sift's threshold, and
Sift's steering always gets there first.

And `decision-synthesizer` is its own `Agent` with its own `GoalLoop`, invoked as an agent-tool
rather than folded into whichever specialist finishes last. Its validator only ever sees the
recommendation, which is the only thing it knows how to judge.
