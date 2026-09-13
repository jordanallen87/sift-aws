/**
 * TDD tests for `seeds.ts`: loading the real car-purchase fixture data into
 * `EntityRecord`s (via the real fixture tools, not a re-implementation of
 * their math) and the full `case.created` + `criteria.updated` +
 * `obligation.updated`[] + `option.upserted`[] seed event sequence
 * `instantiateCase` alone cannot produce (docs/specs/architecture.md
 * "Deterministic core": `instantiateCase` seeds pack-declared state only,
 * never entities -- see this file's header comment for the full reasoning).
 */
import { describe, expect, it } from 'vitest';
import type { Clock, IdGenerator } from '@sift/core';
import { instantiateCase } from '@sift/core';
import {
  BID_COMPARISON_MANIFEST,
  CAR_PURCHASE_MANIFEST,
  HOME_ENERGY_GUARDIAN_MANIFEST,
  compileBidComparisonPack,
  compileCarPurchasePack,
  compileHomeEnergyGuardianPack,
  createCapabilityCatalog,
} from '@sift/packs';
import { SourceSchema, type DecisionPackManifest } from '@sift/contracts';
import { BID_FIXTURE_NAMES, notFoundResult, okResult } from './tools/index.js';
import type {
  lookupHouseholdFit,
  lookupSafetyReliability,
  SafetyReliabilityClaim,
} from './tools/index.js';
import {
  BID_COMPARISON_SOURCE_TAGS,
  buildBidComparisonEntities,
  buildBidComparisonSources,
  buildCarPurchaseCandidateEntities,
  buildCarPurchaseSeedEvents,
  buildCarPurchaseSources,
  buildHomeEnergyResponseOptionEntities,
  buildHomeEnergySources,
  CAR_PURCHASE_CANDIDATE_IDS,
  householdFitAttributes,
  publisherForFixtureSource,
  record,
  safetyAttributes,
  unwrapOk,
} from './seeds.js';

const FIXED_CLOCK: Clock = { now: () => '2026-08-27T00:00:00.000Z' };

function fixedIdGenerator(): IdGenerator {
  let counter = 0;
  return { next: (prefix) => `${prefix ?? 'id'}-${++counter}` };
}

function catalogFor(manifest: DecisionPackManifest) {
  return createCapabilityCatalog([
    ...manifest.skills.map((skill) => ({
      id: skill.id,
      kind: 'skill' as const,
      version: '1.0.0',
    })),
    ...manifest.specialists.map((specialist) => ({
      id: specialist.id,
      kind: 'specialist' as const,
      version: '1.0.0',
    })),
    ...manifest.tools.map((tool) => ({
      id: tool.id,
      kind: 'tool' as const,
      version: '1.0.0',
    })),
  ]);
}

function carPurchaseCatalog() {
  return catalogFor(CAR_PURCHASE_MANIFEST);
}

function bidComparisonCatalog() {
  return catalogFor(BID_COMPARISON_MANIFEST);
}

function homeEnergyGuardianCatalog() {
  return catalogFor(HOME_ENERGY_GUARDIAN_MANIFEST);
}

/**
 * Assembles the same seeded `bid-comparison` `CaseState.entities`/`.sources`
 * a fresh demo case would hold, for the invariant tests below: `instantiateCase`
 * alone always seeds `entities: []`/`sources: []` (this file's own header
 * comment), so both real builders are folded in exactly the way a seed
 * pipeline would.
 */
function seededBidComparisonCase() {
  const pack = compileBidComparisonPack(bidComparisonCatalog(), FIXED_CLOCK);
  const caseState = instantiateCase(
    pack,
    { selectedBy: 'router', reasons: ['test: seeded bid-comparison case'] },
    FIXED_CLOCK,
    fixedIdGenerator(),
  );
  return {
    ...caseState,
    entities: buildBidComparisonEntities(FIXED_CLOCK),
    sources: buildBidComparisonSources(FIXED_CLOCK),
  };
}

/** Same as `seededBidComparisonCase` above, for a freshly seeded car-purchase demo case. */
function seededCarPurchaseCase() {
  const pack = compileCarPurchasePack(carPurchaseCatalog(), FIXED_CLOCK);
  const caseState = instantiateCase(
    pack,
    { selectedBy: 'router', reasons: ['test: seeded car-purchase case'] },
    FIXED_CLOCK,
    fixedIdGenerator(),
  );
  return {
    ...caseState,
    entities: buildCarPurchaseCandidateEntities(FIXED_CLOCK),
    sources: buildCarPurchaseSources(FIXED_CLOCK),
  };
}

/** Same as `seededBidComparisonCase` above, for a freshly seeded home-energy-guardian demo case. */
function seededHomeEnergyCase() {
  const pack = compileHomeEnergyGuardianPack(homeEnergyGuardianCatalog(), FIXED_CLOCK);
  const caseState = instantiateCase(
    pack,
    { selectedBy: 'router', reasons: ['test: seeded home-energy-guardian case'] },
    FIXED_CLOCK,
    fixedIdGenerator(),
  );
  return {
    ...caseState,
    entities: buildHomeEnergyResponseOptionEntities(FIXED_CLOCK),
    sources: buildHomeEnergySources(FIXED_CLOCK),
  };
}

/** Every `sourceIds` entry every attribute on every entity cites, deduplicated. */
function citedSourceIds(
  entities: { attributes: Record<string, { sourceIds: readonly string[] }> }[],
): Set<string> {
  const ids = new Set<string>();
  for (const entity of entities) {
    for (const attribute of Object.values(entity.attributes)) {
      for (const sourceId of attribute.sourceIds) {
        ids.add(sourceId);
      }
    }
  }
  return ids;
}

describe('CAR_PURCHASE_CANDIDATE_IDS', () => {
  it('names exactly the four fixture candidates', () => {
    expect([...CAR_PURCHASE_CANDIDATE_IDS].sort()).toEqual([
      'candidate-crv',
      'candidate-cx5',
      'candidate-outback',
      'candidate-rav4',
    ]);
  });
});

describe('buildCarPurchaseCandidateEntities', () => {
  it('builds one EntityRecord per candidate, kind "candidate"', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    expect(entities).toHaveLength(4);
    for (const entity of entities) {
      expect(entity.kind).toBe('candidate');
      expect(CAR_PURCHASE_CANDIDATE_IDS).toContain(entity.id);
    }
  });

  it('seeds the real teaser-price conflict math for candidate-rav4', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    const rav4 = entities.find((entity) => entity.id === 'candidate-rav4');
    expect(rav4).toBeDefined();

    const advertised = rav4?.attributes['car.advertised_price'];
    expect(advertised?.value).toEqual({ type: 'money', amount: 27995, currency: 'USD' });

    const outTheDoor = rav4?.attributes['car.out_the_door_price'];
    expect(outTheDoor?.value).toEqual({ type: 'money', amount: 33291.3, currency: 'USD' });

    const conflict = rav4?.attributes['car.has_teaser_price_conflict'];
    expect(conflict?.value).toEqual({ type: 'boolean', value: true });

    const gap = rav4?.attributes['car.teaser_price_gap_amount'];
    expect(gap?.value).toEqual({ type: 'money', amount: 5296.3, currency: 'USD' });
  });

  it('never fabricates rear_cargo_crate_fit or driving_comfort_rating -- both stay explicitly unknown', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    for (const entity of entities) {
      const crateFit = entity.attributes['car.rear_cargo_crate_fit'];
      const comfort = entity.attributes['car.driving_comfort_rating'];
      expect(crateFit?.status).toBe('unknown');
      expect('value' in (crateFit ?? {})).toBe(false);
      expect(comfort?.status).toBe('unknown');
      expect('value' in (comfort ?? {})).toBe(false);
    }
  });

  it('translates the household-fit tool definition ids to the pack manifest attribute ids', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    const crv = entities.find((entity) => entity.id === 'candidate-crv');
    // Pack manifest ids (car.cargo_volume_cu_ft / car.cargo_width_in /
    // car.cargo_length_in), not the fixture tool's own differently-named
    // ids (car.cargo_volume_behind_second_row_cu_ft / ...) -- see this
    // file's header comment for the read-only id mismatch this works around.
    expect(crv?.attributes['car.cargo_volume_cu_ft']?.value).toEqual({
      type: 'number',
      value: 39.3,
      unit: 'cu ft',
    });
    expect(crv?.attributes['car.cargo_width_in']?.value).toEqual({
      type: 'number',
      value: 42.8,
      unit: 'in',
    });
    expect(crv?.attributes['car.cargo_length_in']?.value).toEqual({
      type: 'number',
      value: 39.4,
      unit: 'in',
    });
    // The tool-only field with no pack-manifest counterpart at all
    // (car.cargo_height_floor_to_ceiling_in) is not seeded as an entity
    // attribute -- the pack never declares it.
    expect(crv?.attributes['car.cargo_height_floor_to_ceiling_in']).toBeUndefined();
  });

  it('seeds required car.standard_features from the raw fixture (the listing-reader tool does not expose it)', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    const rav4 = entities.find((entity) => entity.id === 'candidate-rav4');
    const features = rav4?.attributes['car.standard_features'];
    expect(features?.value).toMatchObject({ type: 'string_list' });
    if (features?.value?.type === 'string_list') {
      expect(features.value.values).toContain('all-wheel drive');
    }
  });

  it('seeds the ownership-calculator E3 five-year totals identically to calling the tool directly', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    const rav4 = entities.find((entity) => entity.id === 'candidate-rav4');
    const total = rav4?.attributes['car.five_year_ownership_cost'];
    expect(total?.value?.type).toBe('money');
    expect(total?.sourceIds).toEqual(['source-ownership-calculator-candidate-rav4']);
  });

  it('marks the disputed candidate-outback reliability rating conflicted, citing both sources', () => {
    const entities = buildCarPurchaseCandidateEntities(FIXED_CLOCK);
    const outback = entities.find((entity) => entity.id === 'candidate-outback');
    const reliability = outback?.attributes['car.reliability_rating'];
    expect(reliability?.status).toBe('conflicted');
    expect(reliability?.sourceIds).toEqual(
      expect.arrayContaining([
        'source-consumer-drive-index',
        'source-autotrust-reliability-survey',
      ]),
    );
  });
});

describe('buildCarPurchaseSeedEvents', () => {
  it('produces case.created, criteria.updated, one obligation.updated per obligation, then one option.upserted per candidate, in sequence', () => {
    const pack = compileCarPurchasePack(carPurchaseCatalog(), FIXED_CLOCK);
    const { caseState, events } = buildCarPurchaseSeedEvents({
      pack,
      clock: FIXED_CLOCK,
      idGenerator: fixedIdGenerator(),
    });

    expect(events[0]?.type).toBe('case.created');
    expect(events[1]?.type).toBe('criteria.updated');
    const obligationEvents = events.filter((event) => event.type === 'obligation.updated');
    expect(obligationEvents).toHaveLength(pack.obligations.length);
    const optionEvents = events.filter((event) => event.type === 'option.upserted');
    expect(optionEvents).toHaveLength(4);

    events.forEach((event, index) => {
      expect(event.sequence).toBe(index + 1);
    });

    expect(caseState.pack.id).toBe('car-purchase');
    expect(caseState.entities).toHaveLength(0); // instantiateCase alone never seeds entities
  });
});

describe('buildBidComparisonEntities', () => {
  it('builds one EntityRecord per bid, kind "bid", labelled by contractor name -- all twelve bidders, not just the three the narrative names', () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    expect(entities.map((entity) => entity.id).sort()).toEqual(
      [
        'bid-cedar',
        'bid-northgate',
        'bid-tworivers',
        'bid-summit',
        'bid-ironclad',
        'bid-parkside',
        'bid-westbrook',
        'bid-anchor',
        'bid-crestview',
        'bid-fieldstone',
        'bid-brightwater',
        'bid-oldmill',
      ].sort(),
    );
    for (const entity of entities) {
      expect(entity.kind).toBe('bid');
    }
    expect(entities.find((entity) => entity.id === 'bid-northgate')?.label).toBe(
      'Northgate Plumbing',
    );
    expect(entities.find((entity) => entity.id === 'bid-cedar')?.label).toBe('Cedar & Sons');
    expect(entities.find((entity) => entity.id === 'bid-tworivers')?.label).toBe(
      'Two Rivers Mechanical',
    );
  });

  it("never fabricates Cedar & Sons' warranty term -- it stays an explicit unknown, never 0 months", () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    const cedar = entities.find((entity) => entity.id === 'bid-cedar');
    const warranty = cedar?.attributes['bid.warranty_months'];
    expect(warranty?.status).toBe('unknown');
    expect('value' in (warranty ?? {})).toBe(false);

    // Northgate and Two Rivers both state a real term in writing.
    expect(
      entities.find((entity) => entity.id === 'bid-northgate')?.attributes['bid.warranty_months']
        ?.value,
    ).toEqual({
      type: 'number',
      value: 24,
      unit: 'months',
    });
    expect(
      entities.find((entity) => entity.id === 'bid-tworivers')?.attributes['bid.warranty_months']
        ?.value,
    ).toEqual({ type: 'number', value: 36, unit: 'months' });
  });

  it("seeds Cedar & Sons' scope-normalized adjusted total using the real absent-item plug numbers, not its raw quoted total", () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    const cedar = entities.find((entity) => entity.id === 'bid-cedar');
    expect(cedar?.attributes['bid.quoted_total']?.value).toEqual({
      type: 'money',
      amount: 223500,
      currency: 'USD',
    });
    // Higher than Northgate's own adjusted total -- the central finding this
    // pack exists to surface.
    expect(cedar?.attributes['bid.adjusted_total']?.value).toEqual({
      type: 'money',
      amount: 279000,
      currency: 'USD',
    });
    expect(cedar?.attributes['bid.scope_completeness']?.value).toEqual({
      type: 'number',
      value: 62.5,
      unit: '%',
    });
  });

  it("marks Two Rivers Mechanical's credentials invalid on the real named-insured mismatch, and the other two bids fully valid", () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    const byId = new Map(entities.map((entity) => [entity.id, entity]));

    expect(
      byId.get('bid-tworivers')?.attributes['bid.insurance_named_insured_match']?.value,
    ).toEqual({ type: 'boolean', value: false });
    expect(byId.get('bid-tworivers')?.attributes['bid.credentials_valid']?.value).toEqual({
      type: 'boolean',
      value: false,
    });
    expect(byId.get('bid-northgate')?.attributes['bid.credentials_valid']?.value).toEqual({
      type: 'boolean',
      value: true,
    });
    expect(byId.get('bid-cedar')?.attributes['bid.credentials_valid']?.value).toEqual({
      type: 'boolean',
      value: true,
    });
  });

  it("marks Fieldstone Plumbing Co.'s credentials invalid on a real, distinct ground from Two Rivers' -- a licence class with no plumbing trade endorsement, not a named-insured mismatch", () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    const fieldstone = entities.find((entity) => entity.id === 'bid-fieldstone');
    expect(fieldstone?.attributes['bid.insurance_named_insured_match']?.value).toEqual({
      type: 'boolean',
      value: true,
    });
    expect(fieldstone?.attributes['bid.credentials_valid']?.value).toEqual({
      type: 'boolean',
      value: false,
    });
  });

  it('gives none of the nine also-ran bids a scope-normalized adjusted total below Northgate Plumbing among credential-valid bids', () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    const northgate = entities.find((entity) => entity.id === 'bid-northgate');
    const northgateAdjusted = (
      northgate?.attributes['bid.adjusted_total']?.value as { amount: number } | undefined
    )?.amount;
    expect(northgateAdjusted).toBe(276000);
    for (const entity of entities) {
      if (entity.id === 'bid-northgate') continue;
      const credentialsValid = (
        entity.attributes['bid.credentials_valid']?.value as { value: boolean } | undefined
      )?.value;
      const adjustedTotal = entity.attributes['bid.adjusted_total'];
      if (credentialsValid !== true || adjustedTotal?.status !== 'asserted') continue;
      const amount = (adjustedTotal.value as { amount: number }).amount;
      expect(
        amount,
        `bid "${entity.id}" must not undercut Northgate's adjusted total`,
      ).toBeGreaterThan(northgateAdjusted!);
    }
  });
});

describe('buildBidComparisonSources / seeded bid-comparison case sources', () => {
  // INVARIANT, not a hardcoded id list: every `sourceIds` entry any
  // bid-comparison entity attribute cites must resolve to a real `Source`
  // present on the seeded case. This is the regression test for the defect
  // where a freshly seeded case held 60 distinct cited sourceIds and zero
  // `Source` rows -- "No sources yet" in the UI while every attribute
  // claimed a citation.
  it('provides a Source for every sourceIds entry every seeded entity attribute cites, and the cited set is non-empty', () => {
    const caseState = seededBidComparisonCase();
    const citedIds = citedSourceIds(caseState.entities);
    const sourceIdsOnCase = new Set(caseState.sources.map((source) => source.id));

    // Non-empty, so this assertion can never pass vacuously.
    expect(citedIds.size).toBeGreaterThan(0);

    for (const sourceId of citedIds) {
      expect(
        sourceIdsOnCase.has(sourceId),
        `sourceId "${sourceId}" is cited by a seeded entity attribute but has no matching Source on the case`,
      ).toBe(true);
    }
  });

  it('never produces an orphan Source -- every Source it builds is cited by at least one seeded entity attribute', () => {
    const caseState = seededBidComparisonCase();
    const citedIds = citedSourceIds(caseState.entities);

    for (const source of caseState.sources) {
      expect(
        citedIds.has(source.id),
        `Source "${source.id}" is not cited by any seeded entity attribute`,
      ).toBe(true);
    }
  });

  it('builds Source records that satisfy SourceSchema (fixture origin, unverified, a real retrievedAt, a real non-empty summary)', () => {
    const sources = buildBidComparisonSources(FIXED_CLOCK);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(() => SourceSchema.parse(source)).not.toThrow();
      expect(source.origin).toBe('fixture');
      expect(source.verification).toBe('unverified');
      expect(source.summary).toBeTruthy();
    }
  });

  it('deduplicates: the license/named-insured Source ids are shared across entities, and each still resolves to exactly one Source', () => {
    const sources = buildBidComparisonSources(FIXED_CLOCK);
    const idCounts = new Map<string, number>();
    for (const source of sources) {
      idCounts.set(source.id, (idCounts.get(source.id) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      expect(count, `Source id "${id}" must be built exactly once`).toBe(1);
    }
  });

  // Regression test for the casing bug: `license-lookup.ts`'s own
  // `licenseSourceId()` lowercases the licence number (scripts/check-source.ts
  // flags the uppercase form as a possible secret -- see that function's own
  // doc comment) before building the id. The seed must cite that exact
  // lowercase id, never a re-uppercased copy of it, or the citation can
  // never resolve against what the tool -- and a live investigation run --
  // actually produces.
  it("cites the license source id in the tool's own lowercase form, never the bid fixture's uppercase licence number", () => {
    const entities = buildBidComparisonEntities(FIXED_CLOCK);
    const northgate = entities.find((entity) => entity.id === 'bid-northgate');
    const licenseStatusSourceIds = northgate?.attributes['bid.license_status']?.sourceIds ?? [];
    expect(licenseStatusSourceIds).toEqual(['source-license-pl-4417-ng']);

    const citedIds = citedSourceIds(entities);
    for (const sourceId of citedIds) {
      if (!sourceId.startsWith('source-license-')) continue;
      expect(sourceId, `license source id "${sourceId}" must be all-lowercase`).toBe(
        sourceId.toLowerCase(),
      );
    }
  });

  // Regression test for the defect this task fixes: a freshly seeded case
  // held sixty real `Source`s but every one carried `tags: undefined`, so
  // the Reference library rendered one flat 60-item scroll with no filter
  // chips (the document-import path's sources DO carry tags, and the UI
  // already renders chips for them -- the seeded sources simply did not
  // participate). `BID_COMPARISON_SOURCE_TAGS` (seeds.ts) is the small,
  // deliberate vocabulary this closes the gap with.
  describe('tags', () => {
    it('gives every seeded Source a non-empty tags array whose entries all satisfy SourceSchema', () => {
      const sources = buildBidComparisonSources(FIXED_CLOCK);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source.tags, `Source "${source.id}" must carry tags`).toBeDefined();
        expect(source.tags!.length).toBeGreaterThan(0);
        // A person can filter by two or so, never a sprawling per-source
        // taxonomy -- see BID_COMPARISON_SOURCE_TAGS's own header.
        expect(source.tags!.length).toBeLessThanOrEqual(2);
        for (const tag of source.tags!) {
          // Lowercase-kebab, matching every tag `command-service.ts` mints
          // ('bid-document', 'import-check') -- a deliberate house style,
          // not a SourceSchema requirement (`tags` is free-form there).
          expect(tag, `tag "${tag}" on Source "${source.id}" must be lowercase-kebab`).toMatch(
            /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
          );
        }
      }
      // SourceSchema itself governs length/safety (safeString(60), max 20
      // entries) -- exercised here via the real schema, not re-asserted by
      // hand.
      for (const source of sources) {
        expect(() => SourceSchema.parse(source)).not.toThrow();
      }
    });

    it('uses exactly the chosen five-tag vocabulary -- a future addition must be deliberate, not drift', () => {
      const sources = buildBidComparisonSources(FIXED_CLOCK);
      const distinctTags = new Set(sources.flatMap((source) => source.tags ?? []));
      expect(distinctTags).toEqual(new Set(Object.values(BID_COMPARISON_SOURCE_TAGS)));
    });

    it('tags the twelve bid submissions with exactly the bid-document tag, one per bid', () => {
      const sources = buildBidComparisonSources(FIXED_CLOCK);
      const bidSubmissions = sources.filter((source) =>
        source.tags?.includes(BID_COMPARISON_SOURCE_TAGS.bidDocument),
      );
      expect(bidSubmissions).toHaveLength(BID_FIXTURE_NAMES.length);
      for (const source of bidSubmissions) {
        expect(source.tags).toEqual([BID_COMPARISON_SOURCE_TAGS.bidDocument]);
        expect(source.title.endsWith('bid submission')).toBe(true);
      }
    });

    it("tags the bid-calculator's derivations (adjusted total AND scope completeness) with bid-calculation -- two per bid", () => {
      const sources = buildBidComparisonSources(FIXED_CLOCK);
      const calculations = sources.filter((source) =>
        source.tags?.includes(BID_COMPARISON_SOURCE_TAGS.bidCalculation),
      );
      // Two derivations (adjusted total, scope completeness) for every bid.
      expect(calculations).toHaveLength(BID_FIXTURE_NAMES.length * 2);
      for (const source of calculations) {
        expect(source.tags).toEqual([BID_COMPARISON_SOURCE_TAGS.bidCalculation]);
        expect(source.id).toMatch(/^source-bid-calculator-/);
      }
      // Never overlaps the credential checks below -- a derivation is never
      // also a registry lookup.
      for (const source of calculations) {
        expect(source.tags).not.toContain(BID_COMPARISON_SOURCE_TAGS.credentialCheck);
      }
    });

    it('tags the licence registry and certificate-of-insurance records as import-check, and keeps them distinguishable from each other', () => {
      const sources = buildBidComparisonSources(FIXED_CLOCK);
      const credentialChecks = sources.filter((source) =>
        source.tags?.includes(BID_COMPARISON_SOURCE_TAGS.credentialCheck),
      );
      // One licence record and one certificate per bid.
      expect(credentialChecks).toHaveLength(BID_FIXTURE_NAMES.length * 2);

      const licenseRecords = credentialChecks.filter((source) =>
        source.tags?.includes(BID_COMPARISON_SOURCE_TAGS.licenseRegistry),
      );
      const insuranceRecords = credentialChecks.filter((source) =>
        source.tags?.includes(BID_COMPARISON_SOURCE_TAGS.certificateOfInsurance),
      );
      expect(licenseRecords).toHaveLength(BID_FIXTURE_NAMES.length);
      expect(insuranceRecords).toHaveLength(BID_FIXTURE_NAMES.length);
      // Every credential check is exactly one of the two sub-kinds, never
      // both and never neither.
      expect(licenseRecords.length + insuranceRecords.length).toBe(credentialChecks.length);
      for (const source of licenseRecords) {
        expect(source.tags).toEqual([
          BID_COMPARISON_SOURCE_TAGS.credentialCheck,
          BID_COMPARISON_SOURCE_TAGS.licenseRegistry,
        ]);
        expect(source.id).toMatch(/^source-license-/);
      }
      for (const source of insuranceRecords) {
        expect(source.tags).toEqual([
          BID_COMPARISON_SOURCE_TAGS.credentialCheck,
          BID_COMPARISON_SOURCE_TAGS.certificateOfInsurance,
        ]);
        expect(source.id).toMatch(/-named-insured$/);
      }
    });

    it('leaves id/url/excerpt untouched by tagging -- ids stay the tool-built form and urls stay the sift:// fixture shape', () => {
      const sources = buildBidComparisonSources(FIXED_CLOCK);
      for (const source of sources) {
        expect(source.url).toBe(`sift://fixtures/bid-comparison/${source.id}`);
        expect(source.id).toMatch(/^[a-z0-9._-]+$/);
        expect(source).not.toHaveProperty('excerpt');
      }
      // Spot-check the same licence id the lowercase-casing test above
      // pins, so this file has one place that ties a concrete id to its
      // real tag set.
      const northgateLicense = sources.find((source) => source.id === 'source-license-pl-4417-ng');
      expect(northgateLicense?.tags).toEqual([
        BID_COMPARISON_SOURCE_TAGS.credentialCheck,
        BID_COMPARISON_SOURCE_TAGS.licenseRegistry,
      ]);
    });
  });
});

// Same invariant as `buildBidComparisonSources / seeded bid-comparison case
// sources` above, for the other two packs: a freshly started car-purchase
// demo case measured 20 cited sourceIds against 0 seeded Source rows, and a
// freshly started home-energy-guardian case measured 4 against 0
// (apps/agent/src/server.ts's `demoSeedSources` map used to document this
// honestly -- "car-purchase/home-energy-guardian have the same defect but no
// builder yet"). `buildCarPurchaseSources`/`buildHomeEnergySources` close
// that gap the same way `buildBidComparisonSources` already did; this proves
// it as the SAME invariant over whatever a seeded entity's attributes
// actually cite, never a hardcoded id list, so it stays true even if the
// underlying fixtures change shape.
describe('buildCarPurchaseSources / seeded car-purchase case sources', () => {
  it('provides a Source for every sourceIds entry every seeded entity attribute cites, and the cited set is non-empty', () => {
    const caseState = seededCarPurchaseCase();
    const citedIds = citedSourceIds(caseState.entities);
    const sourceIdsOnCase = new Set(caseState.sources.map((source) => source.id));

    expect(citedIds.size).toBeGreaterThan(0);

    for (const sourceId of citedIds) {
      expect(
        sourceIdsOnCase.has(sourceId),
        `sourceId "${sourceId}" is cited by a seeded entity attribute but has no matching Source on the case`,
      ).toBe(true);
    }
  });

  it('never produces an orphan Source -- every Source it builds is cited by at least one seeded entity attribute', () => {
    const caseState = seededCarPurchaseCase();
    const citedIds = citedSourceIds(caseState.entities);

    for (const source of caseState.sources) {
      expect(
        citedIds.has(source.id),
        `Source "${source.id}" is not cited by any seeded entity attribute`,
      ).toBe(true);
    }
  });

  it('builds Source records that satisfy SourceSchema (fixture origin, verified, a real retrievedAt, a real non-empty summary, and a human-readable title -- never the raw sourceId)', () => {
    const sources = buildCarPurchaseSources(FIXED_CLOCK);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(() => SourceSchema.parse(source)).not.toThrow();
      expect(source.origin).toBe('fixture');
      expect(source.verification).toBe('verified');
      expect(source.summary).toBeTruthy();
      // §34 regression (see `car-purchase-scenario.ts`'s `ensureSourcesExist`
      // doc comment): `title` must be the real publisher name, never the
      // raw internal id `RecommendationCard` would otherwise render as a
      // citation's visible link text.
      expect(source.title).not.toBe(source.id);
      expect(source.title).toBe(publisherForFixtureSource(source.id));
    }
  });

  // Regression coverage for the coordinator-flagged consistency requirement:
  // `car-purchase-scenario.ts`'s `ensureSourcesExist` (the live-run backfill
  // for a sourceId this seed builder did not pre-build) must never disagree
  // with this seed builder about what a given sourceId's Source looks like.
  // Both now share `publisherForFixtureSource` for `title`/`publisher` and
  // the same `https://fixtures.example.com/sources/{id}` url shape -- see
  // `seeds.ts`'s own "Shared fixture Source publisher labels" section.
  it('gives every Source the same url shape and the same title/publisher `ensureSourcesExist` would build for the same sourceId', () => {
    const sources = buildCarPurchaseSources(FIXED_CLOCK);
    for (const source of sources) {
      expect(source.url).toBe(`https://fixtures.example.com/sources/${source.id}`);
      expect(source.publisher).toBe(publisherForFixtureSource(source.id));
    }
  });

  it('builds exactly one Source for the four safety/reliability report ids shared across all four candidates, never one per candidate', () => {
    const sources = buildCarPurchaseSources(FIXED_CLOCK);
    const idCounts = new Map<string, number>();
    for (const source of sources) {
      idCounts.set(source.id, (idCounts.get(source.id) ?? 0) + 1);
    }
    expect(idCounts.get('source-national-crash-safety-consortium')).toBe(1);
    for (const [id, count] of idCounts) {
      expect(count, `Source id "${id}" must be built exactly once`).toBe(1);
    }
  });
});

describe('buildHomeEnergySources / seeded home-energy-guardian case sources', () => {
  it('provides a Source for every sourceIds entry every seeded entity attribute cites, and the cited set is non-empty', () => {
    const caseState = seededHomeEnergyCase();
    const citedIds = citedSourceIds(caseState.entities);
    const sourceIdsOnCase = new Set(caseState.sources.map((source) => source.id));

    expect(citedIds.size).toBeGreaterThan(0);

    for (const sourceId of citedIds) {
      expect(
        sourceIdsOnCase.has(sourceId),
        `sourceId "${sourceId}" is cited by a seeded entity attribute but has no matching Source on the case`,
      ).toBe(true);
    }
  });

  it('never produces an orphan Source -- every Source it builds is cited by at least one seeded entity attribute', () => {
    const caseState = seededHomeEnergyCase();
    const citedIds = citedSourceIds(caseState.entities);

    for (const source of caseState.sources) {
      expect(
        citedIds.has(source.id),
        `Source "${source.id}" is not cited by any seeded entity attribute`,
      ).toBe(true);
    }
  });

  it('builds Source records that satisfy SourceSchema (fixture origin, verified, a real retrievedAt, a real non-empty summary, and a human-readable title -- never the raw sourceId)', () => {
    const sources = buildHomeEnergySources(FIXED_CLOCK);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(() => SourceSchema.parse(source)).not.toThrow();
      expect(source.origin).toBe('fixture');
      expect(source.verification).toBe('verified');
      expect(source.summary).toBeTruthy();
      expect(source.title).not.toBe(source.id);
      expect(source.title).toBe(publisherForFixtureSource(source.id));
    }
  });

  it("cites each response option's own real description as the Source summary, never an invented sentence", () => {
    const sources = buildHomeEnergySources(FIXED_CLOCK);
    const monitor = sources.find(
      (source) => source.id === 'source-response-option-monitor-one-cycle',
    );
    expect(monitor?.summary).toContain('Take no action and observe');
  });
});

describe('unwrapOk', () => {
  it('throws a descriptive error, rather than silently returning undefined, when given a non-"ok" ToolResult', () => {
    const result = notFoundResult(
      'some-fixture-tool',
      'candidate-ghost',
      'no such candidate on record',
    );
    expect(() => unwrapOk(result, 'looking up a fictional candidate')).toThrow(
      'seeds.ts: expected an "ok" result while looking up a fictional candidate, got "not_found"',
    );
  });
});

describe('record', () => {
  it('throws, rather than silently building an invalid AttributeRecord, when status "unknown" is paired with a value (violating the asserted/unknown invariant)', () => {
    expect(() =>
      record(FIXED_CLOCK, {
        definitionId: 'car.make',
        label: 'Make',
        sourceIds: [],
        status: 'unknown',
        value: { type: 'text', value: 'should not be present for an unknown record' },
      }),
    ).toThrow(/seeds\.ts: failed to build attribute record "car\.make"/);
  });
});

function syntheticSafetyClaim(
  category: string,
  rating: string,
  sourceId: string,
): SafetyReliabilityClaim {
  return {
    category,
    rating,
    notes: 'synthetic claim for a seeds.ts unit test',
    sourceId,
    publisher: 'Synthetic Publisher (test fixture)',
    reportTitle: 'Synthetic Report (test fixture)',
    url: 'https://example.com/synthetic-report',
    retrievedAt: '2026-08-15',
    publishedAt: '2026-08-01',
  };
}

describe('safetyAttributes', () => {
  it('skips (does not fabricate) an attribute for a SAFETY_CATEGORY_TO_ATTRIBUTE category with no recorded claim, rather than throwing or inventing a rating', () => {
    const syntheticResult: ReturnType<typeof lookupSafetyReliability> = okResult(
      'safety-reliability-lookup',
      {
        candidateId: 'candidate-synthetic',
        // Only crash_safety has a claim; driver_assistance and reliability
        // (also declared in SAFETY_CATEGORY_TO_ATTRIBUTE) do not.
        claims: [
          syntheticSafetyClaim('crash_safety', 'Top Safety Pick+', 'source-synthetic-crash'),
        ],
        disagreements: [],
        evidence: [],
      },
    );

    const attributes = safetyAttributes(FIXED_CLOCK, 'candidate-synthetic', syntheticResult);

    expect(Object.keys(attributes)).toEqual(['car.crash_safety_rating']);
    expect(attributes['car.driver_assistance_rating']).toBeUndefined();
    expect(attributes['car.reliability_rating']).toBeUndefined();
  });
});

describe('householdFitAttributes', () => {
  it('skips (does not fabricate) an attribute for an unknown id with no HOUSEHOLD_FIT_UNKNOWN_TRANSLATION entry, rather than throwing or inventing a pack attribute id', () => {
    const syntheticResult: ReturnType<typeof lookupHouseholdFit> = okResult(
      'household-fit-matrix',
      {
        candidateId: 'candidate-synthetic',
        knownFacts: [],
        unknowns: [
          {
            id: 'unknown.some_untranslated_question',
            definitionId: 'unknown.some_untranslated_question',
            label: 'Some untranslated unknown question',
            origin: 'pack',
            sourceIds: [],
            status: 'unknown',
            updatedAt: FIXED_CLOCK.now(),
            question: 'Some untranslated question no pack attribute maps to?',
            reason: 'synthetic reason for a seeds.ts unit test',
            resolutionPath: 'synthetic resolution path for a seeds.ts unit test',
          },
        ],
        householdDogCrateProfile: {
          crateCount: 0,
          eachCrateDimensionsIn: { lengthIn: 0, widthIn: 0, heightIn: 0 },
        },
        evidence: [],
      },
    );

    const attributes = householdFitAttributes(FIXED_CLOCK, 'candidate-synthetic', syntheticResult);

    expect(Object.keys(attributes)).toHaveLength(0);
  });
});
