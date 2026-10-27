import type { SourceId } from "../router";
import type { EngineId } from "../engines/types";

export interface Theme {
  label: string;
  accent: string;
  text: string;
  alt: string;
  good: string;
  warn: string;
  bad: string;
  bright: string;
  /** Borders, rules and empty progress track. */
  rule: string;
  /** Paused and queued rows. */
  paused: string;
  /** Darkest stop of the logo and progress-bar ramps. */
  deep: string;
  /** Logo's bottom-right shadow. */
  shade: string;
  /** Logo's top-left highlight. */
  highlight: string;
  /** The sheen that sweeps across a running progress bar. */
  peak: string;
  /** The little arrow over the D. */
  sprout: string;
}

export const THEMES = {
  torlink: {
    label: "torlink",
    accent: "#a78bfa",
    text: "#e9e4f5",
    alt: "#b9a7e6",
    good: "#86d6a2",
    warn: "#f0c560",
    bad: "#ee7d92",
    bright: "#d8b4fe",
    rule: "#6b6577",
    paused: "#7c7785",
    deep: "#7c5cd6",
    shade: "#4c3a8a",
    highlight: "#ffffff",
    peak: "#f4efff",
    sprout: "#5ae87a",
  },
  ocean: {
    label: "ocean",
    accent: "#60a5fa",
    text: "#e2ecf7",
    alt: "#93c5fd",
    good: "#5eead4",
    warn: "#fcd34d",
    bad: "#f87171",
    bright: "#7dd3fc",
    rule: "#52627a",
    paused: "#6b7a90",
    deep: "#2563eb",
    shade: "#1e3a8a",
    highlight: "#ffffff",
    peak: "#e0f2fe",
    sprout: "#5eead4",
  },
  ember: {
    label: "ember",
    accent: "#fb923c",
    text: "#f5e9e2",
    alt: "#fdba74",
    good: "#a3e635",
    warn: "#facc15",
    bad: "#f87171",
    bright: "#fcd34d",
    rule: "#7a6458",
    paused: "#8a776c",
    deep: "#ea580c",
    shade: "#7c2d12",
    highlight: "#fff7ed",
    peak: "#fff1e0",
    sprout: "#facc15",
  },
  forest: {
    label: "forest",
    accent: "#4ade80",
    text: "#e3f2e6",
    alt: "#86efac",
    good: "#bef264",
    warn: "#fde047",
    bad: "#fb7185",
    bright: "#bbf7d0",
    rule: "#55695b",
    paused: "#6f8574",
    deep: "#16a34a",
    shade: "#14532d",
    highlight: "#f0fdf4",
    peak: "#ecfdf5",
    sprout: "#fde047",
  },
  rose: {
    label: "rose",
    accent: "#f472b6",
    text: "#f7e6ef",
    alt: "#f9a8d4",
    good: "#86efac",
    warn: "#fcd34d",
    bad: "#fb7185",
    bright: "#fbcfe8",
    rule: "#735b68",
    paused: "#86707c",
    deep: "#db2777",
    shade: "#831843",
    highlight: "#fff1f7",
    peak: "#fff0f6",
    sprout: "#86efac",
  },
  mono: {
    label: "mono",
    accent: "#e5e5e5",
    text: "#f5f5f5",
    alt: "#a3a3a3",
    good: "#c8c8c8",
    warn: "#dddddd",
    bad: "#f0a0a0",
    bright: "#ffffff",
    rule: "#5c5c5c",
    paused: "#777777",
    deep: "#8a8a8a",
    shade: "#4a4a4a",
    highlight: "#ffffff",
    peak: "#ffffff",
    sprout: "#cfcfcf",
  },
  // For terminals with a light background: dark text, deeper colors.
  paper: {
    label: "paper (light terminals)",
    accent: "#6d28d9",
    text: "#2a2433",
    alt: "#5b4d7a",
    good: "#15803d",
    warn: "#a16207",
    bad: "#be123c",
    bright: "#7c3aed",
    rule: "#a8a1b5",
    paused: "#8b849a",
    deep: "#4c1d95",
    shade: "#2e1065",
    highlight: "#8b5cf6",
    peak: "#ede9fe",
    sprout: "#16a34a",
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export function isThemeName(s: unknown): s is ThemeName {
  return typeof s === "string" && s in THEMES;
}

/**
 * The live palette. Components read it at render time, so switching themes
 * is a mutation plus a re-render; nothing needs to be threaded through props.
 */
export const COLOR: Theme = { ...THEMES.torlink };

export function applyTheme(name: ThemeName): void {
  Object.assign(COLOR, THEMES[name]);
}

export function nextTheme(name: ThemeName): ThemeName {
  return THEME_NAMES[(THEME_NAMES.indexOf(name) + 1) % THEME_NAMES.length]!;
}

export const ICON = {
  done: "✓",
  error: "✗",
  pending: "·",
  pointer: "❯",
  dot: "·",
  warn: "⚠",
  bar: "▌",
  down: "↓",
  up: "↑",
  peer: "•",
  pause: "⏸",
  mark: "◆",
  clock: "◷",
} as const;

export const GUTTER = 2;

type PaletteKey = "text" | "accent" | "alt" | "good" | "bad";

// Brand-ish tags keep fixed hues; the ones that should follow the theme name
// a palette key instead.
const SOURCE_STYLE: Record<SourceId, { tag: string; color: string | { key: PaletteKey } }> = {
  youtube: { tag: "YT", color: "#ee7d92" },
  instagram: { tag: "IG", color: "#f6a55c" },
  facebook: { tag: "FB", color: "#7db8f0" },
  reddit: { tag: "RDT", color: "#f6a55c" },
  x: { tag: "X", color: { key: "text" } },
  tiktok: { tag: "TT", color: "#5fd0c5" },
  vimeo: { tag: "VM", color: "#7db8f0" },
  twitch: { tag: "TW", color: { key: "accent" } },
  soundcloud: { tag: "SC", color: "#f6a55c" },
  pinterest: { tag: "PIN", color: { key: "bad" } },
  imgur: { tag: "IMG", color: { key: "good" } },
  tumblr: { tag: "TMB", color: "#7db8f0" },
  web: { tag: "WEB", color: { key: "alt" } },
};

export const ENGINE_LABEL: Record<EngineId, string> = {
  http: "HTTP",
  ytdlp: "yt-dlp",
  gallerydl: "gallery-dl",
};

/** Tag for a row: a direct file reads HTTP, anything else its site. */
export function sourceStyle(source?: SourceId, engine?: EngineId): { tag: string; color: string } {
  if (engine === "http" && (!source || source === "web")) return { tag: "HTTP", color: "#5fd0c5" };
  const s = source ? SOURCE_STYLE[source] : undefined;
  if (!s) return { tag: "•", color: COLOR.alt };
  return { tag: s.tag, color: typeof s.color === "string" ? s.color : COLOR[s.color.key] };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}
