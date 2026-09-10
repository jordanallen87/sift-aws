/**
 * Internal loader for the fixture JSON files under
 * `packages/scenarios/fixtures/car-purchase/` (Choose Our Next Car),
 * `packages/scenarios/fixtures/energy/` (Home Energy Guardian), and
 * `packages/scenarios/fixtures/bids/` (bid comparison).
 *
 * Filesystem access is scoped to `packages/scenarios` deliberately --
 * `packages/core` may never read the filesystem (architecture.md
 * "Repository structure": "No file in `packages/core` may import ...
 * filesystem storage"). This package is exactly where fixture-backed tools
 * are meant to live (architecture.md: "packages/scenarios/ Fixture data,
 * scripted tools, scenario runner, and assertions").
 *
 * Every fixture file is Zod-validated end to end (architecture.md "Tool
 * inputs, outputs, model responses, and persisted snapshots are size-bounded
 * and schema-validated") and defensively size-bounded before `JSON.parse`
 * ever runs, so a corrupted or runaway fixture file fails loudly and early
 * instead of silently propagating bad data into a tool's evidence output.
 *
 * `parseFixtureJson` is a pure function over a raw string -- no disk I/O --
 * so every validation branch (oversized, malformed JSON, schema-invalid,
 * unregistered fixture name) is unit-testable directly, without needing to
 * fabricate real files on disk. `loadFixture` is the thin disk-reading +
 * in-memory-cache wrapper real tool code calls; it accepts an optional
 * `baseDir` override purely so tests can exercise its disk-read failure
 * paths (missing file, malformed content) against a temporary directory
 * without ever touching the checked-in fixtures. Every registered fixture
 * name maps to exactly one pack's fixtures directory (`FIXTURE_PACK_DIR`
 * below), resolved automatically unless a test overrides `baseDir`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `src/tools/fixture-loader.ts` -> `../../fixtures/<pack>`.
const CAR_PURCHASE_FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'car-purchase');
const ENERGY_FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'energy');
const BIDS_FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'bids');

/**
 * Defensive upper bound on a single fixture file's byte size
 * (architecture.md "Tool inputs, outputs, model responses, and persisted
 * snapshots are size-bounded"). Every real car-purchase fixture is under
 * 10 KB; 2 MB is generous headroom for future fixture growth while still
 * refusing to `JSON.parse` an unbounded or runaway file.
 */
export const MAX_FIXTURE_BYTES = 2_000_000;

const MoneyAmountSchema = z
  .object({
    amount: z.number().finite(),
    currency: z.string().min(1).max(10),
  })
  .strict();

// --- candidate-listings.json ---

const CandidateListingSchema = z
  .object({
    candidateId: z.string().min(1),
    make: z.string().min(1),
    model: z.string().min(1),
    modelYear: z.number().int(),
    trim: z.string().min(1),
    bodyStyle: z.string().min(1),
    drivetrain: z.string().min(1),
    powertrain: z.string().min(1),
    advertisedPrice: MoneyAmountSchema,
    mileage: z.object({ value: z.number().finite(), unit: z.string().min(1) }).strict(),
    exteriorColor: z.string().min(1),
    vin: z.string().min(1),
    listingSourceUrl: z.url(),
    listingId: z.string().min(1),
    dealerName: z.string().min(1),
    listedAt: z.iso.date(),
    standardFeatures: z.array(z.string().min(1)).max(50),
  })
  .strict();

export const CandidateListingsSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    candidates: z.array(CandidateListingSchema).max(50),
  })
  .strict();
export type CandidateListings = z.infer<typeof CandidateListingsSchema>;
export type CandidateListing = z.infer<typeof CandidateListingSchema>;

// --- dealer-offers.json ---

const MandatoryAddOnSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    amount: z.number().finite(),
    currency: z.string().min(1).max(10),
    mandatory: z.boolean(),
    note: z.string().optional(),
  })
  .strict();

const FinancingExampleSchema = z
  .object({
    description: z.string().optional(),
    apr: z.number().finite(),
    termMonths: z.number().int().positive(),
    note: z.string().optional(),
  })
  .strict();

const PriceBreakdownSchema = z
  .object({
    advertisedPrice: z.number().finite(),
    mandatoryAddOnsTotal: z.number().finite(),
    subtotalBeforeTax: z.number().finite(),
    taxableBase: z.number().finite(),
    salesTax: z.number().finite(),
    titleAndRegistrationFee: z.number().finite(),
    trueOutTheDoorPrice: z.number().finite(),
    arithmeticNote: z.string().optional(),
  })
  .strict();

const TeaserGapSchema = z
  .object({
    advertisedPrice: z.number().finite(),
    trueOutTheDoorPrice: z.number().finite(),
    gapAmount: z.number().finite(),
    gapPercentOfAdvertised: z.number().finite(),
    arithmeticNote: z.string().optional(),
    exceedsHouseholdMaxBudget: z.boolean(),
    householdMaxBudget: z.number().finite(),
    amountOverBudget: z.number().finite().optional(),
    note: z.string().optional(),
  })
  .strict();

const MonthlyPaymentEstimateSchema = z
  .object({ amount: z.number().finite(), currency: z.string().min(1).max(10), basis: z.string() })
  .strict();

const DealerOfferSchema = z
  .object({
    candidateId: z.string().min(1),
    dealerName: z.string().min(1),
    quotedAt: z.iso.date(),
    hasTeaserPriceConflict: z.boolean(),
    advertisedPrice: MoneyAmountSchema,
    advertisedFinancingExample: FinancingExampleSchema,
    mandatoryAddOns: z.array(MandatoryAddOnSchema).max(50),
    actualFinancingOffer: FinancingExampleSchema,
    priceBreakdown: PriceBreakdownSchema,
    teaserGap: TeaserGapSchema,
    downPaymentAssumed: MoneyAmountSchema,
    amountFinanced: z.number().finite(),
    estimatedMonthlyPayment: z
      .object({
        underAdvertisedTerms: MonthlyPaymentEstimateSchema.optional(),
        underActualOfferedTerms: MonthlyPaymentEstimateSchema,
        note: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const DealerOffersSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    sharedTaxAndFeeAssumptions: z
      .object({
        salesTaxRate: z.number().finite(),
        salesTaxBasis: z.string(),
        titleAndRegistrationFee: MoneyAmountSchema,
      })
      .strict(),
    offers: z.array(DealerOfferSchema).max(50),
  })
  .strict();
export type DealerOffers = z.infer<typeof DealerOffersSchema>;
export type DealerOffer = z.infer<typeof DealerOfferSchema>;

// --- ownership-assumptions.json ---

const CostWithArithmeticNoteSchema = z
  .object({
    amount: z.number().finite(),
    currency: z.string().min(1).max(10),
    arithmeticNote: z.string().optional(),
  })
  .strict();

const PowertrainClassSchema = z.enum(['gasoline', 'hybrid']);

const PerCandidateOwnershipSchema = z
  .object({
    fuelEconomyMpg: z
      .object({
        city: z.number().finite().positive(),
        highway: z.number().finite().positive(),
        combined: z.number().finite().positive(),
      })
      .strict(),
    powertrainClassForMaintenance: PowertrainClassSchema,
    annualInsurancePremium: MoneyAmountSchema,
    fiveYearRetainedValuePercent: z.number().finite().min(0).max(100),
    estimatedFiveYearFuelCost: CostWithArithmeticNoteSchema,
    estimatedFiveYearMaintenanceCost: CostWithArithmeticNoteSchema,
  })
  .strict();

export const OwnershipAssumptionsSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    sharedAssumptions: z
      .object({
        note: z.string().optional(),
        ownershipHorizonYears: z.number().int().positive(),
        annualMileageMi: z.number().finite().positive(),
        fuel: z
          .object({
            regularUnleadedPricePerGallon: MoneyAmountSchema,
            priceSource: z.string().optional(),
          })
          .strict(),
        insurance: z
          .object({
            coverageProfile: z.string(),
            driverProfile: z.string(),
            note: z.string().optional(),
          })
          .strict(),
        maintenance: z
          .object({
            gasolinePowertrainCostPerMi: MoneyAmountSchema,
            hybridPowertrainCostPerMi: MoneyAmountSchema,
            note: z.string().optional(),
          })
          .strict(),
        depreciation: z.object({ methodology: z.string(), note: z.string().optional() }).strict(),
        financingBaseline: z
          .object({
            note: z.string().optional(),
            apr: z.number().finite(),
            termMonths: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    perCandidate: z.record(z.string(), PerCandidateOwnershipSchema),
  })
  .strict();
export type OwnershipAssumptions = z.infer<typeof OwnershipAssumptionsSchema>;
export type PerCandidateOwnership = z.infer<typeof PerCandidateOwnershipSchema>;

// --- safety-reliability-sources.json ---

const SafetySourceSchema = z
  .object({
    sourceId: z.string().min(1),
    publisherName: z.string().min(1),
    reportTitle: z.string().min(1),
    url: z.url(),
    retrievedAt: z.iso.date(),
    publishedAt: z.iso.date(),
    methodologyNote: z.string().optional(),
  })
  .strict();

const SafetyFindingSchema = z
  .object({
    candidateId: z.string().min(1),
    sourceId: z.string().min(1),
    category: z.string().min(1),
    rating: z.string().min(1),
    // Required, not optional: every finding in the real fixture carries a
    // `notes` string, so this schema is tightened to match observed reality
    // rather than modeling a possibility the fixture never actually uses --
    // see safety-reliability-lookup.ts, which relies on this to avoid an
    // otherwise-untestable "no notes" branch.
    notes: z.string().min(1),
  })
  .strict();

const SafetyDisagreementSchema = z
  .object({
    candidateId: z.string().min(1),
    category: z.string().min(1),
    sourceIdA: z.string().min(1),
    ratingA: z.string().min(1),
    sourceIdB: z.string().min(1),
    ratingB: z.string().min(1),
    natureOfConflict: z.string().min(1),
    requiresSourceChallengeReview: z.boolean(),
  })
  .strict();

const SafetyReliabilitySourcesShape = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    sources: z.array(SafetySourceSchema).max(100),
    findings: z.array(SafetyFindingSchema).max(500),
    disagreements: z.array(SafetyDisagreementSchema).max(100),
  })
  .strict();

/**
 * Referential integrity beyond individual-record shape: every `sourceId`
 * a finding or disagreement cites must name a source actually declared in
 * `sources`. Enforcing this here -- once, at load time -- means every
 * consumer (`safety-reliability-lookup.ts`) can trust the join and never
 * needs its own defensive "what if this sourceId doesn't exist" branch.
 */
export const SafetyReliabilitySourcesSchema = SafetyReliabilitySourcesShape.superRefine(
  (fixture, ctx) => {
    const knownSourceIds = new Set(fixture.sources.map((source) => source.sourceId));
    fixture.findings.forEach((finding, index) => {
      if (!knownSourceIds.has(finding.sourceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['findings', index, 'sourceId'],
          message: `finding references unknown sourceId "${finding.sourceId}"`,
        });
      }
    });
    fixture.disagreements.forEach((disagreement, index) => {
      for (const key of ['sourceIdA', 'sourceIdB'] as const) {
        if (!knownSourceIds.has(disagreement[key])) {
          ctx.addIssue({
            code: 'custom',
            path: ['disagreements', index, key],
            message: `disagreement references unknown ${key} "${disagreement[key]}"`,
          });
        }
      }
    });
  },
);
export type SafetyReliabilitySources = z.infer<typeof SafetyReliabilitySourcesSchema>;
export type SafetySource = z.infer<typeof SafetySourceSchema>;
export type SafetyFinding = z.infer<typeof SafetyFindingSchema>;
export type SafetyDisagreement = z.infer<typeof SafetyDisagreementSchema>;

// --- household-fit.json ---

const CrateDimensionsSchema = z
  .object({
    lengthIn: z.number().positive(),
    widthIn: z.number().positive(),
    heightIn: z.number().positive(),
  })
  .strict();

const ExplicitUnknownSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    status: z.literal('unknown'),
    reason: z.string().min(1),
    resolutionPath: z.string().min(1),
  })
  .strict();

const HouseholdFitCandidateSchema = z
  .object({
    knownSpecifications: z
      .object({
        source: z.string(),
        cargoWidthBetweenWheelWellsIn: z.number().positive(),
        cargoLengthSeatToLiftgateIn: z.number().positive(),
        cargoHeightFloorToCeilingIn: z.number().positive(),
        rearDoorOpeningWidthIn: z.number().positive(),
        secondRowLegroomIn: z.number().positive(),
        cargoVolumeBehindSecondRowCuFt: z.number().positive(),
        groundClearanceIn: z.number().positive(),
      })
      .strict(),
    explicitUnknowns: z.array(ExplicitUnknownSchema).max(50),
  })
  .strict();

export const HouseholdFitSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    householdDogCrateProfile: z
      .object({
        note: z.string().optional(),
        crateCount: z.number().int().nonnegative(),
        eachCrateDimensionsIn: CrateDimensionsSchema,
      })
      .strict(),
    candidates: z.record(z.string(), HouseholdFitCandidateSchema),
  })
  .strict();
export type HouseholdFit = z.infer<typeof HouseholdFitSchema>;
export type HouseholdFitCandidate = z.infer<typeof HouseholdFitCandidateSchema>;
export type ExplicitUnknown = z.infer<typeof ExplicitUnknownSchema>;

// --- household-profile.json ---

export const HouseholdProfileSchema = z
  .object({
    _provenance: z.string(),
    householdId: z.string().min(1),
    displayName: z.string().min(1),
    caseId: z.string().min(1),
    members: z
      .object({
        adults: z.number().int().nonnegative(),
        children: z.number().int().nonnegative(),
        childCarSeatDetails: z
          .object({
            seatsRequired: z.number().int().nonnegative(),
            seatTypes: z.array(z.string()).max(10),
            isofixOrLatchAnchorsRequired: z.number().int().nonnegative(),
          })
          .strict(),
        dogs: z.number().int().nonnegative(),
        dogProfile: z
          .object({
            breedSizeClass: z.string(),
            combinedApproximateWeightLb: z.number().positive(),
            crateCount: z.number().int().nonnegative(),
            crateDimensionsIn: z
              .object({ eachCrate: CrateDimensionsSchema, note: z.string().optional() })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    budget: z
      .object({
        maxOutTheDoorPrice: MoneyAmountSchema,
        preferredMonthlyPayment: z
          .object({
            amount: z.number().finite(),
            currency: z.string().min(1).max(10),
            cadence: z.string(),
          })
          .strict(),
        downPayment: MoneyAmountSchema,
      })
      .strict(),
    financingAssumptions: z
      .object({
        targetApr: z.number().finite(),
        targetTermMonths: z.number().int().positive(),
        creditTier: z.string(),
        note: z.string().optional(),
      })
      .strict(),
    commute: z
      .object({
        roundTripMilesPerDay: z.number().finite().nonnegative(),
        drivingMixProfile: z.string(),
        annualMileageEstimateMi: z.number().finite().positive(),
        primaryDriver: z.string(),
        secondaryDriver: z.string(),
      })
      .strict(),
    cargoAndRearSeatNeeds: z
      .object({
        rearSeatOccupantsTypical: z.string(),
        cargoUseCase: z.string(),
        cargoUseCaseResolved: z.boolean(),
        note: z.string().optional(),
      })
      .strict(),
    mustHaves: z
      .array(
        z.object({ id: z.string().min(1), label: z.string().min(1), kind: z.string() }).strict(),
      )
      .max(50),
    weightedPreferences: z
      .object({
        note: z.string().optional(),
        criteria: z
          .array(
            z
              .object({
                id: z.string().min(1),
                label: z.string().min(1),
                weight: z.number().min(0).max(1),
                direction: z.string(),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    _scenarioNotes: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type HouseholdProfile = z.infer<typeof HouseholdProfileSchema>;

// --- current-bill.json (Home Energy Guardian) ---

export const CurrentBillSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    householdId: z.string().min(1),
    displayName: z.string().min(1),
    utilityAccountFictionalId: z.string().min(1),
    billingPeriod: z
      .object({ start: z.iso.date(), end: z.iso.date(), days: z.number().int().positive() })
      .strict(),
    tariffId: z.string().min(1),
    usage: z.object({ value: z.number().finite(), unit: z.string().min(1) }).strict(),
    charges: z
      .object({
        fixedMonthlyCustomerCharge: MoneyAmountSchema,
        volumetricCharge: CostWithArithmeticNoteSchema,
        totalAmount: CostWithArithmeticNoteSchema,
      })
      .strict(),
    currentAmount: MoneyAmountSchema,
    baseline: z
      .object({
        amount: MoneyAmountSchema,
        usage: z.object({ value: z.number().finite(), unit: z.string().min(1) }).strict(),
        methodology: z.string().min(1),
        computedBy: z.string().min(1),
      })
      .strict(),
    anomaly: z
      .object({
        percentAboveBaseline: z.number().finite(),
        arithmeticNote: z.string().min(1),
        usageGapAboveBaselineKwh: z.number().finite(),
        usageGapArithmeticNote: z.string().min(1),
        flaggedAt: z.iso.datetime(),
        flaggedBy: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type CurrentBill = z.infer<typeof CurrentBillSchema>;

// --- usage-history.json ---

const UsageCycleSchema = z
  .object({
    cycleLabel: z.string().min(1),
    billingPeriod: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
    usageKwh: z.number().finite().nonnegative(),
    tariffId: z.string().min(1),
    billedAmount: MoneyAmountSchema,
    arithmeticNote: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

export const UsageHistorySchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    householdId: z.string().min(1),
    note: z.string().optional(),
    cycles: z.array(UsageCycleSchema).max(200),
  })
  .strict();
export type UsageHistory = z.infer<typeof UsageHistorySchema>;
export type UsageCycle = z.infer<typeof UsageCycleSchema>;

// --- weather-history.json ---

const WeatherAttributionSchema = z
  .object({
    typicalCdd: z.number().finite(),
    actualCdd: z.number().finite(),
    excessCdd: z.number().finite(),
    weatherSensitivityKwhPerCdd: z.number().finite(),
    weatherSensitivityMethodology: z.string().min(1),
    usageExplainedByWeatherKwh: z.number().finite(),
    arithmeticNote: z.string().min(1),
    conclusion: z.string().min(1),
  })
  .strict();

const WeatherCycleSchema = z
  .object({
    cycleLabel: z.string().min(1),
    billingPeriod: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
    hdd: z.number().finite().nonnegative(),
    cdd: z.number().finite().nonnegative(),
    note: z.string().optional(),
    weatherAttribution: WeatherAttributionSchema.optional(),
  })
  .strict();

export const WeatherHistorySchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    weatherStation: z
      .object({
        stationId: z.string().min(1),
        name: z.string().min(1),
        degreeDayBaseF: z.number().finite(),
      })
      .strict(),
    note: z.string().optional(),
    cycles: z.array(WeatherCycleSchema).max(200),
  })
  .strict();
export type WeatherHistory = z.infer<typeof WeatherHistorySchema>;
export type WeatherCycle = z.infer<typeof WeatherCycleSchema>;
export type WeatherAttribution = z.infer<typeof WeatherAttributionSchema>;

// --- household-events.json ---

const HouseholdEventDeviceSchema = z
  .object({
    make: z.string().min(1),
    model: z.string().min(1),
    deviceIdFictional: z.string().min(1),
  })
  .strict();

const HouseholdEventSchema = z
  .object({
    eventId: z.string().min(1),
    type: z.string().min(1),
    date: z.iso.date(),
    label: z.string().min(1),
    description: z.string().min(1),
    performedBy: z.string().optional(),
    workOrderId: z.string().optional(),
    outcome: z.string().optional(),
    relevanceNote: z.string().min(1),
    device: HouseholdEventDeviceSchema.optional(),
    detectionMethod: z.string().optional(),
    status: z.string().optional(),
  })
  .strict();

export const HouseholdEventsSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    householdId: z.string().min(1),
    events: z.array(HouseholdEventSchema).max(200),
  })
  .strict();
export type HouseholdEvents = z.infer<typeof HouseholdEventsSchema>;
export type HouseholdEvent = z.infer<typeof HouseholdEventSchema>;

// --- rate-schedules.json ---

const TariffChangeSchema = z
  .object({
    fixedChargeIncrease: MoneyAmountSchema,
    fixedChargeIncreasePercent: z.number().finite(),
    volumetricRateIncrease: MoneyAmountSchema,
    volumetricRateIncreasePercent: z.number().finite(),
    arithmeticNote: z.string().min(1),
  })
  .strict();

const TariffSchema = z
  .object({
    tariffId: z.string().min(1),
    label: z.string().min(1),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    fixedMonthlyCustomerCharge: MoneyAmountSchema,
    volumetricRatePerKwh: MoneyAmountSchema,
    rateStructure: z.string().min(1),
    changeFromPriorTariff: TariffChangeSchema.optional(),
    regulatoryFilingReference: z.string().optional(),
  })
  .strict();

const RateChangeImpactSchema = z
  .object({
    note: z.string().min(1),
    baselineUsageKwh: z.number().finite(),
    billUnderPriorTariffAtBaselineUsage: CostWithArithmeticNoteSchema,
    billUnderCurrentTariffAtBaselineUsage: CostWithArithmeticNoteSchema,
    rateChangeAttributableAmount: CostWithArithmeticNoteSchema,
    rateChangeAttributablePercentOfTotalGap: z.number().finite(),
    totalGapVsPriorTariffAtActualUsage: z
      .object({
        note: z.string().min(1),
        amount: z.number().finite(),
        currency: z.string().min(1).max(10),
        arithmeticNote: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const RateSchedulesSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    utilityName: z.string().min(1),
    serviceAddressNote: z.string().optional(),
    tariffs: z.array(TariffSchema).max(50),
    rateChangeImpactOnBaselineUsage: RateChangeImpactSchema,
  })
  .strict();
export type RateSchedules = z.infer<typeof RateSchedulesSchema>;
export type Tariff = z.infer<typeof TariffSchema>;

// --- response-options.json ---

const ResponseOptionSchema = z
  .object({
    optionId: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    roughCost: MoneyAmountSchema,
    roughEffortLevel: z.string().min(1),
    estimatedTimeToInsight: z.string().min(1),
    addressesRootCause: z.boolean(),
    requiresConsequentialAction: z.boolean(),
    consequentialActionNote: z.string().optional(),
  })
  .strict();

export const ResponseOptionsSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    options: z.array(ResponseOptionSchema).max(50),
  })
  .strict();
export type ResponseOptions = z.infer<typeof ResponseOptionsSchema>;
export type ResponseOption = z.infer<typeof ResponseOptionSchema>;

// --- job.json (bid comparison) ---

const ScopeLineItemDefinitionSchema = z
  .object({
    scopeItemId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

export const BidJobSchema = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    jobId: z.string().min(1),
    title: z.string().min(1),
    trade: z.string().min(1),
    projectAddressNote: z.string().min(1),
    summary: z.string().min(1),
    requiredScopeLineItems: z.array(ScopeLineItemDefinitionSchema).min(1).max(50),
    biddersInvited: z.array(z.string().min(1)).max(20),
    note: z.string().optional(),
  })
  .strict();
export type BidJob = z.infer<typeof BidJobSchema>;
export type ScopeLineItemDefinition = z.infer<typeof ScopeLineItemDefinitionSchema>;

// --- bid-northgate.json / bid-cedar.json / bid-tworivers.json (bid comparison) ---

const BidLineItemSchema = z
  .object({
    scopeItemId: z.string().min(1),
    label: z.string().min(1),
    amount: MoneyAmountSchema,
  })
  .strict();

const BidAllowanceSchema = z
  .object({
    id: z.string().min(1),
    scopeItemId: z.string().min(1).optional(),
    label: z.string().min(1),
    amount: MoneyAmountSchema,
    note: z.string().optional(),
  })
  .strict();

const BidWarrantySchema = z
  .object({
    present: z.boolean(),
    termMonths: z.number().int().positive().nullable(),
    statedInWriting: z.boolean(),
    note: z.string().optional(),
  })
  .strict();

const BidShape = z
  .object({
    _provenance: z.string(),
    caseId: z.string().min(1),
    bidId: z.string().min(1),
    jobId: z.string().min(1),
    contractorName: z.string().min(1),
    licenseNumber: z.string().min(1),
    total: MoneyAmountSchema,
    lineItems: z.array(BidLineItemSchema).min(1).max(20),
    depositPercent: z.number().finite().min(0).max(100),
    warranty: BidWarrantySchema,
    startInWeeks: z.number().finite().positive(),
    durationWorkingDays: z.number().int().positive(),
    allowances: z.array(BidAllowanceSchema).max(20),
  })
  .strict();

/**
 * Line items must sum exactly to the stated total -- this is obligation
 * `bid.price_verification` from the bid-comparison build plan
 * (docs/bid-comparison/plan.md), enforced once at load time (the same
 * "join checked here, not by every consumer" judgment call as
 * `SafetyReliabilitySourcesSchema`'s sourceId cross-check above) so no
 * bid-reading tool needs its own defensive re-addition of a bid's own line
 * items before trusting its total.
 */
export const BidSchema = BidShape.superRefine((bid, ctx) => {
  const lineItemSum = bid.lineItems.reduce((sum, item) => sum + item.amount.amount, 0);
  const roundedSum = Math.round(lineItemSum * 100) / 100;
  if (Math.abs(roundedSum - bid.total.amount) > 0.005) {
    ctx.addIssue({
      code: 'custom',
      path: ['lineItems'],
      message: `line items sum to ${roundedSum} but total.amount is ${bid.total.amount}`,
    });
  }
});
export type Bid = z.infer<typeof BidSchema>;
export type BidLineItem = z.infer<typeof BidLineItemSchema>;
export type BidAllowance = z.infer<typeof BidAllowanceSchema>;
export type BidWarranty = z.infer<typeof BidWarrantySchema>;

// --- license-registry.json (bid comparison) ---

const LicenseInsuranceSchema = z
  .object({
    status: z.string().min(1),
    namedInsured: z.string().min(1),
    matchesLicenseHolder: z.boolean(),
    policyNumberFictional: z.string().min(1),
  })
  .strict();

const LicenseRegistryEntrySchema = z
  .object({
    licenseNumber: z.string().min(1),
    licenseHolderName: z.string().min(1),
    status: z.string().min(1),
    classCoversScope: z.boolean(),
    class: z.string().min(1),
    insurance: LicenseInsuranceSchema,
    note: z.string().optional(),
  })
  .strict();

export const LicenseRegistrySchema = z
  .object({
    _provenance: z.string(),
    entries: z.array(LicenseRegistryEntrySchema).min(1).max(50),
  })
  .strict();
export type LicenseRegistry = z.infer<typeof LicenseRegistrySchema>;
export type LicenseRegistryEntry = z.infer<typeof LicenseRegistryEntrySchema>;

// --- registry, pure parsing, and disk-backed loader with in-memory cache ---

const FIXTURE_SCHEMAS = {
  'candidate-listings': CandidateListingsSchema,
  'dealer-offers': DealerOffersSchema,
  'household-fit': HouseholdFitSchema,
  'household-profile': HouseholdProfileSchema,
  'ownership-assumptions': OwnershipAssumptionsSchema,
  'safety-reliability-sources': SafetyReliabilitySourcesSchema,
  'current-bill': CurrentBillSchema,
  // The second, within-threshold bill feed `bill-feed-gate.ts` reads to
  // prove its case-creation gate declines in both directions -- same shape
  // as `current-bill` (reuses `CurrentBillSchema` unmodified), a distinct
  // fixture file so `current-bill.json` itself, and everything that reads
  // it unconditionally by name, is never touched.
  'current-bill-normal': CurrentBillSchema,
  'usage-history': UsageHistorySchema,
  'weather-history': WeatherHistorySchema,
  'household-events': HouseholdEventsSchema,
  'rate-schedules': RateSchedulesSchema,
  'response-options': ResponseOptionsSchema,
  job: BidJobSchema,
  'bid-northgate': BidSchema,
  'bid-cedar': BidSchema,
  'bid-tworivers': BidSchema,
  'bid-summit': BidSchema,
  'bid-ironclad': BidSchema,
  'bid-parkside': BidSchema,
  'bid-westbrook': BidSchema,
  'bid-anchor': BidSchema,
  'bid-crestview': BidSchema,
  'bid-fieldstone': BidSchema,
  'bid-brightwater': BidSchema,
  'bid-oldmill': BidSchema,
  'license-registry': LicenseRegistrySchema,
} as const;

export const FIXTURE_NAMES = Object.keys(FIXTURE_SCHEMAS) as FixtureName[];

/** Which pack's fixtures directory each registered fixture name resolves against, absent a `baseDir` override. */
const FIXTURE_PACK_DIR: Record<FixtureName, string> = {
  'candidate-listings': CAR_PURCHASE_FIXTURES_DIR,
  'dealer-offers': CAR_PURCHASE_FIXTURES_DIR,
  'household-fit': CAR_PURCHASE_FIXTURES_DIR,
  'household-profile': CAR_PURCHASE_FIXTURES_DIR,
  'ownership-assumptions': CAR_PURCHASE_FIXTURES_DIR,
  'safety-reliability-sources': CAR_PURCHASE_FIXTURES_DIR,
  'current-bill': ENERGY_FIXTURES_DIR,
  'current-bill-normal': ENERGY_FIXTURES_DIR,
  'usage-history': ENERGY_FIXTURES_DIR,
  'weather-history': ENERGY_FIXTURES_DIR,
  'household-events': ENERGY_FIXTURES_DIR,
  'rate-schedules': ENERGY_FIXTURES_DIR,
  'response-options': ENERGY_FIXTURES_DIR,
  job: BIDS_FIXTURES_DIR,
  'bid-northgate': BIDS_FIXTURES_DIR,
  'bid-cedar': BIDS_FIXTURES_DIR,
  'bid-tworivers': BIDS_FIXTURES_DIR,
  'bid-summit': BIDS_FIXTURES_DIR,
  'bid-ironclad': BIDS_FIXTURES_DIR,
  'bid-parkside': BIDS_FIXTURES_DIR,
  'bid-westbrook': BIDS_FIXTURES_DIR,
  'bid-anchor': BIDS_FIXTURES_DIR,
  'bid-crestview': BIDS_FIXTURES_DIR,
  'bid-fieldstone': BIDS_FIXTURES_DIR,
  'bid-brightwater': BIDS_FIXTURES_DIR,
  'bid-oldmill': BIDS_FIXTURES_DIR,
  'license-registry': BIDS_FIXTURES_DIR,
};

export type FixtureName = keyof typeof FIXTURE_SCHEMAS;
export type FixtureData<N extends FixtureName> = z.infer<(typeof FIXTURE_SCHEMAS)[N]>;

/** Raised for any fixture load/parse/validation failure. Carries the offending fixture name for callers that want structured handling. */
export class FixtureLoadError extends Error {
  readonly fixtureName: string;

  constructor(fixtureName: string, message: string) {
    super(`fixture-loader: fixture "${fixtureName}" ${message}`);
    this.name = 'FixtureLoadError';
    this.fixtureName = fixtureName;
  }
}

/**
 * Pure validation over an already-read JSON string: size bound, `JSON.parse`,
 * then Zod schema validation. No disk I/O -- every failure branch here is
 * directly unit-testable without fabricating files on disk.
 */
export function parseFixtureJson<N extends FixtureName>(name: N, raw: string): FixtureData<N> {
  const schema = (FIXTURE_SCHEMAS as Record<string, (typeof FIXTURE_SCHEMAS)[FixtureName]>)[name];
  if (!schema) {
    throw new FixtureLoadError(name, 'has no registered schema');
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_FIXTURE_BYTES) {
    throw new FixtureLoadError(name, `exceeds the ${MAX_FIXTURE_BYTES}-byte defensive size bound`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // `String(error)` (not `.message`) so this needs no `instanceof Error`
    // branch: it is informative for both a real `SyntaxError` (the only
    // thing `JSON.parse` actually throws) and, defensively, anything else.
    throw new FixtureLoadError(name, `is not valid JSON: ${String(error)}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new FixtureLoadError(name, `failed schema validation: ${result.error.message}`);
  }

  return result.data as FixtureData<N>;
}

export interface LoadFixtureOptions {
  /**
   * Overrides the directory `<name>.json` is read from. Defaults to that
   * fixture name's own pack directory (`FIXTURE_PACK_DIR`) -- the real
   * `packages/scenarios/fixtures/car-purchase` or
   * `packages/scenarios/fixtures/energy` directory. Tests use this to
   * exercise disk-read failure paths against a temporary directory without
   * ever touching the checked-in fixtures.
   */
  baseDir?: string;
}

// Cache key includes baseDir so a test-supplied directory can never collide
// with (or invalidate) the real fixtures' cached entries, and repeated calls
// with the real fixtures never re-read disk.
const cache = new Map<string, unknown>();

function cacheKey(name: FixtureName, baseDir: string): string {
  return `${baseDir} ${name}`;
}

/**
 * Loads and Zod-validates one fixture JSON file by name (from its own pack's
 * fixtures directory, per `FIXTURE_PACK_DIR`, unless `options.baseDir`
 * overrides it), caching the validated result in memory so repeated tool
 * calls in one process never re-read or re-parse the file.
 */
export function loadFixture<N extends FixtureName>(
  name: N,
  options: LoadFixtureOptions = {},
): FixtureData<N> {
  const baseDir = options.baseDir ?? FIXTURE_PACK_DIR[name];
  const key = cacheKey(name, baseDir);

  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached as FixtureData<N>;
  }

  const filePath = join(baseDir, `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new FixtureLoadError(name, `failed to read at ${filePath}: ${String(error)}`);
  }

  const data = parseFixtureJson(name, raw);
  cache.set(key, data);
  return data;
}

/** Clears every cached fixture entry. Test-only; real tool code never needs this. */
export function clearFixtureCache(): void {
  cache.clear();
}
