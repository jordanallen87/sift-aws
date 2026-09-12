# Product and Scope Specification

## Product promise

Sift handles the repetitive investigation behind consequential everyday decisions and interrupts the user only when evidence, authority, or preference requires judgment.

The product should feel like a calm case board rather than a chatbot dashboard. The agent works visibly in the background, the person can reshape the investigation from the page or from ChatGPT, and the final decision remains recognizably theirs.

Sift does not compete with the base model on eloquence. It supplies the durable evidence, completion, adaptation, persistence, and authority layer that a one-shot answer lacks. The required product proof is defined in `value-proposition.md`.


## Vehicle Selection: the adaptive journey

This replaces the earlier fixed car flow (a launcher, a catalog, a shortlist).
The approved experience is
[docs/final-plan/final-approved-experience.md](../final-plan/final-approved-experience.md);
the decisions behind it are
[ADR 0009](../decisions/0009-adaptive-decision-experience.md).

### The journey

1. **Conversational activation.** A person says what they want in ChatGPT.
   WebMCP tools describe Sift, list packs, and start or resume the case. The
   pane immediately shows the decision, the pack, the phase, current
   coverage, current focus, and the next action.
2. **Adaptive discovery.** The pack declares required topics and a bounded
   interaction grammar, not a fixed script. One natural answer may resolve
   several topics at once, and an answered topic is never asked again.
   Recognition beats recall: option-first where the pack supplies seeds, open
   text for nuance.
3. **Needs, importance, and blockers.** Inputs are classified **Must work**,
   **Matters a lot**, **Nice to have**, or **Needs verification**. A model
   may propose; only a person may confirm, and nothing becomes a blocker
   without that confirmation. Missing compatibility data is *Needs
   verification* — neither a pass nor a failure.
4. **One blind-spot review.** Before model discovery, Sift raises plausible
   omissions for this case — car-seat layout, garage clearance, charging
   access, load height — with "None of these" and "Something else" as real
   answers.
5. **Model discovery.** The full 853-record bundled EPA catalog is the
   discovery universe. A curated cohort of eight models adds the
   decision-relevant fields EPA data does not carry, every one labelled
   `curated_demo`. No live price, no local availability, no dealer terms.
6. **Quick Pick.** Keep / Pass / Unsure, one card at a time, canonical and
   undoable. Keep retains a candidate for a closer look and focuses deeper
   work on it. **Keep is not shortlist confirmation**, and the card says so.
7. **Living recommendations.** A continuously recomputed list, not a purchase
   instruction. A leader appears only when deterministic evidence supports
   one; otherwise a tie or group. Unknown never becomes zero; disputed never
   becomes settled.
8. **Human authority.** Confirming the test-drive shortlist and the final
   choice are human-only moves with no tool attached to them at all.

### Two modes, one engine

| | Companion (ChatGPT pane) | Standalone |
| --- | --- | --- |
| Required topics | Must be confirmed or not-applicable before discovery | Same |
| Soft topics | May not be deferred | May be deferred |
| Deferred output | n/a | Labelled **provisional** |
| Navigation | Conversation-led, one dominant artifact | Direct navigation, filters, search |

### The data boundary

The external world may be curated. The product may not be simulated.

Real: tool registration and calls, canonical state changes, discovery
coverage and readiness, bounded interaction validation and rendering, Quick
Pick persistence and undo, deterministic ranking and invalidation, RunPlan
events, evidence-to-recommendation cause and effect, human authority,
persistence and resume.

Curated and labelled: vehicle profiles and indicative price bands, external
evidence responses, specialist tool results, deterministic provider responses,
synthetic personas.


## Target users

The hackathon audience is an individual dealing with an unfamiliar, evidence-heavy personal decision:

- a household comparing shortlisted cars and dealer offers before choosing what to test-drive or buy;
- a household trying to understand and respond to an abnormal utility bill;
- a person who wants an agent to do the comparison work without silently making purchases, bookings, or commitments.

## Core jobs

1. Turn an unstructured question and supporting documents into a visible decision case.
2. Select the appropriate Decision Pack without requiring the user to understand internal agent configuration.
3. Investigate unresolved questions using the right skill and specialist at the right time.
4. Show what is known, what is inferred, what conflicts, and what remains unknown.
5. Let the user change criteria or focus by selecting evidence in the web page and speaking to ChatGPT.
6. Produce a reviewable recommendation and preserve human authority over the decision.

## Primary experience

The user opens a public Sift URL in ChatGPT's in-app browser. The page contains a seeded demo launcher and the active case workspace. The user can interact in either direction:

- Human to page: select a claim, change a criterion, expand a source, request another investigation, approve or reject a proposal.
- Human to ChatGPT: ask why the recommendation changed, tell the agent to ignore a line item, or request a different comparison.
- ChatGPT to page: discover and invoke WebMCP tools that call the same command layer as the visible controls.
- Runtime to page: stream truthful case and activity events for routing, skill activation, specialist execution, tools, steering, evidence, readiness, and proposals as they happen.

The page must make agent activity legible without requiring users to read chain-of-thought. It displays actions, inputs, outputs, evidence, and policy decisions, never private reasoning traces. A command shows accepted/queued state only after the service returns its receipt; every later progress state is driven by an actual streamed event.

## Real-time experience contract

The normal workspace behaves as a live case board rather than a request/response form:

1. A visible control or WebMCP callback sends the same typed command.
2. The service returns `commandId`, `caseId`, accepted sequence, and `runId` when work begins.
3. The initiating control becomes correlated queued/active state without blocking the rest of the case.
4. The page streams specialist, skill, tool, steering, evidence, obligation, and recommendation events.
5. Each public activity item can open the exact correlated Runtime Inspector event.
6. Canonical snapshots update only from committed case events.
7. Disconnect preserves the last valid state, visibly reconnects, replays from `Last-Event-ID`, and falls back to snapshot polling when necessary.

At minimum, the demos visibly pass through queued, investigating, tool-active, evidence-arrived, guided or waiting, recommendation-recomputed, and completed states. Loading copy or timers cannot fabricate an event that did not occur.

## Workspace layout

**Status: implemented in `apps/web/src/app/App.tsx`, with one gap noted inline below.** This section replaces the nine-region ordered list this section previously specified under ADR 0002 — a list the shipped implementation had already silently drifted from into an unspecced eleven-region stack, which is the regression ADR 0004 exists to close (see that ADR's Context for the measured evidence). The region order below matches `App.tsx`'s own header comment, which is the authoritative as-built record of this restructure; `docs/build-log.md` records task-by-task history.

**A primary workspace view dominates the page** rather than a stack of independent cards:

1. **Case identity** — a single slim line: decision title and a compact status summary (e.g. "4 vehicles · Comparing · 2 things need attention"). No Decision Pack ID, version, compiled hash, command ID, or other developer identifier appears here. A short domain label may appear if pack presentation metadata supplies one; the pack ID and hash never do.
2. **The answer hero** — the current recommendation and the single next human action, merged into one region directly below case identity. It is one region, not two, specifically so it cannot disagree with itself about the case's current state (ADR 0004 decision 1: today's `ApprovalCard` and `RecommendationCard` can render contradictory summaries of the same case in the same glance). This is deliberately the first substantial content the user reaches. It renders only when there is something to say; see "Empty regions" below.
3. **The primary workspace view** — one of the generic option views (Quick Pick, List, Compare, Board; see "Workspace views" below), selected by `WorkspaceViewState.mode`. This is the main body of the page; every other region is secondary to it.
4. **Secondary decision navigation** — Questions ("To Check") is implemented as a closed-by-default disclosure ("Still checking") wrapping `ReadinessPanel`, plus "Manage options" and "Add something Sift should check" as sibling disclosures. Decision Profile ("What you're looking for") and Notes ("Notes" plus "Add a note") are now mounted here too — see "Decision Profile" and "Research and Notes" below. **A dedicated Research view is the one remaining gap in this region**: it does not yet exist separately from `FindingsSheet`'s evidence-disposition framing (see "Research and Notes" below). This omission is not silent — it is recorded here and in the referenced section rather than implied to be finished.
5. **Developer/Inspect boundary** — implemented as `RuntimeInspector`, and every raw runtime identifier this item names is genuinely absent from the consumer surface (see "Consumer and developer projections" below). **A real, explicit entry point exists**: `CaseHeader` carries a small, always-visible "Developer view" icon control, reachable the moment any case is open — it needs no prior run or other activity, unlike the hero's "Inspect run" control (`RecommendationHero`'s `onInspectRun`, still present and unchanged), which still renders only once a live/recent run receipt exists. Both open the same `RuntimeInspector`; the header control opens it generally, "Inspect run" opens it pre-targeted at a specific run. This closes change-set §36's request for an intentional developer/inspect entry point. See `debugging-and-observability.md` for exactly how this control is (and is not) gated relative to `SIFT_DEBUG_ENABLED`.

**Empty regions.** Do not render an empty conceptual region merely because `CaseState` contains a corresponding field (change-set §5). An empty state must be intentional, compact, and attached to the region that owns the concept — never its own full-height card whose entire content is an announcement of its own emptiness. A workspace with no options yet shows one compact prompt to add or find options, not several independently empty cards each reporting that there is nothing to show. **Status: substantially restructured, not exhaustively verified.** The hero merge (item 2 above) already removes the two-cards-disagreeing defect this rule exists to prevent, and `CaseExtensionReviewCard` now mounts only while an extension is genuinely pending rather than rendering its own "nothing pending" copy. There is not yet a test suite asserting every audited region is *absent* (not merely visually small) when empty; treat this rule as directionally satisfied by the redesign rather than exhaustively proven.

**Above-the-fold is a testable acceptance property, not only a written promise.** At each of the three canonical narrow widths (390, 430, 480), the answer hero's top edge must fall within the first viewport height, measured against the real production build. This exact property was specified once already (ADR 0002) and silently regressed once because nothing tested it (ADR 0004's own account: "a spec sentence alone already failed to hold it"). A Playwright assertion enforcing it is required release evidence — see `testing.md` — not merely a sentence in this document.

At desktop/expanded width, the same primary-view-dominant structure applies, with a genuinely different information architecture where a specific view benefits from one (see "Narrow and expanded modes" below) — never a three-column dashboard or full-page navigation chrome layered onto the narrow design.

### Consumer and developer projections

Change-set §33 requires that the consumer workspace and a developer/inspect surface project from the *same* underlying events — never two independently maintained truth sources. The consumer surface answers "what does this mean for my decision"; the developer surface answers "what exactly did the system do." `apps/web/src/components/activity-labels.ts` is the designated extension point for this mapping (internal event type → consumer copy), not a new mechanism to build. Content that moves off the consumer surface and stays developer-only: `commandId`, `runId`, the compiled pack hash, specialist ID, skill ID, the raw chronological activity ledger, and the E0–E3 evidence-level vocabulary.

### Guided case workflow

The primary consumer pane guides a case through five sequential stages:
**Intake, Priorities, Analysis, Review, and Decide**. These stages are a
workflow stepper, not peer tabs. At narrow width the persistent affordance
names the current stage and ordinal progress without forcing all five labels
into one row. Completed stages remain revisitable; unavailable future stages
state their prerequisite; and an upstream change that invalidates analysis
must make the stale state visible.

Findings, Sources, and Activity belong to Analysis. Quick Pick, List,
Compare, Board, filters, option profiles, and Keep / Unsure / Pass belong to
Review. Consequential proposal controls belong to Decide. The stepper derives
its status from canonical case state and never becomes a second persisted
workflow engine. See ADR 0016.

### Lifecycle language

The four-stage tracker (Started / Investigating / Pick ready / Decided) is retired. Consumer-facing progress uses task-shaped stages appropriate to the pack and the case's current point in the process — a generic shopping/comparison lifecycle is Find; Shortlist; Compare; Review; Decide, or a compact subset of it. This tracker must not dominate the page once a comparison is active: once inside an active workspace view, the view itself is more informative than a permanent process tracker (change-set §37).

This has a direct contract consequence: **`CaseStatus` is a two-value type, `'draft' | 'decided'`.** The values `investigating`, `waiting`, `ready`, and `failed` are removed from the contract (see `architecture.md`) — no production code path ever assigned them, and the lifecycle vocabulary that would have displayed them is replaced entirely by the task-shaped stages above (ADR 0004 decision 4).

### Current focus ("Currently checking")

Where the workspace shows what is actively being investigated, it must derive from a genuinely populated `activeFocus` value — never render a region whose only possible state is a permanently-true empty placeholder. `activeFocus` remains a real `CaseState` field (see `architecture.md`), but until a production code path writes a non-null value to it, no "currently checking" region renders at all, rather than rendering a card that can only ever show its own absence (ADR 0004 decision 5). Once populated, consumer copy reads like "Currently checking — Whether the Forester's lower price still holds after dealer fees" or "Rechecking — Ride-comfort evidence after your priorities changed" (change-set §39); the underlying obligation, skill, and specialist identifiers remain visible only in the developer view.

## Workspace views

**Status: implemented and wired.** Four option views exist, each answering a different decision task rather than being cosmetic renderings of the same data (change-set §8), and each is reachable in the live page today through `WorkspaceViewSwitcher` (`apps/web/src/components/WorkspaceViewSwitcher.tsx`), mounted as the primary workspace region (see "Workspace layout" above). **The workspace opens on Quick Pick, not Compare** (`WorkspaceViewState.mode` falls back to `'quick_pick'` when nothing has persisted a view yet): the always-fully-expanded Compare table, as a freshly opened case's default view, was the single largest contributor to a measured ~3379px 390px-baseline height, and Quick Pick's one-option-at-a-time rendering is both a legitimate first-class triage view in its own right and the shortest of the four by construction. Nothing becomes unreachable — every view, including Compare, stays exactly one tap away on the always-visible tab strip immediately below the hero.

- **Quick Pick** (`QuickPickView.tsx`) — a single-option triage view. One option dominates the pane; the user Passes, Maybes, or Shortlists it through accessible buttons (swipe gestures are additive, never gesture-only). Answers "should I keep looking at this one."
- **List** (`OptionListView.tsx`) — a compact, information-dense card per option: identity, price, high-value attributes, strengths, concerns, unresolved information, current fit, relevant source-backed findings. Answers "tell me about each option." Not every available field is shown; pack presentation metadata influences which fields are prominent.
- **Compare** (`OptionCompareView.tsx`) — a configurable comparison table, a genuine rewrite rather than an extension of the retired `OptionComparison.tsx` (ADR 0005 decision 5; the old component has since been deleted from the codebase entirely, not merely excluded from the live page). Answers "how do these options differ." Narrow mode (≤480px, docs/engineering-principles.md's canonical narrow-pane ceiling) is a two-option head-to-head; expanded mode (wider) is a multi-column table showing every visible option — this is the one view currently wired to real narrow/expanded width detection (`useWidthMode`; see "Narrow and expanded modes" below). Which options and which attribute rows are visible, which rows are pinned, sort order, and filters are all configurable — by the user directly, and through WebMCP by ChatGPT (see `webmcp.md`, PRESENTATION tools). Custom (`custom.*`) fields render as ordinary rows, subtly marked (e.g. a "Custom" badge) as added for this comparison; their raw IDs never reach this surface.
- **Board** (`OptionBoardView.tsx`) — movable status columns (a useful default: Considering; Top choices; Need to verify; Out), configurable where the pack allows. Answers "where does each option currently stand." Moving an option preserves human authority — the model may suggest a move with a stated reason but does not silently eliminate a candidate; a keyboard-operable alternative to drag-and-drop is required (change-set §49) and implemented.

`WorkspaceViewState.mode` selects the active view. `WorkspaceViewState` is a `CaseState` field (see `architecture.md`) that persists through the same `updateSelection()` path as `selectedOptionId`/`activeFocus` — a presentation change, and structurally incapable of invalidating a recommendation because that path never reaches the invalidation code (ADR 0005 decision 1). The command-service handler (`setView`) that reaches `updateSelection()` for the `view` field is implemented and durable, and every PRESENTATION-class WebMCP tool (`sift_set_view`, `sift_configure_comparison`, `sift_focus_question`) reaches it too — none hold view state only in browser-session memory (see `webmcp.md` for the exact per-tool contract). This is what makes change-set §54's rule true by construction rather than by convention: "Show only safety and cargo" changes what is visible; it does not change what the user says matters. Changing `criteria` is a separate, decision-mutating command, and the two must never be conflated.

`FindingsSheet`'s existing List/Table/Kanban tabs are evidence-review UI — keyed on evidence disposition, not option identity — and are not a foundation for these four views; they remain unchanged, serving their existing purpose. Only its generic `Sheet`/`Tabs` shell is shared as a UI primitive with the new view components (ADR 0005 decision 3).

### Narrow and expanded modes

**Status: implemented and wired across the shell and all three views that benefit (ADR 0007).** A real width-detection mechanism exists (`apps/web/src/hooks/use-width-mode.ts`, `useWidthMode`, ADR 0005 decision 4): a live `matchMedia` listener keyed to docs/engineering-principles.md's 480px narrow-pane ceiling, falling back safely to `narrow` wherever `matchMedia` is unavailable (SSR/JSDOM) rather than throwing. `WorkspaceViewSwitcher` calls it once and passes an explicit `layout` prop to each view; the views stay pure. That is deliberate and load-bearing: `matchMedia` does not exist in this repo's jsdom environment, so a hook called inside a view would pin every test to `narrow` and leave the expanded layouts permanently unasserted.

**This section previously read "implemented, partially wired" and described List and Board's expanded treatment as "open work."** That was accurate as documentation and useless as scheduling — nothing converted it back into a task, and meanwhile a more basic problem made the whole question moot: three top-level components each independently capped their own container at `max-w-[480px]`, so at a 1440px viewport the entire product rendered in a 448px column surrounded by empty space. Expanded mode was not partially wired, it was structurally unreachable — `OptionCompareView` correctly switched to its multi-column table above 480px and then had to scroll it inside a 448px card. See ADR 0007 for how every existing gate passed anyway.

What each view does at each width now:

- **Shell** — a single `.page-shell` class: `--pane-width-max` (480px) at narrow, `--shell-width-max` (1280px) above 481px, centred. The launcher deliberately keeps pane width via `.pane-shell`, since a three-choice entry screen has nothing to spread across 1280px; that exemption is a named class rather than an omission so it reads as a decision.
- **Quick Pick** — narrow-native by design, unchanged at both widths (ADR 0005 decision 4).
- **List** — narrow keeps the single stacked column. Expanded renders cards in `.option-grid` so several are visible at once, and raises the prominent-field budget from 6 to 10, walking every pack presentation group in the author's declared order rather than only the first. Pack-driven prominence is respected, never bypassed.
- **Compare** — two-option head-to-head at narrow, multi-column table when expanded (unchanged logic; it now has the width it always assumed).
- **Board** — narrow keeps fixed-width horizontally-scrolling columns. Expanded uses a single-row grid so more status columns are visible simultaneously without scrolling, and raises the facts-per-card budget from 2 to 4. The keyboard-operable alternative to drag-and-drop (change-set §49) is identical in both modes and is asserted as such.
- **Catalog browse** — single-column list at narrow; `.option-grid` card grid at expanded, each card adding a mini spec sheet (body style, drivetrain, fuel type, combined MPG, estimated annual fuel cost, EPA fuel-economy score, cargo volume), every row omitted rather than fabricated when the field is null.

Running prose and stacked forms take `.reading-measure` / `.form-measure` caps so widening the shell does not produce 150-character lines or 1280px-wide text inputs. Grids, tables, and boards deliberately take the full shell.

`assertExpandedLayoutUsesWidth` (`tests/e2e/helpers/layout-assertions.ts`) is the release evidence: at any viewport above 480px the main content container must measure materially wider than the narrow pane. It is a lower bound on width rather than a snapshot, so it asserts the property §7 requires without pinning one design.

### Decision Profile

**Status: implemented and mounted.** `apps/web/src/components/decision-profile.ts` derives a first-class consumer projection — "what are we actually looking for": budget/constraints, usage context, must-haves, preferences, priority ordering, and open clarifying questions — purely from the existing criteria/attribute/case-extension model, with no competing second source of truth (change-set §15). Priorities are shown as simplified weight bands (e.g. Very important / Important / Somewhat important) rather than raw numeric percentages by default, with exact weights available behind a closed advanced disclosure and always preserved internally regardless of display (change-set §42). `suggestedQuestions` is derived from exactly three real sources — pack-guide questions (see the pack-level Decision Guide, below), unmet-obligation questions, and a criterion's own declared question — never fabricated; an empty list renders nothing.

`DecisionProfileView.tsx` (the presentation component) is fully tested and consumes this projection. `App.tsx` computes `deriveDecisionProfile(snapshot, activePack?.decisionGuide)` — a pure projection, no new stored state — and mounts it in a closed-by-default disclosure ("What you're looking for") in "Secondary decision navigation" (see "Workspace layout" above), positioned below the answer hero so the above-the-fold invariant is unaffected. It is absent entirely, not merely empty, when the derived profile has nothing to show. ChatGPT's WebMCP visibility into profile-adjacent state (missing information, unresolved questions) is separately real through the widened case context (see `webmcp.md`).

**Priorities are also a real write surface, not only this read-only projection.** `CriteriaEditor.tsx`, reached from the app bar's "Add or adjust → Adjust priorities" item, lets a person change every non-protected preference criterion's weight directly — until this existed, `sift_update_criteria` was reachable only through WebMCP, so an assistant could change what a case weighs and a person at the keyboard could not. It commits on an explicit "Save weights" action rather than per-keystroke (each change invalidates the recommendation and reopens the affected synthesis obligation, so a live-writing control would churn the case through invalidations nobody asked for), sends only the weights that actually moved, and renders a protected criterion (e.g. Home Energy Guardian's emergency-risk gate) as a stated constraint rather than a control that would only fail if tried. The running total shown is never silently normalized: the deterministic core scores against whatever weights the case actually holds, so rescaling the number on screen would make it disagree with the number doing the work.

### Questions ("To Check")

The consumer projection of obligations. Each unresolved obligation is shown as a plain-language question (e.g. "CR-V dealer price still needs verification"), never as obligation/evidence-level jargon. Focusing a Question informs subsequent case context the same way focusing an option does.

### Research and Notes

**Research status: the underlying model is real and substantially more complete than before this task.** `submitSource` now turns submitted claims into durable, option-linked `Claim` records instead of silently discarding them (change-set §27, ADR 0006 decision 2), and research (sources, claims, provenance) is part of the widened WebMCP case context ChatGPT can read (see `webmcp.md`). A dedicated first-class consumer UI presenting this as a Research summary → Findings → Sources hierarchy — source title, publisher, relevance, freshness, disposition — remains to be built in the primary workspace; `FindingsSheet` today still frames this content as evidence-disposition review (its long-standing, unchanged role — see "Workspace views" above) rather than the option-centric research hierarchy this section describes. E0–E3 evidence-level vocabulary stays in the developer view unless useful.

**Notes status: implemented.** `CaseNote` (change-set §28/§51; `CaseNoteSchema`, `packages/contracts/src/case.ts`) is a lighter-weight, non-evidentiary record — an observation, question, preference, or reminder, with a `kind`, optional links to one or more options and one unresolved question (obligation), and optional source ids cited purely for context — distinct from evidence, event-sourced (`note.added`), and durable across reload. **The defining rule: a note never auto-promotes to evidence, by construction.** Adding one cannot satisfy an obligation, move readiness, or invalidate a recommendation — the command handler that creates one (`CommandService.addNote`) has no code path that touches any of those. `CaseNotes` (`apps/web/src/components/CaseNotes.tsx`) renders every note on the case — the component itself returns `null` when there are none, so no wrapping disclosure is needed at its call site — and `AddNoteForm` (`apps/web/src/components/AddNoteForm.tsx`) is a closed-by-default disclosure giving a person at the keyboard the write half that previously existed only through the `sift_add_note` WebMCP tool. Both are mounted in "Secondary decision navigation" (see "Workspace layout" above), immediately after the Decision Profile. ChatGPT reads and writes notes through `sift_list_notes`/`sift_add_note` (see `webmcp.md`).

### Custom fields are first-class

A case-defined `custom.*` attribute (see `pack-authoring.md`) is a hero product capability here, not an edge case. It renders beside pack-native fields in List, Compare, and Board with a subtle "added for this comparison" indicator, never as a raw ID. Opening a custom field explains why it exists, who added it, what sources support it, and what remains unknown. The model may populate a custom field's value across options, but every populated value preserves provenance, origin, and confidence, and an unsupported subjective value remains explicitly unknown rather than a fabricated inference (change-set §22–§26).

## Standing Watch

**Specified, not yet implemented.** Full runtime rationale in docs/decisions/0015-standing-watch-and-background-triggers.md. This section is the UI half of that decision, held to the same rigor ADR 0004 and ADR 0009 already hold the rest of this workspace to: concrete states, exact copy rules, and empty/loading/error behavior for each surface — because autonomy a person cannot observe is indistinguishable from a fake. Every surface below is specified 390px-first; a wider layout only ever gets more room, never different content or a different rule.

Only a case running the `bid-comparison` pack can show any of the surfaces below in this build (docs/decisions/0015, "Pack scope") — `car-purchase` and `home-energy-guardian` cases declare no `watches[]`, so every rule below that says "absent when the case has no watches" already covers them without a pack-specific UI branch.

### Freshness

The one-line answer to "how current is this recommendation, and is anything watching it." Renders inside the answer hero (`RecommendationHero`), directly beneath the recommendation headline, only when the case has at least one watch — a case with none renders no freshness line at all, the same "do not render an empty conceptual region" rule the rest of this document already applies (see "Empty regions" above), because a case nothing is watching has nothing true to say about its own currency.

Three states:

- **Current** — `"Current as of {relative time} · watching {n} thing{s}."` The relative time is measured from the **stalest** (least recently checked) active watch on the case, not the freshest. A recommendation is only as current as the least-recently-confirmed input feeding it: if one watch checked 30 seconds ago and another two minutes ago, the honest claim is "as of two minutes ago," because that is the last moment every watched input was confirmed unchanged. Reporting the freshest watch's time here would silently launder the stale one's uncertainty into a claim the product cannot back.
- **Checking** — while a watch-initiated run is actively executing for this case (a queued or active run carrying `origin: 'watch'`, a new value on the existing `CommandOrigin` vocabulary, `packages/contracts/src/http.ts`'s `COMMAND_ORIGINS` — today that array holds only `'webmcp'`, with an absent origin meaning "a person, through the UI"; this is the same field extended with a new value, not a new mechanism), the line reads `"Checking now · watching {n} thing{s}."` with no relative time — stating a stale "as of" timestamp while a fresh check is already in flight would be misleading in the other direction.
- **Stale** — when the scheduler has not completed a tick for this case within the interval its own fastest declared watch expects (the scheduler process was behind, restarting, or otherwise not keeping up), the line reads `"Last checked {relative time}, longer than usual · watching {n} thing{s}."` in a subdued attention treatment — not an error state, not red, not alarming. A scheduler running behind is an honest operational fact, not a product failure, and must not be styled as one.

Loading and error: the freshness line has no independent loading skeleton. It renders once real watch state is available and renders nothing until then, and it renders nothing (rather than a broken or guessed value) if watch state specifically fails to load while the rest of the case loads normally — the same "an error must not blank the workspace" rule under "Required visible states" below, applied to exactly this one region rather than the page.

At 390px the line sits on its own row beneath the headline, wraps rather than truncates on a long `n`-things count, and is itself a tap target that opens "The watch list" below (see that section) — "watching 3 things" is a promise a person must be able to verify with one tap, not a number they have to take on faith.

### "Since you were away" digest

A compact card mounted between the answer hero and the primary workspace view (`product.md`'s "Workspace layout," between existing regions 2 and 3), testid `since-you-were-away-digest`. It exists to answer "what happened while I wasn't looking," driven by the read marker (`architecture.md`'s `read_markers` table, ADR 0015's Prerequisites).

**Appears only when both are true:** the case has at least one watch, and the case's `read_markers.lastSeenActivitySequence` is behind at least one watch-originated public event (`watch.fired`, `watch.triaged`, `watch.suppressed`, an `intervention.confirmation_required` from a watch-initiated run, or a `recommendation.invalidated`/`recommendation.ready` a watch run produced) since that marker. Otherwise the card does not render — not a "nothing happened" empty state, an absent region, matching every other empty-region rule in this document.

**At most three lines.** Ordered by how much a person's decision is implicated, most first: (1) a pending interrupt or a changed recommendation, (2) a reopened obligation or new evidence, (3) a suppressed-but-material check summary. Within a tier, newest first. When more qualifying events exist than fit in three lines, the third line is replaced with a rollup — `"+{n} more"` — that is itself a control opening "The watch list" below, never a dead label that silently drops events. A digest that truncates without saying so is exactly the kind of silent gap the rest of this specification refuses elsewhere (evidence, coverage, scoring); it is refused here too.

**Dismissal** advances the read marker to the case's current activity sequence — it marks everything as seen; it does not delete, hide, or otherwise alter the underlying events, which remain fully visible in the activity stream and Runtime Inspector. A `"Dismiss"` control (testid `since-you-were-away-dismiss`) is keyboard-reachable and at least 44×44 CSS px (`testing.md`'s touch-target rule). Reopening a case afterward with no further watch activity shows no digest at all, because the marker has already caught up — this is the intended steady state, not a bug.

At 390px the card is a single column; each of its (at most three) lines wraps on its own rather than clipping mid-word.

### Interrupt policy

Reached from the app bar's existing **"Add or adjust"** menu (`workspace-app-bar-create-menu`), as a new item alongside "Adjust priorities" (`workspace-app-bar-priorities`) — `workspace-app-bar-interrupt-policy`. Present only on a case with at least one watch; absent, not disabled, on one with none, for the same reason the freshness line is absent — there is nothing honest to say a policy about.

Three levels, exactly:

| Level | Label | Meaning |
| --- | --- | --- |
| `decision_only` | "Only if the decision changes" | **Default.** Interrupt only when the deterministic core's before/after comparison finds the favored option, readiness, or a hard constraint actually changed (docs/decisions/0015 Decision 5). |
| `any_change` | "On any change" | Interrupt whenever a watch's triage finds a change material, even if the decision itself did not move. |
| `never` | "Never — I'll check" | No interruption from any watch on this case; every material change becomes a quiet entry in the digest and the watch list instead. |

The menu item itself states the case's current level inline (e.g. `"Interrupt policy · Only if the decision changes"`), so a person can see their current setting without opening anything. Opening it presents the three levels as a radio group with the current selection marked, and one sentence under each stating its consequence in the same plain terms as the table above — mirroring how `CriteriaEditor` already states a protected criterion's consequence rather than only offering a control that would fail if tried.

Setting this is a **person-only, durable, event-sourced decision** — it commits through `append()`, never `updateSelection()`, because it changes a real fact about how the person wants to be treated, not a presentation setting. There is no model write path to it at all, not even a propose-and-confirm one: extending "the model may never trigger an interruption" (docs/decisions/0015 Decision 5) to its logical edge, the model also never gets to suggest loosening or tightening how interruptible a person is. This one setting applies to every watch on the case uniformly in this build; a per-watch override is out of scope (ADR 0015, "Alternatives considered").

### The watch list

A closed-by-default disclosure in "Secondary decision navigation" (`product.md`'s "Workspace layout," region 4), a sibling of the existing "Still checking" and "Manage options" disclosures — **"What Sift is watching"**, testid `watch-list-disclosure`. This is the surface that makes vigilance verifiable rather than merely claimed: tapping "watching {n} things" in the freshness line opens this disclosure directly.

Each watch renders, in the pack's declared order:

- its human-readable `label` (never the raw `id`, the same developer/consumer boundary this document applies everywhere else);
- a plain-language statement of what would make it fire, drawn from the pack's declared `description` (never the raw `predicate`, which is developer-view jargon — see `debugging-and-observability.md`);
- when it was last checked, as a relative time honoring the same fixture-time labelling rule as the freshness line;
- its most recent outcome — see "`watch.suppressed` must be visible" below for the exact wording rule.

Absent entirely (not present, not shown empty) on a case with no watches — the disclosure itself does not exist rather than existing to say "nothing is being watched," which would be a region whose only possible state is its own absence, the exact pattern "Current focus" already refuses.

### `watch.suppressed` must be visible, without becoming noise

A quiet agent that can never show its quiet work looks identical to an agent that did nothing. The rule this feature exists to prove — "it noticed and chose not to bother you" — needs a real, visible line, and it needs to never grow unbounded, because an appendable log of every suppressed check ever would itself become the noise the interrupt policy exists to prevent.

The resolution: **one line per watch, always overwritten by that watch's most recent outcome**, shown in the watch list (above) and, when it is the most decision-relevant thing that happened since the person was last here, as the digest's lowest-priority line. Never a running history of every suppressed event.

Two outcome copy strings, and the distinction between them is a rule, not a style choice:

- `"Checked {relative time} — nothing that changes your decision."` — the watch's predicate **fired**, triage ran, and the deterministic core found nothing crossing the person's interrupt policy. Real work happened and was judged immaterial.
- `"Checked {relative time} — no change."` — the watch ticked and its predicate never fired at all. No triage ran because there was nothing to triage.

Using the second string for the first case (or vice versa) is a defect against this specification: the person is entitled to know whether the agent actually looked at something and decided it did not matter, versus found nothing to look at in the first place — that distinction is the entire content of the "quiet, not absent" claim.

### Case list

**Prerequisite, specified, not yet implemented** (docs/decisions/0015, "Prerequisites"; `architecture.md`'s `GET /api/cases` and `GET /api/events`). A new top-level view, distinct from the existing demo launcher, listing every case rather than one — the surface "3 watched, 1 needs you" requires and that the product currently has no way to show at all, since today's product opens directly into one active case with no list of others.

**Row state machine**, per case:

| State | Meaning | Visual treatment |
| --- | --- | --- |
| `no_watches` | The case declares no watches (every `car-purchase`/`home-energy-guardian` case, and a `bid-comparison` case before its first recommendation) | Plain row: title, pack, status only |
| `watching_quiet` | At least one active watch, nothing pending | Row carries a quiet "watching" indicator |
| `watching_needs_you` | At least one `pending_interrupts` row is unresolved for this case | Row carries a visibly distinct badge/dot — the one state a person is meant to notice without opening anything |

A case transitions between these states only from real data (`watches`/`pending_interrupts` rows), never from a client-side guess.

**What the global stream must carry.** `GET /api/events` (`architecture.md`) does not need to replay full event payloads to drive this list — it is a summary surface, and opening a case still uses the existing per-case `GET /api/cases/:caseId/events` stream for detail. Per case, it needs only enough to move one row between the three states above without a full-page poll: the case id, a monotonic per-case revision marker (the case's own `eventSequence` or its `activity_events` max sequence is sufficient — no new counter is required), the case's current pending-interrupt count, and its most recent activity timestamp.

At 390px this is a single-column stack of full-width, tappable row cards — never a dense table — the same "canonical UI is a 390–480px pane" rule the rest of this specification holds everywhere else.

### Honesty copy rules for Standing Watch

The general rule is stated in docs/decisions/0015-standing-watch-and-background-triggers.md ("Honesty boundary"): copy must state what is being checked and where the data came from, and must never imply a live external source that does not exist. Applied to each surface specified above:

| Surface | Compliant | Non-compliant | Why |
| --- | --- | --- | --- |
| Freshness | "Current as of 2 minutes ago (fixture clock) · watching 3 things." | "Current as of 2 minutes ago · watching 3 things." (fixture mode, no qualifier) | An unqualified relative timestamp in fixture mode reads as wall-clock time to a person with no way to know the clock is injected. |
| Digest | "Cedar's revised bid arrived (fixture feed) — the ranking flipped back." | "New email from Cedar & Sons." | The compliant line names the fixture feed and the fact that changed; the non-compliant line invents a live inbox connection the product does not have. |
| Watch list | "Checks the bids inbox fixture for a newer document than this case has seen." | "Monitoring your inbox." | Same rule as the ADR's general table, restated for the description a person actually reads. |
| Case list | "3 cases · 1 needs you" | "3 cases syncing live" | "Syncing" implies a live external connection driving every row; what is actually true is a bounded scheduler ticking over fixture feeds. |
| Interrupt policy | "Interrupt me only if the decision changes" | "Get notified instantly when anything changes" | "Instantly" claims a responsiveness the periodic, fixture-driven scheduler does not have and should never imply. |

**No timestamp anywhere in this feature's UI omits its fixture-time qualifier when the deployment is running in fixture mode.** This is checked the same way `product.md`'s other release-relevant copy already must be — as a literal text assertion, not only a visual baseline (`testing.md`'s existing rule that pixel diffing alone is not an acceptable substitute for a text assertion on copy that changed on purpose, applied here to copy that must never silently regress to an unqualified timestamp).

### New visual baselines this feature requires

Every surface above is new, visible product surface and needs its own named Playwright baseline at `390x844`, `430x900`, and `480x900` (and the `1440x1000` secondary project) once implemented, per `testing.md`'s existing visual-verification contract: the freshness line in each of its three states, the digest card (both its normal and its "+n more" rollup state), the watch list disclosure both closed and open, the interrupt policy sheet, and the case list in all three row states. None of these exist as baselines today because none of the underlying surfaces exist yet.

## Required visible states

Every region must have explicit UI for:

- initial and empty;
- loading;
- partial evidence;
- active investigation;
- guided retry;
- waiting for confirmation;
- blocked;
- stale evidence;
- ready for review;
- approved, rejected, and revision requested;
- recoverable error;
- unsupported WebMCP host.
- reconnecting, replaying, and polling fallback.

Errors must preserve the last valid case state. A failed model or tool call becomes an event and a blocked or retryable obligation; it must not blank the workspace.

## Demo launcher

`docs/decisions/0003-vehicle-catalog-and-normal-case-creation.md` (ADR 0003) changed this section: the launcher's job is no longer only to start one of two fixtures — it is the front door into two genuinely different ways of using Sift.

The launcher presents one primary action above a visually secondary, grouped pair of example cards:

- **Compare vehicles** (primary) — opens the vehicle catalog and shortlist flow (see "Vehicle catalog and normal case creation" below). This is a normal product action, not a demo: it creates a fresh, empty `car-purchase` case (`startCase`) and lets the user add real vehicles to it themselves.
- **Or try a finished example** (secondary group heading), containing the two pre-existing demo cards, copy and behavior completely unchanged:
  - **Choose our next car** — starts the checked-in deterministic Car Purchase fixture and permits editing the seeded household priorities and candidates.
  - **Investigate my energy bill** — starts the Home Energy Guardian fixture.

Starting either example resets its case to the checked-in fixture and generates a fresh case ID; it does not depend on a previous demo run. Both example cards keep their pre-existing `data-testid`s, copy, and `startDemo` command wiring exactly as they were — this ADR is additive to the launcher (a new primary action, a new group heading, and visual demotion of the pre-existing pair), not a rewrite of the demo path.

## Vehicle catalog and normal case creation

ADR 0003's core product change: **Sift is useful as a normal vehicle-comparison website before ChatGPT/WebMCP is involved.** A user reaching "Compare vehicles" can:

1. Browse/search a bundled catalog of real published vehicle specifications (year, make, model, trim, body style, drivetrain, powertrain, combined fuel economy) — no network access required, no live pricing or dealer data.
2. Add up to five vehicles to a shortlist, removing or replacing any before committing.
3. Start a real, persisted `car-purchase` case from that shortlist (`startCase`, then one `upsertOption` per selected vehicle — the exact same command visible controls and WebMCP callbacks already share). The resulting case is pinned to the `car-purchase` Decision Pack's ID/version/compiled hash exactly like a demo case.
4. Continue in the normal case workspace: compare candidates, add listing-specific facts (price, mileage, dealer, listing URL) via the existing `OptionEditor`, change criteria, add a custom concern, submit their own sources, and set evidence dispositions — every one of these commands works identically on a catalog-built case and a demo case, since none of them are demo-specific.

**Known, disclosed limitation:** guided/automated investigation (`requestInvestigation`) currently runs only against the deterministic Car Purchase example case. A catalog-built case's `requestInvestigation` call fails honestly with a clear explanation rather than crashing or fabricating a plausible-looking recommendation — see ADR 0003 §4. Every other capability above remains fully real and functional on a catalog-built case. Building a genuine, generic investigation engine for arbitrary user-built shortlists is out of scope for this task and is recorded as a known limitation, not silently implied as working.

Catalog data is intentionally a separate, narrower fact class from case data (ADR 0003): a catalog record describes a year/make/model/trim's *published specifications* and is never mutated once a case has copied its known fields onto a candidate entity — later catalog updates never reinterpret an existing case.

## User-facing terminology

Consumer-facing labels are not applied mechanically — choose language that makes sense in context. The guiding rule (change-set §4): consumer UI should explain what something means for the decision, not how Sift implemented it. The table below is illustrative, not exhaustive; the canonical mapping implementation is `apps/web/src/components/activity-labels.ts` (see "Consumer and developer projections" above).

| Internal term | UI label |
| --- | --- |
| `DecisionPackManifest` / `CompiledDecisionPack` | Decision Pack — developer view only; the consumer surface shows at most a short domain label |
| Case | Comparison / Decision |
| Obligation | Question to resolve, grouped under **To Check** |
| Convergence | Ready for decision |
| Intervention | Guidance or safeguard — developer view only |
| `Guide` | Agent redirected / Rechecking another way |
| `Confirm` | Your approval needed |
| `Deny` | Action blocked |
| Evidence ledger | Research, shown per-option as Research summary → Findings → Sources |
| Claim | Finding |
| Agent graph | Investigation team — developer view only |
| Readiness | **To Check** |
| Raw activity ledger (`commandId`, `runId`, tool/skill/specialist IDs) | developer view only |
| `activeFocus`, when genuinely populated | **Currently checking** / **Rechecking** |
| Recommendation | **Current recommendation**, or **Leading option** before readiness is earned — never "Our pick" before then |
| Approval | **Your decision** |
| Accepted uncertainty | Decide without this |
| Case extension / `custom.*` attribute | comparison field, marked "added for this comparison" |
| Decision Profile (criteria + attributes + case extensions, projected) | **Decision Profile** |
| Option comparison view | **Compare** |
| `VehicleCatalogRecord` | Vehicle |
| Shortlist (pre-case candidate selection) | Your shortlist |
| `startCase` | Compare vehicles |
| E0–E3 evidence levels | developer view only |

## Success criteria

The hackathon build succeeds when:

- a judge can understand the product within 20 seconds of seeing the workspace;
- both demo scenarios complete from reset using fixture-backed tools;
- ChatGPT can inspect and update the active case through WebMCP without simulated clicking;
- changing one user criterion visibly changes the engine's next move or recommendation;
- adding one concern absent from the installed pack creates a visible typed case extension, derives an evidence question when necessary, and affects the run plan without recompiling the pack;
- at least one skill activation, specialist change, guided retry, evidence conflict, readiness transition, and human approval boundary is visible during the demos;
- the user sees real queued, running, tool, evidence, steering, and completion events without refreshing the page;
- a judge can open the Runtime Inspector and connect a recommendation change to the skills, handoffs, tools, interventions, sources, state diffs, tokens, and latency that produced it;
- every displayed claim links to a source fixture and every automated action links to a runtime event;
- a full automated release gate verifies both scenarios end to end;
- the deployed Strands service passes AgentCore's `/ping` and `/invocations` protocol checks.

## Explicit scope cuts

The following do not ship in the hackathon version:

- accounts, authentication, teams, or multi-user collaboration;
- arbitrary file uploads beyond the provided demo fixtures; users may manually enter up to five car candidates, select them from the bundled vehicle catalog, and paste structured listing or offer details;
- OCR or general document ingestion;
- automated vehicle marketplace scraping, live pricing, VIN-level inventory, utility accounts, email, calendar, dealer contact, purchasing, financing applications, or scheduling — the bundled vehicle catalog (ADR 0003) is a static, offline, bounded snapshot of published specifications, never a live marketplace integration;
- autonomous final decisions;
- a graphical Pack Studio, pack marketplace, runtime self-modification, or pack composition; a local conversational `pack-authoring` skill and CLI are included;
- unrestricted browser automation;
- general-purpose chat embedded in Sift;
- a mobile application;
- long-term memory across unrelated cases;
- claims that Sift provides financial, legal, automotive, energy, or professional advice.

The demos may include optional live research, but their required path uses deterministic local tools. The UI labels the scenarios as illustrative decision support.
