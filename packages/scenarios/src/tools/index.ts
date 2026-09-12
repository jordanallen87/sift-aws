// @sift/scenarios/tools — deterministic, read-only fixture tools for both
// Decision Packs: Choose Our Next Car (docs/specs/packs-and-routing.md
// "Choose Our Next Car Decision Pack" -> "Skills, specialists, and tools":
// "Fixture tools: listing/offer reader, specification lookup, safety/
// reliability source lookup, ownership calculator, household-fit matrix")
// and Home Energy Guardian ("Home Energy Guardian Decision Pack" ->
// "Skills, specialists, and tools": "Tools: fixture bill reader, historical
// usage query, tariff lookup, weather lookup, household event lookup,
// calculator"), plus the internal fixture-loading helper they all share.

export {
  loadFixture,
  parseFixtureJson,
  clearFixtureCache,
  FIXTURE_NAMES,
  MAX_FIXTURE_BYTES,
  FixtureLoadError,
  CandidateListingsSchema,
  DealerOffersSchema,
  OwnershipAssumptionsSchema,
  SafetyReliabilitySourcesSchema,
  HouseholdFitSchema,
  HouseholdProfileSchema,
  CurrentBillSchema,
  UsageHistorySchema,
  WeatherHistorySchema,
  HouseholdEventsSchema,
  RateSchedulesSchema,
  ResponseOptionsSchema,
  BidJobSchema,
  BidSchema,
  LicenseRegistrySchema,
} from './fixture-loader.js';
export type {
  FixtureName,
  FixtureData,
  LoadFixtureOptions,
  CandidateListings,
  CandidateListing,
  DealerOffers,
  DealerOffer,
  OwnershipAssumptions,
  PerCandidateOwnership,
  SafetyReliabilitySources,
  SafetySource,
  SafetyFinding,
  SafetyDisagreement,
  HouseholdFit,
  HouseholdFitCandidate,
  ExplicitUnknown,
  HouseholdProfile,
  CurrentBill,
  UsageHistory,
  UsageCycle,
  WeatherHistory,
  WeatherCycle,
  WeatherAttribution,
  HouseholdEvents,
  HouseholdEvent,
  RateSchedules,
  Tariff,
  ResponseOptions,
  ResponseOption,
  BidJob,
  ScopeLineItemDefinition,
  Bid,
  BidLineItem,
  BidAllowance,
  BidWarranty,
  LicenseRegistry,
  LicenseRegistryEntry,
} from './fixture-loader.js';

export { isAborted, okResult, notFoundResult, cancelledResult } from './tool-result.js';
export type {
  ToolEvidenceItem,
  ToolResultStatus,
  ToolOkResult,
  ToolNotFoundResult,
  ToolCancelledResult,
  ToolResult,
} from './tool-result.js';

export { LISTING_READER_TOOL_ID, readListing, budgetComparisonSentence } from './listing-reader.js';
export type {
  MoneyAmount,
  CandidateListingFacts,
  CandidateDealerOfferFacts,
  CandidateListingResult,
  ListingReaderInput,
} from './listing-reader.js';

export {
  OWNERSHIP_CALCULATOR_TOOL_ID,
  calculateOwnershipCost,
  computeAmortizedFinancing,
} from './ownership-calculator.js';
export type {
  FuelComponent,
  MaintenanceComponent,
  InsuranceComponent,
  DepreciationComponent,
  FinancingComponent,
  OwnershipCostComponents,
  OwnershipCostResult,
  OwnershipCalculatorInput,
} from './ownership-calculator.js';

export {
  SAFETY_RELIABILITY_LOOKUP_TOOL_ID,
  lookupSafetyReliability,
} from './safety-reliability-lookup.js';
export type {
  SafetyReliabilityClaim,
  SafetyReliabilityDisagreement,
  SafetyReliabilityResult,
  SafetyReliabilityLookupInput,
} from './safety-reliability-lookup.js';

export { HOUSEHOLD_FIT_MATRIX_TOOL_ID, lookupHouseholdFit } from './household-fit-matrix.js';
export type {
  KnownHouseholdFitFact,
  HouseholdFitUnknown,
  HouseholdFitResult,
  HouseholdFitMatrixInput,
} from './household-fit-matrix.js';

// --- Home Energy Guardian fixture tools ---

export { BILL_READER_TOOL_ID, readCurrentBill } from './bill-reader.js';
export type {
  CurrentBillCharges,
  CurrentBillBaseline,
  CurrentBillAnomaly,
  CurrentBillResult,
  BillReaderInput,
} from './bill-reader.js';

export { USAGE_HISTORY_QUERY_TOOL_ID, queryUsageHistory } from './usage-history-query.js';
export type {
  UsageHistoryCycleFacts,
  UsageHistoryResult,
  UsageHistoryQueryInput,
} from './usage-history-query.js';

export { TARIFF_LOOKUP_TOOL_ID, lookupTariff } from './tariff-lookup.js';
export type {
  TariffChangeFacts,
  TariffFacts,
  TariffLookupResult,
  TariffLookupInput,
} from './tariff-lookup.js';

export { WEATHER_LOOKUP_TOOL_ID, lookupWeather } from './weather-lookup.js';
export type {
  WeatherAttributionFacts,
  WeatherCycleFacts,
  WeatherLookupResult,
  WeatherLookupInput,
} from './weather-lookup.js';

export { HOUSEHOLD_EVENT_LOOKUP_TOOL_ID, lookupHouseholdEvents } from './household-event-lookup.js';
export type {
  HouseholdEventDeviceFacts,
  HouseholdEventFacts,
  HouseholdEventLookupResult,
  HouseholdEventLookupInput,
} from './household-event-lookup.js';

export {
  DEFAULT_ANOMALY_THRESHOLD_PERCENT,
  ENERGY_CALCULATOR_TOOL_ID,
  calculateEnergyAnalysis,
  determineAnomaly,
  evaluateResponseOptions,
} from './energy-calculator.js';
export type {
  AnomalyDetermination,
  RateChangeAttribution,
  WeatherNormalizedUsage,
  UnexplainedUsageGap,
  EnergyAnalysisResult,
  CalculateEnergyAnalysisInput,
  ResponseOptionScore,
  ResponseOptionsEvaluationResult,
  EvaluateResponseOptionsInput,
} from './energy-calculator.js';

// The deterministic case-creation gate for Home Energy Guardian (see
// bill-feed-gate.ts's own header comment): decides whether a bill feed is
// materially abnormal enough to open a case at all, reusing
// `determineAnomaly`/`DEFAULT_ANOMALY_THRESHOLD_PERCENT` above rather than
// duplicating that arithmetic.
export { evaluateBillFeed, loadAndEvaluateBillFeed } from './bill-feed-gate.js';
export type {
  BillFeedGateDecision,
  BillFeedFixtureName,
  BillFeedInput,
  LoadAndEvaluateBillFeedOptions,
} from './bill-feed-gate.js';

// --- bid-comparison fixture tools ---

export { BID_READER_TOOL_ID, BID_FIXTURE_NAMES, isBidFixtureName, readBid } from './bid-reader.js';
export type {
  MoneyAmount as BidMoneyAmount,
  BidFixtureName,
  BidReaderResult,
  BidReaderInput,
} from './bid-reader.js';

export {
  BID_DOCUMENT_EXTRACTOR_TOOL_ID,
  BID_DOCUMENT_FIELDS,
  REQUIRED_BID_DOCUMENT_FIELDS,
  MAX_EXTRACTED_LINE_ITEMS,
  STATED_FIELD_CONFIDENCE,
  QUALIFIED_FIELD_CONFIDENCE,
  DERIVED_FIELD_CONFIDENCE,
  extractBidDocument,
} from './bid-document-extractor.js';
export type {
  BidDocumentField,
  ExtractedValue,
  ExtractedLineItem,
  ExtractedBidFields,
  BidDocumentExtractionResult,
  BidDocumentExtractorInput,
} from './bid-document-extractor.js';

export { SCOPE_DIFFER_TOOL_ID, diffBidScope, compareBidScope } from './scope-differ.js';
export type {
  ScopeItemStatus,
  ScopeItemDiffEntry,
  BidScopeDiff,
  ScopeDifferResult,
  ScopeDifferInput,
  ScopeDifferJobInput,
  ScopeDifferBidInput,
} from './scope-differ.js';

export {
  BID_CALCULATOR_TOOL_ID,
  PAYMENT_RISK_NORMAL_MAX_PERCENT,
  PAYMENT_RISK_ELEVATED_MAX_PERCENT,
  derivePaymentRisk,
  calculateBidEconomics,
} from './bid-calculator.js';
export type {
  PaymentRiskBand,
  KnownAdjustedTotal,
  UnknownAdjustedTotal,
  AdjustedTotalResult,
  BidCalculatorResult,
  BidCalculatorInput,
} from './bid-calculator.js';

export { LICENSE_LOOKUP_TOOL_ID, lookupLicense } from './license-lookup.js';
export type {
  LicenseInsuranceFacts,
  LicenseLookupFacts,
  LicenseLookupResult,
  LicenseLookupInput,
} from './license-lookup.js';
