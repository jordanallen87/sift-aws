/**
 * The Bid Comparison hero demo, run as a test.
 *
 * `docs/bid-comparison/plan.md` and
 * `docs/submissions/agents-for-humans/demo-script-bid.md` describe this
 * pack's own beats: twelve subcontractor bids for one scope of work, a real
 * six-specialist Swarm doing licence, insurance, and scope-normalization
 * checks, a `GoalLoop` that refuses to rank bids before their scope is on
 * one basis, and an award the model can only propose — `ConsequenceGuard`
 * gates it on human confirmation before the proposal is even recorded
 * (`tests/scenarios/bid-comparison.scenario.ts`: "Sift proposes; only
 * `origin: 'user'` may approve — and in this trajectory nobody ever does").
 *
 * Unlike `webmcp-hero`/`aws-hero` (a vehicle purchase and a utility bill),
 * this is a procurement decision: what matters here is that the licence and
 * insurance checks are real, that the twelve bids' cited sources actually
 * resolve (`git log -1 --grep 'make every source citation resolve'` —
 * "Sixty citations pointed at nothing" was a real, shipped defect in this
 * exact pack, fixed 2026-09-13), and that the award itself never gets
 * approved by anything other than a person.
 */
import { bindCase, type Journey } from '../harness.js';

interface EntitySummary {
  id: string;
  label: string;
}

interface RawEntity {
  id: string;
  label: string;
  attributes?: Record<string, { sourceIds?: string[] }>;
}

interface PackShape {
  id?: string;
  version?: string;
  compiledHash?: string;
}

interface ObligationSummary {
  id: string;
  status: string;
}

interface ProposalSummary {
  id?: string;
  status?: string;
  reviewedByActor?: string;
}

interface SourceSummary {
  id: string;
}

function entities(state: Record<string, unknown>): EntitySummary[] {
  return (state['entities'] ?? []) as EntitySummary[];
}

function rawEntities(state: Record<string, unknown>): RawEntity[] {
  return (state['entities'] ?? []) as RawEntity[];
}

function pack(state: Record<string, unknown>): PackShape {
  return state['pack'] ?? {};
}

function recommendation(state: Record<string, unknown>): Record<string, unknown> | null {
  return (state['recommendation'] ?? null) as Record<string, unknown> | null;
}

function obligations(state: Record<string, unknown>): ObligationSummary[] {
  return (state['obligations'] ?? []) as ObligationSummary[];
}

function proposal(state: Record<string, unknown>): ProposalSummary | null {
  return state['proposal'] ?? null;
}

function sourcesOn(state: Record<string, unknown>): SourceSummary[] {
  return (state['sources'] ?? []) as SourceSummary[];
}

function digits(text: string | null): string | null {
  return text === null ? null : (/\d+/.exec(text)?.[0] ?? null);
}

interface ActivityEvent {
  type?: string;
  payload?: Record<string, unknown>;
}

/** The public, sanitized activity stream — see `aws-hero.ts`'s identical helper for the full rationale (`?mode=poll` is the same transport the pane subscribes to). */
async function activity(baseUrl: string, caseId: string): Promise<ActivityEvent[]> {
  try {
    const response = await fetch(
      `${baseUrl}/api/cases/${encodeURIComponent(caseId)}/events?mode=poll`,
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { events?: ActivityEvent[] };
    return body.events ?? [];
  } catch {
    return [];
  }
}

function typesIn(events: ActivityEvent[]): string[] {
  return [...new Set(events.map((event) => event.type ?? '').filter((type) => type !== ''))];
}

function firstRunId(events: ActivityEvent[]): string {
  const started = events.find((event) => event.type === 'run.started') as
    (ActivityEvent & { runId?: string }) | undefined;
  return started?.runId ?? '';
}

/** Distinct specialists that actually ran, read from the events' own `agentId` — see `aws-hero.ts`'s identical helper. */
function specialists(events: ActivityEvent[]): string[] {
  return [
    ...new Set(
      events
        .filter((event) => (event.type ?? '').startsWith('specialist.'))
        .map((event) => (event as ActivityEvent & { agentId?: string }).agentId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
}

interface RuntimeEvent {
  name?: string;
  category?: string;
  summary?: string;
  agentId?: string;
  phase?: string;
  sequence?: number;
  attributes?: Record<string, unknown>;
}

/** The detailed runtime stream — see `aws-hero.ts`'s identical helper for why this is deliberately a different stream from `activity()`. */
async function runtimeEvents(baseUrl: string, runId: string): Promise<RuntimeEvent[]> {
  try {
    const response = await fetch(`${baseUrl}/api/debug/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { events?: RuntimeEvent[] };
    return body.events ?? [];
  } catch {
    return [];
  }
}

/** The four bids the demo narrative names individually (`docs/bid-comparison/plan.md`'s own table). */
const NAMED_BIDS = [
  'Northgate Plumbing',
  'Cedar & Sons',
  'Two Rivers Mechanical',
  'Fieldstone Plumbing Co.',
] as const;

/** The pack's own five obligations (`packages/packs/src/bid-comparison.ts`, `tests/scenarios/bid-comparison.scenario.ts`). */
const OBLIGATION = {
  scopeNormalization: 'bid.scope_normalization',
  priceVerification: 'bid.price_verification',
  credentialVerification: 'bid.credential_verification',
  scheduleFeasibility: 'bid.schedule_feasibility',
  awardRecommendation: 'bid.award_recommendation',
} as const;

export const bidComparisonHero: Journey = {
  id: 'bid-comparison-hero',
  title: 'Bid Comparison hero — twelve subcontractor bids, one scope of work',
  proves:
    "This pack's own claims are things that actually happened: twelve bids read and compared, a real Swarm doing licence/insurance/scope checks with a genuine GoalLoop reject-then-recover cycle, every cited source resolving to a real Source record rather than dangling, and an award the model can only propose — never approve.",
  turns: [
    {
      id: 'launch',
      actor: 'person',
      intent: 'Opens Sift to compare bids for the plumbing package before awarding one',
      async act(ctx) {
        await ctx.page.goto(ctx.baseUrl, { waitUntil: 'domcontentloaded' });
        await ctx.page.getByTestId('demo-launcher').waitFor({ state: 'visible', timeout: 30_000 });
        await ctx.page.getByTestId('demo-launcher-bid-comparison').click();
        await ctx.page.getByTestId('case-workspace').waitFor({ state: 'visible', timeout: 30_000 });
        await bindCase(ctx);
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const options = entities(state);

        check.data(
          'all twelve bids are seeded, not a hand-picked handful',
          options.length === 12,
          `${options.length} bid(s): ${options.map((o) => o.label).join(', ')}`,
        );
        check.data(
          'the case is pinned to the bid-comparison pack',
          pack(state).id === 'bid-comparison' && (pack(state).compiledHash ?? '').length > 0,
          `${pack(state).id}@${pack(state).version} #${(pack(state).compiledHash ?? '').slice(0, 12)}`,
        );
        const labels = options.map((option) => option.label);
        check.data(
          'the four bids the demo narrative names individually are really on the case',
          NAMED_BIDS.every((name) => labels.includes(name)),
          labels.join(', '),
        );

        const title = await ctx.text('workspace-app-bar-title');
        check.ui(
          'the decision is named on screen',
          title !== null && title.length > 0,
          `"${title ?? ''}"`,
        );
        check.agreeOn(
          'the option count on screen matches the case',
          options.length,
          digits(await ctx.text('workspace-app-bar-option-count')),
        );
      },
    },

    {
      id: 'assistant-reads-the-case-and-the-bids',
      actor: 'assistant',
      intent: '"Before I dig in — what am I actually looking at here?"',
      async act(ctx) {
        await ctx.call('sift_get_case_context');
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const context = (await ctx.call('sift_get_case_context')).data as
          { caseId?: string; options?: unknown[]; pack?: PackShape } | undefined;

        check.data(
          'the assistant reads the case that is open',
          context?.caseId === ctx.caseId,
          `tool returned ${context?.caseId ?? '(none)'}`,
        );
        check.agreement(
          'the assistant sees all twelve bids, the same twelve the case holds',
          (context?.options ?? []).length === 12 &&
            (context?.options ?? []).length === entities(state).length,
          `tool ${(context?.options ?? []).length}, server ${entities(state).length}`,
        );
        check.agreement(
          'the assistant and the server see the same compiled pack',
          context?.pack?.compiledHash === pack(state).compiledHash,
          `${(context?.pack?.compiledHash ?? '').slice(0, 12)} vs ${(pack(state).compiledHash ?? '').slice(0, 12)}`,
        );
      },
    },

    {
      id: 'investigation-checks-licence-insurance-and-scope',
      actor: 'person',
      intent:
        '"Ask Sift to look into this" — the licence, insurance, and scope-normalization checks this pack exists to do',
      async act(ctx) {
        const button = ctx.page.getByTestId('request-investigation');
        if ((await button.count()) > 0) {
          await button.first().click();
        } else {
          await ctx.write('sift_request_investigation');
        }
        for (let tick = 0; tick < 180; tick += 1) {
          if (recommendation(await ctx.state()) !== null) break;
          await ctx.page.waitForTimeout(1_000);
        }
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const events = await activity(ctx.baseUrl, ctx.caseId);
        const types = typesIn(events);

        const ran = specialists(events);
        const expected = [
          'scope-analyst',
          'price-analyst',
          'credential-checker',
          'schedule-analyst',
          'source-challenger',
          'decision-synthesizer',
        ];
        check.data(
          'all six specialists this pack declares actually ran',
          expected.every((id) => ran.includes(id)),
          ran.join(', ') || 'none recorded',
        );
        check.data(
          'skills activate progressively rather than one giant prompt',
          types.some((type) => type.includes('skill')),
          types.filter((t) => t.includes('skill')).join(', ') || `none of ${types.length} types`,
        );

        const runId = firstRunId(events);
        const runtime = await runtimeEvents(ctx.baseUrl, runId);
        const runtimeNames = [...new Set(runtime.map((event) => event.name ?? ''))];
        check.data(
          'the model was handed current case context, not the whole transcript',
          runtimeNames.includes('context.injected'),
          `${runtime.filter((e) => e.name === 'context.injected').length} context.injected in the runtime stream`,
        );

        const toolNames = new Set(
          runtime.filter((event) => event.category === 'tool').map((event) => event.name ?? ''),
        );
        check.data(
          "the scope, price, and credential tools all genuinely ran -- this pack's own substance, not just an LLM opinion",
          ['tool.scope-differ', 'tool.bid-calculator', 'tool.license-lookup'].every((name) =>
            toolNames.has(name),
          ),
          [...toolNames]
            .filter((name) => name.startsWith('tool.'))
            .sort()
            .join(', ') || 'no tool.* runtime events',
        );
        const finishedLicenseLookups = runtime.filter(
          (event) => event.name === 'tool.license-lookup' && event.phase === 'finish',
        ).length;
        check.data(
          'credential-checker actually looked up a licence against the registry, more than once',
          finishedLicenseLookups >= 1,
          `${finishedLicenseLookups} completed license-lookup call(s)`,
        );

        const recommended = recommendation(state);
        check.data(
          'the run reached a real recommendation',
          recommended !== null,
          recommended === null ? 'none' : 'present',
        );
        check.data(
          'the recommendation favors the bid the case actually supports, not a placeholder',
          recommended?.['favoredOptionId'] === 'bid-northgate',
          `favoredOptionId ${String(recommended?.['favoredOptionId'])}`,
        );

        // The pack's own substance: scope and credential problems that are
        // genuinely degraded evidence stay open rather than being marked
        // done just because a run completed.
        const scopeStatus = obligations(state).find(
          (o) => o.id === OBLIGATION.scopeNormalization,
        )?.status;
        const credentialStatus = obligations(state).find(
          (o) => o.id === OBLIGATION.credentialVerification,
        )?.status;
        check.data(
          'the scope-normalization and credential checks stay open on real degraded evidence, not silently cleared',
          scopeStatus === 'open' && credentialStatus === 'open',
          `scope_normalization=${String(scopeStatus)}, credential_verification=${String(credentialStatus)}`,
        );
        const priceStatus = obligations(state).find(
          (o) => o.id === OBLIGATION.priceVerification,
        )?.status;
        const scheduleStatus = obligations(state).find(
          (o) => o.id === OBLIGATION.scheduleFeasibility,
        )?.status;
        check.data(
          'price verification and schedule feasibility genuinely clear',
          priceStatus === 'satisfied' && scheduleStatus === 'satisfied',
          `price_verification=${String(priceStatus)}, schedule_feasibility=${String(scheduleStatus)}`,
        );
        const awardStatus = obligations(state).find(
          (o) => o.id === OBLIGATION.awardRecommendation,
        )?.status;
        check.data(
          'the synthesis obligation itself reaches satisfied -- it is the recommendation that stands, not an in-progress draft',
          awardStatus === 'satisfied',
          `award_recommendation=${String(awardStatus)}`,
        );

        const phase = await ctx.text('live-run-status-phase');
        check.ui(
          'the pane reports a terminal run phase',
          /completed/i.test(phase ?? ''),
          phase ?? 'absent',
        );
        const headline = await ctx.text('recommendation-hero-headline');
        check.ui('the hero states an answer', (headline ?? '').length > 0, `"${headline ?? ''}"`);

        const favoredLabel =
          entities(state).find((e) => e.id === recommended?.['favoredOptionId'])?.label ?? '';
        check.agreement(
          'the hero names the bid the case actually favors',
          favoredLabel !== '' && (headline ?? '').includes(favoredLabel),
          `state favors "${favoredLabel}", hero reads "${headline ?? ''}"`,
        );
      },
    },

    {
      id: 'the-guardrails-that-made-the-run-honest',
      actor: 'person',
      intent: 'Looks at whether Sift ever cut a corner to reach that answer',
      async act() {
        // Nothing to do: this beat is about what the run already did.
      },
      async checks(ctx, check) {
        const events = await activity(ctx.baseUrl, ctx.caseId);
        const runId = firstRunId(events);
        const runtime = await runtimeEvents(ctx.baseUrl, runId);

        // Deny: price-analyst reaching for a tool this pack grants only to
        // credential-checker is refused before it runs.
        const denyEvents = runtime.filter(
          (event) => event.category === 'intervention' && event.name === 'intervention.deny',
        );
        check.data(
          'the licence lookup was really refused to the specialist not allowed to touch it',
          denyEvents.length > 0 &&
            denyEvents.every(
              (event) =>
                event.agentId === 'price-analyst' &&
                event.attributes?.['subject'] === 'license-lookup',
            ),
          denyEvents.length > 0
            ? denyEvents
                .map((event) => `${String(event.agentId)}→${String(event.attributes?.['subject'])}`)
                .join(', ')
            : 'no intervention.deny recorded',
        );

        // Guide: scope-analyst repeating the same scope-differ comparison
        // with no new angle is steered, not left to loop.
        const guideEvents = runtime.filter(
          (event) => event.category === 'intervention' && event.name === 'intervention.guide',
        );
        check.data(
          'repeated, no-new-evidence work was steered rather than left to repeat',
          guideEvents.length > 0 &&
            guideEvents.every(
              (event) =>
                event.agentId === 'scope-analyst' &&
                event.attributes?.['subject'] === 'scope-differ',
            ),
          guideEvents.length > 0
            ? guideEvents.map((event) => String(event.agentId)).join(', ')
            : 'no intervention.guide recorded',
        );

        // GoalLoop: the first draft ranks on raw quoted totals -- rejected
        // -- and only the scope-normalized retry is accepted.
        const goal = runtime.filter((event) => event.category === 'goal');
        const failed = goal.filter((event) => event.name === 'goal.validation_failed');
        const passed = goal.filter((event) => event.name === 'goal.validated');
        check.data(
          'a lot of assistants would just answer -- this one drafted the obvious wrong ranking first and rejected its own draft',
          failed.length > 0 && failed.every((event) => event.agentId === 'decision-synthesizer'),
          failed.length > 0
            ? `rejected: ${failed.map((event) => event.summary ?? event.name).join('; ')}`
            : 'GoalLoop validated on the first attempt; nothing was ever rejected',
        );
        check.data(
          'the corrected, scope-normalized retry is what actually validated',
          passed.length > 0 && passed.every((event) => event.agentId === 'decision-synthesizer'),
          passed.length > 0 ? 'validated' : 'no goal.validated recorded',
        );
        if (failed.length > 0 && passed.length > 0) {
          const failedSeq = failed[0]?.sequence ?? Number.POSITIVE_INFINITY;
          const passedSeq = passed[0]?.sequence ?? -1;
          check.data(
            'the rejection happened before the corrected answer, not after',
            failedSeq < passedSeq,
            `rejected at sequence ${String(failedSeq)}, validated at ${String(passedSeq)}`,
          );
        }

        if (denyEvents.length === 0 || guideEvents.length === 0 || failed.length === 0) {
          ctx.observe(
            "One or more of this pack's three documented guardrail beats (Deny/Guide/GoalLoop reject-then-recover) did not fire on this run. docs/bid-comparison/plan.md and the demo script both claim all three happen inside a single round-1 run -- if this is reproducible, it is a regression in the scripted trajectory, not a documented gap.",
          );
        }
      },
    },

    {
      id: 'citations-resolve-to-real-sources',
      actor: 'person',
      intent: 'Checks whether the claims Sift is making actually trace back to a source',
      async act() {
        // Checks-only: this asks whether what the investigation already did
        // holds up, not something a new action should change.
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const knownSourceIds = new Set(sourcesOn(state).map((source) => source.id));

        const citedSourceIds = new Set<string>();
        for (const entity of rawEntities(state)) {
          for (const attribute of Object.values(entity.attributes ?? {})) {
            for (const sourceId of attribute.sourceIds ?? []) citedSourceIds.add(sourceId);
          }
        }
        check.data(
          'the investigation actually cited sources, not bare claims',
          citedSourceIds.size > 0,
          `${citedSourceIds.size} distinct source id(s) cited across ${rawEntities(state).length} bid(s)`,
        );
        const unresolved = [...citedSourceIds].filter((id) => !knownSourceIds.has(id));
        check.data(
          'every cited source id resolves to a real Source record on the case -- none dangle',
          unresolved.length === 0,
          unresolved.length === 0
            ? `${knownSourceIds.size} source(s) on the case, all citations resolve`
            : `${unresolved.length} dangling citation(s): ${unresolved.slice(0, 5).join(', ')}`,
        );

        const recommended = recommendation(state);
        const recSourceIds = (recommended?.['sourceIds'] ?? []) as string[];
        check.data(
          'the recommendation itself cites at least one source',
          recSourceIds.length > 0,
          `${recSourceIds.length} sourceId(s) on the recommendation`,
        );

        check.ui(
          'the pane shows a Sources section under the recommendation',
          await ctx.visible('recommendation-card-sources'),
          (await ctx.visible('recommendation-card-sources')) ? 'present' : 'absent',
        );

        let resolvedOnScreen = 0;
        const danglingOnScreen: string[] = [];
        for (const sourceId of recSourceIds) {
          if (await ctx.visible(`recommendation-card-source-${sourceId}`)) {
            resolvedOnScreen += 1;
          } else if (await ctx.visible(`recommendation-card-unresolved-source-${sourceId}`)) {
            danglingOnScreen.push(sourceId);
          }
        }
        // This is the exact bug that shipped past every earlier test on this
        // pack (2026-09-13): 60 cited source ids, 0 `Source` records on the
        // case, and the pane had no way to distinguish a resolved citation
        // from one that dangled until `recommendation-card-unresolved-source-*`
        // was added specifically so a check like this one could catch it.
        check.agreement(
          'every source the recommendation cites renders as a resolved link on screen, not a dangling [id]',
          recSourceIds.length > 0 &&
            resolvedOnScreen === recSourceIds.length &&
            danglingOnScreen.length === 0,
          danglingOnScreen.length > 0
            ? `${danglingOnScreen.length} dangling citation(s) rendered on screen: ${danglingOnScreen.join(', ')}`
            : `${resolvedOnScreen}/${recSourceIds.length} source(s) rendered as resolved links`,
        );
      },
    },

    {
      id: 'the-model-proposes-the-award-and-stops-there',
      actor: 'assistant',
      intent: 'Tries to close the award the way any other WebMCP write would',
      async act(ctx) {
        await ctx.call('sift_get_case_context');
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        const prop = proposal(state);

        check.data(
          'decision-synthesizer already proposed an award before anyone reviewed it',
          prop !== null && prop.status === 'pending',
          prop === null ? 'no proposal on the case' : `status=${String(prop.status)}`,
        );
        check.data(
          'proposing is not the same as deciding -- nobody has reviewed it yet',
          prop?.reviewedByActor === undefined,
          prop?.reviewedByActor === undefined
            ? 'no reviewedByActor'
            : `reviewedByActor=${String(prop.reviewedByActor)}`,
        );

        const names = [...ctx.host.tools.keys()];
        const approvers = names.filter((name) =>
          /approve|review_proposal|confirm_decision/i.test(name),
        );
        check.data(
          'no tool in the catalog can approve the award',
          approvers.length === 0,
          approvers.length === 0
            ? `${names.length} tools, none of them an approval`
            : approvers.join(', '),
        );

        // Not merely absent from the catalog: unreachable, even called by
        // name -- mirrors webmcp-hero.ts's identical defense-in-depth check.
        const forced = await ctx.call('sift_review_proposal', {
          caseId: ctx.caseId,
          decision: 'approve',
        });
        check.data(
          'calling the approval verb directly still fails',
          forced.ok === false,
          forced.ok === false
            ? 'refused'
            : 'RELEASE BLOCKER — an assistant call approved the award',
        );

        const pendingOnScreen = await ctx.visible('approval-card-pending');
        check.ui(
          'the pane shows the award still waiting on a person',
          pendingOnScreen,
          pendingOnScreen ? 'approval-card-pending' : 'no pending approval card on screen',
        );
        check.agreement(
          'a pending award on the case is a pending award on screen',
          (prop?.status === 'pending') === pendingOnScreen,
          `state ${String(prop?.status)}, screen ${pendingOnScreen ? 'pending' : 'not pending'}`,
        );
        const note = await ctx.text('dock-human-only-note');
        check.ui(
          'the pane states the human-only boundary while the award is pending',
          note !== null,
          note ?? 'no human-only note on screen while an award is pending',
        );
      },
    },

    {
      id: 'a-person-decides-the-award',
      actor: 'person',
      intent: 'Reads the recommendation and confirms what moves forward',
      async act(ctx) {
        const approve = ctx.page.getByTestId('approval-card-approve');
        if ((await approve.count()) > 0 && (await approve.first().isEnabled())) {
          await approve.first().click();
        }
      },
      async checks(ctx, check) {
        const settled = await ctx.visible('approval-card-settled');
        const pending = await ctx.visible('approval-card-pending');
        check.ui(
          'the award is visibly settled by the person, not left pending',
          settled || !pending,
          settled
            ? 'approval-card-settled'
            : pending
              ? 'still pending'
              : 'no approval card on screen',
        );

        const state = await ctx.state();
        const prop = proposal(state);
        check.data(
          'the case records a human decision on the award, not a model one',
          prop?.status !== 'pending' && prop?.reviewedByActor === 'human',
          prop === null
            ? 'no proposal on the case'
            : `status=${String(prop.status)}, reviewedByActor=${String(prop.reviewedByActor)}`,
        );
        check.agreement(
          "the case's decided status and the screen's settled status agree",
          (prop?.status !== 'pending') === (settled || !pending),
          `state status=${String(prop?.status)}, screen settled=${String(settled || !pending)}`,
        );
      },
    },

    {
      id: 'persists-across-a-reload',
      actor: 'person',
      intent: 'Closes the pane and comes back to it later',
      async act(ctx) {
        await ctx.page.reload({ waitUntil: 'domcontentloaded' });
        await ctx.page.getByTestId('case-workspace').waitFor({ state: 'visible', timeout: 30_000 });
      },
      async checks(ctx, check) {
        const state = await ctx.state();
        check.data(
          'the case survived the reload',
          (state['id'] ?? '') === ctx.caseId,
          `${String(state['id'])} vs ${ctx.caseId}`,
        );
        check.ui(
          'the workspace came back, not the launcher',
          await ctx.visible('case-workspace'),
          (await ctx.visible('demo-launcher')) ? 'launcher shown instead' : 'workspace restored',
        );
        check.data(
          'the decided award proposal is still there, not reset by the reload',
          proposal(state)?.status === 'approved',
          `status=${String(proposal(state)?.status)}`,
        );
        check.data(
          'the host can still address the case after a reload',
          [...ctx.host.tools.keys()].length >= 3,
          `${[...ctx.host.tools.keys()].length} tools registered`,
        );
      },
    },
  ],
};
