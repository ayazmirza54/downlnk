import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Keep tests off the real user data dir: redirect all persisted state (queue,
// config, tools) into a temp folder via the DOWNLNK_STATE_DIR override that
// src/config/paths.ts honors.
export default defineConfig({
  test: {
    env: {
      DOWNLNK_STATE_DIR: path.join(os.tmpdir(), "downlnk-test-state"),
    },
  },
});
