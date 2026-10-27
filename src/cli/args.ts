import { THEME_NAMES } from "../ui/theme";

export interface GetOptions {
  urls: string[];
  /** Text files with one link per line (IDM's "import list"). */
  files: string[];
  output?: string;
  quality?: string;
  audioFormat?: "mp3" | "m4a";
  subtitles: boolean;
  playlist: boolean;
  connections?: number;
  limit?: number;
  cookiesFromBrowser?: string;
  sort: boolean;
}

export type Command =
  | { kind: "tui"; urls: string[]; theme?: string }
  | { kind: "get"; opts: GetOptions }
  | { kind: "info"; url: string }
  | { kind: "queue-add"; opts: GetOptions }
  | { kind: "queue-list" }
  | { kind: "queue-start"; limit?: number }
  | { kind: "update-tools" }
  | { kind: "tools" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "invalid"; message: string };

export const HELP_TEXT = `downlnk: a download manager in your terminal

Usage
  downlnk [url…]                 open the app (links are added right away)
  downlnk --theme <name>         open with a color theme: torlink, ocean,
                                 ember, forest, rose, mono, paper (t cycles)
  downlnk get <url…> [options]   download, show progress, exit when done
  downlnk info <url>             print what downlnk finds at a link, as JSON
  downlnk queue add <url…>       add to the saved queue without starting
  downlnk queue list             print the saved queue as JSON
  downlnk queue start            run the saved queue headless until it's empty
  downlnk tools                  show which yt-dlp / gallery-dl / ffmpeg are used
  downlnk update-tools           fetch the latest yt-dlp and gallery-dl builds

Options
  -o, --output <dir>             save here instead of the sorted download folder
  -q, --quality <q>              best, 2160, 1440, 1080, 720, 480, 360 or audio
  -a, --audio [mp3|m4a]          audio only (default mp3)
      --subs                     fetch English subtitles too
      --no-playlist              just the video, when a link is also a playlist
  -c, --connections <n>          parallel connections per file (default 8)
  -l, --limit <rate>             speed cap, e.g. 500K or 2M (per second)
      --cookies-from-browser <b> use your logged-in session from chrome,
                                 firefox, edge, brave, … (never a password)
  -i, --input <file>             read links from a text file, one per line
      --no-sort                  don't sort into Video / Music / Images / …
  -h, --help                     show this
  -v, --version                  print the version`;

const UNITS: Record<string, number> = { "": 1, B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

/** "500K", "2M", "1.5m", "800" → bytes per second; null if unreadable. */
export function parseRate(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*([kmg]?)(?:i?b)?(?:\/s)?$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * (UNITS[m[2]!.toUpperCase()] ?? 1));
}

const QUALITIES = new Set(["best", "2160", "1440", "1080", "720", "480", "360", "240", "audio"]);

function parseGet(args: string[]): GetOptions | string {
  const o: GetOptions = { urls: [], files: [], subtitles: false, playlist: true, sort: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const val = () => {
      const v = args[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === "-o" || a === "--output") o.output = val();
      else if (a === "-q" || a === "--quality") {
        const q = val().toLowerCase().replace(/p$/, "");
        if (!QUALITIES.has(q)) return `unknown quality '${q}'`;
        o.quality = q;
      } else if (a === "-a" || a === "--audio") {
        o.quality = "audio";
        const next = args[i + 1];
        if (next === "mp3" || next === "m4a") o.audioFormat = (i++, next);
      } else if (a === "--subs") o.subtitles = true;
      else if (a === "--no-playlist") o.playlist = false;
      else if (a === "--no-sort") o.sort = false;
      else if (a === "-c" || a === "--connections") {
        const n = Number(val());
        if (!Number.isInteger(n) || n < 1 || n > 32) return "connections must be 1 to 32";
        o.connections = n;
      } else if (a === "-l" || a === "--limit") {
        const r = parseRate(val());
        if (r === null) return "limit looks like 500K or 2M";
        o.limit = r;
      } else if (a === "--cookies-from-browser") o.cookiesFromBrowser = val();
      else if (a === "-i" || a === "--input") o.files.push(val());
      else if (a.startsWith("-")) return `unknown option '${a}'`;
      else o.urls.push(a);
    } catch (err) {
      return (err as Error).message;
    }
  }
  return o;
}

export function parseCliArgs(argv: string[]): Command {
  const [first, ...rest] = argv;
  if (first === "-h" || first === "--help" || first === "help") return { kind: "help" };
  if (first === "-v" || first === "--version") return { kind: "version" };
  if (first === "update-tools") return { kind: "update-tools" };
  if (first === "tools") return { kind: "tools" };
  if (first === "info") {
    return rest[0] ? { kind: "info", url: rest[0] } : { kind: "invalid", message: "info needs a link" };
  }
  if (first === "get") {
    const o = parseGet(rest);
    if (typeof o === "string") return { kind: "invalid", message: o };
    if (!o.urls.length && !o.files.length) return { kind: "invalid", message: "get needs at least one link" };
    return { kind: "get", opts: o };
  }
  if (first === "queue") {
    const [sub, ...more] = rest;
    if (sub === "list") return { kind: "queue-list" };
    if (sub === "start") {
      const o = parseGet(more);
      if (typeof o === "string") return { kind: "invalid", message: o };
      return { kind: "queue-start", limit: o.limit };
    }
    if (sub === "add") {
      const o = parseGet(more);
      if (typeof o === "string") return { kind: "invalid", message: o };
      if (!o.urls.length && !o.files.length) return { kind: "invalid", message: "queue add needs a link" };
      return { kind: "queue-add", opts: o };
    }
    return { kind: "invalid", message: "queue takes add, list or start" };
  }
  const urls: string[] = [];
  let theme: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--theme") {
      theme = argv[++i];
      if (!theme || !THEME_NAMES.includes(theme as never)) {
        return { kind: "invalid", message: `--theme takes one of: ${THEME_NAMES.join(", ")}` };
      }
    } else if (a.startsWith("-")) return { kind: "invalid", message: `unknown option '${a}'` };
    else urls.push(a);
  }
  return theme ? { kind: "tui", urls, theme } : { kind: "tui", urls };
}
