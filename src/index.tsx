import { HELP_TEXT, parseCliArgs } from "./cli/args";
import { VERSION } from "./version";

const cmd = parseCliArgs(process.argv.slice(2));

if (cmd.kind === "help") {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (cmd.kind === "version") {
  console.log(`downlnk v${VERSION}`);
  process.exit(0);
}

if (cmd.kind === "invalid") {
  console.error(`error: ${cmd.message}\n`);
  console.error(HELP_TEXT);
  process.exit(1);
}

function finish(code: number): never {
  process.exit(code);
}

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// Headless commands never touch the TUI; each is imported on demand so a
// plain `downlnk` launch pays nothing for them.
if (cmd.kind !== "tui") {
  void import("./cli/headless")
    .then((h) => {
      switch (cmd.kind) {
        case "get":
          return h.runGet(cmd.opts);
        case "info":
          return h.runInfo(cmd.url);
        case "queue-add":
          return h.runQueueAdd(cmd.opts);
        case "queue-list":
          return h.runQueueList();
        case "queue-start":
          return h.runQueueStart(cmd.limit);
        case "tools":
          return h.runTools();
        case "update-tools":
          return h.runUpdateTools();
      }
    })
    .then((code) => finish(code ?? 0))
    .catch(fail);
} else {
  void import("./tui").then(({ runTui }) => runTui(cmd.urls, cmd.theme)).catch(fail);
}
