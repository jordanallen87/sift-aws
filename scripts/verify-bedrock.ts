#!/usr/bin/env tsx
/**
 * `npx tsx scripts/verify-bedrock.ts` (also `pnpm verify:bedrock` if wired
 * up in `package.json`): proves the live Amazon Bedrock path actually works
 * end to end, against real AWS credentials, for anyone -- including a
 * hackathon judge -- to run themselves rather than take the claim on faith.
 *
 * Reads `SIFT_MODEL_ID`/`AWS_REGION` from the environment with EXACTLY the
 * defaults `apps/agent/src/config.ts` applies (this script imports
 * `loadConfig` itself rather than re-declaring those defaults, so the two
 * can never silently drift apart), constructs the model through the repo's
 * own `resolveModelProvider` (`apps/agent/src/runtime/model-provider.ts`)
 * -- never a Bedrock client built inline here -- sends one minimal prompt
 * through a real Strands `Agent`, and prints the model id, region, latency
 * in milliseconds, and the response text. Exits 0 on success; on failure it
 * prints the thrown error's own name/message VERBATIM and exits 1, because
 * that text is the actionable part (e.g. Bedrock's own
 * `ResourceNotFoundException: Model use case details have not been
 * submitted for this account. Fill out the Anthropic use case details form
 * before using the model.`, the exact failure that motivated
 * `SIFT_MODEL_ID`'s default change to `amazon.nova-lite-v1:0` -- see
 * `config.ts`'s `SIFT_MODEL_ID` comment).
 *
 * Never prints or logs credentials. AWS credentials are resolved entirely
 * by the AWS SDK's own default provider chain, underneath `BedrockModel`;
 * this script never reads `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/
 * `AWS_SESSION_TOKEN`/etc itself, and on failure only the caught error's
 * `name`/`message` are printed -- never the raw error object, whose AWS-SDK
 * shape can otherwise carry request metadata alongside the message.
 *
 * Opt-in and network-dependent, like `test:deployed`/`test:host`: never
 * part of `pnpm verify`/`pnpm verify:release`, both of which must run with
 * no network access.
 *
 * --- Why this file reaches `@strands-agents/sdk` the way it does ---
 *
 * `@strands-agents/sdk` is a dependency of `apps/agent` only (its own
 * `package.json`), not of the repo root, and this script deliberately adds
 * no new dependency. A plain `import ... from '@strands-agents/sdk'`
 * written in THIS file would fail to resolve at both typecheck and runtime:
 * Node/TypeScript resolve a bare specifier relative to the IMPORTING file's
 * own location, walking `scripts/node_modules` then `<repo root>/
 * node_modules` -- and neither holds this package in this pnpm-isolated
 * install (verified directly: `createRequire('<repo root>/scripts/...')
 * .resolve('@strands-agents/sdk')` throws `MODULE_NOT_FOUND`, while the
 * identical call rooted at `apps/agent/package.json` succeeds). `loadConfig`
 * and `resolveModelProvider` below are imported by their real relative path
 * into `apps/agent/src` instead, which resolves fine because THEIR OWN
 * imports of the SDK resolve from THEIR location
 * (`apps/agent/node_modules/@strands-agents/sdk` exists). The one thing
 * this script still needs directly from the SDK -- a Strands `Agent` to
 * drive one real turn -- is loaded with `createRequire` rooted at
 * `apps/agent/package.json` (so Node's resolver walks up from THERE, not
 * from `scripts/`), then dynamically imported by the resolved absolute
 * path. Only the tiny slice of `Agent`'s real, documented public surface
 * this script actually drives is typed, locally, right below --
 * `invoke(prompt: string)` accepting a plain string is `Agent`'s own
 * documented behavior (its `InvokeArgs` doc comment: "string - User text
 * input (wrapped in TextBlock, creates user Message)"), and `AgentResult`
 * (the real return type) documents its own `toString()` as returning the
 * response text.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../apps/agent/src/config.js';
import { resolveModelProvider } from '../apps/agent/src/runtime/model-provider.js';

/** The minimal slice of Strands `AgentResult`'s real public surface this script reads. */
interface MinimalAgentResult {
  toString(): string;
}

/** The minimal slice of Strands `Agent`'s real public surface this script drives -- see this file's header. */
interface MinimalAgent {
  invoke(prompt: string): Promise<MinimalAgentResult>;
}

/** The minimal slice of Strands `AgentConfig` this script needs -- every field here is a real, documented `AgentConfig` field (see `apps/agent/src/runtime/bid-document-reader.ts`'s own `new Agent({...})` for the identical construction pattern). */
interface MinimalAgentConfig {
  id: string;
  name: string;
  model: ReturnType<typeof resolveModelProvider>;
  printer: boolean;
  systemPrompt: string;
}

type MinimalAgentConstructor = new (config: MinimalAgentConfig) => MinimalAgent;

const PROMPT = 'Reply with exactly one short sentence confirming you received this message.';

/** Resolves and dynamically imports `@strands-agents/sdk` from `apps/agent`'s own install, rooted there rather than at this script's own (non-resolving) location -- see this file's header. */
async function loadAgentConstructor(): Promise<MinimalAgentConstructor> {
  const requireFromAgent = createRequire(new URL('../apps/agent/package.json', import.meta.url));
  const entryPath = requireFromAgent.resolve('@strands-agents/sdk');
  const sdkModule = (await import(pathToFileURL(entryPath).href)) as {
    Agent: MinimalAgentConstructor;
  };
  return sdkModule.Agent;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { modelId, awsRegion } = config;

  console.log(`[sift] verify:bedrock: modelId=${modelId} region=${awsRegion}`);

  const model = resolveModelProvider({ modelId, awsRegion });
  const Agent = await loadAgentConstructor();
  const agent = new Agent({
    id: 'verify-bedrock',
    name: 'verify-bedrock',
    model,
    printer: false,
    systemPrompt: 'You are a connectivity check for Amazon Bedrock. Respond briefly.',
  });

  const startedAt = Date.now();
  try {
    const result = await agent.invoke(PROMPT);
    const latencyMs = Date.now() - startedAt;
    console.log(
      `[sift] verify:bedrock OK -- modelId=${modelId} region=${awsRegion} latencyMs=${latencyMs}`,
    );
    console.log(`[sift] response: ${result.toString()}`);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    console.error(
      `[sift] verify:bedrock FAILED after ${latencyMs}ms -- modelId=${modelId} region=${awsRegion}`,
    );
    // Printed verbatim, on purpose: the error's own name/message IS the
    // actionable part (e.g. Bedrock's ResourceNotFoundException use-case-
    // form message). Never the raw error object -- see this file's header.
    if (error instanceof Error) {
      console.error(`${error.name}: ${error.message}`);
    } else {
      console.error(String(error));
    }
    process.exitCode = 1;
    return;
  }
}

main().catch((error: unknown) => {
  console.error('[sift] verify:bedrock: crashed unexpectedly:');
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
