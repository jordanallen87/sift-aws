/**
 * Zod-validated Sift service configuration loader.
 *
 * Reads the `SIFT_*`/`AWS_*` environment variables documented in the repo
 * root `.env.example` (`SIFT_EXECUTION_TARGET`, `SIFT_DATA_DIR`,
 * `SIFT_AUTHORING_ENABLED`, `SIFT_DEBUG_ENABLED`, `SIFT_TRACING_ENABLED`,
 * `SIFT_DEBUG_PAYLOAD_MODE`, `SIFT_DEBUG_RETENTION_DAYS`, `SIFT_MODEL_ID`,
 * `AWS_REGION`, `SIFT_PUBLIC_ORIGIN`, `SIFT_DEMO_PACING_MS`,
 * `SIFT_BID_DOCUMENT_READER_ENABLED`), applies exactly the defaults shown
 * there, and throws one `ConfigError` listing every invalid/missing
 * variable at once.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT`/`OTEL_EXPORTER_OTLP_HEADERS` are documented
 * in `.env.example` as an optional passthrough to Strands's own OTEL setup
 * ("enables an external OTEL exporter without changing Sift's own
 * SQLite-backed event persistence") and are deliberately still not
 * validated here: they are standard OpenTelemetry variable names with an
 * OTEL-defined meaning, read by `@opentelemetry/exporter-trace-otlp-http`'s
 * own `OTLPTraceExporter` rather than by Sift, and `runtime/
 * otel-span-recorder.ts` only checks whether `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is set at all in order to decide whether to attach that exporter. Sift
 * never reinterprets or re-defaults them.
 *
 * `PORT` (used by `server.ts` to choose a listen port) is deliberately not
 * part of this schema: it is not documented in `.env.example` as
 * Sift-specific configuration and is instead a standard Node/Railway
 * server-bootstrapping convention (Railway injects `PORT` automatically),
 * handled directly in `server.ts`.
 *
 * Zod is imported the same way `@sift/contracts` does (`import { z } from
 * 'zod'`), pinned to the same `^4.4.3` already installed for that package
 * (see `apps/agent/package.json`).
 */
import { z } from 'zod';

export const EXECUTION_TARGETS = ['local', 'agentcore'] as const;
export type ExecutionTarget = (typeof EXECUTION_TARGETS)[number];

export const DEBUG_PAYLOAD_MODES = ['fixture-full', 'metadata-only'] as const;
export type DebugPayloadMode = (typeof DEBUG_PAYLOAD_MODES)[number];

/** Raw environment shape this loader reads (a subset of `process.env`). */
export interface RawEnv {
  SIFT_EXECUTION_TARGET?: string | undefined;
  SIFT_DATA_DIR?: string | undefined;
  SIFT_AUTHORING_ENABLED?: string | undefined;
  SIFT_DEBUG_ENABLED?: string | undefined;
  SIFT_TRACING_ENABLED?: string | undefined;
  SIFT_DEBUG_PAYLOAD_MODE?: string | undefined;
  SIFT_DEBUG_RETENTION_DAYS?: string | undefined;
  SIFT_MODEL_ID?: string | undefined;
  AWS_REGION?: string | undefined;
  SIFT_PUBLIC_ORIGIN?: string | undefined;
  SIFT_BID_DOCUMENT_READER_ENABLED?: string | undefined;
}

export interface SiftConfig {
  executionTarget: ExecutionTarget;
  dataDir: string;
  authoringEnabled: boolean;
  debugEnabled: boolean;
  /**
   * Registers Sift's OpenTelemetry `TracerProvider` at boot so the spans the
   * Strands SDK already emits (`dist/src/telemetry/tracer.js`, called from
   * `multiagent/graph.js` and `swarm.js` on every run) are captured into
   * `runtime_events` instead of discarded (`runtime/otel-span-recorder.ts`).
   *
   * Defaults to `true`: capture is entirely in-process and adds no network
   * dependency, so a fixture run stays fully offline. Set `false` to leave
   * the global OTel API unregistered, which is exactly the pre-existing
   * behavior -- every Strands span is created and immediately discarded, and
   * nothing else changes.
   */
  tracingEnabled: boolean;
  debugPayloadMode: DebugPayloadMode;
  /** Days of runtime/debug telemetry retained. 1-30 inclusive; docs/specs/debugging-and-observability.md: "cannot exceed 30 in this build." */
  debugRetentionDays: number;
  modelId: string;
  awsRegion: string;
  /** Milliseconds to pace each scripted model turn for a demo recording. 0 = no added latency (the default everywhere except a deliberate recording session). */
  demoPacingMs: number;
  /** Same-origin (undefined/unset) unless a separate deployed origin is introduced. */
  publicOrigin?: string;
  /**
   * Enables `POST /api/cases/:caseId/bid-documents/read`
   * (`routes/bid-documents.ts`): reading a bid PDF's browser-extracted
   * prose text layer with a real model (`SIFT_MODEL_ID`/`AWS_REGION`) BEFORE
   * handing it to the synchronous, deterministic `submitBidDocument`
   * command (`runtime/bid-document-reader.ts`'s header explains why that
   * model step cannot live inside the command layer at all).
   *
   * Defaults to `false` and MUST stay `false` for the complete local demo:
   * docs/specs/architecture.md requires that demo to run with no network
   * and no AWS credentials, and this is the one route in this service that
   * would otherwise make a real, network-dependent Bedrock call. `server.ts`
   * only constructs the model (`resolveModelProvider`/`createBedrockModel`,
   * `runtime/model-provider.ts`) when this is `true`; when `false`, the
   * route is still mounted but always answers a clear, actionable refusal
   * instead of ever attempting a model call -- reading a PDF needs a model
   * this deployment does not have configured, and importing the bid as
   * JSON/CSV or typing its values in directly both still work.
   */
  bidDocumentReaderEnabled: boolean;
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid Sift configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** `''` and `undefined` both mean "not set" for optional string env vars. */
function emptyToUndefined(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

/** Parses a `'true'`/`'false'` env string; any other non-empty value fails validation instead of silently coercing. */
const booleanFromEnvString = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // left as-is (a non-boolean string) so z.boolean() reports a clear failure
}, z.boolean());

const integerFromEnvString = (min: number, max: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value; // non-numeric strings fail z.number() cleanly
  }, z.number().int().min(min).max(max));

const ConfigSchema = z.object({
  SIFT_EXECUTION_TARGET: z.enum(EXECUTION_TARGETS).default('local'),
  SIFT_DATA_DIR: z.string().min(1, 'must not be empty').default('.sift-data'),
  SIFT_AUTHORING_ENABLED: booleanFromEnvString.default(false),
  SIFT_DEBUG_ENABLED: booleanFromEnvString.default(true),
  SIFT_TRACING_ENABLED: booleanFromEnvString.default(true),
  SIFT_DEBUG_PAYLOAD_MODE: z.enum(DEBUG_PAYLOAD_MODES).default('metadata-only'),
  // debugging-and-observability.md: "SIFT_DEBUG_RETENTION_DAYS defaults to 7
  // and cannot exceed 30 in this build." The spec states only the ceiling;
  // a floor of 1 is this loader's own judgment call (a non-positive
  // retention window is not a meaningful configuration).
  SIFT_DEBUG_RETENTION_DAYS: integerFromEnvString(1, 30).default(7),
  // Default changed 2026-09-14 from `global.anthropic.claude-sonnet-4-6` to
  // Amazon's own `amazon.nova-lite-v1:0` (Amazon Nova Lite). The Anthropic
  // default does NOT work on this account: Bedrock rejects it with
  // `ResourceNotFoundException: Model use case details have not been
  // submitted for this account. Fill out the Anthropic use case details
  // form before using the model.` -- a per-provider gate Amazon's own model
  // family has no equivalent of. Nova Lite was verified working end to end
  // that same day (a bid document's text in, a real option created on the
  // case with `origin: 'agent_proposed'`, HTTP 200 in 2.5s) and costs less
  // than the model it replaced. `amazon.nova-micro-v1:0` also works and is
  // cheaper still, but it is text-only and lower quality for the structured
  // extraction `bid-document-reader.ts` needs, so Nova Lite is the default,
  // not Nova Micro. Run `npx tsx scripts/verify-bedrock.ts` to prove
  // whatever model/region this resolves to actually works against live
  // Bedrock, with real AWS credentials.
  SIFT_MODEL_ID: z
    .preprocess(emptyToUndefined, z.string().min(1).optional())
    .default('amazon.nova-lite-v1:0'),
  AWS_REGION: z.string().min(1, 'must not be empty').default('us-east-1'),
  // Demo pacing: milliseconds to wait before each scripted model turn.
  // 0 (the default, and what every test and gate uses) means no added
  // latency. See `ScriptedModelProvider.turnDelayMs` for why this exists:
  // a scripted turn has no inference to wait for, so a full run collapses
  // into ~1s and cannot be watched. Capped at 2000ms per turn so a
  // misconfiguration cannot hang a run indefinitely.
  SIFT_DEMO_PACING_MS: integerFromEnvString(0, 2000).default(0),
  SIFT_PUBLIC_ORIGIN: z.preprocess(emptyToUndefined, z.url().optional()),
  // Opt-in only -- see `SiftConfig.bidDocumentReaderEnabled`'s own doc
  // comment for why this must default to `false`.
  SIFT_BID_DOCUMENT_READER_ENABLED: booleanFromEnvString.default(false),
});

/**
 * Loads and validates Sift service configuration from a raw env-like object
 * (defaults to `process.env`). Accepts an explicit `env` argument so tests
 * never need to mutate global `process.env` state.
 */
export function loadConfig(env: RawEnv = process.env): SiftConfig {
  const result = ConfigSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(config)';
      const received = 'input' in issue ? String((issue as { input?: unknown }).input) : undefined;
      const receivedSuffix =
        received !== undefined ? ` (received: ${JSON.stringify(received)})` : '';
      return `${path}: ${issue.message}${receivedSuffix}`;
    });
    throw new ConfigError(issues);
  }

  const parsed = result.data;
  const config: SiftConfig = {
    executionTarget: parsed.SIFT_EXECUTION_TARGET,
    dataDir: parsed.SIFT_DATA_DIR,
    authoringEnabled: parsed.SIFT_AUTHORING_ENABLED,
    debugEnabled: parsed.SIFT_DEBUG_ENABLED,
    tracingEnabled: parsed.SIFT_TRACING_ENABLED,
    debugPayloadMode: parsed.SIFT_DEBUG_PAYLOAD_MODE,
    debugRetentionDays: parsed.SIFT_DEBUG_RETENTION_DAYS,
    modelId: parsed.SIFT_MODEL_ID ?? 'amazon.nova-lite-v1:0',
    awsRegion: parsed.AWS_REGION,
    demoPacingMs: parsed.SIFT_DEMO_PACING_MS,
    bidDocumentReaderEnabled: parsed.SIFT_BID_DOCUMENT_READER_ENABLED,
  };
  if (parsed.SIFT_PUBLIC_ORIGIN !== undefined) {
    config.publicOrigin = parsed.SIFT_PUBLIC_ORIGIN;
  }
  return config;
}
