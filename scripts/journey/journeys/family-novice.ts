/**
 * A first-time person, answering questions in the pane, with nobody helping.
 *
 * `scripts/test-persona.ts` already walks this persona and asserts hard on
 * case state — but in process, calling commands directly, rendering
 * nothing. It passed while the product had no way to answer a question at
 * all. This is the same person, through the screen.
 *
 * The checks here are deliberately about **orientation** rather than
 * mechanics: after each answer, does the pane tell this person where they
 * are, what changed, and what to do next — and does what it says match the
 * case underneath? A first-time user's whole experience is that loop, and
 * it is the loop no other harness watches.
 */
import { bindCase, openWorkflowStage, type Journey, type TurnContext } from '../harness.js';

interface DiscoveryTopic {
  topicId?: string;
  id?: string;
  status?: string;
}

function topics(state: Record<string, unknown>): DiscoveryTopic[] {
  return ((state['discovery'] ?? {}) as { topics?: DiscoveryTopic[] }).topics ?? [];
}

function confirmedCount(state: Record<string, unknown>): number {
  return topics(state).filter((topic) => topic.status === 'confirmed').length;
}

/** "3 of 5 covered" -> [3, 5]. */
function coverageNumbers(text: string | null): [number, number] | null {
  const match = /(\d+)\s*of\s*(\d+)/.exec(text ?? '');
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

/** Answers whatever question the dock is currently offering, if it can. */
async function answerNextQuestion(ctx: TurnContext): Promise<boolean> {
  const ask = ctx.page.getByTestId('dock-action-primary');
  if ((await ask.count()) === 0) return false;
  await ask.first().click();

  const interaction = ctx.page.getByTestId('discovery-interaction');
  await interaction.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (!(await interaction.isVisible().catch(() => false))) return false;

  const option = interaction.locator('[data-testid^="interaction-option-"]').first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
  } else {
    const custom = ctx.page.getByTestId('interaction-custom');
    if ((await custom.count()) === 0) return false;
    await custom.fill('Personal or family use');
  }
  const submit = ctx.page.getByTestId('interaction-submit');
  if ((await submit.count()) === 0) return false;
  await submit.click();
  return true;
}

/**
 * Completes the blind-spot review sheet if the dock's primary action just
 * opened it, rather than a `discovery-interaction` question
 * (`BlindSpotReviewSheet.tsx` — "the one required challenge pass before
 * model discovery", reached from the dock's `review_blind_spots` move once
 * every required topic is confirmed).
 *
 * A real person facing it with nothing else to add ticks nothing and
 * submits: `CompleteBlindSpotReviewInputSchema` treats an empty selection as
 * a real, complete answer ("Nothing else to add" — see the sheet's own
 * "Selecting nothing is a real answer" doc), not a dead end. Leaving the
 * sheet open instead — which is what happened before this fix, because
 * `answerNextQuestion` clicks `dock-action-primary` regardless of which move
 * it triggers — blocks every click after it: Radix mounts the sheet's own
 * overlay over the rest of the page, and `request-investigation` timed out
 * with "blind-spot-review-sheet subtree intercepts pointer events" as a
 * direct result.
 */
async function completeBlindSpotReviewIfOpen(ctx: TurnContext): Promise<boolean> {
  const sheet = ctx.page.getByTestId('blind-spot-review-sheet');
  if (
    (await sheet.count()) === 0 ||
    !(await sheet
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    return false;
  }
  const submit = ctx.page.getByTestId('blind-spot-review-submit');
  if ((await submit.count()) === 0) return false;
  await submit.first().click();
  await sheet
    .first()
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => undefined);
  return true;
}

export const familyNovice: Journey = {
  id: 'family-novice',
  title: 'First-time person — answering questions in the pane',
  proves:
    'Someone who has never used Sift can answer its questions on screen and, after each answer, be told where they are and what changed — with the pane and the case agreeing.',
  turns: [
    {
      id: 'arrives',
      actor: 'person',
      intent: 'Opens Sift for the first time',
      async act(ctx) {
        await ctx.page.goto(ctx.baseUrl, { waitUntil: 'domcontentloaded' });
        await ctx.page.getByTestId('demo-launcher').waitFor({ state: 'visible', timeout: 30_000 });
      },
      async checks(ctx, check) {
        const launcher = await ctx.text('demo-launcher');
        check.ui(
          'the first screen says what this is for',
          (launcher ?? '').length > 0,
          `${(launcher ?? '').replace(/\s+/g, ' ').slice(0, 140)}…`,
        );
        check.ui(
          'nothing on the first screen is an error state',
          !(await ctx.visible('demo-launcher-error')),
          (await ctx.text('demo-launcher-error')) ?? 'no error',
        );
      },
    },

    {
      id: 'starts-the-decision',
      actor: 'person',
      intent: 'Picks the car decision',
      async act(ctx) {
        await ctx.page.getByTestId('demo-launcher-car-purchase').click();
        await ctx.page.getByTestId('case-workspace').waitFor({ state: 'visible', timeout: 30_000 });
        await bindCase(ctx);
      },
      async checks(ctx, check) {
        const next = await ctx.text('orientation-next-step');
        const coverage = await ctx.text('orientation-coverage');
        const phase = await ctx.text('orientation-phase');

        check.ui('the pane names a single next step', (next ?? '').length > 0, next ?? 'absent');
        check.ui('the pane says how far along this is', coverage !== null, coverage ?? 'absent');
        check.ui('the pane names the phase', (phase ?? '').length > 0, phase ?? 'absent');

        const numbers = coverageNumbers(coverage);
        check.agreement(
          'the coverage on screen matches what the case has confirmed',
          numbers !== null && numbers[0] === confirmedCount(await ctx.state()),
          `screen ${coverage ?? '(none)'}, case has ${confirmedCount(await ctx.state())} confirmed topic(s)`,
        );

        // Nothing on this screen may claim the person set priorities they
        // have not been asked about. The comparison card used to open with
        // "…scores highest against what you said matters" at 0 of 5
        // covered (ADR 0014).
        const insights = await ctx.text('case-insights');
        check.ui(
          'the comparison does not claim priorities this person has not given',
          insights === null || !/what you said matters|weight you have assigned/i.test(insights),
          (insights ?? 'no insights on screen').replace(/\s+/g, ' ').slice(0, 150),
        );

        // A first-time person is told a recommendation exists before they
        // have answered anything. Whether that is reassuring or confusing
        // is a judgment; that it is worth looking at is not.
        const heroStatus = await ctx.text('recommendation-hero-status');
        if (numbers !== null && numbers[0] === 0 && (heroStatus ?? '').length > 0) {
          ctx.observe(
            `At 0 of ${numbers[1]} covered — before this person has told Sift anything — the hero already reads "${(heroStatus ?? '').replace(/\s+/g, ' ').slice(0, 90)}". Sift is being honest that it is working from the catalog, but the first thing a new person sees is an answer to a question they have not been asked yet.`,
          );
        }
      },
    },

    {
      id: 'answers-the-first-question',
      actor: 'person',
      intent: 'Answers the question the pane is asking',
      async act(ctx) {
        (ctx as unknown as { before?: number }).before = confirmedCount(await ctx.state());
        (ctx as unknown as { nextBefore?: string | null }).nextBefore =
          await ctx.text('orientation-next-step');
        (ctx as unknown as { answered?: boolean }).answered = await answerNextQuestion(ctx);
      },
      async checks(ctx, check) {
        const answered = (ctx as unknown as { answered?: boolean }).answered ?? false;
        check.ui(
          'the question could actually be answered on screen',
          answered,
          answered ? 'answered in the pane' : 'no answerable question was reachable from the dock',
        );

        const before = (ctx as unknown as { before?: number }).before ?? 0;
        const after = confirmedCount(await ctx.state());
        check.data('the answer moved the case', after > before, `${before} → ${after} confirmed`);

        const nextBefore = (ctx as unknown as { nextBefore?: string | null }).nextBefore ?? null;
        const nextAfter = await ctx.text('orientation-next-step');
        check.ui(
          'the pane moves on rather than asking the same thing again',
          nextAfter !== nextBefore,
          `"${nextBefore ?? ''}" → "${nextAfter ?? ''}"`,
        );

        // `visibleText`, not `text`: the orientation shell now collapses its
        // secondary lines with the `hidden` attribute rather than unmounting
        // them, so `textContent` still returns content a person cannot see.
        check.agreement(
          'coverage on screen kept up with the case',
          coverageNumbers(await ctx.visibleText('orientation-coverage'))?.[0] === after,
          `screen ${await ctx.visibleText('orientation-coverage')}, case ${after}`,
        );

        // What a person can see without opening anything. The collapsed row
        // carries phase, coverage and the next step; "You said: …"
        // (`orientation-latest-change`) moved behind the expander when the
        // shell was compressed to one row, so this asks the question that
        // still matters — after answering, does the pane show them they
        // moved — rather than pinning one line that is no longer on screen.
        const nextVisible = await ctx.visibleText('orientation-next-step');
        const coverageVisible = await ctx.visibleText('orientation-coverage');
        check.ui(
          'the pane shows the person they moved, without opening anything',
          (coverageVisible ?? '').length > 0 && (nextVisible ?? '').length > 0,
          `coverage "${coverageVisible ?? ''}", next "${nextVisible ?? ''}"`,
        );

        const changeVisible = await ctx.visibleText('orientation-latest-change');
        if (changeVisible === null) {
          ctx.observe(
            '"You said: …" — the pane repeating a person\'s own answer back to them — is now behind the collapsed expander. It is the cheapest trust signal in the product, and a first-time user will not open a disclosure to find it.',
          );
        }
      },
    },

    {
      id: 'keeps-answering-until-done',
      actor: 'person',
      intent: 'Works through the rest of the questions',
      async act(ctx) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const next = await ctx.text('orientation-next-step');
          if (next === null || next.trim() === '') break;
          if (await answerNextQuestion(ctx)) {
            await ctx.page.waitForTimeout(1_200);
            continue;
          }
          // The dock's primary action can also be the last discovery gate
          // rather than another answerable question -- `answerNextQuestion`
          // already clicked it. Finish what it opened, exactly as a person
          // would, instead of concluding there is nothing left to do.
          if (await completeBlindSpotReviewIfOpen(ctx)) {
            await ctx.page.waitForTimeout(1_200);
            continue;
          }
          break;
        }
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const coverage = await ctx.text('orientation-coverage');
        const numbers = coverageNumbers(coverage);

        check.data(
          'several questions were answered, not just the first',
          confirmedCount(state) >= 2,
          `${confirmedCount(state)} confirmed topic(s)`,
        );
        check.agreement(
          'the pane and the case still agree on coverage after a run of answers',
          numbers !== null && numbers[0] === confirmedCount(state),
          `screen ${coverage ?? '(none)'}, case ${confirmedCount(state)}`,
        );

        const phase = await ctx.text('orientation-phase');
        check.ui(
          'the pane still names a coherent phase',
          (phase ?? '').length > 0,
          phase ?? 'absent',
        );

        // Three separate lines about readiness sit within one screen of
        // each other. If they disagree, a person has no way to know which
        // to believe.
        const alert = await ctx.text('workspace-alert-banner');
        const hero = await ctx.text('recommendation-hero-status');
        if (
          /ready/i.test(phase ?? '') &&
          /need|attention|unresolved/i.test(`${alert ?? ''} ${hero ?? ''}`)
        ) {
          ctx.observe(
            `The orientation line reads "${(phase ?? '').trim()}" while the same screen also says "${(alert ?? hero ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)}". Two readiness claims, one screen, opposite meanings.`,
          );
        }
      },
    },

    {
      id: 'judges-an-option',
      actor: 'person',
      intent: 'Makes a call on one of the cars',
      async act(ctx) {
        // A real person leaves nothing open before moving on.
        await completeBlindSpotReviewIfOpen(ctx);

        const keep = ctx.page.getByTestId('quick-pick-keep');
        if (
          (await keep.count()) === 0 ||
          !(await keep
            .first()
            .isVisible()
            .catch(() => false))
        ) {
          // Review owns Quick Pick (ADR 0016 / case-workflow.ts's stage-
          // ownership table) -- a real person opens the guided stepper and
          // moves to Review to see it, exactly as the dock's own
          // `quick_pick` move would send them there.
          await openWorkflowStage(ctx, 'review');
        }

        const keepAfterNav = ctx.page.getByTestId('quick-pick-keep');
        if (
          (await keepAfterNav.count()) > 0 &&
          (await keepAfterNav
            .first()
            .isEnabled()
            .catch(() => false))
        ) {
          await keepAfterNav.first().click();
        }
      },
      async checks(ctx, check) {
        const disposition = await ctx.text('quick-pick-current-disposition');
        const position = await ctx.text('quick-pick-position');
        check.ui(
          'the pane confirms the judgment back to the person',
          disposition !== null || position !== null,
          `${disposition ?? ''} ${position ?? ''}`.trim() || 'no quick-pick surface on screen',
        );

        // Quick Pick dispositions live on `discovery`, not on the entity
        // (`CaseState.discovery.dispositions` — see case.ts: "the Quick
        // Pick dispositions"), and each one records what it changed from.
        const state = await ctx.state();
        const dispositions =
          (
            (state['discovery'] ?? {}) as {
              dispositions?: {
                entityId: string;
                disposition: string;
                previousDisposition?: string;
              }[];
            }
          ).dispositions ?? [];
        check.data(
          'the judgment is on the case, not just on screen',
          dispositions.length > 0,
          dispositions
            .map((d) => `${d.entityId}: ${String(d.previousDisposition)} → ${d.disposition}`)
            .join(', ') || 'no dispositions recorded',
        );
      },
    },

    {
      id: 'asks-what-sift-thinks',
      actor: 'person',
      intent: 'Asks Sift to look into it properly now',
      async act(ctx) {
        // Belt and suspenders: the previous turn already closes the sheet
        // if the discovery loop opened it, but a real person would never
        // click through an open sheet's overlay to reach the hero
        // underneath, so this guards the click site itself too.
        await completeBlindSpotReviewIfOpen(ctx);

        const button = ctx.page.getByTestId('request-investigation');
        if ((await button.count()) > 0 && (await button.first().isEnabled())) {
          await button.first().click();
        } else {
          await ctx.write('sift_request_investigation');
        }
        for (let tick = 0; tick < 90; tick += 1) {
          if ((await ctx.state())['recommendation'] != null) break;
          await ctx.page.waitForTimeout(1_000);
        }
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const recommended = state['recommendation'] as { favoredOptionId?: string } | null;
        const label = ((state['entities'] ?? []) as { id: string; label: string }[]).find(
          (entity) => entity.id === recommended?.favoredOptionId,
        )?.label;

        check.data(
          'Sift produced an answer',
          recommended !== null,
          recommended === null ? 'none' : 'present',
        );

        const headline = await ctx.text('recommendation-hero-headline');
        check.ui(
          'the answer is stated on screen',
          (headline ?? '').length > 0,
          headline ?? 'absent',
        );
        check.agreement(
          'the option named on screen is the option the case favors',
          label !== undefined && (headline ?? '').includes(label),
          `case favors "${label ?? '(none)'}", screen reads "${headline ?? ''}"`,
        );

        check.ui(
          'the person is told this is theirs to decide',
          await ctx.visible('dock-human-only-note'),
          (await ctx.text('dock-human-only-note')) ?? 'no human-only note on screen',
        );
      },
    },
  ],
};
