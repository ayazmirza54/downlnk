import type { Status } from "../download/types";

export interface Hint {
  keys: string;
  label: string;
}

interface HelpGroup {
  title: string;
  hints: Hint[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: "Navigate",
    hints: [
      { keys: "↑↓←→ / hjkl", label: "Move" },
      { keys: "tab", label: "Switch pane" },
      { keys: "a or /", label: "Add a link" },
      { keys: "v", label: "Add the copied link" },
      { keys: "esc", label: "Back" },
      { keys: "?", label: "This sheet" },
      { keys: "q", label: "Quit (downloads resume next time)" },
    ],
  },
  {
    title: "Downloads",
    hints: [
      { keys: "p", label: "Pause / resume" },
      { keys: "x", label: "Cancel, or remove from list" },
      { keys: "r", label: "Retry / download again" },
      { keys: "e", label: "Open folder" },
      { keys: "␣", label: "Mark for a batch action" },
      { keys: "l", label: "Speed limit for this one" },
      { keys: "P", label: "Pause or resume everything" },
      { keys: "C", label: "Clear finished from the list" },
    ],
  },
  {
    title: "Settings",
    hints: [
      { keys: "o", label: "Download folder" },
      { keys: "L", label: "Global speed limit" },
      { keys: "S", label: "Schedule start / stop" },
      { keys: "+ -", label: "Downloads at once" },
      { keys: "[ ]", label: "Connections per file" },
      { keys: "c", label: "Browser for cookies" },
      { keys: "w", label: "Watch the clipboard" },
      { keys: "T", label: "Sort into category folders" },
      { keys: "t", label: "Next color theme" },
    ],
  },
  {
    title: "Adding",
    hints: [
      { keys: "↵", label: "Download (default folder)" },
      { keys: "f", label: "Download to a folder…" },
      { keys: "↑↓", label: "Pick quality" },
      { keys: "s", label: "Subtitles" },
      { keys: "m", label: "Container mp4 / mkv" },
      { keys: "p", label: "Whole playlist / just this" },
    ],
  },
];

const ALWAYS: Hint = { keys: "?", label: "Keys" };
const ADD: Hint = { keys: "a", label: "Add link" };
const SWITCH: Hint = { keys: "tab", label: "Switch" };
const FOLDER: Hint = { keys: "e", label: "Folder" };

export type ListFocus = Status | null;

export function footerHints(region: "sidebar" | "content", focus: ListFocus, marked: number): Hint[] {
  if (region === "sidebar") {
    return [{ keys: "↑↓", label: "Filter" }, { keys: "↵", label: "Open" }, ADD, SWITCH, ALWAYS, { keys: "q", label: "Quit" }];
  }
  if (marked > 0) {
    return [
      { keys: "␣", label: `Mark (${marked})` },
      { keys: "p", label: "Pause/resume marked" },
      { keys: "x", label: "Cancel marked" },
      { keys: "esc", label: "Unmark" },
      ALWAYS,
    ];
  }
  if (focus === "downloading" || focus === "queued") {
    return [{ keys: "p", label: "Pause" }, { keys: "x", label: "Cancel" }, { keys: "l", label: "Limit" }, FOLDER, ADD, ALWAYS];
  }
  if (focus === "paused") {
    return [{ keys: "p", label: "Resume" }, { keys: "x", label: "Cancel" }, FOLDER, ADD, ALWAYS];
  }
  if (focus === "failed") {
    return [{ keys: "r", label: "Retry" }, { keys: "x", label: "Remove" }, FOLDER, ADD, ALWAYS];
  }
  if (focus === "done") {
    return [{ keys: "e", label: "Open folder" }, { keys: "r", label: "Again" }, { keys: "x", label: "Remove from list" }, ADD, ALWAYS];
  }
  return [ADD, { keys: "v", label: "Paste" }, SWITCH, ALWAYS, { keys: "q", label: "Quit" }];
}
