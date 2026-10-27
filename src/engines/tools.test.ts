import { describe, expect, it } from "vitest";
import { ProgressFolder, buildArgs, formatSelector, parseProgressLine, summarizeInfo } from "./ytdlp";
import { parseFileLine, summarizeGallery } from "./gallerydl";
import { DEFAULT_MEDIA } from "../download/types";
import { lastError } from "../tools/spawn";
import { releaseUrl } from "../tools/resolve";

describe("yt-dlp", () => {
  it("picks a format selector per quality, merging only with ffmpeg", () => {
    expect(formatSelector({ ...DEFAULT_MEDIA, quality: "best" }, true)).toBe("bv*+ba/b");
    expect(formatSelector({ ...DEFAULT_MEDIA, quality: "720" }, true)).toBe(
      "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
    );
    expect(formatSelector({ ...DEFAULT_MEDIA, quality: "720" }, false)).toBe("b[height<=720]/b");
    expect(formatSelector({ ...DEFAULT_MEDIA, quality: "audio" }, false)).toBe("ba[ext=m4a]/ba/b");
  });

  it("parses its progress template, treating NA as unknown", () => {
    expect(parseProgressLine("DLNK|1024|4096|NA|512.5|6|NA|NA")).toEqual({
      downloaded: 1024,
      total: 4096,
      speed: 512.5,
      eta: 6,
      index: undefined,
      entries: undefined,
    });
    expect(parseProgressLine("DLNK|10|NA|2000|NA|NA|2|5")).toMatchObject({ total: 2000, index: 2, entries: 5 });
    expect(parseProgressLine("[download] Destination: x.mp4")).toBeNull();
  });

  it("folds a video stream then an audio stream into one running total", () => {
    const f = new ProgressFolder(0);
    expect(f.push({ downloaded: 900, total: 1000, speed: 0 })).toEqual({ downloaded: 900, total: 1000 });
    f.push({ downloaded: 1000, total: 1000, speed: 0 });
    expect(f.push({ downloaded: 50, total: 200, speed: 0 })).toEqual({ downloaded: 1050, total: 1200 });
  });

  it("summarizes formats into the heights on offer", () => {
    const info = summarizeInfo({
      title: "Clip",
      formats: [
        { vcodec: "avc1", height: 1080, filesize: 10 },
        { vcodec: "avc1", height: 720 },
        { vcodec: "none", acodec: "opus" },
        { vcodec: "vp9", height: 1080 },
      ],
      requested_formats: [{ filesize: 100 }, { filesize_approx: 20 }],
    });
    expect(info).toMatchObject({ title: "Clip", heights: [1080, 720], hasVideo: true, isPlaylist: false, sizeEstimate: 120 });
    expect(summarizeInfo({ _type: "playlist", title: "L", entries: [{}, {}] })).toMatchObject({ isPlaylist: true, entries: 2 });
  });

  it("builds a command line with audio extraction, limits and cookies", () => {
    const args = buildArgs(
      { url: "https://youtu.be/x", dir: "/dl", media: { ...DEFAULT_MEDIA, quality: "audio", playlist: false } },
      { rateLimit: 2048, connections: 8, retries: 3, cookiesFromBrowser: "firefox" },
      "/usr/bin/ffmpeg",
    );
    expect(args).toContain("--no-playlist");
    expect(args.join(" ")).toContain("-x --audio-format mp3");
    expect(args.join(" ")).toContain("--limit-rate 2048");
    expect(args.join(" ")).toContain("--cookies-from-browser firefox");
    expect(args.join(" ")).toContain("temp:");
  });
});

describe("gallery-dl", () => {
  it("counts files and finds a title in -j output", () => {
    expect(
      summarizeGallery([
        [2, { category: "reddit", title: "My album" }],
        [3, "https://i.redd.it/a.jpg", {}],
        [3, "https://i.redd.it/b.jpg", {}],
      ]),
    ).toEqual({ title: "My album", count: 2 });
  });

  it("reads saved and skipped file lines", () => {
    expect(parseFileLine("C:\\dl\\a.jpg")).toEqual({ path: "C:\\dl\\a.jpg", skipped: false });
    expect(parseFileLine("# /dl/a.jpg")).toEqual({ path: "/dl/a.jpg", skipped: true });
    expect(parseFileLine("[instagram][error] login required")).toBeNull();
  });
});

describe("tools", () => {
  it("surfaces the tool's own error line", () => {
    expect(lastError("[youtube] x: Downloading\nERROR: [youtube] x: Video unavailable\n")).toBe(
      "[youtube] x: Video unavailable",
    );
  });

  it("knows where each platform's standalone build lives", () => {
    expect(releaseUrl("yt-dlp", "win32", "x64")).toMatch(/yt-dlp\.exe$/);
    expect(releaseUrl("yt-dlp", "darwin", "arm64")).toMatch(/yt-dlp_macos$/);
    expect(releaseUrl("gallery-dl", "darwin", "arm64")).toBeNull();
    expect(releaseUrl("ffmpeg")).toBeNull();
  });
});
