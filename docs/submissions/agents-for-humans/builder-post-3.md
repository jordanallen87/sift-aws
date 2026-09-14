**Title:** Agents for Humans: making a Strands agent prove it's really Strands

**Description (486/512):** I built a claim-evidence matrix mapping every Strands capability I claim to a log line a reader can check. Writing it caught a capability I'd never actually seen fire: a deny intervention with zero real occurrences. The fix was in the scripted trajectory, not the intervention code. The proof: Strands' own lifecycle hooks feed one ordered event log, and all 105 OpenTelemetry spans in an export carry the SDK's own otel.scope: strands-agents, a string only the real tracer can produce.

---

I have a document in this repo called `claim-evidence-matrix.md`. Its job is to map every Strands
capability I claim to a log line someone else can pull from the running app and check themselves.
Writing it caught something I'd otherwise have shipped as true without ever seeing it happen.

One row says interventions produce all three outcomes: Guide, Confirm, and Deny.
`ScopeAuthorization` — the handler that denies a tool call outside a specialist's grant — had been
registered in both the Swarm and the Graph from early on. But until 2026-09-05, no specialist in
either demo trajectory ever reached for a tool it wasn't allowed to use. Deny had fired zero times
outside a unit test built to force it. A live run I pulled before I caught this had 308 events: 104
proceed, 1 guide, zero deny. I'd been claiming a capability the running product had never produced.

The fix wasn't in the intervention code, which was already correct — it was in the trajectory. I
changed the scripted beat so `anomaly-investigator`, having measured a 42% usage anomaly, reaches
for `household-event-lookup` — a tool the compiled pack grants only to `home-systems-analyst`. Now
the guard refuses that call before it executes, and the exported log has a real `intervention.deny`
event to point at, with the tool name attached.

That's the shape of the whole observability layer: it exists so I don't have to ask anyone to take
my word for it.

The mechanism is Strands' own lifecycle hooks — `BeforeToolCallEvent`, `AfterToolCallEvent`,
`BeforeModelCallEvent`, `AfterModelCallEvent`, `BeforeNodeCallEvent`, `NodeResultEvent`,
`MultiAgentHandoffEvent`. Every one is a real event the SDK fires, not something I invented to
sound like one. I attach handlers, normalize the payload, and push each event onto a queue tagged
with a trace id Sift mints once per run. The result is one ordered log — tool calls, model calls,
node starts and finishes, handoffs, skills, interventions, GoalLoop attempts — that exports as one
JSON file and reads like a transcript, not a summary of what the UI decided to show.

The strongest piece of evidence in that log isn't anything I built. It's something I didn't. Every
OpenTelemetry span in an export carries `"otel.scope": "strands-agents"`. That string is the
instrumentation scope baked into the SDK's own tracer — I registered a `NodeTracerProvider` and
called the SDK's own `setupTracer`, but I didn't write the spans and didn't choose the scope name.
The trajectory is deterministic, so every run exports the same shape: 433 runtime events and 105
spans. Running `jq` over every span's `otel.scope` in that file returns
exactly one distinct string: `strands-agents`. A local class I wrote and named after Strands cannot
produce that field. Only the real SDK's tracer can, because the scope name is compiled into it.

One more thing the log does on purpose: it says what it left out. Every export carries a redaction
manifest naming each field it withheld and why — model and user content is stored as a length and a
digest, never the text itself. `debug.test.ts` plants secret-looking values on purpose and asserts
they never show up verbatim in an export. The proof isn't just what's present — it's honest about
what isn't, which matters if you want the rest believed.

The trace id turns this from a pile of events into an explanation. Sift mints one per run and
stamps it on every tool call, model call, node transition, handoff, and span in that run. So when a
handoff happens, I can line up the exact `BeforeToolCallEvent`/`AfterToolCallEvent` pairs and OTel
spans around it and see what the specialist did before it handed off — not a summary I wrote
afterward, the real sequence.

That's the point, past the working demo. Anyone can write a paragraph claiming their
agent uses a framework seriously. What's harder to fake is a log a reader can pull themselves — hit
the export endpoint, run one `jq` filter, see if it's there. I'd rather someone check `otel.scope`
than take my word for a diagram. The claim-evidence matrix exists so a judge doesn't have to trust
me. They can read the run.
