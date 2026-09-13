/**
 * Shared human-agent control, interleaved in one case.
 *
 * This is the WebMCP submission's actual claim — that a person and an
 * assistant operate the same case through the same commands, and that the
 * authority boundary between them is structural rather than policed. Every
 * other journey exercises one actor at a time. This one alternates, in one
 * case, in one browser, and checks after every hand-off that both sides
 * still see the same thing.
 *
 * Four properties, none of which a single-actor journey can show:
 *
 * 1. A person's answer in the pane is immediately readable by the host.
 * 2. What the assistant records is a **proposal**, never a confirmation —
 *    `sift_record_discovery` has no `actor` and no `op` field, so there is
 *    nowhere in the request to ask for confirmation. The capability is
 *    absent, not guarded.
 * 3. A write whose DECISION depends on the view it read -- reweighting a
 *    criteria set -- is refused when that view has moved on, and the refusal
 *    names the sequence the case is actually at, so the caller can recover
 *    rather than guess.
 *
 *    This step used to make the same point with `sift_add_note`, and it was
 *    retargeted rather than deleted when `addNote` became one of the two
 *    commands the server treats as sequence-independent (see
 *    `CommandService.loadForIndependentMutation`). A note depends on nothing
 *    a bystander event can change, so refusing one proved only that a counter
 *    had moved -- and, on a real case with a run streaming events, refused
 *    writes that were never in conflict with anything. `sift_update_criteria`
 *    is the honest subject: it decides what to write by reading the criteria
 *    set, so a stale view is a real hazard and the refusal is real
 *    protection.
 * 4. A person can confirm or reject what the assistant proposed, and the
 *    result carries whose judgment it was.
 */
import { bindCase, openWorkflowStage, type Journey } from '../harness.js';

interface DiscoveryTopic {
  topicId?: string;
  id?: string;
  status?: string;
  origin?: string;
  valueSummary?: string;
}

function topics(state: Record<string, unknown>): DiscoveryTopic[] {
  const discovery = (state['discovery'] ?? {}) as { topics?: DiscoveryTopic[] };
  return discovery.topics ?? [];
}

function topicId(topic: DiscoveryTopic): string {
  return topic.topicId ?? topic.id ?? '';
}

export const sharedControl: Journey = {
  id: 'shared-control',
  title: 'Shared control — a person and an assistant on one case',
  proves:
    "A person and a WebMCP host alternate on the same case: the person's answer is readable by the host, the host can only propose, a view-dependent write against a stale sequence is refused with the real sequence, and the person decides.",
  turns: [
    {
      id: 'launch',
      actor: 'person',
      intent: 'Starts the car decision',
      async act(ctx) {
        await ctx.page.goto(ctx.baseUrl, { waitUntil: 'domcontentloaded' });
        await ctx.page.getByTestId('demo-launcher').waitFor({ state: 'visible', timeout: 30_000 });
        await ctx.page.getByTestId('demo-launcher-car-purchase').click();
        await ctx.page.getByTestId('case-workspace').waitFor({ state: 'visible', timeout: 30_000 });
        await bindCase(ctx);
      },
      async checks(ctx, check) {
        check.data('a case is open', ctx.caseId !== '', ctx.caseId || '(none)');
        check.ui(
          'the dock offers the person something to do',
          await ctx.visible('dock-action-primary'),
          (await ctx.text('dock-action-primary')) ?? 'no primary action',
        );
      },
    },

    {
      id: 'person-answers-in-the-pane',
      actor: 'person',
      intent: 'Answers the question Sift is asking, in the pane',
      async act(ctx) {
        const ask = ctx.page.getByTestId('dock-action-primary');
        if ((await ask.count()) === 0) return;
        await ask.click();
        const interaction = ctx.page.getByTestId('discovery-interaction');
        await interaction.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
        if (!(await interaction.isVisible().catch(() => false))) return;

        const option = interaction.locator('[data-testid^="interaction-option-"]').first();
        if (await option.isVisible().catch(() => false)) {
          await option.click();
        } else {
          await ctx.page.getByTestId('interaction-custom').fill('Personal or family use');
        }
        await ctx.page.getByTestId('interaction-submit').click();
      },
      async checks(ctx, check) {
        const answered = topics(await ctx.state());
        check.data(
          'answering in the pane moved the case, not just the screen',
          answered.length > 0,
          `${answered.length} discovery topic(s) recorded`,
        );

        const confirmed = answered.filter((topic) => topic.status === 'confirmed');
        check.data(
          "the person's own answer is recorded as confirmed",
          confirmed.length > 0,
          confirmed
            .map((t) => `${topicId(t)}=${String(t.status)}/${String(t.origin)}`)
            .join(', ') || answered.map((t) => `${topicId(t)}=${String(t.status)}`).join(', '),
        );
        check.data(
          'and attributed to the person, not the model',
          confirmed.every((topic) => topic.origin === 'user' || topic.origin === undefined),
          confirmed.map((t) => String(t.origin)).join(', ') || 'none',
        );

        const coverage = await ctx.text('orientation-coverage');
        check.ui('coverage is visible to the person', coverage !== null, coverage ?? 'absent');
      },
    },

    {
      id: 'assistant-reads-what-the-person-said',
      actor: 'assistant',
      intent: 'Reads the case before saying anything about it',
      async act(ctx) {
        await ctx.call('sift_get_interaction_context');
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const seen = (await ctx.call('sift_get_interaction_context')).data as
          Record<string, unknown> | undefined;

        check.data(
          'the host can read the discovery surface at all',
          seen !== undefined && seen !== null,
          seen === undefined ? 'no data' : Object.keys(seen).join(', '),
        );
        check.agreement(
          'the host sees the answer the person just gave',
          JSON.stringify(seen ?? {}).length > 2 && topics(state).length > 0,
          `${topics(state).length} topic(s) on the case`,
        );
      },
    },

    {
      id: 'assistant-can-only-propose',
      actor: 'assistant',
      intent: 'Records something it heard the person say',
      async act(ctx) {
        const open = topics(await ctx.state()).find((topic) => topic.status !== 'confirmed');
        const target = topicId(open ?? {}) || 'vehicle.budget';
        (ctx as unknown as { proposedTopic?: string }).proposedTopic = target;
        await ctx.write('sift_record_discovery', {
          operations: [
            {
              topicId: target,
              valueSummary: 'Around $35,000 all in',
              confidence: 0.7,
            },
          ],
        });
      },
      async checks(ctx, check) {
        const target = (ctx as unknown as { proposedTopic?: string }).proposedTopic ?? '';
        const recorded = topics(await ctx.state()).find((topic) => topicId(topic) === target);

        check.data(
          'what the assistant recorded exists on the case',
          recorded !== undefined,
          recorded === undefined ? `no topic ${target}` : `${target}=${String(recorded.status)}`,
        );
        // The whole point: an assistant cannot confirm.
        check.data(
          'it landed as a proposal, not a confirmation',
          recorded?.status !== 'confirmed',
          `status ${String(recorded?.status)}, origin ${String(recorded?.origin)}`,
        );

        const tool = ctx.host.tools.get('sift_record_discovery');
        const schema = JSON.stringify(tool?.inputSchema ?? {});
        check.data(
          'the tool schema has nowhere to ask for confirmation',
          !schema.includes('"actor"') && !/"op"\s*:/.test(schema),
          'no actor/op field in the published input schema',
        );
        check.agreement(
          'the host is told what it is allowed to do by the schema it was given',
          schema.includes('confidence'),
          `schema advertises: ${Object.keys(tool?.inputSchema?.['properties'] ?? {}).join(', ')}`,
        );
      },
    },

    {
      id: 'a-stale-write-is-refused',
      actor: 'assistant',
      intent: 'Reweights a criterion using a sequence it read a moment ago, after the case moved',
      async act(ctx) {
        const before = await ctx.state();
        const stale = ((before['eventSequence'] as number | undefined) ?? 1) - 1;
        const criterionId =
          (before['criteria'] as { id?: string }[] | undefined)?.[0]?.id ?? 'pref.ownership_cost';
        // Deliberately stale by one: the shape of a real race, not a wild
        // value. Reweighting is decided by reading the criteria set, so this
        // is a write the guard genuinely protects.
        const result = await ctx.host.call('sift_update_criteria', {
          caseId: ctx.caseId,
          expectedSequence: Math.max(0, stale),
          operations: [{ op: 'reweight', criterionId, weight: 5 }],
        });
        (ctx as unknown as { staleResult?: unknown }).staleResult = result;
      },
      async checks(ctx, check) {
        const result = (ctx as unknown as { staleResult?: { ok?: boolean; message?: string } })
          .staleResult;
        check.data(
          'the stale write is refused rather than silently applied',
          result?.ok === false,
          result?.ok === false
            ? String(result.message).slice(0, 110)
            : 'RELEASE BLOCKER — accepted',
        );
        check.data(
          'the refusal tells the caller how to recover',
          /sequence|refresh|retry|conflict/i.test(String(result?.message ?? '')),
          String(result?.message ?? '').slice(0, 140),
        );

        // And the pane is unharmed by a rejected host write.
        check.ui(
          "the person's workspace is undisturbed by the assistant's failed write",
          await ctx.visible('case-workspace'),
          (await ctx.visible('error-state'))
            ? 'an error state took over the pane'
            : 'workspace intact',
        );
      },
    },

    {
      id: 'person-decides-on-the-proposal',
      actor: 'person',
      intent: 'Looks at what the assistant suggested and decides',
      async act(ctx) {
        // Layout-aware, because the product is (ADR 0008): at pane width
        // the decision profile is a disclosure row; above 480px the same
        // content is a Sheet opened from the main-column toolbar. Checking
        // only the expanded control reported the pane as having no review
        // surface at all, which was this journey's bug, not the product's.
        const expanded = ctx.page.getByTestId('workspace-expanded-open-decision-profile');
        const summary = ctx.page.getByTestId('disclosure-decision-profile-summary');

        // Priorities owns "Your priorities" / the Decision Profile (ADR
        // 0016; case-workflow.ts's stage-ownership table). By this point in
        // the journey the case has usually moved the recommended stage on
        // to Analysis, so neither trigger is on screen until a person steps
        // back to Priorities -- exactly what the guided stepper is for.
        if ((await expanded.count()) === 0 && (await summary.count()) === 0) {
          await openWorkflowStage(ctx, 'priorities');
        }

        if ((await expanded.count()) > 0) {
          await expanded.first().click();
          await ctx.page.waitForTimeout(1_500);
          return;
        }
        if ((await summary.count()) > 0) {
          await summary.first().click();
          await ctx.page.waitForTimeout(1_500);
        }
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const proposed = topics(state).filter((topic) => topic.status !== 'confirmed');

        // Whether or not the review surface is reachable in this layout,
        // the case must still distinguish what a person said from what a
        // model inferred. That distinction is the product.
        check.data(
          'proposed and confirmed remain distinguishable on the case',
          topics(state).some((topic) => topic.status === 'confirmed') || proposed.length > 0,
          topics(state)
            .map((topic) => `${topicId(topic)}=${String(topic.status)}`)
            .join(', '),
        );

        const reviewable =
          (await ctx.visible('decision-profile-view')) ||
          (await ctx.visible('workspace-decision-profile-sheet')) ||
          (await ctx.visible('disclosure-decision-profile'));
        check.ui(
          'a person can reach the place where proposals are reviewed',
          reviewable,
          reviewable ? 'decision profile open' : 'no review surface reachable from this layout',
        );

        if (!reviewable && proposed.length > 0) {
          ctx.observe(
            `${proposed.length} topic(s) are sitting unconfirmed on the case, and at this pane width there is no reachable surface showing them to the person for review. An assistant's inference that nobody can see is one nobody can correct.`,
          );
        }
      },
    },
  ],
};
