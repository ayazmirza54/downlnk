import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { render } from "ink";
import type { ReactNode } from "react";

// Borrowed from torlink: render an Ink tree for tests with input that Ink 7
// actually reads. Ink consumes stdin via 'readable' + stdin.read(), so bytes
// emitted on ink-testing-library's EventEmitter stub never reach its parser;
// a real PassThrough does. Raw mode is gated on isTTY plus a setRawMode.

export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

export interface RenderedUI {
  frame: () => string;
  press: (bytes: string) => void;
  unmount: () => void;
}

export function renderUI(node: ReactNode, opts: { cols?: number; rows?: number } = {}): RenderedUI {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (v: boolean) => void;
    ref: () => void;
    unref: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  const writes: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns: opts.cols ?? 100,
    rows: opts.rows ?? 30,
    write(chunk: unknown): boolean {
      writes.push(String(chunk));
      return true;
    },
  });

  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    // Every render lands as one full frame instead of incremental repaints.
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  let fatal: unknown = null;
  instance.waitUntilExit().catch((e: unknown) => {
    fatal = e;
  });

  return {
    frame: () => {
      if (fatal) throw fatal;
      return stripAnsi(writes.at(-1) ?? "");
    },
    press: (bytes: string) => void stdin.write(bytes),
    unmount: () => instance.unmount(),
  };
}
