# Change Set: Guided Case Workflow

Status: **approved — authoritative requirements input**  
Date received: 2026-09-10  
Source: project owner, supplied through review of the live Bid Comparison pane.

## Purpose

The existing consumer workspace exposes many valid capabilities at once, but it does not explain the order in which a person should use them. Sift must guide a person through a case without replacing the existing case engine, commands, evidence model, WebMCP contract, or human-approval boundary.

The canonical right-pane journey is:

1. **Intake** — establish the Pack, required inputs, options, and any unresolved setup requirements.
2. **Priorities** — confirm criteria, constraints, trade-offs, and questions Sift should answer.
3. **Analysis** — run and observe bounded investigation; review findings, sources, citations, and activity.
4. **Review** — compare options, triage them with Keep / Unsure / Pass, and resolve material gaps.
5. **Decide** — review the exact proposed outcome and record the person's decision.

These are sequential workflow steps, not peer tabs. Completed steps remain revisitable. A change to an upstream step must make any dependent result visibly stale rather than silently preserving it as current.

## Right-pane requirements

- Design and acceptance begin at 390–480 px. Wider layouts may reveal more context but may not contain capabilities that the right pane cannot reach.
- The stepper shows the current step, `n of 5`, completion, attention, and blocked states without forcing five full labels into one narrow row.
- The current step has one primary action. Back and supporting actions are secondary or quiet.
- Bid count, filter trigger, option-view controls, and Add Bid occupy one compact row when width permits and reflow without horizontal scrolling.
- The filter trigger and option-view controls use icons with accessible names and tooltips. The visible `Filters` label and the four text-heavy view tabs are removed from the compact row.
- Findings, Sources, and Activity are reached from Analysis. They are not unexplained global counters.
- Keep / Unsure / Pass and comparison views belong to Review.
- Approval controls belong to Decide. They must name the option and outcome precisely.

## Action and color hierarchy

- Sift Green is the only normal filled-action color.
- Neutral outlined controls are secondary actions.
- Quiet/ghost controls are navigation or low-emphasis utilities.
- Status colors describe status; they do not create competing primary actions.
- Amber means attention or accepted uncertainty.
- Red is reserved for errors and genuinely destructive/rejecting actions.
- A screen region has no more than one filled primary action.

## Copy requirements

- Replace ambiguous deictic actions such as **Choose this** with an exact outcome such as **Select Northgate Plumbing**.
- Replace **Keep researching** with **Continue investigation**.
- The decision surface states what confirmation records and whether any external action occurs.
- Counts name what they count: `3 items need review`, `20 sources`, or `28 evidence links`; a badge may not imply it is a total findings count when it is only a flagged count.
- A source title and publisher with identical text render once, not as two adjacent links or labels.

## Compatibility boundary

This change set's first implementation increment is presentation-only. It does not alter public schemas, persistence, command handlers, run orchestration, evidence validity, WebMCP tools, or human-only approval rules. Existing controls retain their existing command callbacks when relocated.

Pack-declared intake gating and live, non-fixture investigation remain a separate functional increment. This document records their required UX, but their internal implementation requires its own approved proposal and verification cycle.

## Acceptance

- A new user can identify the current step and next required action from a single right-pane screenshot.
- The five stages and their contents are keyboard reachable and screen-reader named.
- No horizontal overflow occurs at 390, 430, or 480 px.
- Existing human and WebMCP actions continue to use the same application commands.
- Existing scenario state remains valid across the visual reorganization.

