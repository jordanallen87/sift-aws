/**
 * `compilePack(source, catalog, clock): CompiledDecisionPack`, implementing
 * the exact 11-step pipeline in pack-authoring.md "Compiler and registry"
 * and the rejection list in packs-and-routing.md "Manifest contract":
 * "duplicate IDs, missing references, unknown capabilities, cycles without
 * execution bounds, missing approval policies for consequential effects,
 * invalid extension rules, UI fields the generic renderer cannot display,
 * and evaluation suites without negative cases."
 *
 * `compilePack` is exhaustive, not fail-fast: every step from 3 through 10
 * runs and every issue it finds is collected into one `PackCompilationError`
 * (mirroring `conformance.ts`'s "report every check, don't stop at the
 * first failure" philosophy) rather than throwing on the first violation
 * encountered. Only step 1 (schema validation) short-circuits the rest of
 * the pipeline, since steps 3-10 all assume a structurally valid manifest
 * to walk.
 *
 * Judgment calls requiring inference beyond the prose spec (each also
 * documented at its call site below, and in the dated docs/build-log.md
 * entry with full reasoning):
 *
 * 1. Steps 1 ("source schema and size validation") and 2 ("stable ID and
 *    semantic-version validation") both fold into a single
 *    `DecisionPackManifestSchema.safeParse(source)` call: `PackIdentitySchema`
 *    (packs.ts) already enforces the pack-id charset and semver format via
 *    its own regexes, and every array in the manifest already carries a
 *    `.max(...)` size bound. There is nothing left for a distinct "step 2"
 *    to check once step 1's `safeParse` has succeeded.
 * 2. Step 4 ("attribute, criterion, and obligation rule compilation") is a
 *    pure *derivation*, not a rejection check: it produces
 *    `runtimeValidators` (`CompiledValidatorReferences`) -- one validator
 *    reference per declared attribute and per declared obligation. The real
 *    validator *implementations* are a separate, later workstream (the
 *    pack-specific skills/specialists build); this compiler only proves
 *    every attribute/obligation has a stable, deterministic validator
 *    reference id waiting for that implementation to claim.
 * 3. Step 6's "Graph reachability/cycle bounds or Swarm membership/bounds
 *    checks" -- see `validateOrchestrationBounds` below for the concrete,
 *    schema-grounded rules chosen, since `OrchestrationDefinitionSchema`
 *    carries no node/edge/member topology to walk.
 * 4. Step 7's "human-authority and prohibited-effect checks" -- see
 *    `checkApprovalPolicies` below.
 * 5. Step 8's "invalid extension rules" -- see `checkExtensionPolicy` below.
 * 6. Step 9's "generic UI renderability checks" -- see `checkUiRenderability`
 *    below.
 * 7. Step 10's "evaluation suites without negative cases" -- see
 *    `validateNegativeScenarios` below.
 */
import {
  CompiledDecisionPackSchema,
  DecisionPackManifestSchema,
  type CompiledDecisionPack,
  type CompiledValidatorReferences,
  type DecisionPackManifest,
  type OrchestrationDefinition,
  type PackEvaluationDefinition,
  type ResolvedCapabilityCatalog,
} from '@sift/contracts';
import type { Clock } from '@sift/core';
import { SiftDomainError } from '@sift/core';
import { canonicalizeManifest, hashManifest } from './canonicalize.js';
import { capabilityKey, resolveCapabilityReferences } from './capability-catalog.js';
import type { CapabilityCatalog } from './capability-catalog.js';

/** One rejection found while compiling a manifest. `step` names the pack-authoring.md pipeline step (folding steps 1+2, per judgment call #1 above) that found it. */
export interface PackCompilationIssue {
  readonly step:
    | 'schema'
    | 'duplicate_id'
    | 'dangling_reference'
    | 'unknown_capability'
    | 'orchestration_bounds'
    | 'approval_policy'
    | 'extension_policy'
    | 'ui_renderability'
    | 'negative_scenarios';
  readonly message: string;
  /** A dotted/bracketed path into the manifest, e.g. `obligations[0].preferredSkills[0]`, when applicable. */
  readonly path?: string;
}

export class PackCompilationError extends SiftDomainError {
  readonly code = 'PACK_COMPILATION_FAILED' as const;
  readonly issues: readonly PackCompilationIssue[];

  constructor(issues: readonly PackCompilationIssue[]) {
    const summary = issues.map((issue) => `[${issue.step}] ${issue.message}`).join('; ');
    super(`Decision Pack manifest failed compilation with ${issues.length} issue(s): ${summary}`);
    this.issues = issues;
  }
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return Array.from(duplicates);
}

/** Step 3a: duplicate IDs within each manifest collection. Uniqueness is enforced per collection (its own ID namespace), not across collections -- a `car.hard_constraints` obligation ID and an unrelated `car.hard_constraints` attribute ID do not collide in the runtime model, since attributes/criteria/obligations/skills/specialists/tools/policies/entities are each addressed through their own typed field, never through one shared global ID space. */
function checkDuplicateIds(manifest: DecisionPackManifest): PackCompilationIssue[] {
  const collections: { name: string; ids: string[] }[] = [
    { name: 'entities', ids: manifest.entities.map((entity) => entity.id) },
    { name: 'attributes', ids: manifest.attributes.map((attribute) => attribute.id) },
    { name: 'criteria.defaults', ids: manifest.criteria.defaults.map((criterion) => criterion.id) },
    { name: 'obligations', ids: manifest.obligations.map((obligation) => obligation.id) },
    { name: 'skills', ids: manifest.skills.map((skill) => skill.id) },
    { name: 'specialists', ids: manifest.specialists.map((specialist) => specialist.id) },
    { name: 'tools', ids: manifest.tools.map((tool) => tool.id) },
    { name: 'policies', ids: manifest.policies.map((policy) => policy.id) },
  ];

  const issues: PackCompilationIssue[] = [];
  for (const collection of collections) {
    for (const duplicateId of findDuplicates(collection.ids)) {
      issues.push({
        step: 'duplicate_id',
        message: `Duplicate id "${duplicateId}" in ${collection.name}.`,
        path: collection.name,
      });
    }
  }
  return issues;
}

function checkReferencesExist(
  referencingIds: readonly string[],
  knownIds: ReadonlySet<string>,
  pathPrefix: string,
  describeTarget: string,
): PackCompilationIssue[] {
  const issues: PackCompilationIssue[] = [];
  for (const id of referencingIds) {
    if (!knownIds.has(id)) {
      issues.push({
        step: 'dangling_reference',
        message: `${pathPrefix} references ${describeTarget} "${id}", which is not declared.`,
        path: pathPrefix,
      });
    }
  }
  return issues;
}

/**
 * Step 3b: every manifest-internal ID reference resolves to a declared ID
 * in the collection it names. This is distinct from step 5's capability
 * *allowlist* resolution (which checks a reference against the installed
 * catalog, not against the manifest's own declarations) and from step 9's
 * renderability check (an attribute that exists but is never assigned to a
 * presentation group, the opposite direction of a dangling reference).
 */
function checkDanglingReferences(manifest: DecisionPackManifest): PackCompilationIssue[] {
  const attributeIds = new Set(manifest.attributes.map((attribute) => attribute.id));
  const criterionIds = new Set(manifest.criteria.defaults.map((criterion) => criterion.id));
  const obligationIds = new Set(manifest.obligations.map((obligation) => obligation.id));
  const skillIds = new Set(manifest.skills.map((skill) => skill.id));
  const specialistIds = new Set(manifest.specialists.map((specialist) => specialist.id));
  const toolIds = new Set(manifest.tools.map((tool) => tool.id));

  const issues: PackCompilationIssue[] = [];

  for (const entity of manifest.entities) {
    issues.push(
      ...checkReferencesExist(
        entity.attributeIds,
        attributeIds,
        `entities["${entity.id}"].attributeIds`,
        'attribute',
      ),
    );
  }

  issues.push(
    ...checkReferencesExist(
      manifest.criteria.protectedCriterionIds,
      criterionIds,
      'criteria.protectedCriterionIds',
      'criterion',
    ),
  );

  for (const obligation of manifest.obligations) {
    for (const dependsOnId of obligation.dependsOn) {
      if (dependsOnId === obligation.id) {
        issues.push({
          step: 'dangling_reference',
          message: `Obligation "${obligation.id}" depends on itself.`,
          path: `obligations["${obligation.id}"].dependsOn`,
        });
      }
    }
    issues.push(
      ...checkReferencesExist(
        obligation.dependsOn.filter((id) => id !== obligation.id),
        obligationIds,
        `obligations["${obligation.id}"].dependsOn`,
        'obligation',
      ),
      ...checkReferencesExist(
        obligation.preferredSkills,
        skillIds,
        `obligations["${obligation.id}"].preferredSkills`,
        'skill',
      ),
      ...checkReferencesExist(
        obligation.preferredSpecialists,
        specialistIds,
        `obligations["${obligation.id}"].preferredSpecialists`,
        'specialist',
      ),
    );
  }

  for (const specialist of manifest.specialists) {
    issues.push(
      ...checkReferencesExist(
        specialist.allowedTools,
        toolIds,
        `specialists["${specialist.id}"].allowedTools`,
        'tool',
      ),
      ...checkReferencesExist(
        specialist.allowedSkills ?? [],
        skillIds,
        `specialists["${specialist.id}"].allowedSkills`,
        'skill',
      ),
    );
  }

  for (const policy of manifest.policies) {
    issues.push(
      ...checkReferencesExist(
        policy.appliesToToolIds ?? [],
        toolIds,
        `policies["${policy.id}"].appliesToToolIds`,
        'tool',
      ),
    );
  }

  for (const group of manifest.presentation.attributeGroups) {
    issues.push(
      ...checkReferencesExist(
        group.attributeIds,
        attributeIds,
        `presentation.attributeGroups["${group.id}"].attributeIds`,
        'attribute',
      ),
    );
  }

  return issues;
}

/** Step 4: pure derivation of runtime validator references -- no rejection logic. See judgment call #2 above. */
function compileValidatorReferences(manifest: DecisionPackManifest): CompiledValidatorReferences {
  return {
    attributeValidatorIds: manifest.attributes.map((attribute) => attribute.id),
    obligationValidatorIds: manifest.obligations.map((obligation) => obligation.id),
  };
}

/**
 * Step 6: `OrchestrationDefinitionSchema` (packs.ts) has no node/edge/member
 * topology field to check reachability or cycles against -- only
 * `strategy` plus numeric bounds. So "Graph reachability/cycle bounds or
 * Swarm membership/bounds checks" is implemented as three schema-grounded
 * coherence rules over those bounds, each directly quoting the spec
 * language that requires it:
 *
 * 1. `nodeTimeoutMs <= totalTimeoutMs` for every strategy -- a single
 *    node/agent step cannot legitimately be allowed to run longer than the
 *    orchestration's own total time budget; nothing in
 *    `OrchestrationDefinitionSchema` cross-validates these two independent
 *    numeric ranges against each other.
 * 2. `strategy: 'graph'` requires `maxConcurrency` to be set.
 *    strands-runtime.md: "Graphs set `maxSteps`, timeouts, and concurrency
 *    explicitly." -- `maxConcurrency` is optional in the schema (so a
 *    Swarm-only pack need not declare it), but a Graph-strategy pack that
 *    omits it has not, in fact, set concurrency explicitly.
 * 3. `strategy: 'swarm'` requires both `repetitiveHandoffDetectionWindow`
 *    and `repetitiveHandoffMinUniqueAgents` to be set.
 *    strands-runtime.md: "The Swarm sets `maxSteps`, execution timeout,
 *    node timeout, and repetitive-handoff detection." -- this is precisely
 *    the "cycles without execution bounds" case from packs-and-routing.md's
 *    manifest-contract rejection list: without a repetitive-handoff bound,
 *    a Swarm has no configured defense against an unbounded handoff cycle.
 */
export function validateOrchestrationBounds(
  orchestration: OrchestrationDefinition,
): PackCompilationIssue[] {
  const issues: PackCompilationIssue[] = [];

  if (orchestration.nodeTimeoutMs > orchestration.totalTimeoutMs) {
    issues.push({
      step: 'orchestration_bounds',
      message: `orchestration.nodeTimeoutMs (${orchestration.nodeTimeoutMs}) must not exceed orchestration.totalTimeoutMs (${orchestration.totalTimeoutMs}).`,
      path: 'orchestration.nodeTimeoutMs',
    });
  }

  if (orchestration.strategy === 'graph' && orchestration.maxConcurrency === undefined) {
    issues.push({
      step: 'orchestration_bounds',
      message:
        'A "graph" orchestration must declare an explicit orchestration.maxConcurrency bound.',
      path: 'orchestration.maxConcurrency',
    });
  }

  if (orchestration.strategy === 'swarm') {
    if (orchestration.repetitiveHandoffDetectionWindow === undefined) {
      issues.push({
        step: 'orchestration_bounds',
        message:
          'A "swarm" orchestration must declare orchestration.repetitiveHandoffDetectionWindow to bound handoff cycles.',
        path: 'orchestration.repetitiveHandoffDetectionWindow',
      });
    }
    if (orchestration.repetitiveHandoffMinUniqueAgents === undefined) {
      issues.push({
        step: 'orchestration_bounds',
        message:
          'A "swarm" orchestration must declare orchestration.repetitiveHandoffMinUniqueAgents to bound handoff cycles.',
        path: 'orchestration.repetitiveHandoffMinUniqueAgents',
      });
    }
  }

  return issues;
}

/**
 * Step 7: "missing approval policies for consequential effects." A
 * `ToolDeclaration` with `effect: 'consequential'` must (a) itself declare
 * `requiresApproval: true` -- the tool's own posture -- AND (b) be covered
 * by at least one `PolicyDefinition` with `requiresHumanApproval: true`
 * whose `appliesToToolIds` either omits the field (read as "applies to
 * every tool", the natural meaning of an unscoped policy) or explicitly
 * lists the tool's id. Requiring both is deliberate: `requiresApproval`
 * alone is a self-declared flag with nothing enforcing it, and a
 * `requiresHumanApproval` policy with no matching tool is unreachable
 * dead configuration; only the pair together proves architecture.md's
 * `ConsequenceGuard` ("confirms a consequential proposal ... for a named
 * tool call") has something concrete to enforce. This also folds in step
 * 7's "prohibited-effect checks": a consequential effect missing this
 * wiring is precisely the shape of a prohibited effect slipping through
 * ungated, so no separate check is needed for it.
 */
export function checkApprovalPolicies(manifest: DecisionPackManifest): PackCompilationIssue[] {
  const issues: PackCompilationIssue[] = [];
  const humanApprovalPolicies = manifest.policies.filter((policy) => policy.requiresHumanApproval);

  for (const tool of manifest.tools) {
    if (tool.effect !== 'consequential') {
      continue;
    }

    if (!tool.requiresApproval) {
      issues.push({
        step: 'approval_policy',
        message: `Consequential tool "${tool.id}" must declare requiresApproval: true.`,
        path: `tools["${tool.id}"].requiresApproval`,
      });
    }

    const isCovered = humanApprovalPolicies.some(
      (policy) =>
        policy.appliesToToolIds === undefined || policy.appliesToToolIds.includes(tool.id),
    );
    if (!isCovered) {
      issues.push({
        step: 'approval_policy',
        message: `Consequential tool "${tool.id}" has no policy with requiresHumanApproval: true covering it.`,
        path: `tools["${tool.id}"]`,
      });
    }
  }

  return issues;
}

/**
 * Step 8: "invalid extension rules." `extensionPolicy.userConcernTemplateId`
 * cannot itself be missing/empty -- `idString()` already requires a
 * non-empty, charset-restricted string at the schema layer (step 1) -- so
 * the prompt's illustrative "`allowCaseObligations: true` but no
 * `userConcernTemplateId`" case is re-grounded as two checks that are
 * actually reachable past that schema constraint:
 *
 * 1. `allowCaseObligations: true` requires `allowCaseCriteria: true`.
 *    packs-and-routing.md "Flexible attributes and criteria": "When a
 *    custom criterion needs evidence, the core derives a case obligation
 *    from the pack's `userConcern` template." Case obligations are always
 *    *derived from* case criteria in this model -- a pack that allows case
 *    obligations while forbidding case criteria describes a rule with no
 *    coherent trigger, i.e. an invalid extension rule.
 * 2. `userConcernTemplateId` must not collide with a real declared
 *    `obligations[].id`. The template id is a distinct, reserved token the
 *    core uses to derive new case-scoped obligation ids from (per
 *    pack-authoring.md: `case.<caseId>.dog-crate-fit`-shaped); aliasing it
 *    to an existing required pack obligation's id would let a case
 *    extension's generated obligation collide with (and potentially be
 *    confused for, or overwrite) that already-required obligation --
 *    silently undermining "Required pack obligations ... cannot be
 *    removed."
 */
export function checkExtensionPolicy(manifest: DecisionPackManifest): PackCompilationIssue[] {
  const issues: PackCompilationIssue[] = [];
  const { extensionPolicy } = manifest;

  if (extensionPolicy.allowCaseObligations && !extensionPolicy.allowCaseCriteria) {
    issues.push({
      step: 'extension_policy',
      message:
        'extensionPolicy.allowCaseObligations is true but extensionPolicy.allowCaseCriteria is false; case obligations are always derived from case criteria.',
      path: 'extensionPolicy.allowCaseObligations',
    });
  }

  const obligationIds = new Set(manifest.obligations.map((obligation) => obligation.id));
  if (obligationIds.has(extensionPolicy.userConcernTemplateId)) {
    issues.push({
      step: 'extension_policy',
      message: `extensionPolicy.userConcernTemplateId ("${extensionPolicy.userConcernTemplateId}") collides with a declared obligation id.`,
      path: 'extensionPolicy.userConcernTemplateId',
    });
  }

  return issues;
}

/**
 * Step 9: "generic UI renderability checks." `AttributeDefinition.valueType`
 * is already a closed Zod enum of every `AttributeValue` variant (step 1
 * rejects anything else structurally), so the reachable renderability
 * failure is not "an unrenderable value type" but "a declared attribute the
 * generic right-pane UI has nowhere to place": every non-`sensitive`
 * attribute must be listed in at least one
 * `presentation.attributeGroups[].attributeIds`, since product.md's
 * schema-driven, pack-agnostic renderer walks `presentation.attributeGroups`
 * to lay out attribute fields -- an attribute absent from every group is
 * declared but permanently invisible. `sensitive` attributes are exempt:
 * the generic renderer is expected to handle them via redaction/masking
 * rather than an ordinary group listing, so their absence from a group is
 * not by itself an unrenderable-field defect. (A presentation group
 * pointing at an attribute id that does not exist at all is the opposite
 * failure -- a dangling reference -- and is already caught by step 3's
 * `checkDanglingReferences`, not repeated here.)
 */
/**
 * Every lens must name attributes this pack actually declares, and must name
 * each one once.
 *
 * Without this a typo is invisible at authoring time and silently degrading
 * at runtime: selecting the lens writes `visibleAttributeIds` containing an
 * id nothing matches, so the person gets a comparison with a column missing
 * and no indication anything went wrong. A duplicate is the same class of
 * quiet defect -- it renders the same column twice.
 */
export function checkLensReferences(manifest: DecisionPackManifest): PackCompilationIssue[] {
  const lenses = manifest.lenses ?? [];
  if (lenses.length === 0) return [];

  const declaredAttributeIds = new Set(manifest.attributes.map((attribute) => attribute.id));
  const issues: PackCompilationIssue[] = [];

  for (const lens of lenses) {
    const seen = new Set<string>();
    for (const attributeId of lens.attributeIds) {
      if (!declaredAttributeIds.has(attributeId)) {
        issues.push({
          step: 'ui_renderability' as const,
          message: `Lens "${lens.id}" names attribute "${attributeId}", which this pack does not declare, so selecting it would hide a column with no explanation.`,
          path: `lenses["${lens.id}"].attributeIds`,
        });
      }
      if (seen.has(attributeId)) {
        issues.push({
          step: 'ui_renderability' as const,
          message: `Lens "${lens.id}" names attribute "${attributeId}" more than once, which would render the same column twice.`,
          path: `lenses["${lens.id}"].attributeIds`,
        });
      }
      seen.add(attributeId);
    }
  }

  return issues;
}

export function checkUiRenderability(manifest: DecisionPackManifest): PackCompilationIssue[] {
  const renderableAttributeIds = new Set(
    manifest.presentation.attributeGroups.flatMap((group) => group.attributeIds),
  );

  return manifest.attributes
    .filter((attribute) => !attribute.sensitive && !renderableAttributeIds.has(attribute.id))
    .map((attribute) => ({
      step: 'ui_renderability' as const,
      message: `Attribute "${attribute.id}" is not assigned to any presentation.attributeGroups entry, so the generic renderer has nowhere to display it.`,
      path: `attributes["${attribute.id}"]`,
    }));
}

/**
 * Step 10: "evaluation suites without negative cases." `PackEvaluationDefinition`
 * (packs.ts) carries only a flat `scenarioIds: string[]` -- no per-scenario
 * outcome-kind metadata (success/incomplete-evidence/steering/human-
 * boundary), since scenario *content* lives in separate
 * `scenarios/<scenario-id>.json` bundle files (pack-authoring.md's pack
 * bundle layout), not inside the manifest this compiler validates. The
 * manifest-level proxy available for "includes a negative case" is
 * therefore the author-declared `requiresNegativeCase` boolean itself: the
 * compiler treats a manifest that does not affirmatively declare
 * `requiresNegativeCase: true` as *not proving* it has one, and a
 * manifest with zero scenarios as unable to have one regardless of the
 * flag. Deeper verification that a real negative-scenario file exists and
 * actually asserts failure/incomplete-evidence semantics is
 * `pnpm test:pack`'s and `runPackConformance`'s job (see `conformance.ts`),
 * which can execute the scenario files this static manifest-only compiler
 * cannot see.
 */
export function validateNegativeScenarios(
  evaluation: PackEvaluationDefinition,
): PackCompilationIssue[] {
  const issues: PackCompilationIssue[] = [];

  if (evaluation.scenarioIds.length === 0) {
    issues.push({
      step: 'negative_scenarios',
      message: 'evaluation.scenarioIds is empty; a pack must declare at least one scenario.',
      path: 'evaluation.scenarioIds',
    });
  }

  if (!evaluation.requiresNegativeCase) {
    issues.push({
      step: 'negative_scenarios',
      message:
        'evaluation.requiresNegativeCase is false; every pack evaluation suite must include a negative (incomplete-evidence, steering, or human-boundary) scenario.',
      path: 'evaluation.requiresNegativeCase',
    });
  }

  return issues;
}

function schemaIssuesFrom(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): PackCompilationIssue[] {
  return error.issues.map((issue) => ({
    step: 'schema' as const,
    message: issue.message,
    path: issue.path.map(String).join('.'),
  }));
}

export function compilePack(
  source: DecisionPackManifest,
  catalog: CapabilityCatalog,
  clock: Clock,
): CompiledDecisionPack {
  // Steps 1+2 (folded -- see judgment call #1 in the module comment).
  const parsed = DecisionPackManifestSchema.safeParse(source);
  if (!parsed.success) {
    throw new PackCompilationError(schemaIssuesFrom(parsed.error));
  }
  const manifest = parsed.data;

  // Steps 3, 5, 6, 7, 8, 9, 10 -- exhaustive, not fail-fast.
  const capabilityResolution = resolveCapabilityReferences(manifest, catalog);
  const issues: PackCompilationIssue[] = [
    ...checkDuplicateIds(manifest),
    ...checkDanglingReferences(manifest),
    ...capabilityResolution.unresolved.map((reference): PackCompilationIssue => ({
      step: 'unknown_capability',
      message: `Unknown capability: no installed ${reference.kind} "${reference.id}" in the catalog.`,
      path: `${reference.kind}s`,
    })),
    ...validateOrchestrationBounds(manifest.orchestration),
    ...checkApprovalPolicies(manifest),
    ...checkExtensionPolicy(manifest),
    ...checkUiRenderability(manifest),
    ...validateNegativeScenarios(manifest.evaluation),
  ];

  if (issues.length > 0) {
    throw new PackCompilationError(issues);
  }

  // Step 4 (derivation, not a check -- see judgment call #2).
  const runtimeValidators = compileValidatorReferences(manifest);

  const resolvedCapabilities: ResolvedCapabilityCatalog = {
    skillIds: manifest.skills.map((skill) => skill.id),
    specialistIds: manifest.specialists.map((specialist) => specialist.id),
    toolIds: manifest.tools.map((tool) => tool.id),
  };

  // Step 11: deterministic canonical serialization and SHA-256 hash
  // generation, folding resolved capability versions into the hash input
  // (see canonicalize.ts's hashManifest doc comment) and computing the
  // hash from the pre-compilation manifest, before compiledAt exists.
  const canonicalManifestJson = canonicalizeManifest(manifest);
  const resolvedCapabilityVersions = Object.fromEntries(
    capabilityResolution.resolved.map((reference) => [
      capabilityKey(reference.kind, reference.id),
      // `capabilityResolution.resolved` is filtered to `resolved: true`
      // entries, which `resolveCapabilityReferences` only produces when
      // `findCapability` found a matching catalog entry -- and every
      // `CapabilityCatalogEntry.version` is a required, always-defined
      // string. So `reference.version` cannot be `undefined` here; this
      // avoids an unreachable `?? ''` fallback branch no valid input could
      // exercise (same reasoning as `routing.ts`'s `compareSemver`).
      reference.version!,
    ]),
  );
  const compiledHash = hashManifest(canonicalManifestJson, resolvedCapabilityVersions);

  const compiled: CompiledDecisionPack = {
    ...manifest,
    compiledHash,
    compiledAt: clock.now(),
    resolvedCapabilities,
    runtimeValidators,
  };

  // Defense in depth: the compiler's own output must satisfy the same
  // schema a persisted/registered compiled pack is validated against
  // everywhere else in the system.
  return CompiledDecisionPackSchema.parse(compiled);
}
