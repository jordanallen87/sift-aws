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
import { join } from 'node:path';
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
const RADIUS = 26;

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

async function speak(manifest: Manifest, text: string, out: string): Promise<void> {
  const key = process.env['ELEVENLABS_API_KEY'];
  const voiceId = process.env['ELEVENLABS_VOICE_ID'] ?? manifest.voice.elevenLabsVoiceId;
  if (manifest.voice.provider === 'elevenlabs' && key !== undefined && voiceId !== '') {
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
      // The cache key carries the line's own text. Keying on the index alone
      // would silently keep stale audio after any rewording -- the captions
      // would then read the new line while the voice spoke the old one.
      const key = createHash('sha1').update(text).digest('hex').slice(0, 10);
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

    planned.push({ beat, lines, audio, windows, seconds });
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

function backgroundHtml(beat: Beat, total: number, manifest: Manifest): string {
  return shell(
    `<div style="position:absolute;left:${String(LEFT.x)}px;top:96px">
       <div style="font-size:30px;font-weight:800;letter-spacing:.20em;color:${TEXT}">SIFT</div>
       <div style="font-size:17px;letter-spacing:.13em;color:${MUTED};margin-top:10px;text-transform:uppercase">
         ${escapeHtml(manifest.hackathon)} &middot; ${escapeHtml(manifest.track)}</div>
     </div>
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
    await shoot(
      backgroundHtml(plan.beat, groupCount(manifest), manifest),
      `bg-${plan.beat.id}.png`,
      { ...CANVAS },
      false,
    );
    for (const [index, line] of plan.lines.entries()) {
      await shoot(
        captionHtml(line.text),
        `cap-${plan.beat.id}-${String(index).padStart(2, '0')}.png`,
        { width: LEFT.width, height: LEFT.height },
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
    const mark = timeline.marks.find((m) => m.id === plan.beat.id);
    if (mark === undefined) throw new Error(`no footage recorded for beat ${plan.beat.id}`);
    const from = mark.startMs / 1000;
    const raw = mark.endMs / 1000 - from;
    // Only ever compress time, never stretch it: slowed UI footage reads as a
    // stutter. When a beat came up shorter than its narration -- every beat
    // here ends on a held, static view -- clone the last frame to cover the
    // remainder instead. Without this the pane simply vanishes for the
    // shortfall and the panel plays on over an empty canvas.
    const rate = raw >= plan.seconds ? raw / plan.seconds : 1;
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

    const out = join(SEGMENT_DIR, `${plan.beat.id}.mp4`);
    const inputs = [
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
    ];
    // 0 background, 1 footage, 2 bezel, then one caption image per line.
    const steps = [
      `[1:v]scale=${String(PANE.width)}:${String(PANE.height)},format=yuva420p,` +
        `${opensGroup ? 'fade=t=in:st=0:d=0.35:alpha=1,' : ''}setsar=1[pane]`,
      `[0:v][pane]overlay=${String(PANE.x)}:${String(PANE.y)}:shortest=0[p0]`,
      `[p0][2:v]overlay=${String(PANE.x)}:${String(PANE.y)}[p1]`,
    ];
    let label = 'p1';
    for (const [index, window] of plan.windows.entries()) {
      const stream = 3 + index;
      inputs.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        plan.seconds.toFixed(3),
        '-i',
        join(PANEL_DIR, `cap-${plan.beat.id}-${String(index).padStart(2, '0')}.png`),
      );
      const next = `c${String(index)}`;
      steps.push(
        `[${label}][${String(stream)}:v]overlay=${String(LEFT.x)}:${String(LEFT.y)}:` +
          `enable='between(t,${window.from.toFixed(3)},${window.to.toFixed(3)})'[${next}]`,
      );
      label = next;
    }
    inputs.push('-i', plan.audio);
    const audioStream = 3 + plan.windows.length;
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
    console.log(
      `  ${plan.beat.id}: ${raw.toFixed(1)}s footage -> ${plan.seconds.toFixed(1)}s at ${rate.toFixed(2)}x`,
    );
  }

  const card = join(SEGMENT_DIR, 'card-close.mp4');
  const seconds = manifest.timing.cardSeconds;
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

async function main(): Promise<void> {
  const manifest = loadManifest();
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('narration:');
  const planned = await narrate(manifest);
  const total = planned.reduce((sum, plan) => sum + plan.seconds, 0) + manifest.timing.cardSeconds;
  console.log(`  total ${total.toFixed(1)}s against a ${String(manifest.hardCapSeconds)}s cap`);
  if (total > manifest.hardCapSeconds)
    throw new Error(`planned runtime ${total.toFixed(1)}s exceeds the cap before rendering starts`);

  console.log('panels:');
  await renderPanels(manifest, planned);

  console.log('segments:');
  const files = composeBeats(manifest, planned);

  const out = join(OUT_DIR, 'sift-agents-for-humans.mp4');
  stitch(files, out);
  const srt = join(OUT_DIR, 'sift-agents-for-humans.srt');
  writeSrt(planned, srt);
  gate(out, manifest);

  const bytes = readFileSync(out).byteLength;
  console.log(`video: ${out} (${(bytes / 1_000_000).toFixed(1)} MB)`);
  console.log(`captions: ${srt}`);
}

await main();
