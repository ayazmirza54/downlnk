import { createContext, useContext, useSyncExternalStore } from "react";
import type { Config } from "../config/config";
import type { DownloadQueue } from "../download/queue";
import type { Category, DownloadItem } from "../download/types";
import type { ListFocus } from "./keymap";

export type Region = "sidebar" | "content";

export type Filter = "all" | "active" | "finished" | Category;

/** A link being looked at (resolving) before it becomes a download. */
export interface Pending {
  id: string;
  url: string;
}

export interface PromptSpec {
  title: string;
  subject?: string;
  value: string;
  placeholder?: string;
  submitLabel?: string;
  /** One dim line under the field explaining the format. */
  hint?: string;
  /** Return an error message to keep the prompt open. */
  onSubmit: (value: string) => string | void;
}

export interface Store {
  queue: DownloadQueue;
  config: Config;
  cols: number;
  rows: number;
  contentWidth: number;
  listRows: number;
  region: Region;
  setRegion: (r: Region) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  pending: Pending[];
  editingUrl: boolean;
  /** A prompt, picker or the help sheet owns the keyboard. */
  overlayOpen: boolean;
  setEditingUrl: (v: boolean) => void;
  submitLinks: (text: string) => void;
  openFolder: (dir: string) => void;
  openPrompt: (p: PromptSpec) => void;
  notify: (msg: string, tone?: "good" | "warn" | "bad") => void;
  setListFocus: (f: ListFocus, marked: number) => void;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("StoreContext missing");
  return s;
}

/** Re-render whenever the queue changes; returns the live list. */
export function useQueueItems(queue: DownloadQueue): readonly DownloadItem[] {
  useSyncExternalStore(
    (fn) => queue.subscribe(fn),
    queue.getVersion,
    queue.getVersion,
  );
  return queue.list();
}

export function matchesFilter(it: DownloadItem, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "active") return it.status !== "done";
  if (f === "finished") return it.status === "done";
  return it.category === f;
}
