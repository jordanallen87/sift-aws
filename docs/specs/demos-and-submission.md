# Demo and Submission Specification

## Fixture philosophy

Both demonstrations use realistic, checked-in fictional data. Fixture tools perform real parsing, lookup, correlation, calculation, and source linking over that data. Model reasoning and Strands orchestration remain real in the live demo, while deterministic scripted models make the same scenario reliable in CI.

The UI labels fixture cases as demonstrations. No fixture uses a real person's address, account number, vehicle identification number, or utility identifier.

## Choose Our Next Car scenario — WebMCP hero

### Seed artifacts

- `household-profile.json`: budget, financing assumptions, commute, cargo/rear-seat needs, must-haves, and weighted preferences.
- `candidate-listings.json`: four fictional shortlisted crossover listings with year, trim, advertised price, mileage, and source URL.
- `dealer-offers.json`: out-the-door components, add-ons, APR, and term details, including one teaser price with conflicting mandatory terms.
- `ownership-assumptions.json`: insurance, energy/fuel, maintenance, depreciation, and financing assumptions shared across candidates.
- `safety-reliability-sources.json`: fictionalized source summaries with clear provenance and one material disagreement.
- `household-fit.json`: specification-derived fit plus explicit unknowns requiring human judgment or a test drive.

### Initial prompt

> Help us choose which car should advance from our shortlist. Show us what the listings hide, what the evidence supports, and what we still need to learn on a test drive.

### Required sequence

1. Sift routes to Choose Our Next Car and displays at least two concrete reasons.
2. The listing normalizer makes prices, terms, mileage, and trims comparable.
3. The Graph runs deal, ownership-cost, safety/reliability, and household-fit specialists before source challenge and synthesis.
4. Sift initially favors `candidate-rav4` under the seeded lowest-risk and fuel-cost preferences.
5. The user selects `candidate-rav4` in the page and asks ChatGPT: `I love this one. What would have to be true for it to beat our current favorite?`
6. ChatGPT calls `sift_get_case_context`, which returns that exact selected candidate, then requests focused deal investigation.
7. A dealer offer conflicts with the advertised teaser price because of mandatory add-ons and a longer financing term. The prior deal score becomes stale and `source-challenger` activates.
8. The user tells ChatGPT: `Driving comfort matters more to us than fuel economy.` ChatGPT calls `sift_update_criteria`.
9. The user adds: `We also need two dog crates to fit behind the second row without folding the seats.` This field does not exist in the installed pack. ChatGPT calls `sift_define_case_attribute` and `sift_update_criteria`, creating `custom.dog_crate_fit` plus a case-specific evidence question.
10. Sift uses known cargo dimensions where relevant but refuses to fabricate actual crate fit or driving comfort. It reopens household fit and creates explicit measurement/test-drive questions.
11. Normalized deal economics and the criteria changes revise the favored option to `candidate-crv`.
12. Sift proposes advancing the CR-V and one close alternative to the household's test-drive shortlist, with conditions that could change the ranking.
13. The agent cannot advance a candidate itself. The user approves the shortlist through the visible UI.

### Required final assertions

- every included material claim has at least one source;
- advertised and normalized out-the-door prices remain separately visible;
- the stale teaser-price score remains in history;
- the selected candidate in WebMCP context matches the page selection;
- `source-challenger` appears in the trajectory;
- a subjective unknown becomes a test-drive question rather than an invented score;
- `custom.dog_crate_fit` persists as a typed case extension, creates a case obligation, and does not change the compiled pack hash;
- the recommendation changes after deal normalization and criteria reweighting;
- queued, specialist, skill, tool, evidence, guided/waiting, recommendation, and completion events appear in order without page refresh;
- no `decision.approved` event has actor `agent`;
- reload produces the same decided snapshot.

## Home Energy Guardian scenario — AWS/Strands hero

### Seed artifacts

- `current-bill.json`: a bill 42% above the normalized baseline.
- `usage-history.json`: 18 months of monthly usage and charges.
- `rate-schedules.json`: prior and current tariffs and fixed fees.
- `weather-history.json`: heating and cooling degree-day summaries.
- `household-events.json`: HVAC maintenance and a newly failing thermostat event.
- `response-options.json`: monitor, change plan, request energy audit, request HVAC inspection.

### Initial instruction

> Watch my household energy bills. Investigate unusual increases quietly and only ask me when there is something worth doing.

### Required sequence

1. A deterministic bill-feed gate decides whether a case is warranted, and opens one only because the
   bill is 42% above baseline — past the 15% materiality threshold. The gate is invoked when the
   month's bill is checked; it is not a background poller, and this spec should not be read as
   promising one. What it does guarantee is that no energy case exists without the threshold having
   been met: `packages/scenarios/src/tools/bill-feed-gate.ts` is the single decision point, it reuses
   the one `DEFAULT_ANOMALY_THRESHOLD_PERCENT` definition rather than restating the arithmetic, and
   the refusal direction is proven against a real second fixture (`current-bill-normal.json`, 4.42%
   above baseline) that genuinely opens nothing.
2. Sift routes to Home Energy Guardian without requiring a human choice.
3. The anomaly check reaches E3 through deterministic baseline calculation.
4. Rate and weather analysis explain part but not all of the increase.
5. A plausible early `monitor-one-cycle` draft is rejected because household-change evidence is unresolved; the UI displays `Draft withheld`.
6. Repeated weather work produces no evidence delta. `RetrySteering` guides the run away from weather and the Swarm hands off from `weather-analyst` to `home-systems-analyst`.
7. The runtime activates home-event correlation rather than asking the user an open-ended question.
8. The thermostat event creates a supported HVAC hypothesis and the source challenger checks it.
9. Sift surfaces one human decision with three bounded options and stated remaining uncertainty.
10. The user or ChatGPT reweights the criterion from lowest immediate cost to long-term waste reduction.
11. The recommendation revises from `monitor-one-cycle` to `request-hvac-inspection` and passes GoalLoop validation.
12. `ConsequenceGuard` emits `Confirm` and saves a session snapshot before an inspection proposal is created.
13. The deterministic test restarts and restores the runtime, then the user approves creation of the proposal through the visible UI. The demo does not schedule anything.

### Required final assertions

- no human action is emitted before the engine completes rate, weather, and household-event investigation;
- all autonomous tools are fixture-backed and read-only;
- criterion reweighting invalidates the prior recommendation;
- confirmation precedes proposal creation;
- the trace contains AgentSkills activation, Context Injector use, a real Swarm handoff, `Guide`, GoalLoop rejection and recovery, and snapshot restoration;
- no scheduling or purchase event exists;
- reload produces the same approved proposal and case evidence.

## WebMCP demo moments

The recorded WebMCP demo must show the page already open in ChatGPT's in-app browser. Sift is a generic AI-assisted decision workspace; the car-purchase Decision Pack is its first polished shopping/comparison implementation (change-set, Purpose), and the demo should read as a case of that generic capability rather than as a car-specific product.

Car-buying moment:

1. The user selects the car they currently prefer.
2. The user tells ChatGPT: `I love this one. What would have to be true for it to beat our current favorite?`
3. ChatGPT calls `sift_get_case_context`, sees the selected candidate, and calls `sift_request_investigation` for its deal/fit obligations.
4. The page visibly challenges the teaser price, shows normalized cost, and updates the ranking.
5. The user says: `Driving comfort matters more than fuel economy.` ChatGPT calls `sift_update_criteria`; Sift creates test-drive questions rather than inventing evidence.
6. The user adds the two-dog-crate requirement. ChatGPT defines the case attribute, and the page immediately shows the new concern and its unresolved evidence question.

### Additional showcase moments (capability now exists; not yet proven end-to-end on camera)

Change-set §57 identifies this as a materially stronger WebMCP narrative than "ChatGPT changed a criterion." Two specific moments are named as deliberate showcases. The underlying capability they depend on is real today: `product.md`'s "Workspace views" (Quick Pick/List/Compare/Board) are implemented and wired into the live page, and all PRESENTATION-class WebMCP tools (`sift_set_view`, `sift_configure_comparison`, `sift_focus_question`) durably persist through the real `setView` command (see `webmcp.md` for the exact, current tool list and per-tool "Effect" status). What has **not** yet happened is recording or rehearsing these two moments as an actual demo take against the current build; they are recorded here as required demo beats to script and verify, not as claims that the video already contains them.

**Model reconfigures the comparison table (§58).** The user says: `Compare the CR-V, Forester, and RAV4, and only show me the things that matter most to us.` ChatGPT changes the view to Compare, limits the visible candidates to those three, and sets the visible rows — including any dynamic custom fields already defined — so the page visibly reconfigures without mouse/click automation. This must be shown alongside proof that the underlying decision criteria did not change: presentation filtering is not criterion mutation (change-set §54).

**Quick Pick shared focus (§59).** The user says: `Walk me through them.` ChatGPT switches the view to Quick Pick. The Forester appears; ChatGPT explains it from the same case context the page shows. The user swipes or taps Maybe; the next option becomes focused, and ChatGPT's subsequent context reflects the new focused option without the user having to restate which option they mean. This demonstrates genuine shared attention rather than the model working from stale or reconstructed screen text.

Energy moment:

1. The user tells ChatGPT: `Long-term waste matters more than the cheapest immediate option.`
2. ChatGPT calls `sift_update_criteria` and `sift_request_investigation`.
3. The criteria UI, active skill, activity ledger, and recommendation update on the page.

The video must show structured tool use rather than mouse automation.

## Competition-specific video structures

The submissions use separate edits. The complete scripts and live official requirements are maintained in `docs/submissions/`.

### WebMCP video — under three minutes

1. Show the working right-pane car case in the first 15 seconds.
2. Demonstrate shared selected-option context through `sift_get_case_context`.
3. Add an unanticipated household concern through WebMCP while work is active.
4. Show the Strands Graph redirect, skill activation, stale recommendation, honest unknown, and revised shortlist.
5. Show human-only approval and one correlated Runtime Inspector event.
6. Close with WebMCP as a live steering channel between the human, ChatGPT, page, and Strands team.

### Agents for Humans video — no longer than five minutes

Hero: `bid-comparison`, Professional Agents track. The complete shot list, exact UI strings, and
measured timings are `docs/submissions/agents-for-humans/demo-script-bid.md`; this is the
required-beats list this spec holds the film to, not a second shot list.

1. Establish the twelve-bid problem: the low bid is tens of thousands under the eventual winner, for a small GC with no full-time estimator.
2. Show a real Strands Swarm across six specialists, with a visible `Guide` redirect and a `Deny` refusal.
3. Show `GoalLoop` reject the obvious cheap-bid ranking and recover with a supported one.
4. Show the on-screen arithmetic that reverses the apparent low bid into the more expensive one.
5. Show fail-closed findings: obligations that stay open even after a winner is recommended.
6. Show a criteria reweight and a hard credential constraint that flags, rather than removes, a top-scoring bid.
7. Show `Confirm`-gated human award: the agent recommends, a person approves on camera.
8. Show proof of a real Strands runtime — an inspectable run's event, swarm, handoff, and span counts.
9. Close with Sift as an agent designed to know when it has not earned the right to answer.

## Capture and render toolchain

Neither video is shot or assembled by hand, and no session should build a
pipeline for it. The proven narrated-video pipeline and the portable
stills/clips kit both live in the `praetor` read-only reference repository,
and the operational reference for them — exact commands, prerequisites, and
the confirmed traps — is
[`docs/hackathons/demo-tooling/README.md`](../hackathons/demo-tooling/README.md).

Two constraints that bind regardless of which lane is used:

- `docs/reuse-source-map.md` makes `praetor` read-only reference and forbids
  importing it through a filesystem path. Those scripts are run in place or
  copied and adapted; they never become a Sift dependency.
- The caps this specification sets (WebMCP under 180s, Agents for Humans at or
  under 300s) are the ones that apply. The reference `compose.mjs` hardcodes a
  240-second cap from a different contest and must be changed.

## Submission deliverables

The repository must contain:

- `README.md` with problem, audience, features, architecture, setup, test, deployment, and demo instructions;
- an MIT `LICENSE` visible at repository root;
- `.env.example` containing names and explanations but no credentials;
- architecture diagram source plus exported image;
- public repository URL;
- public web URL;
- AgentCore deployment evidence and invocation instructions;
- WebMCP testing instructions for ChatGPT and compatible Chrome;
- automated verification report from the release commit;
- separate public demo videos: WebMCP under three minutes with audio and AWS no longer than five minutes;
- text descriptions tailored to each hackathon;
- the shared release checklist and exhaustive competition-specific requirements checklists under `docs/submissions/`;
- an optional AWS Builder post draft.

## Automated submission checks

`pnpm test:submission` fails when:

- required files are missing;
- README commands do not match package scripts;
- license is absent or not MIT;
- environment examples contain likely secrets;
- architecture diagram source or export is missing;
- fixture attribution is missing;
- either deterministic scenario report is absent or failed;
- the latest release verification SHA differs from the current Git SHA;
- the WebMCP recording is three minutes or longer, or the AWS recording exceeds five minutes, once the video files are present;
- required public URL fields remain unset in the release metadata.

The checker maps machine-verifiable checklist requirements to release metadata, files, URLs, test reports, or scenario evidence. It must never mark eligibility, country, submitter type, learning, career-value, AWS Builder ID ownership, rule agreement, or other personal/legal attestations complete. Those remain visible human gates in the Markdown checklists.

## Event-specific emphasis

### OpenAI WebMCP Challenge

Lead with the shared browser workspace: ChatGPT discovers page tools, acts on the current selection and state, and updates the same visual case the human controls. Emphasize usefulness, originality, thoughtful WebMCP use, and the quality of human-agent collaboration.

### AWS Agents for Humans

Lead with the refused ranking, dynamic Strands skills and specialists, typed interventions, session persistence, AgentCore deployment, and escalation only for a real decision. Enter the Professional Agents track.

The two submissions describe one project honestly; neither claims features that exist only in documentation or deterministic test doubles.
