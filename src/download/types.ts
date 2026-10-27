import type { EngineId } from "../engines/types";
import type { SourceId } from "../router";

export type Category = "Video" | "Music" | "Images" | "Documents" | "Archives" | "Programs" | "Other";

export const CATEGORIES: readonly Category[] = [
  "Video",
  "Music",
  "Images",
  "Documents",
  "Archives",
  "Programs",
  "Other",
];

export type Status = "queued" | "downloading" | "paused" | "failed" | "done";

/** What to fetch from a media page (yt-dlp) or gallery (gallery-dl). */
export interface MediaOptions {
  /** "best", a max height like "1080", or "audio". */
  quality: string;
  audioFormat: "mp3" | "m4a";
  container: "mp4" | "mkv";
  subtitles: boolean;
  /** For a URL that is both a video and a playlist: take the whole list. */
  playlist: boolean;
}

export const DEFAULT_MEDIA: MediaOptions = {
  quality: "best",
  audioFormat: "mp3",
  container: "mp4",
  subtitles: false,
  playlist: true,
};

export interface DownloadItem {
  id: string;
  url: string;
  engine: EngineId;
  source: SourceId;
  title: string;
  /** Folder the files land in. */
  dir: string;
  category: Category;
  status: Status;
  media: MediaOptions;
  /** HTTP: target file name inside `dir`. */
  filename?: string;
  /** Final paths once finished. */
  files: string[];
  downloaded: number;
  total: number;
  speed: number;
  eta?: number;
  connections?: number;
  filesDone?: number;
  filesTotal?: number;
  stage?: string;
  error?: string;
  /** Per-download cap in bytes/s; 0 or undefined means only the global cap. */
  speedLimit?: number;
  addedAt: number;
  completedAt?: number;
}

export interface NewDownload {
  url: string;
  engine: EngineId;
  source: SourceId;
  title: string;
  dir: string;
  category: Category;
  media?: MediaOptions;
  filename?: string;
  total?: number;
  filesTotal?: number;
  speedLimit?: number;
}
