import path from "node:path";
import type { Config } from "../config/config";
import { probeGallery, type GalleryInfo } from "../engines/gallerydl";
import { probeHttp, sanitizeFilename, type HttpProbe } from "../engines/http/probe";
import { probeYtdlp, type MediaInfo } from "../engines/ytdlp";
import { AbortedError, isAborted } from "../engines/types";
import { route, type Route } from "../router";
import { categoryFor } from "./category";
import { DEFAULT_MEDIA, type MediaOptions, type NewDownload } from "./types";

const LOGIN_SITES = new Set(["instagram", "facebook", "reddit", "x", "tiktok"]);

export type Resolved =
  | { engine: "http"; route: Route; probe: HttpProbe }
  | { engine: "ytdlp"; route: Route; info: MediaInfo }
  | { engine: "gallerydl"; route: Route; info: GalleryInfo };

export interface ResolveOptions {
  signal?: AbortSignal;
  cookiesFromBrowser?: string | null;
}

/**
 * Work out what a URL is and which engine should fetch it: walk the route's
 * engines in order and take the first that recognizes it. Errors from the
 * preferred engine win, since they say the most about the link.
 */
export async function resolveUrl(raw: string, opts: ResolveOptions = {}): Promise<Resolved> {
  const r = route(raw);
  if (!r) throw new Error("That doesn't look like a link.");
  const errors: string[] = [];
  for (const engine of r.engines) {
    if (opts.signal?.aborted) throw new AbortedError();
    try {
      if (engine === "http") {
        const probe = await probeHttp(r.url, { signal: opts.signal });
        // A page, not a file: let the extractors have a go at it first.
        const html = /text\/html|application\/xhtml/i.test(probe.contentType ?? "");
        if (html && !r.direct && r.engines.length > 1) continue;
        return { engine, route: r, probe };
      }
      if (engine === "ytdlp") {
        return { engine, route: r, info: await probeYtdlp(r.url, opts) };
      }
      return { engine, route: r, info: await probeGallery(r.url, opts) };
    } catch (err) {
      if (isAborted(err) || opts.signal?.aborted) throw new AbortedError();
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  let msg = errors[0] ?? "Nothing downloadable found at this link.";
  // These sites hide most posts from logged-out visitors; point at the fix.
  if (LOGIN_SITES.has(r.source) && !opts.cookiesFromBrowser) {
    msg = `${msg.replace(/\s*Use --cookies.*$/i, "")} · ${r.source} may need you signed in: pick your browser for cookies (c in the app, --cookies-from-browser on the command line)`;
  }
  throw new Error(msg);
}

export function titleOf(res: Resolved): string {
  if (res.engine === "http") return res.probe.filename;
  return res.info.title;
}

/** Bytes expected, when known. */
export function sizeOf(res: Resolved): number {
  if (res.engine === "http") return res.probe.total;
  if (res.engine === "ytdlp") return res.info.sizeEstimate ?? 0;
  return 0;
}

/**
 * Turn a resolved link plus the picker's choices into a queue entry. With no
 * folder override, files sort into a category folder under the download root
 * (Video, Music, Images, …), IDM style; a gallery also gets its own subfolder.
 */
export function toNewDownload(
  res: Resolved,
  config: Pick<Config, "downloadDir" | "sortByCategory">,
  media: MediaOptions = DEFAULT_MEDIA,
  dirOverride?: string,
): NewDownload {
  const filename = res.engine === "http" ? res.probe.filename : undefined;
  const category = categoryFor(res.engine, media, filename);
  let dir = dirOverride ?? (config.sortByCategory ? path.join(config.downloadDir, category) : config.downloadDir);
  if (res.engine === "gallerydl") dir = path.join(dir, sanitizeFilename(res.info.title) || "Gallery");
  return {
    // The original link, not where it redirected: signed CDN URLs expire, and
    // the original mints a fresh one on resume.
    url: res.route.url,
    engine: res.engine,
    source: res.route.source,
    title: titleOf(res),
    dir,
    category,
    media,
    filename,
    // yt-dlp's estimate describes the best formats; any other pick would
    // show a wildly wrong size until the real streams report in.
    total: res.engine === "ytdlp" && media.quality !== "best" ? 0 : sizeOf(res),
    filesTotal:
      res.engine === "gallerydl"
        ? res.info.count
        : res.engine === "ytdlp" && res.info.isPlaylist
          ? res.info.entries
          : undefined,
  };
}
