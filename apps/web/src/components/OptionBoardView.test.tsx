import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type {
  AttributeDefinition,
  Criterion,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { OptionBoardView, type OptionBoardViewProps } from './OptionBoardView.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';
import { buildWorkspaceScoreboard } from './case-scoreboard.js';
import {
  buildCarCaseState,
  buildEnergyCaseState,
  CAR_CRITERIA,
  CAR_DEFINITIONS,
  CAR_OPTIONS,
  CAR_PRESENTATION,
  ENERGY_CRITERIA,
  ENERGY_DEFINITIONS,
  ENERGY_OPTIONS,
  ENERGY_PRESENTATION,
} from '../test/scoreboard-fixtures.js';

const DEFINITIONS: AttributeDefinition[] = [
  {
    id: 'price',
    label: 'Price',
    valueType: 'money',
    required: false,
    appliesTo: ['car'],
    evidenceExpectation: 'assertion',
    comparison: 'lower_better',
    sensitive: false,
  },
  {
    id: 'mileage',
    label: 'Mileage',
    valueType: 'number',
    required: false,
    appliesTo: ['car'],
    unit: 'mi',
    evidenceExpectation: 'assertion',
    comparison: 'lower_better',
    sensitive: false,
  },
  {
    id: 'custom.laptop_work_fit',
    label: 'Laptop work fit',
    valueType: 'string',
    required: false,
    appliesTo: ['car'],
    evidenceExpectation: 'assertion',
    comparison: 'none',
    sensitive: false,
  },
];

function buildEntity(overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 'option-1',
    kind: 'car',
    label: 'Toyota RAV4',
    attributes: {
      price: {
        definitionId: 'price',
        label: 'Price',
        value: { type: 'money', amount: 28500, currency: 'USD' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
      mileage: {
        definitionId: 'mileage',
        label: 'Mileage',
        value: { type: 'number', value: 15000, unit: 'mi' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    },
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

// Deliberately named `option-1` / `option-2` / `option-3` -- the task brief's own example of a
// raw internal id that must never leak into rendered text.
const OPTIONS: EntityRecord[] = [
  buildEntity(),
  buildEntity({
    id: 'option-2',
    label: 'Honda CR-V',
    attributes: {
      price: {
        definitionId: 'price',
        label: 'Price',
        value: { type: 'money', amount: 32400, currency: 'USD' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
      mileage: {
        definitionId: 'mileage',
        label: 'Mileage',
        value: { type: 'number', value: 12000, unit: 'mi' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    },
  }),
  buildEntity({
    id: 'option-3',
    label: 'Subaru Forester',
    attributes: {
      'custom.laptop_work_fit': {
        definitionId: 'custom.laptop_work_fit',
        label: 'Laptop work fit',
        value: { type: 'string', value: 'Poor' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    },
  }),
];

function noop() {
  // intentionally empty default for props this suite does not exercise
}

function boardView(overrides: Partial<OptionBoardViewProps> = {}) {
  const props: OptionBoardViewProps = {
    options: OPTIONS,
    attributeDefinitions: DEFINITIONS,
    presentation: null,
    criteria: [],
    optionColumnIds: {},
    selectedOptionId: null,
    layout: 'narrow',
    onMoveOption: noop,
    onFocusOption: noop,
    ...overrides,
  };
  return <OptionBoardView {...props} />;
}

describe('OptionBoardView', () => {
  it('renders the four default columns when none are supplied', () => {
    render(boardView());

    expect(screen.getByTestId('board-column-considering')).toHaveTextContent('Comparing');
    expect(screen.getByTestId('board-column-top_choices')).toHaveTextContent('Favorites');
    expect(screen.getByTestId('board-column-need_to_verify')).toHaveTextContent('Need to check');
    expect(screen.getByTestId('board-column-out')).toHaveTextContent('Ruled out');
  });

  it('honors custom columns', () => {
    render(
      boardView({
        columns: [
          { id: 'new_arrivals', label: 'New arrivals' },
          { id: 'finalists', label: 'Finalists' },
        ],
      }),
    );

    expect(screen.getByTestId('board-column-new_arrivals')).toHaveTextContent('New arrivals');
    expect(screen.getByTestId('board-column-finalists')).toHaveTextContent('Finalists');
    expect(screen.queryByTestId('board-column-considering')).not.toBeInTheDocument();
    expect(screen.queryByTestId('board-column-out')).not.toBeInTheDocument();
  });

  it('places each option in its assigned column; unassigned options land in the first column', () => {
    render(boardView({ optionColumnIds: { 'option-1': 'top_choices', 'option-2': 'out' } }));

    expect(
      within(screen.getByTestId('board-column-list-top_choices')).getByTestId(
        'board-card-option-1',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('board-column-list-out')).getByTestId('board-card-option-2'),
    ).toBeInTheDocument();
    // option-3 has no entry in optionColumnIds -- falls back to the first column (Comparing).
    expect(
      within(screen.getByTestId('board-column-list-considering')).getByTestId(
        'board-card-option-3',
      ),
    ).toBeInTheDocument();
  });

  it('moving an option via the keyboard-accessible control fires onMoveOption with correct args', async () => {
    const user = userEvent.setup();
    const onMoveOption = vi.fn();
    render(boardView({ onMoveOption }));

    const select = screen.getByTestId('board-move-option-1');
    await user.selectOptions(select, 'top_choices');

    expect(onMoveOption).toHaveBeenCalledExactlyOnceWith('option-1', 'top_choices');
  });

  it('does not move the option itself -- placement is driven entirely by props', async () => {
    const user = userEvent.setup();
    const onMoveOption = vi.fn();
    const { rerender } = render(boardView({ onMoveOption }));

    const select = screen.getByTestId('board-move-option-1');
    await user.selectOptions(select, 'top_choices');

    // The callback fired, but nothing about the rendered board moved on its own: option-1 is
    // still in Comparing because the component holds no internal placement state.
    expect(
      within(screen.getByTestId('board-column-list-considering')).getByTestId(
        'board-card-option-1',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('board-column-list-top_choices')).not.toBeInTheDocument();

    // Only re-rendering with new props -- as the caller would after actually persisting the
    // move -- changes what is on screen.
    rerender(boardView({ onMoveOption, optionColumnIds: { 'option-1': 'top_choices' } }));

    expect(
      within(screen.getByTestId('board-column-list-top_choices')).getByTestId(
        'board-card-option-1',
      ),
    ).toBeInTheDocument();
    // option-1 no longer sits in Comparing -- only the still-unassigned option-2/option-3 do.
    expect(
      within(screen.getByTestId('board-column-list-considering')).queryByTestId(
        'board-card-option-1',
      ),
    ).not.toBeInTheDocument();
  });

  it('focusing an option fires onFocusOption', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(boardView({ onFocusOption }));

    await user.click(screen.getByTestId('board-focus-option-2'));
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith('option-2');
  });

  // Regression test for the reported defect: this card's focus button
  // carries `aria-pressed={isSelected}`, promising a real toggle. Clicking
  // the already-selected card used to re-send the same id and leave it
  // permanently selected -- a dead end and an `aria-pressed` lie. It must
  // now clear the selection (`onFocusOption(null)`) instead.
  it('clicking the already-selected card clears the selection instead of re-selecting it', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(boardView({ selectedOptionId: 'option-2', onFocusOption }));

    await user.click(screen.getByTestId('board-focus-option-2'));
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("marks only the selected card's focus button aria-pressed, and every other card false", () => {
    render(boardView({ selectedOptionId: 'option-2' }));

    expect(screen.getByTestId('board-focus-option-2')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('board-focus-option-1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders a supplied reason and invents no reason text when none is supplied', () => {
    render(boardView({ reasons: { 'option-1': 'Dealer offer conflicts with advertised price' } }));

    expect(screen.getByTestId('board-reason-option-1')).toHaveTextContent(
      'Dealer offer conflicts with advertised price',
    );
    expect(screen.queryByTestId('board-reason-option-2')).not.toBeInTheDocument();
  });

  // The shipped board card had no headline stat at all -- 2-4 same-size
  // "Label: value" lines and nothing a person could glance at. The first
  // attribute `pickCardAttributeIds` returns is now promoted into its own
  // display-size callout, and the rest follow beneath it.
  it('leads each card with a headline stat, then the remaining decision-relevant facts', () => {
    render(boardView());

    const card = screen.getByTestId('board-card-option-1');
    expect(card).toHaveTextContent('Toyota RAV4');

    const headline = screen.getByTestId('board-headline-option-1');
    expect(headline).toHaveTextContent('Price');
    // Deterministic, comma-grouped, symbol-mapped formatting -- see
    // attribute-value-format.ts's header comment.
    expect(headline).toHaveTextContent('$28,500');

    const facts = screen.getByTestId('board-facts-option-1');
    expect(facts).toHaveTextContent('Mileage: 15,000 mi');
    // The headline is promoted OUT of the fact list, never duplicated into both.
    expect(facts).not.toHaveTextContent('Price');
  });

  it('renders no headline at all for an option whose prominent attributes are all unrecorded, rather than an empty callout', () => {
    const unknownOption = buildEntity({
      id: 'option-blank',
      label: 'Kia Sportage',
      attributes: {},
    });
    render(boardView({ options: [unknownOption] }));

    expect(screen.queryByTestId('board-headline-option-blank')).not.toBeInTheDocument();
    expect(screen.queryByTestId('board-facts-option-blank')).not.toBeInTheDocument();
    // The card still says something true about the option: everything is unknown.
    expect(screen.getByTestId('option-card-signals-option-blank')).toHaveTextContent('3 unknowns');
  });

  it("follows the pack's prominentAttributeIds order rather than raw attributeDefinitions order", () => {
    const presentation: PresentationDefinition = {
      optionLabel: 'car',
      optionLabelPlural: 'cars',
      // Mileage first, deliberately against both definition order and the
      // money-first fallback, so only the pack field can produce this result.
      prominentAttributeIds: ['mileage', 'price'],
      attributeGroups: [],
    };
    render(boardView({ options: [buildEntity()], presentation, layout: 'expanded' }));

    expect(screen.getByTestId('board-headline-option-1')).toHaveTextContent('Mileage');
    expect(screen.getByTestId('board-facts-option-1')).toHaveTextContent('Price: $28,500');
  });

  it('with no pack prominentAttributeIds, the heaviest criterion decides the headline', () => {
    const criteria: Criterion[] = [
      {
        id: 'crit-mileage',
        label: 'Low mileage matters most',
        kind: 'preference',
        weight: 80,
        direction: 'lower_better',
        appliesToAttribute: 'mileage',
        origin: 'user',
        status: 'active',
      },
    ];
    render(boardView({ options: [buildEntity()], criteria }));

    // Ahead of the money-typed `price` the last-resort fallback would otherwise
    // have chosen -- proof that `criteria` genuinely reaches the selection.
    expect(screen.getByTestId('board-headline-option-1')).toHaveTextContent('Mileage');
  });

  // Regression test for the "cards restate their own title" defect: a
  // `valueType: 'string'`/`comparison: 'none'` attribute like `make` is a
  // plain catalog/identity descriptor -- exactly the shape
  // `isIdentityAttribute` (../lib/evidence-expectation.ts) exists to flag,
  // now applied inside the shared `pickCardAttributeIds` -- and must never
  // consume a card's scarce fact budget, even when it sorts earlier in
  // `attributeDefinitions` than a genuinely decision-relevant attribute.
  it("excludes plain identity attributes already spelled out in the option's own label from its facts", () => {
    const identityDefinition: AttributeDefinition = {
      id: 'make',
      label: 'Make',
      valueType: 'string',
      required: true,
      appliesTo: ['car'],
      evidenceExpectation: 'source',
      comparison: 'none',
      sensitive: false,
    };
    const optionWithIdentity = buildEntity({
      id: 'option-5',
      label: 'Toyota RAV4',
      attributes: {
        make: {
          definitionId: 'make',
          label: 'Make',
          value: { type: 'string', value: 'Toyota' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
        price: {
          definitionId: 'price',
          label: 'Price',
          value: { type: 'money', amount: 28500, currency: 'USD' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
        mileage: {
          definitionId: 'mileage',
          label: 'Mileage',
          value: { type: 'number', value: 15000, unit: 'mi' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      },
    });

    render(
      boardView({
        options: [optionWithIdentity],
        // `identityDefinition` is listed FIRST -- proves the skip actually
        // happens rather than merely never being reached because it lost a
        // race for one of narrow layout's two fact slots.
        attributeDefinitions: [identityDefinition, ...DEFINITIONS],
      }),
    );

    const card = screen.getByTestId('board-card-option-5');
    expect(card).not.toHaveTextContent('Make');
    expect(card).not.toHaveTextContent('Toyota RAV4 Toyota');
    // Both narrow-layout slots go to genuinely decision-relevant facts instead.
    expect(screen.getByTestId('board-headline-option-5')).toHaveTextContent('$28,500');
    expect(screen.getByTestId('board-facts-option-5')).toHaveTextContent('Mileage: 15,000 mi');
  });

  // THE SHIPPED DEFECT the shared `pickCardAttributeIds` was introduced to fix.
  // `OptionListView`'s deleted `pickProminentDefinitions` read only
  // `presentation.attributeGroups[0]` at narrow width; for the real
  // `car-purchase` pack that group is `basics`, so a 390px card showed six
  // restatements of its own title and no decision-relevant number at all.
  // Board never had that code, but it reads the same pack metadata now, so the
  // same pack shape is pinned here too.
  it('regression: a pack whose FIRST attribute group is entirely identity fields still leads with a real non-identity fact', () => {
    const identityDefinitions: AttributeDefinition[] = ['make', 'model', 'trim'].map((id) => ({
      id,
      label: id === 'make' ? 'Make' : id === 'model' ? 'Model' : 'Trim',
      valueType: 'string' as const,
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion' as const,
      comparison: 'none' as const,
      sensitive: false,
    }));
    // No `prominentAttributeIds` -- exactly the pack shape the old
    // `attributeGroups[0]` rule was reading when it produced the defect.
    const identityFirstPresentation: PresentationDefinition = {
      optionLabel: 'car',
      optionLabelPlural: 'cars',
      attributeGroups: [
        { id: 'basics', label: 'Basics', attributeIds: ['make', 'model', 'trim'] },
        { id: 'numbers', label: 'Numbers', attributeIds: ['price', 'mileage'] },
      ],
    };
    const option = buildEntity({
      id: 'option-identity',
      label: 'Toyota RAV4 XLE Hybrid AWD',
      attributes: {
        ...buildEntity().attributes,
        make: {
          definitionId: 'make',
          label: 'Make',
          value: { type: 'string', value: 'Toyota' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      },
    });

    render(
      boardView({
        options: [option],
        attributeDefinitions: [...identityDefinitions, ...DEFINITIONS],
        presentation: identityFirstPresentation,
      }),
    );

    expect(screen.getByTestId('board-headline-option-identity')).toHaveTextContent('$28,500');
    expect(screen.getByTestId('board-card-option-identity')).not.toHaveTextContent('Make');
  });

  it('carries the same compact signal row the list cards use, omitting any zero count', () => {
    render(boardView());

    // option-1 knows its price and mileage (both clearing their `assertion`
    // bar) and nothing about the custom field.
    const signals = screen.getByTestId('option-card-signals-option-1');
    expect(signals).toHaveTextContent('2 supported');
    expect(signals).toHaveTextContent('1 unknown');
    // Nothing is wrong with this option, so no concerns chip is printed --
    // "0 concerns" would read as a measured achievement.
    expect(screen.queryByTestId('option-card-signal-concerns-option-1')).not.toBeInTheDocument();
    expect(signals).not.toHaveTextContent('0');
  });

  it('renders the View details affordance only when the caller supplied onOpenProfile', async () => {
    const user = userEvent.setup();
    const { rerender } = render(boardView());
    expect(screen.queryByTestId('option-card-open-profile-option-1')).not.toBeInTheDocument();

    const onOpenProfile = vi.fn();
    const onFocusOption = vi.fn();
    rerender(boardView({ onOpenProfile, onFocusOption }));
    const affordance = screen.getByTestId('option-card-open-profile-option-1');
    expect(affordance).toHaveTextContent('View details');

    await user.click(affordance);
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith('option-1');
    expect(onFocusOption).not.toHaveBeenCalled();
  });

  it('never truncates the option label, however long it is', () => {
    const longLabel = '2022 Toyota RAV4 XLE Hybrid AWD with the Weather and Convenience package';
    render(boardView({ options: [buildEntity({ id: 'option-long', label: longLabel })] }));

    const focusButton = screen.getByTestId('board-focus-option-long');
    expect(focusButton).toHaveTextContent(longLabel);
    // The board shipped titles clipped to "2022 Toyota RAV4 XLE Hyb…". jsdom
    // cannot measure the ellipsis, so guard the mechanism that produces it: the
    // label may wrap, it may not be clipped.
    const labelSpan = focusButton.firstElementChild;
    expect(labelSpan?.className).not.toContain('truncate');
    expect(labelSpan?.className).toContain('break-words');
  });

  it('never renders raw internal ids as user-visible text', () => {
    const { container } = render(boardView({ optionColumnIds: { 'option-3': 'need_to_verify' } }));

    const visibleText = container.textContent ?? '';
    expect(visibleText).not.toContain('option-1');
    expect(visibleText).not.toContain('option-2');
    expect(visibleText).not.toContain('option-3');
    expect(visibleText).not.toContain('custom.laptop_work_fit');
    // These ids differ in casing/spacing from their rendered labels ("Favorites", "Need to
    // check"), so this is a genuine check and not an accidental match against the label itself.
    expect(visibleText).not.toContain('top_choices');
    expect(visibleText).not.toContain('need_to_verify');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      boardView({
        optionColumnIds: { 'option-1': 'top_choices', 'option-2': 'out' },
        reasons: { 'option-2': 'Dealer offer conflicts with advertised price' },
        selectedOptionId: 'option-1',
        onOpenProfile: vi.fn(),
      }),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk (the board scrolls within its own container)', () => {
    const { overflowRisks } = renderAtNarrowWidth(boardView({ onOpenProfile: vi.fn() }));
    expect(overflowRisks).toEqual([]);
  });

  // §7 "Expanded mode vs narrow mode": expanded must show "more status
  // columns visible simultaneously... rather than requiring horizontal
  // scrolling" and change information architecture, "not merely CSS
  // widths" -- this proves the concrete structural swap (fixed-width flex
  // row -> a real single-row CSS grid sized to the actual column count),
  // not just a different className string.
  it('narrow renders fixed-width columns in a flex row; expanded renders a single-row grid sized to the real column count', () => {
    const { rerender } = render(boardView({ layout: 'narrow' }));
    const narrowColumns = screen.getByTestId('board-columns');
    expect(narrowColumns).toHaveAttribute('data-layout', 'narrow');
    expect(narrowColumns.className).toContain('flex');
    expect(narrowColumns.className).not.toContain('grid');
    expect(screen.getByTestId('board-column-considering').className).toContain('w-[220px]');

    rerender(boardView({ layout: 'expanded' }));
    const expandedColumns = screen.getByTestId('board-columns');
    expect(expandedColumns).toHaveAttribute('data-layout', 'expanded');
    expect(expandedColumns.className).toContain('grid');
    // 4 columns -- the DEFAULT_BOARD_COLUMNS count -- each floored at 240px
    // but free to grow (`1fr`) to fill the wider expanded pane, rather than
    // staying pinned at the narrow layout's fixed 220px.
    expect(expandedColumns).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(240px, 1fr))' });
    expect(screen.getByTestId('board-column-considering').className).not.toContain('w-[220px]');
  });

  it('narrow caps card facts at two (headline included); expanded raises the per-card fact budget', () => {
    const threeFactOption = buildEntity({
      id: 'option-4',
      label: 'Mazda CX-5',
      attributes: {
        price: {
          definitionId: 'price',
          label: 'Price',
          value: { type: 'money', amount: 29500, currency: 'USD' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
        mileage: {
          definitionId: 'mileage',
          label: 'Mileage',
          value: { type: 'number', value: 18000, unit: 'mi' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
        'custom.laptop_work_fit': {
          definitionId: 'custom.laptop_work_fit',
          label: 'Laptop work fit',
          value: { type: 'string', value: 'Good' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      },
    });

    const { rerender } = render(boardView({ options: [threeFactOption], layout: 'narrow' }));
    expect(screen.getByTestId('board-headline-option-4')).toHaveTextContent('$29,500');
    const narrowFacts = screen.getByTestId('board-facts-option-4');
    expect(narrowFacts).toHaveTextContent('Mileage: 18,000 mi');
    expect(narrowFacts).not.toHaveTextContent('Laptop work fit');

    rerender(boardView({ options: [threeFactOption], layout: 'expanded' }));
    expect(screen.getByTestId('board-headline-option-4')).toHaveTextContent('$29,500');
    const expandedFacts = screen.getByTestId('board-facts-option-4');
    expect(expandedFacts).toHaveTextContent('Mileage: 18,000 mi');
    expect(expandedFacts).toHaveTextContent('Laptop work fit: Good');
  });

  // Change-set §49: "Board changes must not rely solely on drag-and-drop."
  // This is the mandatory keyboard-operable alternative -- proven working,
  // unchanged, in expanded layout too, not only the narrow layout the other
  // move-control tests above already cover.
  it('the keyboard-accessible move control keeps working identically in expanded layout', async () => {
    const user = userEvent.setup();
    const onMoveOption = vi.fn();
    render(boardView({ layout: 'expanded', onMoveOption }));

    const select = screen.getByTestId('board-move-option-1');
    await user.selectOptions(select, 'top_choices');

    expect(onMoveOption).toHaveBeenCalledExactlyOnceWith('option-1', 'top_choices');
  });
});

/**
 * The deterministic ranking on a Board card.
 *
 * A board column is 220px and the card already leads with a headline stat,
 * so this is the `compact` density: the same facts, one size down, no
 * coverage meter. The words are the contract; the bar is reinforcement.
 */
describe('OptionBoardView ranking', () => {
  const CAR_SCOREBOARD = buildWorkspaceScoreboard(buildCarCaseState());
  const ENERGY_SCOREBOARD = buildWorkspaceScoreboard(buildEnergyCaseState());

  function carBoard(overrides: Partial<OptionBoardViewProps> = {}) {
    return (
      <OptionBoardView
        options={CAR_OPTIONS}
        attributeDefinitions={CAR_DEFINITIONS}
        presentation={CAR_PRESENTATION}
        criteria={CAR_CRITERIA}
        optionColumnIds={{}}
        selectedOptionId={null}
        layout="narrow"
        onMoveOption={vi.fn()}
        onFocusOption={vi.fn()}
        scoreboard={CAR_SCOREBOARD}
        {...overrides}
      />
    );
  }

  function energyBoard(overrides: Partial<OptionBoardViewProps> = {}) {
    return (
      <OptionBoardView
        options={ENERGY_OPTIONS}
        attributeDefinitions={ENERGY_DEFINITIONS}
        presentation={ENERGY_PRESENTATION}
        criteria={ENERGY_CRITERIA}
        optionColumnIds={{}}
        selectedOptionId={null}
        layout="narrow"
        onMoveOption={vi.fn()}
        onFocusOption={vi.fn()}
        scoreboard={ENERGY_SCOREBOARD}
        {...overrides}
      />
    );
  }

  it('shows the position, the score, and the coverage it rests on, at compact density', () => {
    render(carBoard());

    const badge = screen.getByTestId('option-rank-candidate-crv');
    expect(badge).toHaveAttribute('data-density', 'compact');
    expect(screen.getByTestId('option-rank-position-candidate-crv')).toHaveTextContent('#1 of 3');
    expect(screen.getByTestId('option-rank-score-candidate-crv')).toHaveTextContent('75%');
    // The meter is the one thing a 220px column drops. The number never is.
    expect(screen.queryByTestId('option-rank-meter-candidate-crv')).toBeNull();
    expect(screen.getByTestId('option-rank-coverage-candidate-crv')).toHaveTextContent(
      'on everything you said matters',
    );
  });

  it('renders the unmeasured option as unranked rather than last', () => {
    render(carBoard());

    expect(screen.queryByTestId('option-rank-position-candidate-outback')).toBeNull();
    expect(screen.getByTestId('option-rank-unranked-candidate-outback')).toHaveTextContent(
      /not last/i,
    );
  });

  it('renders no ranking at all when the caller supplies no scoreboard', () => {
    render(carBoard({ scoreboard: undefined }));

    expect(screen.queryByTestId('option-rank-candidate-crv')).toBeNull();
    expect(screen.getByTestId('board-card-candidate-crv')).toBeInTheDocument();
  });

  it('keeps a constraint-violating option on the board, movable and focusable', () => {
    // Rule 4: flagged, never eliminated. Every control it had, it keeps.
    render(energyBoard());

    expect(screen.getByTestId('board-card-option-audit')).toBeInTheDocument();
    expect(screen.getByTestId('board-focus-option-audit')).toBeEnabled();
    expect(screen.getByTestId('board-move-option-audit')).toBeEnabled();
    expect(screen.getByTestId('option-rank-constraint-flags-option-audit')).toHaveTextContent(
      'Misses',
    );
  });

  it('flags a disputed measurement in a 220px column without clipping its label', () => {
    render(energyBoard());

    const label = screen.getByTestId('option-rank-disputed-label-option-thermostat-energy.cost');
    expect(label).toHaveTextContent('Lowest immediate cost');
    expect(label.className).toContain('break-words');
    expect(label.className).not.toContain('truncate');
  });

  it('adds no fixed width wider than the narrow pane, in either pack', () => {
    for (const ui of [carBoard(), energyBoard()]) {
      const { renderResult, overflowRisks } = renderAtNarrowWidth(ui);
      expect(overflowRisks).toEqual([]);
      renderResult.unmount();
    }
  });

  it('has no accessibility violations with the ranking rendered, in either pack', async () => {
    const car = render(carBoard({ layout: 'expanded' }));
    expect(await axe(car.container)).toHaveNoViolations();
    car.unmount();

    const energy = render(energyBoard());
    expect(await axe(energy.container)).toHaveNoViolations();
  });
});
