/**
 * `runPackConformance(pack, catalog): PackConformanceReport`. Implements
 * testing.md "Decision Pack conformance tests": `pnpm test:pack` "discovers
 * every built-in and authoring fixture pack and runs the same
 * compiler/conformance suite. It verifies reference resolution, extension
 * policy, Graph/Swarm bounds, required negative scenarios, authority rules,
 * generic UI renderability, deterministic compilation, and immutable
 * version/hash pinning."
 *
 * Judgment call: neither pack-authoring.md nor testing.md gives
 * `PackConformanceReport` an explicit field list. This module infers its
 * shape from two anchor points:
 *
 * 1. The scope described in `packages/packs`'s own task brief -- re-verify
 *    a compiled pack's capability references still resolve against a
 *    *possibly updated* catalog, its Graph/Swarm bounds, and that it has
 *    negative scenarios -- which is a strict subset of `compilePack`'s
 *    validations (the ones meaningful to re-check post-hoc against a
 *    catalog that may have changed since compile time; duplicate-ID and
 *    dangling-reference checks are static properties of the manifest text
 *    itself that cannot regress after compilation, so they are not
 *    re-checked here).
 * 2. "returning a structured pass/fail report per check rather than
 *    throwing (a conformance report should show every check's result, not
 *    stop at the first failure)" -- directly given in the task brief,
 *    mirrored from `compilePack`'s own exhaustive-not-fail-fast collection
 *    behavior in `compiler.ts`.
 *
 * `PackConformanceReport` deliberately carries no timestamp field:
 * `runPackConformance`'s given signature is `(pack, catalog)` with no clock
 * parameter, so the report is a pure function of its two inputs -- fully
 * deterministic and directly assertable in a test without an injected
 * `Clock`. A caller that wants a "when was this conformance run" record
 * (e.g. `pnpm test:pack`'s own report writer) can timestamp the report
 * externally; that is orchestration, not this function's job.
 *
 * Reuses `checkApprovalPolicies`/`checkExtensionPolicy`/`checkUiRenderability`
 * from `compiler.ts` too, beyond the three checks named above, since
 * "authority rules" (testing.md) and "invalid extension rules"/"UI fields
 * the generic renderer cannot display" (packs-and-routing.md) are exactly
 * what those functions already check, and a compiled pack's manifest
 * content is immutable post-compile -- re-running them against the same
 * `CompiledDecisionPack` can only ever re-confirm what compilation already
 * proved, but conformance testing.md explicitly wants that proof re-run
 * "for every built-in and authoring fixture pack", not merely trusted from
 * compile time.
 */
import type { CompiledDecisionPack } from '@sift/contracts';
import {
  checkApprovalPolicies,
  checkExtensionPolicy,
  checkUiRenderability,
  validateNegativeScenarios,
  validateOrchestrationBounds,
  checkLensReferences,
} from './compiler.js';
import { resolveCapabilityReferences } from './capability-catalog.js';
import type { CapabilityCatalog } from './capability-catalog.js';

export const PACK_CONFORMANCE_CHECK_IDS = [
  'capability_references_resolve',
  'orchestration_bounds',
  'approval_policies',
  'extension_policy',
  'ui_renderability',
  'negative_scenarios_present',
] as const;
export type PackConformanceCheckId = (typeof PACK_CONFORMANCE_CHECK_IDS)[number];

export interface PackConformanceCheckResult {
  readonly id: PackConformanceCheckId;
  readonly passed: boolean;
  readonly message: string;
}

export interface PackConformanceReport {
  readonly packId: string;
  readonly packVersion: string;
  readonly compiledHash: string;
  readonly checks: readonly PackConformanceCheckResult[];
  /** `true` iff every entry in `checks` passed. */
  readonly passed: boolean;
}

function summarize(
  id: PackConformanceCheckId,
  passingMessage: string,
  failureMessages: readonly string[],
): PackConformanceCheckResult {
  return failureMessages.length === 0
    ? { id, passed: true, message: passingMessage }
    : { id, passed: false, message: failureMessages.join('; ') };
}

export function runPackConformance(
  pack: CompiledDecisionPack,
  catalog: CapabilityCatalog,
): PackConformanceReport {
  const capabilityResolution = resolveCapabilityReferences(pack, catalog);
  const capabilityCheck = summarize(
    'capability_references_resolve',
    'All declared skill/specialist/tool references resolve against the installed catalog.',
    capabilityResolution.unresolved.map(
      (reference) =>
        `Unknown capability: no installed ${reference.kind} "${reference.id}" in the catalog.`,
    ),
  );

  const orchestrationIssues = validateOrchestrationBounds(pack.orchestration);
  const orchestrationCheck = summarize(
    'orchestration_bounds',
    'Orchestration Graph/Swarm bounds are within policy.',
    orchestrationIssues.map((issue) => issue.message),
  );

  const approvalIssues = checkApprovalPolicies(pack);
  const approvalCheck = summarize(
    'approval_policies',
    'Every consequential-effect tool is covered by a human-approval policy.',
    approvalIssues.map((issue) => issue.message),
  );

  const extensionIssues = checkExtensionPolicy(pack);
  const extensionCheck = summarize(
    'extension_policy',
    'Extension policy rules are internally coherent.',
    extensionIssues.map((issue) => issue.message),
  );

  // Lens references share the `ui_renderability` step because they fail the
  // same way: an attribute the person should be able to see, that the
  // renderer has no way to show.
  const renderabilityIssues = [...checkUiRenderability(pack), ...checkLensReferences(pack)];
  const renderabilityCheck = summarize(
    'ui_renderability',
    'Every declared, non-sensitive attribute renders in the generic UI, and every lens names attributes this pack declares.',
    renderabilityIssues.map((issue) => issue.message),
  );

  const negativeScenarioIssues = validateNegativeScenarios(pack.evaluation);
  const negativeScenarioCheck = summarize(
    'negative_scenarios_present',
    'The evaluation suite declares at least one required negative scenario.',
    negativeScenarioIssues.map((issue) => issue.message),
  );

  const checks: PackConformanceCheckResult[] = [
    capabilityCheck,
    orchestrationCheck,
    approvalCheck,
    extensionCheck,
    renderabilityCheck,
    negativeScenarioCheck,
  ];

  return {
    packId: pack.identity.id,
    packVersion: pack.identity.version,
    compiledHash: pack.compiledHash,
    checks,
    passed: checks.every((check) => check.passed),
  };
}
