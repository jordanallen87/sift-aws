# WebMCP Demo Production Checklist

Status: pre-capture. Live and host recordings are intentionally blocked until
the application finalization pass is complete and capture is explicitly
authorized.

## Narrative and submission materials

- [x] Draft a narration-led story: payoff, system contract, WebMCP co-driving,
  adaptive interaction, Strands investigation, trace proof, human authority,
  and close. Human approval is still required before recording.
- [ ] Replace the current cue-level story with an approved narration-led
  storyline: payoff, system contract, WebMCP co-driving, adaptive Strands
  investigation, trace proof, human authority, close.
- [ ] Keep one spoken claim paired with one visible proof.
- [ ] Verify every technical claim against the deployed build and a real
  WebMCP-capable host before recording.
- [ ] Keep explanatory visuals under 25% of the finished WebMCP video.
- [ ] Produce a screenshot list, Devpost write-up draft, video description,
  and public-link checklist separately from the video assets.

## Timing and motion system

- [ ] Generate one narration file per cue using ElevenLabs' timing endpoint.
- [x] Convert returned character alignments into normalized phrase markers and
  30fps frame offsets.
- [ ] Make diagrams, callouts, focus moves, blur, captions, and cuts address
  phrase markers rather than hand-maintained absolute times.
- [ ] Retain cue-level fallbacks so a changed sentence does not require a
  complete re-record.
- [ ] Respect reduced-motion settings in generated explanatory visuals.

## Reusable Demo Studio code

- [x] Add a Sift-independent `@sift/demo-studio` manifest schema and semantic
  validator.
- [x] Add unit tests for timing, annotation ranges, safe areas, segment
  continuity, source adapters, and duration caps.
- [x] Add a timing compiler that accepts ElevenLabs alignment data and resolves
  phrase or word anchors to frame ranges.
- [x] Add the first deterministic annotation renderer without reimplementing
  aidemo browser capture. The architecture-flow renderer remains next.
- [ ] Generate deterministic edit-plan inputs; never overwrite an approved
  recording.
- [ ] Document the package public API, command flow, and portability boundary.

## Product proof and capture gate

- [ ] Confirm the real host transcript visibly shows WebMCP tool calls.
- [ ] Confirm Sift visibly changes the same durable case state the host reads.
- [ ] Confirm the dynamic workspace configuration, typed case attribute,
  investigation, trace correlation, and human-only approval sequence work in
  one deterministic fixture path.
- [ ] Add or improve the trace-backed Run Map only when the final product work
  is available and its events can be honestly demonstrated.
- [ ] Validate the deployed commit, selectors, audio, captions, visual safe
  areas, codec, duration, and signed-out playback before upload.

## Documentation verification

- [x] Update `docs/hackathons/demo-tooling/README.md` when the timing contract
  becomes implemented.
- [ ] Update both demo manifests and their runbooks as the renderer's schema
  becomes concrete.
- [x] Update `docs/specs/demos-and-submission.md` with the production flow and
  capture prerequisites. — done 2026-09-10: a "Capture and render toolchain"
  section there points at `../hackathons/demo-tooling/README.md`, which now
  carries the verified commands, prerequisites and traps for both praetor
  toolchains.
