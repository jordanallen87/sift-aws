import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { Recommendation, Source } from '@sift/contracts';
import { RecommendationCard } from './RecommendationCard.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';

function buildRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'recommendation-1',
    status: 'ready',
    favoredOptionId: 'option-1',
    rationale: 'The Civic has the lowest total out-the-door cost among confirmed offers.',
    facts: ['Dealer A confirmed $28,450 out-the-door.', 'Dealer B confirmed $29,100 out-the-door.'],
    hypotheses: ['Dealer A may match Dealer B if asked directly.'],
    confidence: 0.82,
    limitations: ['Financing terms were not compared.'],
    sourceIds: ['source-1'],
    resolvedObligationIds: ['obligation-1'],
    acceptedUncertaintyObligationIds: [],
    generatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function buildSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'source-1',
    url: 'https://dealer.example.com/quote/123',
    title: 'Dealer A written quote',
    retrievedAt: '2026-08-27T00:00:00.000Z',
    origin: 'user_submitted',
    verification: 'unverified',
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('RecommendationCard', () => {
  it('renders the initial/empty state when no recommendation exists and none was withheld', () => {
    render(<RecommendationCard recommendation={null} />);
    expect(screen.getByTestId('recommendation-card-empty')).toHaveTextContent(
      /no recommendation yet/i,
    );
  });

  it('renders a loading state', () => {
    render(<RecommendationCard recommendation={null} loading />);
    expect(screen.getByTestId('recommendation-card-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the exact required "Draft withheld" copy for the premature-conclusion sequence', () => {
    // docs/specs/value-proposition.md "Required visible copy" verbatim.
    render(<RecommendationCard recommendation={null} withheld={{ unresolvedRequiredCount: 3 }} />);

    const withheld = screen.getByTestId('recommendation-card-withheld');
    expect(withheld).toHaveTextContent('Draft withheld');
    expect(withheld).toHaveTextContent(
      'This answer is plausible, but 3 required questions are still unresolved.',
    );
    expect(withheld).toHaveTextContent(
      'Sift is continuing the investigation before asking you to decide.',
    );
  });

  it('grammatically singularizes the withheld copy for exactly one unresolved question', () => {
    render(<RecommendationCard recommendation={null} withheld={{ unresolvedRequiredCount: 1 }} />);
    expect(screen.getByTestId('recommendation-card-withheld')).toHaveTextContent(
      'This answer is plausible, but 1 required question is still unresolved.',
    );
  });

  it('renders a ready recommendation with facts and hypotheses visually and textually distinct', () => {
    render(<RecommendationCard recommendation={buildRecommendation()} />);

    expect(screen.getByTestId('recommendation-card-status')).toHaveTextContent(/ready for review/i);
    const facts = screen.getByTestId('recommendation-card-facts');
    const hypotheses = screen.getByTestId('recommendation-card-hypotheses');
    expect(facts).toHaveTextContent('Dealer A confirmed $28,450 out-the-door.');
    expect(hypotheses).toHaveTextContent('Dealer A may match Dealer B if asked directly.');
    // Distinct containers, not merged into one list.
    expect(facts).not.toHaveTextContent('Dealer A may match Dealer B');
    expect(hypotheses).not.toHaveTextContent('Dealer A confirmed $28,450');
  });

  it('omits the facts and hypotheses blocks entirely -- not as an empty tinted callout -- when there is no content yet', () => {
    // Global constraint 4 ("never render what cannot be true") and
    // change-set DoD item 35 ("Empty conceptual regions are not rendered
    // unnecessarily"): an empty-but-present FACTS/HYPOTHESES block is
    // exactly the defect, so assert absence, not merely emptiness.
    render(
      <RecommendationCard
        recommendation={buildRecommendation({ facts: [], hypotheses: [], sourceIds: [] })}
      />,
    );

    expect(screen.queryByTestId('recommendation-card-facts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recommendation-card-hypotheses')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recommendation-card-sources')).not.toBeInTheDocument();
  });

  it('renders limitations when present', () => {
    render(<RecommendationCard recommendation={buildRecommendation()} />);
    expect(screen.getByTestId('recommendation-card-limitations')).toHaveTextContent(
      'Financing terms were not compared.',
    );
  });

  it('does not render a limitations section when there are none', () => {
    render(<RecommendationCard recommendation={buildRecommendation({ limitations: [] })} />);
    expect(screen.queryByTestId('recommendation-card-limitations')).not.toBeInTheDocument();
  });

  it('renders a clickable source link when a joined Source is supplied', () => {
    render(
      <RecommendationCard
        recommendation={buildRecommendation()}
        sources={{ 'source-1': buildSource() }}
      />,
    );
    const link = screen.getByTestId('recommendation-card-source-source-1');
    expect(link).toHaveAttribute('href', 'https://dealer.example.com/quote/123');
    expect(link).toHaveTextContent('Dealer A written quote');
  });

  it('falls back to a plain reference chip when no joined Source is supplied', () => {
    render(<RecommendationCard recommendation={buildRecommendation()} />);
    // Distinct testid from the resolved-link branch (`recommendation-card-
    // source-*`) -- see the regression test below for why the two must
    // never collide.
    const chip = screen.getByTestId('recommendation-card-unresolved-source-source-1');
    expect(chip.tagName).not.toBe('A');
    expect(chip).toHaveTextContent('[source-1]');
  });

  it('gives a dangling source id its own testid, distinct from a resolved one, so a test cannot mistake one for the other', () => {
    // A real 60-dangling-citation bug shipped past every existing test
    // because the resolved `<a>` and the unresolved `<span>` shared one
    // testid (`recommendation-card-source-${sourceId}`) -- a suite that
    // only counted `li` elements saw the same number either way. This
    // asserts the two branches are independently locatable: the resolved
    // id renders as a link under `recommendation-card-source-*`, and the
    // dangling id renders under the distinct `recommendation-card-
    // unresolved-source-*` testid, not the resolved one.
    render(
      <RecommendationCard
        recommendation={buildRecommendation({ sourceIds: ['source-1', 'source-missing'] })}
        sources={{ 'source-1': buildSource() }}
      />,
    );

    const link = screen.getByTestId('recommendation-card-source-source-1');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://dealer.example.com/quote/123');
    expect(link).toHaveTextContent('Dealer A written quote');

    const dangling = screen.getByTestId('recommendation-card-unresolved-source-source-missing');
    expect(dangling.tagName).not.toBe('A');
    expect(dangling).toHaveTextContent('[source-missing]');
    expect(
      screen.queryByTestId('recommendation-card-source-source-missing'),
    ).not.toBeInTheDocument();
  });

  // See `RecommendationHero.test.tsx`'s companion regression for the
  // baseline screenshot this came from. `recommendation.status` describes
  // the recommendation object and stays `'ready'` after the human answers;
  // the chip is a claim about where the *case* is, so once a verdict exists
  // the verdict is what it must state.
  it.each([
    ['approved', 'Decided'],
    ['rejected', 'Not chosen'],
    ['revision_requested', 'Revision requested'],
  ] as const)(
    'states the human verdict (%s) instead of "Ready for review" once the proposal is settled',
    (settledDecision, expectedLabel) => {
      render(
        <RecommendationCard
          recommendation={buildRecommendation()}
          settledDecision={settledDecision}
        />,
      );

      const chip = screen.getByTestId('recommendation-card-status');
      expect(chip).toHaveTextContent(expectedLabel);
      expect(chip).not.toHaveTextContent(/ready for review/i);
    },
  );

  it('keeps saying "Ready for review" while no verdict has been rendered yet', () => {
    const { rerender } = render(<RecommendationCard recommendation={buildRecommendation()} />);
    expect(screen.getByTestId('recommendation-card-status')).toHaveTextContent(/ready for review/i);

    rerender(<RecommendationCard recommendation={buildRecommendation()} settledDecision={null} />);
    expect(screen.getByTestId('recommendation-card-status')).toHaveTextContent(/ready for review/i);
  });

  it("lets the human verdict win over the recommendation's own stale status", () => {
    // A settled case is not waiting on anything the chip could report about
    // the recommendation object; the most consequential true thing about
    // this card is that the person already answered.
    render(
      <RecommendationCard
        recommendation={buildRecommendation({ status: 'stale' })}
        settledDecision="approved"
      />,
    );

    expect(screen.getByTestId('recommendation-card-status')).toHaveTextContent('Decided');
  });

  it('renders a stale recommendation with a distinct textual note, not just a color change', () => {
    render(<RecommendationCard recommendation={buildRecommendation({ status: 'stale' })} />);

    expect(screen.getByTestId('recommendation-card-status')).toHaveTextContent(/stale/i);
    expect(screen.getByTestId('recommendation-card-stale-note')).toHaveTextContent(
      /new evidence or a criteria change has invalidated this recommendation/i,
    );
  });

  it('never claims work is under way on a stale recommendation, because invalidation starts no run', () => {
    // Traced, not assumed. `CommandService.updateCriteria`
    // (apps/agent/src/services/command-service.ts) appends
    // `recommendation.invalidated` and calls `notifyRunPlan` ->
    // `RunPlanService.revisePlan` (apps/agent/src/services/
    // run-plan-service.ts), which re-derives the plan, persists it, and
    // emits `plan.revised`. It launches no engine run. Nothing is
    // recomputed until a human or a tool calls `requestInvestigation`, so
    // neither the chip nor the note may say Sift is recomputing anything --
    // this product's whole claim is that it does not assert what it has not
    // earned, and the one place that must hold is its own UI.
    render(<RecommendationCard recommendation={buildRecommendation({ status: 'stale' })} />);

    const status = screen.getByTestId('recommendation-card-status');
    const note = screen.getByTestId('recommendation-card-stale-note');

    expect(status).not.toHaveTextContent(/recomputing/i);
    expect(note).not.toHaveTextContent(/recomputing/i);

    expect(status).toHaveTextContent('Stale — needs investigation');
    expect(note).toHaveTextContent(
      'Sift has not looked into the change yet, so the content below may no longer reflect the current case.',
    );
  });

  it('has no axe violations across empty, loading, withheld, ready, stale, and settled states', async () => {
    const { container: empty } = render(<RecommendationCard recommendation={null} />);
    expect(await axe(empty)).toHaveNoViolations();

    const { container: loading } = render(<RecommendationCard recommendation={null} loading />);
    expect(await axe(loading)).toHaveNoViolations();

    const { container: withheld } = render(
      <RecommendationCard recommendation={null} withheld={{ unresolvedRequiredCount: 2 }} />,
    );
    expect(await axe(withheld)).toHaveNoViolations();

    const { container: ready } = render(
      <RecommendationCard recommendation={buildRecommendation()} />,
    );
    expect(await axe(ready)).toHaveNoViolations();

    const { container: stale } = render(
      <RecommendationCard recommendation={buildRecommendation({ status: 'stale' })} />,
    );
    expect(await axe(stale)).toHaveNoViolations();

    const { container: settled } = render(
      <RecommendationCard recommendation={buildRecommendation()} settledDecision="approved" />,
    );
    expect(await axe(settled)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk', () => {
    const { overflowRisks } = renderAtNarrowWidth(
      <RecommendationCard
        recommendation={buildRecommendation()}
        sources={{ 'source-1': buildSource() }}
      />,
    );
    expect(overflowRisks).toEqual([]);
  });
});
