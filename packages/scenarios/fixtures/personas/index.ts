/**
 * The four people this product is for, written as scripted turns.
 *
 * These are not test data in the usual sense — they are the product's
 * claims about who it serves, in a form that fails. Each persona is chosen
 * because it stresses a different seam:
 *
 * - **Family novice** is the hero. Someone who has never bought a car this
 *   way, does not know what questions matter, and needs the pane to carry
 *   the whole load. If the harness only ever ran this one, the product
 *   could still be a single-path demo.
 * - **Landscaping owner** is the contrast beat. The *same pack*, a
 *   completely different set of questions — payload, upfit, downtime — and
 *   the divergence has to come from the person's answers rather than from a
 *   second hard-coded script. This is what proves the discovery is adaptive
 *   rather than staged.
 * - **Known-listing shopper** arrives with a specific vehicle already in
 *   mind. It is the convergence case, and the one where the product is most
 *   tempted to fabricate: a real listing has a price and a seller, and Sift
 *   has neither. The persona exists to make sure that stays an explicit
 *   unknown.
 * - **School facilities manager** is `bid-comparison`'s own persona, and a
 *   different seam again: unlike the three `car-purchase` journeys above,
 *   this pack declares no discovery topics at all
 *   (`packages/packs/src/bid-comparison.ts` has no `discovery` field). Its
 *   twelve bids arrive as complete documents, not something to interview
 *   someone about, so this persona never answers a discovery question — it
 *   confirms nothing was missed and asks Sift to verify what is already on
 *   the case. It exists to prove the persona harness works for a
 *   genuinely different pack shape, not only for the one it was written
 *   against first.
 *
 * Turn labels are what appears in a failure report, so each says what the
 * person is trying to do rather than which command runs.
 */
import { PersonaSchema, type Persona } from '@sift/contracts';

/**
 * The family journey, start to shortlist. The novice hero: every question
 * comes from the pack's discovery, and nothing about the route is hard-coded
 * into the persona beyond the answers a person would actually give.
 */
const FAMILY_NOVICE: Persona = PersonaSchema.parse({
  id: 'family-novice',
  title: 'Family novice',
  goal: 'Replace an ageing family car without knowing what questions to ask.',
  packId: 'car-purchase',
  demoId: 'car-purchase',
  mode: 'companion',
  turns: [
    {
      label: 'Ask for help choosing a car',
      actor: 'human',
      utterance: 'We need a new family car.',
    },
    {
      label: 'Say what the car is for',
      actor: 'human',
      utterance: 'Personal or family use — school runs and a long trip a few times a year.',
      command: 'updateDiscovery',
    },
    {
      label: 'Give a budget',
      actor: 'human',
      utterance: 'Under about thirty-five thousand.',
      command: 'updateDiscovery',
    },
    {
      label: 'Answer how many people it carries',
      actor: 'human',
      utterance: 'Two adults, two kids, one still in a car seat.',
      command: 'updateDiscovery',
    },
    {
      // A person answers everything they are asked. The persona does not
      // hard-code how many questions that is: a pack that adds a topic
      // should lengthen the journey, not silently leave it short.
      label: 'Answer the rest of what Sift asks',
      actor: 'human',
      utterance: 'A garage, and we would rather not spend much on fuel.',
      command: 'finishDiscovery',
    },
    {
      label: 'Finish the check for anything missed',
      actor: 'human',
      command: 'completeBlindSpotReview',
    },
    { label: 'See what Sift found', actor: 'human' },
    { label: 'Keep the first option', actor: 'human', command: 'setCandidateDisposition' },
    { label: 'Pass on the second option', actor: 'human', command: 'setCandidateDisposition' },
    {
      // Investigation starts BEFORE the concern is raised. That ordering is
      // the whole demo beat: a concern that arrives after the plan exists
      // revises work already under way. Raised first, it would simply be
      // part of the opening plan and would prove nothing.
      label: 'Ask Sift to look into what is kept',
      actor: 'human',
      command: 'requestInvestigation',
    },
    {
      label: 'Raise a concern nobody asked about',
      actor: 'human',
      utterance: 'Will a dog crate fit behind the back seats?',
      command: 'defineCaseAttribute',
    },
    { label: 'Watch Sift revise what it is looking into', actor: 'human' },
    { label: 'Review where things stand', actor: 'human' },
  ],
});

/**
 * The contrast beat, deliberately short. Proving the divergence is real
 * needs only enough turns to show a different question set arriving from
 * the same pack.
 */
const LANDSCAPING_OWNER: Persona = PersonaSchema.parse({
  id: 'landscaping-owner',
  title: 'Landscaping business owner',
  goal: 'Add a work vehicle that can tow a trailer and survive a worksite.',
  packId: 'car-purchase',
  demoId: 'car-purchase',
  mode: 'companion',
  turns: [
    {
      label: 'Ask for help choosing a work vehicle',
      actor: 'human',
      utterance: 'I need another truck for the landscaping business.',
    },
    {
      label: 'Say it is for the business, not the family',
      actor: 'human',
      utterance: 'A business or trade — crews, tools, and a trailer.',
      command: 'updateDiscovery',
    },
    {
      label: 'Answer a question the family journey never sees',
      actor: 'human',
      utterance: 'It has to tow about seven thousand pounds.',
      command: 'updateDiscovery',
    },
    {
      label: 'Say what downtime would cost',
      actor: 'human',
      utterance: 'If it is off the road for a week I lose jobs.',
      command: 'updateDiscovery',
    },
    {
      label: 'Answer the rest of what Sift asks',
      actor: 'human',
      utterance: 'Gravel sites, and it has to carry a crew.',
      command: 'finishDiscovery',
    },
    { label: 'See a different set of options', actor: 'human' },
  ],
});

/**
 * The convergence case. Someone who already found a specific vehicle and
 * wants to know whether it is right, which is where fabricating a price or
 * a seller would be easiest and most damaging.
 */
const KNOWN_LISTING_SHOPPER: Persona = PersonaSchema.parse({
  id: 'known-listing-shopper',
  title: 'Known-listing shopper',
  goal: 'Check whether a specific vehicle they already found is the right choice.',
  packId: 'car-purchase',
  demoId: 'car-purchase',
  mode: 'companion',
  turns: [
    {
      label: 'Arrive with a specific vehicle in mind',
      actor: 'human',
      utterance: 'I am looking at a RAV4 Hybrid. Is it the right call?',
      command: 'upsertOption',
    },
    {
      label: 'Say what it is for',
      actor: 'human',
      utterance: 'Personal or family use, mostly city driving.',
      command: 'updateDiscovery',
    },
    {
      label: 'Answer the rest of what Sift asks',
      actor: 'human',
      utterance: 'City driving, a garage, and a modest budget.',
      command: 'finishDiscovery',
    },
    {
      label: 'Keep it while Sift looks into it',
      actor: 'human',
      command: 'setCandidateDisposition',
    },
    {
      label: 'Ask Sift to look into it',
      actor: 'human',
      command: 'requestInvestigation',
    },
    { label: 'Read what Sift can and cannot say about it', actor: 'human' },
  ],
});

/**
 * `bid-comparison`'s own persona: a nine-person general contractor's
 * facilities-manager counterpart in the household/small-institution sense
 * `docs/bid-comparison/plan.md` describes — a school district facilities
 * manager comparing twelve plumbing bids for a restroom and locker-room
 * re-pipe, who is not a procurement expert and cares about price,
 * licensing/insurance, warranty, and schedule.
 *
 * Shaped differently from the three journeys above on purpose, because the
 * pack itself is shaped differently: `bid-comparison` declares no discovery
 * topics (see this module's header comment), so there is no interview to
 * answer here — the twelve bids are already fully on the case the moment
 * the demo starts (`buildBidComparisonEntities`,
 * `apps/agent/src/services/command-service.ts`'s `demoSeedEntities`). What
 * this persona actually does is the honest equivalent for a pack shaped
 * that way: look at what already arrived, then ask Sift to go verify what a
 * bid alone cannot prove about itself — its arithmetic, its license and
 * insurance standing, and whether its schedule is credible.
 *
 * Deliberately does not use `setCandidateDisposition`/`upsertOption`/
 * `updateDiscovery`/`finishDiscovery`: every one of those commands, and the
 * `deriveNextMoves`/`deriveDecisionPhase` triage machinery behind them
 * (`packages/core/src/discovery.ts`), is written against entities of kind
 * `'candidate'` with a keep/pass/unsure disposition. A `bid-comparison`
 * entity's kind is `'bid'`, so none of that triage surface ever applies to
 * this case — there is nothing to Keep, Pass, or discover a catalog of. A
 * persona turn scripted against a move this pack never offers would not be
 * a small script bug; it would be this persona lying about what a person
 * choosing among bids actually does next.
 *
 * Also deliberately does not use `completeBlindSpotReview`, and this one is
 * a real, verified finding rather than a stylistic choice: `deriveNextMoves`
 * offers "Check for anything missed" on this case from the first turn
 * onward (it fires once every *required* topic is answered, which is
 * trivially true at zero required topics), but
 * `CompleteBlindSpotReviewInputSchema`
 * (`packages/contracts/src/commands.ts`) requires at least one offered
 * prompt id, and a pack with no `discovery` section declares none. There is
 * no valid input that completes this move for this pack, in the real
 * product or in this harness — see `scripts/test-persona.ts`'s
 * `completeBlindSpots` for where this was actually hit and confirmed. This
 * persona does not attempt it, on the same principle as the paragraph
 * above: scripting a move that cannot succeed would not be a small
 * omission, it would be this persona asserting the pack offers something it
 * does not.
 */
const SCHOOL_FACILITIES_MANAGER: Persona = PersonaSchema.parse({
  id: 'school-facilities-manager',
  title: 'School facilities manager',
  goal: 'Choose which of twelve plumbing bids to award for a school restroom re-pipe before the school year starts, without being a procurement expert.',
  packId: 'bid-comparison',
  demoId: 'bid-comparison',
  mode: 'companion',
  turns: [
    {
      label: 'Ask for help comparing the plumbing bids',
      actor: 'human',
      utterance:
        "I've got twelve plumbing bids in for our elementary school's restroom and locker-room re-pipe, and I need to pick one before the school year starts. I'm not a procurement person, so I don't really know where to begin.",
    },
    { label: 'See what Sift already knows about each bid', actor: 'human' },
    {
      label: 'Ask Sift to verify the bids',
      actor: 'human',
      utterance:
        'I need this done before the school year starts, so double-check the pricing, the license and insurance on file, and whether the schedule is realistic for every one of these bids.',
      command: 'requestInvestigation',
    },
    { label: 'Watch what Sift is checking', actor: 'human' },
    { label: 'Review where things stand', actor: 'human' },
  ],
});

export const PERSONAS: readonly Persona[] = [
  FAMILY_NOVICE,
  LANDSCAPING_OWNER,
  KNOWN_LISTING_SHOPPER,
  SCHOOL_FACILITIES_MANAGER,
];

export function personaById(id: Persona['id']): Persona {
  const persona = PERSONAS.find((entry) => entry.id === id);
  if (persona === undefined) {
    throw new Error(`No persona is defined for id "${id}".`);
  }
  return persona;
}
