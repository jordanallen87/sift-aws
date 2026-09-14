/**
 * `GET /ping` / `POST /invocations` (docs/specs/strands-runtime.md
 * "AgentCore contract"):
 *
 *   - `GET /ping` returning `{ status: "Healthy", time_of_last_update: number }`;
 *   - `POST /invocations` accepting the AgentCore binary request body and
 *     returning the invocation result envelope.
 *
 * Verified against the two official sources the spec links, not invented
 * from the one-line summary above:
 *
 *   - the TypeScript AgentCore deployment guide
 *     (https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/typescript/),
 *     whose exact sample is:
 *       `app.get('/ping', (_, res) => res.json({ status: 'Healthy',
 *       time_of_last_update: Math.floor(Date.now() / 1000) }))` and
 *       `app.post('/invocations', express.raw({ type: '*\/*' }), async (req, res) => {
 *         const prompt = new TextDecoder().decode(req.body);
 *         const response = await agent.invoke(prompt);
 *         return res.json({ response });
 *       })`;
 *   - AWS's general HTTP protocol contract for AgentCore Runtime
 *     (https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html),
 *     which documents container requirements (host `0.0.0.0`, port `8080`),
 *     `/invocations`' example request (`Content-Type: application/json`,
 *     `{"prompt": "..."}`, business-logic-defined beyond that) and example
 *     JSON response (`{"response": ..., "status": "success"}`), and
 *     `/ping`'s response (`{"status": "Healthy" | "HealthyBusy"}`, an
 *     *optional* `time_of_last_update` that must be set "only on an actual
 *     status change" -- "Do not set time_of_last_update to the current time
 *     on every ping ... prevents the idle session timeout from ever
 *     firing").
 *
 * ## Why `req.body` is already the parsed JSON payload here, unlike the
 * official sample's `express.raw` + `TextDecoder`
 *
 * The official TypeScript sample uses `express.raw({ type: '*\/*' })` and
 * decodes the raw bytes itself because its bare-bones Express app has no
 * body parser mounted at all. Sift's `app.ts` already mounts
 * `app.use(express.json())` globally, ahead of every router (including this
 * one) -- by the time a request reaches this route, a JSON-content-typed
 * body has already been parsed into `req.body`, exactly matching AWS's own
 * documented `Content-Type: application/json` contract for `/invocations`.
 * Re-parsing it here (or mounting a second, route-scoped `express.raw`,
 * which would race the already-consumed request stream) would be redundant
 * and would diverge from how every other route in this file's sibling
 * modules (`commands.ts`, `runs.ts`, `cases.ts`) already reads `req.body`.
 *
 * ## Request envelope
 *
 * AWS's own `/invocations` contract states the JSON body's schema beyond
 * the top-level `Content-Type: application/json` is "your agent's business
 * logic" to define -- the `{"prompt": "..."}` shown is a documented
 * *example* convention (matching a `prompt`-centric chat agent), not a
 * mandated field for every AgentCore-deployed service. Sift is not a
 * free-text chat agent at this transport: it is the same typed, deterministic
 * `CommandService`/`RunService` command layer every other HTTP route in this
 * app already dispatches into (docs/specs/architecture.md "Deterministic
 * core" -- "Strands decides how to investigate ... It does not decide
 * whether a human decision is approved"). So `/invocations` defines its own
 * small, honest structured envelope instead of threading a narrative prompt
 * string through a nonexistent free-text router:
 *
 * ```
 * {
 *   caseId?: string;                                // required, except for action 'startDemo', which creates the case
 *   commandName?: one of AGENTCORE_COMMAND_NAMES;   // -> CommandService
 *   action?: 'requestInvestigation' | 'startDemo';  // -> RunService / CommandService.startDemo
 *   input?: Record<string, unknown>;                // command/run input, minus caseId
 *   idempotencyKey?: string;                        // body fallback for the Idempotency-Key header
 * }
 * ```
 *
 * `commandName` and `action` are mutually exclusive. Neither present reads
 * the current case snapshot (the same data `GET /api/cases/:caseId`
 * already returns) -- a genuinely useful, real, side-effect-free default for
 * an agent invocation that just wants to check in on a case.
 *
 * ## Authority boundary: this route can never approve anything
 *
 * docs/engineering-principles.md: "The model may propose candidate events and recommendations.
 * It may never approve a consequential decision." `packages/core/src/policy.ts`'s
 * `reviewProposal` already rejects any `decision.actor !== 'human'` -- but
 * that check inspects a client-supplied JSON field, not an authenticated
 * identity. It correctly protects the browser UI path (the one place that
 * hardcodes the literal string `'human'`, only on an actual human clicking
 * an approve button) but it is NOT, by itself, a guarantee against an
 * autonomous AgentCore caller that simply sets `"actor": "human"` in its own
 * request body and has the deterministic core honor it. Verified, not
 * assumed: nothing upstream of `reviewProposal` authenticates who the caller
 * actually is.
 *
 * The real structural boundary therefore lives here, at the one transport
 * this route owns: `AGENTCORE_COMMAND_NAMES` below excludes both
 * `reviewProposal` (approve/reject a `DecisionProposal`) and
 * `reviewCaseExtension` (confirm/reject an agent-proposed case extension) --
 * the same two human-confirmation verbs `docs/specs/webmcp.md`'s WebMCP tool
 * catalog already withholds from ChatGPT (`sift_request_revision` is the only
 * decision-adjacent WebMCP tool, and it can only attach a revision request,
 * never approve -- see `model-context/webmcp-contract.test.ts`'s "No tool
 * can approve or reject a decision proposal"). A `commandName` naming either
 * verb fails Zod schema validation (`400 VALIDATION`) before `CommandService`
 * is ever invoked -- an enum member that structurally does not exist, not a
 * runtime `actor` string this route would otherwise have to trust.
 *
 * `dispatchCommand`/`COMMAND_NAMES` are imported directly from
 * `routes/commands.ts` (see that file's header comment) so this route
 * genuinely reuses the exact same `CommandService` dispatch table `POST
 * /api/cases/:caseId/commands/:commandName` already uses -- a second
 * transport onto the same real engine, never a re-implemented switch that
 * could drift out of sync with it.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { CaseStateSchema, CommandReceiptSchema, RunReceiptSchema } from '@sift/contracts';
import type { Clock } from '@sift/core';
import { COMMAND_NAMES, dispatchCommand, type CommandName } from './commands.js';
import { readCommandId, respondWithServiceResult, sendError } from './http-support.js';
import { formatZodIssues, type ServiceResult } from '../services/service-result.js';
import type { CommandService } from '../services/command-service.js';
import type { RunService } from '../services/run-service.js';
import type { CaseStore } from '../store/case-store.js';

export interface AgentCoreRouterDeps {
  readonly commandService: CommandService;
  readonly runService: RunService;
  readonly caseStore: CaseStore;
  /** Sources `GET /ping`'s `time_of_last_update` (see below for why it is captured once, not read on every call). */
  readonly clock: Clock;
}

const AGENTCORE_EXCLUDED_COMMAND_NAMES: ReadonlySet<CommandName> = new Set([
  'reviewProposal',
  'reviewCaseExtension',
]);

/**
 * `COMMAND_NAMES` minus the two human-only "review" verbs -- see this
 * file's header comment ("Authority boundary"). Derived from `commands.ts`'s
 * own exported `COMMAND_NAMES` (rather than a second hand-written literal
 * list) so this route can never silently drift out of sync if a future
 * command is added there; `agentcore.test.ts` additionally asserts this
 * derivation still excludes exactly the two expected verbs.
 */
export const AGENTCORE_COMMAND_NAMES = COMMAND_NAMES.filter(
  (name): name is Exclude<CommandName, 'reviewProposal' | 'reviewCaseExtension'> =>
    !AGENTCORE_EXCLUDED_COMMAND_NAMES.has(name),
);

const AgentCoreInvocationBodySchema = z
  .object({
    caseId: z.string().min(1, 'caseId must not be empty').optional(),
    commandName: z.enum(AGENTCORE_COMMAND_NAMES).optional(),
    action: z.enum(['requestInvestigation', 'startDemo']).optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    // AgentCore's InvokeAgentRuntime forwards no custom headers, so this is
    // the only idempotency channel a caller going through AgentCore has.
    idempotencyKey: z.string().optional(),
  })
  .strict()
  .refine((body) => !(body.commandName !== undefined && body.action !== undefined), {
    message: 'commandName and action are mutually exclusive.',
    path: ['action'],
  })
  .refine((body) => !(body.action === 'startDemo' && body.caseId !== undefined), {
    message: 'action "startDemo" creates the case, so it must not name one.',
    path: ['caseId'],
  });

/**
 * Writes the AgentCore-documented success envelope (`{ response, status:
 * "success" }`, per both official sources cited above) for an `ok`
 * `ServiceResult`, and otherwise falls back to `respondWithServiceResult`'s
 * existing validation/not-found/policy/conflict -> HTTP status mapping
 * every other Sift route already uses (AWS's own error-handling contract:
 * "the HTTP status code reflects the exception" -- native HTTP, no special
 * success-shaped wrapping expected for errors).
 */
function respondInvocationResult<
  T extends { commandId: string; caseId: string; acceptedSequence: number },
>(res: Response, result: ServiceResult<T>, onOk: (value: T) => unknown): void {
  if (result.status === 'ok') {
    res.status(200).json({ response: onOk(result.value), status: 'success' });
    return;
  }
  respondWithServiceResult(res, result);
}

export function createAgentCoreRouter(deps: AgentCoreRouterDeps): Router {
  const router = Router();

  // Captured once, when this router is constructed (process boot in
  // server.ts; once per test elsewhere) -- AWS's HTTP protocol contract
  // explicitly warns against setting `time_of_last_update` to "the current
  // time on every ping" ("prevents the idle session timeout from ever
  // firing"). Sift's own health status never actually changes after boot --
  // this route always reports `Healthy` (there is no asynchronous
  // `HealthyBusy` state: every `/invocations` call is handled and
  // responded to synchronously within the one request, per the real
  // `CommandService`/`RunService` dispatch below) -- so the one true
  // "status last changed" instant is the moment the service came up.
  const healthyAtSeconds = Math.floor(new Date(deps.clock.now()).getTime() / 1000);

  router.get('/ping', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'Healthy', time_of_last_update: healthyAtSeconds });
  });

  router.post('/invocations', (req: Request, res: Response) => {
    const rawBody: unknown = req.body;
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      sendError(
        res,
        400,
        'VALIDATION',
        'POST /invocations requires a JSON object body (Content-Type: application/json).',
        false,
      );
      return;
    }

    const parsed = AgentCoreInvocationBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      sendError(
        res,
        400,
        'VALIDATION',
        'Invalid /invocations request body.',
        false,
        formatZodIssues(parsed.error.issues),
      );
      return;
    }

    const { caseId, commandName, action, input, idempotencyKey } = parsed.data;
    const bodyKey = { field: 'idempotencyKey', value: idempotencyKey };

    // The only way to open a case through AgentCore: every other route that
    // creates one (`POST /api/cases`, `POST /api/cases/demo`) is unreachable
    // there, because AgentCore Runtime proxies `/invocations` and nothing else.
    if (action === 'startDemo') {
      const commandId = readCommandId(req, res, bodyKey);
      if (commandId === undefined) return;

      const result = deps.commandService.startDemo(commandId, input ?? {});
      respondInvocationResult(res, result, (value) => CommandReceiptSchema.parse(value));
      return;
    }

    if (caseId === undefined) {
      sendError(res, 400, 'VALIDATION', 'caseId is required.', false);
      return;
    }

    if (commandName !== undefined) {
      const commandId = readCommandId(req, res, bodyKey);
      if (commandId === undefined) return;

      const result = dispatchCommand(deps.commandService, commandName, commandId, {
        ...(input ?? {}),
        caseId,
      });
      respondInvocationResult(res, result, (value) => CommandReceiptSchema.parse(value));
      return;
    }

    if (action === 'requestInvestigation') {
      const commandId = readCommandId(req, res, bodyKey);
      if (commandId === undefined) return;

      const result = deps.runService.requestInvestigation(commandId, {
        ...(input ?? {}),
        caseId,
      });
      respondInvocationResult(res, result, (value) => RunReceiptSchema.parse(value));
      return;
    }

    // Default: no commandName/action -- a real, side-effect-free read of
    // the current case snapshot (the same data `GET /api/cases/:caseId`
    // returns), never idempotency-key-gated since it mutates nothing.
    const snapshot = deps.caseStore.load(caseId);
    if (snapshot === undefined) {
      sendError(res, 404, 'NOT_FOUND', `Case "${caseId}" was not found.`, false);
      return;
    }
    res.status(200).json({ response: CaseStateSchema.parse(snapshot), status: 'success' });
  });

  return router;
}
