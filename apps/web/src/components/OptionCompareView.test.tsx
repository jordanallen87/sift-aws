import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type {
  AttributeDefinition,
  CaseExtension,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { OptionCompareView } from './OptionCompareView.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';

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
    id: 'candidate-rav4',
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
      'custom.laptop_work_fit': {
        definitionId: 'custom.laptop_work_fit',
        label: 'Laptop work fit',
        value: { type: 'string', value: 'Likely good' },
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

const OPTIONS: EntityRecord[] = [
  buildEntity(),
  buildEntity({
    id: 'candidate-crv',
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
      // No custom.laptop_work_fit -- exercises the "Unknown" cell path.
    },
  }),
  buildEntity({
    id: 'candidate-forester',
    label: 'Subaru Forester',
    attributes: {
      // No price -- exercises the "Unknown" cell path for a different row.
      mileage: {
        definitionId: 'mileage',
        label: 'Mileage',
        value: { type: 'number', value: 20500, unit: 'mi' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
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

// Problem 1 fixtures: an identity/label descriptor (`valueType: 'string'`, `comparison: 'none'`,
// non-`custom.` id) exactly matching `isIdentityAttribute`'s own criteria -- the same shape as the
// car-purchase pack's real `car.make`/`car.model`/`car.trim` definitions, standing in for them here
// so this test file does not depend on `@sift/packs`.
const IDENTITY_DEFINITION: AttributeDefinition = {
  id: 'make',
  label: 'Make',
  valueType: 'string',
  required: true,
  appliesTo: ['car'],
  evidenceExpectation: 'source',
  comparison: 'none',
  sensitive: false,
};

const DEFINITIONS_WITH_IDENTITY: AttributeDefinition[] = [IDENTITY_DEFINITION, ...DEFINITIONS];

function withMake(option: EntityRecord, make: string): EntityRecord {
  return {
    ...option,
    attributes: {
      ...option.attributes,
      make: {
        definitionId: 'make',
        label: 'Make',
        value: { type: 'string', value: make },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    },
  };
}

const OPTIONS_WITH_IDENTITY: EntityRecord[] = [
  withMake(OPTIONS[0]!, 'Toyota'),
  withMake(OPTIONS[1]!, 'Honda'),
  withMake(OPTIONS[2]!, 'Subaru'),
];

// Problem 2 fixtures: every option carries the identical `price` value, standing in for the
// motivating "car.standard_features is identical across all four demo candidates" case
// (`packages/scenarios/fixtures/car-purchase/candidate-listings.json`) with a value type
// (`money`) already covered by `DEFINITIONS`/`formatAttributeValue`.
function withPrice(option: EntityRecord, amount: number): EntityRecord {
  return {
    ...option,
    attributes: {
      ...option.attributes,
      price: {
        definitionId: 'price',
        label: 'Price',
        value: { type: 'money', amount, currency: 'USD' },
        origin: 'user',
        sourceIds: [],
        status: 'asserted',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
    },
  };
}

const OPTIONS_SAME_PRICE: EntityRecord[] = [
  withPrice(OPTIONS[0]!, 30000),
  withPrice(OPTIONS[1]!, 30000),
  withPrice(OPTIONS[2]!, 30000),
];

function buildCaseExtension(overrides: Partial<CaseExtension> = {}): CaseExtension {
  return {
    id: 'ext-1',
    caseId: 'case-1',
    definition: {
      id: 'custom.trunk_space',
      label: 'Trunk space fit',
      valueType: 'string',
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion',
      comparison: 'none',
      sensitive: false,
      origin: 'user',
      reason: 'The household needs room for a folded stroller.',
      confirmation: 'confirmed',
      proposedBy: 'user',
      createdAt: '2026-08-27T00:00:00.000Z',
    },
    createdAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('OptionCompareView', () => {
  it('renders the empty state when no options are visible', () => {
    render(
      <OptionCompareView
        options={[]}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );
    expect(screen.getByTestId('option-compare-view-empty')).toBeInTheDocument();
  });

  it('renders a column per option and a row per applicable attribute when no narrowing props are given', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );

    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toHaveTextContent(
      'Toyota RAV4',
    );
    expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toHaveTextContent(
      'Honda CR-V',
    );
    expect(screen.getByTestId('option-compare-view-header-candidate-forester')).toHaveTextContent(
      'Subaru Forester',
    );
    expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-row-mileage')).toBeInTheDocument();
    expect(
      screen.getByTestId('option-compare-view-row-custom.laptop_work_fit'),
    ).toBeInTheDocument();
  });

  it('visibleOptionIds genuinely narrows the columns', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        visibleOptionIds={['candidate-rav4', 'candidate-crv']}
        layout="expanded"
      />,
    );

    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
    expect(
      screen.queryByTestId('option-compare-view-header-candidate-forester'),
    ).not.toBeInTheDocument();
  });

  it('visibleAttributeIds genuinely narrows the rows', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        visibleAttributeIds={['price']}
        layout="expanded"
      />,
    );

    expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
    expect(screen.queryByTestId('option-compare-view-row-mileage')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('option-compare-view-row-custom.laptop_work_fit'),
    ).not.toBeInTheDocument();
  });

  it('pinnedAttributeIds ordering puts pinned rows first', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        pinnedAttributeIds={['mileage']}
        layout="expanded"
      />,
    );

    const table = screen.getByTestId('option-compare-view-table');
    const rowTestIds = within(table)
      .getAllByRole('row')
      .map((row) => row.getAttribute('data-testid'))
      .filter(
        (testId): testId is string => testId?.startsWith('option-compare-view-row-') ?? false,
      );

    expect(rowTestIds[0]).toBe('option-compare-view-row-mileage');
    expect(rowTestIds).toContain('option-compare-view-row-price');

    const pinnedRow = screen.getByTestId('option-compare-view-row-mileage');
    expect(pinnedRow).toHaveAttribute('data-pinned', 'true');
    const unpinnedRow = screen.getByTestId('option-compare-view-row-price');
    expect(unpinnedRow).toHaveAttribute('data-pinned', 'false');
  });

  it('renders a custom.* attribute using its human label, marks it as custom, and never leaks the raw id into rendered text', () => {
    const { container } = render(
      <OptionCompareView
        options={[OPTIONS[0]!]}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );

    const row = screen.getByTestId('option-compare-view-row-custom.laptop_work_fit');
    expect(row).toHaveTextContent('Laptop work fit');
    expect(
      screen.getByTestId('option-compare-view-custom-badge-custom.laptop_work_fit'),
    ).toHaveTextContent('Custom');

    // The raw id must never appear as user-visible text, even though it is used in data-testid
    // attributes (which are not rendered text).
    const visibleText = container.textContent ?? '';
    expect(visibleText).not.toContain('custom.laptop_work_fit');
  });

  it('renders a missing value as an explicit "Unknown", never blank or invented', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );

    // candidate-forester has no price attribute.
    expect(
      screen.getByTestId('option-compare-view-cell-price-candidate-forester'),
    ).toHaveTextContent(/unknown/i);
    // candidate-crv has no custom.laptop_work_fit attribute.
    expect(
      screen.getByTestId('option-compare-view-cell-custom.laptop_work_fit-candidate-crv'),
    ).toHaveTextContent(/unknown/i);
  });

  it('groups rows using pack presentation metadata when provided', () => {
    const presentation: PresentationDefinition = {
      optionLabel: 'car',
      optionLabelPlural: 'cars',
      attributeGroups: [{ id: 'cost', label: 'Cost', attributeIds: ['price'] }],
    };
    render(
      <OptionCompareView
        options={[OPTIONS[0]!]}
        attributeDefinitions={DEFINITIONS}
        presentation={presentation}
        selectedOptionId={null}
        layout="expanded"
      />,
    );
    expect(screen.getByTestId('option-compare-view-group-cost')).toHaveTextContent('Cost');
    expect(screen.getByTestId('option-compare-view-row-mileage')).toBeInTheDocument();
  });

  it('renders a head-to-head shape (exactly two columns) in narrow layout', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="narrow"
      />,
    );

    const table = screen.getByTestId('option-compare-view-table');
    expect(table).toHaveAttribute('data-layout', 'narrow');
    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
    expect(
      screen.queryByTestId('option-compare-view-header-candidate-forester'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-narrow-note')).toBeInTheDocument();
  });

  it('narrow layout head-to-head keeps the selected option and pairs it with the first other option', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId="candidate-forester"
        layout="narrow"
      />,
    );

    expect(screen.getByTestId('option-compare-view-header-candidate-forester')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
    expect(
      screen.queryByTestId('option-compare-view-header-candidate-crv'),
    ).not.toBeInTheDocument();
  });

  it('renders every visible option as a column in expanded layout', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );

    const table = screen.getByTestId('option-compare-view-table');
    expect(table).toHaveAttribute('data-layout', 'expanded');
    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-forester')).toBeInTheDocument();
    expect(screen.queryByTestId('option-compare-view-narrow-note')).not.toBeInTheDocument();
  });

  it('marks the header of the currently selected option', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId="candidate-rav4"
        layout="expanded"
      />,
    );
    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toHaveTextContent(
      /selected/i,
    );
  });

  it('fires onFocusOption when an option header is clicked', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
        onFocusOption={onFocusOption}
      />,
    );

    await user.click(screen.getByTestId('option-compare-view-focus-candidate-crv'));
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith('candidate-crv');
  });

  // Regression test for the reported defect: this header button carries
  // `aria-pressed={isSelected}`, promising a real toggle. Clicking the
  // already-selected header used to re-send the same id and leave it
  // permanently selected -- a dead end and an `aria-pressed` lie. It must
  // now clear the selection (`onFocusOption(null)`) instead.
  it('clicking the already-selected header clears the selection instead of re-selecting it', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId="candidate-crv"
        layout="expanded"
        onFocusOption={onFocusOption}
      />,
    );

    await user.click(screen.getByTestId('option-compare-view-focus-candidate-crv'));
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('marks only the selected header aria-pressed, and every other header false', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId="candidate-crv"
        layout="expanded"
      />,
    );

    expect(screen.getByTestId('option-compare-view-focus-candidate-crv')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('option-compare-view-focus-candidate-rav4')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('is keyboard operable: pressing Enter on a focused option header fires onFocusOption', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
        onFocusOption={onFocusOption}
      />,
    );

    const focusButton = screen.getByTestId('option-compare-view-focus-candidate-forester');
    focusButton.focus();
    expect(focusButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onFocusOption).toHaveBeenCalledExactlyOnceWith('candidate-forester');
  });

  it('has no axe violations in the empty, narrow, and expanded states', async () => {
    const { container: empty } = render(
      <OptionCompareView
        options={[]}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );
    expect(await axe(empty)).toHaveNoViolations();

    const { container: narrow } = render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId="candidate-rav4"
        layout="narrow"
      />,
    );
    expect(await axe(narrow)).toHaveNoViolations();

    const { container: expanded } = render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        pinnedAttributeIds={['price']}
        layout="expanded"
      />,
    );
    expect(await axe(expanded)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk (the table itself scrolls within its own container)', () => {
    const { overflowRisks } = renderAtNarrowWidth(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );
    expect(overflowRisks).toEqual([]);
  });

  // Defect 1 regression gate: a filtered-out option must never read as
  // eliminated (§54 -- presentation filtering is not a decision mutation).
  // Hiding a column via `visibleOptionIds` needs its own visible,
  // non-alarming explanation distinct from the narrow-layout head-to-head
  // auto-pairing note above (`option-compare-view-narrow-note`), which only
  // covers the already-visible set being paired down for the narrow layout.
  it('explains that options missing from a narrowed visibleOptionIds set are not eliminated, only not shown here', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        visibleOptionIds={['candidate-rav4', 'candidate-crv']}
        layout="expanded"
      />,
    );

    const note = screen.getByTestId('option-compare-view-filtered-note');
    expect(note).toHaveTextContent(/not eliminated/i);
    expect(
      screen.queryByTestId('option-compare-view-header-candidate-forester'),
    ).not.toBeInTheDocument();
  });

  it('shows no "not eliminated" note when visibleOptionIds is absent (nothing was filtered)', () => {
    render(
      <OptionCompareView
        options={OPTIONS}
        attributeDefinitions={DEFINITIONS}
        presentation={null}
        selectedOptionId={null}
        layout="expanded"
      />,
    );
    expect(screen.queryByTestId('option-compare-view-filtered-note')).not.toBeInTheDocument();
  });

  // Defect 2: confirmed case-level custom fields (`snapshot.caseExtensions`)
  // must appear as first-class comparison rows, reusing the existing
  // `custom.*` Custom-badge/label rendering this file already tests above.
  describe('confirmed case extensions render as comparison rows (Defect 2)', () => {
    it('merges a confirmed case extension in as a real row, marked Custom, using its label rather than its raw id', () => {
      const entityWithExtensionValue = {
        ...OPTIONS[0]!,
        attributes: {
          ...OPTIONS[0]!.attributes,
          'custom.trunk_space': {
            definitionId: 'custom.trunk_space',
            label: 'Trunk space fit',
            value: { type: 'string' as const, value: 'Fits a folded stroller' },
            origin: 'user' as const,
            sourceIds: [],
            status: 'asserted' as const,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        },
      };

      const { container } = render(
        <OptionCompareView
          options={[entityWithExtensionValue]}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
          caseExtensions={[buildCaseExtension()]}
        />,
      );

      const row = screen.getByTestId('option-compare-view-row-custom.trunk_space');
      expect(row).toHaveTextContent('Trunk space fit');
      expect(row).toHaveTextContent('Fits a folded stroller');
      expect(
        screen.getByTestId('option-compare-view-custom-badge-custom.trunk_space'),
      ).toHaveTextContent('Custom');
      expect(container.textContent ?? '').not.toContain('custom.trunk_space');
    });

    it('excludes a case extension that is still pending human review -- it is a proposal, not an agreed comparison dimension', () => {
      render(
        <OptionCompareView
          options={[OPTIONS[0]!]}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
          caseExtensions={[
            buildCaseExtension({
              id: 'ext-pending',
              definition: {
                ...buildCaseExtension().definition,
                id: 'custom.paint_color',
                label: 'Paint color match',
                confirmation: 'pending',
              },
            }),
          ]}
        />,
      );

      expect(
        screen.queryByTestId('option-compare-view-row-custom.paint_color'),
      ).not.toBeInTheDocument();
    });

    it('excludes a rejected case extension', () => {
      render(
        <OptionCompareView
          options={[OPTIONS[0]!]}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
          caseExtensions={[
            buildCaseExtension({
              id: 'ext-rejected',
              definition: {
                ...buildCaseExtension().definition,
                id: 'custom.rejected_field',
                label: 'Rejected field',
                confirmation: 'rejected',
              },
            }),
          ]}
        />,
      );

      expect(
        screen.queryByTestId('option-compare-view-row-custom.rejected_field'),
      ).not.toBeInTheDocument();
    });

    it('renders no additional rows when caseExtensions is omitted (backward compatible default)', () => {
      render(
        <OptionCompareView
          options={OPTIONS}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );
      // Only the three DEFINITIONS rows exist -- no crash, no phantom row.
      expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-row-mileage')).toBeInTheDocument();
      expect(
        screen.getByTestId('option-compare-view-row-custom.laptop_work_fit'),
      ).toBeInTheDocument();
    });
  });

  // Problem 1: an identity/label descriptor merely restates the option's own column header
  // ("2022 Toyota RAV4 XLE Hybrid AWD" -> "Make: Toyota" underneath it says nothing new), so it is
  // excluded from Compare's DEFAULT row set -- but Compare is configurable, so it must stay
  // reachable through either narrowing lever a caller already has.
  describe('identity attributes are excluded from the default row set, but stay reachable (Problem 1)', () => {
    it('excludes an identity attribute (isIdentityAttribute) from the default visible rows', () => {
      render(
        <OptionCompareView
          options={OPTIONS_WITH_IDENTITY}
          attributeDefinitions={DEFINITIONS_WITH_IDENTITY}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );

      expect(screen.queryByTestId('option-compare-view-row-make')).not.toBeInTheDocument();
      // Non-identity rows are unaffected.
      expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
    });

    it('still renders an identity attribute when a caller explicitly names it in visibleAttributeIds', () => {
      render(
        <OptionCompareView
          options={OPTIONS_WITH_IDENTITY}
          attributeDefinitions={DEFINITIONS_WITH_IDENTITY}
          presentation={null}
          selectedOptionId={null}
          visibleAttributeIds={['make', 'price']}
          layout="expanded"
        />,
      );

      expect(screen.getByTestId('option-compare-view-row-make')).toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-row-make')).toHaveTextContent('Make');
    });

    it('still renders an identity attribute when it is pinned, even with visibleAttributeIds absent', () => {
      render(
        <OptionCompareView
          options={OPTIONS_WITH_IDENTITY}
          attributeDefinitions={DEFINITIONS_WITH_IDENTITY}
          presentation={null}
          selectedOptionId={null}
          pinnedAttributeIds={['make']}
          layout="expanded"
        />,
      );

      const row = screen.getByTestId('option-compare-view-row-make');
      expect(row).toBeInTheDocument();
      expect(row).toHaveAttribute('data-pinned', 'true');
      // Every other default row (none of which are identity attributes here) still renders too --
      // pinning one identity row must not narrow anything else.
      expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
    });
  });

  // Problem 2: a row where every rendered option resolves to the identical value carries no
  // comparison signal (the motivating case: car.standard_features is identical across all four
  // demo car candidates, and is also the longest row on the page) but must not be deleted -- it
  // collapses to a de-emphasized, reversible single-cell summary instead.
  describe('rows where every rendered option has the same value are de-emphasized, not deleted (Problem 2)', () => {
    it('collapses an all-equal row to one shared, muted cell and marks it data-all-equal', () => {
      render(
        <OptionCompareView
          options={OPTIONS_SAME_PRICE}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );

      const row = screen.getByTestId('option-compare-view-row-price');
      expect(row).toHaveAttribute('data-all-equal', 'true');
      expect(screen.getByTestId('option-compare-view-same-badge-price')).toHaveTextContent(
        /same for all/i,
      );

      // The value is shown once, not once per option -- but it is still shown (never deleted).
      const collapsedCell = screen.getByTestId('option-compare-view-collapsed-cell-price');
      expect(collapsedCell).toHaveTextContent('$30,000');
      expect(
        screen.queryByTestId('option-compare-view-cell-price-candidate-rav4'),
      ).not.toBeInTheDocument();

      // A row with real per-option differences is completely unaffected.
      const mileageRow = screen.getByTestId('option-compare-view-row-mileage');
      expect(mileageRow).toHaveAttribute('data-all-equal', 'false');
      expect(
        screen.getByTestId('option-compare-view-cell-mileage-candidate-rav4'),
      ).toBeInTheDocument();
    });

    it('is reversible: toggling the row open reveals the per-option cells, and toggling again re-collapses it', async () => {
      const user = userEvent.setup();
      render(
        <OptionCompareView
          options={OPTIONS_SAME_PRICE}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );

      const toggle = screen.getByTestId('option-compare-view-row-toggle-price');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.queryByTestId('option-compare-view-collapsed-cell-price'),
      ).not.toBeInTheDocument();
      // Every option's (identical) value is visible individually now -- nothing was lost.
      expect(screen.getByTestId('option-compare-view-cell-price-candidate-rav4')).toHaveTextContent(
        '$30,000',
      );
      expect(screen.getByTestId('option-compare-view-cell-price-candidate-crv')).toHaveTextContent(
        '$30,000',
      );
      expect(
        screen.getByTestId('option-compare-view-cell-price-candidate-forester'),
      ).toHaveTextContent('$30,000');
      // Still explicitly marked as agreeing, even while expanded -- "they are all the same" stays
      // visible information, it is just no longer collapsed.
      expect(screen.getByTestId('option-compare-view-same-badge-price')).toBeInTheDocument();

      await user.click(screen.getByTestId('option-compare-view-row-toggle-price'));

      expect(screen.getByTestId('option-compare-view-row-toggle-price')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.getByTestId('option-compare-view-collapsed-cell-price')).toBeInTheDocument();
    });

    it('never collapses a row when only one option is rendered -- nothing to compare against', () => {
      render(
        <OptionCompareView
          options={[OPTIONS_SAME_PRICE[0]!]}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );

      const row = screen.getByTestId('option-compare-view-row-price');
      expect(row).toHaveAttribute('data-all-equal', 'false');
      expect(screen.getByTestId('option-compare-view-cell-price-candidate-rav4')).toHaveTextContent(
        '$30,000',
      );
      expect(
        screen.queryByTestId('option-compare-view-collapsed-cell-price'),
      ).not.toBeInTheDocument();
    });

    it('does not collapse a row where every option is unresolved -- "no one knows" is not "everyone agrees"', () => {
      const optionsMissingPrice = OPTIONS_SAME_PRICE.map((option) => {
        const { price: _price, ...rest } = option.attributes;
        return { ...option, attributes: rest };
      });

      render(
        <OptionCompareView
          options={optionsMissingPrice}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );

      const row = screen.getByTestId('option-compare-view-row-price');
      expect(row).toHaveAttribute('data-all-equal', 'false');
      expect(screen.getByTestId('option-compare-view-cell-price-candidate-rav4')).toHaveTextContent(
        /unknown/i,
      );
    });

    it('evaluates all-equal against the two options actually rendered in narrow head-to-head, not the full option set', () => {
      // rav4 and crv share the same price; forester (excluded from the narrow head-to-head pair
      // by the default first-two rule) has a different one -- a naive check over every option
      // would wrongly call this row unequal.
      const options = [
        withPrice(OPTIONS[0]!, 30000),
        withPrice(OPTIONS[1]!, 30000),
        withPrice(OPTIONS[2]!, 99999),
      ];

      render(
        <OptionCompareView
          options={options}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="narrow"
        />,
      );

      expect(screen.getByTestId('option-compare-view-row-price')).toHaveAttribute(
        'data-all-equal',
        'true',
      );
    });

    it('has no axe violations with an all-equal row in both its collapsed and expanded states', async () => {
      const { container: collapsed } = render(
        <OptionCompareView
          options={OPTIONS_SAME_PRICE}
          attributeDefinitions={DEFINITIONS}
          presentation={null}
          selectedOptionId={null}
          layout="expanded"
        />,
      );
      expect(await axe(collapsed)).toHaveNoViolations();

      const user = userEvent.setup();
      await user.click(screen.getByTestId('option-compare-view-row-toggle-price'));
      expect(await axe(collapsed)).toHaveNoViolations();
    });
  });
});
