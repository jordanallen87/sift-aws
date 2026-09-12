import { describe, expect, it } from 'vitest';
import type { Clock } from '@sift/core';
import { SiftDomainError } from '@sift/core';
import type { DecisionPackManifest } from '@sift/contracts';
import {
  PackCompilationError,
  checkApprovalPolicies,
  checkExtensionPolicy,
  checkLensReferences,
  checkUiRenderability,
  compilePack,
  validateNegativeScenarios,
  validateOrchestrationBounds,
} from './compiler.js';
import { createCapabilityCatalog } from './capability-catalog.js';
import type { CapabilityCatalog } from './capability-catalog.js';
import { validCatalog, validManifest, validSwarmManifest } from './fixtures/manifest.js';

const fixedClock: Clock = { now: () => '2026-08-27T00:00:00.000Z' };
const laterClock: Clock = { now: () => '2026-08-27T01:00:00.000Z' };

function compileAndExpectIssue(
  manifest: DecisionPackManifest,
  catalog: CapabilityCatalog,
  step: PackCompilationError['issues'][number]['step'],
): PackCompilationError {
  try {
    compilePack(manifest, catalog, fixedClock);
  } catch (error) {
    expect(error).toBeInstanceOf(PackCompilationError);
    expect(error).toBeInstanceOf(SiftDomainError);
    const compilationError = error as PackCompilationError;
    expect(compilationError.issues.some((issue) => issue.step === step)).toBe(true);
    return compilationError;
  }
  throw new Error(`Expected compilePack to reject with a "${step}" issue, but it succeeded.`);
}

describe('compilePack: success path', () => {
  it('compiles a valid graph-orchestrated manifest', () => {
    const compiled = compilePack(validManifest(), validCatalog(), fixedClock);

    expect(compiled.compiledHash).toMatch(/^[0-9a-f]{64}$/);
    expect(compiled.compiledAt).toBe('2026-08-27T00:00:00.000Z');
    expect(compiled.resolvedCapabilities).toEqual({
      skillIds: ['listing-normalizer'],
      specialistIds: ['deal-analyst'],
      toolIds: ['calculator'],
    });
    expect(compiled.runtimeValidators).toEqual({
      attributeValidatorIds: ['apt.rent'],
      obligationValidatorIds: ['apt.hard_constraints'],
    });
    expect(compiled.identity.id).toBe('apartment-hunt');
  });

  it('compiles a valid manifest whose specialist omits the optional allowedSkills field', () => {
    const { allowedSkills: _allowedSkills, ...specialistWithoutAllowedSkills } =
      validManifest().specialists[0]!;
    const manifest = validManifest({ specialists: [specialistWithoutAllowedSkills] });
    const compiled = compilePack(manifest, validCatalog(), fixedClock);
    expect(compiled.specialists[0]?.allowedSkills).toBeUndefined();
  });

  it('compiles a valid manifest whose policy omits the optional appliesToToolIds field', () => {
    const manifest = validManifest({
      policies: [{ ...validManifest().policies[0]!, appliesToToolIds: undefined }],
    });
    const compiled = compilePack(manifest, validCatalog(), fixedClock);
    expect(compiled.policies[0]?.appliesToToolIds).toBeUndefined();
  });

  it('compiles a valid swarm-orchestrated manifest', () => {
    const compiled = compilePack(validSwarmManifest(), validCatalog(), fixedClock);
    expect(compiled.orchestration.strategy).toBe('swarm');
    expect(compiled.compiledHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Task E7 (pack-level Decision Guide, docs/change-sets/2026-08-30-generic-
  // decision-workspace.md §46/§47): `decisionGuide` is optional on
  // `DecisionPackManifestSchema`, and `canonicalizeManifest` drops
  // `undefined` object values (canonicalize.ts), so a manifest that never
  // declares one must compile to the exact same `compiledHash` it always
  // has -- cases pin `pack.compiledHash` (packages/contracts/src/case.ts's
  // `CasePackPinSchema`), so an accidental hash drift for every already-
  // guideless pack the moment this optional field was added would silently
  // invalidate every already-pinned case. `toMatchInlineSnapshot()` with no
  // literal pins whatever value this test captured the first time it ran
  // (before `decisionGuide` existed in `packs.ts`), so any future change
  // that perturbs this specific manifest's hash -- adding the field with a
  // default, forgetting `.optional()`, canonicalizing `undefined`
  // differently -- fails this test with a visible diff instead of silently
  // matching a hand-edited "new" value.
  it('produces the identical compiledHash for a manifest that declares no decisionGuide', () => {
    const compiled = compilePack(validManifest(), validCatalog(), fixedClock);
    expect(compiled.compiledHash).toMatchInlineSnapshot(
      `"958efa0850a8e6082c0f4af05bd7900138a9aef8a87309b7cfd09c6c17bc570a"`,
    );
  });

  // Compliance (the pack-level "real-world rules and standards this class of
  // decision is governed by" declaration, packs.ts's `PackComplianceSchema`):
  // `compliance` is `.optional()` on `DecisionPackManifestSchema` for the
  // exact same reason `decisionGuide` is (see that field's own comment) --
  // `canonicalizeManifest` drops `undefined` object values before hashing,
  // so a manifest that never declares `compliance` must produce the exact
  // same `compiledHash` every already-compiled, guideless-AND-
  // compliance-less pack always has. This reuses the literal hash the test
  // immediately above already pins: `validManifest()` declares neither
  // `decisionGuide` nor `discovery` nor `compliance`, so if adding the
  // `compliance` field to the schema had perturbed this manifest's hash in
  // any way -- a forgotten `.optional()`, a default value, `undefined`
  // canonicalizing differently -- the test above would already have failed
  // with a visible diff. This test names that guarantee explicitly for
  // `compliance` specifically, rather than leaving it as an unstated
  // side-effect of a test that was written for a different field.
  it('produces the identical compiledHash for a manifest that declares no compliance (same hash as the no-decisionGuide case)', () => {
    const compiled = compilePack(validManifest(), validCatalog(), fixedClock);
    expect(compiled.compiledHash).toMatchInlineSnapshot(
      `"958efa0850a8e6082c0f4af05bd7900138a9aef8a87309b7cfd09c6c17bc570a"`,
    );
  });

  it('produces a different compiledHash once a manifest declares a real compliance value', () => {
    const withoutCompliance = compilePack(validManifest(), validCatalog(), fixedClock);
    const withCompliance = compilePack(
      validManifest({
        compliance: {
          disclaimer:
            'These are informational minimums on the party making the award, not legal advice.',
          standards: [
            {
              id: 'three-bid-minimum',
              label: 'Minimum competitive bids for public construction contracts',
              summary:
                'Several jurisdictions require at least three competitive bids before a public construction contract may be awarded.',
              citation: 'N.C. Gen. Stat. § 143-132',
              authority: 'North Carolina General Assembly',
              humanResponsibility:
                'Confirm which jurisdiction actually governs this award and that the required number of sources was genuinely solicited.',
            },
          ],
        },
      }),
      validCatalog(),
      fixedClock,
    );
    expect(withCompliance.compiledHash).not.toBe(withoutCompliance.compiledHash);
  });

  it('produces the same compiledHash regardless of compiledAt (clock)', () => {
    const a = compilePack(validManifest(), validCatalog(), fixedClock);
    const b = compilePack(validManifest(), validCatalog(), laterClock);
    expect(a.compiledHash).toBe(b.compiledHash);
    expect(a.compiledAt).not.toBe(b.compiledAt);
  });

  it('produces a different compiledHash when a referenced capability is at a different version', () => {
    const upgradedCatalog = createCapabilityCatalog([
      { id: 'listing-normalizer', kind: 'skill', version: '1.0.0' },
      { id: 'deal-analyst', kind: 'specialist', version: '1.0.0' },
      { id: 'calculator', kind: 'tool', version: '2.0.0' },
    ]);
    const a = compilePack(validManifest(), validCatalog(), fixedClock);
    const b = compilePack(validManifest(), upgradedCatalog, fixedClock);
    expect(a.compiledHash).not.toBe(b.compiledHash);
  });

  it('produces the same compiledHash for two structurally distinct but semantically identical manifests', () => {
    const manifest = validManifest();
    // Reversed key insertion order for `identity` -- a real (not merely
    // cosmetic) reordering, since JS engines preserve string-key insertion
    // order.
    const reorderedIdentity = {
      tags: manifest.identity.tags,
      description: manifest.identity.description,
      name: manifest.identity.name,
      version: manifest.identity.version,
      id: manifest.identity.id,
    };
    const semanticallyIdentical: DecisionPackManifest = {
      ...manifest,
      identity: reorderedIdentity,
    };
    const a = compilePack(manifest, validCatalog(), fixedClock);
    const b = compilePack(semanticallyIdentical, validCatalog(), fixedClock);
    expect(a.compiledHash).toBe(b.compiledHash);
  });
});

describe('compilePack: step 1 (schema and size validation)', () => {
  it('rejects a source object that fails DecisionPackManifestSchema', () => {
    const invalid = { ...validManifest(), schemaVersion: '2.0' } as unknown as DecisionPackManifest;
    const error = compileAndExpectIssue(invalid, validCatalog(), 'schema');
    expect(error.issues.every((issue) => issue.step === 'schema')).toBe(true);
  });

  it('short-circuits later steps when the schema itself is invalid', () => {
    const invalid = { schemaVersion: '1.0' } as unknown as DecisionPackManifest;
    expect(() => compilePack(invalid, validCatalog(), fixedClock)).toThrow(PackCompilationError);
  });
});

describe('compilePack: step 3 (duplicate IDs)', () => {
  it('rejects a duplicate entity id', () => {
    const manifest = validManifest({
      entities: [
        { id: 'unit', label: 'Unit', attributeIds: ['apt.rent'] },
        { id: 'unit', label: 'Unit again', attributeIds: [] },
      ],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate attribute id', () => {
    const attribute = validManifest().attributes[0]!;
    const manifest = validManifest({ attributes: [attribute, attribute] });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate criterion id', () => {
    const criterion = validManifest().criteria.defaults[0]!;
    const manifest = validManifest({
      criteria: { ...validManifest().criteria, defaults: [criterion, criterion] },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate obligation id', () => {
    const obligation = validManifest().obligations[0]!;
    const manifest = validManifest({ obligations: [obligation, obligation] });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate skill id', () => {
    const skill = validManifest().skills[0]!;
    const manifest = validManifest({ skills: [skill, skill] });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate specialist id', () => {
    const specialist = validManifest().specialists[0]!;
    const manifest = validManifest({ specialists: [specialist, specialist] });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate tool id', () => {
    const tool = validManifest().tools[0]!;
    const manifest = validManifest({ tools: [tool, tool] });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });

  it('rejects a duplicate policy id', () => {
    const policy = validManifest().policies[0]!;
    const manifest = validManifest({ policies: [policy, policy] });
    compileAndExpectIssue(manifest, validCatalog(), 'duplicate_id');
  });
});

describe('compilePack: step 3 (dangling references)', () => {
  it('rejects an entity attributeIds entry that does not exist', () => {
    const manifest = validManifest({
      entities: [{ id: 'unit', label: 'Unit', attributeIds: ['apt.nonexistent'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects a protectedCriterionIds entry that does not exist', () => {
    const manifest = validManifest({
      criteria: { ...validManifest().criteria, protectedCriterionIds: ['does-not-exist'] },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects an obligation dependsOn entry that does not exist', () => {
    const manifest = validManifest({
      obligations: [{ ...validManifest().obligations[0]!, dependsOn: ['does-not-exist'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects an obligation that depends on itself', () => {
    const obligation = validManifest().obligations[0]!;
    const manifest = validManifest({
      obligations: [{ ...obligation, dependsOn: [obligation.id] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects an obligation naming a preferredSkill not in skills', () => {
    const manifest = validManifest({
      obligations: [{ ...validManifest().obligations[0]!, preferredSkills: ['not-a-real-skill'] }],
    });
    const error = compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
    expect(error.issues.some((issue) => issue.message.includes('preferredSkills'))).toBe(true);
  });

  it('rejects an obligation naming a preferredSpecialist not in specialists', () => {
    const manifest = validManifest({
      obligations: [
        { ...validManifest().obligations[0]!, preferredSpecialists: ['not-a-real-specialist'] },
      ],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects a specialist allowedTools entry not in tools', () => {
    const manifest = validManifest({
      specialists: [{ ...validManifest().specialists[0]!, allowedTools: ['not-a-real-tool'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects a specialist allowedSkills entry not in skills', () => {
    const manifest = validManifest({
      specialists: [{ ...validManifest().specialists[0]!, allowedSkills: ['not-a-real-skill'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects a policy appliesToToolIds entry not in tools', () => {
    const manifest = validManifest({
      policies: [{ ...validManifest().policies[0]!, appliesToToolIds: ['not-a-real-tool'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });

  it('rejects a presentation attributeGroups entry naming a nonexistent attribute', () => {
    const manifest = validManifest({
      presentation: {
        ...validManifest().presentation,
        attributeGroups: [{ id: 'basics', label: 'Basics', attributeIds: ['does-not-exist'] }],
      },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'dangling_reference');
  });
});

describe('compilePack: step 5 (unknown capabilities)', () => {
  it('rejects an unknown skill', () => {
    const manifest = validManifest({
      skills: [{ id: 'not-installed', description: 'Not in the catalog.' }],
      obligations: [{ ...validManifest().obligations[0]!, preferredSkills: ['not-installed'] }],
      specialists: [{ ...validManifest().specialists[0]!, allowedSkills: ['not-installed'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'unknown_capability');
  });

  it('rejects an unknown specialist', () => {
    const manifest = validManifest({
      specialists: [
        {
          id: 'not-installed',
          description: 'Not in the catalog.',
          allowedTools: ['calculator'],
          allowedSkills: ['listing-normalizer'],
        },
      ],
      obligations: [
        { ...validManifest().obligations[0]!, preferredSpecialists: ['not-installed'] },
      ],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'unknown_capability');
  });

  it('rejects an unknown tool', () => {
    const manifest = validManifest({
      tools: [
        {
          id: 'not-installed',
          description: 'Not in the catalog.',
          effect: 'consequential',
          requiresApproval: true,
        },
      ],
      specialists: [{ ...validManifest().specialists[0]!, allowedTools: ['not-installed'] }],
      policies: [{ ...validManifest().policies[0]!, appliesToToolIds: ['not-installed'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'unknown_capability');
  });
});

describe('validateOrchestrationBounds (step 6)', () => {
  it('accepts a graph orchestration with maxConcurrency and coherent timeouts', () => {
    expect(
      validateOrchestrationBounds({
        strategy: 'graph',
        maxSteps: 10,
        nodeTimeoutMs: 5_000,
        totalTimeoutMs: 30_000,
        maxConcurrency: 2,
      }),
    ).toEqual([]);
  });

  it('accepts a swarm orchestration with repetitive-handoff bounds set', () => {
    expect(
      validateOrchestrationBounds({
        strategy: 'swarm',
        maxSteps: 10,
        nodeTimeoutMs: 5_000,
        totalTimeoutMs: 30_000,
        repetitiveHandoffDetectionWindow: 8,
        repetitiveHandoffMinUniqueAgents: 3,
      }),
    ).toEqual([]);
  });

  it('accepts a single_agent orchestration with no strategy-specific bounds required', () => {
    expect(
      validateOrchestrationBounds({
        strategy: 'single_agent',
        maxSteps: 10,
        nodeTimeoutMs: 5_000,
        totalTimeoutMs: 30_000,
      }),
    ).toEqual([]);
  });

  it('rejects nodeTimeoutMs greater than totalTimeoutMs', () => {
    const issues = validateOrchestrationBounds({
      strategy: 'single_agent',
      maxSteps: 10,
      nodeTimeoutMs: 40_000,
      totalTimeoutMs: 30_000,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('orchestration.nodeTimeoutMs');
  });

  it('rejects a graph orchestration missing maxConcurrency', () => {
    const issues = validateOrchestrationBounds({
      strategy: 'graph',
      maxSteps: 10,
      nodeTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
    });
    expect(issues.some((issue) => issue.path === 'orchestration.maxConcurrency')).toBe(true);
  });

  it('rejects a swarm orchestration missing repetitiveHandoffDetectionWindow', () => {
    const issues = validateOrchestrationBounds({
      strategy: 'swarm',
      maxSteps: 10,
      nodeTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
      repetitiveHandoffMinUniqueAgents: 3,
    });
    expect(
      issues.some((issue) => issue.path === 'orchestration.repetitiveHandoffDetectionWindow'),
    ).toBe(true);
  });

  it('rejects a swarm orchestration missing repetitiveHandoffMinUniqueAgents', () => {
    const issues = validateOrchestrationBounds({
      strategy: 'swarm',
      maxSteps: 10,
      nodeTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
      repetitiveHandoffDetectionWindow: 8,
    });
    expect(
      issues.some((issue) => issue.path === 'orchestration.repetitiveHandoffMinUniqueAgents'),
    ).toBe(true);
  });

  it('is wired into compilePack end to end', () => {
    const manifest = validManifest({
      orchestration: {
        strategy: 'graph',
        maxSteps: 10,
        nodeTimeoutMs: 5_000,
        totalTimeoutMs: 30_000,
      },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'orchestration_bounds');
  });
});

describe('checkApprovalPolicies (step 7)', () => {
  it('passes a consequential tool with requiresApproval and matching policy', () => {
    expect(checkApprovalPolicies(validManifest())).toEqual([]);
  });

  it('passes a read_only tool regardless of approval/policy configuration', () => {
    const manifest = validManifest({
      tools: [
        {
          id: 'reader',
          description: 'Reads a listing.',
          effect: 'read_only',
          requiresApproval: false,
        },
      ],
      specialists: [{ ...validManifest().specialists[0]!, allowedTools: ['reader'] }],
      policies: [],
    });
    expect(checkApprovalPolicies(manifest)).toEqual([]);
  });

  it('rejects a consequential tool with requiresApproval: false', () => {
    const manifest = validManifest({
      tools: [{ ...validManifest().tools[0]!, requiresApproval: false }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'approval_policy');
  });

  it('rejects a consequential tool with requiresApproval true but no covering policy', () => {
    const manifest = validManifest({ policies: [] });
    compileAndExpectIssue(manifest, validCatalog(), 'approval_policy');
  });

  it('rejects a consequential tool whose only policy scopes appliesToToolIds to a different tool', () => {
    const manifest = validManifest({
      policies: [{ ...validManifest().policies[0]!, appliesToToolIds: ['some-other-tool'] }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'approval_policy');
  });

  it('accepts coverage from a policy with no appliesToToolIds (applies globally)', () => {
    const manifest = validManifest({
      policies: [{ ...validManifest().policies[0]!, appliesToToolIds: undefined }],
    });
    expect(checkApprovalPolicies(manifest)).toEqual([]);
  });

  it('ignores a policy with requiresHumanApproval: false when checking coverage', () => {
    const manifest = validManifest({
      policies: [{ ...validManifest().policies[0]!, requiresHumanApproval: false }],
    });
    compileAndExpectIssue(manifest, validCatalog(), 'approval_policy');
  });
});

describe('checkExtensionPolicy (step 8)', () => {
  it('passes a coherent extension policy', () => {
    expect(checkExtensionPolicy(validManifest())).toEqual([]);
  });

  it('rejects allowCaseObligations: true with allowCaseCriteria: false', () => {
    const manifest = validManifest({
      extensionPolicy: { ...validManifest().extensionPolicy, allowCaseCriteria: false },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'extension_policy');
  });

  it('rejects a userConcernTemplateId that collides with a declared obligation id', () => {
    const obligationId = validManifest().obligations[0]!.id;
    const manifest = validManifest({
      extensionPolicy: { ...validManifest().extensionPolicy, userConcernTemplateId: obligationId },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'extension_policy');
  });

  it('allows allowCaseObligations and allowCaseCriteria both false', () => {
    const manifest = validManifest({
      extensionPolicy: {
        allowCaseAttributes: false,
        allowCaseCriteria: false,
        allowCaseObligations: false,
        userConcernTemplateId: 'apt.user_concern',
      },
    });
    expect(checkExtensionPolicy(manifest)).toEqual([]);
  });
});

describe('checkLensReferences', () => {
  it('accepts a manifest with no lenses at all', () => {
    expect(checkLensReferences(validManifest())).toEqual([]);
  });

  it('rejects a lens naming an attribute the pack does not declare', () => {
    const manifest = validManifest();
    const issues = checkLensReferences({
      ...manifest,
      lenses: [
        {
          id: 'lens.made-up',
          label: 'Made up',
          description: 'Names a field that does not exist.',
          attributeIds: ['attr.does-not-exist'],
        },
      ],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('attr.does-not-exist');
    expect(issues[0]?.path).toBe('lenses["lens.made-up"].attributeIds');
  });

  it('rejects a lens naming the same attribute twice, which would render one column twice', () => {
    const manifest = validManifest();
    const declared = manifest.attributes[0]?.id;
    if (declared === undefined) {
      throw new Error('test setup: validManifest() declares no attributes');
    }
    const issues = checkLensReferences({
      ...manifest,
      lenses: [
        {
          id: 'lens.dupe',
          label: 'Dupe',
          description: 'Names one field twice.',
          attributeIds: [declared, declared],
        },
      ],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('more than once');
  });

  it('accepts a lens whose attributes are all declared', () => {
    const manifest = validManifest();
    const declared = manifest.attributes[0]?.id;
    if (declared === undefined) {
      throw new Error('test setup: validManifest() declares no attributes');
    }
    expect(
      checkLensReferences({
        ...manifest,
        lenses: [
          {
            id: 'lens.ok',
            label: 'Fine',
            description: 'Names only declared fields.',
            attributeIds: [declared],
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe('checkUiRenderability (step 9)', () => {
  it('passes when every non-sensitive attribute is assigned to a presentation group', () => {
    expect(checkUiRenderability(validManifest())).toEqual([]);
  });

  it('rejects a non-sensitive attribute assigned to no presentation group', () => {
    const manifest = validManifest({
      presentation: { ...validManifest().presentation, attributeGroups: [] },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'ui_renderability');
  });

  it('does not require a sensitive attribute to be assigned to a presentation group', () => {
    const manifest = validManifest({
      attributes: [{ ...validManifest().attributes[0]!, sensitive: true }],
      presentation: { ...validManifest().presentation, attributeGroups: [] },
    });
    expect(checkUiRenderability(manifest)).toEqual([]);
  });
});

describe('validateNegativeScenarios (step 10)', () => {
  it('passes an evaluation suite with scenarios and requiresNegativeCase: true', () => {
    expect(validateNegativeScenarios(validManifest().evaluation)).toEqual([]);
  });

  it('rejects an empty scenarioIds list', () => {
    const manifest = validManifest({ evaluation: { scenarioIds: [], requiresNegativeCase: true } });
    compileAndExpectIssue(manifest, validCatalog(), 'negative_scenarios');
  });

  it('rejects requiresNegativeCase: false', () => {
    const manifest = validManifest({
      evaluation: { scenarioIds: ['apt-success'], requiresNegativeCase: false },
    });
    compileAndExpectIssue(manifest, validCatalog(), 'negative_scenarios');
  });
});

describe('compilePack: exhaustive issue collection', () => {
  it('reports issues from multiple independent steps in a single call, not just the first', () => {
    const manifest = validManifest({
      tools: [{ ...validManifest().tools[0]!, requiresApproval: false }],
      evaluation: { scenarioIds: [], requiresNegativeCase: false },
    });

    try {
      compilePack(manifest, validCatalog(), fixedClock);
      throw new Error('expected compilePack to throw');
    } catch (error) {
      const compilationError = error as PackCompilationError;
      const steps = new Set(compilationError.issues.map((issue) => issue.step));
      expect(steps.has('approval_policy')).toBe(true);
      expect(steps.has('negative_scenarios')).toBe(true);
    }
  });

  it('includes a readable summary of every issue in the thrown error message', () => {
    const manifest = validManifest({
      evaluation: { scenarioIds: [], requiresNegativeCase: false },
    });
    try {
      compilePack(manifest, validCatalog(), fixedClock);
      throw new Error('expected compilePack to throw');
    } catch (error) {
      expect((error as Error).message).toContain('issue(s)');
    }
  });
});
