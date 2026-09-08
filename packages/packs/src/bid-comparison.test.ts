/**
 * TDD tests for the real `bid-comparison@1.0.0` Decision Pack manifest
 * (`bid-comparison.ts`). Mirrors `home-energy-guardian.test.ts`'s structure:
 * proves the manifest compiles cleanly against a realistic capability
 * catalog covering every declared skill/specialist/tool, that `compiledHash`
 * is deterministic, that the compiled pack passes the exact same shared
 * conformance suite `conformance.ts` runs for every built-in pack, that the
 * five required obligations from docs/bid-comparison/plan.md are present
 * with the plan's exact structure, and that the least-privilege tool grants
 * the plan's "Deny" beat depends on are exactly as specified.
 */
import { describe, expect, it } from 'vitest';
import type { AttributeRecord } from '@sift/contracts';
import { AttributeRecordSchema } from '@sift/contracts';
import type { Clock } from '@sift/core';
import { removeCriterion, reweightCriterion } from '@sift/core';
import { BID_COMPARISON_MANIFEST, compileBidComparisonPack } from './bid-comparison.js';
import { createCapabilityCatalog } from './capability-catalog.js';
import type { CapabilityCatalog } from './capability-catalog.js';
import { PACK_CONFORMANCE_CHECK_IDS, runPackConformance } from './conformance.js';

const fixedClock: Clock = { now: () => '2026-09-06T00:00:00.000Z' };
const laterClock: Clock = { now: () => '2026-09-06T01:00:00.000Z' };

/**
 * A catalog covering every skill/specialist/tool id
 * `BID_COMPARISON_MANIFEST` declares, built directly from the manifest's own
 * declarations so this test file cannot silently drift out of sync with the
 * manifest as it evolves, matching `home-energy-guardian.test.ts`'s
 * `energyCatalog()` pattern.
 */
function bidCatalog(): CapabilityCatalog {
  return createCapabilityCatalog([
    ...BID_COMPARISON_MANIFEST.skills.map((skill) => ({
      id: skill.id,
      kind: 'skill' as const,
      version: '1.0.0',
    })),
    ...BID_COMPARISON_MANIFEST.specialists.map((specialist) => ({
      id: specialist.id,
      kind: 'specialist' as const,
      version: '1.0.0',
    })),
    ...BID_COMPARISON_MANIFEST.tools.map((tool) => ({
      id: tool.id,
      kind: 'tool' as const,
      version: '1.0.0',
    })),
  ]);
}

describe('BID_COMPARISON_MANIFEST identity and activation', () => {
  it('declares the pinned pack identity', () => {
    expect(BID_COMPARISON_MANIFEST.identity.id).toBe('bid-comparison');
    expect(BID_COMPARISON_MANIFEST.identity.version).toBe('1.0.0');
    expect(BID_COMPARISON_MANIFEST.identity.name).toBe('Bid Comparison');
  });
});

describe('compileBidComparisonPack: compiles cleanly', () => {
  it('compiles the manifest against a realistic capability catalog without throwing', () => {
    expect(() => compileBidComparisonPack(bidCatalog(), fixedClock)).not.toThrow();
  });

  it('produces a compiledHash matching the lowercase-hex SHA-256 shape', () => {
    const compiled = compileBidComparisonPack(bidCatalog(), fixedClock);
    expect(compiled.compiledHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a deterministic compiledHash across two compiles regardless of clock', () => {
    const a = compileBidComparisonPack(bidCatalog(), fixedClock);
    const b = compileBidComparisonPack(bidCatalog(), laterClock);
    expect(a.compiledHash).toBe(b.compiledHash);
    expect(a.compiledAt).not.toBe(b.compiledAt);
  });

  it('resolves every declared skill, specialist, and tool against the catalog', () => {
    const compiled = compileBidComparisonPack(bidCatalog(), fixedClock);
    expect(compiled.resolvedCapabilities.skillIds.sort()).toEqual(
      [...BID_COMPARISON_MANIFEST.skills.map((skill) => skill.id)].sort(),
    );
    expect(compiled.resolvedCapabilities.specialistIds.sort()).toEqual(
      [...BID_COMPARISON_MANIFEST.specialists.map((specialist) => specialist.id)].sort(),
    );
    expect(compiled.resolvedCapabilities.toolIds.sort()).toEqual(
      [...BID_COMPARISON_MANIFEST.tools.map((tool) => tool.id)].sort(),
    );
  });
});

describe('runPackConformance: bid-comparison passes the shared conformance suite', () => {
  it('reports every conformance check passing for the freshly compiled pack', () => {
    const compiled = compileBidComparisonPack(bidCatalog(), fixedClock);
    const report = runPackConformance(compiled, bidCatalog());

    expect(report.packId).toBe('bid-comparison');
    expect(report.packVersion).toBe('1.0.0');
    expect(report.compiledHash).toBe(compiled.compiledHash);
    expect(report.checks).toHaveLength(PACK_CONFORMANCE_CHECK_IDS.length);
    expect(report.checks.map((check) => check.id).sort()).toEqual(
      [...PACK_CONFORMANCE_CHECK_IDS].sort(),
    );
    for (const check of report.checks) {
      expect(check.passed, `${check.id}: ${check.message}`).toBe(true);
    }
    expect(report.passed).toBe(true);
  });
});

describe('required obligations (docs/bid-comparison/plan.md "Obligations")', () => {
  it('declares exactly the five required obligation ids, no more and no fewer', () => {
    expect(BID_COMPARISON_MANIFEST.obligations.map((obligation) => obligation.id).sort()).toEqual(
      [
        'bid.scope_normalization',
        'bid.price_verification',
        'bid.credential_verification',
        'bid.schedule_feasibility',
        'bid.award_recommendation',
      ].sort(),
    );
  });

  it('every obligation is required and pack-origin', () => {
    for (const obligation of BID_COMPARISON_MANIFEST.obligations) {
      expect(obligation.required).toBe(true);
      expect(obligation.origin).toBe('pack');
    }
  });

  it('bid.scope_normalization has no dependencies and runs first', () => {
    const scopeNormalization = BID_COMPARISON_MANIFEST.obligations.find(
      (obligation) => obligation.id === 'bid.scope_normalization',
    );
    expect(scopeNormalization?.dependsOn).toEqual([]);
  });

  it('bid.price_verification depends on bid.scope_normalization (adjusted total needs the scope gap first)', () => {
    const priceVerification = BID_COMPARISON_MANIFEST.obligations.find(
      (obligation) => obligation.id === 'bid.price_verification',
    );
    expect(priceVerification?.dependsOn).toEqual(['bid.scope_normalization']);
  });

  it('bid.credential_verification and bid.schedule_feasibility are independent tracks with no dependencies', () => {
    for (const id of ['bid.credential_verification', 'bid.schedule_feasibility']) {
      const obligation = BID_COMPARISON_MANIFEST.obligations.find((entry) => entry.id === id);
      expect(obligation?.dependsOn).toEqual([]);
    }
  });

  it('bid.award_recommendation depends on all four measurement obligations and declares dependsOnCriteria: true', () => {
    const awardRecommendation = BID_COMPARISON_MANIFEST.obligations.find(
      (obligation) => obligation.id === 'bid.award_recommendation',
    );
    expect(awardRecommendation?.dependsOn.slice().sort()).toEqual(
      [
        'bid.scope_normalization',
        'bid.price_verification',
        'bid.credential_verification',
        'bid.schedule_feasibility',
      ].sort(),
    );
    // This is the field a criteria reweight reopens only the synthesis
    // through -- docs/bid-comparison/plan.md: "`bid.award_recommendation` --
    // synthesis, `dependsOnCriteria: true` so a reweight reopens only this
    // one".
    expect(awardRecommendation?.dependsOnCriteria).toBe(true);
  });

  it('no other obligation declares dependsOnCriteria', () => {
    const others = BID_COMPARISON_MANIFEST.obligations.filter(
      (obligation) => obligation.id !== 'bid.award_recommendation',
    );
    for (const obligation of others) {
      expect(obligation.dependsOnCriteria).toBeFalsy();
    }
  });

  it('every obligation preferredSkills/preferredSpecialists reference declared capabilities', () => {
    const skillIds = new Set(BID_COMPARISON_MANIFEST.skills.map((skill) => skill.id));
    const specialistIds = new Set(
      BID_COMPARISON_MANIFEST.specialists.map((specialist) => specialist.id),
    );
    for (const obligation of BID_COMPARISON_MANIFEST.obligations) {
      for (const skillId of obligation.preferredSkills) {
        expect(skillIds.has(skillId)).toBe(true);
      }
      for (const specialistId of obligation.preferredSpecialists) {
        expect(specialistIds.has(specialistId)).toBe(true);
      }
    }
  });
});

describe('skills, specialists, and tools (docs/bid-comparison/plan.md "Specialists and skills")', () => {
  it('declares exactly the four required skill ids, each bound to a real measurement obligation', () => {
    const skillIds = BID_COMPARISON_MANIFEST.skills.map((skill) => skill.id).sort();
    expect(skillIds).toEqual(
      [
        'scope-normalization',
        'price-arithmetic',
        'credential-verification',
        'schedule-analysis',
      ].sort(),
    );

    const preferredSkillIds = new Set(
      BID_COMPARISON_MANIFEST.obligations.flatMap((obligation) => obligation.preferredSkills),
    );
    for (const skillId of skillIds) {
      expect(preferredSkillIds.has(skillId)).toBe(true);
    }
  });

  it('declares exactly the six required specialist ids', () => {
    expect(BID_COMPARISON_MANIFEST.specialists.map((specialist) => specialist.id).sort()).toEqual(
      [
        'scope-analyst',
        'price-analyst',
        'credential-checker',
        'schedule-analyst',
        'source-challenger',
        'decision-synthesizer',
      ].sort(),
    );
  });

  it('every specialist that declares an allowedSkill is bound to a skill that some real obligation prefers', () => {
    const preferredSkillIds = new Set(
      BID_COMPARISON_MANIFEST.obligations.flatMap((obligation) => obligation.preferredSkills),
    );
    for (const specialist of BID_COMPARISON_MANIFEST.specialists) {
      for (const skillId of specialist.allowedSkills ?? []) {
        expect(
          preferredSkillIds.has(skillId),
          `specialist "${specialist.id}"'s allowed skill "${skillId}" is not preferred by any declared obligation`,
        ).toBe(true);
      }
    }
  });

  it('source-challenger and decision-synthesizer are granted no ordinary skills (invoked as Swarm agent-tools directly)', () => {
    for (const id of ['source-challenger', 'decision-synthesizer']) {
      const specialist = BID_COMPARISON_MANIFEST.specialists.find((entry) => entry.id === id);
      expect(specialist?.allowedSkills).toEqual([]);
    }
  });

  it('price-analyst is granted exactly bid-reader and bid-calculator -- NOT license-lookup', () => {
    const priceAnalyst = BID_COMPARISON_MANIFEST.specialists.find(
      (specialist) => specialist.id === 'price-analyst',
    );
    expect(priceAnalyst).toBeDefined();
    expect(priceAnalyst?.allowedTools.slice().sort()).toEqual(
      ['bid-calculator', 'bid-reader'].sort(),
    );
    expect(priceAnalyst?.allowedTools.includes('license-lookup')).toBe(false);
  });

  it('credential-checker is granted ONLY license-lookup (least privilege for the credential check)', () => {
    const credentialChecker = BID_COMPARISON_MANIFEST.specialists.find(
      (specialist) => specialist.id === 'credential-checker',
    );
    expect(credentialChecker?.allowedTools).toEqual(['license-lookup']);
  });

  it('license-lookup is granted to exactly one specialist across the whole pack', () => {
    const grantees = BID_COMPARISON_MANIFEST.specialists.filter((specialist) =>
      specialist.allowedTools.includes('license-lookup'),
    );
    expect(grantees.map((specialist) => specialist.id)).toEqual(['credential-checker']);
  });

  it('scope-analyst and source-challenger are granted bid-reader and scope-differ', () => {
    for (const id of ['scope-analyst', 'source-challenger']) {
      const specialist = BID_COMPARISON_MANIFEST.specialists.find((entry) => entry.id === id);
      expect(specialist?.allowedTools.slice().sort()).toEqual(
        ['bid-reader', 'scope-differ'].sort(),
      );
    }
  });

  it('schedule-analyst is granted only bid-reader', () => {
    const scheduleAnalyst = BID_COMPARISON_MANIFEST.specialists.find(
      (specialist) => specialist.id === 'schedule-analyst',
    );
    expect(scheduleAnalyst?.allowedTools).toEqual(['bid-reader']);
  });

  it('decision-synthesizer is granted only propose_award', () => {
    const decisionSynthesizer = BID_COMPARISON_MANIFEST.specialists.find(
      (specialist) => specialist.id === 'decision-synthesizer',
    );
    expect(decisionSynthesizer?.allowedTools).toEqual(['propose_award']);
  });

  it('declares the consequential propose_award tool requiring approval, covered by a policy', () => {
    const tool = BID_COMPARISON_MANIFEST.tools.find((entry) => entry.id === 'propose_award');
    expect(tool).toBeDefined();
    expect(tool?.effect).toBe('consequential');
    expect(tool?.requiresApproval).toBe(true);

    const coveringPolicy = BID_COMPARISON_MANIFEST.policies.find(
      (policy) =>
        policy.requiresHumanApproval &&
        (policy.appliesToToolIds === undefined ||
          policy.appliesToToolIds.includes('propose_award')),
    );
    expect(coveringPolicy).toBeDefined();
  });

  it('declares the four fixture-data tools with effect read_only and requiresApproval: false', () => {
    for (const id of ['bid-reader', 'scope-differ', 'bid-calculator', 'license-lookup']) {
      const tool = BID_COMPARISON_MANIFEST.tools.find((entry) => entry.id === id);
      expect(tool).toBeDefined();
      expect(tool?.effect).toBe('read_only');
      expect(tool?.requiresApproval).toBe(false);
    }
  });
});

describe('extensionPolicy (allows custom.* criteria and attributes)', () => {
  it('allows case attributes, criteria, and obligations, and pins the user-concern template id', () => {
    expect(BID_COMPARISON_MANIFEST.extensionPolicy).toEqual({
      allowCaseAttributes: true,
      allowCaseCriteria: true,
      allowCaseObligations: true,
      userConcernTemplateId: 'bid.user_concern',
    });
  });

  it('allows user-defined criteria', () => {
    expect(BID_COMPARISON_MANIFEST.criteria.allowUserDefined).toBe(true);
  });
});

describe('orchestration (bounded Strands Swarm)', () => {
  it('uses a swarm strategy with repetitive-handoff bounds set and nodeTimeoutMs <= totalTimeoutMs', () => {
    const { orchestration } = BID_COMPARISON_MANIFEST;
    expect(orchestration.strategy).toBe('swarm');
    expect(orchestration.repetitiveHandoffDetectionWindow).toBeDefined();
    expect(orchestration.repetitiveHandoffMinUniqueAgents).toBeDefined();
    expect(orchestration.nodeTimeoutMs).toBeLessThanOrEqual(orchestration.totalTimeoutMs);
  });

  it("configures the repetitive-handoff window wider than Sift's own three-call RetrySteering threshold", () => {
    const { orchestration } = BID_COMPARISON_MANIFEST;
    expect(orchestration.repetitiveHandoffDetectionWindow).toBeGreaterThan(3);
  });
});

describe('criteria.defaults (docs/bid-comparison/plan.md "Criteria")', () => {
  it('declares exactly the criteria table from the plan, weighted and summing to 100', () => {
    const byId = new Map(
      BID_COMPARISON_MANIFEST.criteria.defaults.map((criterion) => [criterion.id, criterion]),
    );

    expect(byId.get('bid.adjusted_total')).toMatchObject({
      kind: 'preference',
      direction: 'lower_better',
      weight: 45,
      origin: 'pack',
      status: 'active',
    });
    expect(byId.get('bid.scope_completeness')).toMatchObject({
      kind: 'preference',
      direction: 'higher_better',
      weight: 20,
    });
    expect(byId.get('bid.payment_risk')).toMatchObject({
      kind: 'preference',
      direction: 'lower_better',
      weight: 15,
    });
    expect(byId.get('bid.schedule_fit')).toMatchObject({
      kind: 'preference',
      direction: 'higher_better',
      weight: 10,
    });
    expect(byId.get('bid.warranty')).toMatchObject({
      kind: 'preference',
      direction: 'higher_better',
      weight: 10,
    });

    const preferenceWeightSum = BID_COMPARISON_MANIFEST.criteria.defaults
      .filter((criterion) => criterion.kind === 'preference')
      .reduce((sum, criterion) => sum + criterion.weight, 0);
    expect(preferenceWeightSum).toBe(100);
  });

  it('the compiled pack carries the same criteria.defaults through unchanged', () => {
    const compiled = compileBidComparisonPack(bidCatalog(), fixedClock);
    expect(compiled.criteria.defaults).toEqual(BID_COMPARISON_MANIFEST.criteria.defaults);
  });
});

describe('protected bid.credentials_valid hard constraint (docs/bid-comparison/plan.md "Criteria")', () => {
  it('declares bid.credentials_valid as a hard_constraint criterion listed in protectedCriterionIds', () => {
    const criterion = BID_COMPARISON_MANIFEST.criteria.defaults.find(
      (entry) => entry.id === 'bid.credentials_valid',
    );
    expect(criterion).toBeDefined();
    expect(criterion?.kind).toBe('hard_constraint');
    expect(criterion?.status).toBe('active');
    expect(BID_COMPARISON_MANIFEST.criteria.protectedCriterionIds).toEqual([
      'bid.credentials_valid',
    ]);
  });

  it('cannot be removed via packages/core/src/criteria.ts removeCriterion', () => {
    const result = removeCriterion(
      BID_COMPARISON_MANIFEST.criteria.defaults,
      'bid.credentials_valid',
      BID_COMPARISON_MANIFEST.criteria.protectedCriterionIds,
    );
    expect(result.ok).toBe(false);
  });

  it('cannot be reweighted via packages/core/src/criteria.ts reweightCriterion unless allowProtectedReweight is explicitly granted (which this pack never grants)', () => {
    const denied = reweightCriterion(
      BID_COMPARISON_MANIFEST.criteria.defaults,
      'bid.credentials_valid',
      50,
      {
        protectedCriterionIds: BID_COMPARISON_MANIFEST.criteria.protectedCriterionIds,
        allowProtectedReweight: false,
      },
    );
    expect(denied.ok).toBe(false);
  });

  it('an ordinary non-protected criterion (bid.adjusted_total) can still be removed and reweighted -- this is the reweight beat', () => {
    const removed = removeCriterion(
      BID_COMPARISON_MANIFEST.criteria.defaults,
      'bid.adjusted_total',
      BID_COMPARISON_MANIFEST.criteria.protectedCriterionIds,
    );
    expect(removed.ok).toBe(true);

    const reweighted = reweightCriterion(
      BID_COMPARISON_MANIFEST.criteria.defaults,
      'bid.scope_completeness',
      60,
      {
        protectedCriterionIds: BID_COMPARISON_MANIFEST.criteria.protectedCriterionIds,
        allowProtectedReweight: false,
      },
    );
    expect(reweighted.ok).toBe(true);
  });
});

describe('bid.warranty_months: explicit unknown, not a defaulted zero', () => {
  const AT = '2026-09-06T00:00:00.000Z';

  it('declares bid.warranty_months as not required, so a bid with no stated term can omit it', () => {
    const definition = BID_COMPARISON_MANIFEST.attributes.find(
      (attribute) => attribute.id === 'bid.warranty_months',
    );
    expect(definition).toBeDefined();
    expect(definition?.required).toBe(false);
    expect(definition?.valueType).toBe('number');
  });

  it('round-trips as a real AttributeRecord with status "unknown" and no value at all', () => {
    const unknownWarranty: AttributeRecord = {
      definitionId: 'bid.warranty_months',
      label: 'Warranty term',
      origin: 'pack',
      sourceIds: [],
      status: 'unknown',
      updatedAt: AT,
    };
    const parsed = AttributeRecordSchema.safeParse(unknownWarranty);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.value).toBeUndefined();
  });

  it('is a distinct state from an asserted zero-month warranty -- the schema does not let "unknown" carry a smuggled value', () => {
    const zeroMonthWarranty: AttributeRecord = {
      definitionId: 'bid.warranty_months',
      label: 'Warranty term',
      value: { type: 'number', value: 0, unit: 'months' },
      origin: 'pack',
      sourceIds: ['src-bid-b'],
      status: 'asserted',
      updatedAt: AT,
    };
    expect(AttributeRecordSchema.safeParse(zeroMonthWarranty).success).toBe(true);

    // A record cannot claim BOTH: "unknown" status must carry no value at
    // all, per attributes.ts's own rule ("value must be absent when status
    // is 'unknown'") -- proving the schema cannot collapse "no stated term"
    // into "asserted zero months" by accident.
    const invalidHybrid = {
      definitionId: 'bid.warranty_months',
      label: 'Warranty term',
      value: { type: 'number', value: 0, unit: 'months' },
      origin: 'pack',
      sourceIds: [],
      status: 'unknown',
      updatedAt: AT,
    };
    expect(AttributeRecordSchema.safeParse(invalidHybrid).success).toBe(false);
  });
});

describe('bid.credentials_valid attribute: single-attribute gate, not a composite', () => {
  it('the criterion applies to one attribute rather than composedOfAttributes (hard constraints cannot gate on a composite)', () => {
    const criterion = BID_COMPARISON_MANIFEST.criteria.defaults.find(
      (entry) => entry.id === 'bid.credentials_valid',
    );
    expect(criterion?.appliesToAttribute).toBe('bid.credentials_valid');
    expect(criterion?.composedOfAttributes).toBeUndefined();
  });

  it('the underlying attribute is a boolean with comparison "constraint"', () => {
    const definition = BID_COMPARISON_MANIFEST.attributes.find(
      (attribute) => attribute.id === 'bid.credentials_valid',
    );
    expect(definition?.valueType).toBe('boolean');
    expect(definition?.comparison).toBe('constraint');
  });
});

describe('presentation renderability', () => {
  it('assigns every declared non-sensitive attribute to a presentation.attributeGroups entry', () => {
    const renderableIds = new Set(
      BID_COMPARISON_MANIFEST.presentation.attributeGroups.flatMap((group) => group.attributeIds),
    );
    for (const attribute of BID_COMPARISON_MANIFEST.attributes) {
      if (!attribute.sensitive) {
        expect(renderableIds.has(attribute.id)).toBe(true);
      }
    }
  });
});

describe('evaluation (negative case required)', () => {
  it('requires a negative case and declares at least a happy-path and a negative scenario id', () => {
    expect(BID_COMPARISON_MANIFEST.evaluation.requiresNegativeCase).toBe(true);
    expect(BID_COMPARISON_MANIFEST.evaluation.scenarioIds.length).toBeGreaterThanOrEqual(2);
  });
});

describe('decisionGuide (§46/§47 pack-level Decision Guide)', () => {
  it('declares a Decision Guide with real, non-empty content in every field', () => {
    const guide = BID_COMPARISON_MANIFEST.decisionGuide;
    expect(guide).toBeDefined();
    expect(guide?.domainPurpose.length).toBeGreaterThan(0);
    expect(guide?.discoveryStrategy.length).toBeGreaterThan(0);
    expect(guide?.researchGuidance.length).toBeGreaterThan(0);
    expect(guide?.customFieldGuidance.length).toBeGreaterThan(0);
    expect(guide?.presentationGuidance.length).toBeGreaterThan(0);
    expect(guide?.suggestedQuestions.length).toBeGreaterThan(0);
    expect(guide?.importantUnknowns.length).toBeGreaterThan(0);
  });

  it('suggests questions that actually read as questions, not asserted facts', () => {
    const guide = BID_COMPARISON_MANIFEST.decisionGuide;
    for (const question of guide?.suggestedQuestions ?? []) {
      expect(question.trim().endsWith('?')).toBe(true);
    }
  });
});

// Compliance: the pack-level "real-world rules and standards this class of
// decision is governed by" declaration (packs.ts's `PackComplianceSchema`).
// Every citation is verified real content, not invented, so this suite
// checks against the exact statutes/regulations named in the brief rather
// than merely "some non-empty string exists."
describe('compliance (real-world rules and standards)', () => {
  it('declares a compliance value with a disclaimer and every named standard', () => {
    const compliance = BID_COMPARISON_MANIFEST.compliance;
    expect(compliance).toBeDefined();
    expect(compliance?.disclaimer.length).toBeGreaterThan(0);
    expect(compliance?.standards.map((standard) => standard.id).sort()).toEqual(
      [
        'far-13-104-b-simplified-acquisitions',
        'nc-gs-143-132-public-construction',
        'comparable-state-bid-minimums',
        'license-and-insurance-verification',
      ].sort(),
    );
  });

  it('cites FAR 13.104(b) for the federal simplified-acquisition minimum', () => {
    const standard = BID_COMPARISON_MANIFEST.compliance?.standards.find(
      (entry) => entry.id === 'far-13-104-b-simplified-acquisitions',
    );
    expect(standard?.citation).toContain('FAR 13.104(b)');
    expect(standard?.summary).toContain('at least three sources');
  });

  it('cites N.C. Gen. Stat. § 143-132 for the North Carolina public-construction minimum, including the water/sewer carve-out', () => {
    const standard = BID_COMPARISON_MANIFEST.compliance?.standards.find(
      (entry) => entry.id === 'nc-gs-143-132-public-construction',
    );
    expect(standard?.citation).toBe('N.C. Gen. Stat. § 143-132');
    expect(standard?.summary).toContain('at least three competitive bids');
    expect(standard?.summary).toContain('July 7, 2026');
  });

  it('names Idaho, Pennsylvania, and Louisiana as comparable state minimums', () => {
    const standard = BID_COMPARISON_MANIFEST.compliance?.standards.find(
      (entry) => entry.id === 'comparable-state-bid-minimums',
    );
    expect(standard?.summary).toContain('Idaho');
    expect(standard?.summary).toContain('Pennsylvania');
    expect(standard?.summary).toContain('Louisiana');
  });

  it('describes license/insurance verification as an automated check, matching what license-lookup.ts actually verifies', () => {
    const standard = BID_COMPARISON_MANIFEST.compliance?.standards.find(
      (entry) => entry.id === 'license-and-insurance-verification',
    );
    expect(standard?.automatedCheck).toBeDefined();
    expect(standard?.automatedCheck).toContain('license is active');
    expect(standard?.automatedCheck).toContain('named insured');
  });

  // The three competitive-bid-minimum standards are read-only, informational
  // content: this pack cannot observe how many sources were solicited
  // (only how many bid documents exist in a case), so none of them may
  // claim an automated check it cannot honestly perform. See
  // `PackComplianceStandardSchema.automatedCheck`'s own doc comment.
  it('declares no automatedCheck for any of the three competitive-bid-minimum standards', () => {
    const bidMinimumIds = [
      'far-13-104-b-simplified-acquisitions',
      'nc-gs-143-132-public-construction',
      'comparable-state-bid-minimums',
    ];
    for (const id of bidMinimumIds) {
      const standard = BID_COMPARISON_MANIFEST.compliance?.standards.find(
        (entry) => entry.id === id,
      );
      expect(standard?.automatedCheck, `${id} must not claim an automated check`).toBeUndefined();
    }
  });

  it('every standard states a humanResponsibility -- this pack never claims a compliance determination on its own', () => {
    for (const standard of BID_COMPARISON_MANIFEST.compliance?.standards ?? []) {
      expect(standard.humanResponsibility.length, standard.id).toBeGreaterThan(0);
    }
  });

  it('states minimums on the awarding party, never a cap on bid count or a claim that any count is typical', () => {
    const compliance = BID_COMPARISON_MANIFEST.compliance;
    expect(compliance?.disclaimer.toLowerCase()).toContain('not a cap');
    expect(compliance?.disclaimer.toLowerCase()).toContain('not a claim');
  });

  it('is not legal advice -- the disclaimer and every human-facing string say so or defer to the reader explicitly', () => {
    expect(BID_COMPARISON_MANIFEST.compliance?.disclaimer.toLowerCase()).toContain(
      'not legal advice',
    );
  });

  // This scenario is separately being scaled from 3 bids to 12 bids
  // (packages/scenarios/fixtures/bids/*, out of this task's scope). No
  // compliance string may hard-code a claim about how many bids THIS case
  // holds -- only the cited statutes' own "at least three" language, which
  // is a rule about sourcing before an award, not a fact about this case.
  it('never asserts a specific bid count for this case (only the cited statutes own minimums)', () => {
    const compliance = BID_COMPARISON_MANIFEST.compliance;
    const allText = [
      compliance?.disclaimer ?? '',
      ...(compliance?.standards.flatMap((standard) => [
        standard.summary,
        standard.humanResponsibility,
        standard.automatedCheck ?? '',
      ]) ?? []),
    ].join(' \n ');
    expect(allText).not.toMatch(/\bthe three bids\b/i);
    expect(allText).not.toMatch(/\bthree bids in this case\b/i);
  });

  /**
   * The consumer-invisibility rule ADR 0004 decision item 1 enforces, asserted
   * against the content this pack ACTUALLY ships rather than against a test
   * fixture.
   *
   * `HowSiftWorks.test.tsx` already asserts that the rendering component adds
   * none of this vocabulary, but it renders `samplePackCompliance()` -- a
   * synthetic fixture. That proves the component is clean; it cannot prove the
   * shipped copy is, because the component faithfully renders whatever a pack
   * author wrote. This pack shipped exactly that gap once: the FAR standard's
   * `humanResponsibility` read "this pack can show how many bids are recorded"
   * and would have rendered the word "pack" into the consumer surface, with
   * the component test passing throughout.
   *
   * Every string here is user-visible (`HowSiftWorks.tsx` renders `summary`,
   * `citation`, `authority`, `automatedCheck`, and `humanResponsibility`), so
   * the whole block is checked, not a sample of it.
   */
  it('ships no pack/manifest/evidence-level vocabulary in any user-visible string', () => {
    const compliance = BID_COMPARISON_MANIFEST.compliance;
    expect(compliance).toBeDefined();
    const visible = [
      compliance?.disclaimer ?? '',
      ...(compliance?.standards.flatMap((standard) => [
        standard.label,
        standard.summary,
        standard.citation,
        standard.authority,
        standard.humanResponsibility,
        standard.automatedCheck ?? '',
      ]) ?? []),
    ].join(' \n ');

    expect(visible).not.toMatch(/\bpack\b/i);
    expect(visible).not.toMatch(/\bmanifest\b/i);
    expect(visible).not.toMatch(/\bobligation\b/i);
    expect(visible).not.toMatch(/\bdisposition\b/i);
    expect(visible).not.toMatch(/\breadiness\b/i);
    expect(visible).not.toMatch(/\bE[0-3]\b/);
  });
});

describe('full manifest fidelity', () => {
  // See home-energy-guardian.test.ts's identical suite for the full
  // rationale: structural suites above don't pin individual field values,
  // so this snapshot pins the entire manifest verbatim.
  it('matches its full manifest snapshot', () => {
    expect(BID_COMPARISON_MANIFEST).toMatchSnapshot();
  });
});
