# AWS Platform Research: Bedrock AgentCore for Sift

Research date: 2026-09-07. Scope: answer six questions about Amazon Bedrock AgentCore, Bedrock inference, Bedrock Knowledge Bases, and the "Agents for Humans" hackathon (deadline 2026-09-14), specifically as they apply to Sift — a TypeScript monorepo on `@strands-agents/sdk@^1.14.0` (repo pin; npm latest is `1.16.0` as of this research — [npmjs.com/package/@strands-agents/sdk](https://www.npmjs.com/package/%40strands-agents%2Fsdk)), Express 5, port 8080, currently SCRIPTED-model-only in production, with `GET /ping` / `POST /invocations` already implemented at `apps/agent/src/routes/agentcore.ts`.

All sources are 2026-dated unless explicitly marked otherwise. No source older than 12 months was relied on for a load-bearing claim; where an older source appears it is flagged.

---

## 1. Amazon Bedrock AgentCore — what it is, components, Runtime contract, TypeScript support, cost

### 1.1 What it is

Amazon Bedrock AgentCore is "an agentic platform for building, deploying, and operating highly effective agents securely at scale using any framework and foundation model" — it composes with any open-source agent framework (CrewAI, LangGraph, LlamaIndex, **Strands Agents**) and any foundation model, not just Bedrock's. ([AWS AgentCore Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html))

### 1.2 Components (as of this research)

| Component | What it does | Source |
|---|---|---|
| **Runtime** | Secure, serverless hosting for agent code — session-isolated microVMs per session, HTTP/WebSocket, 100MB payloads, built-in auth (SigV4/OAuth). | [Host agent with AgentCore Runtime](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html) |
| **Memory** | Managed short-term (event-sourced conversation turns) and long-term (extracted/consolidated records: semantic, summary, user-preference, episodic) memory. | [AgentCore Memory overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html); [MEMORY.md](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/docs/MEMORY.md) |
| **Gateway** | Turns APIs/Lambdas into MCP-compatible tools agents can discover and call; semantic tool search. | [AWS AgentCore Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) |
| **Identity** | Agent identity/auth, integrates with Cognito/Okta/Entra ID/Auth0; outbound OAuth/API-key flows to third-party services. | Same |
| **Observability** | Unified OTEL-based tracing/debugging/monitoring via CloudWatch GenAI Observability dashboards. | Same |
| **Code Interpreter** | Isolated sandbox for agent-executed code (Python, JS/TS, others). | Same |
| **Browser** | Managed, cloud-hosted Chrome the agent drives via Playwright/CDP. | [AgentCore Browser](https://clawaws.com/blog/amazon-bedrock-agentcore-browser-managed-cloud-browser-ai) (third-party summary; component existence corroborated by the official overview doc above) |
| **Policy** | Deterministic, Cedar-based (or natural-language-authored) authorization gate in front of every Gateway tool call — e.g., cap a refund tool at $100 without trusting the system prompt. | [PwC AgentCore guide](https://www.pwc.com/us/en/technology/alliances/library/amazon-bedrock-agentcore-hands-on-guide.html) |
| **Registry** | Catalog for discovering/publishing agents, MCP servers, tools, skills across an org. | [AWS AgentCore Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) |
| **Evaluations** | Batch quality evaluation of agent runs; billed per input/output token. | [AWS AgentCore Pricing](https://aws.amazon.com/bedrock/agentcore/pricing) |
| **Harness** (newer) | A managed, config-only agent loop (model + system prompt + tools, no orchestration code) running in an isolated microVM; distinct from bringing your own framework via Runtime. | [AWS AgentCore Overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) |
| **Optimization / Payments** (preview/newer) | Cost-recommendation and agent-initiated micropayment (Coinbase CDP/Stripe Privy wallets) services. | [Cloud Burn: AgentCore pricing](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing) |

Sift is a Runtime + (optionally) Memory + Observability consumer; Gateway/Policy/Browser/Payments are not relevant to the current scope.

### 1.3 Runtime deployment contract (container path)

Verified directly against the official HTTP protocol contract and the official TypeScript deployment guide, both dated to the current docs tree:

- **Host**: `0.0.0.0`. **Port**: `8080`. **Platform**: `linux/arm64` — **ARM64 is mandatory**, not optional. AgentCore validates ELF headers of any native (`.node`/`.so`) binaries in the image/package and fails `CREATE_FAILED` if they're not arm64. ([HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html); [Direct code deployment for Node.js](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html))
- **`GET /ping`**: returns `200` with `Content-Type: application/json` and `{"status": "Healthy" | "HealthyBusy"}`. `HealthyBusy` tells Runtime a background task is active and keeps the session alive. Sift's existing implementation and the spec comment in `apps/agent/src/routes/agentcore.ts` already correctly note the AWS guidance to **not** set `time_of_last_update` on every ping (it would prevent the idle-session timeout from ever firing) — this is a real, documented AWS caveat, not an invented one. ([HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html))
- **`POST /invocations`**: JSON (or SSE) request/response; AWS's own docs say the body schema beyond `Content-Type: application/json` is the agent's business logic to define — the `{"prompt": "..."}` shape shown in examples is a convention, not a mandate. Both HTTP and WebSocket (`/ws`) can share port 8080 for bidirectional streaming. ([HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html))
- **Session routing**: pass the same header value across a multi-turn conversation to keep routing to the same microVM. The header name is **protocol-dependent**: `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` for HTTP/A2A/AG-UI, `Mcp-Session-Id` for MCP. ([Use isolated sessions for agents](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html)) When invoking via the AWS SDK's `InvokeAgentRuntimeCommand`, this is the `runtimeSessionId` field, not a raw header. ([TypeScript deployment guide](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript))
- **Default idle session timeout**: 15 minutes (`IdleRuntimeSessionTimeout`, configurable). ([Direct code deployment for Node.js](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html); [Cloud Burn pricing](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing))
- **Deployment mechanics (container path)**: build an arm64 Docker image → push to ECR → `aws bedrock-agentcore-control create-agent-runtime --agent-runtime-artifact containerConfiguration={containerUri=...} --role-arn ... --network-configuration networkMode=PUBLIC --protocol-configuration serverProtocol=HTTP`. Update with `update-agent-runtime`. ([TypeScript deployment guide](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript))

### 1.4 A second, newer path: direct code deployment (no Docker)

As of an April 2026 AWS "what's new" post, AgentCore Runtime added **Node.js direct code deployment**: zip your compiled JS + `node_modules` (or an esbuild-bundled single file), upload to S3, `CreateAgentRuntime` with `entryPoint: ["dist/app.js"]` — no container image, no ECR. Same `/ping`+`/invocations` HTTP contract, same arm64 requirement (native modules must be arm64-compiled; most pure-JS packages like Express are unaffected), same session isolation/auth/streaming/observability. TypeScript is **not** run natively — you must `tsc` or `esbuild` to `.js` first, and entry points must be `.js`. Zip limits: 250MB zipped / 750MB unzipped. ([Node.js support launch](https://aws.amazon.com/about-aws/whats-new/2026/04/amazon-bedrock-agentcore-runtime); [Direct code deployment for Node.js](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html))

For Sift's existing Docker/Railway posture, the **container path is the natural fit** — the same image already targets Railway; direct code deployment would be a second packaging pipeline for marginal benefit under hackathon time pressure.

### 1.5 TypeScript + Strands support: officially supported, with an official example

**Confirmed, not inferred**: Strands' own docs publish a first-class, current **TypeScript Deployment to Amazon Bedrock AgentCore Runtime** guide using Express + Docker — this *is* the official TypeScript example. ([strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript)) It walks: project scaffold → `strands.Agent` + `strands.BedrockModel` + Express `/ping`/`/invocations` → Dockerfile (arm64 base image) → IAM role script → ECR push → `create-agent-runtime` → a TypeScript `invoke.ts` test script using `@aws-sdk/client-bedrock-agentcore`'s `InvokeAgentRuntimeCommand`.

There is also an **official AWS TypeScript SDK for AgentCore itself** — `bedrock-agentcore` on npm (`aws/bedrock-agentcore-sdk-typescript` on GitHub) — providing `BedrockAgentCoreApp` (a framework-agnostic Runtime-compliant server: request parsing, streaming, session handling) plus `CodeInterpreterTools`/`PlaywrightBrowser` helpers with built-in Strands Agents and Vercel AI SDK integrations. Minimal example:

```ts
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime'
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'

const agent = new Agent({ model: new BedrockModel({ modelId: 'global.amazon.nova-2-lite-v1:0' }) })
const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ prompt: z.string() }),
    process: async function* (request) {
      for await (const event of agent.stream(request.prompt)) {
        if (event.type === 'modelContentBlockDeltaEvent' && event.delta?.type === 'textDelta') {
          yield { event: 'message', data: { text: event.delta.text } }
        }
      }
    },
  },
})
app.run()
```
([aws/bedrock-agentcore-sdk-typescript README](https://github.com/aws/bedrock-agentcore-sdk-typescript))

There is also an official **AgentCore CLI** (`npm install -g @aws/agentcore`) that scaffolds a TypeScript+Strands project (`agentcore create` → choose TypeScript / Strands / CodeZip), tests locally, and deploys via CDK under the hood. It requires the AWS CDK to be installed. ([Get started with the AgentCore CLI in TypeScript](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html))

**Bottom line for question 1's "Python-only?" concern**: No — TypeScript/Strands is officially, currently supported on AgentCore Runtime via at least three paths (raw container + Express per the Strands guide, the `bedrock-agentcore` npm SDK's `BedrockAgentCoreApp`, and Node.js direct code deployment). Sift's existing hand-rolled `/ping`/`/invocations` Express routes already match the first path's documented contract closely (confirmed by reading `apps/agent/src/routes/agentcore.ts`, which cites both the Strands TS guide and the AWS HTTP contract doc directly in its own comments).

### 1.6 Cost / free tier for a hackathon

There is **no AgentCore-specific free tier** beyond the general new-account AWS credit. As of the current (post-July 2025) signup flow, new accounts get **$100 credit immediately, up to $100 more via onboarding tasks (one of which is literally "test a prompt in Amazon Bedrock"), for $200 max**, expiring 6 months / account-credit-exhaustion, whichever is first. ([Rackspace: AWS Free Tier Explained 2026](https://spot.rackspace.com/blog/aws-free-tier); [Tech Insider AU: AWS Free Tier 2026](https://tech-insider.org/au/what-changed-in-the-aws-free-tier-for-2026)) Agent Registry has a component-level free allotment (5,000 records, 1M search calls, 2M list/get calls/month); other components (Runtime, Gateway, Memory, Policy, Evaluations) do not. ([Cloud Burn: AgentCore Pricing](https://cloudburn.io/blog/amazon-bedrock-agentcore-pricing))

**Published AgentCore Runtime rates** (official AWS pricing page): $0.0895/vCPU-hour + $0.00945/GB-hour, billed per-second, active-compute only (I/O-wait time is not billed as CPU). ([aws.amazon.com/bedrock/agentcore/pricing](https://aws.amazon.com/bedrock/agentcore/pricing)) For hackathon-scale usage (a handful of demo invocations, sessions lasting seconds to low minutes), this is **effectively cents**, not dollars — e.g., AWS's own worked example puts a 10-minute, 2-vCPU/4GB session at ~$0.012. Model inference tokens are billed separately under standard Bedrock pricing (§3 below) and are the dominant real cost for a demo.

**Hackathon-specific credit**: the Agents for Humans Devpost resources page states registered participants can request **$50 in AWS Promotional Credits** (request deadline **2026-09-11 12pm PT** — 3 days before the hackathon deadline, so request immediately if pursuing AgentCore). ([agentsforhumans.devpost.com/resources](https://agentsforhumans.devpost.com/resources))

---

## 2. AgentCore Memory

### 2.1 What it is and the two-tier model

AgentCore Memory is **event-sourced with two tiers**:

1. **Short-term memory (events)**: `createEvent` records each role-tagged conversational turn, scoped to `(actorId, sessionId)`. Retention configurable up to 365 days (a walkthrough example sets 7). ([MEMORY.md](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/docs/MEMORY.md); [AgentCore short-term memory walkthrough](https://dev.to/aws-heroes/amazon-bedrock-agentcore-runtime-part-6-using-agentcore-short-term-memory-with-strands-agents-sdk-55d4))
2. **Long-term memory (records)**: configured **strategies** (semantic, summary, user-preference, episodic) **asynchronously** extract and consolidate short-term events into namespaced, retrievable long-term records — no client-side LLM pass required. ([MEMORY.md](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/docs/MEMORY.md); [AgentCore long-term memory walkthrough](https://dev.to/aws-heroes/amazon-bedrock-agentcore-runtime-part-7-using-agentcore-long-term-memory-with-strands-agents-sdk-lb2))

**Important consistency caveat, directly relevant to any deterministic-test claims**: a fact written this turn may **not** be retrievable next turn until server-side extraction finishes — this is genuinely eventually-consistent, asynchronous, not instant. `MemoryManager.flush()` drains in-flight writes but does **not** wait for extraction. ([MEMORY.md](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/docs/MEMORY.md)) This directly matters for Sift's "deterministic core" mandate: AgentCore long-term Memory cannot be used as a source of truth for case state in a deterministic test — it is a genuinely async, best-effort recall layer suited only for narrative/context enrichment, never for anything CLAUDE.md's "deterministic core owns case state" rule would need same-turn.

### 2.2 TypeScript SDK access — two separate integration surfaces

1. **`agentcore-memory` npm package** — a **Strands session manager** integration (`aws` org, listed as an official Strands integration: "Amazon Bedrock AgentCore Memory session manager providing short-term conversation persistence and long-term memory strategies for Strands Agents"). This is the drop-in path if Sift wanted AgentCore Memory to *replace* Strands' own session/snapshot persistence — but note CLAUDE.md already mandates SQLite/Drizzle as the canonical Sift store, so this would only be additive context, never a persistence replacement. ([strandsagents.com/integrations](https://strandsagents.com/integrations))
2. **Direct `MemoryManager` + `BedrockKnowledgeBaseStore`-style vended memory store** — not applicable here; AgentCore Memory's TS integration point is the session-manager package above, distinct from the `vended-memory-stores/bedrock-knowledge-base` module covered in §4.

A GitHub issue on `strands-agents/harness-sdk` shows an **`AgentCoreMemorySessionManager`** feature request/design pattern was already tracked for Strands' session management, confirming the intended shape: `session_manager = AgentCoreMemorySessionManager({ sessionId, actorId, memoryId, region, loadLongTermMemories, shortTermRetentionDays, longTermRetentionDays })`, then `new Agent({ session_manager })`. ([Issue #486](https://github.com/strands-agents/harness-sdk/issues/486)) This example is shown in Python-flavored pseudocode in the issue; the TypeScript-idiomatic shape would follow the SDK's usual camelCase config pattern, but **could not verify the exact TypeScript constructor signature** from primary docs in this pass — treat as "exists and is named `agentcore-memory` on the Strands integrations page," not as a verified API contract, before using it in code.

### 2.3 IAM/testing cost of AgentCore Memory (relevant to CLAUDE.md's "no network calls in `pnpm verify`" rule)

The official TS SDK's own integration/E2E test suite documents that a real round-trip test **creates a throwaway memory resource, writes, polls for async extraction, then deletes it** — a multi-minute test requiring live AWS credentials (`bedrock-agentcore-control:{Create,Get,Delete}Memory`, `bedrock-agentcore:{CreateEvent,RetrieveMemoryRecords}`, `bedrock:InvokeModel`). ([MEMORY.md](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/docs/MEMORY.md)) This confirms AgentCore Memory is **fundamentally not fixture-mode-compatible** — it cannot be part of Sift's deterministic `pnpm verify` gate (which must run with no network access), only an additive, credentials-gated live check, exactly as CLAUDE.md's "Live model and deployed checks are additive" rule anticipates.

### 2.4 vs. Bedrock Knowledge Bases

AgentCore Memory is a **conversation-turn-shaped** memory system (events → extracted records, scoped by actor/session, retrieved via `retrieveMemoryRecords`) purpose-built for "what has this user told the agent." Bedrock Knowledge Bases (§4) is a **document-corpus-shaped** RAG system (chunk/embed/index arbitrary documents, retrieved via semantic search over a vector store) purpose-built for "what do our source documents say." One AWS engineering blog frames retrieving AgentCore memories as itself a form of RAG ("we're essentially doing RAG… just applied to conversation memories rather than documents") — the mechanism (embed, retrieve-by-similarity, inject into context) is the same; the corpus and intended use differ. ([Building Production-Ready AI Agents with Strands and AgentCore](https://dev.to/aws/building-production-ready-ai-agents-with-strands-agents-and-amazon-bedrock-agentcore-3dg0)) For Sift's actual need — contractor bid *documents* — Knowledge Bases is the right primitive, not Memory.

---

## 3. Bedrock inference

### 3.1 Models available (2026)

| Model | Input / Output per 1M tokens (Standard, most regions) | Notes |
|---|---|---|
| Amazon Nova Micro | $0.035 / $0.14 | Cheapest; classification/routing |
| Amazon Nova Lite | $0.06 / $0.24 | Multimodal, low cost |
| Amazon Nova Pro | $0.80 / $3.20 | Balanced Amazon-native |
| Amazon Nova Premier | $2.50 / $12.50 | Amazon flagship, 1M context |
| Claude Haiku 4.5 | $1.00 / $5.00 | Fast/cheap |
| Claude Sonnet 4.6 | $3.00 / $15.00 | Widely deployed production default |
| **Claude Sonnet 5** | **$2 / $10 through 2026-08-31 (promo), then $3 / $15** | Newest balanced Claude; Strands TS SDK's current default model in its quickstart examples |
| Claude Opus 4.8 | $5.00 / $25.00 | Deep reasoning, "hundreds of parallel subagents" mode |
| Claude Fable 5 | $10 / $50 (was briefly export-control-suspended, redeployed 2026-07-01) | Most expensive frontier option |

Sources: [cloudzero.com/blog/amazon-bedrock-pricing](https://www.cloudzero.com/blog/amazon-bedrock-pricing); [cloudforecast.io/blog/aws-bedrock-pricing](https://www.cloudforecast.io/blog/aws-bedrock-pricing); [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing) (official page, confirms Claude 3.5 Sonnet legacy-tier rates directly but the live model-by-model table requires a region selection in-console — the third-party aggregator tables above are consistent with each other and with the official page's methodology and are dated within the last 2 months of this research). **Cross-region inference adds ~10%** where used (see §3.3). Batch inference is ~50% off; prompt caching up to ~90% off cached input reads. ([pecollective.com/tools/aws-bedrock-pricing](https://pecollective.com/tools/aws-bedrock-pricing))

**Recommendation for Sift's two demo packs**: **Claude Sonnet 4.6** (or Sonnet 5 at promo pricing through 2026-08-31 — note that promo window has already lapsed relative to today's 2026-09-07 date, so Sonnet 5 is now $3/$15, same as 4.6) is the sensible default — it's the SDK's documented default in the TypeScript quickstart ("agents use the Amazon Bedrock model provider with Claude Sonnet 4.6" — [TypeScript Quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript)) and inexpensive enough that a full demo run (a handful of turns × a few thousand tokens each) costs low single-digit cents.

### 3.2 `BedrockModel` configuration (TypeScript SDK)

Confirmed from the official API reference and the official model-provider doc, and cross-checked against the version already in Sift's codebase (`apps/agent/src/runtime/model-provider.ts`, which already does exactly this):

```ts
import { BedrockModel } from '@strands-agents/sdk/models/bedrock'

const provider = new BedrockModel({
  region: 'us-west-2',
  modelId: 'global.anthropic.claude-sonnet-4-6', // or a specific dated id / inference-profile id
  maxTokens: 2048,
  temperature: 0.8,
  cacheConfig: { strategy: 'auto' }, // prompt/tool caching
  clientConfig: {
    credentials: { accessKeyId, secretAccessKey, sessionToken }, // optional; else default provider chain
    requestHandler: { requestTimeout: 60_000 }, // TS SDK defaults to 120_000ms; override to avoid a hung connection
  },
})
```
([BedrockModel API reference](https://strandsagents.com/latest/documentation/docs/api-reference/typescript/classes/BedrockModel.html); [Amazon Bedrock model-provider guide](https://strandsagents.com/docs/user-guide/concepts/model-providers/amazon-bedrock))

Credentials resolve via the standard AWS SDK v3 chain: env vars (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`), `~/.aws/credentials` (`aws configure`), IAM role (EC2/ECS/Lambda/AgentCore Runtime's execution role), or a Bedrock API key via `AWS_BEARER_TOKEN_BEDROCK`. ([TypeScript Quickstart](https://strandsagents.com/docs/user-guide/quickstart/typescript)) Sift's `createBedrockModel(options)` in `model-provider.ts` already wires `modelId`/`region` from `SIFT_MODEL_ID`/`AWS_REGION` config — confirmed correct against this contract; it is scaffolded but explicitly noted in-code as "not wired into any [production path] — never used by a deterministic test," matching CLAUDE.md's "SCRIPTED model provider for every run" fact.

### 3.3 IAM policy

Minimum policy for direct on-demand invocation (no inference profile):

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
  "Resource": ["arn:aws:bedrock:*::foundation-model/*"]
}
```
This is exactly what the official Strands TypeScript AgentCore deployment guide's IAM-role script grants (`BedrockModelAccess` statement). ([TypeScript deployment guide](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript)) The `BedrockAgentCoreRuntimeIdentityServiceRolePolicy` and `BedrockAgentCoreFullAccess` AWS-managed policies additionally grant `bedrock:InvokeModel`/`InvokeModelWithResponseStream` for AgentCore's own use (evaluations, memory extraction). ([AWS managed policies for AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/security-iam-awsmanpol.html))

### 3.4 Cross-region inference profiles — when required

**Newer Claude/Nova models on Bedrock require an inference-profile ID, not the bare model ID, for on-demand throughput** — calling a bare model ID like `anthropic.claude-sonnet-4-6-v1:0` directly returns `ValidationException: model identifier is invalid` / "on-demand throughput isn't supported" for these families. You must pass a profile ID/ARN (e.g. a `global.` or `us.`-prefixed id, as already used correctly in Sift's own `model-provider.ts` and the Strands docs examples) instead of the bare model ARN. ([Configuring Claude Code with Bedrock — real troubleshooting writeup](https://aws.plainenglish.io/configuring-claude-code-extension-with-aws-bedrock-and-how-you-can-avoid-my-mistakes-090dbed5215b); [Cross-Region Inference Profile Required for Claude on Bedrock](https://zenn.dev/hknote/articles/bedrock-haiku-inference-profile?locale=en)) When using a profile that spans regions, your IAM policy's `Resource` must grant `bedrock:InvokeModel` for **both** the inference-profile ARN **and** the foundation-model ARN in every destination region the profile covers, not just the calling region. ([zenn.dev, IAM Pitfall section](https://zenn.dev/hknote/articles/bedrock-haiku-inference-profile?locale=en)) Using the wildcard `Resource: ["arn:aws:bedrock:*::foundation-model/*", "arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:*"]` pattern from the Strands IAM script (§3.3) already satisfies this by being broad across regions — good for a hackathon, not least-privilege for production. Cross-region routing also carries a **~10% price premium** over pure single-region pricing where a geographic/regional endpoint is chosen over the global default. ([cloudzero.com/blog/amazon-bedrock-pricing](https://www.cloudzero.com/blog/amazon-bedrock-pricing))

**Model access note**: as of an October 2025 change, Bedrock **auto-enables** all serverless foundation models by default in commercial regions — the old manual "Model access" console page is retired for most providers. **Anthropic models remain the one exception**: they still require a one-time usage-terms form submission (via API or console) before first invoke, even though they show as "enabled." ([Amazon Bedrock simplifies access with automatic enablement](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-automatic-enablement-serverless-foundation-models) — Oct 2025, >12 months old but describes a still-current mechanism corroborated by the current official model-access doc: [Request access to models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html))

---

## 4. Bedrock Knowledge Bases + Strands TS `bedrock-knowledge-base` memory store

### 4.1 What Knowledge Bases are

A fully managed RAG pipeline: point it at a data source (S3, etc.), it handles chunking, embedding (e.g. Titan Text Embeddings v2), vector indexing, and retrieval, then optionally generation (`RetrieveAndGenerate`). Supported vector-store backends as of 2026: **Amazon OpenSearch Serverless** (default "quick create"), **OpenSearch Managed Cluster**, **Aurora PostgreSQL (pgvector)**, **Neptune Analytics**, **S3 Vectors** (GA, cost-optimized, no idle floor), **Pinecone**, **MongoDB Atlas**, **Redis Enterprise Cloud**. ([Vector store options for Bedrock Knowledgebase](https://repost.aws/questions/QUbsDhN6CRQvGdP43k_xL3Fw/vector-store-options-for-bedrock-knowledgebase); [AWS Vector Store for RAG — Beyond OpenSearch](https://cevo.com.au/post/aws-vector-store-for-rag-beyond-opensearch); [S3 Vectors GA announcement](https://www.linkedin.com/posts/marcsilv_aws-amazon-s3-vector-buckets-activity-7351310191360999425-bcwN)) OpenSearch Serverless has a real idle-cost floor (~$350–700/month minimum from its 4-OCU baseline per two independent sources); **S3 Vectors is the cost-sensible pick for a hackathon-scale, low-QPS Knowledge Base** — no idle floor, storage+query billing only. ([bigdataboutique.com AWS Vector Database Options](https://bigdataboutique.com/blog/aws-vector-database-options); [cevo.com.au](https://cevo.com.au/post/aws-vector-store-for-rag-beyond-opensearch))

### 4.2 Strands TS `vended-memory-stores/bedrock-knowledge-base`

This is a **`MemoryStore` adapter** that lets a Strands `Agent` treat a Bedrock Knowledge Base as one of its memory sources — read-only by default, optionally writable with automatic extraction:

```ts
import { Agent, BedrockModel } from '@strands-agents/sdk'
import { BedrockKnowledgeBaseStore } from '@strands-agents/sdk/vended-memory-stores/bedrock-knowledge-base'

const store = new BedrockKnowledgeBaseStore({
  name: 'bids',
  description: 'Contractor bid documents for this case.',
  config: { knowledgeBaseId: 'KB123' },
})

const agent = new Agent({
  model: new BedrockModel(),
  memoryManager: { stores: [store] },
})
```
([Bedrock Knowledge Base Store — Strands docs](https://strandsagents.com/docs/user-guide/concepts/memory/bedrock-knowledge-base))

The store auto-detects whether it's connected to a **managed** or **vector** knowledge base and shapes its `Retrieve` request accordingly — same config works for either. A writable store (for the agent to save new memories via `add_memory`) needs a `dataSourceId`; an S3-backed writable store additionally needs `dataSourceType: 'S3'` + `s3: { bucket, prefix }`. `extraction: true` makes the store passively capture memories from conversation turns rather than requiring an explicit tool call. The `MemoryManager` also auto-registers a configurable `search_memory`-style tool (`searchToolConfig`) the agent can call on demand. ([Bedrock Knowledge Base Store docs](https://strandsagents.com/docs/user-guide/concepts/memory/bedrock-knowledge-base); [Memory overview — automatic extraction](https://strandsagents.com/docs/user-guide/concepts/memory/overview))

### 4.3 Concrete worked example: three contractor bid documents

For "store three contractor bid documents, then ask 'which bids priced permits?'":

1. **Ingest**: upload the three bid PDFs/DOCX/text files to an S3 bucket that is the Knowledge Base's **data source**. Bedrock's ingestion job chunks each document, embeds each chunk (Titan Text Embeddings v2 by default), and writes vectors to the configured store (S3 Vectors recommended per §4.1).
2. **Configure the Strands agent**:
   ```ts
   const store = new BedrockKnowledgeBaseStore({
     name: 'contractor-bids',
     description: 'Uploaded contractor bid documents for this Home Energy Guardian case.',
     config: { knowledgeBaseId: process.env.BID_KB_ID! },
   })
   const agent = new Agent({ model: new BedrockModel(), memoryManager: { stores: [store] } })
   ```
3. **Ask**: `agent.invoke("Which bids priced permits, and how much?")`. The `MemoryManager` runs a `search_memory`-equivalent semantic retrieval over the KB (query: "permit pricing in contractor bids") *before* the model call, injects the top-matching chunks (e.g., a line item "Permit fees: $450" from Bid #2, another from Bid #3) into context, and the model synthesizes an answer citing which of the three bid documents mention permits and at what price. Because retrieval is semantic (embedding similarity), it will surface a permit line item even if the literal word "permit" is phrased differently ("municipal filing fee") in one bid — this is the genuine value-add over a keyword grep across the three files.
4. This maps cleanly onto Sift's own "evidence" concept for Home Energy Guardian: the KB retrieval is the *evidence-gathering* step; the deterministic core (per CLAUDE.md) still owns whether "permits priced" becomes a validated case fact — the model's retrieval-augmented answer is a **candidate finding**, not an authoritative state mutation, exactly matching "the model may propose candidate events... it may never approve a consequential decision."

**Cost model for this example**: ingestion is a one-time embedding cost (near-zero for 3 short documents); each query is one embedding call (query text) + one KB `Retrieve` call + the surrounding model invocation's normal token cost. With S3 Vectors, no idle floor is incurred between demo runs. Could not verify an exact per-query dollar figure for S3-Vectors-backed KB retrieval from a primary source in this pass — treat as "low cents at hackathon scale," not a precise number.

---

## 5. What a hackathon judge expects for "AgentCore deployment"

Confirmed directly from the hackathon's own pages ([agentsforhumans.devpost.com](https://agentsforhumans.devpost.com), [rules](https://agentsforhumans.devpost.com/rules), [FAQs](https://agentsforhumans.devpost.com/details/faqs), [resources](https://agentsforhumans.devpost.com/resources)):

- **AgentCore is explicitly optional, not required.** Verbatim FAQ: *"Q: Do I need to use AWS AgentCore? A: No. AgentCore is encouraged and will strengthen your Technical Implementation score, but it's not required. Build with Strands Agents as your foundation and deploy however works for you."* The rules page repeats the identical framing: *"Deploying with Amazon Bedrock AgentCore is a smart architectural choice and will strengthen your Technical Implementation score, but it's not required."*
- **The one hard requirement is Strands Agents SDK as the foundation** — the hackathon's whole premise ("Build an AI agent with Strands Agents SDK that handles repetitive tasks"). Sift already satisfies this unconditionally regardless of AgentCore.
- **Functionality/Judging bar**: the project "must be capable of being successfully installed and running consistently on the platform for which it is intended and must function as depicted in the video and/or expressed in the text description" — i.e., judges will actually try to run it or, at minimum, hold the submission to what the demo video/text claims. This directly supports CLAUDE.md's "Never fabricate deployment success" instruction — an honest "AgentCore not deployed, here's why" beats a false claim a judge could disprove by trying `/invocations`.
- **What's submitted**: standard Devpost project submission (description, demo video, code repo); a **bonus** for publishing a build-journey post on `builder.aws.com` tagged for the hackathon (no longer requires the `#AgentsforHumans` hashtag in the *blog post title* specifically, per an 8/12/26 rules update — but the FAQ instructs using "Agents for Humans" in the title convention shown, and the post must be public before the deadline).
- **Newly created work only**: the project "must have been built during the Submission Period" (2026-08-10 through 2026-09-14); pre-existing frameworks/libraries/starter templates/AI coding assistants are fine and expected, but any other pre-existing code/prior work must be disclosed. This is relevant to Sift's `docs/reuse-source-map.md` discipline — already aligned.
- **Practical judge-facing proof of "genuine AgentCore leverage"** (synthesized from the rubric language plus general AWS Strands+AgentCore builder guidance found in this research, since no separate "how judges evaluate AgentCore specifically" doc was found): a working `/ping` + `/invocations` round trip against a real deployed AgentCore Runtime ARN, ideally shown live or in the demo video via `agentcore invoke` or an `InvokeAgentRuntimeCommand` call, is the concrete, checkable artifact — not just a Dockerfile that targets the contract but was never actually pushed and invoked. Given Sift's dual-purpose Railway container already implements the exact `/ping`/`/invocations` shape AgentCore requires, the **marginal judge-facing win of also standing up a real AgentCore Runtime deployment (even briefly, even for one hero pack) is high relative to its cost** — it is close to a "deploy the same container a second way" exercise, not a rebuild, given the shared HTTP contract already correctly implemented in `apps/agent/src/routes/agentcore.ts`.
- **Could not verify**: no independent, AgentCore-specific "how to demo this well" guidance page distinct from the hackathon's own rules/FAQ/resources pages was found in this search pass; the resources page does link the generic AgentCore CLI quickstart and "Deploy a Strands Agent to AgentCore Runtime" doc, both already covered in §1.

---

## 6. Minimum viable path — ordered steps with commands and time estimates

Assumes an AWS account with console/CLI access already exists and `aws configure` has not yet been run.

| # | Step | Command(s) | Est. time |
|---|---|---|---|
| 1 | Configure AWS CLI credentials | `aws configure` (or env vars `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) | 2 min |
| 2 | Verify identity | `aws sts get-caller-identity` | 1 min |
| 3 | Request AWS Promotional Credit for the hackathon (do this **first** — deadline is 2026-09-11 12pm PT) | Via the Devpost resources page form ([agentsforhumans.devpost.com/resources](https://agentsforhumans.devpost.com/resources)) | 5 min, but time-boxed by the external deadline |
| 4 | Submit the one-time Anthropic model usage-terms form (Bedrock auto-enables Nova/others, but Anthropic models still gate on this) | Console: open a Claude model in the Bedrock Playground and accept the form; or programmatically per [Request access to models](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) | 5 min (may be near-instant once submitted) |
| 5 | Run one inference from the TS SDK to prove Bedrock connectivity | `npm install @strands-agents/sdk` (already in repo); `new Agent({ model: new BedrockModel({ region: 'us-east-1' }) }); await agent.invoke('hello')` — reuse Sift's existing `createBedrockModel` in `apps/agent/src/runtime/model-provider.ts`, just call it from a throwaway script instead of leaving it unwired | 5–10 min once credentials/model-access are live |
| 6 | Create the AgentCore Runtime execution IAM role | Run the `create-iam-role.sh` script pattern from the [Strands TS AgentCore guide](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript) (trust policy for `bedrock-agentcore.amazonaws.com`, permissions for ECR pull, CloudWatch Logs, X-Ray, `bedrock:InvokeModel`) | 5 min |
| 7 | Build the arm64 image and push to ECR | `aws ecr create-repository --repository-name sift-agent`; `aws ecr get-login-password \| docker login ...`; `docker build --platform linux/arm64 -t sift-agent .`; `docker tag ...`; `docker push ...` | 10–15 min (image build/push time depends on layer sizes) |
| 8 | Create the AgentCore Runtime | `aws bedrock-agentcore-control create-agent-runtime --agent-runtime-name sift_agent --agent-runtime-artifact containerConfiguration={containerUri=...} --role-arn $ROLE_ARN --network-configuration networkMode=PUBLIC --protocol-configuration serverProtocol=HTTP --region us-east-1` | 2 min to issue, ~1 min to reach `READY` |
| 9 | Poll status | `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id ... --query 'status'` | <1 min |
| 10 | Hit `/invocations` for real | TypeScript: `new BedrockAgentCoreClient({ region }).send(new InvokeAgentRuntimeCommand({ runtimeSessionId, agentRuntimeArn, qualifier: 'DEFAULT', payload: new TextEncoder().encode(JSON.stringify({ prompt: '...' })) }))`, or `agentcore invoke '{"prompt": "..."}'` if using the AgentCore CLI project shape | 2–5 min |
| 11 | (Optional, if pursuing per-pack proof per CLAUDE.md) Repeat 6–10 for the second hero pack's agent config, or invoke the same runtime with a pack-specific `caseId`/command payload per Sift's already-defined `/invocations` envelope | 10–15 min (mostly reusing the same role/ECR repo) |

**Total for a first successful `/ping` + `/invocations` round trip against a real AgentCore Runtime, assuming Bedrock model access is already granted**: roughly **45–60 minutes** of active work, dominated by Docker build/push and the few sequential AWS API round trips that must each reach a terminal state before the next step. The single biggest external-dependency risk is step 4 (Anthropic model access approval) — that gate has historically been near-instant in the current auto-enablement regime but is the one step not fully under the operator's control, so it should be triggered first, in parallel with everything else.

**Fastest possible path if the CDK-based AgentCore CLI is acceptable** (`agentcore create` → wizard picks TypeScript/Strands/CodeZip → `agentcore deploy`) trades the manual ECR/IAM steps above for CDK bootstrap time; the CLI's own docs pitch this as "a few minutes" end-to-end, but it introduces a CDK bootstrap dependency Sift doesn't otherwise have and diverges from the existing Docker/Railway container path — the **manual container path in the table above is the better fit for Sift's existing deployment posture** and is what its own `apps/agent/src/routes/agentcore.ts` code was already written against.

---

## Summary of sources by recency

All primary sources cited are either the current AWS official docs tree (`docs.aws.amazon.com/bedrock-agentcore/...`, undated but reflecting the live docs as served on 2026-09-07), the current official pricing page (`aws.amazon.com/bedrock/agentcore/pricing`, `aws.amazon.com/bedrock/pricing`), the current Strands official docs (`strandsagents.com/docs/...`), the official `aws/bedrock-agentcore-sdk-typescript` and `strands-agents/sdk-typescript` GitHub repos, or the hackathon's own Devpost pages. Third-party aggregator/blog sources (pricing round-ups, walkthrough blog posts) are all dated within the current year (2026) and were used only to corroborate figures already visible on the official pricing pages, never as the sole source for a load-bearing claim. The one >12-month-old source used ([Amazon Bedrock simplifies access with automatic enablement](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-automatic-enablement-serverless-foundation-models), Oct 2025) is flagged inline and corroborated by the current official model-access doc.
