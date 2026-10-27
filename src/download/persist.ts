import { mkdirSync, promises as fs, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { queueFile } from "../config/paths";
import { writeJsonAtomic } from "../util/atomic";
import type { DownloadItem } from "./types";

/** Finished entries kept for the Recently downloaded list. */
export const DONE_CAP = 300;

export function trimForSave(items: readonly DownloadItem[]): DownloadItem[] {
  const done = items.filter((i) => i.status === "done");
  const drop = new Set(
    done
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(DONE_CAP)
      .map((i) => i.id),
  );
  // Live counters mean nothing after a restart; keep only what resumes.
  return items
    .filter((i) => !drop.has(i.id))
    .map((i) => ({ ...i, speed: 0, eta: undefined, connections: undefined, stage: undefined }));
}

export async function loadQueue(file = queueFile): Promise<DownloadItem[]> {
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return Array.isArray(raw) ? (raw as DownloadItem[]).filter((i) => i && i.id && i.url) : [];
  } catch {
    return [];
  }
}

export async function saveQueue(items: readonly DownloadItem[], file = queueFile): Promise<void> {
  await writeJsonAtomic(file, trimForSave(items));
}

/** For the quit path, where nothing async gets to finish. */
export function saveQueueSync(items: readonly DownloadItem[], file = queueFile): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(trimForSave(items), null, 2), "utf8");
    renameSync(tmp, file);
  } catch {}
}
