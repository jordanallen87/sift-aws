#!/usr/bin/env tsx
/**
 * `pnpm test:journey` — turn-based journey acceptance (ADR 0014).
 *
 * Runs each journey through the **rendered pane in a real WebMCP browser**,
 * and after every turn evaluates the case state, what the pane shows, and
 * whether those two describe the same case. See `journey/harness.ts` for
 * why the third of those is the one that matters.
 *
 *   SIFT_HOST_URL=http://localhost:8080 pnpm test:journey
 *   SIFT_HOST_URL=… pnpm test:journey webmcp-hero
 *
 * Opt-in, like `test:host` and `test:deployed`: it needs a specific browser
 * build and a running instance, so it is never part of `pnpm verify`, which
 * must run offline. A missing URL or a browser without WebMCP is a failure
 * of a gate you chose to run — not a skip, and never a pass.
 *
 * Artifacts land in `artifacts/journey/<runId>/`: `report.json`,
 * `summary.md`, and one screenshot per turn. The screenshots are the input
 * to the UX review, which is a human/model judgment this script does not
 * attempt to automate — it collects the evidence and records observations
 * turns made along the way.
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { HostSession, HostSessionUnavailableError } from './journey/host-session.js';
import {
  runJourney,
  writeJourneyReport,
  type Journey,
  type JourneyResult,
} from './journey/harness.js';
import { webmcpHero } from './journey/journeys/webmcp-hero.js';
import { awsHero } from './journey/journeys/aws-hero.js';
import { sharedControl } from './journey/journeys/shared-control.js';
import { familyNovice } from './journey/journeys/family-novice.js';
import { bidComparisonHero } from './journey/journeys/bid-comparison-hero.js';

const ARTIFACT_ROOT = fileURLToPath(new URL('../artifacts/journey', import.meta.url));

const ALL: Journey[] = [webmcpHero, awsHero, sharedControl, familyNovice, bidComparisonHero];

async function main(): Promise<void> {
  const baseUrl = (process.env['SIFT_HOST_URL'] ?? '').replace(/\/+$/, '');
  if (baseUrl === '') {
    console.error(
      '[sift] test:journey: SIFT_HOST_URL is not set. This gate drives a real WebMCP browser ' +
        'against a running Sift instance — set it to the origin to test (e.g. ' +
        'http://localhost:8080 or the deployed URL) and rerun.',
    );
    process.exit(1);
  }

  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const journeys =
    requested.length === 0 ? ALL : ALL.filter((journey) => requested.includes(journey.id));
  if (journeys.length === 0) {
    console.error(
      `[sift] test:journey: no journey matched ${requested.join(', ')}. Known: ${ALL.map((j) => j.id).join(', ')}`,
    );
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(ARTIFACT_ROOT, runId);

  let host: HostSession;
  try {
    host = await HostSession.open();
  } catch (error) {
    if (error instanceof HostSessionUnavailableError) {
      console.error(`[sift] test:journey: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const results: JourneyResult[] = [];
  try {
    for (const journey of journeys) {
      console.log(`\n[sift] ${journey.title}`);
      results.push(await runJourney(journey, host, baseUrl, outDir));
    }
  } finally {
    await host.close();
  }

  writeJourneyReport(outDir, runId, baseUrl, results);

  const totals = results.flatMap((journey) => journey.turns.flatMap((turn) => turn.checks));
  const failed = totals.filter((check) => !check.ok);
  // A turn that threw ran no checks at all, so counting only checks
  // reported "31/31 passed" for a run in which three of four journeys died
  // on their first turn. Errors are counted and named separately.
  const errored = results.flatMap((journey) =>
    journey.turns
      .filter((turn) => turn.error !== undefined)
      .map((turn) => `${journey.id}/${turn.id}`),
  );
  console.log(
    `\n[sift] test:journey: ${totals.length - failed.length}/${totals.length} checks passed across ${results.length} journey(s)`,
  );
  if (errored.length > 0) {
    console.log(
      `[sift] ${errored.length} turn(s) ended in an error and ran no checks: ${errored.join(', ')}`,
    );
  }
  console.log(`[sift] evidence: artifacts/journey/${runId}/`);
  if (results.some((journey) => !journey.ok)) process.exit(1);
}

await main();
