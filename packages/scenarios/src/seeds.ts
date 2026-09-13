/**
 * Loads the real car-purchase fixture data into the four candidate
 * `EntityRecord`s the "Choose Our Next Car" demo compares, plus the full
 * seed `CaseEvent` sequence a fresh demo case needs. Also builds the
 * matching `Source` record for every `sourceIds` entry those entities'
 * attributes cite (`buildCarPurchaseSources`) -- and the Home Energy
 * Guardian analog, `buildHomeEnergySources`, for the four response-option
 * `EntityRecord`s further below -- closing the defect
 * `apps/agent/src/server.ts`'s `demoSeedSources` map used to describe as
 * "the same defect [as car-purchase and home-energy-guardian had] but no
 * builder yet": a freshly started demo case held real cited `sourceIds` on
 * its seeded entities but zero matching `Source` rows, so the UI rendered
 * an unresolved citation as a raw mono id (e.g.
 * `[source-listing-candidate-rav4]`) instead of a titled link. Mirrors
 * `buildBidComparisonSources`, the same fix already shipped for the third
 * pack.
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
  Source,
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
  type CandidateListingResult,
  type HouseholdFitResult,
  type LicenseLookupFacts,
  type LicenseLookupResult,
  type OwnershipCostResult,
  type ResponseOption,
  type ToolEvidenceItem,
} from './tools/index.js';

// --- Shared fixture Source publisher labels (car-purchase AND home-energy) ---
//
// Moved here from `apps/agent/src/runtime/car-purchase-scenario.ts` (which
// still re-exports `publisherForFixtureSource` under its own historical name
// `publisherFor`, unchanged, so every existing caller/test there keeps
// working). That file's own `ensureSourcesExist` -- the live-run backfill
// that gives a `Source` to a sourceId an `ExecutionResult` cited but no seed
// builder pre-built -- is reused UNMODIFIED across all three packs' engines
// (car-purchase, home-energy, bid-comparison each import it from
// `car-purchase-scenario.ts`, despite that file's car-purchase-specific
// name), so this mapping was already a cross-pack utility in practice, just
// living one layer too high in the workspace's dependency graph for this
// module's OWN seed-time source builders (`buildCarPurchaseSources`,
// `buildHomeEnergySources` below) to reuse without an apps -> packages
// import inversion (architecture.md's layering: `packages/scenarios` may
// never depend on `apps/agent`). Moving the mapping down here, and having
// `car-purchase-scenario.ts` import it back, is the only way both the
// seed-time path (this file) and the live-run backfill path
// (`ensureSourcesExist`) can agree that one sourceId always means one
// `Source` -- title, publisher, and url alike -- regardless of which path
// happens to build it first for a given case.
//
// bid-comparison deliberately keeps its OWN, separately-reasoned
// `sift://.../unverified` Source convention (`bidComparisonSourceUrl`/
// `bidComparisonSource` below) rather than this one: `ensureSourcesExist`
// never actually backfills a bid-comparison source in practice, because
// `buildBidComparisonSources` already seeds every sourceId a fresh
// bid-comparison case cites, so there is no second path for that pack's
// sources to ever disagree with.
const FIXTURE_SOURCE_PUBLISHERS: Readonly<Record<string, string>> = {
  'source-national-crash-safety-consortium': 'National Crash Safety Consortium (fictional)',
  'source-northfield-vehicle-safety-lab': 'Northfield Vehicle Safety Lab (fictional)',
  'source-consumer-drive-index': 'Consumer Drive Index (fictional)',
  'source-autotrust-reliability-survey': 'AutoTrust Annual Reliability Survey (fictional)',
};

/**
 * Human-readable, plainly fictional publisher label for a car-purchase or
 * home-energy fixture `sourceId` -- exported for `car-purchase-scenario.ts`
 * to re-export as `publisherFor` (see this section's own header) and for
 * this module's own `buildCarPurchaseSources`/`buildHomeEnergySources`
 * below. Every returned label already carries "(fictional)" or otherwise
 * plainly names a fixture-only construct (docs/engineering-principles.md's
 * demo-data honesty posture; see every `_provenance` field under
 * `packages/scenarios/fixtures/`) -- never a real publication, dealer, or
 * organization name standing alone.
 */
export function publisherForFixtureSource(sourceId: string): string {
  const known = FIXTURE_SOURCE_PUBLISHERS[sourceId];
  if (known !== undefined) return known;
  if (sourceId.startsWith('source-listing-'))
    return 'Example vehicle listing aggregator (fictional)';
  if (sourceId.startsWith('source-dealer-offer-')) return 'Dealer written offer (fictional)';
  if (sourceId.startsWith('source-ownership-calculator-')) return 'Sift ownership cost calculator';
  if (sourceId.startsWith('source-household-fit-'))
    return 'Manufacturer specification sheet (fictional)';
  if (sourceId.startsWith('source-response-option-'))
    return 'Home Energy Guardian response-option catalog (fictional)';
  return 'Fixture source (fictional)';
}

/**
 * Non-network URL for a `Source` built by this module's car-purchase/
 * home-energy seed builders below, OR by `car-purchase-scenario.ts`'s
 * `ensureSourcesExist` -- the SAME shape both paths use (see this section's
 * own header), so a citation resolves to the identical `Source` regardless
 * of which path built it first.
 */
function fixtureBackedSourceUrl(sourceId: string): string {
  return `https://fixtures.example.com/sources/${sourceId}`;
}

/**
 * Builds one car-purchase or home-energy `Source` from a real fixture-
 * derived `summary` sentence (never invented -- every call site below passes
 * either a real `ToolEvidenceItem.summary`, a real fixture field, or a join
 * of several real per-field summaries) and `sourceId` (always the same id
 * this module's own attribute-building code already cited, never a second,
 * independently recomputed copy of it). `verification: 'verified'` and
 * `origin: 'fixture'` mirror `ensureSourcesExist`'s own choice there
 * (deterministic fixture-mode sources are pre-vetted for this demo, which
 * also keeps E1->E2 evidence synthesis deterministic -- see that function's
 * own doc comment for the full reasoning this does not repeat).
 */
function fixtureBackedSource(clock: Clock, sourceId: string, summary: string): Source {
  const now = clock.now();
  const publisher = publisherForFixtureSource(sourceId);
  return {
    id: sourceId,
    url: fixtureBackedSourceUrl(sourceId),
    title: publisher,
    publisher,
    retrievedAt: now,
    summary,
    origin: 'fixture',
    verification: 'verified',
    createdAt: now,
  };
}

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

interface HomeEnergySeedData {
  readonly entities: EntityRecord[];
  readonly sources: Source[];
}

/**
 * Builds the four Home Energy Guardian response-option `EntityRecord`s
 * (`monitor-one-cycle`/`change-rate-plan`/`request-energy-audit`/
 * `request-hvac-inspection`) directly from the real `response-options.json`
 * fixture, AND the `Source` record for the one `sourceId` each option's
 * attributes cite (`homeEnergyResponseOptionAttributes` above) -- both from
 * the same fixture read, so a freshly seeded case's entities and sources can
 * never disagree about which id names which source. Mirrors
 * `buildBidComparisonSeedData`'s own "same underlying build, split into two
 * return shapes" discipline (see that function's doc comment); this and
 * `buildCarPurchaseSeedData` below are the same pattern applied to the other
 * two packs, closing the defect `apps/agent/src/server.ts`'s
 * `demoSeedSources` map used to document ("have the same defect but no
 * builder yet") for both of them.
 *
 * Each option's `Source.summary` is that option's own real
 * `response-options.json` `description` field verbatim -- never a
 * paraphrase or an invented sentence -- so the citation can never say
 * anything the seeded attributes themselves do not already say.
 *
 * See this module's own header comment above for the full grounding and the
 * documented, deliberately deferred `billing_cycle` seeding gap this does
 * not attempt to close.
 */
function buildHomeEnergySeedData(clock: Clock): HomeEnergySeedData {
  const now = clock.now();
  const fixture = loadFixture('response-options');

  const entities: EntityRecord[] = [];
  const sources: Source[] = [];
  for (const option of fixture.options) {
    const sourceId = `source-response-option-${option.optionId}`;
    entities.push({
      id: option.optionId,
      kind: 'response_option',
      label: option.label,
      attributes: homeEnergyResponseOptionAttributes(clock, option),
      createdAt: now,
      updatedAt: now,
    });
    sources.push(fixtureBackedSource(clock, sourceId, option.description));
  }

  return { entities, sources };
}

/**
 * Builds the four Home Energy Guardian response-option `EntityRecord`s. See
 * `buildHomeEnergySeedData` above for the full grounding; this and
 * `buildHomeEnergySources` below are the same underlying build, split into
 * the two return shapes their existing/new callers each need.
 */
export function buildHomeEnergyResponseOptionEntities(clock: Clock): EntityRecord[] {
  return buildHomeEnergySeedData(clock).entities;
}

/**
 * Builds the `Source` record for every `sourceIds` entry the four Home
 * Energy Guardian response-option `EntityRecord`s' attributes cite -- so a
 * freshly seeded `home-energy-guardian` case can hold these on
 * `CaseState.sources` and every one of those citations resolves. See
 * `buildHomeEnergySeedData` above for the full grounding.
 */
export function buildHomeEnergySources(clock: Clock): Source[] {
  return buildHomeEnergySeedData(clock).sources;
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

interface CarPurchaseSeedData {
  readonly entities: EntityRecord[];
  readonly sources: Source[];
}

/**
 * Builds the four car-purchase candidate `EntityRecord`s from the real
 * fixture tools, AND the `Source` record for every `sourceIds` entry those
 * entities' attributes cite -- both from the SAME fixture-tool calls (one
 * call per tool per candidate; never called twice), so a freshly seeded
 * case's entities and sources can never disagree about which id names which
 * source. Mirrors `buildBidComparisonSeedData`'s own "same underlying
 * build, split into two return shapes" discipline. See module header for
 * the full grounding and the two documented read-only id mismatches this
 * works around.
 *
 * Rather than resolving each of the four fixture tools' own `evidence`
 * shape into a `Source` independently (bid-comparison's approach, viable
 * there because every bid-comparison sourceId is 1:1 with one
 * `ToolEvidenceItem`), this walks the sourceIds the JUST-BUILT `attributes`
 * object actually cites for this candidate, and resolves EACH one against
 * whichever real fixture data produced it:
 *
 * - `source-listing-*`/`source-dealer-offer-*`: `readListing`'s own
 *   `evidence[].summary` (one traceable document each, per that tool's own
 *   module header).
 * - `source-ownership-calculator-*`: `calculateOwnershipCost`'s own
 *   `evidence[0].summary` (the E3 "shows its work" arithmetic summary).
 * - The four safety/reliability report ids (e.g.
 *   `source-national-crash-safety-consortium`) are shared across all four
 *   candidates -- `safety-reliability-sources.json`'s own top-level
 *   `sources[]` array (the exact join `lookupSafetyReliability` itself
 *   performs internally) is the one canonical record per id, so this reads
 *   that array directly (the same "read the fixture directly for data the
 *   tool doesn't expose at the right granularity" precedent module header
 *   mismatch #1 already establishes) rather than picking one arbitrary
 *   candidate's per-finding note to stand in for the whole report.
 * - `source-household-fit-*`: `lookupHouseholdFit`'s own `evidence[]` (seven
 *   per-field summaries sharing ONE sourceId, because household-fit.json
 *   documents all seven fields come from one manufacturer specification
 *   sheet per candidate) joined into one summary -- the same
 *   `summaryParts.join(' ')` convention `command-service.ts` already uses to
 *   combine several real sentences into one `Source.summary`.
 *
 * Driving this resolution off `citedIds` (rather than off each tool's raw
 * `evidence` unconditionally) means a category/translation this candidate's
 * own attribute builders skip (`safetyAttributes`'/`householdFitAttributes`'
 * own defensive skip branches) can never leave a cited id unresolved OR
 * build an orphan `Source` nothing cites -- the same invariant
 * `seeds.test.ts` proves for bid-comparison, proved here structurally
 * instead of by (correct, but happenstance) fixture content.
 */
function buildCarPurchaseSeedData(clock: Clock): CarPurchaseSeedData {
  const now = clock.now();
  const rawListings = loadFixture('candidate-listings');
  const standardFeaturesByCandidateId = new Map(
    rawListings.candidates.map((candidate) => [candidate.candidateId, candidate.standardFeatures]),
  );
  const safetySourcesById = new Map(
    loadFixture('safety-reliability-sources').sources.map(
      (source) => [source.sourceId, source] as const,
    ),
  );

  const entities: EntityRecord[] = [];
  const sourcesById = new Map<string, Source>();

  for (const candidateId of CAR_PURCHASE_CANDIDATE_IDS) {
    const listingResult = unwrapOk<CandidateListingResult>(
      readListing({ candidateId }),
      `reading the listing for "${candidateId}"`,
    );
    const ownershipResult = unwrapOk<OwnershipCostResult>(
      calculateOwnershipCost({ candidateId }),
      `calculating ownership cost for "${candidateId}"`,
    );
    const safetyResult = lookupSafetyReliability({ candidateId });
    const householdFitResult = lookupHouseholdFit({ candidateId });
    const householdFitData = unwrapOk<HouseholdFitResult>(
      householdFitResult,
      `looking up household fit for "${candidateId}"`,
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
      ...safetyAttributes(clock, candidateId, safetyResult),
      ...householdFitAttributes(clock, candidateId, householdFitResult),
    };

    entities.push({
      id: candidateId,
      kind: 'candidate',
      label: candidateLabel(listingResult.listing),
      attributes,
      createdAt: now,
      updatedAt: now,
    });

    // Every sourceId this candidate's own attributes actually cite --
    // see this function's own doc comment for why resolution is driven
    // off this set rather than off each tool's raw evidence unconditionally.
    const citedIds = new Set<string>();
    for (const attribute of Object.values(attributes)) {
      for (const sourceId of attribute.sourceIds) citedIds.add(sourceId);
    }

    const evidenceSummaryBySourceId = new Map<string, string>();
    for (const evidence of listingResult.evidence) {
      evidenceSummaryBySourceId.set(evidence.sourceId, evidence.summary);
    }
    for (const evidence of ownershipResult.evidence) {
      evidenceSummaryBySourceId.set(evidence.sourceId, evidence.summary);
    }
    // Real, verbatim per-field summaries from the tool's own evidence,
    // joined -- never a hand-composed sentence standing in for the seven
    // real ones (see this function's own doc comment).
    const householdFitSourceId = householdFitData.evidence[0]?.sourceId;
    const householdFitSummary =
      householdFitData.evidence.length > 0
        ? householdFitData.evidence.map((item) => item.summary).join(' ')
        : undefined;

    for (const sourceId of citedIds) {
      if (sourcesById.has(sourceId)) continue;

      const toolEvidenceSummary = evidenceSummaryBySourceId.get(sourceId);
      if (toolEvidenceSummary !== undefined) {
        sourcesById.set(sourceId, fixtureBackedSource(clock, sourceId, toolEvidenceSummary));
        continue;
      }

      const safetySource = safetySourcesById.get(sourceId);
      if (safetySource !== undefined) {
        const summary =
          safetySource.methodologyNote ??
          `${safetySource.reportTitle} (${safetySource.publisherName}).`;
        sourcesById.set(sourceId, fixtureBackedSource(clock, sourceId, summary));
        continue;
      }

      if (
        householdFitSourceId !== undefined &&
        householdFitSummary !== undefined &&
        sourceId === householdFitSourceId
      ) {
        sourcesById.set(sourceId, fixtureBackedSource(clock, sourceId, householdFitSummary));
        continue;
      }

      // Unreachable for the real fixture set (every cited id above resolves
      // against one of the three real fixture-tool results this candidate's
      // own attributes were just built from) -- never silently skipped if a
      // future attribute ever cites an id none of them can explain, the same
      // "no reachable real-data trigger, exercised as a loud defensive
      // check" discipline `unwrapOk`/`evidenceFor` document above.
      throw new Error(
        `seeds.ts: cited sourceId "${sourceId}" for candidate "${candidateId}" has no known car-purchase Source-building path`,
      );
    }
  }

  return { entities, sources: [...sourcesById.values()] };
}

/**
 * Builds the four car-purchase candidate `EntityRecord`s. See
 * `buildCarPurchaseSeedData` above for the full grounding; this and
 * `buildCarPurchaseSources` below are the same underlying build, split into
 * the two return shapes their existing/new callers each need.
 */
export function buildCarPurchaseCandidateEntities(clock: Clock): EntityRecord[] {
  return buildCarPurchaseSeedData(clock).entities;
}

/**
 * Builds the `Source` record for every `sourceIds` entry the four car-
 * purchase candidate `EntityRecord`s' attributes cite (deduplicated by id --
 * the four safety/reliability report sources are shared across all four
 * candidates) -- so a freshly seeded `car-purchase` case can hold these on
 * `CaseState.sources` and every one of those citations resolves. See
 * `buildCarPurchaseSeedData` above for the full grounding.
 */
export function buildCarPurchaseSources(clock: Clock): Source[] {
  return buildCarPurchaseSeedData(clock).sources;
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

/**
 * Every attribute the `bid-comparison` pack manifest declares on its one
 * `bid` entity kind, computed from one bid's real `readBid`/
 * `calculateBidEconomics`/`lookupLicense` results.
 *
 * `licenseSourceId`/`namedInsuredSourceId` are taken verbatim from
 * `lookupLicense`'s own `ToolEvidenceItem.sourceId`s (see
 * `buildBidComparisonSeedData` below), never recomputed here -- `./tools/
 * license-lookup.ts`'s `licenseSourceId()` lowercases the licence number
 * (`scripts/check-source.ts` flags the uppercase form as a possible secret;
 * see that function's own doc comment) before building the id, so an id
 * built by re-interpolating `license.licenseNumber` here would carry the
 * licence's original uppercase casing and never match what the tool itself
 * emits. Citing the tool's own id, rather than a second, independently
 * recomputed copy of it, is the only way this can never drift again.
 */
function bidComparisonAttributes(
  clock: Clock,
  bid: BidReaderResult,
  calculated: BidCalculatorResult,
  license: LicenseLookupFacts,
  licenseSourceId: string,
  namedInsuredSourceId: string,
): Record<string, AttributeRecord> {
  const bidSourceId = `source-${bid.bidId}`;
  const adjustedTotalSourceId = `source-bid-calculator-${bid.bidId}-adjusted-total`;
  const scopeCompletenessSourceId = `source-bid-calculator-${bid.bidId}-scope-completeness`;

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
 * Finds the one `ToolEvidenceItem` a real fixture tool's own `evidence`
 * array carries for `sourceId`, rather than assuming array position or
 * re-deriving the id a second time. Throws (never silently returns
 * `undefined`) if the id is absent -- the same "no reachable real-data
 * trigger, exercised as a loud defensive check" discipline `unwrapOk`
 * documents above: every real call site here names a `sourceId` this
 * module itself just built from the SAME tool result's own fields, so a
 * miss here can only mean the two have drifted apart, which must never pass
 * silently.
 */
function evidenceFor(
  evidence: readonly ToolEvidenceItem[],
  sourceId: string,
  context: string,
): ToolEvidenceItem {
  const item = evidence.find((entry) => entry.sourceId === sourceId);
  if (item === undefined) {
    throw new Error(`seeds.ts: no evidence item found for sourceId "${sourceId}" while ${context}`);
  }
  return item;
}

/**
 * `lookupLicense`'s `evidence` always carries exactly two items -- a
 * "standing" item (licence/class/insurance status) and a "named insured"
 * item, in that order (`license-lookup.ts`'s `buildEvidence`) -- but this
 * finds them by their real, distinguishing id shape (the named-insured item
 * is always `${standingSourceId}-named-insured`) rather than assuming that
 * order, and throws rather than silently proceeding if the tool ever stops
 * returning exactly that shape.
 */
function licenseEvidenceItems(
  bidId: string,
  evidence: readonly ToolEvidenceItem[],
): { standing: ToolEvidenceItem; namedInsured: ToolEvidenceItem } {
  const namedInsured = evidence.find((item) => item.sourceId.endsWith('-named-insured'));
  const standing = evidence.find((item) => item !== namedInsured);
  if (standing === undefined || namedInsured === undefined || evidence.length !== 2) {
    throw new Error(
      `seeds.ts: expected lookupLicense to return exactly a "standing" and a "named-insured" evidence item for "${bidId}", got ${evidence.length} item(s)`,
    );
  }
  return { standing, namedInsured };
}

/**
 * Non-network URL for a bid-comparison fixture `Source` -- the same
 * `sift://` convention `apps/agent/src/services/command-service.ts` already
 * uses for a source with no real web address (`SourceSchema.url` is
 * required; see that file's own `sift://cases/{caseId}/documents/{sourceId}`
 * / `sift://cases/{caseId}/checks/{id}` construction). These sources are not
 * case-scoped -- the same twelve bid fixtures back every seeded
 * bid-comparison case -- so the path names the shared fixture set instead
 * of a case id, keyed by the source's own id for a stable, deterministic,
 * one-to-one URL per source.
 */
function bidComparisonSourceUrl(sourceId: string): string {
  return `sift://fixtures/bid-comparison/${sourceId}`;
}

/**
 * The tag vocabulary for the sixty seeded `bid-comparison` `Source`s, so the
 * Reference library renders filter chips for them instead of one flat
 * 60-item scroll (the defect this constant fixes: every seeded source
 * previously carried `tags: undefined`).
 *
 * Chosen to be the SAME vocabulary `apps/agent/src/services/command-service.ts`
 * already mints for a real bid-document import, not a parallel one, so a
 * person filtering the library gets the same kind of thing regardless of
 * whether a source arrived by seed or by import:
 *
 * - `bidDocument` ('bid-document') is that file's own tag for the submitted
 *   bid itself (`tags: ['bid-document', format]`). Reused verbatim -- a bid
 *   `readBid` reads off a fixture and a bid a person uploads are the same
 *   kind of artifact.
 * - `credentialCheck` ('import-check') is that file's own tag for a
 *   registry check `lookupLicense` ran (`buildCredentialAttributes`'s two
 *   `addSource` calls, titled "Contractor licence registry" and
 *   "Certificate of insurance"). Reused verbatim -- `licenseEvidenceItems`
 *   below calls that SAME tool for the SAME two evidence items, so these are
 *   not merely similar, they are the identical check.
 *
 * `licenseRegistry`/`certificateOfInsurance` are new, existing nowhere in
 * `command-service.ts`, because a bid-comparison case cares which of the two
 * credential checks a given source is (so "isolate the bids" / "isolate
 * credential records" both work as single-chip filters, while the licence
 * and the certificate stay individually distinguishable too).
 *
 * `bidCalculation` ('bid-calculation') is also new. It is deliberately NOT
 * `credentialCheck`: unlike the two checks above, the adjusted total and
 * scope completeness are never a registry lookup -- both come from the same
 * `calculateBidEconomics` call's own `evidence` (their source ids share the
 * `source-bid-calculator-` prefix built above), i.e. the bid-calculator's
 * own arithmetic on the bid's stated numbers, not a fact fetched from
 * somewhere else. (`command-service.ts` derives an imported bid's scope
 * completeness through a different tool, `scope-differ`, not the
 * bid-calculator, so there is no existing tag to reuse for this one.)
 *
 * Deliberately four tags of "kind", not more: exactly what distinguishes
 * "the bids" from "what Sift worked out" from the two credential records,
 * per this module's own module header. No source carries more than two.
 */
export const BID_COMPARISON_SOURCE_TAGS = {
  bidDocument: 'bid-document',
  bidCalculation: 'bid-calculation',
  credentialCheck: 'import-check',
  licenseRegistry: 'license-registry',
  certificateOfInsurance: 'certificate-of-insurance',
} as const;

/**
 * Builds one `Source` from a real fixture tool's own `ToolEvidenceItem`:
 * `summary` is that item's own `summary` sentence verbatim (never
 * paraphrased or invented -- it already quotes the fixture's real numbers),
 * `id`/`url` are keyed off its own `sourceId`, and `title`/`publisher` are
 * composed only from real fixture fields (contractor name, licence number,
 * licence holder name) the caller passes in. `tags` is the source's kind
 * from `BID_COMPARISON_SOURCE_TAGS` above (see that constant for why).
 */
function bidComparisonSource(
  clock: Clock,
  evidence: ToolEvidenceItem,
  options: { title: string; publisher?: string; tags: string[] },
): Source {
  const now = clock.now();
  return {
    id: evidence.sourceId,
    url: bidComparisonSourceUrl(evidence.sourceId),
    title: options.title,
    ...(options.publisher !== undefined ? { publisher: options.publisher } : {}),
    retrievedAt: now,
    tags: options.tags,
    summary: evidence.summary,
    origin: 'fixture',
    verification: 'unverified',
    createdAt: now,
  };
}

interface BidComparisonSeedData {
  readonly entities: EntityRecord[];
  readonly sources: Source[];
}

/**
 * Builds the twelve Bid Comparison `EntityRecord`s, kind `'bid'` (the pack
 * manifest's one declared entity kind --
 * `packages/packs/src/bid-comparison.ts`'s `entities: [{ id: 'bid', ... }]`),
 * AND the `Source` record for every `sourceIds` entry those entities'
 * attributes cite -- both from the same real fixture-tool calls
 * (`readBid`/`calculateBidEconomics`/`lookupLicense`), so a freshly seeded
 * case's entities and sources can never disagree about which id names which
 * source. See this section's own header comment for the full grounding.
 *
 * Several bids share the shape of a source id (the license/named-insured
 * pair) only in principle -- each of the twelve bids in this fixture set
 * names a distinct licence number, so no id collision is reachable today --
 * but `sourcesById` still deduplicates by id defensively, so a future bid
 * that reused another bid's licence would still get exactly one `Source`,
 * never a duplicate or a second, conflicting one.
 */
function buildBidComparisonSeedData(clock: Clock): BidComparisonSeedData {
  const now = clock.now();
  const entities: EntityRecord[] = [];
  const sourcesById = new Map<string, Source>();

  for (const bidId of BID_FIXTURE_NAMES as readonly BidFixtureName[]) {
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
    const licenseResult = unwrapOk<LicenseLookupResult>(
      lookupLicense({ licenseNumber: bid.licenseNumber }),
      `looking up the license for "${bidId}"`,
    );
    const license = licenseResult.license;
    const { standing: standingEvidence, namedInsured: namedInsuredEvidence } = licenseEvidenceItems(
      bidId,
      licenseResult.evidence,
    );

    const bidSourceId = `source-${bid.bidId}`;
    const adjustedTotalSourceId = `source-bid-calculator-${bid.bidId}-adjusted-total`;
    const scopeCompletenessSourceId = `source-bid-calculator-${bid.bidId}-scope-completeness`;

    entities.push({
      id: bidId,
      kind: 'bid',
      label: bid.contractorName,
      attributes: bidComparisonAttributes(
        clock,
        bid,
        calculated,
        license,
        standingEvidence.sourceId,
        namedInsuredEvidence.sourceId,
      ),
      createdAt: now,
      updatedAt: now,
    });

    const bidEvidence = evidenceFor(bid.evidence, bidSourceId, `reading bid "${bidId}"`);
    const adjustedTotalEvidence = evidenceFor(
      calculated.evidence,
      adjustedTotalSourceId,
      `calculating bid economics for "${bidId}"`,
    );
    const scopeCompletenessEvidence = evidenceFor(
      calculated.evidence,
      scopeCompletenessSourceId,
      `calculating bid economics for "${bidId}"`,
    );

    const sourceSpecs: [ToolEvidenceItem, { title: string; publisher?: string; tags: string[] }][] =
      [
        [
          bidEvidence,
          {
            title: `${bid.contractorName} bid submission`,
            publisher: bid.contractorName,
            tags: [BID_COMPARISON_SOURCE_TAGS.bidDocument],
          },
        ],
        [
          adjustedTotalEvidence,
          {
            title: `${bid.contractorName} bid calculator: scope-normalized adjusted total`,
            tags: [BID_COMPARISON_SOURCE_TAGS.bidCalculation],
          },
        ],
        [
          scopeCompletenessEvidence,
          {
            title: `${bid.contractorName} bid calculator: scope completeness`,
            tags: [BID_COMPARISON_SOURCE_TAGS.bidCalculation],
          },
        ],
        [
          standingEvidence,
          {
            title: `${license.licenseHolderName} license ${license.licenseNumber}`,
            tags: [
              BID_COMPARISON_SOURCE_TAGS.credentialCheck,
              BID_COMPARISON_SOURCE_TAGS.licenseRegistry,
            ],
          },
        ],
        [
          namedInsuredEvidence,
          {
            title: `${license.licenseHolderName} certificate of insurance`,
            tags: [
              BID_COMPARISON_SOURCE_TAGS.credentialCheck,
              BID_COMPARISON_SOURCE_TAGS.certificateOfInsurance,
            ],
          },
        ],
      ];
    for (const [evidence, options] of sourceSpecs) {
      if (!sourcesById.has(evidence.sourceId)) {
        sourcesById.set(evidence.sourceId, bidComparisonSource(clock, evidence, options));
      }
    }
  }

  return { entities, sources: [...sourcesById.values()] };
}

/**
 * Builds the twelve Bid Comparison `EntityRecord`s. See
 * `buildBidComparisonSeedData` above for the full grounding; this and
 * `buildBidComparisonSources` below are the same underlying build, split
 * into the two return shapes their existing callers each need.
 */
export function buildBidComparisonEntities(clock: Clock): EntityRecord[] {
  return buildBidComparisonSeedData(clock).entities;
}

/**
 * Builds the `Source` record for every `sourceIds` entry the twelve Bid
 * Comparison `EntityRecord`s' attributes cite (deduplicated by id) -- so a
 * freshly seeded `bid-comparison` case can hold these on `CaseState.sources`
 * and every one of those citations resolves. See `buildBidComparisonSeedData`
 * above for the full grounding, and `BID_COMPARISON_SOURCE_TAGS` above that
 * for why each of the sixty carries the `tags` it does.
 */
export function buildBidComparisonSources(clock: Clock): Source[] {
  return buildBidComparisonSeedData(clock).sources;
}
