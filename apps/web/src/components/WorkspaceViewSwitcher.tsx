/**
 * The primary workspace view switcher (`docs/decisions/
 * 0004-consumer-workspace-information-architecture.md`, decision item 5;
 * `docs/change-sets/2026-08-30-generic-decision-workspace.md` §6's "Primary
 * workspace view switcher -- e.g. Quick Pick / List / Compare / Board" and
 * §8's "These are not cosmetic renderings of identical information -- each
 * solves a different decision task"). This is the region that dominates the
 * page below the answer-first hero, replacing the old "Compare the
 * options" disclosure row's unconditional `OptionComparison` table -- ADR
 * 0005 ("Workspace View State and Option Views") names that component's
 * defect directly: no prop, piece of local state, or hook anywhere in it
 * could narrow which options or attributes render.
 *
 * All four generic views change-set §8 names now exist as separate,
 * prop-driven, purely presentational components per ADR 0005's own
 * component-architecture decision -- `QuickPickView`, `OptionListView`,
 * `OptionCompareView`, and `OptionBoardView`. This component's only job is
 * to own the tab affordance and route real snapshot data into whichever one
 * is selected; it holds no option state of its own.
 *
 * List and Board were briefly rendered here as honest "not built yet"
 * placeholders while their components were still being written in parallel,
 * deliberately rather than stubbing fabricated views over real option data.
 * Both are now wired to the real components and that placeholder path is
 * gone -- there is no remaining branch that can render a view Sift cannot
 * actually populate.
 *
 * `mode` is deliberately caller-owned state, not local `useState` here: ADR
 * 0005 decision 1 designed `WorkspaceViewState.mode` to persist through
 * `CaseState` via the `SelectionPatch`/`updateSelection()` escape hatch so
 * the browser and a WebMCP-driven ChatGPT session can share the same view
 * (change-set §13, §30). No `sift_set_view` command exists yet in this
 * codebase to actually write that field (only `sift_focus_option` is wired
 * today -- confirmed by reading `apps/web/src/model-context/
 * register-sift-tools.ts` and `apps/agent/src/services/command-service.ts`
 * directly), so `App.tsx` currently supplies `mode` from plain session-local
 * `useState` rather than a real server round-trip. This component's own
 * contract does not assume that: it takes `mode`/`onModeChange` as props so
 * a future caller can swap the source of truth to the real persisted
 * `WorkspaceViewState.mode` without this component changing at all.
 *
 * `layout`, by contrast, IS decided locally here via `useWidthMode` (Phase
 * B3, `apps/web/src/hooks/use-width-mode.ts`) rather than threaded through
 * as a prop from further up the tree: it is a real-time viewport fact, not
 * case/session state anything needs to persist or share with a WebMCP
 * caller (ADR 0005 Decision 4's "narrow and expanded modes are two
 * intentional information architectures" is about what a given width
 * *renders*, not something ChatGPT would ever set on the user's behalf).
 * `OptionCompareView` was this hook's first real consumer -- previously
 * `layout="narrow"` was hard-coded here, which is exactly the gap ADR 0005
 * Decision 4 named ("no existing component or hook ... provides a starting
 * point for the width-detection mechanism itself"). `OptionListView` and
 * `OptionBoardView` now receive the same resolved `widthMode` the identical
 * way (product.md's own tracked gap: "List and Board currently render one
 * layout across both width modes; a genuinely distinct expanded treatment
 * for those two views ... remains open work" -- this closes exactly that).
 * All three views stay pure, caller-fed leaves; only this component ever
 * calls `useWidthMode`.
 *
 * `criteria`/`onOpenProfile`: the two browse grids (`OptionListView`,
 * `OptionBoardView`) were refocused onto a headline stat plus a couple of
 * prominent facts, with the rest of an option's detail moved into a per-option
 * profile. Both inputs of that change route through here for the same reason
 * everything else does -- the views stay pure leaves. `criteria` is read only
 * as a ranking signal for which attributes a card leads with (the heaviest
 * `Criterion.appliesToAttribute` weight, when a pack declares no
 * `presentation.prominentAttributeIds`); nothing downstream mutates a
 * `Criterion` or appends a `CaseEvent`. `onOpenProfile` stays optional the
 * whole way down so a caller with no profile surface wired renders no dead
 * "View details" control.
 *
 * `compareOptionIds`/`compareVisibleAttributeIds`/`comparePinnedAttributeIds`/
 * `caseExtensions` (Defect 1 & 2 seam fix): `OptionCompareView` already
 * genuinely implements `visibleOptionIds`/`visibleAttributeIds`/
 * `pinnedAttributeIds`/`caseExtensions` as real props, and
 * `sift_configure_comparison`/`sift_set_view` already genuinely persist
 * `CaseState.view` through the real `setView` command -- but until this
 * fix nothing here forwarded the persisted values, so a model-driven
 * `sift_configure_comparison` call reported success while the page never
 * moved (§58's own named demo moment). This component stays the thin
 * router it already was: it takes the already-resolved values as props
 * (from `App.tsx`, which reads `snapshot.view`) and forwards them,
 * exactly like `selectedOptionId`/`presentation` above.
 *
 * `WorkspaceViewState.compare.optionIds` and the top-level
 * `visibleOptionIds` overlap in intent (both narrow which options are
 * visible), so `compareOptionIds` here is deliberately fed from
 * `compare.optionIds`, not the top-level field. Two independent sources
 * point at the same conclusion: `sift_configure_comparison` -- the tool
 * whose description is literally "Configures the Compare view: which
 * options are shown side by side" and the one §58's demo moment names --
 * writes exactly `compare.optionIds` (`register-sift-tools.ts`
 * `buildConfigureComparisonTool`); and ADR 0005's own "Consequences"
 * section states the Compare component's rendering must be "driven by
 * `WorkspaceViewState.compare.optionIds`, `visibleAttributeIds`,
 * `pinnedAttributeIds`, `sort`, and `filters`" (0005-workspace-view-state-
 * and-option-views.md, Consequences, third bullet) -- notably naming
 * `compare.optionIds`, not the top-level `visibleOptionIds`, for this
 * exact purpose. The top-level `visibleOptionIds` field (written by the
 * more generic `sift_set_view`) has since been claimed, and deliberately
 * NOT here: `App.tsx` applies it upstream, composing it with the person's
 * own `filters` before handing this component the already-narrowed
 * `options` array. That placement is what makes it a genuinely
 * cross-view narrowing (List, Board, and Quick Pick all honour it without
 * each re-implementing it) and what lets `FilterBar` state both reasons the
 * list is short in one place. This component still does not read the field,
 * and stays the thin router it was.
 * `visibleAttributeIds`/`pinnedAttributeIds` are NOT namespaced under
 * `compare` in the schema (`WorkspaceViewStateSchema`,
 * `packages/contracts/src/case.ts`) -- ADR 0005 calls them "the outer
 * `visibleAttributeIds`/`pinnedAttributeIds`" for exactly this reason --
 * so `compareVisibleAttributeIds`/`comparePinnedAttributeIds` read the
 * top-level fields directly, unlike `compareOptionIds`.
 */
import { useMemo, type ReactNode } from 'react';
import { BadgeCheckIcon, Columns3Icon, LayoutGridIcon, ListIcon } from 'lucide-react';
import {
  WORKSPACE_VIEW_MODES,
  type WorkspaceViewMode,
  type CandidateDisposition,
} from '@sift/contracts';
import type {
  AttributeDefinition,
  CaseExtension,
  Criterion,
  EntityRecord,
  PresentationDefinition,
} from '@sift/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QuickPickView } from './QuickPickView.js';
import { OptionCompareView } from './OptionCompareView.js';
import { OptionListView } from './OptionListView.js';
import { OptionBoardView } from './OptionBoardView.js';
import { useWidthMode } from '../hooks/use-width-mode.js';
import type { WorkspaceScoreboard } from './case-scoreboard.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface WorkspaceViewSwitcherProps {
  mode: WorkspaceViewMode;
  onModeChange: (mode: WorkspaceViewMode) => void;
  options: EntityRecord[];
  attributeDefinitions: AttributeDefinition[];
  /** Confirmed case-level custom concerns (`CaseState.caseExtensions`) -- forwarded to `OptionCompareView` so a confirmed custom field renders as a real comparison row (Defect 2). See this file's header comment. */
  caseExtensions: CaseExtension[];
  presentation: PresentationDefinition | null;
  /** The case's criteria (`CaseState.criteria`). Forwarded to the two browse grids, whose cards rank which attributes to lead with by the heaviest `Criterion.appliesToAttribute` weight when the pack declares no `presentation.prominentAttributeIds` (see `option-profile.ts`'s `pickCardAttributeIds`). This component neither reads nor mutates them itself -- it is still a router. */
  criteria: Criterion[];
  selectedOptionId: string | null;
  /**
   * The case's deterministic scoreboard (`buildWorkspaceScoreboard`),
   * forwarded to the two browse grids that render a rank.
   *
   * Routed, never derived -- this component stays the thin router it has
   * always been, exactly as it does for `presentation` and
   * `compareOptionIds`. It deliberately does NOT reach `OptionCompareView` or
   * `QuickPickView`: ADR 0005 Decision 2's point is that the four views are
   * four different decision tasks, and neither of those two answers "where
   * does this rank" (Compare answers "how do these differ", Quick Pick
   * answers "keep or pass"). Adding a rank to them would be the cosmetic
   * sameness that ADR argues against.
   */
  scoreboard?: WorkspaceScoreboard | undefined;
  /** `null` clears the focused option -- forwarded straight through to whichever of the three option views (List/Board/Compare) rendered the click; see `OptionListView.tsx`'s `onFocusOption` doc comment for the toggle contract each view implements. */
  onFocusOption: (optionId: string | null) => void;
  /** Opens the full per-option profile for one option. Optional the whole way down: a caller with no profile surface wired yet gets cards with no dead "View details" control on them. */
  onOpenProfile?: ((optionId: string) => void) | undefined;

  // Compare view configuration (Defect 1 seam fix) -- see this file's own
  // header comment for the `compare.optionIds` vs. top-level
  // `visibleOptionIds` decision. `undefined` (the caller's own default when
  // a case has never set `CaseState.view` at all) reaches `OptionCompareView`
  // unchanged, which already renders its own full, unnarrowed table for
  // `undefined` -- so an unconfigured case looks exactly as it did before
  // this fix.
  compareOptionIds?: string[] | undefined;
  compareVisibleAttributeIds?: string[] | undefined;
  comparePinnedAttributeIds?: string[] | undefined;

  // Quick Pick's own triage queue position -- see this file's header
  // comment on why this is caller state, not local state here.
  quickPickPosition: number;
  /** Canonical Quick Pick judgments, keyed by option id -- read from case state so a reload lands on the same picture. */
  quickPickDispositions: Record<string, CandidateDisposition>;
  onQuickPickKeep: (optionId: string) => void;
  onQuickPickPass: (optionId: string) => void;
  onQuickPickUnsure: (optionId: string) => void;
  onQuickPickUndo: (optionId: string) => void;
  onQuickPickFocusChange: (optionId: string) => void;

  // Board placement, held by the caller for the same reason `mode` is: it
  // belongs in the persisted `WorkspaceViewState.board` once a command
  // exists to write it, and this component should not have to change when
  // that source of truth swaps. Board placement is deliberately NOT derived
  // from case state -- where an option sits is the user's working
  // arrangement, not a decision the engine has made about it (change-set
  // §12).
  boardPlacement: Record<string, string>;
  onMoveOption: (optionId: string, toColumnId: string) => void;
  /** Optional compact control placed before the view selector in the narrow review toolbar. */
  toolbarLeading?: ReactNode;
}

// `quick_pick`'s visible tab label is "Best Match" -- Cars.com's own sort-order label for its
// default-ranked results (see shopping-ux-research.md row 1) -- even though the `mode` value and
// every `data-testid` stay the internal `quick_pick` identifier; only the rendered copy changed.
const VIEW_TAB_LABEL: Record<WorkspaceViewMode, string> = {
  quick_pick: 'Best Match',
  list: 'List',
  compare: 'Compare',
  board: 'Board',
};

const VIEW_TAB_ICON: Record<WorkspaceViewMode, React.ComponentType<{ className?: string }>> = {
  quick_pick: BadgeCheckIcon,
  list: ListIcon,
  compare: Columns3Icon,
  board: LayoutGridIcon,
};

/**
 * Quick Pick's tab is labelled **"Best Match"**, and until the deterministic
 * scoreboard existed that label described nothing: the queue walked the
 * case's own insertion order, so "Best Match — 1 of 4" showed whichever
 * option happened to be added first.
 *
 * That was survivable while nothing else on the page ranked anything. It
 * stopped being survivable the moment `CaseInsightsPanel` began saying "the
 * Outback scores highest against what you said matters" directly above a
 * card headed "Best Match" showing the RAV4 — the workspace contradicting
 * itself about the one question it exists to answer, which is precisely the
 * drift ADR 0012 argues against.
 *
 * So the queue is ordered by the board when there is one. Options the board
 * could not rank keep their relative order and go last: an unscored option
 * is not worse, it is unmeasured (scoring rule 1), and it still belongs in
 * a triage queue whose whole purpose is deciding what to look at next.
 *
 * Falls back to the caller's order verbatim when no scoreboard is supplied
 * or nothing is rankable, so an unranked case behaves exactly as it did.
 */
function orderByRank(
  options: EntityRecord[],
  scoreboard: WorkspaceScoreboard | undefined,
): EntityRecord[] {
  if (scoreboard?.isRankable !== true) return options;
  const rank = scoreboard.rankByOptionId;
  return [...options].sort((a, b) => {
    const rankA = rank.get(a.id);
    const rankB = rank.get(b.id);
    if (rankA === undefined && rankB === undefined) return 0;
    if (rankA === undefined) return 1;
    if (rankB === undefined) return -1;
    return rankA - rankB;
  });
}

export function WorkspaceViewSwitcher({
  mode,
  onModeChange,
  options,
  attributeDefinitions,
  caseExtensions,
  presentation,
  criteria,
  selectedOptionId,
  scoreboard,
  onFocusOption,
  onOpenProfile,
  compareOptionIds,
  compareVisibleAttributeIds,
  comparePinnedAttributeIds,
  quickPickPosition,
  quickPickDispositions,
  onQuickPickKeep,
  onQuickPickPass,
  onQuickPickUnsure,
  onQuickPickUndo,
  onQuickPickFocusChange,
  boardPlacement,
  onMoveOption,
  toolbarLeading,
}: WorkspaceViewSwitcherProps) {
  const rankedForQuickPick = useMemo(() => orderByRank(options, scoreboard), [options, scoreboard]);

  const widthMode = useWidthMode();

  return (
    <section
      data-testid="workspace-view-switcher"
      aria-label="Workspace view"
      className="flex flex-col gap-[var(--space-2)]"
    >
      <Tabs
        value={mode}
        onValueChange={(value) => {
          onModeChange(value as WorkspaceViewMode);
        }}
      >
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          {toolbarLeading}
          <TabsList aria-label="Choose how to view your options">
            {WORKSPACE_VIEW_MODES.map((viewMode) => {
              const Icon = VIEW_TAB_ICON[viewMode];
              const trigger = (
                <TabsTrigger
                  key={viewMode}
                  data-testid={`workspace-view-tab-${viewMode}`}
                  value={viewMode}
                  aria-label={widthMode === 'narrow' ? VIEW_TAB_LABEL[viewMode] : undefined}
                  className={
                    widthMode === 'narrow'
                      ? 'min-h-[var(--size-touch-target-min)] min-w-[var(--size-touch-target-min)] p-0'
                      : undefined
                  }
                >
                  {widthMode === 'narrow' ? (
                    <Icon aria-hidden="true" className="size-4" />
                  ) : (
                    VIEW_TAB_LABEL[viewMode]
                  )}
                </TabsTrigger>
              );
              return widthMode === 'narrow' ? (
                <Tooltip key={viewMode}>
                  <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                  <TooltipContent>{VIEW_TAB_LABEL[viewMode]}</TooltipContent>
                </Tooltip>
              ) : (
                trigger
              );
            })}
          </TabsList>
        </div>

        <TabsContent data-testid="workspace-view-content-quick_pick" value="quick_pick">
          <QuickPickView
            options={rankedForQuickPick}
            attributeDefinitions={attributeDefinitions}
            position={quickPickPosition}
            dispositions={quickPickDispositions}
            onKeep={onQuickPickKeep}
            onPass={onQuickPickPass}
            onUnsure={onQuickPickUnsure}
            onUndo={onQuickPickUndo}
            layout={widthMode}
            onFocusChange={onQuickPickFocusChange}
          />
        </TabsContent>

        <TabsContent data-testid="workspace-view-content-compare" value="compare">
          <OptionCompareView
            options={options}
            attributeDefinitions={attributeDefinitions}
            caseExtensions={caseExtensions}
            presentation={presentation}
            selectedOptionId={selectedOptionId}
            visibleOptionIds={compareOptionIds}
            visibleAttributeIds={compareVisibleAttributeIds}
            pinnedAttributeIds={comparePinnedAttributeIds}
            layout={widthMode}
            onFocusOption={onFocusOption}
          />
        </TabsContent>

        <TabsContent data-testid="workspace-view-content-list" value="list">
          <OptionListView
            options={options}
            attributeDefinitions={attributeDefinitions}
            presentation={presentation}
            criteria={criteria}
            selectedOptionId={selectedOptionId}
            scoreboard={scoreboard}
            layout={widthMode}
            onFocusOption={onFocusOption}
            onOpenProfile={onOpenProfile}
          />
        </TabsContent>

        <TabsContent data-testid="workspace-view-content-board" value="board">
          <OptionBoardView
            options={options}
            attributeDefinitions={attributeDefinitions}
            presentation={presentation}
            criteria={criteria}
            optionColumnIds={boardPlacement}
            selectedOptionId={selectedOptionId}
            scoreboard={scoreboard}
            layout={widthMode}
            onMoveOption={onMoveOption}
            onFocusOption={onFocusOption}
            onOpenProfile={onOpenProfile}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
