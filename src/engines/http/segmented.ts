import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../../util/atomic";
import { AbortedError, type Progress } from "../types";
import { takeAll, type RateLimiter } from "./limiter";
import { MIN_SEGMENT, planSegments, remaining, splitLargest, totalDone, type Segment } from "./plan";
import { USER_AGENT, probeHttp, type HttpProbe } from "./probe";

export interface SegmentedOptions {
  url: string;
  dir: string;
  filename: string;
  connections: number;
  retries: number;
  limiters?: RateLimiter[];
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  headers?: Record<string, string>;
  /** Overrides MIN_SEGMENT for planning and splitting (tests use tiny files). */
  minSplit?: number;
  retryDelayMs?: number;
}

/** What sits next to `<file>.part` so a later run can pick up where this one stopped. */
interface PartState {
  url: string;
  total: number;
  ranged: boolean;
  etag?: string;
  lastModified?: string;
  segments: Segment[];
}

const TICK_MS = 500;
const SAVE_EVERY_TICKS = 2;

export function partPaths(dir: string, filename: string): { part: string; state: string } {
  const part = path.join(dir, `${filename}.part`);
  return { part, state: `${part}.json` };
}

/** `name.ext`, else `name (1).ext`, `name (2).ext`, … whichever is free. */
export function uniquePath(file: string): string {
  if (!existsSync(file)) return file;
  const ext = path.extname(file);
  const stem = file.slice(0, file.length - ext.length);
  for (let i = 1; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
}

async function loadState(file: string): Promise<PartState | null> {
  try {
    const s = JSON.parse(await fs.readFile(file, "utf8")) as PartState;
    return Array.isArray(s.segments) ? s : null;
  } catch {
    return null;
  }
}

// A saved partial is only trusted when the server still describes the same
// file: same size and, where it gave one, the same validator. Otherwise the
// bytes on disk belong to a different version and splicing would corrupt it.
export function canResume(saved: PartState | null, fresh: HttpProbe): boolean {
  if (!saved || !saved.ranged || !fresh.ranged) return false;
  if (saved.total !== fresh.total) return false;
  if (saved.etag && fresh.etag && saved.etag !== fresh.etag) return false;
  if (saved.lastModified && fresh.lastModified && saved.lastModified !== fresh.lastModified) return false;
  return true;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Download `url` into `dir/filename` over up to `connections` parallel byte
 * ranges, IDM style: every connection that finishes early splits the biggest
 * remaining range and takes its back half. Progress persists to a sidecar, so
 * an abort (pause) or a crash resumes from the bytes already on disk. Returns
 * the final path; aborting rejects with AbortedError and keeps the partial.
 */
export async function downloadSegmented(o: SegmentedOptions): Promise<string> {
  const minSplit = o.minSplit ?? MIN_SEGMENT;
  const limiters = o.limiters ?? [];
  const retryDelay = o.retryDelayMs ?? 1000;
  const headers = { "User-Agent": USER_AGENT, ...o.headers };
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  o.signal?.addEventListener("abort", onOuterAbort, { once: true });
  if (o.signal?.aborted) inner.abort();
  const signal = inner.signal;

  await fs.mkdir(o.dir, { recursive: true });
  const { part, state: stateFile } = partPaths(o.dir, o.filename);

  const probe = await probeHttp(o.url, { signal, headers: o.headers });
  const saved = existsSync(part) ? await loadState(stateFile) : null;
  const resume = canResume(saved, probe);
  const state: PartState = resume
    ? saved!
    : {
        url: probe.url,
        total: probe.total,
        ranged: probe.ranged,
        etag: probe.etag,
        lastModified: probe.lastModified,
        segments: probe.ranged ? planSegments(probe.total, o.connections, minSplit) : [],
      };
  // Fetch from wherever the redirect lands now: signed CDN links expire, and
  // the original URL mints a fresh one.
  state.url = probe.url;

  const fh = await fs.open(part, resume ? "r+" : "w");
  let live = 0;
  let lastBytes = resume ? totalDone(state.segments) : 0;
  let streamed = 0; // for unranged downloads
  let speed = 0;
  let ticks = 0;

  const downloaded = () => (state.ranged ? totalDone(state.segments) : streamed);
  const report = () => {
    const now = downloaded();
    const inst = ((now - lastBytes) * 1000) / TICK_MS;
    lastBytes = now;
    speed = speed ? speed * 0.7 + inst * 0.3 : inst;
    const left = state.total - now;
    o.onProgress?.({
      downloaded: now,
      total: state.total,
      speed,
      eta: speed > 0 && state.total > 0 ? left / speed : undefined,
      connections: live,
    });
  };
  const save = () => (state.ranged ? writeJsonAtomic(stateFile, state).catch(() => {}) : Promise.resolve());

  const timer = setInterval(() => {
    report();
    if (++ticks % SAVE_EVERY_TICKS === 0) void save();
  }, TICK_MS);
  timer.unref?.();

  // One connection working one segment until it is done (its end may move
  // closer while it runs, when another connection splits it).
  async function rangeWorker(seg: Segment): Promise<void> {
    let attempt = 0;
    while (remaining(seg) > 0) {
      if (signal.aborted) throw new AbortedError();
      const from = seg.start + seg.done;
      try {
        const res = await fetch(state.url, {
          headers: { ...headers, Range: `bytes=${from}-${seg.end}` },
          redirect: "follow",
          signal,
        });
        if (res.status !== 206 || !res.body) {
          await res.body?.cancel().catch(() => {});
          throw new Error(`HTTP ${res.status} on a range request`);
        }
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          await takeAll(limiters, chunk.length);
          const pos = seg.start + seg.done;
          const room = seg.end - pos + 1;
          if (room <= 0) break;
          const n = Math.min(room, chunk.length);
          // Claim the bytes before awaiting the write, so a split that runs
          // during the write measures from past them.
          seg.done += n;
          await fh.write(chunk, 0, n, pos);
          attempt = 0;
          if (n < chunk.length) break;
        }
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (++attempt > o.retries) throw err;
        await sleep(retryDelay * attempt);
      }
    }
  }

  // Servers without byte ranges get one plain stream; any failure starts over.
  async function streamWorker(): Promise<void> {
    let attempt = 0;
    for (;;) {
      if (signal.aborted) throw new AbortedError();
      try {
        streamed = 0;
        lastBytes = 0;
        await fh.truncate(0);
        const res = await fetch(state.url, { headers, redirect: "follow", signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          await takeAll(limiters, chunk.length);
          const pos = streamed;
          streamed += chunk.length;
          await fh.write(chunk, 0, chunk.length, pos);
        }
        if (!state.total) state.total = streamed;
        return;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (++attempt > o.retries) throw err;
        await sleep(retryDelay * attempt);
      }
    }
  }

  try {
    if (!state.ranged) {
      live = 1;
      await streamWorker();
    } else {
      if (!resume) await fh.truncate(state.total);
      await new Promise<void>((resolve, reject) => {
        const claimed = new Set<Segment>();
        let failed = false;
        const next = (): Segment | null =>
          state.segments.find((s) => remaining(s) > 0 && !claimed.has(s)) ??
          splitLargest(state.segments, minSplit);
        const launch = (): void => {
          while (!failed && live < o.connections) {
            const seg = next();
            if (!seg) break;
            claimed.add(seg);
            live++;
            rangeWorker(seg).then(
              () => {
                claimed.delete(seg);
                live--;
                if (!failed) launch();
              },
              (err) => {
                live--;
                if (failed) return;
                failed = true;
                inner.abort();
                reject(err);
              },
            );
          }
          if (live === 0 && !failed) resolve();
        };
        launch();
      });
    }
  } catch (err) {
    clearInterval(timer);
    await save();
    await fh.close().catch(() => {});
    o.signal?.removeEventListener("abort", onOuterAbort);
    throw o.signal?.aborted ? new AbortedError() : err;
  }

  clearInterval(timer);
  live = 0;
  report();
  await fh.close();
  o.signal?.removeEventListener("abort", onOuterAbort);
  const final = uniquePath(path.join(o.dir, o.filename));
  await fs.rename(part, final);
  await fs.rm(stateFile, { force: true });
  return final;
}

/** Remove a cancelled download's partial and its sidecar. */
export async function discardPartial(dir: string, filename: string): Promise<void> {
  const { part, state } = partPaths(dir, filename);
  await fs.rm(part, { force: true });
  await fs.rm(state, { force: true });
}
