# Agents for Humans demo video — shot-by-shot

Video URL: to be replaced after re-upload (previous cut: <https://youtu.be/T8Q0oQAExE4>) · Duration: measured at render, cap 300s
Narration: ElevenLabs · Rendered from `scripts/demo-video/manifest.json` by `scripts/demo-video/render.ts`

## What this demo is about

Ask a chatbot which of twelve contractor bids to take and you will have an answer in ten seconds.
Confident. Plausible. And if you are the one signing the award, you cannot use it. Sift is built
for the answer you can sign instead. You say what matters — price, warranty, a deposit schedule,
anything you name — and it works out what has to be established before it answers, goes and
establishes that with a real multi-agent Strands system, shows where every value came from, and
tells you plainly what it could not establish. It refuses to rank options that are not yet on a
common basis. The decision still lands with you: the agent recommends, a person confirms.

Twelve subcontractor bids for a school renovation are the worked example in this video, not the
product. The lowest one looks $52,500 cheaper than the eventual winner. Whether that is a better
deal or just less work priced in is the question the rest of the video answers.

## Shot list

### Beat 1 — The answer you can sign

**Narration:**
> "Ask a chatbot which of twelve contractor bids to take and you'll have an answer in ten seconds. Confident. Plausible. And if you're the one signing the award, you can't use it."
> "Sift is built for the answer you can sign. You say what matters. It works out what has to be established before it answers, establishes it, and tells you what it couldn't."

**On screen:** Opens on the launcher with the three pack tiles visible, then clicks "Compare
these bids" to open the Bid Comparison case.

### Beat 2 — Two Strands topologies

**Narration:**
> "Under the hood it's the Strands SDK, twice over. Where the order of work is a routing problem, a Swarm. That's bids, and home energy."
> "Where the order is fixed, a Graph. That's the car purchase. Three decision packs, one engine, and a pack is just data."

**On screen:** Two code stills, no live footage: `apps/agent/src/runtime/bid-comparison-swarm.ts`
lines 79–85, then `apps/agent/src/runtime/car-purchase-graph.ts` lines 65–70.

### Beat 3 — The core the model never touches

**Narration:**
> "The scoring is a separate deterministic core. One dependency. No model, no network, no filesystem."
> "So every number you're about to check was never touched by a model. Everything above that line is Strands."

**On screen:** A code still of `packages/core/package.json`, no live footage.

### Beat 4 — Twelve bids for the same job

**Narration:**
> "Twelve plumbing bids for a school renovation. Cedar and Sons is cheapest, by fifty-two and a half thousand. It also prices sixty-two and a half percent of the required scope."
> "Better deal, or pricing less work?"

**On screen:** On the Review stage's List view, the workspace scroller glides down through the
twelve bid cards.

### Beat 5 — A Swarm, steered mid-run

**Narration:**
> "One click starts a real Strands Swarm. Six specialists, five handoffs, each one a real handoff event from the SDK."
> "Each specialist loads only the skill its job needs. Four activations."
> "And every turn, a context injector hands it the weights, the open gaps and the budget. Twenty-eight injections."
> "Watch the scope analyst. Completed, redirected once."
> "It was circling the same two bids, so a Guide intervention pointed it at the third."

**On screen:** Clicks "Have Sift investigate"; the Investigation team panel fills in live across
six specialist rows, ending with the scope analyst reading "Completed · Redirected once."

### Beat 6 — Refused before it ran

**Narration:**
> "Here's a Deny. The price analyst reached for the licence lookup, a tool this pack grants only to the credential checker. Refused before it ran."
> "Not a failure. A boundary, recorded as one."

**On screen:** Opens the Runtime Inspector's Activity tab, scrolled to the entry: tool "not in the
declared allowlist for this run."

### Beat 7 — The agent refuses to answer

**Narration:**
> "Now the part that matters. GoalLoop runs the recommendation through a validator, and the validator throws out the first draft."
> "It ranked twelve bids that weren't on a common basis yet. Not a bad answer. A false one."
> "So it goes round again. Most tools would have shipped that ranking. This one refuses."

**On screen:** Same Activity tab, scrolled to the entry: recommendation draft "rejected on attempt
1."

### Beat 8 — The cheapest bid isn't

**Narration:**
> "Here's the maths, and you can check it. Cedar is silent on three things the others price. Permits, eighteen thousand. Shower-valve rough-in, thirty-one five. Haul-away, six thousand."
> "Corrected, Cedar is two seventy-nine against Northgate's two seventy-six. The bid that looked fifty-two thousand cheaper is three thousand more."

**On screen:** Back at the top of the workspace, the scroller glides down through the
recommendation rationale to the numbers named in the narration.

### Beat 9 — Unknown stays unknown

**Narration:**
> "It names a winner and still won't close two questions: a scope comparison that came back incomplete, and two bids that failed credential checks."
> "Unknown doesn't get rounded up to fine."

**On screen:** The amber findings banner is opened and its panel scrolled into view.

### Beat 10 — Scores highest. Still doesn't win.

**Narration:**
> "Change what you care about and the ranking moves. That's the deterministic core, not the model."
> "And the sixth criterion has no slider. Credentials are set by the pack. You can't weight your way past them."
> "Now Two Rivers scores highest of all twelve. Ninety-one percent, against the winner's seventy-two. And it still doesn't win."
> "Flagged, not removed. Still ranked, and still yours to decide."

**On screen:** Opens "Adjust priorities," fills five weight fields, saves, re-runs the
investigation, then centres the flagged Two Rivers card in the List view.

### Beat 11 — The person decides, on camera

**Narration:**
> "Awarding is gated by a Confirm intervention. The proposal sits pending, with no approving actor, until a person acts."
> "And I just did. I selected Northgate Plumbing."
> "Decided. The agent recommended. A human awarded. That line is structural."

**On screen:** Centres on the pending approval card, clicks "Select Northgate Plumbing," then
scrolls to the top where the case now reads "Decided."

### Beat 12 — Proof it is really Strands

**Narration:**
> "This is the Runtime Inspector. Four hundred and thirty-three events from that one run, all through the SDK's own lifecycle hooks, under one trace id."
> "The Swarm's own record: six nodes, five handoffs. And every span carries the SDK's own instrumentation scope."
> "And every mechanism you just watched has a test that fails if it stops being true."

**On screen:** Cycles the Runtime Inspector's Overview, Execution and Timeline tabs on the
round-1 run. Filmed right after beat 7 (the Inspector shows only the latest run, and round 2 would
overwrite it); `render.ts` places the footage back here.

### Beat 13 — Live, on Amazon Bedrock

**Narration:**
> "And here's how a bid actually gets in. Drop the PDF, and a real model reads it."
> "That's Amazon Nova, on Amazon Bedrock. Six values read off the document, and it says plainly it couldn't read two."
> "Quoted total, two hundred and forty-one thousand eight hundred. Read by a model. Confidence forty percent. Not verified. Only a person can verify."

**On screen:** Adds a new option, imports `harborview-bid.pdf`, and waits on a real Bedrock round
trip. The summary reads "A model read 6 values off this document and could not read 2," each value
marked "Confidence 40%. Not verified."

### Beat 14 — Close

**Narration:**
> "It refused to rank twelve bids until they were comparable. Flagged the highest scorer instead of hiding it. Left the award to a person."
> "That's an answer you can sign."

**On screen:** Scrolled to the top of the case for the closing card. (Manifest id `b13-close`;
its title field is blank.)

## Provenance of every claim

| Claim | File / line or event | How to check |
| --- | --- | --- |
| Swarm responses are scripted, not model-chosen routing | `bid-comparison-engine.ts` `scriptedModelFor` (~L450); header of `bid-comparison-swarm.ts` | Read the source header |
| Handoffs are real Strands SDK events along that fixed path | `MultiAgentHandoffEvent` from `@strands-agents/sdk/multiagent` | Runtime Inspector → Execution tab |
| 6 nodes / 6 stages / 5 handoffs | Runtime Inspector, Execution tab | Open a run's Execution tab |
| 433 events, 105 spans, every span `"otel.scope": "strands-agents"` | Runtime Inspector Overview + Export | Overview count; grep an exported run for `otel.scope` |
| 28 context injections, 4 skill activations | Runtime Inspector Overview ("context 28", "skill 4") | Overview tab, By category panel |
| Guide intervention redirects the scope analyst | Panel row "Completed · Redirected once"; Activity tab `intervention` event | Investigation team panel, or Activity tab |
| Deny blocks the price analyst's reach for the licence lookup | Activity tab: tool "not in the declared allowlist for this run" | Runtime Inspector → Activity tab |
| GoalLoop rejects attempt 1, validates attempt 2 | Activity tab "rejected on attempt 1"; `goal.validation_failed` then `goal.validated` | Activity tab, or exported run, `category: goal` |
| Cedar $223,500 + $18,000 permits + $31,500 rough-in + $6,000 haul-away = $279,000 vs Northgate $276,000 | `bid-cedar.json`, `bid-northgate.json` fixtures | Read the fixtures; checks by hand |
| Two Rivers 91% vs winner's 72% after reweight, still #11 of 12, insurance names "TRM Holdings LLC" | `ROUND2_CRITERIA_WEIGHTS`, `scripted-beats/bid-comparison.ts` | Apply the same weights; inspect List view card |
| `propose_award` gated by `Confirm`; proposal pending, no approving actor | Bid pack config; `approval-card-approve` control | Reach pending-award without approving |
| Beat 13 real inference: Nova Lite reads a PDF, returns "Harborview Mechanical LLC," $241,800, `agent_proposed`, confidence 0.4 | `take/timeline.json` → `observed.bedrockSummary` | Re-run the import; read the summary panel |
| No background loop in the runtime | No scheduler/cron in `apps/agent` runtime | Grep the runtime; every beat starts from a click |
| Final video runs at or under the 300s hard cap | `artifacts/demo/sift-aws-bid-demo-FINAL.mp4` | `ffprobe -show_entries format=duration ...FINAL.mp4` |

## What this demo does not claim

- **The swarm handoffs are a scripted, deterministic path, not model-chosen routing.** Nodes,
  handoffs and timeouts are real Strands mechanics; the model responses driving them are served by
  a scripted `Model` so the release gates can assert an exact event sequence offline. Never say
  "the model decided the handoffs."
- **No background loop exists in the runtime.** Every investigation, reweight and import here
  starts because a person clicked something on camera, not a quiet trigger.
- **AgentCore is not deployed for this submission.** `/ping` and `/invocations` exist in code, but
  this video shows no live AgentCore deployment.
- **The readiness score measures evidence coverage, not truth.** It says what has been checked,
  not that the underlying numbers are correct.
- **The fixture-backed run proves the app behaves correctly, not that Sift has plumbing-contracting
  expertise.** Twelve seeded bids exercise real scoring and routing code; the domain rules a pack
  declares are pack data, not a verified construction-procurement authority.
