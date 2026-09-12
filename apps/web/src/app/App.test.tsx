import { StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { PRESENTATION_ONLY_ACTIVITY_DETAIL } from '@sift/contracts';
import type { CaseState, CommandReceipt, PublicActivityEvent } from '@sift/contracts';
import { buildVehicleCatalogRecord } from '@sift/catalog/test-support';
import { App } from './App.js';
import { AppProviders } from './AppProviders.js';
import {
  FIRST_RUN_GUIDE_STORAGE_KEY,
  hasSeenFirstRunGuide,
  markFirstRunGuideSeen,
} from './first-run-storage.js';
import { createFakeSiftCommands, buildFakeCommandReceipt } from '../test/fake-sift-commands.js';
import { buildFixtureCaseState, buildFixtureCompiledPack } from '../test/fixtures.js';
import { FakeEventSource, createFakeEventSource } from '../test/fake-event-source.js';
import {
  InMemoryModelContextAdapter,
  type WebMcpRegisterOptions,
  type WebMcpToolDefinition,
} from '../model-context/adapter.js';
import {
  CASE_SCOPED_SIFT_TOOL_NAMES,
  GLOBAL_SIFT_TOOL_NAMES,
} from '../model-context/register-sift-tools.js';
import { renderAtNarrowWidth } from '../test/narrow-viewport.js';
import { buildCarCaseState } from '../test/scoreboard-fixtures.js';

const CASE_ID = 'case-live-1';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
// Defensive, independent of any individual test's own `vi.unstubAllGlobals()`
// call: several tests in this file `vi.stubGlobal('matchMedia', ...)` (see
// `stubExpandedLayout()` above) to exercise ADR 0008's expanded layout. If
// one of those tests fails/throws BEFORE reaching its own cleanup call, the
// stub would otherwise silently leak into every later test in this file --
// forcing `useWidthMode()` to `'expanded'` everywhere else too, which
// reads as an unrelated cascade of failures far from the real cause. This
// runs after every test regardless of how it exits.
afterEach(() => vi.unstubAllGlobals());
afterAll(() => server.close());

beforeEach(() => {
  FakeEventSource.reset();
  // `App`'s reload-restore feature (`active-case-storage.ts`) persists a
  // pointer to the active case id in `localStorage`. jsdom's `localStorage`
  // is not reset between tests automatically (unlike a real browser's
  // fresh-per-session storage in these tests' single shared jsdom window),
  // so an earlier test's real `startDemo` would otherwise leak a stored
  // caseId into every later test in this file, making `App` render the
  // "Restoring your case…" state instead of the plain launcher it expects.
  localStorage.clear();
  // `App` shows `FirstRunGuide` -- a modal Radix Dialog -- on the FIRST case
  // ever opened in a browser (`first-run-storage.ts`), which is what a
  // freshly-cleared `localStorage` above describes. Left unset, that
  // overlay would open over every case-workspace test in this file and
  // `aria-hidden` the workspace underneath it, so every `getByRole` query
  // here would start failing for a reason that has nothing to do with what
  // it is testing. This is exactly the seam Playwright's `SiftPage.open()`
  // uses for the same reason: seed the real production storage key that a
  // returning visitor would already have, never a test-only code path.
  // 'first-run guide' below deliberately clears it again to test the
  // unseeded, genuine first-visit behaviour.
  markFirstRunGuideSeen();
});

function pollHandler(snapshot: CaseState, events: PublicActivityEvent[] = []) {
  return http.get(`/api/cases/${CASE_ID}/events`, ({ request }) => {
    const url = new URL(request.url);
    const after = Number(url.searchParams.get('afterSequence') ?? '0');
    return HttpResponse.json({
      snapshot,
      events: events.filter((event) => event.sequence > after),
    });
  });
}

// Matches the real server contract exactly (`apps/agent/src/routes/packs.ts`
// `ListPacksResponseSchema`: `{ packs: [...] }`, never a bare array) -- see
// `App.tsx`'s own `InstalledPacksResponseSchema` comment for the real,
// previously-silent bug this mock's earlier bare-array shape masked.
function packsHandler(packs: ReturnType<typeof buildFixtureCompiledPack>[]) {
  return http.get('/api/packs', () => HttpResponse.json({ packs }));
}

function commandHandler(
  commandName: string,
  receipt: CommandReceipt,
  onCall?: (body: unknown) => void,
) {
  return http.post(`/api/cases/${CASE_ID}/commands/${commandName}`, async ({ request }) => {
    onCall?.(await request.json());
    return HttpResponse.json(receipt);
  });
}

function runHandler(receipt: CommandReceipt & { runId: string }, onCall?: (body: unknown) => void) {
  return http.post(`/api/cases/${CASE_ID}/run`, async ({ request }) => {
    onCall?.(await request.json());
    return HttpResponse.json(receipt);
  });
}

function debugRunHandler(runId: string) {
  return http.get(`/api/debug/runs/${runId}`, () =>
    HttpResponse.json({
      overview: {
        runId,
        caseId: CASE_ID,
        obligationId: 'car.deal_normalization',
        traceId: 'trace-1',
        sessionId: null,
        status: 'completed',
        startedAt: '2026-08-27T00:00:00.000Z',
        completedAt: '2026-08-27T00:00:05.000Z',
        durationMs: 5000,
        eventCount: 1,
        countsByCategory: { tool: 1 },
        countsByLevel: { info: 1 },
        errorCount: 0,
        tokenUsage: null,
        estimatedCostUsd: null,
      },
      events: [
        {
          schemaVersion: '1.0',
          sequence: 0,
          timestamp: '2026-08-27T00:00:00.000Z',
          traceId: 'trace-1',
          caseId: CASE_ID,
          runId,
          category: 'tool',
          name: 'tool.listing_reader',
          phase: 'start',
          level: 'info',
          summary: 'Calling tool "listing_reader".',
          attributes: {},
          redactions: [],
          id: 'debug-1',
        },
      ],
    }),
  );
}

const DEFAULT_PACK = buildFixtureCompiledPack({
  entities: [{ id: 'car', label: 'Car', attributeIds: [] }],
});

// `packs` is a parameter rather than a fixed `[DEFAULT_PACK]` because
// `App` resolves `activePack` from `/api/packs` synchronously inside its
// own mount effect -- a `server.use(packsHandler(...))` call issued after
// `render()` returns is already too late to be the pack the workspace runs
// on. Every existing caller keeps the previous behaviour by omitting it.
function renderLiveWorkspace(
  snapshot: CaseState,
  events: PublicActivityEvent[] = [],
  packs: ReturnType<typeof buildFixtureCompiledPack>[] = [DEFAULT_PACK],
) {
  server.use(
    http.post('/api/cases/demo', () =>
      HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID, commandId: 'cmd-start' })),
    ),
    pollHandler(snapshot, events),
    packsHandler(packs),
  );

  const adapter = new InMemoryModelContextAdapter();
  const utils = render(
    <AppProviders
      caseEventsConfig={{ createEventSource: createFakeEventSource }}
      webMcpAdapter={adapter}
    >
      <App />
    </AppProviders>,
  );
  return { ...utils, adapter };
}

async function startDemoAndWait() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
  await waitFor(() => {
    expect(screen.getByTestId('case-workspace')).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument();
  });
  return user;
}

// "What Sift found" is reached from the Analysis stage, not from the app bar
// and not from a disclosure row. ADR 0008 first promoted it out of the
// bottom-of-page stack into a `WorkspaceAppBar` control; ADR 0016 then gave
// it a conceptual home instead of global app-bar priority ("Findings and
// references stop consuming global app-bar priority and gain an explicit
// conceptual home" -- Analysis owns "findings, sources/citations, activity").
// Tests that need a real evidence-card control open the sheet the way a
// person does: from the Analysis stage.
async function openFindingsSheet(user: ReturnType<typeof userEvent.setup>) {
  // Findings have two real entry points, and which one exists depends on the
  // rendered layout -- so this reaches the sheet the way a person at that
  // width actually would, rather than assuming one of them.
  //
  // Expanded: the `WorkspaceAppBar` control ADR 0008 promoted out of the
  // bottom-of-page stack. Narrow: the Analysis stage, where ADR 0016 gave
  // findings a conceptual home instead of global app-bar priority. The
  // guided stepper is narrow-only (`layout === 'narrow'` in `App.tsx`), so
  // at expanded width there is no stage to navigate to at all.
  const appBarControl = screen.queryByTestId('workspace-app-bar-findings');
  if (appBarControl !== null) {
    await user.click(appBarControl);
  } else {
    if (screen.queryByTestId('case-stage-analysis-open-findings') === null) {
      await user.click(screen.getByTestId('case-workflow-stepper-toggle'));
      await user.click(screen.getByTestId('case-workflow-step-analysis'));
    }
    await user.click(screen.getByTestId('case-stage-analysis-open-findings'));
  }
  await waitFor(() => {
    expect(screen.getByTestId('findings-sheet')).toBeInTheDocument();
  });
}

// ADR 0016's five guided steps each own a slice of the workspace now
// (`App.tsx`'s `stageOwns`), so a region is on screen when its own step is --
// Review owns Quick Pick/List/Compare/Board and the filter bar, Priorities
// owns the Decision Profile, Decide owns the approval controls. A test that
// needs one of those reaches it the way a person does: by pressing the step
// that owns it, rather than assuming one flat screen holds everything.
//
// The narrow stepper (jsdom's default, since `useWidthMode()` has no
// `matchMedia` to read) keeps its step list behind the compact progress
// affordance ADR 0016 specifies; expanded renders all five labels inline. So
// this opens the list only when there is one to open, and uses the same
// `case-workflow-step-<id>` testid either way.
async function goToWorkflowStage(
  user: ReturnType<typeof userEvent.setup>,
  stageId: 'intake' | 'priorities' | 'analysis' | 'review' | 'decide',
) {
  if (screen.queryByTestId(`case-workflow-step-${stageId}`) === null) {
    await user.click(screen.getByTestId('case-workflow-stepper-toggle'));
  }
  await user.click(await screen.findByTestId(`case-workflow-step-${stageId}`));
}

// The three create actions ("Add option", "Add a note", "Add a question")
// are one app-bar menu now, in BOTH layouts -- and "Add a note"/"Add a
// question" are no longer bottom-of-stack `DisclosureSection` rows at all
// (the project owner: "Add a note and add a question should be in either the
// header or footer toolbars -- not at the bottom of the stack"). Every test
// that needs one of those surfaces reaches it the way a person does: open
// the menu, pick the item, wait for the sheet it opens.
async function openCreateMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  itemTestId: string,
  sheetTestId: string,
) {
  await user.click(screen.getByTestId('workspace-app-bar-create-menu'));
  await user.click(await screen.findByTestId(itemTestId));
  await waitFor(() => {
    expect(screen.getByTestId(sheetTestId)).toBeInTheDocument();
  });
}

// ADR 0008: `layout === 'expanded'` (web app / "shopping site" mode) is
// only reachable in jsdom by stubbing `matchMedia`, since jsdom has no real
// implementation and `useWidthMode()` falls back to `'narrow'` otherwise
// (`use-width-mode.ts`'s own header comment). Hoisted here (rather than
// duplicated per describe block) so every expanded-mode test in this file
// shares one implementation.
function stubExpandedLayout() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

describe('App', () => {
  it('renders the demo launcher when no case is active', () => {
    render(
      <AppProviders commandsClient={createFakeSiftCommands()}>
        <App />
      </AppProviders>,
    );

    expect(screen.getByTestId('demo-launcher')).toBeInTheDocument();
    expect(screen.queryByTestId('case-workspace')).not.toBeInTheDocument();
  });

  it('transitions from the launcher to the case workspace once a demo starts', async () => {
    const receipt = buildFakeCommandReceipt({ caseId: 'case-abc' });
    const commands = createFakeSiftCommands({
      startDemo: () => Promise.resolve(receipt),
    });
    const user = userEvent.setup();

    render(
      <AppProviders commandsClient={commands}>
        <App />
      </AppProviders>,
    );

    await user.click(screen.getByRole('button', { name: 'Choose our next car' }));

    await waitFor(() => {
      expect(screen.getByTestId('case-workspace')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('demo-launcher')).not.toBeInTheDocument();
  });

  it('transitions launcher -> catalog -> back to launcher, and launcher -> catalog -> case workspace once a case is created', async () => {
    server.use(
      http.get('/api/catalog/makes', () => HttpResponse.json({ makes: ['Toyota'] })),
      http.get('/api/catalog/body-styles', () => HttpResponse.json({ bodyStyles: ['Sedan'] })),
      http.get('/api/catalog/vehicles', () =>
        HttpResponse.json({
          // Complete, schema-valid records: `catalog-client.ts` Zod-validates
          // this response, so a hand-written partial would fail validation
          // rather than exercise the launcher -> catalog -> workspace
          // transition these assertions are actually about.
          records: [
            buildVehicleCatalogRecord({
              id: 'veh-camry-1',
              year: 2025,
              make: 'Toyota',
              model: 'Camry',
              bodyStyle: 'Sedan',
              source: { dataset: 'epa-fueleconomy-gov', recordId: '1' },
            }),
            buildVehicleCatalogRecord({
              id: 'veh-corolla-1',
              year: 2025,
              make: 'Toyota',
              model: 'Corolla',
              bodyStyle: 'Sedan',
              source: { dataset: 'epa-fueleconomy-gov', recordId: '2' },
            }),
          ],
          total: 2,
        }),
      ),
    );
    const startCaseReceipt = buildFakeCommandReceipt({ caseId: 'case-catalog-1' });
    const commands = createFakeSiftCommands({
      startCase: () => Promise.resolve(startCaseReceipt),
      upsertOption: () => Promise.resolve(buildFakeCommandReceipt({ caseId: 'case-catalog-1' })),
    });
    const user = userEvent.setup();

    render(
      <AppProviders commandsClient={commands}>
        <App />
      </AppProviders>,
    );

    await user.click(screen.getByTestId('demo-launcher-compare-vehicles'));
    await waitFor(() => {
      expect(screen.getByTestId('vehicle-catalog-flow')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('demo-launcher')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('vehicle-catalog-back'));
    expect(screen.getByTestId('demo-launcher')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-catalog-flow')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('demo-launcher-compare-vehicles'));
    await waitFor(() => {
      expect(screen.getByTestId('vehicle-card-veh-camry-1')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('vehicle-add-veh-camry-1'));
    await user.click(screen.getByTestId('vehicle-add-veh-corolla-1'));
    await user.click(screen.getByTestId('vehicle-catalog-start-comparison'));

    await waitFor(() => {
      expect(screen.getByTestId('case-workspace')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('vehicle-catalog-flow')).not.toBeInTheDocument();
  });

  it('has no routing chrome -- renders exactly one top-level region at a time', () => {
    render(
      <AppProviders commandsClient={createFakeSiftCommands()}>
        <App />
      </AppProviders>,
    );

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  describe('reload persistence', () => {
    it('restores the active case from a stored caseId, verified against the real server, on a fresh mount', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, title: 'Restored case' });
      localStorage.setItem('sift:activeCaseId', CASE_ID);
      server.use(
        http.get(`/api/cases/${CASE_ID}`, () => HttpResponse.json(snapshot)),
        pollHandler(snapshot),
        packsHandler([DEFAULT_PACK]),
      );

      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );

      // Never flashes the launcher while restoration is being verified.
      expect(screen.queryByTestId('demo-launcher')).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument();
      });
      expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent('Restored case');
    });

    it('clears a stale stored caseId and falls back to the launcher when the server no longer has that case', async () => {
      localStorage.setItem('sift:activeCaseId', 'case-does-not-exist');
      server.use(
        http.get('/api/cases/case-does-not-exist', () =>
          HttpResponse.json({ error: 'not found' }, { status: 404 }),
        ),
      );

      render(
        <AppProviders commandsClient={createFakeSiftCommands()}>
          <App />
        </AppProviders>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('demo-launcher')).toBeInTheDocument();
      });
      expect(localStorage.getItem('sift:activeCaseId')).toBeNull();
    });
  });

  describe('live workspace wiring', () => {
    it('renders WorkspaceAppBar with the real streamed snapshot title, and never leaks the pack id/badge to the consumer surface', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, title: 'Choose our next car (live)' });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent(
        'Choose our next car (live)',
      );
      // ADR 0004 decision item 1: the Decision Pack badge/id/hash and the
      // pack-selection sentence leave the consumer surface entirely.
      expect(screen.queryByTestId('case-header-pack-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('case-header-pack-explanation')).not.toBeInTheDocument();
      expect(screen.queryByText(/car-purchase/)).not.toBeInTheDocument();
    });

    it('renders the loading state for the header before the first snapshot resolves', async () => {
      // Deliberately never resolves within this test's window.
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        http.get(`/api/cases/${CASE_ID}/events`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json({
            snapshot: buildFixtureCaseState({ id: CASE_ID }),
            events: [],
          });
        }),
        packsHandler([DEFAULT_PACK]),
      );
      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));

      await waitFor(() => {
        expect(screen.getByTestId('case-workspace')).toBeInTheDocument();
      });
      expect(screen.getByTestId('case-workspace-loading')).toHaveAttribute('aria-busy', 'true');
    });

    it('computes readiness from the real evaluateReadiness(core) function over the live snapshot', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        obligations: [
          {
            id: 'obl-1',
            label: 'Confirm total price',
            question: 'What is the out-the-door price?',
            category: 'price',
            required: true,
            priority: 1,
            requiredEvidenceLevel: 'E1',
            maxAttempts: 3,
            acceptedUncertaintyAllowed: false,
            dependsOn: [],
            preferredSkills: [],
            preferredSpecialists: [],
            completionRule: {
              minimumEvidenceLevel: 'E1',
              minimumIndependentSources: 1,
              acceptedUncertaintyAllowed: false,
            },
            origin: 'pack',
            status: 'satisfied',
            attemptsUsed: 1,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('readiness-panel-status')).toHaveTextContent(
          /ready for decision/i,
        );
      });
      expect(screen.getByTestId('readiness-panel-bucket-satisfied-count')).toHaveTextContent('1');
    });

    it('renders live evidence via EvidenceList from the real snapshot', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        sources: [
          {
            id: 'source-1',
            url: 'https://dealer.example.com',
            title: 'Dealer quote',
            retrievedAt: '2026-08-27T00:00:00.000Z',
            origin: 'user_submitted',
            verification: 'unverified',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        ],
        evidenceLinks: [
          {
            id: 'evidence-1',
            obligationId: 'obl-1',
            sourceId: 'source-1',
            level: 'E1',
            verdict: 'pass',
            disposition: 'included',
            summary: 'Confirmed via dealer quote.',
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      await openFindingsSheet(user);

      await waitFor(() => {
        expect(screen.getByTestId('evidence-card-evidence-1')).toBeInTheDocument();
      });
    });

    // Replaces a prior test asserting a live SSE event streamed into
    // `ActivityTimeline`'s raw ledger. ADR 0004 decision item 3/4 moves that
    // raw chronological ledger ("Sift's work so far") to developer content;
    // this is the consumer-surface equivalent -- a live, correlated SSE
    // event still visibly updates the hero's quiet `LiveRunStatus`
    // indicator and flips the headline to the honest "investigating" phase,
    // with no timer or fabricated progress involved (product.md "Real-time
    // experience contract").
    it("streams a live, correlated SSE event into the hero's LiveRunStatus indicator and phase headline", async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      renderLiveWorkspace(snapshot);
      server.use(
        runHandler({ ...buildFakeCommandReceipt({ caseId: CASE_ID }), runId: 'run-stream-1' }),
      );
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('request-investigation'));
      await waitFor(() => {
        expect(screen.getByTestId('live-run-status')).toBeInTheDocument();
      });

      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      const source = FakeEventSource.instances.at(-1)!;
      source.triggerOpen();

      source.emit({
        schemaVersion: '1.0',
        eventId: 'evt-live',
        sequence: 1,
        timestamp: '2026-08-27T00:01:00.000Z',
        caseId: CASE_ID,
        runId: 'run-stream-1',
        type: 'specialist.started',
        phase: 'active',
        summary: 'Deal analyst started working.',
      });

      await waitFor(() => {
        expect(screen.getByTestId('live-run-status-summary')).toHaveTextContent(
          'Deal analyst started working.',
        );
      });
      expect(screen.getByTestId('recommendation-hero-headline')).toHaveTextContent(
        'Sift is investigating.',
      );
    });

    // Regression gate for a real defect found by auditing the client against
    // a live run's actual event stream. `isRunActive` used to be "does the
    // single most recent event carry a non-terminal phase?" -- but roughly
    // half of a real run's ~73 correlated events (`tool.completed`,
    // `skill.activated`, `specialist.completed`) legitimately report
    // `phase: 'completed'` while the run continues. So on any render that
    // landed on one of those, the hero reverted to "Nothing's been looked
    // into yet." with a primary-emphasis "Ask Sift to look into this"
    // button, mid-investigation. Invisible only because today's whole burst
    // lands inside ~70 ms; once the runtime streams events as the graph
    // progresses it becomes a visible flicker of "nothing has happened" in
    // the middle of an investigation.
    //
    // Asserting only the state after the burst passes on the buggy code --
    // this asserts after EVERY event, which is where the defect lives.
    it('never reverts the hero to the not-started phase mid-run, on any event of a realistic burst (half of which report phase "completed")', async () => {
      const beforeRun = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      const afterRun = buildFixtureCaseState({
        id: CASE_ID,
        eventSequence: 12,
        entities: [
          {
            id: 'candidate-rav4',
            kind: 'candidate',
            label: '2023 Toyota RAV4 Hybrid',
            attributes: {},
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
        recommendation: {
          id: 'rec-burst-1',
          status: 'ready',
          rationale: 'The RAV4 leads on the criteria that were checked.',
          facts: [],
          hypotheses: [],
          limitations: [],
          sourceIds: [],
          favoredOptionId: 'candidate-rav4',
          confidence: 0.8,
          resolvedObligationIds: [],
          acceptedUncertaintyObligationIds: [],
          generatedAt: '2026-08-27T00:05:00.000Z',
        },
      });
      // The canonical snapshot only gains the recommendation once the run
      // has actually finished, exactly as the real server's does -- so every
      // mid-burst assertion below is genuinely about the run's lifecycle and
      // not about a recommendation quietly appearing early.
      let currentSnapshot = beforeRun;

      renderLiveWorkspace(beforeRun);
      server.use(
        http.get(`/api/cases/${CASE_ID}/events`, () =>
          HttpResponse.json({ snapshot: currentSnapshot, events: [] as PublicActivityEvent[] }),
        ),
        // The workspace refetches the RunPlan whenever `eventSequence`
        // moves, which this test's post-run snapshot genuinely does. Not
        // what is under test here -- answered honestly (no plan) rather than
        // left to `onUnhandledRequest: 'error'`.
        http.get(`/api/cases/${CASE_ID}/run-plan`, () => new HttpResponse(null, { status: 404 })),
        runHandler({ ...buildFakeCommandReceipt({ caseId: CASE_ID }), runId: 'run-burst-1' }),
      );
      const user = await startDemoAndWait();

      expect(screen.getByTestId('recommendation-hero-status')).toHaveAttribute(
        'data-phase',
        'not_started',
      );

      await user.click(screen.getByTestId('request-investigation'));
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      const source = FakeEventSource.instances.at(-1)!;
      source.triggerOpen();

      // An ordered burst in the real shape `run-service.ts` and
      // `car-purchase-engine.ts` emit: `run.queued` carries both commandId
      // and runId, every later event of the run carries only the runId, and
      // the run ends with a terminal `run.completed`.
      const buildBurstEvent = (
        index: number,
        step: Pick<PublicActivityEvent, 'type' | 'phase' | 'summary'>,
      ): PublicActivityEvent => ({
        schemaVersion: '1.0',
        eventId: `evt-burst-${String(index)}`,
        sequence: index + 1,
        timestamp: '2026-08-27T00:01:00.000Z',
        caseId: CASE_ID,
        runId: 'run-burst-1',
        ...(index === 0 ? { commandId: 'cmd-burst-1' } : {}),
        ...step,
      });

      const midRunBurst: PublicActivityEvent[] = [
        { type: 'run.queued', phase: 'queued', summary: 'Investigation queued.' },
        { type: 'run.started', phase: 'active', summary: 'Investigation started (initial pass).' },
        { type: 'specialist.started', phase: 'active', summary: 'Deal analyst started working.' },
        { type: 'skill.activated', phase: 'completed', summary: 'Activated skill "deal-review".' },
        { type: 'tool.started', phase: 'active', summary: 'Calling tool "listing_reader".' },
        { type: 'tool.completed', phase: 'completed', summary: 'Tool "listing_reader" finished.' },
        { type: 'evidence.accepted', phase: 'completed', summary: 'Evidence accepted.' },
        { type: 'specialist.completed', phase: 'completed', summary: 'Deal analyst finished.' },
        { type: 'specialist.started', phase: 'active', summary: 'Safety analyst started working.' },
        { type: 'tool.completed', phase: 'completed', summary: 'Tool "safety_reader" finished.' },
        { type: 'obligation.updated', phase: 'completed', summary: 'An obligation was satisfied.' },
      ].map((step, index) =>
        buildBurstEvent(index, step as Pick<PublicActivityEvent, 'type' | 'phase' | 'summary'>),
      );

      // Half of it reports a terminal phase -- the exact condition the old
      // derivation mistook for "the run is over".
      expect(
        midRunBurst.filter((event) => event.phase === 'completed').length,
      ).toBeGreaterThanOrEqual(midRunBurst.length / 2);

      for (const event of midRunBurst) {
        act(() => {
          source.emit(event);
        });

        const status = screen.getByTestId('recommendation-hero-status');
        expect(status).not.toHaveAttribute('data-phase', 'not_started');
        expect(status).toHaveAttribute('data-phase', 'investigating');
        expect(screen.getByTestId('recommendation-hero-headline')).toHaveTextContent(
          'Sift is investigating.',
        );
        expect(screen.getByTestId('recommendation-hero-headline')).not.toHaveTextContent(
          "Nothing's been looked into yet.",
        );
      }

      // The recommendation lands in the canonical snapshot before the run
      // reports itself finished, exactly as the real engine's does
      // (`car-purchase-engine.ts` writes it, then appends `run.completed`).
      currentSnapshot = afterRun;
      act(() => {
        source.emit(
          buildBurstEvent(midRunBurst.length, {
            type: 'recommendation.ready',
            phase: 'completed',
            summary: 'A recommendation is ready for review.',
          }),
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId('recommendation-hero-status')).toHaveAttribute(
          'data-phase',
          'ready_blocked',
        );
      });
      expect(screen.getByTestId('recommendation-hero-headline')).toHaveTextContent(
        'Leading so far: 2023 Toyota RAV4 Hybrid',
      );

      // The terminal event genuinely ends the run -- and ending it must not
      // blank the answer the run just produced.
      act(() => {
        source.emit(
          buildBurstEvent(midRunBurst.length + 1, {
            type: 'run.completed',
            phase: 'completed',
            summary: 'Investigation completed (initial pass).',
          }),
        );
      });
      expect(screen.getByTestId('recommendation-hero-status')).toHaveAttribute(
        'data-phase',
        'ready_blocked',
      );
      expect(screen.getByTestId('recommendation-hero-headline')).toHaveTextContent(
        'Leading so far: 2023 Toyota RAV4 Hybrid',
      );
    });

    it('reflects the real SSE connectionState in the WorkspaceAppBar connection indicator', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      FakeEventSource.instances.at(-1)!.triggerOpen();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-connection-status')).toHaveTextContent(
          /live/i,
        );
      });
    });

    it("reset demo calls startDemo with the currently active pack's demoId and transitions to the new case", async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, title: 'First case' });
      let capturedBody: unknown;
      server.use(
        http.post('/api/cases/demo', async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(buildFakeCommandReceipt({ caseId: 'case-live-2' }));
        }),
        pollHandler(snapshot),
        http.get('/api/cases/case-live-2/events', () =>
          HttpResponse.json({
            snapshot: buildFixtureCaseState({ id: 'case-live-2', title: 'Second case' }),
            events: [],
          }),
        ),
        packsHandler([DEFAULT_PACK]),
      );

      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('workspace-app-bar-reset-demo'));

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent('Second case');
      });
      expect(capturedBody).toMatchObject({ demoId: 'car-purchase' });
    });

    it('resets a case-scoped component\'s stale local UI state (e.g. a leftover "Concern added" success banner) when Reset demo switches to a different case', async () => {
      // Manual QA finding (live browser pass, this task): `CustomConcernForm`
      // (and every other case-scoped child App.tsx renders without a `key`
      // tied to the active case -- `OptionEditor`, `CaseExtensionReviewCard`)
      // owns local `useState` (`success`/`error`/`form`) that used to survive
      // a case switch, because React reuses the same component instance
      // across a prop change with no identity change. Confirmed live: submit
      // a custom concern against case A, click "Reset demo" to land on a
      // brand-new case B, and the "Concern added..." success banner from
      // case A was still showing on case B's otherwise-empty form -- falsely
      // implying something had just been added to a case nothing had been
      // submitted against. `App.tsx` now keys the whole case workspace by
      // `activeCaseId` so every case-scoped child remounts (and its local
      // state resets) exactly when the active case actually changes.
      const secondCaseId = 'case-live-2';
      const secondSnapshot = buildFixtureCaseState({ id: secondCaseId, title: 'Second case' });
      let demoCallCount = 0;
      server.use(
        http.post('/api/cases/demo', () => {
          demoCallCount += 1;
          return HttpResponse.json(
            buildFakeCommandReceipt({ caseId: demoCallCount === 1 ? CASE_ID : secondCaseId }),
          );
        }),
        pollHandler(buildFixtureCaseState({ id: CASE_ID, title: 'First case' })),
        http.get(`/api/cases/${secondCaseId}/events`, () =>
          HttpResponse.json({ snapshot: secondSnapshot, events: [] }),
        ),
        packsHandler([DEFAULT_PACK]),
        commandHandler('defineCaseAttribute', buildFakeCommandReceipt({ caseId: CASE_ID })),
      );

      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      const user = await startDemoAndWait();
      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent('First case');
      });

      // "Add a question" is an app-bar create-menu item opening a Sheet now,
      // not a bottom-of-stack disclosure row. That changes what this test can
      // observe: a closed Sheet unmounts its children outright, so a stale
      // success banner inside one would disappear on close regardless of the
      // `key={activeCaseId}` fix this test exists to guard. So the remount is
      // ALSO asserted through a case-scoped child that stays mounted the
      // whole time -- `DisclosureSection`'s DOM-owned `open` state, which
      // only returns to its `defaultOpen` if the element is genuinely
      // recreated. Both halves of the original finding are still covered.
      await user.click(screen.getByTestId('disclosure-still-checking-summary'));
      expect(screen.getByTestId<HTMLDetailsElement>('disclosure-still-checking').open).toBe(true);

      await openCreateMenuItem(
        user,
        'workspace-app-bar-add-concern',
        'workspace-add-concern-sheet',
      );
      await user.type(screen.getByLabelText('Concern id'), 'trunk_space');
      await user.type(screen.getByLabelText('Label'), 'Trunk space');
      await user.type(screen.getByLabelText('Why this matters to you'), 'Need cargo room');
      await user.click(screen.getByTestId('custom-concern-form-submit'));
      await waitFor(() => {
        expect(screen.getByTestId('custom-concern-form-success')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('sheet-close'));
      await waitFor(() => {
        expect(screen.queryByTestId('workspace-add-concern-sheet')).not.toBeInTheDocument();
      });

      await user.click(screen.getByTestId('workspace-app-bar-reset-demo'));
      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent('Second case');
      });

      expect(screen.getByTestId<HTMLDetailsElement>('disclosure-still-checking').open).toBe(false);
      await openCreateMenuItem(
        user,
        'workspace-app-bar-add-concern',
        'workspace-add-concern-sheet',
      );
      expect(screen.getByTestId('custom-concern-form')).toBeInTheDocument();
      expect(screen.queryByTestId('custom-concern-form-success')).not.toBeInTheDocument();
      // An explicit timeout, not a global one: this is the longest single
      // user journey in the file (open a disclosure, open a menu, open a
      // sheet, type three fields character-by-character through
      // `user-event`, submit, close, reset the demo, reopen the menu and
      // sheet) and it measured ~10s of real work after the create-menu move
      // added two more overlay transitions to it. Nothing here waits on a
      // timer; the default 5s simply no longer covers the keystrokes.
    }, 25_000);

    it('the "Request investigation" control calls requestInvestigation and LiveRunStatus reflects the correlated run', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      let capturedBody: unknown;
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        pollHandler(snapshot),
        packsHandler([DEFAULT_PACK]),
        runHandler(
          { ...buildFakeCommandReceipt({ caseId: CASE_ID }), runId: 'run-live-1' },
          (body) => {
            capturedBody = body;
          },
        ),
      );

      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

      await user.click(screen.getByTestId('request-investigation'));

      // The real run id is never rendered as raw text on the consumer
      // surface anymore (ADR 0004 decision item 3) -- proven here by
      // clicking through to the real Runtime Inspector, the one place the
      // id is developer-appropriate to show.
      await waitFor(() => {
        expect(screen.getByTestId('open-runtime-inspector')).toBeInTheDocument();
      });
      expect(screen.queryByText('run-live-1')).not.toBeInTheDocument();
      expect(capturedBody).toMatchObject({
        caseId: CASE_ID,
        expectedSequence: snapshot.eventSequence,
      });
    });

    it('automatically retries a requestInvestigation 409 conflict once, using the server-reported actual sequence', async () => {
      // A real Playwright e2e run under worker contention found this
      // exact race: the browser's SSE-delivered `snapshot.eventSequence`
      // can be one event behind the server the instant this control is
      // pressed. `App.tsx`'s `handleRequestInvestigation` recovers
      // automatically using the conflict envelope's `actualSequence`
      // (architecture.md: "Conflicts return the latest sequence so ChatGPT
      // can call sift_get_case_context before retrying") rather than
      // leaving the human stuck with a silently re-enabled button.
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      let callCount = 0;
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        pollHandler(snapshot),
        packsHandler([DEFAULT_PACK]),
        http.post(`/api/cases/${CASE_ID}/run`, async ({ request }) => {
          callCount += 1;
          if (callCount === 1) {
            return HttpResponse.json(
              {
                error: {
                  code: 'CONFLICT',
                  message:
                    'The case has advanced since expectedSequence was read; refresh and retry.',
                  retryable: true,
                  expectedSequence: snapshot.eventSequence,
                  actualSequence: snapshot.eventSequence + 1,
                },
                snapshot,
              },
              { status: 409 },
            );
          }
          const body = (await request.json()) as { expectedSequence: number };
          expect(body.expectedSequence).toBe(snapshot.eventSequence + 1);
          return HttpResponse.json({
            ...buildFakeCommandReceipt({ caseId: CASE_ID }),
            runId: 'run-retry-1',
          });
        }),
      );

      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

      await user.click(screen.getByTestId('request-investigation'));

      await waitFor(() => {
        expect(screen.getByTestId('open-runtime-inspector')).toBeInTheDocument();
      });
      expect(callCount).toBe(2);
      expect(screen.queryByTestId('request-investigation-error')).not.toBeInTheDocument();
    });

    it('approving a pending proposal calls reviewProposal with actor "human"', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        recommendation: {
          id: 'rec-1',
          status: 'ready',
          favoredOptionId: null,
          rationale: 'Best overall fit.',
          facts: [],
          hypotheses: [],
          confidence: 0.8,
          limitations: [],
          sourceIds: [],
          resolvedObligationIds: [],
          acceptedUncertaintyObligationIds: [],
          generatedAt: '2026-08-27T00:00:00.000Z',
        },
        proposal: {
          id: 'prop-1',
          recommendationId: 'rec-1',
          status: 'pending',
          createdAt: '2026-08-27T00:00:00.000Z',
        },
      });
      let capturedBody: unknown;
      renderLiveWorkspace(snapshot);
      server.use(
        commandHandler('reviewProposal', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          capturedBody = body;
        }),
      );
      const user = await startDemoAndWait();

      await waitFor(() => expect(screen.getByTestId('approval-card-approve')).toBeInTheDocument());
      await user.click(screen.getByTestId('approval-card-approve'));

      await waitFor(() => {
        expect(capturedBody).toMatchObject({
          caseId: CASE_ID,
          proposalId: 'prop-1',
          actor: 'human',
          decision: 'approve',
        });
      });
    });

    it('an evidence disposition control calls setEvidenceDisposition on the shared command client', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        evidenceLinks: [
          {
            id: 'evidence-1',
            obligationId: 'obl-1',
            level: 'E1',
            verdict: 'pass',
            disposition: 'included',
            summary: 'Confirmed.',
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      let capturedBody: unknown;
      renderLiveWorkspace(snapshot);
      server.use(
        commandHandler(
          'setEvidenceDisposition',
          buildFakeCommandReceipt({ caseId: CASE_ID }),
          (body) => {
            capturedBody = body;
          },
        ),
      );
      const user = await startDemoAndWait();
      await openFindingsSheet(user);

      await waitFor(() =>
        expect(screen.getByTestId('evidence-card-disposition-option-excluded')).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId('evidence-card-disposition-option-excluded'));
      await user.type(screen.getByTestId('evidence-card-reason-evidence-1'), 'No longer relevant.');
      await user.click(screen.getByTestId('evidence-card-reason-confirm-evidence-1'));

      await waitFor(() => {
        expect(capturedBody).toMatchObject({
          caseId: CASE_ID,
          evidenceId: 'evidence-1',
          disposition: 'excluded',
        });
      });
    });

    it('shows a recoverable error when setEvidenceDisposition fails', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        evidenceLinks: [
          {
            id: 'evidence-1',
            obligationId: 'obl-1',
            level: 'E1',
            verdict: 'pass',
            disposition: 'included',
            summary: 'Confirmed.',
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      server.use(
        http.post(`/api/cases/${CASE_ID}/commands/setEvidenceDisposition`, () =>
          HttpResponse.json(
            { error: { code: 'CONFLICT', message: 'Stale sequence.', retryable: true } },
            { status: 409 },
          ),
        ),
      );
      const user = await startDemoAndWait();
      await openFindingsSheet(user);

      await waitFor(() =>
        expect(screen.getByTestId('evidence-card-disposition-option-excluded')).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId('evidence-card-disposition-option-excluded'));
      await user.type(screen.getByTestId('evidence-card-reason-evidence-1'), 'No longer relevant.');
      await user.click(screen.getByTestId('evidence-card-reason-confirm-evidence-1'));

      await waitFor(() => {
        expect(screen.getByTestId('error-state-message')).toHaveTextContent('Stale sequence.');
      });
    });

    it('joins a real claim into an evidence item (via claimId) rather than only falling back to the summary', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        claims: [
          {
            id: 'claim-1',
            obligationId: 'obl-1',
            statement: 'The dealer confirmed the out-the-door price.',
            stance: 'supports',
            confidence: 0.9,
            sourceIds: [],
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        ],
        evidenceLinks: [
          {
            id: 'evidence-1',
            obligationId: 'obl-1',
            claimId: 'claim-1',
            level: 'E1',
            verdict: 'pass',
            disposition: 'included',
            summary: 'Fallback summary text.',
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      await openFindingsSheet(user);

      await waitFor(() => {
        expect(screen.getByTestId('evidence-card-claim')).toHaveTextContent(
          'The dealer confirmed the out-the-door price.',
        );
      });
    });

    it('renders a pending agent-proposed case extension via CaseExtensionReviewCard', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        caseExtensions: [
          {
            id: 'ext-1',
            caseId: CASE_ID,
            definition: {
              id: 'custom.pet_sensory_fit',
              label: 'Pet sensory fit',
              valueType: 'string',
              required: false,
              appliesTo: ['car'],
              evidenceExpectation: 'assertion',
              comparison: 'none',
              sensitive: false,
              origin: 'agent_proposed',
              reason: 'The household mentioned a sound-sensitive dog.',
              confirmation: 'pending',
              proposedBy: 'lead-investigator',
              createdAt: '2026-08-27T00:00:00.000Z',
            },
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      // `CaseExtensionReviewCard` lives in the "Add a question" sheet now,
      // which the app bar's create menu opens -- it used to be inside a
      // self-opening bottom-of-stack disclosure row (see this file's
      // `openCreateMenuItem` helper for why that row is gone).
      await openCreateMenuItem(
        user,
        'workspace-app-bar-add-concern',
        'workspace-add-concern-sheet',
      );
      await waitFor(() => {
        expect(screen.getByTestId('case-extension-review-card-label')).toHaveTextContent(
          'Pet sensory fit',
        );
      });
    });

    it('registers case-scoped WebMCP tools once a case is active', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      const { adapter } = renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        for (const name of CASE_SCOPED_SIFT_TOOL_NAMES) {
          expect(adapter.getRegisteredTool(name)).toBeDefined();
        }
      });
    });

    it('resolves the active installed pack (by identity.id) and passes its real optionLabel/presentation down to OptionEditor and the option views', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      // `DEFAULT_PACK.presentation.optionLabel` is `'car'` -- if the active
      // pack were not correctly resolved (e.g. matched on the wrong field),
      // this would silently fall back to the generic `'option'` label.
      // `OptionEditor` now only mounts inside the app bar's "Add option"
      // sheet (ADR 0008), and "Add option" is an item in the app bar's
      // create menu -- open both first.
      await openCreateMenuItem(user, 'workspace-app-bar-add-option', 'workspace-add-option-sheet');
      // `OptionEditor`'s own `option-editor-new` "Add {label}" button is gone
      // (adding is now the sheet's own default state); its sr-only
      // `option-editor-heading` ("Add a {label}"/"Edit {label}") is
      // `OptionEditor`'s own copy, owned by that component, not this file,
      // and is what now carries the resolved `optionLabel` down.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Add a car' })).toBeInTheDocument();
      });
    });

    it('shows the WebMcpStatus "ready" confirmation when the injected adapter reports supported', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      expect(screen.getByTestId('webmcp-status-supported')).toBeInTheDocument();
    });

    // The raw `ErrorState` this stream error would otherwise render is now
    // suppressed while `connectionState` is `'offline'`/`'reconnecting'`:
    // a dropped connection used to put TWO banners on screen at once, the
    // app bar's own "reconnecting" connection badge above a second, red one
    // whose entire text was the browser's raw "Failed to fetch" `TypeError`
    // message -- a developer-vocabulary restatement of the same fact, with
    // no retry control of its own. The connection badge is the one true,
    // actionable signal here, and is asserted present in its place.
    it('suppresses the raw ErrorState for a stream error that is really a dropped connection, while preserving the last valid WorkspaceAppBar title', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, title: 'Resilient case' });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      FakeEventSource.instances.at(-1)!.triggerError();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-connection-status')).toHaveTextContent(
          /reconnecting/i,
        );
      });
      expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
      // Last valid case state is preserved -- the header title never blanks.
      expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent('Resilient case');
    });

    // ADR 0004 decision item 5: `CaseState.activeFocus` is written only as
    // `null` by every production code path -- the old "What Sift is doing"
    // current-focus card was unreachable dead code whose only visible
    // branch was a permanently-true empty state. It is deleted outright,
    // not replaced with a fabricated substitute ("Nothing may render from
    // `activeFocus` again until a real production code path writes a
    // non-null value to it"). This proves the deletion actually took
    // effect: even a snapshot carrying a real, fully-populated `activeFocus`
    // (something no production writer produces today, but the fixture can)
    // renders no trace of the old current-focus UI anywhere.
    it('renders nothing from activeFocus even when the snapshot carries a real (never-production-written) value', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        activeFocus: {
          obligationId: 'obl-1',
          reason: 'Dealer quote has not been corroborated yet.',
          skillId: 'price-verification',
          specialistId: 'deal-analyst',
          since: '2026-08-27T00:00:00.000Z',
        },
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      expect(screen.queryByTestId('current-focus')).not.toBeInTheDocument();
      expect(screen.queryByTestId('current-focus-detail')).not.toBeInTheDocument();
      expect(screen.queryByTestId('current-focus-obligation')).not.toBeInTheDocument();
      expect(screen.queryByTestId('current-focus-reason')).not.toBeInTheDocument();
      expect(screen.queryByTestId('current-focus-skill')).not.toBeInTheDocument();
      expect(screen.queryByTestId('current-focus-specialist')).not.toBeInTheDocument();
      expect(screen.queryByTestId('current-focus-empty')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Dealer quote has not been corroborated yet.'),
      ).not.toBeInTheDocument();
    });

    it('shows the "Draft withheld" recommendation state when the last event is draft.withheld and no recommendation exists yet', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      const withheldEvent: PublicActivityEvent = {
        schemaVersion: '1.0',
        eventId: 'evt-withheld',
        sequence: 1,
        timestamp: '2026-08-27T00:01:00.000Z',
        caseId: CASE_ID,
        type: 'draft.withheld',
        phase: 'completed',
        summary: 'Draft withheld pending more evidence.',
      };
      renderLiveWorkspace(snapshot, [withheldEvent]);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('recommendation-card-withheld')).toBeInTheDocument();
      });
    });

    it('derives "Latest command" from replayed history when a case loads with prior run activity, instead of the empty state', async () => {
      // Regression test: `lastRunReceipt` was pure session-local state, set
      // only inside a live command's own promise-resolution handlers, and
      // reset to `null` by `handleDemoStarted`/reload -- so a case loaded
      // with real, already-completed run history (exactly what a page
      // reload replays) rendered "No command has been sent yet." directly
      // above a Readiness panel and Activity log that both correctly showed
      // that same history. Only the `run.queued` event carries both
      // `commandId` and `runId` together (see run-service.ts); every later
      // event in the run (specialist/tool/run.completed) carries only
      // `runId`, so this fixture also proves the fallback finds the real
      // originating `commandId` rather than fabricating one.
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      const priorRunEvents: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-1',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-prior-1',
          runId: 'run-prior-1',
          type: 'run.queued',
          phase: 'queued',
          summary: 'Investigation queued.',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-2',
          sequence: 2,
          timestamp: '2026-08-27T00:00:05.000Z',
          caseId: CASE_ID,
          runId: 'run-prior-1',
          type: 'specialist.started',
          phase: 'active',
          summary: 'Deal analyst started working.',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-3',
          sequence: 3,
          timestamp: '2026-08-27T00:00:10.000Z',
          caseId: CASE_ID,
          runId: 'run-prior-1',
          type: 'run.completed',
          phase: 'completed',
          summary: 'Investigation completed.',
        },
      ];
      renderLiveWorkspace(snapshot, priorRunEvents);
      server.use(debugRunHandler('run-prior-1'));
      await startDemoAndWait();

      // `LiveRunStatus` renders nothing at all before any command has been
      // sent (ADR 0004 item 2); a case reloaded with prior run history must
      // therefore show the real quiet indicator, not that empty state.
      await waitFor(() => {
        expect(screen.getByTestId('live-run-status')).toBeInTheDocument();
      });
      expect(screen.getByTestId('live-run-status-phase')).toHaveTextContent(/completed/i);
      // Neither raw id renders as visible text on the consumer surface
      // (ADR 0004 item 3) -- proven by clicking through to the real
      // Runtime Inspector below, the one place `run-prior-1` is
      // developer-appropriate to show.
      expect(screen.queryByText('run-prior-1')).not.toBeInTheDocument();
      expect(screen.queryByText('cmd-prior-1')).not.toBeInTheDocument();

      // The "Open Runtime Inspector" control is directly adjacent to
      // LiveRunStatus and must not disagree with it: it was still gated on
      // the raw session-local `lastRunReceipt?.runId`, unchanged by the
      // fallback above, so it stayed hidden here even though LiveRunStatus
      // now correctly shows a completed run with a real run id.
      await waitFor(() => {
        expect(screen.getByTestId('open-runtime-inspector')).toBeInTheDocument();
      });
      const user = userEvent.setup();
      await user.click(screen.getByTestId('open-runtime-inspector'));

      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-run-id')).toHaveTextContent('run-prior-1');
      });
    });

    it('scopes the derived "Latest command" fallback to the active case, ignoring any other case\'s events still present in the events array', async () => {
      // Regression test (Task 15 review, Finding 3): `deriveReceiptFromEvents`
      // used to run over whatever `events` currently held, with no filter by
      // `caseId`. On "Reset demo," `setActiveCaseId(newId)` and
      // `setLastRunReceipt(null)` can commit and render before
      // `useCaseEvents`'s own internal `events` state (keyed by `caseId`) has
      // cleared, so for one frame the derived fallback could reflect the
      // *previous* case's history. This test proxies that race at the
      // `deriveReceiptFromEvents` call site directly: it hands the component
      // an `events` array containing a later-sequence event stamped with a
      // different, stale `caseId` (`case-other`) mixed in among the active
      // case's own real history, and asserts the derived receipt reflects
      // only the active case's own run -- never the foreign one, even though
      // it sorts later.
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      const events: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-1',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-prior-1',
          runId: 'run-prior-1',
          type: 'run.queued',
          phase: 'queued',
          summary: 'Investigation queued.',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-2',
          sequence: 2,
          timestamp: '2026-08-27T00:00:05.000Z',
          caseId: CASE_ID,
          runId: 'run-prior-1',
          type: 'run.completed',
          phase: 'completed',
          summary: 'Investigation completed.',
        },
        // A stale, foreign-case event: a higher sequence number than any
        // real event belonging to `CASE_ID`, which is exactly what would let
        // it win a naive "most recent event" scan if the derivation were not
        // scoped by `caseId`.
        {
          schemaVersion: '1.0',
          eventId: 'evt-foreign',
          sequence: 99,
          timestamp: '2026-08-27T00:01:00.000Z',
          caseId: 'case-other',
          commandId: 'cmd-foreign',
          runId: 'run-foreign',
          type: 'run.queued',
          phase: 'queued',
          summary: "A different case's investigation queued.",
        },
      ];
      renderLiveWorkspace(snapshot, events);
      server.use(debugRunHandler('run-prior-1'));
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('live-run-status')).toBeInTheDocument();
      });
      // Proven by clicking through to the real Runtime Inspector -- the
      // real run id is never rendered as raw consumer-surface text (ADR
      // 0004 item 3), so the *scoping* behavior this test exists to prove
      // (the derivation must never reflect a foreign case's event, even
      // one with a higher sequence number) is now verified at the one
      // place the id is developer-appropriate to show.
      await waitFor(() => {
        expect(screen.getByTestId('open-runtime-inspector')).toBeInTheDocument();
      });
      const user = userEvent.setup();
      await user.click(screen.getByTestId('open-runtime-inspector'));
      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-run-id')).toHaveTextContent('run-prior-1');
      });
      expect(screen.getByTestId('runtime-inspector-run-id')).not.toHaveTextContent('run-foreign');
    });

    // ADR 0004 item 2 / audit §2: an empty conceptual region must be
    // ABSENT, not a card announcing its own emptiness -- `LiveRunStatus`
    // used to render a "No command has been sent yet." card here; it now
    // renders nothing at all for a genuinely fresh case with no prior
    // activity.
    it('renders no LiveRunStatus indicator at all for a genuinely fresh case with no prior activity', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      renderLiveWorkspace(snapshot, []);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('live-run-status')).not.toBeInTheDocument();
      expect(screen.queryByTestId('live-run-status-empty')).not.toBeInTheDocument();
    });

    // Task A9 (`docs/planning/plans/2026-08-30-generic-decision-workspace.md`
    // Phase A; brief w1b-ui-refinement.md): found by live inspection at
    // 430px -- the hero rendered "Nothing's been looked into yet." directly
    // above a "Investigation status -- Completed -- Added option ..." block,
    // even though nothing had actually been investigated. Both statements
    // were individually true (nothing was investigated; the demo's own
    // fixture-seeding command *had* completed) but read together they
    // contradicted, echoing the exact defect ADR 0004 exists to remove.
    // Reproduces the real cause directly: `startDemo` bundles case creation
    // AND every seeded entity under ONE `commandId`
    // (`apps/agent/src/services/command-service.ts`'s `startDemo`), none of
    // it carrying a `runId` (seeding is not an investigation run) -- exactly
    // the shape asserted here. The fix must hold both ways: the hero still
    // honestly says nothing has been investigated, AND no stale "completed
    // command" status renders beside it for a command the human never
    // actually issued themselves.
    it('does not render a contradictory "completed" command status beside "Nothing\'s been looked into yet." for fixture/demo-seeded setup the user never issued', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null, proposal: null });
      const seedEvents: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-seed-1',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-start',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Started "Choose Our Next Car".',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-seed-2',
          sequence: 2,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-start',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Added option "2022 Subaru Outback Premium AWD".',
        },
      ];
      renderLiveWorkspace(snapshot, seedEvents);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('recommendation-hero-headline')).toHaveTextContent(
          "Nothing's been looked into yet.",
        );
      });
      // The contradiction-proof assertion: no completed-command status
      // block renders at all while the hero still says nothing has been
      // looked into, because the only "completed command" in this case's
      // history is fixture/demo seeding, not something the human asked for.
      expect(screen.queryByTestId('live-run-status')).not.toBeInTheDocument();
      expect(screen.queryByText(/Added option/i)).not.toBeInTheDocument();
    });

    // ADR 0009. The same defect shape as the seeding case above, found the
    // same way -- by looking at the running product at 390px -- and made
    // frequent by this change: filters now write `setView` on every chip
    // press, so picking "Body style: compact crossover SUV" surfaced
    // "Latest command / Set workspace view to "quick_pick". / Completed"
    // directly beneath a hero still reading "Nothing's been looked into
    // yet." Individually true, a non-sequitur together, and phrased in
    // internal vocabulary a person shopping for a car has never seen.
    //
    // The rule: a presentation-only command (`setView`/`focusOption`/
    // `focusEvidence` -- the three that write through `updateSelection`,
    // append no `CaseEvent`, and never advance `eventSequence`) cannot
    // answer "what did Sift last do about my decision," so it never claims
    // this block.
    it('never promotes a presentation-only command into "Latest command" -- a filter or view change is not something Sift did about the decision', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null, proposal: null });
      const events: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-seed-1',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-start',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Started "Choose Our Next Car".',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-view-1',
          sequence: 2,
          timestamp: '2026-08-27T00:00:01.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-set-view',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Set workspace view to "quick_pick".',
          safeDetails: { [PRESENTATION_ONLY_ACTIVITY_DETAIL]: true },
        },
      ];
      renderLiveWorkspace(snapshot, events);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('recommendation-hero-headline')).toHaveTextContent(
          "Nothing's been looked into yet.",
        );
      });
      // Skipping the `setView` event falls through to the seeding command,
      // which the rule above already excludes -- so nothing renders at all,
      // exactly as it did before filters ever wrote a view.
      expect(screen.queryByTestId('live-run-status')).not.toBeInTheDocument();
      expect(screen.queryByText(/Set workspace view/i)).not.toBeInTheDocument();
    });

    it('still surfaces a REAL command underneath a later presentation-only one, rather than skipping the block entirely', async () => {
      // The other half of the rule, and the reason this is a `continue`
      // rather than an early `return null`: a presentation-only event must
      // be stepped OVER, never treated as "there is nothing to show." A user
      // who adds an option and then switches tabs must still see the option
      // they added reported here.
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null, proposal: null });
      const events: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-seed-1',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-start',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Started "Choose Our Next Car".',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-real-1',
          sequence: 2,
          timestamp: '2026-08-27T00:00:01.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-add-option',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Added option "2022 Mazda CX-5 Preferred AWD".',
        },
        {
          schemaVersion: '1.0',
          eventId: 'evt-view-1',
          sequence: 3,
          timestamp: '2026-08-27T00:00:02.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-set-view',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Set workspace view to "list".',
          safeDetails: { [PRESENTATION_ONLY_ACTIVITY_DETAIL]: true },
        },
      ];
      renderLiveWorkspace(snapshot, events);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('live-run-status')).toBeInTheDocument();
      });
      expect(screen.getByTestId('live-run-status-summary')).toHaveTextContent(
        'Added option "2022 Mazda CX-5 Preferred AWD".',
      );
      expect(screen.queryByText(/Set workspace view/i)).not.toBeInTheDocument();
    });

    it('does not send a reset command when the active pack id is not a recognized demo id', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        pack: {
          id: 'not-a-real-demo-pack',
          version: '1.0.0',
          compiledHash: 'a'.repeat(64),
          selectedBy: 'router',
          reasons: [],
        },
      });
      let startDemoCalled: boolean;
      server.use(
        http.post('/api/cases/demo', () => {
          startDemoCalled = true;
          return HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID }));
        }),
        pollHandler(snapshot),
        packsHandler([DEFAULT_PACK]),
      );
      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      // Only track calls made *after* the initial launcher click's own
      // (expected) startDemo call.
      startDemoCalled = false;
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

      await user.click(screen.getByTestId('workspace-app-bar-reset-demo'));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(startDemoCalled).toBe(false);
    });

    it('recovers from a reset-demo failure by re-enabling the reset control', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, title: 'Still here' });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      // Only the *reset* attempt fails -- the initial `startDemo` from the
      // launcher (already completed above) must succeed normally.
      server.use(http.post('/api/cases/demo', () => new HttpResponse(null, { status: 500 })));

      await user.click(screen.getByTestId('workspace-app-bar-reset-demo'));

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-reset-demo')).not.toBeDisabled();
      });
      // Never blanked -- the same case stays displayed after a failed reset.
      expect(screen.getByTestId('workspace-app-bar-title')).toHaveTextContent('Still here');
    });

    it('disposes the WebMCP tool registration handle cleanly on unmount', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      const { unmount, adapter } = renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      // Waiting for a *case-scoped* tool (rather than a global one) proves
      // the async `registerSiftTools()` promise has actually resolved and
      // its handle has been committed to React state via the follow-up
      // `setActiveCase` effect -- a global tool alone can appear registered
      // slightly before that commit, which would make this test's `unmount`
      // race the handle's own assignment.
      await waitFor(() => {
        expect(adapter.getRegisteredTool('sift_upsert_option')).toBeDefined();
      });
      expect(adapter.getRegisteredTool('sift_get_case_context')).toBeDefined();

      unmount();

      expect(adapter.getRegisteredTool('sift_get_case_context')).toBeUndefined();
      expect(adapter.getRegisteredTool('sift_upsert_option')).toBeUndefined();
    });

    it('recovers from a requestInvestigation failure by re-enabling the control', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      server.use(
        http.post(`/api/cases/${CASE_ID}/run`, () => new HttpResponse(null, { status: 500 })),
      );
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('request-investigation'));

      await waitFor(() => {
        expect(screen.getByTestId('request-investigation')).toBeEnabled();
      });
      // Copy owned by `RecommendationHero.tsx` (a concurrent terminology
      // pass, unrelated to this task) -- asserting it returns to its real
      // default label rather than staying stuck on a "requesting..." state,
      // not asserting a specific wording this file does not own.
      expect(screen.getByTestId('request-investigation')).toHaveTextContent(
        'Have Sift investigate',
      );
      expect(screen.getByTestId('request-investigation-error')).toBeInTheDocument();
    });

    it('shows a generic error message on the ApprovalCard when reviewProposal rejects with a non-Error value', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        recommendation: {
          id: 'rec-1',
          status: 'ready',
          favoredOptionId: null,
          rationale: 'Best overall fit.',
          facts: [],
          hypotheses: [],
          confidence: 0.8,
          limitations: [],
          sourceIds: [],
          resolvedObligationIds: [],
          acceptedUncertaintyObligationIds: [],
          generatedAt: '2026-08-27T00:00:00.000Z',
        },
        proposal: {
          id: 'prop-1',
          recommendationId: 'rec-1',
          status: 'pending',
          createdAt: '2026-08-27T00:00:00.000Z',
        },
      });
      renderLiveWorkspace(snapshot);
      server.use(
        http.post(`/api/cases/${CASE_ID}/commands/reviewProposal`, () =>
          HttpResponse.text('not the expected JSON error body', { status: 500 }),
        ),
      );
      const user = await startDemoAndWait();

      await waitFor(() => expect(screen.getByTestId('approval-card-approve')).toBeInTheDocument());
      await user.click(screen.getByTestId('approval-card-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-card-error')).toBeInTheDocument();
      });
    });

    it('degrades gracefully (still renders the workspace) when GET /api/packs fails', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        pollHandler(snapshot),
        http.get('/api/packs', () => new HttpResponse(null, { status: 500 })),
      );
      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument();
      });
      // Falls back to the generic 'option' label rather than blocking.
      // `option-editor-new` is gone (adding is now `OptionEditor`'s own
      // default state) -- its sr-only heading is what now carries the label.
      await openCreateMenuItem(user, 'workspace-app-bar-add-option', 'workspace-add-option-sheet');
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Add a option' })).toBeInTheDocument();
      });
    });

    it('has no axe violations in the live workspace', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      const { container } = renderLiveWorkspace(snapshot);
      await startDemoAndWait();
      await waitFor(() => expect(screen.getByTestId('readiness-panel')).toBeInTheDocument());

      expect(await axe(container)).toHaveNoViolations();
    });

    it('renders the whole workspace at 390px width with no fixed-width overflow risk', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        pollHandler(snapshot),
        packsHandler([DEFAULT_PACK]),
      );
      const user = userEvent.setup();
      const { overflowRisks, renderResult } = renderAtNarrowWidth(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(renderResult.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => {
        expect(renderResult.getByTestId('case-workspace')).toBeInTheDocument();
      });

      expect(overflowRisks).toEqual([]);
    });

    describe('Runtime Inspector wiring', () => {
      it('opens the real Runtime Inspector from the "Inspect run" control once a run exists, and returns to the case body on close', async () => {
        const snapshot = buildFixtureCaseState({ id: CASE_ID });
        server.use(
          http.post('/api/cases/demo', () =>
            HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
          ),
          pollHandler(snapshot),
          packsHandler([DEFAULT_PACK]),
          runHandler({ ...buildFakeCommandReceipt({ caseId: CASE_ID }), runId: 'run-inspect-1' }),
          debugRunHandler('run-inspect-1'),
        );
        const user = userEvent.setup();
        render(
          <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
            <App />
          </AppProviders>,
        );
        await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
        await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

        // Not reachable before any run has ever been requested this session.
        expect(screen.queryByTestId('open-runtime-inspector')).not.toBeInTheDocument();

        await user.click(screen.getByTestId('request-investigation'));
        await waitFor(() => {
          expect(screen.getByTestId('open-runtime-inspector')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('open-runtime-inspector'));

        await waitFor(() => {
          expect(screen.getByTestId('runtime-inspector')).toBeInTheDocument();
        });
        expect(screen.getByTestId('runtime-inspector-run-id')).toHaveTextContent('run-inspect-1');
        // The inspector is now a Sheet overlay (round-2 design review: "show
        // these in ... a side sliding sheet" rather than navigating to a
        // separate page) -- the case body stays mounted underneath it.
        // `recommendation-hero` replaces the retired "current-focus" card as
        // the stable, always-present region proving this (ADR 0004 item 5
        // deleted the current-focus card entirely).
        expect(screen.getByTestId('recommendation-hero')).toBeInTheDocument();
        expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument();

        await waitFor(() => {
          expect(screen.getByTestId('runtime-inspector-status')).toHaveTextContent('completed');
        });

        await user.click(screen.getByTestId('sheet-close'));

        await waitFor(() => {
          expect(screen.queryByTestId('runtime-inspector')).not.toBeInTheDocument();
        });
        expect(screen.getByTestId('recommendation-hero')).toBeInTheDocument();
      });

      // A prior version of this test opened the Inspector from a per-item
      // "Inspect run" control on `ActivityTimeline`, the raw chronological
      // activity ledger. ADR 0004 item 3/4 moves that ledger to developer
      // content and this file no longer mounts it on the consumer surface
      // at all (change-set §34: "Do not build a redundant separate debug
      // system") -- the single "Inspect run" control tied to the hero's own
      // `LiveRunStatus` (covered by the test above and by "streams a live,
      // correlated SSE event...") is the one remaining, still-tested entry
      // point into the Runtime Inspector.

      it('has no axe violations with the Runtime Inspector open', async () => {
        const snapshot = buildFixtureCaseState({ id: CASE_ID });
        server.use(
          http.post('/api/cases/demo', () =>
            HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
          ),
          pollHandler(snapshot),
          packsHandler([DEFAULT_PACK]),
          runHandler({ ...buildFakeCommandReceipt({ caseId: CASE_ID }), runId: 'run-inspect-axe' }),
          debugRunHandler('run-inspect-axe'),
        );
        const user = userEvent.setup();
        const { container } = render(
          <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
            <App />
          </AppProviders>,
        );
        await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
        await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());
        await user.click(screen.getByTestId('request-investigation'));
        await waitFor(() =>
          expect(screen.getByTestId('open-runtime-inspector')).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId('open-runtime-inspector'));
        await waitFor(() => {
          expect(screen.getByTestId('runtime-inspector-status')).toHaveTextContent('completed');
        });

        expect(await axe(container)).toHaveNoViolations();
      });
    });
  });

  // Task A5 ("a real developer-mode entry point") and Task I2b (the
  // trigger half of I2, "a consumer event opens its exact runtime event").
  describe('developer view entry point (Task A5 / I2b)', () => {
    it('opens the Runtime Inspector via the WorkspaceAppBar developer-view control with no run in hand, defaulting to the Activity tab', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      // Reachable even though no run has ever happened this session --
      // unlike the pre-existing run-scoped "Inspect run" control.
      expect(screen.queryByTestId('open-runtime-inspector')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('workspace-app-bar-developer-view'));

      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector')).toBeInTheDocument();
      });
      expect(screen.getByTestId('runtime-inspector-tab-activity')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByTestId('runtime-inspector-activity')).toBeInTheDocument();
      // The case body stays mounted underneath, same as every other
      // Inspector entry point.
      expect(screen.getByTestId('recommendation-hero')).toBeInTheDocument();

      await user.click(screen.getByTestId('sheet-close'));
      await waitFor(() => {
        expect(screen.queryByTestId('runtime-inspector')).not.toBeInTheDocument();
      });
    });

    it('jumps from a consumer activity item to its exact correlated runtime event via "Inspect event" (Task I2b)', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      const priorRunEvents: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-1',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          runId: 'run-prior-1',
          debugEventId: 'debug-1',
          type: 'tool.started',
          phase: 'active',
          summary: 'Calling tool "listing_reader".',
        },
      ];
      renderLiveWorkspace(snapshot, priorRunEvents);
      server.use(debugRunHandler('run-prior-1'));
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('workspace-app-bar-developer-view'));
      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-activity')).toBeInTheDocument();
      });

      const inspectEventButton = screen.getByTestId('activity-item-inspect-event-evt-1');
      await user.click(inspectEventButton);

      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-tab-timeline')).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-timeline-item-debug-1')).toHaveAttribute(
          'data-focused',
          'true',
        );
      });
      expect(screen.getByTestId('runtime-inspector-run-id')).toHaveTextContent('run-prior-1');
    });

    it('does not render an "Inspect event" control for an activity item with no debugEventId (global constraint 4)', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, recommendation: null });
      const priorRunEvents: PublicActivityEvent[] = [
        {
          schemaVersion: '1.0',
          eventId: 'evt-no-debug',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          commandId: 'cmd-start',
          type: 'command.accepted',
          phase: 'completed',
          summary: 'Started "Choose Our Next Car".',
        },
      ];
      renderLiveWorkspace(snapshot, priorRunEvents);
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('workspace-app-bar-developer-view'));
      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-activity')).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId('activity-item-inspect-event-evt-no-debug'),
      ).not.toBeInTheDocument();
    });

    it('has no axe violations with the developer view open on the Activity tab', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      const { container } = renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('workspace-app-bar-developer-view'));
      await waitFor(() => {
        expect(screen.getByTestId('runtime-inspector-activity')).toBeInTheDocument();
      });

      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // ADR 0004 "Consumer workspace information architecture": the merged
  // answer-first hero is always visible and precedes every disclosure row
  // -- the machine-checkable form of "answer first" this task's brief asks
  // for, in DOM order rather than only visual position. Each disclosure
  // row's closed `<summary>` still carries an accurate live summary even
  // while collapsed (a property ADR 0002 established and ADR 0004 keeps).
  describe('workspace layout (ADR 0004/0008, answer-first hero + disclosure rows)', () => {
    it('renders the recommendation hero before every remaining disclosure row, in real DOM order', async () => {
      // "Manage options" and "What Sift found" are no longer disclosure rows
      // at all (ADR 0008 -- both promoted into `WorkspaceAppBar`), and
      // neither are "Add a note"/"Add a question" any more (the owner: they
      // "should be in either the header or footer toolbars -- not at the
      // bottom of the stack" -- both are app-bar create-menu items opening
      // Sheets now). Only the genuinely read-only investigative rows are
      // left, and they must still all follow the hero.
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      const hero = screen.getByTestId('recommendation-hero');
      for (const testId of ['disclosure-still-checking']) {
        const position = hero.compareDocumentPosition(screen.getByTestId(testId));
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });

    it('has removed the "Add a note" and "Add a question" bottom-of-stack disclosure rows entirely', async () => {
      // The owner's complaint, as a standing assertion: neither create
      // surface may reappear as a row at the end of the narrow content
      // column. `case-notes` (read-only, and absent while there are no
      // notes) is unaffected -- only the two WRITE surfaces moved.
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      expect(screen.queryByTestId('disclosure-add-note')).not.toBeInTheDocument();
      expect(screen.queryByTestId('disclosure-add-concern')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-note-form')).not.toBeInTheDocument();
      expect(screen.queryByTestId('custom-concern-form')).not.toBeInTheDocument();
    });

    it('starts every investigative disclosure row closed by default', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      for (const testId of ['disclosure-still-checking']) {
        expect(screen.getByTestId<HTMLDetailsElement>(testId).open).toBe(false);
      }
      // "What Sift found" is the app bar's "Findings" control now (ADR
      // 0008), not a disclosure at all -- "closed by default" for this
      // region means the sheet is not open yet.
      expect(screen.queryByTestId('findings-sheet')).not.toBeInTheDocument();
      // "Manage options", "Add a note" and "Add a question" likewise have no
      // disclosure row any more -- all three are app-bar create-menu items,
      // and every sheet they open is closed by default. The menu itself is
      // closed too, so none of the three even exists in the DOM yet.
      expect(screen.queryByTestId('workspace-add-option-sheet')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-notes-sheet')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-add-concern-sheet')).not.toBeInTheDocument();
      expect(screen.getByTestId('workspace-app-bar-create-menu')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('shows a live option count on the app bar (ADR 0008: "Manage options" is no longer a disclosure row)', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        entities: [
          {
            id: 'candidate-rav4',
            kind: 'car',
            label: 'Toyota RAV4',
            attributes: {},
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
          {
            id: 'candidate-crv',
            kind: 'car',
            label: 'Honda CR-V',
            attributes: {},
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-app-bar-option-count')).toHaveTextContent('2 options');
      });
      expect(screen.queryByTestId('disclosure-options')).not.toBeInTheDocument();
    });

    it('shows a live finding count on the Findings control for the rendered layout, and on the alert banner', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        sources: [
          {
            id: 'source-1',
            url: 'https://dealer.example.com',
            title: 'Dealer quote',
            retrievedAt: '2026-08-27T00:00:00.000Z',
            origin: 'user_submitted',
            verification: 'unverified',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        ],
        evidenceLinks: [
          {
            id: 'evidence-1',
            obligationId: 'obl-1',
            sourceId: 'source-1',
            level: 'E1',
            verdict: 'fail',
            disposition: 'included',
            summary: 'Price could not be confirmed.',
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      // jsdom has no layout engine, so the width hook reports narrow and this
      // renders the guided stage (ADR 0016), where findings live on the
      // Analysis stage rather than the app bar. Asserted as the rendered
      // sentence a person reads, so a count that stops agreeing with the
      // evidence fails instead of quietly changing.
      await waitFor(() => {
        expect(screen.getByTestId('case-stage-analysis-open-findings')).toHaveTextContent(
          'Review 1 flagged finding',
        );
      });
      expect(screen.queryByTestId('disclosure-findings')).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('workspace-alert-banner-item-findings')).toHaveTextContent(
          '1 finding needs your attention.',
        );
      });
    });

    it('shows "All checked" on "Still checking" when the case has no required questions', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, obligations: [] });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('disclosure-still-checking-meta')).toHaveTextContent(
          'All checked',
        );
      });
    });

    it('shows a remaining count on "Still checking" when the case is not ready', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        obligations: [
          {
            id: 'obl-1',
            label: 'Confirm total price',
            question: 'What is the out-the-door price?',
            category: 'price',
            required: true,
            priority: 1,
            requiredEvidenceLevel: 'E1',
            maxAttempts: 3,
            acceptedUncertaintyAllowed: false,
            dependsOn: [],
            preferredSkills: [],
            preferredSpecialists: [],
            completionRule: {
              minimumEvidenceLevel: 'E1',
              minimumIndependentSources: 1,
              acceptedUncertaintyAllowed: false,
            },
            origin: 'pack',
            status: 'active',
            attemptsUsed: 1,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('disclosure-still-checking-meta')).toHaveTextContent(
          '1 still open',
        );
      });
    });

    // The raw chronological ledger this test used to check ("Sift's work so
    // far" / `ActivityTimeline`, with its own live-pulsing indicator) is
    // retired from the consumer surface entirely (ADR 0004 item 3/4); the
    // equivalent "a live run visibly and quietly updates the workspace"
    // coverage now lives in 'live workspace wiring' > "streams a live,
    // correlated SSE event into the hero's LiveRunStatus indicator and
    // phase headline", against the hero's own `LiveRunStatus`.

    it('renders the primary Quick Pick / List / Compare / Board view switcher, always expanded (not a disclosure row)', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-switcher')).toBeInTheDocument();
      });
      expect(screen.getByTestId('case-workflow-stepper')).toBeInTheDocument();
      expect(screen.getByText(/Step \d of 5/)).toBeInTheDocument();
      // A real `<details>` disclosure would carry a `disclosure-*` testid
      // (per `DisclosureSection`'s own naming convention) -- the view
      // switcher deliberately carries none, because ADR 0004 item 5 makes
      // it a primary, always-expanded surface, not a closed-by-default row.
      expect(screen.queryByTestId('disclosure-view')).not.toBeInTheDocument();
    });

    // Task A10 (`docs/planning/plans/2026-08-30-generic-decision-workspace.md`
    // Phase A): the regenerated 390px baseline measured ~3379px tall, driven
    // largely by Compare's always-fully-expanded attribute table rendering
    // as the *default* view on a freshly opened case -- directly against
    // change-set §64's "reduce apparent complexity." Quick Pick renders
    // exactly one option at a time, so defaulting there instead cuts the
    // first-paint height dramatically while every view, including Compare,
    // remains reachable in exactly one tap on the always-visible tab strip
    // (nothing becomes unreachable, per this task's own constraint). This
    // test locks in the default so a future change cannot silently revert
    // it back to the tall table.
    it('defaults the workspace view switcher to Quick Pick, not the always-expanded Compare table', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-switcher')).toBeInTheDocument();
      });
      // Radix `Tabs` keeps every panel mounted in the DOM (hidden via the
      // native `hidden` attribute rather than unmounted) so it can animate
      // transitions -- `getByTestId` alone would find an inactive panel
      // too, so visibility (`toBeVisible`, which respects `hidden`) is the
      // real assertion of which view is actually showing.
      expect(screen.getByTestId('workspace-view-content-quick_pick')).toBeVisible();
      expect(screen.getByTestId('workspace-view-content-compare')).not.toBeVisible();

      // Every view, including Compare, stays reachable in exactly one tap.
      const user = userEvent.setup();
      await user.click(screen.getByTestId('workspace-view-tab-compare'));
      expect(screen.getByTestId('workspace-view-content-compare')).toBeVisible();
    });

    it('surfaces a pending agent-proposed extension through the alert banner, which opens the "Add a question" sheet in one click', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        caseExtensions: [
          {
            id: 'ext-1',
            caseId: CASE_ID,
            definition: {
              id: 'custom.pet_sensory_fit',
              label: 'Pet sensory fit',
              valueType: 'string',
              required: false,
              appliesTo: ['car'],
              evidenceExpectation: 'assertion',
              comparison: 'none',
              sensitive: false,
              origin: 'agent_proposed',
              reason: 'The household mentioned a sound-sensitive dog.',
              confirmation: 'pending',
              proposedBy: 'lead-investigator',
              createdAt: '2026-08-27T00:00:00.000Z',
            },
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      // The "Add a question" region is a Sheet now, not a self-opening
      // disclosure row, so `defaultOpen`/`meta` are gone with it. The
      // signal they carried ("1 needs your review", visible without
      // scrolling) is not lost: it was always ALSO carried by the alert
      // banner at the top of the stack, which is strictly more visible than
      // a `<summary>` at the bottom of it -- and its action now reveals the
      // review card itself in one click, in BOTH layouts.
      const alertAction = await screen.findByTestId(
        'workspace-alert-banner-action-pending-extension',
      );
      await user.click(alertAction);

      await waitFor(() => {
        expect(screen.getByTestId('workspace-add-concern-sheet')).toBeInTheDocument();
      });
      expect(screen.getByTestId('case-extension-review-card-label')).toHaveTextContent(
        'Pet sensory fit',
      );
    });

    it('raises no pending-extension alert, and no review card anywhere, when nothing is pending', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      expect(
        screen.queryByTestId('workspace-alert-banner-item-pending-extension'),
      ).not.toBeInTheDocument();

      // ...and the create-menu route to the same region opens a form with no
      // review card attached to it.
      await openCreateMenuItem(
        user,
        'workspace-app-bar-add-concern',
        'workspace-add-concern-sheet',
      );
      expect(screen.getByTestId('custom-concern-form')).toBeInTheDocument();
      expect(screen.queryByTestId('case-extension-review-card')).not.toBeInTheDocument();
    });

    // Task A2 audit finding: `CaseExtensionReviewCard` is already correctly
    // gated at the orchestration level (`pendingExtension !== null ? ... :
    // null`, per this file's own ADR 0004 item 2 comment) -- audit §2
    // region 3, "Proposed concern." That gating was never actually proven
    // by a test asserting the region's own root testid is absent, only by
    // tests about the surrounding `DisclosureSection`'s open/closed state
    // and meta text. This closes that gap directly, per plan task A2's own
    // *done when*: "a test asserts each region is absent (not merely
    // empty) when it has no content."
    it('renders no CaseExtensionReviewCard at all (not merely closed) when no agent-proposed extension is pending', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      expect(screen.queryByTestId('case-extension-review-card')).not.toBeInTheDocument();
    });

    it('opens "Still checking" on click and reveals the readiness panel it wraps', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('disclosure-still-checking-summary'));
      expect(screen.getByTestId<HTMLDetailsElement>('disclosure-still-checking').open).toBe(true);
      expect(screen.getByTestId('readiness-panel-status')).toBeInTheDocument();
    });
  });

  // Independent spec-audit finding, addressed this task alongside A11:
  // `DecisionProfileView` was fully built and fully tested but never
  // mounted anywhere in the shipped product (not in `App.tsx`, not even
  // exported from `apps/web/src/index.ts`) -- change-set DoD item 15/16,
  // "Decision Profile is coherent and visible."
  describe('Decision Profile (spec-audit gap: built but never mounted)', () => {
    it('renders the Decision Profile for a seeded case with real criteria', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        criteria: [
          {
            id: 'crit-budget',
            label: 'Budget',
            kind: 'hard_constraint',
            weight: 20,
            direction: 'higher_better',
            origin: 'pack',
            status: 'active',
            target: { type: 'money', amount: 40000, currency: 'USD' },
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      // Priorities owns the Decision Profile (ADR 0016).
      await goToWorkflowStage(user, 'priorities');

      await waitFor(() => {
        expect(screen.getByTestId('disclosure-decision-profile')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('disclosure-decision-profile-summary'));
      expect(screen.getByTestId('decision-profile-view')).toBeInTheDocument();
      expect(screen.getByTestId('decision-profile-view-concern-crit-budget')).toHaveTextContent(
        'Budget',
      );
    });

    it('renders no Decision Profile region at all when the case has no criteria, extensions, or missing/suggested items (global constraint 4)', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID, criteria: [], caseExtensions: [] });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      expect(screen.queryByTestId('disclosure-decision-profile')).not.toBeInTheDocument();
      expect(screen.queryByTestId('decision-profile-view')).not.toBeInTheDocument();
    });
  });

  // W3-B: `CaseNotes` (§28/§63) mounted for the first time this task.
  // Mirrors the Decision Profile block immediately above: the smallest
  // possible `App.tsx` change is an unconditional mount, since `CaseNotes`
  // renders `null` itself when there are no notes (global constraint 4).
  describe('Notes (CaseNotes, §28/§63)', () => {
    it('renders every note on the active case, most-recently-added first, with who wrote it', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        notes: [
          {
            id: 'note-1',
            body: 'The seat position felt wrong on the test drive.',
            kind: 'observation',
            origin: 'user',
            authoredBy: 'user',
            optionIds: [],
            sourceIds: [],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'note-2',
            body: 'Dealer said the timing belt was done at 90k.',
            kind: 'research',
            origin: 'agent_proposed',
            authoredBy: 'model',
            optionIds: [],
            sourceIds: [],
            createdAt: '2026-01-01T00:00:01.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      // Notes live on one sheet at every width now. They used to also be
      // mounted inline in the narrow column, which meant that opening this
      // sheet below 800px put two `case-notes` sections -- and two elements
      // carrying the same `id="case-notes-heading"` -- in the document at
      // once. Opening the sheet is the only way to read a note now, so this
      // test opens it.
      await openCreateMenuItem(
        userEvent.setup(),
        'workspace-app-bar-add-note',
        'workspace-notes-sheet',
      );

      await waitFor(() => {
        expect(screen.getByTestId('case-notes')).toBeInTheDocument();
      });
      expect(screen.getByTestId('case-note-body-note-2')).toHaveTextContent(
        'Dealer said the timing belt was done at 90k.',
      );
      expect(screen.getAllByTestId(/^case-note-body-/).map((el) => el.textContent)).toEqual([
        'Dealer said the timing belt was done at 90k.',
        'The seat position felt wrong on the test drive.',
      ]);
    });

    it('renders no Notes region at all (not merely empty) when the case has no notes', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      // `CaseNotes` returns `null` on a case with no notes, so the region is
      // absent even with its sheet open -- empty, not merely hidden.
      await openCreateMenuItem(
        userEvent.setup(),
        'workspace-app-bar-add-note',
        'workspace-notes-sheet',
      );

      expect(screen.queryByTestId('case-notes')).not.toBeInTheDocument();
    });
  });

  // A human-facing "add note" affordance -- `CaseNote`/`note.added`/
  // `addNote` were already fully built and reachable only through the
  // `sift_add_note` WebMCP tool; this closes the gap for a person at the
  // keyboard. `AddNoteForm` used to live in its own closed-by-default
  // bottom-of-stack `DisclosureSection`; it is now an app-bar create-menu
  // item opening a Sheet, in BOTH layouts (the owner: "Add a note and add a
  // question should be in either the header or footer toolbars -- not at the
  // bottom of the stack"). The property that mattered about the old
  // placement still holds and is still asserted below: the affordance is
  // reachable even when `CaseNotes` itself renders nothing (global
  // constraint 4), and an empty case grows no permanent empty region -- now
  // it grows no permanent row at all, only a menu item.
  describe('Add a note (AddNoteForm)', () => {
    it('stays reachable from the app bar even when the case has no notes yet', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      expect(screen.queryByTestId('case-notes')).not.toBeInTheDocument();

      await openCreateMenuItem(user, 'workspace-app-bar-add-note', 'workspace-notes-sheet');
      expect(screen.getByTestId('add-note-form')).toBeInTheDocument();
    });

    it('costs the resting page no vertical space at all until it is asked for', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      // The whole point of the move: nothing about "add a note" is in the
      // scrolling column at rest -- no row, no summary, no form.
      expect(screen.queryByTestId('disclosure-add-note')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-note-form')).not.toBeInTheDocument();
      expect(screen.queryByTestId('workspace-notes-sheet')).not.toBeInTheDocument();
    });

    it('submits a human-entered note through commands.addNote with no origin field, and shows success', async () => {
      let capturedBody: unknown;
      server.use(
        commandHandler('addNote', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          capturedBody = body;
        }),
      );
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      await openCreateMenuItem(user, 'workspace-app-bar-add-note', 'workspace-notes-sheet');
      await user.type(
        screen.getByLabelText('Note'),
        'The seat position felt wrong on the test drive.',
      );
      await user.click(screen.getByTestId('add-note-form-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('add-note-form-success')).toBeInTheDocument();
      });
      expect(capturedBody).toEqual({
        caseId: CASE_ID,
        expectedSequence: snapshot.eventSequence,
        note: { body: 'The seat position felt wrong on the test drive.' },
      });
    });

    /**
     * The regression: a visible control sent an `expectedSequence` read out
     * of a snapshot that the client's own refresh schedule had allowed to
     * fall behind, and the server correctly refused it.
     *
     * Two changes made the window reachable in ordinary use. The runtime now
     * streams a run's events as the graph progresses rather than draining
     * them at the end, so the case sequence climbs steadily during a run; and
     * `use-case-events.ts` now coalesces snapshot refreshes (73 requests in
     * 70 ms was a real defect), so the snapshot can legitimately trail by up
     * to `snapshotRefreshIntervalMs`. A person pressing a button inside that
     * window got a hard failure caused by nothing they did.
     *
     * This asserts the sequence actually put on the wire, not the end state:
     * every end-state assertion in this file passes with the defect present,
     * because a conflict here is refused server-side and the command simply
     * never happens.
     */
    it('sends the sequence the server would accept when a server-originated event has advanced the case past the snapshot in hand', async () => {
      const staleSnapshot = buildFixtureCaseState({ id: CASE_ID, eventSequence: 41 });
      const advancedSnapshot = buildFixtureCaseState({ id: CASE_ID, eventSequence: 42 });
      let reads = 0;
      let releaseCoalescedRefresh: () => void = () => undefined;
      const coalescedRefreshLanded = new Promise<void>((resolve) => {
        releaseCoalescedRefresh = resolve;
      });
      let capturedBody: unknown;

      renderLiveWorkspace(staleSnapshot);
      server.use(
        // The canonical-snapshot route, with the client's event-driven
        // refresh held open so the pane is provably one behind the server at
        // the moment of the click -- the deterministic stand-in for "the
        // coalescing interval has not elapsed yet".
        http.get(`/api/cases/${CASE_ID}/events`, async () => {
          reads += 1;
          if (reads === 1) {
            return HttpResponse.json({ snapshot: staleSnapshot, events: [] });
          }
          if (reads === 2) await coalescedRefreshLanded;
          return HttpResponse.json({ snapshot: advancedSnapshot, events: [] });
        }),
        commandHandler('addNote', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          capturedBody = body;
        }),
      );

      const user = await startDemoAndWait();
      await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
      const source = FakeEventSource.instances[0]!;
      source.triggerOpen();

      // The server advances the case on its own and says so over SSE. The
      // event carries an ACTIVITY sequence, which is a different counter from
      // `CaseState.eventSequence` -- it announces that the case moved without
      // ever saying where it moved to.
      act(() => {
        source.emit({
          schemaVersion: '1.0',
          eventId: 'evt-server-originated',
          sequence: 1,
          timestamp: '2026-08-27T00:00:00.000Z',
          caseId: CASE_ID,
          type: 'specialist.completed',
          phase: 'completed',
          summary: 'Deal normalization finished.',
        });
      });
      await waitFor(() => expect(reads).toBe(2));

      await openCreateMenuItem(user, 'workspace-app-bar-add-note', 'workspace-notes-sheet');
      await user.type(screen.getByLabelText('Note'), 'Ask about the roof rails.');
      await user.click(screen.getByTestId('add-note-form-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('add-note-form-success')).toBeInTheDocument();
      });
      expect(capturedBody).toEqual({
        caseId: CASE_ID,
        // 42, not the 41 the rendered snapshot still shows.
        expectedSequence: advancedSnapshot.eventSequence,
        note: { body: 'Ask about the roof rails.' },
      });

      releaseCoalescedRefresh();
    });
  });

  // Task A11: the rendered workspace view must derive from the persisted
  // `CaseState.view` when one exists, rather than from an independent local
  // `useState` -- otherwise a genuinely persisted `sift_set_view` WebMCP
  // call (or any other writer of `CaseState.view`) can succeed on the
  // server while the open page silently never moves, which is exactly the
  // "two sources of truth" global constraint 5 forbids.
  describe('workspace view state derives from the persisted CaseState.view (Task A11)', () => {
    it('renders the persisted view on load instead of the local default when CaseState.view is already set', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        view: { mode: 'compare' },
      });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-tab-compare')).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });
      // Radix keeps every panel mounted (hidden via the native `hidden`
      // attribute) -- visibility, not mere presence, is the real proof of
      // which view actually rendered (same technique the pre-existing
      // "defaults ... to Quick Pick" test above uses).
      expect(screen.getByTestId('workspace-view-content-compare')).toBeVisible();
      expect(screen.getByTestId('workspace-view-content-quick_pick')).not.toBeVisible();
    });

    it('falls back to the quick_pick default when the case has never set a view (view is absent, not written on load)', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-tab-quick_pick')).toHaveAttribute(
          'aria-selected',
          'true',
        );
      });
    });

    it('optimistically reflects a user-initiated view change immediately, ahead of any persisted round trip', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();

      expect(screen.getByTestId('workspace-view-content-quick_pick')).toBeVisible();

      await user.click(screen.getByTestId('workspace-view-tab-list'));

      expect(screen.getByTestId('workspace-view-tab-list')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByTestId('workspace-view-content-list')).toBeVisible();
    });

    it('writes a user-initiated view change through the real setView command with the full WorkspaceViewState', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      let capturedBody: unknown;
      renderLiveWorkspace(snapshot);
      server.use(
        commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          capturedBody = body;
        }),
      );
      const user = await startDemoAndWait();

      await user.click(screen.getByTestId('workspace-view-tab-list'));

      await waitFor(() => {
        expect(capturedBody).toMatchObject({
          caseId: CASE_ID,
          expectedSequence: snapshot.eventSequence,
          view: { mode: 'list' },
        });
      });
    });

    it('re-derives the rendered view from a newly persisted CaseState.view delivered over the live event stream', async () => {
      // Proves the read side reacts to a LATER persisted change too, not
      // just the initial snapshot -- e.g. a real WebMCP `sift_set_view`
      // call landing while the page is already open.
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      renderLiveWorkspace(snapshot);
      await startDemoAndWait();
      expect(screen.getByTestId('workspace-view-content-quick_pick')).toBeVisible();

      server.use(
        pollHandler({
          ...snapshot,
          view: { mode: 'board' },
          eventSequence: snapshot.eventSequence + 1,
        }),
      );
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      const source = FakeEventSource.instances.at(-1)!;
      source.triggerOpen();
      source.emit({
        schemaVersion: '1.0',
        eventId: 'evt-view-1',
        sequence: snapshot.eventSequence + 1,
        timestamp: '2026-08-27T00:02:00.000Z',
        caseId: CASE_ID,
        commandId: 'cmd-set-view-1',
        type: 'command.accepted',
        phase: 'completed',
        summary: 'Set workspace view to "board".',
      });

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-board')).toBeVisible();
      });
    });

    it('does not revert a just-chosen view when a stale snapshot re-delivers the previous persisted value', async () => {
      // Regression gate for a real defect the visual gate caught: two runs
      // of the same Playwright journey rendered DIFFERENT tabs, because the
      // reconciliation effect cleared the local override as soon as the
      // persisted value equalled it, after which `viewMode` fell back to the
      // persisted field alone -- so any later re-delivery of an older
      // snapshot flipped the tab back underneath the user.
      //
      // A `setView` write is especially likely to lose that race during a
      // live run: it carries `expectedSequence`, the run advances
      // `eventSequence` continuously, so the persisted value may never catch
      // up at all. The user's explicit choice must survive that.
      const snapshot = buildFixtureCaseState({ id: CASE_ID, view: { mode: 'compare' } });
      renderLiveWorkspace(snapshot);
      server.use(commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID })));
      const user = await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-compare')).toBeVisible();
      });

      await user.click(screen.getByTestId('workspace-view-tab-list'));
      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-list')).toBeVisible();
      });

      // A stale refresh re-delivers the OLD persisted view ('compare'). It is
      // not a new value, so it must not override the choice just made.
      server.use(pollHandler({ ...snapshot, view: { mode: 'compare' } }));
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      const source = FakeEventSource.instances.at(-1)!;
      source.triggerOpen();
      source.emit({
        schemaVersion: '1.0',
        eventId: 'evt-view-stale',
        sequence: snapshot.eventSequence + 1,
        timestamp: '2026-08-27T00:03:00.000Z',
        caseId: CASE_ID,
        type: 'evidence.accepted',
        phase: 'completed',
        summary: 'Evidence accepted.',
      });

      // Give the effect every chance to misfire before asserting it did not.
      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-list')).toBeVisible();
      });
      expect(screen.queryByTestId('workspace-view-content-compare')).not.toBeVisible();
    });
  });

  // Seam defect closed this task (this file's own top-of-conversation
  // brief): `sift_configure_comparison`/`sift_set_view` genuinely persist
  // `CaseState.view.compare.optionIds`/`visibleAttributeIds`/
  // `pinnedAttributeIds` through the real `setView` command, and
  // `OptionCompareView` genuinely implements those as real narrowing props
  // -- but nothing in `App.tsx` read the persisted values and passed them
  // down, so a real `sift_configure_comparison` WebMCP call reported success
  // while the rendered table never moved. This is the §58 demo moment's own
  // regression gate: a persisted view configuration must actually change
  // what the Compare table renders, not merely be storable.
  describe('Compare view configuration reaches OptionCompareView (WebMCP demo moment, §58)', () => {
    const PRICE_DEFINITION = {
      id: 'price',
      label: 'Price',
      valueType: 'money' as const,
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion' as const,
      comparison: 'lower_better' as const,
      sensitive: false,
    };
    const MILEAGE_DEFINITION = {
      id: 'mileage',
      label: 'Mileage',
      valueType: 'number' as const,
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion' as const,
      comparison: 'lower_better' as const,
      sensitive: false,
    };

    function buildCar(id: string, label: string, price: number) {
      return {
        id,
        kind: 'car',
        label,
        attributes: {
          price: {
            definitionId: 'price',
            label: 'Price',
            value: { type: 'money' as const, amount: price, currency: 'USD' },
            origin: 'user' as const,
            sourceIds: [],
            status: 'asserted' as const,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
          mileage: {
            definitionId: 'mileage',
            label: 'Mileage',
            value: { type: 'number' as const, value: 10000, unit: 'mi' },
            origin: 'user' as const,
            sourceIds: [],
            status: 'asserted' as const,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        },
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      };
    }

    // `stubExpandedLayout()` (module scope, near `openFindingsSheet` above)
    // forces expanded layout so `OptionCompareView`'s own narrow-layout
    // head-to-head auto-pairing (which independently limits to 2 columns)
    // cannot masquerade as this test's real subject: the persisted
    // `compare.optionIds`/`visibleAttributeIds`/`pinnedAttributeIds` wiring.

    it('renders every option and attribute unchanged when the persisted view has no compare configuration', async () => {
      stubExpandedLayout();
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        view: { mode: 'compare' },
        attributeDefinitions: [PRICE_DEFINITION, MILEAGE_DEFINITION],
        entities: [
          buildCar('candidate-rav4', 'Toyota RAV4', 28500),
          buildCar('candidate-crv', 'Honda CR-V', 32400),
          buildCar('candidate-forester', 'Subaru Forester', 27000),
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-compare')).toBeVisible();
      });
      expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
      expect(
        screen.getByTestId('option-compare-view-header-candidate-forester'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-row-mileage')).toBeInTheDocument();

      vi.unstubAllGlobals();
    });

    it('a persisted view.compare.optionIds/visibleAttributeIds/pinnedAttributeIds configuration genuinely narrows what the Compare table renders, and the hidden option is explained as not eliminated', async () => {
      stubExpandedLayout();
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        view: {
          mode: 'compare',
          compare: { optionIds: ['candidate-rav4', 'candidate-crv'] },
          visibleAttributeIds: ['price'],
          pinnedAttributeIds: ['price'],
        },
        attributeDefinitions: [PRICE_DEFINITION, MILEAGE_DEFINITION],
        entities: [
          buildCar('candidate-rav4', 'Toyota RAV4', 28500),
          buildCar('candidate-crv', 'Honda CR-V', 32400),
          buildCar('candidate-forester', 'Subaru Forester', 27000),
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-compare')).toBeVisible();
      });
      // The model's reconfiguration genuinely reached the rendered table.
      expect(screen.getByTestId('option-compare-view-header-candidate-rav4')).toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-header-candidate-crv')).toBeInTheDocument();
      expect(
        screen.queryByTestId('option-compare-view-header-candidate-forester'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-row-price')).toBeInTheDocument();
      expect(screen.queryByTestId('option-compare-view-row-mileage')).not.toBeInTheDocument();
      expect(screen.getByTestId('option-compare-view-row-price')).toHaveAttribute(
        'data-pinned',
        'true',
      );
      // The Forester was filtered from the comparison, not eliminated --
      // Defect 1's own "never read as eliminated" requirement.
      expect(screen.getByTestId('option-compare-view-filtered-note')).toHaveTextContent(
        /not eliminated/i,
      );

      vi.unstubAllGlobals();
    });

    it('renders a confirmed case extension as a real Compare row; a still-pending one does not appear', async () => {
      stubExpandedLayout();
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        view: { mode: 'compare' },
        attributeDefinitions: [PRICE_DEFINITION],
        entities: [
          {
            ...buildCar('candidate-rav4', 'Toyota RAV4', 28500),
            attributes: {
              ...buildCar('candidate-rav4', 'Toyota RAV4', 28500).attributes,
              'custom.trunk_space': {
                definitionId: 'custom.trunk_space',
                label: 'Trunk space fit',
                value: { type: 'string' as const, value: 'Fits a folded stroller' },
                origin: 'user' as const,
                sourceIds: [],
                status: 'asserted' as const,
                updatedAt: '2026-08-27T00:00:00.000Z',
              },
            },
          },
        ],
        caseExtensions: [
          {
            id: 'ext-confirmed',
            caseId: CASE_ID,
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
          },
          {
            id: 'ext-pending',
            caseId: CASE_ID,
            definition: {
              id: 'custom.pet_sensory_fit',
              label: 'Pet sensory fit',
              valueType: 'string',
              required: false,
              appliesTo: ['car'],
              evidenceExpectation: 'assertion',
              comparison: 'none',
              sensitive: false,
              origin: 'agent_proposed',
              reason: 'The household mentioned a sound-sensitive dog.',
              confirmation: 'pending',
              proposedBy: 'lead-investigator',
              createdAt: '2026-08-27T00:00:00.000Z',
            },
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      renderLiveWorkspace(snapshot);
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-content-compare')).toBeVisible();
      });
      const row = screen.getByTestId('option-compare-view-row-custom.trunk_space');
      expect(row).toHaveTextContent('Trunk space fit');
      expect(
        screen.getByTestId('option-compare-view-custom-badge-custom.trunk_space'),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('option-compare-view-row-custom.pet_sensory_fit'),
      ).not.toBeInTheDocument();

      vi.unstubAllGlobals();
    });
  });

  /**
   * `WorkspaceViewState.visibleOptionIds` reaches the rendered page, and
   * says out loud that it did.
   *
   * `sift_set_view` has always persisted this field, and `OptionListView`/
   * `OptionCompareView` have always implemented it as a real narrowing prop
   * -- but nothing in `App.tsx` read it, so the model could call "show her
   * just those two", collect a success receipt, and the page would not move.
   * The exact seam `compare.optionIds` had before §58 closed it, one field
   * over.
   *
   * The harder half is the second requirement these tests carry: an
   * invisible narrowing is worse than no narrowing. Three cards with no
   * stated reason reads as "there are three cars." So every test below that
   * proves the list got shorter also proves the row above it says who
   * shortened it and offers a way out.
   */
  describe("the assistant's visibleOptionIds narrowing reaches the page, visibly (sift_set_view)", () => {
    const AWD_DEFINITION = {
      id: 'awd',
      label: 'AWD',
      valueType: 'boolean' as const,
      required: false,
      appliesTo: ['car'],
      evidenceExpectation: 'assertion' as const,
      comparison: 'none' as const,
      sensitive: false,
    };

    function buildAwdCar(id: string, label: string, awd: boolean) {
      return {
        id,
        kind: 'car',
        label,
        attributes: {
          awd: {
            definitionId: 'awd',
            label: 'AWD',
            value: { type: 'boolean' as const, value: awd },
            origin: 'user' as const,
            sourceIds: [],
            status: 'asserted' as const,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        },
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      };
    }

    /** Three cars that genuinely disagree on AWD, so a real human filter is available to compose with. */
    const THREE_CARS = [
      buildAwdCar('candidate-rav4', 'Toyota RAV4', true),
      buildAwdCar('candidate-crv', 'Honda CR-V', false),
      buildAwdCar('candidate-forester', 'Subaru Forester', true),
    ];

    function buildNarrowedCase(view: Partial<NonNullable<CaseState['view']>>) {
      return buildFixtureCaseState({
        id: CASE_ID,
        attributeDefinitions: [AWD_DEFINITION],
        entities: THREE_CARS,
        view: { mode: 'list', ...view },
      });
    }

    it('renders only the options the assistant named', async () => {
      renderLiveWorkspace(
        buildNarrowedCase({ visibleOptionIds: ['candidate-forester', 'candidate-rav4'] }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('option-list-view-card-candidate-rav4')).toBeInTheDocument();
      });
      expect(screen.getByTestId('option-list-view-card-candidate-forester')).toBeInTheDocument();
      expect(screen.queryByTestId('option-list-view-card-candidate-crv')).not.toBeInTheDocument();
    });

    it("keeps the case's own option order rather than resequencing to match the assistant's list", async () => {
      renderLiveWorkspace(
        buildNarrowedCase({ visibleOptionIds: ['candidate-forester', 'candidate-rav4'] }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('option-list-view-cards')).toBeInTheDocument();
      });
      // The order on screen is the person's own working arrangement. Naming
      // ids in a different sequence says WHICH to show, not "re-sort my page."
      const rendered = [...screen.getByTestId('option-list-view-cards').children].map((card) =>
        card.getAttribute('data-testid'),
      );
      expect(rendered).toEqual([
        'option-list-view-card-candidate-rav4',
        'option-list-view-card-candidate-forester',
      ]);
    });

    it('says plainly that the assistant narrowed the view, instead of just showing a shorter list', async () => {
      renderLiveWorkspace(
        buildNarrowedCase({ visibleOptionIds: ['candidate-rav4', 'candidate-forester'] }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      });
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toHaveTextContent(
        'Assistant narrowed to 2',
      );
      // And the true total stays on screen, so nobody concludes the case
      // only ever held two cars.
      expect(screen.getByTestId('workspace-filter-result-count')).toHaveTextContent('2 of 3');
    });

    it("composes with the human's own filters -- both narrowings hold at once", async () => {
      renderLiveWorkspace(
        buildNarrowedCase({
          visibleOptionIds: ['candidate-rav4', 'candidate-crv'],
          filters: [{ fieldId: 'awd', operator: 'equals', value: 'true' }],
        }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      // The CR-V is inside the assistant's set but fails the person's
      // filter; the Forester passes the filter but is outside the set.
      // Only the RAV4 satisfies both.
      await waitFor(() => {
        expect(screen.getByTestId('option-list-view-card-candidate-rav4')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('option-list-view-card-candidate-crv')).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('option-list-view-card-candidate-forester'),
      ).not.toBeInTheDocument();
      // Both reasons are on screen at once, each with its own way out.
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-filter-chip-awd')).toBeInTheDocument();
    });

    it('ignores an id naming no saved option rather than failing to render', async () => {
      // A `visibleOptionIds` persisted before an option was deleted still
      // names it. Ordinary staleness, not corruption.
      renderLiveWorkspace(
        buildNarrowedCase({ visibleOptionIds: ['candidate-rav4', 'candidate-deleted'] }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('option-list-view-card-candidate-rav4')).toBeInTheDocument();
      });
      expect(screen.getByTestId('workspace-filter-assistant-chip')).toHaveTextContent(
        'Assistant narrowed to 1',
      );
    });

    it('clearing it brings the hidden options straight back', async () => {
      renderLiveWorkspace(buildNarrowedCase({ visibleOptionIds: ['candidate-rav4'] }));
      server.use(commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID })));
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('workspace-filter-assistant-chip-remove'));

      await waitFor(() => {
        expect(screen.getByTestId('option-list-view-card-candidate-crv')).toBeInTheDocument();
      });
      expect(screen.getByTestId('option-list-view-card-candidate-forester')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-filter-assistant-chip')).not.toBeInTheDocument();
    });

    it('clearing it PERSISTS through the same setView path the filter chips use, not just locally', async () => {
      // `visibleOptionIds` is a durable field on the snapshot. A ✕ that only
      // hid it locally would put the narrowing back on the next reload, with
      // the person having no idea why.
      const setViewBodies: unknown[] = [];
      renderLiveWorkspace(buildNarrowedCase({ visibleOptionIds: ['candidate-rav4'] }));
      server.use(
        commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          setViewBodies.push(body);
        }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('workspace-filter-assistant-chip-remove'));

      await waitFor(() => expect(setViewBodies.length).toBeGreaterThan(0));
      const cleared = setViewBodies.at(-1) as { view: { mode: string } };
      expect(cleared.view).not.toHaveProperty('visibleOptionIds');
      // Presentation only, and still the person's own view: clearing the
      // assistant's narrowing must not smuggle in a mode change or drop the
      // filters alongside it.
      expect(cleared.view.mode).toBe('list');
    });

    it('a later view-mode write cannot resurrect a narrowing the person just cleared', async () => {
      // The two view writers are separate single-flight queues that both
      // rebuild the full `WorkspaceViewState` from a snapshot which lags
      // whatever the other has in flight -- exactly the race `intendedViewRef`
      // exists for. Without the clear joining that shared intent, switching
      // tabs a moment later would spread the stale `visibleOptionIds` back
      // out of the snapshot and undo it.
      const setViewBodies: unknown[] = [];
      renderLiveWorkspace(buildNarrowedCase({ visibleOptionIds: ['candidate-rav4'] }));
      server.use(
        commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          setViewBodies.push(body);
        }),
      );
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('workspace-filter-assistant-chip-remove'));
      await user.click(screen.getByTestId('workspace-view-tab-board'));

      await waitFor(() => {
        expect(
          setViewBodies.some((body) => (body as { view: { mode: string } }).view.mode === 'board'),
        ).toBe(true);
      });
      for (const body of setViewBodies) {
        expect((body as { view: Record<string, unknown> }).view).not.toHaveProperty(
          'visibleOptionIds',
        );
      }
    });

    it('a genuinely new narrowing from the assistant still lands after an earlier one was cleared', async () => {
      // The cleared-intent flag must not become a permanent veto: the person
      // clears "those three", then asks for a different three in chat.
      const snapshot = buildNarrowedCase({ visibleOptionIds: ['candidate-rav4'] });
      renderLiveWorkspace(snapshot);
      server.use(commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID })));
      const user = await startDemoAndWait();
      // Review owns the option views, the lens strip and the filter bar (ADR 0016).
      await goToWorkflowStage(user, 'review');

      await waitFor(() => {
        expect(screen.getByTestId('workspace-filter-assistant-chip')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('workspace-filter-assistant-chip-remove'));
      await waitFor(() => {
        expect(screen.queryByTestId('workspace-filter-assistant-chip')).not.toBeInTheDocument();
      });

      // A real `sift_set_view` landing while the page is open, delivered the
      // way the live stream delivers every other durable change.
      server.use(
        pollHandler({
          ...snapshot,
          eventSequence: snapshot.eventSequence + 1,
          view: { mode: 'list', visibleOptionIds: ['candidate-crv', 'candidate-forester'] },
        }),
      );
      await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
      const source = FakeEventSource.instances.at(-1)!;
      source.triggerOpen();
      source.emit({
        schemaVersion: '1.0',
        eventId: 'evt-narrowing-1',
        sequence: snapshot.eventSequence + 1,
        timestamp: '2026-08-27T00:04:00.000Z',
        caseId: CASE_ID,
        commandId: 'cmd-set-view-narrow',
        type: 'command.accepted',
        phase: 'completed',
        summary: 'Set workspace view to "list".',
      });

      await waitFor(() => {
        expect(screen.getByTestId('workspace-filter-assistant-chip')).toHaveTextContent(
          'Assistant narrowed to 2',
        );
      });
      expect(screen.queryByTestId('option-list-view-card-candidate-rav4')).not.toBeInTheDocument();
    });
  });

  // ADR 0008 "Two Modes, One Product": `WorkspaceAppBar`/`WorkspaceAlertBanner`
  // replace `CaseHeader` and the former bottom-of-page "Manage options"/
  // "What Sift found" disclosures in BOTH layout modes; `WorkspaceSidebar`
  // plus this file's own sheet-based utility controls are the web-app-mode
  // (`layout: 'expanded'`) equivalent of the narrow-mode disclosures that
  // remain elsewhere in this file.
  describe('ADR 0008 two-mode product architecture', () => {
    describe('WorkspaceAlertBanner (derived from real state, never fabricated)', () => {
      it('renders no alert banner at all when nothing warrants attention', async () => {
        const snapshot = buildFixtureCaseState({ id: CASE_ID });
        renderLiveWorkspace(snapshot);
        await startDemoAndWait();

        expect(screen.queryByTestId('workspace-alert-banner')).not.toBeInTheDocument();
      });

      it('shows a findings alert (from the same flaggedFindingsCount the app bar badge uses) with a working "Review findings" action', async () => {
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          sources: [
            {
              id: 'source-1',
              url: 'https://dealer.example.com',
              title: 'Dealer quote',
              retrievedAt: '2026-08-27T00:00:00.000Z',
              origin: 'user_submitted',
              verification: 'unverified',
              createdAt: '2026-08-27T00:00:00.000Z',
            },
          ],
          evidenceLinks: [
            {
              id: 'evidence-1',
              obligationId: 'obl-1',
              sourceId: 'source-1',
              level: 'E1',
              verdict: 'fail',
              disposition: 'included',
              summary: 'Price could not be confirmed.',
              stale: false,
              createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
          ],
        });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        const item = await screen.findByTestId('workspace-alert-banner-item-findings');
        expect(item).toHaveTextContent('1 finding needs your attention.');

        await user.click(screen.getByTestId('workspace-alert-banner-action-findings'));
        await waitFor(() => {
          expect(screen.getByTestId('findings-sheet')).toBeInTheDocument();
        });
      });

      it('omits a recommendation-ready alert once a recommendation is pending approval -- the hero directly below already carries that exact headline plus the live Approve/Reject/Revise controls, so a banner repeating it verbatim would only duplicate the sentence and push the hero further down the pane', async () => {
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          recommendation: {
            id: 'rec-1',
            status: 'ready',
            favoredOptionId: null,
            rationale: 'Best overall fit.',
            facts: [],
            hypotheses: [],
            confidence: 0.8,
            limitations: [],
            sourceIds: [],
            resolvedObligationIds: [],
            acceptedUncertaintyObligationIds: [],
            generatedAt: '2026-08-27T00:00:00.000Z',
          },
          proposal: {
            id: 'prop-1',
            recommendationId: 'rec-1',
            status: 'pending',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        });
        renderLiveWorkspace(snapshot);
        await startDemoAndWait();

        expect(await screen.findByTestId('recommendation-hero-headline')).toHaveTextContent(
          'Sift has a recommendation ready for your decision.',
        );
        expect(
          screen.queryByTestId('workspace-alert-banner-item-recommendation-ready'),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId('workspace-alert-banner-action-recommendation-ready'),
        ).not.toBeInTheDocument();
      });

      it('shows a pending-extension alert whose action opens the "Add something Sift should check" sheet in expanded mode', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          caseExtensions: [
            {
              id: 'ext-1',
              caseId: CASE_ID,
              definition: {
                id: 'custom.pet_sensory_fit',
                label: 'Pet sensory fit',
                valueType: 'string',
                required: false,
                appliesTo: ['car'],
                evidenceExpectation: 'assertion',
                comparison: 'none',
                sensitive: false,
                origin: 'agent_proposed',
                reason: 'The household mentioned a sound-sensitive dog.',
                confirmation: 'pending',
                proposedBy: 'lead-investigator',
                createdAt: '2026-08-27T00:00:00.000Z',
              },
              createdAt: '2026-08-27T00:00:00.000Z',
            },
          ],
        });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        const item = await screen.findByTestId('workspace-alert-banner-item-pending-extension');
        expect(item).toHaveTextContent('Sift proposed something new to check on this case.');

        await user.click(screen.getByTestId('workspace-alert-banner-action-pending-extension'));
        await waitFor(() => {
          expect(screen.getByTestId('workspace-add-concern-sheet')).toBeInTheDocument();
        });
        expect(screen.getByTestId('case-extension-review-card-label')).toHaveTextContent(
          'Pet sensory fit',
        );
      });

      it('opens the very same "Add a question" sheet from the alert in narrow (pane) mode, with exactly one review card mounted', async () => {
        // This used to be layout-aware: in narrow mode the alert's action
        // only SCROLLED an already-auto-open disclosure into view, because
        // opening the sheet as well would have mounted a second
        // `CaseExtensionReviewCard` over the same extension and
        // double-registered `case-extension-review-card-label` in the DOM.
        // That disclosure is gone (the owner: "Add a note and add a question
        // should be in either the header or footer toolbars -- not at the
        // bottom of the stack"), so the sheet is now the ONLY home for this
        // region and both layouts take the identical, simpler path. The
        // duplicate-mount hazard the old branch existed to avoid is asserted
        // below rather than dropped.
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          caseExtensions: [
            {
              id: 'ext-1',
              caseId: CASE_ID,
              definition: {
                id: 'custom.pet_sensory_fit',
                label: 'Pet sensory fit',
                valueType: 'string',
                required: false,
                appliesTo: ['car'],
                evidenceExpectation: 'assertion',
                comparison: 'none',
                sensitive: false,
                origin: 'agent_proposed',
                reason: 'The household mentioned a sound-sensitive dog.',
                confirmation: 'pending',
                proposedBy: 'lead-investigator',
                createdAt: '2026-08-27T00:00:00.000Z',
              },
              createdAt: '2026-08-27T00:00:00.000Z',
            },
          ],
        });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        // Nothing about the proposal is in the resting scroll column any
        // more -- the review card exists only inside the sheet.
        expect(screen.queryByTestId('case-extension-review-card-label')).not.toBeInTheDocument();

        await user.click(
          await screen.findByTestId('workspace-alert-banner-action-pending-extension'),
        );

        await waitFor(() => {
          expect(screen.getByTestId('workspace-add-concern-sheet')).toBeInTheDocument();
        });
        expect(screen.getAllByTestId('case-extension-review-card-label')).toHaveLength(1);
        expect(screen.getByTestId('case-extension-review-card-label')).toHaveTextContent(
          'Pet sensory fit',
        );
      });

      it('shows a connection-offline alert when the live event stream cannot be reached at all, and clears once it recovers', async () => {
        server.use(
          http.post('/api/cases/demo', () =>
            HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
          ),
          http.get(`/api/cases/${CASE_ID}/events`, () => new HttpResponse(null, { status: 500 })),
          packsHandler([DEFAULT_PACK]),
        );
        const user = userEvent.setup();
        render(
          <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
            <App />
          </AppProviders>,
        );
        await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
        await waitFor(() => expect(screen.getByTestId('case-workspace')).toBeInTheDocument());

        await waitFor(() => {
          expect(
            screen.getByTestId('workspace-alert-banner-item-connection-offline'),
          ).toHaveTextContent('Connection lost. Sift will keep trying to reconnect.');
        });
      });
    });

    describe('ContextActionDock wiring (handleDockAction)', () => {
      it('taking the "review_question" move -- the ONLY move `deriveNextMoves` offers on a decided case, and therefore the dock\'s primary button on the final screen of both hero journeys -- brings the person to the recommendation hero (which already carries the decision) instead of doing nothing', async () => {
        // Regression test for a real dead-button defect: `handleDockAction`
        // dispatched on `move.kind` through a `viewForMove` map that never
        // had a `review_question` entry, so clicking this button did
        // nothing at all. `packages/core/src/discovery.ts`'s own
        // `deriveNextMoves` header comment documents the same gap directly
        // ("every move of this kind is currently an inert button... it is
        // the web app's to close").
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          status: 'decided',
          // `ContextActionDock` only mounts once `snapshot.discovery !==
          // undefined` (see `App.tsx`) -- a case that has never entered
          // discovery renders no dock at all, decided or not. This is the
          // minimal schema-valid `DiscoveryState`; its contents do not
          // matter to `deriveNextMoves`, which short-circuits to the single
          // `review_question` move for ANY `status: 'decided'` case before
          // reading discovery fields at all.
          discovery: {
            mode: 'companion',
            topics: [],
            blindSpotReview: { status: 'pending', offeredPromptIds: [], selectedPromptIds: [] },
            dispositions: [],
            pendingInteraction: null,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
          recommendation: {
            id: 'rec-1',
            status: 'ready',
            favoredOptionId: null,
            rationale: 'Best overall fit.',
            facts: [],
            hypotheses: [],
            confidence: 0.8,
            limitations: [],
            sourceIds: [],
            resolvedObligationIds: [],
            acceptedUncertaintyObligationIds: [],
            generatedAt: '2026-08-27T00:00:00.000Z',
          },
          proposal: {
            id: 'prop-1',
            recommendationId: 'rec-1',
            status: 'approved',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        });
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        const action = await screen.findByTestId('dock-action-primary');
        expect(action).toHaveTextContent('Review what was decided');

        await user.click(action);

        // Observable, not a no-op: the recommendation hero -- which already
        // renders the decided headline and the `RecommendationCard` the
        // decision landed on -- is scrolled into view and takes real
        // keyboard focus, so a keyboard/screen-reader user actually lands
        // somewhere instead of the click silently doing nothing.
        expect(scrollIntoView).toHaveBeenCalled();
        await waitFor(() => {
          expect(screen.getByTestId('recommendation-hero')).toHaveFocus();
        });
      });

      // --- `confirm_shortlist`: the one `humanOnly` move Sift derives ---

      /**
       * A case whose recommendation is `ready` and whose proposal is still
       * `pending` -- the exact state in which `deriveNextMoves` derives
       * `confirm_shortlist` and `RecommendationHero` renders `ApprovalCard`'s
       * real Approve/Reject/Revise controls.
       *
       * The blind-spot review is marked complete so the move list stays
       * short and deterministic: `[discover_candidates, confirm_shortlist]`.
       * `ContextActionDock` never drops a `humanOnly` move
       * (`selectDockActions`), so the confirm action is always rendered,
       * second.
       */
      function buildConfirmShortlistSnapshot(proposalStatus: 'pending' | null) {
        return buildFixtureCaseState({
          id: CASE_ID,
          discovery: {
            mode: 'companion',
            topics: [],
            blindSpotReview: {
              status: 'complete',
              offeredPromptIds: ['blindspot.garage_clearance'],
              selectedPromptIds: [],
              acknowledgedAt: '2026-08-27T00:00:00.000Z',
            },
            dispositions: [],
            pendingInteraction: null,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
          recommendation: {
            id: 'rec-1',
            status: 'ready',
            favoredOptionId: null,
            rationale: 'Best overall fit.',
            facts: [],
            hypotheses: [],
            confidence: 0.8,
            limitations: [],
            sourceIds: [],
            resolvedObligationIds: [],
            acceptedUncertaintyObligationIds: [],
            generatedAt: '2026-08-27T00:00:00.000Z',
          },
          proposal:
            proposalStatus === null
              ? null
              : {
                  id: 'prop-1',
                  recommendationId: 'rec-1',
                  status: proposalStatus,
                  createdAt: '2026-08-27T00:00:00.000Z',
                },
        });
      }

      it('taking the "confirm_shortlist" move -- the ONLY humanOnly move Sift derives, and the one the dock marks "Your decision" -- brings the person to the approval controls instead of doing nothing', async () => {
        // Regression test for the second confirmed dead-button defect:
        // `handleDockAction` had no `confirm_shortlist` branch and no entry
        // for it in `viewForMove` (its `requiredView` is `'confirmation'`,
        // which is not even a `WorkspaceViewMode`), so the single most
        // important button in the product rendered, enabled, and did
        // nothing at all when pressed.
        let reviewCalls = 0;
        renderLiveWorkspace(buildConfirmShortlistSnapshot('pending'));
        server.use(
          commandHandler('reviewProposal', buildFakeCommandReceipt({ caseId: CASE_ID }), () => {
            reviewCalls += 1;
          }),
        );
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        const user = await startDemoAndWait();

        const action = await screen.findByTestId('dock-action-secondary');
        expect(action).toHaveTextContent('Confirm what moves forward');
        expect(action).toHaveAttribute('data-human-only', 'true');

        await user.click(action);

        // Observable: the person is taken to `ApprovalCard` -- the real
        // Approve/Reject/Revise controls, already on the page -- which is
        // scrolled into view and given real keyboard focus, so this works
        // for a keyboard/screen-reader user too.
        expect(scrollIntoView).toHaveBeenCalled();
        await waitFor(() => {
          expect(screen.getByTestId('approval-card')).toHaveFocus();
        });
        expect(screen.getByTestId('approval-card-approve')).toBeInTheDocument();

        // And it approves NOTHING. docs/engineering-principles.md: "The model may propose
        // candidate events and recommendations. It may never approve a
        // consequential decision" -- a dock button that pressed Approve on
        // the person's behalf would be a worse defect than the dead button
        // it replaced.
        expect(reviewCalls).toBe(0);
      });

      it('falls back to the recommendation hero when "confirm_shortlist" is offered before a proposal exists to approve', async () => {
        // `confirm_shortlist` is derived from `recommendation.status ===
        // 'ready'` alone, so it can be offered while `proposal` is still
        // `null` -- in which case `ApprovalCard` is not rendered at all and
        // there is nothing to focus. The hero (which does render the
        // recommendation) is the honest destination; silently doing nothing
        // is not.
        renderLiveWorkspace(buildConfirmShortlistSnapshot(null));
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        const user = await startDemoAndWait();

        const action = await screen.findByTestId('dock-action-secondary');
        expect(action).toHaveTextContent('Confirm what moves forward');
        await user.click(action);

        expect(screen.queryByTestId('approval-card')).not.toBeInTheDocument();
        expect(scrollIntoView).toHaveBeenCalled();
        await waitFor(() => {
          expect(screen.getByTestId('recommendation-hero')).toHaveFocus();
        });
      });

      // --- `review_blind_spots`: the last gate before discovery ---

      /**
       * A pack that declares a real blind-spot review, and a case that has
       * answered every required topic without doing it -- exactly the
       * condition `deriveNextMoves` derives `review_blind_spots` from
       * (`requiredComplete && !readiness.coverage.blindSpotReviewComplete`).
       * With no topics declared, `requiredResolved === requiredTotal === 0`,
       * so the review is genuinely the only thing outstanding and the move
       * is the dock's primary button -- which is how it was seen in a real
       * Home Energy Guardian baseline screenshot.
       */
      const BLIND_SPOT_PACK = buildFixtureCompiledPack({
        entities: [{ id: 'car', label: 'Car', attributeIds: [] }],
        discovery: {
          topics: [],
          blindSpots: [
            {
              id: 'blindspot.garage_clearance',
              label: 'Where it has to park',
              detail: 'Garage length and height, or a tight communal space.',
            },
            {
              id: 'blindspot.long_term_cost',
              label: 'The cost after the purchase',
              detail: 'Insurance, servicing, tyres, and depreciation.',
            },
          ],
        },
      });

      function buildBlindSpotSnapshot() {
        return buildFixtureCaseState({
          id: CASE_ID,
          discovery: {
            mode: 'companion',
            topics: [],
            blindSpotReview: { status: 'pending', offeredPromptIds: [], selectedPromptIds: [] },
            dispositions: [],
            pendingInteraction: null,
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        });
      }

      it('taking the "review_blind_spots" move opens the pack\'s own contextual checks instead of doing nothing', async () => {
        // Regression test for the third confirmed dead-button defect. The
        // blind-spot review had a command (`completeBlindSpotReview`), a
        // case event, a reducer branch, and a readiness gate that blocks
        // discovery until it is done -- and no surface at all in the web
        // app, so the dock button that offers it was inert.
        renderLiveWorkspace(buildBlindSpotSnapshot(), [], [BLIND_SPOT_PACK]);
        const user = await startDemoAndWait();

        const action = await screen.findByTestId('dock-action-primary');
        expect(action).toHaveTextContent('Check for anything missed');

        await user.click(action);

        const sheet = await screen.findByTestId('blind-spot-review-sheet');
        // The pack's own prompts, rendered verbatim. Nothing here is
        // generated: every label and detail comes from the compiled pack.
        expect(sheet).toHaveTextContent('Where it has to park');
        expect(sheet).toHaveTextContent('Garage length and height, or a tight communal space.');
        expect(sheet).toHaveTextContent('The cost after the purchase');
      });

      it('completing the blind-spot review calls completeBlindSpotReview with the pack\'s offered prompts and actor "human"', async () => {
        let capturedBody: unknown;
        renderLiveWorkspace(buildBlindSpotSnapshot(), [], [BLIND_SPOT_PACK]);
        server.use(
          commandHandler(
            'completeBlindSpotReview',
            buildFakeCommandReceipt({ caseId: CASE_ID }),
            (body) => {
              capturedBody = body;
            },
          ),
        );
        const user = await startDemoAndWait();

        await user.click(await screen.findByTestId('dock-action-primary'));
        await screen.findByTestId('blind-spot-review-sheet');

        await user.click(screen.getByRole('checkbox', { name: /Where it has to park/ }));
        await user.click(screen.getByTestId('blind-spot-review-submit'));

        await waitFor(() => {
          expect(capturedBody).toMatchObject({
            caseId: CASE_ID,
            // Only a person may complete this review --
            // `CompleteBlindSpotReviewInputSchema` refuses any other actor.
            actor: 'human',
            offeredPromptIds: ['blindspot.garage_clearance', 'blindspot.long_term_cost'],
            selectedPromptIds: ['blindspot.garage_clearance'],
          });
        });
      });
    });

    describe('WorkspaceSidebar (web app mode priorities/still-checking) and the filter surface', () => {
      const AWD_DEFINITION = {
        id: 'awd',
        label: 'AWD',
        valueType: 'boolean' as const,
        required: false,
        appliesTo: ['car'],
        evidenceExpectation: 'assertion' as const,
        comparison: 'none' as const,
        sensitive: false,
      };

      /**
       * Two options that genuinely DISAGREE on AWD, which is what makes an
       * AWD control render at all: `planFilter` suppresses any filter that
       * cannot change which options are visible, so a case where every
       * option agrees -- or has no value -- correctly shows no toggle.
       */
      const AWD_SPLIT_ENTITIES = [
        {
          id: 'candidate-rav4',
          kind: 'car',
          label: 'Toyota RAV4',
          attributes: {
            awd: {
              definitionId: 'awd',
              label: 'AWD',
              value: { type: 'boolean' as const, value: true },
              origin: 'user' as const,
              sourceIds: [],
              status: 'asserted' as const,
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
          },
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
        {
          id: 'candidate-civic',
          kind: 'car',
          label: 'Honda Civic',
          attributes: {
            awd: {
              definitionId: 'awd',
              label: 'AWD',
              value: { type: 'boolean' as const, value: false },
              origin: 'user' as const,
              sourceIds: [],
              status: 'asserted' as const,
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
          },
          createdAt: '2026-08-27T00:00:00.000Z',
          updatedAt: '2026-08-27T00:00:00.000Z',
        },
      ];

      it('renders the sidebar only in expanded layout, never in narrow', async () => {
        const snapshot = buildFixtureCaseState({ id: CASE_ID });
        renderLiveWorkspace(snapshot);
        await startDemoAndWait();

        expect(screen.queryByTestId('workspace-sidebar')).not.toBeInTheDocument();
      });

      it('writes a filter toggle through the real setView command as presentation state -- filters only, never a criteria/weight mutation', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          attributeDefinitions: [AWD_DEFINITION],
          // Two options that genuinely DISAGREE on AWD. Required, and a
          // strictly better fixture than the empty `entities: []` this test
          // used before: `planFilter` suppresses any control that cannot
          // change which options are visible, so a case where every option
          // agrees -- or has no value at all -- correctly renders no toggle.
          // Real disagreement is what makes this exercise the derived path
          // the shipping product actually uses.
          entities: [
            {
              id: 'candidate-rav4',
              kind: 'car',
              label: 'Toyota RAV4',
              attributes: {
                awd: {
                  definitionId: 'awd',
                  label: 'AWD',
                  value: { type: 'boolean' as const, value: true },
                  origin: 'user' as const,
                  sourceIds: [],
                  status: 'asserted' as const,
                  updatedAt: '2026-08-27T00:00:00.000Z',
                },
              },
              createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
            {
              id: 'candidate-civic',
              kind: 'car',
              label: 'Honda Civic',
              attributes: {
                awd: {
                  definitionId: 'awd',
                  label: 'AWD',
                  value: { type: 'boolean' as const, value: false },
                  origin: 'user' as const,
                  sourceIds: [],
                  status: 'asserted' as const,
                  updatedAt: '2026-08-27T00:00:00.000Z',
                },
              },
              createdAt: '2026-08-27T00:00:00.000Z',
              updatedAt: '2026-08-27T00:00:00.000Z',
            },
          ],
        });
        let capturedBody: unknown;
        renderLiveWorkspace(snapshot);
        server.use(
          commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
            capturedBody = body;
          }),
        );
        const user = await startDemoAndWait();
        // Review owns the option views, the lens strip and the filter bar (ADR 0016).
        await goToWorkflowStage(user, 'review');

        await waitFor(() => expect(screen.getByTestId('workspace-sidebar')).toBeInTheDocument());
        // The filter surface moved out of the sidebar into a sheet reachable
        // from both layouts (ADR 0009), so reaching the same control now
        // takes one deliberate open. The assertion below is unchanged --
        // this test's real subject is that a filter control writes through
        // the real `setView` command as presentation-only state, and that is
        // exactly as true from the sheet as it was from the sidebar.
        await user.click(screen.getByTestId('workspace-filter-open'));
        await waitFor(() => expect(screen.getByTestId('workspace-filter-sheet')).toBeVisible());
        await user.click(screen.getByTestId('workspace-filter-awd'));

        await waitFor(() => {
          expect(capturedBody).toMatchObject({
            caseId: CASE_ID,
            expectedSequence: snapshot.eventSequence,
            view: {
              mode: 'quick_pick',
              filters: [{ fieldId: 'awd', operator: 'equals', value: 'true' }],
            },
          });
        });
        // Presentation-only, by construction: this is a `setView` payload,
        // never a `criteria`/weight-bearing command -- there is no other
        // command endpoint this test registers a handler for, so any such
        // call would surface as an unhandled-request error (`server.listen`
        // is configured `onUnhandledRequest: 'error'` at the top of this
        // file).
      });

      // ADR 0009 regression gate. The view-mode writer and the filter writer
      // are two separate single-flight queues, and both used to rebuild the
      // FULL `WorkspaceViewState` by spreading `snapshotRef.current.view` --
      // a snapshot that lags whatever the other writer has in flight. So a
      // filter press computed `mode` from a stale snapshot and persisted it,
      // silently undoing the view the user had just chosen.
      //
      // Harmless while nothing read `filters`; a visible defect the moment
      // filters became real. Repro in one sentence: switch to List, apply a
      // filter, get thrown back to Best Match. Found by the new e2e journey
      // failing consistently under four parallel workers while passing in
      // isolation -- the timing signature of a real race.
      //
      // This asserts the WIRE PAYLOAD rather than the rendered tab, because
      // the payload is where the rollback originated: the filter write must
      // carry the mode the person actually chose.
      it('a filter write carries the view mode the user just chose, never a stale one that would roll their view back', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          attributeDefinitions: [AWD_DEFINITION],
          entities: AWD_SPLIT_ENTITIES,
        });
        const setViewBodies: unknown[] = [];
        renderLiveWorkspace(snapshot);
        server.use(
          commandHandler('setView', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
            setViewBodies.push(body);
          }),
        );
        const user = await startDemoAndWait();
        // Review owns the option views, the lens strip and the filter bar (ADR 0016).
        await goToWorkflowStage(user, 'review');

        // Choose List, then IMMEDIATELY apply a filter -- without waiting for
        // the mode write to round-trip into the snapshot. That gap is exactly
        // the race; awaiting the round-trip first would test nothing.
        await user.click(screen.getByTestId('workspace-view-tab-list'));
        await user.click(screen.getByTestId('workspace-filter-open'));
        await waitFor(() => expect(screen.getByTestId('workspace-filter-sheet')).toBeVisible());
        await user.click(screen.getByTestId('workspace-filter-awd'));

        await waitFor(() => {
          expect(
            setViewBodies.some(
              (body) => (body as { view?: { filters?: unknown[] } }).view?.filters?.length === 1,
            ),
          ).toBe(true);
        });
        const filterWrite = setViewBodies.find(
          (body) => (body as { view?: { filters?: unknown[] } }).view?.filters?.length === 1,
        ) as { view: { mode: string; filters: unknown[] } };
        expect(filterWrite.view.mode).toBe('list');
        // And no write anywhere in the sequence may quietly revert the mode.
        expect(
          setViewBodies.every(
            (body) => (body as { view: { mode: string } }).view.mode !== 'quick_pick',
          ),
        ).toBe(true);
      });

      it('renders real priorities from the derived DecisionProfile, and opens "Still checking" (with the real ReadinessPanel) via the sidebar button', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          criteria: [
            {
              id: 'crit-budget',
              label: 'Budget',
              kind: 'hard_constraint',
              weight: 20,
              direction: 'higher_better',
              origin: 'pack',
              status: 'active',
              target: { type: 'money', amount: 40000, currency: 'USD' },
            },
          ],
        });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        await waitFor(() => {
          expect(screen.getByTestId('workspace-sidebar-priority-crit-budget')).toHaveTextContent(
            'Budget',
          );
        });

        await user.click(screen.getByTestId('workspace-sidebar-still-checking-button'));
        await waitFor(() => {
          expect(screen.getByTestId('workspace-still-checking-sheet')).toBeInTheDocument();
        });
        expect(screen.getByTestId('readiness-panel-status')).toBeInTheDocument();
      });
    });

    describe('expanded-mode reachability for regions with no sidebar slot (Notes, full Decision Profile, Add a concern)', () => {
      it('reaches Notes and the FULL Decision Profile (including fields the sidebar excludes) via the main-column toolbar, and "Add a question" via the app-bar create menu', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({
          id: CASE_ID,
          criteria: [
            {
              id: 'crit-budget',
              label: 'Budget',
              kind: 'hard_constraint',
              weight: 20,
              direction: 'higher_better',
              origin: 'pack',
              status: 'active',
              target: { type: 'money', amount: 40000, currency: 'USD' },
            },
          ],
          notes: [
            {
              id: 'note-1',
              body: 'The seat position felt wrong on the test drive.',
              kind: 'observation',
              origin: 'user',
              authoredBy: 'user',
              optionIds: [],
              sourceIds: [],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        await user.click(screen.getByTestId('workspace-expanded-open-notes'));
        await waitFor(() => {
          expect(screen.getByTestId('workspace-notes-sheet')).toBeInTheDocument();
        });
        expect(screen.getByTestId('case-note-body-note-1')).toHaveTextContent(
          'The seat position felt wrong on the test drive.',
        );
        await user.click(screen.getByTestId('sheet-close'));
        await waitFor(() => {
          expect(screen.queryByTestId('workspace-notes-sheet')).not.toBeInTheDocument();
        });

        // Priorities owns the Decision Profile (ADR 0016), so its toolbar
        // button lives on that step. Notes above deliberately does not: it is
        // in no stage's ownership row, so it stays on screen throughout.
        await goToWorkflowStage(user, 'priorities');
        await user.click(screen.getByTestId('workspace-expanded-open-decision-profile'));
        await waitFor(() => {
          expect(screen.getByTestId('workspace-decision-profile-sheet')).toBeInTheDocument();
        });
        expect(screen.getByTestId('decision-profile-view-concern-crit-budget')).toHaveTextContent(
          'Budget',
        );
        await user.click(screen.getByTestId('sheet-close'));
        await waitFor(() => {
          expect(screen.queryByTestId('workspace-decision-profile-sheet')).not.toBeInTheDocument();
        });

        // "Add a question" left this toolbar entirely: it is one of the app
        // bar's three create-menu items now, identical in both layouts, so a
        // second expanded-only button over the same sheet would be pure
        // duplication. The capability is asserted through its real, single
        // entry point instead.
        expect(screen.queryByTestId('workspace-expanded-open-add-concern')).not.toBeInTheDocument();
        await openCreateMenuItem(
          user,
          'workspace-app-bar-add-concern',
          'workspace-add-concern-sheet',
        );
        expect(screen.getByTestId('custom-concern-form')).toBeInTheDocument();
      });

      it('reaches "Add a note" from the app-bar create menu in expanded mode too (ADR 0008: every capability reachable in both modes)', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({ id: CASE_ID });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        await openCreateMenuItem(user, 'workspace-app-bar-add-note', 'workspace-notes-sheet');
        expect(screen.getByTestId('add-note-form')).toBeInTheDocument();
      });

      it('omits the "What you\'re looking for" toolbar button entirely (not merely a disabled one) when the derived DecisionProfile is empty', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({ id: CASE_ID, criteria: [], caseExtensions: [] });
        renderLiveWorkspace(snapshot);
        await startDemoAndWait();

        expect(
          screen.queryByTestId('workspace-expanded-open-decision-profile'),
        ).not.toBeInTheDocument();
      });
    });

    describe('"Add option" / "Manage options" (ADR 0008: promoted into the app bar in BOTH layouts, no disclosure row any more)', () => {
      it('remains reachable via the app bar in expanded layout too, saving a real option through the same OptionEditor/upsertOption path', async () => {
        stubExpandedLayout();
        const snapshot = buildFixtureCaseState({ id: CASE_ID });
        renderLiveWorkspace(snapshot);
        const user = await startDemoAndWait();

        expect(screen.queryByTestId('disclosure-options')).not.toBeInTheDocument();
        await openCreateMenuItem(
          user,
          'workspace-app-bar-add-option',
          'workspace-add-option-sheet',
        );
        expect(screen.getByTestId('option-editor')).toBeInTheDocument();
      });
    });
  });

  /**
   * ADR 0016's stage-ownership table, asserted as behaviour.
   *
   * The defect these cover, found in a live browser: the five-step stepper
   * rendered, and pressing a step changed nothing. Intake and Priorities
   * produced byte-identical screens, because `activeWorkflowStageId` gated
   * exactly one region (Analysis) out of the whole workspace. A stepper that
   * navigates nowhere is worse than no stepper -- it claims a sequence the
   * product does not have.
   */
  describe('guided workflow stage ownership (ADR 0016)', () => {
    const RANKED_CAR = {
      id: 'candidate-rav4',
      kind: 'car',
      label: 'Toyota RAV4',
      attributes: {},
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    };
    const BUDGET_CRITERION = {
      id: 'crit-budget',
      label: 'Budget',
      kind: 'hard_constraint' as const,
      weight: 20,
      direction: 'higher_better' as const,
      origin: 'pack' as const,
      status: 'active' as const,
      target: { type: 'money' as const, amount: 40000, currency: 'USD' },
    };
    const READY_RECOMMENDATION = {
      id: 'rec-1',
      status: 'ready' as const,
      favoredOptionId: 'candidate-rav4',
      rationale: 'Best overall fit.',
      facts: [],
      hypotheses: [],
      confidence: 0.8,
      limitations: [],
      sourceIds: [],
      resolvedObligationIds: [],
      acceptedUncertaintyObligationIds: [],
      generatedAt: '2026-08-27T00:00:00.000Z',
    };

    it('Intake and Priorities no longer render the same screen', async () => {
      renderLiveWorkspace(
        buildFixtureCaseState({
          id: CASE_ID,
          entities: [RANKED_CAR],
          criteria: [BUDGET_CRITERION],
        }),
      );
      const user = await startDemoAndWait();

      await goToWorkflowStage(user, 'intake');
      await waitFor(() => {
        expect(screen.getByTestId('case-stage-intake')).toBeInTheDocument();
      });
      expect(screen.getByTestId('case-stage-intake-option-count')).toHaveTextContent(
        '1 car on this case',
      );
      expect(screen.queryByTestId('case-stage-priorities')).not.toBeInTheDocument();

      await goToWorkflowStage(user, 'priorities');
      await waitFor(() => {
        expect(screen.getByTestId('case-stage-priorities')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('case-stage-intake')).not.toBeInTheDocument();
    });

    it('Review owns the option views, the lens strip and the filter bar', async () => {
      renderLiveWorkspace(
        buildFixtureCaseState({
          id: CASE_ID,
          entities: [RANKED_CAR],
          criteria: [BUDGET_CRITERION],
          recommendation: READY_RECOMMENDATION,
          view: { mode: 'list' },
        }),
      );
      const user = await startDemoAndWait();

      await goToWorkflowStage(user, 'intake');
      await waitFor(() => {
        expect(screen.getByTestId('case-stage-intake')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('workspace-view-switcher')).not.toBeInTheDocument();
      expect(screen.queryByTestId('disclosure-still-checking')).not.toBeInTheDocument();

      await goToWorkflowStage(user, 'review');
      await waitFor(() => {
        expect(screen.getByTestId('workspace-view-switcher')).toBeInTheDocument();
      });
      expect(screen.getByTestId('option-list-view-card-candidate-rav4')).toBeInTheDocument();
      expect(screen.getByTestId('disclosure-still-checking')).toBeInTheDocument();
    });

    it('Decide owns the approval controls, and the recommendation hero stays on every step', async () => {
      renderLiveWorkspace(
        buildFixtureCaseState({
          id: CASE_ID,
          entities: [RANKED_CAR],
          criteria: [BUDGET_CRITERION],
          recommendation: READY_RECOMMENDATION,
          proposal: {
            id: 'prop-1',
            recommendationId: 'rec-1',
            status: 'pending',
            createdAt: '2026-08-27T00:00:00.000Z',
          },
        }),
      );
      const user = await startDemoAndWait();

      // A pending proposal is the action awaiting the person, so Decide is
      // where the derived workflow puts them -- the approval controls are met
      // on arrival, not hunted for.
      await waitFor(() => {
        expect(screen.getByTestId('approval-card-approve')).toBeInTheDocument();
      });

      await goToWorkflowStage(user, 'review');
      await waitFor(() => {
        expect(screen.queryByTestId('approval-card-approve')).not.toBeInTheDocument();
      });
      // ADR 0004's answer-first region is NOT stage-owned: the recommendation
      // is still on screen while the person revisits an upstream step, which
      // is what `assertRecommendationHeroAboveTheFold` asserts in the browser.
      expect(screen.getByTestId('recommendation-hero')).toBeInTheDocument();
      expect(screen.getByTestId('recommendation-card')).toBeInTheDocument();

      await goToWorkflowStage(user, 'decide');
      await waitFor(() => {
        expect(screen.getByTestId('approval-card-approve')).toBeInTheDocument();
      });
    });

    it('shows a stage’s regions where the person is standing when that stage cannot be reached at all', async () => {
      // A case with nothing to review: Review is `unavailable`, so gating its
      // regions behind it would delete them rather than relocate them. The
      // change set is absolute -- no capability may end up somewhere the pane
      // cannot reach -- so the gate stands down exactly there.
      renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID, entities: [], criteria: [] }));
      await startDemoAndWait();

      await waitFor(() => {
        expect(screen.getByTestId('case-stage-intake')).toBeInTheDocument();
      });
      expect(screen.getByTestId('workspace-view-switcher')).toBeInTheDocument();
      expect(screen.getByTestId('disclosure-still-checking')).toBeInTheDocument();
    });
  });

  // Defensive branches this file's other tests do not naturally exercise --
  // mostly "a promise resolves/rejects after this component (or its case
  // generation) has already been torn down" guards, plus a handful of
  // fallback-message/rendering branches whose "happy path" arm is already
  // covered elsewhere in this file. Some genuinely reachable guards in this
  // file (`handleResetDemo`'s `snapshot === null` check,
  // `handleReviewProposal`'s `!snapshot?.proposal || activeCaseId === null`
  // check, `handleSetDisposition`'s equivalent check, the `obligationId`
  // parameter of `handleRequestInvestigation`, `review.reason` in
  // `handleReviewProposal`'s command payload, and the `readiness?.blockers
  // .length ?? 0` fallback) are NOT covered here because they are
  // structurally unreachable from any real user interaction as this file
  // currently wires things: their triggering control either never mounts
  // (`WorkspaceAppBar`/`ApprovalCard`/`EvidenceList`'s action controls all
  // require non-null data derived from `snapshot` before they render at
  // all -- unlike "Request investigation", which always mounts, just
  // disabled) or the value in question (`obligationId`, `review.reason`) is
  // never produced by any current caller, or (`readiness`) the real
  // `evaluateReadiness` never actually returns `null` for a non-null
  // snapshot.
  describe('defensive branches (post-teardown guards and rare fallback paths)', () => {
    it('does not update installedPacks after unmount if the /api/packs fetch resolves late', async () => {
      let releasePacks: (() => void) | undefined;
      server.use(
        http.get('/api/packs', async () => {
          await new Promise<void>((resolve) => {
            releasePacks = resolve;
          });
          return HttpResponse.json({ packs: [DEFAULT_PACK] });
        }),
      );

      const { unmount } = render(
        <AppProviders commandsClient={createFakeSiftCommands()}>
          <App />
        </AppProviders>,
      );
      await waitFor(() => expect(releasePacks).toBeDefined());

      unmount();
      expect(() => releasePacks?.()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      // No error was thrown by the late-arriving packs response landing
      // after unmount -- the disposed guard skipped applying it.
    });

    it('ignores a malformed /api/packs payload that fails schema validation and falls back to the generic option label', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID, commandId: 'cmd-start' })),
        ),
        pollHandler(snapshot),
        http.get('/api/packs', () => HttpResponse.json([{ not: 'a valid compiled pack' }])),
      );
      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

      // Falls back to the generic 'option' label -- the malformed payload
      // never made it past `InstalledPacksResponseSchema.safeParse`.
      // `option-editor-new` is gone (adding is now `OptionEditor`'s own
      // default state) -- its sr-only heading is what now carries the label.
      await openCreateMenuItem(user, 'workspace-app-bar-add-option', 'workspace-add-option-sheet');
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Add a option' })).toBeInTheDocument();
      });
    });

    it('unmounting before the reload-restore verification fetch resolves does not apply a late activeCaseId/clear update', async () => {
      localStorage.setItem('sift:activeCaseId', CASE_ID);
      let releaseRestore: (() => void) | undefined;
      server.use(
        http.get(`/api/cases/${CASE_ID}`, async () => {
          await new Promise<void>((resolve) => {
            releaseRestore = resolve;
          });
          return HttpResponse.json(buildFixtureCaseState({ id: CASE_ID }));
        }),
      );

      const { unmount } = render(
        <AppProviders commandsClient={createFakeSiftCommands()}>
          <App />
        </AppProviders>,
      );
      await waitFor(() => expect(releaseRestore).toBeDefined());

      unmount();
      expect(() => releaseRestore?.()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('unmounting before the reload-restore verification fetch rejects does not apply a late clear/restore update', async () => {
      localStorage.setItem('sift:activeCaseId', CASE_ID);
      let releaseFailure: (() => void) | undefined;
      server.use(
        http.get(`/api/cases/${CASE_ID}`, async () => {
          await new Promise<void>((resolve) => {
            releaseFailure = resolve;
          });
          return HttpResponse.error();
        }),
      );

      const { unmount } = render(
        <AppProviders commandsClient={createFakeSiftCommands()}>
          <App />
        </AppProviders>,
      );
      await waitFor(() => expect(releaseFailure).toBeDefined());

      unmount();
      expect(() => releaseFailure?.()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('disposes the global WebMCP tool registration immediately if the component unmounts before registerSiftTools resolves', async () => {
      // A subclass whose `registerTool` still performs the base class's real
      // synchronous bookkeeping (so `disposeAll()`'s abort-listener wiring
      // stays real) but leaves its OWN returned promise pending until this
      // test releases it -- giving a deterministic window to unmount before
      // `registerSiftTools(...).then(...)` in `App.tsx` ever runs.
      class DelayedRegisterAdapter extends InMemoryModelContextAdapter {
        readonly pendingReleases: (() => void)[] = [];
        override registerTool(
          ...args: Parameters<InMemoryModelContextAdapter['registerTool']>
        ): Promise<void> {
          void super.registerTool(...args);
          return new Promise<void>((resolve) => {
            this.pendingReleases.push(resolve);
          });
        }
      }
      const adapter = new DelayedRegisterAdapter();
      server.use(http.get('/api/packs', () => HttpResponse.json([])));

      const { unmount } = render(
        <AppProviders commandsClient={createFakeSiftCommands()} webMcpAdapter={adapter}>
          <App />
        </AppProviders>,
      );
      await waitFor(() => expect(adapter.pendingReleases.length).toBeGreaterThan(0));

      unmount();
      // `registerSiftTools` awaits its global `registerTool` calls
      // sequentially, so each one only becomes pending once the previous is
      // released. Drain them rather than releasing a hard-coded count: the
      // subject here is that disposal unregisters everything that got
      // registered, which must stay true as the global surface grows.
      let released = 0;
      while (released < adapter.pendingReleases.length) {
        adapter.pendingReleases[released]?.();
        released += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The `.then()` callback's own `disposed` check called
      // `handle.disposeAll()` instead of committing the handle to state --
      // every tool it had just (really) registered is unregistered again.
      expect(adapter.registeredToolNames).toEqual([]);
    });

    it('keeps WebMCP tools registered when Strict Mode restarts an in-flight registration effect', async () => {
      // The browser inserts a tool before registerTool() resolves and rejects
      // a second registration under the same name. Delaying resolution makes
      // React's development-only setup -> cleanup -> setup cycle deterministic
      // and catches cleanup that becomes available only after the first async
      // registration has already completed.
      class BrowserLikeDelayedAdapter extends InMemoryModelContextAdapter {
        readonly pendingReleases: (() => void)[] = [];

        override registerTool(
          definition: WebMcpToolDefinition,
          options?: WebMcpRegisterOptions,
        ): Promise<void> {
          if (this.getRegisteredTool(definition.name) !== undefined) {
            return Promise.reject(
              new DOMException(
                `Tool "${definition.name}" is already registered.`,
                'InvalidStateError',
              ),
            );
          }

          void super.registerTool(definition, options);
          return new Promise<void>((resolve, reject) => {
            this.pendingReleases.push(resolve);
            options?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Registration aborted.', 'AbortError')),
              { once: true },
            );
          });
        }
      }

      const adapter = new BrowserLikeDelayedAdapter();
      server.use(http.get('/api/packs', () => HttpResponse.json([])));

      const { unmount } = render(
        <StrictMode>
          <AppProviders commandsClient={createFakeSiftCommands()} webMcpAdapter={adapter}>
            <App />
          </AppProviders>
        </StrictMode>,
      );
      await waitFor(() => expect(adapter.pendingReleases.length).toBeGreaterThan(0));

      let released = 0;
      while (released < adapter.pendingReleases.length) {
        adapter.pendingReleases[released]?.();
        released += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      await waitFor(() => {
        expect([...adapter.registeredToolNames].sort()).toEqual([...GLOBAL_SIFT_TOOL_NAMES].sort());
      });
      unmount();
    });

    it('the "Request investigation" control does nothing if invoked while snapshot is still null (bypasses the disabled attribute to prove the callback\'s own defensive guard)', async () => {
      let runCalled = false;
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        // Never resolves -- keeps `snapshot` null indefinitely, matching the
        // real "loading" state this control is disabled during.
        http.get(`/api/cases/${CASE_ID}/events`, () => new Promise(() => undefined)),
        packsHandler([DEFAULT_PACK]),
        http.post(`/api/cases/${CASE_ID}/run`, () => {
          runCalled = true;
          return HttpResponse.json({
            ...buildFakeCommandReceipt({ caseId: CASE_ID }),
            runId: 'run-should-not-happen',
          });
        }),
      );
      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => {
        expect(screen.getByTestId('case-workspace-loading')).toBeInTheDocument();
      });

      const button = screen.getByTestId('request-investigation');
      expect(button).toBeDisabled();
      button.removeAttribute('disabled');
      fireEvent.click(button);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(runCalled).toBe(false);
    });

    it('does not retry a requestInvestigation conflict when the server response lacks a usable actualSequence, and shows a recoverable error instead', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      let callCount = 0;
      server.use(
        http.post('/api/cases/demo', () =>
          HttpResponse.json(buildFakeCommandReceipt({ caseId: CASE_ID })),
        ),
        pollHandler(snapshot),
        packsHandler([DEFAULT_PACK]),
        http.post(`/api/cases/${CASE_ID}/run`, () => {
          callCount += 1;
          // No top-level `snapshot` and no `actualSequence` -- fails the
          // strict conflict-envelope schema, so the client falls back to the
          // generic error-body shape instead, whose `details` carries no
          // usable `actualSequence` at all.
          return HttpResponse.json(
            {
              error: {
                code: 'CONFLICT',
                message: 'Stale sequence; refresh and retry.',
                retryable: true,
              },
            },
            { status: 409 },
          );
        }),
      );
      const user = userEvent.setup();
      render(
        <AppProviders caseEventsConfig={{ createEventSource: createFakeEventSource }}>
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

      await user.click(screen.getByTestId('request-investigation'));

      await waitFor(() => {
        expect(screen.getByTestId('request-investigation-error')).toHaveTextContent(
          'Stale sequence; refresh and retry.',
        );
      });
      expect(callCount).toBe(1);
    });

    it('shows the generic "Could not request an investigation." message when requestInvestigation rejects with a non-Error value', async () => {
      const snapshot = buildFixtureCaseState({ id: CASE_ID });
      const commands = createFakeSiftCommands({
        startDemo: () => Promise.resolve(buildFakeCommandReceipt({ caseId: CASE_ID })),
        requestInvestigation: vi.fn().mockRejectedValue('network gremlin'),
      });
      server.use(pollHandler(snapshot), packsHandler([DEFAULT_PACK]));
      const user = userEvent.setup();
      render(
        <AppProviders
          commandsClient={commands}
          caseEventsConfig={{ createEventSource: createFakeEventSource }}
        >
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());

      await user.click(screen.getByTestId('request-investigation'));

      await waitFor(() => {
        expect(screen.getByTestId('request-investigation-error')).toHaveTextContent(
          'Could not request an investigation.',
        );
      });
    });

    it('submitting a "Request revision" review calls reviewProposal with the typed instructions', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        recommendation: {
          id: 'rec-1',
          status: 'ready',
          favoredOptionId: null,
          rationale: 'Best overall fit.',
          facts: [],
          hypotheses: [],
          confidence: 0.8,
          limitations: [],
          sourceIds: [],
          resolvedObligationIds: [],
          acceptedUncertaintyObligationIds: [],
          generatedAt: '2026-08-27T00:00:00.000Z',
        },
        proposal: {
          id: 'prop-1',
          recommendationId: 'rec-1',
          status: 'pending',
          createdAt: '2026-08-27T00:00:00.000Z',
        },
      });
      let capturedBody: unknown;
      renderLiveWorkspace(snapshot);
      server.use(
        commandHandler('reviewProposal', buildFakeCommandReceipt({ caseId: CASE_ID }), (body) => {
          capturedBody = body;
        }),
      );
      const user = await startDemoAndWait();

      await waitFor(() =>
        expect(screen.getByTestId('approval-card-request-revision')).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId('approval-card-request-revision'));
      await user.type(
        screen.getByTestId('approval-card-revision-instructions-input'),
        'Please re-check the total price including fees.',
      );
      await user.click(screen.getByTestId('approval-card-revision-submit'));

      await waitFor(() => {
        expect(capturedBody).toMatchObject({
          caseId: CASE_ID,
          proposalId: 'prop-1',
          actor: 'human',
          decision: 'request_revision',
          instructions: 'Please re-check the total price including fees.',
        });
      });
    });

    it('shows the generic "Could not submit this review." message when reviewProposal rejects with a non-Error value', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        recommendation: {
          id: 'rec-1',
          status: 'ready',
          favoredOptionId: null,
          rationale: 'Best overall fit.',
          facts: [],
          hypotheses: [],
          confidence: 0.8,
          limitations: [],
          sourceIds: [],
          resolvedObligationIds: [],
          acceptedUncertaintyObligationIds: [],
          generatedAt: '2026-08-27T00:00:00.000Z',
        },
        proposal: {
          id: 'prop-1',
          recommendationId: 'rec-1',
          status: 'pending',
          createdAt: '2026-08-27T00:00:00.000Z',
        },
      });
      const commands = createFakeSiftCommands({
        startDemo: () => Promise.resolve(buildFakeCommandReceipt({ caseId: CASE_ID })),
        reviewProposal: vi.fn().mockRejectedValue('server hiccup'),
      });
      server.use(pollHandler(snapshot), packsHandler([DEFAULT_PACK]));
      const user = userEvent.setup();
      render(
        <AppProviders
          commandsClient={commands}
          caseEventsConfig={{ createEventSource: createFakeEventSource }}
        >
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('approval-card-approve')).toBeInTheDocument());

      await user.click(screen.getByTestId('approval-card-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('approval-card-error')).toHaveTextContent(
          'Could not submit this review.',
        );
      });
    });

    it('shows the generic "Could not update this evidence item." message when setEvidenceDisposition rejects with a non-Error value', async () => {
      const snapshot = buildFixtureCaseState({
        id: CASE_ID,
        evidenceLinks: [
          {
            id: 'evidence-1',
            obligationId: 'obl-1',
            level: 'E1',
            verdict: 'pass',
            disposition: 'included',
            summary: 'Confirmed.',
            stale: false,
            createdAt: '2026-08-27T00:00:00.000Z',
            updatedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      });
      const commands = createFakeSiftCommands({
        startDemo: () => Promise.resolve(buildFakeCommandReceipt({ caseId: CASE_ID })),
        setEvidenceDisposition: vi.fn().mockRejectedValue('server hiccup'),
      });
      server.use(pollHandler(snapshot), packsHandler([DEFAULT_PACK]));
      const user = userEvent.setup();
      render(
        <AppProviders
          commandsClient={commands}
          caseEventsConfig={{ createEventSource: createFakeEventSource }}
        >
          <App />
        </AppProviders>,
      );
      await user.click(screen.getByRole('button', { name: 'Choose our next car' }));
      await waitFor(() => expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument());
      await openFindingsSheet(user);

      await waitFor(() =>
        expect(screen.getByTestId('evidence-card-disposition-option-excluded')).toBeInTheDocument(),
      );
      await user.click(screen.getByTestId('evidence-card-disposition-option-excluded'));
      await user.type(screen.getByTestId('evidence-card-reason-evidence-1'), 'No longer relevant.');
      await user.click(screen.getByTestId('evidence-card-reason-confirm-evidence-1'));

      await waitFor(() => {
        expect(screen.getByTestId('error-state-message')).toHaveTextContent(
          'Could not update this evidence item.',
        );
      });
    });

    // The two `activeFocus`-rendering defensive branches this section used
    // to cover (a ghost obligation id with no matching obligation; a focus
    // with no skill/specialist) no longer apply -- the current-focus UI
    // they exercised is deleted entirely (ADR 0004 decision item 5; see
    // 'live workspace wiring' > "renders nothing from activeFocus even when
    // the snapshot carries a real (never-production-written) value", which
    // proves the deletion holds even for a fully-populated `activeFocus`).
  });
});

/**
 * The deterministic ranking, end to end.
 *
 * Every other test for these surfaces hands a component a scoreboard
 * directly. These prove the workspace actually BUILDS one from the live
 * snapshot and routes it to all three places it belongs -- which is the
 * wiring ADR 0012 listed as still open ("the workspace does not yet render
 * the scoreboard: option cards show pack-declared prominent attributes, not
 * rank, score, or the per-criterion breakdown").
 */
describe('App scoreboard', () => {
  const RANKED_CASE = buildCarCaseState({ id: CASE_ID });

  it('surfaces the computed insights near the top of the workspace', async () => {
    renderLiveWorkspace(RANKED_CASE);
    await startDemoAndWait();

    await waitFor(() => {
      expect(screen.getByTestId('case-insights')).toBeInTheDocument();
    });

    // The leave-one-out result, which is the single most compelling thing
    // the engine computes, and the one the panel leads with.
    const decisive = screen.getByTestId('case-insight-decisive_criterion');
    expect(decisive).toHaveAttribute('data-lead', 'true');
    expect(decisive).toHaveTextContent('is what puts 2022 Honda CR-V EX-L AWD ahead.');
  });

  it('ranks the option cards and explains the rank in the profile', async () => {
    renderLiveWorkspace(RANKED_CASE);
    const user = await startDemoAndWait();
    // Review owns the option views, the lens strip and the filter bar (ADR 0016).
    await goToWorkflowStage(user, 'review');

    await user.click(screen.getByTestId('workspace-view-tab-list'));

    await waitFor(() => {
      expect(screen.getByTestId('option-rank-position-candidate-crv')).toHaveTextContent('#1 of 3');
    });
    // The unmeasured car is unranked, not fourth.
    expect(screen.queryByTestId('option-rank-position-candidate-outback')).toBeNull();
    expect(screen.getByTestId('option-rank-unranked-candidate-outback')).toBeInTheDocument();

    await user.click(screen.getByTestId('option-card-open-profile-candidate-crv'));

    await waitFor(() => {
      expect(screen.getByTestId('option-rank-breakdown-candidate-crv')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('option-rank-criterion-candidate-crv-pref.ownership_cost'),
    ).toHaveAttribute('data-status', 'disputed');
  });
});

/**
 * The first-run guide (`components/FirstRunGuide.tsx`).
 *
 * Every test here clears the flag the file-level `beforeEach` seeds, so
 * these -- and only these -- render the genuine first-visit path.
 */
describe('App first-run guide', () => {
  beforeEach(() => {
    localStorage.removeItem(FIRST_RUN_GUIDE_STORAGE_KEY);
  });

  // The locked-down-storage test below spies on `Storage.prototype`. Undone
  // here rather than only at the end of that test, so a failure mid-test
  // cannot leak a throwing `localStorage` into every later test in the file.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens itself on the first case this browser ever starts', async () => {
    renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    await startDemoAndWait();

    await waitFor(() => {
      expect(screen.getByTestId('first-run-guide')).toBeInTheDocument();
    });
    // The half of the content that is the point of the surface.
    expect(screen.getByTestId('how-sift-works-phrases')).toBeInTheDocument();
    expect(screen.getByTestId('how-sift-works-authority')).toBeInTheDocument();
  });

  it('does not open on the launcher, before any case exists', async () => {
    render(
      <AppProviders commandsClient={createFakeSiftCommands()}>
        <App />
      </AppProviders>,
    );

    await screen.findByTestId('demo-launcher');
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
    expect(hasSeenFirstRunGuide()).toBe(false);
  });

  it('records the dismissal so a second case never re-nags', async () => {
    renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    const user = await startDemoAndWait();
    await screen.findByTestId('first-run-guide');

    await user.click(screen.getByTestId('first-run-guide-dismiss'));

    await waitFor(() => {
      expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
    });
    expect(hasSeenFirstRunGuide()).toBe(true);
  });

  it('stays dismissed across a fresh mount -- a reset demo does not show it again', async () => {
    const snapshot = buildFixtureCaseState({ id: CASE_ID });
    const first = renderLiveWorkspace(snapshot);
    const user = await startDemoAndWait();
    await screen.findByTestId('first-run-guide');
    await user.click(screen.getByTestId('first-run-guide-dismiss'));
    first.unmount();
    // A reset demo returns to the launcher, so the active-case POINTER is
    // gone (`active-case-storage.ts`) -- but the first-run flag, which is a
    // fact about the person and not about any case, must survive it.
    localStorage.removeItem('sift:activeCaseId');

    renderLiveWorkspace(snapshot);
    await startDemoAndWait();

    // Given a full render cycle to appear, and it must not.
    await waitFor(() => {
      expect(screen.getByTestId('workspace-app-bar')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
  });

  it('is remembered even when a case is abandoned without dismissing the guide', async () => {
    const first = renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    await startDemoAndWait();
    await screen.findByTestId('first-run-guide');

    // Never dismissed -- the tab is simply closed (or reloaded, or reset).
    first.unmount();
    expect(hasSeenFirstRunGuide()).toBe(true);
    localStorage.removeItem('sift:activeCaseId');

    renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    await startDemoAndWait();
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
  });

  it('stays reachable from the Help control after it has been dismissed', async () => {
    renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    const user = await startDemoAndWait();
    await screen.findByTestId('first-run-guide');
    await user.click(screen.getByTestId('first-run-guide-dismiss'));
    await waitFor(() => {
      expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId('help-button'));

    const sheet = await screen.findByTestId('help-sheet');
    expect(within(sheet).getByTestId('how-sift-works-phrases')).toBeInTheDocument();
  });

  it('never crashes when localStorage is unavailable, and simply shows the guide', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === FIRST_RUN_GUIDE_STORAGE_KEY) {
        throw new Error('SecurityError: storage is disabled in this context');
      }
      return null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled in this context');
    });

    renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    await startDemoAndWait();

    await waitFor(() => {
      expect(screen.getByTestId('first-run-guide')).toBeInTheDocument();
    });
  });

  it('hands focus back to the Help control on dismissal, not to the document body', async () => {
    renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    const user = await startDemoAndWait();
    await screen.findByTestId('first-run-guide');

    await user.click(screen.getByTestId('first-run-guide-dismiss'));

    // The launcher button that opened this case is unmounted by now, so
    // Radix's own focus restore has nothing to return to -- without the
    // explicit target, focus lands on `<body>` and a keyboard user has to
    // Tab from the top of the document.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('help-button'));
    });
  });

  it('has no axe violations while the guide is open over a live case', async () => {
    const { baseElement } = renderLiveWorkspace(buildFixtureCaseState({ id: CASE_ID }));
    await startDemoAndWait();
    await screen.findByTestId('first-run-guide');

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
