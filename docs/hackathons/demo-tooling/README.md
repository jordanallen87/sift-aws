# Hackathon demo production system

This directory defines the shared production contract for the WebMCP and
Agents for Humans videos. Each video has its own hybrid `manifest.json`, an
aidemo browser storyboard, slide-card specifications, and a capture runbook.

## Why this shape

Devpost recommends a narrated screencast, an immediate explanation of what the
app does, editing out setup/dead time, and scripting the video before recording.
Its demo guidance calls the working product the most important part and says to
show the resolution of the opening problem. The resulting house style is:

1. open on the working product and the result at stake;
2. spend one short slide on the human problem;
3. show the smallest complete, real product journey;
4. use one architecture slide for relationships that cannot be seen in the UI;
5. close on the outcome and differentiator.

Slides explain invisible concepts. They never substitute for product proof.
Both manifests keep generated slides below 25% of runtime.

Sources:

- <https://help.devpost.com/article/84-video-making-best-practices>
- <https://info.devpost.com/blog/how-to-present-a-successful-hackathon-demo>
- <https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video>
- <https://info.devpost.com/blog/hackathon-judging-tips>

## Where the tools are — read this before recording anything

**Do not build a capture or render pipeline. One already exists, it is proven,
and it is two directories in the private reference repository `praetor`.**
Everything below was verified by reading the source on 2026-09-10, not
inferred from its documentation.

`docs/reuse-source-map.md` governs how that repository may be used: it is
**read-only reference**, and Sift must **never import it through a filesystem
path**. Both toolchains below are standalone Node scripts you either run
in place or copy in and adapt — neither becomes a Sift dependency.

| Need | Where | Status |
| --- | --- | --- |
| Narrated, captioned demo video | `praetor/docs/hackathons/all-things-agentic/demo/` | **Built and proven** — it produced the 211.3s `demo.mp4` sitting beside it |
| Product stills, short silent clips, route survey | `praetor/tools/demo-kit/` | **Built and generic** — engines take any URL |
| Manifest schema, timing compile, annotations, recording review | `@sift/demo-studio` (this repo, `packages/demo-studio`) | Built here |
| Deterministic browser replay | [aidemo v0.8.0](https://github.com/tandryukha/aidemo/tree/v0.8.0) | External, evaluated, **not** a dependency of either repo |

### The video pipeline — `praetor/docs/hackathons/all-things-agentic/demo/`

Run each stage separately, in this order. Commands are verbatim from each
script's own header.

```bash
# 1. Narration: one MP3 per cue, measured, plus a timing sheet and subtitles.
#    --dry-run needs no key and makes no API calls -- use it to check length first.
ELEVENLABS_API_KEY=<key> node narrate.mjs --voice <voiceId> [--only <cueId>] [--dry-run]

# 2. Screen capture around a deterministic driver command.
node record.mjs --out segment.mp4 --seconds 30 -- <command to run>

# 3. Still card + its narration -> one 1920x1080 segment.
node mkseg.mjs <image.png> <audio.mp3> <out.mp4> [--pad 0.6] [--zoom]

# 4. Edit list -> normalized build/pN.mp4 parts.
node compose.mjs

# 5. Crossfade the parts together. TD is the transition duration.
node stitch.mjs 0.5

# 6. Captions, timed against the ACTUAL composed timeline.
#    Pass the SAME TD you gave stitch.mjs -- see the traps below.
node mksrt.mjs 0.5
```

`manifest.json` is the narration source: `{ voice, notes, cues[] }`, each cue
`{ id, section, targetSeconds, text }`. Title cards are HTML in `cards/`,
rendered to 1920x1080 PNGs by `cards/make-cards.mjs`.

### Six traps, all confirmed in the source

These are the reasons to read this page rather than just the filenames.

1. **`compose.mjs` hardcodes `const CAP = 240`** — the 4:00 cap of the
   contest it was written for. Sift's caps are **180s** (WebMCP) and **300s**
   (Agents for Humans). Change it, or it enforces the wrong limit.
2. **`stitch.mjs` defaults `TD = 0.5`; `mksrt.mjs` defaults `TD = 0.6`.**
   Run both bare and the captions drift against the picture. Always pass the
   same value to both explicitly.
3. **The edit list lives inside `compose.mjs`** as an in-source array, and
   **`mksrt.mjs` regex-parses `compose.mjs`'s own source** to recover cue
   order, on top of its own hardcoded `SEG_TO_CUE` map (`mksrt.mjs:30`)
   naming that demo's exact segment filenames. Unlike `demo-kit`, this
   content is not factored into a swappable JSON list: adapting it means
   editing both scripts by hand.
4. **`record.mjs` must stop ffmpeg by writing `q` to its stdin.** Its own
   header warns that SIGKILL leaves an unplayable file. It also discovers the
   avfoundation screen index at runtime, because that index shifts when
   virtual cameras connect or disconnect; never hardcode it.
5. **`manifest.json` ships `voice.voiceId: "REPLACE_ME"`** — the real voice id
   was not preserved *there*, and `REPLACE_ME` is the only value that has ever
   existed in that file across its whole history. It is preserved here now:
   the narration voice is **`mHV5m7DLaQM0bIAP6BTK`**, recorded in
   `scripts/demo-video/manifest.json` (`voice.elevenLabsVoiceId`) so it never
   has to be fetched from the ElevenLabs UI again. (praetor's own `narrate.mjs`
   still fails until an id is supplied via `--voice` or `ELEVENLABS_VOICE_ID`.)
   The voice id is a selector, not a credential. The API **key** is the secret:
   it is read from the environment only, never written to disk, and never put
   in a manifest.
6. **`drive-ag.mjs` and `approve.mjs` import Playwright by absolute path**
   (`drive-ag.mjs:3`, `approve.mjs:2`), and `drive-ag.mjs:5` hardcodes its
   output directory. The other six scripts contain no absolute paths. Those
   two need a one-line fix each before they run anywhere else — and they
   drive Antigravity specifically, so Sift most likely does not want them at
   all.

**Captions are a sidecar, not burned in.** `narrate.mjs`/`mksrt.mjs` emit
`narration.srt`; no script in that directory burns text into pixels
(no `subtitles=`/`ass=` filter anywhere in it). Confirm what the rules for
*our* competitions require before assuming an `.srt` upload satisfies them —
that pipeline's rules explicitly accepted audio **or** subtitles, and ours may
not.

### The stills and clips kit — `praetor/tools/demo-kit/`

Separate from the video lane, and worth knowing about for screenshots and
short silent loops. Its own README's status table records the narrated-video
lane there as *"designed, not moved here"* — so it does **not** produce the
video; the directory above does.

```bash
node tools/demo-kit/survey.mjs <survey.json> --concurrency 4   # which views are worth capturing
node tools/demo-kit/shoot.mjs  <shots.json>  [--only <name>]   # retina PNG stills
node tools/demo-kit/clip.mjs   <clips.json>  [--only <name>]   # silent MP4 + WebM + poster
node tools/demo-kit/crop.mjs   <crops.json>                    # re-cut published images, no browser
node tools/demo-kit/sheet.mjs  <dir> --cols 4                  # contact sheet of a capture set
```

Every script's exit code is its failure count. The engines (`shoot`, `clip`,
`crop`, `sheet`, `lib/*`) are genuinely portable — repo-root and Playwright
discovery walk up for markers rather than assuming a layout, and there are no
absolute paths anywhere in them. What is project-specific is the **JSON
lists**, which is correct: a list is the script for one demo of one product.
Two caveats: `crop.mjs` and `sheet.mjs` require `sharp` resolved from the
**repo root** `node_modules`, and `crops/*.py` there are Strata19-specific
generators with hardcoded pixel geometry, which the kit's own portability
table does not mention.

Useful warnings from that kit that apply to any capture work here:
Playwright's `recordVideo` **draws no mouse cursor** (the kit injects a
synthetic one) and **cannot be started late** — it runs for the life of the
context, so a slow view yields a recording that is mostly spinner and must be
trimmed from a measured staging timestamp. Its output is WebM/VP8 under a
hashed filename, so transcode and rename deliberately.

### Deterministic browser scenes — aidemo v0.8.0

For ordinary browser scenes, the `browser` adapter below uses
[aidemo v0.8.0](https://github.com/tandryukha/aidemo/tree/v0.8.0): deterministic
Chrome replay, cursor animation, autozoom, narration retiming, captions, and
cards. It has been exercised end to end on this machine. **Pin the Git tag; do
not use an unpinned latest version during submission week.**

```bash
npx -y github:tandryukha/aidemo#v0.8.0 probe <demo-dir>
AIDEMO_TTS_PROVIDER=local npx -y github:tandryukha/aidemo#v0.8.0 voice <demo-dir>
npx -y github:tandryukha/aidemo#v0.8.0 captions <demo-dir> --offline
npx -y github:tandryukha/aidemo#v0.8.0 record <demo-dir> --capture native
npx -y github:tandryukha/aidemo#v0.8.0 compose <demo-dir>
```

Run the stages separately. Two recorded caveats: the tested v0.8.0 `render`
command can demand an OpenAI key even when another voice provider already
succeeded, and `doctor` reports `chrome: NOT FOUND` as a false negative —
recording works anyway.

### Driving a desktop app — `praetor/docs/hackathons/demo-tooling/CDP-AUTOMATION-FINDING.md`

If any beat needs a desktop/Electron app driven on camera, read this first.
The load-bearing conclusion: **driving and recording are separate
capabilities.** Playwright can attach to an Electron app over CDP and drive
it, but `recordVideo` only captures contexts Playwright itself created, so a
CDP-attached app must be recorded separately with `ffmpeg -f avfoundation`
running alongside the driver. The debugging port is chosen by the OS per
launch and must be rediscovered every session.

## Three capture adapters

| `sourceType` | What it proves | Capture path |
| --- | --- | --- |
| `browser` | Sift UI and persisted case behavior | aidemo storyboard |
| `host` | ChatGPT/WebMCP tool calls | WebMCP-capable host + native recording |
| `slide` | problem, architecture, closing thesis | HTML card renderer |

The master manifest is the edit decision list. Browser and host clips are
recorded separately, then the reference FFmpeg pipeline trims them to the
declared targets and lays the shared narration/captions over them.

## Rendering gate

A video is not ready until all of these are true:

- every manifest cue has a real source asset and matching narration audio;
- every selector passes an aidemo `probe` against the deployed commit;
- every host-tool expectation is visible in the captured host transcript;
- narration is never sped up to meet the cap;
- slide time remains at or below 25%;
- the output has H.264 video, AAC audio, and captions;
- `ffprobe` reports WebMCP `< 180s` and Agents for Humans `<= 300s`;
- a signed-out viewer can play the uploaded video.

