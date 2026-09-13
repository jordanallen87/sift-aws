/**
 * Region 6, "Recommendation and approval" (docs/specs/product.md "Workspace
 * layout") -- the recommendation half only; the approve/revise/reject
 * controls live in `ApprovalCard.tsx` (a `Recommendation` and a
 * `DecisionProposal` are distinct canonical objects, architecture.md
 * "Security and authority": "A recommendation and an approved decision are
 * distinct states").
 *
 * Renders a real `Recommendation` (packages/contracts/src/case.ts). Facts
 * and hypotheses are rendered as two visually distinct lists (never merged
 * into one undifferentiated bullet list) -- this is the UI half of
 * value-proposition.md's capability-boundary claim, "Typed claims linked to
 * durable sources" and "separation of fact and hypothesis" (GoalLoop
 * validator, strands-runtime.md). Per global constraint 4 ("never render
 * what cannot be true") and change-set DoD item 35 ("Empty conceptual
 * regions are not rendered unnecessarily"), the FACTS and HYPOTHESES blocks
 * are each omitted entirely -- not rendered as an empty tinted callout --
 * when `recommendation.facts`/`recommendation.hypotheses` is empty. A
 * present-but-empty HYPOTHESES block is especially misleading: its
 * "accepted uncertainty" tint reads as an active warning even though
 * nothing is actually open.
 *
 * This component owns no top-level heading of its own: it is only ever
 * mounted inside `RecommendationHero`, whose own `<h2>` headline already
 * reads "Current recommendation" for every state this card renders content
 * in (see workspace-status.ts). A second, identical "Current recommendation"
 * `<h2>` here duplicated that headline directly above it -- see ADR 0004,
 * whose entire point was merging the answer and its next action into ONE
 * region precisely so "it cannot disagree with itself because it is one
 * region, not two."
 *
 * The `withheld` prop drives the exact required copy from
 * docs/specs/value-proposition.md's "Required visible copy":
 *
 *   Draft withheld
 *   This answer is plausible, but 3 required questions are still unresolved.
 *   Sift is continuing the investigation before asking you to decide.
 *
 * This is a distinct state from a plain "no recommendation yet" empty
 * state: `withheld` means a draft was actually produced and rejected by
 * GoalLoop/readiness validation (draft.withheld PublicActivityEvent),
 * whereas a bare empty state means no attempt has happened yet.
 */
import type { Recommendation, Source } from '@sift/contracts';
import { Badge } from '@/components/ui/badge';
import { STATUS_TONE_META, type StatusTone } from './activity-labels.js';
import type { SettledDecision } from './workspace-status.js';

export interface RecommendationWithheld {
  /** Count of required questions still unresolved -- substituted into the exact required copy. */
  unresolvedRequiredCount: number;
}

export interface RecommendationCardProps {
  /** `null` when no recommendation has been produced and accepted yet. */
  recommendation: Recommendation | null;
  /** Present exactly when the most recent draft was withheld by validation -- see the file header for the exact required copy this drives. */
  withheld?: RecommendationWithheld | null;
  loading?: boolean;
  /** Optional joined `Source` records for `recommendation.sourceIds`, keyed by id, for a richer citation link. Falls back to a plain reference chip when a source is not supplied. */
  sources?: Record<string, Source>;
  /**
   * The verdict a human has already rendered on this recommendation's
   * proposal, or `null` while none has been (`WorkspaceStatus.settledDecision`,
   * supplied by `RecommendationHero`). Drives the status chip -- see
   * `SETTLED_STATUS_META` below for why the chip cannot be read off
   * `recommendation.status` alone.
   */
  settledDecision?: SettledDecision | null;
}

const RECOMMENDATION_STATUS_META: Record<
  Recommendation['status'],
  { label: string; tone: StatusTone }
> = {
  ready: { label: 'Ready for review', tone: 'ready' },
  // NOT "Stale — recomputing". Invalidation starts no work: `updateCriteria`
  // (apps/agent/src/services/command-service.ts) appends
  // `recommendation.invalidated` and calls `notifyRunPlan` ->
  // `RunPlanService.revisePlan` (apps/agent/src/services/run-plan-service.ts),
  // which re-derives and persists a plan and emits `plan.revised` -- it
  // launches no engine run. Nothing is recomputed until a human or a tool
  // calls `requestInvestigation`. The chip says what is true and what is
  // owed: the answer is stale, and a fresh investigation is what would
  // refresh it. "Investigation" is the product's own word for that work
  // ("Request investigation", "Sift is investigating.", workspace-status.ts).
  stale: { label: 'Stale — needs investigation', tone: 'stale' },
};

/**
 * What the status chip says once a human has answered, which outranks
 * `RECOMMENDATION_STATUS_META` above.
 *
 * `Recommendation.status` is a fact about the recommendation object and
 * stays `'ready'` after the decision is made, so a chip derived from it
 * alone went on announcing "READY FOR REVIEW" -- a claim that a person
 * still has to act -- underneath a "Decided." headline on a closed case
 * (release baseline `decided-chatgpt-pane-640-darwin.png`). Same class of
 * defect as the action dock offering "Confirm what moves forward" on a
 * decided case (`deriveNextMoves`, packages/core/src/discovery.ts): state
 * the case has left, still rendered as if current.
 *
 * The labels are deliberately pack-neutral. This card is the one
 * recommendation surface both hero Decision Packs mount through
 * `RecommendationHero` (Choose Our Next Car and Home Energy Guardian), and
 * it is handed no option label, so every word here has to be true of a car
 * and of an HVAC response option alike.
 *
 * Tones follow docs/design-system.md's own reading of the tokens.
 * `approved` is the only outcome that closes the case
 * (`reviewProposal`/`reducer` move `CaseState.status` to `'decided'` on
 * approval and on nothing else), and `decided` is precisely "the case is
 * closed"; `rejected` and `revision_requested` leave the case open, and
 * reuse the two tones that design-system.md already assigns them in this
 * region. The chip is not a second copy of `ApprovalCard`'s settled stamp
 * ("Approved" / "Rejected" / "Revision requested"): it answers "where is
 * this case", the stamp answers "what did the human do", and "Decided"
 * against "Approved" is the one place that distinction is visible.
 */
const SETTLED_STATUS_META: Record<SettledDecision, { label: string; tone: StatusTone }> = {
  approved: { label: 'Decided', tone: 'decided' },
  rejected: { label: 'Not chosen', tone: 'error' },
  revision_requested: { label: 'Revision requested', tone: 'accepted-uncertainty' },
};

function pluralQuestion(count: number): string {
  return count === 1 ? 'question' : 'questions';
}

function pluralIsAre(count: number): string {
  return count === 1 ? 'is' : 'are';
}

export function RecommendationCard({
  recommendation,
  withheld = null,
  loading = false,
  sources = {},
  settledDecision = null,
}: RecommendationCardProps) {
  return (
    <section
      data-testid="recommendation-card"
      className="flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-card p-[var(--space-4)]"
    >
      {recommendation === null ? (
        loading ? (
          <div
            data-testid="recommendation-card-loading"
            aria-busy="true"
            aria-live="polite"
            className="flex flex-col gap-[var(--space-2)]"
          >
            <div className="h-[var(--space-10)] animate-pulse rounded-[var(--radius-md)] bg-muted" />
            <span className="visually-hidden">Loading recommendation…</span>
          </div>
        ) : withheld ? (
          <div
            data-testid="recommendation-card-withheld"
            role="status"
            className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] p-[var(--space-3)]"
            style={{ backgroundColor: STATUS_TONE_META.blocked.bg }}
          >
            <p className="label-caps" style={{ color: STATUS_TONE_META.blocked.ink }}>
              Draft withheld
            </p>
            <p style={{ color: STATUS_TONE_META.blocked.ink }}>
              {`This answer is plausible, but ${withheld.unresolvedRequiredCount} required ${pluralQuestion(
                withheld.unresolvedRequiredCount,
              )} ${pluralIsAre(withheld.unresolvedRequiredCount)} still unresolved.`}
            </p>
            <p style={{ color: STATUS_TONE_META.blocked.ink }}>
              Sift is continuing the investigation before asking you to decide.
            </p>
          </div>
        ) : (
          <p
            data-testid="recommendation-card-empty"
            className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
          >
            No recommendation yet. Sift will propose one once enough evidence is gathered.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-[var(--space-3)]">
          {(() => {
            // A rendered verdict outranks the recommendation's own status,
            // including `stale`: once the human has answered, the chip's
            // job is to say so. A stale recommendation on a settled case
            // still renders its own explanatory note below, which is about
            // the content of the answer rather than about who owes whom an
            // action.
            const statusMeta =
              settledDecision === null
                ? RECOMMENDATION_STATUS_META[recommendation.status]
                : SETTLED_STATUS_META[settledDecision];
            return (
              <Badge
                // Remounts (replaying `.status-change-enter`) whenever the
                // chip's meaning changes -- the recommendation's own status
                // flipping between `ready` and `stale`, or the human
                // rendering a verdict -- a moment worth a beat of visible
                // emphasis.
                key={settledDecision ?? recommendation.status}
                data-testid="recommendation-card-status"
                className="status-change-enter label-caps w-fit gap-[var(--space-1)] rounded-[var(--radius-pill)] px-[var(--space-2)] py-[var(--space-0-5)]"
                style={{
                  color: STATUS_TONE_META[statusMeta.tone].ink,
                  backgroundColor: STATUS_TONE_META[statusMeta.tone].bg,
                }}
              >
                <span aria-hidden="true">{STATUS_TONE_META[statusMeta.tone].icon}</span>
                {statusMeta.label}
              </Badge>
            );
          })()}

          {recommendation.status === 'stale' ? (
            <p
              data-testid="recommendation-card-stale-note"
              className="list-item-enter text-[length:var(--font-size-sm)]"
              style={{ color: STATUS_TONE_META.stale.ink }}
            >
              New evidence or a criteria change has invalidated this recommendation. Sift has not
              looked into the change yet, so the content below may no longer reflect the current
              case.
            </p>
          ) : null}

          {/* The rationale is real running prose, so it takes a reading
              measure rather than the full shell width. Inert at narrow
              width; at 1280px it is the difference between a readable
              paragraph and a ~150-character line. */}
          <p
            data-testid="recommendation-card-rationale"
            className="reading-measure text-[length:var(--font-size-base)] text-[var(--color-ink)]"
          >
            {recommendation.rationale}
          </p>

          {recommendation.facts.length > 0 || recommendation.hypotheses.length > 0 ? (
            <div className="flex flex-col gap-[var(--space-2)]">
              {recommendation.facts.length > 0 ? (
                <div
                  data-testid="recommendation-card-facts"
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] p-[var(--space-2)]"
                  style={{ backgroundColor: STATUS_TONE_META.satisfied.bg }}
                >
                  <h3 className="label-caps" style={{ color: STATUS_TONE_META.satisfied.ink }}>
                    Facts
                  </h3>
                  <ul className="flex flex-col gap-[var(--space-0-5)]">
                    {recommendation.facts.map((fact) => (
                      <li
                        key={fact}
                        className="text-[length:var(--font-size-sm)] text-[var(--color-ink)]"
                      >
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {recommendation.hypotheses.length > 0 ? (
                <div
                  data-testid="recommendation-card-hypotheses"
                  className="flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] p-[var(--space-2)]"
                  style={{ backgroundColor: STATUS_TONE_META['accepted-uncertainty'].bg }}
                >
                  <h3
                    className="label-caps"
                    style={{ color: STATUS_TONE_META['accepted-uncertainty'].ink }}
                  >
                    Hypotheses
                  </h3>
                  <ul className="flex flex-col gap-[var(--space-0-5)]">
                    {recommendation.hypotheses.map((hypothesis) => (
                      <li
                        key={hypothesis}
                        className="text-[length:var(--font-size-sm)] text-[var(--color-ink)]"
                      >
                        {hypothesis}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {recommendation.limitations.length > 0 ? (
            <div
              data-testid="recommendation-card-limitations"
              className="flex flex-col gap-[var(--space-1)]"
            >
              <h3 className="label-caps text-[var(--color-ink-secondary)]">Limitations</h3>
              <ul className="flex flex-col gap-[var(--space-0-5)]">
                {recommendation.limitations.map((limitation) => (
                  <li
                    key={limitation}
                    className="text-[length:var(--font-size-sm)] text-[var(--color-ink-secondary)]"
                  >
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {recommendation.sourceIds.length > 0 ? (
            <div
              data-testid="recommendation-card-sources"
              className="flex flex-col gap-[var(--space-1)]"
            >
              <h3 className="label-caps text-[var(--color-ink-secondary)]">Sources</h3>
              <ul className="flex flex-wrap gap-[var(--space-1-5)]">
                {recommendation.sourceIds.map((sourceId) => {
                  const source = sources[sourceId];
                  return (
                    <li key={sourceId}>
                      {source ? (
                        <a
                          data-testid={`recommendation-card-source-${sourceId}`}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[length:var(--font-size-sm)] text-[var(--color-brand)] underline underline-offset-2"
                        >
                          {source.title}
                        </a>
                      ) : (
                        // Distinct testid from the resolved branch above --
                        // both used to share `recommendation-card-source-*`,
                        // so a test asserting only `li` count could not
                        // distinguish a citation that resolved to a real
                        // Source from one that dangled. A real 60-dangling-
                        // citation bug shipped past every existing test
                        // because of exactly that collision; this testid
                        // exists so a future one cannot repeat it. Visual
                        // rendering (markup, classes, `[id]` text) is
                        // unchanged -- only this attribute is new.
                        <span
                          data-testid={`recommendation-card-unresolved-source-${sourceId}`}
                          className="font-[family-name:var(--font-mono)] text-[length:var(--font-size-2xs)] text-[var(--color-ink-muted)]"
                        >
                          [{sourceId}]
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
