/**
 * The diagnostic pass: the judgment half of the persona harness.
 *
 * ## Provenance, because it matters more than the numbers
 *
 * These scores were produced by Claude Opus 5 on 2026-09-02, reading the
 * turn artifacts in `artifacts/persona/*.json` from the run at commit
 * `d13d82c`+ (after the stalled-turn gate, the seeded-candidate wiring, and
 * the option-seed fix). They are one model's judgment of a text record of a
 * journey — not a user study, not a measurement, and not evidence that real
 * people find this usable. `claim-evidence-matrix.md` row E1 says the same
 * thing where the claims live.
 *
 * Every score cites a turn and quotes something actually in that turn's
 * artifact, because `DiagnosticScoreSchema` refuses a score that does not.
 * That constraint is the point: it makes a score checkable against the
 * artifact rather than an opinion floating free of the run.
 *
 * ## What scoring found
 *
 * Two things the hard gates cannot see. One was repaired because this pass
 * scored it; one stands.
 *
 * - **Fixed — the RunPlan had no surface.** The plan revised at turn 10,
 *   the event fired, and the pane had nowhere to show it: an HTTP route and
 *   two activity events and nothing a person could point at. Scored 2,
 *   which failed the whole persona. The orientation shell now carries "Sift
 *   is looking into N things across M options" and a separate line for a
 *   concern nothing can check. Re-scored 4 — the line reports the plan's
 *   current shape, not what changed about it.
 * - **Standing — the dock offers "Continue Quick Pick" from turn 0**, when
 *   coverage reads 0 of 5 and Sift knows nothing about the person. Triage
 *   is offered before there is anything to triage against. Scored 3: above
 *   the per-turn floor, so it does not fail the run, and left visible here
 *   rather than rounded away.
 *
 * A diagnostic pass that only ever produced fours would not be worth
 * running.
 */
import type { DiagnosticScore, PersonaId } from '@sift/contracts';

export const DIAGNOSTIC_PASS_PROVENANCE = {
  scoredBy: 'Claude Opus 5',
  scoredAt: '2026-09-02',
  method:
    'Read every turn artifact in artifacts/persona/*.json and scored each dimension against the turn that most determined it.',
  limitation:
    'One model reading a text record of a journey. Not a user study and not evidence that real people find this usable.',
} as const;

const FAMILY: DiagnosticScore[] = [
  {
    dimension: 'orientation',
    turnIndex: 1,
    score: 5,
    evidence: {
      turnIndex: 1,
      quote: 'phase "discovery", coverage 1 of 5, next "Budget"',
    },
  },
  {
    dimension: 'orientation',
    turnIndex: 4,
    score: 4,
    evidence: {
      turnIndex: 4,
      quote: 'coverage jumps 3 of 5 to 5 of 5 and the phase changes to triage in one turn',
    },
  },
  {
    dimension: 'next_action_clarity',
    turnIndex: 1,
    score: 5,
    evidence: { turnIndex: 1, quote: 'next "Budget", controls ["Budget", "Continue Quick Pick"]' },
  },
  {
    dimension: 'next_action_clarity',
    turnIndex: 0,
    score: 3,
    evidence: {
      turnIndex: 0,
      quote: 'controls ["What this vehicle is for", "Continue Quick Pick"] at coverage 0 of 5',
    },
  },
  {
    dimension: 'relevance',
    turnIndex: 4,
    score: 5,
    evidence: {
      turnIndex: 4,
      quote: 'topic vehicle.occupants, vehicle.child_seats, vehicle.cargo_household confirmed',
    },
  },
  {
    dimension: 'efficiency',
    turnIndex: 4,
    score: 4,
    evidence: { turnIndex: 4, quote: 'six topics confirmed in a single turn' },
  },
  {
    dimension: 'conversation_canvas_coherence',
    turnIndex: 10,
    score: 4,
    evidence: {
      turnIndex: 10,
      quote:
        'plan.revised: Plan v2: a new concern (Dog crate fit) added 0 new items, kept 10 unchanged',
    },
  },
  {
    // Re-scored after the repair this score caused.
    //
    // The first pass scored this 2: the plan revised at turn 10, the event
    // fired, and the pane had nowhere to show it -- the RunPlan had an HTTP
    // route and two activity events and no surface at all. The orientation
    // shell now carries "Sift is looking into N things across M options"
    // and a separate line for a concern nothing can check, both fed by
    // `GET /api/cases/:id/run-plan`.
    //
    // 4 rather than 5: the line reports the plan's current shape, not what
    // changed about it. Someone who looks away during the revision sees the
    // new state without seeing that it moved.
    dimension: 'conversation_canvas_coherence',
    turnIndex: 11,
    score: 4,
    evidence: {
      turnIndex: 11,
      quote: 'run plan v1 -> v2 with 10 items kept and 1 concern nothing can check',
    },
  },
  {
    dimension: 'control_flexibility',
    turnIndex: 8,
    score: 5,
    evidence: { turnIndex: 8, quote: 'candidate candidate-crv -> pass' },
  },
  {
    dimension: 'trust_evidence',
    turnIndex: 10,
    score: 5,
    evidence: {
      turnIndex: 10,
      quote: '1 concern(s) have nothing that can check them and stay explicit unknowns',
    },
  },
  {
    dimension: 'cognitive_load',
    turnIndex: 1,
    score: 4,
    evidence: { turnIndex: 1, quote: 'one question on screen, one primary control' },
  },
];

const LANDSCAPING: DiagnosticScore[] = [
  {
    dimension: 'orientation',
    turnIndex: 3,
    score: 4,
    evidence: { turnIndex: 3, quote: 'phase "discovery", coverage 3 of 5' },
  },
  {
    dimension: 'next_action_clarity',
    turnIndex: 2,
    score: 4,
    evidence: { turnIndex: 2, quote: 'next "How it gets used"' },
  },
  {
    dimension: 'relevance',
    turnIndex: 4,
    score: 5,
    evidence: {
      turnIndex: 4,
      quote: 'topic vehicle.payload_towing, vehicle.worksite_access, vehicle.upfit confirmed',
    },
  },
  {
    dimension: 'efficiency',
    turnIndex: 4,
    score: 4,
    evidence: { turnIndex: 4, quote: 'the business branch resolves without a second pack' },
  },
  {
    dimension: 'conversation_canvas_coherence',
    turnIndex: 1,
    score: 4,
    evidence: { turnIndex: 1, quote: 'topic vehicle.use_case -> confirmed (origin: user)' },
  },
  {
    dimension: 'control_flexibility',
    turnIndex: 4,
    score: 4,
    evidence: {
      turnIndex: 4,
      quote: 'controls ["Check for anything missed", "Continue Quick Pick"]',
    },
  },
  {
    dimension: 'trust_evidence',
    turnIndex: 1,
    score: 4,
    evidence: { turnIndex: 1, quote: 'origin: user recorded on every confirmed topic' },
  },
  {
    dimension: 'cognitive_load',
    turnIndex: 5,
    score: 4,
    evidence: { turnIndex: 5, quote: 'two controls, never more' },
  },
];

const KNOWN_LISTING: DiagnosticScore[] = [
  {
    dimension: 'orientation',
    turnIndex: 0,
    score: 4,
    evidence: {
      turnIndex: 0,
      quote: 'phase "discovery" with a candidate already present and coverage 0 of 5',
    },
  },
  {
    dimension: 'next_action_clarity',
    turnIndex: 2,
    score: 4,
    evidence: { turnIndex: 2, quote: 'next "Check for anything missed"' },
  },
  {
    dimension: 'relevance',
    turnIndex: 2,
    score: 4,
    evidence: { turnIndex: 2, quote: 'the family branch resolves from one confirmed answer' },
  },
  {
    dimension: 'efficiency',
    turnIndex: 2,
    score: 5,
    evidence: { turnIndex: 2, quote: 'four topics confirmed in one turn after a single answer' },
  },
  {
    dimension: 'conversation_canvas_coherence',
    turnIndex: 4,
    score: 4,
    evidence: { turnIndex: 4, quote: 'run plan created at v1 with 11 item(s)' },
  },
  {
    dimension: 'control_flexibility',
    turnIndex: 3,
    score: 4,
    evidence: { turnIndex: 3, quote: 'candidate candidate-rav4 -> keep' },
  },
  {
    dimension: 'trust_evidence',
    turnIndex: 5,
    score: 4,
    evidence: {
      turnIndex: 5,
      quote: 'phase triage with coverage 5 of 5 and no invented listing data',
    },
  },
  {
    dimension: 'cognitive_load',
    turnIndex: 0,
    score: 4,
    evidence: { turnIndex: 0, quote: 'one question, one option already on the case' },
  },
];

// `Partial`, not a total `Record`: `PERSONA_IDS` also names
// `school-facilities-manager` (the `bid-comparison` persona), and this pass
// has no entry for it. Nobody -- model or person -- has read that persona's
// turn artifacts and scored them; writing an entry down, even a borrowed
// one, would be exactly the fabricated judgment this module's own header
// forbids. `scripts/test-persona.ts` reads `DIAGNOSTIC_PASS[persona.id]`,
// gets `undefined` for that persona, and passes no `scores` to `runPersona`
// -- which is `summarizeDiagnostics`'s own "unmeasured, not acceptable" path
// (`packages/scenarios/src/persona-diagnostics.ts`), not a silent pass.
export const DIAGNOSTIC_PASS: Readonly<Partial<Record<PersonaId, readonly DiagnosticScore[]>>> = {
  'family-novice': FAMILY,
  'landscaping-owner': LANDSCAPING,
  'known-listing-shopper': KNOWN_LISTING,
};
