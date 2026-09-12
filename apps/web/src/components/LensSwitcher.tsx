/**
 * The lens switcher: which FACTS the current view draws.
 *
 * A lens is a pack-declared, named subset of that pack's own attributes
 * (`PackLensSchema`, packages/contracts/src/packs.ts). It composes with
 * `WorkspaceViewSwitcher` rather than competing with it: that control picks
 * the SHAPE the options are drawn in -- Quick Pick, List, Compare, Board --
 * and this one picks which of their fields are drawn. Any lens applies to
 * any view, which is precisely why they are two controls and not one.
 *
 * Purely presentational and entirely caller-owned, for the same reason
 * `WorkspaceViewSwitcher`'s `mode` is: selecting a lens writes
 * `visibleAttributeIds` on `WorkspaceViewState`, which persists through
 * `CaseStore.updateSelection()` and therefore structurally cannot advance
 * `eventSequence` or invalidate a recommendation (ADR 0005). This component
 * holds no state of its own and issues no commands -- it reports a chosen
 * lens id and lets `App.tsx` route it through the existing `setView` path,
 * the same one `sift_set_view` already uses. Nothing here can hide a fact
 * from the scoring engine: `scoreCaseState` never reads this field.
 *
 * "All fields" is a real, selectable member of the list rather than a
 * separate reset control, because clearing a lens is the same kind of act as
 * choosing one and should cost the same single tap. It maps to `null`, which
 * `App.tsx` turns into an absent `visibleAttributeIds` -- the state a case
 * has before anyone picks a lens, so choosing it genuinely restores the
 * original view rather than approximating it with an every-attribute list.
 */
import type { PackLens } from '@sift/contracts';
import { Button } from '@/components/ui/button';

export interface LensSwitcherProps {
  /** The lenses this case's pack declares, in the author's own order. Render nothing when empty. */
  readonly lenses: readonly PackLens[];
  /** The selected lens id, or `null` for "All fields". */
  readonly activeLensId: string | null;
  /** Fired with the chosen lens id, or `null` when "All fields" is chosen. */
  readonly onLensChange: (lensId: string | null) => void;
}

const ALL_FIELDS_LABEL = 'All fields';

export function LensSwitcher({
  lenses,
  activeLensId,
  onLensChange,
}: LensSwitcherProps): React.JSX.Element | null {
  // A pack with no lenses gets no control at all, rather than a control with
  // one inert option in it. Lenses are optional on the manifest precisely so
  // a pack that has nothing useful to group can decline to pretend otherwise.
  if (lenses.length === 0) return null;

  const active = lenses.find((lens) => lens.id === activeLensId) ?? null;

  return (
    <div
      data-testid="lens-switcher"
      role="group"
      aria-label="Which details to show"
      className="flex flex-col gap-[var(--space-1)]"
    >
      <div className="flex flex-wrap gap-[var(--space-1)]">
        <Button
          type="button"
          data-testid="lens-switcher-option-all"
          variant={activeLensId === null ? 'secondary' : 'ghost'}
          aria-pressed={activeLensId === null}
          onClick={() => onLensChange(null)}
          size="sm"
        >
          {ALL_FIELDS_LABEL}
        </Button>
        {lenses.map((lens) => (
          <Button
            key={lens.id}
            type="button"
            data-testid={`lens-switcher-option-${lens.id}`}
            variant={lens.id === activeLensId ? 'secondary' : 'ghost'}
            aria-pressed={lens.id === activeLensId}
            onClick={() => onLensChange(lens.id)}
            size="sm"
          >
            {lens.label}
          </Button>
        ))}
      </div>
      {/*
        The author's own sentence for the selected lens, shown rather than
        hidden behind a tooltip: on a touch pane there is no hover, and
        "Credentials & risk" alone does not tell a person which fields just
        stopped being visible. `aria-live` is deliberately absent -- the
        person caused this change by pressing a button whose pressed state
        already announces, so re-reading the description would be noise.
      */}
      {active !== null ? (
        <p
          data-testid="lens-switcher-description"
          className="text-[length:var(--font-size-xs)] text-[var(--color-ink-secondary)]"
        >
          {active.description}
        </p>
      ) : null}
    </div>
  );
}
