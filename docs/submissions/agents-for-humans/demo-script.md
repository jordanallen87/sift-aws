# Agents for Humans demo video — shot-by-shot recording script

> **Capture toolchain — do not improvise one.** A proven narrated-video
> pipeline already exists (ElevenLabs narration, ffmpeg segments, crossfades,
> captions) in the `praetor` reference repository, along with a separate,
> portable stills/clips kit. Read
> [`docs/hackathons/demo-tooling/README.md`](../../hackathons/demo-tooling/README.md)
> **before recording anything** — it carries the exact commands and six traps
> confirmed in that source, including a hardcoded 240-second cap that is wrong
> for this video and a transition-duration default mismatch that silently
> drifts the captions.

Target: **no longer than 5 minutes**, public audio, published video. This script hits, in order, the seven required beats in `docs/specs/demos-and-submission.md` ("Agents for Humans video — no longer than five minutes"). Every quoted UI label and event string below was cross-checked against the actual component source and, where noted "(live-verified …)", against the real deployed product on 2026-08-27 using Playwright against `https://sift-hackathon-production.up.railway.app`, and against `apps/agent/src/runtime/home-energy-swarm.test.ts`. Where the live product genuinely cannot do something the spec describes, this script says so plainly and routes around it honestly instead of scripting a moment that won't happen on camera.

> **Before you record: start the service with `SIFT_DEMO_PACING_MS=250`.** Without it there is nothing to watch. A scripted model turn returns instantly, so a complete six-specialist investigation finishes in **298ms** and emits its entire activity stream in about a second — the Investigation team panel snaps to "all done" and the Runtime Inspector's Timeline is already full before you can toggle to it. Measured with pacing at 250: the same run takes **5.8 seconds** and emits 317 events, which reads as live, gives beat 2 something to narrate over, and lets you open the dev view **mid-run** and watch the log tail in. Nothing else changes — identical events, counts and ordering, paced or not. The delay is added to a model call that would really have latency with a live Bedrock model; the fixture is what removed it. See `.env.example`.

**Total runtime budget: 5:00.** Beats below sum to exactly 300 seconds; land under it, not on it.

> **The 2026-09-05 additions push past 300s and you must rebalance before recording.** Three new moments were added that did not exist when the timings were set: the `Deny` / "Action blocked" pair in beat 4 (~20s), the live AgentCore `/invocations` refusal in beat 6 (~30s), and the corrected demo-switch path in beat 7. If you keep all three — and the AgentCore refusal is the strongest single moment in this video for an "Agents for Humans" judge, because it is the authority boundary proved on the one transport an autonomous agent would actually use — take the time back from beat 6's release-report sub-beat (the `report.json` walkthrough narrates what the repository already documents) and from beat 2, which can lose ~15s without losing the Swarm-filling-in shot. **A run over five minutes is disqualifying; the rules cap it, not the taste.** Time a full rehearsal with a stopwatch before the real take.

**This script's "(live-verified …)" claims predate the 2026-08-30 workspace redesign (ADR 0004) and are now stale for on-screen positions.** The former separate "Recommendation" and "Approval" cards this script scrolls to are now composed inside one merged hero region (`RecommendationHero`) rather than being independently scrolled-to cards; the required beats and event names below are unchanged, but re-verify exact scroll targets and card boundaries against the live build before recording.

**2026-09-05 pass.** Nine commits landed the same week that changed what this pack does: the default criteria weights moved from 50/50 to 80/20 (`energy.cost`/`energy.conservation` in `packages/packs/src/home-energy-guardian.ts`), a criteria reweight now genuinely reopens and re-runs the response-options synthesis (`ObligationTemplate.dependsOnCriteria`), the premature draft is now actually rejected and shown as `Draft withheld` rather than only proven by a unit test, and a real **Adjust priorities** control now exists in the app bar. Every beat below was rewritten against the current source (`packages/packs/src/home-energy-guardian.ts`, `apps/agent/src/runtime/home-energy-engine.ts`, `apps/agent/src/runtime/recommendation-scoring.ts`, `apps/agent/src/runtime/scripted-beats/home-energy-guardian.ts`, `apps/web/src/components/CriteriaEditor.tsx`, `apps/web/src/components/SpecialistActivityPanel.tsx`, `apps/web/src/components/RuntimeInspector.tsx`) rather than against a fresh browser recording — **rehearse the whole script once in a real browser before you record**, the same way the rest of this document already asks you to.

---

## Before you record — read this in full

1. **URL.** `https://sift-hackathon-production.up.railway.app`. No login required.
2. **Fresh case.** Click **"Investigate my energy bill"** on the launcher (label verbatim from `apps/web/src/components/DemoLauncher.tsx`). This resets to the checked-in fixture and mints a fresh case ID.
3. **This deployment runs `SIFT_EXECUTION_TARGET=local`, not AgentCore.** The AgentCore container deployment was not completed before the deadline; the `/ping` and `/invocations` routes are implemented and answer on the live deployment — the beat that mentions AgentCore/CloudWatch below is explicitly conditional and only recorded if you have since deployed to AgentCore with real credentials. Do not fabricate an AgentCore screen.
4. **`pnpm verify:release` is real now — this note is stale and describes an earlier state of the repository.** Per the current `README.md`, `pnpm verify:release` runs `pnpm verify` plus real Stryker-based `test:mutation`, a production build check, a Docker build contract check, and `pnpm test:submission`, writing its own report to `artifacts/verification/release-latest/report.json`. `test:observability` and `test:live` remain honest declared stubs (they print "not yet implemented" and exit 0) — confirm which specific stage you are showing on screen and describe it accurately; do not claim `verify:release` itself is a stub. Regenerate whichever report you show fresh (`pnpm verify` and/or `pnpm verify:release`) shortly before recording so its `gitSha` matches the commit you're submitting.
5. **"Draft withheld" now fires in the standard click-through run — this was a gap and is fixed.** Round 1's `decision-synthesizer` offers an uncited first draft, the real `GoalLoop` validator refuses it for citing no source, and the corrected retry is what reaches the case. The rejection surfaces as a real consumer event: **"Recommendation draft rejected on attempt 1."**, correlated to `decision-synthesizer`, immediately followed by the recommendation that replaced it. Nothing needs to be narrated around this any more — record what the page does. (Previously the `goal` category never reached the consumer stream and round 1 validated on attempt 1, so the whole rejection path lived only in `home-energy-swarm.test.ts` and beat 3 had to apologise for it on camera.)
6. **Reweighting has a real control now — this was a gap and is fixed.** The app bar's **"Add or adjust"** menu has an **"Adjust priorities"** item that opens a Priorities sheet: one weight per criterion, a running total, and protected criteria stated rather than offered. Change the weights, press **Save weights**, then press **"Ask Sift to look into this"** again — the reweight reopens the response-options obligation, so the re-run works without any special phrasing. DevTools and ChatGPT are no longer needed for this beat; do it on camera in the UI. (Previously there was no criteria control anywhere in the product, and a plain re-run failed outright with `"No open obligation remains to select."`)
7. Keep the browser window narrow (390–480px) so the right pane reads as the real product.

---

## Shot list

### Beat 1 — the household problem and the background trigger (0:00–0:25, 25s)

*(Required beat 1: "Establish the household energy problem and background anomaly trigger.")*

**On screen:** the freshly-started case, loaded but not yet investigated. Case header reads **"Home Energy Guardian"**, with **"4 options"** beside it. The card below reads **"Nothing's been looked into yet."** Scroll to the option list — it carries the four real response options (**"Monitor for one more billing cycle," "Switch to a different rate plan," "Request a home energy audit," "Request an HVAC / thermostat inspection"**).

**Do not go looking for a "Readiness panel" listing five named questions** — that was this script's pre-redesign wording and no such region exists. The five obligations are real and still drive the run; what the pane shows is the orientation strip (**"Understanding what you need · Next: Check for anything missed"**) and the **"Check for anything missed"** action at the foot. Show those instead.

**Narration:**
> "A household's energy bill just came in 42 percent over its normal baseline — $248.50 against a weather-normalized $175.00. Nobody should have to notice that, dig through eighteen months of usage history, and guess why. Sift already flagged it as a case the moment the bill posted — quietly, in the background, before asking anyone anything."

---

### Beat 2 — real AgentSkills, rate/weather work, and Swarm activity (0:25–1:15, 50s)

*(Required beat 2: "Show real AgentSkills, rate/weather work, and Swarm activity.")*

**On-screen action:** click **"Ask Sift to look into this"** (`data-testid="request-investigation"` — the testid still says `request-investigation`, the visible label does not) live, on camera. Let the page update in real time — this is a real bounded Strands Swarm, not a canned animation, and it genuinely completes in a few seconds.

**Point out, live, as it runs (two real consumer surfaces update from the same stream, not a canned animation):**
- **"Latest command"** updates on every real event as it streams — its summary line carries genuine developer-phrased text (**"Swarm node \"anomaly-investigator\" started."**, **"Activated skill \"bill-normalizer\"."**, **"Calling tool \"bill-reader\"."**) and the plain-language line under it carries the matching consumer label (**"A step in the investigation started,"** **"A new capability activated,"** **"Looking something up"**) — one line at a time, because this block only ever shows what just happened.
- The **"Investigation team"** panel below it (`data-testid="specialist-activity-panel"`) is the clearer shot for this beat: its rows appear and settle in order as each specialist finishes — **Bill anomaly**, **Rate change**, **Weather** — each a real specialist, not a hardcoded label.

**Narration:**
> "Watch the investigation team fill in — bill anomaly, then rate change, then weather — each one a real specialist activating a real Strands Skill and calling real tools, not a canned animation."

**Optional, and the strongest version of this beat if you are comfortable with it — the live dev view:** with pacing on, click **"Inspect run"** *while the run is still going*. The Runtime Inspector tails a live run: its Timeline appends events as they happen and stops polling the moment the run reaches a terminal status. You can watch skill activations, tool calls, interventions and the GoalLoop rejection arrive in real time, then stay in the Inspector as the run completes.

> This is new as of 2026-09-05. The Inspector used to fetch once — its own hook described `refresh()` as something you call "after a run completes" — so opening it mid-run showed a frozen snapshot. If you are recording against a build older than that, open it *after* the run instead, as the beats below assume.

*(Leave this run on screen — you will come back to the rest of it for beats 3 and 4 without re-running anything. The full, permanent, ordered record of every skill activation and tool call is one click away in the Runtime Inspector, opened in beat 3.)*

---

### Beat 3 — GoalLoop is real, and now genuinely shown (1:15–1:45, 30s)

*(Required beat 3: "Show the premature monitoring draft rejected as `Draft withheld`." — this now happens live, on every run. It did not used to: round 1's `decision-synthesizer` used to cite a source on its very first attempt, so the real validator had nothing to reject, and this beat had to apologise on camera for proving the rejection path only in a unit test. That gap is closed — round 1's first draft is now genuinely uncited and genuinely rejected before the corrected retry lands.)*

**On-screen action:** once the run completes, click **"Inspect run"** to open the Runtime Inspector. On the **Overview** tab, point at the real correlated `trace` and `case` IDs. Switch to **Timeline**, filter category to **goal**, and point at both real entries, in order:
- **"Recommendation draft rejected on attempt 1."** (`goal.validation_failed`, agent: `decision-synthesizer`) — the uncited first draft, genuinely refused.
- **"Recommendation draft validated on attempt 2."** (`goal.validated`, agent: `decision-synthesizer`) — the corrected, source-cited retry that actually reached the case.

**Also point out (back in the main pane, the "Investigation team" panel):** the **Recommendation** row reads **Completed**, not Denied. The rejection genuinely happened — you just watched it in the Timeline — but a specialist's row reports the node's own final outcome, not an attempt it recovered from along the way. A withheld draft is not a permanent verdict.

**Narration:**
> "Every recommendation Sift drafts goes through GoalLoop — a real validator that can reject a plausible-sounding answer and force a corrected retry, bounded at two attempts. Watch it happen on this exact run: the first draft cites nothing, GoalLoop rejects it outright — that's the 'Draft withheld' moment — and the corrected second attempt, the one that actually names its sources, is what reaches the case. That used to be provable only in `home-energy-swarm.test.ts`. Now it's what just happened, on camera, in the product."

---

### Beat 4 — no-progress steering, handoff, skill switch, thermostat evidence, source challenge (1:45–2:30, 45s)

*(Required beat 4: "Show no-progress steering, specialist handoff, skill switch, thermostat evidence, and source challenge.")*

**On-screen action:** still in the Runtime Inspector **Timeline** from beat 3, **clear the category filter and set the level filter to `info`**, then scroll to the weather-analyst entries.

> **Do not set the category filter to `tool` here.** An earlier revision of this script offered that as an equivalent option; it is not. RetrySteering's guide is normalized as category **`intervention`**, not `tool`, so filtering to `tool` hides the very entry this beat exists to point at. Setting the level filter to `info` suppresses the three `debug`-level `intervention.proceed` rows (ScopeAuthorization, ConsequenceGuard, BudgetGuard all record one before RetrySteering runs) that would otherwise sit between the entries below and break up the sequence.

**Point out (exact Timeline entry text, in order):**
- **"Calling tool \"weather-lookup\"."** — a second time, immediately followed by
- **"RetrySteering: this search repeats a prior query family without explaining a new angle"**
- then **"Tool \"weather-lookup\" failed."**

**Narration:**
> "Weather-analyst tried the same weather lookup twice with nothing new to say for itself. Watch — Sift's RetrySteering intervention catches that immediately and redirects it, live. That's a real `Guide` intervention, not a retry counter quietly incrementing somewhere."

**On-screen action:** close the Runtime Inspector and point at the **Investigation team** panel's **Weather** row: it reads **Completed · How much the weather explains · Redirected once** (the role description sits between the two, so read the screen, not a shortened quote). The lookup genuinely failed — you just watched it in the Timeline — but the specialist recovered and finished, and the row says so plainly rather than reporting it as broken.

**On-screen action — the third intervention outcome (new 2026-09-05):** scroll the activity list back to the start of round 1, to `anomaly-investigator`'s entries. Two consecutive lines read:
- **"Looking something up"** — the attempt.
- **"Action blocked"** — `ScopeAuthorization` refusing it.

**Narration:**
> "The bill specialist just measured a 42% spike and reached for the household device log to explain it — a tool this pack grants to the home-systems specialist, not to this one. Sift denied the call before it ran. That's the third of Strands' three intervention outcomes: you've now seen Guide redirect a specialist, you'll see Confirm gate the proposal in a moment, and that's Deny. It's also the honest answer to why this is a Swarm and not one agent doing everything — it can't be."

*(Until 2026-09-05 this moment did not exist on camera: `Deny` was implemented, wired, and unit-tested, but nothing in either demo trajectory ever triggered it, so it appeared in no report and on no screen. Worse, when it was first made to fire, the pane rendered it as **"Couldn't complete that lookup"** — the denied call's own error status — which describes a broken tool rather than a boundary holding. `intervention.denied` is now a real public activity type carrying `product.md`'s own terminology-table label, "Action blocked".)*

**Continue, pointing at the panel's remaining rows:**
- **Home systems — Completed** (a real handoff, and a real skill switch to `home-event-correlation`, which found the thermostat sensor-drift event).
- **Source check — Completed** immediately after.

**Narration:**
> "The Swarm hands off to home-systems-analyst — a real handoff, a real skill switch to home-event-correlation — and it finds a thermostat sensor-drift event that started three days into this billing cycle. Source-challenger checks that claim before anyone downstream trusts it."

**On-screen action:** scroll to the Recommendation card. Read the real, live text:
> "Given the household's current criteria (energy.cost weight 80, energy.conservation weight 20), the lowest-cost options score highest: monitor-one-cycle and change-rate-plan both score 0.80, versus request-hvac-inspection's 0.47. Recommend monitoring for one more billing cycle (monitor-one-cycle) before taking further action… No inspection is proposed at this weighting."

**Narration:**
> "Right now, under cost-first priorities, Sift's honest answer is: do nothing yet. That's about to change."

---

### Beat 5 — confirmation, snapshot restoration, human-only approval (2:30–3:35, 65s)

*(Required beat 5: "Show confirmation, snapshot restoration, and human-only proposal approval." Sequence steps 10–13.)*

**On-screen action (see note 6 above):** open **Add or adjust → Adjust priorities** in the app bar, on camera. The **Priorities** sheet opens with two editable weights — **"Lowest immediate cost"** and **"Long-term waste reduction"** — plus the protected **"No electrical, gas, fire, or medical-equipment emergency risk"** criterion, shown as a stated constraint ("is set by the pack and cannot be reweighted") rather than a control you could try and have refused. Move the weights toward conservation (e.g. cost 20 / conservation 80), watch the **"Weights total"** line update live, and press **Save weights**.

**Narration:**
> "Long-term waste matters more than the cheapest immediate option — so I'm telling Sift that directly, in the product. No assistant required."

This calls `updateCriteria` — the exact same command a ChatGPT `sift_update_criteria` call would issue; the visible control and the WebMCP tool share one command implementation. Point out: the Recommendation card's status flips to **"Stale — needs investigation."** Nothing is running yet — `updateCriteria` appends `recommendation.invalidated` and revises the run plan (`apps/agent/src/services/run-plan-service.ts`), it does not start an engine run — which is exactly why the next line on camera is asking for one.

**On-screen action:** press **"Ask Sift to look into this"** again — no special phrasing, no targeted obligation ID needed. The reweight reopens the `energy.response_options` obligation (`ObligationTemplate.dependsOnCriteria`, `packages/packs/src/home-energy-guardian.ts`), which is now the only open obligation on the case, so the plain re-run finds it on its own.

**What happens (verified against source):** a genuinely revised run fires, starting directly at `decision-synthesizer` — the four measured findings (the anomaly, the rate-change attribution, the weather attribution, the thermostat event) stand unchanged; only the synthesis is redone. Watch the **Investigation team** panel's **Recommendation** row run again and complete, then watch the **Approval** card itself appear, reading **"Your approval needed"** (no trailing period on the badge itself) That heading exists at all only because `decision-synthesizer` called `propose_inspection` and a real `ConsequenceGuard` `Confirm` intervention gated it on human review before the proposal was ever recorded.

**Narration:**
> "Watch this exactly — before Sift will even record a proposal to inspect anything in this household, ConsequenceGuard stops it and requires confirmation. That's a real ConsequenceGuard `Confirm` intervention, not a courtesy dialog bolted on afterward."

**Continue:** the run completes. Read the new, live Recommendation text — the model's:
> "Recommend requesting an HVAC/thermostat inspection (request-hvac-inspection) to address the confirmed thermostat sensor-drift root cause… Under the reweighted conservation-focused criteria this scores highest (0.87) versus monitor-one-cycle (0.20)."

**Then point at the Facts section immediately below it, which is Sift's, not the model's** (live-verified against the shipped scenario):
> "Request an HVAC / thermostat inspection scores 87% against the criteria on this case, measured across 100% of the weight assigned to them."
>
> "Strongest on Long-term waste reduction: best of the options compared, where higher is better."

**Narration — this is the beat that earns the distinguishing claim:**
> "Two independent things just agreed. The Swarm's synthesis says the inspection scores 0.87 against 0.20. Sift's deterministic engine, which has never seen a prompt, computed 87% and 20% from the household's own weights, measuring every bit of the criteria this household wrote down — that's the '100%' in the sentence above. That is not the model grading its own homework — it is a measurement the model happened to describe correctly, and if it had described it incorrectly Sift would have said so on this card."

**And read the limitation, which is the strongest single line in the demo:**
> "Long-term waste reduction is what puts Request an HVAC / thermostat inspection ahead. Take it out of the weighting and Switch to a different rate plan comes first instead."

**Narration:**
> "Sift didn't write that sentence from a template. It removed that one criterion, re-ranked, watched the order actually flip, and only then said it. When no single factor flips the order, it says nothing at all — so when it does speak, it has earned it."

**On-screen action — snapshot/reload proof:** reload the browser tab. Point out the case reloads to the identical state — same recommendation, same pending approval — proving this is durable server state, not client memory.

**On-screen action — human-only approval:** scroll to the **Approval** card, which reads **"Your approval needed"**. Click **"Choose this"** (`data-testid="approval-card-approve"`) yourself — the `data-testid` still says `approve`, but the visible label deliberately reads "Choose this" (`ApprovalCard.tsx:236`), so read the button, not the test id, when you are on camera. Point out the resulting rotated **"Approved"** stamp and the Recommendation card's own status chip flipping to **"Decided"** (verified against source — `RecommendationCard.tsx`'s `SETTLED_STATUS_META`).

**Narration:**
> "No inspection got scheduled — Sift doesn't book real-world appointments. What just happened is a human, me, approving that this proposal should exist. The agent built the case for it; only I can say yes."

---

### Beat 6 — implementation proof: AgentCore/CloudWatch (conditional), Runtime Inspector, release report (3:35–4:15, 40s)

*(Required beat 6: "Show AgentCore/CloudWatch correlation when available, Runtime Inspector evidence, and the release report.")*

**Conditional sub-beat — only if you have since deployed to a real Bedrock AgentCore runtime with AWS credentials:** show `/ping` and one `/invocations` call against the deployed AgentCore endpoint, and the matching CloudWatch trace. **If you have not** (true as of this writing — this deployment runs `SIFT_EXECUTION_TARGET=local`, no AWS credentials configured) — **skip this sub-beat and say so plainly on camera** rather than staging a fake AWS console screen:

**Narration (if skipping):**
> "This deployment runs its Strands execution locally — no AWS credentials were available at deploy time. That's an honest, documented limitation, not a missing feature: the same code path talks to Bedrock AgentCore's `/ping` and `/invocations` contract the moment credentials exist."

**On-screen action — the AgentCore contract, live and unstaged (new 2026-09-05; record this whether or not AgentCore itself is deployed):** in a terminal, run these two against the public deployment:

```bash
curl -s https://sift-hackathon-production.up.railway.app/ping
# {"status":"Healthy","time_of_last_update":...}

curl -s -X POST https://sift-hackathon-production.up.railway.app/invocations \
  -H 'Content-Type: application/json' \
  -d '{"caseId":"<the case on screen>","commandName":"reviewProposal",
       "input":{"proposalId":"p1","decision":{"actor":"human","outcome":"approved"}}}'
# 400 VALIDATION — and the error enumerates the 17 verbs it *does* accept.
```

**Narration:**
> "This is the AgentCore runtime contract — the same `/ping` and `/invocations` AWS documents — live on the deployed service. Now watch an autonomous caller try to approve the inspection through it, claiming to be a human. It doesn't get refused by a permission check it might have talked its way past. `reviewProposal` is not in the enum this transport accepts at all — the request fails schema validation before any engine sees it, and the error politely lists the seventeen things it *can* do. The agent cannot approve, structurally, on the one transport an autonomous agent would use."

*(Verified live on 2026-09-05: both approval verbs, `reviewProposal` and `reviewCaseExtension`, return `400 VALIDATION` with the accepted-verb enumeration. A full investigation driven through this same `/invocations` route produced 308 runtime events — 76 carrying real OpenTelemetry span ids, 19 Context Injector injections, 4 AgentSkill activations, both GoalLoop events, and the swarm handoff chain. Every Strands feature this video claims is observable in one run triggered through the AgentCore transport.)*

**On-screen action (always record this part):** open the Runtime Inspector on round 1's run (from beats 2–4 — that is the more interesting one to show here) and point at its **Overview** tab's real category and level counts and the real `trace` ID. **Read what is actually on screen rather than reciting a fixed list.** For round 1 specifically, expect a genuine `error`-level entry (the recovered `weather-lookup` failure from beat 4) and a genuine `warn`-level entry (the withheld draft from beat 3), alongside everything that completed cleanly — this is not a defect to explain away.

**Narration:**
> "This isn't a sanitized trace. That one real error and one real warning are the exact RetrySteering redirect and the withheld draft you just watched happen. Both genuinely occurred, both are visible right here, and the run still finished and produced a sourced recommendation. Nothing here is cleaned up after the fact."

**Optional 10s aside, only if the rebalance above left room — Context Injector:** set the Timeline's category filter to **`context`**. Nineteen **"Injected case context (5 field(s))."** entries appear on a round-1 run.

**Narration (if included):**
> "Every specialist starts from the case as it stands right now — injected, not carried along in a prompt someone wrote earlier. That's why raising a new concern revises a run already under way instead of restarting it."

*(This is the one required Strands capability the video otherwise never points at, though it has always been real and is asserted in the scenario report's `contextInjections`. Verified live: 19 `context.injected` events on a single deployed run.)*

**On-screen action — release report:** in a terminal, show `artifacts/verification/latest/report.json` (or run `pnpm verify` fresh if time allows) — point at `"status": "passed"` and the real `gitSha` matching your submitted commit.

**Narration:**
> "Every claim in this video is backed by a real, green verification run — format, lint, typecheck, unit, pack, integration, scenario, and end-to-end tests, all passing against this exact commit."

---

### Beat 7 (platform proof, then close) — 4:15–5:00 (45s)

**On-screen action (brief platform proof — not one of the seven required beats on its own, but explicitly requested framing from `docs/submissions/agents-for-humans/submission-details.md`):** open the app bar's **"Add or adjust"** menu and choose **"Start a different decision"**, then launch **"Choose our next car."** The workspace title will read **Vehicle Selection** (the pack's own name; "Choose our next car" is the launcher's button label).

> **This path is new as of 2026-09-05 and did not exist when this beat was first written.** "Reset demo" restarts the *same* pack, the launcher renders only when no case is active, and the active case id is restored from `localStorage` on every load — so there was genuinely no way to reach the other demo without clearing site data, and an earlier revision of this script asked the recorder to do something the product could not do. Covered end to end now by `home-energy-guardian-journey.spec.ts`'s "a person can leave one decision and start the other, without clearing site data", at all six viewports.

**Narration:**
> "This same engine also runs Choose Our Next Car — a different Decision Pack, a compiled Strands Graph instead of a Swarm, four real specialists instead of six. Same deterministic core owns readiness and evidence either way. A typed, case-specific concern — like needing two dog crates to fit in the back — adapts a live run without ever rewriting the installed pack."

**Close (required beat 7 — exact distinguishing claim):**
> "Most agents are optimized to finish. Sift is optimized to know when it has not earned the right to answer yet."

---

## Post-recording checklist

- [ ] Total runtime is 5:00 or under (the automated submission checker fails the release otherwise, once the file is present).
- [ ] Audio is clear and present throughout.
- [ ] The AgentCore/CloudWatch sub-beat either shows real deployed evidence or is honestly narrated as skipped — never staged.
- [ ] The release-report shot shows the real `pnpm verify` or `pnpm verify:release` report you actually regenerated, and narration matches which one it is — never a claim that `verify:release` is still a stub (see the note above; it is real now).
- [ ] No beat claims "Draft withheld" happened live if it did not actually appear on screen during your take.
- [ ] The reweight beat (beat 5) is recorded entirely in the UI — **"Add or adjust → Adjust priorities" → Save weights → "Ask Sift to look into this"**. No ChatGPT dialogue, no DevTools console, and no direct API call appear anywhere in this video.
- [ ] Beat 3's Runtime Inspector shot shows both the real `goal.validation_failed` (attempt 1) and `goal.validated` (attempt 2) entries — never only one of the two, and never a claim that round 1 "validated on attempt 1."
- [ ] Upload publicly and confirm playback in a signed-out/incognito window before submitting.
