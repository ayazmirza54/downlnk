import os from "node:os";
import path from "node:path";
import envPaths from "env-paths";

export const APP_NAME = "downlnk";

const base = envPaths(APP_NAME, { suffix: "" });

// Optional override that relocates all persisted state under one folder. Tests
// point this at a temp dir so they never touch the real user data; it also
// doubles as a portable-state escape hatch.
const override = process.env.DOWNLNK_STATE_DIR;
const dataDir = override ? path.join(override, "data") : base.data;
const configDir = override ? path.join(override, "config") : base.config;

export const defaultDownloadDir = path.join(os.homedir(), "Downloads", APP_NAME);

export const configFile = path.join(configDir, "config.json");

export const queueFile = path.join(dataDir, "queue.json");

// Standalone yt-dlp / gallery-dl binaries fetched on first run live here.
export const toolsDir = path.join(dataDir, "bin");
