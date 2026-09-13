# ADR 0001: Hackathon Heroes, Decision Packs, Adaptability, Storage, Deployment, and Runtime Inspection

Status: accepted  
Date: 2026-08-26

## Context

Sift must be completed quickly, work inside ChatGPT's narrow browser pane, produce two differentiated hackathon stories, persist on Railway, and provide enough evidence to debug adaptive Strands behavior. The original repair-versus-replace demo was not compelling to the project owner. Railway CLI authentication is available.

## Decisions

1. **WebMCP hero:** Replace the repair demo with **Choose Our Next Car**, a household shortlist and dealer-offer diligence workspace that supports manually entered real candidates and a deterministic fictional fixture.
2. **AWS hero:** Retain **Home Energy Guardian** as the background adaptive Strands Swarm demo.

   > **Superseded on 2026-09-07 by [ADR 0017](./0017-bid-comparison-professional-agents-hero.md).**
   > The Agents for Humans hero changed to **Bid Comparison**, and the recommended competition
   > track changed from Everyday Agents to Professional Agents. Home Energy Guardian was not
   > removed -- it stays registered, tested, and shipped as a second demo -- but it is no longer
   > the submission hero. This decision is recorded as written because it is what was decided on
   > 2026-08-26; see ADR 0017 for the reasoning behind the change.
3. **Canonical storage:** Use SQLite with `better-sqlite3` and Drizzle migrations. Persist canonical case events/snapshots, replayable sanitized public activity, runs, idempotency records, and sanitized runtime events. Use JSONL only for exported verification bundles.
4. **Railway:** The autonomous build must create and deploy a new project/service through the authenticated CLI, attach `/data`, create a public domain, and verify SQLite persistence across restart.
5. **Observability:** Build a first-class right-pane Runtime Inspector from native Strands hooks and OpenTelemetry plus Sift domain events. Keep it detailed, correlated, filterable, and exportable while redacting secrets, private notes, and private reasoning.
6. **Scale boundary:** Run one writable Railway application replica for the hackathon. If horizontal write scaling becomes necessary, replace the storage adapter with PostgreSQL rather than introducing PGlite.
7. **Extension unit:** Call each vertical a **Sift Decision Pack**. Cases pin pack ID, semantic version, and compiled hash. Models generate and revise bounded case-specific run plans; they do not rewrite installed packs during execution.
8. **Adaptable data:** Keep Zod at every trust boundary, but model domain data through a typed attribute-value protocol plus pack-defined and case-defined definitions. Users may add `custom.*` criteria, attributes, and evidence questions without changing required obligations, capabilities, or authority policies.
9. **Pack authoring:** Include a real developer-mode `pack-authoring` Strands skill and compiler/conformance workflow. It produces non-executable declarative drafts and requires explicit human publication. Keep it disabled in the unauthenticated public deployment.
10. **Real-time UX:** Treat ordered command-correlated SSE activity, replay/reconnect, resync, and polling equivalence as foundational architecture. The page may display progress only when a real persisted or normalized event supports it.

## Consequences

- The car demo requires editable candidates, deal normalization, ownership-cost assumptions, household criteria, and explicit test-drive unknowns.
- SQLite gives local/deployed parity and simple transactional persistence but precludes multiple writable Railway replicas in this version.
- The Runtime Inspector becomes part of product acceptance and both demo videos, not a post-build engineering tool.
- AgentCore remains the AWS execution/observability target; canonical case ownership stays with Railway.
- The two hero packs demonstrate different orchestration envelopes: a compiled Graph for car purchase and a bounded Swarm for energy.
- Generic UI and WebMCP contracts operate on options, typed attributes, criteria, evidence, and cases; pack-specific labels and fields come from compiled presentation metadata.
- A no-code pack can reuse the installed capability catalog. New executable tools remain developer-reviewed application code.
