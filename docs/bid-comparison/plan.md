# Build plan — `bid-comparison` pack

Decided 2026-09-06. This pack becomes the **AWS hero**. `home-energy-guardian` and `car-purchase` both stay registered and tested; nothing is removed.

## The scenario

Meridian Builders, a nine-person general contractor with no estimating department, is choosing between twelve subcontractor bids for the **plumbing scope of a restroom and locker-room renovation package**, released as a public bid through a regional plan room — the realistic bidder count for a commercial/public trade package of this size (real public bid tabs are public record; invitations reach every subcontractor on the plan room's distribution list, not a hand-picked handful). Scaled from an original three-bid, single-family-home version of this same scenario (2026-09-08) specifically because three bids is a chore a person will compare by hand, while twelve with mismatched scopes and credentials is exactly the case where a person gives up and sorts by the bottom-line number instead — the failure mode this pack exists to catch, demonstrated at the point on the curve where it actually matters.

| Bid | Contractor | Quoted total | Notable |
| --- | --- | --- | --- |
| A | Northgate Plumbing | **$276,000** | The recommendation |
| B | Cedar & Sons | **$223,500** | Missing 3 of 8 scope items — the scope-normalization beat |
| C | Two Rivers Mechanical | **$288,750** | Highest raw score under round 2's reweight — the hard-constraint beat |
| D | Fieldstone Plumbing Co. | **$268,000** | Lowest scope-normalized adjusted total of all twelve, and the only bid under A once scope is corrected — license class does not cover this scope |
| — | Summit, Ironclad, Parkside, Westbrook, Anchor, Crestview, Brightwater, Old Mill | $278,000–$315,000 | Also-ran bids with realistic variety in deposit, warranty, schedule; two (Westbrook, Brightwater) each have their own single-item scope gap |

Bid B is $52,500 under bid A's quoted total. It is cheaper because it is silent on three things the others price:

| Missing from bid B | Plug number (Northgate's own priced amount) |
| --- | --- |
| Permits and inspections | $18,000 |
| Shower-valve rough-in | $31,500 |
| Debris haul-away | $6,000 |

**Adjusted: B = 223,500 + 55,500 = $279,000 — now more expensive than A's $276,000.** The ranking flips, and it flips on arithmetic anyone can follow on camera.

Secondary evidence, so the board is not decided on one axis: B wants a 45% deposit (research says over 33% is a red flag, over 50% is alarming); B's warranty has no stated term; C's license is active but its insurance certificate names a different entity than the license holder; D's license itself is active and its insurance is correctly named, but its license class carries no plumbing trade endorsement for this scope of work — a third, genuinely distinct way a bid's credentials can fail.

## Criteria

| id | kind | direction | weight |
| --- | --- | --- | --- |
| `bid.adjusted_total` | preference | lower_better | 45 |
| `bid.scope_completeness` | preference | higher_better | 20 |
| `bid.payment_risk` | preference | lower_better | 15 |
| `bid.schedule_fit` | preference | higher_better | 10 |
| `bid.warranty` | preference | higher_better | 10 |
| `bid.credentials_valid` | hard_constraint | — | protected, not reweightable |

The reweight beat: move weight off `adjusted_total` toward `scope_completeness` and `payment_risk`, and the recommendation changes again — proving the deterministic core owns the ranking.

## Obligations

1. `bid.scope_normalization` — put all three on one scope basis (scope-analyst)
2. `bid.price_verification` — line items sum to total; allowances identified (price-analyst)
3. `bid.credential_verification` — licence covers this work, insurance active, named insured matches (credential-checker)
4. `bid.schedule_feasibility` — start date and duration credible (schedule-analyst)
5. `bid.award_recommendation` — synthesis, `dependsOnCriteria: true` so a reweight reopens only this one (decision-synthesizer)

## Specialists and skills

`scope-analyst` (skill `scope-normalization`, tools `bid-reader`/`scope-differ`) → `price-analyst` (skill `price-arithmetic`, tools `bid-reader`/`bid-calculator`) → `credential-checker` (skill `credential-verification`, tool `license-lookup`) → `schedule-analyst` (skill `schedule-analysis`, tool `bid-reader`) → `source-challenger` (tools `bid-reader`/`scope-differ`) → `decision-synthesizer` (tool `propose_award`).

## The Strands beats, placed deliberately

- **Deny** — `price-analyst` reaches for `license-lookup`, which the pack grants only to `credential-checker`. Refused before it runs.
- **Guide** — `scope-analyst` runs `scope-differ` twice on the same pair with no new angle; RetrySteering redirects it to the third bid.
- **GoalLoop** — first synthesis draft ranks on raw totals and is **rejected** because the scope basis is not normalized; the corrected attempt ranks on adjusted totals and cites the plug numbers.
- **Confirm** — `propose_award` is consequential; ConsequenceGuard gates it on human review before the proposal is recorded.
- **Explicit unknown** — until a plug number is supplied, bid B's adjusted total is unknown and readiness is blocked. This is the product's whole thesis.

## Files

**New**

- `packages/scenarios/fixtures/bids/{job,bid-northgate,bid-cedar,bid-tworivers,bid-summit,bid-ironclad,bid-parkside,bid-westbrook,bid-anchor,bid-crestview,bid-fieldstone,bid-brightwater,bid-oldmill,license-registry}.json` (scaled from three bid fixtures to twelve, 2026-09-08)
- `packages/packs/src/bid-comparison.ts` + `.test.ts`
- `packages/scenarios/src/tools/{bid-reader,scope-differ,bid-calculator,license-lookup}.ts` + tests
- `apps/agent/src/runtime/bid-comparison-swarm.ts` + `.test.ts`
- `apps/agent/src/runtime/scripted-beats/bid-comparison.ts` + `.test.ts`
- `apps/agent/src/runtime/bid-comparison-engine.ts` + `.test.ts`
- `tests/scenarios/bid-comparison.scenario.ts` + `.scenario.test.ts`
- `tests/e2e/bid-comparison-journey.spec.ts`
- `docs/submissions/agents-for-humans/demo-script-bid.md`

**Modified**

- `packages/contracts/src/commands.ts` — add `'bid-comparison'` to `DEMO_IDS`
- `packages/scenarios/src/tools/fixture-loader.ts` — bids fixture dir + schemas
- `packages/scenarios/src/tools/index.ts`, `packages/packs/src/index.ts` — exports
- `apps/agent/src/server.ts` — register pack, wire engine
- `apps/web/src/components/DemoLauncher.tsx` — third launcher entry
- `stryker.config.mjs` — add `bid-calculator.ts` and `scope-differ.ts` to `mutate`

## Waves

1. Fixtures + loader wiring ‖ pack manifest
2. Domain tools ‖ contracts/registration wiring
3. Swarm + scripted beats ‖ engine + server wiring
4. Scenario assertions + e2e ‖ demo script + submission docs

Full `pnpm verify` after every wave that touches runtime code. Nothing merges that leaves energy or car red.

## Non-negotiables

- No existing test weakened, no threshold lowered, no baseline updated without inspecting the image.
- The scripted provider stays a real Strands `Model`; the orchestration is genuine.
- `propose_award` can never be auto-approved; only `origin: 'user'` decides.
- Fixtures are invented and labelled fictional — no real contractor, licence number, or address.
