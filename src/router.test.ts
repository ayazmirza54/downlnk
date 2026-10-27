import { describe, expect, it } from "vitest";
import { extractUrls, isSupportedUrl, route } from "./router";
import { crossed, inWindow, normalizeTime } from "./download/schedule";
import { categoryForFile } from "./download/category";

describe("route", () => {
  it("sends video sites to yt-dlp", () => {
    expect(route("https://www.youtube.com/watch?v=abc")).toMatchObject({ source: "youtube", engines: ["ytdlp"] });
    expect(route("youtu.be/abc")).toMatchObject({ source: "youtube", engines: ["ytdlp"] });
    expect(route("https://www.tiktok.com/@a/video/1")!.engines).toEqual(["ytdlp"]);
  });

  it("splits Instagram by what the path holds", () => {
    expect(route("https://www.instagram.com/reel/xyz/")!.engines[0]).toBe("ytdlp");
    expect(route("https://www.instagram.com/p/xyz/")!.engines[0]).toBe("gallerydl");
    expect(route("https://www.instagram.com/someone/")!.engines).toEqual(["gallerydl"]);
  });

  it("tries video first on Reddit and X, falling back to galleries", () => {
    expect(route("https://www.reddit.com/r/pics/comments/1/x/")!.engines).toEqual(["ytdlp", "gallerydl"]);
    expect(route("https://x.com/a/status/1")!.engines).toEqual(["ytdlp", "gallerydl"]);
    expect(route("https://i.redd.it/abc.jpg")!.engines).toEqual(["http"]);
  });

  it("downloads plain files directly", () => {
    expect(route("https://example.com/a/b/setup.exe")).toMatchObject({ engines: ["http"], direct: true });
  });

  it("sniffs unknown pages before handing them to the extractors", () => {
    expect(route("https://example.com/watch/123")!.engines).toEqual(["http", "ytdlp", "gallerydl"]);
  });

  it("rejects things that aren't web links", () => {
    expect(route("hello")).toBeNull();
    expect(route("ftp://example.com/a")).toBeNull();
    expect(route("")).toBeNull();
  });
});

describe("extractUrls", () => {
  it("pulls every link out of pasted text, once each", () => {
    const text = "grab https://a.com/1.zip and https://b.com/x),\nhttps://a.com/1.zip";
    expect(extractUrls(text)).toEqual(["https://a.com/1.zip", "https://b.com/x"]);
  });
});

describe("isSupportedUrl", () => {
  it("only fires the clipboard watcher for links downlnk knows", () => {
    expect(isSupportedUrl("https://www.youtube.com/watch?v=1")).toBe(true);
    expect(isSupportedUrl("https://example.com/file.zip")).toBe(true);
    expect(isSupportedUrl("https://example.com/blog")).toBe(false);
    expect(isSupportedUrl("youtube.com/watch?v=1")).toBe(false);
  });
});

describe("schedule", () => {
  const at = (h: number, m: number, day = 1) => new Date(2026, 0, day, h, m);

  it("normalizes loose time input", () => {
    expect(normalizeTime("2")).toBe("02:00");
    expect(normalizeTime("14:5")).toBe("14:05");
    expect(normalizeTime("25:00")).toBeNull();
  });

  it("detects crossing a time, including over midnight", () => {
    expect(crossed(at(1, 59), at(2, 0), 120)).toBe(true);
    expect(crossed(at(2, 0), at(2, 1), 120)).toBe(false);
    expect(crossed(at(23, 59), at(0, 1, 2), 0)).toBe(true);
  });

  it("knows whether now is inside a start/stop window", () => {
    expect(inWindow(at(3, 0), 120, 360)).toBe(true);
    expect(inWindow(at(7, 0), 120, 360)).toBe(false);
    expect(inWindow(at(1, 0), 23 * 60, 120)).toBe(true);
  });
});

describe("categoryForFile", () => {
  it("files by extension, IDM style", () => {
    expect(categoryForFile("movie.MKV")).toBe("Video");
    expect(categoryForFile("song.flac")).toBe("Music");
    expect(categoryForFile("setup.exe")).toBe("Programs");
    expect(categoryForFile("mystery")).toBe("Other");
  });
});
