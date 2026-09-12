#!/usr/bin/env tsx
/**
 * `pnpm contact:sheet [<viewport>] [--out <file>]` — tile every Playwright
 * baseline for one viewport into a single labelled image.
 *
 * ## Why this exists
 *
 * `--update-snapshots` regenerates baselines and reports a pass count. A pass
 * count is not a look. Reviewing a regenerated set one file at a time is worse
 * still: each image looks plausible alone, and the defects that actually ship
 * are the ones only visible across the set — the same modal scrimming five
 * frames, two checkpoints that are accidentally identical, a region that went
 * blank everywhere at one width.
 *
 * This repository has already paid for that lesson twice. A ratio-tolerant
 * pixel gate left 32 stale baselines in place while reporting green, and a
 * later regeneration rewrote 83 files that nobody looked at. Both were caught
 * by accident rather than by review.
 *
 * So: one command, one image, every checkpoint for a viewport side by side,
 * each cell labelled with its own filename. Defects that hide in a sequence
 * are obvious in a grid.
 *
 * ## Usage
 *
 *   pnpm contact:sheet                     # every viewport, one sheet each
 *   pnpm contact:sheet right-pane-430      # just that viewport
 *   pnpm contact:sheet desktop-1440 --out /tmp/sheet.png
 *
 * Output lands in `artifacts/verification/contact-sheets/` by default, which
 * is already git-ignored — these are review aids, not evidence to check in.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const SNAPSHOT_ROOT = 'tests/e2e';
const DEFAULT_OUT_DIR = 'artifacts/verification/contact-sheets';

/** Every viewport project name that appears in a baseline filename. */
const VIEWPORTS = [
  'right-pane-390',
  'right-pane-430',
  'right-pane-480',
  'chatgpt-pane-640',
  'expanded-820',
  'desktop-1440',
] as const;

function collectBaselines(viewport: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('-snapshots')) continue;
    const dir = join(SNAPSHOT_ROOT, entry.name);
    for (const file of readdirSync(dir)) {
      if (file.endsWith(`-${viewport}-darwin.png`)) found.push(join(dir, file));
    }
  }
  return found.sort();
}

/**
 * Each cell is labelled with the spec directory AND the checkpoint name,
 * because the same checkpoint name (`seeded-case`) exists in three different
 * journeys and an unlabelled grid would make them indistinguishable.
 */
function cellLabel(path: string): string {
  const spec = basename(path.replace(/\/[^/]+$/, '')).replace('.spec.ts-snapshots', '');
  const shot = basename(path).replace(/-[a-z0-9-]+-darwin\.png$/, '');
  return `${spec}: ${shot}`;
}

function buildSheet(viewport: string, outFile: string): boolean {
  const baselines = collectBaselines(viewport);
  if (baselines.length === 0) {
    console.log(`[contact-sheet] ${viewport}: no baselines found`);
    return false;
  }

  // `montage` labels each tile with the text supplied per input, so the grid
  // is self-describing rather than requiring a separate index to read it.
  const args: string[] = [];
  for (const file of baselines) {
    args.push('-label', cellLabel(file), file);
  }
  args.push(
    '-tile',
    '6x',
    // A fixed cell width keeps a 390px pane and a 1440px desktop legible in
    // the same grid; height is free so nothing is cropped away unseen.
    '-geometry',
    '320x+8+8',
    '-background',
    '#1b1b1b',
    '-fill',
    '#f5f5f5',
    '-pointsize',
    '13',
    outFile,
  );

  execFileSync('montage', args, { stdio: 'inherit' });
  console.log(`[contact-sheet] ${viewport}: ${String(baselines.length)} baselines -> ${outFile}`);
  return true;
}

function main(): void {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf('--out');
  const explicitOut = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const requested = argv.filter((arg, index) => {
    if (arg.startsWith('--')) return false;
    if (outIndex >= 0 && index === outIndex + 1) return false;
    return true;
  });

  const viewports: readonly string[] = requested.length > 0 ? requested : VIEWPORTS;
  for (const viewport of viewports) {
    if (!VIEWPORTS.includes(viewport as (typeof VIEWPORTS)[number])) {
      throw new Error(`Unknown viewport "${viewport}". Known: ${VIEWPORTS.join(', ')}`);
    }
  }

  const outDir = DEFAULT_OUT_DIR;
  if (explicitOut === undefined && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  let built = 0;
  for (const viewport of viewports) {
    const outFile = explicitOut ?? join(outDir, `${viewport}.png`);
    if (buildSheet(viewport, outFile)) built += 1;
  }
  if (built === 0) throw new Error('No contact sheets were produced.');
}

main();
