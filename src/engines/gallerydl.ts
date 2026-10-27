import { promises as fs } from "node:fs";
import type { DownloadItem } from "../download/types";
import { ensureTool } from "../tools/resolve";
import { capture, killTree, lastError, readLines, spawnTool } from "../tools/spawn";
import { AbortedError, type RunContext } from "./types";

export interface GalleryInfo {
  title: string;
  /** Files the extractor listed; 0 when it only knows of sub-galleries. */
  count: number;
}

// gallery-dl -j prints one JSON array of messages: [2, meta] opens a
// directory, [3, url, meta] is a file, [6, url, meta] queues another page.
type Message = [number, ...unknown[]];

const TITLE_KEYS = ["title", "gallery_title", "description", "content", "subreddit", "username", "author", "user"];

function pickTitle(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  for (const k of TITLE_KEYS) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\s+/g, " ").slice(0, 120);
    if (v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string") {
      return (v as { name: string }).name;
    }
  }
  // Albums nest their own metadata (imgur's "album": {"title": …}).
  for (const k of ["album", "gallery", "post"]) {
    const t = (meta[k] as { title?: unknown } | undefined)?.title;
    if (typeof t === "string" && t.trim()) return t.trim().slice(0, 120);
  }
  const cat = typeof meta.category === "string" ? meta.category : "";
  const id = meta.id ?? meta.post_id ?? meta.gallery_id;
  return cat || id ? `${cat} ${id ?? ""}`.trim() : undefined;
}

export function summarizeGallery(messages: Message[]): GalleryInfo {
  let title: string | undefined;
  let count = 0;
  for (const m of messages) {
    if (m[0] === 2) title ??= pickTitle(m[1] as Record<string, unknown>);
    else if (m[0] === 3) {
      count++;
      title ??= pickTitle(m[2] as Record<string, unknown>);
    }
  }
  return { title: title ?? "Gallery", count };
}

function cookieArgs(browser: string | null): string[] {
  return browser ? ["--cookies-from-browser", browser] : [];
}

export async function probeGallery(
  url: string,
  { signal, cookiesFromBrowser = null }: { signal?: AbortSignal; cookiesFromBrowser?: string | null } = {},
): Promise<GalleryInfo> {
  const bin = await ensureTool("gallery-dl");
  const r = await capture(bin, ["-j", ...cookieArgs(cookiesFromBrowser), url], { timeoutMs: 90_000, signal });
  if (signal?.aborted) throw new AbortedError();
  let messages: Message[] = [];
  try {
    const parsed = JSON.parse(r.stdout) as unknown;
    if (Array.isArray(parsed)) messages = parsed as Message[];
  } catch {}
  // gallery-dl also exits non-zero for a partial failure; trust the files it found.
  const info = summarizeGallery(messages);
  if (info.count === 0 && !messages.some((m) => m[0] === 6)) {
    throw new Error(r.code === 0 ? "no images found at this link" : lastError(r.stderr));
  }
  return info;
}

/** gallery-dl prints each file it saves; "# " marks one already on disk. */
export function parseFileLine(line: string): { path: string; skipped: boolean } | null {
  const t = line.trim();
  if (!t || t.startsWith("[")) return null;
  if (t.startsWith("# ")) return { path: t.slice(2), skipped: true };
  return /[\\/]/.test(t) ? { path: t, skipped: false } : null;
}

export async function runGallery(item: DownloadItem, ctx: RunContext): Promise<string[]> {
  const bin = await ensureTool("gallery-dl");
  await fs.mkdir(item.dir, { recursive: true });
  const args = ["-D", item.dir, "-R", String(ctx.retries), ...cookieArgs(ctx.cookiesFromBrowser)];
  if (ctx.rateLimit > 0) args.push("--limit-rate", String(Math.max(1024, Math.round(ctx.rateLimit))));
  args.push(item.url);
  const child = spawnTool(bin, args);

  const files: string[] = [];
  let downloaded = 0;
  let stderr = "";
  let lastAt = Date.now();
  let lastBytes = 0;
  let speed = 0;
  const filesTotal = item.filesTotal || undefined;

  readLines(child.stdout, (line) => {
    const f = parseFileLine(line);
    if (!f) return;
    files.push(f.path);
    void fs
      .stat(f.path)
      .then((st) => {
        downloaded += st.size;
        const now = Date.now();
        if (now - lastAt >= 500) {
          const inst = ((downloaded - lastBytes) * 1000) / (now - lastAt);
          speed = speed ? speed * 0.6 + inst * 0.4 : inst;
          lastAt = now;
          lastBytes = downloaded;
        }
      })
      .catch(() => {})
      .finally(() => {
        const done = files.length;
        const left = filesTotal ? Math.max(0, filesTotal - done) : 0;
        const avg = done ? downloaded / done : 0;
        ctx.onProgress({
          downloaded,
          total: filesTotal ? Math.max(downloaded, Math.round(avg * filesTotal)) : 0,
          speed,
          eta: speed > 0 && left ? (avg * left) / speed : undefined,
          filesDone: done,
          filesTotal,
        });
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
  // Non-zero with files saved is a partial success (one dead image in an
  // album); only fail when nothing came down at all.
  if (code !== 0 && files.length === 0) throw new Error(lastError(stderr));
  return files;
}

/**
 * A cancelled gallery keeps the images it already saved (each is a complete
 * file); only gallery-dl's half-written .part files go.
 */
export async function discardGallery(item: Pick<DownloadItem, "dir">): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(item.dir);
  } catch {
    return;
  }
  await Promise.all(
    names.filter((n) => n.endsWith(".part")).map((n) => fs.rm(`${item.dir}/${n}`, { force: true })),
  );
}
