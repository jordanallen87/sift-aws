/**
 * Shared shapes for the Agents for Humans demo video pipeline, plus the
 * manifest loader.
 *
 * The manifest (`manifest.json`) is the narration source of truth. Every line
 * in it is spoken, captioned, and timed from its own measured audio file, so
 * the captions cannot drift against the voice track: there is no separately
 * maintained timing sheet to fall out of step.
 *
 * `docs/hackathons/demo-tooling/README.md` records why this pipeline does not
 * reuse the reference one verbatim -- that one keeps its edit list inside
 * `compose.mjs` and regex-parses it back out in `mksrt.mjs`, which is the trap
 * this file exists to avoid.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_DIR = dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = join(process.cwd(), 'artifacts/demo-video');
export const TAKE_DIR = join(OUT_DIR, 'take');
export const AUDIO_DIR = join(OUT_DIR, 'audio');
export const PANEL_DIR = join(OUT_DIR, 'panels');
export const SEGMENT_DIR = join(OUT_DIR, 'segments');

export interface Canvas {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export interface Voice {
  readonly provider: 'say' | 'elevenlabs';
  readonly sayVoice: string;
  readonly sayRateWpm: number;
  readonly elevenLabsVoiceId: string;
}

export interface Timing {
  readonly leadInSeconds: number;
  readonly lineGapSeconds: number;
  readonly tailSeconds: number;
  readonly cardSeconds: number;
}

export interface Card {
  readonly kicker: string;
  readonly title: string;
  readonly subtitle: string;
}

export interface Beat {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  /** Floor for the finished segment, so an action stays legible even when the narration is short. */
  readonly minSeconds: number;
  readonly lines: readonly string[];
  /** A beat with no product footage: the visual is a still exhibit read from this repo-relative path. */
  readonly still?: {
    readonly kind: 'image' | 'code';
    readonly path: string;
    /** 1-based inclusive line range, for showing the one block that proves the claim. */
    readonly lines?: readonly [number, number];
  };
}

export interface Manifest {
  readonly schemaVersion: number;
  readonly project: string;
  readonly hackathon: string;
  readonly track: string;
  readonly hardCapSeconds: number;
  readonly canvas: Canvas;
  readonly pane: { readonly width: number; readonly height: number };
  readonly voice: Voice;
  readonly timing: Timing;
  readonly titleCard: Card;
  readonly closeCard: Card;
  readonly beats: readonly Beat[];
}

/** One beat's footage inside the continuous take, in milliseconds from the first video frame. */
export interface Mark {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface Timeline {
  readonly recordedAt: string;
  readonly video: string;
  readonly paneWidth: number;
  readonly paneHeight: number;
  readonly marks: readonly Mark[];
  /** Counts read off the running product, for checking the narration's numbers. */
  readonly observed: Record<string, string>;
}

export function loadManifest(): Manifest {
  const raw = readFileSync(join(DEMO_DIR, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as Manifest;
  if (manifest.beats.length === 0) throw new Error('manifest declares no beats');
  return manifest;
}

export function loadTimeline(): Timeline {
  return JSON.parse(readFileSync(join(TAKE_DIR, 'timeline.json'), 'utf8')) as Timeline;
}
