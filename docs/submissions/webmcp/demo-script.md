# WebMCP demo video — shot-by-shot recording script

Target: **2:50**, hard failure at **3:00** (OpenAI's stated limit; `scripts/test-submission.ts:496` fails the release at 180s or over). Public audio required. Published to YouTube.

> **Capture toolchain — do not improvise one.** A proven narrated-video
> pipeline already exists (ElevenLabs narration, ffmpeg segments, crossfades,
> captions) in the `praetor` reference repository, along with a separate,
> portable stills/clips kit. Read
> [`docs/hackathons/demo-tooling/README.md`](../../hackathons/demo-tooling/README.md)
> **before recording anything** — it carries the exact commands and six traps
> confirmed in that source, including a hardcoded 240-second cap that is wrong
> for this video and a transition-duration default mismatch that silently
> drifts the captions.

The spine is the six required beats in `docs/specs/demos-and-submission.md` § "WebMCP video — under three minutes." They are all still covered; screen time has moved between them, and required beat 5 is split across two shots. Every quoted on-screen string, control label, and `data-testid` below is copied from the current source, with the file and line recorded in the verification table at the end of this file. Nothing here is remembered or paraphrased.

## Who is on camera

The submitter, in his own voice, about his own decision. Not a persona and not a hypothetical household:

- 39, married, an 18-month-old at home, a second child due in three months.
- Remote software engineer.
- Shopping the four vehicles already on the case — `candidate-rav4`, `candidate-crv`, `candidate-cx5`, `candidate-outback`. They are the checked-in fixture set and **do not change**: the scenario fixtures, `final-snapshot.json` and 36 screenshot baselines all depend on them. **Never name a class on camera.** The narration never does, and a class label is the one word that would invite a viewer to argue with the shortlist instead of watching it.

What he actually said he needs: enough seats and room for two small kids, the roomier end of what is on this shortlist, and a high safety rating. What he'd like: a sunroof, and in-car wifi — he works remotely, and that last one is what Beat 7 is really about.

**He is not shopping for a third row, and nothing in this script may imply he is.** Two children under two both go in the second row. That is exactly why the question in Beat 3 is worth asking: *does a rear-facing seat fit behind the driver without pushing the driver's seat forward* is only an interesting question in a vehicle this size. In something with a third row it is a non-question, and the whole beat evaporates. The size of these four is the reason the concern exists — lean on that, do not apologise for it.

Two of his concerns turn into the custom columns this video is really about, and they are deliberately a matched pair:

- **`custom.infotainment_platform`** — the one a model can genuinely *research*. Beat 7.
- **`custom.rear_facing_seat_behind_driver`** — the one no model can research, because nobody publishes it. Beat 3, and it is what carries Beat 4's honest unknown.

That contrast is the thesis of the video. Say it if a judge asks; there is no room for it in the narration.

---

## Self-honesty banner — read before trusting a single direction

**As of 2026-09-04. Every figure in this file is now MEASURED, not derived.**

**0. Where the numbers come from, and why you should trust them more than the last revision.** A harness drove the real product through all eight beats over real WebMCP in real Chrome and read every figure off the live DOM. It ran **three times with identical results**, so these are deterministic, not a sample. Wherever an earlier revision said "derived by re-scoring `final-snapshot.json`", that derivation was wrong and has been replaced. **Do not re-derive anything in this file.** If a number on screen disagrees with a number here, the run is wrong, not the script — the most likely cause is staging (see item 1).

1. **Staging is load-bearing and the harness proved it.** Round 1 must run **off camera** before you roll; Beat 3 then adds the concern; Beat 4 runs round 2. The first harness run skipped the off-camera round 1 and produced a **different board** — different enough that every figure below would have been wrong on camera. See "Staging" step 4. This is the single easiest way to ruin a take.

   *(The round-2 trigger that blocked the previous revision is resolved: the live run reaches round 2, emits the proposal, renders the `ApprovalCard`, and the stamp lands. If round 2 ever fails to fire, the cause is the engine's extension-id trigger — `determineCarPurchaseRound`, `car-purchase-engine.ts:195-202` — and the symptom is a second "initial pass" instead of "revised pass" in the Latest command panel.)*
2. **It is written against the working tree, not a shipped artifact.** The screenshots in `artifacts/journey/2026-09-02T19-51-29-052Z/webmcp-hero/` and the 14/14 host-acceptance runs in `artifacts/host-acceptance/` still prove the WebMCP contract; they no longer show the current layout. **Deploy the exact commit you intend to submit and rehearse once before recording.**
3. **The pack is named "Vehicle Selection," not "Choose Our Next Car."** The pack id stays `car-purchase`; only the visible name generalised (`packages/packs/src/car-purchase.ts:45`). "Choose our next car" survives only as the demo-launcher card label (`apps/web/src/components/DemoLauncher.tsx:53`).
4. **There is no pack badge and no compiled-hash chip on screen.** The compiled hash is real and pinned on the case, and it provably does not change when a custom concern is added — but that proof lives in case state and in `artifacts/journey/**/report.json`, not in a rendered component. Do not narrate it.
5. **The Activity ledger is developer-only.** `ActivityTimeline` mounts only inside the Runtime Inspector's Activity tab (`apps/web/src/app/App.tsx:2726`, `apps/web/src/components/RuntimeInspector.tsx:380`).
6. **Beat 4's figures are MEASURED: 0.4, 65%, 79%, 95%, 17%.** Read off the live card after round 2, three runs, identical. The only one you speak is the pair in the disagreement line — **"ninety-five to sixty-five"**. Previous revisions of this file said 59% and 64%; both were wrong, and so was the 20% driving-comfort figure, which **does not appear on screen at all** — driving comfort now shows up as a coverage sentence with no percentage in it. Consistency check, not the source of truth: the active weights are the pack's five defaults plus Beat 3's criterion at 20, so 20 ÷ 120 = 17%, and the CR-V's unscored weight (comfort 5 + seat 20) ÷ 120 = 21%, leaving the measured 79% coverage. The numbers agree with the arithmetic; trust the numbers.
7. **Beat 7's figures are MEASURED too.** After the infotainment column the List rank badges read **Outback #1 84% on 96% · RAV4 #2 68% on 96% · CR-V #3 56% on 81% · CX-5 #4 18% on 96%**. The case stays **"Decided"** — `SETTLED_STATUS_META` outranks the recommendation's own status (`RecommendationCard.tsx:120, 196`), so invalidating the recommendation does not un-decide the case, and the live run confirms it. Read the badges before you speak them; you speak none of them by default.
8. **RESOLVED — the two hard-coded round-2 limitation strings are gone.** All five Limitations lines are now derived from real coverage and all five are accurate, so nothing in that block has to be avoided any more. Two of them are new and good: line 1 states the coverage gap in plain numbers, and line 5 is a **sensitivity analysis** the product produced unprompted. Beat 4 now scrolls the whole block instead of hiding from the top of it.
9. **This is Chrome's WebMCP, not ChatGPT's**, unless you have ChatGPT's WebMCP-capable browser and have smoke-tested it. Do not say "ChatGPT" on camera over a Chrome session.
10. **Beat 6 gained two capabilities that have landed and are verified.** There is now a fourth Inspector tab that draws the Graph, and OpenTelemetry is real — so "a real correlated trace event" is a true claim again. Two claims are still false and stay excluded. See "What Beat 6 may not say" before you improvise a word of it.

---

## Before you record

### Choosing a host

`document.modelContext` is the whole submission. It must be a real host, not a simulation.

**Route A — verified from this repository, and the default.** Chrome 152+ launched with WebMCP enabled, driven by a real model over `pnpm webmcp:bridge`.

```
SIFT_HOST_URL=https://sift-hackathon-production.up.railway.app pnpm webmcp:bridge
```

`scripts/webmcp-bridge.ts` is a stdio MCP server that maps MCP `tools/list` onto the page's live `WebMCP.toolsAdded` registrations and MCP `tools/call` onto `WebMCP.invokeTool` in the real browser. Point Claude Code, Codex, or any MCP client at it (config block is in that file's header comment, lines 24–34) and a real model is choosing and sequencing the real tools on the real page. It opens a **visible** Chrome window on a throwaway profile at **430×900** — Sift's canonical right-pane width — with `--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport` (`scripts/journey/host-session.ts:128-137`). That window is your recording surface. Put the MCP client's transcript beside it.

**Route B — stronger for this competition if you can do it honestly.** ChatGPT's WebMCP-capable in-app browser, opened on the same URL. Nothing in this repository can verify that host, so smoke-test it first: open the URL, ask the assistant what tools the page offers, and confirm it lists 26 once a case is open. If it lists three, no case is open yet. If it lists none, fall back to Route A rather than narrating a call that did not happen.

Do **not** record in a stock Chrome/Firefox/Safari tab. Sift detects the missing API and shows `WebMCP unavailable in this browser — every action is still available here.` (`apps/web/src/components/WebMcpStatus.tsx:68`) — correct, tested fallback behavior, and also proof that no `sift_*` call in this script fired.

### Staging

1. **URL.** `https://sift-hackathon-production.up.railway.app` (`docs/submissions/release-metadata.json:3`).
2. **Window width.** Keep the pane at 430–480px. Below 800px the app bar collapses its controls to icons with tooltips (`apps/web/src/hooks/use-width-mode.ts:51`, `NARROW_MAX_WIDTH_PX = 800`); that is the canonical, intended look and it is what you want on camera.
3. **Fresh case.** On the launcher, click **"Choose our next car"** (`demo-launcher-car-purchase`, `apps/web/src/components/DemoLauncher.tsx:53`). It resets to the checked-in fixture and mints a fresh case id. Do this immediately before recording, not mid-take.
4. **Pre-stage round 1 off camera. This is not optional and it is not cosmetic.** Click **"Ask Sift to look into this"** (`request-investigation`, `apps/web/src/components/RecommendationHero.tsx:172`) once and let it finish. Confirm the hero headline reads **"Leading so far: 2022 Toyota RAV4 XLE Hybrid AWD"** (`workspace-status.ts:220`). The organizer's checklist sanctions removing setup and dead time — but the real reason is arithmetic: **every measured figure in this file assumes round 1 ran first, then Beat 3 added the concern, then Beat 4 ran round 2.** A harness run that skipped this step produced a different board, and every number in Beats 4 and 7 would have been wrong on camera. If the Latest command panel ever says "initial pass" during Beat 4, you skipped it — stop and reset.
5. **Nothing else is pre-staged.** Every mutation from Beat 2 onward happens live, on camera, through real WebMCP tool calls.
6. Turn on your OS cursor highlighter. Several beats depend on the viewer seeing that you did *not* click.
7. A real model is non-deterministic. Nudge by tool name when it stalls; never narrate a call that did not fire.

### Known, honest limitations this script works around

- **No visible criteria-reweighting form exists anywhere in `apps/web/src/components`.** Reweighting and adding a weighted criterion are WebMCP-only today. That is a positive fact about why WebMCP matters here, not an apology.
- **`sift_define_case_attribute` creates the column *and* fills it in, in one command.** Passing `values` writes one provenance-carrying record per option in the same append as the definition (`apps/agent/src/services/command-service.ts:1292-1297`), so a populated comparison row genuinely does appear. Narrate it.
- **An enum column is not scorable until something declares its order.** `scoring.ts` rule 3 refuses to read a ranking out of `allowedValues`, which is a membership set, and returns *"this rating has no declared worst-to-best ordering, so its grades cannot be ranked without guessing"* (`packages/core/src/scoring.ts:227-234`). Both custom columns pass `orderedValues` (`packages/contracts/src/commands.ts:343`). Without it the row renders and never moves the ranking.
- **Compare is a two-column head-to-head at recording width, always.** `layout` is viewport-derived, `narrow` at ≤800px (`use-width-mode.ts:47`), and narrow layout renders at most two option columns (`OptionCompareView.tsx:433-439`, `pickHeadToHeadOptions:207-220`). There is no in-app toggle. Every compare shot below names its pair explicitly.
- **Consumer-facing "Findings" opens a sheet titled "Research."** If you open it, read the title you see.

---

## Recording spine

| Beat | Window | Duration | Spoken words | Speech | Silence | Required beat | What it proves |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:14 | 14s | 33 | 13.2s | 0.8s | 1 | Working right-pane product; a real `document.modelContext` host |
| 2 | 0:14–0:27 | 13s | 30 | 12.0s | 1.0s | 2 | Shared selection, and a ranking the model reads rather than invents |
| 3 | 0:27–0:48 | 21s | 49 | 19.6s | 1.4s | 3 | A concern no manufacturer publishes, added live through WebMCP |
| 4 | 0:48–1:22 | 34s | 74 | 29.6s | 4.4s | 4 | Revised shortlist, honest unknown, sensitivity analysis, and Sift disagreeing with its own model |
| 5 | 1:22–1:40 | 18s | 40 | 16.0s | 2.0s | 5a | Human-only approval |
| 6 | 1:40–1:58 | 18s | 39 | 15.6s | 2.4s | 5b | The Graph drawn, a correlated trace event, and one human confirmation |
| 7 | 1:58–2:39 | 41s | 92 | 36.8s | 4.2s | — | A researched column the pack never had, scored, moving the board |
| 8 | 2:39–2:50 | 11s | 26 | 10.4s | 0.6s | 6 | Close |

**2:50 total, 383 spoken words.** At an unhurried 150 words per minute that is 153.2 seconds of speech and 16.8 seconds of deliberate silence — 4.4s of it resting on Beat 4's Limitations block and 4.2s in Beat 7 while four tool calls land. Blockquotes marked **spoken** are the entire script; nothing else in this file is read aloud. Blockquotes marked **on screen** are text the camera holds on. Reading those out is how a take blows past 3:00.

Counts are token-by-token (a word is a whitespace-delimited token containing a letter or digit; em dashes and bare punctuation are not words). Beat 7 is the largest product segment on purpose, and the Runtime Inspector is the second — that is the user's call about where this video should spend its time.

If a take runs long, cut in this order: Beat 7's payoff line, Beat 6's first sentence, Beat 2's second sentence. **Never** cut Beat 4's disagreement, Beat 5's refusal, or the `status: "unknown"` field in Beat 3's payload — that last one is not narration and dropping it moves every number in Beat 4 at once.

---

## Beat 1 — the working product, and why this is a WebMCP entry (0:00–0:14, 14s)

*(Required beat 1: "Show the working right-pane car case in the first 15 seconds.")*

**On screen:** the pre-staged case. Three things must be in frame:

- App bar (`workspace-app-bar`): title **"Vehicle Selection"** (`workspace-app-bar-title`), the connection pill reading **Live** — small caps via `label-caps`, so it reads "LIVE" (`WorkspaceAppBar.tsx:286`) — and **"4 options"** (`workspace-app-bar-option-count`).
- The hero (`recommendation-hero`), headline **"Leading so far: 2022 Toyota RAV4 XLE Hybrid AWD"** (`workspace-status.ts:220`).
- The footer strip, one line above the bottom edge: **"WebMCP ready — a connected assistant can operate this page."** (`webmcp-status-supported`, `WebMcpStatus.tsx:80`).

**Action:** none for the first few seconds. Then flick the **List** tab (`workspace-view-tab-list`, `WorkspaceViewSwitcher.tsx:203, 290`) so all four candidates are on screen as cards, each carrying a rank badge in the shape **"#N of 4"** / **"N% score"** / **"on N% of what you said matters"** (`option-rank-position-*` / `option-rank-score-*` / `option-rank-coverage-*`, `OptionRankBadge.tsx:301, 322, 362`). **Do not read those numbers aloud here** — this is the round-1 board and no figure in this file is derived for it; the badges are established as a surface, not as data.

**Why List and not Compare:** this click is yours, and it has to be. In Beats 3 and 7 the assistant presses **Compare** through `sift_set_view` — the same control, from the other side. If you are already in Compare, that call is a silent no-op. Leave Compare for the model. The rank badges are also the surface Beat 7 pays off on, so establishing them here costs nothing.

**Narration (spoken, 33 words):**

> "Sift, in a browser that speaks WebMCP. I'm buying a car — toddler at home, one on the way. That line at the bottom is the submission: this page registers twenty-six typed tools through `document.modelContext`."

**Point at:** the **"WebMCP ready"** strip, then the **Live** pill.

---

## Beat 2 — shared selection, and a ranking the model reads rather than invents (0:14–0:27, 13s)

*(Required beat 2: "Demonstrate shared selected-option context through `sift_get_case_context`.")*

Compressed hard. It is a proof, not a story, and 13 seconds is enough to make it.

**Say to the assistant (spoken, 13 words):**

> "Select the RAV4 as my current pick, and tell me why it's ahead."

**What fires:** `sift_focus_option` (`register-sift-tools.ts:430`), then `sift_get_case_context` (`:1323`), then `sift_explain_ranking` (`:985`).

**What changes on screen, with no click of yours:** the RAV4's List card tints to the ready palette and gains `data-selected="true"` (`OptionListView.tsx:320-321`); its title button gains an inline **"Selected"** label and flips to `aria-pressed="true"` (`:334-336, 347`). That title *is* a real button you could have clicked — a shared control, not screen-scraping.

**Narration (spoken, 17 words):**

> "I didn't touch the page. And it didn't invent that ranking — it asked Sift, which computes it."

**Cut in this revision:** *"Otherwise you get two rankings and no way to tell which one to trust."* and *"…deterministically from this household's own weights."* The claim survives in the sentence above; the gloss did not fit 13 seconds.

---

## Beat 3 — a concern nobody publishes, added live through WebMCP (0:27–0:48, 21s)

*(Required beat 3: "Add an unanticipated household concern through WebMCP while work is active.")*

`custom.rear_facing_seat_behind_driver` is the honest half of this video's pair. No manufacturer publishes it. It exists only in hands-on car-seat-fit checks, and with a second seat arriving in three months it is the question that actually decides this shortlist — *because* these four are the size they are. Put a third row behind him and nobody would ask it. A model cannot research it at all. He can only report what he measured, and the one car he did not get to is the one that stays unknown.

**Say to the assistant (spoken, 37 words):**

> "Second baby's due in three months. Add whether a rear-facing seat fits behind the driver — room to spare on the Outback, seat-back on the RAV4, seat-forward on the CX-5, and we never fitted the CR-V. Weight twenty."

**What fires — two calls.**

**(a) `sift_define_case_attribute`** (`register-sift-tools.ts:478`; schema `packages/contracts/src/commands.ts:449`) — definition and every cell in one command:

```
{
  origin: "user",
  definition: {
    id: "custom.rear_facing_seat_behind_driver",
    label: "Rear-facing seat fits behind the driver",
    valueType: "enum",
    appliesTo: ["candidate"],
    allowedValues: ["Driver seat must move forward", "Fits with driver seat back", "Fits with room to spare"],
    orderedValues: ["Driver seat must move forward", "Fits with driver seat back", "Fits with room to spare"],
    evidenceExpectation: "verification",
    comparison: "higher_better",
    reason: "A second child arrives in three months; a rear-facing seat has to go behind the driver without pushing the driver's seat forward."
  },
  values: [
    { optionId: "candidate-outback", status: "asserted", confidence: 0.9, value: { type: "enum", value: "Fits with room to spare"       } },
    { optionId: "candidate-rav4",    status: "asserted", confidence: 0.9, value: { type: "enum", value: "Fits with driver seat back"    } },
    { optionId: "candidate-cx5",     status: "asserted", confidence: 0.9, value: { type: "enum", value: "Driver seat must move forward" } },
    { optionId: "candidate-crv",     status: "unknown",  reason: "We have not had our seat in this one; the CR-V on the lot was a different trim." }
  ]
}
```

**(b) `sift_update_criteria`** (`register-sift-tools.ts:462`) — one `add`, and it starts counting:

```
{ op: "add", criterion: {
    id: "custom.rear_facing_seat_behind_driver",
    label: "Rear-facing seat fits behind the driver",
    kind: "preference",
    weight: 20,
    direction: "higher_better",
    appliesToAttribute: "custom.rear_facing_seat_behind_driver",
    question: "Does a rear-facing seat fit behind the driver without moving the driver's seat forward?"
} }
```

Three things in that payload are enforced, not decorative:

- **`orderedValues` is what makes the column rankable** — `scoring.ts` rule 3 (`packages/core/src/scoring.ts:227-234`); the schema requires the two lists to hold the same grades, no repeats, no gaps (`packages/contracts/src/commands.ts:343, 349-381`).
- **There are no blank cells.** Each entry is a real value or an explicit unknown; a `status: "unknown"` with no `reason` is rejected as *"indistinguishable from an oversight"* (`packages/contracts/src/commands.ts:393-421`). The CR-V's reason rides along as a real option-linked `CaseNote` of kind `question`, appended in the same transaction (`command-service.ts:1521-1538`).
- **`status: "verified"` is not claimed.** Only a human attestation may claim it (`packages/core/src/attributes.ts:388-395`), and nobody put a tape measure on these — `asserted` is honest for a recollection with no source attached.

**What changes on screen:** the recommendation's status chip flips to **"Stale — needs investigation"** (`recommendation-card-status`, `RecommendationCard.tsx:87`) and the stale note appears beneath it (`:224-226`). Let the viewer read it; do not read it aloud. A criteria change appends `recommendation.invalidated` and revises the run plan (`run-plan-service.ts:95-125`) — it starts no engine run. Nothing recomputes until Beat 4 asks. The chip says exactly that, so the screen is telling the truth and you can let it.

**Narration (spoken, 12 words):**

> "There's no form for that anywhere. It's not in the pack either."

**Weight 20 is required, not a taste.** It is the pack's five default weights plus this one, and 20 of that 120 is what puts the measured **17%** on Beat 4's fourth limitation. Change it and every number in Beats 4 and 7 moves.

---

## Beat 4 — round two: revised shortlist, honest unknown, and a system that disagrees with its own model (0:48–1:22, 34s)

*(Required beat 4: "Show the Strands Graph redirect, skill activation, stale recommendation, honest unknown, and revised shortlist.")*

**Every figure in this beat is measured off a live run, three times, identical. Speak none of them that you have not read off the card in front of you.**

**Say to the assistant (spoken, 10 words):**

> "Look at it again, now that the seat question exists."

**What fires:** `sift_request_investigation` (`register-sift-tools.ts:523`). Because the seat concern is a **confirmed** case extension, the engine runs **round 2** rather than repeating round 1 (`car-purchase-engine.ts:195-202`) — `household-fit-analyst` re-investigates, `source-challenger` re-verifies the deal, and the round-1 teaser-price evidence link is **superseded, not deleted** (`:653-673`).

**What to point at while it runs** — the **Latest command** panel inside the hero (`live-run-status`, `LiveRunStatus.tsx:150`): its phase chip walks the real sequence and lands on **"Completed"** (`:76`), with the summary **"Investigation completed (revised pass)."** (`car-purchase-engine.ts:1041`). That word *revised* is the round-2 proof, on screen, in the product.

**Then hold on the recommendation card and scroll it, top to bottom.** Every line below is **on screen, not spoken**.

**On screen** — the rationale, which is the model's:

> "Revise the shortlist to 2022 Honda CR-V EX-L AWD, with 2022 Subaru Outback Premium AWD as a close alternative. 2022 Toyota RAV4 XLE Hybrid AWD is disqualified per Dealer written offer (fictional) (true price over the household budget)…"

**On screen** — under **Facts** (`recommendation-card-facts`, `RecommendationCard.tsx:234`), Sift's own and deterministic. Four lines render, **measured verbatim**; frame the **first** and the **last**:

> "2022 Honda CR-V EX-L AWD scores 65% against the criteria on this case, measured across 79% of the weight assigned to them."
>
> "Strongest on 5-year ownership cost (fuel, maintenance, depreciation, financing): best of the options compared, where lower is better."
>
> "Weakest on Safety and reliability: weakest of the options compared, where higher is better (averaged across 3 of 3 measures)."
>
> "2022 Subaru Outback Premium AWD scores 95% on the same criteria."

**On screen** — under **Limitations** (`recommendation-card-limitations`, `RecommendationCard.tsx:283`). **Five lines, in this exact order, measured verbatim. All five are now derived from real coverage and all five are true** — the two hard-coded strings an earlier revision told you to dodge are gone. Scroll the whole block in one slow pass and land on the last line:

> 1. "Rear-facing seat fits behind the driver: established for only 3 of the 4 candidates."
> 2. "Driving comfort: not established for any candidate on this case."
> 3. "This recommendation favors 2022 Honda CR-V EX-L AWD, but scoring your criteria puts 2022 Subaru Outback Premium AWD ahead (95% to 65%). The reasoning above may account for something the scoring does not — it is worth reading before deciding."
> 4. "Rear-facing seat fits behind the driver carries 17% of the weight on this case but is not part of the score: nobody has established this for this option yet, so it is left out of the score rather than counted against it"
> 5. "Safety and reliability is what puts 2022 Subaru Outback Premium AWD ahead. Take it out of the weighting and 2022 Honda CR-V EX-L AWD comes first instead. If that factor matters less to you than the weights currently say, this ranking changes."

**Three of those five are the beat, and the narration walks them in order.** Line 1 is the honest unknown, stated as a coverage fact rather than an apology: three of four answered, and the fourth is the car being recommended. Line 3 is Sift contradicting its own model out loud. **Line 5 is new, and it is the strongest line on the card** — a sensitivity analysis nobody asked for: not just *we disagree*, but *here is the single weight doing the work, and here is what happens if you take it out*. That is the difference between a system that hedges and a system that hands you the lever.

Line 4 is the mechanism behind line 1 — the seat criterion carries 17% of the weight and is left out of the CR-V's score rather than counted against it. Worth having in frame; not worth a spoken word.

**The measured figures, and what changed since the last revision.** 65%, 79%, 95%, 17% and the 0.4 confidence were read off the live card on three identical runs. Earlier revisions of this file said **59%** and **64%** — both wrong — and quoted a **20%** driving-comfort figure that does not appear on screen at all (line 2 states it with no percentage in it). **The only figures you speak are "ninety-five to sixty-five" and "nought point four."** Read both off the card before the take. If the card says 59, round 1 was not pre-staged (see Staging step 4) — reset, do not re-narrate.

**Narration (spoken, 64 words) — the beat that wins or loses the submission. Speak it over the scroll:**

> "Three of four have an answer. The one Sift recommends doesn't. And Sift just disagreed with its own model: it favours the CR-V, but its own scoring puts the Outback ahead, ninety-five to sixty-five, and drops its confidence to nought point four. Then it says what would flip that — take safety out of the weighting and the CR-V wins. Not a hedge. A measurement."

**Cut from the previous revision to pay for the sensitivity line:** *"…with the reason attached"* and *"Not a guess, not a zero."* Both are now stated better on screen — line 1 gives the coverage, line 4 gives the "left out of the score rather than counted against it" — so the words were buying what the card already says. The beat is one word shorter than before and carries one more idea.

---

## Beat 5 — human-only approval (1:22–1:40, 18s)

*(Required beat 5, first half: "Show human-only approval.")*

**Verified on the live run:** the stamp lands, the hero reads "Decided.", and a made-up `sift_review_proposal` comes back **"not registered with the host"**.

**Say to the assistant (spoken, 4 words):**

> "Approve this for me."

**What happens:** nothing on the page changes. The registered catalog contains no approval tool at all — `SIFT_WEBMCP_TOOL_NAMES` is pinned at 26 and none of them can approve (`webmcp-contract.test.ts:297, 302`; `register-sift-tools.ts` records that `sift_request_revision` deliberately calls `commands.requestRevision` and that `commands.reviewProposal` is never referenced in the file). The `webmcp-hero` journey goes further and calls a made-up `sift_review_proposal` by name through the real host: **refused** (`scripts/journey/journeys/webmcp-hero.ts`, turn `assistant-cannot-approve`).

**Narration (spoken, 27 words):**

> "It can't. There's no approval tool in the catalog, and calling one by name is refused. That's not a prompt rule — it's an absence in the API."

**On-screen action:** in the hero, the approval region reads **"Your decision"** (`ApprovalCard.tsx:128`) with a **"Your approval needed"** badge (`:184`). Click **"Choose this"** (`approval-card-approve`, `:216`) — its siblings are **"Pass"** (`:230`) and **"Keep researching"** (`:250`).

**What changes:** a rotated **"Approved"** stamp lands (`approval-card-stamp`, `:88, 157`), the hero headline flips to **"Decided."** (`workspace-status.ts:156`), and the recommendation chip flips to **"Decided"** (`RecommendationCard.tsx:111`).

**Narration (spoken, 9 words):**

> "A human just closed this. The agent never can."

---

## Beat 6 — the run underneath (1:40–1:58, 18s)

*(Required beat 5, second half: "…and one correlated Runtime Inspector event.")*

**Written against a Runtime Inspector audit of the real database (154,233 rows, 744 runs), then updated for two capabilities that have since landed and been verified: a Graph-topology tab, and real OpenTelemetry. Read "What Beat 6 may not say" below before improvising a single word.**

**Shot order matters and the old one was impossible.** Opening the Inspector from the app bar leaves `runId` null, so it opens on **Activity** and Overview would read **"No run data yet."** (`RuntimeInspector.tsx:288-290, 432-434`). Two valid entry points:

- **Preferred:** click **"Inspect run"** in the hero (`open-runtime-inspector`, `RecommendationHero.tsx:205, 211`) — opens with a run in hand.
- **Or:** the terminal-glyph **Developer view** button in the app bar (`workspace-app-bar-developer-view`, `WorkspaceAppBar.tsx:597`), which lands on **Activity**; then click **"Inspect event"** on an entry (`activity-item-inspect-event-…`, `ActivityTimeline.tsx:154-163`) to set the run *before* touching Overview.

Either way the sheet is titled **"Run details"** (`RuntimeInspector.tsx:331`).

**What to film, in order. Three stops in eighteen seconds — do not attempt a fourth.**

1. **Execution** (`runtime-inspector-tab-execution`) — **new, landed, and now the opening shot of this beat.** It draws the real topology instead of asking you to describe it: **"Strands Graph"**, **"6 nodes · 3 stages"**, then **"STAGE 1 — 4 IN PARALLEL"** with each specialist named and marked Completed, then `source-challenger`, then `decision-synthesizer`. That panel is the first sentence of the narration, rendered. Let it sit while you say it.
2. **Activity** (`runtime-inspector-tab-activity`) → **"Inspect event"** on one entry (`activity-item-inspect-event-…`, `ActivityTimeline.tsx:154-163`). The Inspector switches to **Timeline** and the matching item auto-scrolls to centre and takes a brand outline: `data-focused="true"` plus `outline: 2px solid var(--color-brand)` (`RuntimeInspector.tsx:241, 245`), driven by a real `scrollIntoView({ block: 'center' })` (`:319, 591`). **This is the money shot** — a consumer-visible activity item opening its exact runtime event. It is e2e-proven and it is the last thing the narration says.
3. **Scroll the Timeline a few rows** — do not use the filters (see below). Real, visible entries: progressive skill activations, and one **`intervention.confirm`** on `propose_recommendation`, reason *"tool … creates a consequential artifact and requires human confirmation"* (`interventions.ts:186-187`) — which is the same authority boundary Beat 5 just made you press a button for, showing up in the machinery.

**Overview is off the shot list for time, not for honesty.** If you have a spare second, **Case**, **Events** and **Errors** are safe (`RuntimeInspector.tsx:463-494`). **Session** is not — see below.

**Narration (spoken, 39 words):**

> "Six specialists ran that, four of them in parallel. Skills switched on as they were needed, and one tool call stopped for human confirmation. Every step is a real correlated trace event. An activity item opens the exact one."

**"Correlated trace" is a true claim again.** OpenTelemetry is now real: spans are captured into `runtime_events` with populated `span_id`/`parent_span_id` — 276 span rows, 272 of them parented, forming a five-level tree (`invoke_graph` → `execute_node` ×6 → `invoke_agent` → `execute_agent_loop_cycle` → `chat`/`execute_tool`) with real durations from the OTel SDK. The previous revision of this file forbade the word "correlated" because span ids were NULL by design. They are not any more. Say it.

### What Beat 6 may not say

| Excluded claim | Why |
| --- | --- |
| Pointing at **Session** on Overview | Still renders `(none)` on every run (`RuntimeInspector.tsx:485`). |
| `Guide` / `Deny` interventions | `Deny` has never fired in 744 runs; `Guide` never fires on the car pack. Only the **confirm** intervention is real here. |
| GoalLoop attempts | The car pack emits zero goal events today. |
| Tokens, latency, cost | The Overview block is conditional and empty on these runs. |
| Redaction | 0 rows have ever been redacted. |
| Filters / export | Under active repair; scroll instead. |
| Opening via Developer view **then** Overview | Leaves `runId` null; Overview shows "No run data yet." Not a claim — a shot order that cannot work. |

**One thing to check in rehearsal rather than assume.** The spans are real, but confirm that the **Trace** id printed on Overview matches the ids on the Timeline events before you point a camera at that field — it mismatched before the OTel work landed and this file has not seen it re-measured. The narration above does not depend on it either way.

**Still-open upgrades, if they land before you record.** Re-verify each against the running build; a green build is not proof of a specific claim.

- Goal events → a GoalLoop attempt becomes narratable.
- Tokens/latency → the Overview cost row becomes real.
- Filters/export → step 3 becomes a filter instead of a scroll.
- WebMCP origin on runs → you could say on camera that the run was started by a tool call rather than a click.

---

## Beat 7 — the column a model can actually research (1:58–2:39, 41s)

*(Not one of the six required beats. It is the largest product segment in the video, deliberately, and it is the other half of the pair Beat 3 opened.)*

Beat 3's column was the one no model can research. This one is the opposite, and the distinction is real rather than rhetorical: spec sheets blur **Android Automotive OS** — Google Maps and Assistant running natively *in the car* — with **Android Auto**, which is phone projection. He is a remote software engineer and the reason is an engineer's reason, not a brand preference: navigation should not die when his phone isn't in the car, hands-free Assistant matters with a toddler in the back, and OTA updates mean the car doesn't rot in the driveway.

The case is already **decided** at this point, and it stays decided: `SETTLED_STATUS_META` outranks the recommendation's own status (`RecommendationCard.tsx:120, 196`), and nothing rejects adding a criterion to a settled case (only *removing* one a decided case references is rejected). Adding this dimension does not un-decide anything — it shows that the workspace is still his afterwards.

**Say to the assistant (spoken, 36 words):**

> "One more. I work from home and I live in the nav. Add in-car software: phone projection worst, then wireless Android Auto, then Automotive OS, then Google built-in. Fill it in for all four, weight fifteen."

**What fires — four calls, in this order.** Let them run; do not talk over the middle two.

**(a) `sift_set_view`** (`register-sift-tools.ts:758`; schema `webmcp-local-schemas.ts:141-152`) — `mode: "compare"`. `WORKSPACE_VIEW_MODES` is `quick_pick | list | compare | board` (`packages/contracts/src/case.ts:341`). The **Compare** tab takes the selected state (`workspace-view-tab-compare`, `WorkspaceViewSwitcher.tsx:204, 290`) and the table under **"Compare the options"** (`OptionCompareView.tsx:567`) replaces the list — the same tab you pressed yourself in Beat 1.

**(b) `sift_define_case_attribute`** — definition and all four cells:

```
{
  origin: "user",
  definition: {
    id: "custom.infotainment_platform",
    label: "In-car software platform",
    valueType: "enum",
    appliesTo: ["candidate"],
    allowedValues: ["Phone projection only", "Wireless Android Auto", "Android Automotive OS", "AAOS with Google built-in"],
    orderedValues: ["Phone projection only", "Wireless Android Auto", "Android Automotive OS", "AAOS with Google built-in"],
    evidenceExpectation: "source",
    comparison: "higher_better",
    reason: "Navigation and voice assistance must run in the car itself, so they still work with no phone present; OTA updates keep the software current."
  },
  values: [
    { optionId: "candidate-rav4",    status: "asserted", confidence: 0.8, value: { type: "enum", value: "Wireless Android Auto" } },
    { optionId: "candidate-crv",     status: "asserted", confidence: 0.8, value: { type: "enum", value: "Phone projection only" } },
    { optionId: "candidate-cx5",     status: "asserted", confidence: 0.8, value: { type: "enum", value: "Wireless Android Auto" } },
    { optionId: "candidate-outback", status: "asserted", confidence: 0.8, value: { type: "enum", value: "Phone projection only" } }
  ]
}
```

**All four are answered, and none is `verified`.** That is the contrast with Beat 3 and it is the honest one: this is a question a model can answer from what it knows, and the answer is still its own claim rather than a human attestation — `attributeStatusOriginError` (`packages/core/src/attributes.ts:388-395`) enforces the difference. Note also the real result: **none of the four reaches Android Automotive OS.** The top two grades stay empty. That is the finding, not a failure of the demo — the spec sheets suggest otherwise and the column says so plainly.

**(c) `sift_update_criteria`** — one `add` at **weight 15**:

```
{ op: "add", criterion: {
    id: "custom.infotainment_platform",
    label: "In-car software platform",
    kind: "preference",
    weight: 15,
    direction: "higher_better",
    appliesToAttribute: "custom.infotainment_platform",
    question: "Does navigation and voice assistance run in the car itself, without a phone?"
} }
```

`appliesToAttribute` (`packages/contracts/src/commands.ts:532`) is the mechanism: it points the criterion at a column that did not exist a minute ago, and `scoreCaseState` picks it up from `caseExtensions` exactly as if the pack had shipped it (`packages/core/src/scoring.ts:852-865`).

**(d) `sift_configure_comparison`** (`register-sift-tools.ts:811`; schema `webmcp-local-schemas.ts:161-188`) — `optionIds: ["candidate-crv", "candidate-outback"]`, `pinnedAttributeIds: ["custom.infotainment_platform"]`. The new row jumps to its own `<tbody>` under a **"Pinned"** heading at the top of the table (`OptionCompareView.tsx:677-685`).

**What changes on screen, part one — the column.** A real comparison row, pinned, labelled **"In-car software platform"** with an outlined **"Custom"** badge beside it (`option-compare-view-custom-badge-…`, `OptionCompareView.tsx:333-338`, tooltip "Added for your comparison"). Under two `<th scope="col">` headers (`:646-647`) — **2022 Honda CR-V EX-L AWD**, then **2022 Subaru Outback Premium AWD**, in the order the call names them (`narrowOptions`, `:187-196`) — both cells read **Phone projection only**, so the row collapses to a **"Same for all"** badge with a **"Show separately"** toggle (`:343-348, 357-364`). Press the toggle; that is the honest signal that on *this* pair the new dimension separates nothing, and it is worth two seconds. Above the table:

> **On screen** (`option-compare-view-filtered-note`, `OptionCompareView.tsx:580-583`):
>
> "Showing 2 of 4 options in this comparison. Options not shown here are not eliminated -- they're just not part of this view."

**What changes on screen, part two — the payoff.** Flick back to **List**. Every rank badge has moved, because the board was re-scored on a dimension that did not exist a minute earlier (`OptionRankBadge.tsx:301, 322, 362`):

| Option | Before Beat 7 (the Beat 4 board) | After Beat 7 — **measured** |
| --- | --- | --- |
| 2022 Subaru Outback Premium AWD | leader, **95% score** | **#1 of 4 · 84% score · on 96%** |
| 2022 Toyota RAV4 XLE Hybrid AWD | *not measured — read it in rehearsal* | **#2 of 4 · 68% score · on 96%** |
| 2022 Honda CR-V EX-L AWD | **65% score · on 79%** | **#3 of 4 · 56% score · on 81%** |
| 2023 Mazda CX-5 Preferred AWD | *not measured — read it in rehearsal* | **#4 of 4 · 18% score · on 96%** |

**The right-hand column is measured off a live run, three times, identical.** The left-hand column carries only the two figures Beat 4's card states out loud (`facts[0]` and `facts[3]`); the RAV4's and CX-5's pre-Beat-7 badges were never measured, so this file does not print a number for them. Fill those two cells in rehearsal if you want the full before/after in the Devpost write-up; **do not speak them.** An earlier revision printed derived values in both columns and every one of them was wrong.

The positions do not reorder. What moves is every score and every coverage line: three of the four jump to **96%** coverage because the new column is answered for all of them, and the CR-V lands at **81%** because its seat cell is still the honest unknown. **Read the badges before you speak them, and speak none of them if you have not.**

**The honest edge, now measurable:** the car he just chose drops **65% → 56%** on a dimension he added himself, after he had already decided. Sift says so, plainly, and does not take the decision back.

**Narration (spoken, 43 words) — over (a), letting (b)–(d) land in the gap:**

> "The pack has no such field. The model made one, put the grades in order so Sift can rank it, and answered it for every car from what it knows — as its own claim. It isn't allowed to say verified. Only I am."

**Payoff line (spoken, 13 words) — over the List flick:**

> "And the board moved. New dimension, after the decision, still mine to steer."

**Nudge by name if the model stalls:** *"use `sift_set_view` to switch to compare"*; *"use `sift_define_case_attribute` for `custom.infotainment_platform` as an enum with `orderedValues`, and a `values` entry for all four"*; *"use `sift_update_criteria` to add a criterion with `appliesToAttribute` `custom.infotainment_platform` at weight fifteen"*; *"use `sift_configure_comparison` to show the CR-V against the Outback and pin that row"*. If (d) does not fire the row still appears, unpinned; adjust where you point. If (b) or (c) does not fire, the List payoff does not happen — reset that beat.

---

## Beat 8 — close (2:39–2:50, 11s)

*(Required beat 6: "Close with WebMCP as a live steering channel between the human, ChatGPT, page, and Strands team.")*

**On screen:** the case workspace, decided, full pane visible.

**Narration (spoken, 26 words):**

> "That's WebMCP as a steering channel — me, an assistant, this page, and a real agent team underneath. And the one thing it can't do is decide."

---

## If round 2 does not fire

The long fallback take that used to live here is gone: a live run reaches round 2, emits the proposal, renders the `ApprovalCard` and lands the stamp, three times over. If it ever does not, this is the diagnosis, not a reason to improvise:

- **Symptom.** The Latest command panel says *"Investigation completed (initial pass)."* instead of *"(revised pass)."*, no proposal appears, and the hero never offers an approval control — a `null` proposal renders no `ApprovalCard` at all (`RecommendationHero.tsx:231`), because round 2 is the only path that emits `proposal.proposed` (`car-purchase-engine.ts:881`).
- **Almost always the cause: you skipped the off-camera round 1** (Staging step 4), so Beat 4's request *is* round 1. Reset the demo and start again.
- **Otherwise:** the engine's round detection keys on the confirmed case-extension id (`determineCarPurchaseRound`, `car-purchase-engine.ts:195-202`). If that id and Beat 3's payload have drifted apart, Beats 4, 5 and 6 are unrecordable. Do **not** fake them and do **not** file the column under a different id to make the trigger match — the id is visible in the Runtime Inspector, which Beat 6 opens on camera.

---

## Every label, control, and claim verified for this script

Verified against the working tree on 2026-09-03. If any row is false at recording time, fix the row before you fix the take.

| On screen | Source |
| --- | --- |
| Pack/case name **"Vehicle Selection"** | `packages/packs/src/car-purchase.ts:45` |
| Launcher card **"Choose our next car"** (`demo-launcher-car-purchase`) | `apps/web/src/components/DemoLauncher.tsx:53` |
| App bar title (`workspace-app-bar-title`) | `apps/web/src/components/WorkspaceAppBar.tsx:390` |
| Connection pill **"Live"** (`workspace-app-bar-connection-status`) | `apps/web/src/components/WorkspaceAppBar.tsx:286, 397` |
| **"4 options"** (`workspace-app-bar-option-count`) | `apps/web/src/components/WorkspaceAppBar.tsx:410` |
| Developer view icon button (`workspace-app-bar-developer-view`) | `apps/web/src/components/WorkspaceAppBar.tsx:597-598` |
| Icon-only collapse below 800px (`NARROW_MAX_WIDTH_PX = 800`) | `apps/web/src/hooks/use-width-mode.ts:47, 51`; `apps/web/src/hooks/width-mode-constants.ts` |
| Hero headline **"Leading so far: {option}"** / **"Decided."** | `apps/web/src/components/workspace-status.ts:220, 156` |
| Button **"Ask Sift to look into this"** (`request-investigation`) | `apps/web/src/components/RecommendationHero.tsx:159, 172` |
| Button **"Inspect run"** (`open-runtime-inspector`) | `apps/web/src/components/RecommendationHero.tsx:205, 211` |
| `ApprovalCard` renders only when a proposal exists | `apps/web/src/components/RecommendationHero.tsx:231` |
| **"Latest command"** panel (`live-run-status`); phase **"Completed"** | `apps/web/src/components/LiveRunStatus.tsx:145, 150, 72-77` |
| Run summary **"Investigation completed (revised pass)."** | `apps/agent/src/runtime/car-purchase-engine.ts:1041` |
| Chip **"Ready for review"** / **"Stale — needs investigation"** / **"Decided"** | `apps/web/src/components/RecommendationCard.tsx:76-87, 111` |
| Settled status outranks recommendation status (a decided case stays "Decided") | `apps/web/src/components/RecommendationCard.tsx:120, 196` |
| Stale note copy | `apps/web/src/components/RecommendationCard.tsx:224-226` |
| Section headings **Facts / Hypotheses / Limitations / Sources** | `apps/web/src/components/RecommendationCard.tsx:239, 264, 286, 305` |
| Approval **"Your decision"** / **"Your approval needed"** / **"Choose this"** / **"Pass"** / **"Keep researching"** / **"Approved"** stamp | `apps/web/src/components/ApprovalCard.tsx:128, 184, 216, 230, 250, 88, 157` |
| View tabs **Best Match / List / Compare / Board** (`workspace-view-tab-*`) | `apps/web/src/components/WorkspaceViewSwitcher.tsx:201-205, 290, 293` |
| List card **"Selected"** marker, tint, focus control | `apps/web/src/components/OptionListView.tsx:320-321, 334-336, 347` |
| List rank badge **"#N of M"**, **"N% score"**, **"on N% of what you said matters"** | `apps/web/src/components/OptionRankBadge.tsx:301, 322, 362` |
| Compare heading **"Compare the options"** | `apps/web/src/components/OptionCompareView.tsx:567` |
| Compare row **"Custom"** badge, tooltip "Added for your comparison" | `apps/web/src/components/OptionCompareView.tsx:333-338` |
| Compare **"Same for all"** badge + **"Show separately"** toggle | `apps/web/src/components/OptionCompareView.tsx:343-348, 357-364` |
| Compare cell literal **"Unknown"**; enum values render verbatim | `apps/web/src/components/OptionCompareView.tsx:381`; `apps/web/src/components/attribute-value-format.ts:168-169` |
| Compare **"Pinned"** section | `apps/web/src/components/OptionCompareView.tsx:677-685` |
| Compare note **"Showing 2 of 4 options in this comparison…"** | `apps/web/src/components/OptionCompareView.tsx:580-583` |
| Compare is head-to-head (max 2 columns) at ≤800px; explicit `optionIds` order wins | `apps/web/src/components/OptionCompareView.tsx:187-196, 207-220, 433-439`; `apps/web/src/hooks/use-width-mode.ts:47` |
| Footer strip **"WebMCP ready…"** / **"WebMCP unavailable…"** | `apps/web/src/components/WebMcpStatus.tsx:80, 68`; mounted `apps/web/src/app/App.tsx:2786` |
| Inspector sheet title **"Run details"**; tabs Overview / Timeline / Activity | `apps/web/src/components/RuntimeInspector.tsx:331, 350, 365, 380` |
| Inspector opens on **Activity** when `runId` is null; Overview shows **"No run data yet."** | `apps/web/src/components/RuntimeInspector.tsx:288-290, 432-434` |
| Overview fields Obligation / Case / Trace / Session / Events / Errors; Session renders `(none)` | `apps/web/src/components/RuntimeInspector.tsx:463-494, 476, 485` |
| **"Inspect event"** → focused Timeline item auto-scrolls and outlines (`data-focused="true"`) | `apps/web/src/components/ActivityTimeline.tsx:154-163`; `apps/web/src/components/RuntimeInspector.tsx:241, 245, 319, 591` |
| Six graph nodes, first four in a parallel branch | `apps/agent/src/runtime/car-purchase-graph.ts:114-129` |
| One `intervention.confirm` on a consequential tool call, with its reason | `apps/agent/src/runtime/interventions.ts:186-187` |
| 26 registered tools, pinned | `apps/web/src/model-context/webmcp-contract.test.ts:297, 302` |
| `document.modelContext.registerTool` is the real production path | `apps/web/src/model-context/adapter.ts:96, 109` |
| No approval tool exists in the catalog | `apps/web/src/model-context/register-sift-tools.ts` (`sift_request_revision` builder; `commands.reviewProposal` never referenced) |
| `origin: 'user'` ⇒ extension confirmed immediately | `packages/core/src/extensions.ts:105-108, 137-140` |
| `sift_set_view` modes `quick_pick / list / compare / board` | `packages/contracts/src/case.ts:341`; tool `register-sift-tools.ts:758`; schema `webmcp-local-schemas.ts:141-152` |
| `sift_configure_comparison` `optionIds` / `visibleAttributeIds` / `pinnedAttributeIds` / `sort` | tool `register-sift-tools.ts:811`; schema `webmcp-local-schemas.ts:161-188` |
| `sift_define_case_attribute` takes `definition` **and** `values`; column + cells are one append | `packages/contracts/src/commands.ts:449, 455`; `apps/agent/src/services/command-service.ts:1292-1297` |
| `orderedValues` (worst→best) must hold exactly the `allowedValues` set | `packages/contracts/src/commands.ts:331, 343, 349-381` |
| Enums are not ordinal until declared: *"no declared worst-to-best ordering…"* | `packages/core/src/scoring.ts:40-41, 227-234` |
| A `values` entry is a real value **or** `status: 'unknown'` with a required `reason` | `packages/contracts/src/commands.ts:393-421` |
| An `unknown`'s reason becomes an option-linked `CaseNote` of kind `question`, same transaction | `apps/agent/src/services/command-service.ts:1521-1538` |
| Only `origin: 'user'` may claim `status: 'verified'` | `packages/core/src/attributes.ts:388-395` |
| A criterion reaches a custom column through `appliesToAttribute`; extensions score like pack attributes | `packages/contracts/src/commands.ts:521-536`; `packages/core/src/scoring.ts:852-865` |
| Weights are 0–100 integers normalised by their sum, not out of 100 | `packages/contracts/src/commands.ts:529`; `packages/core/src/criteria.ts:215-230`; applied `packages/core/src/scoring.ts:550` |
| The `add` branch has no decided-case guard (only pack extension policy); the protected-criterion guards apply to remove/reweight | `apps/agent/src/services/command-service.ts:1763-1795` (add), `:1799-1835` (protected) |
| Round-2 trigger is the confirmed case extension id (see "If round 2 does not fire") | `apps/agent/src/runtime/car-purchase-engine.ts:195-202` |
| Round 2 is the only path to `proposal.proposed` | `apps/agent/src/runtime/car-purchase-engine.ts:881`; round 1 records a recommendation and no proposal (`:571-600`) |
| Round 2 supersedes (does not delete) round-1 teaser-price evidence | `apps/agent/src/runtime/car-purchase-engine.ts:653-673` |
| A criteria change revises the plan but starts no run | `apps/agent/src/services/run-plan-service.ts:95-125` |
| `recommendation.invalidated` marks the recommendation stale and leaves the proposal intact | `packages/core/src/reducer.ts:245-257` |
| Beat 4's 0.4 / 65% / 79% / 95% / 17% | **MEASURED** — read off the live card, three identical harness runs over real WebMCP in real Chrome |
| Beat 7's rank badges 84/96 · 68/96 · 56/81 · 18/96 | **MEASURED** — same three runs. The Beat 4 board's RAV4 and CX-5 badges were not measured and are not printed |
| An unknown lowers coverage, never score, and is reported as a limitation | `apps/agent/src/runtime/recommendation-scoring.ts:163, 194-203`; `packages/core/src/scoring.ts:26-30` |
| Confidence capped at 0.4 when the model and the scoreboard disagree | `apps/agent/src/runtime/recommendation-scoring.ts:186-189, 238-242` |
| All five round-2 Limitations lines are now derived from real coverage; the hard-coded pair is gone | **MEASURED** — five-line block captured verbatim in Beat 4 |
| Line 5 is an unprompted sensitivity analysis ("take it out of the weighting and … comes first instead") | **MEASURED** — same block |
| Inspector **Execution** tab (`runtime-inspector-tab-execution`): "Strands Graph", "6 nodes · 3 stages", "STAGE 1 — 4 IN PARALLEL" | **MEASURED** — landed and verified on the live run |
| Real OpenTelemetry: 276 span rows, 272 parented, five-level tree with SDK durations | **MEASURED** — `span_id`/`parent_span_id` populated in `runtime_events` |
| Active weights: the pack's five defaults + 20 = 120 (Beat 4); + 15 = 135 (Beat 7) | consistency check only — it reproduces the measured 17% and 79%/96%/81% coverage; the measurements are the source of truth |
| Public URL | `docs/submissions/release-metadata.json:3` |

---

## The evidence to cite in the Devpost write-up (not on camera — there is no time)

`artifacts/host-acceptance/` holds automated real-host acceptance runs against the live Railway deployment in **Chrome 152.0.7977.75** with native `document.modelContext`, driven over Chrome's `WebMCP` CDP domain: **14/14 checks passing** on `2026-09-02T18-26-35-407Z` and `2026-09-02T18-51-03-610Z` (both `"url": "https://sift-hackathon-production.up.railway.app"`, both `"ok": true`), plus a later local 14/14 run. The checks include tool discovery (3 global, 26 once a case exists), schemas reaching the host, a person's click becoming visible to the host (`eventSequence` 12 → 13), a host write rendering in the pane without a reload, a blind write refused by schema validation, reload persistence, re-registration after reload, host reconnect — and **"no approval tool: the catalog exposes no tool that can approve a decision."**

Two limits are written into every `report.json` and must be repeated wherever this evidence is cited: **it is Chrome, not ChatGPT**, and **no model chose anything — the script picked every call.** `docs/submissions/webmcp/host-acceptance.md` carries both verbatim. Do not let the video's narration imply otherwise.

---

## Post-recording checklist

- [ ] Total runtime is under 3:00. `pnpm test:submission` fails the release at 180s or over.
- [ ] Audio is clear and present throughout (hard OpenAI requirement).
- [ ] The recording shows the **real** deployed product — `sift-hackathon-production.up.railway.app` — not `localhost`.
- [ ] Every `sift_*` call narrated actually fired, and the on-screen state changed to match it.
- [ ] Round 1 was run **off camera** before rolling, and Beat 4's Latest command panel says **"(revised pass)"** — not "(initial pass)". Every figure below is downstream of that one step.
- [ ] Beat 3's seat row is on screen with the CR-V cell reading **"Unknown"**; Beat 7's software row is on screen with a **"Custom"** badge.
- [ ] Beat 4's spoken figures match the card: **ninety-five to sixty-five**, and **nought point four**. If the card says 59, round 1 was not pre-staged — reset and re-record, do not re-narrate.
- [ ] Beat 4 scrolls all five Limitations in one pass and lands on line 5, the sensitivity analysis.
- [ ] Beat 7's rank badges read **84 / 68 / 56 / 18** and were read off the List cards before anything about them was said aloud.
- [ ] Beat 6 opens on the **Execution** tab, and contains no excluded claim — no Session field, no Guide/Deny, no GoalLoop, no tokens, no redaction. "Correlated trace" is now permitted and is in the script.
- [ ] No claim that a pack badge, compiled hash, or consumer activity ledger is on screen.
- [ ] The word "ChatGPT" appears only if the host actually was ChatGPT.
- [ ] Upload publicly to YouTube (public or unlisted, never private) and confirm playback in a signed-out incognito window before submitting.
