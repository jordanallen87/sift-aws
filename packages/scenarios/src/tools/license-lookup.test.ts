import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BID_FIXTURE_NAMES } from './bid-reader.js';
import { loadFixture } from './fixture-loader.js';
import {
  LICENSE_LOOKUP_TOOL_ID,
  licenceHolderMatchesBidder,
  lookupLicense,
  type LicenseLookupResult,
} from './license-lookup.js';

/** See listing-reader.test.ts for the full rationale. */
function signalAbortingOnRead(n: number): AbortSignal {
  let reads = 0;
  return {
    get aborted() {
      reads += 1;
      return reads >= n;
    },
  } as unknown as AbortSignal;
}

function expectOk<T>(result: { status: string }): asserts result is { status: 'ok'; data: T } {
  expect(result.status).toBe('ok');
}

describe('lookupLicense -- clean licences (Northgate, Cedar)', () => {
  it("Northgate's licence is active, class covers scope, insurance active, and the named insured matches exactly", () => {
    const result = lookupLicense({ licenseNumber: 'PL-4417-NG' });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.license.licenseHolderName).toBe('Northgate Plumbing');
    expect(result.data.license.isActive).toBe(true);
    expect(result.data.license.classCoversScope).toBe(true);
    expect(result.data.license.insurance.isActive).toBe(true);
    expect(result.data.license.insurance.matchesLicenseHolder).toBe(true);
    expect(result.data.license.insurance.namedInsured).toBe('Northgate Plumbing');
  });

  it("Cedar's licence is likewise clean on every check", () => {
    const result = lookupLicense({ licenseNumber: 'PL-2290-CS' });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.license.isActive).toBe(true);
    expect(result.data.license.classCoversScope).toBe(true);
    expect(result.data.license.insurance.isActive).toBe(true);
    expect(result.data.license.insurance.matchesLicenseHolder).toBe(true);
  });

  it('produces two passing E1 evidence items (overall standing + named-insured match) for a clean licence', () => {
    const result = lookupLicense({ licenseNumber: 'PL-4417-NG' });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.evidence).toHaveLength(2);
    for (const item of result.data.evidence) {
      expect(item.level).toBe('E1');
      expect(item.verdict).toBe('pass');
      expect(item.summary.trim()).not.toBe('');
    }
  });
});

describe('lookupLicense -- Two Rivers Mechanical (deliberate named-insured mismatch)', () => {
  it('reports the licence itself active with class coverage and active insurance', () => {
    const result = lookupLicense({ licenseNumber: 'PL-8801-TR' });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.license.licenseHolderName).toBe('Two Rivers Mechanical Inc');
    expect(result.data.license.isActive).toBe(true);
    expect(result.data.license.classCoversScope).toBe(true);
    expect(result.data.license.insurance.isActive).toBe(true);
  });

  it('surfaces the named-insured mismatch as its own distinct, checkable finding -- not buried in the overall summary', () => {
    const result = lookupLicense({ licenseNumber: 'PL-8801-TR' });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.license.insurance.matchesLicenseHolder).toBe(false);
    expect(result.data.license.insurance.namedInsured).toBe('TRM Holdings LLC');

    expect(result.data.evidence).toHaveLength(2);
    const [standing, namedInsured] = result.data.evidence;

    // The overall standing check is unaffected -- licence/class/insurance
    // status alone would look completely clean.
    expect(standing?.sourceId).not.toContain('named-insured');

    // The mismatch is its own item, with its own degraded verdict, distinct
    // sourceId, and both names spelled out.
    expect(namedInsured?.sourceId).toContain('named-insured');
    expect(namedInsured?.verdict).toBe('degraded');
    expect(namedInsured?.summary).toContain('TRM Holdings LLC');
    expect(namedInsured?.summary).toContain('Two Rivers Mechanical Inc');
    expect(namedInsured?.summary).toContain('does not match');
  });
});

describe('lookupLicense -- inactive licence / inactive insurance (via baseDir test seam)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sift-license-lookup-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports isActive: false and a degraded overall verdict for a suspended licence, with no reachable case against the real fixture', () => {
    const realRegistry = loadFixture('license-registry');
    const suspendedRegistry = {
      ...realRegistry,
      entries: realRegistry.entries.map((entry) =>
        entry.licenseNumber === 'PL-4417-NG' ? { ...entry, status: 'suspended' } : entry,
      ),
    };
    writeFileSync(join(tempDir, 'license-registry.json'), JSON.stringify(suspendedRegistry));

    const result = lookupLicense({ licenseNumber: 'PL-4417-NG', baseDir: tempDir });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.license.status).toBe('suspended');
    expect(result.data.license.isActive).toBe(false);
    const [standing] = result.data.evidence;
    expect(standing?.verdict).toBe('degraded');
    expect(standing?.summary).toContain('suspended');
  });

  it('reports insurance.isActive: false for a lapsed policy', () => {
    const realRegistry = loadFixture('license-registry');
    const lapsedRegistry = {
      ...realRegistry,
      entries: realRegistry.entries.map((entry) =>
        entry.licenseNumber === 'PL-2290-CS'
          ? { ...entry, insurance: { ...entry.insurance, status: 'lapsed' } }
          : entry,
      ),
    };
    writeFileSync(join(tempDir, 'license-registry.json'), JSON.stringify(lapsedRegistry));

    const result = lookupLicense({ licenseNumber: 'PL-2290-CS', baseDir: tempDir });
    expectOk<LicenseLookupResult>(result);
    expect(result.data.license.insurance.status).toBe('lapsed');
    expect(result.data.license.insurance.isActive).toBe(false);
    const [standing] = result.data.evidence;
    expect(standing?.verdict).toBe('degraded');
  });
});

describe('lookupLicense -- determinism, not_found, and cancellation', () => {
  it('is deterministic: identical input twice produces deep-equal output', () => {
    const first = lookupLicense({ licenseNumber: 'PL-8801-TR' });
    const second = lookupLicense({ licenseNumber: 'PL-8801-TR' });
    expect(second).toEqual(first);
  });

  it('returns a deterministic not_found result for an unknown licenseNumber, without throwing', () => {
    const result = lookupLicense({ licenseNumber: 'PL-0000-XX' });
    if (result.status !== 'not_found') {
      throw new Error(`expected status "not_found", got "${result.status}"`);
    }
    expect(result.toolId).toBe(LICENSE_LOOKUP_TOOL_ID);
    expect(result.query).toBe('PL-0000-XX');
  });

  it('returns a cancelled result when called with an already-aborted signal, before loading anything', () => {
    const controller = new AbortController();
    controller.abort();
    const result = lookupLicense({ licenseNumber: 'PL-4417-NG', signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect((result as { toolId: string }).toolId).toBe(LICENSE_LOOKUP_TOOL_ID);
  });

  it('checks the signal again mid-flight and honors a late abort', () => {
    const result = lookupLicense({
      licenseNumber: 'PL-4417-NG',
      signal: signalAbortingOnRead(2),
    });
    expect(result.status).toBe('cancelled');
  });
});

describe('licenceHolderMatchesBidder', () => {
  it('tolerates the "Inc" suffix -- the exact discrepancy between bid-tworivers.json and its own registry entry', () => {
    expect(licenceHolderMatchesBidder('Two Rivers Mechanical Inc', 'Two Rivers Mechanical')).toBe(
      true,
    );
  });

  it("rejects a bid citing someone else's licence outright -- the live defect this helper exists to fix", () => {
    expect(licenceHolderMatchesBidder('Northgate Plumbing', 'Harborline Mechanical')).toBe(false);
  });

  it("every one of the twelve seeded bid fixtures' contractorName matches its own registry licenseHolderName, read off the real checked-in files", () => {
    const registry = loadFixture('license-registry');
    expect(BID_FIXTURE_NAMES.length).toBeGreaterThan(0);
    for (const fixtureName of BID_FIXTURE_NAMES) {
      const bid = loadFixture(fixtureName);
      const entry = registry.entries.find(
        (candidate) => candidate.licenseNumber === bid.licenseNumber,
      );
      expect(
        entry,
        `no registry entry for ${fixtureName}'s licenceNumber "${bid.licenseNumber}"`,
      ).toBeDefined();
      expect(
        licenceHolderMatchesBidder(entry?.licenseHolderName ?? '', bid.contractorName),
        `${fixtureName}: "${bid.contractorName}" vs registry holder "${entry?.licenseHolderName}"`,
      ).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(licenceHolderMatchesBidder('Cedar & Sons', 'cedar & sons')).toBe(true);
    expect(licenceHolderMatchesBidder('Cedar & Sons', 'CEDAR & SONS')).toBe(true);
  });

  it('treats ". , & -" as word separators, so a hyphenated or ampersand-joined name matches its spaced-out spelling', () => {
    expect(licenceHolderMatchesBidder('Cedar & Sons', 'Cedar, Sons')).toBe(true);
    expect(licenceHolderMatchesBidder('Cedar & Sons', 'Cedar and Sons')).toBe(false); // "&" and the word "and" are not the same token -- normalisation never invents words
    expect(licenceHolderMatchesBidder('Smith-Jones Mechanical', 'Smith Jones Mechanical')).toBe(
      true,
    );
  });

  it('deletes an apostrophe outright rather than treating it as a word break, so a mid-word contraction matches its unpunctuated spelling', () => {
    expect(licenceHolderMatchesBidder("O'Brien Plumbing", "O'Brien Plumbing")).toBe(true);
    expect(licenceHolderMatchesBidder("O'Brien Plumbing", 'OBrien Plumbing')).toBe(true);
  });

  it('rejects genuinely different names that happen to share a word', () => {
    expect(licenceHolderMatchesBidder('Summit Mechanical Co.', 'Summit Plumbing')).toBe(false);
  });

  it('returns false for empty or whitespace-only input on either side, never a fabricated match', () => {
    expect(licenceHolderMatchesBidder('', '')).toBe(false);
    expect(licenceHolderMatchesBidder('   ', '   ')).toBe(false);
    expect(licenceHolderMatchesBidder('Northgate Plumbing', '')).toBe(false);
    expect(licenceHolderMatchesBidder('', 'Northgate Plumbing')).toBe(false);
    expect(licenceHolderMatchesBidder('Northgate Plumbing', '   ')).toBe(false);
  });

  it('strips repeated corporate suffixes, not just one ("Foo Co Inc" -> "Foo")', () => {
    expect(licenceHolderMatchesBidder('Foo Co Inc', 'Foo')).toBe(true);
    expect(licenceHolderMatchesBidder('Foo Company', 'Foo')).toBe(true);
    expect(licenceHolderMatchesBidder('Foo Corporation', 'Foo Corp')).toBe(true);
    // "Ltd" and "Limited" are different spellings of the same suffix -- both
    // strip away, leaving "foo" on both sides.
    expect(licenceHolderMatchesBidder('Foo Ltd', 'Foo Limited')).toBe(true);
  });

  it('strips the spelled-out "L.L.C." suffix the same as "LLC"', () => {
    expect(licenceHolderMatchesBidder('Foo L.L.C.', 'Foo LLC')).toBe(true);
    expect(licenceHolderMatchesBidder('Foo L.L.C.', 'Foo')).toBe(true);
  });

  it('never strips a suffix word that is the whole name down to nothing', () => {
    expect(licenceHolderMatchesBidder('Inc', 'Inc')).toBe(true);
    expect(licenceHolderMatchesBidder('Co', 'Co')).toBe(true);
    // A single suffix word is not the same business as a real multi-word
    // name, even one that also ends in that word.
    expect(licenceHolderMatchesBidder('Inc', 'Foo Inc')).toBe(false);
  });

  it('never strips "co" (or any suffix word) as a substring from inside a longer word', () => {
    // "Ecoline" contains the letters "co" but is one token, never decomposed
    // into "eco" + something -- suffix stripping only ever removes a whole
    // trailing WORD, never characters from inside one, so "Ecoline" is not
    // the same word as "Eco" and the two names do not match.
    expect(licenceHolderMatchesBidder('Ecoline Plumbing', 'Eco Plumbing')).toBe(false);
    // A real standalone trailing "Co" (its own word) DOES strip as a suffix.
    expect(licenceHolderMatchesBidder('Eco Plumbing Co', 'Eco Plumbing')).toBe(true);
  });
});
