/**
 * Stage 2 of the demo video: turn one continuous take plus a narration
 * manifest into the finished 1920x1080 submission file.
 *
 * The ordering principle is that **the voice is the master clock**. Every line
 * in the manifest is synthesized separately and measured, the beat's audio is
 * assembled from those measured pieces, and only then is the beat's footage
 * retimed to fit. That is why the captions cannot drift: each caption window is
 * computed from the same measured durations that produced the audio, rather
 * than from a separate timing sheet that has to be kept in step by hand.
 *
 * Footage is only ever sped up or trimmed to fit, never slowed -- `record.ts`
 * deliberately films each beat longer than its narration needs, because slowed
 * footage reads as a stutter and a viewer notices it immediately.
 *
 * Narration provider is pluggable. With no key this uses macOS `say`, which is
 * offline, deterministic and free; with ELEVENLABS_API_KEY set and a voice id
 * supplied it uses ElevenLabs instead and nothing else about the pipeline
 * changes. The key is read from the environment only and never written to disk.
 */
import { chromium, type Browser } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  AUDIO_DIR,
  loadManifest,
  loadTimeline,
  OUT_DIR,
  PANEL_DIR,
  SEGMENT_DIR,
  type Beat,
  type Card,
  type Manifest,
} from './manifest.js';

const CANVAS = { width: 1920, height: 1080 } as const;
const PANE = { x: 1299, y: 40, width: 511, height: 1000 } as const;
const LEFT = { x: 110, y: 520, width: 1110, height: 430 } as const;
/** Where a still beat's exhibit (image or code) is centred, and where its caption sits below it. */
const STILL_BOX = { x: 210, y: 316, width: 1500, height: 520 } as const;
const STILL_CAPTION = { x: 210, y: 880, width: 1500, height: 150 } as const;
const RADIUS = 26;
/** Headroom kept under the hard cap so rounding never lands us on it. */
const CAP_MARGIN_SECONDS = 4;
/** Caption dissolve, and the film's open and close. Kept here so the three read together. */
const CAPTION_FADE = 0.18;
const OPEN_FADE = 0.6;
const CLOSE_FADE = 0.9;

const INK = '#0B1512';
const TEXT = '#F4F7F5';
const MUTED = '#93A79E';
const ACCENT = '#4FB08A';
const RULE = '#1E2E28';
const FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";

interface Line {
  readonly text: string;
  readonly audio: string;
  readonly seconds: number;
}

interface PlannedBeat {
  readonly beat: Beat;
  readonly lines: readonly Line[];
  readonly audio: string;
  /** Measured length of the assembled narration, the floor a beat can never go below. */
  readonly voiceSeconds: number;
  /** Caption windows relative to the start of this beat's segment. */
  readonly windows: readonly { readonly from: number; readonly to: number }[];
  readonly seconds: number;
}

/** Beats sharing a number are one numbered beat, split to track the footage. */
function groupCount(manifest: Manifest): number {
  return new Set(manifest.beats.map((beat) => beat.number)).size;
}

function ffmpeg(args: readonly string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function probeSeconds(file: string): number {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  return Number.parseFloat(out.toString().trim());
}

/** Hyphen separators are kinder to a speech synthesizer; an em dash is kinder to a reader. */
function forDisplay(text: string): string {
  return text.replace(/ - /g, ' — ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- narration

function resolvedVoiceId(manifest: Manifest): string {
  return process.env['ELEVENLABS_VOICE_ID'] ?? manifest.voice.elevenLabsVoiceId;
}

/** True only when the ElevenLabs path will actually be taken this run. */
function usesElevenLabs(manifest: Manifest): boolean {
  return (
    manifest.voice.provider === 'elevenlabs' &&
    process.env['ELEVENLABS_API_KEY'] !== undefined &&
    resolvedVoiceId(manifest) !== ''
  );
}

async function speak(manifest: Manifest, text: string, out: string): Promise<void> {
  const key = process.env['ELEVENLABS_API_KEY'];
  const voiceId = resolvedVoiceId(manifest);
  if (usesElevenLabs(manifest) && key !== undefined) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      },
    );
    if (!response.ok) throw new Error(`elevenlabs ${String(response.status)}`);
    const mp3 = join(AUDIO_DIR, 'tmp.mp3');
    writeFileSync(mp3, Buffer.from(await response.arrayBuffer()));
    ffmpeg(['-i', mp3, '-ar', '48000', '-ac', '2', out]);
    rmSync(mp3, { force: true });
    return;
  }
  const aiff = join(AUDIO_DIR, 'tmp.aiff');
  execFileSync('say', [
    '-v',
    manifest.voice.sayVoice,
    '-r',
    String(manifest.voice.sayRateWpm),
    '-o',
    aiff,
    text,
  ]);
  // A touch of high-pass and gentle compression: `say` is dry and thin, and a
  // demo played through laptop speakers needs the midrange lifted.
  ffmpeg([
    '-i',
    aiff,
    '-af',
    'highpass=f=85,acompressor=threshold=-18dB:ratio=3:attack=8:release=180,loudnorm=I=-15:TP=-1.5:LRA=11',
    '-ar',
    '48000',
    '-ac',
    '2',
    out,
  ]);
  rmSync(aiff, { force: true });
}

async function narrate(manifest: Manifest): Promise<PlannedBeat[]> {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const planned: PlannedBeat[] = [];
  const { leadInSeconds, lineGapSeconds, tailSeconds } = manifest.timing;

  for (const beat of manifest.beats) {
    const lines: Line[] = [];
    for (const [index, text] of beat.lines.entries()) {
      // The cache key carries the line's own text AND the voice that spoke it.
      // Keying on the index alone would keep stale audio after a rewording --
      // the captions would read the new line while the voice spoke the old one
      // -- and keying on text alone would let a `say` take survive a switch to
      // ElevenLabs, rendering the whole film in the fallback voice silently.
      // Mirrors `speak`'s own condition, not just the declared provider: with
      // `elevenlabs` declared but no key present the run silently falls back to
      // `say`, and a key that claimed ElevenLabs would then pin that fallback
      // take in place for the real render.
      const voiceKey = usesElevenLabs(manifest)
        ? `elevenlabs:${resolvedVoiceId(manifest)}`
        : `say:${manifest.voice.sayVoice}:${String(manifest.voice.sayRateWpm)}`;
      const key = createHash('sha1').update(`${voiceKey}\n${text}`).digest('hex').slice(0, 10);
      const out = join(AUDIO_DIR, `${beat.id}-${String(index).padStart(2, '0')}-${key}.wav`);
      if (!existsSync(out)) await speak(manifest, text, out);
      lines.push({ text, audio: out, seconds: probeSeconds(out) });
    }

    const spoken = lines.reduce((sum, line) => sum + line.seconds, 0);
    const audioSeconds = leadInSeconds + spoken + lineGapSeconds * (lines.length - 1) + tailSeconds;
    const seconds = Math.max(audioSeconds, beat.minSeconds);
    // A beat held open for its action has slack beyond the narration. Splitting
    // it across both ends gives the viewer a moment to read the new screen
    // before the voice starts; banking all of it at the end instead produced a
    // five-second dead stop in the middle of the video.
    const slack = seconds - audioSeconds;
    const lead = leadInSeconds + slack * 0.55;
    const tail = tailSeconds + slack * 0.45;

    // Caption windows: a line stays up through the pause that follows it, so
    // the panel never blinks empty between sentences.
    const windows: { from: number; to: number }[] = [];
    let cursor = lead;
    for (const [index, line] of lines.entries()) {
      const from = index === 0 ? 0 : cursor;
      cursor += line.seconds;
      const last = index === lines.length - 1;
      const to = last ? seconds : cursor + lineGapSeconds;
      windows.push({ from, to });
      cursor += lineGapSeconds;
    }

    const audio = join(AUDIO_DIR, `${beat.id}.wav`);
    const inputs: string[] = [];
    const labels: string[] = [];
    let stream = 0;
    const silence = (dur: number): void => {
      inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
      labels.push(`[${String(stream)}:a]`);
      stream += 1;
    };
    silence(lead);
    for (const [index, line] of lines.entries()) {
      inputs.push('-i', line.audio);
      labels.push(`[${String(stream)}:a]`);
      stream += 1;
      if (index < lines.length - 1) silence(lineGapSeconds);
    }
    silence(tail);
    ffmpeg([
      ...inputs,
      '-filter_complex',
      `${labels.join('')}concat=n=${String(labels.length)}:v=0:a=1[a]`,
      '-map',
      '[a]',
      '-ar',
      '48000',
      '-ac',
      '2',
      audio,
    ]);

    planned.push({ beat, lines, audio, windows, seconds, voiceSeconds: audioSeconds });
    console.log(
      `  ${beat.id}: ${String(lines.length)} lines, voice ${audioSeconds.toFixed(1)}s, segment ${seconds.toFixed(1)}s`,
    );
  }
  return planned;
}

// ------------------------------------------------------------------- panels

function shell(body: string, width: number, height: number, background: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${String(width)}px;height:${String(height)}px;background:${background};
      font-family:${FONT};-webkit-font-smoothing:antialiased}
  </style></head><body>${body}</body></html>`;
}

/** Top-left wordmark and hackathon/track kicker, shared by every full-canvas panel. */
function wordmarkHtml(manifest: Manifest): string {
  return `<div style="position:absolute;left:${String(LEFT.x)}px;top:96px">
       <div style="font-size:30px;font-weight:800;letter-spacing:.20em;color:${TEXT}">SIFT</div>
       <div style="font-size:17px;letter-spacing:.13em;color:${MUTED};margin-top:10px;text-transform:uppercase">
         ${escapeHtml(manifest.hackathon)} &middot; ${escapeHtml(manifest.track)}</div>
     </div>`;
}

function backgroundHtml(beat: Beat, total: number, manifest: Manifest): string {
  return shell(
    `${wordmarkHtml(manifest)}
     <div style="position:absolute;left:${String(LEFT.x)}px;bottom:${String(CANVAS.height - (LEFT.y - 52))}px;width:${String(LEFT.width)}px">
       <div style="font-size:19px;font-weight:700;letter-spacing:.16em;color:${ACCENT}">
         ${String(beat.number).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div>
       <div style="font-size:58px;font-weight:700;line-height:1.12;color:${TEXT};margin-top:18px">
         ${escapeHtml(beat.title)}</div>
     </div>
     <div style="position:absolute;left:${String(LEFT.x)}px;top:${String(LEFT.y - 42)}px;
       width:${String(LEFT.width)}px;height:1px;background:${RULE}"></div>
     <div style="position:absolute;left:${String(PANE.x)}px;top:${String(PANE.y)}px;
       width:${String(PANE.width)}px;height:${String(PANE.height)}px;border-radius:${String(RADIUS)}px;
       background:#fff;box-shadow:0 46px 110px rgba(0,0,0,.62), 0 4px 18px rgba(0,0,0,.4)"></div>`,
    CANVAS.width,
    CANVAS.height,
    INK,
  );
}

function captionHtml(text: string): string {
  return shell(
    `<div style="width:${String(LEFT.width)}px;font-size:41px;line-height:1.44;color:${TEXT};
       font-weight:450;letter-spacing:-.004em">${escapeHtml(forDisplay(text))}</div>`,
    LEFT.width,
    LEFT.height,
    'transparent',
  );
}

/** A still beat's caption: centred in the bottom strip below the exhibit, not the left panel. */
function stillCaptionHtml(text: string): string {
  return shell(
    `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
       text-align:center">
       <div style="font-size:36px;line-height:1.44;color:${TEXT};font-weight:450;letter-spacing:-.004em">
         ${escapeHtml(forDisplay(text))}</div>
     </div>`,
    STILL_CAPTION.width,
    STILL_CAPTION.height,
    'transparent',
  );
}

function cardHtml(card: Card): string {
  return shell(
    `<div style="position:absolute;left:${String(LEFT.x)}px;top:360px;width:1500px">
       <div style="font-size:19px;font-weight:700;letter-spacing:.16em;color:${ACCENT};text-transform:uppercase">
         ${escapeHtml(card.kicker)}</div>
       <div style="font-size:74px;font-weight:700;line-height:1.14;color:${TEXT};margin-top:26px">
         ${escapeHtml(card.title)}</div>
       <div style="font-size:34px;line-height:1.5;color:${MUTED};margin-top:34px">
         ${escapeHtml(forDisplay(card.subtitle))}</div>
     </div>`,
    CANVAS.width,
    CANVAS.height,
    INK,
  );
}

/** A frame with a rounded hole, laid over the pane so its square corners are covered. */
function bezelHtml(): string {
  const { width: w, height: h } = PANE;
  const r = RADIUS;
  const outer = `M0,0 H${String(w)} V${String(h)} H0 Z`;
  const inner =
    `M${String(r)},0 H${String(w - r)} A${String(r)},${String(r)} 0 0 1 ${String(w)},${String(r)} ` +
    `V${String(h - r)} A${String(r)},${String(r)} 0 0 1 ${String(w - r)},${String(h)} ` +
    `H${String(r)} A${String(r)},${String(r)} 0 0 1 0,${String(h - r)} ` +
    `V${String(r)} A${String(r)},${String(r)} 0 0 1 ${String(r)},0 Z`;
  return shell(
    `<svg width="${String(w)}" height="${String(h)}" xmlns="http://www.w3.org/2000/svg">
       <path d="${outer} ${inner}" fill="${INK}" fill-rule="evenodd"/>
       <rect x=".9" y=".9" width="${String(w - 1.8)}" height="${String(h - 1.8)}"
         rx="${String(r)}" fill="none" stroke="#263B33" stroke-width="1.8"/>
     </svg>`,
    w,
    h,
    'transparent',
  );
}

const CODE_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const CODE_PADDING = 28;
const CODE_HEADER_HEIGHT = 60;

/**
 * The largest font size, from 22px down, at which both the longest line and
 * the full line count fit inside the still box. Computed from character and
 * line counts rather than measured in the browser: Playwright's screenshot is
 * a single synchronous shot, with no render-then-shrink-to-fit pass available
 * before it.
 */
function fitCodeFontSize(lines: readonly string[]): number {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const maxWidth = STILL_BOX.width - CODE_PADDING * 2;
  const maxHeight = STILL_BOX.height - CODE_PADDING * 2 - CODE_HEADER_HEIGHT;
  for (let size = 22; size > 8; size -= 1) {
    // 0.6em is a standard advance-width approximation for a monospace face.
    if (longest * size * 0.6 <= maxWidth && lines.length * size * 1.5 <= maxHeight) return size;
  }
  return 8;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  svg: 'svg+xml',
};

/** A still beat's exhibit: an embedded image or a rendered source file, centred in STILL_BOX. */
function exhibitHtml(still: NonNullable<Beat['still']>): string {
  const path = join(process.cwd(), still.path);
  if (still.kind === 'image') {
    const ext = extname(path).slice(1).toLowerCase();
    const mime = IMAGE_MIME[ext] ?? 'png';
    const dataUri = `data:image/${mime};base64,${readFileSync(path).toString('base64')}`;
    return `<div style="background:#fff;border-radius:18px;padding:24px;
        box-shadow:0 46px 110px rgba(0,0,0,.62),0 4px 18px rgba(0,0,0,.4);
        max-width:${String(STILL_BOX.width)}px;max-height:${String(STILL_BOX.height)}px;display:flex">
        <img src="${dataUri}" style="max-width:100%;max-height:100%;object-fit:contain;display:block"/>
      </div>`;
  }
  const all = readFileSync(path, 'utf8').split('\n');
  // A whole file shrinks to illegibility. Naming the range keeps the exhibit at
  // a readable size and tells a judge exactly where to look it up.
  const [from, to] = still.lines ?? [1, all.length];
  const lines = all.slice(from - 1, to);
  const label =
    still.lines === undefined ? still.path : `${still.path}:${String(from)}-${String(to)}`;
  const width = String(all.slice(from - 1, to).length + from).length;
  const numbered = lines.map((line, i) => `${String(from + i).padStart(width, ' ')}  ${line}`);
  const size = fitCodeFontSize(numbered);
  return `<div style="background:#0F1C18;border-radius:14px;overflow:hidden;
      max-width:${String(STILL_BOX.width)}px;max-height:${String(STILL_BOX.height)}px;
      box-shadow:0 46px 110px rgba(0,0,0,.62),0 4px 18px rgba(0,0,0,.4)">
      <div style="padding:16px ${String(CODE_PADDING)}px;background:#132A22;color:${MUTED};
        font-size:19px;letter-spacing:.02em">${escapeHtml(label)}</div>
      <div style="padding:${String(CODE_PADDING)}px;font-family:${CODE_FONT};
        font-size:${String(size)}px;line-height:1.5;color:${TEXT};white-space:pre">${escapeHtml(numbered.join('\n'))}</div>
    </div>`;
}

/** Full-canvas still panel: wordmark, beat number/title, and the beat's exhibit centred in STILL_BOX. */
function stillHtml(beat: Beat, total: number, manifest: Manifest): string {
  const still = beat.still;
  if (still === undefined) throw new Error(`stillHtml called for beat with no still: ${beat.id}`);
  return shell(
    `${wordmarkHtml(manifest)}
     <div style="position:absolute;left:${String(LEFT.x)}px;top:196px;width:1600px">
       <div style="font-size:19px;font-weight:700;letter-spacing:.16em;color:${ACCENT}">
         ${String(beat.number).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div>
       <div style="font-size:44px;font-weight:700;line-height:1.16;color:${TEXT};margin-top:14px;
         white-space:nowrap">${escapeHtml(beat.title)}</div>
     </div>
     <div style="position:absolute;left:${String(STILL_BOX.x)}px;top:${String(STILL_BOX.y)}px;
       width:${String(STILL_BOX.width)}px;height:${String(STILL_BOX.height)}px;
       display:flex;align-items:center;justify-content:center">
       ${exhibitHtml(still)}
     </div>`,
    CANVAS.width,
    CANVAS.height,
    INK,
  );
}

async function renderPanels(manifest: Manifest, planned: readonly PlannedBeat[]): Promise<void> {
  rmSync(PANEL_DIR, { recursive: true, force: true });
  mkdirSync(PANEL_DIR, { recursive: true });
  const browser: Browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { ...CANVAS }, deviceScaleFactor: 1 });

  const shoot = async (
    html: string,
    file: string,
    size: { width: number; height: number },
    transparent: boolean,
  ): Promise<void> => {
    await page.setViewportSize(size);
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: join(PANEL_DIR, file), omitBackground: transparent });
  };

  await shoot(bezelHtml(), 'bezel.png', { width: PANE.width, height: PANE.height }, true);
  await shoot(cardHtml(manifest.closeCard), 'card-close.png', { ...CANVAS }, false);
  for (const plan of planned) {
    if (plan.beat.still === undefined) {
      await shoot(
        backgroundHtml(plan.beat, groupCount(manifest), manifest),
        `bg-${plan.beat.id}.png`,
        { ...CANVAS },
        false,
      );
    } else {
      await shoot(
        stillHtml(plan.beat, groupCount(manifest), manifest),
        `still-${plan.beat.id}.png`,
        { ...CANVAS },
        false,
      );
    }
    const captionSize =
      plan.beat.still === undefined
        ? { width: LEFT.width, height: LEFT.height }
        : { width: STILL_CAPTION.width, height: STILL_CAPTION.height };
    for (const [index, line] of plan.lines.entries()) {
      await shoot(
        plan.beat.still === undefined ? captionHtml(line.text) : stillCaptionHtml(line.text),
        `cap-${plan.beat.id}-${String(index).padStart(2, '0')}.png`,
        captionSize,
        true,
      );
    }
  }
  await browser.close();
}

// ------------------------------------------------------------------ compose

const ENCODE = [
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-r',
  '30',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-ar',
  '48000',
  '-ac',
  '2',
] as const;

function composeBeats(manifest: Manifest, planned: readonly PlannedBeat[]): string[] {
  rmSync(SEGMENT_DIR, { recursive: true, force: true });
  mkdirSync(SEGMENT_DIR, { recursive: true });
  const timeline = loadTimeline();
  const files: string[] = [];

  for (const [index, plan] of planned.entries()) {
    const previous = planned[index - 1];
    // Consecutive beats that share a title are one visual beat split only so
    // each part can align to its own footage. Fading the pane at those joins
    // would read as a flicker in the middle of a continuous thought.
    const opensGroup = previous?.beat.title !== plan.beat.title;
    const still = plan.beat.still;

    const out = join(SEGMENT_DIR, `${plan.beat.id}.mp4`);
    const inputs: string[] = [];
    const steps: string[] = [];
    let label: string;
    let raw = 0;
    let rate = 1;

    if (still === undefined) {
      const mark = timeline.marks.find((m) => m.id === plan.beat.id);
      if (mark === undefined) throw new Error(`no footage recorded for beat ${plan.beat.id}`);
      const from = mark.startMs / 1000;
      raw = mark.endMs / 1000 - from;
      // Only ever compress time, never stretch it: slowed UI footage reads as a
      // stutter. When a beat came up shorter than its narration -- every beat
      // here ends on a held, static view -- clone the last frame to cover the
      // remainder instead. Without this the pane simply vanishes for the
      // shortfall and the panel plays on over an empty canvas.
      rate = raw >= plan.seconds ? raw / plan.seconds : 1;
      const shortfall = Math.max(0, plan.seconds - raw / rate);
      const pad =
        shortfall > 0 ? `,tpad=stop_mode=clone:stop_duration=${(shortfall + 0.2).toFixed(3)}` : '';
      const slice = join(SEGMENT_DIR, `raw-${plan.beat.id}.mp4`);
      // `-ss`/`-t` are INPUT options here, and that placement is load-bearing.
      // As output options they are applied after the filter graph, so `setpts`
      // has already rescaled the timestamps by the time the duration limit is
      // read: the retime silently does nothing and the final beat, whose shifted
      // timestamps land past its own limit, comes out as an empty file.
      ffmpeg([
        '-ss',
        from.toFixed(3),
        '-t',
        raw.toFixed(3),
        '-i',
        timeline.video,
        '-an',
        '-vf',
        `setpts=PTS/${rate.toFixed(6)},fps=30${pad}`,
        '-t',
        plan.seconds.toFixed(3),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '14',
        '-pix_fmt',
        'yuv420p',
        slice,
      ]);

      inputs.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        plan.seconds.toFixed(3),
        '-i',
        join(PANEL_DIR, `bg-${plan.beat.id}.png`),
        '-i',
        slice,
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        plan.seconds.toFixed(3),
        '-i',
        join(PANEL_DIR, 'bezel.png'),
      );
      // 0 background, 1 footage, 2 bezel, then one caption image per line.
      steps.push(
        `[1:v]scale=${String(PANE.width)}:${String(PANE.height)},format=yuva420p,` +
          `${opensGroup ? 'fade=t=in:st=0:d=0.35:alpha=1,' : ''}setsar=1[pane]`,
        `[0:v][pane]overlay=${String(PANE.x)}:${String(PANE.y)}:shortest=0[p0]`,
        `[p0][2:v]overlay=${String(PANE.x)}:${String(PANE.y)}[p1]`,
      );
      label = 'p1';
    } else {
      // No footage to retime: the visual is a single baked frame held for the
      // beat's full measured duration, so there is no slice, scale or bezel --
      // only the caption overlays below apply on top of it.
      inputs.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        plan.seconds.toFixed(3),
        '-i',
        join(PANEL_DIR, `still-${plan.beat.id}.png`),
      );
      // `-map` needs a filtergraph-defined pad, not a raw input reference, so
      // this input is named through a no-op filter even though nothing about
      // it changes -- a still beat with no captions would otherwise map an
      // input stream through link-label syntax, which ffmpeg rejects.
      steps.push('[0:v]null[still]');
      label = 'still';
    }

    // Non-still beats caption the left panel; still beats caption the bottom
    // strip below the exhibit instead. Caption stream numbering starts right
    // after whatever base inputs the branch above already pushed.
    const captionOrigin = still === undefined ? LEFT : STILL_CAPTION;
    const baseInputs = still === undefined ? 3 : 1;
    for (const [capIndex, window] of plan.windows.entries()) {
      const stream = baseInputs + capIndex;
      inputs.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        plan.seconds.toFixed(3),
        '-i',
        join(PANEL_DIR, `cap-${plan.beat.id}-${String(capIndex).padStart(2, '0')}.png`),
      );
      // Dissolve rather than pop. Each caption's own alpha is animated, so the
      // overlay needs no `enable` window: the image is fully transparent
      // outside its own [from, to]. Window `to` equals the next window's
      // `from`, so the outgoing fade finishes exactly as the incoming one
      // starts -- they never double-expose, and no transition duration has to
      // be kept in step with a separate caption timing sheet.
      const faded = `f${String(capIndex)}`;
      const next = `c${String(capIndex)}`;
      const out1 = Math.max(window.from, window.to - CAPTION_FADE);
      steps.push(
        `[${String(stream)}:v]format=rgba,` +
          `fade=t=in:st=${window.from.toFixed(3)}:d=${CAPTION_FADE.toFixed(3)}:alpha=1,` +
          `fade=t=out:st=${out1.toFixed(3)}:d=${CAPTION_FADE.toFixed(3)}:alpha=1[${faded}]`,
      );
      steps.push(
        `[${label}][${faded}]overlay=${String(captionOrigin.x)}:${String(captionOrigin.y)}[${next}]`,
      );
      label = next;
    }
    // The film opens out of black rather than cutting in cold.
    if (index === 0) {
      steps.push(`[${label}]fade=t=in:st=0:d=${OPEN_FADE.toFixed(3)}[opened]`);
      label = 'opened';
    }
    inputs.push('-i', plan.audio);
    const audioStream = baseInputs + plan.windows.length;
    ffmpeg([
      ...inputs,
      '-filter_complex',
      steps.join(';'),
      '-map',
      `[${label}]`,
      '-map',
      `${String(audioStream)}:a`,
      '-t',
      plan.seconds.toFixed(3),
      ...ENCODE,
      '-movflags',
      '+faststart',
      out,
    ]);
    files.push(out);
    if (still === undefined) {
      console.log(
        `  ${plan.beat.id}: ${raw.toFixed(1)}s footage -> ${plan.seconds.toFixed(1)}s at ${rate.toFixed(2)}x`,
      );
    } else {
      console.log(`  ${plan.beat.id}: still (${still.kind}) -> ${plan.seconds.toFixed(1)}s`);
    }
  }

  // A manifest whose last beat is itself the close needs no separate card, and
  // asks for zero seconds of one. Appending it anyway builds a zero-length
  // segment whose fade starts before its own first frame.
  const seconds = manifest.timing.cardSeconds;
  if (seconds <= 0) return files;
  const card = join(SEGMENT_DIR, 'card-close.mp4');
  ffmpeg([
    '-loop',
    '1',
    '-framerate',
    '30',
    '-t',
    seconds.toFixed(3),
    '-i',
    join(PANEL_DIR, 'card-close.png'),
    '-f',
    'lavfi',
    '-t',
    seconds.toFixed(3),
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-vf',
    `fade=t=out:st=${(seconds - CLOSE_FADE).toFixed(3)}:d=${CLOSE_FADE.toFixed(3)}`,
    ...ENCODE,
    '-movflags',
    '+faststart',
    card,
  ]);
  files.push(card);
  return files;
}

// ------------------------------------------------------------ stitch + srt

function srtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

function writeSrt(planned: readonly PlannedBeat[], file: string): void {
  const blocks: string[] = [];
  let offset = 0;
  let index = 1;
  for (const plan of planned) {
    for (const [i, window] of plan.windows.entries()) {
      const line = plan.lines[i];
      if (line === undefined) continue;
      blocks.push(
        `${String(index)}\n${srtTime(offset + window.from)} --> ${srtTime(offset + window.to)}\n` +
          `${forDisplay(line.text)}\n`,
      );
      index += 1;
    }
    offset += plan.seconds;
  }
  writeFileSync(file, `${blocks.join('\n')}\n`);
}

function stitch(files: readonly string[], out: string): void {
  const list = join(SEGMENT_DIR, 'concat.txt');
  writeFileSync(list, `${files.map((f) => `file '${f}'`).join('\n')}\n`);
  // Every segment came out of the same encoder settings, so a stream copy is
  // exact. Re-encoding here would be a second generation loss for nothing.
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
}

// --------------------------------------------------------------------- gate

function gate(file: string, manifest: Manifest): void {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_name,codec_type,width,height',
    '-of',
    'json',
    file,
  ]).toString();
  const probe = JSON.parse(out) as {
    format: { duration: string };
    streams: { codec_name: string; codec_type: string; width?: number; height?: number }[];
  };
  const seconds = Number.parseFloat(probe.format.duration);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const failures: string[] = [];
  if (seconds > manifest.hardCapSeconds)
    failures.push(
      `duration ${seconds.toFixed(1)}s exceeds the ${String(manifest.hardCapSeconds)}s cap`,
    );
  if (video?.codec_name !== 'h264') failures.push(`video codec is ${String(video?.codec_name)}`);
  if (audio?.codec_name !== 'aac') failures.push(`audio codec is ${String(audio?.codec_name)}`);
  if (video?.width !== CANVAS.width || video?.height !== CANVAS.height)
    failures.push(`frame is ${String(video?.width)}x${String(video?.height)}`);
  console.log(
    `\ngate: ${seconds.toFixed(1)}s, ${String(video?.width)}x${String(video?.height)}, ` +
      `${String(video?.codec_name)}/${String(audio?.codec_name)}`,
  );
  if (failures.length > 0)
    throw new Error(`rendering gate failed:\n  - ${failures.join('\n  - ')}`);
}

/**
 * Brings the running time under the cap by spending each beat's slack -- the
 * dwell it holds beyond its own narration -- never by speeding the voice up or
 * dropping a line. Beats give up slack in proportion to how much they have, so
 * a long hold yields more than a tight one, and none is cut below the audio it
 * has to carry.
 *
 * This exists because narration length is provider-dependent: the same script
 * measured on `say` and on ElevenLabs differs by seconds per beat, so one fixed
 * set of floors cannot fit both.
 */
function fitToCap(planned: readonly PlannedBeat[], manifest: Manifest): PlannedBeat[] {
  const target = manifest.hardCapSeconds - manifest.timing.cardSeconds - CAP_MARGIN_SECONDS;
  const total = planned.reduce((sum, plan) => sum + plan.seconds, 0);
  if (total <= target) return [...planned];

  const slack = planned.map((plan) => Math.max(0, plan.seconds - plan.voiceSeconds));
  const available = slack.reduce((sum, value) => sum + value, 0);
  if (available <= 0) return [...planned];

  const share = Math.min(1, (total - target) / available);
  console.log(
    `  over by ${(total - target).toFixed(1)}s; spending ${(share * 100).toFixed(0)}% of ` +
      `${available.toFixed(1)}s of hold time`,
  );
  return planned.map((plan, index) => {
    const cut = (slack[index] ?? 0) * share;
    if (cut <= 0.05) return plan;
    const seconds = plan.seconds - cut;
    // The last caption of a beat runs to the beat's end, so it shortens with it.
    const windows = plan.windows.map((w, i) =>
      i === plan.windows.length - 1 ? { from: w.from, to: Math.max(w.from + 0.5, seconds) } : w,
    );
    return { ...plan, seconds, windows };
  });
}

async function main(): Promise<void> {
  const manifest = loadManifest();
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('narration:');
  const planned = await narrate(manifest);
  const fitted = fitToCap(planned, manifest);
  const total = fitted.reduce((sum, plan) => sum + plan.seconds, 0) + manifest.timing.cardSeconds;
  console.log(`  total ${total.toFixed(1)}s against a ${String(manifest.hardCapSeconds)}s cap`);
  if (total > manifest.hardCapSeconds)
    throw new Error(
      `planned runtime ${total.toFixed(1)}s exceeds the cap even with every beat trimmed to its ` +
        `own narration. Shorten the script; the voice is never sped up to fit.`,
    );

  console.log('panels:');
  await renderPanels(manifest, fitted);

  console.log('segments:');
  const files = composeBeats(manifest, fitted);

  const out = join(OUT_DIR, 'sift-agents-for-humans.mp4');
  stitch(files, out);
  const srt = join(OUT_DIR, 'sift-agents-for-humans.srt');
  writeSrt(fitted, srt);
  gate(out, manifest);

  const bytes = readFileSync(out).byteLength;
  console.log(`video: ${out} (${(bytes / 1_000_000).toFixed(1)} MB)`);
  console.log(`captions: ${srt}`);
}

await main();
