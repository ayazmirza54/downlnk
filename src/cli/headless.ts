import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig, type Config } from "../config/config";
import { DownloadQueue } from "../download/queue";
import { loadQueue, saveQueue } from "../download/persist";
import { resolveUrl, toNewDownload } from "../download/resolve";
import { DEFAULT_MEDIA, type DownloadItem, type MediaOptions } from "../download/types";
import { extractUrls } from "../router";
import { toolEvents, toolStatus, updateTools } from "../tools/resolve";
import { formatBytes, formatBytesPerSec, formatEtaShort, truncate } from "../util/format";
import type { GetOptions } from "./args";

const err = (s: string) => process.stderr.write(`${s}\n`);

function mediaFrom(o: GetOptions, config: Config): MediaOptions {
  return {
    ...DEFAULT_MEDIA,
    quality: o.quality ?? config.quality,
    audioFormat: o.audioFormat ?? DEFAULT_MEDIA.audioFormat,
    subtitles: o.subtitles,
    playlist: o.playlist,
  };
}

async function collectUrls(o: GetOptions): Promise<string[]> {
  const urls = [...o.urls];
  for (const f of o.files) urls.push(...extractUrls(await fs.readFile(f, "utf8")));
  return urls;
}

function settingsFrom(config: Config, o?: Partial<GetOptions>) {
  return {
    maxConcurrent: config.maxConcurrent,
    connections: o?.connections ?? config.segments,
    retries: config.retries,
    speedLimit: o?.limit ?? config.speedLimit,
    cookiesFromBrowser: o?.cookiesFromBrowser ?? config.cookiesFromBrowser,
  };
}

function watchToolFetches(): void {
  toolEvents.on("fetch", (name: string) => err(`fetching ${name} (first run only)…`));
}

/** Resolve each link and queue it; failures are reported and skipped. */
async function resolveAll(q: DownloadQueue, urls: string[], o: GetOptions, config: Config): Promise<number> {
  let failed = 0;
  const media = mediaFrom(o, config);
  const cfg = { downloadDir: config.downloadDir, sortByCategory: o.sort && config.sortByCategory };
  for (const url of urls) {
    err(`resolving ${truncate(url, 70)}`);
    try {
      const res = await resolveUrl(url, { cookiesFromBrowser: o.cookiesFromBrowser ?? config.cookiesFromBrowser });
      const n = toNewDownload(res, cfg, media, o.output ? path.resolve(o.output) : undefined);
      q.add(n);
      err(`  + ${n.title}  [${res.engine}]`);
    } catch (e) {
      failed++;
      err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed;
}

function statusLine(it: DownloadItem): string {
  const pct = it.total > 0 ? Math.min(100, Math.floor((it.downloaded / it.total) * 100)) : 0;
  const files = it.filesTotal ? `  ${it.filesDone ?? 0}/${it.filesTotal} files` : "";
  if (it.status === "done") return `✓ ${formatBytes(it.downloaded)}${files}  ${it.title}`;
  if (it.status === "failed") return `✗ ${it.error ?? "failed"}  ${it.title}`;
  if (it.status === "queued") return `· queued  ${it.title}`;
  if (it.status === "paused") return `⏸ paused  ${it.title}`;
  const size = it.total > 0 ? `${formatBytes(it.downloaded)}/${formatBytes(it.total)}` : formatBytes(it.downloaded);
  const eta = it.eta ? `  ${formatEtaShort(it.eta)}` : "";
  const stage = it.stage ? `  ${it.stage}` : "";
  return `↓ ${String(pct).padStart(3)}%  ${size}  ${formatBytesPerSec(it.speed) || "…"}${eta}${files}${stage}  ${it.title}`;
}

/** Live progress: redraws in place on a terminal, prints a line every few seconds otherwise. */
function renderProgress(q: DownloadQueue): () => void {
  const tty = process.stderr.isTTY;
  const width = () => Math.max(40, (process.stderr.columns ?? 100) - 1);
  let drawn = 0;
  let ticks = 0;
  const draw = () => {
    const lines = q.list().map((it) => truncate(statusLine(it), width()));
    if (tty) {
      let out = drawn ? `\x1b[${drawn}A` : "";
      for (const l of lines) out += `\x1b[2K${l}\n`;
      process.stderr.write(out);
      drawn = lines.length;
    } else if (ticks++ % 6 === 0) {
      for (const l of lines) err(l);
    }
  };
  const timer = setInterval(draw, 500);
  return () => {
    clearInterval(timer);
    if (!tty) ticks = 0;
    draw();
  };
}

export async function runGet(o: GetOptions): Promise<number> {
  watchToolFetches();
  const config = await loadConfig();
  const q = new DownloadQueue(settingsFrom(config, o));
  const urls = await collectUrls(o);
  const resolveFailures = await resolveAll(q, urls, o, config);
  if (!q.list().length) return 1;
  const stop = renderProgress(q);
  const onSig = () => {
    void q.stopAll();
    stop();
    err("stopped; run the same command again to resume.");
    process.exit(130);
  };
  process.on("SIGINT", onSig);
  await q.idle();
  await new Promise((r) => setTimeout(r, 100)); // let finished sizes settle from disk
  stop();
  const done = q.list().filter((i) => i.status === "done");
  for (const it of done) for (const f of it.files) process.stdout.write(`${f}\n`);
  return resolveFailures || q.list().some((i) => i.status === "failed") ? 1 : 0;
}

export async function runInfo(url: string): Promise<number> {
  watchToolFetches();
  const config = await loadConfig();
  try {
    const res = await resolveUrl(url, { cookiesFromBrowser: config.cookiesFromBrowser });
    const body = res.engine === "http" ? res.probe : res.info;
    process.stdout.write(`${JSON.stringify({ engine: res.engine, source: res.route.source, ...body }, null, 2)}\n`);
    return 0;
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

async function savedQueue(config: Config, o?: Partial<GetOptions>) {
  const q = new DownloadQueue(settingsFrom(config, o), { persist: (items) => saveQueue(items) });
  q.load(await loadQueue());
  return q;
}

export async function runQueueAdd(o: GetOptions): Promise<number> {
  watchToolFetches();
  const config = await loadConfig();
  const q = new DownloadQueue(settingsFrom(config, o), { persist: (items) => saveQueue(items) });
  q.setHold("later"); // adding only; `queue start` or the app runs them
  q.load(await loadQueue());
  const failed = await resolveAll(q, await collectUrls(o), o, config);
  await q.flush();
  err(`${q.pendingCount} waiting in the queue. Start it with: downlnk queue start`);
  return failed ? 1 : 0;
}

export async function runQueueList(): Promise<number> {
  process.stdout.write(`${JSON.stringify(await loadQueue(), null, 2)}\n`);
  return 0;
}

export async function runQueueStart(limit?: number): Promise<number> {
  watchToolFetches();
  const config = await loadConfig();
  const q = await savedQueue(config, { limit });
  q.resumeAll();
  if (!q.pendingCount) {
    err("The queue is empty.");
    return 0;
  }
  const stop = renderProgress(q);
  process.on("SIGINT", () => {
    void q.stopAll();
    stop();
    void q.flush().finally(() => process.exit(130));
  });
  await q.idle();
  await new Promise((r) => setTimeout(r, 100)); // let finished sizes settle from disk
  stop();
  await q.flush();
  return q.list().some((i) => i.status === "failed") ? 1 : 0;
}

export async function runTools(): Promise<number> {
  for (const name of ["yt-dlp", "gallery-dl", "ffmpeg"] as const) {
    const s = await toolStatus(name);
    process.stdout.write(
      s.path
        ? `${name.padEnd(11)} ${s.version ?? "?"}  ${s.path}${s.managed ? "  (managed by downlnk)" : ""}\n`
        : `${name.padEnd(11)} not found${name === "ffmpeg" ? "" : "  (downlnk fetches it on first use)"}\n`,
    );
  }
  return 0;
}

export async function runUpdateTools(): Promise<number> {
  try {
    await updateTools((l) => process.stdout.write(`${l}\n`));
    return 0;
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}
