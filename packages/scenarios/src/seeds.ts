/**
 * Loads the real car-purchase fixture data into the four candidate
 * `EntityRecord`s the "Choose Our Next Car" demo compares, plus the full
 * seed `CaseEvent` sequence a fresh demo case needs.
 *
 * `instantiateCase` (`@sift/core`) alone only ever seeds pack-declared state
 * (`pack`, `criteria`, `obligations`, `attributeDefinitions`) -- it always
 * seeds `entities: []` (see that file's own header comment). This module is
 * the "whatever glue is needed to load the car-purchase fixtures into
 * initial CaseState/entities via `instantiateCase` + `option.upserted`
 * events for the four candidates" this task calls for.
 *
 * `buildCarPurchaseCandidateEntities` deliberately calls the REAL fixture
 * tools (`readListing`/`calculateOwnershipCost`/`lookupSafetyReliability`/
 * `lookupHouseholdFit` -- `./tools/index.js`, read-only reference) to
 * compute every entity attribute, rather than re-deriving the same
 * arithmetic a second time here. This keeps the seeded "current best known
 * value" on each candidate's `EntityRecord` byte-for-byte identical to what
 * a Strands specialist independently re-discovers when it calls the exact
 * same tool during the Graph investigation -- there are not two competing
 * sources of truth for one fixture fact.
 *
 * --- Two real, pre-existing mismatches in the read-only fixture-tool/pack
 * layers this module works around (documented, not silently patched over;
 * flagged loudly in the dated docs/build-log.md entry for this task since
 * neither file may be edited) ---
 *
 * 1. `listing-reader.ts`'s `CandidateListingFacts`/`CandidateDealerOfferFacts`
 *    never expose `standardFeatures`, even though `candidate-listings.json`
 *    itself has one and the car-purchase pack manifest declares
 *    `car.standard_features` as `required: true`. This module reads that one
 *    field directly from `loadFixture('candidate-listings')` (a real,
 *    already-exported `@sift/scenarios` function, not a private tool
 *    internal) rather than leaving a required pack attribute permanently
 *    unseeded.
 * 2. `household-fit-matrix.ts`'s `KNOWN_SPEC_FIELDS` definition ids
 *    (`car.cargo_width_between_wheel_wells_in`,
 *    `car.cargo_length_seat_to_liftgate_in`,
 *    `car.cargo_height_floor_to_ceiling_in`,
 *    `car.cargo_volume_behind_second_row_cu_ft`) do not match the car-purchase
 *    pack manifest's own attribute ids
 *    (`car.cargo_width_in`/`car.cargo_length_in`/`car.cargo_volume_cu_ft`;
 *    the pack declares no height-floor-to-ceiling attribute at all).
 *    `HOUSEHOLD_FIT_DEFINITION_ID_TRANSLATION` below maps the tool's ids to
 *    the pack's, dropping the one field the pack never declares. The same
 *    translation table is reused wherever a later task folds a live
 *    `household-fit-matrix` tool call's `knownFacts` into `EntityRecord`
 *    attributes, so the two never drift against each other.
 *
 * `car.rear_cargo_crate_fit` and `car.driving_comfort_rating` are seeded
 * `status: 'unknown'` with no `value` for every candidate, translated from
 * `household-fit-matrix`'s own `unknown.rear_cargo_crate_compatibility` /
 * `unknown.driving_comfort` -- docs/engineering-principles.md: "It may never ... fabricate."
 */
import type { Clock, IdGenerator } from '@sift/core';
import { createAttributeRecord, instantiateCase, type PackSelection } from '@sift/core';
import type {
  AttributeRecord,
  AttributeValue,
  CaseEvent,
  CaseState,
  CompiledDecisionPack,
  EntityRecord,
} from '@sift/contracts';
import {
  calculateBidEconomics,
  calculateOwnershipCost,
  loadFixture,
  lookupHouseholdFit,
  lookupLicense,
  lookupSafetyReliability,
  readBid,
  readListing,
  BID_FIXTURE_NAMES,
  type BidCalculatorResult,
  type BidFixtureName,
  type BidReaderResult,
  type CandidateDealerOfferFacts,
  type CandidateListingFacts,
  type LicenseLookupFacts,
  type OwnershipCostResult,
  type ResponseOption,
} from './tools/index.js';

// --- Home Energy Guardian response-option seeding ---
//
// `home-energy-guardian.ts`'s compiled pack declares a `response_option`
// entity kind (`energy.response_option_description`/`energy.rough_cost`/
// `energy.rough_effort_level`/`energy.estimated_time_to_insight`/
// `energy.addresses_root_cause`/`energy.requires_consequential_action`/
// `energy.consequential_action_note`), matching
// `packages/scenarios/fixtures/energy/response-options.json`'s four options
// field-for-field -- the same "compare/select among a fixed set of options"
// shape `buildCarPurchaseCandidateEntities` above seeds for car-purchase's
// four candidates. `instantiateCase` always seeds `entities: []`
// (see this file's own header comment), and unlike car-purchase's
// candidates, nothing in `home-energy-swarm.ts` ever needs a
// `response_option` `EntityRecord` to run (the Swarm's specialists reach
// `response-options.json` directly through `calculator`'s
// `evaluateResponseOptions`/the synthesizer's baked-in system-prompt facts,
// never through case entities) -- so this is not a *run-blocking* gap the
// way the car-purchase candidates are. It is still a genuine
// generic-rendering gap: without it, a real live case's
// `recommendation.favoredOptionId` (set by `apps/agent/src/runtime/
// home-energy-engine.ts`) names a `response_option` id with no matching
// `EntityRecord` for the normal workspace's generic option renderer to
// resolve. `buildHomeEnergyResponseOptionEntities` closes that gap the same
// way `buildCarPurchaseCandidateEntities` closes its own: reading the real
// fixture directly (not re-deriving the same facts a second time), so the
// seeded entity's attributes are guaranteed identical to what
// `energy-calculator.ts`'s `evaluateResponseOptions` and
// `home-energy-swarm.ts`'s `decision-synthesizer` system prompt (see that
// file's module header, judgment call 4) both independently read from the
// same file.
//
// This module deliberately does *not* seed a `billing_cycle` entity: unlike
// `response_option`'s static, pre-known facts, `billing_cycle`'s declared
// attributes (baseline, anomaly percent, weather/rate attribution,
// correlated event) are themselves the Swarm investigation's *output* --
// pre-seeding them would falsely show "already known" figures before any
// investigation runs, contradicting packs-and-routing.md's "the engine
// investigates ... before creating a human action". No existing fold helper
// (`car-purchase-scenario.ts`'s `foldExecutionResult`, reused by
// `home-energy-engine.ts`) writes discovered facts onto an `EntityRecord`
// either -- car-purchase's own specialists only ever validate/challenge
// candidate facts that were already seeded upfront, never write new ones.
// Building that "write investigation results onto a `billing_cycle` entity"
// mechanism is a genuine, separately-scoped follow-up, not part of this
// task's live-wiring scope.
function homeEnergyResponseOptionAttributes(
  clock: Clock,
  option: ResponseOption,
): Record<string, AttributeRecord> {
  const sourceId = `source-response-option-${option.optionId}`;
  const attributes: Record<string, AttributeRecord> = {
    'energy.response_option_description': record(clock, {
      definitionId: 'energy.response_option_description',
      label: 'Description',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'text', value: option.description },
    }),
    'energy.rough_cost': record(clock, {
      definitionId: 'energy.rough_cost',
      label: 'Rough cost',
      sourceIds: [sourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: option.roughCost.amount,
        currency: option.roughCost.currency,
      },
    }),
    'energy.rough_effort_level': record(clock, {
      definitionId: 'energy.rough_effort_level',
      label: 'Rough effort level',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'enum', value: option.roughEffortLevel },
    }),
    'energy.estimated_time_to_insight': record(clock, {
      definitionId: 'energy.estimated_time_to_insight',
      label: 'Estimated time to insight',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'string', value: option.estimatedTimeToInsight },
    }),
    'energy.addresses_root_cause': record(clock, {
      definitionId: 'energy.addresses_root_cause',
      label: 'Addresses the root cause',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'boolean', value: option.addressesRootCause },
    }),
    'energy.requires_consequential_action': record(clock, {
      definitionId: 'energy.requires_consequential_action',
      label: 'Requires a consequential action to pursue',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'boolean', value: option.requiresConsequentialAction },
    }),
  };
  if (option.consequentialActionNote !== undefined) {
    attributes['energy.consequential_action_note'] = record(clock, {
      definitionId: 'energy.consequential_action_note',
      label: 'Consequential action note',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'text', value: option.consequentialActionNote },
    });
  }
  return attributes;
}

/**
 * Builds the four Home Energy Guardian response-option `EntityRecord`s
 * (`monitor-one-cycle`/`change-rate-plan`/`request-energy-audit`/
 * `request-hvac-inspection`) directly from the real `response-options.json`
 * fixture. See this module's own header comment above for the full
 * grounding and the documented, deliberately deferred `billing_cycle`
 * seeding gap this does not attempt to close.
 */
export function buildHomeEnergyResponseOptionEntities(clock: Clock): EntityRecord[] {
  const now = clock.now();
  const fixture = loadFixture('response-options');

  return fixture.options.map((option): EntityRecord => ({
    id: option.optionId,
    kind: 'response_option',
    label: option.label,
    attributes: homeEnergyResponseOptionAttributes(clock, option),
    createdAt: now,
    updatedAt: now,
  }));
}

export const CAR_PURCHASE_CANDIDATE_IDS = [
  'candidate-rav4',
  'candidate-crv',
  'candidate-cx5',
  'candidate-outback',
] as const;
export type CarPurchaseCandidateId = (typeof CAR_PURCHASE_CANDIDATE_IDS)[number];

/** See module header, mismatch #2. Tool definition id -> pack manifest attribute id; a tool id with no entry here (`car.cargo_height_floor_to_ceiling_in`) has no pack-manifest counterpart and is intentionally dropped. */
export const HOUSEHOLD_FIT_DEFINITION_ID_TRANSLATION: Readonly<Record<string, string>> = {
  'car.cargo_width_between_wheel_wells_in': 'car.cargo_width_in',
  'car.cargo_length_seat_to_liftgate_in': 'car.cargo_length_in',
  'car.cargo_volume_behind_second_row_cu_ft': 'car.cargo_volume_cu_ft',
  'car.rear_door_opening_width_in': 'car.rear_door_opening_width_in',
  'car.second_row_legroom_in': 'car.second_row_legroom_in',
  'car.ground_clearance_in': 'car.ground_clearance_in',
};

/** `household-fit-matrix`'s `unknowns[].id` -> the pack manifest attribute id the unknown blocks. */
const HOUSEHOLD_FIT_UNKNOWN_TRANSLATION: Readonly<Record<string, string>> = {
  'unknown.rear_cargo_crate_compatibility': 'car.rear_cargo_crate_fit',
  'unknown.driving_comfort': 'car.driving_comfort_rating',
};

/**
 * Exported (rather than kept module-private) purely so its own defensive
 * "the fixture tool did not return `ok`" branch is directly unit-testable
 * with a synthetic `ToolResult`, the same testability rationale
 * `fixture-loader.ts` documents for exporting `parseFixtureJson` alongside
 * `loadFixture`. Every real call site here only ever calls it with a real
 * fixture tool's own result for one of the four fixed, fixture-declared
 * `CAR_PURCHASE_CANDIDATE_IDS`, which always succeeds -- so the throw branch
 * has no reachable real-data trigger and is exercised directly instead.
 */
export function unwrapOk<T>(result: { status: string }, description: string): T {
  if (result.status !== 'ok') {
    throw new Error(
      `seeds.ts: expected an "ok" result while ${description}, got "${result.status}"`,
    );
  }
  return (result as { status: 'ok'; data: T }).data;
}

/**
 * Exported for the same reason as `unwrapOk` above: every real call site
 * passes a status/value pairing that is correct by construction (an
 * `asserted`/`supported`/`conflicted` record always carries a real fixture-
 * derived `value`; an `unknown` record never does), so
 * `createAttributeRecord`'s own invariant-violation failure branch has no
 * reachable real-data trigger here and is exercised directly instead.
 */
export function record(
  clock: Clock,
  input: {
    definitionId: string;
    label: string;
    sourceIds: readonly string[];
    status: AttributeRecord['status'];
    value?: AttributeValue;
  },
): AttributeRecord {
  const result = createAttributeRecord(
    {
      definitionId: input.definitionId,
      label: input.label,
      origin: 'pack',
      sourceIds: input.sourceIds,
      status: input.status,
      ...(input.value !== undefined ? { value: input.value } : {}),
    },
    clock,
  );
  if (!result.ok) {
    throw new Error(
      `seeds.ts: failed to build attribute record "${input.definitionId}": ${result.errors.join('; ')}`,
    );
  }
  return result.value;
}

function candidateLabel(listing: CandidateListingFacts): string {
  return `${listing.modelYear} ${listing.make} ${listing.model} ${listing.trim}`;
}

/**
 * Attribute records derivable directly from `listing-reader`'s real output
 * (plus the one raw `standardFeatures` field it never exposes -- see module
 * header mismatch #1).
 */
function listingAttributes(
  clock: Clock,
  listing: CandidateListingFacts,
  dealerOffer: CandidateDealerOfferFacts,
  standardFeatures: readonly string[],
): Record<string, AttributeRecord> {
  const listingSourceId = `source-listing-${listing.candidateId}`;
  const dealerOfferSourceId = `source-dealer-offer-${listing.candidateId}`;

  return {
    'car.make': record(clock, {
      definitionId: 'car.make',
      label: 'Make',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'string', value: listing.make },
    }),
    'car.model': record(clock, {
      definitionId: 'car.model',
      label: 'Model',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'string', value: listing.model },
    }),
    'car.model_year': record(clock, {
      definitionId: 'car.model_year',
      label: 'Model year',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'number', value: listing.modelYear },
    }),
    'car.trim': record(clock, {
      definitionId: 'car.trim',
      label: 'Trim',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'string', value: listing.trim },
    }),
    'car.body_style': record(clock, {
      definitionId: 'car.body_style',
      label: 'Body style',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'string', value: listing.bodyStyle },
    }),
    'car.drivetrain': record(clock, {
      definitionId: 'car.drivetrain',
      label: 'Drivetrain',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'enum', value: listing.drivetrain },
    }),
    'car.powertrain': record(clock, {
      definitionId: 'car.powertrain',
      label: 'Powertrain',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'enum', value: listing.powertrain },
    }),
    'car.mileage': record(clock, {
      definitionId: 'car.mileage',
      label: 'Mileage',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'number', value: listing.mileage.value, unit: listing.mileage.unit },
    }),
    'car.standard_features': record(clock, {
      definitionId: 'car.standard_features',
      label: 'Standard features',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: { type: 'string_list', values: [...standardFeatures] },
    }),
    'car.advertised_price': record(clock, {
      definitionId: 'car.advertised_price',
      label: 'Advertised price',
      sourceIds: [listingSourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: listing.advertisedPrice.amount,
        currency: listing.advertisedPrice.currency,
      },
    }),
    'car.out_the_door_price': record(clock, {
      definitionId: 'car.out_the_door_price',
      label: 'True out-the-door price',
      sourceIds: [dealerOfferSourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: dealerOffer.trueOutTheDoorPrice,
        currency: dealerOffer.advertisedPrice.currency,
      },
    }),
    'car.teaser_price_gap_amount': record(clock, {
      definitionId: 'car.teaser_price_gap_amount',
      label: 'Teaser price gap',
      sourceIds: [dealerOfferSourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: dealerOffer.teaserGap.gapAmount,
        currency: dealerOffer.advertisedPrice.currency,
      },
    }),
    'car.has_teaser_price_conflict': record(clock, {
      definitionId: 'car.has_teaser_price_conflict',
      label: 'Has teaser price conflict',
      sourceIds: [dealerOfferSourceId],
      status: 'asserted',
      value: { type: 'boolean', value: dealerOffer.hasTeaserPriceConflict },
    }),
  };
}

function ownershipAttributes(
  clock: Clock,
  ownership: OwnershipCostResult,
): Record<string, AttributeRecord> {
  const sourceId = `source-ownership-calculator-${ownership.candidateId}`;
  return {
    'car.five_year_fuel_cost': record(clock, {
      definitionId: 'car.five_year_fuel_cost',
      label: 'Estimated 5-year fuel cost',
      sourceIds: [sourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: ownership.components.fuel.amount,
        currency: ownership.currency,
      },
    }),
    'car.five_year_maintenance_cost': record(clock, {
      definitionId: 'car.five_year_maintenance_cost',
      label: 'Estimated 5-year maintenance cost',
      sourceIds: [sourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: ownership.components.maintenance.amount,
        currency: ownership.currency,
      },
    }),
    'car.five_year_ownership_cost': record(clock, {
      definitionId: 'car.five_year_ownership_cost',
      label: 'Estimated 5-year total ownership cost',
      sourceIds: [sourceId],
      status: 'asserted',
      value: { type: 'money', amount: ownership.totalFiveYearCost, currency: ownership.currency },
    }),
    'car.combined_fuel_economy_mpg': record(clock, {
      definitionId: 'car.combined_fuel_economy_mpg',
      label: 'Combined fuel economy',
      sourceIds: [sourceId],
      status: 'asserted',
      value: {
        type: 'number',
        value: ownership.components.fuel.combinedMpg,
        unit: 'mpg',
      },
    }),
    'car.annual_insurance_premium': record(clock, {
      definitionId: 'car.annual_insurance_premium',
      label: 'Estimated annual insurance premium',
      sourceIds: [sourceId],
      status: 'asserted',
      value: {
        type: 'money',
        amount: ownership.components.insurance.annualPremium,
        currency: ownership.currency,
      },
    }),
  };
}

const SAFETY_CATEGORY_TO_ATTRIBUTE: Readonly<Record<string, string>> = {
  crash_safety: 'car.crash_safety_rating',
  driver_assistance: 'car.driver_assistance_rating',
  reliability: 'car.reliability_rating',
};

/**
 * Exported for direct unit testing of its own "no claim recorded for this
 * category" skip branch: every real candidate in `safety-reliability-
 * sources.json` carries a claim for all three
 * `SAFETY_CATEGORY_TO_ATTRIBUTE` categories, so that branch has no reachable
 * real-data trigger and is exercised directly with a synthetic
 * `ToolResult` instead.
 */
export function safetyAttributes(
  clock: Clock,
  candidateId: string,
  result: ReturnType<typeof lookupSafetyReliability>,
): Record<string, AttributeRecord> {
  const data = unwrapOk<{
    claims: {
      category: string;
      rating: string;
      sourceId: string;
    }[];
    disagreements: { category: string; sourceIdA: string; sourceIdB: string }[];
  }>(result, `looking up safety/reliability facts for "${candidateId}"`);

  const disputedCategories = new Set(data.disagreements.map((entry) => entry.category));
  const byCategory = new Map<string, { rating: string; sourceIds: string[] }>();
  for (const claim of data.claims) {
    const existing = byCategory.get(claim.category);
    if (existing === undefined) {
      byCategory.set(claim.category, { rating: claim.rating, sourceIds: [claim.sourceId] });
    } else {
      existing.sourceIds.push(claim.sourceId);
    }
  }

  const attributes: Record<string, AttributeRecord> = {};
  for (const [category, definitionId] of Object.entries(SAFETY_CATEGORY_TO_ATTRIBUTE)) {
    const claim = byCategory.get(category);
    if (claim === undefined) continue;
    const disputed = disputedCategories.has(category);
    attributes[definitionId] = record(clock, {
      definitionId,
      label: definitionId,
      sourceIds: claim.sourceIds,
      status: disputed ? 'conflicted' : 'supported',
      value: { type: 'enum', value: claim.rating },
    });
  }
  return attributes;
}

/**
 * Exported for direct unit testing of its own "no pack-manifest attribute
 * for this unknown id" skip branch: every real `unknown.*` id
 * `household-fit-matrix.ts` ever produces (`unknown.
 * rear_cargo_crate_compatibility`, `unknown.driving_comfort`) has an entry
 * in `HOUSEHOLD_FIT_UNKNOWN_TRANSLATION`, so that branch has no reachable
 * real-data trigger and is exercised directly with a synthetic
 * `ToolResult` instead.
 */
export function householdFitAttributes(
  clock: Clock,
  candidateId: string,
  result: ReturnType<typeof lookupHouseholdFit>,
): Record<string, AttributeRecord> {
  const data = unwrapOk<{
    knownFacts: {
      definitionId: string;
      label: string;
      value: AttributeValue;
      sourceIds: string[];
    }[];
    unknowns: { id: string; label: string }[];
  }>(result, `looking up household fit for "${candidateId}"`);

  const attributes: Record<string, AttributeRecord> = {};
  for (const fact of data.knownFacts) {
    const packAttributeId = HOUSEHOLD_FIT_DEFINITION_ID_TRANSLATION[fact.definitionId];
    if (packAttributeId === undefined) continue; // See module header mismatch #2.
    attributes[packAttributeId] = record(clock, {
      definitionId: packAttributeId,
      label: fact.label,
      sourceIds: fact.sourceIds,
      status: 'supported',
      value: fact.value,
    });
  }
  for (const unknown of data.unknowns) {
    const packAttributeId = HOUSEHOLD_FIT_UNKNOWN_TRANSLATION[unknown.id];
    if (packAttributeId === undefined) continue;
    attributes[packAttributeId] = record(clock, {
      definitionId: packAttributeId,
      label: unknown.label,
      sourceIds: [],
      status: 'unknown',
    });
  }
  return attributes;
}

/**
 * Builds the four car-purchase candidate `EntityRecord`s from the real
 * fixture tools. See module header for the full grounding and the two
 * documented read-only id mismatches this works around.
 */
export function buildCarPurchaseCandidateEntities(clock: Clock): EntityRecord[] {
  const now = clock.now();
  const rawListings = loadFixture('candidate-listings');
  const standardFeaturesByCandidateId = new Map(
    rawListings.candidates.map((candidate) => [candidate.candidateId, candidate.standardFeatures]),
  );

  return CAR_PURCHASE_CANDIDATE_IDS.map((candidateId): EntityRecord => {
    const listingResult = unwrapOk<{
      listing: CandidateListingFacts;
      dealerOffer: CandidateDealerOfferFacts;
    }>(readListing({ candidateId }), `reading the listing for "${candidateId}"`);
    const ownershipResult = unwrapOk<OwnershipCostResult>(
      calculateOwnershipCost({ candidateId }),
      `calculating ownership cost for "${candidateId}"`,
    );
    // The `?? []` fallback has no reachable real-data trigger: `readListing`
    // above (which must already have succeeded to reach this line -- see
    // `unwrapOk`) resolves `candidateId` against the exact same cached
    // `loadFixture('candidate-listings')` object `standardFeaturesByCandidateId`
    // was built from, so any `candidateId` that survives `unwrapOk` is
    // necessarily already a key in this map.
    const standardFeatures = standardFeaturesByCandidateId.get(candidateId) ?? [];

    const attributes: Record<string, AttributeRecord> = {
      ...listingAttributes(
        clock,
        listingResult.listing,
        listingResult.dealerOffer,
        standardFeatures,
      ),
      ...ownershipAttributes(clock, ownershipResult),
      ...safetyAttributes(clock, candidateId, lookupSafetyReliability({ candidateId })),
      ...householdFitAttributes(clock, candidateId, lookupHouseholdFit({ candidateId })),
    };

    return {
      id: candidateId,
      kind: 'candidate',
      label: candidateLabel(listingResult.listing),
      attributes,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export interface CarPurchaseSeedResult {
  readonly caseState: CaseState;
  readonly events: CaseEvent[];
}

export interface BuildCarPurchaseSeedEventsParams {
  readonly pack: CompiledDecisionPack;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly selection?: PackSelection;
}

/**
 * The full seed `CaseEvent` sequence for a fresh car-purchase demo case:
 * `case.created`, `criteria.updated`, one `obligation.updated` per compiled
 * obligation (mirroring `apps/agent/src/services/command-service.ts`'s
 * `startDemo` -- read-only reference, not imported here to keep this
 * package's dependency graph one-directional; the shape is intentionally
 * identical), then one `option.upserted` per candidate entity. `caseState`
 * is the same `instantiateCase` result the first three event groups encode;
 * a caller that only needs the events (e.g. to feed a real `CaseStore`) can
 * ignore it.
 */
export function buildCarPurchaseSeedEvents(
  params: BuildCarPurchaseSeedEventsParams,
): CarPurchaseSeedResult {
  const { pack, clock, idGenerator } = params;
  const selection: PackSelection = params.selection ?? {
    selectedBy: 'router',
    reasons: [
      `"${pack.identity.name}" matched the household's request to compare shortlisted vehicles.`,
      'The case mentions candidate listings, a dealer offer, and household cargo/budget needs.',
    ],
  };
  const caseState = instantiateCase(pack, selection, clock, idGenerator);
  const now = caseState.createdAt;

  const events: CaseEvent[] = [
    {
      eventId: idGenerator.next('event'),
      caseId: caseState.id,
      sequence: 1,
      timestamp: now,
      type: 'case.created',
      payload: { title: caseState.title, pack: caseState.pack },
    },
    {
      eventId: idGenerator.next('event'),
      caseId: caseState.id,
      sequence: 2,
      timestamp: now,
      type: 'criteria.updated',
      payload: { criteria: caseState.criteria },
    },
    ...caseState.obligations.map((obligation, index): CaseEvent => ({
      eventId: idGenerator.next('event'),
      caseId: caseState.id,
      sequence: 3 + index,
      timestamp: now,
      type: 'obligation.updated',
      payload: { obligation },
    })),
  ];

  const entities = buildCarPurchaseCandidateEntities(clock);
  const optionStartSequence = events.length + 1;
  events.push(
    ...entities.map((entity, index): CaseEvent => ({
      eventId: idGenerator.next('event'),
      caseId: caseState.id,
      sequence: optionStartSequence + index,
      timestamp: now,
      type: 'option.upserted',
      payload: { entity },
    })),
  );

  return { caseState, events };
}

// --- Bid Comparison entity seeding ---
//
// Mirrors `buildCarPurchaseCandidateEntities`'s own "no two competing
// sources of truth for one fixture fact" discipline (see this module's own
// header): every attribute below is the REAL output of the real fixture
// tools (`bid-reader`/`bid-calculator`/`license-lookup`), so a freshly
// seeded case already shows the same numbers the live `bid-comparison`
// Swarm investigation independently re-derives.

/**
 * Bids whose scope-normalized adjusted total needs plug numbers for the
 * required scope items `scope-differ`/`bid-calculator` find absent
 * (`bid-calculator.ts`'s own honesty rule: an absent item with no supplied
 * plug number leaves `adjustedTotal` an explicit unknown, never a silent
 * `$0` or the quoted total standing in for it). Three of the twelve bids in
 * this fixture set are missing required scope items: `bid-cedar` (permits
 * and inspections, the shower-valve rough-in, and debris haul-away --
 * the scripted narrative's own scope-normalization beat),
 * `bid-westbrook` (debris haul-away alone), and `bid-brightwater` (permits
 * and inspections alone) -- the latter two are minor, single-item gaps
 * among the nine also-ran bids added to scale this case to a realistic
 * twelve-bidder public bid tab, never disturbing the recommendation. Every
 * dollar figure here is Northgate Plumbing's own real priced line-item
 * amount for that exact scope item (`bid-northgate.json`) -- the same real,
 * non-invented plug numbers the scripted `price-analyst` beat itself
 * supplies (`apps/agent/src/runtime/scripted-beats/bid-comparison.ts`'s
 * `buildPriceAnalystProvider`), so this seed's adjusted total matches the
 * live investigation's exactly.
 */
const BID_COMPARISON_PLUG_NUMBERS: Readonly<Record<string, Record<string, number>>> = {
  'bid-cedar': {
    'permits-inspections': 18000,
    'shower-valve-rough-in': 31500,
    'debris-haul-away': 6000,
  },
  'bid-westbrook': {
    'debris-haul-away': 6000,
  },
  'bid-brightwater': {
    'permits-inspections': 18000,
  },
};

/** Every attribute the `bid-comparison` pack manifest declares on its one `bid` entity kind, computed from one bid's real `readBid`/`calculateBidEconomics`/`lookupLicense` results. */
function bidComparisonAttributes(
  clock: Clock,
  bid: BidReaderResult,
  calculated: BidCalculatorResult,
  license: LicenseLookupFacts,
): Record<string, AttributeRecord> {
  const bidSourceId = `source-${bid.bidId}`;
  const adjustedTotalSourceId = `source-bid-calculator-${bid.bidId}-adjusted-total`;
  const scopeCompletenessSourceId = `source-bid-calculator-${bid.bidId}-scope-completeness`;
  const licenseSourceId = `source-license-${license.licenseNumber}`;
  const namedInsuredSourceId = `${licenseSourceId}-named-insured`;

  return {
    'bid.quoted_total': record(clock, {
      definitionId: 'bid.quoted_total',
      label: 'Quoted total',
      sourceIds: [bidSourceId],
      status: 'asserted',
      value: { type: 'money', amount: bid.total.amount, currency: bid.total.currency },
    }),
    'bid.deposit_percent': record(clock, {
      definitionId: 'bid.deposit_percent',
      label: 'Deposit requested',
      sourceIds: [bidSourceId],
      status: 'asserted',
      value: { type: 'number', value: bid.depositPercent, unit: '%' },
    }),
    'bid.start_weeks': record(clock, {
      definitionId: 'bid.start_weeks',
      label: 'Weeks until work can start',
      sourceIds: [bidSourceId],
      status: 'asserted',
      value: { type: 'number', value: bid.startInWeeks, unit: 'weeks' },
    }),
    'bid.duration_days': record(clock, {
      definitionId: 'bid.duration_days',
      label: 'Estimated project duration',
      sourceIds: [bidSourceId],
      status: 'asserted',
      value: { type: 'number', value: bid.durationWorkingDays, unit: 'days' },
    }),
    'bid.license_status': record(clock, {
      definitionId: 'bid.license_status',
      label: 'License status',
      sourceIds: [licenseSourceId],
      status: 'asserted',
      value: { type: 'enum', value: license.status },
    }),
    'bid.insurance_named_insured_match': record(clock, {
      definitionId: 'bid.insurance_named_insured_match',
      label: 'Insurance named insured matches license holder',
      sourceIds: [namedInsuredSourceId],
      status: 'asserted',
      value: { type: 'boolean', value: license.insurance.matchesLicenseHolder },
    }),
    // `credentials_valid` gates `packages/packs/src/bid-comparison.ts`'s
    // protected hard constraint -- derived here from the two recorded
    // registry facts (never itself a single raw fact), matching that
    // manifest's own module header ("`credential-checker`'s
    // `credential-verification` skill derives it from the two recorded
    // facts ... rather than either recorded fact being the gate on its
    // own").
    'bid.credentials_valid': record(clock, {
      definitionId: 'bid.credentials_valid',
      label: 'License and insurance credentials fully valid',
      sourceIds: [licenseSourceId, namedInsuredSourceId],
      status: 'asserted',
      value: {
        type: 'boolean',
        value:
          license.isActive &&
          license.classCoversScope &&
          license.insurance.isActive &&
          license.insurance.matchesLicenseHolder,
      },
    }),
    'bid.scope_completeness': record(clock, {
      definitionId: 'bid.scope_completeness',
      label: 'Scope completeness',
      sourceIds: [scopeCompletenessSourceId],
      status: 'asserted',
      value: {
        type: 'number',
        // A percentage NUMBER (62.5, not 0.625) -- the same convention this
        // package already uses for every other `unit: '%'` attribute (e.g.
        // `bid.deposit_percent` below), matching `bid-calculator.ts`'s own
        // `(scopeCompleteness * 100).toFixed(1)` display formatting.
        value: Number((calculated.scopeCompleteness * 100).toFixed(1)),
        unit: '%',
      },
    }),
    'bid.adjusted_total':
      calculated.adjustedTotal.status === 'known'
        ? record(clock, {
            definitionId: 'bid.adjusted_total',
            label: 'Scope-normalized adjusted total',
            sourceIds: [adjustedTotalSourceId],
            status: 'asserted',
            value: {
              type: 'money',
              amount: calculated.adjustedTotal.value.amount,
              currency: calculated.adjustedTotal.value.currency,
            },
          })
        : // Never reachable for this fixture set (`BID_COMPARISON_PLUG_NUMBERS`
          // supplies every plug number `bid-cedar` needs), but never
          // silently coalesced to the quoted total or `$0` if a future bid
          // ever left an item genuinely unpriced -- docs/engineering-principles.md
          // "It may never ... fabricate."
          record(clock, {
            definitionId: 'bid.adjusted_total',
            label: 'Scope-normalized adjusted total',
            sourceIds: [],
            status: 'unknown',
          }),
    // Cedar & Sons' bid mentions a workmanship warranty but states no term
    // in writing (`bid-cedar.json`'s `warranty.termMonths: null`). This
    // stays an explicit unknown -- never a fabricated 0-month warranty
    // (docs/engineering-principles.md "It may never ... fabricate").
    'bid.warranty_months':
      bid.warranty.termMonths === null
        ? record(clock, {
            definitionId: 'bid.warranty_months',
            label: 'Warranty term',
            sourceIds: [],
            status: 'unknown',
          })
        : record(clock, {
            definitionId: 'bid.warranty_months',
            label: 'Warranty term',
            sourceIds: [bidSourceId],
            status: 'asserted',
            value: { type: 'number', value: bid.warranty.termMonths, unit: 'months' },
          }),
  };
}

/**
 * Builds the three Bid Comparison `EntityRecord`s (`bid-northgate`,
 * `bid-cedar`, `bid-tworivers`), kind `'bid'` (the pack manifest's one
 * declared entity kind -- `packages/packs/src/bid-comparison.ts`'s
 * `entities: [{ id: 'bid', ... }]`), from the real fixture tools. See this
 * section's own header comment for the full grounding.
 */
export function buildBidComparisonEntities(clock: Clock): EntityRecord[] {
  const now = clock.now();
  return BID_FIXTURE_NAMES.map((bidId: BidFixtureName): EntityRecord => {
    const bid = unwrapOk<BidReaderResult>(readBid({ bidId }), `reading bid "${bidId}"`);
    const calculated = unwrapOk<BidCalculatorResult>(
      calculateBidEconomics({
        bidId,
        ...(BID_COMPARISON_PLUG_NUMBERS[bidId] !== undefined
          ? { plugNumbers: BID_COMPARISON_PLUG_NUMBERS[bidId] }
          : {}),
      }),
      `calculating bid economics for "${bidId}"`,
    );
    const license = unwrapOk<{ license: LicenseLookupFacts }>(
      lookupLicense({ licenseNumber: bid.licenseNumber }),
      `looking up the license for "${bidId}"`,
    ).license;

    return {
      id: bidId,
      kind: 'bid',
      label: bid.contractorName,
      attributes: bidComparisonAttributes(clock, bid, calculated, license),
      createdAt: now,
      updatedAt: now,
    };
  });
}
