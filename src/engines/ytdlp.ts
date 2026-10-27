import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DownloadItem, MediaOptions } from "../download/types";
import { ensureTool, locateTool } from "../tools/resolve";
import { capture, killTree, lastError, readLines, spawnTool } from "../tools/spawn";
import { AbortedError, type RunContext } from "./types";

export interface MediaInfo {
  title: string;
  uploader?: string;
  duration?: number;
  isPlaylist: boolean;
  entries?: number;
  /** Distinct video heights on offer, highest first. */
  heights: number[];
  hasVideo: boolean;
  /** Rough size of the best download, when the site reports one. */
  sizeEstimate?: number;
  subtitles: string[];
}

interface RawFormat {
  vcodec?: string;
  acodec?: string;
  height?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}

interface RawInfo {
  _type?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  entries?: unknown[];
  playlist_count?: number;
  formats?: RawFormat[];
  requested_formats?: RawFormat[];
  filesize?: number | null;
  filesize_approx?: number | null;
  subtitles?: Record<string, unknown>;
  vcodec?: string;
  height?: number;
}

const size = (f?: RawFormat | RawInfo | null) => f?.filesize || f?.filesize_approx || 0;

export function summarizeInfo(info: RawInfo): MediaInfo {
  const isPlaylist = info._type === "playlist" || Array.isArray(info.entries);
  const formats = info.formats ?? [];
  const heights = [
    ...new Set(
      formats
        .filter((f) => f.vcodec && f.vcodec !== "none" && f.height)
        .map((f) => f.height as number),
    ),
  ].sort((a, b) => b - a);
  const hasVideo =
    heights.length > 0 || (!!info.vcodec && info.vcodec !== "none") || (!formats.length && !isPlaylist);
  const est = info.requested_formats?.reduce((n, f) => n + size(f), 0) || size(info) || undefined;
  return {
    title: info.title || "Untitled",
    uploader: info.uploader || info.channel || undefined,
    duration: info.duration || undefined,
    isPlaylist,
    entries: isPlaylist ? (info.playlist_count ?? info.entries?.length) : undefined,
    heights,
    hasVideo,
    sizeEstimate: est,
    subtitles: Object.keys(info.subtitles ?? {}),
  };
}

// YouTube now gates formats behind a JavaScript challenge, and yt-dlp only
// looks for deno by default. downlnk always runs under Node, so offer it.
function jsRuntimeArgs(): string[] {
  return process.versions.node ? ["--js-runtimes", `node:${process.execPath}`] : [];
}

function cookieArgs(browser: string | null): string[] {
  return browser ? ["--cookies-from-browser", browser] : [];
}

export async function probeYtdlp(
  url: string,
  { signal, cookiesFromBrowser = null }: { signal?: AbortSignal; cookiesFromBrowser?: string | null } = {},
): Promise<MediaInfo> {
  const bin = await ensureTool("yt-dlp");
  const r = await capture(
    bin,
    ["-J", "--flat-playlist", "--no-warnings", "--encoding", "utf-8", ...jsRuntimeArgs(), ...cookieArgs(cookiesFromBrowser), url],
    { timeoutMs: 90_000, signal },
  );
  if (signal?.aborted) throw new AbortedError();
  if (r.code !== 0) throw new Error(lastError(r.stderr));
  try {
    return summarizeInfo(JSON.parse(r.stdout) as RawInfo);
  } catch {
    throw new Error("yt-dlp returned something downlnk could not read");
  }
}

/** yt-dlp's -f selector for the chosen quality, with or without ffmpeg to merge. */
export function formatSelector(media: MediaOptions, hasFfmpeg: boolean): string {
  if (media.quality === "audio") return hasFfmpeg ? "ba/b" : "ba[ext=m4a]/ba/b";
  const h = /^\d+$/.test(media.quality) ? Number(media.quality) : 0;
  const cap = h ? `[height<=${h}]` : "";
  // Without ffmpeg nothing can be merged, so only single-file formats work.
  if (!hasFfmpeg) return h ? `b${cap}/b` : "b";
  return h ? `bv*${cap}+ba/b${cap}/bv*+ba/b` : "bv*+ba/b";
}

export const PROGRESS_PREFIX = "DLNK|";
export const FILE_PREFIX = "DLNKFILE|";

export function buildArgs(
  item: Pick<DownloadItem, "url" | "dir" | "media">,
  ctx: Pick<RunContext, "rateLimit" | "connections" | "retries" | "cookiesFromBrowser">,
  ffmpeg: string | null,
): string[] {
  const m = item.media;
  const args = [
    item.url,
    "-f",
    formatSelector(m, !!ffmpeg),
    "-P",
    item.dir,
    // Partial files live in a folder of their own, so a cancel can sweep up
    // exactly this download's leftovers and nothing else's. Relative (yt-dlp
    // joins it onto the home path): an absolute Windows path's drive colon
    // collides with the TYPE:PATH syntax.
    "-P",
    `temp:${path.join(".downlnk", partKey(item))}`,
    "-o",
    // Playlist items get a folder and a track number; a lone video gets
    // neither (an empty folder part would leave a leading slash, i.e. the
    // drive root).
    m.playlist
      ? "%(playlist_title&{}/|)s%(playlist_index&{:03d} - |)s%(title).150B [%(id)s].%(ext)s"
      : "%(title).150B [%(id)s].%(ext)s",
    "--newline",
    "--progress",
    "--no-colors",
    "--encoding",
    "utf-8",
    "--continue",
    "--no-mtime",
    "--progress-template",
    `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.playlist_index)s|%(info.n_entries)s`,
    "--print",
    `after_move:${FILE_PREFIX}%(filepath)s`,
    // HLS/DASH streams come in fragments; fetch several at once, like
    // segmented HTTP does for plain files.
    "--concurrent-fragments",
    String(Math.max(1, Math.min(8, ctx.connections))),
    "--retries",
    String(ctx.retries),
    "--fragment-retries",
    String(ctx.retries),
    ...cookieArgs(ctx.cookiesFromBrowser),
    ...jsRuntimeArgs(),
  ];
  if (!m.playlist) args.push("--no-playlist");
  if (ctx.rateLimit > 0) args.push("--limit-rate", String(Math.max(1024, Math.round(ctx.rateLimit))));
  if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
  if (m.quality === "audio") {
    if (ffmpeg) args.push("-x", "--audio-format", m.audioFormat, "--audio-quality", "0", "--embed-thumbnail", "--embed-metadata");
  } else if (ffmpeg) {
    args.push("--merge-output-format", m.container, "-S", m.container === "mp4" ? "ext:mp4:m4a" : "res");
    args.push("--embed-metadata");
  }
  if (m.subtitles) {
    args.push("--write-subs", "--sub-langs", "en.*,en");
    if (ffmpeg && m.quality !== "audio") args.push("--embed-subs");
  }
  return args;
}

export interface ProgressLine {
  downloaded: number;
  total: number;
  speed: number;
  eta?: number;
  index?: number;
  entries?: number;
}

const num = (s?: string) => {
  const n = s && s !== "NA" && s !== "None" ? Number(s) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

export function parseProgressLine(line: string): ProgressLine | null {
  const at = line.indexOf(PROGRESS_PREFIX);
  if (at < 0) return null;
  const [dl, total, est, speed, eta, index, entries] = line.slice(at + PROGRESS_PREFIX.length).split("|");
  const downloaded = num(dl);
  if (downloaded === undefined) return null;
  return {
    downloaded,
    total: num(total) ?? num(est) ?? 0,
    speed: num(speed) ?? 0,
    eta: num(eta),
    index: num(index),
    entries: num(entries),
  };
}

/**
 * Folds yt-dlp's per-stream progress into one figure for the whole item: an HD
 * video arrives as a video stream then an audio stream (and a playlist as one
 * file after another), and each restarts its counter at zero.
 */
export class ProgressFolder {
  private base = 0;
  private cur: ProgressLine | null = null;

  constructor(private estimate = 0) {}

  push(p: ProgressLine): { downloaded: number; total: number } {
    // A counter that goes backwards means a new stream (or file) started,
    // unless it's the same stream retrying (same size, not yet finished).
    const prev = this.cur;
    if (prev && p.downloaded < prev.downloaded && (p.total !== prev.total || prev.downloaded >= prev.total)) {
      this.base += Math.max(prev.total, prev.downloaded);
    }
    this.cur = p;
    const downloaded = this.base + p.downloaded;
    const total = Math.max(this.estimate, this.base + p.total, downloaded);
    return { downloaded, total };
  }
}

/** Run yt-dlp for one item; resolves with the files it wrote. */
export async function runYtdlp(item: DownloadItem, ctx: RunContext): Promise<string[]> {
  const bin = await ensureTool("yt-dlp");
  const ffmpeg = locateTool("ffmpeg");
  if (item.media.quality === "audio" && !ffmpeg) {
    ctx.onProgress({ downloaded: 0, total: 0, speed: 0, stage: "no ffmpeg: keeping original audio" });
  }
  await fs.mkdir(item.dir, { recursive: true });
  const child = spawnTool(bin, buildArgs(item, ctx, ffmpeg));
  const files: string[] = [];
  let stderr = "";
  const folder = new ProgressFolder(item.total);
  const isPlaylist = item.media.playlist && (item.filesTotal ?? 0) > 1;

  readLines(child.stdout, (line) => {
    if (line.startsWith(FILE_PREFIX)) {
      files.push(line.slice(FILE_PREFIX.length).trim());
      return;
    }
    const p = parseProgressLine(line);
    if (!p) return;
    const { downloaded, total } = folder.push(p);
    const finishing = p.total > 0 && p.downloaded >= p.total;
    ctx.onProgress({
      downloaded,
      total,
      speed: p.speed,
      eta: p.eta,
      filesDone: isPlaylist && p.index ? p.index - 1 : undefined,
      filesTotal: isPlaylist ? (p.entries ?? item.filesTotal) : undefined,
      stage: finishing ? "processing" : undefined,
    });
  });
  readLines(child.stderr, (line) => {
    stderr = `${stderr}\n${line}`.slice(-8000);
  });

  const onAbort = () => killTree(child);
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  if (ctx.signal.aborted) onAbort();

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => ctx.signal.removeEventListener("abort", onAbort));

  if (ctx.signal.aborted) throw new AbortedError();
  if (code !== 0) throw new Error(lastError(stderr));
  await discardYtdlp(item);
  return files;
}

// Named after what is being fetched rather than the queue entry, so running
// the same `downlnk get` again (a fresh entry) finds and resumes the partial.
export function partKey(item: Pick<DownloadItem, "url" | "media">): string {
  const m = item.media;
  return createHash("sha1")
    .update([item.url, m.quality, m.audioFormat, m.container, m.subtitles, m.playlist].join("|"))
    .digest("hex")
    .slice(0, 12);
}

export function tempDir(item: Pick<DownloadItem, "url" | "dir" | "media">): string {
  return path.join(item.dir, ".downlnk", partKey(item));
}

/** Remove a download's partial files (after a cancel, or tidy-up after success). */
export async function discardYtdlp(item: Pick<DownloadItem, "url" | "dir" | "media">): Promise<void> {
  await fs.rm(tempDir(item), { recursive: true, force: true });
  // Drop the shared parent too once nothing else is using it.
  await fs.rmdir(path.join(item.dir, ".downlnk")).catch(() => {});
}
