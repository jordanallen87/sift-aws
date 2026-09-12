/**
 * The always-visible half of the filter experience: a `Filters` button with
 * an active count, one removable chip per applied filter, `Clear all`, and
 * a live result count that says in plain words why the list below is the
 * length it is.
 *
 * These tests deliberately assert the *sentence* a person reads, not just
 * the presence of an element. The defect this whole round of work exists to
 * fix is a results area that goes empty with no explanation, so "No saved
 * cars match these filters." being on screen -- with an escape hatch beside
 * it -- is the behaviour under test, not an incidental string.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type {
  AttributeDefinition,
  AttributeValue,
  EntityRecord,
  PresentationDefinition,
  WorkspaceFilter,
} from '@sift/contracts';
import { FilterBar, type FilterBarProps } from './FilterBar.js';

function buildAttribute(overrides: Partial<AttributeDefinition> = {}): AttributeDefinition {
  return {
    id: 'awd',
    label: 'AWD',
    valueType: 'boolean',
    required: false,
    appliesTo: ['car'],
    evidenceExpectation: 'assertion',
    comparison: 'none',
    sensitive: false,
    ...overrides,
  };
}

const ATTRIBUTES: AttributeDefinition[] = [
  buildAttribute({ id: 'awd', label: 'AWD', valueType: 'boolean' }),
  buildAttribute({ id: 'price', label: 'Price', valueType: 'number', unit: 'USD' }),
  buildAttribute({ id: 'msrp', label: 'MSRP', valueType: 'money' }),
  buildAttribute({ id: 'color', label: 'Color', valueType: 'string' }),
  // Nothing here has an honest single-field comparison control, so a bar
  // built from only these must render no chrome at all.
  buildAttribute({ id: 'listedOn', label: 'Listed on', valueType: 'date' }),
];

function buildOption(id: string, values: Record<string, AttributeValue>): EntityRecord {
  const attributes: EntityRecord['attributes'] = {};
  for (const [definitionId, value] of Object.entries(values)) {
    attributes[definitionId] = {
      definitionId,
      label: definitionId,
      value,
      origin: 'user',
      sourceIds: [],
      status: 'asserted',
      updatedAt: '2026-08-28T00:00:00.000Z',
    };
  }
  return {
    id,
    kind: 'car',
    label: id,
    attributes,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

const OPTIONS: EntityRecord[] = [
  buildOption('car-1', {
    awd: { type: 'boolean', value: true },
    price: { type: 'number', value: 27995 },
    msrp: { type: 'money', amount: 29500, currency: 'USD' },
    color: { type: 'string', value: 'Red' },
  }),
  buildOption('car-2', {
    awd: { type: 'boolean', value: false },
    price: { type: 'number', value: 24500 },
    msrp: { type: 'money', amount: 26000, currency: 'USD' },
    color: { type: 'string', value: 'Blue' },
  }),
  buildOption('car-3', {
    awd: { type: 'boolean', value: true },
    price: { type: 'number', value: 31995 },
    color: { type: 'string', value: 'Black' },
  }),
  buildOption('car-4', {
    awd: { type: 'boolean', value: false },
    price: { type: 'number', value: 22995 },
    color: { type: 'string', value: 'Red' },
  }),
];

/** The real `PresentationDefinition` shape the car-purchase pack ships (`packages/packs/src/car-purchase.ts`) -- a pack author's own noun, never one invented here. */
const CAR_PRESENTATION: PresentationDefinition = {
  optionLabel: 'Saved car',
  optionLabelPlural: 'Saved cars',
  attributeGroups: [],
};

function baseProps(overrides: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    attributeDefinitions: ATTRIBUTES,
    options: OPTIONS,
    filters: [],
    onFiltersChange: vi.fn(),
    onOpenFilters: vi.fn(),
    matchingCount: OPTIONS.length,
    totalCount: OPTIONS.length,
    presentation: CAR_PRESENTATION,
    ...overrides,
  };
}

const AWD_FILTER: WorkspaceFilter = { fieldId: 'awd', operator: 'equals', value: 'true' };
const COLOR_FILTER: WorkspaceFilter = { fieldId: 'color', operator: 'equals', value: 'Red' };

describe('FilterBar', () => {
  describe('when there is nothing to filter', () => {
    it('renders no chrome at all when the case declares no filterable attribute', () => {
      const { container } = render(
        <FilterBar {...baseProps({ attributeDefinitions: [ATTRIBUTES[4]!] })} />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId('workspace-filter-bar')).not.toBeInTheDocument();
    });
  });

  describe('the Filters entry point', () => {
    it('renders the button with no count badge while nothing is applied', () => {
      render(<FilterBar {...baseProps()} />);
      expect(screen.getByTestId('workspace-filter-bar')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-filter-open')).toHaveTextContent('Filters');
      expect(screen.queryByTestId('workspace-filter-active-count')).not.toBeInTheDocument();
    });

    it('can render a compact icon-only trigger while keeping its accessible name', () => {
      render(<FilterBar {...baseProps()} compact />);

      expect(screen.getByTestId('workspace-filter-open')).toHaveAccessibleName('Filter options');
      expect(screen.getByTestId('workspace-filter-open')).not.toHaveTextContent('Filters');
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('4 saved cars');
    });

    it('shows how many filters are applied, once at least one is', () => {
      render(<FilterBar {...baseProps({ filters: [AWD_FILTER, COLOR_FILTER] })} />);
      expect(screen.getByTestId('workspace-filter-active-count')).toHaveTextContent('2');
    });

    it('only asks the caller to open the sheet -- it never opens anything itself', async () => {
      const user = userEvent.setup();
      const onOpenFilters = vi.fn();
      render(<FilterBar {...baseProps({ onOpenFilters })} />);

      await user.click(screen.getByTestId('workspace-filter-open'));
      expect(onOpenFilters).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('workspace-filter-sheet')).not.toBeInTheDocument();
    });
  });

  describe('applied-filter chips', () => {
    it('renders one chip per applied filter, worded the way the control that set it is worded', () => {
      render(
        <FilterBar
          {...baseProps({
            filters: [
              AWD_FILTER,
              COLOR_FILTER,
              { fieldId: 'price', operator: 'less_than_or_equal', value: '30000' },
              { fieldId: 'msrp', operator: 'less_than_or_equal', value: '30000' },
            ],
            matchingCount: 1,
          })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-chip-awd')).toHaveTextContent('AWD only');
      expect(screen.getByTestId('workspace-filter-chip-color')).toHaveTextContent('Color: Red');
      // The declared unit for a plain number, the real declared currency for money.
      expect(screen.getByTestId('workspace-filter-chip-price')).toHaveTextContent(
        'Price: 30,000 USD or less',
      );
      expect(screen.getByTestId('workspace-filter-chip-msrp')).toHaveTextContent(
        'MSRP: $30,000 or less',
      );
    });

    it('orders chips by the attribute declaration, so the row does not reshuffle as filters are toggled', () => {
      render(
        <FilterBar
          {...baseProps({
            // Applied in the reverse of declaration order.
            filters: [COLOR_FILTER, AWD_FILTER],
            matchingCount: 2,
          })}
        />,
      );
      const chips = within(screen.getByTestId('workspace-filter-chips')).getAllByText(
        /AWD only|Color: Red/,
      );
      expect(chips.map((chip) => chip.textContent)).toEqual(['AWD only', 'Color: Red']);
    });

    it("gives every chip's ✕ an accessible name saying what it removes, not a bare glyph", () => {
      render(
        <FilterBar {...baseProps({ filters: [AWD_FILTER, COLOR_FILTER], matchingCount: 2 })} />,
      );
      expect(screen.getByTestId('workspace-filter-chip-remove-awd')).toHaveAccessibleName(
        'Remove filter: AWD only',
      );
      expect(screen.getByTestId('workspace-filter-chip-remove-color')).toHaveAccessibleName(
        'Remove filter: Color: Red',
      );
    });

    it('removing one chip emits the COMPLETE next array with only that filter gone', async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      render(
        <FilterBar
          {...baseProps({ filters: [AWD_FILTER, COLOR_FILTER], matchingCount: 2, onFiltersChange })}
        />,
      );

      await user.click(screen.getByTestId('workspace-filter-chip-remove-awd'));
      expect(onFiltersChange).toHaveBeenCalledWith([COLOR_FILTER]);
    });

    it('never writes a criterion-shaped payload -- only fieldId/operator/value survive a removal', async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      render(
        <FilterBar
          {...baseProps({ filters: [AWD_FILTER, COLOR_FILTER], matchingCount: 2, onFiltersChange })}
        />,
      );

      await user.click(screen.getByTestId('workspace-filter-chip-remove-awd'));
      const [next] = onFiltersChange.mock.calls.at(-1) as [WorkspaceFilter[]];
      for (const filter of next) {
        expect(Object.keys(filter as object).sort()).toEqual(['fieldId', 'operator', 'value']);
      }
    });

    it('keeps a long chip readable at pane width instead of truncating it to a stub', () => {
      const longValue = 'Deep Ocean Metallic with Graphite Accents';
      render(
        <FilterBar
          {...baseProps({
            filters: [{ fieldId: 'color', operator: 'equals', value: longValue }],
            matchingCount: 0,
          })}
        />,
      );
      const chip = screen.getByTestId('workspace-filter-chip-color');
      // The chip claims its own line rather than losing a shrink race (the
      // exact defect that once cut a real label down to "S…"), and the
      // complete text stays reachable even if the value overflows.
      expect(chip).toHaveClass('shrink-0');
      expect(chip).toHaveClass('max-w-full');
      expect(within(chip).getByTitle(`Color: ${longValue}`)).toHaveTextContent(longValue);
    });

    it('renders no chip for a filter naming an attribute this pack version no longer declares', () => {
      render(
        <FilterBar
          {...baseProps({
            filters: [{ fieldId: 'towing_capacity', operator: 'equals', value: '5000' }],
          })}
        />,
      );
      // A stale filter is ignored by `applyWorkspaceFilters` too, so
      // counting it here would claim a narrowing that is not happening.
      expect(screen.getByTestId('workspace-filter-bar')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-filter-active-count')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-filter-clear-all')).not.toBeInTheDocument();
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('4 saved cars');
    });
  });

  describe('clear all', () => {
    it('is absent while nothing is applied', () => {
      render(<FilterBar {...baseProps()} />);
      expect(screen.queryByTestId('workspace-filter-clear-all')).not.toBeInTheDocument();
    });

    it('empties every filter at once, including one with no chip of its own', async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      render(
        <FilterBar
          {...baseProps({
            filters: [
              AWD_FILTER,
              { fieldId: 'towing_capacity', operator: 'equals', value: '5000' },
            ],
            matchingCount: 2,
            onFiltersChange,
          })}
        />,
      );

      await user.click(screen.getByTestId('workspace-filter-clear-all'));
      expect(onFiltersChange).toHaveBeenCalledWith([]);
    });
  });

  describe('the live result count', () => {
    it('reads as a plain total when nothing is applied', () => {
      render(<FilterBar {...baseProps()} />);
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('4 saved cars');
    });

    it('reads as "N of M" once a filter narrows the list', () => {
      render(<FilterBar {...baseProps({ filters: [AWD_FILTER], matchingCount: 2 })} />);
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent(
        '2 of 4 saved cars',
      );
    });

    it('uses the singular noun for a single saved option, never "1 saved cars"', () => {
      render(
        <FilterBar {...baseProps({ options: [OPTIONS[0]!], matchingCount: 1, totalCount: 1 })} />,
      );
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('1 saved car');
      expect(screen.getByTestId('workspace-filter-result-count')).not.toHaveTextContent(
        '1 saved cars',
      );
    });

    it("uses the pack's own noun rather than one invented here", () => {
      render(
        <FilterBar
          {...baseProps({
            presentation: {
              optionLabel: 'Response option',
              optionLabelPlural: 'Response options',
              attributeGroups: [],
            },
          })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent(
        '4 response options',
      );
    });

    it('falls back to a neutral noun when no pack has been resolved yet', () => {
      render(<FilterBar {...baseProps({ presentation: null })} />);
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('4 options');
    });

    it('falls back to the neutral singular for a single option with no pack resolved', () => {
      render(
        <FilterBar
          {...baseProps({
            presentation: null,
            options: [OPTIONS[0]!],
            matchingCount: 1,
            totalCount: 1,
          })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('1 option');
    });
  });

  describe('when filters exclude everything', () => {
    it('says so in plain words and keeps the escape hatch inline', () => {
      render(
        <FilterBar
          {...baseProps({
            filters: [{ fieldId: 'color', operator: 'equals', value: 'Purple' }],
            matchingCount: 0,
          })}
        />,
      );
      // An unexplained empty results area is the defect this closes: it
      // looks identical to a case with nothing saved, or to a broken load.
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent(
        'No saved cars match these filters.',
      );
      expect(screen.getByTestId('workspace-filter-clear-all')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-filter-chip-remove-color')).toBeInTheDocument();
    });
  });

  /**
   * The assistant's own narrowing (`WorkspaceViewState.visibleOptionIds`,
   * written by `sift_set_view`) shown as what it is: SOMEONE ELSE's reason
   * the list is short.
   *
   * The rule these tests exist to enforce is that an invisible narrowing is
   * a lie. If the model narrows twelve saved cars to three and the page
   * simply shows three cards, the person reasonably concludes there are only
   * three cars -- which is strictly worse than never implementing the
   * feature. So it gets the same treatment a human filter gets: a chip that
   * says plainly what happened, a real ✕ that undoes it, and a result count
   * that keeps naming the true total.
   */
  describe("the assistant's narrowing", () => {
    it('says in plain words that the assistant narrowed the view, and to how many', () => {
      render(
        <FilterBar
          {...baseProps({
            assistantVisibleOptionIds: ['car-1', 'car-2', 'car-3'],
            matchingCount: 3,
          })}
        />,
      );
      const chip = screen.getByTestId('workspace-filter-assistant-chip');
      // Plain English, and no jargon: the person has never heard of
      // `visibleOptionIds` and should not have to.
      expect(chip).toHaveTextContent('Assistant narrowed to 3 saved cars');
      expect(chip).not.toHaveTextContent('visibleOptionIds');
    });

    it("uses the pack's own singular noun when the assistant narrowed to exactly one", () => {
      render(
        <FilterBar {...baseProps({ assistantVisibleOptionIds: ['car-1'], matchingCount: 1 })} />,
      );
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toHaveTextContent(
        'Assistant narrowed to 1 saved car',
      );
    });

    it('counts only the options that actually exist, never the raw id list it was handed', () => {
      // A `visibleOptionIds` array persisted before an option was deleted
      // still names it. Claiming "narrowed to 3" while two of those three
      // are gone would be a fabricated number in the one place this row
      // exists to be honest about.
      render(
        <FilterBar
          {...baseProps({
            assistantVisibleOptionIds: ['car-1', 'ghost-a', 'ghost-b'],
            matchingCount: 1,
          })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toHaveTextContent(
        'Assistant narrowed to 1 saved car',
      );
    });

    it('is visually distinguishable from a human-set filter chip -- whose narrowing this is, is the point', () => {
      render(
        <FilterBar
          {...baseProps({
            filters: [AWD_FILTER],
            assistantVisibleOptionIds: ['car-1', 'car-3'],
            matchingCount: 2,
          })}
        />,
      );
      const assistantChip = screen.getByTestId('workspace-filter-assistant-chip');
      const humanChip = screen.getByTestId('workspace-filter-chip-awd');
      expect(assistantChip.className).not.toEqual(humanChip.className);
    });

    it('has a ✕ whose accessible name says what it undoes', () => {
      render(
        <FilterBar {...baseProps({ assistantVisibleOptionIds: ['car-1'], matchingCount: 1 })} />,
      );
      expect(screen.getByTestId('workspace-filter-assistant-chip-remove')).toHaveAccessibleName(
        'Remove: Assistant narrowed to 1 saved car',
      );
    });

    it('clearing it asks the caller to undo it, and never touches the human filters', async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      const onClearAssistantNarrowing = vi.fn();
      render(
        <FilterBar
          {...baseProps({
            filters: [AWD_FILTER],
            assistantVisibleOptionIds: ['car-1'],
            matchingCount: 1,
            onFiltersChange,
            onClearAssistantNarrowing,
          })}
        />,
      );

      await user.click(screen.getByTestId('workspace-filter-assistant-chip-remove'));
      expect(onClearAssistantNarrowing).toHaveBeenCalledTimes(1);
      expect(onFiltersChange).not.toHaveBeenCalled();
    });

    it('is absent whenever the assistant has narrowed nothing', () => {
      render(<FilterBar {...baseProps({ filters: [AWD_FILTER], matchingCount: 2 })} />);
      expect(screen.queryByTestId('workspace-filter-assistant-chip')).not.toBeInTheDocument();
    });

    it('does not inflate the Filters button count, which stands for what the sheet can change', () => {
      // The badge is a promise that opening the sheet shows you those
      // controls. The assistant's narrowing has no control in there, so
      // counting it would send the person looking for something that is not
      // there.
      render(
        <FilterBar
          {...baseProps({
            filters: [AWD_FILTER],
            assistantVisibleOptionIds: ['car-1'],
            matchingCount: 1,
          })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-active-count')).toHaveTextContent('1');
    });

    it('still renders the row when the assistant narrowed a case with nothing filterable', async () => {
      // Without this the honesty guarantee would silently lapse for any pack
      // declaring no filterable attribute: the bar returns null, and the
      // narrowing becomes invisible again -- the exact defect being fixed.
      const { container } = render(
        <FilterBar
          {...baseProps({
            attributeDefinitions: [ATTRIBUTES[4]!],
            assistantVisibleOptionIds: ['car-1'],
            matchingCount: 1,
          })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      // ...but no dead `Filters` button over a sheet with no controls in it.
      expect(screen.queryByTestId('workspace-filter-open')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('reads as "N of M" so the true total stays on screen while the assistant is narrowing', () => {
      render(
        <FilterBar
          {...baseProps({ assistantVisibleOptionIds: ['car-1', 'car-2'], matchingCount: 2 })}
        />,
      );
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent(
        '2 of 4 saved cars',
      );
    });

    it('Clear all undoes both narrowings, because it sits at the end of the row that shows both', async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      const onClearAssistantNarrowing = vi.fn();
      render(
        <FilterBar
          {...baseProps({
            filters: [AWD_FILTER],
            assistantVisibleOptionIds: ['car-1'],
            matchingCount: 1,
            onFiltersChange,
            onClearAssistantNarrowing,
          })}
        />,
      );

      await user.click(screen.getByTestId('workspace-filter-clear-all'));
      expect(onFiltersChange).toHaveBeenCalledWith([]);
      expect(onClearAssistantNarrowing).toHaveBeenCalledTimes(1);
    });

    it('gives its ✕ the same real 44px touch target every other control here has', () => {
      render(
        <FilterBar {...baseProps({ assistantVisibleOptionIds: ['car-1'], matchingCount: 1 })} />,
      );
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
      expect(screen.getByTestId('workspace-filter-assistant-chip-remove')).toHaveClass(
        'h-[var(--size-touch-target-min)]',
        'w-[var(--size-touch-target-min)]',
      );
    });

    it('has no axe violations with both narrowings shown at once', async () => {
      const { container } = render(
        <FilterBar
          {...baseProps({
            filters: [AWD_FILTER, COLOR_FILTER],
            assistantVisibleOptionIds: ['car-1'],
            matchingCount: 1,
          })}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    describe('when nothing survives both narrowings', () => {
      it('names BOTH reasons, so the person is not left blaming their filters alone', () => {
        render(
          <FilterBar
            {...baseProps({
              filters: [{ fieldId: 'color', operator: 'equals', value: 'Purple' }],
              assistantVisibleOptionIds: ['car-1', 'car-2'],
              matchingCount: 0,
            })}
          />,
        );
        const text = screen.getByTestId('workspace-filter-result-count');
        expect(text).toHaveTextContent('these filters');
        expect(text).toHaveTextContent('the 2 the assistant narrowed to');
      });

      it('blames only the assistant when it narrowed to options that are no longer saved', () => {
        render(
          <FilterBar
            {...baseProps({ assistantVisibleOptionIds: ['ghost-a'], matchingCount: 0 })}
          />,
        );
        expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent(
          'The assistant narrowed this view to saved cars that are no longer here.',
        );
      });

      it('still blames only the filters when the assistant has narrowed nothing', () => {
        render(
          <FilterBar
            {...baseProps({
              filters: [{ fieldId: 'color', operator: 'equals', value: 'Purple' }],
              matchingCount: 0,
            })}
          />,
        );
        expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent(
          'No saved cars match these filters.',
        );
      });

      it('keeps both escape hatches reachable', async () => {
        const user = userEvent.setup();
        const onClearAssistantNarrowing = vi.fn();
        render(
          <FilterBar
            {...baseProps({
              filters: [{ fieldId: 'color', operator: 'equals', value: 'Purple' }],
              assistantVisibleOptionIds: ['car-1'],
              matchingCount: 0,
              onClearAssistantNarrowing,
            })}
          />,
        );
        expect(screen.getByTestId('workspace-filter-chip-remove-color')).toBeInTheDocument();
        await user.click(screen.getByTestId('workspace-filter-assistant-chip-remove'));
        expect(onClearAssistantNarrowing).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('accessibility', () => {
    it('gives every control a real 44px touch target', () => {
      render(<FilterBar {...baseProps({ filters: [AWD_FILTER], matchingCount: 2 })} />);
      expect(screen.getByTestId('workspace-filter-open')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
      expect(screen.getByTestId('workspace-filter-clear-all')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
      expect(screen.getByTestId('workspace-filter-chip-awd')).toHaveClass(
        'min-h-[var(--size-touch-target-min)]',
      );
      expect(screen.getByTestId('workspace-filter-chip-remove-awd')).toHaveClass(
        'h-[var(--size-touch-target-min)]',
        'w-[var(--size-touch-target-min)]',
      );
    });

    it('has no axe violations with nothing applied', async () => {
      const { container } = render(<FilterBar {...baseProps()} />);
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations with a full chip row', async () => {
      const { container } = render(
        <FilterBar
          {...baseProps({
            filters: [
              AWD_FILTER,
              COLOR_FILTER,
              { fieldId: 'price', operator: 'less_than_or_equal', value: '30000' },
            ],
            matchingCount: 1,
          })}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations in the zero-match state', async () => {
      const { container } = render(
        <FilterBar
          {...baseProps({
            filters: [{ fieldId: 'color', operator: 'equals', value: 'Purple' }],
            matchingCount: 0,
          })}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
