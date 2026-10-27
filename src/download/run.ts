import { discardGallery, runGallery } from "../engines/gallerydl";
import { discardPartial, downloadSegmented } from "../engines/http/segmented";
import { discardYtdlp, runYtdlp } from "../engines/ytdlp";
import type { RunContext } from "../engines/types";
import type { DownloadItem } from "./types";

export type Runner = (item: DownloadItem, ctx: RunContext) => Promise<string[]>;
export type Discarder = (item: DownloadItem) => Promise<void>;

/** Hand an item to the engine that owns it. */
export const runItem: Runner = async (item, ctx) => {
  if (item.engine === "ytdlp") return runYtdlp(item, ctx);
  if (item.engine === "gallerydl") return runGallery(item, ctx);
  const file = await downloadSegmented({
    url: item.url,
    dir: item.dir,
    filename: item.filename ?? "download",
    connections: ctx.connections,
    retries: ctx.retries,
    limiters: ctx.limiters,
    signal: ctx.signal,
    onProgress: ctx.onProgress,
  });
  return [file];
};

/** Clean up what a cancelled download left behind. Finished files are never touched. */
export const discardItem: Discarder = async (item) => {
  if (item.engine === "ytdlp") return discardYtdlp(item);
  if (item.engine === "gallerydl") return discardGallery(item);
  return discardPartial(item.dir, item.filename ?? "download");
};
