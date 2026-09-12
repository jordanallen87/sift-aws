# Sift Design System

Status: v1 — color, type, spacing, radius, shadow, and motion tokens. No
components yet; this document explains the token layer at
`apps/web/src/styles/tokens.css` and `apps/web/src/styles/global.css` and
records what in it was adapted from a private reference repository.

## The design world: a case dossier, not a dashboard

### Guided workflow and action hierarchy

The consumer pane uses a compact stepper for Intake, Priorities, Analysis,
Review, and Decide. It is a progress and navigation control, not a tab strip.
At 390–480 px it leads with the current step and ordinal progress; the full
sequence is disclosed on demand rather than compressed into five truncated
labels.

Each region has at most one filled primary action. Sift Green is the normal
primary-action color; neutral outlined buttons are secondary; quiet controls
handle navigation and utilities; amber communicates attention; and brick red
is reserved for errors or genuinely rejecting/destructive actions. Status
colors never create competing calls to action.

Sift's own language is casework: a **case**, **evidence**, **obligations**
("questions to resolve"), **readiness**, a **recommendation**, and a human
**approval**. `docs/specs/product.md` describes the product as "a calm case
board rather than a chatbot dashboard." That sentence is the design brief.
The token system is built around a claims-examiner's desk — paper, ink,
cited sources, a stamped verdict — rather than a generic blue/gray SaaS
palette or an AI-generic warm-cream-and-serif landing page.

Two AI-demo defaults were deliberately avoided: a warm cream background
with a high-contrast display serif and a terracotta accent, and a
near-black background with a single neon accent. Sift's palette instead
sits on a cool, quiet paper tone with a dark desaturated forest green —
Sift Green, the corporate identity primary — as its brand color, and
reserves saturated color entirely for the nine status tokens described
below.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| `--color-paper` | `#EEF1F0` | Page background — a cool, quiet paper/ledger tone, not warm cream |
| `--color-surface` | `#FBFBF9` | Card/panel fill |
| `--color-surface-sunken` | `#E4E7E1` | Recessed areas: code, Runtime Inspector rows |
| `--color-ink` | `#1B1D1B` | Primary text |
| `--color-brand` | `#1F5C52` | Primary actions, links, focus |
| `--color-brand-strong` | `#164A41` | Hover/pressed |
| `--color-brand-tint` | `#D7E9E5` | Subtle brand-colored surface |

Brand color rationale: this is Sift Green, the corporate identity primary
from the brand kit (`docs/brand/palette.json`, green.600). It is a dark,
desaturated forest green that reads as ink rather than UI chrome, far
enough from a bright SaaS blue (`#3B82F6`-class) or a violet/indigo accent
(Linear/Stripe-class) to read as a distinct choice rather than a framework
default, and it sits warmer against the paper neutrals than the ink-blue
it replaced.

The three tokens are `var()` references into the `--sift-green-*` ramp in
`tokens.css` rather than copied literals, so the identity mark and the
workspace chrome cannot drift apart — which they previously did, the
interface brand being an independent navy and the identity ramp being
consumed by nothing.

Two of the three deliberately diverge from the brand kit's own semantic
aliases, because a static mark and an interactive control have different
requirements:

- **`--color-brand-strong` is green.800, not the kit's `--sift-brand-hover`
  (green.700).** green.700 is only ΔE00 2.3 / 1.11:1 from the base — at or
  below the just-noticeable-difference threshold, so a hover would read as
  no feedback at all. The retired navy pair (`#2C4870` → `#1F3555`) had a
  ΔE00 6.5 / 1.34:1 / ΔL\* 8.4 step; green.800 reproduces it almost exactly
  (ΔE00 5.8 / 1.30:1 / ΔL\* 7.1). green.900 would overshoot to ΔE00 10.9 and
  read as a different color rather than a state.
- **`--color-brand-tint` is green.100, not the kit's `--sift-brand-soft`
  (green.50).** Most tint usage sits on `--color-surface` (pure white):
  green.50 is only 1.08:1 there and would vanish; green.100 holds 1.26:1,
  marginally better than the navy tint it replaces (1.23:1), at effectively
  the same lightness (L\* 91.0 vs 91.8).

### Formerly-navy: what happened to `#2C4870`

The ink-blue did not leave the palette. It was simultaneously the brand
*and* the `active` status, written as two independent literals; when the
brand moved to green, `active` kept the navy — see "Why `active` did not
follow the brand" below.

### Status tokens

`docs/specs/product.md`'s Readiness region groups obligations by
**satisfied, active, blocked, accepted uncertainty,** and **open**; the
Required Visible States list adds **stale**, an **error** state, **ready**
(for review), and **decided**. Each of the nine gets an `-ink` /
`-bg` / `-border` triad in `tokens.css`:

| State | Ink | Meaning |
| --- | --- | --- |
| `satisfied` | moss green `#3B6B4C` | required evidence is in and sufficient |
| `active` | ink-blue `#2C4870` | being investigated right now |
| `blocked` | plum/wine `#6B3550` | stuck on a human or a missing capability |
| `accepted-uncertainty` | ochre `#8A5A16` | a gap the user explicitly accepted |
| `open` | stone gray `#64665F` | not yet started — deliberately hue-less |
| `stale` | dusty mauve `#75636C` | evidence aged past its validity window |
| `error` | brick red `#A13A2A` | a recoverable technical/tool failure |
| `ready` | petrol blue `#0F6076` | every requirement met, awaiting human review |
| `decided` | ink charcoal `#1B1D1B` | the case is closed |

Design choices behind this set:

- **Every ink value was calibrated against real WCAG contrast math**, not
  eyeballed. All nine pass ≥ 4.5:1 as text on `--color-paper`, as text on
  their own `-bg` tint, and as white text on a solid fill of the ink color
  — so the same token works as a label, an outlined chip, or a filled
  badge without a second set of "accessible" variants.
- **Separation between status inks is measured in CIEDE2000 (ΔE00), not in
  WCAG contrast ratio.** Contrast ratio is the wrong instrument for
  *distinctness* and will mislead anyone who reaches for it. Because every
  ink is deliberately tuned into the same narrow luminance band — which is
  exactly what lets them all clear 4.5:1 on the same backgrounds — *every*
  pair in this set sits under 2:1 of every other. `blocked` and `error` are
  1.40:1 apart and are obviously different colors (ΔE00 22.4). Only
  `decided` clears 2:1 of anything, and only because it is near-black. A
  2:1 rule applied to these tokens is unsatisfiable: reaching it would
  force an ink either light enough to fail 4.5:1 on white or dark enough to
  collide with `decided`. The working floor is instead **ΔE00 ≥ 13.7**, the
  tightest pair this system already treats as distinct (`blocked` vs
  `stale`).
- **`blocked` and `error` are deliberately different hues** (plum vs.
  brick red). `blocked` is a case-domain state — the run is stuck on a
  human or a missing capability, which is a normal, expected pause, not an
  alarm. `error` is reserved for technical failure, where red's
  conventional urgency is earned.
- **`open` and `decided` are intentionally the quietest tokens** —
  unclaimed work and closed work should not compete visually with the
  states that need attention (`blocked`, `accepted-uncertainty`, `ready`).
- **No new hue was invented for `decided`.** A closed case is calm, not
  alarming or celebratory, so it reuses the primary ink color; the
  distinguishing signature is a shape treatment, not a tenth color (see
  "Signature element" below). The three concrete outcomes in the
  Recommendation region — approved, rejected, revision requested — reuse
  `satisfied`, `error`, and `accepted-uncertainty` respectively rather than
  adding three more tokens. That is `ApprovalCard`'s settled stamp, which
  says *what the human did*. The status chip on `RecommendationCard`
  directly above it answers a different question — *where is this case* —
  and so the one outcome that actually closes the case, approval, carries
  `decided` there ("Decided"), while rejection and a revision request keep
  the case open and keep their own two tones ("Not chosen", "Revision
  requested"). Before this distinction existed the chip was derived from
  `Recommendation.status`, which stays `ready` forever after a decision, so
  a closed case rendered a green "READY FOR REVIEW" chip beneath its own
  "Decided." headline (release baseline
  `decided-chatgpt-pane-640-darwin.png`).
- **Never color-only.** Every status token is paired with the state's text
  label (see `docs/specs/product.md`'s terminology table — "Your approval
  needed," "Action blocked," etc.) and, at the component level, an icon.
  Color is reinforcement, not the only channel.

### The Sift Green repoint: two collisions and how they were resolved

Moving `--color-brand` from ink-blue to Sift Green broke two things that a
find-and-replace would have missed. Both were resolved deliberately.

**1. `active` did not follow the brand — it kept the navy.**

`--color-status-active-ink`/`-bg` were hardcoded literals equal to the old
brand, not `var()` references, so `active` would have silently stayed navy
while everything else turned green. The literals are kept, but they are now
*deliberate* rather than coincidental: `active` owns `#2C4870` outright.

It does not point at `--color-brand` because:

1. A status says something about the *case*; the brand says something about
   the *product*. `active` is the highest-frequency status in the UI —
   every pulsing "working" dot, the Live connection chip, filter chips,
   Runtime Inspector rows. Pointing it at the brand would paint all of that
   the same color as every primary button, link, and focus ring, leaving
   the status with no independent signal.
2. Green is now the palette's *completion* family (brand chrome plus
   `satisfied` moss). "In flight" is not "done". A green `active` would sit
   ΔE00 9.7 from the brand *and* 9.7 from `satisfied`, and `active` and
   `satisfied` chips render side by side in the same Readiness grouping —
   a real legibility regression in the densest region of the product.
3. Contrast. The navy holds AAA on every pair it is used in (7.53:1 on its
   own `-bg`, 8.15:1 on paper, 9.26:1 as white-on-fill). Every alternative
   blue far enough from Sift Green to be told apart has to be lighter, and
   the whole search space at that separation lands around 4.7:1 on paper —
   an AAA→AA regression.

It separates cleanly from the new brand (ΔE00 24.7) and from every other
status ink (minimum ΔE00 19.1, against `stale`).

**2. `ready` moved from green-teal to petrol blue.**

`#1B665F` sat **ΔE00 3.8** from `#1F5C52` — visually the same color. "Your
approval needed" would have been indistinguishable from every primary
button, in the one state where the product most needs the human to see that
*they* must act and that the chip is not itself the button.

A lighter or darker green — the brand kit's own guidance for supporting
colors — does not work here, because the green family is full at the
lightness band WCAG allows. Text needing ≥ 4.5:1 on white caps the ink at
about L\* 47, and L\* 28 / 35 / 41 are already `--color-brand-strong` /
`--color-brand` / `satisfied`. Going darker hits green.900 at ΔE00 5.1 from
`--color-brand-strong`; darker still (green.950) collides with `decided`
ink-charcoal at ΔE00 10.4 and stops reading as a status at all.

The freed navy was evaluated and rejected for `ready` specifically because
`active` has no viable alternative to it (reason 3 above) and only one token
can hold it. A search of the remaining gamut at `ready`'s required contrast
returns only olive (H≈100) and violet (H≈315) as genuinely free hues; both
are wrong for this design world, and violet is the accent family the brand
rationale above explicitly rejects.

So `ready` stays recognisably *teal* — continuity with what shipped — but
moves decisively from the green side of teal to the blue side. `#0F6076` is
ΔE00 14.8 from the brand and 15.0 from `active`, both above the ΔE00 13.7
floor; every other separation is ≥ 19.3. It is also strictly *better* on
contrast than the teal it replaces, gaining AAA on white.

**Audit of the remaining seven.** Every status-to-status pair clears the
ΔE00 13.7 floor after the change, and every status clears it against
`--color-brand` except `satisfied` (ΔE00 9.7). `satisfied` is kept as moss
green anyway, deliberately: it is not a status-to-status collision (16.7
from its nearest status neighbour), the two never render as the same *kind*
of element — the brand is button fills, links, and focus rings; `satisfied`
is chip text on a tint — and at roughly 4× the just-noticeable difference
with a 6.1 L\* gap they read as related shades rather than one color. Green
meaning "this is settled" is also the correct family for it now that the
brand is green.

### Measured contrast, before and after

Every pair touched by the repoint. All clear WCAG AA (4.5:1); the two
regressions from AAA are noted.

| Pair | Before | After |
| --- | --- | --- |
| white on `--color-brand` (primary button) | 9.26 AAA | 7.75 AAA |
| white on `--color-brand-strong` (hover) | 12.36 AAA | 10.05 AAA |
| `--color-brand` text on `--color-surface` (white) | 9.26 AAA | 7.75 AAA |
| `--color-brand` text on `--color-paper` | 8.15 AAA | 6.82 **AA** |
| `--color-brand` text on `--color-brand-tint` | 7.53 AAA | 6.15 **AA** |
| `--color-brand-strong` on tint (`--accent-foreground` on `--accent`, `::selection`) | 10.05 AAA | 7.98 AAA |
| `--color-ink` on tint (pinned compare row) | 13.78 AAA | 13.47 AAA |
| `--color-ink-muted` on tint | 4.96 AA | 4.84 AA |
| `ready` ink on `ready` bg | 5.53 AA | 5.80 AA |
| `ready` ink on `--color-paper` | 5.94 AA | 6.25 AA |
| `ready` ink on `--color-surface` (white) | 6.75 AA | **7.11 AAA** |
| `ready` ink on `--color-surface-sunken` | 5.40 AA | 5.69 AA |
| white on `ready` ink (filled badge) | 6.75 AA | **7.11 AAA** |
| `--color-ink-muted` on `ready` bg | 4.99 AA | 4.98 AA |
| `--color-ink` on `ready` bg (review card fill) | 13.89 AAA | 13.85 AAA |

`active` is unchanged and retains 7.53 / 8.15 / 9.26 (own `-bg` / paper /
white-on-fill).

The two AAA→AA drops are both forced by the brand primary itself, which is
fixed by the identity: `#1F5C52` is lighter than the navy it replaces, so
anything measured against it loses a little headroom. Both remain well
clear of AA, and the pair that matters most in practice — brand text on
`--color-surface`, where every link in the component tree actually renders,
since links live inside white cards — stays AAA at 7.75. Brand text
directly on `--color-paper` is the rarer case.

`--color-ink-muted` still clears 4.5:1 against all nine status backgrounds
(worst case 4.82 on `error`, with `ready` at 4.98), so `tokens.css`'s
standing promise for that token holds.

### Mapping the full required-states list

The nine status tokens above cover per-obligation and per-case states
directly. The remaining states in `docs/specs/product.md`'s "Required
visible states" list are compositions of the status tokens with the
neutral surface and motion tokens, not additional colors:

| Required state | Built from |
| --- | --- |
| initial / empty | `--color-surface` + `--color-border-subtle` + `--color-ink-muted`; no status color — nothing has happened yet |
| loading | `--color-surface-sunken` skeleton fill, animated with `--duration-*` (becomes a static fill under reduced motion) |
| partial evidence | `satisfied` chips (what's confirmed) next to `open` chips (what's missing) in the same list |
| active investigation | `active` |
| guided retry | `active`, distinguished from plain investigation by the "Agent redirected" label/icon, not a new color |
| waiting for confirmation | `ready` — attention has shifted from the agent to the human, same as "ready for review" |
| blocked | `blocked` |
| stale evidence | `stale` |
| ready for review | `ready` |
| approved / rejected / revision requested | `satisfied` / `error` / `accepted-uncertainty`, applied to the stamp treatment |
| recoverable error | `error`; the last valid case state stays rendered underneath per the product spec's error contract |
| unsupported WebMCP host | neutral informational treatment (`--color-surface-sunken` + `--color-ink-muted`) — this is an environment fact, not a case state, so it does not borrow a status hue |
| reconnecting / replaying / polling fallback | a small connection indicator using `active` (pulsing, motion-token-driven) for reconnecting and `open`/muted for polling fallback; transient notices use `--z-toast` and `--shadow-elevated` |

### Signature element: the stamp

The one deliberately memorable device is a **stamped verdict** for the
Recommendation and Approval region: a rectangular (not pill-shaped) badge
with a doubled border, uppercase wide-tracked type, and a slight rotation,
rendered in the outcome's ink color (`satisfied`/`error`/
`accepted-uncertainty`). It is a direct, literal expression of the
product's core authority rule — "the final decision remains recognizably
theirs" — a human stamps the case; the agent never does. It appears in
exactly one place (`ApprovalCard.tsx`'s `approval-card-stamp`, once a
proposal has settled) so it stays a signature rather than a decoration
repeated everywhere. It plays a dedicated `stamp-in` entrance animation
(`apps/web/src/styles/global.css`'s Motion section) the moment it first
mounts — scaling and rotating down into its rest position, reading as a
genuine stamp landing rather than a generic fade.

## Typography

Three families, one role each, self-hosted (see the font-loading note
below):

- **Display — Newsreader** (headings, the case title, the stamp verdict).
  An editorial serif with real optical texture but calm proportions —
  it reads as a typeset report, not a marketing headline, which matches
  the "calm case board" requirement better than a high-contrast display
  serif would. Used with restraint: headings only, never body copy.
- **Body/UI — Public Sans.** Designed by 18F/USWDS specifically for dense
  civic and case-processing forms. That is a literal match for Sift's
  vocabulary (case, obligation, evidence, readiness, approval), not a
  generic Inter/system-ui default — and it is proven at small sizes and
  high information density, which the 390px pane demands.
- **Mono — IBM Plex Mono.** IDs, hashes, timestamps, source citations, and
  every dense value in the Runtime Inspector's trace/state-diff views.

All three are SIL Open Font License 1.1 families, so self-hosting the
unmodified static files is license-clean with no attribution string
required beyond the license text carried in the font files themselves.

### Font-loading strategy (network-independent)

docs/engineering-principles.md requires fixture mode to run "without network access after
installation," which rules out a Google Fonts `<link>` in the deployed and
test-time HTML. `global.css` instead declares `@font-face` rules pointing
at self-hosted files under `apps/web/public/fonts/**` (Vite serves
`public/` at the site root, so `public/fonts/x.woff2` resolves to
`/fonts/x.woff2` in both dev and the production build).

**The woff2 binaries are real, committed files** at exactly these paths —
`global.css` references them by name:

```
apps/web/public/fonts/newsreader/newsreader-400.woff2
apps/web/public/fonts/newsreader/newsreader-500.woff2
apps/web/public/fonts/newsreader/newsreader-600.woff2
apps/web/public/fonts/newsreader/newsreader-400-italic.woff2
apps/web/public/fonts/public-sans/public-sans-400.woff2
apps/web/public/fonts/public-sans/public-sans-500.woff2
apps/web/public/fonts/public-sans/public-sans-600.woff2
apps/web/public/fonts/public-sans/public-sans-700.woff2
apps/web/public/fonts/ibm-plex-mono/ibm-plex-mono-400.woff2
apps/web/public/fonts/ibm-plex-mono/ibm-plex-mono-500.woff2
```

Each file is an unmodified copy (renamed only) of the matching weight/style
from the pinned `@fontsource/newsreader`, `@fontsource/public-sans`, and
`@fontsource/ibm-plex-mono` npm packages — `@sift/web` `dependencies`, so
the exact source version is lockfile-pinned and reproducible on a clean
`pnpm install`, with no separate download step and no network access
required at build or test time. See docs/reuse-attribution.md for the full
source/license record.

If a file were ever missing (e.g. a partial checkout), the corresponding
`@font-face` would simply fail to load and its `--font-*` stack in
`tokens.css` would fall through to its system fallback (`Georgia`/serif,
`-apple-system`/sans-serif, `ui-monospace`) — the product stays legible and
functional either way — but that fallback is not the expected state of a
normal checkout.

### Type scale

Sized for a 390-480px reading column rather than scaled down from a
desktop composition. Base body size is 16px (`--font-size-base`) so form
inputs never trigger iOS Safari's auto-zoom-on-focus; the smallest step
(`--font-size-2xs`, 11px) is reserved for timestamps, sequence numbers,
and IDs — never for anything a user must read to act.

## Spacing, radius, shadow, motion

Adapted from the private sibling reference repository think-os per
`docs/reuse-source-map.md`'s explicit instruction to "translate selected
values into CSS variables" rather than import the package — see
`docs/reuse-attribution.md` for the full record. Summary:

- **Spacing** — the 4px-grid scale (`--space-0-5` through `--space-16`,
  plus `--space-20` for desktop-only gutters) is taken as-is; it is a
  well-formed utilitarian scale with no product-specific opinion baked in.
- **Radius** — the small-to-medium steps (`--radius-xs` through
  `--radius-lg`) are taken as-is; the large end is deliberately tightened
  (no `2xl`/`3xl` 24-28px steps) because a case dossier should read closer
  to a document than a bubbly consumer app. `--radius-pill` remains for
  status badges only.
- **Shadow** — the restrained two-step philosophy (no shadow on ordinary
  cards; shadow reserved for things floating with nothing behind them in
  page flow) is taken as-is, renamed `--shadow-soft` / `--shadow-elevated`
  and re-tuned to sit on `--color-ink` instead of a generic dark gray.
- **Motion** — the four-step duration scale and three easing curves are
  taken as-is. `tokens.css` adds the actual `prefers-reduced-motion`
  override (zeroing all four durations at `:root`) that the source scale
  documented as an intent but did not itself implement as CSS.

Color and typography values are **not** adapted from think-os — they are
new choices for Sift's own identity (see the Palette and Typography
sections above); think-os's `colors.ts` and `fonts.ts` were reviewed for
direction only, per `docs/reuse-source-map.md`'s instruction to "select
only values that support Sift's calm narrow-pane identity."

## How this holds up at 390px specifically

"Responsive" is not the requirement — docs/engineering-principles.md is explicit that 390-480px
*is* the canonical viewport, not a breakpoint reached by shrinking a
desktop layout. Concrete decisions this token system makes for that width:

- **Information density.** The type scale's bottom three steps (11/12.5/14px)
  carry status badges, metadata, and secondary text so a readiness row or
  activity item can show a label, a value, and a timestamp on one line
  without wrapping at 390px; the 16px base is reserved for text a user is
  actually reading (evidence claims, the recommendation, form inputs).
  Spacing at narrow width should default to the `--space-3`/`--space-4`
  (12/16px) steps for card padding and list-item gaps; `--space-6` and up
  are desktop-only compositional gutters (`--desktop-breakpoint: 900px`
  is the token that marks that switch).
- **Touch targets.** `--size-touch-target-min` is set to 44px, matching
  `docs/specs/testing.md`'s 44×44 CSS-pixel requirement. This is a hit-area
  token, not a visual-size token: a status chip or badge can render
  smaller than 44px visually, but every *actionable* control (approve/
  reject, demo launcher cards, nav/back controls, the Runtime Inspector's
  view selector) must resolve to a real ≥44px box via padding or
  min-height/min-width, independent of how small its label or icon looks.
- **Stacking order.** `--desktop-breakpoint: 900px` remains defined for
  desktop-only compositional gutters. The narrow pane (≤ `--pane-width-max`,
  480px) is single-column, in the region order `docs/specs/product.md`
  "Workspace layout" specifies.

  **This paragraph previously read "the workspace is single-column at every
  width (ADR 0002)" and that was wrong twice over** — it cited an ADR whose
  layout `product.md` §55 records as replaced by ADR 0004, and it contradicted
  change-set §7's requirement for two intentional information architectures.
  Implementers read it as licence for the `max-w-[480px]` cap that three
  separate top-level components each applied, which made expanded mode
  structurally unreachable: at a 1440px viewport the whole product rendered in
  a 448px column. See **ADR 0007** for the correction and the shared
  `.page-shell` that replaces those three caps.

  Above 480px the shell widens to `--shell-width-max` (1280px) and individual
  views adopt their expanded information architecture — a card grid, a
  multi-column comparison table, a wider board. docs/engineering-principles.md's "not a desktop
  dashboard shrunk after the fact" remains binding and is a statement about
  *design order* — the narrow pane is designed first and natively, and is
  never a compressed desktop layout. It is not a licence to leave desktop
  space unused, and `product.md` §69's guardrail still forbids a three-column
  dashboard or full-page navigation chrome at any width. The
  Runtime Inspector is a full-width route replacing the case body — never
  a second column — consistent with `docs/specs/debugging-and-observability.md`'s
  390px requirement for "a single view selector and stacked event
  details," not a side-by-side trace tree and payload panel.
- **Runtime Inspector density vs. the calm workspace.** The Inspector
  needs to be visibly denser than the normal case board (timelines, state
  diffs, trace payloads) without switching to a different visual language.
  It reuses the same status tokens (an event's `level` maps `error`→
  `error`, `warn`→`accepted-uncertainty`, `info`/`debug`→`open`/
  `--color-ink-muted`) and drops to `--color-surface-sunken` for recessed
  trace rows and `--font-mono`/`--font-size-2xs` for IDs, hashes, and
  timestamps, rather than inventing an unrelated "developer mode" palette.

## Files

- `apps/web/src/styles/tokens.css` — all custom properties described above.
- `apps/web/src/styles/global.css` — `@font-face` declarations, a small
  deliberate reset, base typography, focus-visible styling, and the
  reduced-motion and overflow backstops.
- No React components exist yet; wiring these into the app entry point and
  building the region components (`ReadinessPanel`, `CurrentFocusCard`,
  the stamp/`ApprovalCard`, etc.) is later work per
  `docs/planning/plans/2026-08-26-pax-hackathon-build.md`.
