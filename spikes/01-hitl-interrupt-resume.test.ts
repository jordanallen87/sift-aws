/**
 * SPIKE 1: HumanInTheLoop interrupt/resume, across a genuine process restart.
 *
 * Goal: prove `HumanInTheLoop` from `@strands-agents/sdk/vended-interventions/hitl`
 * pauses a real Strands `Agent` before a tool call (default interrupt/resume mode,
 * no `ask`), that the tool did NOT execute, and that -- after persisting the
 * session through a real `SessionManager` + `LocalFileStorage` and building a
 * BRAND NEW `Agent` instance from that persisted session (simulating a process
 * restart) -- resuming with an approval response lets the tool execute, while
 * resuming with a denial keeps it from executing.
 *
 * Mirrors `apps/agent/src/runtime/session-adapter.ts`'s
 * `buildLocalSessionManager`/`saveCaseSnapshot`/`restoreCaseSnapshot` pattern
 * (read-only reference; not imported -- spikes/ is not a workspace member and
 * must not depend on or modify tracked files) and
 * `home-energy-guardian-scenario.ts`'s "genuine restart, not a re-used
 * in-memory object" session round trip.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, InterruptResponseContent, SessionManager, tool } from '@strands-agents/sdk';
import { LocalFileStorage } from '@strands-agents/sdk/storage';
import { HumanInTheLoop } from '@strands-agents/sdk/vended-interventions/hitl';
import { z } from 'zod';
import { ScriptedModelProvider } from './helpers/scripted-model.js';

let sessionsDir: string;

beforeEach(async () => {
  sessionsDir = await mkdtemp(join(tmpdir(), 'sift-spike-hitl-'));
});

afterEach(async () => {
  await rm(sessionsDir, { recursive: true, force: true });
});

/** Real fixture tool: `propose_award`. Its callback flips a flag we can assert on -- if the assertion below ever sees this flag flipped for the "before approval" or "after denial" checks, the intervention did not do its job. */
/**
 * What the spike records about the guarded tool actually running. Declared as a
 * named type because the assertions read `lastInput` (proving the *resumed* agent
 * passed the original tool input through, not just that something ran), and an
 * inferred `{ count: 0 }` literal has no such property.
 */
interface ExecutionLog {
  count: number;
  lastInput?: unknown;
}

function buildProposeAwardTool(executed: ExecutionLog) {
  return tool({
    name: 'propose_award',
    description: 'Creates the consequential proposal to award a bid to a subcontractor.',
    inputSchema: z.object({ bidId: z.string(), rationale: z.string() }),
    callback: (input) => {
      executed.count += 1;
      executed.lastInput = input;
      return { status: 'proposed', ...input };
    },
  });
}

function buildAgent(
  sessionManager: SessionManager,
  model: ScriptedModelProvider,
  executed: ExecutionLog,
): Agent {
  return new Agent({
    id: 'award-agent',
    model,
    printer: false,
    sessionManager,
    tools: [buildProposeAwardTool(executed)],
    interventions: [new HumanInTheLoop()],
  });
}

describe('spike: HITL interrupt/resume across a real process restart', () => {
  it('pauses with stopReason "interrupt" and does not execute the tool', async () => {
    const executed: ExecutionLog = { count: 0 };
    const model = new ScriptedModelProvider({
      turns: [
        {
          toolCalls: [
            {
              name: 'propose_award',
              input: { bidId: 'bid-cedar-sons', rationale: 'Lowest adjusted total, clean scope.' },
            },
          ],
        },
      ],
    });
    const sessionManager = new SessionManager({
      sessionId: 'case-hitl-spike',
      storage: new LocalFileStorage(sessionsDir),
    });
    const agent = buildAgent(sessionManager, model, executed);

    const result = await agent.invoke('Award the bid to the best contractor.');

    expect(result.stopReason).toBe('interrupt');
    expect(executed.count).toBe(0);
    expect(result.interrupts).toBeDefined();
    expect(result.interrupts).toHaveLength(1);
    expect(result.interrupts?.[0]?.id).toBeTruthy();
  });

  it('approval path: resumes a FRESH Agent from persisted session state and executes the tool', async () => {
    const executed: ExecutionLog = { count: 0 };
    const model = new ScriptedModelProvider({
      turns: [
        {
          toolCalls: [
            {
              name: 'propose_award',
              input: { bidId: 'bid-cedar-sons', rationale: 'Lowest adjusted total, clean scope.' },
            },
          ],
        },
        // Second turn: the model's follow-up after the tool result comes back.
        { text: 'Award proposed for bid-cedar-sons.' },
      ],
    });

    // --- "Process 1": build agent, invoke, hit the interrupt, persist session. ---
    const sessionManagerA = new SessionManager({
      sessionId: 'case-hitl-approve',
      storage: new LocalFileStorage(sessionsDir),
    });
    const agentA = buildAgent(sessionManagerA, model, executed);
    const firstResult = await agentA.invoke('Award the bid to the best contractor.');
    expect(firstResult.stopReason).toBe('interrupt');
    expect(executed.count).toBe(0);

    const interruptId = firstResult.interrupts?.[0]?.id;
    expect(interruptId).toBeTruthy();

    // SessionManager's default `saveLatestOn: 'invocation'` already persisted
    // snapshot_latest when `invoke()` returned above (an interrupt stop is
    // still an invocation boundary) -- confirmed by reading session-manager.js
    // directly (`_onAfterAgentInvocation` fires regardless of stopReason).
    // Force an explicit save too, exactly as `session-adapter.ts`'s
    // `saveCaseSnapshot` does, so this spike does not depend on that default
    // continuing to hold.
    await sessionManagerA.saveSnapshot({ target: agentA, isLatest: true });

    // --- "Process 2": brand-new SessionManager + brand-new Agent, same on-disk session dir. ---
    const sessionManagerB = new SessionManager({
      sessionId: 'case-hitl-approve',
      storage: new LocalFileStorage(sessionsDir),
    });
    // A fresh model instance too -- this is a new "process", it does not reuse
    // process 1's ScriptedModelProvider cursor. SessionManager restores the
    // interrupted conversation state; the freshly-restored agent's next
    // `invoke()` call (with the interrupt response) drives the tool-call
    // continuation directly WITHOUT calling the model again for the same
    // turn (Strands resumes pending tool execution from the snapshot, see
    // `PendingToolExecution` in `interrupt.d.ts`) and then calls the model
    // once more for the natural-language follow-up -- hence turn index 1
    // ("Award proposed...") is what the resumed agent's own model call
    // consumes.
    const freshModel = new ScriptedModelProvider({
      turns: [{ text: 'Award proposed for bid-cedar-sons.' }],
    });
    const agentB = buildAgent(sessionManagerB, freshModel, executed);
    const restored = await sessionManagerB.restoreSnapshot({ target: agentB });
    expect(restored).toBe(true);

    // Resuming is `agent.invoke([...interrupt responses])`, per
    // `types/agent.ts`'s `InvokeArgs` union
    // (`InterruptResponseContent[] | InterruptResponseContentData[]`) --
    // there is no separate `Agent#resume()` method in this SDK version.
    const resumeResult = await agentB.invoke([
      new InterruptResponseContent({ interruptId: interruptId!, response: true }),
    ]);

    expect(resumeResult.stopReason).not.toBe('interrupt');
    expect(executed.count).toBe(1);
    expect(executed.lastInput).toMatchObject({ bidId: 'bid-cedar-sons' });
  });

  it('denial path: resumes a fresh Agent from persisted session state and the tool does NOT execute', async () => {
    const executed: ExecutionLog = { count: 0 };
    const model = new ScriptedModelProvider({
      turns: [
        {
          toolCalls: [
            {
              name: 'propose_award',
              input: {
                bidId: 'bid-other-co',
                rationale: 'Lower total but missing warranty terms.',
              },
            },
          ],
        },
        // Follow-up turn after the model sees the cancellation message (Deny
        // sets `event.cancel` with the reason text, shown to the model per
        // `interventions/actions.d.ts`'s `Deny` doc comment).
        { text: 'Understood, I will not proceed with that award.' },
      ],
    });

    const sessionManagerA = new SessionManager({
      sessionId: 'case-hitl-deny',
      storage: new LocalFileStorage(sessionsDir),
    });
    const agentA = buildAgent(sessionManagerA, model, executed);
    const firstResult = await agentA.invoke('Award the bid to the best contractor.');
    expect(firstResult.stopReason).toBe('interrupt');
    const interruptId = firstResult.interrupts?.[0]?.id;
    expect(interruptId).toBeTruthy();

    await sessionManagerA.saveSnapshot({ target: agentA, isLatest: true });

    const sessionManagerB = new SessionManager({
      sessionId: 'case-hitl-deny',
      storage: new LocalFileStorage(sessionsDir),
    });
    const freshModel = new ScriptedModelProvider({
      turns: [{ text: 'Understood, I will not proceed with that award.' }],
    });
    const agentB = buildAgent(sessionManagerB, freshModel, executed);
    const restored = await sessionManagerB.restoreSnapshot({ target: agentB });
    expect(restored).toBe(true);

    // HumanInTheLoop's default `evaluate` accepts only `true` / 'y' / 'yes'
    // (case-insensitive) -- see `HumanInTheLoopConfig.evaluate` doc comment.
    // `false` is therefore a denial.
    const resumeResult = await agentB.invoke([
      new InterruptResponseContent({ interruptId: interruptId!, response: false }),
    ]);

    expect(resumeResult.stopReason).not.toBe('interrupt');
    expect(executed.count).toBe(0);
  });
});
