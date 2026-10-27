import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadSegmented, partPaths, uniquePath } from "./segmented";
import { filenameFromDisposition, pickFilename, sanitizeFilename } from "./probe";
import { isAborted } from "../types";

const SIZE = 3 * 1024 * 1024 + 123;
const DATA = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) DATA[i] = (i * 31 + (i >> 8)) & 255;

let server: Server;
let base = "";
let rangeRequests = 0;

// Serves DATA with real byte-range support, trickling each response in small
// chunks so a test can abort mid-download. /plain ignores ranges entirely.
beforeAll(async () => {
  server = createServer((req, res) => {
    const ranged = !req.url?.startsWith("/plain");
    const m = ranged ? req.headers.range?.match(/bytes=(\d+)-(\d*)/) : null;
    let start = 0;
    let end = SIZE - 1;
    if (m) {
      rangeRequests++;
      start = Number(m[1]);
      end = m[2] ? Math.min(SIZE - 1, Number(m[2])) : SIZE - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${SIZE}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ETag: '"v1"',
        "Content-Disposition": 'attachment; filename="sample.bin"',
      });
    } else {
      res.writeHead(200, { "Content-Length": SIZE, "Content-Type": "application/zip" });
    }
    let pos = start;
    const slow = req.url?.includes("slow");
    const pump = () => {
      if (pos > end || res.destroyed) return res.end();
      const next = Math.min(end + 1, pos + (slow ? 16 : 64) * 1024);
      res.write(DATA.subarray(pos, next));
      pos = next;
      setTimeout(pump, slow ? 30 : 0);
    };
    pump();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "downlnk-seg-"));

describe("downloadSegmented", () => {
  it("downloads over several connections and reassembles exactly", async () => {
    const dir = tmp();
    rangeRequests = 0;
    const out = await downloadSegmented({
      url: `${base}/file`,
      dir,
      filename: "a.bin",
      connections: 4,
      retries: 1,
      minSplit: 256 * 1024,
    });
    expect(out).toBe(path.join(dir, "a.bin"));
    expect((await fs.readFile(out)).equals(DATA)).toBe(true);
    // One probe plus at least one request per connection.
    expect(rangeRequests).toBeGreaterThanOrEqual(5);
    expect(existsSync(partPaths(dir, "a.bin").state)).toBe(false);
  });

  it("pauses by aborting, then resumes from the bytes on disk", async () => {
    const dir = tmp();
    const ctrl = new AbortController();
    let seen = 0;
    const first = downloadSegmented({
      url: `${base}/slow`,
      dir,
      filename: "b.bin",
      connections: 3,
      retries: 1,
      minSplit: 256 * 1024,
      signal: ctrl.signal,
      onProgress: (p) => {
        seen = p.downloaded;
        if (p.downloaded > 0) ctrl.abort();
      },
    });
    const err = await first.catch((e: unknown) => e);
    expect(isAborted(err)).toBe(true);
    expect(seen).toBeGreaterThan(0);
    const saved = JSON.parse(await fs.readFile(partPaths(dir, "b.bin").state, "utf8"));
    const kept = saved.segments.reduce((n: number, s: { done: number }) => n + s.done, 0);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(SIZE);

    let firstReport = -1;
    const out = await downloadSegmented({
      url: `${base}/file`,
      dir,
      filename: "b.bin",
      connections: 3,
      retries: 1,
      minSplit: 256 * 1024,
      onProgress: (p) => {
        if (firstReport < 0) firstReport = p.downloaded;
      },
    });
    expect((await fs.readFile(out)).equals(DATA)).toBe(true);
    expect(firstReport).toBeGreaterThanOrEqual(kept);
  });

  it("falls back to one stream when the server ignores ranges", async () => {
    const dir = tmp();
    const out = await downloadSegmented({
      url: `${base}/plain/archive`,
      dir,
      filename: "c.zip",
      connections: 8,
      retries: 1,
    });
    expect((await fs.readFile(out)).equals(DATA)).toBe(true);
  });

  it("never overwrites an existing file", async () => {
    const dir = tmp();
    await fs.writeFile(path.join(dir, "d.bin"), "keep me");
    const out = await downloadSegmented({
      url: `${base}/file`,
      dir,
      filename: "d.bin",
      connections: 2,
      retries: 1,
    });
    expect(out).toBe(path.join(dir, "d (1).bin"));
    expect(await fs.readFile(path.join(dir, "d.bin"), "utf8")).toBe("keep me");
    expect(uniquePath(path.join(dir, "d.bin"))).toBe(path.join(dir, "d (2).bin"));
  });
});

describe("filenames", () => {
  it("reads RFC 5987 and plain Content-Disposition", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''na%C3%AFve%20file.pdf")).toBe(
      "naïve file.pdf",
    );
    expect(filenameFromDisposition('attachment; filename="report.pdf"')).toBe("report.pdf");
    expect(filenameFromDisposition("inline")).toBeUndefined();
  });

  it("falls back to the URL path and adds an extension from the type", () => {
    expect(pickFilename("https://x.test/files/movie.mp4?sig=1")).toBe("movie.mp4");
    expect(pickFilename("https://x.test/get", null, "application/pdf")).toBe("get.pdf");
    expect(pickFilename("https://x.test/")).toBe("download");
  });

  it("strips anything that could escape the folder or upset Windows", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(sanitizeFilename('a<b>:c"d|e?f*g')).toBe("a_b__c_d_e_f_g");
    expect(sanitizeFilename("CON.txt")).toBe("_CON.txt");
  });
});
