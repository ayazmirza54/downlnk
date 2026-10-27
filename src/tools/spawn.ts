import { spawn, type ChildProcess } from "node:child_process";

// yt-dlp and gallery-dl are Python programs; on Windows their console encoding
// defaults to the ANSI code page and mangles any non-Latin title. Force UTF-8.
export const TOOL_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  PYTHONIOENCODING: "utf-8",
  PYTHONUTF8: "1",
};

export function spawnTool(file: string, args: string[]): ChildProcess {
  return spawn(file, args, { env: TOOL_ENV, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Stop a tool and everything it started. yt-dlp hands merging to ffmpeg, and
 * on Windows killing the parent alone leaves that child running and holding
 * the file open.
 */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on(
      "error",
      () => child.kill(),
    );
  } else {
    child.kill("SIGTERM");
  }
}

/** Feed complete lines from a stream to `onLine`, handling \r progress redraws too. */
export function readLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    const parts = buf.split(/\r\n|\n|\r/);
    buf = parts.pop() ?? "";
    for (const p of parts) if (p) onLine(p);
  });
  stream.on("end", () => {
    if (buf) onLine(buf);
    buf = "";
  });
}

export interface Captured {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function capture(
  file: string,
  args: string[],
  { timeoutMs = 60_000, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Captured> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child: ChildProcess;
    try {
      child = spawnTool(file, args);
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err) });
      return;
    }
    const stop = () => killTree(child);
    const timer = setTimeout(stop, timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => (stdout += d));
    child.stderr?.on("data", (d: string) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The most useful line of a tool's stderr: its last ERROR, else its last line. */
export function lastError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const err = [...lines].reverse().find((l) => /^(ERROR|\[error\])/i.test(l));
  return (err ?? lines.at(-1) ?? "failed")
    .replace(/^ERROR:\s*/i, "")
    .replace(/^\[error\]\s*/i, "")
    .slice(0, 300);
}
