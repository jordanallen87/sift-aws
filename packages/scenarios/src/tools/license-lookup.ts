/**
 * Fixture tool: "license lookup"
 * (docs/bid-comparison/plan.md "Specialists and skills": `credential-checker`
 * tool `license-lookup`, obligation `bid.credential_verification` --
 * "licence covers this work, insurance active, named insured matches").
 *
 * Given a licence number, returns whether the licence is active, whether
 * its class covers this trade's scope, whether the certificate of
 * insurance is active, and -- kept as its own distinct, checkable finding
 * rather than folded silently into one summary sentence -- whether the
 * certificate's named insured actually matches the licence holder.
 *
 * Two Rivers Mechanical's bid is the deliberate case this last check exists
 * to catch: licence active, class covers scope, insurance active, but the
 * certificate names "TRM Holdings LLC", not the licence holder "Two Rivers
 * Mechanical Inc". A tool that only reported an overall "credentials OK/not
 * OK" boolean could bury that one discrepancy inside an otherwise-clean
 * result; `namedInsuredMatch`-adjacent facts are surfaced as their own
 * evidence item so a human sees exactly which check failed and why.
 *
 * Evidence-level assignment rule: every fact here comes from one traceable
 * document -- `license-registry.json`, this fictional state's licensing
 * registry -- so each finding is tagged `E1` ("one traceable source",
 * packs-and-routing.md's evidence-level table), the same per-source rule as
 * `tariff-lookup.ts`.
 *
 * The real fixture's twelve entries are all `status: 'active'` with active
 * insurance, so the "licence not active" / "insurance not active" branches
 * below have no reachable case against the checked-in registry; they are
 * exercised via `fixtureBaseDir` (see `CalculateEnergyAnalysisInput` in
 * `energy-calculator.ts` for the established rationale for this test seam)
 * rather than left as untested dead code. One entry (Fieldstone Plumbing
 * Co., `PL-7734-FS`) DOES have `classCoversScope: false` -- a real,
 * reachable case for that branch against the checked-in registry, not a
 * status-inactive one: its licence is active and its insurance is active
 * and correctly named, but its own licence class carries no plumbing trade
 * endorsement, so it fails `credentials_valid` on a different, genuinely
 * distinct ground than Two Rivers Mechanical's named-insured mismatch.
 */
import {
  loadFixture,
  type LicenseRegistryEntry,
  type LoadFixtureOptions,
} from './fixture-loader.js';
import {
  cancelledResult,
  isAborted,
  notFoundResult,
  okResult,
  type ToolEvidenceItem,
  type ToolResult,
} from './tool-result.js';

export const LICENSE_LOOKUP_TOOL_ID = 'license-lookup';

const ACTIVE_STATUS = 'active';

export interface LicenseInsuranceFacts {
  status: string;
  isActive: boolean;
  namedInsured: string;
  matchesLicenseHolder: boolean;
}

export interface LicenseLookupFacts {
  licenseNumber: string;
  licenseHolderName: string;
  status: string;
  isActive: boolean;
  classCoversScope: boolean;
  class: string;
  insurance: LicenseInsuranceFacts;
}

export interface LicenseLookupResult {
  license: LicenseLookupFacts;
  evidence: ToolEvidenceItem[];
}

export interface LicenseLookupInput extends LoadFixtureOptions {
  licenseNumber: string;
  signal?: AbortSignal;
}

/**
 * Corporate-entity suffixes stripped from the END of a normalised name only
 * (see `stripCorporateSuffixes`). "Foo Co Inc" strips to "foo" (both words
 * removed, one at a time); "Foo Company" and "Foo Corporation" both strip to
 * "foo" too. Deliberately does NOT include anything that could also be a
 * real trade word this domain uses (no "group", no "services", no
 * "contractors") -- those appear in real licence-holder names in this very
 * registry (`Parkside Plumbing Group`, `Crestview Mechanical Services`,
 * `Westbrook Mechanical Contractors`) and stripping them would erase a
 * meaningful difference instead of a purely administrative one.
 */
const CORPORATE_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'co',
  'company',
  'corp',
  'corporation',
  'ltd',
  'limited',
]);

/**
 * Strips trailing corporate-suffix words one at a time (so "Foo Co Inc"
 * loses "inc" then "co"), plus the special case of "llc" spelled with
 * periods ("L.L.C."), which `normalizeNameWords` below has already turned
 * into three separate single-letter words ("l l c") by the time this runs.
 *
 * Never pops the last remaining word. A name that IS just "Inc" or "Co" (or,
 * degenerately, "L L C") is a real, if odd, string to compare -- collapsing
 * it to nothing would turn "no information" into a false match against any
 * other single-word name stripped down to empty, which is worse than
 * leaving the suffix word in place.
 */
function stripCorporateSuffixes(words: readonly string[]): string[] {
  let result = [...words];
  let changed = true;
  while (changed) {
    changed = false;

    if (result.length > 3 && result.slice(-3).join(' ') === 'l l c') {
      result = result.slice(0, -3);
      changed = true;
      continue;
    }

    const last = result[result.length - 1];
    if (result.length > 1 && last !== undefined && CORPORATE_SUFFIXES.has(last)) {
      result = result.slice(0, -1);
      changed = true;
    }
  }
  return result;
}

/**
 * Lower-cases, then removes/replaces punctuation in two different ways on
 * purpose:
 *
 *  - `. , & -` become a SPACE, because each one separates two otherwise-
 *    distinct words in a filing name: "Smith-Jones Mechanical" must tokenize
 *    the same as "Smith Jones Mechanical", and "Foo, Inc." the same as "Foo
 *    Inc" -- deleting the character outright would instead fuse them into
 *    "smithjones", merging two words that were never meant to be one.
 *  - `'` is deleted outright, not turned into a space, because an
 *    apostrophe in a business name is almost always a mid-word contraction
 *    ("O'Brien") rather than a word boundary: "O'Brien Plumbing" and the
 *    same firm spelled "OBrien Plumbing" on a different document are the
 *    same one-word surname either way, and turning the apostrophe into a
 *    space would wrongly split it into two tokens ("o", "brien") that would
 *    then fail to match the no-apostrophe spelling's single "obrien" token.
 *
 * Whitespace is then collapsed and the result split into words. Word-level
 * splitting is also what keeps suffix-stripping from ever touching a suffix
 * that is merely a SUBSTRING of a longer word: "co" is stripped only when it
 * is its own array entry, so "Ecoline Plumbing" ("ecoline", "plumbing") is
 * untouched -- there is no "co" token to find.
 */
function normalizeNameWords(name: string): string[] {
  const noApostrophes = name.replace(/'/g, '');
  const spaced = noApostrophes.toLowerCase().replace(/[.,&-]/g, ' ');
  const words = spaced.split(/\s+/).filter((word) => word.length > 0);
  return stripCorporateSuffixes(words);
}

/**
 * Does the licence registry's `licenseHolderName` refer to the same
 * business as the name a bid document states for itself
 * (`contractorName`)? This is the check `buildCredentialAttributes`
 * (`apps/agent/src/services/command-service.ts`) is missing before this fix:
 * a licence lookup by number alone tells you the licence is real, active,
 * and insured -- never that it belongs to the bidder citing it.
 *
 * Deliberately NOT strict string equality: `bid-tworivers.json`'s
 * `contractorName` is "Two Rivers Mechanical" while the registry's
 * `licenseHolderName` for that same licence is "Two Rivers Mechanical Inc"
 * -- a corporate suffix, not a different company, and Two Rivers already
 * fails this bid's credential gate for a real, separate reason (its
 * certificate of insurance names "TRM Holdings LLC", not its own licence
 * holder). A strict-equality version of this check would hand Two Rivers a
 * SECOND, spurious failure reason and corrupt that load-bearing demo beat.
 * So both names are normalised (case-folded, punctuation flattened to
 * spaces, corporate suffixes stripped from the end) before comparing --
 * tolerant of exactly the "Inc"/"Co."/"&" noise a real filing name carries,
 * and nothing more: two genuinely different names that happen to share one
 * word ("Summit Mechanical Co." vs. "Summit Plumbing") still compare
 * unequal after normalisation, because normalisation never removes or
 * reorders a distinguishing word, only administrative decoration.
 *
 * Empty or whitespace-only input (on EITHER side) always returns `false`,
 * never `true` -- two blank strings are not evidence of a match, they are
 * an absence of the information a match requires.
 */
export function licenceHolderMatchesBidder(licenseHolderName: string, bidderName: string): boolean {
  const holderWords = normalizeNameWords(licenseHolderName);
  const bidderWords = normalizeNameWords(bidderName);
  if (holderWords.length === 0 || bidderWords.length === 0) return false;
  return holderWords.join(' ') === bidderWords.join(' ');
}

/**
 * Deliberately short. `scripts/check-source.ts` flags any 40+ character
 * `[A-Za-z0-9+_=-]` token whose Shannon entropy reaches 4.0 as a possible
 * secret, and it evaluates string literals -- which these ids are, both here
 * and where the scripted beats quote them. `source-license-pl-4417-ng-named-insured`
 * is 48 characters at entropy 4.15 and tripped it: the uppercase licence
 * numbers carry enough character diversity to clear the threshold where the
 * energy pack's all-lowercase ids do not.
 *
 * The scanner is right to be blunt about this and must not be softened to
 * accommodate us, so the identifiers conform instead. It already exempts
 * "a long, strictly-lowercase, multi-segment kebab-case token (3+
 * hyphen-joined alphanumeric words)" as a human-readable identifier rather
 * than a credential -- which is exactly what these are, and exactly the
 * shape the energy pack's own source ids already use (that is why
 * `source-household-event-event-thermostat-failure-2026-07` passes at 55
 * characters and entropy 4.07). Only the uppercase licence number broke the
 * pattern, so the id lowercases it. The licence number itself is untouched
 * everywhere it is data rather than an identifier.
 */
function licenseSourceId(licenseNumber: string): string {
  return `source-license-${licenseNumber.toLowerCase()}`;
}

function toFacts(entry: LicenseRegistryEntry): LicenseLookupFacts {
  return {
    licenseNumber: entry.licenseNumber,
    licenseHolderName: entry.licenseHolderName,
    status: entry.status,
    isActive: entry.status === ACTIVE_STATUS,
    classCoversScope: entry.classCoversScope,
    class: entry.class,
    insurance: {
      status: entry.insurance.status,
      isActive: entry.insurance.status === ACTIVE_STATUS,
      namedInsured: entry.insurance.namedInsured,
      matchesLicenseHolder: entry.insurance.matchesLicenseHolder,
    },
  };
}

function buildEvidence(facts: LicenseLookupFacts): ToolEvidenceItem[] {
  const sourceId = licenseSourceId(facts.licenseNumber);
  const standingGood = facts.isActive && facts.classCoversScope && facts.insurance.isActive;

  const standingEvidence: ToolEvidenceItem = {
    sourceId,
    level: 'E1',
    verdict: standingGood ? 'pass' : 'degraded',
    summary: `${facts.licenseHolderName} (${facts.licenseNumber}): licence ${facts.status}, ${facts.class} ${facts.classCoversScope ? 'covers' : 'does not cover'} this scope, insurance ${facts.insurance.status}.`,
  };

  const namedInsuredEvidence: ToolEvidenceItem = {
    sourceId: `${sourceId}-named-insured`,
    level: 'E1',
    verdict: facts.insurance.matchesLicenseHolder ? 'pass' : 'degraded',
    summary: facts.insurance.matchesLicenseHolder
      ? `Certificate of insurance names "${facts.insurance.namedInsured}", matching the licence holder "${facts.licenseHolderName}".`
      : `Certificate of insurance names "${facts.insurance.namedInsured}", which does not match the licence holder "${facts.licenseHolderName}" -- needs a human answer before this bid's credentials can be marked verified.`,
  };

  return [standingEvidence, namedInsuredEvidence];
}

export function lookupLicense(input: LicenseLookupInput): ToolResult<LicenseLookupResult> {
  if (isAborted(input.signal)) {
    return cancelledResult(LICENSE_LOOKUP_TOOL_ID);
  }

  const { licenseNumber, signal: _signal, ...loadOptions } = input;
  const registry = loadFixture('license-registry', loadOptions);
  const entry = registry.entries.find((candidate) => candidate.licenseNumber === licenseNumber);

  if (isAborted(input.signal)) {
    return cancelledResult(LICENSE_LOOKUP_TOOL_ID);
  }

  if (!entry) {
    return notFoundResult(
      LICENSE_LOOKUP_TOOL_ID,
      licenseNumber,
      `no license-registry entry found for licenseNumber "${licenseNumber}"`,
    );
  }

  const facts = toFacts(entry);
  return okResult(LICENSE_LOOKUP_TOOL_ID, { license: facts, evidence: buildEvidence(facts) });
}
