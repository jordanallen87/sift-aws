# Demo re-cut plan (render-only)

For whoever re-renders after the narration change in `manifest.json` (commit
`fed2c61`). Evidence: `render.ts`, `record.ts`, `timeline.json`, preserved
pre-render segments at `.../scratchpad/segments.before/<id>.mp4` and
`.../scratchpad/srt.before.srt` (live `segments/`/`.srt` are being overwritten by
a render in progress — use the preserved copies, not the live ones), and cached
per-line ElevenLabs audio in `artifacts/demo-video/audio/`.

## 1. Per-beat fit check

Rate: **0.4115 s/word**, measured directly by hashing every *old* line with
render.ts's own audio cache key (`sha1("elevenlabs:<voiceId>\n"+text)`, render.ts:208),
locating the cached `.wav`, and `ffprobe`-ing it — 674 old words / 277.34s of real
ElevenLabs audio. All 37 old lines were cached; none of the 37 new lines are yet.

`estAudio = 0.35 lead + Σ(words×0.4115) + 0.25×(n−1) gaps + 0.55 tail`; `footage` =
take mark duration (stills have none). **FREEZE** = estAudio exceeds footage —
render.ts doesn't error or stretch, it clones the last frame
(`tpad=stop_mode=clone`, render.ts:570–573), per its "compress, never stretch" rule
(line 565).

| beat | old w | new w | footage(s) | old seg(s)* | est new audio(s) | flag |
|---|---|---|---|---|---|---|
| b1-what | 49 | 64 | 17.5 | 20.7 | 27.5 | **FREEZE ~10.0s** |
| b2a-swarm-import | 17 | 25 | STILL | 6.2 | 11.2 | — |
| b2b-graph-import | 13 | 22 | STILL | 5.7 | 10.0 | — |
| b3-core | 37 | 34 | STILL | 15.5 | 15.1 | — |
| b4-case | 29 | 36 | 19.4 | 14.0 | 16.0 | ok |
| b5a-swarm | 57 | 49 | 26.6 | 28.2 | 21.6 | ok |
| b5b-guide | 24 | 23 | 16.0 | 8.8 | 10.6 | ok |
| b6-deny | 37 | 33 | 21.0 | 15.8 | 14.7 | ok |
| b7-goalloop | 64 | 53 | 34.0 | 27.8 | 23.2 | ok |
| b8-arithmetic | 40 | 47 | 27.0 | 22.5 | 20.5 | ok |
| b9-failclosed | 31 | 31 | 18.1 | 14.9 | 13.9 | ok |
| b10a-reweight | 31 | 36 | 19.0 | 13.6 | 16.0 | ok |
| b10b-flagged | 29 | 29 | 19.0 | 11.7 | 13.1 | ok |
| b11-decide | 43 | 36 | 25.4 | 20.3 | 16.2 | ok |
| b12-proof | 81 | 59 | 28.1 | 35.6 | 25.7 | ok |
| b13-bedrock | 67 | 60 | 24.9 | 26.6 | 26.1 | FREEZE ~1.2s |
| b13-close | 25 | 30 | 13.4 | 9.7 | 13.5 | negligible |

\* preserved pre-render segments, `ffprobe`d from `segments.before/`.

Only **b1-what** is a real risk: ~10s held on a static launcher while new
narration keeps playing. b13-bedrock/b13-close are within estimate error.

## 2. Estimated total runtime vs. cap

Pre-cap sum of `max(estAudio, minSeconds)`: **318.9s**. `fitToCap` target =
`300 − 0(card) − 4(CAP_MARGIN_SECONDS) = 296s` (render.ts:56,839). Available hold
slack = 24.1s; fitting spends **95%** of it.

**Estimated final runtime ≈ 296.0s vs. 300s cap — ~4.0s margin**, all of it the
built-in margin constant. This is a global-rate estimate; ElevenLabs paces per
line unevenly, so treat it as ±3–5s and confirm against the real `gate:` log line.

## 3. Is the existing take still valid?

**Yes.** Take `recordedAt`: 2026-09-14T21:25:35.994Z (17:25:35 -04:00).
`git log --since=<that time> -- apps/web/src apps/agent/src packages/packs packages/scenarios`
→ 2 commits, neither touching visible UI: `31ee6ce` (17:58, opt-in default-off
`SIFT_LIVE_SWARM_ENABLED` path + architecture docs) and `2eb5af1` (19:22, AgentCore
`/invocations` route, never exercised by the take). `apps/web/src` has zero commits
since the take.

Narration-claim vs. `observed`:

| claim | beat | status |
|---|---|---|
| "Completed, redirected once" | b5b-guide | matches `specialistPanel` |
| "Flagged, not removed" | b10b-flagged | matches `twoRiversFlag` verbatim |
| "Decided" | b11-decide | matches `decided` |
| "6 values ... could not read 2" | b13-bedrock | matches `bedrockReader` verbatim |
| "Confidence 40%. Not verified" | b13-bedrock | matches `bedrockSummary` |
| "433 events" | b12-proof | matches `inspector-overview` |
| "Four activations" | b5a-swarm | not captured — `record.ts` calls no `note()` in this beat |
| "91 percent against 72" | b10b-flagged | not captured — captured selector omits the score; other notes truncate at 600 chars right before it |
| "A hundred and five spans" | b12-proof | not captured — `inspector-overview` truncates before any spans count |
| "#11 of 12" | — | not present as narration text in the current manifest |

The three "not captured" lines aren't contradicted, just outside what `note()`
scraped — confirm by eye, not evidence of a broken beat.

## 4. Recommendation: render-only

Beat ids/order/`minSeconds`/stills unchanged, no app-UI commit since the take,
no claim above contradicted. Render.ts absorbs the one real mismatch (b1-what)
by design.

If re-record were ever needed: `record.ts` **cannot** target one beat — it's one
continuous session where later beats depend on state built by earlier ones (its
header notes beat 8 is filmed out of order and stitched back only because it's
one run). Re-recording means the whole take: current file is **409.6s** (~6.8 min)
at `SIFT_DEMO_PACING_MS=2000`, plus build/serve startup — budget ~10 minutes.

## 5. Hook quality

The opening line ("Ask a chatbot which of twelve contractor bids...") plays over
~9s of the Sift **launcher** (four example-case tiles, not bids) — promise and
picture mismatch for the first 10s a judge sees, and the one real freeze in item 1.

**Recommend:** open cold on the twelve-bid list (currently b4-case's footage),
then cut to the launcher for the second line. That's a `record.ts` change, not
render.ts — reshuffling footage means a full re-record (item 4). Given the
render-only recommendation, don't do this now; log it for the next re-record.

## 6. Optional AgentCore beat (OPTIONAL — only if deployment succeeds)

- Insert after b13-bedrock, ~12s: a terminal running `aws bedrock-agentcore
  invoke-agent-runtime --agent-runtime-name sift_agentcore --region us-east-1 ...`
  against the deployed runtime, then cut to the app reflecting that state.
- ~15 new words; only ~1.2s of unspent hold slack remains post-fit, so another
  beat needs trimming further to fit.
- Only if deployment lands, backed by a real capture — never fabricate the
  invocation. Skip if it pushes the estimate past 296s.

## 7. Runbook

Follow the README's "Re-rendering after a narration change" section as written
(Steps 0–3: only `render.ts` runs, key in `.env.local` then delete it). Its
blanket "do not re-run `record.ts`" still holds per item 1, but call out
b1-what by name when reporting back rather than treating it as unconditional.

1. `npx tsx scripts/demo-video/render.ts` (no key → `say` voice). Verify:
   `total NNN.Ns against a 300s cap` prints < 300.
2. Real key in `.env.local`; re-run. Verify: prints `gate: NNN.Ns, 1920x1080, h264/aac`.
3. `rm .env.local`. Verify: not tracked/present.
4. `ffprobe -v error -show_entries format=duration -of csv=p=0 artifacts/demo-video/sift-agents-for-humans.mp4`
   Verify: ≤ 300.
5. `grep -c " --> " artifacts/demo-video/sift-agents-for-humans.srt` Verify: = 37.
6. Watch once; eyeball: b1-what (launcher hold reads as a stall?), b5a-swarm
   ("Four activations" legible?), b10b-flagged ("91 percent against 72" on
   screen?), b12-proof ("105" spans visible?), b13-bedrock (~1.2s hold reads
   as a stutter?).
7. Then the README's Step 3 (`cp` to the FINAL name, upload, update
   `release-metadata.json` and the two docs it names, `pnpm test:submission`).

## Top risks

- b1-what freezes on the launcher for ~10s while new narration keeps playing —
  the opening 30s now shows a stall right where the hook matters most.
- The 296.0s estimate spends 95% of all hold-time slack to fit the cap; it's a
  words/sec extrapolation, not measured audio for the new lines, so the real
  render could land over 300s and need a further trim.
- Three on-screen numeric claims ("Four activations," "91% vs 72," "105 spans")
  aren't verifiable from `timeline.json` alone — not contradicted, just unseen.
