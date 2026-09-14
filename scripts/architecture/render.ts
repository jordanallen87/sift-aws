#!/usr/bin/env tsx
/**
 * Renders `scripts/architecture/layout.json` -- a hand-authored PRESENTATION
 * of the architecture diagram -- to a PNG, via an in-memory HTML page
 * screenshotted with Playwright. Run: `tsx scripts/architecture/render.ts
 * [outputPath]` (defaults to docs/architecture.png).
 *
 * Why hand-authored instead of another mermaid layout pass: mermaid's
 * auto-layout (both dagre and ELK) wastes roughly 69% of the top-left
 * quadrant and produces a tall, narrow image a judge has to scroll. The
 * `.mmd` stays the canonical SEMANTIC source (node/edge/group content,
 * shape meaning, palette); this file only decides WHERE things sit on the
 * canvas. `conformance.ts` is what keeps the two from drifting apart --
 * this file does not re-derive or validate content against the `.mmd`.
 *
 * Node shapes intentionally mirror the `.mmd`'s own vocabulary (see its
 * header comment): a plain box, a gate/decision hexagon, a datastore
 * cylinder, a double-bordered immutable artifact, and a circular actor.
 * Only `AUTHGATE` and `APPROVE` carry the source's explicit `authGate`
 * accent (`class AUTHGATE,APPROVE authGate` in the `.mmd`) -- every other
 * node uses its group's palette for its border/text only, with a white
 * card body, because in the source only the *subgraph* containers (not
 * their children) are classed with the group palettes.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// ---------------------------------------------------------------------------
// Layout schema
// ---------------------------------------------------------------------------

export interface Palette {
  fill: string;
  stroke: string;
  color: string;
  strokeWidth?: number;
}

export type NodeShape = 'box' | 'gate' | 'datastore' | 'immutable' | 'actor';
export type EdgeStyle = 'solid' | 'dashed';
export type EdgeEmphasis = 'primary' | 'normal';

export interface LayoutNode {
  id: string;
  group: string;
  label: string;
  shape: NodeShape;
  row: number;
  col: number;
  colspan?: number;
  accent?: 'authGate';
}

export interface LayoutGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  palette: string;
  cols: number;
  rows: number;
  emphasis?: boolean;
  caption?: string;
  style?: 'dashed';
}

export interface LayoutEdge {
  from: string;
  to: string;
  style: EdgeStyle;
  label: string;
  emphasis?: EdgeEmphasis;
}

export interface LayoutCanvas {
  width: number;
  height: number;
  scale: number;
}

export interface LayoutFile {
  canvas: LayoutCanvas;
  palettes: Record<string, Palette>;
  groups: LayoutGroup[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

/**
 * Loads and shape-checks layout.json. `JSON.parse` alone would let a typo'd
 * hand edit (a missing field, a number written as a string) surface as a
 * confusing NaN or `undefined.x` deep inside the geometry code instead of a
 * readable error pointing at the file.
 */
export function loadLayoutFile(path: string): LayoutFile {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: expected a JSON object at the top level.`);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of ['canvas', 'palettes', 'groups', 'nodes', 'edges']) {
    if (!(key in obj)) {
      throw new Error(`${path}: missing required top-level key "${key}".`);
    }
  }
  if (
    !Array.isArray(obj['groups']) ||
    !Array.isArray(obj['nodes']) ||
    !Array.isArray(obj['edges'])
  ) {
    throw new Error(`${path}: "groups", "nodes", and "edges" must all be arrays.`);
  }
  return obj as unknown as LayoutFile;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

const GROUP_PAD = 18;
// Wide enough that two directly-adjacent same-row nodes (e.g. PACK and
// CASEPLAN) leave room for a real visible edge between them once anchors are
// nudged off each border -- at 14px that gap collapsed to ~4px of anchor
// separation, which read as an invisible dot rather than a line.
const GRID_GAP = 22;
const GROUP_RADIUS = 16;

const HEADER_FONT = 19;
const HEADER_LINE_HEIGHT = 25;
const TAGLINE_FONT = 27;
const TAGLINE_LINE_HEIGHT = 33;
const CAPTION_FONT = 15;
const CAPTION_LINE_HEIGHT = 21;

/** Hard floor from the brief: node labels must read at >=15px at 1x. */
const NODE_FONT = 15;
const NODE_LINE_HEIGHT = 19;
const NODE_PAD_X = 14;
const NODE_PAD_Y = 12;
const EDGE_LABEL_FONT = 11;

const HUMAN_TAGLINE = 'ONLY A HUMAN CAN APPROVE';

interface GroupMetrics {
  headerLines: string[];
  headerTop: number;
  taglineLines: string[];
  taglineTop: number;
  captionLines: string[];
  captionTop: number;
  contentTop: number;
  contentHeight: number;
}

/** Average glyph width for the UI sans stack, as a fraction of font-size -- a
 * measurement heuristic (no headless-browser round trip needed to lay out
 * text) tuned against this diagram's actual label set. */
const AVG_CHAR_WIDTH = 0.56;

function estimateTextWidth(text: string, fontSizePx: number): number {
  return text.length * fontSizePx * AVG_CHAR_WIDTH;
}

function wrapSegment(segment: string, maxWidthPx: number, fontSizePx: number): string[] {
  const words = segment.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (current === '' || estimateTextWidth(candidate, fontSizePx) <= maxWidthPx) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/** Splits on the `.mmd`'s own `<br/>` breaks first (those are authored line
 * breaks, not overflow), then further wraps any segment that still would not
 * fit the box at the given font size. */
function wrapLabel(label: string, maxWidthPx: number, fontSizePx: number): string[] {
  const segments = label.split(/<br\s*\/?>/i);
  return segments.flatMap((segment) => wrapSegment(segment.trim(), maxWidthPx, fontSizePx));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Every offset here is derived from the ACTUAL wrapped line count of the
 * text that precedes it, not a fixed "assume one line" guess -- a header
 * that wraps to two lines (a narrow group with a long title, e.g. AWS's)
 * must push the caption below it down by exactly that much, or the two
 * overlap. `headerTop`/`taglineTop`/`captionTop` are relative to the
 * group's own top-left corner (the `.group` div is each child's
 * positioning context); `contentTop`/`contentHeight` are absolute canvas
 * coordinates, since `cellRect` positions node boxes on the shared canvas.
 */
function computeGroupMetrics(group: LayoutGroup): GroupMetrics {
  const innerW = group.w - 2 * GROUP_PAD;
  const headerLines = wrapLabel(group.label, innerW, HEADER_FONT);
  const headerTop = GROUP_PAD;
  let relY = GROUP_PAD + headerLines.length * HEADER_LINE_HEIGHT + 10;

  const taglineLines =
    group.emphasis === true ? wrapLabel(HUMAN_TAGLINE, innerW, TAGLINE_FONT) : [];
  const taglineTop = relY;
  if (taglineLines.length > 0) {
    relY += taglineLines.length * TAGLINE_LINE_HEIGHT + 10;
  }

  const captionLines =
    group.caption !== undefined ? wrapLabel(group.caption, innerW, CAPTION_FONT) : [];
  const captionTop = relY;
  if (captionLines.length > 0) {
    relY += captionLines.length * CAPTION_LINE_HEIGHT + 16;
  }

  const contentTop = group.y + relY;
  const contentHeight = group.y + group.h - GROUP_PAD - contentTop;
  return {
    headerLines,
    headerTop,
    taglineLines,
    taglineTop,
    captionLines,
    captionTop,
    contentTop,
    contentHeight,
  };
}

function cellRect(group: LayoutGroup, metrics: GroupMetrics, node: LayoutNode): Rect {
  const innerX = group.x + GROUP_PAD;
  const innerW = group.w - 2 * GROUP_PAD;
  const colspan = node.colspan ?? 1;
  const colW = (innerW - (group.cols - 1) * GRID_GAP) / group.cols;
  const rowH = (metrics.contentHeight - (group.rows - 1) * GRID_GAP) / group.rows;
  const x = innerX + node.col * (colW + GRID_GAP);
  const y = metrics.contentTop + node.row * (rowH + GRID_GAP);
  const w = colW * colspan + GRID_GAP * (colspan - 1);
  return { x, y, w, h: rowH };
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Point on `box`'s own perimeter facing `(towardX, towardY)`, nudged a few
 * px outward so an arrowhead lands just outside the border instead of being
 * half-swallowed by it. `t` biases the point along that side toward the
 * other box's position instead of always exiting dead-center, which is what
 * lets several edges fan into the same target node without stacking. */
function anchorPoint(box: Rect, towardX: number, towardY: number): Point {
  const c = centerOf(box);
  const dx = towardX - c.x;
  const dy = towardY - c.y;
  const nudge = 5;
  if (Math.abs(dx) * box.h > Math.abs(dy) * box.w) {
    const x = dx > 0 ? box.x + box.w + nudge : box.x - nudge;
    const t = clamp(0.5 + (dy / box.h) * 0.35, 0.14, 0.86);
    return { x, y: box.y + box.h * t };
  }
  const y = dy > 0 ? box.y + box.h + nudge : box.y - nudge;
  const t = clamp(0.5 + (dx / box.w) * 0.35, 0.14, 0.86);
  return { x: box.x + box.w * t, y };
}

// ---------------------------------------------------------------------------
// Node shape markup
// ---------------------------------------------------------------------------

interface RenderedNode {
  rect: Rect;
  html: string;
}

function getPalette(layout: LayoutFile, key: string): Palette {
  const palette = layout.palettes[key];
  if (!palette) throw new Error(`layout.json: no palette named "${key}".`);
  return palette;
}

/** How tall a node's card wants to be for its own (already-wrapped) text,
 * ignoring the grid cell it was assigned. Used two ways: to size a node
 * that is alone in its row, and -- via the row-max taken across a whole row
 * in `buildDocument` -- to give every node in that row the SAME height, so
 * e.g. the five PERSIST datastores read as one uniform row instead of each
 * shrink-wrapping to its own label length. */
function measureNaturalHeight(node: LayoutNode, cellW: number): number {
  if (node.shape === 'actor') return 0; // actor sizes itself from min(cellW, cellH); excluded from row uniformity
  const capH = node.shape === 'datastore' ? 14 : 0;
  const lines = wrapLabel(node.label, cellW - 2 * NODE_PAD_X, NODE_FONT);
  return lines.length * NODE_LINE_HEIGHT + 2 * NODE_PAD_Y + capH;
}

/** A node's white card does not have to stretch to fill its whole grid cell
 * -- only the group's background needs to fill the canvas. Sizing each card
 * to its own content (or to `rowHeight`, when the caller wants every card in
 * a row to match) and centering it in the cell is what keeps a five-column
 * datastore row or a two-node HUMAN row from turning into absurdly
 * stretched boxes. */
function renderNode(
  layout: LayoutFile,
  node: LayoutNode,
  cell: Rect,
  rowHeight?: number,
): RenderedNode {
  const group = layout.groups.find((g) => g.id === node.group);
  if (!group)
    throw new Error(`layout.json: node "${node.id}" references unknown group "${node.group}".`);
  const groupPalette = getPalette(layout, group.palette);
  const palette = node.accent !== undefined ? getPalette(layout, node.accent) : groupPalette;
  const strokeWidth = palette.strokeWidth ?? 2;

  if (node.shape === 'actor') {
    const size = clamp(Math.min(cell.w, cell.h) * 0.82, 84, 150);
    const rect: Rect = {
      x: cell.x + (cell.w - size) / 2,
      y: cell.y + (cell.h - size) / 2,
      w: size,
      h: size,
    };
    const lines = wrapLabel(node.label, size - 2 * NODE_PAD_X, NODE_FONT);
    const html = `
      <div class="node node-actor" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;
        background:${palette.fill};border-color:${palette.stroke};border-width:${strokeWidth}px;color:${palette.color};">
        <div class="node-text">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>
      </div>`;
    return { rect, html };
  }

  const capH = node.shape === 'datastore' ? 14 : 0;
  const textW = cell.w - 2 * NODE_PAD_X;
  const lines = wrapLabel(node.label, textW, NODE_FONT);
  const naturalH = rowHeight ?? lines.length * NODE_LINE_HEIGHT + 2 * NODE_PAD_Y + capH;
  const h = Math.min(naturalH, cell.h);
  const rect: Rect = { x: cell.x, y: cell.y + (cell.h - h) / 2, w: cell.w, h };

  const textHtml = `<div class="node-text">${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>`;

  if (node.shape === 'gate') {
    const html = `
      <div class="node node-gate" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;
        background:${palette.fill};border-color:${palette.stroke};border-width:${strokeWidth}px;color:${palette.color};">
        ${textHtml}
      </div>`;
    return { rect, html };
  }

  if (node.shape === 'immutable') {
    const html = `
      <div class="node node-immutable-outer" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;
        border-color:${palette.stroke};border-width:${strokeWidth}px;">
        <div class="node-immutable-inner" style="background:${palette.fill};border-color:${palette.stroke};
          border-width:${strokeWidth}px;color:${palette.color};">
          ${textHtml}
        </div>
      </div>`;
    return { rect, html };
  }

  if (node.shape === 'datastore') {
    const html = `
      <div class="node node-datastore" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;
        background:${palette.fill};border-color:${palette.stroke};border-width:${strokeWidth}px;color:${palette.color};">
        <div class="cyl-cap" style="height:${capH + strokeWidth}px;background:${palette.fill};border-color:${palette.stroke};
          border-width:${strokeWidth}px;"></div>
        ${textHtml}
      </div>`;
    return { rect, html };
  }

  const html = `
    <div class="node node-box" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;
      background:${palette.fill};border-color:${palette.stroke};border-width:${strokeWidth}px;color:${palette.color};">
      ${textHtml}
    </div>`;
  return { rect, html };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function renderGroup(layout: LayoutFile, group: LayoutGroup, metrics: GroupMetrics): string {
  const palette = getPalette(layout, group.palette);
  const strokeWidth = palette.strokeWidth ?? 2;
  const border = group.style === 'dashed' ? 'dashed' : 'solid';

  const headerHtml = metrics.headerLines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  const taglineHtml =
    metrics.taglineLines.length > 0
      ? `<div class="group-tagline" style="top:${metrics.taglineTop}px;color:${palette.stroke};">${metrics.taglineLines
          .map((l) => `<div>${escapeHtml(l)}</div>`)
          .join('')}</div>`
      : '';
  const captionHtml =
    metrics.captionLines.length > 0
      ? `<div class="group-caption" style="top:${metrics.captionTop}px;color:${palette.color};">${metrics.captionLines
          .map((l) => `<div>${escapeHtml(l)}</div>`)
          .join('')}</div>`
      : '';

  return `
    <div class="group${group.emphasis === true ? ' group-emphasis' : ''}" style="left:${group.x}px;top:${group.y}px;
      width:${group.w}px;height:${group.h}px;background:${palette.fill};border-color:${palette.stroke};
      border-width:${strokeWidth}px;border-style:${border};">
      <div class="group-header" style="top:${metrics.headerTop}px;color:${palette.color};border-color:${palette.stroke};">${headerHtml}</div>
      ${taglineHtml}
      ${captionHtml}
    </div>`;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

interface EdgeVisual {
  stroke: string;
  width: number;
  dash: string;
  marker: string;
  labelMuted: boolean;
}

function edgeVisual(edge: LayoutEdge): EdgeVisual {
  if (edge.style === 'dashed') {
    // Was #94a3b8 at 1.5px/7-6 dash: legible up close, but against a tinted
    // group fill (e.g. OBS's #fae8ff) it all but disappeared, leaving the
    // telemetry labels ("Sift domain events", ...) looking unattached to
    // anything. Darker and a touch thicker/denser keeps it visibly lighter
    // than a solid "normal" edge (#475569 @ 2px) while no longer vanishing.
    return { stroke: '#64748b', width: 2, dash: '6 4', marker: 'arrow-light', labelMuted: true };
  }
  if (edge.emphasis === 'primary') {
    return {
      stroke: '#0f172a',
      width: 3.5,
      dash: 'none',
      marker: 'arrow-primary',
      labelMuted: false,
    };
  }
  return { stroke: '#475569', width: 2, dash: 'none', marker: 'arrow-normal', labelMuted: false };
}

function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y
  );
}

/**
 * A label chip defaults to the sitting at its edge's own curve midpoint, but
 * that midpoint can land on a group's header/tagline/caption text (a chip
 * this dense a graph produces often does) or on an unrelated node it
 * happens to pass near. Rather than special-case any one collision, walk
 * outward from the base point along the curve's own perpendicular (the same
 * axis its bow already uses) until a spot clears every obstacle, trying
 * both directions at increasing distance. Falls back to the base point if
 * nothing within range is clear -- better a rare, still-legible overlap
 * than a chip flung arbitrarily far from the line it labels.
 */
function findClearChipCenter(
  baseX: number,
  baseY: number,
  chipW: number,
  chipH: number,
  nx: number,
  ny: number,
  obstacles: Rect[],
): Point {
  const offsets = [0, 26, -26, 52, -52, 78, -78, 104, -104, 130, -130, 156, -156];
  for (const t of offsets) {
    const cx = baseX + nx * t;
    const cy = baseY + ny * t;
    const rect: Rect = { x: cx - chipW / 2, y: cy - chipH / 2, w: chipW, h: chipH };
    if (!obstacles.some((o) => rectsOverlap(rect, o, 3))) {
      return { x: cx, y: cy };
    }
  }
  return { x: baseX, y: baseY };
}

function renderEdges(
  layout: LayoutFile,
  nodeRects: Map<string, Rect>,
  groupRects: Map<string, Rect>,
  groupTextZones: Rect[],
): { pathsSvg: string; labelsSvg: string; warnings: string[] } {
  const warnings: string[] = [];
  // Every node box plus every group's header/tagline/caption zone -- the two
  // kinds of things a chip must never sit on top of.
  const obstacles: Rect[] = [...nodeRects.values(), ...groupTextZones];

  function resolveBox(id: string): Rect {
    const node = nodeRects.get(id);
    if (node) return node;
    const group = groupRects.get(id);
    if (group) return group;
    throw new Error(`layout.json: edge references unknown id "${id}" (not a node or group).`);
  }

  const paths: string[] = [];
  const labels: string[] = [];

  layout.edges.forEach((edge, index) => {
    const boxA = resolveBox(edge.from);
    const boxB = resolveBox(edge.to);
    const centerA = centerOf(boxA);
    const centerB = centerOf(boxB);
    let p1 = anchorPoint(boxA, centerB.x, centerB.y);
    let p2 = anchorPoint(boxB, centerA.x, centerA.y);
    let rawDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

    // Two boxes that are adjacent in the SAME row/column (e.g. PACK next to
    // CASEPLAN) face each other across only a grid gap, so their facing-side
    // anchors collapse to a few px apart -- a quadratic curve between two
    // near-coincident points draws a tiny illegible knot, not a line.
    // Exiting both from the side perpendicular to how they're arranged
    // (bottom, for a horizontally-adjacent pair) uses each box's own width
    // for real separation instead, producing a proper visible arc.
    if (rawDist < 40) {
      const horizontallyArranged =
        Math.abs(centerB.x - centerA.x) >= Math.abs(centerB.y - centerA.y);
      const exitNudge = 6;
      p1 = horizontallyArranged
        ? { x: boxA.x + boxA.w / 2, y: boxA.y + boxA.h + exitNudge }
        : { x: boxA.x + boxA.w + exitNudge, y: boxA.y + boxA.h / 2 };
      p2 = horizontallyArranged
        ? { x: boxB.x + boxB.w / 2, y: boxB.y + boxB.h + exitNudge }
        : { x: boxB.x + boxB.w + exitNudge, y: boxB.y + boxB.h / 2 };
      rawDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = rawDist || 1;
    const nx = -dy / dist;
    const ny = dx / dist;
    const sign = index % 2 === 0 ? 1 : -1;
    // A labelled edge between two nearly-touching boxes (e.g. PACK and
    // CASEPLAN, 14px apart) has nowhere to put a multi-word chip without
    // this: the bezier's own midpoint sits right in that 14px gap, and a
    // ~190px-wide chip there can only cover both boxes' text. Forcing extra
    // bow for a short labelled edge sends the curve -- and the chip riding
    // its midpoint -- out into the group's open background instead.
    const hasLabel = edge.label.trim() !== '';
    const minBow = hasLabel && dist < 80 ? 34 : 6;
    const bow = clamp(dist * 0.1, minBow, 46) * sign;
    const midX = (p1.x + p2.x) / 2 + nx * bow;
    const midY = (p1.y + p2.y) / 2 + ny * bow;

    const visual = edgeVisual(edge);
    paths.push(
      `<path d="M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ` +
        `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}" fill="none" stroke="${visual.stroke}" ` +
        `stroke-width="${visual.width}" stroke-dasharray="${visual.dash}" marker-end="url(#${visual.marker})" />`,
    );

    if (edge.label.trim() === '') return;
    // Quadratic Bezier midpoint at t=0.5 -- the chip's default position
    // before collision resolution nudges it clear of any obstacle.
    const baseChipX = 0.25 * p1.x + 0.5 * midX + 0.25 * p2.x;
    const baseChipY = 0.25 * p1.y + 0.5 * midY + 0.25 * p2.y;
    const lines = edge.label.split(/<br\s*\/?>/i).map((l) => l.trim());
    const widest = Math.max(...lines.map((l) => estimateTextWidth(l, EDGE_LABEL_FONT)));
    const chipW = widest + 14;
    const lineH = 13;
    const chipH = lines.length * lineH + 8;
    const { x: chipX, y: chipY } = findClearChipCenter(
      baseChipX,
      baseChipY,
      chipW,
      chipH,
      nx,
      ny,
      obstacles,
    );
    const textColor = visual.labelMuted ? '#64748b' : '#1e293b';
    const borderColor = visual.labelMuted ? '#e2e8f0' : '#cbd5e1';
    const tspans = lines
      .map(
        (l, i) =>
          `<tspan x="${chipX}" dy="${i === 0 ? -((lines.length - 1) * lineH) / 2 : lineH}">${escapeHtml(l)}</tspan>`,
      )
      .join('');
    labels.push(
      `<rect x="${(chipX - chipW / 2).toFixed(1)}" y="${(chipY - chipH / 2).toFixed(1)}" width="${chipW.toFixed(1)}" ` +
        `height="${chipH.toFixed(1)}" rx="4" fill="#ffffff" fill-opacity="0.92" stroke="${borderColor}" stroke-width="1" />` +
        `<text x="${chipX}" y="${chipY + lineH / 2 - 2}" text-anchor="middle" font-size="${EDGE_LABEL_FONT}" ` +
        `font-family="ui-sans-serif, system-ui, sans-serif" fill="${textColor}">${tspans}</text>`,
    );

    if (dist < 40) {
      warnings.push(
        `edge ${edge.from} -> ${edge.to}: anchors are only ${dist.toFixed(0)}px apart.`,
      );
    }
  });

  return { pathsSvg: paths.join('\n'), labelsSvg: labels.join('\n'), warnings };
}

const MARKERS = `
  <marker id="arrow-primary" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#0f172a" />
  </marker>
  <marker id="arrow-normal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
  </marker>
  <marker id="arrow-light" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
  </marker>`;

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #canvas {
    position: relative;
    background: #ffffff;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .group {
    position: absolute;
    border-radius: ${GROUP_RADIUS}px;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }
  .group-emphasis { box-shadow: 0 4px 18px rgba(180, 83, 9, 0.28); }
  /* top offsets are set inline per group -- they depend on how many lines
     that group's own header/tagline/caption actually wrapped to, which a
     shared static rule cannot know (see computeGroupMetrics). */
  .group-header {
    position: absolute;
    left: ${GROUP_PAD}px;
    right: ${GROUP_PAD}px;
    font-size: ${HEADER_FONT}px;
    line-height: ${HEADER_LINE_HEIGHT}px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .group-tagline {
    position: absolute;
    left: ${GROUP_PAD}px;
    right: ${GROUP_PAD}px;
    font-size: ${TAGLINE_FONT}px;
    line-height: ${TAGLINE_LINE_HEIGHT}px;
    font-weight: 800;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .group-caption {
    position: absolute;
    left: ${GROUP_PAD}px;
    right: ${GROUP_PAD}px;
    font-size: ${CAPTION_FONT}px;
    line-height: ${CAPTION_LINE_HEIGHT}px;
    font-weight: 500;
  }
  .node {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: hidden;
    border-style: solid;
    font-size: ${NODE_FONT}px;
    line-height: ${NODE_LINE_HEIGHT}px;
    font-weight: 600;
    padding: ${NODE_PAD_Y}px ${NODE_PAD_X}px;
  }
  .node-box { border-radius: 10px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12); }
  .node-gate {
    clip-path: polygon(7% 0%, 93% 0%, 100% 50%, 93% 100%, 7% 100%, 0% 50%);
  }
  .node-actor { border-radius: 50%; }
  .node-immutable-outer {
    position: absolute;
    border-style: solid;
    border-radius: 12px;
    padding: 4px;
    background: #ffffff;
  }
  .node-immutable-inner {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-style: solid;
    border-radius: 7px;
    font-size: ${NODE_FONT}px;
    line-height: ${NODE_LINE_HEIGHT}px;
    font-weight: 600;
    padding: ${NODE_PAD_Y - 4}px ${NODE_PAD_X - 4}px;
    overflow: hidden;
  }
  .node-datastore {
    border-radius: 0 0 12px 12px;
    border-top: none;
    padding-top: ${NODE_PAD_Y + 12}px;
  }
  .cyl-cap {
    position: absolute;
    top: -1px;
    left: -2px;
    right: -2px;
    border-radius: 50%;
    border-style: solid;
    border-bottom: none;
  }
  .node-text { position: relative; z-index: 1; }
  svg { position: absolute; left: 0; top: 0; }
`;

function buildDocument(layout: LayoutFile): { html: string; warnings: string[] } {
  const nodeRects = new Map<string, Rect>();
  const groupRects = new Map<string, Rect>();
  const nodeHtml: string[] = [];
  const groupHtml: string[] = [];
  // The header/tagline/caption band at the top of each group -- a chip
  // resolving its position (see findClearChipCenter) must stay out of this,
  // not just off node boxes.
  const groupTextZones: Rect[] = [];

  for (const group of layout.groups) {
    groupRects.set(group.id, { x: group.x, y: group.y, w: group.w, h: group.h });
    const metrics = computeGroupMetrics(group);
    groupHtml.push(renderGroup(layout, group, metrics));
    groupTextZones.push({
      x: group.x,
      y: group.y,
      w: group.w,
      h: metrics.contentTop - group.y,
    });

    const nodesInGroup = layout.nodes.filter((n) => n.group === group.id);

    // Give every node in the same grid row the same card height (the tallest
    // one's natural need) instead of each shrinking to its own label length
    // -- otherwise a one-line "runs" cylinder ends up visibly shorter than
    // its four PERSIST siblings in the same row.
    const rowMaxHeight = new Map<number, number>();
    for (const node of nodesInGroup) {
      const cell = cellRect(group, metrics, node);
      const natural = measureNaturalHeight(node, cell.w);
      if (natural === 0) continue; // actor: sized independently, see measureNaturalHeight
      rowMaxHeight.set(node.row, Math.max(rowMaxHeight.get(node.row) ?? 0, natural));
    }

    for (const node of nodesInGroup) {
      const cell = cellRect(group, metrics, node);
      const rendered = renderNode(layout, node, cell, rowMaxHeight.get(node.row));
      nodeRects.set(node.id, rendered.rect);
      nodeHtml.push(rendered.html);
    }
  }

  const { pathsSvg, labelsSvg, warnings } = renderEdges(
    layout,
    nodeRects,
    groupRects,
    groupTextZones,
  );

  // Two SVG layers sandwich the node boxes: paths sit BELOW nodes so a line
  // visibly terminates at a box's border instead of poking out past it, and
  // label chips sit ABOVE nodes so a chip that lands near a box (dense
  // 47-edge graph, that happens a lot) is never half-hidden underneath one.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${STYLE}</style>
</head>
<body>
<div id="canvas" style="width:${layout.canvas.width}px;height:${layout.canvas.height}px;">
  ${groupHtml.join('\n')}
  <svg width="${layout.canvas.width}" height="${layout.canvas.height}">
    <defs>${MARKERS}</defs>
    <g>${pathsSvg}</g>
  </svg>
  ${nodeHtml.join('\n')}
  <svg width="${layout.canvas.width}" height="${layout.canvas.height}">
    <g>${labelsSvg}</g>
  </svg>
</div>
</body>
</html>`;

  return { html, warnings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function renderToFile(layout: LayoutFile, outputPath: string): Promise<string[]> {
  const { html, warnings } = buildDocument(layout);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: layout.canvas.width, height: layout.canvas.height },
      deviceScaleFactor: layout.canvas.scale,
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outputPath });
  } finally {
    await browser.close();
  }

  return warnings;
}

function isMain(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const layoutPath = resolve(scriptDir, 'layout.json');
  const repoRoot = resolve(scriptDir, '..', '..');
  const outputArg = process.argv[2];
  const outputPath = outputArg ? resolve(outputArg) : resolve(repoRoot, 'docs', 'architecture.png');

  const layout = loadLayoutFile(layoutPath);
  const warnings = await renderToFile(layout, outputPath);

  const finalW = layout.canvas.width * layout.canvas.scale;
  const finalH = layout.canvas.height * layout.canvas.scale;
  console.log(`[render] wrote ${outputPath} (${finalW}x${finalH}px)`);
  if (warnings.length > 0) {
    console.warn(`[render] ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }
}

if (isMain()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
