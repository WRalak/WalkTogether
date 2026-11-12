import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../../config/env';

const MAX_SECONDS = 180;

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    p.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    p.stdout.on('data', (d) => (stdout += d));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stderr, stdout });
    });
  });
}

/**
 * Transcodes an uploaded video to H.264/AAC MP4 (≤720p, faststart) and extracts a poster frame.
 * All container metadata is dropped (-map_metadata -1), which removes GPS location atoms that
 * phones embed. Inputs are untrusted: the process runs with a timeout and a duration cap.
 */
/**
 * Untrusted input may only be opened as a local ISO-BMFF file (MP4/QuickTime — the only video types
 * uploads accept, see sniff.ts). This keeps playlist/XML demuxers (HLS, DASH, concat, IMF…) and
 * network protocols unreachable: no SSRF or local-file reads through crafted playlists, and the
 * libxml2-based parsers never see user data.
 */
const INPUT_GUARD = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov'];

export async function transcodeVideo(input: Buffer): Promise<{ video: Buffer; poster: Buffer; width: number; height: number; durationS: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'wt-video-'));
  try {
    const src = join(dir, 'in');
    const out = join(dir, 'out.mp4');
    const poster = join(dir, 'poster.jpg');
    await writeFile(src, input);
    const probe = await run(
      env.FFPROBE_PATH,
      ['-v', 'error', ...INPUT_GUARD, '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', src],
      30_000,
    );
    if (probe.code !== 0) throw new Error('not a readable video');
    const info = JSON.parse(probe.stdout) as { streams?: { width: number; height: number }[]; format?: { duration?: string } };
    if (!info.streams?.length) throw new Error('no video stream');
    const durationS = Number(info.format?.duration ?? 0);
    if (durationS > MAX_SECONDS) throw new Error('video too long');
    const t = await run(
      env.FFMPEG_PATH,
      [
        '-y',
        '-v',
        'error',
        ...INPUT_GUARD,
        '-i',
        src,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-vf',
        "scale='min(1280,iw)':-2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '26',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        '-t',
        String(MAX_SECONDS),
        out,
      ],
      5 * 60_000,
    );
    if (t.code !== 0) throw new Error(`transcode failed: ${t.stderr.slice(-200)}`);
    const p = await run(
      env.FFMPEG_PATH,
      ['-y', '-v', 'error', ...INPUT_GUARD, '-ss', String(Math.min(1, durationS / 2)), '-i', out, '-frames:v', '1', '-map_metadata', '-1', poster],
      60_000,
    );
    if (p.code !== 0) throw new Error('poster extraction failed');
    const dims = await run(env.FFPROBE_PATH, ['-v', 'error', ...INPUT_GUARD, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', out], 30_000);
    const d = (JSON.parse(dims.stdout) as { streams: { width: number; height: number }[] }).streams[0]!;
    return { video: await readFile(out), poster: await readFile(poster), width: d.width, height: d.height, durationS };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
