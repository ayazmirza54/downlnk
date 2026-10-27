export const LOGO_LINES: readonly string[] = [
  "  ↓                              ",
  " █▀▄ █▀█ █ █ █ █▄ █ █   █▄ █ █▄▀",
  " █▄▀ █▄█ ▀▄▀▄▀ █ ▀█ █▄▄ █ ▀█ █ █",
];

export const LOGO_WIDTH = Math.max(...LOGO_LINES.map((l) => [...l].length));

/** The little arrow over the D, drawn in green like torlink's sprout. */
export const SPROUT_CELLS: ReadonlySet<string> = new Set(["0,2"]);
