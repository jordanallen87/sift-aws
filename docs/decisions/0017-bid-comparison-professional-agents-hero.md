# ADR 0017: Bid Comparison Becomes the Agents for Humans Hero, Track Changes to Professional Agents

Status: accepted
Date: 2026-09-07

## Context

ADR 0001 selected Home Energy Guardian as the AWS/Strands-first hackathon hero and recommended the
Everyday Agents track. `docs/bid-comparison/prior-art.md` (researched 2026-09-06) corrected an
earlier assumption that bid comparison was a green field: a real, competitive AI bid-leveling
market already exists for commercial general contractors (MeltPlan, Struvia, Buildr, Procore, and
others), and it is called "table stakes for competitive preconstruction teams" in 2026. The same
research located the segment that market genuinely does not serve: every incumbent targets
mid-size to large commercial general contractors inside a preconstruction workflow, and none serve
the homeowner with three quotes or the two-to-ten-person trade shop that cannot justify a
preconstruction platform.

`docs/submissions/agents-for-humans/requirements-checklist.md`'s track-qualification entry (added
the same day) reasons from the two tracks' own text: Professional Agents asks for "an agent that
makes someone dramatically better at the work they already do -- professionals, makers, creators,
small-business owners" doing "repetitive, judgment-heavy tasks that eat their day," and names no
autonomy requirement at all. Comparing subcontractor bids is exactly that task, and the segment
`prior-art.md` identifies as unserved is exactly the "small-business owners" the track names. A
scenario built around an institutional buyer (a school district's own procurement office, for
example) would instead land inside the segment the incumbents already serve, forfeiting the
differentiation the track claim depends on -- so the scenario's buyer, Meridian Builders, is
deliberately a nine-person general contractor with no estimating department, not the property
owner.

`docs/bid-comparison/strands-feature-map.md` separately confirmed the retarget would not cost
Strands technical depth: the bid pack matches Home Energy Guardian's Swarm, AgentSkills, Context
Injector, and intervention coverage feature-for-feature, and is measurably *stronger* on one axis
(GoalLoop rejects a synthesis draft for a structural reason -- unnormalized scope -- rather than a
missing citation).

## Decision

1. **The Agents for Humans hero changes from Home Energy Guardian to Bid Comparison**, effective
   2026-09-07. This supersedes ADR 0001's decision 2 ("AWS hero: Retain Home Energy Guardian").
2. **The recommended competition track changes from Everyday Agents to Professional Agents**,
   because the hero scenario -- a small general contractor comparing subcontractor bids -- is a
   professional, judgment-heavy task performed by a small-business owner, not a household errand.
3. **Home Energy Guardian is not removed.** It stays registered, tested, and shipped as a second
   demo, and keeps the property Bid Comparison structurally lacks -- opening its own case from a
   bill feed with nobody asking, which the Everyday Agents track text describes almost verbatim.
   It remains available as a versatility beat if time allows, but it is no longer the submission's
   primary evidence for Technological Implementation or Potential Impact.
4. **Choose Our Next Car and the WebMCP Challenge submission are unaffected.** This ADR only
   changes the Agents for Humans hero and track.

## Consequences

- `docs/decisions/0001-hackathon-runtime-storage-and-heroes.md` decision 2 is annotated in place
  with a pointer to this ADR rather than rewritten; ADR 0001 continues to accurately record what
  was decided on 2026-08-26.
- `docs/submissions/agents-for-humans/requirements-checklist.md` and
  `docs/specs/demos-and-submission.md` were reconciled to the new hero on 2026-09-13 (commit
  `b0dbf22`) -- the video beats, required sequence, and track-qualification checks now describe and
  verify Bid Comparison rather than Home Energy Guardian.
- No demo video exists yet for Bid Comparison. `docs/submissions/agents-for-humans/demo-script-bid.md`
  is the shot list to record from; nothing in this ADR should be read as claiming a recording, a
  deployment, or a passing gate that does not yet exist.
- Every other document that names Home Energy Guardian as a shipped pack, as the subject of its
  own demo script, or as WebMCP-era history remains accurate and is unaffected by this decision.
