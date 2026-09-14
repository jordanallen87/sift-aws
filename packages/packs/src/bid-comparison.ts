/**
 * The real `bid-comparison@1.0.0` Decision Pack manifest ("Bid Comparison"),
 * implementing `docs/bid-comparison/plan.md` verbatim: a nine-person general
 * contractor comparing twelve subcontractor bids for the plumbing scope of a
 * school restroom and locker-room renovation package. This pack is not yet
 * described in
 * `docs/specs/packs-and-routing.md` (that spec predates this plan); every
 * field below is grounded either in a direct quote from
 * `docs/bid-comparison/plan.md` or an explicit judgment call documented at
 * its declaration, following the exact reasoning style
 * `home-energy-guardian.ts` uses for its own inferred fields.
 *
 * `BID_COMPARISON_MANIFEST` is the raw, uncompiled source manifest.
 * `compileBidComparisonPack(catalog, clock)` is a thin convenience wrapper
 * around `compilePack` (`compiler.ts`), matching the manifest+wrapper shape
 * `car-purchase.ts`/`home-energy-guardian.ts` and their test files use.
 *
 * ## Orchestration: Strands Swarm, not Graph
 *
 * The plan's own "Specialists and skills" line reads as a directed chain
 * ("`scope-analyst` ... -> `price-analyst` ... -> `credential-checker` ...
 * -> `schedule-analyst` ... -> `source-challenger` ... ->
 * `decision-synthesizer`") ending in the exact same
 * `source-challenger`-then-`decision-synthesizer` pair that closes
 * `home-energy-guardian`'s six-specialist Swarm team. Three of the four
 * measurement obligations below (`bid.credential_verification`,
 * `bid.schedule_feasibility`, and -- once the scope basis is known --
 * `bid.price_verification`) can genuinely investigate independently rather
 * than through one fixed sequence, and the plan's own "Guide" beat
 * ("`scope-analyst` runs `scope-differ` twice on the same pair with no new
 * angle; RetrySteering redirects it to the third bid") is precisely the
 * repeated-work-without-evidence-gain steering shape
 * `docs/specs/strands-runtime.md` "Energy Swarm" describes for its bounded
 * Swarm, not a rigid Graph topology. `orchestration.strategy: 'swarm'`
 * below reuses `home-energy-guardian`'s exact bounds
 * (`maxSteps`/`nodeTimeoutMs`/`totalTimeoutMs`/repetitive-handoff window and
 * unique-agent floor) as the shared baseline for this codebase's two
 * Swarm-orchestrated packs.
 *
 * ## The `bid.credentials_valid` gate: copied mechanism, not a copied field
 *
 * `docs/bid-comparison/plan.md`'s "Attribute definitions" instruction lists
 * exactly what gets *recorded* per bid from source documents: quoted total,
 * adjusted total, scope completeness, deposit percent, warranty months,
 * start weeks, duration days, licence status, and insurance named-insured
 * match -- nine attributes, none of them a single pass/fail gate. But the
 * hard-constraint criterion `bid.credentials_valid` needs exactly one
 * attribute to gate on (a hard constraint with `composedOfAttributes`
 * degrades to an ordinary averaged composite in `scoreCase` -- see
 * `packages/core/src/scoring.ts`'s `criterion.kind === 'hard_constraint' &&
 * composite === undefined` guard -- so it cannot gate on two attributes at
 * once and still disqualify a bid outright). `home-energy-guardian.ts` faced
 * the identical shape of problem for `energy.no_emergency_risk` and solved
 * it the same way: `energy.emergency_risk_present` is a boolean attribute
 * with no fixture source file, existing purely so the protected constraint
 * has one concrete fact to gate on. `bid.credentials_valid` (the attribute)
 * is that same pattern here: the `credential-checker` specialist's
 * `credential-verification` skill derives it from the two recorded facts
 * (`bid.license_status` covering this scope, `bid.insurance_named_insured_match`
 * being true) rather than either recorded fact being the gate on its own.
 */
import type { CapabilityCatalog } from './capability-catalog.js';
import { compilePack } from './compiler.js';
import type { Clock } from '@sift/core';
import type { CompiledDecisionPack, DecisionPackManifest } from '@sift/contracts';

export const BID_COMPARISON_MANIFEST: DecisionPackManifest = {
  schemaVersion: '1.0',

  identity: {
    id: 'bid-comparison',
    version: '1.0.0',
    name: 'Bid Comparison',
    description:
      "Compares subcontractor bids for a remodeling scope of work on a common scope basis, verifies each bid's arithmetic and contractor credentials, and recommends which bid to award against the household or contractor's cost, scope-completeness, payment-risk, schedule, and warranty priorities, deferring the award itself to explicit human confirmation.",
    tags: ['bid-comparison', 'construction', 'contractor', 'bid-comparison-hero'],
  },

  // Not yet reflected in docs/specs/packs-and-routing.md (this pack postdates
  // that spec's current text). `intents`/`keywords`/`artifactKinds`/
  // `entitySignals`/`exclusions` are all judgment calls grounded in
  // docs/bid-comparison/plan.md's scenario description, chosen to signal a
  // bid-comparison intent without echoing a capability this pack cannot
  // perform (it can only *propose* an award, never execute a contract or
  // resolve a legal dispute).
  activation: {
    intents: [
      'compare subcontractor bids',
      'choose which bid to award',
      'evaluate remodel quotes',
      'check a contractor bid for missing scope',
    ],
    keywords: [
      'subcontractor bid',
      'contractor quote',
      'remodel bid',
      'plumbing bid',
      'bid comparison',
      'lowest bid',
      'scope of work',
      'deposit percentage',
      'license and insurance',
      'award the bid',
    ],
    artifactKinds: [
      'contractor_bid',
      'scope_of_work',
      'license_certificate',
      'insurance_certificate',
    ],
    entitySignals: [
      'bid total',
      'line items',
      'deposit',
      'warranty',
      'start date',
      'license number',
      'certificate of insurance',
    ],
    exclusions: ['structural safety concern', 'active litigation', 'code violation dispute'],
  },

  entities: [
    {
      id: 'bid',
      label: 'Subcontractor bid',
      description:
        "One subcontractor's bid for the scope of work under comparison: its quoted and scope-normalized adjusted totals, scope completeness, deposit and warranty terms, schedule, and license/insurance credential status.",
      attributeIds: [
        'bid.quoted_total',
        'bid.adjusted_total',
        'bid.scope_completeness',
        'bid.deposit_percent',
        'bid.warranty_months',
        'bid.start_weeks',
        'bid.duration_days',
        'bid.license_status',
        'bid.insurance_named_insured_match',
        'bid.credentials_valid',
      ],
    },
  ],

  attributes: [
    {
      id: 'bid.quoted_total',
      label: 'Quoted total',
      valueType: 'money',
      required: true,
      appliesTo: ['bid'],
      evidenceExpectation: 'source',
      comparison: 'none',
      sensitive: false,
    },
    {
      id: 'bid.adjusted_total',
      label: 'Scope-normalized adjusted total',
      valueType: 'money',
      required: true,
      appliesTo: ['bid'],
      // `evidenceExpectation: 'verification'` (E3-tier), not `'source'`:
      // this is the price-analyst's own deterministic recomputation (quoted
      // total plus the plug numbers for any scope items `scope-differ`
      // found missing), the same reasoning `home-energy-guardian.ts` gives
      // for `energy.baseline_bill_amount`. Until every missing-scope item
      // has a plug number, this value is an explicit unknown rather than a
      // silently-optimistic "quoted total" default -- the plan's own
      // thesis ("until a plug number is supplied, bid B's adjusted total
      // is unknown and readiness is blocked").
      evidenceExpectation: 'verification',
      comparison: 'lower_better',
      sensitive: false,
    },
    {
      id: 'bid.scope_completeness',
      label: 'Scope completeness',
      valueType: 'number',
      required: true,
      appliesTo: ['bid'],
      unit: '%',
      // Also a deterministic derivation of `scope-differ`'s comparison
      // (the share of the full normalized scope this bid explicitly
      // prices), not a raw fact read off the bid document.
      evidenceExpectation: 'verification',
      comparison: 'higher_better',
      sensitive: false,
    },
    {
      id: 'bid.deposit_percent',
      label: 'Deposit requested',
      valueType: 'number',
      required: true,
      appliesTo: ['bid'],
      unit: '%',
      evidenceExpectation: 'source',
      comparison: 'lower_better',
      sensitive: false,
    },
    {
      id: 'bid.warranty_months',
      label: 'Warranty term',
      valueType: 'number',
      // `required: false` is the load-bearing field here: a bid that never
      // states a warranty term must round-trip as an explicit unknown
      // (`AttributeRecord.status: 'unknown'`, no `value`), not as `0`
      // months. Silently defaulting a missing term to zero would assert a
      // fact ("this bid explicitly promises no warranty") the bid document
      // never actually states -- exactly the "worst first"/invented-fact
      // failure mode `packages/contracts/src/attributes.ts` and
      // `scoring.ts` guard against elsewhere for enums and composites.
      required: false,
      appliesTo: ['bid'],
      unit: 'months',
      evidenceExpectation: 'source',
      comparison: 'higher_better',
      sensitive: false,
    },
    {
      id: 'bid.start_weeks',
      label: 'Weeks until work can start',
      valueType: 'number',
      required: true,
      appliesTo: ['bid'],
      unit: 'weeks',
      evidenceExpectation: 'source',
      comparison: 'lower_better',
      sensitive: false,
    },
    {
      id: 'bid.duration_days',
      label: 'Estimated project duration',
      valueType: 'number',
      required: true,
      appliesTo: ['bid'],
      unit: 'days',
      evidenceExpectation: 'source',
      comparison: 'lower_better',
      sensitive: false,
    },
    {
      id: 'bid.license_status',
      label: 'License status',
      // 'enum', not 'string': a license-registry lookup returns one of a
      // small, closed set of statuses (unlike, say, a household/appliance
      // event type, which is open-ended prose).
      valueType: 'enum',
      required: true,
      appliesTo: ['bid'],
      allowedValues: ['active', 'inactive', 'expired', 'suspended', 'not_found'],
      // Not itself scored (`comparison: 'none'`) -- it is one of the two
      // recorded facts `credential-verification` combines into the actual
      // scored/gating `bid.credentials_valid` attribute below, matching
      // how `home-energy-guardian.ts`'s `energy.correlated_event_type`
      // stays purely informational rather than itself a criterion target.
      evidenceExpectation: 'source',
      comparison: 'none',
      sensitive: false,
    },
    {
      id: 'bid.insurance_named_insured_match',
      label: 'Insurance named insured matches license holder',
      valueType: 'boolean',
      required: true,
      appliesTo: ['bid'],
      // A deterministic string comparison between the certificate's named
      // insured and the license holder of record, not a raw single-source
      // fact -- 'verification', matching `bid.adjusted_total`'s reasoning.
      evidenceExpectation: 'verification',
      comparison: 'none',
      sensitive: false,
    },
    {
      id: 'bid.credentials_valid',
      label: 'License and insurance credentials fully valid',
      valueType: 'boolean',
      required: true,
      appliesTo: ['bid'],
      evidenceExpectation: 'verification',
      // `comparison: 'constraint'` (not `lower_better`/`higher_better`)
      // matches `home-energy-guardian.ts`'s `energy.emergency_risk_present`
      // exactly: the attribute itself declares no polarity of its own, so
      // the criterion's own `direction` supplies it (see the
      // `bid.credentials_valid` criterion below).
      comparison: 'constraint',
      sensitive: false,
    },
  ],

  // The reweight beat (docs/bid-comparison/plan.md: "move weight off
  // `adjusted_total` toward `scope_completeness` and `payment_risk`, and
  // the recommendation changes again") only demonstrates the deterministic
  // core owning the ranking if these five preference criteria are all
  // freely reweightable -- `protectedCriterionIds` below covers only the
  // one hard constraint, matching `car-purchase.ts`'s precedent of leaving
  // its preference criteria unprotected.
  criteria: {
    defaults: [
      {
        id: 'bid.adjusted_total',
        label: 'Lowest scope-normalized cost',
        kind: 'preference',
        weight: 45,
        direction: 'lower_better',
        appliesToAttribute: 'bid.adjusted_total',
        origin: 'pack',
        status: 'active',
      },
      {
        id: 'bid.scope_completeness',
        label: 'Scope completeness',
        kind: 'preference',
        weight: 20,
        direction: 'higher_better',
        appliesToAttribute: 'bid.scope_completeness',
        origin: 'pack',
        status: 'active',
      },
      {
        id: 'bid.payment_risk',
        label: 'Payment risk (deposit requested)',
        kind: 'preference',
        weight: 15,
        direction: 'lower_better',
        appliesToAttribute: 'bid.deposit_percent',
        question:
          'Is the requested deposit within a reasonable range, or does it signal payment risk?',
        origin: 'pack',
        status: 'active',
      },
      {
        id: 'bid.schedule_fit',
        label: 'Schedule fit (start date and duration)',
        kind: 'preference',
        weight: 10,
        // The criterion-level direction is `higher_better` ("a better
        // schedule fit"), which is the plan's own polarity for this row.
        // Each of the two parts below is normalized by its OWN attribute's
        // `comparison` (both `lower_better`: sooner start and shorter
        // duration are each individually better), exactly the same
        // criterion-vs-part asymmetry `car-purchase.ts` documents for
        // `pref.deal_value` -- so the mismatch between this `higher_better`
        // and the parts' own `lower_better` is intentional, not a polarity
        // bug.
        direction: 'higher_better',
        composedOfAttributes: ['bid.start_weeks', 'bid.duration_days'],
        question: 'How soon can work start and how long will it take, relative to the other bids?',
        origin: 'pack',
        status: 'active',
      },
      {
        id: 'bid.warranty',
        label: 'Warranty term',
        kind: 'preference',
        weight: 10,
        direction: 'higher_better',
        appliesToAttribute: 'bid.warranty_months',
        origin: 'pack',
        status: 'active',
      },
      {
        id: 'bid.credentials_valid',
        label: 'License and insurance credentials are valid',
        kind: 'hard_constraint',
        // `weight: 0`, matching `home-energy-guardian.ts`'s
        // `energy.no_emergency_risk` exactly: `normalizeCriterionWeights`
        // (`packages/core/src/criteria.ts`) pools every `active`
        // criterion's weight regardless of `kind`, so a nonzero weight here
        // would silently dilute the five preference criteria below their
        // intended 100%-of-the-scored-pool share.
        weight: 0,
        // `higher_better`: `true` (credentials fully valid) is the GOOD
        // end here, the mirror image of `energy.no_emergency_risk`'s
        // `lower_better` (where `true` -- risk present -- is the bad end).
        // `evaluateConstraint` (`scoring.ts`) reads a boolean hard
        // constraint's polarity directly from this field.
        direction: 'higher_better',
        appliesToAttribute: 'bid.credentials_valid',
        question:
          'Does the bid carry an active license covering this scope, and does its insurance certificate name the license holder as the insured?',
        origin: 'pack',
        status: 'active',
      },
    ],
    allowUserDefined: true,
    protectedCriterionIds: ['bid.credentials_valid'],
  },

  // docs/bid-comparison/plan.md "Obligations", quoted/paraphrased verbatim
  // for id/label/question. `dependsOn` follows the plan's own causal
  // ordering: `bid.price_verification`'s adjusted-total arithmetic needs
  // the missing-scope plug numbers `bid.scope_normalization` establishes
  // first (the plan's worked example literally walks scope-normalization
  // before the adjusted-total arithmetic); `bid.credential_verification`
  // and `bid.schedule_feasibility` each read an independent document
  // (license registry; the bid's own stated schedule) and can proceed in
  // either order or in parallel; `bid.award_recommendation` depends on all
  // four, mirroring `energy.response_options`' synthesis-depends-on-
  // everything pattern.
  //
  // `priority` reuses `home-energy-guardian.ts`'s exact judgment-call
  // scheme for the same shape of dependency graph: the one obligation nothing
  // else needs to wait on is highest (100), the two obligations gated only
  // on it are equal-and-high (80), the fully independent third measurement
  // obligation is next (70), and the final synthesis is lowest (10).
  //
  // `acceptedUncertaintyAllowed`/`requiredEvidenceLevel`: `bid.price_verification`
  // and `bid.credential_verification` are deterministic re-derivations (line
  // items summing to a total; a registry lookup) with no legitimate partial-
  // credit disposition, so both are `E3`/`false`, matching
  // `energy.anomaly`'s reasoning. `bid.schedule_feasibility` is a
  // plausibility judgment ("is this start date and duration *credible*", not
  // provably true) read from a single document, so it is `E1`/`true`,
  // matching `energy.household_change`. `bid.scope_normalization` is a
  // deterministic comparison, but the plan's own steering beat requires it
  // to survive at least one redirected retry across all three bid pairs, so
  // `maxAttempts: 3` (rather than `home-energy-guardian.ts`'s `1` for its
  // own single-shot deterministic obligation) leaves room for that without
  // loosening `acceptedUncertaintyAllowed`. `bid.award_recommendation` is
  // `E2`/`false`, matching `energy.response_options` exactly: a synthesis
  // must reach a definite ranked recommendation, not an open question.
  obligations: [
    {
      id: 'bid.scope_normalization',
      label: 'Scope normalization',
      question: 'Are all the bids in this case compared on the same scope basis?',
      category: 'scope_normalization',
      required: true,
      priority: 100,
      requiredEvidenceLevel: 'E2',
      maxAttempts: 3,
      acceptedUncertaintyAllowed: false,
      dependsOn: [],
      preferredSkills: ['scope-normalization'],
      preferredSpecialists: ['scope-analyst'],
      completionRule: {
        minimumEvidenceLevel: 'E2',
        minimumIndependentSources: 2,
        acceptedUncertaintyAllowed: false,
      },
      origin: 'pack',
    },
    {
      id: 'bid.price_verification',
      label: 'Price verification',
      question:
        "Do the bid's line items sum to its stated total, and are missing-scope allowances identified?",
      category: 'price_verification',
      required: true,
      priority: 80,
      requiredEvidenceLevel: 'E3',
      maxAttempts: 2,
      acceptedUncertaintyAllowed: false,
      dependsOn: ['bid.scope_normalization'],
      preferredSkills: ['price-arithmetic'],
      preferredSpecialists: ['price-analyst'],
      completionRule: {
        minimumEvidenceLevel: 'E3',
        minimumIndependentSources: 1,
        acceptedUncertaintyAllowed: false,
      },
      origin: 'pack',
    },
    {
      id: 'bid.credential_verification',
      label: 'Credential verification',
      question:
        "Does the bid's license cover this work, is insurance active, and does the named insured match?",
      category: 'credential_verification',
      required: true,
      priority: 80,
      requiredEvidenceLevel: 'E3',
      maxAttempts: 2,
      acceptedUncertaintyAllowed: false,
      dependsOn: [],
      preferredSkills: ['credential-verification'],
      preferredSpecialists: ['credential-checker'],
      completionRule: {
        minimumEvidenceLevel: 'E3',
        minimumIndependentSources: 1,
        acceptedUncertaintyAllowed: false,
      },
      origin: 'pack',
    },
    {
      id: 'bid.schedule_feasibility',
      label: 'Schedule feasibility',
      question: "Is the bid's stated start date and duration credible for this scope of work?",
      category: 'schedule_feasibility',
      required: true,
      priority: 70,
      requiredEvidenceLevel: 'E1',
      maxAttempts: 2,
      acceptedUncertaintyAllowed: true,
      dependsOn: [],
      preferredSkills: ['schedule-analysis'],
      preferredSpecialists: ['schedule-analyst'],
      completionRule: {
        minimumEvidenceLevel: 'E1',
        minimumIndependentSources: 1,
        acceptedUncertaintyAllowed: true,
      },
      origin: 'pack',
    },
    {
      id: 'bid.award_recommendation',
      label: 'Award recommendation',
      question:
        'Which bid should be awarded given adjusted cost, scope completeness, payment risk, schedule fit, warranty, and credentials?',
      category: 'award_recommendation',
      required: true,
      priority: 10,
      requiredEvidenceLevel: 'E2',
      maxAttempts: 2,
      acceptedUncertaintyAllowed: false,
      dependsOn: [
        'bid.scope_normalization',
        'bid.price_verification',
        'bid.credential_verification',
        'bid.schedule_feasibility',
      ],
      // No skill listed here: docs/bid-comparison/plan.md's "Skills and
      // specialists" section names exactly four skills, each bound to one
      // of the four measurement obligations above -- there is no fifth
      // "synthesis" skill. `decision-synthesizer` is invoked as its own
      // bounded Swarm agent-tool (see its `allowedSkills: []` below),
      // matching `home-energy-guardian.ts`'s identical treatment of
      // `source-challenger`.
      preferredSkills: [],
      preferredSpecialists: ['decision-synthesizer', 'source-challenger'],
      completionRule: {
        minimumEvidenceLevel: 'E2',
        minimumIndependentSources: 2,
        acceptedUncertaintyAllowed: false,
      },
      origin: 'pack',
      // This obligation's own question names the scored criteria, so
      // reweighting them is exactly what makes its previous answer stale --
      // unlike the four measurement obligations it depends on, whose
      // findings about scope, price, credentials, and schedule are just as
      // true afterwards. Matches `energy.response_options`'s identical use
      // of this field and reasoning exactly.
      dependsOnCriteria: true,
    },
  ],

  extensionPolicy: {
    allowCaseAttributes: true,
    allowCaseCriteria: true,
    allowCaseObligations: true,
    userConcernTemplateId: 'bid.user_concern',
  },

  // docs/bid-comparison/plan.md "Specialists and skills": "scope-analyst
  // (skill `scope-normalization` ...) -> price-analyst (skill
  // `price-arithmetic` ...) -> credential-checker (skill
  // `credential-verification` ...) -> schedule-analyst (skill
  // `schedule-analysis` ...)".
  skills: [
    {
      id: 'scope-normalization',
      description:
        'Diffs what each bid includes against the others to put all bids on one scope basis, identifying items priced by some bids but silently excluded by others.',
    },
    {
      id: 'price-arithmetic',
      description:
        "Verifies a bid's line items sum to its stated total, identifies allowances, and computes the scope-normalized adjusted total by adding back the cost of any excluded scope items.",
    },
    {
      id: 'credential-verification',
      description:
        "Verifies a bid's contractor license is active and covers this scope of work, and that its certificate of insurance names the license holder as the insured.",
    },
    {
      id: 'schedule-analysis',
      description:
        "Evaluates whether a bid's stated start date and project duration are credible for this scope of work.",
    },
  ],

  // docs/bid-comparison/plan.md "Specialists and skills" and "The Strands
  // beats, placed deliberately". `allowedTools` are the EXACT grants the
  // plan specifies -- in particular `price-analyst` is granted
  // `bid-reader`/`bid-calculator` only, deliberately excluding
  // `license-lookup` (granted only to `credential-checker`), since the
  // plan's own "Deny" beat depends on that exact narrower grant:
  // "`price-analyst` reaches for `license-lookup` ... Refused before it
  // runs."
  specialists: [
    {
      id: 'scope-analyst',
      description:
        'Puts all the bids in this case on one scope basis by diffing what each bid includes and excludes.',
      allowedTools: ['bid-reader', 'scope-differ'],
      allowedSkills: ['scope-normalization'],
    },
    {
      id: 'price-analyst',
      description:
        "Verifies each bid's arithmetic and computes the scope-normalized adjusted total. Does not verify licenses or insurance.",
      allowedTools: ['bid-reader', 'bid-calculator'],
      allowedSkills: ['price-arithmetic'],
    },
    {
      id: 'credential-checker',
      description:
        "Verifies a bid's license and insurance credentials against the license registry.",
      // Deliberately the ONLY specialist granted `license-lookup` -- see
      // the plan's "Deny" beat and `price-analyst` above.
      allowedTools: ['license-lookup'],
      allowedSkills: ['credential-verification'],
    },
    {
      id: 'schedule-analyst',
      description: "Evaluates whether a bid's stated start date and duration are credible.",
      allowedTools: ['bid-reader'],
      allowedSkills: ['schedule-analysis'],
    },
    {
      id: 'source-challenger',
      description:
        'Evaluates provenance, recency, and contradictions across submitted bid evidence before it can satisfy an obligation.',
      allowedTools: ['bid-reader', 'scope-differ'],
      allowedSkills: [],
    },
    {
      id: 'decision-synthesizer',
      description:
        'Synthesizes resolved scope, price, credential, and schedule evidence into a source-linked award recommendation, gated by its own GoalLoop validator and requiring human confirmation before an award proposal is recorded.',
      allowedTools: ['propose_award'],
      allowedSkills: [],
    },
  ],

  // See the module doc comment above for why this pack is Swarm-, not
  // Graph-, orchestrated. Bounds are `home-energy-guardian.ts`'s own values,
  // reused as this codebase's shared Swarm-orchestration baseline: `12`
  // reuses the engine loop's own "twelve tool calls per run" default bound;
  // `8`/`3` keep the repetitive-handoff window strictly wider than Sift's
  // own three-call `RetrySteering` no-progress threshold, so the Swarm's
  // hard `FAILED`-result detection only ever functions as an outer safety
  // net behind Sift's own soft steering.
  orchestration: {
    strategy: 'swarm',
    maxSteps: 12,
    nodeTimeoutMs: 120_000,
    totalTimeoutMs: 300_000,
    repetitiveHandoffDetectionWindow: 8,
    repetitiveHandoffMinUniqueAgents: 3,
  },

  // docs/bid-comparison/plan.md "Files": fixture tools `bid-reader`,
  // `scope-differ`, `bid-calculator`, `license-lookup`. `propose_award` is
  // this pack's one consequential effect (plan.md "Confirm": "`propose_award`
  // is consequential; ConsequenceGuard gates it on human review before the
  // proposal is recorded"), matching `energy.propose_inspection`'s and
  // `car.propose_recommendation`'s identical treatment.
  tools: [
    {
      id: 'bid-reader',
      description:
        "Reads a subcontractor's bid document (contractor, quoted total, line items, deposit terms, warranty, and schedule) from fixture data.",
      effect: 'read_only',
      requiresApproval: false,
    },
    {
      id: 'scope-differ',
      description:
        'Compares the scope covered by two or more bids and returns which items are priced by some bids but excluded by others, with a plug-number estimate for each excluded item.',
      effect: 'read_only',
      requiresApproval: false,
    },
    {
      id: 'bid-calculator',
      description:
        "Performs the deterministic arithmetic behind a bid's line-item sum, allowances, and scope-normalized adjusted total.",
      effect: 'read_only',
      requiresApproval: false,
    },
    {
      id: 'license-lookup',
      description:
        "Reads a contractor's license status and certificate-of-insurance named insured from a fixture license registry.",
      effect: 'read_only',
      requiresApproval: false,
    },
    {
      id: 'propose_award',
      description:
        'Creates the consequential proposal to award the bid to a subcontractor. Requires explicit human confirmation before the proposal is recorded; the pack does not execute or sign a contract.',
      effect: 'consequential',
      requiresApproval: true,
    },
  ],

  policies: [
    {
      id: 'bid.award-approval',
      description:
        'Awarding a bid requires explicit human confirmation before the proposal is recorded.',
      requiresHumanApproval: true,
      appliesToToolIds: ['propose_award'],
    },
  ],

  presentation: {
    optionLabel: 'Bid',
    optionLabelPlural: 'Bids',
    // A bid is chosen on what it actually costs once normalized, how much
    // of the scope it covers, how much deposit risk it carries, and whether
    // its credentials are valid -- not on every underlying schedule/
    // credential-detail field, which stays in `attributeGroups` for the
    // detail profile.
    prominentAttributeIds: [
      'bid.adjusted_total',
      'bid.scope_completeness',
      'bid.deposit_percent',
      'bid.warranty_months',
      'bid.credentials_valid',
    ],
    attributeGroups: [
      {
        id: 'bid',
        label: 'Bid basics',
        attributeIds: ['bid.quoted_total', 'bid.adjusted_total', 'bid.scope_completeness'],
      },
      {
        id: 'payment_and_schedule',
        label: 'Payment and schedule',
        attributeIds: [
          'bid.deposit_percent',
          'bid.warranty_months',
          'bid.start_weeks',
          'bid.duration_days',
        ],
      },
      {
        id: 'credentials',
        label: 'Credentials',
        attributeIds: [
          'bid.license_status',
          'bid.insurance_named_insured_match',
          'bid.credentials_valid',
        ],
      },
    ],
  },

  // docs/bid-comparison/plan.md declares no scenario-content file names yet
  // (those are separate, later Wave-4 work); this manifest only declares
  // the ids `requiresNegativeCase` needs to see, one per named beat: the
  // happy path, the scope-differ steering handoff ("Guide"), and the award
  // confirmation ("Confirm") -- matching `home-energy-guardian.ts`'s
  // identical judgment call for the same field.
  evaluation: {
    scenarioIds: [
      'bid-comparison-happy-path',
      'bid-comparison-scope-differ-steering-handoff',
      'bid-comparison-award-confirmation',
    ],
    requiresNegativeCase: true,
  },

  // docs/change-sets/2026-08-30-generic-decision-workspace.md §46/§47
  // pack-level Decision Guide -- see `car-purchase.ts`/`home-energy-guardian.ts`'s
  // identical field for the full rationale (declarative data only, never a
  // prompt). Every claim below is grounded in this manifest's own
  // obligations, criteria, and attribute definitions above.
  decisionGuide: {
    domainPurpose:
      'Comparing subcontractor bids for the same scope of work by putting them on one scope basis, verifying arithmetic and credentials, and recommending an award that fits the cost, completeness, payment-risk, schedule, and warranty priorities of whoever is choosing.',
    discoveryStrategy:
      'Normalize scope across every bid before comparing price at all -- a cheaper bid that is silent on part of the work is not actually cheaper. Credential verification and schedule feasibility can be investigated independently of price and of each other, since each reads its own separate document.',
    suggestedQuestions: [
      'Does every bid price the same scope of work, or is one bid silent on something the others include?',
      'Is the requested deposit within a reasonable range for this size of job?',
      "Does each contractor's license cover this scope, and does its insurance certificate name the license holder as the insured?",
      'Would the deciding party rather see the lowest adjusted cost or the most complete scope, if those bids differ?',
    ],
    importantUnknowns: [
      'Whether a bid with no stated warranty term genuinely offers none, or simply did not write one down, is not knowable from the bid document alone -- it stays an explicit unknown rather than a zero-month warranty.',
      'Whether a proposed award is actually the right call is a judgment this pack can surface but never decide -- it always requires explicit human confirmation before the proposal is recorded.',
    ],
    researchGuidance:
      "Re-derive each bid's adjusted total from its own stated line items and the scope gaps found against the other bids, rather than comparing quoted totals directly; verify license and insurance against the registry rather than taking a bid's own claim at face value.",
    customFieldGuidance:
      'Prefer a typed custom field over noting an unusual bid term only in prose. Never infer that credentials are valid without an explicit registry check -- that judgment gates whether the bid can be awarded at all, not only its ranking.',
    presentationGuidance:
      'Show the adjusted total alongside the quoted total and scope completeness together, since a bid that looks cheapest on its quoted total alone can rank differently once the missing scope is priced in.',
  },

  // The pack-level compliance declaration (packs.ts's `PackComplianceSchema`,
  // added specifically because the product owner asked to "include things
  // like compliance, b/c thats big"). Every citation below was verified this
  // session, not invented, and every summary states only what the cited
  // text actually says.
  //
  // ## What these standards are, and what they are not
  //
  // FAR 13.104(b), N.C. Gen. Stat. § 143-132, and the comparable state
  // statutes are all MINIMUMS the party making the award must satisfy before
  // an award is legal -- "at least three," never "at most three" and never a
  // claim that three is a typical or recommended count. This manifest
  // deliberately never states or implies a bid count of its own (the pack's
  // own scenario content is a separate, evolving concern -- see
  // `docs/bid-comparison/plan.md` and the fixtures under
  // `packages/scenarios/fixtures/bids/`); every summary and
  // `humanResponsibility` string below is phrased generically ("the bids in
  // this case," never "the three bids") so this declaration stays correct
  // regardless of how many bids any given case actually holds.
  //
  // ## Why every competitive-bid standard has no `automatedCheck`
  //
  // Each of the first three standards gates on how many sources were
  // SOLICITED before an award, not on how many bid documents happen to be
  // recorded in a case. This pack can only see what has been entered as a
  // bid; it has no way to observe whether a fourth contractor was invited
  // and declined, or never invited at all. Claiming an automated check here
  // would assert a fact the pack cannot actually verify -- the same
  // discipline `PackComplianceStandardSchema.automatedCheck`'s own doc
  // comment requires. `license-and-insurance-verification` is the one
  // standard below that DOES get `automatedCheck`, because it is exactly
  // what `packages/scenarios/src/tools/license-lookup.ts` already verifies
  // against the license registry -- see that file's own header comment,
  // named directly in this task's brief as "the model for the kind of thing
  // this field should describe."
  //
  // ## Not legal advice
  //
  // `disclaimer` and every `humanResponsibility` entry say this explicitly:
  // this pack states what a cited rule says, never which rule applies to a
  // reader's own project, and never that satisfying one of these checks
  // makes an award lawful. That determination is always the human's own,
  // informed by their own counsel and their own jurisdiction.
  /**
   * Three lenses, because twelve bids is the point at which a person stops
   * reading a wide table and starts sorting by whichever number is nearest.
   * Each one answers a question a person choosing a subcontractor actually
   * asks, and the three together cover every attribute -- but they overlap
   * deliberately: `bid.adjusted_total` appears under both Price and Risk,
   * because "is this the cheapest" and "can this bidder actually do it for
   * that" are different questions about the same number.
   */
  lenses: [
    {
      id: 'bid.lens.price',
      label: 'Price',
      description:
        'What each bid costs once every bid prices the same work -- and what it quoted before that correction.',
      attributeIds: ['bid.quoted_total', 'bid.adjusted_total', 'bid.scope_completeness'],
    },
    {
      id: 'bid.lens.schedule',
      label: 'Schedule & warranty',
      description: 'When each bidder can start, how long they need, and what they stand behind.',
      attributeIds: ['bid.start_weeks', 'bid.duration_days', 'bid.warranty_months'],
    },
    {
      id: 'bid.lens.risk',
      label: 'Credentials & risk',
      description:
        'Whether each bidder is licensed and insured for this scope, and how much money you are asked for up front.',
      attributeIds: [
        'bid.credentials_valid',
        'bid.license_status',
        'bid.insurance_named_insured_match',
        'bid.deposit_percent',
        'bid.adjusted_total',
      ],
    },
  ],

  compliance: {
    disclaimer:
      'These are informational minimums on the party making the award — not a cap on how many bids may be received, and not a claim that any particular number is typical. They are not legal advice: confirm which rules actually govern this award in your own jurisdiction before relying on them.',
    standards: [
      {
        id: 'far-13-104-b-simplified-acquisitions',
        label: 'Minimum sources for federal simplified acquisitions',
        summary:
          'For federal simplified acquisitions, the contracting officer must "consider solicitation of at least three sources to promote competition to the maximum extent practicable" before making an award.',
        citation: 'FAR 13.104(b) (48 C.F.R. § 13.104(b))',
        authority: 'U.S. Federal Acquisition Regulation',
        humanResponsibility:
          'Confirm whether this award is a federal simplified acquisition subject to FAR Part 13, and that the required number of sources was actually solicited — Sift can show how many bids are recorded in this case, not how many sources were invited to bid.',
      },
      {
        id: 'nc-gs-143-132-public-construction',
        label: 'Minimum competitive bids for North Carolina public construction contracts',
        summary:
          'A North Carolina public construction contract may not be awarded "unless at least three competitive bids have been received"; if fewer arrive, the contracting entity must re-advertise. A temporary carve-out effective July 7, 2026 permits two bids for water and sewer system contracts specifically.',
        citation: 'N.C. Gen. Stat. § 143-132',
        authority: 'North Carolina General Assembly',
        humanResponsibility:
          'Confirm this award is subject to Chapter 143 of the North Carolina General Statutes, and whether the temporary water/sewer carve-out applies before treating two bids as sufficient.',
      },
      {
        id: 'comparable-state-bid-minimums',
        label: 'Comparable minimum-bid thresholds in other states',
        summary:
          "Idaho, Pennsylvania, and Louisiana each set their own minimum competitive-bid or -quote requirements for public contracts, similar in spirit to North Carolina's rule but not identical in trigger amount or required bid count: Idaho sets a statewide minimum under Idaho Code § 67-2805; Pennsylvania requires competitive quotes for contracts in the $13,200-$24,500 range; Louisiana requires them in the $10,000-$30,000 range.",
        citation: 'Idaho Code § 67-2805; 62 Pa. Cons. Stat. § 3902; La. Rev. Stat. § 38:2212',
        authority: 'Idaho, Pennsylvania, and Louisiana state legislatures',
        humanResponsibility:
          "Confirm which state's threshold, if any, actually governs this award — the trigger dollar amount and the required bid count both differ by state, and none of them is assumed to apply by default.",
      },
      {
        id: 'license-and-insurance-verification',
        label: 'Active license and insurance covering the scope of work',
        summary:
          'A contractor awarded a bid should hold a license that is active and whose class covers the scope of work, and should carry a certificate of insurance that names the license holder as the insured.',
        citation: 'State contractor licensing statutes (requirements vary by jurisdiction)',
        authority: 'State contractor licensing board',
        // The one standard this pack genuinely automates -- see the
        // module comment above and `license-lookup.ts`'s own header
        // comment, which this restates in the reader's language rather
        // than the engine's.
        automatedCheck:
          "Confirms each bid's contractor license is active and its class covers this scope of work, that the certificate of insurance is active, and that the certificate's named insured matches the license holder.",
        humanResponsibility:
          'Confirm the licensing board record itself is current and that no additional local permit or inspection is required beyond licensing and insurance.',
      },
    ],
  },
};

/** Convenience wrapper: `compilePack(BID_COMPARISON_MANIFEST, catalog, clock)`. */
export function compileBidComparisonPack(
  catalog: CapabilityCatalog,
  clock: Clock,
): CompiledDecisionPack {
  return compilePack(BID_COMPARISON_MANIFEST, catalog, clock);
}
