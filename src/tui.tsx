import { render } from "ink";
import { App } from "./ui/App";

export function runTui(initialUrls: string[], theme?: string): void {
  // Alt-screen with the hardware cursor hidden: the TUI draws its own cursor
  // in the text fields. restoreTerminal undoes both on any way out.
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b]0;downlnk\x07");
  if (process.platform === "win32") process.title = "downlnk";

  let restored = false;
  const restoreTerminal = (): void => {
    if (restored) return;
    restored = true;
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  };

  let exiting = false;
  const forceExit = (code = 0): void => {
    if (exiting) {
      restoreTerminal();
      process.exit(code);
    }
    exiting = true;
    // State is already flushed (quitAll saves the queue synchronously), so
    // never wait on child processes or sockets winding down.
    try {
      app.unmount();
    } catch {}
    restoreTerminal();
    process.exit(code);
  };

  const app = render(<App initialUrls={initialUrls} themeOverride={theme} onQuit={() => forceExit(0)} />, { exitOnCtrlC: false });

  app
    .waitUntilExit()
    .then(() => forceExit(0))
    .catch((err) => {
      restoreTerminal();
      console.error(err);
      process.exit(1);
    });

  process.on("SIGINT", () => forceExit(0));
  process.on("SIGTERM", () => forceExit(0));
  process.on("exit", restoreTerminal);
  process.on("uncaughtException", (err) => {
    restoreTerminal();
    console.error(err);
    process.exit(1);
  });
}
