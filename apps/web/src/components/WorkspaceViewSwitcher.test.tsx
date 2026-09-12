import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import type { AttributeDefinition, CaseExtension, Criterion, EntityRecord } from '@sift/contracts';
import { WorkspaceViewSwitcher, type WorkspaceViewSwitcherProps } from './WorkspaceViewSwitcher.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';
import { buildWorkspaceScoreboard } from './case-scoreboard.js';
import {
  buildCarCaseState,
  CAR_CRITERIA,
  CAR_DEFINITIONS,
  CAR_OPTIONS,
  CAR_PRESENTATION,
} from '../test/scoreboard-fixtures.js';

function buildOption(overrides: Partial<EntityRecord> = {}): EntityRecord {
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

function buildDefinition(overrides: Partial<AttributeDefinition> = {}): AttributeDefinition {
  return {
    id: 'price',
    label: 'Price',
    valueType: 'number',
    required: false,
    appliesTo: ['car'],
    evidenceExpectation: 'assertion',
    comparison: 'lower_better',
    sensitive: false,
    ...overrides,
  };
}

function buildProps(
  overrides: Partial<WorkspaceViewSwitcherProps> = {},
): WorkspaceViewSwitcherProps {
  return {
    mode: 'compare',
    onModeChange: vi.fn(),
    options: [buildOption()],
    attributeDefinitions: [buildDefinition()],
    caseExtensions: [],
    presentation: null,
    criteria: [],
    selectedOptionId: null,
    onFocusOption: vi.fn(),
    quickPickPosition: 0,
    quickPickDispositions: {},
    onQuickPickKeep: vi.fn(),
    onQuickPickPass: vi.fn(),
    onQuickPickUnsure: vi.fn(),
    onQuickPickUndo: vi.fn(),
    onQuickPickFocusChange: vi.fn(),
    boardPlacement: {},
    onMoveOption: vi.fn(),
    ...overrides,
  };
}

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

describe('WorkspaceViewSwitcher', () => {
  it('renders compact icon-only view controls at narrow width with consumer-facing names', () => {
    render(<WorkspaceViewSwitcher {...buildProps()} />);
    expect(screen.getByTestId('workspace-view-tab-quick_pick')).toHaveAccessibleName('Best Match');
    expect(screen.getByTestId('workspace-view-tab-list')).toHaveAccessibleName('List');
    expect(screen.getByTestId('workspace-view-tab-compare')).toHaveAccessibleName('Compare');
    expect(screen.getByTestId('workspace-view-tab-board')).toHaveAccessibleName('Board');
    expect(screen.getByTestId('workspace-view-tab-quick_pick')).not.toHaveTextContent('Best Match');
  });

  it('places an optional compact toolbar control beside the view controls', () => {
    render(
      <WorkspaceViewSwitcher
        {...buildProps({ toolbarLeading: <button type="button">Filter options</button> })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Filter options' })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders the real OptionCompareView when mode is compare', () => {
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'compare' })} />);
    expect(screen.getByTestId('option-compare-view')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toHaveTextContent(
      'Toyota RAV4',
    );
  });

  it('renders the real QuickPickView when mode is quick_pick', () => {
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'quick_pick' })} />);
    expect(screen.getByTestId('quick-pick-view')).toBeInTheDocument();
    expect(screen.getByTestId('quick-pick-option-label')).toHaveTextContent('Toyota RAV4');
  });

  // Supersedes an earlier test that asserted List and Board rendered an
  // honest "not built yet" placeholder. That placeholder was correct while
  // those components were still being written in parallel -- rendering a
  // fabricated board over real option data would have been the worse
  // failure -- but both now exist and are wired, so the assertion is
  // inverted rather than deleted: the placeholder path must be GONE, and
  // each tab must render its real view over the real options it was given.
  it('renders every one of the four views over real option data, with no placeholder path left', () => {
    const { rerender } = render(<WorkspaceViewSwitcher {...buildProps({ mode: 'list' })} />);
    expect(screen.getByTestId('option-list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-view-gap-list')).not.toBeInTheDocument();

    rerender(<WorkspaceViewSwitcher {...buildProps({ mode: 'board' })} />);
    expect(screen.getByTestId('option-board-view')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-view-gap-board')).not.toBeInTheDocument();

    rerender(<WorkspaceViewSwitcher {...buildProps({ mode: 'quick_pick' })} />);
    expect(screen.getByTestId('quick-pick-view')).toBeInTheDocument();

    rerender(<WorkspaceViewSwitcher {...buildProps({ mode: 'compare' })} />);
    expect(screen.getByTestId('option-compare-view')).toBeInTheDocument();
  });

  it('routes a board move request up to the caller rather than repositioning the card itself', async () => {
    const user = userEvent.setup();
    const onMoveOption = vi.fn();
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'board', onMoveOption })} />);

    const moveControl = screen.getAllByTestId(/board-move-/)[0];
    expect(moveControl).toBeDefined();
    await user.selectOptions(moveControl as HTMLSelectElement, 'top_choices');

    expect(onMoveOption).toHaveBeenCalledWith('candidate-rav4', 'top_choices');
  });

  it('calls onModeChange with the real selected mode when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<WorkspaceViewSwitcher {...buildProps({ onModeChange })} />);

    await user.click(screen.getByTestId('workspace-view-tab-quick_pick'));
    expect(onModeChange).toHaveBeenCalledWith('quick_pick');
  });

  it('routes Quick Pick actions to the supplied handlers', async () => {
    const user = userEvent.setup();
    const onQuickPickKeep = vi.fn();
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'quick_pick', onQuickPickKeep })} />);

    await user.click(screen.getByTestId('quick-pick-keep'));
    expect(onQuickPickKeep).toHaveBeenCalledWith('candidate-rav4');
  });

  it('routes OptionCompareView focus clicks to onFocusOption', async () => {
    const user = userEvent.setup();
    const onFocusOption = vi.fn();
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'compare', onFocusOption })} />);

    await user.click(screen.getByTestId('option-compare-view-focus-candidate-rav4'));
    expect(onFocusOption).toHaveBeenCalledWith('candidate-rav4');
  });

  it('has no axe violations', async () => {
    const { container } = render(<WorkspaceViewSwitcher {...buildProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders at 390px width with no fixed-width overflow risk', () => {
    const { overflowRisks } = renderAtNarrowWidth(<WorkspaceViewSwitcher {...buildProps()} />);
    expect(overflowRisks).toEqual([]);
  });

  // Task B3 (`useWidthMode`, `apps/web/src/hooks/use-width-mode.ts`): Compare
  // is its first real consumer -- narrow width renders the two-option
  // head-to-head layout, wider than the canonical 480px pane renders the
  // full multi-column table (ADR 0005 Decision 4). jsdom has no
  // `window.matchMedia` at all, so the "narrow" case below exercises this
  // hook's own SSR/JSDOM-safe default rather than a stub.
  it('drives OptionCompareView narrow (head-to-head) layout from the real width, defaulting narrow with no matchMedia present', () => {
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'compare' })} />);
    expect(screen.getByTestId('option-compare-view-table')).toHaveAttribute(
      'data-layout',
      'narrow',
    );
  });

  it('drives OptionCompareView expanded (multi-column) layout once the viewport reports wider than the canonical narrow pane', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'compare' })} />);
    expect(screen.getByTestId('option-compare-view-table')).toHaveAttribute(
      'data-layout',
      'expanded',
    );

    vi.unstubAllGlobals();
  });

  // product.md's own tracked gap: "List and Board currently render one
  // layout across both width modes; a genuinely distinct expanded treatment
  // for those two views ... remains open work." These four tests prove this
  // component now threads the same real `widthMode` into `OptionListView`
  // and `OptionBoardView` it already threads into `OptionCompareView` above
  // -- mirroring those two Compare tests exactly, including the "no
  // matchMedia in jsdom defaults to narrow" case.
  it('drives OptionListView layout from the real width, defaulting narrow with no matchMedia present', () => {
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'list' })} />);
    expect(screen.getByTestId('option-list-view-cards')).toHaveAttribute('data-layout', 'narrow');
  });

  it('drives OptionListView expanded layout once the viewport reports wider than the canonical narrow pane', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'list' })} />);
    expect(screen.getByTestId('option-list-view-cards')).toHaveAttribute('data-layout', 'expanded');

    vi.unstubAllGlobals();
  });

  it('drives OptionBoardView layout from the real width, defaulting narrow with no matchMedia present', () => {
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'board' })} />);
    expect(screen.getByTestId('board-columns')).toHaveAttribute('data-layout', 'narrow');
  });

  it('drives OptionBoardView expanded layout once the viewport reports wider than the canonical narrow pane', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'board' })} />);
    expect(screen.getByTestId('board-columns')).toHaveAttribute('data-layout', 'expanded');

    vi.unstubAllGlobals();
  });

  // Defect 1 (§58 WebMCP demo moment): `sift_configure_comparison` persists
  // through the real `setView` command, but nothing upstream of this
  // component ever threaded the persisted configuration into
  // `OptionCompareView` -- the model's reconfiguration silently never
  // reached the page. These three props are this component's own half of
  // that wiring: proof that whatever `App.tsx` reads off the persisted
  // `CaseState.view` genuinely reaches `OptionCompareView`'s narrowing
  // props, not merely that this component *could* accept them.
  it('threads compareOptionIds through to OptionCompareView as the option columns that actually render', () => {
    // Forced to expanded layout: narrow layout's own head-to-head
    // auto-pairing would otherwise hide the third option regardless of
    // whether `compareOptionIds` is wired at all, producing a false pass.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    const options = [
      buildOption(),
      buildOption({ id: 'candidate-crv', label: 'Honda CR-V' }),
      buildOption({ id: 'candidate-forester', label: 'Subaru Forester' }),
    ];
    render(
      <WorkspaceViewSwitcher
        {...buildProps({
          mode: 'compare',
          options,
          compareOptionIds: ['candidate-rav4', 'candidate-crv'],
        })}
      />,
    );

    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
    expect(
      screen.queryByTestId('option-compare-view-header-candidate-forester'),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('threads compareVisibleAttributeIds and comparePinnedAttributeIds through to OptionCompareView', () => {
    const definitions = [
      buildDefinition({ id: 'price', label: 'Price' }),
      buildDefinition({ id: 'mileage', label: 'Mileage' }),
    ];
    render(
      <WorkspaceViewSwitcher
        {...buildProps({
          mode: 'compare',
          attributeDefinitions: definitions,
          compareVisibleAttributeIds: ['mileage'],
          comparePinnedAttributeIds: ['mileage'],
        })}
      />,
    );

    expect(screen.getByTestId('option-compare-view-row-mileage')).toHaveAttribute(
      'data-pinned',
      'true',
    );
    expect(screen.queryByTestId('option-compare-view-row-price')).not.toBeInTheDocument();
  });

  it('renders todays full table unchanged when no compare configuration is supplied (undefined stays undefined, not narrowed to nothing)', () => {
    const options = [buildOption(), buildOption({ id: 'candidate-crv', label: 'Honda CR-V' })];
    render(<WorkspaceViewSwitcher {...buildProps({ mode: 'compare', options })} />);

    expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
    expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
  });

  // The browse grids were refocused onto a headline stat plus a couple of
  // prominent facts, with the rest of an option's detail moved into a
  // per-option profile. Both halves of that wiring pass through this router,
  // so these two tests prove the props genuinely reach the views rather than
  // merely being accepted by the interface.
  it('threads criteria through to the browse grids, where they decide which fact a card leads with', () => {
    const options = [
      buildOption({
        id: 'candidate-rav4',
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
      }),
    ];
    const attributeDefinitions = [
      buildDefinition({ id: 'price', label: 'Price', valueType: 'money' }),
      buildDefinition({ id: 'mileage', label: 'Mileage', valueType: 'number', unit: 'mi' }),
    ];
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

    render(
      <WorkspaceViewSwitcher
        {...buildProps({ mode: 'board', options, attributeDefinitions, criteria })}
      />,
    );

    // Ahead of the money-typed `price` the criterion-free fallback would
    // otherwise have led with.
    expect(screen.getByTestId('board-headline-candidate-rav4')).toHaveTextContent('Mileage');
  });

  it('threads onOpenProfile to both browse grids, and renders no affordance at all when it is absent', () => {
    const onOpenProfile = vi.fn();
    const { rerender } = render(<WorkspaceViewSwitcher {...buildProps({ mode: 'list' })} />);
    expect(screen.queryByTestId('option-card-open-profile-candidate-rav4')).not.toBeInTheDocument();

    rerender(<WorkspaceViewSwitcher {...buildProps({ mode: 'list', onOpenProfile })} />);
    expect(screen.getByTestId('option-card-open-profile-candidate-rav4')).toBeInTheDocument();

    rerender(<WorkspaceViewSwitcher {...buildProps({ mode: 'board', onOpenProfile })} />);
    expect(screen.getByTestId('option-card-open-profile-candidate-rav4')).toBeInTheDocument();
  });

  // Defect 2: confirmed case extensions must reach the Compare table too.
  it('threads caseExtensions through to OptionCompareView so a confirmed custom field renders as a row', () => {
    render(
      <WorkspaceViewSwitcher
        {...buildProps({ mode: 'compare', caseExtensions: [buildCaseExtension()] })}
      />,
    );

    expect(screen.getByTestId('option-compare-view-row-custom.trunk_space')).toBeInTheDocument();
  });
});

/**
 * The scoreboard is routed, not derived.
 *
 * This component stays the thin router it has always been: it takes an
 * already-computed `WorkspaceScoreboard` and forwards it, exactly like
 * `presentation` and `selectedOptionId`. The point of these tests is that it
 * reaches the two browse grids that render a rank and stops there -- Compare
 * and Quick Pick answer different questions and have no rank surface.
 */
describe('WorkspaceViewSwitcher scoreboard routing', () => {
  const SCOREBOARD = buildWorkspaceScoreboard(buildCarCaseState());

  function rankedProps(overrides: Partial<WorkspaceViewSwitcherProps> = {}) {
    return buildProps({
      options: CAR_OPTIONS,
      attributeDefinitions: CAR_DEFINITIONS,
      presentation: CAR_PRESENTATION,
      criteria: CAR_CRITERIA,
      scoreboard: SCOREBOARD,
      ...overrides,
    });
  }

  it('forwards the scoreboard to the List view', () => {
    render(<WorkspaceViewSwitcher {...rankedProps({ mode: 'list' })} />);
    expect(screen.getByTestId('option-rank-position-candidate-crv')).toHaveTextContent('#1 of 3');
  });

  it('forwards the scoreboard to the Board view', () => {
    render(<WorkspaceViewSwitcher {...rankedProps({ mode: 'board' })} />);
    expect(screen.getByTestId('option-rank-position-candidate-crv')).toHaveTextContent('#1 of 3');
  });

  it('renders both grids unchanged when no scoreboard is supplied', () => {
    render(<WorkspaceViewSwitcher {...rankedProps({ mode: 'list', scoreboard: undefined })} />);
    expect(screen.getByTestId('option-list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('option-rank-candidate-crv')).toBeNull();
  });
});

describe('"Best Match" shows the best match', () => {
  // The tab is labelled "Best Match" and the card is headed "Best Match".
  // Until the deterministic scoreboard existed, the queue walked the case's
  // insertion order, so that label described nothing. It became an active
  // contradiction the moment `CaseInsightsPanel` began stating which option
  // scores highest directly above a card showing a different one.
  const scoreboard = buildWorkspaceScoreboard(buildCarCaseState());

  function quickPickProps(options: EntityRecord[]) {
    return buildProps({
      mode: 'quick_pick',
      options,
      attributeDefinitions: CAR_DEFINITIONS,
      criteria: CAR_CRITERIA,
      presentation: CAR_PRESENTATION,
      scoreboard,
    });
  }

  it('starts the queue at the option the board actually ranks first', () => {
    const leaderLabel = scoreboard.board.options[0]?.optionLabel;
    expect(leaderLabel).toBeDefined();
    if (leaderLabel === undefined) return;

    // Deliberately fed in an order that puts the leader last, so passing
    // could not be an accident of the fixture's own ordering.
    const reversed = [...CAR_OPTIONS].reverse();
    render(<WorkspaceViewSwitcher {...quickPickProps(reversed)} />);

    expect(screen.getByRole('heading', { name: leaderLabel })).toBeInTheDocument();
  });

  it('leaves the caller’s order alone when there is no board to rank by', () => {
    const reversed = [...CAR_OPTIONS].reverse();
    const firstLabel = reversed[0]?.label;
    expect(firstLabel).toBeDefined();
    if (firstLabel === undefined) return;
    render(
      <WorkspaceViewSwitcher
        {...buildProps({
          mode: 'quick_pick',
          options: reversed,
          attributeDefinitions: CAR_DEFINITIONS,
          criteria: CAR_CRITERIA,
          presentation: CAR_PRESENTATION,
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: firstLabel })).toBeInTheDocument();
  });
});

describe('Quick Pick judgments reach the command layer', () => {
  it('reports Keep, Pass, Unsure, and undo as four distinct judgments', async () => {
    // The proof that the pane-to-conversation half of the loop is real: a
    // Quick Pick action has to leave the component as a specific judgment
    // about a specific candidate, not as an anonymous "advance".
    const user = userEvent.setup();
    const onQuickPickKeep = vi.fn();
    const onQuickPickPass = vi.fn();
    const onQuickPickUnsure = vi.fn();
    const onQuickPickUndo = vi.fn();

    const { rerender } = render(
      <WorkspaceViewSwitcher
        {...buildProps({
          mode: 'quick_pick',
          onQuickPickKeep,
          onQuickPickPass,
          onQuickPickUnsure,
          onQuickPickUndo,
        })}
      />,
    );

    await user.click(screen.getByTestId('quick-pick-keep'));
    expect(onQuickPickKeep).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('quick-pick-pass'));
    expect(onQuickPickPass).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('quick-pick-unsure'));
    expect(onQuickPickUnsure).toHaveBeenCalledTimes(1);

    const keptId = onQuickPickKeep.mock.calls[0]?.[0] as string;
    rerender(
      <WorkspaceViewSwitcher
        {...buildProps({
          mode: 'quick_pick',
          quickPickDispositions: { [keptId]: 'keep' },
          onQuickPickKeep,
          onQuickPickPass,
          onQuickPickUnsure,
          onQuickPickUndo,
        })}
      />,
    );

    await user.click(screen.getByTestId('quick-pick-undo'));
    expect(onQuickPickUndo).toHaveBeenCalledWith(keptId);
  });
});
