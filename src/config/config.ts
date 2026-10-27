import { promises as fs } from "node:fs";
import { configFile, defaultDownloadDir } from "./paths";
import { writeJsonAtomic } from "../util/atomic";

export const BROWSERS = ["chrome", "firefox", "edge", "brave", "opera", "vivaldi", "safari"] as const;

export interface Config {
  downloadDir: string;
  /** Sort finished files into Video / Music / Images / … under downloadDir. */
  sortByCategory: boolean;
  /** Downloads running at once; the rest wait in the queue. */
  maxConcurrent: number;
  /** Parallel connections per direct-file download. */
  segments: number;
  /** Global speed cap in bytes/s; 0 means unlimited. */
  speedLimit: number;
  /** Retries per connection before a download is marked failed. */
  retries: number;
  /** Browser to borrow cookies from for logged-in content, or null. */
  cookiesFromBrowser: string | null;
  clipboardWatch: boolean;
  /** "HH:MM" the queue starts at, or null to start right away. */
  scheduleStart: string | null;
  /** "HH:MM" the queue pauses at, or null to never stop. */
  scheduleStop: string | null;
  /** Default quality for media: "best", "2160", "1080", …, "audio". */
  quality: string;
  /** Color theme name (see ui/theme.ts). */
  theme: string;
}

export const DEFAULT_CONFIG: Config = {
  downloadDir: defaultDownloadDir,
  sortByCategory: true,
  maxConcurrent: 3,
  segments: 8,
  speedLimit: 0,
  retries: 5,
  cookiesFromBrowser: null,
  clipboardWatch: false,
  scheduleStart: null,
  scheduleStop: null,
  quality: "best",
  theme: "torlink",
};

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Merge whatever is on disk over the defaults, field by field, so a config
// from an older version (or a hand edit gone wrong) never crashes startup.
export function normalizeConfig(raw: unknown): Config {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  return {
    downloadDir: typeof r.downloadDir === "string" && r.downloadDir ? r.downloadDir : d.downloadDir,
    sortByCategory: typeof r.sortByCategory === "boolean" ? r.sortByCategory : d.sortByCategory,
    maxConcurrent: clampInt(r.maxConcurrent, 1, 16, d.maxConcurrent),
    segments: clampInt(r.segments, 1, 32, d.segments),
    speedLimit: clampInt(r.speedLimit, 0, Number.MAX_SAFE_INTEGER, d.speedLimit),
    retries: clampInt(r.retries, 0, 50, d.retries),
    cookiesFromBrowser:
      typeof r.cookiesFromBrowser === "string" && r.cookiesFromBrowser ? r.cookiesFromBrowser : null,
    clipboardWatch: typeof r.clipboardWatch === "boolean" ? r.clipboardWatch : d.clipboardWatch,
    scheduleStart: typeof r.scheduleStart === "string" && HHMM.test(r.scheduleStart) ? r.scheduleStart : null,
    scheduleStop: typeof r.scheduleStop === "string" && HHMM.test(r.scheduleStop) ? r.scheduleStop : null,
    quality: typeof r.quality === "string" && r.quality ? r.quality : d.quality,
    theme: typeof r.theme === "string" && r.theme ? r.theme : d.theme,
  };
}

export async function loadConfig(): Promise<Config> {
  try {
    return normalizeConfig(JSON.parse(await fs.readFile(configFile, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await writeJsonAtomic(configFile, config);
}
