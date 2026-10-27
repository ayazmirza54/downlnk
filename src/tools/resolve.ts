import { EventEmitter } from "node:events";
import { existsSync, promises as fs, statSync } from "node:fs";
import path from "node:path";
import { toolsDir } from "../config/paths";
import { downloadSegmented } from "../engines/http/segmented";
import type { Progress } from "../engines/types";
import { capture } from "./spawn";

export type ToolName = "yt-dlp" | "gallery-dl" | "ffmpeg";

const WIN = process.platform === "win32";

/** Look `name` up on PATH the way a shell would (PATHEXT included on Windows). */
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const exts = WIN ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

export function managedPath(name: ToolName): string {
  return path.join(toolsDir, WIN ? `${name}.exe` : name);
}

const YTDLP_ASSET: Partial<Record<string, string>> = {
  "win32-x64": "yt-dlp.exe",
  "win32-arm64": "yt-dlp_arm64.exe",
  "win32-ia32": "yt-dlp_x86.exe",
  "darwin-x64": "yt-dlp_macos",
  "darwin-arm64": "yt-dlp_macos",
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
};

const GALLERYDL_ASSET: Partial<Record<string, string>> = {
  "win32-x64": "gallery-dl.exe",
  "win32-arm64": "gallery-dl.exe",
  "linux-x64": "gallery-dl.bin",
};

/** Official standalone build for this machine, or null where none is published. */
export function releaseUrl(name: ToolName, platform = process.platform, arch = process.arch): string | null {
  const key = `${platform}-${arch}`;
  if (name === "yt-dlp") {
    const asset = YTDLP_ASSET[key];
    return asset ? `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}` : null;
  }
  if (name === "gallery-dl") {
    const asset = GALLERYDL_ASSET[key];
    return asset ? `https://github.com/mikf/gallery-dl/releases/latest/download/${asset}` : null;
  }
  return null;
}

export const INSTALL_HINT: Record<ToolName, string> = {
  "yt-dlp": "pipx install yt-dlp  (or: brew install yt-dlp)",
  "gallery-dl": "pipx install gallery-dl  (or: brew install gallery-dl)",
  ffmpeg: WIN
    ? "winget install Gyan.FFmpeg  (or: choco install ffmpeg)"
    : process.platform === "darwin"
      ? "brew install ffmpeg"
      : "sudo apt install ffmpeg  (or your distro's package)",
};

const cache = new Map<ToolName, string>();

/** A copy already installed (PATH first, then one downlnk fetched), unverified. */
export function locateTool(name: ToolName): string | null {
  if (cache.has(name)) return cache.get(name)!;
  return findOnPath(name) ?? (existsSync(managedPath(name)) ? managedPath(name) : null);
}

const inflight = new Map<ToolName, Promise<string>>();

/**
 * "fetch" (name) when a first-run download of a tool starts, "progress"
 * (name, Progress) while it runs, "ready" (name) when done. Lets the UI say
 * why the first link takes a moment.
 */
export const toolEvents = new EventEmitter();

/**
 * The path of a copy that actually runs. A PATH entry can be a dead shim (a
 * pip script left behind by a removed Python), so each candidate must answer
 * --version first. With none working, fetch the official standalone build
 * into downlnk's data folder. Throws with an install hint when there's no
 * build to fetch for this platform.
 */
export function ensureTool(name: ToolName, onProgress?: (p: Progress) => void): Promise<string> {
  const have = cache.get(name);
  if (have) return Promise.resolve(have);
  const running = inflight.get(name);
  if (running) return running;
  const job = (async () => {
    const candidates = [findOnPath(name), existsSync(managedPath(name)) ? managedPath(name) : null];
    for (const c of candidates) {
      if (c && (await toolVersion(c))) {
        cache.set(name, c);
        return c;
      }
    }
    return fetchTool(name, onProgress);
  })().finally(() => inflight.delete(name));
  inflight.set(name, job);
  return job;
}

async function fetchTool(name: ToolName, onProgress?: (p: Progress) => void): Promise<string> {
  const url = releaseUrl(name);
  if (!url) throw new Error(`${name} is not installed. Install it with: ${INSTALL_HINT[name]}`);
  const dest = managedPath(name);
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.rm(dest, { force: true });
  toolEvents.emit("fetch", name);
  const out = await downloadSegmented({
    url,
    dir: toolsDir,
    filename: path.basename(dest),
    connections: 4,
    retries: 3,
    onProgress: (p) => {
      onProgress?.(p);
      toolEvents.emit("progress", name, p);
    },
  }).finally(() => toolEvents.emit("ready", name));
  if (!WIN) await fs.chmod(out, 0o755);
  cache.set(name, out);
  return out;
}

export async function toolVersion(file: string): Promise<string | null> {
  const flag = path.basename(file).toLowerCase().startsWith("ffmpeg") ? "-version" : "--version";
  const r = await capture(file, [flag], { timeoutMs: 20_000 });
  if (r.code !== 0) return null;
  const first = r.stdout.split(/\r?\n/)[0]?.trim() ?? "";
  return first.replace(/^ffmpeg version\s+/, "").split(" ")[0] || first || null;
}

export interface ToolStatus {
  name: ToolName;
  path: string | null;
  managed: boolean;
  version: string | null;
}

export async function toolStatus(name: ToolName): Promise<ToolStatus> {
  for (const p of [findOnPath(name), existsSync(managedPath(name)) ? managedPath(name) : null]) {
    const version = p ? await toolVersion(p) : null;
    if (p && version) return { name, path: p, managed: p === managedPath(name), version };
  }
  return { name, path: null, managed: false, version: null };
}

/**
 * Refresh the copies downlnk manages by fetching the latest release again.
 * Copies found on PATH belong to the user's package manager and are left
 * alone; the returned lines say so.
 */
export async function updateTools(log: (line: string) => void): Promise<void> {
  for (const name of ["yt-dlp", "gallery-dl"] as const) {
    const onPath = findOnPath(name);
    const v = onPath ? await toolVersion(onPath) : null;
    if (onPath && v) {
      log(`${name} ${v} found at ${onPath}; update it with your package manager.`);
      continue;
    }
    if (!releaseUrl(name)) {
      log(`${name}: no standalone build for this platform. Install it with: ${INSTALL_HINT[name]}`);
      continue;
    }
    log(`${name}: fetching the latest release…`);
    cache.delete(name);
    await fs.rm(managedPath(name), { force: true });
    const file = await ensureTool(name);
    log(`${name} ${(await toolVersion(file)) ?? ""} ready at ${file}`);
  }
  const ff = locateTool("ffmpeg");
  log(ff ? `ffmpeg found at ${ff}` : `ffmpeg not found (needed to merge HD video and extract audio): ${INSTALL_HINT.ffmpeg}`);
}
