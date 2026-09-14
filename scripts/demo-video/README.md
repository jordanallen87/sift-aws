# Agents for Humans demo video

Produces the submission video end to end, with no manual recording, editing or
voice-over step. Two commands:

```bash
# 1. Serve the built app with the demo pacing the video needs.
pnpm --filter @sift/web build
SIFT_DEMO_PACING_MS=2000 PORT=8099 npx tsx artifacts/submission/server.ts

# 2. Drive the real product once, then cut the film.
SIFT_CAPTURE_PORT=8099 npx tsx scripts/demo-video/record.ts
npx tsx scripts/demo-video/render.ts
```

Output lands in `artifacts/demo-video/`:
`sift-agents-for-humans.mp4` (1920x1080, H.264/AAC) and a matching `.srt`.

## How it is put together

`manifest.json` is the narration and the edit list. `record.ts` drives the real
bid-comparison workflow in one continuous take and writes `timeline.json`, a
mark per beat. `render.ts` synthesizes one audio file per narration line,
measures each, assembles the beat's audio from those measurements, and only
then retimes that beat's footage to fit.

**The voice is the master clock.** Caption windows come from the same measured
durations that produced the audio, so there is no second timing sheet to drift
out of step -- the failure mode that
[`docs/hackathons/demo-tooling/README.md`](../../docs/hackathons/demo-tooling/README.md)
records in the reference pipeline, where `mksrt.mjs` regex-parses `compose.mjs`
to recover cue order.

## Five things that were established by measurement

Each of these cost a render to find. They are written down so they do not have
to be found again.

1. **Recording resolution.** `--force-device-scale-factor=2` with a 480x940
   viewport and a 960x1880 `recordVideo.size` yields a crisp 960x1880 capture of
   the real 480px right-pane layout. Without that flag the same size setting
   composites a 480-wide frame into a 960-wide canvas and leaves the rest grey:
   Playwright never upscales.
2. **`-ss`/`-t` must be input options when the filter graph retimes.** As output
   options they are applied after `setpts` has already rescaled the timestamps,
   so the retime silently does nothing and the final beat -- whose shifted
   timestamps land past its own limit -- renders as an empty file.
3. **One mark per narration segment, not per numbered beat.** Footage has its
   own internal timing that narration cannot bend. A single mark spanning two
   on-screen moments put the words "draft withheld" over a shot still showing
   the blocked action. Beats sharing a `number` and `title` render as one
   numbered beat but align to their own footage independently.
4. **`page.evaluate` takes a string, not a function.** tsx compiles with
   esbuild's `keepNames`, which rewrites named inner functions to call a
   `__name` helper that exists in Node and not in the page; a serialized closure
   containing one dies on `ReferenceError: __name is not defined`.
5. **`scrollIntoView` scrolls every scrollable ancestor**, including the
   document, which shears the app bar off the top of the pane. Move the
   workspace container's own `scrollTop` instead.

## Transitions

Deliberately quiet, and all of them computed from the same measured caption
windows rather than from a transition-duration constant that has to be kept in
step by hand -- trap 2 in
[`docs/hackathons/demo-tooling/README.md`](../../docs/hackathons/demo-tooling/README.md),
where `stitch.mjs` defaults to 0.5 and `mksrt.mjs` to 0.6 and the captions drift
against the picture.

- **Captions dissolve, 0.18s.** Each caption image animates its own alpha, so
  the overlay needs no `enable` window. A window's `to` is exactly the next
  window's `from`, so the outgoing fade finishes as the incoming one starts:
  they never double-expose, and measured caption-area luma across a change runs
  9 -> 6 -> 1 -> 4 -> 9.
- **The pane fades in, 0.35s, once per numbered beat.** Sub-beats that share a
  number and title are one visual beat split only so each part can align to its
  own footage; fading at those joins would read as a flicker mid-thought.
- **The film opens out of black over 0.6s and the closing card fades out over
  0.9s.** Applied to those two segments, not to the stitched file, so the final
  concat stays a stream copy and costs no second encode.
- **Beat to beat is a hard cut.** A cross-dissolve between segments would mean
  re-encoding the join and subtracting the overlap from every downstream
  caption offset. The cut is the honest edit here: the screen genuinely changes.

There is no music bed. The narration is synthesized and a bed would compete
with it; add one only with a licensed asset and well under the voice.

## Narration

Defaults to macOS `say` -- offline, deterministic, free, and good enough that
the captions carry the argument. Set `ELEVENLABS_API_KEY` (and a voice id, via
`ELEVENLABS_VOICE_ID` or the manifest) and flip `voice.provider` to
`elevenlabs` to re-render with studio narration; nothing else changes, and the
key is read from the environment only and never written to disk.

**The key lives in `.env.local`, and only while a render is running.**
`render.ts` loads that file if it is there. `scripts/check-source.ts` scans it
and fails `pnpm verify` on a real key, which is the scanner working, not a
false positive -- so write the file, render, delete the file. Never weaken the
scanner to keep it.

Deleting it does not cost anything already rendered: the ElevenLabs takes stay
in `artifacts/demo-video/audio/`. But a re-render _without_ the key resolves to
the `say` cache key instead, re-synthesizes, and quietly ships the fallback
voice -- the run drops from 296s to 287s, which is the tell. Put the file back
before re-rendering anything you intend to publish.

Audio is cached per line under a hash of the line's own text, so rewording a
line re-synthesizes exactly that line. Keying on the index instead would leave
the captions reading the new words while the voice spoke the old ones.

## What the gate enforces

`render.ts` fails rather than emitting a file that breaks a submission rule:
runtime at or under the manifest's `hardCapSeconds` (300 for this contest,
checked both before rendering and on the finished file), 1920x1080, H.264 video
and AAC audio.

Narration is never sped up to meet the cap, and footage is never slowed to fill
one: `record.ts` films every beat longer than its narration needs, so `render.ts`
only ever compresses time or, where a beat still came up short, holds its last
frame.
