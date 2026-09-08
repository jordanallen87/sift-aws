# Decision Packs and Routing Specification

## Purpose

A **Decision Pack** is the validated, versioned method a case uses. It supplies domain vocabulary, default attributes and criteria, required questions, skills, specialist agents, allowed tools, orchestration bounds, policies, UI labels, and evaluation scenarios. It contains no arbitrary executable code.

The generic Sift engine remains stable across domains. The selected pack changes what must be resolved and which bounded capabilities are available. The pack is a supervisory contract, not a rigid questionnaire: case-specific typed extensions let users add concerns the author did not anticipate.

The complete authoring, extension, and compiler behavior is defined in `pack-authoring.md`.

## Manifest contract

```ts
interface DecisionPackManifest {
  schemaVersion: '1.0'
  identity: {
    id: string
    version: string
    name: string
    description: string
    tags: string[]
  }
  activation: {
    intents: string[]
    keywords: string[]
    artifactKinds: string[]
    entitySignals: string[]
    exclusions: string[]
  }
  entities: EntityTypeDefinition[]
  attributes: AttributeDefinition[]
  criteria: {
    defaults: CriterionDefinition[]
    allowUserDefined: boolean
    protectedCriterionIds: string[]
  }
  obligations: ObligationTemplate[]
  extensionPolicy: {
    allowCaseAttributes: boolean
    allowCaseCriteria: boolean
    allowCaseObligations: boolean
    userConcernTemplateId: string
  }
  skills: SkillReference[]
  specialists: SpecialistDefinition[]
  orchestration: OrchestrationDefinition
  tools: ToolDeclaration[]
  policies: PolicyDefinition[]
  presentation: PresentationDefinition
  evaluation: PackEvaluationDefinition
  watches?: WatchDeclaration[]
}

interface CompiledDecisionPack extends DecisionPackManifest {
  compiledHash: string
  compiledAt: string
  resolvedCapabilities: ResolvedCapabilityCatalog
  runtimeValidators: CompiledValidatorReferences
}
```

Manifest compilation rejects duplicate IDs, missing references, unknown capabilities, cycles without execution bounds, missing approval policies for consequential effects, invalid extension rules, UI fields the generic renderer cannot display, and evaluation suites without negative cases.

## Flexible attributes and criteria

Pack attributes are strongly typed defaults, not a closed entity object. Known fields such as `car.advertised_price` or `energy.billing_period` use declarative `AttributeDefinition` records. A case may add `custom.*` definitions when allowed by the pack.

All values cross the shared discriminated `AttributeValue` Zod schema. This preserves validation while allowing a household to add concerns such as garage clearance, dog-crate fit, accessibility, sensory comfort, or a locally meaningful constraint without publishing another pack version.

Users may add, remove, rename, and reweight non-protected criteria. When a custom criterion needs evidence, the core derives a case obligation from the pack's `userConcern` template. Required pack obligations and protected criteria cannot be removed. Unsupported concerns remain explicit unknowns and may request human evidence; the model cannot invent a tool or value.

## Presentation metadata and Decision Guide

**Status: `PresentationDefinition` itself remains unexpanded.** It today declares only `optionLabel`, `optionLabelPlural`, and `attributeGroups` (see `pack-authoring.md`). Change-set §46 specifies expanding it so a pack can declare, as pure data:

- recommended workspace views (which of Quick Pick/List/Compare/Board apply to this pack, and a sensible default; see `product.md`'s "Workspace views");
- default visible fields and prominent fields for List and Compare;
- Decision Profile sections and profile discovery questions;
- catalog capability — whether and how `sift_search_catalog` applies to this pack, and its filter schema (see `webmcp.md`);
- useful initial filters;
- which fields are subjective/human-only versus safe for model inference — the distinction change-set §26 requires: research-supported "likely" is not the same claim as human-attested "verified comfortable";
- recommended Question wording;
- Board column defaults;
- Quick Pick summary fields.

None of this is executable behavior. It is declarative metadata the generic renderer reads, the same way `attributeGroups` already is today — never a per-pack React conditional, and never a mechanism that lets a pack branch application logic (change-set §46: "Do NOT put executable behavior into the declarative pack. Compiler/conformance should validate new presentation metadata."). The compiler's existing "generic UI renderability checks" step (`pack-authoring.md`) must validate this expanded metadata the same way it validates today's fields, once implemented.

### Decision Guide

**Status: the schema and both hero packs' content are implemented.** Change-set §47 and ADR 0006 decision 6 specify a declarative, pack-level Decision Guide: domain purpose, discovery strategy, suggested questions, important unknowns, research guidance, custom-field guidance, and presentation guidance for the class of decision the pack represents. `DecisionGuideSchema` (`packages/contracts/src/packs.ts`) implements exactly these seven fields as a `.strict()`-validated, optional manifest field, and both `car-purchase` and `home-energy-guardian` declare real, non-placeholder content for every field. Omitting the guide entirely is structurally incapable of changing an existing pack's `compiledHash`, because canonicalization filters `undefined` keys before hashing — a pack that adopts a guide later does not silently invalidate cases pinned to its pre-guide hash, and one that never adopts a guide is unaffected. **The read path is implemented too:** `sift_get_decision_guide` (READ) exposes this guide to ChatGPT using progressive disclosure — see `webmcp.md` for its exact input/effect contract. `product.md`'s Decision Profile `suggestedQuestions` separately consumes this guide's `suggestedQuestions` field directly from `CaseState`, independent of the WebMCP tool.

**This is data, not instructions, and that is a hard boundary, not a style preference.** It must never be implemented as hidden prompt injection or as content that attempts to override host or system-level instructions (change-set §17/§47). A pack author can still write persuasive prose inside a field like `discoveryStrategy` — `safeString` rejects HTML and `javascript:` URIs, not persuasive English — so the actual guarantee is structural, not linguistic: there is no free-form `instructions`/`systemPrompt`-shaped field for such content to occupy (`.strict()` rejects one), the guide is consumed as typed JSON in named fields and never concatenated into a system prompt, and — decisively — no tool path reaches proposal approval regardless of what any pack's guide content says. Human authority is enforced in the deterministic core, not by the model declining to be persuaded.

**The Decision Guide is data, not instructions, and this is a hard boundary, not a style preference.** It must never be implemented as hidden prompt injection or as content that attempts to override host or system-level instructions (change-set §17/§47: "it must remain data, not executable prompts capable of overriding system authority... do not attempt prompt injection... do not pretend it is a host-level system prompt"). Tool descriptions and structured tool outputs remain the entire integration mechanism — there is no second, hidden channel. A Decision Guide implementation that lets pack content instruct the model to disregard other instructions, impersonate a system prompt, or execute anything is a defect against this specification, not a legitimate reading of it. The compiler must reject free-form executable or instruction-shaped content in this field the same way it already rejects HTML/script content elsewhere in pack manifests (see `pack-authoring.md`'s stable entity envelope).

## Obligation template

```ts
interface ObligationTemplate {
  id: string
  label: string
  question: string
  category: string
  required: boolean
  priority: number
  requiredEvidenceLevel: 'E0' | 'E1' | 'E2' | 'E3'
  maxAttempts: number
  acceptedUncertaintyAllowed: boolean
  dependsOn: string[]
  preferredSkills: string[]
  preferredSpecialists: string[]
  completionRule: CompletionRule
  origin: 'pack' | 'case_extension'
  dependsOnCriteria?: boolean
}
```

`dependsOnCriteria` (optional, defaults to false) marks an obligation whose answer is a *synthesis over the case's criteria* rather than a measurement of the world. A criteria reweight does not invalidate a measurement — how much of a bill came from a tariff change is unaffected by how much the household now cares about long-term waste — but it does invalidate an answer that was a synthesis over those criteria's weights. When `updateCriteria` changes an active recommendation, only obligations carrying this flag reopen (their `attemptsUsed` is preserved, not reset, so the pack's attempt budget cannot be looped by repeated reweights); every other satisfied obligation stands. Without this distinction, `selectNextObligation` — which only considers `open` obligations — has nothing to select once every obligation is satisfied, and the required adaptive moment "changing the criterion changes option ranking" becomes unreachable through the product's own controls. Home Energy Guardian's `energy.response_options` obligation is the concrete example: its own question ("Which actions fit the user's cost and conservation criteria?") names the criteria directly, so it is the one obligation in that pack that sets `dependsOnCriteria: true`.

Evidence levels are:

- `E0`: unverified statement or user-provided assertion;
- `E1`: one traceable source or deterministic extraction;
- `E2`: corroborated by two independent sources or one authoritative source;
- `E3`: verified by a domain-specific deterministic check or explicit human attestation.

A non-stale `error` or `degraded` evidence result blocks completion for that obligation. Failed and skipped results remain visible but do not raise evidence level.

## Watch declarations (Standing Watch)

**Specified, not yet implemented.** Full rationale in docs/decisions/0015-standing-watch-and-background-triggers.md. `watches` is optional and defaults to absent; a pack that declares none compiles, hashes, and behaves exactly as it does today — canonicalization drops `undefined` keys before hashing (`packages/packs/src/canonicalize.ts`), the same rule that already lets `decisionGuide` and `discovery` be adopted without disturbing an already-pinned case's `compiledHash`. Of the two hero packs and `bid-comparison`, only `bid-comparison` is intended to declare any (ADR 0015, "Pack scope"); `car-purchase` and `home-energy-guardian` are untouched by this feature.

```ts
interface WatchDeclaration {
  id: string
  label: string
  description: string
  kind: 'push' | 'time' | 'query'
  feed: string
  predicate: string
  pollIntervalMs?: number
  triage: 'model' | 'deterministic'
  reopens: string[]
  specialistId?: string
  budget: { toolCalls: number; modelCalls: number }
  defaultInterruptPolicy: 'decision_only' | 'any_change' | 'never'
}
```

- **`kind`** selects the trigger primitive the scheduler dispatcher uses for this watch — `push` (a listener on `feed`), `time` (a tick comparing a stored deadline to the injected `Clock`), or `query` (a tick that polls `feed` on `pollIntervalMs`). `pollIntervalMs` is required when `kind === 'query'` and meaningless otherwise; the compiler rejects a `query` watch that omits it and rejects a non-`query` watch that supplies it, the same "a field only makes sense for one variant" discipline `ObligationTemplate.dependsOnCriteria` already documents for a different field.
- **`feed`** names a fixture feed id in every build this specification covers — the same contract a real external source would later satisfy, never a live connection today. See "Honesty boundary" below and docs/decisions/0015's own section of the same name.
- **`predicate`** is a deterministic, core-owned description of what counts as "this watch fired" for this trigger kind (e.g. "a document in `feed` has a newer revision than the one this case last recorded," "the stored deadline is before `clock.now()`"). The predicate decides whether a trigger fired at all; it never decides whether a fired trigger is worth acting on — that is `triage`.
- **`triage`** is `'model'` for the ordinary case (a small triage agent judges materiality, bounded by `budget`, exactly as docs/decisions/0015 Decision 5 describes) or `'deterministic'` for a watch whose materiality is itself a computable fact requiring no judgment at all (e.g. "a hard constraint attribute changed value" needs no model to decide it matters). A `'deterministic'` watch still emits `watch.triaged`, with its verdict computed rather than model-produced, so the event vocabulary a consumer reads does not have to branch on how a watch happened to be built.
- **`reopens`** lists obligation ids this watch's bounded work may reopen when triage finds it material — never obligation ids outside the pack's own declared set, checked at compile time the same way `ObligationTemplate.dependsOn` references are. When a watch reopens an obligation, `attemptsUsed` is preserved, not reset — the same rule `ObligationTemplate.dependsOnCriteria` already states for a criteria-driven reopen, and for the identical reason: an attempt budget must not be loopable by repeated background triggers any more than by repeated person-initiated reweights.
- **`specialistId`**, when present, must name a specialist the pack already declares (`SpecialistDefinition`); a watch introduces no new capability, only a new reason to invoke an existing one.
- **`budget`** is the tightened `BudgetGuard` configuration for this watch's background work — deliberately separate from, and typically smaller than, a foreground run's default bounds (`strands-runtime.md` "Engine loop"), since nobody is watching a background run in real time to decide whether to let it keep going.
- **`defaultInterruptPolicy`** is this watch's contribution to the interrupt decision (docs/decisions/0015 Decision 5) when the case itself carries no override. The case-level override, when present, applies to every watch on the case uniformly — a per-watch override is explicitly out of scope for this decision (see ADR 0015's "Alternatives considered" and "Revisit conditions").

Manifest compilation extends its existing rejection list (`packs-and-routing.md` "Manifest contract") to reject: a `watches[]` entry whose `id` collides with another watch on the same pack; a `reopens` id absent from the pack's own `obligations`; a `specialistId` absent from the pack's own `specialists`; a `query`-kind watch missing `pollIntervalMs` or a non-`query` watch supplying one; and a `feed` value that is not a registered fixture feed id in this build.

## Router input and output

```ts
interface RoutingInput {
  explicitPackId?: string
  activeCasePack?: { id: string; version: string; compiledHash: string }
  userGoal: string
  route: string
  artifactKinds: string[]
  entitySignals: string[]
}

interface RoutingCandidate {
  packId: string
  version: string
  compiledHash: string
  confidence: number
  reasons: string[]
  matchedSignals: string[]
}

interface RoutingDecision {
  kind: 'selected' | 'needs_confirmation' | 'no_match'
  selected: RoutingCandidate | null
  candidates: RoutingCandidate[]
}
```

## Routing algorithm

Routing follows this order. The pinned-case check runs unconditionally before every other step, including explicit selection — a pinned case's ID/version/hash can never be overridden by any input, since "the router cannot change it" is an absolute guarantee, not one that only holds when the caller happens not to also pass an `explicitPackId`:

1. If an active case is pinned, return that exact ID, version, and compiled hash regardless of any other input on the request. The router cannot change it.
2. Otherwise, if `explicitPackId` references an installed pack, select it with reason `User selected this Decision Pack`.
3. Compute a deterministic signal score from keywords, artifact kinds, entity signals, and exclusions.
4. Ask a Strands router agent for structured candidate IDs and semantic confidence. The agent receives only registered pack metadata, never full pack instructions.
5. Merge deterministic and semantic scores with weights `0.6` and `0.4`.
6. Select automatically only when the top score is at least `0.75` and exceeds the second score by at least `0.20`.
7. Otherwise return at most two candidates for user confirmation.
8. Reject any candidate ID, version, or hash absent from the compiled registry.

When the model is unavailable, deterministic routing remains functional for the two demos: with no semantic candidates, the merged score is deterministic-only and is mathematically capped at `0.6` under the weights above — below the `0.75` auto-select floor by construction. "Functional" therefore means the router always produces a safe `needs_confirmation` result with real candidates and reasons for the user to choose from; it never means the router still auto-selects without a model. This is the intended, safer behavior, not a degraded one.

The `0.6`/`0.4` merge weights and the `0.75`/`0.20` selection thresholds are constants tuned for this hackathon's two-pack catalog, not a derived or general-purpose routing algorithm result. Submission copy and demo narration must describe them as such rather than as a scientifically validated routing model.

The UI always displays the selected Decision Pack and reasons. User override is available until the first evidence event. After evidence exists, changing packs requires starting a new case so evidence is never reinterpreted under different rules.

## Pack selection versus adaptive execution

Pack selection happens once per case. Skill, specialist, tool, and next-question selection happen on every engine move.

```text
Case: Choose our next family car
Pinned pack: car-purchase@1.0.0#<compiledHash>

Move 1: activate listing-normalizer; invoke deal-analyst
Move 2: activate ownership-cost; invoke ownership-cost-analyst
User adds: two dog crates must fit
Move 3: create case extension; activate household-fit; request dimensions
Move 4: record fit as unknown until human measurement or test drive
```

The runtime may change the run plan, skills, and specialists without changing the case's installed pack, required obligations, authority, or completion semantics.

## Choose Our Next Car Decision Pack

Pack ID: `car-purchase@1.0.0`  
Orchestration: deterministic Strands Graph with bounded model work inside each node.

### Activation

- Intents: compare shortlisted cars, understand a dealer offer, choose what to test-drive, evaluate household vehicle fit.
- Artifacts: household priorities, candidate details, listing or offer terms, ownership-cost assumptions, safety and reliability sources.
- Exclusions: mechanical diagnosis, financing applications, negotiation/contact automation, reservations, scheduling, and purchases.

### Required obligations

| ID | Question | Evidence | Attempts |
| --- | --- | --- | --- |
| `car.hard_constraints` | Which candidates satisfy the household's budget and non-negotiable needs? | E1 | 2 |
| `car.deal_normalization` | What is each candidate's comparable out-the-door price and which terms or add-ons are uncertain? | E2 | 2 |
| `car.ownership_cost` | What is the comparable five-year ownership estimate under the same assumptions? | E2 | 2 |
| `car.safety_reliability` | Which material safety and reliability differences are supported by traceable sources? | E2 | 3 |
| `car.household_fit` | Which needs can be established from specifications and which require household judgment or a test drive? | E1 | 2 |
| `car.shortlist` | Which candidate should advance, what could change that result, and what remains to verify? | E2 | 2 |

### Extensions

- `allowCaseAttributes`, `allowCaseCriteria`, and `allowCaseObligations` are true.
- The `car.user_concern` template accepts hard constraints, preferences, and human-observation questions.
- A user concern that cannot be established from available sources becomes a test-drive or household-measurement question instead of an invented score.
- Required deal, cost, safety/reliability, household-fit, and shortlist obligations cannot be deleted.

### Skills, specialists, and tools

- Skills: `listing-normalizer`, `deal-analysis`, `ownership-cost`, `safety-reliability`, `household-fit`, `decision-synthesis`.
- Specialists: `deal-analyst`, `ownership-cost-analyst`, `safety-reliability-analyst`, `household-fit-analyst`, `source-challenger`, `decision-synthesizer`.
- Fixture tools: listing/offer reader, specification lookup, safety/reliability source lookup, ownership calculator, household-fit matrix.
- Optional live tools: bounded public automotive source adapters and user/ChatGPT-submitted source intake. A model has no general internet access unless an installed tool explicitly supplies it.
- Consequential effect: advancing candidates to the household's test-drive shortlist requires explicit human approval. The pack cannot contact a dealer, schedule a test drive, reserve a car, apply for financing, negotiate, or purchase anything.

### Required adaptive moments

- A teaser-price claim conflicts with mandatory add-ons and financing terms, making the prior deal score stale and activating `source-challenger`.
- Selecting a candidate in the UI makes that exact candidate available to ChatGPT through WebMCP.
- Reweighting driving comfort above fuel economy reopens household fit; Sift creates a test-drive question instead of fabricating a comfort score.
- Adding an unanticipated household criterion creates a typed case extension and targeted investigation without recompiling the pack.
- The favored shortlist candidate changes after normalized deal terms and the user's criteria update.

## Home Energy Guardian Decision Pack

Pack ID: `home-energy-guardian@1.0.0`  
Orchestration: bounded Strands Swarm with deterministic readiness outside the Swarm.

### Activation

- Intents: unusual bill, household energy monitoring, rate-plan comparison, unexplained usage increase.
- Artifacts: utility bill, usage history, rate schedule, weather history, household event log.
- Exclusion: electrical danger, gas leak, fire, or medical equipment risk. The demo stops and presents emergency guidance.

### Required obligations

| ID | Question | Evidence | Attempts |
| --- | --- | --- | --- |
| `energy.anomaly` | Is the current bill materially abnormal? | E3 | 1 |
| `energy.rate_change` | How much of the increase comes from tariff or fee changes? | E2 | 2 |
| `energy.weather` | How much is explained by weather-normalized usage? | E2 | 2 |
| `energy.household_change` | Did a household or appliance event plausibly change consumption? | E1 | 2 |
| `energy.response_options` | Which actions fit the user's cost and conservation criteria? | E2 | 2 |

### Extensions

- `allowCaseAttributes`, `allowCaseCriteria`, and `allowCaseObligations` are true.
- The `energy.user_concern` template can capture comfort, budget, environmental, equipment, accessibility, and household-specific questions.
- Safety exclusions and emergency policies are protected and cannot be reweighted or removed.

### Skills, specialists, and tools

- Skills: `bill-normalizer`, `weather-comparison`, `rate-plan-analysis`, `home-event-correlation`, `decision-synthesis`.
- Specialists: `anomaly-investigator`, `rate-analyst`, `weather-analyst`, `home-systems-analyst`, `source-challenger`, `decision-synthesizer`.
- Tools: fixture bill reader, historical usage query, tariff lookup, weather lookup, household event lookup, calculator.
- Consequential effects: requesting an inspection is a proposal requiring human confirmation. The pack does not schedule an appointment.

### Required adaptive moments

- The engine investigates the anomaly in the background before creating a human action.
- Weather explains part but not all of the spike, causing the engine to activate home-event correlation.
- Repeated work without evidence gain triggers steering and a specialist handoff.
- Changing the criterion from lowest immediate cost to long-term waste reduction changes option ranking. `energy.response_options` is the one obligation in this pack with `dependsOnCriteria: true` (see "Obligation template" above), so a reweight reopens exactly that obligation — the four measurement obligations it depends on stay satisfied — and a plain re-run finds it without a targeted `obligationId`. Reachable from a real UI control (`CriteriaEditor`, opened from the app bar's "Add or adjust → Adjust priorities" item) as well as through `sift_update_criteria`, per docs/engineering-principles.md's "Visible UI controls and WebMCP callbacks use the same command implementation."
- The system asks for confirmation before creating an inspection proposal.

The pack's shipped default weighting is cost-heavy (`energy.cost` outweighs `energy.conservation`): a household that just opened an anomalously high bill wants the number smaller before it wants long-term waste reduced, and the round-1 investigation's own recommendation has to agree with whatever the default actually is, or the product's hero card states two disagreeing numbers for the same comparison. The exact weight values are an implementation constant (`packages/packs/src/home-energy-guardian.ts`), not a spec-level commitment; what this spec requires is that the pack's default weighting and its round-1 narration never drift apart, which `home-energy-guardian.test.ts` enforces.
