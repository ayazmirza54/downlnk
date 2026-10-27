import { describe, expect, it } from "vitest";
import { parseCliArgs, parseRate } from "./args";

describe("parseCliArgs", () => {
  it("opens the app with any links given", () => {
    expect(parseCliArgs([])).toEqual({ kind: "tui", urls: [] });
    expect(parseCliArgs(["https://a.com/x"])).toEqual({ kind: "tui", urls: ["https://a.com/x"] });
  });

  it("reads get options", () => {
    const cmd = parseCliArgs(["get", "https://y.com/v", "-q", "720p", "-o", "out", "--limit", "2M", "--subs"]);
    expect(cmd).toEqual({
      kind: "get",
      opts: expect.objectContaining({
        urls: ["https://y.com/v"],
        quality: "720",
        output: "out",
        limit: 2 * 1024 * 1024,
        subtitles: true,
        playlist: true,
      }),
    });
  });

  it("takes an optional format after --audio", () => {
    const cmd = parseCliArgs(["get", "-a", "m4a", "https://y.com/v"]);
    expect(cmd).toMatchObject({ kind: "get", opts: { quality: "audio", audioFormat: "m4a", urls: ["https://y.com/v"] } });
  });

  it("opens with a chosen theme", () => {
    expect(parseCliArgs(["--theme", "ember"])).toEqual({ kind: "tui", urls: [], theme: "ember" });
    expect(parseCliArgs(["--theme", "neon"])).toMatchObject({ kind: "invalid" });
  });

  it("explains bad input instead of guessing", () => {
    expect(parseCliArgs(["get"])).toMatchObject({ kind: "invalid" });
    expect(parseCliArgs(["get", "x", "-q", "8k"])).toMatchObject({ kind: "invalid" });
    expect(parseCliArgs(["--nope"])).toMatchObject({ kind: "invalid" });
    expect(parseCliArgs(["queue", "dance"])).toMatchObject({ kind: "invalid" });
  });
});

describe("parseRate", () => {
  it("reads human speeds", () => {
    expect(parseRate("500K")).toBe(512_000);
    expect(parseRate("1.5m")).toBe(1_572_864);
    expect(parseRate("2MB/s")).toBe(2_097_152);
    expect(parseRate("fast")).toBeNull();
  });
});
