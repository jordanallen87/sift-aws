/**
 * The declarative `DemoScenario` for "Bid Comparison"
 * (docs/specs/testing.md "Scenario tests", `@sift/contracts` `scenario.ts`),
 * the AWS-hackathon-hero Swarm pack. Its closest analogue is
 * `home-energy-guardian.scenario.ts` (also a Strands Swarm pack, not a
 * Graph), and this file follows that file's shape exactly.
 *
 * `steps` documents the human/WebMCP-facing command sequence in the
 * `SCENARIO_COMMAND_NAMES` vocabulary the contracts package defines. Real
 * `caseId`/`expectedSequence` values are only known once the case actually
 * exists (assigned by the real `IdGenerator`/`CaseStore` at run time), so the
 * values below are illustrative placeholders -- the real trajectory
 * (`tests/scenarios/bid-comparison.scenario.test.ts`) resolves the genuine
 * values itself, exactly mirroring `car-purchase.scenario.ts`'s own
 * documented scope for the identical reason.
 *
 * --- Deliberately one round, not two ---
 *
 * Unlike `car-purchase.scenario.ts`/`home-energy-guardian.scenario.ts`
 * (each two full Graph/Swarm rounds plus a final human approval), this
 * scenario drives exactly one real round-1 Swarm run and stops there,
 * without ever calling `reviewProposal`. That is this pack's own real shape,
 * not an omission: `docs/bid-comparison/plan.md`'s "Confirm" beat --
 * `decision-synthesizer` calling `propose_award`, gated by `ConsequenceGuard`
 * -- is reachable in round 1 itself (unlike `home-energy-guardian`'s
 * round-2-only inspection proposal), and every required intervention outcome
 * (Deny, Guide, Confirm) plus a genuine GoalLoop reject-then-recover cycle
 * all fire within that one round (`bid-comparison-engine.test.ts`'s own
 * "runs round1 then round2" integration test proves the identical round-1
 * beats this scenario checks, before it ever reweights toward round 2). The
 * one thing this scenario is built specifically to prove -- that the award
 * proposal ends `pending`, reviewed by no one -- requires that no approval
 * command ever run in this trajectory at all.
 *
 * `assertions` is what the scenario test actively checks (via
 * `@sift/scenarios`'s `checkAssertions`) against the real trajectory the
 * test file builds from the real, live `bid-comparison` engine's own
 * persisted runtime events and case events -- not a parallel
 * reimplementation of the Swarm run. A few checks that genuinely need
 * per-node attribution the declarative `intervention`/`tool_called` DSL
 * kinds do not carry (which specialist was denied/guided, which tool a
 * confirmation gated) are checked directly in the test file against the raw
 * runtime/activity events instead of duplicated here as an assertion kind
 * the schema does not support, exactly mirroring `car-purchase.scenario.ts`'s
 * own documented rationale for its dynamic-id assertions.
 */
import type { DemoScenario } from '../../packages/contracts/src/index.js';

export const BID_COMPARISON_DEMO_SCENARIO: DemoScenario = {
  id: 'bid-comparison-demo',
  packId: 'bid-comparison',
  seed: {
    demoId: 'bid-comparison',
    fixtureBundleId: 'bids',
    clockIso: '2026-08-27T00:00:00.000Z',
  },
  steps: [
    {
      command: 'startDemo',
      input: { demoId: 'bid-comparison' },
      description:
        'Start the Bid Comparison demo: seeds the case with twelve subcontractor bids (a realistic public-bid-tab scale; Northgate Plumbing, Cedar & Sons, Two Rivers Mechanical, and Fieldstone Plumbing Co. are the four the demo narrative names individually) for the same plumbing scope of work.',
    },
    {
      command: 'requestInvestigation',
      input: { caseId: 'case-1', expectedSequence: 0 },
      description:
        'ChatGPT calls sift_request_investigation with no obligationId; the engine auto-selects bid.scope_normalization, the only open, dependency-free obligation, and runs the real six-node Swarm.',
    },
  ],
  assertions: [
    { kind: 'pack_selected', packId: 'bid-comparison', reasonIncludes: 'bid-comparison' },
    { kind: 'specialist_invoked', specialistId: 'scope-analyst' },
    { kind: 'specialist_invoked', specialistId: 'price-analyst' },
    { kind: 'specialist_invoked', specialistId: 'credential-checker' },
    { kind: 'specialist_invoked', specialistId: 'schedule-analyst' },
    { kind: 'specialist_invoked', specialistId: 'source-challenger' },
    { kind: 'specialist_invoked', specialistId: 'decision-synthesizer' },
    {
      kind: 'skill_activated',
      skillId: 'scope-normalization',
      obligationId: 'bid.scope_normalization',
    },
    {
      kind: 'skill_activated',
      skillId: 'price-arithmetic',
      obligationId: 'bid.price_verification',
    },
    {
      kind: 'skill_activated',
      skillId: 'credential-verification',
      obligationId: 'bid.credential_verification',
    },
    {
      kind: 'skill_activated',
      skillId: 'schedule-analysis',
      obligationId: 'bid.schedule_feasibility',
    },
    { kind: 'context_injected', fields: ['activeObligation', 'evidenceInventory', 'criteria'] },
    { kind: 'tool_called', toolId: 'bid-reader' },
    { kind: 'tool_called', toolId: 'scope-differ' },
    { kind: 'tool_called', toolId: 'bid-calculator' },
    // credential-checker successfully calls license-lookup four times (once
    // per named bid's license number -- Northgate, Cedar, Two Rivers, and
    // Fieldstone Plumbing Co., whose license class does not cover this
    // scope); price-analyst's own fifth, denied attempt is refused by
    // ScopeAuthorization *before* it executes, so it never reaches a
    // finished tool call at all (see the "deny" assertion below and the
    // test file's own direct check of that denial).
    { kind: 'tool_called', toolId: 'license-lookup', count: 4 },
    { kind: 'tool_called', toolId: 'propose_award', count: 1 },
    // The three intervention outcomes docs/engineering-principles.md requires
    // visible on every run, all genuinely reachable within this one round-1
    // trajectory (see this file's header comment) -- `price-analyst`
    // overreaching into `license-lookup` (granted only to
    // `credential-checker`), `scope-analyst` repeating the same
    // `scope-differ` bid pair with no new angle, and `decision-synthesizer`'s
    // `propose_award` call, which requires human confirmation before the
    // proposal is recorded.
    { kind: 'intervention', action: 'deny', handler: 'ScopeAuthorization' },
    { kind: 'intervention', action: 'guide', handler: 'RetrySteering' },
    { kind: 'intervention', action: 'confirm', handler: 'ConsequenceGuard' },
    // A genuine GoalLoop reject-then-recover cycle (maxAttempts: 2):
    // `decision-synthesizer`'s first draft ranks bids on raw quoted totals
    // and is withheld; the corrected retry ranks on the scope-normalized
    // adjusted totals and is accepted.
    {
      kind: 'goal_validation_failed',
      reasonIncludes: 'scope-normalized adjusted totals',
    },
    {
      kind: 'goal_recovered',
      reasonIncludes: 'scope-normalized adjusted totals',
    },
    { kind: 'swarm_handoff', from: 'scope-analyst', to: 'price-analyst' },
    { kind: 'swarm_handoff', from: 'price-analyst', to: 'credential-checker' },
    { kind: 'swarm_handoff', from: 'credential-checker', to: 'schedule-analyst' },
    { kind: 'swarm_handoff', from: 'schedule-analyst', to: 'source-challenger' },
    { kind: 'swarm_handoff', from: 'source-challenger', to: 'decision-synthesizer' },
    // bid.scope_normalization and bid.credential_verification each stay
    // "open" (never "satisfied") after this one round-1 attempt -- a real,
    // deliberate fail-closed fact, not an unverified assumption: each one's
    // own scripted evidence genuinely includes a non-stale "degraded"
    // verdict (Cedar & Sons' scope-diff result; Two Rivers Mechanical's
    // named-insured mismatch), and `packages/core/src/evidence.ts`'s
    // `hasBlockingEvidenceIssue` fail-closed rule ("A non-stale `error` or
    // `degraded` evidence result blocks completion for that obligation")
    // means neither can reach "satisfied" from this evidence alone, however
    // many passing items sit alongside it. This does not block the award
    // synthesis itself -- `bid.award_recommendation`'s `dependsOn` gates
    // which obligation a human/WebMCP investigation request auto-selects
    // next, not whether this pack's own six-node Swarm run folds a result --
    // and both real, named discrepancies are exactly what a person is meant
    // to see and resolve, not a defect this scenario should paper over.
    { kind: 'obligation_status', obligationId: 'bid.scope_normalization', status: 'open' },
    { kind: 'obligation_status', obligationId: 'bid.price_verification', status: 'satisfied' },
    { kind: 'obligation_status', obligationId: 'bid.credential_verification', status: 'open' },
    { kind: 'obligation_status', obligationId: 'bid.schedule_feasibility', status: 'satisfied' },
    { kind: 'obligation_status', obligationId: 'bid.award_recommendation', status: 'satisfied' },
    { kind: 'recommendation', favoredOptionId: 'bid-northgate' },
    { kind: 'human_action', action: 'request_investigation:bid.scope_normalization' },
    // Sift proposes; only `origin: 'user'` may approve -- and in this
    // trajectory nobody ever does. See this file's header comment.
    { kind: 'forbidden_event_absent', eventType: 'decision.approved.actor.agent' },
  ],
};
