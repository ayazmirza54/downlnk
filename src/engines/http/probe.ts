import path from "node:path";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface HttpProbe {
  /** URL after redirects; segments fetch from here. */
  url: string;
  /** Size in bytes, 0 when the server won't say. */
  total: number;
  /** Server honors byte ranges, so the file can be split and resumed. */
  ranged: boolean;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  filename: string;
}

const EXT_BY_TYPE: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-7z-compressed": ".7z",
  "application/gzip": ".gz",
  "application/x-msdownload": ".exe",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/html": ".html",
};

// Windows forbids these in file names; a server-supplied name is untrusted,
// so path separators go too (nothing may write outside the download folder).
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 200);
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** Filename from a Content-Disposition header, preferring RFC 5987 filename*. */
export function filenameFromDisposition(header?: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[2]!.trim().replace(/^"|"$/g, ""));
    } catch {}
  }
  const plain = header.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
  const v = plain ? (plain[2] ?? plain[1])!.trim() : undefined;
  return v || undefined;
}

export function filenameFromUrl(url: string): string | undefined {
  try {
    const base = path.posix.basename(new URL(url).pathname);
    return base ? decodeURIComponent(base) : undefined;
  } catch {
    return undefined;
  }
}

export function pickFilename(url: string, disposition?: string | null, contentType?: string): string {
  const raw = filenameFromDisposition(disposition) ?? filenameFromUrl(url) ?? "download";
  let name = sanitizeFilename(raw) || "download";
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  const ext = type ? EXT_BY_TYPE[type] : undefined;
  if (!path.extname(name) && ext) name += ext;
  return name;
}

export function parseContentRangeTotal(header?: string | null): number {
  const m = header?.match(/\/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/**
 * Ask for the first byte. A 206 answer proves ranges work (and its
 * Content-Range carries the size); a 200 means one plain stream. GET beats
 * HEAD here: plenty of CDNs answer HEAD differently from the real request.
 */
export async function probeHttp(
  url: string,
  { signal, headers = {} }: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<HttpProbe> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...headers, Range: "bytes=0-0" },
    redirect: "follow",
    signal,
  });
  try {
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    const ranged = res.status === 206;
    const total = ranged
      ? parseContentRangeTotal(res.headers.get("content-range"))
      : Number(res.headers.get("content-length") ?? 0) || 0;
    const contentType = res.headers.get("content-type") ?? undefined;
    return {
      url: res.url || url,
      total,
      ranged: ranged && total > 0,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
      contentType,
      filename: pickFilename(res.url || url, res.headers.get("content-disposition"), contentType),
    };
  } finally {
    await res.body?.cancel().catch(() => {});
  }
}
