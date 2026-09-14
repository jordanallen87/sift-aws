/**
 * Shared HTTP envelope helpers used by every `routes/*.ts` module: the
 * `Idempotency-Key` header convention (`commandId`, per
 * `services/command-service.ts`'s header comment) and translating a
 * `services/service-result.ts` `ServiceResult` into the real HTTP error
 * envelope from `@sift/contracts/src/http.ts`
 * (`HttpErrorBodySchema`/`HttpConflictResponseSchema`).
 *
 * Status code mapping (docs/specs/architecture.md "Command and event flow":
 * "A stale `eventSequence` produces HTTP `409`"; docs/specs/testing.md "HTTP
 * integration tests": "success, validation, not-found, conflict, policy,
 * cancellation, and internal-error coverage"):
 *
 *  - `validation` -> `400 VALIDATION`
 *  - `not_found`  -> `404 NOT_FOUND`
 *  - `conflict`   -> `409 CONFLICT` (`HttpConflictResponseSchema`: error + latest `snapshot`)
 *  - `policy`     -> `403 POLICY`
 *  - a thrown (unexpected) error -> `500 INTERNAL`, handled by `app.ts`'s
 *    error-handling middleware, not here (`service-result.ts`'s own header
 *    comment: a genuine internal error is left to propagate as a real
 *    thrown `Error`, not returned as a `ServiceFailure`).
 *
 * Also owns `readCommandOrigin`, the sibling reader for the optional
 * `X-Sift-Command-Origin` header (I1: WebMCP call provenance -- ADR 0006
 * decision 8, docs/specs/debugging-and-observability.md "WebMCP tool
 * calls"). See that function's own doc comment and
 * `packages/contracts/src/http.ts`'s `CommandOrigin` doc comment for the
 * full contract, including why this is self-reported provenance and never
 * an authorization signal.
 */
import type { Request, Response } from 'express';
import {
  CommandOriginSchema,
  CommandReceiptSchema,
  HttpConflictResponseSchema,
  HttpErrorBodySchema,
  COMMAND_ORIGINS,
  type CommandOrigin,
  type JsonValue,
} from '@sift/contracts';
import type { ServiceResult } from '../services/service-result.js';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const COMMAND_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
const COMMAND_ORIGIN_HEADER = 'x-sift-command-origin';

/**
 * Reads and validates the `Idempotency-Key` request header as the
 * command's `commandId`. Writes a `400 VALIDATION` response and returns
 * `undefined` when the header is missing or malformed -- callers must check
 * for `undefined` and return immediately without proceeding.
 */
export function readCommandId(
  req: Request,
  res: Response,
  bodyFallback?: { readonly field: string; readonly value: string | undefined },
): string | undefined {
  // `bodyFallback` exists for `POST /invocations` only: AgentCore Runtime's
  // InvokeAgentRuntime API forwards no arbitrary request headers, so a
  // caller reaching Sift through AgentCore has no way to set this header.
  // The header still wins when both are present.
  const key = req.get(IDEMPOTENCY_KEY_HEADER) ?? bodyFallback?.value;
  const source =
    bodyFallback === undefined
      ? `"${IDEMPOTENCY_KEY_HEADER}" request header`
      : `"${IDEMPOTENCY_KEY_HEADER}" request header or "${bodyFallback.field}" body field`;
  if (key === undefined || key.length === 0) {
    sendError(
      res,
      400,
      'VALIDATION',
      `A non-empty ${source} is required as the command's idempotency key.`,
      false,
    );
    return undefined;
  }
  if (!COMMAND_ID_PATTERN.test(key)) {
    sendError(
      res,
      400,
      'VALIDATION',
      `The ${source} must contain only letters, digits, ".", "_", or "-" (max 200 chars).`,
      false,
    );
    return undefined;
  }
  return key;
}

export type CommandOriginReadResult =
  { readonly ok: true; readonly origin: CommandOrigin | undefined } | { readonly ok: false };

/**
 * Reads and validates the OPTIONAL `X-Sift-Command-Origin` request header
 * (I1: WebMCP call provenance -- ADR 0006 decision 8,
 * docs/specs/debugging-and-observability.md "WebMCP tool calls"): a sibling
 * to `Idempotency-Key`/`X-Sift-Command-Id` (`sift-client.ts:38-48`) that
 * tags a command as issued by a registered WebMCP tool rather than a direct
 * UI action, for the developer/runtime trail only.
 *
 * Unlike `readCommandId`, the header is optional -- absence returns `{ ok:
 * true, origin: undefined }`, exactly today's (pre-marker) behavior, so
 * every existing caller that never sends it is unaffected. When present it
 * must be a member of `COMMAND_ORIGINS` (`@sift/contracts`'s closed enum,
 * not free text); an unrecognized value writes a `400 VALIDATION` response
 * and returns `{ ok: false }` -- the same failure contract `readCommandId`
 * already uses, so a caller must check `result.ok` and return immediately
 * without proceeding, exactly like that function.
 *
 * This marker is NEVER consulted for an authorization decision -- see
 * `@sift/contracts`'s `CommandOrigin` doc comment (`packages/contracts/src/
 * http.ts`) for why trusting client-reported provenance for policy would
 * recreate the exact hazard `routes/agentcore.ts`'s header comment
 * documents for its own `actor` field on a neighbouring transport.
 */
export function readCommandOrigin(req: Request, res: Response): CommandOriginReadResult {
  const header = req.get(COMMAND_ORIGIN_HEADER);
  if (header === undefined || header.length === 0) {
    return { ok: true, origin: undefined };
  }
  const parsed = CommandOriginSchema.safeParse(header);
  if (!parsed.success) {
    sendError(
      res,
      400,
      'VALIDATION',
      `"${COMMAND_ORIGIN_HEADER}" must be one of: ${COMMAND_ORIGINS.join(', ')}.`,
      false,
    );
    return { ok: false };
  }
  return { ok: true, origin: parsed.data };
}

export function sendError(
  res: Response,
  status: number,
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'POLICY' | 'UNAVAILABLE' | 'INTERNAL',
  message: string,
  retryable: boolean,
  details?: JsonValue,
): void {
  res.status(status).json(
    HttpErrorBodySchema.parse({
      error: { code, message, retryable, ...(details !== undefined ? { details } : {}) },
    }),
  );
}

/**
 * Writes the appropriate HTTP response for a `CommandService`/`RunService`
 * `ServiceResult`. `onOk` lets a caller (e.g. `routes/runs.ts`, which
 * returns a `RunReceipt`, a strict superset of `CommandReceipt`; or
 * `routes/cases.ts`'s `checkEnergyBillFeed` route, whose
 * `EnergyBillFeedCheckResult` is not `CommandReceipt`-shaped at all when
 * no case was opened) customize the success-response schema; defaults to
 * `CommandReceiptSchema`, which is why every *other* existing caller can
 * still omit it. `T`'s bound is deliberately just `{ commandId: string }`
 * -- the field every `ServiceResult` success value actually carries -- not
 * a `CommandReceipt`-shaped constraint: nothing in this function's body
 * reads `caseId`/`acceptedSequence` off `T` itself (only `onOk` does, and
 * only when the caller's own schema needs them), so requiring them here
 * would reject an honest non-case-creating outcome for no functional
 * reason.
 */
export function respondWithServiceResult<T extends { commandId: string }>(
  res: Response,
  result: ServiceResult<T>,
  onOk: (value: T) => unknown = (value) => CommandReceiptSchema.parse(value),
): void {
  switch (result.status) {
    case 'ok':
      res.status(200).json(onOk(result.value));
      return;
    case 'validation':
      sendError(res, 400, 'VALIDATION', result.message, false, [...result.issues]);
      return;
    case 'not_found':
      sendError(res, 404, 'NOT_FOUND', result.message, false);
      return;
    case 'policy':
      sendError(res, 403, 'POLICY', result.message, false);
      return;
    case 'conflict':
      res.status(409).json(
        HttpConflictResponseSchema.parse({
          error: {
            code: 'CONFLICT',
            message: result.message,
            retryable: true,
            expectedSequence: result.expectedSequence,
            actualSequence: result.actualSequence,
          },
          snapshot: result.snapshot,
        }),
      );
      return;
  }
}
