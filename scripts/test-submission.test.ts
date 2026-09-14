import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkArchitectureDiagram,
  checkEnvExampleNoSecrets,
  checkFixtureAttribution,
  checkLicenseIsMIT,
  checkReadmeCommandsMatchPackageScripts,
  checkReleaseMetadataPublicUrls,
  checkReleaseVerificationSha,
  checkRequiredFiles,
  checkScenarioReport,
  checkVideoDuration,
  runSubmissionChecks,
  VIDEO_CHECKS,
  type VideoDurationDeps,
} from './test-submission.js';

const MIT_TEXT = [
  'MIT License',
  '',
  'Copyright (c) 2026 Sift contributors',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  '',
].join('\n');

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'sift-test-submission-'));
}

describe('checkRequiredFiles', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails and names every missing required file', () => {
    dir = tempRoot();
    const result = checkRequiredFiles(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('README.md');
    expect(result.message).toContain('LICENSE');
  });

  it('passes when every required file exists', () => {
    dir = tempRoot();
    const files = [
      'README.md',
      'LICENSE',
      '.env.example',
      'docs/reuse-attribution.md',
      'docs/submissions/shared-release-checklist.md',
      'docs/submissions/webmcp/submission-details.md',
      'docs/submissions/webmcp/requirements-checklist.md',
      'docs/submissions/agents-for-humans/submission-details.md',
      'docs/submissions/agents-for-humans/requirements-checklist.md',
    ];
    for (const relPath of files) {
      mkdirSync(join(dir, relPath, '..'), { recursive: true });
      writeFileSync(join(dir, relPath), 'content\n');
    }
    const result = checkRequiredFiles(dir);
    expect(result.status).toBe('pass');
  });
});

// Named to match this checker's own kebab-case result name rather than the
// camelCase function name: the latter (38 chars, mixed-case, no hyphen
// boundaries) sits just over scripts/check-source.ts's Shannon-entropy
// threshold for "looks like a secret," and the kebab-case form is exactly
// the shape its own kebab-case exemption already recognizes as safe.
describe('readme-commands-match-package-scripts (checkReadmeCommandsMatchPackageScripts)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeRoot(readme: string, scripts: Record<string, string>): void {
    if (!dir) throw new Error('dir not set');
    writeFileSync(join(dir, 'README.md'), readme);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sift', scripts }));
  }

  it('fails when README.md is missing', () => {
    dir = tempRoot();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'sift', scripts: {} }));
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/README\.md is missing/);
  });

  it('passes when every referenced pnpm command matches a real root script', () => {
    dir = tempRoot();
    writeRoot('Run `pnpm verify` then `pnpm test:unit`.\n', { verify: 'x', 'test:unit': 'y' });
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('pass');
  });

  it('fails when a referenced root script does not exist', () => {
    dir = tempRoot();
    writeRoot('Run `pnpm test:nonexistent`.\n', { verify: 'x' });
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('test:nonexistent');
  });

  it('ignores ordinary pnpm builtin verbs like `pnpm install`', () => {
    dir = tempRoot();
    writeRoot('```bash\npnpm install\n```\n', {});
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('pass');
  });

  it('validates `pnpm --filter <pkg> <script>` against that workspace package', () => {
    dir = tempRoot();
    writeRoot('Run `pnpm --filter @sift/web build`.\n', { verify: 'x' });
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    writeFileSync(
      join(dir, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: '@sift/web', scripts: { build: 'vite build' } }),
    );
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('pass');
  });

  it('fails when `pnpm --filter <pkg> <script>` references a script the workspace package lacks', () => {
    dir = tempRoot();
    writeRoot('Run `pnpm --filter @sift/web nonexistent-script`.\n', { verify: 'x' });
    mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
    writeFileSync(
      join(dir, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: '@sift/web', scripts: { build: 'vite build' } }),
    );
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('nonexistent-script');
  });

  it('fails when `pnpm --filter` references an unknown workspace package', () => {
    dir = tempRoot();
    writeRoot('Run `pnpm --filter @sift/does-not-exist build`.\n', { verify: 'x' });
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('@sift/does-not-exist');
  });

  it('only scans commands inside backticks, not plain prose', () => {
    dir = tempRoot();
    writeRoot('This mentions pnpm nonexistent-script in prose only, without backticks.\n', {
      verify: 'x',
    });
    const result = checkReadmeCommandsMatchPackageScripts(dir);
    expect(result.status).toBe('pass');
  });
});

describe('checkLicenseIsMIT', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails when LICENSE is missing', () => {
    dir = tempRoot();
    const result = checkLicenseIsMIT(dir);
    expect(result.status).toBe('fail');
  });

  it('fails when LICENSE exists but is not MIT text', () => {
    dir = tempRoot();
    writeFileSync(join(dir, 'LICENSE'), 'Apache License 2.0\n');
    const result = checkLicenseIsMIT(dir);
    expect(result.status).toBe('fail');
  });

  it('passes for real MIT license text', () => {
    dir = tempRoot();
    writeFileSync(join(dir, 'LICENSE'), MIT_TEXT);
    const result = checkLicenseIsMIT(dir);
    expect(result.status).toBe('pass');
  });
});

describe('checkEnvExampleNoSecrets', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails when .env.example is missing', () => {
    dir = tempRoot();
    const result = checkEnvExampleNoSecrets(dir);
    expect(result.status).toBe('fail');
  });

  it('passes when values are empty or clearly non-secret defaults', () => {
    dir = tempRoot();
    writeFileSync(
      join(dir, '.env.example'),
      [
        '# comment',
        'SIFT_EXECUTION_TARGET=local',
        'SIFT_MODEL_ID=',
        'AWS_REGION=us-east-1',
        '',
      ].join('\n'),
    );
    const result = checkEnvExampleNoSecrets(dir);
    expect(result.status).toBe('pass');
  });

  it('fails on a credential-named key with a real-looking value', () => {
    dir = tempRoot();
    // Built from two concatenated halves (rather than one literal) so this
    // fixture's fake-secret shape never appears as one contiguous run in
    // this file's own tracked source — see the AWS_KEY_ID_PATTERN comment
    // in test-submission.ts for why that matters to scripts/check-source.ts.
    const fakeSecretValue = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCY' + 'EXAMPLEKEY';
    writeFileSync(join(dir, '.env.example'), `AWS_SECRET_ACCESS_KEY=${fakeSecretValue}\n`);
    const result = checkEnvExampleNoSecrets(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('AWS_SECRET_ACCESS_KEY');
  });

  it('does not flag a credential-named key with an obvious placeholder value', () => {
    dir = tempRoot();
    writeFileSync(join(dir, '.env.example'), 'API_KEY=your-api-key-here\n');
    const result = checkEnvExampleNoSecrets(dir);
    expect(result.status).toBe('pass');
  });

  it('fails on a value matching the AWS access key ID shape regardless of the key name', () => {
    dir = tempRoot();
    // Same concatenation reasoning as the fixture above.
    const fakeKeyId = 'AKIAIOSFODNN7' + 'EXAMPLE';
    writeFileSync(join(dir, '.env.example'), `SOME_VAR=${fakeKeyId}\n`);
    const result = checkEnvExampleNoSecrets(dir);
    expect(result.status).toBe('fail');
  });
});

describe('checkArchitectureDiagram', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails when both source and export are missing', () => {
    dir = tempRoot();
    const result = checkArchitectureDiagram(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('architecture.mmd');
    expect(result.message).toContain('architecture.png');
  });

  it('passes when both source and export exist and are non-empty', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'architecture.mmd'), 'graph TD; A-->B;\n');
    writeFileSync(join(dir, 'docs', 'architecture.png'), Buffer.from([1, 2, 3, 4]));
    const result = checkArchitectureDiagram(dir);
    expect(result.status).toBe('pass');
  });
});

describe('checkFixtureAttribution', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails when the file is missing', () => {
    dir = tempRoot();
    const result = checkFixtureAttribution(dir);
    expect(result.status).toBe('fail');
  });

  it('fails when the file is a trivial placeholder', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'reuse-attribution.md'), '# Attribution\n\nTBD.\n');
    const result = checkFixtureAttribution(dir);
    expect(result.status).toBe('fail');
  });

  it('passes for a real attribution document with a dated section heading', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'reuse-attribution.md'),
      `# Sift Reuse Attribution\n\n## 2026-08-27 — Example entry\n\n${'x'.repeat(500)}\n`,
    );
    const result = checkFixtureAttribution(dir);
    expect(result.status).toBe('pass');
  });
});

describe('checkScenarioReport', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function scenarioDir(scenarioId: string): string {
    if (!dir) throw new Error('dir not set');
    const path = join(dir, 'artifacts', 'verification', 'scenarios', scenarioId);
    mkdirSync(path, { recursive: true });
    return path;
  }

  it('fails when the report is absent', () => {
    dir = tempRoot();
    const result = checkScenarioReport(dir, 'home-energy-guardian');
    expect(result.status).toBe('fail');
    expect(result.name).toBe('scenario-report:home-energy-guardian');
    expect(result.message).toContain('absent');
  });

  it('fails when the report says passed: false', () => {
    dir = tempRoot();
    const path = scenarioDir('car-purchase');
    writeFileSync(
      join(path, 'assertion-report.json'),
      JSON.stringify({ passed: false, results: [{ passed: false }, { passed: true }] }),
    );
    const result = checkScenarioReport(dir, 'car-purchase');
    expect(result.status).toBe('fail');
    expect(result.message).toContain('1 failing');
  });

  it('passes when the report says passed: true', () => {
    dir = tempRoot();
    const path = scenarioDir('car-purchase');
    writeFileSync(
      join(path, 'assertion-report.json'),
      JSON.stringify({ passed: true, results: [{ passed: true }] }),
    );
    const result = checkScenarioReport(dir, 'car-purchase');
    expect(result.status).toBe('pass');
  });

  it('fails when the report is not valid JSON', () => {
    dir = tempRoot();
    const path = scenarioDir('car-purchase');
    writeFileSync(join(path, 'assertion-report.json'), '{not json');
    const result = checkScenarioReport(dir, 'car-purchase');
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not valid JSON');
  });
});

describe('checkReleaseVerificationSha', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeReport(gitSha: string | null): void {
    if (!dir) throw new Error('dir not set');
    const path = join(dir, 'artifacts', 'verification', 'latest');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'report.json'), JSON.stringify({ gitSha }));
  }

  it('fails when no verification report exists', () => {
    dir = tempRoot();
    const result = checkReleaseVerificationSha(dir, () => 'abc123');
    expect(result.status).toBe('fail');
    expect(result.message).toContain('pnpm verify');
  });

  it('fails when the report gitSha differs from the current Git SHA', () => {
    dir = tempRoot();
    writeReport('old-sha');
    const result = checkReleaseVerificationSha(dir, () => 'new-sha');
    expect(result.status).toBe('fail');
    expect(result.message).toContain('old-sha');
    expect(result.message).toContain('new-sha');
  });

  it('passes when the report gitSha matches the current Git SHA', () => {
    dir = tempRoot();
    writeReport('same-sha');
    const result = checkReleaseVerificationSha(dir, () => 'same-sha');
    expect(result.status).toBe('pass');
  });

  it('skips when the current Git SHA cannot be resolved', () => {
    dir = tempRoot();
    writeReport('some-sha');
    const result = checkReleaseVerificationSha(dir, () => null);
    expect(result.status).toBe('skip');
  });
});

describe('checkVideoDuration', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  // `VIDEO_CHECKS` now holds only the agents-for-humans spec — the webmcp
  // spec (and its 180s-limit test cases) was removed along with it. The
  // OpenAI WebMCP Challenge is a separate, already-submitted contest, so
  // this release's video-duration gate no longer covers it.
  const awsSpec = VIDEO_CHECKS.find((spec) => spec.key === 'agents-for-humans');
  if (!awsSpec) throw new Error('agents-for-humans video spec not found');

  it('skips when no video file is present at the conventional path', () => {
    dir = tempRoot();
    const result = checkVideoDuration(dir, awsSpec, {});
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no video file yet');
  });

  it('skips with an honest reason when ffprobe is unavailable but the file exists', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'demo', 'aws-recording.mp4'), Buffer.from([0]));
    const deps: VideoDurationDeps = {
      isFfprobeAvailable: () => false,
      probeDurationSeconds: () => null,
    };
    const result = checkVideoDuration(dir, awsSpec, {}, deps);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('ffprobe is not available');
  });

  it('passes when the AWS recording is exactly five minutes (inclusive limit)', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'demo', 'aws-recording.mp4'), Buffer.from([0]));
    const deps: VideoDurationDeps = {
      isFfprobeAvailable: () => true,
      probeDurationSeconds: () => 300,
    };
    const result = checkVideoDuration(dir, awsSpec, {}, deps);
    expect(result.status).toBe('pass');
  });

  it('fails when the AWS recording exceeds five minutes', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'demo', 'aws-recording.mp4'), Buffer.from([0]));
    const deps: VideoDurationDeps = {
      isFfprobeAvailable: () => true,
      probeDurationSeconds: () => 300.1,
    };
    const result = checkVideoDuration(dir, awsSpec, {}, deps);
    expect(result.status).toBe('fail');
  });

  it('honors a SIFT_*_VIDEO_PATH env override', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'custom'), { recursive: true });
    writeFileSync(join(dir, 'custom', 'my-video.mp4'), Buffer.from([0]));
    const deps: VideoDurationDeps = {
      isFfprobeAvailable: () => true,
      probeDurationSeconds: () => 10,
    };
    const result = checkVideoDuration(
      dir,
      awsSpec,
      { SIFT_AWS_VIDEO_PATH: 'custom/my-video.mp4' },
      deps,
    );
    expect(result.status).toBe('pass');
    expect(result.message).toContain('custom/my-video.mp4');
  });
});

describe('checkReleaseMetadataPublicUrls', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('fails honestly when the file does not exist', () => {
    dir = tempRoot();
    const result = checkReleaseMetadataPublicUrls(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('does not exist');
  });

  // `webmcpVideoUrl` was dropped from RELEASE_METADATA_REQUIRED_URL_FIELDS:
  // the OpenAI WebMCP Challenge is a separate, already-submitted contest, so
  // this release's metadata gate no longer requires that field.
  it('fails and names the specific unset fields when some are missing, including agentsForHumansVideoUrl', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs', 'submissions'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'submissions', 'release-metadata.json'),
      JSON.stringify({ repositoryUrl: 'https://github.com/example/sift', deployedUrl: null }),
    );
    const result = checkReleaseMetadataPublicUrls(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('deployedUrl');
    expect(result.message).toContain('agentsForHumansVideoUrl');
    expect(result.message).not.toContain('repositoryUrl,'); // repositoryUrl was set, should not be listed as unset
  });

  it('passes when every required URL field is a valid-looking URL', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs', 'submissions'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'submissions', 'release-metadata.json'),
      JSON.stringify({
        repositoryUrl: 'https://github.com/example/sift',
        deployedUrl: 'https://sift-hackathon-production.up.railway.app',
        agentsForHumansVideoUrl: 'https://youtube.com/watch?v=def',
      }),
    );
    const result = checkReleaseMetadataPublicUrls(dir);
    expect(result.status).toBe('pass');
  });

  it('fails when the file is not valid JSON', () => {
    dir = tempRoot();
    mkdirSync(join(dir, 'docs', 'submissions'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'submissions', 'release-metadata.json'), '{not json');
    const result = checkReleaseMetadataPublicUrls(dir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not valid JSON');
  });
});

describe('runSubmissionChecks', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('aggregates every check and is not ok when any check fails', () => {
    dir = tempRoot();
    const report = runSubmissionChecks({ rootDir: dir, resolveGitSha: () => 'sha', env: {} });
    expect(report.ok).toBe(false);
    expect(report.results.length).toBeGreaterThan(5);
    expect(report.results.some((r) => r.status === 'fail')).toBe(true);
  });

  it('never reports a check whose name resembles a human/legal attestation category', () => {
    dir = tempRoot();
    const report = runSubmissionChecks({ rootDir: dir, resolveGitSha: () => 'sha', env: {} });
    const forbidden =
      /eligib|country|submitter[-_ ]?type|learning|career|builder[-_ ]?id|rule[-_ ]?agreement/i;
    for (const result of report.results) {
      expect(result.name).not.toMatch(forbidden);
    }
  });
});
