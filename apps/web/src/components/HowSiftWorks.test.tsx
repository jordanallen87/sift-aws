import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { AppProviders } from '../app/AppProviders.js';
import { InMemoryModelContextAdapter } from '../model-context/adapter.js';
import { SIFT_WEBMCP_TOOL_NAMES } from '../model-context/register-sift-tools.js';
import {
  ASSISTANT_PHRASES,
  BID_COMPARISON_ASSISTANT_PHRASES,
  HOW_SIFT_WORKS_SUMMARY,
  HOW_SIFT_WORKS_TITLE,
  HowSiftWorksContent,
  resolveAssistantPhrases,
} from './HowSiftWorks.js';
import { DEMO_OPTIONS } from './demo-options.js';

/** WebMCP present: the real `InMemoryModelContextAdapter.supported()` returns `true`. */
function renderWithWebMcp(props: Parameters<typeof HowSiftWorksContent>[0] = {}) {
  return render(
    <AppProviders webMcpAdapter={new InMemoryModelContextAdapter()}>
      <HowSiftWorksContent {...props} />
    </AppProviders>,
  );
}

/**
 * A realistic `PackCompliance` value, shaped like `bid-comparison.ts`'s real
 * declaration but kept minimal: one standard with an `automatedCheck`, one
 * without, so both rendering branches in `ComplianceStandardRow` are
 * exercised.
 */
function samplePackCompliance() {
  return {
    disclaimer:
      'These are informational minimums, not legal advice -- confirm what applies in your own jurisdiction.',
    standards: [
      {
        id: 'three-bid-minimum',
        label: 'Minimum competitive bids for public construction contracts',
        summary: 'Several jurisdictions require at least three competitive bids before an award.',
        citation: 'N.C. Gen. Stat. § 143-132',
        authority: 'North Carolina General Assembly',
        humanResponsibility: 'Confirm which jurisdiction actually governs this award.',
      },
      {
        id: 'license-and-insurance',
        label: 'Active license and insurance covering the scope of work',
        summary: "A contractor's license must be active and cover the scope of work.",
        citation: 'Varies by jurisdiction',
        authority: 'State contractor licensing board',
        automatedCheck:
          "Confirms the contractor's licence is active and its certificate of insurance names the licence holder.",
        humanResponsibility: 'Confirm the licensing board record itself is current.',
      },
    ],
  };
}

/**
 * WebMCP absent: rendered with no `<AppProviders>` at all, which is the
 * same signal a stock browser gives -- `useWebMcpSupported()` resolves to
 * `false` rather than throwing.
 */
function renderWithoutWebMcp() {
  return render(<HowSiftWorksContent />);
}

describe('HowSiftWorks shared content', () => {
  it('cites only tools that are genuinely registered', () => {
    const registered = new Set<string>(SIFT_WEBMCP_TOOL_NAMES);
    for (const phrase of ASSISTANT_PHRASES) {
      expect(phrase.tools.length).toBeGreaterThan(0);
      for (const tool of phrase.tools) {
        expect(registered.has(tool), `${tool} is not in SIFT_WEBMCP_TOOL_NAMES`).toBe(true);
      }
    }
  });

  it('never cites an approval-shaped tool, because none exists', () => {
    const approvalShaped = /approve|reject|review_proposal|reviewProposal/i;
    for (const phrase of ASSISTANT_PHRASES) {
      for (const tool of phrase.tools) {
        expect(approvalShaped.test(tool)).toBe(false);
      }
    }
  });

  it('names the product and the shared-authority claim in one summary line', () => {
    expect(HOW_SIFT_WORKS_TITLE).toBe('How Sift works');
    expect(HOW_SIFT_WORKS_SUMMARY).toMatch(/share/i);
  });

  it('names the real visible controls, exactly as they render', () => {
    renderWithWebMcp();
    const controls = screen.getByTestId('how-sift-works-controls');
    // Every string below is a live label: RecommendationHero.tsx ("Have Sift
    // investigate", "Inspect run"), WorkspaceAppBar.tsx ("Findings",
    // CREATE_MENU_LABEL "Add or adjust"), DemoLauncher.tsx.
    expect(within(controls).getByText('Have Sift investigate')).toBeInTheDocument();
    expect(within(controls).getByText('Findings')).toBeInTheDocument();
    expect(within(controls).getByText('Add or adjust')).toBeInTheDocument();
    expect(within(controls).getByText('Inspect run')).toBeInTheDocument();
  });

  it('names the real launcher entry points', () => {
    renderWithWebMcp();
    const start = screen.getByTestId('how-sift-works-start');
    expect(within(start).getByText('Compare vehicles')).toBeInTheDocument();
    expect(within(start).getByText(/Or try a finished example/)).toBeInTheDocument();
  });

  // Regression gate: this line hard-coded "two ready-made cases" long after
  // a third (`bid-comparison`) demo card existed. Reading it off
  // `DEMO_OPTIONS.length` instead -- the exact array `DemoLauncher.tsx`
  // renders the cards from -- means it cannot go stale again.
  it('names the real number of ready-made examples, not a hard-coded count', () => {
    renderWithWebMcp();
    const start = screen.getByTestId('how-sift-works-start');
    expect(
      within(start).getByText(new RegExp(`${DEMO_OPTIONS.length} ready-made cases`)),
    ).toBeInTheDocument();
  });

  it('renders every copy-paste assistant phrase with what it does', () => {
    renderWithWebMcp();
    const phrases = screen.getByTestId('how-sift-works-phrases');
    for (const phrase of ASSISTANT_PHRASES) {
      expect(within(phrases).getByText(`“${phrase.phrase}”`)).toBeInTheDocument();
      expect(within(phrases).getByText(phrase.effect)).toBeInTheDocument();
    }
    expect(ASSISTANT_PHRASES.length).toBeGreaterThanOrEqual(6);
  });

  it('states the authority boundary and names the human-only controls', () => {
    renderWithWebMcp();
    const boundary = screen.getByTestId('how-sift-works-authority');
    expect(boundary).toHaveTextContent(/cannot approve/i);
    // `ApprovalCard.tsx`'s three real decision controls, asserted both ways:
    // the current labels must be present AND the retired ones absent. This
    // help text went on naming "Choose this" and "Keep researching" after
    // both were renamed, so it described buttons that no longer existed --
    // a passing test is what let that sit there.
    expect(boundary).toHaveTextContent('Select');
    expect(boundary).toHaveTextContent('Pass');
    expect(boundary).toHaveTextContent('Continue investigation');
    expect(boundary).not.toHaveTextContent('Keep researching');
    expect(boundary).not.toHaveTextContent('Choose this');
  });

  it('reports the real registered tool count rather than a hard-coded number', () => {
    renderWithWebMcp();
    expect(screen.getByTestId('how-sift-works-phrases-lead')).toHaveTextContent(
      String(SIFT_WEBMCP_TOOL_NAMES.length),
    );
  });

  it('promises assistant interaction only where WebMCP actually exists', () => {
    renderWithWebMcp();
    const lead = screen.getByTestId('how-sift-works-phrases-lead');
    expect(lead).toHaveTextContent(/plain language is enough/i);
    expect(lead).not.toHaveTextContent(/no WebMCP host/i);
  });

  it('says plainly that an assistant cannot reach this page when WebMCP is unavailable', () => {
    renderWithoutWebMcp();
    const lead = screen.getByTestId('how-sift-works-phrases-lead');
    expect(lead).toHaveTextContent(/no WebMCP host/i);
    // The phrases still render -- they are what the product does, and they
    // are honestly framed as host-dependent rather than promised here.
    expect(screen.getByTestId('how-sift-works-phrases')).toBeInTheDocument();
  });

  it('has no axe violations in either WebMCP state', async () => {
    const supported = renderWithWebMcp();
    expect(await axe(supported.container)).toHaveNoViolations();
    supported.unmount();

    const unsupported = renderWithoutWebMcp();
    expect(await axe(unsupported.container)).toHaveNoViolations();
  });
});

// Pack-aware "Talking to your assistant" examples (defect: the sheet showed
// hardcoded car examples -- "I need a dog crate to fit", "the seat position
// felt wrong on the test drive" -- on every pack, including a
// bid-comparison case where they read as nonsense next to subcontractor
// bids). `resolveAssistantPhrases` is the fix; these tests cover both the
// pure resolver and what it actually renders.
describe('HowSiftWorks: pack-aware assistant phrases (packId)', () => {
  it('resolves to the default (car-flavoured) phrases when no pack id is given', () => {
    expect(resolveAssistantPhrases(null)).toBe(ASSISTANT_PHRASES);
    expect(resolveAssistantPhrases(undefined)).toBe(ASSISTANT_PHRASES);
  });

  it('resolves to the default phrases for a pack with no dedicated list of its own', () => {
    expect(resolveAssistantPhrases('car-purchase')).toBe(ASSISTANT_PHRASES);
    expect(resolveAssistantPhrases('home-energy-guardian')).toBe(ASSISTANT_PHRASES);
    expect(resolveAssistantPhrases('some-future-pack-id')).toBe(ASSISTANT_PHRASES);
  });

  it("resolves to bid-comparison's own phrases for a bid-comparison case", () => {
    expect(resolveAssistantPhrases('bid-comparison')).toBe(BID_COMPARISON_ASSISTANT_PHRASES);
  });

  it('cites only tools that are genuinely registered, for the bid-comparison set too', () => {
    const registered = new Set<string>(SIFT_WEBMCP_TOOL_NAMES);
    for (const phrase of BID_COMPARISON_ASSISTANT_PHRASES) {
      expect(phrase.tools.length).toBeGreaterThan(0);
      for (const tool of phrase.tools) {
        expect(registered.has(tool), `${tool} is not in SIFT_WEBMCP_TOOL_NAMES`).toBe(true);
      }
    }
  });

  it('never cites an approval-shaped tool in the bid-comparison set, because none exists', () => {
    const approvalShaped = /approve|reject|review_proposal|reviewProposal/i;
    for (const phrase of BID_COMPARISON_ASSISTANT_PHRASES) {
      for (const tool of phrase.tools) {
        expect(approvalShaped.test(tool)).toBe(false);
      }
    }
  });

  it('renders bid-shaped examples, not the car defaults, on a bid-comparison case', () => {
    renderWithWebMcp({ packId: 'bid-comparison' });
    const phrases = screen.getByTestId('how-sift-works-phrases');
    for (const phrase of BID_COMPARISON_ASSISTANT_PHRASES) {
      expect(within(phrases).getByText(`“${phrase.phrase}”`)).toBeInTheDocument();
    }
    expect(within(phrases).queryByText(/dog crate/i)).not.toBeInTheDocument();
    expect(within(phrases).queryByText(/test drive/i)).not.toBeInTheDocument();
    expect(within(phrases).queryByText(/driving comfort/i)).not.toBeInTheDocument();
  });

  it('keeps rendering the car defaults when no case is open yet', () => {
    renderWithWebMcp();
    const phrases = screen.getByTestId('how-sift-works-phrases');
    expect(
      within(phrases).getByText('“Look into the safety record on these.”'),
    ).toBeInTheDocument();
  });

  it('falls back to the car defaults for a pack id with no list of its own (home-energy-guardian)', () => {
    renderWithWebMcp({ packId: 'home-energy-guardian' });
    const phrases = screen.getByTestId('how-sift-works-phrases');
    expect(
      within(phrases).getByText('“Look into the safety record on these.”'),
    ).toBeInTheDocument();
  });

  it('has no axe violations rendering the bid-comparison phrase set', async () => {
    const rendered = renderWithWebMcp({ packId: 'bid-comparison' });
    expect(await axe(rendered.container)).toHaveNoViolations();
  });
});

// "What gets checked" (the compliance surface, packs.ts's
// `PackComplianceSchema`). Mirrors `WorkspaceAlertBanner`'s established
// "render nothing, not an empty shell" rule and ADR 0004's ban on surfacing
// Decision Pack identity -- these tests exist specifically to catch a
// regression toward either one.
describe('HowSiftWorks: what gets checked (compliance)', () => {
  it('renders no compliance section at all when compliance is omitted -- the default, pre-case case', () => {
    renderWithWebMcp();
    expect(screen.queryByTestId('how-sift-works-compliance')).not.toBeInTheDocument();
  });

  it('renders no compliance section when compliance is explicitly null', () => {
    renderWithWebMcp({ compliance: null });
    expect(screen.queryByTestId('how-sift-works-compliance')).not.toBeInTheDocument();
  });

  it('renders no compliance section when compliance declares zero standards', () => {
    renderWithWebMcp({ compliance: { disclaimer: 'x', standards: [] } });
    expect(screen.queryByTestId('how-sift-works-compliance')).not.toBeInTheDocument();
  });

  it('renders the disclaimer and every declared standard when compliance is present', () => {
    const compliance = samplePackCompliance();
    renderWithWebMcp({ compliance });
    const section = screen.getByTestId('how-sift-works-compliance');
    expect(within(section).getByText(compliance.disclaimer)).toBeInTheDocument();
    for (const standard of compliance.standards) {
      const row = within(section).getByTestId(`how-sift-works-compliance-standard-${standard.id}`);
      expect(within(row).getByText(standard.label)).toBeInTheDocument();
      expect(within(row).getByText(standard.summary)).toBeInTheDocument();
      expect(row).toHaveTextContent(standard.citation);
      expect(row).toHaveTextContent(standard.authority);
      expect(row).toHaveTextContent(standard.humanResponsibility);
    }
  });

  it('renders "Sift checks" only for a standard that declares an automatedCheck', () => {
    const compliance = samplePackCompliance();
    renderWithWebMcp({ compliance });
    const withCheck = screen.getByTestId(
      'how-sift-works-compliance-standard-license-and-insurance',
    );
    expect(withCheck).toHaveTextContent('Sift checks:');
    const withoutCheck = screen.getByTestId('how-sift-works-compliance-standard-three-bid-minimum');
    expect(withoutCheck).not.toHaveTextContent('Sift checks:');
  });

  // The exact consumer-invisibility properties ADR 0004 requires: this
  // section never names the pack, the manifest, an obligation, a
  // disposition, "readiness," or an evidence-level token, no matter what a
  // pack author declares in its compliance content.
  it('never renders pack/manifest/evidence-level vocabulary anywhere in this section', () => {
    const compliance = samplePackCompliance();
    renderWithWebMcp({ compliance });
    const section = screen.getByTestId('how-sift-works-compliance');
    expect(section).not.toHaveTextContent(/\bpack\b/i);
    expect(section).not.toHaveTextContent(/\bmanifest\b/i);
    expect(section).not.toHaveTextContent(/\bobligation\b/i);
    expect(section).not.toHaveTextContent(/\bdisposition\b/i);
    expect(section).not.toHaveTextContent(/\breadiness\b/i);
    expect(section).not.toHaveTextContent(/\bE[0-3]\b/);
  });

  it('has no axe violations with a real compliance section rendered', async () => {
    const rendered = renderWithWebMcp({ compliance: samplePackCompliance() });
    expect(await axe(rendered.container)).toHaveNoViolations();
  });
});
