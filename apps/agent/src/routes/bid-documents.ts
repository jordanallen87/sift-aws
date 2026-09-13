/**
 * `POST /api/cases/:caseId/bid-documents/read` -- the ASYNC step that sits
 * BEFORE `submitBidDocument` (`routes/commands.ts`'s `submitBidDocument`
 * case, `services/command-service.ts`): it turns a bid PDF's
 * browser-extracted prose text layer into Sift's canonical bid shape with a
 * model, then hands a successful reading straight to the existing,
 * synchronous, deterministic `CommandService.submitBidDocument` as an
 * ordinary `format: 'application/json'` document -- so the proven,
 * model-free `extractBidDocument` still does the actual field-by-field
 * mapping onto attributes, and the command layer never needs to know a
 * model was ever involved. See `runtime/bid-document-reader.ts`'s own
 * header comment for the full architectural reasoning:
 * `CommandService` is synchronous end to end by design (`better-sqlite3`, a
 * synchronous driver; commands are replayed by `commandId` for idempotency,
 * which a model call inside one would break), so the model call genuinely
 * cannot live inside a command handler. This route is that seam -- the ONE
 * place in this codebase where "async" and "Sift command" meet, and they
 * meet BEFORE the command, never inside it.
 *
 * Structurally the same shape as `routes/commands.ts`: the same
 * `Idempotency-Key` -> `commandId` reader, the same optional
 * `X-Sift-Command-Origin` reader, the same body/URL `caseId` consistency
 * check, and the same `respondWithServiceResult`/`sendError` response
 * mapping -- so a successful reading looks, to the client, exactly like any
 * other command response (a `CommandReceipt`), and every failure mode this
 * route can produce reuses the identical HTTP error envelope every other
 * route already uses.
 *
 * --- Why `async`/`await` is safe here on this Express version ---
 *
 * Express 5 (`apps/agent/package.json`: `"express": "^5.2.1"`) forwards a
 * rejected Promise returned by an async route handler to the app's
 * error-handling middleware automatically (`app.ts`'s final
 * `(err, _req, res, _next) => ...` handler, which logs the real error and
 * answers a generic `500 INTERNAL` -- never leaking internals, per
 * architecture.md "Security and authority"). That alone is enough to keep
 * an unhandled rejection here from ever taking the process down. This
 * handler still wraps its body in an explicit `try`/`catch` and calls
 * `next(error)` itself rather than leaning on that implicit behavior alone:
 * it keeps this route's safety property visible and testable in this file,
 * rather than depending on a reader already knowing Express 5's async
 * semantics, and it costs nothing extra since `readBidDocumentWithModel`
 * itself is documented to never throw (its own header comment) -- this
 * `catch` is defense in depth against a bug that defies that contract, not
 * the primary mechanism relied on.
 *
 * --- The no-network rule (`config.ts`, `.env.example`) ---
 *
 * `docs/specs/architecture.md` requires the complete local demo to run with
 * NO network and no AWS credentials. `deps.reader` is therefore optional
 * and constructed exactly ONCE, in `server.ts`, only when
 * `SIFT_BID_DOCUMENT_READER_ENABLED=true` -- reusing
 * `resolveModelProvider`/`createBedrockModel`
 * (`runtime/model-provider.ts`), never a Bedrock client built inline here.
 * A test injects a `ScriptedModelProvider` double instead
 * (`bid-documents.test.ts`). When `deps.reader` is `undefined` (every
 * local/offline deployment, and every test that does not explicitly opt
 * in), this route NEVER attempts a model call: it answers the same honest,
 * actionable refusal every time, telling the person plainly that reading a
 * PDF needs a model this deployment does not have configured, and that
 * importing JSON/CSV or typing the values in directly both still work.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { BaseModelConfig, Model } from '@strands-agents/sdk';
import { ReadBidDocumentInputSchema } from '@sift/contracts';
import type { CommandService } from '../services/command-service.js';
import { formatZodIssues } from '../services/service-result.js';
import { readBidDocumentWithModel } from '../runtime/bid-document-reader.js';
import {
  readCommandId,
  readCommandOrigin,
  respondWithServiceResult,
  sendError,
} from './http-support.js';

/**
 * The injected model dependency this route calls `readBidDocumentWithModel`
 * with, plus the id that names it in every `readBy` marker this route
 * writes (`SubmittedBidDocumentReadBySchema.modelId`, `@sift/contracts`).
 * Carrying `modelId` alongside the `Model` instance, rather than reading it
 * back off `model.getConfig()`, keeps this route's own provenance record
 * independent of an SDK internal it does not otherwise need to inspect.
 */
export interface BidDocumentReaderDeps {
  readonly model: Model<BaseModelConfig>;
  readonly modelId: string;
}

export interface BidDocumentsRouterDeps {
  readonly commandService: CommandService;
  /**
   * `undefined` in every deployment/test that has not explicitly opted in
   * (`SIFT_BID_DOCUMENT_READER_ENABLED`, config.ts) -- see this module's
   * header for why that must stay the default.
   */
  readonly reader?: BidDocumentReaderDeps;
}

export function createBidDocumentsRouter(deps: BidDocumentsRouterDeps): Router {
  const router = Router();

  router.post(
    '/api/cases/:caseId/bid-documents/read',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const commandId = readCommandId(req, res);
        if (commandId === undefined) return;

        const originResult = readCommandOrigin(req, res);
        if (!originResult.ok) return;

        const { caseId } = req.params;
        const rawBody: Record<string, unknown> =
          typeof req.body === 'object' && req.body !== null
            ? (req.body as Record<string, unknown>)
            : {};
        // The same body/URL consistency check `routes/commands.ts` applies:
        // a body that names a DIFFERENT case than the URL it was posted to
        // is malformed input, not an ambiguity to silently resolve by
        // picking one.
        if ('caseId' in rawBody && rawBody['caseId'] !== caseId) {
          sendError(
            res,
            400,
            'VALIDATION',
            'The request body "caseId" does not match the URL path caseId.',
            false,
          );
          return;
        }

        const parsed = ReadBidDocumentInputSchema.safeParse({ ...rawBody, caseId });
        if (!parsed.success) {
          sendError(
            res,
            400,
            'VALIDATION',
            'Invalid bid document reading request.',
            false,
            formatZodIssues(parsed.error.issues),
          );
          return;
        }
        const input = parsed.data;

        if (deps.reader === undefined) {
          // Never a 500, never a silent empty import, and never pretending
          // to read a PDF this deployment cannot actually read. `503
          // UNAVAILABLE` (not `400 VALIDATION`): the request itself is
          // perfectly well-formed, and would succeed on a deployment with
          // `SIFT_BID_DOCUMENT_READER_ENABLED=true` -- this is a deployment
          // capability gap, not a mistake the caller made.
          sendError(
            res,
            503,
            'UNAVAILABLE',
            `Reading a PDF bid document requires a model, and this deployment has none configured for it (SIFT_BID_DOCUMENT_READER_ENABLED is not enabled). Import the bid as a JSON or CSV file instead, or type its values in directly.`,
            false,
          );
          return;
        }

        const reading = await readBidDocumentWithModel({
          filename: input.filename,
          text: input.text,
          model: deps.reader.model,
        });
        if (!reading.ok) {
          if (reading.kind === 'invocation_failed') {
            // The model itself could not be reached (unreachable,
            // unauthenticated, throttled, timed out) -- this is exactly the
            // "flag enabled, credentials absent/expired" deployment state
            // documented on `BidDocumentReaderDeps`, an ordinary condition,
            // not an edge case. The same `503 UNAVAILABLE` shape as the
            // "no reader configured" branch above, on purpose: to the person
            // who submitted the document, an unreachable model and no model
            // at all are the same experience -- their PDF was never read,
            // and it is not their fault. `reading.reason` (the real
            // exception message, e.g. "Could not load credentials from any
            // providers") still goes into `details`, exactly as before, for
            // whoever runs this deployment to actually act on.
            sendError(
              res,
              503,
              'UNAVAILABLE',
              `Could not reach the model to read "${input.filename}". This is a problem with this deployment, not with your document. Import the bid as a JSON or CSV file instead, or type its values in directly.`,
              false,
              [reading.reason],
            );
            return;
          }
          // Every other failure kind (`invalid_reading`, `nothing_read`,
          // `rejected`) really is about the document, or the request naming
          // it -- a validation-shaped failure carrying the model's own
          // reason. Never a 500, and never an option silently created from
          // nothing.
          sendError(res, 400, 'VALIDATION', `Could not read "${input.filename}" as a bid.`, false, [
            reading.reason,
          ]);
          return;
        }

        // The model step is over. Everything from here is the identical,
        // synchronous, deterministic `submitBidDocument` command every
        // other bid import already runs through -- this route hands it an
        // ordinary `format: 'application/json'` document (the successful
        // reading, `JSON.stringify`'d) plus the `readBy` marker that tells
        // `submitBidDocument` this reading came from a model, never a
        // labelled field in a file the person handed over directly. See
        // `command-service.ts`'s `MODEL_READ_ATTRIBUTE_CONFIDENCE` for what
        // that marker changes downstream.
        const result = deps.commandService.submitBidDocument(
          commandId,
          {
            caseId: input.caseId,
            expectedSequence: input.expectedSequence,
            ...(input.optionId !== undefined ? { optionId: input.optionId } : {}),
            document: {
              filename: input.filename,
              format: 'application/json',
              text: JSON.stringify(reading.document),
              readBy: {
                agent: 'model',
                modelId: deps.reader.modelId,
                originalFilename: input.filename,
                originalFormat: 'application/pdf',
              },
            },
          },
          originResult.origin,
        );
        respondWithServiceResult(res, result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
