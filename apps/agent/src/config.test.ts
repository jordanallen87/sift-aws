import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError, type RawEnv } from './config.js';

// Defaults asserted here are the literal values documented in
// `.env.example` (root of the repo), per this task's instruction to treat
// that file as authoritative for names/defaults.
const DEFAULTS = {
  executionTarget: 'local',
  dataDir: '.sift-data',
  authoringEnabled: false,
  debugEnabled: true,
  tracingEnabled: true,
  debugPayloadMode: 'metadata-only',
  debugRetentionDays: 7,
  modelId: 'global.anthropic.claude-sonnet-4-6',
  awsRegion: 'us-east-1',
  demoPacingMs: 0,
  publicOrigin: undefined,
  bidDocumentReaderEnabled: false,
} as const;

describe('loadConfig', () => {
  it('applies every .env.example-documented default when no env vars are set', () => {
    const config = loadConfig({});
    expect(config).toEqual(DEFAULTS);
  });

  it('reads and coerces every supported variable from a raw env-like object', () => {
    const config = loadConfig({
      SIFT_EXECUTION_TARGET: 'agentcore',
      SIFT_DATA_DIR: '/data',
      SIFT_AUTHORING_ENABLED: 'true',
      SIFT_DEBUG_ENABLED: 'false',
      SIFT_TRACING_ENABLED: 'false',
      SIFT_DEBUG_PAYLOAD_MODE: 'fixture-full',
      SIFT_DEBUG_RETENTION_DAYS: '14',
      SIFT_MODEL_ID: 'global.anthropic.claude-sonnet-4-7',
      AWS_REGION: 'eu-west-1',
      SIFT_PUBLIC_ORIGIN: 'https://sift.example.com',
    });

    expect(config).toEqual({
      executionTarget: 'agentcore',
      dataDir: '/data',
      authoringEnabled: true,
      debugEnabled: false,
      tracingEnabled: false,
      debugPayloadMode: 'fixture-full',
      debugRetentionDays: 14,
      modelId: 'global.anthropic.claude-sonnet-4-7',
      awsRegion: 'eu-west-1',
      demoPacingMs: 0,
      publicOrigin: 'https://sift.example.com',
      bidDocumentReaderEnabled: false,
    });
  });

  it("reads and coerces SIFT_BID_DOCUMENT_READER_ENABLED (opt-in only, per architecture.md's no-network local demo requirement)", () => {
    expect(loadConfig({}).bidDocumentReaderEnabled).toBe(false);
    expect(loadConfig({ SIFT_BID_DOCUMENT_READER_ENABLED: 'true' }).bidDocumentReaderEnabled).toBe(
      true,
    );
    expect(loadConfig({ SIFT_BID_DOCUMENT_READER_ENABLED: 'false' }).bidDocumentReaderEnabled).toBe(
      false,
    );
  });

  it('treats an empty-string SIFT_MODEL_ID as unset and applies the default', () => {
    const config = loadConfig({ SIFT_MODEL_ID: '' });
    expect(config.modelId).toBe(DEFAULTS.modelId);
  });

  it('treats an empty-string SIFT_PUBLIC_ORIGIN as same-origin (undefined)', () => {
    const config = loadConfig({ SIFT_PUBLIC_ORIGIN: '' });
    expect(config.publicOrigin).toBeUndefined();
  });

  it('rejects an empty-string SIFT_AUTHORING_ENABLED (booleanFromEnvString\'s "" branch, distinct from the "key entirely absent" case the no-env-vars test above already covers) -- real behavior, not the default substitution SIFT_MODEL_ID/SIFT_PUBLIC_ORIGIN\'s "" handling gets, because z.boolean() here has no .optional() for ZodDefault to fall through to', () => {
    // Genuine finding, verified empirically against the installed zod@4.4.3:
    // `booleanFromEnvString`'s preprocess step does turn '' into `undefined`
    // (closing this branch), matching its own doc comment's "'' and
    // undefined both mean 'not set'" intent -- but `.default(false)` here
    // wraps `z.preprocess(fn, z.boolean())`, and zod's `ZodDefault` only
    // substitutes the default when the *wrapped* schema itself successfully
    // resolves to `undefined` (as SIFT_MODEL_ID's `.optional()`-wrapped inner
    // schema does); `z.boolean()` alone rejects `undefined` as an invalid
    // boolean, so the net *observable* result is a thrown `ConfigError`, not
    // "applies the default". Not a config.ts fix in scope for this
    // assignment (production-fix permission here is scoped to
    // command-service.ts/run-service.ts only) -- asserting the real behavior.
    expect(() => loadConfig({ SIFT_AUTHORING_ENABLED: '' })).toThrow(ConfigError);
  });

  it('rejects an empty-string SIFT_DEBUG_RETENTION_DAYS (integerFromEnvString\'s "" branch) for the same real reason: z.number() here has no .optional() for ZodDefault to fall through to', () => {
    expect(() => loadConfig({ SIFT_DEBUG_RETENTION_DAYS: '' })).toThrow(ConfigError);
  });

  it('throws a ConfigError listing every invalid variable at once, not just the first', () => {
    let caught: unknown;
    try {
      loadConfig({
        SIFT_EXECUTION_TARGET: 'not-a-target',
        SIFT_DEBUG_PAYLOAD_MODE: 'not-a-mode',
        SIFT_DEBUG_RETENTION_DAYS: 'not-a-number',
        AWS_REGION: '',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as ConfigError).message;
    expect(message).toContain('SIFT_EXECUTION_TARGET');
    expect(message).toContain('SIFT_DEBUG_PAYLOAD_MODE');
    expect(message).toContain('SIFT_DEBUG_RETENTION_DAYS');
    expect(message).toContain('AWS_REGION');
  });

  it('rejects a retention-days value above the 30-day cap from debugging-and-observability.md', () => {
    expect(() => loadConfig({ SIFT_DEBUG_RETENTION_DAYS: '31' })).toThrow(ConfigError);
  });

  it('rejects an invalid SIFT_PUBLIC_ORIGIN that is not a valid URL', () => {
    expect(() => loadConfig({ SIFT_PUBLIC_ORIGIN: 'not a url' })).toThrow(ConfigError);
  });

  it('rejects a non-boolean-shaped SIFT_AUTHORING_ENABLED value', () => {
    expect(() => loadConfig({ SIFT_AUTHORING_ENABLED: 'yes-please' })).toThrow(ConfigError);
  });

  it('falls back to "(config)" as the issue path label when a Zod issue has no field path (a non-object env value fails at the schema root, path: [])', () => {
    let caught: unknown;
    try {
      // `RawEnv` is always a plain object in real use (`process.env` or a
      // literal in every other test here); `null` is only reachable by
      // deliberately violating that type, which is exactly what is needed to
      // produce a root-level (`path: []`) Zod issue instead of a per-field one.
      loadConfig(null as unknown as RawEnv);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain('(config)');
  });

  // Deliberately not covered, with reasons verified empirically against the
  // real installed zod@4.4.3 (see apps/agent/src/config.ts lines 117-120 and
  // 134):
  //
  // - `loadConfig`'s `'input' in issue` check (line 118) and the
  //   `receivedSuffix` ternary that depends on it (line 120): every issue
  //   kind `ConfigSchema.safeParse` can actually produce for this schema
  //   (invalid_value/enum, too_small/string-min, invalid_type/boolean or
  //   number, invalid_format/url, a root invalid_type, and a custom/refine
  //   issue) was checked directly against this exact zod version, and none
  //   of them ever carry an `input` property on the issue object itself.
  //   `received` is therefore always `undefined`, and both the `'input' in
  //   issue` true branch and the `received !== undefined` true branch it
  //   feeds are unreachable through any real `ConfigSchema` validation
  //   failure.
  // - `parsed.SIFT_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6'` (line
  //   134): confirmed empirically that zod 4.4.3's `.default(...)` on a
  //   `z.preprocess(emptyToUndefined, z.string().optional())` schema fires
  //   even when the raw input key is present but preprocesses down to
  //   `undefined` (e.g. `SIFT_MODEL_ID: ''`), not only when the key is
  //   entirely absent. `parsed.SIFT_MODEL_ID` is therefore never `undefined`
  //   after a successful parse, so this `??`'s right-hand fallback never
  //   fires -- the field-level schema default (already exercised by the
  //   "empty-string SIFT_MODEL_ID" test above) always wins first. This is
  //   redundant-but-harmless defense-in-depth against an assumption about
  //   `.default()` timing that this real zod version does not need.
});
