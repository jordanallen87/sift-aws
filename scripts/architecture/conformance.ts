#!/usr/bin/env tsx
/**
 * Guards against `scripts/architecture/layout.json` (the hand-authored
 * PRESENTATION) silently drifting from `docs/architecture.mmd` (the
 * canonical, audited SEMANTIC source). Run: `tsx
 * scripts/architecture/conformance.ts` -- exits non-zero and prints every
 * difference if the two have diverged.
 *
 * Parses `docs/architecture.mmd` with the exact same regexes used to
 * originally extract its content (node/edge/subgraph shape), so this stays
 * a mechanical diff against the source of truth rather than a second,
 * possibly-drifting understanding of it. One deliberate consequence of
 * reusing those regexes: `matchAll` never returns overlapping matches, so a
 * mermaid statement that chains several arrows on one line (`ROUTE -->
 * OBLIG --> EVID --> READY`) only yields edges from its first and last
 * identifiers outward (`ROUTE->OBLIG`, `EVID->READY`) -- an inner link like
 * `OBLIG->EVID` is consumed as part of matching the edge before it and never
 * produces a second match. layout.json was hand-authored against this same
 * extraction, so a chained-line edge this parser cannot see is correctly
 * absent from both sides and never flagged as missing.
 *
 * Two ids in the `.mmd` are also legitimately edge endpoints in their own
 * right, not just node ids: `STRANDS` and `HUMAN` are subgraph (group) ids
 * that several edges point at directly (e.g. `LOCALEXEC --> STRANDS`,
 * `READY --> HUMAN`) to mean "enters this subsystem/boundary as a whole,"
 * not any specific node inside it. This checker treats a group id as a
 * valid edge endpoint alongside node ids for exactly that reason.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLayoutFile, type LayoutFile } from './render.js';

// ---------------------------------------------------------------------------
// Parsing (mirrors the extraction regexes docs/architecture.mmd was dumped
// with -- see this file's header comment for why that matters).
// ---------------------------------------------------------------------------

interface ParsedEdge {
  from: string;
  to: string;
}

interface ParsedMermaid {
  subgraphs: Map<string, string>;
  /** Includes subgraph ids too (the node regex also matches a subgraph's
   * own `ID["label"]` header) -- callers must subtract `subgraphs` to get
   * real node ids. */
  nodes: Map<string, string>;
  edges: ParsedEdge[];
}

const SUBGRAPH_RE = /subgraph\s+([A-Z][A-Z0-9]*)\["(.+?)"\]/g;
const NODE_RE = /\b([A-Z][A-Z0-9]*)\s*(\[\[|\[\(|\(\(|\{\{|\[)([\s\S]+?)(\]\]|\)\]|\)\)|\}\}|\])/g;
const EDGE_RE = /\b([A-Z][A-Z0-9]*)\s*(-->|-\.->)\s*(?:\|"?([\s\S]*?)"?\|)?\s*([A-Z][A-Z0-9]*)/g;

function stripQuotes(s: string): string {
  return s.replace(/^"+/, '').replace(/"+$/, '');
}

export function parseMermaid(source: string): ParsedMermaid {
  const startIdx = source.indexOf('flowchart TD');
  if (startIdx === -1) {
    throw new Error(
      'docs/architecture.mmd: could not find "flowchart TD" -- is this the right file?',
    );
  }
  // Drop comment lines before matching so a commented-out edge/node example
  // in the header notes can never be mistaken for real graph content.
  const body = source.slice(startIdx).replace(/^[ \t]*%%.*$/gm, '');

  const subgraphs = new Map<string, string>();
  for (const m of body.matchAll(SUBGRAPH_RE)) {
    const id = m[1];
    const label = m[2];
    if (id !== undefined && label !== undefined) subgraphs.set(id, label);
  }

  const nodes = new Map<string, string>();
  for (const m of body.matchAll(NODE_RE)) {
    const id = m[1];
    const rawLabel = m[3];
    if (id === undefined || rawLabel === undefined) continue;
    nodes.set(id, stripQuotes(rawLabel.trim()));
  }

  const edges: ParsedEdge[] = [];
  for (const m of body.matchAll(EDGE_RE)) {
    const from = m[1];
    const to = m[4];
    if (from === undefined || to === undefined) continue;
    edges.push({ from, to });
  }

  return { subgraphs, nodes, edges };
}

/** `<br/>` (any of its HTML spellings) counts as whitespace for comparison,
 * same as every other run of whitespace -- only the words in a label matter
 * here, not where its author chose to break the line. */
function normalizeLabel(label: string): string {
  return label
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ConformanceIssue {
  kind:
    | 'missing-group'
    | 'extra-group'
    | 'group-label-mismatch'
    | 'missing-node'
    | 'extra-node'
    | 'node-label-mismatch'
    | 'missing-edge'
    | 'extra-edge';
  detail: string;
}

export interface ConformanceReport {
  ok: boolean;
  issues: ConformanceIssue[];
}

function edgeKey(from: string, to: string): string {
  return `${from} -> ${to}`;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function checkConformance(mmdSource: string, layout: LayoutFile): ConformanceReport {
  const parsed = parseMermaid(mmdSource);
  const issues: ConformanceIssue[] = [];

  // --- groups -------------------------------------------------------------
  const mmdGroupIds = new Set(parsed.subgraphs.keys());
  const layoutGroupIds = new Set(layout.groups.map((g) => g.id));

  for (const id of mmdGroupIds) {
    if (!layoutGroupIds.has(id)) {
      issues.push({
        kind: 'missing-group',
        detail: `"${id}" is a subgraph in docs/architecture.mmd but has no group in layout.json`,
      });
    }
  }
  for (const id of layoutGroupIds) {
    if (!mmdGroupIds.has(id)) {
      issues.push({
        kind: 'extra-group',
        detail: `"${id}" is a group in layout.json but not a subgraph in docs/architecture.mmd`,
      });
    }
  }
  for (const group of layout.groups) {
    const mmdLabel = parsed.subgraphs.get(group.id);
    if (mmdLabel !== undefined && normalizeLabel(mmdLabel) !== normalizeLabel(group.label)) {
      issues.push({
        kind: 'group-label-mismatch',
        detail: `group "${group.id}": mmd label "${mmdLabel}" != layout.json label "${group.label}"`,
      });
    }
  }

  // --- nodes ----------------------------------------------------------------
  // The node regex also matches every subgraph's own `ID["label"]` header,
  // so real node ids are everything it found minus the subgraph ids.
  const mmdNodeIds = new Set([...parsed.nodes.keys()].filter((id) => !mmdGroupIds.has(id)));
  const layoutNodeIds = new Set(layout.nodes.map((n) => n.id));

  for (const id of mmdNodeIds) {
    if (!layoutNodeIds.has(id)) {
      issues.push({
        kind: 'missing-node',
        detail: `node "${id}" is in docs/architecture.mmd but missing from layout.json`,
      });
    }
  }
  for (const id of layoutNodeIds) {
    if (!mmdNodeIds.has(id)) {
      issues.push({
        kind: 'extra-node',
        detail: `node "${id}" is in layout.json but not in docs/architecture.mmd`,
      });
    }
  }
  for (const node of layout.nodes) {
    const mmdLabel = parsed.nodes.get(node.id);
    if (mmdLabel === undefined) continue; // already reported above as missing-node
    if (normalizeLabel(mmdLabel) !== normalizeLabel(node.label)) {
      issues.push({
        kind: 'node-label-mismatch',
        detail: `node "${node.id}": mmd label "${mmdLabel}" != layout.json label "${node.label}"`,
      });
    }
  }

  // --- edges ------------------------------------------------------------
  // Compared as multisets (not sets) so a duplicated edge on one side that
  // is only present once on the other cannot silently cancel out.
  const mmdEdgeCounts = countBy(parsed.edges, (e) => edgeKey(e.from, e.to));
  const layoutEdgeCounts = countBy(layout.edges, (e) => edgeKey(e.from, e.to));
  const allEdgeKeys = new Set([...mmdEdgeCounts.keys(), ...layoutEdgeCounts.keys()]);

  for (const key of allEdgeKeys) {
    const mmdCount = mmdEdgeCounts.get(key) ?? 0;
    const layoutCount = layoutEdgeCounts.get(key) ?? 0;
    if (mmdCount > layoutCount) {
      issues.push({
        kind: 'missing-edge',
        detail: `edge "${key}" appears ${mmdCount}x in docs/architecture.mmd but ${layoutCount}x in layout.json`,
      });
    } else if (layoutCount > mmdCount) {
      issues.push({
        kind: 'extra-edge',
        detail: `edge "${key}" appears ${layoutCount}x in layout.json but ${mmdCount}x in docs/architecture.mmd`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printReport(report: ConformanceReport): void {
  if (report.ok) {
    console.log(
      '[conformance] layout.json matches docs/architecture.mmd — nothing missing, nothing extra.',
    );
    return;
  }
  console.error(
    `[conformance] ${report.issues.length} difference(s) between docs/architecture.mmd and layout.json:\n`,
  );
  for (const issue of report.issues) {
    console.error(`  [${issue.kind}] ${issue.detail}`);
  }
  console.error(
    '\nFix layout.json (or, if the .mmd changed intentionally, update layout.json to match).',
  );
}

function isMain(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, '..', '..');
  const mmdSource = readFileSync(resolve(repoRoot, 'docs', 'architecture.mmd'), 'utf8');
  const layout = loadLayoutFile(resolve(scriptDir, 'layout.json'));

  const report = checkConformance(mmdSource, layout);
  printReport(report);
  process.exitCode = report.ok ? 0 : 1;
}
