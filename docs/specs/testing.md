# Automated Testing and Self-Healing Specification

## Objective

The test system must prove the demo, not merely exercise code. Every visible demo beat has deterministic assertions over case state, runtime trajectory, policy decisions, WebMCP behavior, and rendered UI.

The release gate produces machine-readable evidence that Claude Code can use to diagnose and repair failures. Self-healing is bounded and test-preserving: Claude may repair implementation or fixtures, but it may not weaken acceptance assertions to manufacture a green build.

## Verification layers

### Static verification

- TypeScript strict typecheck for every workspace.
- ESLint with zero warnings.
- Prettier check.
- Dependency and circular-import check.
- Zod schema compilation for all pack manifests, discriminated attribute values, case extensions, authoring drafts, and scenario files.
- Search gate rejecting conventional unfinished-work markers, focused tests, skipped tests, and exclusive test modifiers.

### Unit tests

Vitest tests pure behavior for:

- pack compilation and registry;
- deterministic router scoring and threshold behavior;
- case creation and pack ID/version/hash pinning;
- typed attribute definitions/values, case-extension creation, origin, confirmation, and namespace rules;
- custom-criterion obligation derivation and dependency invalidation;
- obligation derivation, dependency ordering, prioritization, attempt budgets, and accepted uncertainty;
- evidence levels, source independence, staleness, fail-closed verdicts, and convergence;
- recommendation invalidation after criteria or evidence changes;
- policy enforcement and human-only approval;
- intervention detection and action precedence;
- event reduction, optimistic concurrency, idempotency, clocks, and IDs;
- tool argument normalization and no-progress detection.
- runtime event correlation, redaction, retention, payload bounds, and state-diff generation.
- authoring-tool draft-root confinement, compiler diagnostics, deterministic hash, and human-only publication.

Critical invariants in `packages/core` and `packages/packs` require 100% branch and function coverage. Global thresholds are 90% branches and 95% lines, functions, and statements.

### Property tests

fast-check verifies:

- router output never references an unregistered pack;
- explicit user selection always wins for a valid pack;
- a pinned case never changes pack through routing;
- compiled pack hashing is deterministic for semantically identical manifests;
- a case extension never removes or weakens a required pack obligation or protected criterion;
- every valid `AttributeValue` variant round-trips through the reducer and persisted schema;
- `unknown` attribute status persists without a placeholder value, while every non-unknown status requires a valid value;
- arbitrary unsupported or executable values are rejected;
- adding a user concern cannot increase readiness before its evidence question is resolved;
- event sequence is monotonic;
- reducing the same idempotent event twice does not duplicate its effect;
- adding failed, degraded, skipped, or stale evidence cannot promote readiness;
- removing included evidence cannot increase readiness;
- an agent actor can never produce an approved decision;
- normalized criterion weights remain finite and sum to one when at least one criterion has positive weight.

### Component tests

React Testing Library verifies every visible state named in the product specification. All interactive controls use stable `data-testid` values and accessible names. axe checks run on the launcher, active workspace, pending confirmation, error, and decided states.

### HTTP integration tests

Tests start the real Express application with a migrated temporary SQLite database, temporary session store, scripted models, and fixture tools. Every endpoint has success, validation, not-found, conflict, policy, cancellation, and internal-error coverage where applicable.

Tests assert both the HTTP response and persisted event/snapshot state.

### WebMCP contract tests

An in-memory `ModelContextAdapter` records tools and invokes their actual callbacks. Contract tests verify the complete list in `webmcp.md`, dynamic registration, schema validation, cancellation, command equivalence, UI updates, conflict recovery, and the absence of an agent approval tool.

### Scenario tests

Scenario tests execute the actual core, pack, Strands adapter, scripted model, interventions, fixture tools, event store, and API in process. They do not render a browser.

Each scenario is declarative:

```ts
interface DemoScenario {
  id: string
  packId: string
  seed: ScenarioSeed
  steps: ScenarioStep[]
  assertions: ScenarioAssertion[]
}

type ScenarioAssertion =
  | { kind: 'pack_selected'; packId: string; reasonIncludes: string }
  | { kind: 'case_extension_defined'; definitionId: string; origin: string }
  | { kind: 'case_obligation_created'; obligationId: string; criterionId: string }
  | { kind: 'skill_activated'; skillId: string; obligationId: string }
  | { kind: 'specialist_invoked'; specialistId: string }
  | { kind: 'graph_node'; nodeId: string }
  | { kind: 'swarm_handoff'; from: string; to: string }
  | { kind: 'context_injected'; fields: string[] }
  | { kind: 'goal_validation_failed'; reasonIncludes: string }
  | { kind: 'snapshot_restored'; caseId: string }
  | { kind: 'debug_event_correlated'; eventName: string; activityType: string }
  | { kind: 'redaction_canary_absent'; canary: string }
  | { kind: 'tool_called'; toolId: string; count?: number }
  | { kind: 'intervention'; action: 'guide' | 'confirm' | 'deny'; handler: string }
  | { kind: 'claim_linked'; claimId: string; sourceIds: string[] }
  | { kind: 'evidence_stale'; evidenceId: string }
  | { kind: 'obligation_status'; obligationId: string; status: string }
  | { kind: 'readiness'; ready: boolean; blockers: string[] }
  | { kind: 'recommendation'; favoredOptionId: string }
  | { kind: 'human_action'; action: string }
  | { kind: 'forbidden_event_absent'; eventType: string }
  | { kind: 'watch_fired'; watchId: string }
  | { kind: 'watch_triaged'; watchId: string; material: boolean }
  | { kind: 'watch_suppressed'; watchId: string }
```

The last three kinds are **specified, not yet implemented** — docs/decisions/0015-standing-watch-and-background-triggers.md, which also specifies the scheduler that would emit the events these assert on. They exist in this union now so a scenario written against them and an implementation of the scheduler can be developed against the same declared contract rather than a second one invented at implementation time. `watch_fired`/`watch_triaged` name the watch a bounded predicate/triage step ran for; `watch_suppressed` is the assertion the minimum Standing Watch slice cannot ship without, since "it noticed and chose not to bother you" is the one demo beat with no other test kind capable of proving it — a run that produces no visible change looks identical to a run that never happened unless something explicitly asserts the suppression occurred.

The runner writes the final snapshot, event log, normalized agent trajectory, and assertion report to `artifacts/verification/scenarios/<scenarioId>/`.

### Standing Watch scheduler determinism

**Specified, not yet implemented.** Full rationale in docs/decisions/0015-standing-watch-and-background-triggers.md ("Determinism and testing"). A scheduler cannot be tested with a real sleep, and this suite does not gain one:

- **An injectable `Clock`.** The scheduler takes the same `{ now(): string }` port every deterministic module in `packages/core` already takes, imported from `packages/core/src/ports.ts` — the file a prior integration pass already established as canonical, not a fourth local declaration. `packages/core` currently carries three structurally-identical `Clock` interfaces (`attributes.ts`, `evidence.ts`, `policy.ts`), left in place by a recorded prior decision rather than collapsed; the scheduler's own obligation is only to adopt the existing canonical port for its own new code, never to add a fourth copy or to take on collapsing the other three as part of this feature's scope.
- **Unit and scenario tests advance a fake clock and call the dispatcher's tick function directly.** No wall-clock time passes during a test run. A test asserting "the 30-day price hold lapses" sets the fake clock's `now()` past the stored deadline and calls the tick once.
- **Idempotent-tick regression coverage.** Because ticks are idempotent, keyed by `(watchId, cursor)` (`architecture.md` "Standing Watch scheduler"), the direct regression test for "a restart mid-tick replays correctly" is calling the dispatcher twice for the same watch state and asserting the second call is a no-op — no process restart needs to be simulated to prove this property.
- **A dev-only "advance fixture time" control for browser tests.** `pnpm test:e2e`/`pnpm test:journey` drive a real running server process from the browser side, where a unit test's technique of swapping a fake `Clock` into a function call does not apply. The control is gated the same way `SIFT_DEBUG_ENABLED` gates the Runtime Inspector — never present in a build where advancing fixture time could be mistaken for advancing real time — and advances the server's injected clock plus triggers one dispatcher pass, so a Playwright test can drive "the price hold lapses" or "the revised bid arrives" deterministically instead of waiting or faking a longer test timeout. Its own UI surface, and the rule that any timestamp advanced this way must render labelled as fixture time, are specified in `product.md`'s "Honesty copy rules for Standing Watch."
- **New scenario coverage** exercises a fake clock advancing through a fixture timeline and asserts, in order: `watch_fired` → bounded run → recommendation change → **no** proposal auto-approval (the existing `forbidden_event_absent` kind already covers the last of these; nothing new is needed there). Mutation coverage (`stryker.config.mjs`'s `mutate` globs) must name the interrupt-policy decision function explicitly once it exists outside `packages/core`/`packages/packs`, the same way `bill-feed-gate.ts`/`energy-calculator.ts`/`scope-differ.ts`/`bid-calculator.ts` are already named individually — it is a decision rule governing human attention, and the existing globs will not find it on their own.

### Decision Pack conformance tests

`pnpm test:pack` discovers every built-in and authoring fixture pack and runs the same compiler/conformance suite. It verifies reference resolution, extension policy, Graph/Swarm bounds, required negative scenarios, authority rules, generic UI renderability, deterministic compilation, and immutable version/hash pinning.

The compact `apartment-hunt` authoring fixture must begin without a pet-sensory field, accept a typed `custom.pet_sensory_fit` criterion, create a case obligation, persist it through SQLite, render it in the generic UI, and preserve an explicit unknown when no installed source can verify it.

The `pack-authoring` skill integration suite uses the real Strands AgentSkills activation with a scripted model and temporary draft root. It proves catalog, scaffold, validate, test, diff, confirmation, and publish behavior; path traversal, executable manifest content, failing conformance, an agent actor, and public authoring-disabled configuration are rejected.

### Browser E2E tests

Playwright starts the real web and agent services with deterministic fixtures. Tests cover:

- launching each demo from a clean state;
- responsive rendering at `430x900` and `1440x1000`;
- running the full scenario through visible controls;
- running key steps through the in-memory WebMCP bridge exposed to the browser test;
- focusing evidence and seeing the selection reflected in case context;
- changing criteria and observing recommendation invalidation and revision;
- guided retry and stale-evidence activity cards;
- adding a concern not declared by the pack and observing its typed field, evidence question, and targeted investigation;
- real queued, specialist, skill, tool, evidence, steering, recommendation, and completion updates without page refresh;
- SSE disconnect/replay through `Last-Event-ID`, duplicate suppression, slow-client resync, and polling-equivalent final state;
- explicit human proposal review;
- persistence after reload;
- network interruption and recovery;
- accessibility and keyboard operation;
- stable screenshots for launcher, active investigation, confirmation, ready, and decided states.
- opening the Runtime Inspector, filtering events, expanding a steering/tool/handoff event, viewing a state diff, jumping from activity to trace, and downloading a sanitized run bundle;
- the answer hero's top edge falls within the first viewport height at `390x844`, `430x900`, and `480x900`, measured against the real production build (`product.md`'s above-the-fold acceptance property, required by ADR 0004 decision 6). This exact property was specified once already under ADR 0002 and silently regressed once because nothing tested it; this assertion exists specifically so a third regression fails the release gate instead of requiring another manual audit to notice;
- a presentation-only change (workspace view mode, focused option/evidence/question, visible/pinned comparison fields, sort, filters — whether made through the UI or a PRESENTATION-class WebMCP tool) provably does not invalidate the recommendation. Assert this both behaviorally (the recommendation's status and sequence are unchanged after the presentation change) and structurally, where the implementation allows it (the underlying store call reaches `updateSelection()`, never `append()` — see `architecture.md`'s "Two persistence paths" and ADR 0005 decision 1). A test that only checks the end state and never distinguishes "no invalidation happened" from "invalidation happened but produced the same visible result" does not satisfy this requirement.

**Status: implemented.** `tests/e2e/generic-decision-workspace-journey.spec.ts` (Task J1) is the change-set §61 generic-workspace journey — Quick Pick/List/Compare/Board round-tripped through both the UI and WebMCP, dynamic custom-field creation and population, the Decision Profile, notes, and a developer-view correlation click, all in one consolidated, ordered flow. The checked-in E2E suite is `car-purchase-journey.spec.ts`, `home-energy-guardian-journey.spec.ts`, `vehicle-catalog-journey.spec.ts`, `generic-decision-workspace-journey.spec.ts`, `reload-persistence.spec.ts`, `error-recovery.spec.ts`, and `keyboard-accessibility.spec.ts`. The new spec's own header comment discloses two departures from §61's literal step wording (its "normal comparison start" step reuses the demo launcher rather than `VehicleCatalogFlow`, since guided investigation only runs against the deterministic demo case; and round-1 investigation is requested before the search/add/verify steps rather than after) — both are disclosed reorderings, not omissions, and every one of §61's 22 numbered beats is still exercised in the same session, including the above-the-fold assertion and the presentation-versus-decision-mutation boundary (both below).

The primary visual project is `right-pane` with viewports `390x844`, `430x900`, and `480x900`. A secondary desktop project runs at `1440x1000`. Every required state has both semantic assertions and a named screenshot; screenshots alone are insufficient.

Visual tests must:

- call `toHaveScreenshot()` with animations disabled, a checked-in deterministic font setup, and `maxDiffPixelRatio` no greater than `0.01`. As implemented (`tests/e2e/car-purchase-journey.spec.ts`, `tests/e2e/home-energy-guardian-journey.spec.ts`), this is `expect(page.getByTestId('case-workspace')).toHaveScreenshot()` (or `demo-launcher` before a case exists), not a plain `expect(page)` capture: the right-pane workspace is realistically far taller than any configured viewport (a real, growing activity ledger, comparison table, and forms), so an un-scoped viewport screenshot would only ever show the same top-of-page fold at every named state and could never distinguish "recommendation ready" from "decided". Scoping to the workspace's own root element captures its full real height at each checkpoint instead, which is the literal visual-baseline intent this bullet describes. Two additional, empirically-discovered masking rules apply (`tests/e2e/helpers/visual-masks.ts`): the real system clock/id generator make every `<time>` element and the active run's `commandId`/`runId` genuinely non-deterministic between runs, so those are masked (or, where a masked region's own *height* is itself non-deterministic -- car-purchase's real six-node Strands Graph genuinely fans four specialists out in parallel, so `ActivityTimeline`'s item order and `LiveRunStatus`'s phase-breadcrumb length both vary run to run -- temporarily hidden via `display: none` for the capture and restored immediately after);
- assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth` at every right-pane state;
- assert the bounding boxes of fixed/sticky controls do not overlap the focused card, approval controls, or WebMCP status;
- verify primary controls remain inside the viewport and have at least a 44-by-44 CSS-pixel target where applicable;
- run axe against launcher, investigating, guided, waiting, ready, error, and decided states;
- fail on uncaught page errors, unexpected console errors, failed same-origin API requests, or hydration warnings;
- retain Playwright trace, screenshot, video, console log, request log, and final case snapshot on failure.
- assert fixture traces show safe model/tool payloads while user-entered cases show hashes/summaries and never raw private notes.
- treat `maxDiffPixelRatio: 0.01` as a ceiling on layout drift, not as sufficient coverage for copy correctness. A full product rename (Pax → Sift) once passed this exact suite green against stale baselines that still rendered the old name, because the changed text occupies a small fraction of a tall, scrolled workspace screenshot and stayed under the 1% pixel-diff threshold undetected. Any release-relevant copy — the product name, region headings, and the terminology-table labels in `product.md` — must additionally be asserted as literal rendered text (`toHaveText`/`toContainText` or equivalent) at the relevant checkpoints; pixel diffing alone is not an acceptable substitute for a text assertion on copy that changed on purpose.
- treat the named baselines as **blind to colour**, and cover colour with a computed-style assertion instead. This is not the ratio ceiling above and cannot be repaired by tightening it. Playwright compares PNGs with `pixelmatch` at `threshold: 0.2` (playwright-core 1.62.1), which calls two pixels identical up to a YIQ distance of `35215 * 0.2² = 1408.6`. Recolouring the entire app from ink-blue `#2c4870` to Sift Green `#1f5c52` measures **113.1** — an eighth of that tolerance. Measured directly on this build at `right-pane-390`: the `case-workspace` capture is exactly one viewport (390×844; the pane shell is fixed-height, so `scrollHeight === clientHeight`), 16,341 of its 329,160 pixels (**4.96%**, nearly 5× the 1% budget) genuinely change colour, and Playwright counts **0** of them as different. `maxDiffPixelRatio: 0` and `maxDiffPixels: 0` both still pass. Lowering `threshold` below ~0.057 would register the change but is exactly the tolerance that absorbs font antialiasing and GPU dithering across machines, so it buys colour sensitivity with cross-machine determinism. `assertBrandColorIntegrity` (`tests/e2e/helpers/layout-assertions.ts`, called from `expectNamedScreenshot`, so every named baseline at every viewport carries it) is the second signal: it resolves `--color-brand`, `--color-brand-strong`, `--color-brand-tint`, `--color-focus-ring`, `--primary`, `--sift-brand`, `--sift-green-600`, and `--color-ink-on-brand` through the rendering engine and requires each to equal the identity value in `docs/brand/palette.json`, and requires every visible primary `Button` to paint exactly that fill and on-brand label colour. It anchors on the identity palette, not on `apps/web/src/styles/tokens.css`, because anchoring on the file under test would make an edit to the brand edit its own expectation.

Golden screenshots may be updated only after the executor opens and inspects the generated image, states why the change is intended, and confirms it against the relevant requirement. Blind `--update-snapshots` repair is prohibited.

Playwright waits on domain state and test IDs. Fixed sleeps are prohibited.

### Live tests

`pnpm test:live` is opt-in and requires AWS credentials. It invokes the configured Bedrock model against fixture tools and asserts schemas and trajectory invariants, not exact prose.

`pnpm test:deployed` verifies:

- public web health and static assets;
- AgentCore `/ping`;
- one AgentCore invocation per hero pack;
- CORS from the public web origin;
- WebMCP tool registration in a compatible Chromium run;
- no secrets in returned payloads.

`pnpm test:host` drives a **real WebMCP host** against a running instance (ADR 0013). Chrome 152 ships WebMCP natively (`document.modelContext`) and exposes a `WebMCP` CDP domain — `enable`, `invokeTool`, `cancelInvocation`, and the `toolsAdded`/`toolsRemoved`/`toolInvoked`/`toolResponded` events — so tool discovery, schema delivery, invocation, both-direction state control, reload persistence, and host reconnect are automated rather than transcribed by hand. It is opt-in (`SIFT_HOST_URL`), never part of `pnpm verify`/`verify:release`, exits non-zero rather than degrading to a meaningless pass when no WebMCP host is available, and writes evidence to `artifacts/host-acceptance/<runId>/`.

`pnpm test:journey` builds on the same host session to run **turn-based journeys through the rendered pane** (ADR 0014), evaluating case state, what the pane shows, and whether the two agree — separately, after every turn. A turn is taken either by the person, through visible controls, or by the assistant, through a real WebMCP tool call, so the claim that both reach the same command implementation is tested rather than asserted. It captures a screenshot per turn, which is what `docs/ux-review-2026-09-02.md` is written from.

`pnpm webmcp:bridge` exposes the page's live tool registrations to any MCP client, so a real model can drive the page. That is the one thing neither gate above can establish: both choose their own calls, and neither can tell you whether a model finds the tools or sequences them sensibly.

This replaces the manual host-smoke record, which existed because no WebMCP host could be driven — a fact that stopped being true. Two things it does not prove, both recorded in its own `report.json`: it is **Chrome, not ChatGPT** (a page cannot tell hosts apart, so the page-side contract is the same, but a claim naming a product needs a session in that product), and **no model chose anything** (the script picks every call). A session in a specific assistant remains the only evidence for those two, and is narrowed to exactly them.

## Demo traceability matrix

| Demo beat | Unit | Integration | Scenario | Browser E2E | Live |
| --- | --- | --- | --- | --- | --- |
| Correct Decision Pack selected with reasons | router | API | required | visible badge | Bedrock router smoke |
| Skill activated dynamically | skill policy | Strands adapter | required | activity card | trajectory invariant |
| Car-purchase Graph node executes | graph builder | Strands Graph | Car required | activity card | trajectory invariant |
| Energy Swarm changes specialist | handoff policy | Strands Swarm | Energy required | current-focus card | trajectory invariant |
| Repeated search is guided | retry detector | interventions | required | guidance card | optional |
| Premature conclusion is withheld | output validator | GoalLoop adapter | Energy required | draft-withheld card | trajectory invariant |
| Current case state is injected | context projection | Context Injector | Energy required | updated focus/criteria | trajectory invariant |
| Paused run restores from snapshot | snapshot policy | session adapter | Energy required | reload/reconnect | deployed smoke |
| Conflicting evidence becomes stale | evidence ledger | event store | Car required | evidence badge | not required |
| Criteria change invalidates recommendation | reducer | command API | both required | WebMCP + UI | not required |
| Confirmation precedes consequential proposal | policy | intervention API | Energy required | approval card | trajectory invariant |
| Agent cannot approve decision | policy | command API | forbidden assertion | no agent control | not required |
| Final decision survives reload | reducer | persistence | required | required | deployed smoke |
| Activity opens exact trace event | correlation | debug API | both required | inspector journey | deployed smoke |
| Tool/model/state detail is inspectable | redactor | hook + OTEL capture | both required | inspector tabs | CloudWatch correlation |
| Secrets and private notes are absent | redactor | persistence/export | required | response/download checks | deployed canary |
| SQLite survives service restart | store | migrated SQLite | required | reload after restart | Railway required |
| Unanticipated concern becomes a typed case extension | extension reducer | command/store | Car required | custom criterion journey | not required |
| Pack-authoring skill produces a valid bounded draft | compiler/policy | real AgentSkill + authoring tools | authoring fixture | transcript/docs smoke | not required |
| Workspace updates from truthful real-time events | projection/order | SSE replay/resync | both required | intermediate-state journey | deployed smoke |

## Commands and gates

The implemented repository must provide:

```text
pnpm format:check       formatting only
pnpm lint               lint with zero warnings
pnpm typecheck          all workspace typechecks
pnpm test:unit          unit, property, and component tests
pnpm test:coverage      the full test:unit suite, with coverage measured and thresholds enforced
pnpm test:pack          pack compiler, conformance, extension, and authoring-skill tests
pnpm test:integration   HTTP, store, and Strands-adapter integration
pnpm test:contract      WebMCP and AgentCore contracts
pnpm test:scenario      both deterministic demo scenarios
pnpm test:e2e           Playwright critical journeys
pnpm test:observability Runtime Inspector, trace correlation, redaction, and export
pnpm test:mutation      targeted core invariant mutation tests
pnpm test:live          opt-in Bedrock tests
pnpm test:deployed      opt-in public deployment tests
pnpm test:host          opt-in real WebMCP host acceptance in Chrome 152+ (ADR 0013)
pnpm test:journey       opt-in turn-based journeys through the rendered pane (ADR 0014)
pnpm webmcp:bridge      dev tool: exposes the page's WebMCP tools to any MCP client (ADR 0014)
pnpm verify             static + unit + coverage + pack + integration + contract + scenario + E2E
pnpm verify:release     verify + mutation + build + Docker contract + submission checks
```

`pnpm test:coverage` (`vitest run --coverage`) runs the identical `test.projects` suite `pnpm test:unit` runs, with V8 coverage collection turned on. It is a distinct stage rather than a flag added to `test:unit` itself because `test:pack`/`test:integration`/`test:contract` reuse `test:unit`'s own test files with explicit path filters (see `scripts/verify.ts`'s header comment) — coverage percentages are only meaningful measured once across the whole suite, not repeated over each path-filtered subset. Vitest enforces `vitest.config.ts`'s `coverage.thresholds` (branches 90%, functions/lines/statements 95%) itself and exits non-zero on a miss; `scripts/verify.ts` relies on that real exit code rather than re-implementing threshold arithmetic. Reports are written to `artifacts/verification/coverage/` (`text`, `html`, `lcov`, `json-summary`).

`pnpm verify` must run without network access after dependencies and Playwright browsers are installed.

`pnpm test:deployed` is mandatory for Railway. It creates a fixture case, records its case/run IDs, confirms inspector availability, triggers a Railway restart or redeploy, and proves the case, events, trace, and SQLite migration ledger persist afterward.

## Failure artifacts

Every verification command writes JUnit where supported. The top-level verifier always writes:

```ts
interface VerificationReport {
  schemaVersion: '1.0'
  runId: string
  startedAt: string
  finishedAt: string
  gitSha: string | null
  status: 'passed' | 'failed'
  stages: VerificationStageResult[]
  failures: Array<{
    fingerprint: string
    stage: string
    testFile?: string
    testName?: string
    message: string
    relatedRequirements: string[]
    artifactPaths: string[]
    focusedRerunCommand: string
  }>
}
```

The canonical path is `artifacts/verification/latest/report.json`. On failure, `artifacts/verification/latest/summary.md` provides a human-readable version. Previous runs are retained by run ID.

## Bounded Claude repair protocol

`docs/engineering-principles.md` and the implementation plan must instruct Claude Code to use this loop:

1. Run the narrowest required verification command for the current task.
2. On failure, read the complete error and `report.json` before editing.
3. Classify the failure as implementation, contract, fixture, environment, flaky test, or specification conflict.
4. Reproduce with `focusedRerunCommand`.
5. Make the smallest causal repair.
6. Rerun the focused test until it passes.
7. Run the task's complete gate.
8. At milestone boundaries, run `pnpm verify`.
9. Before claiming completion, run `pnpm verify:release` and archive its report.

Claude must stop and write `artifacts/verification/latest/BLOCKED.md` when the same failure fingerprint survives three repair attempts. The report names attempts, changes, evidence, and the decision required. Claude must not continue cycling.

## Test integrity rules

Claude may not:

- delete, skip, focus, or weaken a failing test to make a gate pass;
- reduce coverage thresholds;
- update a golden snapshot unless the corresponding requirement and visible change justify it;
- change a fixture's expected outcome to match incorrect implementation;
- replace an integration with a mock when the specification requires the real boundary;
- treat an unavailable live credential as a passing live test;
- claim a manual ChatGPT host check happened without a recorded result.

Any intentional acceptance change requires a specification edit and explicit user approval before the test changes.

## Flake policy

- A test that passes only on retry is failed and labeled flaky.
- CI does not use automatic test retries for deterministic suites.
- Random generators log and accept a reproducible seed.
- Time, IDs, model output, tool output, and network are injected in deterministic tests.
- Each scenario starts with a new temporary store and case ID.
- Playwright traces, screenshots, console logs, request logs, and final case snapshots are retained on failure.

## Mutation testing

A targeted mutation gate covers router thresholds, human-only approval, fail-closed evidence, staleness, and readiness. Surviving mutations in those modules fail `verify:release`. Mutation testing is not required for React presentation code.

Scope is defined by `stryker.config.mjs`'s `mutate` globs: `packages/core/src` and `packages/packs/src` in full, plus any individually named decision rule that lives outside them. As of 2026-09-07 there are four such files, each named in `stryker.config.mjs` with its own justifying comment: `packages/scenarios/src/tools/bill-feed-gate.ts` (the Home Energy Guardian case-creation gate — decides whether a case is opened at all), `packages/scenarios/src/tools/energy-calculator.ts` (the Home Energy Guardian hero's baseline/anomaly, weather- and rate-attribution, and response-option arithmetic), `packages/scenarios/src/tools/scope-differ.ts` (the bid-comparison pack's absent/priced/priced-at-zero scope classification), and `packages/scenarios/src/tools/bid-calculator.ts` (the bid-comparison pack's adjusted-total honesty contract — an absent required item with no supplied plug number must stay an explicit unknown, never a silent 0 or a silently-optimistic quoted total). **A decision rule added outside `core`/`packs` must be named in `mutate` explicitly**; the globs will not find it, and a rule that is never mutated can be pinned by tests that would not fail if it broke. The break threshold is 80.
