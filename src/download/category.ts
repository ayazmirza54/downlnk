import path from "node:path";
import type { Category, MediaOptions } from "./types";
import type { EngineId } from "../engines/types";

const BY_EXT: Record<Category, string[]> = {
  Video: ["mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "ts", "3gp"],
  Music: ["mp3", "m4a", "flac", "wav", "ogg", "opus", "aac", "wma", "alac"],
  Images: ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "tif", "tiff", "heic"],
  Documents: ["pdf", "epub", "mobi", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "txt", "csv", "md", "rtf"],
  Archives: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "tgz", "iso", "img"],
  Programs: ["exe", "msi", "msix", "dmg", "pkg", "appimage", "deb", "rpm", "apk"],
  Other: [],
};

const LOOKUP = new Map<string, Category>();
for (const [cat, exts] of Object.entries(BY_EXT) as [Category, string[]][]) {
  for (const e of exts) LOOKUP.set(e, cat);
}

export function categoryForFile(name: string): Category {
  return LOOKUP.get(path.extname(name).slice(1).toLowerCase()) ?? "Other";
}

export function categoryFor(engine: EngineId, media: MediaOptions, filename?: string): Category {
  if (engine === "gallerydl") return "Images";
  if (engine === "ytdlp") return media.quality === "audio" ? "Music" : "Video";
  return filename ? categoryForFile(filename) : "Other";
}
