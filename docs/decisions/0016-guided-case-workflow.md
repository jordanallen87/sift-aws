# ADR 0016: Guided Case Workflow in the Consumer Pane

Status: **accepted**  
Date: 2026-09-10  
Requirements source: `docs/change-sets/2026-09-10-guided-case-workflow.md`

## Context

The consumer pane currently combines orientation, alerts, recommendation state, option views, readiness, findings, references, notes, and approval actions in one scrolling workspace. Each region is individually functional, but the composition does not teach a person what to do first, what Sift is doing, or why a particular action is available.

The pane is the primary product surface. A navigation model designed for desktop width or a flat set of peer tabs would misrepresent both the available space and the sequential nature of a case.

## Decision

Sift presents the consumer journey as five workflow steps: Intake, Priorities, Analysis, Review, and Decide.

The stepper is an orientation and navigation control over existing case state. It does not become a second workflow engine. Stage status is derived from canonical CaseState, discovery coverage, run state, evidence/readiness, recommendation, and proposal state. User navigation is local presentation state; mutations continue through existing commands.

At narrow width the persistent header shows only the current step, ordinal progress, and a compact progress affordance. The complete step list is available from that control. Wider layouts may show all labels when they fit.

Stage ownership is:

| Stage | Owns |
| --- | --- |
| Intake | Pack identity, required setup, options, missing inputs, pending discovery interactions |
| Priorities | criteria, constraints, importance, questions, Decision Profile |
| Analysis | investigation request/status, findings, sources/citations, activity, stale-result explanation |
| Review | Quick Pick, List, Compare, Board, filters, option profiles, readiness gaps, blind-spot review |
| Decide | recommendation summary, proposal, explicit human approval/rejection/revision |

Completed steps are revisitable. Future steps may be visible but unavailable when their prerequisites are not satisfied. If an upstream mutation invalidates analysis, the stepper and Analysis stage show the stale state using the existing canonical invalidation signal.

## Visual hierarchy

The existing Sift token system remains authoritative. Sift Green is used for the single primary action in a region. Secondary actions use neutral controls. Status colors remain semantic and do not compete with actions. Red is not used as a routine alternative button.

The compact option toolbar combines a truthful bid/option count, icon-only filter control, icon-only view controls, and Add Option. Accessible names and tooltips preserve meaning that the visible labels previously supplied.

## Consequences

- The existing consumer components can be reused and relocated instead of rewritten.
- App-level composition becomes responsible for the active presentation stage.
- Findings and references stop consuming global app-bar priority and gain an explicit conceptual home.
- Unit and browser tests must distinguish stage navigation from domain mutation.
- Existing full-workspace screenshots will change even though canonical case data does not.

## Rejected alternatives

- **Peer tabs:** incorrectly imply the regions are equivalent views and do not communicate prerequisite order.
- **A permanent five-label row at every width:** consumes too much of the 390 px pane and forces truncation.
- **A new persisted workflow-stage field:** duplicates state already derivable from canonical case/run/proposal state and creates disagreement risk.
- **A wholesale workspace rewrite:** adds internal risk without improving the engine, commands, or evidence model.

