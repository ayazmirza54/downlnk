import type { RateLimiter } from "./http/limiter";

export type EngineId = "http" | "ytdlp" | "gallerydl";

export interface Progress {
  downloaded: number;
  /** 0 when unknown. */
  total: number;
  /** Bytes per second. */
  speed: number;
  /** Seconds left, when it can be estimated. */
  eta?: number;
  /** Live connections (segmented HTTP only). */
  connections?: number;
  /** Files finished / expected (galleries and playlists). */
  filesDone?: number;
  filesTotal?: number;
  /** Short phase label, e.g. "merging" or "extracting audio". */
  stage?: string;
}

export interface RunContext {
  signal: AbortSignal;
  /** Global then per-download caps, for the in-process HTTP engine. */
  limiters: RateLimiter[];
  /** Effective cap in bytes/s for external tools (0 = none). */
  rateLimit: number;
  connections: number;
  retries: number;
  cookiesFromBrowser: string | null;
  onProgress: (p: Progress) => void;
}

/** Thrown when a run stops because its signal fired (pause or cancel). */
export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

export function isAborted(err: unknown): boolean {
  return err instanceof AbortedError || (err instanceof Error && err.name === "AbortError");
}
