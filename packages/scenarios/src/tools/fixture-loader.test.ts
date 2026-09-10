import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearFixtureCache,
  loadFixture,
  parseFixtureJson,
  FIXTURE_NAMES,
  type FixtureName,
} from './fixture-loader.js';

describe('FIXTURE_NAMES', () => {
  it('lists every car-purchase, energy, and bids fixture file this loader knows how to validate', () => {
    expect([...FIXTURE_NAMES].sort()).toEqual(
      [
        // car-purchase
        'candidate-listings',
        'dealer-offers',
        'household-fit',
        'household-profile',
        'ownership-assumptions',
        'safety-reliability-sources',
        // energy
        'current-bill',
        'current-bill-normal',
        'usage-history',
        'weather-history',
        'household-events',
        'rate-schedules',
        'response-options',
        // bids
        'job',
        'bid-northgate',
        'bid-cedar',
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
        'license-registry',
      ].sort(),
    );
  });
});

describe('parseFixtureJson (pure validation, no disk I/O)', () => {
  it('parses and validates real candidate-listings content', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-car-purchase',
      candidates: [
        {
          candidateId: 'candidate-rav4',
          make: 'Toyota',
          model: 'RAV4',
          modelYear: 2022,
          trim: 'XLE Hybrid AWD',
          bodyStyle: 'compact crossover SUV',
          drivetrain: 'AWD',
          powertrain: 'hybrid',
          advertisedPrice: { amount: 27995, currency: 'USD' },
          mileage: { value: 28400, unit: 'mi' },
          exteriorColor: 'Lunar Rock',
          vin: 'FICTIONAL-VIN-RAV4-0001',
          listingSourceUrl: 'https://motors.example.com/listings/x',
          listingId: 'listing-104822',
          dealerName: 'Example Motors of Northfield',
          listedAt: '2026-08-02',
          standardFeatures: ['all-wheel drive'],
        },
      ],
    });
    const result = parseFixtureJson('candidate-listings', raw);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.candidateId).toBe('candidate-rav4');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseFixtureJson('candidate-listings', '{not json')).toThrow(/not valid JSON/);
  });

  it('rejects content that fails schema validation', () => {
    const raw = JSON.stringify({ _provenance: 'x', caseId: 'x', candidates: [{ missing: true }] });
    expect(() => parseFixtureJson('candidate-listings', raw)).toThrow(/schema validation/);
  });

  it('rejects content exceeding the defensive size bound', () => {
    const raw = JSON.stringify({
      _provenance: 'x'.repeat(3_000_000),
      caseId: 'x',
      candidates: [],
    });
    expect(() => parseFixtureJson('candidate-listings', raw)).toThrow(/exceeds/);
  });

  it('accepts content exactly at the defensive size bound', () => {
    // Pad the schema's unbounded `_provenance` field (rather than adding an
    // unrecognized key, which the strict schema would reject on its own
    // merits) so the payload lands just under 2,000,000 bytes -- proving the
    // size check's boundary is inclusive (<=), not exclusive.
    const base = { _provenance: '', caseId: 'x', candidates: [] as unknown[] };
    const overhead = JSON.stringify(base).length;
    const padded = { ...base, _provenance: 'x'.repeat(2_000_000 - overhead) };
    const raw = JSON.stringify(padded);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(2_000_000);
    expect(() => parseFixtureJson('candidate-listings', raw)).not.toThrow();
  });

  it('throws for a fixture name with no registered schema', () => {
    expect(() => parseFixtureJson('not-a-real-fixture' as unknown as FixtureName, '{}')).toThrow(
      /no registered schema/,
    );
  });

  it('parses and validates real dealer-offers content, including the RAV4 teaser-price conflict shape', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-car-purchase',
      sharedTaxAndFeeAssumptions: {
        salesTaxRate: 0.07,
        salesTaxBasis: 'basis note',
        titleAndRegistrationFee: { amount: 275, currency: 'USD' },
      },
      offers: [
        {
          candidateId: 'candidate-rav4',
          dealerName: 'Example Motors of Northfield',
          quotedAt: '2026-08-19',
          hasTeaserPriceConflict: true,
          advertisedPrice: { amount: 27995, currency: 'USD' },
          advertisedFinancingExample: { description: 'x', apr: 0.049, termMonths: 60 },
          mandatoryAddOns: [
            {
              id: 'addon-value-protection-package',
              label: 'Value Protection Package',
              amount: 2395,
              currency: 'USD',
              mandatory: true,
              note: 'not removable',
            },
          ],
          actualFinancingOffer: {
            description: 'x',
            apr: 0.0749,
            termMonths: 75,
            note: 'longer term',
          },
          priceBreakdown: {
            advertisedPrice: 27995,
            mandatoryAddOnsTotal: 2894,
            subtotalBeforeTax: 30889,
            taxableBase: 30390,
            salesTax: 2127.3,
            titleAndRegistrationFee: 275,
            trueOutTheDoorPrice: 33291.3,
            arithmeticNote: 'x',
          },
          teaserGap: {
            advertisedPrice: 27995,
            trueOutTheDoorPrice: 33291.3,
            gapAmount: 5296.3,
            gapPercentOfAdvertised: 18.92,
            arithmeticNote: 'x',
            exceedsHouseholdMaxBudget: true,
            householdMaxBudget: 32000,
            amountOverBudget: 1291.3,
          },
          downPaymentAssumed: { amount: 3000, currency: 'USD' },
          amountFinanced: 30291.3,
          estimatedMonthlyPayment: {
            underAdvertisedTerms: { amount: 470.54, currency: 'USD', basis: 'x' },
            underActualOfferedTerms: { amount: 507.0, currency: 'USD', basis: 'x' },
            note: 'x',
          },
        },
      ],
    });
    const result = parseFixtureJson('dealer-offers', raw);
    expect(result.offers[0]?.teaserGap.exceedsHouseholdMaxBudget).toBe(true);
  });

  const validSafetyFixtureBase = {
    _provenance: 'fictional',
    caseId: 'case-demo-car-purchase',
    sources: [
      {
        sourceId: 'source-a',
        publisherName: 'Publisher A',
        reportTitle: 'Report A',
        url: 'https://example.com/a',
        retrievedAt: '2026-08-15',
        publishedAt: '2026-01-01',
      },
      {
        sourceId: 'source-b',
        publisherName: 'Publisher B',
        reportTitle: 'Report B',
        url: 'https://example.com/b',
        retrievedAt: '2026-08-15',
        publishedAt: '2026-01-01',
      },
    ],
  };

  it('rejects a safety-reliability-sources finding that cites an undeclared sourceId', () => {
    const raw = JSON.stringify({
      ...validSafetyFixtureBase,
      findings: [
        {
          candidateId: 'candidate-rav4',
          sourceId: 'source-does-not-exist',
          category: 'crash_safety',
          rating: 'Top',
          notes: 'x',
        },
      ],
      disagreements: [],
    });
    expect(() => parseFixtureJson('safety-reliability-sources', raw)).toThrow(
      /references unknown sourceId/,
    );
  });

  it('rejects a safety-reliability-sources disagreement that cites an undeclared sourceIdA/sourceIdB', () => {
    const raw = JSON.stringify({
      ...validSafetyFixtureBase,
      findings: [],
      disagreements: [
        {
          candidateId: 'candidate-outback',
          category: 'reliability',
          sourceIdA: 'source-a',
          ratingA: 'Above',
          sourceIdB: 'source-does-not-exist',
          ratingB: 'Below',
          natureOfConflict: 'x',
          requiresSourceChallengeReview: true,
        },
      ],
    });
    expect(() => parseFixtureJson('safety-reliability-sources', raw)).toThrow(
      /references unknown sourceIdB/,
    );
  });

  it('accepts a safety-reliability-sources fixture where every reference resolves', () => {
    const raw = JSON.stringify({
      ...validSafetyFixtureBase,
      findings: [
        {
          candidateId: 'candidate-rav4',
          sourceId: 'source-a',
          category: 'crash_safety',
          rating: 'Top',
          notes: 'x',
        },
      ],
      disagreements: [
        {
          candidateId: 'candidate-outback',
          category: 'reliability',
          sourceIdA: 'source-a',
          ratingA: 'Above',
          sourceIdB: 'source-b',
          ratingB: 'Below',
          natureOfConflict: 'x',
          requiresSourceChallengeReview: true,
        },
      ],
    });
    expect(() => parseFixtureJson('safety-reliability-sources', raw)).not.toThrow();
  });
});

describe('parseFixtureJson (pure validation, no disk I/O) -- energy fixtures', () => {
  it('parses valid current-bill content', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-energy-guardian',
      householdId: 'household-demo-energy-01',
      displayName: 'The Okafor-Bryant household',
      utilityAccountFictionalId: 'DEMO-ACCT-0000-0001',
      billingPeriod: { start: '2026-07-16', end: '2026-08-14', days: 30 },
      tariffId: 'tariff-standard-2026',
      usage: { value: 1565, unit: 'kWh' },
      charges: {
        fixedMonthlyCustomerCharge: { amount: 13.75, currency: 'USD' },
        volumetricCharge: { amount: 234.75, currency: 'USD', arithmeticNote: 'x' },
        totalAmount: { amount: 248.5, currency: 'USD', arithmeticNote: 'x' },
      },
      currentAmount: { amount: 248.5, currency: 'USD' },
      baseline: {
        amount: { amount: 175.0, currency: 'USD' },
        usage: { value: 1075, unit: 'kWh' },
        methodology: 'x',
        computedBy: 'x',
      },
      anomaly: {
        percentAboveBaseline: 42,
        arithmeticNote: 'x',
        usageGapAboveBaselineKwh: 490,
        usageGapArithmeticNote: 'x',
        flaggedAt: '2026-08-15T09:05:00Z',
        flaggedBy: 'deterministic anomaly watcher',
      },
    });
    const result = parseFixtureJson('current-bill', raw);
    expect(result.anomaly.percentAboveBaseline).toBe(42);
  });

  it('rejects current-bill content missing a required field', () => {
    const raw = JSON.stringify({ _provenance: 'x', caseId: 'x' });
    expect(() => parseFixtureJson('current-bill', raw)).toThrow(/schema validation/);
  });

  it('parses valid usage-history content', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-energy-guardian',
      householdId: 'household-demo-energy-01',
      cycles: [
        {
          cycleLabel: '2026-08',
          billingPeriod: { start: '2026-07-16', end: '2026-08-14' },
          usageKwh: 1565,
          tariffId: 'tariff-standard-2026',
          billedAmount: { amount: 248.5, currency: 'USD' },
          arithmeticNote: 'x',
          note: 'x',
        },
      ],
    });
    const result = parseFixtureJson('usage-history', raw);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.usageKwh).toBe(1565);
  });

  it('parses valid weather-history content, including the optional weatherAttribution block', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-energy-guardian',
      weatherStation: { stationId: 'station-x', name: 'x', degreeDayBaseF: 65 },
      cycles: [
        {
          cycleLabel: '2026-08',
          billingPeriod: { start: '2026-07-16', end: '2026-08-14' },
          hdd: 0,
          cdd: 460,
          weatherAttribution: {
            typicalCdd: 380,
            actualCdd: 460,
            excessCdd: 80,
            weatherSensitivityKwhPerCdd: 2.625,
            weatherSensitivityMethodology: 'x',
            usageExplainedByWeatherKwh: 210,
            arithmeticNote: 'x',
            conclusion: 'x',
          },
        },
      ],
    });
    const result = parseFixtureJson('weather-history', raw);
    expect(result.cycles[0]?.weatherAttribution?.usageExplainedByWeatherKwh).toBe(210);
  });

  it('parses valid household-events content, including an event without a device', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-energy-guardian',
      householdId: 'household-demo-energy-01',
      events: [
        {
          eventId: 'event-hvac-maintenance-2026-05',
          type: 'hvac_maintenance',
          date: '2026-05-08',
          label: 'x',
          description: 'x',
          performedBy: 'x',
          workOrderId: 'x',
          outcome: 'x',
          relevanceNote: 'x',
        },
      ],
    });
    const result = parseFixtureJson('household-events', raw);
    expect(result.events).toHaveLength(1);
  });

  it('parses valid rate-schedules content with two tariffs and a rate-change-impact block', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-energy-guardian',
      utilityName: 'x',
      tariffs: [
        {
          tariffId: 'tariff-standard-2024',
          label: 'x',
          effectiveFrom: '2024-06-01',
          effectiveTo: '2026-05-31',
          fixedMonthlyCustomerCharge: { amount: 11.25, currency: 'USD' },
          volumetricRatePerKwh: { amount: 0.135, currency: 'USD' },
          rateStructure: 'flat volumetric, no tiers',
        },
        {
          tariffId: 'tariff-standard-2026',
          label: 'x',
          effectiveFrom: '2026-06-01',
          effectiveTo: null,
          fixedMonthlyCustomerCharge: { amount: 13.75, currency: 'USD' },
          volumetricRatePerKwh: { amount: 0.15, currency: 'USD' },
          rateStructure: 'flat volumetric, no tiers',
          changeFromPriorTariff: {
            fixedChargeIncrease: { amount: 2.5, currency: 'USD' },
            fixedChargeIncreasePercent: 22.22,
            volumetricRateIncrease: { amount: 0.015, currency: 'USD' },
            volumetricRateIncreasePercent: 11.11,
            arithmeticNote: 'x',
          },
        },
      ],
      rateChangeImpactOnBaselineUsage: {
        note: 'x',
        baselineUsageKwh: 1075,
        billUnderPriorTariffAtBaselineUsage: {
          amount: 156.38,
          currency: 'USD',
          arithmeticNote: 'x',
        },
        billUnderCurrentTariffAtBaselineUsage: {
          amount: 175.0,
          currency: 'USD',
          arithmeticNote: 'x',
        },
        rateChangeAttributableAmount: { amount: 18.62, currency: 'USD', arithmeticNote: 'x' },
        rateChangeAttributablePercentOfTotalGap: 20.21,
        totalGapVsPriorTariffAtActualUsage: {
          note: 'x',
          amount: 92.12,
          currency: 'USD',
          arithmeticNote: 'x',
        },
      },
    });
    const result = parseFixtureJson('rate-schedules', raw);
    expect(result.tariffs).toHaveLength(2);
    expect(result.tariffs[1]?.effectiveTo).toBeNull();
  });

  it('parses valid response-options content', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-energy-guardian',
      options: [
        {
          optionId: 'monitor-one-cycle',
          label: 'x',
          description: 'x',
          roughCost: { amount: 0, currency: 'USD' },
          roughEffortLevel: 'low',
          estimatedTimeToInsight: 'x',
          addressesRootCause: false,
          requiresConsequentialAction: false,
        },
      ],
    });
    const result = parseFixtureJson('response-options', raw);
    expect(result.options).toHaveLength(1);
  });
});

describe('parseFixtureJson (pure validation, no disk I/O) -- bids fixtures', () => {
  it('parses valid job content', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-bid-comparison',
      jobId: 'job-demo-school-plumbing-01',
      title: 'x',
      trade: 'plumbing',
      projectAddressNote: 'x',
      summary: 'x',
      requiredScopeLineItems: [{ scopeItemId: 'demo-existing', label: 'x' }],
      biddersInvited: ['bid-northgate'],
    });
    const result = parseFixtureJson('job', raw);
    expect(result.requiredScopeLineItems).toHaveLength(1);
  });

  function bidFixture(overrides: { total: number; lineItemAmounts: number[] }): string {
    return JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-bid-comparison',
      bidId: 'bid-northgate',
      jobId: 'job-demo-school-plumbing-01',
      contractorName: 'x',
      licenseNumber: 'PL-0000-XX',
      total: { amount: overrides.total, currency: 'USD' },
      lineItems: overrides.lineItemAmounts.map((amount, index) => ({
        scopeItemId: `scope-item-${index}`,
        label: 'x',
        amount: { amount, currency: 'USD' },
      })),
      depositPercent: 25,
      warranty: { present: true, termMonths: 24, statedInWriting: true },
      startInWeeks: 3,
      durationWorkingDays: 9,
      allowances: [],
    });
  }

  it('parses a valid bid whose line items sum exactly to its total', () => {
    const raw = bidFixture({ total: 300, lineItemAmounts: [100, 200] });
    const result = parseFixtureJson('bid-northgate', raw);
    expect(result.total.amount).toBe(300);
  });

  it('rejects a bid whose line items do not sum to its stated total', () => {
    const raw = bidFixture({ total: 300, lineItemAmounts: [100, 150] });
    expect(() => parseFixtureJson('bid-northgate', raw)).toThrow(
      /line items sum to 250 but total.amount is 300/,
    );
  });

  it('accepts a bid warranty that is present with no stated term (null termMonths)', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      caseId: 'case-demo-bid-comparison',
      bidId: 'bid-cedar',
      jobId: 'job-demo-school-plumbing-01',
      contractorName: 'x',
      licenseNumber: 'PL-0000-XX',
      total: { amount: 100, currency: 'USD' },
      lineItems: [
        { scopeItemId: 'demo-existing', label: 'x', amount: { amount: 100, currency: 'USD' } },
      ],
      depositPercent: 45,
      warranty: { present: true, termMonths: null, statedInWriting: false },
      startInWeeks: 1,
      durationWorkingDays: 7,
      allowances: [],
    });
    const result = parseFixtureJson('bid-cedar', raw);
    expect(result.warranty.termMonths).toBeNull();
  });

  it('parses valid license-registry content, including a named-insured mismatch', () => {
    const raw = JSON.stringify({
      _provenance: 'fictional',
      entries: [
        {
          licenseNumber: 'PL-8801-TR',
          licenseHolderName: 'Two Rivers Mechanical Inc',
          status: 'active',
          classCoversScope: true,
          class: 'x',
          insurance: {
            status: 'active',
            namedInsured: 'TRM Holdings LLC',
            matchesLicenseHolder: false,
            policyNumberFictional: 'GL-INS-0003-TR',
          },
        },
      ],
    });
    const result = parseFixtureJson('license-registry', raw);
    expect(result.entries[0]?.insurance.matchesLicenseHolder).toBe(false);
  });
});

describe('loadFixture (disk I/O + caching)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sift-fixture-loader-'));
  });

  afterEach(() => {
    clearFixtureCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeValidCandidateListings(dir: string): void {
    writeFileSync(
      join(dir, 'candidate-listings.json'),
      JSON.stringify({
        _provenance: 'fictional',
        caseId: 'case-demo-car-purchase',
        candidates: [],
      }),
    );
  }

  it('loads and validates the real, checked-in car-purchase fixtures from disk', () => {
    const listings = loadFixture('candidate-listings');
    expect(listings.candidates.map((candidate) => candidate.candidateId).sort()).toEqual([
      'candidate-crv',
      'candidate-cx5',
      'candidate-outback',
      'candidate-rav4',
    ]);

    const offers = loadFixture('dealer-offers');
    expect(offers.offers).toHaveLength(4);
    // listing-reader.ts's list-all path relies on every listing having a
    // matching offer (and vice versa) without a defensive runtime check;
    // this is the assertion that backs that judgment call.
    expect(offers.offers.map((offer) => offer.candidateId).sort()).toEqual(
      listings.candidates.map((candidate) => candidate.candidateId).sort(),
    );

    const ownership = loadFixture('ownership-assumptions');
    expect(Object.keys(ownership.perCandidate).sort()).toEqual([
      'candidate-crv',
      'candidate-cx5',
      'candidate-outback',
      'candidate-rav4',
    ]);

    const safety = loadFixture('safety-reliability-sources');
    expect(safety.sources.length).toBeGreaterThan(0);
    expect(safety.disagreements).toHaveLength(1);

    const fit = loadFixture('household-fit');
    expect(Object.keys(fit.candidates).sort()).toEqual([
      'candidate-crv',
      'candidate-cx5',
      'candidate-outback',
      'candidate-rav4',
    ]);

    const profile = loadFixture('household-profile');
    expect(profile.householdId).toBe('household-demo-car-01');
  });

  it('loads and validates the real, checked-in energy fixtures from disk, from their own energy directory', () => {
    const bill = loadFixture('current-bill');
    expect(bill.householdId).toBe('household-demo-energy-01');
    expect(bill.anomaly.percentAboveBaseline).toBe(42);

    // The second, within-threshold bill feed (bill-feed-gate.ts's "no case
    // opened" fixture) -- same household/account, a different, ordinary
    // billing cycle. Registered under its own fixture name rather than
    // ever overwriting current-bill.json, which the anomalous demo path
    // and its baselines depend on unchanged.
    const normalBill = loadFixture('current-bill-normal');
    expect(normalBill.householdId).toBe('household-demo-energy-01');
    expect(normalBill.anomaly.percentAboveBaseline).toBeLessThan(15);

    const usage = loadFixture('usage-history');
    expect(usage.cycles).toHaveLength(18);
    // Final cycle matches current-bill.json exactly (fixture note).
    expect(usage.cycles.at(-1)?.usageKwh).toBe(bill.usage.value);
    expect(usage.cycles.at(-1)?.billedAmount.amount).toBe(bill.currentAmount.amount);

    const weather = loadFixture('weather-history');
    expect(weather.cycles).toHaveLength(18);
    expect(weather.cycles.at(-1)?.weatherAttribution?.usageExplainedByWeatherKwh).toBe(210);

    const events = loadFixture('household-events');
    expect(events.events.map((event) => event.eventId).sort()).toEqual(
      ['event-hvac-maintenance-2026-05', 'event-thermostat-failure-2026-07'].sort(),
    );

    const rates = loadFixture('rate-schedules');
    expect(rates.tariffs.map((tariff) => tariff.tariffId).sort()).toEqual(
      ['tariff-standard-2024', 'tariff-standard-2026'].sort(),
    );
    // current-bill.json's tariffId must resolve to a tariff this fixture
    // actually declares -- the join `tariff-lookup.ts` and `energy-
    // calculator.ts` both rely on.
    expect(rates.tariffs.map((tariff) => tariff.tariffId)).toContain(bill.tariffId);

    const options = loadFixture('response-options');
    expect(options.options.map((option) => option.optionId).sort()).toEqual(
      [
        'monitor-one-cycle',
        'change-rate-plan',
        'request-energy-audit',
        'request-hvac-inspection',
      ].sort(),
    );
  });

  it('loads and validates the real, checked-in bids fixtures from disk, from their own bids directory', () => {
    const job = loadFixture('job');
    expect(job.jobId).toBe('job-demo-school-plumbing-01');
    expect(job.requiredScopeLineItems.map((item) => item.scopeItemId).sort()).toEqual(
      [
        'demo-existing',
        'rough-in-supply',
        'rough-in-drain',
        'shower-valve-rough-in',
        'fixture-set-install',
        'permits-inspections',
        'debris-haul-away',
        'final-test',
      ].sort(),
    );

    const northgate = loadFixture('bid-northgate');
    expect(northgate.contractorName).toBe('Northgate Plumbing');
    expect(northgate.total.amount).toBe(276000);
    // Every required scope item is priced -- Northgate is the "complete
    // bid" reference the case's price-verification obligation compares
    // Cedar's silence against.
    expect(northgate.lineItems.map((item) => item.scopeItemId).sort()).toEqual(
      job.requiredScopeLineItems.map((item) => item.scopeItemId).sort(),
    );

    const cedar = loadFixture('bid-cedar');
    expect(cedar.contractorName).toBe('Cedar & Sons');
    expect(cedar.total.amount).toBe(223500);
    // Cedar is silent on exactly these three items -- absent, not marked
    // excluded -- which is the entire evidence question this case exists
    // to surface (docs/bid-comparison/plan.md).
    const cedarScopeItemIds = new Set(cedar.lineItems.map((item) => item.scopeItemId));
    for (const missing of ['permits-inspections', 'shower-valve-rough-in', 'debris-haul-away']) {
      expect(cedarScopeItemIds.has(missing)).toBe(false);
    }
    expect(cedar.warranty.termMonths).toBeNull();
    expect(cedar.depositPercent).toBe(45);

    const tworivers = loadFixture('bid-tworivers');
    expect(tworivers.contractorName).toBe('Two Rivers Mechanical');
    expect(tworivers.total.amount).toBe(288750);
    expect(tworivers.lineItems.map((item) => item.scopeItemId).sort()).toEqual(
      job.requiredScopeLineItems.map((item) => item.scopeItemId).sort(),
    );

    // Every bid's line items sum exactly to its own stated total, including
    // the nine also-ran bids that scale this case to a realistic
    // twelve-bidder public bid tab. The schema's superRefine already
    // enforces this at load time (so a mismatch would have thrown before
    // this line ever ran), but this assertion additionally proves it
    // against the real, checked-in fixture content on disk rather than only
    // against inline test fixtures.
    const others = [
      'bid-summit',
      'bid-ironclad',
      'bid-parkside',
      'bid-westbrook',
      'bid-anchor',
      'bid-crestview',
      'bid-fieldstone',
      'bid-brightwater',
      'bid-oldmill',
    ] as const;
    for (const bidId of others) {
      const bid = loadFixture(bidId);
      expect(bid.jobId).toBe(job.jobId);
    }
    for (const bid of [northgate, cedar, tworivers, ...others.map((id) => loadFixture(id))]) {
      const lineItemSum = bid.lineItems.reduce((sum, item) => sum + item.amount.amount, 0);
      expect(lineItemSum).toBe(bid.total.amount);
    }
    expect(job.biddersInvited.sort()).toEqual(
      ['bid-northgate', 'bid-cedar', 'bid-tworivers', ...others].sort(),
    );

    const registry = loadFixture('license-registry');
    expect(registry.entries.map((entry) => entry.licenseNumber).sort()).toEqual(
      [
        'PL-4417-NG',
        'PL-2290-CS',
        'PL-8801-TR',
        'PL-3312-SM',
        'PL-5567-IC',
        'PL-2245-PK',
        'PL-6690-WB',
        'PL-1183-AP',
        'PL-4429-CV',
        'PL-7734-FS',
        'PL-9021-BW',
        'PL-3356-OM',
      ].sort(),
    );
    const northgateEntry = registry.entries.find((entry) => entry.licenseNumber === 'PL-4417-NG');
    const cedarEntry = registry.entries.find((entry) => entry.licenseNumber === 'PL-2290-CS');
    const tworiversEntry = registry.entries.find((entry) => entry.licenseNumber === 'PL-8801-TR');
    expect(northgateEntry?.insurance.matchesLicenseHolder).toBe(true);
    expect(cedarEntry?.insurance.matchesLicenseHolder).toBe(true);
    // The real, checkable credential discrepancy the case's
    // credential_verification obligation exists to catch: Two Rivers'
    // licence holder and its certificate of insurance's named insured
    // disagree.
    expect(tworiversEntry?.insurance.matchesLicenseHolder).toBe(false);
    expect(tworiversEntry?.licenseHolderName).toBe('Two Rivers Mechanical Inc');
    expect(tworiversEntry?.insurance.namedInsured).toBe('TRM Holdings LLC');
  });

  it('caches by fixture name: repeated calls return the identical object reference', () => {
    const first = loadFixture('candidate-listings');
    const second = loadFixture('candidate-listings');
    expect(second).toBe(first);
  });

  it('caches independently per baseDir so tests using a temp directory never collide with the real fixtures', () => {
    writeValidCandidateListings(tempDir);
    const real = loadFixture('candidate-listings');
    const fromTemp = loadFixture('candidate-listings', { baseDir: tempDir });
    expect(fromTemp).not.toBe(real);
    expect(fromTemp.candidates).toEqual([]);
  });

  it('clearFixtureCache forces a fresh read/parse producing a new object reference', () => {
    writeValidCandidateListings(tempDir);
    const first = loadFixture('candidate-listings', { baseDir: tempDir });
    clearFixtureCache();
    const second = loadFixture('candidate-listings', { baseDir: tempDir });
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('throws a descriptive error when the fixture file does not exist on disk', () => {
    expect(() => loadFixture('candidate-listings', { baseDir: tempDir })).toThrow(/failed to read/);
  });

  it('propagates a schema validation failure for a malformed fixture file on disk', () => {
    writeFileSync(join(tempDir, 'candidate-listings.json'), JSON.stringify({ bogus: true }));
    expect(() => loadFixture('candidate-listings', { baseDir: tempDir })).toThrow(
      /schema validation/,
    );
  });

  it('propagates malformed JSON on disk as a descriptive error', () => {
    writeFileSync(join(tempDir, 'candidate-listings.json'), '{not json');
    expect(() => loadFixture('candidate-listings', { baseDir: tempDir })).toThrow(/not valid JSON/);
  });
});
