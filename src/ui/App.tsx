import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdin, useStdout } from "ink";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BROWSERS, loadConfig, saveConfig, type Config } from "../config/config";
import { DownloadQueue, type QueueSettings } from "../download/queue";
import { loadQueue, saveQueue, saveQueueSync } from "../download/persist";
import { resolveUrl, toNewDownload, type Resolved } from "../download/resolve";
import { startScheduler, normalizeTime } from "../download/schedule";
import type { MediaOptions } from "../download/types";
import { isAborted, type Progress } from "../engines/types";
import { parseRate } from "../cli/args";
import { extractUrls, isSupportedUrl, parseUrl } from "../router";
import { toolEvents } from "../tools/resolve";
import { readClipboard } from "../util/clipboard";
import { openFolder as openInFileManager } from "../util/openFolder";
import { formatBytesPerSec, truncate } from "../util/format";
import { StoreContext, type Filter, type Pending, type PromptSpec, type Region, type Store } from "./store";
import { footerHints, type ListFocus } from "./keymap";
import { Logo } from "./components/Logo";
import { Rule } from "./components/Rule";
import { Footer } from "./components/Footer";
import { HelpOverlay } from "./components/HelpOverlay";
import { Sidebar, RAIL_WIDTH } from "./components/Sidebar";
import { UrlBar } from "./components/UrlBar";
import { Downloads } from "./components/Downloads";
import { FormatPicker } from "./components/FormatPicker";
import { InputPrompt } from "./components/InputPrompt";
import { Spinner } from "./components/Spinner";
import { TabTitle } from "./components/TabTitle";
import { Splash } from "./views/Splash";
import { COLOR, ICON, THEMES, applyTheme, isThemeName, nextTheme } from "./theme";

type Tone = "good" | "warn" | "bad";

function queueSettings(c: Config): QueueSettings {
  return {
    maxConcurrent: c.maxConcurrent,
    connections: c.segments,
    retries: c.retries,
    speedLimit: c.speedLimit,
    cookiesFromBrowser: c.cookiesFromBrowser,
  };
}

function expandHome(p: string): string {
  const t = p.trim().replace(/^["']|["']$/g, "");
  if (t === "~") return os.homedir();
  if (t.startsWith("~/") || t.startsWith("~\\")) return path.join(os.homedir(), t.slice(2));
  return path.resolve(t);
}

function rateLabel(bps: number): string {
  return bps > 0 ? formatBytesPerSec(bps) : "none";
}

export function App({
  initialUrls = [],
  themeOverride,
  onQuit,
}: {
  initialUrls?: string[];
  /** --theme on the command line: applied and remembered. */
  themeOverride?: string;
  onQuit: () => void;
}) {
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const [size, setSize] = useState({ cols: stdout.columns || 100, rows: stdout.rows || 30 });
  useEffect(() => {
    const on = () => setSize({ cols: stdout.columns || 100, rows: stdout.rows || 30 });
    stdout.on("resize", on);
    return () => {
      stdout.off("resize", on);
    };
  }, [stdout]);
  const { cols, rows } = size;

  const [config, setConfig] = useState<Config | null>(null);
  const configRef = useRef<Config | null>(null);
  configRef.current = config;
  const [queue, setQueue] = useState<DownloadQueue | null>(null);
  const [view, setView] = useState<"splash" | "main">("splash");
  const [region, setRegion] = useState<Region>("content");
  const [filter, setFilter] = useState<Filter>("all");
  const [editingUrl, setEditingUrl] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [pickers, setPickers] = useState<Resolved[]>([]);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: Tone } | null>(null);
  const [focus, setFocus] = useState<{ status: ListFocus; marked: number }>({ status: null, marked: 0 });
  const [clipOffer, setClipOffer] = useState<string | null>(null);
  const [toolFetch, setToolFetch] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolving = useRef(new Map<string, AbortController>());

  // ---- boot ----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const c = await loadConfig();
      if (themeOverride && isThemeName(themeOverride)) {
        c.theme = themeOverride;
        void saveConfig(c).catch(() => {});
      }
      applyTheme(isThemeName(c.theme) ? c.theme : "torlink");
      const q = new DownloadQueue(queueSettings(c), { persist: (items) => saveQueue(items) });
      q.load(await loadQueue());
      if (cancelled) return;
      setConfig(c);
      setQueue(q);
      if (initialUrls.length || q.list().some((i) => i.status !== "done")) setView("main");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const notify = useCallback((text: string, tone: Tone = "good") => {
    setNotice({ text, tone });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
    noticeTimer.current.unref?.();
  }, []);

  const updateConfig = useCallback(
    (patch: Partial<Config>) => {
      const cur = configRef.current;
      if (!cur || !queue) return;
      const next = { ...cur, ...patch };
      configRef.current = next;
      setConfig(next);
      queue.setSettings(queueSettings(next));
      void saveConfig(next).catch(() => notify("Couldn't save settings", "bad"));
    },
    [queue, notify],
  );

  // ---- scheduler ----
  const scheduler = useRef<{ refresh: () => void; dispose: () => void } | null>(null);
  useEffect(() => {
    if (!queue) return;
    scheduler.current = startScheduler(
      () => ({ start: configRef.current?.scheduleStart ?? null, stop: configRef.current?.scheduleStop ?? null }),
      {
        hold: (until) => queue.setHold(until),
        stop: () => {
          void queue.stopAll();
          notify("Scheduled stop: downloads will continue at the next start time", "warn");
        },
      },
    );
    return () => scheduler.current?.dispose();
  }, [queue, notify]);

  // ---- first-run tool fetches ----
  useEffect(() => {
    const onFetch = (name: string) => setToolFetch(`Fetching ${name} (first run only)…`);
    const onProgress = (name: string, p: Progress) =>
      setToolFetch(`Fetching ${name} (first run only)… ${p.total ? Math.floor((p.downloaded / p.total) * 100) : 0}%`);
    const onReady = (name: string) => {
      setToolFetch(null);
      notify(`${name} is ready`);
    };
    toolEvents.on("fetch", onFetch);
    toolEvents.on("progress", onProgress);
    toolEvents.on("ready", onReady);
    return () => {
      toolEvents.off("fetch", onFetch);
      toolEvents.off("progress", onProgress);
      toolEvents.off("ready", onReady);
    };
  }, [notify]);

  // ---- adding links ----
  const resolveOne = useCallback(
    async (url: string): Promise<Resolved | null> => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const ctrl = new AbortController();
      resolving.current.set(id, ctrl);
      setPending((p) => [...p, { id, url }]);
      try {
        return await resolveUrl(url, { signal: ctrl.signal, cookiesFromBrowser: configRef.current?.cookiesFromBrowser });
      } catch (err) {
        if (!isAborted(err)) notify(truncate(err instanceof Error ? err.message : String(err), 240), "bad");
        return null;
      } finally {
        resolving.current.delete(id);
        setPending((p) => p.filter((x) => x.id !== id));
      }
    },
    [notify],
  );

  const enqueue = useCallback(
    (res: Resolved, media: MediaOptions, dir?: string) => {
      const c = configRef.current;
      if (!c || !queue) return;
      const n = toNewDownload(res, c, media, dir);
      queue.add(n);
      notify(`Added ${truncate(n.title, 60)}`);
    },
    [queue, notify],
  );

  const submitLinks = useCallback(
    (text: string) => {
      setEditingUrl(false);
      setClipOffer(null);
      const raw = text.trim();
      if (!raw) return;
      void (async () => {
        let urls = extractUrls(raw);
        // A path to a text file is a batch list (IDM's "import").
        if (!urls.length && existsSync(expandHome(raw))) {
          try {
            urls = extractUrls(await fs.readFile(expandHome(raw), "utf8"));
          } catch {}
        }
        if (!urls.length) {
          const u = parseUrl(raw);
          if (u && !/\s/.test(raw)) urls = [u.toString()];
        }
        if (!urls.length) {
          notify("That doesn't look like a link", "bad");
          return;
        }
        if (urls.length === 1) {
          const res = await resolveOne(urls[0]!);
          if (res) setPickers((p) => [...p, res]);
          return;
        }
        // Several at once: no picker per link, just the default quality.
        notify(`Adding ${urls.length} links…`);
        const c = configRef.current;
        let added = 0;
        const work = [...urls];
        await Promise.all(
          Array.from({ length: 3 }, async () => {
            for (let u = work.shift(); u; u = work.shift()) {
              const res = await resolveOne(u);
              if (res && c) {
                enqueue(res, { quality: c.quality, audioFormat: "mp3", container: "mp4", subtitles: false, playlist: true });
                added++;
              }
            }
          }),
        );
        notify(`Added ${added} of ${urls.length} links`, added === urls.length ? "good" : "warn");
      })();
    },
    [notify, resolveOne, enqueue],
  );

  const pasteClipboard = useCallback(async () => {
    if (clipOffer) return submitLinks(clipOffer);
    const text = await readClipboard();
    if (!text) return notify("The clipboard is empty", "warn");
    submitLinks(text);
  }, [clipOffer, submitLinks, notify]);

  // ---- clipboard watcher ----
  useEffect(() => {
    if (!config?.clipboardWatch || !queue) return;
    let last: string | null = null;
    let stopped = false;
    const poll = async () => {
      const text = (await readClipboard()).trim();
      if (stopped) return;
      if (last === null) {
        last = text; // whatever was copied before watching began doesn't count
        return;
      }
      if (text === last) return;
      last = text;
      const url = extractUrls(text)[0];
      if (!url || !isSupportedUrl(url)) return;
      if (queue.list().some((i) => i.url === url)) return;
      setClipOffer(url);
      notify(`Copied ${truncate(url, 50)}  ${ICON.dot}  press v to download it`);
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    timer.unref?.();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [config?.clipboardWatch, queue, notify]);

  // ---- prompts for settings ----
  const openPrompt = useCallback((p: PromptSpec) => {
    setShowHelp(false);
    setPrompt(p);
  }, []);

  const openFolder = useCallback(
    (dir: string) => {
      void openInFileManager(dir).then((ok) => {
        if (!ok) notify(`Couldn't open ${dir}`, "bad");
      });
    },
    [notify],
  );

  const quitAll = useCallback(() => {
    for (const c of resolving.current.values()) c.abort();
    if (queue) {
      void queue.stopAll();
      saveQueueSync(queue.list());
    }
    onQuit();
  }, [queue, onQuit]);

  const setListFocus = useCallback((status: ListFocus, marked: number) => {
    setFocus((f) => (f.status === status && f.marked === marked ? f : { status, marked }));
  }, []);

  const busyOverlay = !!prompt || pickers.length > 0;

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") return quitAll();
      if (busyOverlay || editingUrl) return; // the overlay owns the keys
      if (showHelp) {
        setShowHelp(false);
        return;
      }
      const c = configRef.current;
      if (!c || !queue) return;
      switch (input) {
        case "?":
          return setShowHelp(true);
        case "q":
          return quitAll();
        case "a":
        case "/":
          setRegion("content");
          return setEditingUrl(true);
        case "v":
          return void pasteClipboard();
        case "o":
          return openPrompt({
            title: "download folder",
            value: c.downloadDir,
            placeholder: "~/Downloads/downlnk",
            hint: c.sortByCategory ? "Files sort into Video, Music, Images, … inside it (T to turn off)." : undefined,
            onSubmit: (v) => {
              if (!v.trim()) return "Enter a folder";
              updateConfig({ downloadDir: expandHome(v) });
              notify(`Saving to ${expandHome(v)}`);
            },
          });
        case "L":
          return openPrompt({
            title: "global speed limit",
            value: c.speedLimit ? String(Math.round(c.speedLimit / 1024)) + "K" : "",
            placeholder: "e.g. 2M or 500K; empty for no limit",
            hint: "Per second, shared by every download.",
            onSubmit: (v) => {
              if (!v.trim()) {
                updateConfig({ speedLimit: 0 });
                notify("No speed limit");
                return;
              }
              const r = parseRate(v);
              if (r === null) return "Write it like 500K or 2M";
              updateConfig({ speedLimit: r });
              notify(`Speed limited to ${formatBytesPerSec(r)}`);
            },
          });
        case "S":
          return openPrompt({
            title: "schedule",
            value: [c.scheduleStart ?? "", c.scheduleStop ? `-${c.scheduleStop}` : ""].join(""),
            placeholder: "start-stop, e.g. 02:00-07:00; empty to turn off",
            hint: "Start only: 02:00   stop only: -07:00   both: 02:00-07:00",
            onSubmit: (v) => {
              const t = v.trim();
              if (!t) {
                updateConfig({ scheduleStart: null, scheduleStop: null });
                scheduler.current?.refresh();
                notify("Schedule off: downloads start right away");
                return;
              }
              const [a = "", b = ""] = t.split("-").map((s) => s.trim());
              const start = a ? normalizeTime(a) : null;
              const stop = b ? normalizeTime(b) : null;
              if ((a && !start) || (b && !stop)) return "Times look like 02:00 or 14:30";
              updateConfig({ scheduleStart: start, scheduleStop: stop });
              scheduler.current?.refresh();
              notify(
                [start ? `starts at ${start}` : "", stop ? `stops at ${stop}` : ""].filter(Boolean).join(", ").replace(/^./, (m) => m.toUpperCase()),
              );
            },
          });
        case "+":
        case "=":
          updateConfig({ maxConcurrent: Math.min(16, c.maxConcurrent + 1) });
          return notify(`${Math.min(16, c.maxConcurrent + 1)} downloads at once`);
        case "-":
        case "_":
          updateConfig({ maxConcurrent: Math.max(1, c.maxConcurrent - 1) });
          return notify(`${Math.max(1, c.maxConcurrent - 1)} at once (running ones finish first)`);
        case "]":
          updateConfig({ segments: Math.min(32, c.segments + 1) });
          return notify(`${Math.min(32, c.segments + 1)} connections per file`);
        case "[":
          updateConfig({ segments: Math.max(1, c.segments - 1) });
          return notify(`${Math.max(1, c.segments - 1)} connections per file`);
        case "c": {
          const order = [null, ...BROWSERS];
          const next = order[(order.indexOf(c.cookiesFromBrowser as never) + 1) % order.length] ?? null;
          updateConfig({ cookiesFromBrowser: next });
          return notify(
            next
              ? `Using your ${next} sign-ins for sites that need them (read locally, never stored)`
              : "Not using browser cookies",
          );
        }
        case "w":
          updateConfig({ clipboardWatch: !c.clipboardWatch });
          return notify(c.clipboardWatch ? "Stopped watching the clipboard" : "Watching the clipboard for links");
        case "t": {
          const next = nextTheme(isThemeName(c.theme) ? c.theme : "torlink");
          applyTheme(next);
          updateConfig({ theme: next });
          return notify(`Theme: ${THEMES[next].label}  ${ICON.dot}  t for the next one`);
        }
        case "T":
          updateConfig({ sortByCategory: !c.sortByCategory });
          return notify(c.sortByCategory ? "New downloads go straight into the download folder" : "New downloads sort into category folders");
      }
      if (key.tab) return setRegion(region === "sidebar" ? "content" : "sidebar");
      if (key.rightArrow || input === "l") {
        if (region === "sidebar") setRegion("content");
        return;
      }
      if (key.leftArrow || input === "h") {
        if (region === "content") setRegion("sidebar");
        return;
      }
      if (key.escape) {
        if (focus.marked) return; // the list unmarks
        if (region === "content") return setRegion("sidebar");
        return setView("splash");
      }
    },
    { isActive: isRawModeSupported && view === "main" && !!queue },
  );

  // Links passed on the command line go straight in.
  const seeded = useRef(false);
  useEffect(() => {
    if (!queue || seeded.current || !initialUrls.length) return;
    seeded.current = true;
    submitLinks(initialUrls.join("\n"));
  }, [queue, initialUrls, submitLinks]);

  const compact = rows < 22;
  const headerH = compact ? 1 : 3;
  const bodyH = Math.max(6, rows - headerH - 4);
  const contentWidth = Math.max(30, cols - 2 - RAIL_WIDTH - 1);
  const listH = Math.max(4, bodyH - 3 - 2);

  const store = useMemo<Store | null>(
    () =>
      queue && config
        ? {
            queue,
            config,
            cols,
            rows,
            contentWidth,
            listRows: listH,
            region,
            setRegion,
            filter,
            setFilter,
            pending,
            editingUrl,
            overlayOpen: showHelp || !!prompt || pickers.length > 0,
            setEditingUrl,
            submitLinks,
            openFolder,
            openPrompt,
            notify,
            setListFocus,
          }
        : null,
    [queue, config, cols, rows, contentWidth, listH, region, filter, pending, editingUrl, showHelp, prompt, pickers.length, submitLinks, openFolder, openPrompt, notify, setListFocus],
  );

  if (!store || !config || !queue) {
    return (
      <Box height={rows} justifyContent="center" alignItems="center">
        <Spinner label="Starting downlnk" />
      </Box>
    );
  }

  if (view === "splash") {
    return (
      <StoreContext.Provider value={store}>
        <TabTitle />
        <Splash
          cols={cols}
          rows={rows}
          waiting={queue.pendingCount}
          onSubmit={(t) => {
            setView("main");
            submitLinks(t);
          }}
          onBrowse={() => setView("main")}
          onQuit={quitAll}
        />
      </StoreContext.Provider>
    );
  }

  const picker = pickers[0];
  const overlay = showHelp || !!prompt || !!picker;
  const panelW = Math.max(30, Math.min(cols - 4, 80));
  const toneColor = notice?.tone === "bad" ? COLOR.bad : notice?.tone === "warn" ? COLOR.warn : COLOR.good;
  const speed = queue.totalSpeed;
  const statusBits = [
    queue.activeCount ? `${ICON.down} ${formatBytesPerSec(speed) || "…"}` : null,
    `${config.maxConcurrent} at once`,
    `${config.segments} conn`,
    config.speedLimit ? `limit ${rateLabel(config.speedLimit)}` : null,
    config.cookiesFromBrowser ? `cookies ${config.cookiesFromBrowser}` : null,
    config.clipboardWatch ? "clipboard on" : null,
    config.scheduleStart || config.scheduleStop
      ? `${ICON.clock} ${config.scheduleStart ?? "now"}–${config.scheduleStop ?? "…"}`
      : null,
    queue.held ? `waiting for ${queue.held}` : null,
  ].filter(Boolean);

  const closePicker = () => setPickers((p) => p.slice(1));

  return (
    <StoreContext.Provider value={store}>
      <TabTitle />
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Box flexShrink={0}>
            {compact ? (
              <Text bold color={COLOR.accent}>
                downlnk
              </Text>
            ) : (
              <Logo />
            )}
          </Box>
          <Box flexDirection="column" alignItems="flex-end" flexShrink={1} minWidth={0} marginLeft={2}>
            {!compact ? <Text> </Text> : null}
            {toolFetch ? (
              <Text color={COLOR.warn} wrap="truncate-end">
                {toolFetch}
              </Text>
            ) : notice ? (
              <Text color={toneColor} wrap="truncate-end">
                {notice.text}
              </Text>
            ) : !compact ? (
              <Text> </Text>
            ) : null}
            {!compact ? (
              <Text dimColor wrap="truncate-end">
                {statusBits.join(`  ${ICON.dot}  `)}
              </Text>
            ) : null}
          </Box>
        </Box>
        <Rule width={Math.max(10, cols - 2)} />

        {showHelp ? (
          <Box marginTop={1}>
            <HelpOverlay />
          </Box>
        ) : null}

        {prompt ? (
          <Box marginTop={1}>
            <InputPrompt width={panelW} spec={prompt} onClose={() => setPrompt(null)} />
          </Box>
        ) : picker ? (
          <Box marginTop={1}>
            <FormatPicker
              key={picker.route.url}
              width={panelW}
              resolved={picker}
              defaultQuality={config.quality}
              connections={config.segments}
              target={(media) => toNewDownload(picker, config, media).dir}
              onCancel={closePicker}
              onDownload={(media, pickFolder) => {
                if (!pickFolder) {
                  enqueue(picker, media);
                  closePicker();
                  return;
                }
                const res = picker;
                closePicker();
                openPrompt({
                  title: "download to",
                  subject: res.engine === "http" ? res.probe.filename : res.info.title,
                  value: toNewDownload(res, config, media).dir,
                  submitLabel: "download",
                  onSubmit: (v) => {
                    if (!v.trim()) return "Enter a folder";
                    enqueue(res, media, expandHome(v));
                  },
                });
              }}
            />
          </Box>
        ) : null}

        <Box height={bodyH} marginTop={1} display={overlay ? "none" : "flex"} overflow="hidden">
          <Sidebar />
          <Box flexGrow={1} flexDirection="column">
            <UrlBar
              width={contentWidth}
              editing={editingUrl}
              onSubmit={submitLinks}
              onExitDown={() => setEditingUrl(false)}
            />
            <EscToLeave active={editingUrl} onLeave={() => setEditingUrl(false)} />
            <Downloads height={listH} />
          </Box>
        </Box>

        <Box display={overlay ? "none" : "flex"}>
          <Footer hints={footerHints(region, focus.status, focus.marked)} />
        </Box>
      </Box>
    </StoreContext.Provider>
  );
}

// The URL field swallows every key but esc, which should hand focus back.
function EscToLeave({ active, onLeave }: { active: boolean; onLeave: () => void }) {
  useInput(
    (_input, key) => {
      if (key.escape) onLeave();
    },
    { isActive: active },
  );
  return null;
}
