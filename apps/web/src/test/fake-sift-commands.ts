/**
 * A fully-stubbed `SiftCommands` implementation for component tests. Backs
 * `AppProviders`'s "test-injectable override point" (locked file map:
 * `apps/web/src/app/AppProviders.tsx  Query, event, command, and test
 * providers") so component tests -- and later Playwright tests through the
 * same seam -- can substitute a fake client without hitting the network,
 * instead of mocking `fetch`/MSW for every component test.
 */
import { vi } from 'vitest';
import type { CommandReceipt, EnergyBillFeedCheckResult, RunReceipt } from '@sift/contracts';
import type { SiftCommands } from '../api/sift-client.js';

export function buildFakeCommandReceipt(overrides: Partial<CommandReceipt> = {}): CommandReceipt {
  return {
    commandId: 'cmd-fake-1',
    caseId: 'case-fake-1',
    acceptedSequence: 0,
    ...overrides,
  };
}

export function buildFakeRunReceipt(overrides: Partial<RunReceipt> = {}): RunReceipt {
  return {
    ...buildFakeCommandReceipt(),
    runId: 'run-fake-1',
    ...overrides,
  };
}

/** Defaults to the "case opened" outcome -- matching every other fake command's default optimistic-success shape. Pass `{ caseOpened: false, receipt: undefined, ... }` to script the "no case opened" outcome instead. */
export function buildFakeEnergyBillFeedCheckResult(
  overrides: Partial<EnergyBillFeedCheckResult> = {},
): EnergyBillFeedCheckResult {
  return {
    commandId: 'cmd-fake-1',
    billFeedId: 'anomalous',
    caseOpened: true,
    percentAboveBaseline: 42,
    thresholdPercent: 15,
    reason: 'Materially abnormal. Opening a case.',
    receipt: buildFakeCommandReceipt(),
    ...overrides,
  };
}

/** Every method resolves to a fake receipt by default; pass `overrides` (e.g. `{ startDemo: vi.fn().mockRejectedValue(...) }`) to script a specific test's behavior. */
export function createFakeSiftCommands(overrides: Partial<SiftCommands> = {}): SiftCommands {
  const defaultReceipt = buildFakeCommandReceipt();
  const defaultRunReceipt = buildFakeRunReceipt();

  return {
    startDemo: vi.fn().mockResolvedValue(defaultReceipt),
    startCase: vi.fn().mockResolvedValue(defaultReceipt),
    checkEnergyBillFeed: vi.fn().mockResolvedValue(buildFakeEnergyBillFeedCheckResult()),
    selectPack: vi.fn().mockResolvedValue(defaultReceipt),
    upsertOption: vi.fn().mockResolvedValue(defaultReceipt),
    focusOption: vi.fn().mockResolvedValue(defaultReceipt),
    defineCaseAttribute: vi.fn().mockResolvedValue(defaultReceipt),
    reviewCaseExtension: vi.fn().mockResolvedValue(defaultReceipt),
    focusEvidence: vi.fn().mockResolvedValue(defaultReceipt),
    updateCriteria: vi.fn().mockResolvedValue(defaultReceipt),
    submitSource: vi.fn().mockResolvedValue(defaultReceipt),
    requestInvestigation: vi.fn().mockResolvedValue(defaultRunReceipt),
    reviewProposal: vi.fn().mockResolvedValue(defaultReceipt),
    setEvidenceDisposition: vi.fn().mockResolvedValue(defaultReceipt),
    requestRevision: vi.fn().mockResolvedValue(defaultReceipt),
    setView: vi.fn().mockResolvedValue(defaultReceipt),
    updateDiscovery: vi.fn().mockResolvedValue(defaultReceipt),
    requestInteraction: vi.fn().mockResolvedValue(defaultReceipt),
    submitInteractionResponse: vi.fn().mockResolvedValue(defaultReceipt),
    setCandidateDisposition: vi.fn().mockResolvedValue(defaultReceipt),
    completeBlindSpotReview: vi.fn().mockResolvedValue(defaultReceipt),
    setOptionAttribute: vi.fn().mockResolvedValue(defaultReceipt),
    submitBidDocument: vi.fn().mockResolvedValue(defaultReceipt),
    readBidDocument: vi.fn().mockResolvedValue(defaultReceipt),
    addNote: vi.fn().mockResolvedValue(defaultReceipt),
    ...overrides,
  };
}
