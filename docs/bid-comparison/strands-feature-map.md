# Where every advanced Strands feature lands in the bid pack

The Agents for Humans rubric weights **Technological Implementation** on "how thoroughly and skillfully does the project use Strands Agents." Home Energy Guardian is currently the pack that carries that proof. Before retargeting the demo, every one of those capabilities needs a concrete home here — otherwise we trade a better *story* for a worse *score*.

This file does that mapping honestly, including the two places where this pack is genuinely **weaker** than energy.

Baseline for each row is what `docs/submissions/agents-for-humans/claim-evidence-matrix.md` already proves against a real exported run.

---

## The mapping

| # | Capability | Energy today | Bid pack | Strength |
| --- | --- | --- | --- | --- |
| S1 | Real SDK (`otel.scope: strands-agents`) | Every span | Unchanged — same runtime | **Same** |
| S2 | AgentSkills progressive activation | 4 skills, one per obligation | `scope-normalization`, `price-arithmetic`, `credential-verification`, `schedule-analysis` | **Same** |
| S3 | Bounded Swarm, model-decided handoffs | 6 specialists, 5 handoffs | scope-analyst → price-analyst → credential-checker → schedule-analyst → source-challenger → decision-synthesizer | **Same** |
| S5 | Context Injector | 19 injections/run | Current weights, plus which scope gaps are still unresolved | **Same** |
| S6 | GoalLoop, `maxAttempts: 2` | First draft cites no source, rejected | **First draft ranks on raw totals; validator rejects because scope is not normalized** | **Stronger** |
| S7 | Structured output via SDK | Typed `ExecutionResult` | Unchanged | **Same** |
| S8a | `Guide` (RetrySteering) | Weather lookup repeated with no new angle | scope-analyst re-reads the same bid hunting a permit line that is not there | **Same** |
| S8b | `Confirm` (ConsequenceGuard) | `propose_inspection` | **`propose_award` — awarding a contract, real money** | **Stronger** |
| S8c | `Deny` (ScopeAuthorization) | anomaly-investigator reaches for `household-event-lookup` | price-analyst reaches for `license-lookup`, granted to credential-checker | **Same** |
| S9 | Sessions and snapshots | Restore across confirmation | Unchanged | **Same** |
| S10 | OTel spans → Runtime Inspector | 76 spans/run | Unchanged | **Same** |
| S11 | AgentCore `/ping` + `/invocations` | Served, exercised | Unchanged | **Same** |
| — | Deterministic scoring, human-only approval | Real | Unchanged, and more legible: price vs completeness | **Same** |
| — | Evidence conflicts | Engineered into the demo | **Native — bids genuinely disagree about scope** | **Stronger** |
| — | Explicit unknowns held as unknowns | Real | **Native — the domain's own word for it is a "plug number"**. Cedar's warranty term seeds unknown, displays as "1 unknown", is answerable by a human, and scores as a neutral rather than being coerced to zero. See the correction below: it does **not** block readiness. | **Same** |
| — | Custom `custom.*` concerns | Supported | **"Does it include haul-away?" — the most natural instance of this feature we have** | **Stronger** |

**Result: nothing is lost, five things get materially better motivated.** The GoalLoop rejection stops being "the model forgot to cite a source" and becomes "these bids are not comparable yet, so ranking them would be a lie" — which is the product's actual thesis, doing visible work.

---

## A claim this file made and had to retire

**"Explicit unknowns block readiness" was false**, and it was stated here as a
strength. Writing the e2e journey disproved it: `evaluateReadiness`
(`packages/core/src/readiness.ts`) is driven purely by `ObligationState.status`,
and no obligation in this pack targets `bid.warranty_months`, so that unknown can
never appear as a readiness blocker. The spec now asserts it is *not* among them.

What is actually true is nearby, and is not weaker:

- The unknown **is held as an unknown**. It renders as "1 unknown", a human can
  answer it through the real editor, and it scores as a neutral rather than a
  zero — a bid with no stated warranty is not treated as a bid with no warranty.
- **Readiness genuinely is blocked**, by fail-closed degraded evidence.
  `bid.scope_normalization` and `bid.credential_verification` both end round 1
  `open` because each carries a non-stale `degraded` verdict — Cedar's incomplete
  scope diff and Two Rivers' named-insured mismatch. `packages/core/src/evidence.ts`
  forbids satisfaction while such a link is included, no matter how many other
  checks pass.

So the product does refuse to call the question closed, and it refuses for a
reason it can name. It simply does not refuse via the mechanism this file
claimed. Nothing in the demo changes; one sentence of the pitch does.

## The two honest losses

> **Revised 2026-09-06, after reading the track descriptions verbatim.** This loss is
> **Everyday-specific and disappears in the Professional framing.** The Everyday track's
> defining sentence is "the best ones run quietly in the background and only ping you when
> there's a real decision to make." The Professional track asks for something different
> entirely — "an agent that makes someone dramatically better at the work they already do,
> professionals, makers, creators, small-business owners. Target the repetitive,
> judgment-heavy tasks that eat their day" — with **no autonomy language at all**. Bids
> arriving because you asked for them is not a gap against a track that never asked for a
> trigger. Read the loss below as scoped to an Everyday submission.

**1. There is no background trigger.** Energy opens itself: a bill feed arrives, `evaluateBillFeed` finds 42% over baseline, and a case exists without anyone asking. That is the strongest evidence for "works quietly and surfaces you only for a real decision," and it maps to the Everyday track description almost word for word.

Bids arrive because you went and asked for them. There is no honest analogue, and **we should not invent one** — a fake "we noticed your quotes came in" watcher would be exactly the kind of staged autonomy the rest of this project refuses.

Mitigation: keep the energy pack in the repo and give it the versatility beat. The quiet-background claim stays provable; it just is not the hero.

**2. Anomaly arithmetic is deterministic and impressive.** `calculateEnergyAnalysis` does weather normalization and rate-change attribution — real math the model never touches, and a good answer to "is the model just guessing?" The bid pack's arithmetic is simpler: sum line items, add plug numbers, compare adjusted totals.

Mitigation: simpler is not weaker here, it is *auditable on camera*. A viewer can follow "$223,500 plus a $18,000 plug for the permits nobody priced equals $241,500" in a way nobody follows cooling-degree-day normalization. Trade sophistication for legibility deliberately, and say so.

---

## What gets reused unchanged

Effectively the whole engine. This is a retarget, not a rebuild:

- `packages/core` — obligations, evidence, readiness, scoring, criteria weights, human-only approval
- The Swarm runtime, interventions, plugins, event normalizer, OTel recorder
- The entire web workspace: activity stream, specialist panel, recommendation hero, approval card, criteria editor, Runtime Inspector
- Pack compiler, registry, conformance suite
- `SIFT_DEMO_PACING_MS`, the live-tailing dev view, the AgentCore routes

## What is genuinely new

- The pack manifest (criteria, obligations, specialists, skills, attribute definitions)
- Fixtures: twelve bids for one job, plus a license/insurance registry
- A `scope-differ` tool — compares line items across bids and reports what is priced in some and absent in others. **The one novel tool**, and the reason the demo works.
- Scripted beats for the Swarm trajectory
- Unit tests, scenario trajectory assertions, an e2e journey with baselines at six viewports
- A demo script

---

## The demo beat this is all for

1. Three bids for the same job. One is **$8,000 cheaper**.
2. The Swarm reads all three. `scope-differ` reports: bids A and C price permits and electrical; **bid B is silent on both**.
3. decision-synthesizer drafts *"take bid B, it is cheapest."*
4. **GoalLoop rejects it.** The bids are not on a common scope basis; ranking them would be false. The pane shows *Draft withheld*.
5. An obligation opens in plain words: *nobody priced the permits on bid B.* The person supplies the number, or marks it explicitly unknown.
6. Re-scored on an adjusted basis, **bid B is no longer cheapest** — and the recommendation flips.
7. `propose_award` requires human confirmation. The agent recommends; it never awards.

Every step is a real Strands capability doing work a person can see the point of, in a situation almost everyone has personally been in.
