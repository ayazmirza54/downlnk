import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configFile, queueFile } from "../config/paths";
import { App } from "./App";
import { renderUI } from "./testHarness";
import { COLOR, THEMES } from "./theme";

const DATA = Buffer.alloc(2 * 1024 * 1024 + 7, 7);
let server: Server;
let base = "";
let downloadDir = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(DATA.length - 1, Number(m[2])) : DATA.length - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${DATA.length}`,
        "Content-Length": end - start + 1,
        "Content-Type": "application/zip",
      });
      res.end(DATA.subarray(start, end + 1));
    } else {
      res.writeHead(200, { "Content-Length": DATA.length });
      res.end(DATA);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  downloadDir = mkdtempSync(path.join(os.tmpdir(), "downlnk-ui-"));
  rmSync(queueFile, { force: true });
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(configFile, JSON.stringify({ downloadDir }));
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

let lastSeen: () => string = () => "";
async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timed out waiting for the UI:
${lastSeen()}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const press = async (ui: { press: (s: string) => void }, s: string) => {
  ui.press(s);
  await new Promise((r) => setTimeout(r, 80));
};

describe("App", () => {
  it("takes a link through the picker into a finished download", async () => {
    let quit = false;
    const ui = renderUI(<App initialUrls={[`${base}/files/backup.zip`]} onQuit={() => (quit = true)} />);
    const frame = () => ui.frame();
    lastSeen = frame;

    // The picker shows what's at the link and where it will go.
    await waitFor(() => frame().includes("backup.zip") && frame().includes("pick folder"));
    expect(frame()).toContain("resumable");
    expect(frame()).toContain(path.join(downloadDir, "Archives"));

    // The picker starts listening a beat after it first paints; under a busy
    // test run that beat varies, so press until it takes the key.
    for (let i = 0; i < 20 && frame().includes("pick folder"); i++) {
      await press(ui, "\r");
      await new Promise((r) => setTimeout(r, 250));
    }
    await waitFor(() => frame().includes("Recently downloaded"));
    const file = path.join(downloadDir, "Archives", "backup.zip");
    expect(existsSync(file)).toBe(true);
    expect((await fs.readFile(file)).equals(DATA)).toBe(true);

    // The help sheet opens on ? and any key closes it.
    await press(ui, "?");
    expect(frame()).toContain("Keyboard");
    await press(ui, "x");
    expect(frame()).not.toContain("Keyboard");

    // Settings prompts validate before saving.
    await press(ui, "L");
    expect(frame()).toContain("Global speed limit");
    await press(ui, "fast");
    await press(ui, "\r");
    expect(frame()).toContain("Write it like 500K or 2M");
    await press(ui, "\x1b");
    await waitFor(() => !frame().includes("Global speed limit"));

    // t cycles the color theme, recolors live and remembers the choice.
    await press(ui, "t");
    await waitFor(() => frame().includes("Theme: ocean"));
    expect(COLOR.accent).toBe(THEMES.ocean.accent);
    let savedTheme: unknown;
    for (let i = 0; i < 40 && savedTheme !== "ocean"; i++) {
      await new Promise((r) => setTimeout(r, 50));
      savedTheme = await fs.readFile(configFile, "utf8").then((t) => JSON.parse(t).theme, () => undefined);
    }
    expect(savedTheme).toBe("ocean");

    await press(ui, "q");
    expect(quit).toBe(true);
    const saved = JSON.parse(await fs.readFile(queueFile, "utf8"));
    expect(saved[0]).toMatchObject({ status: "done", title: "backup.zip" });
    ui.unmount();
  }, 30_000);
});
