import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { RateLimiter } from "../engines/http/limiter";
import { isAborted, type Progress } from "../engines/types";
import { discardItem, runItem, type Discarder, type Runner } from "./run";
import { DEFAULT_MEDIA, type DownloadItem, type NewDownload } from "./types";

export interface QueueSettings {
  maxConcurrent: number;
  connections: number;
  retries: number;
  /** Global cap in bytes/s, 0 = none. */
  speedLimit: number;
  cookiesFromBrowser: string | null;
}

export interface QueueDeps {
  runner?: Runner;
  discard?: Discarder;
  persist?: (items: readonly DownloadItem[]) => Promise<void> | void;
  /** Coalesce UI notifications to at most one per this many ms. */
  notifyMs?: number;
}

type Intent = "pause" | "cancel";

interface Running {
  ctrl: AbortController;
  intent: Intent | null;
}

const PERSIST_MS = 2000;

/**
 * Every download, active or finished, in one ordered list. Runs up to
 * maxConcurrent at once and starts the next queued item whenever one ends.
 * Pause aborts the engine (which keeps its partial on disk); resume queues it
 * again and the engine picks up where it stopped.
 */
export class DownloadQueue {
  private items: DownloadItem[] = [];
  private running = new Map<string, Running>();
  private limiters = new Map<string, RateLimiter>();
  private listeners = new Set<() => void>();
  private version = 0;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly runner: Runner;
  private readonly discard: Discarder;
  readonly global = new RateLimiter();
  /** Scheduled hold: queued items wait while this is set. */
  private holdUntil: string | null = null;

  constructor(
    private settings: QueueSettings,
    private deps: QueueDeps = {},
  ) {
    this.runner = deps.runner ?? runItem;
    this.discard = deps.discard ?? discardItem;
    this.global.setRate(settings.speedLimit);
  }

  // ---- observation ----

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getVersion = (): number => this.version;

  list(): readonly DownloadItem[] {
    return this.items;
  }

  get(id: string): DownloadItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  get activeCount(): number {
    return this.running.size;
  }

  get pendingCount(): number {
    return this.items.filter((i) => i.status !== "done").length;
  }

  /** Combined speed of everything running, bytes/s. */
  get totalSpeed(): number {
    return this.items.reduce((n, i) => n + (i.status === "downloading" ? i.speed : 0), 0);
  }

  get held(): string | null {
    return this.holdUntil;
  }

  private emit(now = false): void {
    if (now) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      this.version++;
      for (const fn of this.listeners) fn();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => this.emit(true), this.deps.notifyMs ?? 120);
    this.notifyTimer.unref?.();
  }

  private persistSoon(now = false): void {
    if (!this.deps.persist) return;
    if (now) {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = null;
      void this.deps.persist(this.items);
      return;
    }
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.persistSoon(true), PERSIST_MS);
    this.persistTimer.unref?.();
  }

  private changed(): void {
    this.emit(true);
    this.persistSoon(true);
  }

  // ---- settings ----

  setSettings(next: Partial<QueueSettings>): void {
    this.settings = { ...this.settings, ...next };
    if (next.speedLimit !== undefined) this.global.setRate(next.speedLimit);
    this.pump();
    this.emit(true);
  }

  getSettings(): Readonly<QueueSettings> {
    return this.settings;
  }

  /** Hold queued items until `label` (e.g. "02:00"); null releases them. */
  setHold(label: string | null): void {
    this.holdUntil = label;
    this.pump();
    this.emit(true);
  }

  // ---- lifecycle ----

  /** Restore a saved list. Anything that was mid-download goes back in line. */
  load(saved: readonly DownloadItem[]): void {
    this.items = saved.map((i) => ({
      ...i,
      media: { ...DEFAULT_MEDIA, ...i.media },
      files: i.files ?? [],
      status: i.status === "downloading" ? "queued" : i.status,
      speed: 0,
    }));
    this.pump();
    this.emit(true);
  }

  add(n: NewDownload): DownloadItem {
    const item: DownloadItem = {
      id: randomUUID().slice(0, 12),
      url: n.url,
      engine: n.engine,
      source: n.source,
      title: n.title,
      dir: n.dir,
      category: n.category,
      status: "queued",
      media: n.media ?? DEFAULT_MEDIA,
      filename: n.filename,
      files: [],
      downloaded: 0,
      total: n.total ?? 0,
      speed: 0,
      filesTotal: n.filesTotal,
      speedLimit: n.speedLimit,
      addedAt: Date.now(),
    };
    this.items.push(item);
    this.pump();
    this.changed();
    return item;
  }

  pause(id: string): void {
    const run = this.running.get(id);
    if (run) {
      run.intent = "pause";
      run.ctrl.abort();
      return;
    }
    const it = this.get(id);
    if (it && it.status === "queued") {
      it.status = "paused";
      this.changed();
    }
  }

  resume(id: string): void {
    const it = this.get(id);
    if (!it || (it.status !== "paused" && it.status !== "failed")) return;
    it.status = "queued";
    it.error = undefined;
    this.pump();
    this.changed();
  }

  togglePause(id: string): void {
    const it = this.get(id);
    if (!it) return;
    if (it.status === "downloading" || it.status === "queued") this.pause(id);
    else this.resume(id);
  }

  /** Stop a download and delete its partial data; finished files stay. */
  cancel(id: string): void {
    const run = this.running.get(id);
    if (run) {
      run.intent = "cancel";
      run.ctrl.abort();
      return;
    }
    const it = this.get(id);
    if (!it) return;
    if (it.status !== "done") void this.discard(it).catch(() => {});
    this.drop(id);
  }

  /** Take an entry off the list without touching anything on disk. */
  remove(id: string): void {
    if (this.running.has(id)) return;
    this.drop(id);
  }

  private drop(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.limiters.delete(id);
    this.changed();
  }

  retryFailed(): void {
    for (const it of this.items) if (it.status === "failed") this.resume(it.id);
  }

  pauseAll(): void {
    for (const it of this.items) {
      if (it.status === "downloading" || it.status === "queued") this.pause(it.id);
    }
  }

  resumeAll(): void {
    for (const it of this.items) if (it.status === "paused") this.resume(it.id);
  }

  clearDone(): void {
    this.items = this.items.filter((i) => i.status !== "done");
    this.changed();
  }

  setItemLimit(id: string, bytesPerSec: number): void {
    const it = this.get(id);
    if (!it) return;
    it.speedLimit = bytesPerSec > 0 ? bytesPerSec : undefined;
    this.limiters.get(id)?.setRate(bytesPerSec);
    this.changed();
  }

  /** Persist right now; for quitting. */
  async flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await this.deps.persist?.(this.items);
  }

  /** Stop everything running, leaving partials to resume next launch. */
  async stopAll(): Promise<void> {
    for (const run of this.running.values()) {
      run.intent = "pause";
      run.ctrl.abort();
    }
    for (const it of this.items) if (it.status === "downloading") it.status = "queued";
  }

  /** Resolves once nothing is queued or running (headless runs wait on this). */
  idle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const busy = this.items.some((i) => i.status === "queued" || i.status === "downloading");
        if (!busy) {
          unsub();
          resolve();
        }
      };
      const unsub = this.subscribe(check);
      check();
    });
  }

  // ---- scheduling ----

  private pump(): void {
    if (this.holdUntil) return;
    for (const it of this.items) {
      if (this.running.size >= this.settings.maxConcurrent) break;
      if (it.status === "queued" && !this.running.has(it.id)) this.start(it);
    }
  }

  private limiterFor(it: DownloadItem): RateLimiter {
    let l = this.limiters.get(it.id);
    if (!l) {
      l = new RateLimiter(it.speedLimit ?? 0);
      this.limiters.set(it.id, l);
    }
    return l;
  }

  // External tools can't share our token bucket, so each gets an even slice
  // of the global cap (tightened by its own cap, if it has one).
  private toolRate(it: DownloadItem): number {
    const share = this.settings.speedLimit > 0 ? this.settings.speedLimit / Math.max(1, this.running.size) : 0;
    const own = it.speedLimit ?? 0;
    if (share && own) return Math.min(share, own);
    return share || own;
  }

  // Extractor progress is per stream and estimates drift; once finished, the
  // files on disk are the honest size.
  private async settleSize(it: DownloadItem): Promise<void> {
    let sum = 0;
    for (const f of it.files) sum += await fs.stat(f).then((s) => s.size, () => 0);
    if (sum > 0) {
      it.total = sum;
      it.downloaded = sum;
      this.changed();
    }
  }

  private start(it: DownloadItem): void {
    const run: Running = { ctrl: new AbortController(), intent: null };
    this.running.set(it.id, run);
    it.status = "downloading";
    it.error = undefined;
    it.stage = undefined;
    this.changed();

    const onProgress = (p: Progress) => {
      if (run.intent) return;
      it.downloaded = p.downloaded;
      if (p.total > 0) it.total = p.total;
      it.speed = p.speed;
      it.eta = p.eta;
      it.connections = p.connections;
      if (p.filesDone !== undefined) it.filesDone = p.filesDone;
      if (p.filesTotal !== undefined) it.filesTotal = p.filesTotal;
      it.stage = p.stage;
      this.emit();
      this.persistSoon();
    };

    void this.runner(it, {
      signal: run.ctrl.signal,
      limiters: [this.global, this.limiterFor(it)],
      rateLimit: this.toolRate(it),
      connections: this.settings.connections,
      retries: this.settings.retries,
      cookiesFromBrowser: this.settings.cookiesFromBrowser,
      onProgress,
    }).then(
      (files) => {
        this.running.delete(it.id);
        if (run.intent === "cancel") {
          // Finished in the same instant it was cancelled: the files are
          // complete, so keep them and just drop the entry.
          this.drop(it.id);
        } else {
          it.status = "done";
          it.files = files;
          if (it.total > 0) it.downloaded = it.total;
          else it.total = it.downloaded;
          it.speed = 0;
          it.eta = undefined;
          it.stage = undefined;
          it.completedAt = Date.now();
          if (it.engine !== "http" && files.length) void this.settleSize(it);
        }
        this.pump();
        this.changed();
      },
      (err: unknown) => {
        this.running.delete(it.id);
        it.speed = 0;
        it.eta = undefined;
        it.connections = undefined;
        it.stage = undefined;
        if (run.intent === "cancel") {
          void this.discard(it).catch(() => {});
          this.drop(it.id);
        } else if (run.intent === "pause" || isAborted(err)) {
          if (it.status === "downloading") it.status = run.intent === "pause" ? "paused" : "queued";
        } else {
          it.status = "failed";
          it.error = err instanceof Error ? err.message : String(err);
        }
        this.pump();
        this.changed();
      },
    );
  }
}
