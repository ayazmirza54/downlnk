import { describe, expect, it } from "vitest";
import { DownloadQueue, type QueueSettings } from "./queue";
import type { Runner } from "./run";
import type { NewDownload } from "./types";
import { AbortedError } from "../engines/types";

const SETTINGS: QueueSettings = {
  maxConcurrent: 2,
  connections: 4,
  retries: 0,
  speedLimit: 0,
  cookiesFromBrowser: null,
};

const job = (n: number): NewDownload => ({
  url: `https://example.com/${n}.bin`,
  engine: "http",
  source: "web",
  title: `${n}.bin`,
  dir: "/tmp",
  category: "Other",
  filename: `${n}.bin`,
});

// A runner whose downloads finish (or fail) only when the test says so.
function controllable() {
  const pending = new Map<string, { resolve: (f: string[]) => void; reject: (e: unknown) => void }>();
  const starts: string[] = [];
  const runner: Runner = (item, ctx) =>
    new Promise((resolve, reject) => {
      starts.push(item.title);
      pending.set(item.title, { resolve, reject });
      ctx.signal.addEventListener("abort", () => reject(new AbortedError()));
    });
  return { runner, pending, starts };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("DownloadQueue", () => {
  it("never runs more than maxConcurrent at once and starts the next when one ends", async () => {
    const c = controllable();
    const q = new DownloadQueue(SETTINGS, { runner: c.runner, discard: async () => {} });
    for (let i = 1; i <= 4; i++) q.add(job(i));
    expect(c.starts).toEqual(["1.bin", "2.bin"]);
    expect(q.activeCount).toBe(2);

    c.pending.get("1.bin")!.resolve(["/tmp/1.bin"]);
    await tick();
    expect(c.starts).toEqual(["1.bin", "2.bin", "3.bin"]);
    expect(q.list()[0]!.status).toBe("done");
    expect(q.list()[0]!.files).toEqual(["/tmp/1.bin"]);
  });

  it("pause keeps the item and frees its slot; resume queues it again", async () => {
    const c = controllable();
    const q = new DownloadQueue({ ...SETTINGS, maxConcurrent: 1 }, { runner: c.runner, discard: async () => {} });
    const a = q.add(job(1));
    q.add(job(2));
    q.pause(a.id);
    await tick();
    expect(q.get(a.id)!.status).toBe("paused");
    expect(c.starts).toEqual(["1.bin", "2.bin"]);

    c.pending.get("2.bin")!.resolve([]);
    await tick();
    q.resume(a.id);
    await tick();
    expect(q.get(a.id)!.status).toBe("downloading");
    expect(c.starts).toEqual(["1.bin", "2.bin", "1.bin"]);
  });

  it("cancel drops the entry and discards its partial", async () => {
    const c = controllable();
    const discarded: string[] = [];
    const q = new DownloadQueue(SETTINGS, {
      runner: c.runner,
      discard: async (it) => {
        discarded.push(it.title);
      },
    });
    const a = q.add(job(1));
    q.cancel(a.id);
    await tick();
    expect(q.get(a.id)).toBeUndefined();
    expect(discarded).toEqual(["1.bin"]);
  });

  it("marks real errors failed and retries them on request", async () => {
    const c = controllable();
    const q = new DownloadQueue(SETTINGS, { runner: c.runner, discard: async () => {} });
    const a = q.add(job(1));
    c.pending.get("1.bin")!.reject(new Error("HTTP 404"));
    await tick();
    expect(q.get(a.id)!.status).toBe("failed");
    expect(q.get(a.id)!.error).toBe("HTTP 404");
    q.retryFailed();
    await tick();
    expect(q.get(a.id)!.status).toBe("downloading");
  });

  it("a scheduled hold keeps queued items waiting until released", async () => {
    const c = controllable();
    const q = new DownloadQueue(SETTINGS, { runner: c.runner, discard: async () => {} });
    q.setHold("02:00");
    q.add(job(1));
    expect(c.starts).toEqual([]);
    q.setHold(null);
    expect(c.starts).toEqual(["1.bin"]);
  });

  it("restores a saved list with interrupted downloads back in line", () => {
    const c = controllable();
    const q = new DownloadQueue({ ...SETTINGS, maxConcurrent: 0 }, { runner: c.runner });
    const it = q.add(job(1));
    const saved = [{ ...it, status: "downloading" as const, downloaded: 500 }];
    const q2 = new DownloadQueue({ ...SETTINGS, maxConcurrent: 0 }, { runner: c.runner });
    q2.load(saved);
    expect(q2.list()[0]!.status).toBe("queued");
    expect(q2.list()[0]!.downloaded).toBe(500);
  });
});
