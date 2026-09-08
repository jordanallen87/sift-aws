import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type {
  AttributeDefinition,
  Criterion,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { OptionListView, type OptionListViewProps } from './OptionListView.js';
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
    evidenceExpectation: 'source',
    comparison: 'lower_better',
    sensitive: false,
  },
  // A plain `string`/`comparison: 'none'` descriptor -- `isIdentityAttribute`'s
  // exact shape, and deliberately NOT named in `PRESENTATION`, so it exercises
  // the "an attribute outside the prominent set never reaches the card" side of
  // the contract.
  {
    id: 'warranty',
    label: 'Warranty',
    valueType: 'string',
    required: false,
    appliesTo: ['car'],
    evidenceExpectation: 'verification',
    comparison: 'none',
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
  {
    id: 'reliability',
    label: 'Reliability',
    valueType: 'enum',
    required: false,
    appliesTo: ['car'],
    allowedValues: ['Above Average', 'Average', 'Below Average'],
    evidenceExpectation: 'source',
    comparison: 'higher_better',
    sensitive: false,
  },
];

// The pack author's own answer to "what should a card lead with", in its own
// order -- deliberately NOT definition order (`reliability` is declared last
// above but ranks fourth here, and `warranty` is named nowhere).
const PRESENTATION: PresentationDefinition = {
  optionLabel: 'car',
  optionLabelPlural: 'cars',
  prominentAttributeIds: ['price', 'mileage', 'custom.laptop_work_fit', 'reliability'],
  attributeGroups: [
    {
      id: 'headline',
      label: 'Headline',
      attributeIds: ['price', 'mileage', 'custom.laptop_work_fit'],
    },
  ],
};

// The same pack with the field omitted entirely (not set to `undefined` --
// `exactOptionalPropertyTypes` is on, and an absent optional field is the real
// shape a pack that predates `prominentAttributeIds` has).
const PRESENTATION_WITHOUT_PROMINENT: PresentationDefinition = {
  optionLabel: PRESENTATION.optionLabel,
  optionLabelPlural: PRESENTATION.optionLabelPlural,
  attributeGroups: PRESENTATION.attributeGroups,
};

function buildEntity(overrides: Partial<EntityRecord> = {}): EntityRecord {
  return {
    id: 'candidate-rav4',
    kind: 'car',
    label: 'Toyota RAV4',
    attributes: {},
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

// A well-evidenced value (price), an under-evidenced one (mileage: `asserted`
// against a `source` bar), a conflicted one (the custom field), another
// under-evidenced one (reliability), and one that is never prominent at all
// (warranty).
const RAV4 = buildEntity({
  id: 'candidate-rav4',
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
    reliability: {
      definitionId: 'reliability',
      label: 'Reliability',
      value: { type: 'enum', value: 'Above Average' },
      origin: 'user',
      sourceIds: [],
      status: 'asserted',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
    warranty: {
      definitionId: 'warranty',
      label: 'Warranty',
      value: { type: 'string', value: '5 years' },
      origin: 'user',
      sourceIds: [],
      status: 'verified',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
    'custom.laptop_work_fit': {
      definitionId: 'custom.laptop_work_fit',
      label: 'Laptop work fit',
      value: { type: 'string', value: 'Mixed reports' },
      origin: 'user',
      sourceIds: [],
      status: 'conflicted',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
  },
});

// No attribute records at all -- every prominent field is honestly unknown, so
// the card must show "Unknown" values and an unknowns-only signal row, never a
// fabricated strength.
const CRV = buildEntity({
  id: 'candidate-crv',
  label: 'Honda CR-V',
  attributes: {},
});

const FORESTER = buildEntity({
  id: 'candidate-forester',
  label: 'Subaru Forester',
  attributes: {
    price: {
      definitionId: 'price',
      label: 'Price',
      value: { type: 'money', amount: 26900, currency: 'USD' },
      origin: 'user',
      sourceIds: [],
      status: 'asserted',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
  },
});

const OPTIONS: EntityRecord[] = [RAV4, CRV, FORESTER];

/**
 * Every applicable non-identity attribute present and clearing its own
 * evidence bar: 4 strengths, 0 concerns, 0 unresolved. Exists solely to prove
 * the zero-count omission rule -- a card must not print "0 concerns" as if
 * clean were an achievement it had measured.
 */
const FULLY_EVIDENCED = buildEntity({
  id: 'candidate-clean',
  label: 'Mazda CX-5',
  attributes: {
    price: {
      definitionId: 'price',
      label: 'Price',
      value: { type: 'money', amount: 27100, currency: 'USD' },
      origin: 'user',
      sourceIds: [],
      status: 'asserted',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
    mileage: {
      definitionId: 'mileage',
      label: 'Mileage',
      value: { type: 'number', value: 9000, unit: 'mi' },
      origin: 'agent_proposed',
      sourceIds: [],
      status: 'verified',
      updatedAt: '2026-08-27T00:00:00.000Z',
    },
    reliability: {
      definitionId: 'reliability',
      label: 'Reliability',
      value: { type: 'enum', value: 'Above Average' },
      origin: 'agent_proposed',
      sourceIds: [],
      status: 'supported',
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

function listView(overrides: Partial<OptionListViewProps> = {}) {
  const props: OptionListViewProps = {
    options: OPTIONS,
    attributeDefinitions: DEFINITIONS,
    presentation: PRESENTATION,
    criteria: [],
    selectedOptionId: null,
    layout: 'narrow',
    onFocusOption: vi.fn(),
    ...overrides,
  };
  return <OptionListView {...props} />;
}

describe('OptionListView', () => {
  it('renders the empty state when no options are visible', () => {
    render(listView({ options: [], presentation: null }));
    expect(screen.getByTestId('option-list-view-empty')).toBeInTheDocument();
  });

  it('renders one card per option', () => {
    render(listView());

    expect(screen.getByTestId('option-list-view-card-candidate-rav4')).toHaveTextContent(
      'Toyota RAV4',
    );
    expect(screen.getByTestId('option-list-view-card-candidate-crv')).toHaveTextContent(
      'Honda CR-V',
    );
    expect(screen.getByTestId('option-list-view-card-candidate-forester')).toHaveTextContent(
      'Subaru Forester',
    );
  });

  it('visibleOptionIds narrows which cards render', () => {
    render(listView({ visibleOptionIds: ['candidate-rav4', 'candidate-crv'] }));

    expect(screen.getByTestId('option-list-view-card-candidate-rav4')).toBeInTheDocument();
    expect(screen.getByTestId('option-list-view-card-candidate-crv')).toBeInTheDocument();
    expect(
      screen.queryByTestId('option-list-view-card-candidate-forester'),
    ).not.toBeInTheDocument();
  });

  // Supersedes "only fields from the pack's first presentation group render".
  // The pack field a card reads is now `presentation.prominentAttributeIds`,
  // not `attributeGroups[0]` -- see the regression test below for the shipped
  // defect that motivated the change -- but the "an attribute outside the
  // prominent set cannot appear anywhere on the card" half of that assertion is
  // preserved here verbatim.
  it("prominence: the pack's prominentAttributeIds order is exactly what renders, and an attribute outside it never appears", () => {
    render(listView({ options: [RAV4], layout: 'expanded' }));

    const facts = ['price', 'mileage', 'custom.laptop_work_fit', 'reliability'];
    for (const id of facts) {
      expect(screen.getByTestId(`option-list-view-fact-candidate-rav4-${id}`)).toBeInTheDocument();
    }

    // The pack's own declared order -- `reliability` is declared LAST in
    // `DEFINITIONS` but fourth in `prominentAttributeIds`, so definition order
    // cannot produce this result by accident.
    const rendered = Array.from(
      screen
        .getByTestId('option-list-view-card-candidate-rav4')
        .querySelectorAll('[data-testid^="option-list-view-fact-candidate-rav4-"]'),
    ).map((element) => element.getAttribute('data-testid'));
    expect(rendered).toEqual(facts.map((id) => `option-list-view-fact-candidate-rav4-${id}`));

    // `warranty` has a real, well-evidenced value but the pack never named it
    // prominent, so it must not render anywhere on the card.
    expect(
      screen.queryByTestId('option-list-view-fact-candidate-rav4-warranty'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('option-list-view-card-candidate-rav4')).not.toHaveTextContent(
      'Warranty',
    );
  });

  // THE SHIPPED DEFECT this whole change exists to fix. The deleted
  // `pickProminentDefinitions` read only `presentation.attributeGroups[0]` at
  // narrow width. For the real `car-purchase` pack that group is `basics`, so a
  // 390px card showed make / model / model year / trim / body style /
  // drivetrain -- six restatements of the card's own title -- and no price at
  // all, in the ChatGPT pane that is this product's primary surface.
  it('regression: a pack whose FIRST attribute group is entirely identity fields still leads with a real non-identity fact, not restatements of the card title', () => {
    const identityDefinitions: AttributeDefinition[] = [
      { id: 'make', label: 'Make' },
      { id: 'model', label: 'Model' },
      { id: 'trim', label: 'Trim' },
      { id: 'body_style', label: 'Body style' },
    ].map(({ id, label }) => ({
      id,
      label,
      valueType: 'string' as const,
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion' as const,
      comparison: 'none' as const,
      sensitive: false,
    }));

    // No `prominentAttributeIds` at all -- exactly the pack shape the old
    // `attributeGroups[0]` rule was reading when it produced the defect.
    const identityFirstPresentation: PresentationDefinition = {
      optionLabel: 'car',
      optionLabelPlural: 'cars',
      attributeGroups: [
        { id: 'basics', label: 'Basics', attributeIds: ['make', 'model', 'trim', 'body_style'] },
        { id: 'numbers', label: 'Numbers', attributeIds: ['price', 'mileage'] },
      ],
    };

    const option = buildEntity({
      id: 'candidate-identity',
      label: 'Toyota RAV4 XLE Hybrid AWD',
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
      },
    });

    render(
      listView({
        options: [option],
        attributeDefinitions: [...identityDefinitions, ...DEFINITIONS],
        presentation: identityFirstPresentation,
        layout: 'narrow',
      }),
    );

    const card = screen.getByTestId('option-list-view-card-candidate-identity');
    expect(screen.getByTestId('option-list-view-fact-candidate-identity-price')).toHaveTextContent(
      '$28,500',
    );
    for (const id of ['make', 'model', 'trim', 'body_style']) {
      expect(
        screen.queryByTestId(`option-list-view-fact-candidate-identity-${id}`),
      ).not.toBeInTheDocument();
    }
    // Not one of the card's scarce fact slots restates something already
    // spelled out, unabridged, in its own heading.
    expect(card).not.toHaveTextContent('Make');
    expect(card).not.toHaveTextContent('Body style');
  });

  it('with no pack prominentAttributeIds, the heaviest criterion decides what the card leads with', () => {
    const criteria: Criterion[] = [
      {
        id: 'crit-reliability',
        label: 'Reliability matters most',
        kind: 'preference',
        weight: 90,
        direction: 'higher_better',
        appliesToAttribute: 'reliability',
        origin: 'user',
        status: 'active',
      },
      {
        id: 'crit-mileage',
        label: 'Lower mileage',
        kind: 'preference',
        weight: 20,
        direction: 'lower_better',
        appliesToAttribute: 'mileage',
        origin: 'user',
        status: 'active',
      },
    ];

    render(listView({ options: [RAV4], presentation: PRESENTATION_WITHOUT_PROMINENT, criteria }));

    // The heaviest-weighted criterion's attribute leads, ahead of the
    // money-typed `price` the last-resort fallback would otherwise have put
    // first -- proving `criteria` genuinely reaches the selection rather than
    // being accepted and ignored.
    const rendered = Array.from(
      screen
        .getByTestId('option-list-view-card-candidate-rav4')
        .querySelectorAll('[data-testid^="option-list-view-fact-candidate-rav4-"]'),
    ).map((element) => element.getAttribute('data-testid'));
    expect(rendered[0]).toBe('option-list-view-fact-candidate-rav4-reliability');
    expect(rendered[1]).toBe('option-list-view-fact-candidate-rav4-mileage');
  });

  it('an explicit prominentAttributeIds prop takes precedence over the pack’s own prominentAttributeIds', () => {
    render(listView({ options: [RAV4], prominentAttributeIds: ['warranty'] }));

    expect(screen.getByTestId('option-list-view-fact-candidate-rav4-warranty')).toBeInTheDocument();
    expect(
      screen.queryByTestId('option-list-view-fact-candidate-rav4-price'),
    ).not.toBeInTheDocument();
  });

  it('renders a missing value as an explicit "Unknown", never blank or invented', () => {
    render(listView({ options: [CRV] }));

    expect(screen.getByTestId('option-list-view-fact-candidate-crv-price')).toHaveTextContent(
      /unknown/i,
    );
    expect(screen.getByTestId('option-list-view-fact-candidate-crv-mileage')).toHaveTextContent(
      /unknown/i,
    );
  });

  it('renders a custom.* field by its human label, marked custom, with the raw id absent from rendered text', () => {
    const { container } = render(listView({ options: [RAV4] }));

    const fact = screen.getByTestId('option-list-view-fact-candidate-rav4-custom.laptop_work_fit');
    expect(fact).toHaveTextContent('Laptop work fit');
    expect(
      screen.getByTestId(
        'option-list-view-fact-custom-badge-candidate-rav4-custom.laptop_work_fit',
      ),
    ).toHaveTextContent('Custom');

    const visibleText = container.textContent ?? '';
    expect(visibleText).not.toContain('custom.laptop_work_fit');
  });

  it('caps an over-long string_list value and says how many more there are, never silently truncating', () => {
    const featuresDefinition: AttributeDefinition = {
      id: 'standard_features',
      label: 'Standard features',
      valueType: 'string_list',
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion',
      comparison: 'none',
      sensitive: false,
    };
    const option = buildEntity({
      id: 'candidate-features',
      label: 'Kia Sportage',
      attributes: {
        standard_features: {
          definitionId: 'standard_features',
          label: 'Standard features',
          value: {
            type: 'string_list',
            values: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
          },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      },
    });

    render(
      listView({
        options: [option],
        attributeDefinitions: [featuresDefinition, ...DEFINITIONS],
        presentation: { ...PRESENTATION, prominentAttributeIds: ['standard_features', 'price'] },
      }),
    );

    const fact = screen.getByTestId('option-list-view-fact-candidate-features-standard_features');
    expect(fact).toHaveTextContent('One, Two, Three, Four');
    expect(fact).toHaveTextContent('+2 more');
    expect(fact).not.toHaveTextContent('Five');
  });

  // Supersedes the three stacked "What we like" / "What to watch for" / "Still
  // researching" sections. The classification rule itself (which attribute is a
  // strength, a concern, or unresolved) is now `summarizeOptionSignals` and is
  // tested exhaustively in `option-profile.test.ts`; what belongs HERE is that
  // a card renders those counts, with a real word next to each so the row is
  // never colour-only (docs/design-system.md).
  it('replaces the three insight sections with one compact signal row of counts', () => {
    render(listView({ options: [RAV4] }));

    const signals = screen.getByTestId('option-card-signals-candidate-rav4');
    // price (asserted vs. an `assertion` bar) is the only strength; mileage and
    // reliability are under-evidenced and the custom field is conflicted, so
    // three concerns; `warranty` is an identity descriptor and is counted in
    // none of them.
    expect(screen.getByTestId('option-card-signal-strengths-candidate-rav4')).toHaveTextContent(
      '1 supported',
    );
    expect(signals).toHaveTextContent('3 concerns');
    expect(
      screen.queryByTestId('option-card-signal-unresolved-candidate-rav4'),
    ).not.toBeInTheDocument();

    // Counts, not lists: none of the deleted per-attribute sentences survives
    // anywhere on the card.
    const card = screen.getByTestId('option-list-view-card-candidate-rav4');
    expect(card).not.toHaveTextContent(/needs stronger evidence/i);
    expect(card).not.toHaveTextContent(/conflicting information/i);
    expect(card).not.toHaveTextContent(/still unknown/i);
    expect(
      screen.queryByTestId('option-list-view-strengths-candidate-rav4'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('option-list-view-concerns-candidate-rav4'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('option-list-view-unresolved-candidate-rav4'),
    ).not.toBeInTheDocument();
  });

  it('omits a zero count entirely rather than printing "0 concerns" as if clean were an achievement', () => {
    render(listView({ options: [FULLY_EVIDENCED, CRV] }));

    // Nothing is wrong with this option, so only the strengths chip renders.
    const clean = screen.getByTestId('option-card-signals-candidate-clean');
    expect(clean).toHaveTextContent('4 supported');
    expect(clean).not.toHaveTextContent('0');
    expect(clean).not.toHaveTextContent(/concern/i);
    expect(clean).not.toHaveTextContent(/unknown/i);
    expect(
      screen.queryByTestId('option-card-signal-concerns-candidate-clean'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('option-card-signal-unresolved-candidate-clean'),
    ).not.toBeInTheDocument();

    // And the mirror case: an option with no records at all fabricates no
    // strength, and says plainly how much is still unknown.
    const empty = screen.getByTestId('option-card-signals-candidate-crv');
    expect(empty).toHaveTextContent('4 unknowns');
    expect(
      screen.queryByTestId('option-card-signal-strengths-candidate-crv'),
    ).not.toBeInTheDocument();
    expect(empty).not.toHaveTextContent('0');
  });

  it('singularises a count of one rather than printing "1 concerns"', () => {
    const oneConcern = buildEntity({
      id: 'candidate-one-concern',
      label: 'Hyundai Tucson',
      attributes: {
        ...FULLY_EVIDENCED.attributes,
        // `asserted` against this definition's declared `source` bar -- the one
        // and only concern on the card.
        mileage: {
          definitionId: 'mileage',
          label: 'Mileage',
          value: { type: 'number', value: 22000, unit: 'mi' },
          origin: 'user',
          sourceIds: [],
          status: 'asserted',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      },
    });
    render(listView({ options: [oneConcern] }));

    expect(
      screen.getByTestId('option-card-signal-concerns-candidate-one-concern'),
    ).toHaveTextContent('1 concern');
    expect(
      screen.getByTestId('option-card-signal-concerns-candidate-one-concern'),
    ).not.toHaveTextContent('1 concerns');
  });

  it('renders the View details affordance only when the caller supplied onOpenProfile', () => {
    const { rerender } = render(listView({ options: [RAV4] }));
    // A dead control is worse than no control: with no profile surface wired,
    // nothing renders.
    expect(screen.queryByTestId('option-card-open-profile-candidate-rav4')).not.toBeInTheDocument();

    rerender(listView({ options: [RAV4], onOpenProfile: vi.fn() }));
    expect(screen.getByTestId('option-card-open-profile-candidate-rav4')).toHaveTextContent(
      'View details',
    );
  });

  it('fires onOpenProfile with the option id, and never confuses it with focus', async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    const onFocusOption = vi.fn();
    render(listView({ options: [RAV4], onOpenProfile, onFocusOption }));

    await user.click(screen.getByTestId('option-card-open-profile-candidate-rav4'));
    expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith('candidate-rav4');
    expect(onFocusOption).not.toHaveBeenCalled();
  });

  it('never truncates the option label, however long it is', () => {
    const longLabel = '2022 Toyota RAV4 XLE Hybrid AWD with the Weather and Convenience package';
    const option = buildEntity({ id: 'candidate-long', label: longLabel });
    render(listView({ options: [option] }));

    const heading = screen.getByTestId('option-list-view-focus-candidate-long');
    expect(heading).toHaveTextContent(longLabel);
    // This product has already shipped a card titled "2022 Toyota RAV4 XLE
    // Hyb…". jsdom cannot measure the ellipsis, so guard the mechanism that
    // produces it: the label may wrap, it may not be clipped.
    expect(heading.className).not.toContain('truncate');
    expect(heading.className).toContain('break-words');
  });

  it('fires onFocusOption when a card is clicked', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(listView({ onFocusOption }));

    await user.click(screen.getByTestId('option-list-view-focus-candidate-crv'));
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith('candidate-crv');
  });

  // Regression test for the reported defect: the card's focus button carries
  // `aria-pressed={isSelected}`, promising assistive technology a real
  // toggle. Clicking the button that IS the current selection a second time
  // used to re-send the same id and leave the card stuck selected forever --
  // a dead end, and a lie about what `aria-pressed` claimed the control
  // could do. It must now clear the selection (`onFocusOption(null)`)
  // instead.
  it('clicking the already-selected card clears the selection instead of re-selecting it', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(listView({ selectedOptionId: 'candidate-crv', onFocusOption }));

    await user.click(screen.getByTestId('option-list-view-focus-candidate-crv'));
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("marks only the selected card's focus button aria-pressed, and every other card false", () => {
    render(listView({ selectedOptionId: 'candidate-crv' }));

    expect(screen.getByTestId('option-list-view-focus-candidate-crv')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('option-list-view-focus-candidate-rav4')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('is keyboard operable: pressing Enter on a focused card button fires onFocusOption', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(listView({ onFocusOption }));

    const focusButton = screen.getByTestId('option-list-view-focus-candidate-forester');
    focusButton.focus();
    expect(focusButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith('candidate-forester');
  });

  it('visually distinguishes the selected option', () => {
    render(listView({ selectedOptionId: 'candidate-rav4' }));

    const selectedCard = screen.getByTestId('option-list-view-card-candidate-rav4');
    expect(selectedCard).toHaveAttribute('data-selected', 'true');
    expect(selectedCard).toHaveTextContent(/selected/i);

    const otherCard = screen.getByTestId('option-list-view-card-candidate-crv');
    expect(otherCard).toHaveAttribute('data-selected', 'false');
  });

  it('has no axe violations in the empty and populated states', async () => {
    const { container: empty } = render(listView({ options: [] }));
    expect(await axe(empty)).toHaveNoViolations();

    const { container: populated } = render(
      listView({ selectedOptionId: 'candidate-rav4', onOpenProfile: vi.fn() }),
    );
    expect(await axe(populated)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk', () => {
    const { overflowRisks } = renderAtNarrowWidth(listView({ onOpenProfile: vi.fn() }));
    expect(overflowRisks).toEqual([]);
  });

  // §7 "Expanded mode vs narrow mode": expanded must show "more attributes
  // visible simultaneously" and change information architecture, "not merely
  // CSS widths" -- these two tests prove both of this view's concrete IA
  // changes, not just that a different className string was produced.
  it('narrow stacks cards in a single column; expanded renders them in the shared option-grid layout', () => {
    const { rerender } = render(listView({ layout: 'narrow' }));
    const narrowCards = screen.getByTestId('option-list-view-cards');
    expect(narrowCards).toHaveAttribute('data-layout', 'narrow');
    expect(narrowCards.className).not.toContain('option-grid');

    rerender(listView({ layout: 'expanded' }));
    const expandedCards = screen.getByTestId('option-list-view-cards');
    expect(expandedCards).toHaveAttribute('data-layout', 'expanded');
    expect(expandedCards.className).toContain('option-grid');
  });

  // Supersedes "expanded widens the prominent-field budget to include more of
  // the pack's own presentation groups". The budget is still layout-dependent
  // and still §7's real IA change; what it draws from is now the pack's
  // `prominentAttributeIds` rather than its `attributeGroups`.
  it('expanded shows one more prominent fact per card than narrow, drawn from the same pack-declared order', () => {
    const { rerender } = render(listView({ options: [RAV4], layout: 'narrow' }));
    expect(screen.getByTestId('option-list-view-fact-candidate-rav4-price')).toBeInTheDocument();
    expect(screen.getByTestId('option-list-view-fact-candidate-rav4-mileage')).toBeInTheDocument();
    expect(
      screen.getByTestId('option-list-view-fact-candidate-rav4-custom.laptop_work_fit'),
    ).toBeInTheDocument();
    // The pack's fourth prominent id does not fit the narrow budget.
    expect(
      screen.queryByTestId('option-list-view-fact-candidate-rav4-reliability'),
    ).not.toBeInTheDocument();

    rerender(listView({ options: [RAV4], layout: 'expanded' }));
    expect(
      screen.getByTestId('option-list-view-fact-candidate-rav4-reliability'),
    ).toBeInTheDocument();
  });
});

/**
 * The deterministic ranking on a List card.
 *
 * These use the pack-shaped fixtures rather than this file's own minimal
 * ones, because a rank is only meaningful against a real criteria set -- and
 * because the same assertions have to hold for both shipped packs, which is
 * where every previous genericity claim in this repository has failed.
 */
describe('OptionListView ranking', () => {
  const CAR_SCOREBOARD = buildWorkspaceScoreboard(buildCarCaseState());
  const ENERGY_SCOREBOARD = buildWorkspaceScoreboard(buildEnergyCaseState());

  function carView(overrides: Partial<OptionListViewProps> = {}) {
    return (
      <OptionListView
        options={CAR_OPTIONS}
        attributeDefinitions={CAR_DEFINITIONS}
        presentation={CAR_PRESENTATION}
        criteria={CAR_CRITERIA}
        selectedOptionId={null}
        layout="narrow"
        onFocusOption={vi.fn()}
        scoreboard={CAR_SCOREBOARD}
        {...overrides}
      />
    );
  }

  it('shows each option`s position and score on its card', () => {
    render(carView());

    expect(screen.getByTestId('option-rank-position-candidate-crv')).toHaveTextContent('#1 of 3');
    expect(screen.getByTestId('option-rank-position-candidate-rav4')).toHaveTextContent('#2 of 3');
    expect(screen.getByTestId('option-rank-score-candidate-crv')).toHaveTextContent('75%');
  });

  it('shows the coverage a score rests on beside every score', () => {
    render(carView());

    expect(screen.getByTestId('option-rank-coverage-candidate-crv')).toHaveTextContent(
      'on everything you said matters',
    );
    expect(screen.getByTestId('option-rank-coverage-candidate-forester')).toHaveTextContent(
      'on 50% of what you said matters',
    );
  });

  it('renders the unmeasured option as unranked rather than last', () => {
    render(carView());

    expect(screen.queryByTestId('option-rank-position-candidate-outback')).toBeNull();
    expect(screen.getByTestId('option-rank-unranked-candidate-outback')).toHaveTextContent(
      /not last/i,
    );
  });

  it('renders no ranking at all when the caller supplies no scoreboard', () => {
    // The backward-compatible default: a caller that has not wired the board
    // yet gets exactly the card it had before, not an empty rank slot.
    render(carView({ scoreboard: undefined }));

    expect(screen.queryByTestId('option-rank-candidate-crv')).toBeNull();
    expect(screen.getByTestId('option-list-view-card-candidate-crv')).toBeInTheDocument();
  });

  it('renders no ranking when there is nothing to rank', () => {
    // One option is a score, not a ranking. An empty "#1 of 1" would read as
    // "we compared them and it won".
    const single = buildWorkspaceScoreboard(
      buildCarCaseState({ entities: CAR_OPTIONS.slice(0, 1) }),
    );
    render(carView({ options: CAR_OPTIONS.slice(0, 1), scoreboard: single }));

    expect(screen.queryByTestId('option-rank-candidate-rav4')).toBeNull();
  });

  it('flags a violated requirement on the card without removing the option', () => {
    render(
      <OptionListView
        options={ENERGY_OPTIONS}
        attributeDefinitions={ENERGY_DEFINITIONS}
        presentation={ENERGY_PRESENTATION}
        criteria={ENERGY_CRITERIA}
        selectedOptionId={null}
        layout="narrow"
        onFocusOption={vi.fn()}
        scoreboard={ENERGY_SCOREBOARD}
      />,
    );

    // Still on the board, still focusable, still ranked.
    expect(screen.getByTestId('option-list-view-card-option-audit')).toBeInTheDocument();
    expect(screen.getByTestId('option-list-view-focus-option-audit')).toBeEnabled();
    expect(screen.getByTestId('option-rank-position-option-audit')).toHaveTextContent('#4 of 4');
    expect(screen.getByTestId('option-rank-constraint-flags-option-audit')).toHaveTextContent(
      'Misses',
    );
  });

  it('flags a disputed measurement on the card in both packs', () => {
    const { unmount } = render(carView());
    expect(screen.getByTestId('option-rank-disputed-flags-candidate-crv')).toHaveTextContent(
      'Disputed',
    );
    unmount();

    render(
      <OptionListView
        options={ENERGY_OPTIONS}
        attributeDefinitions={ENERGY_DEFINITIONS}
        presentation={ENERGY_PRESENTATION}
        criteria={ENERGY_CRITERIA}
        selectedOptionId={null}
        layout="narrow"
        onFocusOption={vi.fn()}
        scoreboard={ENERGY_SCOREBOARD}
      />,
    );
    expect(screen.getByTestId('option-rank-disputed-flags-option-thermostat')).toHaveTextContent(
      'Disputed',
    );
  });

  it('adds no fixed width wider than the narrow pane, in either pack', () => {
    for (const ui of [
      carView(),
      <OptionListView
        key="energy"
        options={ENERGY_OPTIONS}
        attributeDefinitions={ENERGY_DEFINITIONS}
        presentation={ENERGY_PRESENTATION}
        criteria={ENERGY_CRITERIA}
        selectedOptionId={null}
        layout="narrow"
        onFocusOption={vi.fn()}
        scoreboard={ENERGY_SCOREBOARD}
      />,
    ]) {
      const { renderResult, overflowRisks } = renderAtNarrowWidth(ui);
      expect(overflowRisks).toEqual([]);
      renderResult.unmount();
    }
  });

  it('has no accessibility violations with the ranking rendered, in either pack and layout', async () => {
    const car = render(carView({ layout: 'expanded' }));
    expect(await axe(car.container)).toHaveNoViolations();
    car.unmount();

    const energy = render(
      <OptionListView
        options={ENERGY_OPTIONS}
        attributeDefinitions={ENERGY_DEFINITIONS}
        presentation={ENERGY_PRESENTATION}
        criteria={ENERGY_CRITERIA}
        selectedOptionId={null}
        layout="narrow"
        onFocusOption={vi.fn()}
        scoreboard={ENERGY_SCOREBOARD}
      />,
    );
    expect(await axe(energy.container)).toHaveNoViolations();
  });
});
