**Title:** Agents for Humans: building an agent that knows when not to answer

**Description (412/512):** My agent's first draft ranked twelve plumbing bids by quoted total and put a $223,500 bid on top. Wrong: once missing permits, rough-in, and haul-away scope are priced in, that bid is really $279,000, $3,000 more than the $276,000 bid it appeared to beat. A Strands GoalLoop validator catches it and forces a rewrite. Scoring runs in a pure TypeScript core with no model call. And the award still needs a person.

---

The first draft my agent wrote was the one every bid tool on the market would have shipped.

Twelve plumbing bids for a school renovation. The synthesizer looked at the quoted totals, put
Cedar & Sons at the top at $223,500, and wrote a tidy recommendation. It read well. It was wrong,
and not in a small way. Cedar's bid says nothing about permits, the shower-valve rough-in, or
debris haul-away. The other eleven bids price all three. Rank on quoted totals and you're rewarding
the bid that left the most out.

So the interesting part of Sift isn't that it produces a recommendation. It's that it throws that
one away.

## What actually rejects the draft

`decision-synthesizer` runs inside a Strands `Swarm` with a `GoalLoop` from
`@strands-agents/sdk/vended-plugins/goal`. `GoalLoop` takes a validator, a plain function that reads
the agent's output and returns pass or fail with feedback. Mine has two checks, in order, in
`apps/agent/src/runtime/bid-comparison-swarm.ts`:

1. The recommendation has to cite at least one source id. A recommendation with nothing behind it
   is unsupported, whatever the domain.
2. It has to rank on scope-normalized adjusted totals, not raw quotes. Concretely, the draft has to
   show an adjusted total and it has to reach Cedar's own adjusted figure. If it never gets there,
   it hasn't normalized scope, and it's rejected with feedback that says exactly that.

Attempt one fails the second check. The SDK reports the failure, Sift normalizes it into a
`goal.validation_failed` event, and the activity feed shows a line that reads "Draft withheld" with
the missing requirement under it. The feedback goes back to the synthesizer and it goes round again.
Attempt two prices in the three gaps. Permits, $18,000. Shower-valve rough-in, $31,500. Haul-away,
$6,000. Cedar lands at $279,000 against Northgate's $276,000. The bid that looked $52,500 cheaper
is $3,000 more expensive. That draft passes, and `goal.validated` follows `goal.validation_failed`
in the same run.

## The part the model never touches

The numbers in that paragraph don't come from the model. Scoring, ranking, readiness and the state
reducer live in `packages/core`, pure TypeScript with one dependency. No model call, no network, no
filesystem. The Strands side proposes. The core does the arithmetic. That's what lets me say "check
the maths yourself" and mean it.

It also means a constraint can outrank a score. Reweight the criteria toward warranty and deposit
and Two Rivers Mechanical scores highest of all twelve, 91% against the winner's 72%. It still
doesn't win. Its insurance certificate names a different company than its licence does. Sift
doesn't drop it. It leaves it ranked, 91% still showing, and says why. If you're the person signing,
that's the row you most need to see.

## Making a refusal read as rigor

The hard part wasn't the validator. It was the screen. A withheld draft looks like a failure unless
the interface says what it's waiting for. So "Draft withheld" names the unresolved questions,
coverage is shown separately from score, and an unknown is never rendered as a zero. Missing data
lowers coverage. It never quietly lowers a bid's score.

And the last step is a person's. `propose_award` sits behind a `Confirm` intervention. The proposal
stays pending, with no approving actor, until someone acts. The agent recommended Northgate. A
human awarded it.

## What I'm not claiming

The demo trajectory runs on scripted model responses, so it's deterministic: the same 433 events
every run, offline, which is what the release gates need. The `GoalLoop`, the validator, the
rejection and the retry are real SDK mechanics. The text being rejected is fixed. Real inference
runs on one path, document intake, where Amazon Nova Lite on Bedrock reads an uploaded PDF and
marks every value it read `agent_proposed`, never `verified`. Only a person can verify.

That's the whole idea. A confident answer you can't sign is worth nothing. This one can say "not
yet", and show you why.
