import type { EngineId } from "./engines/types";

export type SourceId =
  | "youtube"
  | "instagram"
  | "facebook"
  | "reddit"
  | "x"
  | "tiktok"
  | "vimeo"
  | "twitch"
  | "soundcloud"
  | "pinterest"
  | "imgur"
  | "tumblr"
  | "web";

interface HostRule {
  hosts: string[];
  source: SourceId;
  /** Engines to try, in order, for this site; may depend on the path. */
  engines: (u: URL) => EngineId[];
}

const VIDEO_FIRST: EngineId[] = ["ytdlp", "gallerydl"];
const IMAGES_FIRST: EngineId[] = ["gallerydl", "ytdlp"];

const RULES: HostRule[] = [
  { hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"], source: "youtube", engines: () => ["ytdlp"] },
  {
    hosts: ["instagram.com"],
    source: "instagram",
    // Reels and stories are video; posts are often carousels of photos; a
    // bare profile is a gallery.
    engines: (u) =>
      /^\/(reels?|tv|stories)\//.test(u.pathname)
        ? VIDEO_FIRST
        : /^\/p\//.test(u.pathname)
          ? IMAGES_FIRST
          : ["gallerydl"],
  },
  { hosts: ["facebook.com", "fb.watch", "fb.com"], source: "facebook", engines: () => VIDEO_FIRST },
  {
    hosts: ["reddit.com", "redd.it"],
    source: "reddit",
    engines: (u) =>
      u.hostname === "i.redd.it" ? ["http"] : u.hostname === "v.redd.it" ? ["ytdlp"] : VIDEO_FIRST,
  },
  { hosts: ["x.com", "twitter.com"], source: "x", engines: () => VIDEO_FIRST },
  { hosts: ["tiktok.com"], source: "tiktok", engines: () => ["ytdlp"] },
  { hosts: ["vimeo.com"], source: "vimeo", engines: () => ["ytdlp"] },
  { hosts: ["twitch.tv"], source: "twitch", engines: () => ["ytdlp"] },
  { hosts: ["soundcloud.com"], source: "soundcloud", engines: () => ["ytdlp"] },
  { hosts: ["pinterest.com", "pin.it"], source: "pinterest", engines: () => IMAGES_FIRST },
  { hosts: ["imgur.com"], source: "imgur", engines: (u) => (u.hostname === "i.imgur.com" ? ["http"] : IMAGES_FIRST) },
  { hosts: ["tumblr.com"], source: "tumblr", engines: () => IMAGES_FIRST },
  {
    hosts: ["deviantart.com", "artstation.com", "flickr.com", "danbooru.donmai.us", "bsky.app", "pixiv.net"],
    source: "web",
    engines: () => IMAGES_FIRST,
  },
  {
    hosts: ["dailymotion.com", "bilibili.com", "streamable.com", "rumble.com", "bandcamp.com", "kick.com"],
    source: "web",
    engines: () => ["ytdlp"],
  },
];

// A path ending in one of these is a file, not a page: skip the extractors.
const FILE_EXT =
  /\.(zip|rar|7z|tar|gz|bz2|xz|zst|iso|img|dmg|exe|msi|msix|appimage|deb|rpm|apk|pdf|epub|mobi|docx?|xlsx?|pptx?|csv|txt|mp4|mkv|webm|mov|avi|m4v|mp3|m4a|flac|wav|ogg|opus|aac|jpe?g|png|gif|webp|avif|bmp|svg|tiff?|bin|torrent|json|xml)$/i;

export function parseUrl(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u;
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, host: string): boolean {
  const h = hostname.toLowerCase();
  return h === host || h.endsWith(`.${host}`);
}

export interface Route {
  url: string;
  source: SourceId;
  /** Engines to try in order; "http" last means "sniff, then download the file itself". */
  engines: EngineId[];
  /** True when the URL plainly points at a file. */
  direct: boolean;
}

export function route(raw: string): Route | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const url = u.toString();
  if (FILE_EXT.test(u.pathname)) {
    const rule = RULES.find((r) => r.hosts.some((h) => hostMatches(u.hostname, h)));
    return { url, source: rule?.source ?? "web", engines: ["http"], direct: true };
  }
  const rule = RULES.find((r) => r.hosts.some((h) => hostMatches(u.hostname, h)));
  if (rule) return { url, source: rule.source, engines: rule.engines(u), direct: false };
  // Unknown site: look at what the URL serves first. A file downloads as
  // itself; a web page goes to the extractors, which know thousands of sites.
  return { url, source: "web", engines: ["http", "ytdlp", "gallerydl"], direct: false };
}

/** Pull every http(s) URL out of pasted text: one per line, or space-separated. */
export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const u = parseUrl(raw.replace(/[),.;\]]+$/, ""));
    if (u && !seen.has(u.toString())) {
      seen.add(u.toString());
      out.push(u.toString());
    }
  }
  return out;
}

/** True for a URL downlnk has a dedicated route for (used by the clipboard watcher). */
export function isSupportedUrl(raw: string): boolean {
  const u = parseUrl(raw);
  if (!u || !/^https?:\/\//i.test(raw.trim())) return false;
  if (FILE_EXT.test(u.pathname)) return true;
  return RULES.some((r) => r.hosts.some((h) => hostMatches(u.hostname, h)));
}
