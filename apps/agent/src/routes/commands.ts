/**
 * `POST /api/cases/:caseId/commands/:commandName`
 * (docs/specs/architecture.md "HTTP service"), dispatching to
 * `CommandService`. Covers every `SiftCommands` verb except `startDemo`
 * (its own `POST /api/cases/demo` route, `routes/cases.ts`) and
 * `requestInvestigation` (its own `POST /api/cases/:caseId/run` route,
 * `routes/runs.ts` -- see `services/run-service.ts` for why that one is not
 * part of `CommandService` at all).
 *
 * `COMMAND_NAMES`/`CommandName`/`dispatchCommand` are exported for
 * `routes/agentcore.ts` to reuse verbatim: `POST /invocations` genuinely
 * dispatches into this exact same `CommandService` command table (a second
 * transport onto the same real engine, per docs/specs/strands-runtime.md
 * "AgentCore contract"), not a re-implemented or duplicated switch that
 * could drift from this one.
 *
 * `dispatchCommand`'s optional trailing `commandOrigin` parameter (I1:
 * WebMCP call provenance -- ADR 0006 decision 8) is a field on this same
 * envelope, not a second path: every case in the switch below still calls
 * the identical `CommandService` method it always called, just forwarding
 * one extra value that only changes what gets *recorded*, never what the
 * command *does* (see `command-service.ts`'s own header comment and
 * `packages/contracts/src/http.ts`'s `CommandOrigin` doc comment). Adding
 * the parameter as optional-with-no-default keeps `routes/agentcore.ts`'s
 * existing 4-argument call (`dispatchCommand(service, commandName,
 * commandId, input)`) unaffected -- AgentCore invocations are a different
 * transport from the browser-based WebMCP tool calls this marker tags, and
 * are deliberately left untagged here.
 */
import { Router } from 'express';
import type { CommandOrigin, CommandReceipt } from '@sift/contracts';
import type { CommandService } from '../services/command-service.js';
import type { ServiceResult } from '../services/service-result.js';
import {
  readCommandId,
  readCommandOrigin,
  respondWithServiceResult,
  sendError,
} from './http-support.js';

export interface CommandsRouterDeps {
  readonly commandService: CommandService;
}

export const COMMAND_NAMES = [
  'selectPack',
  'upsertOption',
  'setOptionAttribute',
  // Brings a person's own bid document into a case (ADR-free: see
  // `SubmitBidDocumentInputSchema` in `@sift/contracts` and
  // `CommandService.submitBidDocument` for the contract and the
  // extraction-proposes-never-asserts rule it enforces).
  'submitBidDocument',
  'addNote',
  'focusOption',
  'setView',
  'defineCaseAttribute',
  'reviewCaseExtension',
  'focusEvidence',
  'updateCriteria',
  'submitSource',
  'setEvidenceDisposition',
  'requestRevision',
  'reviewProposal',
  // Adaptive discovery. `setCandidateDisposition` and
  // `completeBlindSpotReview` are reachable over this transport because the
  // pane calls them; both refuse a non-human actor at the schema boundary,
  // so exposing the route does not expose the authority.
  'updateDiscovery',
  'requestInteraction',
  'submitInteractionResponse',
  'setCandidateDisposition',
  'completeBlindSpotReview',
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

function isCommandName(value: string): value is CommandName {
  return (COMMAND_NAMES as readonly string[]).includes(value);
}

export function dispatchCommand(
  service: CommandService,
  commandName: CommandName,
  commandId: string,
  input: unknown,
  commandOrigin?: CommandOrigin,
): ServiceResult<CommandReceipt> {
  switch (commandName) {
    case 'selectPack':
      return service.selectPack(commandId, input, commandOrigin);
    case 'upsertOption':
      return service.upsertOption(commandId, input, commandOrigin);
    case 'setOptionAttribute':
      return service.setOptionAttribute(commandId, input, commandOrigin);
    case 'submitBidDocument':
      return service.submitBidDocument(commandId, input, commandOrigin);
    case 'addNote':
      return service.addNote(commandId, input, commandOrigin);
    case 'focusOption':
      return service.focusOption(commandId, input, commandOrigin);
    case 'setView':
      return service.setView(commandId, input, commandOrigin);
    case 'defineCaseAttribute':
      return service.defineCaseAttribute(commandId, input, undefined, commandOrigin);
    case 'reviewCaseExtension':
      return service.reviewCaseExtension(commandId, input, commandOrigin);
    case 'focusEvidence':
      return service.focusEvidence(commandId, input, commandOrigin);
    case 'updateCriteria':
      return service.updateCriteria(commandId, input, commandOrigin);
    case 'submitSource':
      return service.submitSource(commandId, input, commandOrigin);
    case 'setEvidenceDisposition':
      return service.setEvidenceDisposition(commandId, input, commandOrigin);
    case 'requestRevision':
      return service.requestRevision(commandId, input, commandOrigin);
    case 'reviewProposal':
      return service.reviewProposal(commandId, input, commandOrigin);
    case 'updateDiscovery':
      return service.updateDiscovery(commandId, input, commandOrigin);
    case 'requestInteraction':
      return service.requestInteraction(commandId, input, commandOrigin);
    case 'submitInteractionResponse':
      return service.submitInteractionResponse(commandId, input, commandOrigin);
    case 'setCandidateDisposition':
      return service.setCandidateDisposition(commandId, input, commandOrigin);
    case 'completeBlindSpotReview':
      return service.completeBlindSpotReview(commandId, input, commandOrigin);
  }
}

export function createCommandsRouter(deps: CommandsRouterDeps): Router {
  const router = Router();

  router.post('/api/cases/:caseId/commands/:commandName', (req, res) => {
    const commandId = readCommandId(req, res);
    if (commandId === undefined) return;

    const originResult = readCommandOrigin(req, res);
    if (!originResult.ok) return;

    const { caseId, commandName } = req.params;
    if (!isCommandName(commandName)) {
      sendError(res, 404, 'NOT_FOUND', `Unknown command "${commandName}".`, false);
      return;
    }

    const rawBody: Record<string, unknown> =
      typeof req.body === 'object' && req.body !== null
        ? (req.body as Record<string, unknown>)
        : {};
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

    const result = dispatchCommand(
      deps.commandService,
      commandName,
      commandId,
      { ...rawBody, caseId },
      originResult.origin,
    );
    respondWithServiceResult(res, result);
  });

  return router;
}
