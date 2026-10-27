import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { matchesFilter, useQueueItems, useStore } from "../store";
import { Panel } from "./Panel";
import { ProgressBar } from "./ProgressBar";
import { Spinner } from "./Spinner";
import { windowStart } from "../move";
import { COLOR, GUTTER, ICON, sourceStyle } from "../theme";
import { parseRate } from "../../cli/args";
import {
  cleanText,
  formatBytes,
  formatBytesPerSec,
  formatEtaShort,
  formatRelative,
  truncate,
} from "../../util/format";
import type { DownloadItem } from "../../download/types";

const ROWS_PER_ACTIVE = 2;
const MARK = 2;

function statusColor(it: DownloadItem): string {
  if (it.status === "failed") return COLOR.bad;
  if (it.status === "paused" || it.status === "queued") return COLOR.paused;
  return COLOR.accent;
}

function statusIcon(it: DownloadItem): string {
  if (it.status === "failed") return ICON.error;
  if (it.status === "paused") return ICON.pause;
  if (it.status === "queued") return ICON.pending;
  return ICON.down;
}

export function pct(it: DownloadItem): number {
  if (it.status === "done") return 100;
  return it.total > 0 ? Math.min(100, Math.floor((it.downloaded / it.total) * 100)) : 0;
}

function rightStats(it: DownloadItem, held: string | null): string {
  const files = it.filesTotal && it.filesTotal > 1 ? `  ${it.filesDone ?? 0}/${it.filesTotal} files` : "";
  if (it.status === "downloading") {
    if (it.stage && it.speed === 0) return `${pct(it)}%  ${it.stage}${files}`;
    const speed = formatBytesPerSec(it.speed) || "…";
    const eta = it.eta ? `  ${formatEtaShort(it.eta)}` : "";
    const conns = it.connections && it.connections > 1 ? `  ${ICON.peer}${it.connections}` : "";
    const size = it.total > 0 ? "" : `  ${formatBytes(it.downloaded)}`;
    return `${pct(it)}%  ${speed}${conns}${eta}${size}${files}${it.stage ? `  ${it.stage}` : ""}`;
  }
  if (it.status === "paused") return `paused  ${pct(it)}%${files}`;
  if (it.status === "queued") return held ? `waits for ${held}` : `queued  ${pct(it)}%`;
  return it.error || "failed";
}

function order(items: readonly DownloadItem[]): { active: DownloadItem[]; done: DownloadItem[] } {
  const active = items.filter((i) => i.status !== "done");
  const done = items
    .filter((i) => i.status === "done")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return { active, done };
}

export function Downloads({ height }: { height: number }) {
  const { queue, region, contentWidth, filter, pending, openFolder, openPrompt, notify, setListFocus, editingUrl, overlayOpen } =
    useStore();
  const items = useQueueItems(queue);
  const focused = region === "content" && !editingUrl;
  const listening = focused && !overlayOpen;
  const { active, done } = useMemo(
    () => order(items.filter((i) => matchesFilter(i, filter))),
    // items is the same array instance across renders; the version drives it.
    [items, filter, queue.getVersion()],
  );
  const all = [...active, ...done];
  const total = all.length;

  const [cursorId, setCursorId] = useState<string | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  let cursor = cursorId ? all.findIndex((i) => i.id === cursorId) : 0;
  if (cursor < 0) cursor = 0;
  const current = all[cursor];
  const inActive = cursor < active.length;

  const liveMarked = [...marked].filter((id) => all.some((i) => i.id === id));
  useEffect(() => {
    setListFocus(focused && current ? current.status : null, liveMarked.length);
  }, [focused, current?.status, liveMarked.length, setListFocus]);

  const move = (d: number) => {
    if (!total) return;
    const next = (((cursor + d) % total) + total) % total;
    setCursorId(all[next]!.id);
  };
  const targets = (): DownloadItem[] =>
    liveMarked.length ? all.filter((i) => liveMarked.includes(i.id)) : current ? [current] : [];

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") return move(-1);
      if (key.downArrow || input === "j") return move(1);
      if (key.pageUp) return move(-5);
      if (key.pageDown) return move(5);
      if (input === " " && current) {
        const next = new Set(marked);
        if (next.has(current.id)) next.delete(current.id);
        else next.add(current.id);
        setMarked(next);
        move(1);
        return;
      }
      if (key.escape && liveMarked.length) {
        setMarked(new Set());
        return;
      }
      if (input === "P") {
        const anyRunning = queue.list().some((i) => i.status === "downloading" || i.status === "queued");
        if (anyRunning) {
          queue.pauseAll();
          notify("Paused everything");
        } else {
          queue.resumeAll();
          notify("Resumed everything");
        }
        return;
      }
      if (input === "C") {
        queue.clearDone();
        notify("Cleared finished downloads from the list (files stay on disk)");
        return;
      }
      if (!current) return;
      if (input === "p") {
        for (const it of targets()) if (it.status !== "done") queue.togglePause(it.id);
        setMarked(new Set());
      } else if (input === "x" || key.delete) {
        for (const it of targets()) {
          // A finished entry only leaves the list; anything unfinished also
          // has its partial data cleaned up.
          if (it.status === "done") queue.remove(it.id);
          else queue.cancel(it.id);
        }
        setMarked(new Set());
      } else if (input === "r") {
        for (const it of targets()) {
          if (it.status === "failed") queue.resume(it.id);
          else if (it.status === "done") {
            queue.add({
              url: it.url,
              engine: it.engine,
              source: it.source,
              title: it.title,
              dir: it.dir,
              category: it.category,
              media: it.media,
              filename: it.filename,
              total: it.total,
              filesTotal: it.filesTotal,
            });
          }
        }
        setMarked(new Set());
      } else if (input === "e" || key.return) {
        openFolder(current.status === "done" && current.files[0] ? dirOf(current.files[0]) : current.dir);
      } else if (input === "l" && current.status !== "done") {
        const it = current;
        openPrompt({
          title: "speed limit for this download",
          subject: cleanText(it.title),
          value: it.speedLimit ? formatBytes(it.speedLimit).replace(/\.00 /, "").replace(" ", "") : "",
          placeholder: "e.g. 500K or 2M; empty for no limit",
          hint: "Per second. Applies on top of the global limit (L).",
          onSubmit: (v) => {
            if (!v.trim()) {
              queue.setItemLimit(it.id, 0);
              notify("No limit on this download");
              return;
            }
            const r = parseRate(v);
            if (r === null) return "Write it like 500K or 2M";
            queue.setItemLimit(it.id, r);
            notify(`Limited to ${formatBytesPerSec(r)}${it.engine === "http" ? "" : " (applies when it next starts)"}`);
          },
        });
      }
    },
    { isActive: listening },
  );

  const panelH = Math.max(5, height);
  const count = active.length ? `(${active.length})` : undefined;

  if (total === 0 && pending.length === 0) {
    return (
      <Panel title="downloads" width={contentWidth} focused={focused} height={panelH}>
        <Text dimColor>
          {filter === "all"
            ? "Nothing here yet. Press a and paste a link, or copy one and press v."
            : "Nothing in this view."}
        </Text>
      </Panel>
    );
  }

  const ceiling = Math.max(1, panelH - 1 - pending.length);
  const hasActive = active.length > 0;
  const hasDone = done.length > 0;
  const headerRows = hasDone ? 1 : 0;
  let gapRows = hasActive && hasDone ? 1 : 0;
  let maxActive = 0;
  let maxDone = 0;
  if (!hasDone) {
    maxActive = Math.max(1, Math.floor(ceiling / ROWS_PER_ACTIVE));
  } else if (!hasActive) {
    maxDone = Math.max(1, ceiling - headerRows);
  } else {
    let budget = ceiling - headerRows - gapRows;
    if (budget < ROWS_PER_ACTIVE + 1) {
      gapRows = 0;
      budget = ceiling - headerRows;
    }
    const activeCap = Math.max(ROWS_PER_ACTIVE, Math.floor(budget * 0.6));
    maxActive = Math.min(active.length, Math.max(1, Math.floor(activeCap / ROWS_PER_ACTIVE)));
    maxDone = Math.max(1, budget - maxActive * ROWS_PER_ACTIVE);
  }

  const activeStart = windowStart(inActive ? cursor : 0, active.length, maxActive);
  const activeVisible = active.slice(activeStart, activeStart + maxActive);
  const doneCursor = cursor - active.length;
  const doneStart = windowStart(inActive ? 0 : doneCursor, done.length, maxDone);
  const doneVisible = done.slice(doneStart, doneStart + maxDone);

  const inner = contentWidth - 4;
  const barW = Math.max(8, Math.min(28, Math.floor(inner * 0.38)));
  const statsW = Math.max(6, inner - MARK - GUTTER - barW - 2);
  const held = queue.held;

  return (
    <Panel title="downloads" width={contentWidth} focused={focused} count={count} height={panelH}>
      {pending.map((p) => (
        <Box key={p.id}>
          <Box width={MARK + GUTTER} flexShrink={0} />
          <Spinner label={`Looking at ${truncate(p.url, Math.max(10, inner - 16))}`} />
        </Box>
      ))}

      {activeVisible.map((it, i) => {
        const here = focused && activeStart + i === cursor;
        const isMarked = liveMarked.includes(it.id);
        const sc = statusColor(it);
        const ss = sourceStyle(it.source, it.engine);
        return (
          <Box key={it.id} flexDirection="column">
            <Box>
              <Box width={MARK} flexShrink={0}>
                <Text color={COLOR.accent} bold>
                  {here ? ICON.pointer : isMarked ? ICON.mark : ""}
                </Text>
              </Box>
              <Box width={GUTTER} flexShrink={0}>
                <Text color={sc}>{statusIcon(it)}</Text>
              </Box>
              <Box flexGrow={1} minWidth={0}>
                <Text wrap="truncate-end" bold={here} color={here ? COLOR.accent : undefined} dimColor={!here}>
                  {cleanText(it.title)}
                </Text>
              </Box>
              <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                <Text dimColor={!here} bold={here}>
                  {it.total > 0 ? formatBytes(it.total) : "-"}
                </Text>
              </Box>
              <Box width={5} flexShrink={0} marginLeft={1} justifyContent="flex-end">
                <Text color={ss.color} dimColor={!here} bold={here}>
                  {ss.tag}
                </Text>
              </Box>
            </Box>
            <Box>
              <Box width={MARK + GUTTER} flexShrink={0} />
              <ProgressBar pct={pct(it)} width={barW} color={sc} animate={it.status === "downloading"} />
              <Box marginLeft={2} flexShrink={0}>
                <Text color={it.status === "failed" ? COLOR.bad : undefined} dimColor={it.status !== "failed"}>
                  {truncate(rightStats(it, held), statsW)}
                </Text>
              </Box>
            </Box>
          </Box>
        );
      })}

      {hasDone ? (
        <Box marginTop={gapRows ? 1 : 0}>
          <Text dimColor>{`Recently downloaded${done.length > 1 ? `  (${done.length})` : ""}`}</Text>
        </Box>
      ) : null}

      {doneVisible.map((it, i) => {
        const here = focused && !inActive && doneStart + i === doneCursor;
        const isMarked = liveMarked.includes(it.id);
        const ss = sourceStyle(it.source, it.engine);
        const files = it.files.length > 1 ? `${it.files.length} files` : "";
        return (
          <Box key={it.id}>
            <Box width={MARK} flexShrink={0}>
              <Text color={COLOR.accent} bold>
                {here ? ICON.pointer : isMarked ? ICON.mark : ""}
              </Text>
            </Box>
            <Box width={GUTTER} flexShrink={0}>
              <Text color={COLOR.good} dimColor={!here}>
                {ICON.done}
              </Text>
            </Box>
            <Box flexGrow={1} minWidth={0}>
              <Text wrap="truncate-end" bold={here} color={here ? COLOR.accent : undefined} dimColor={!here}>
                {cleanText(it.title)}
              </Text>
            </Box>
            <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor>{files}</Text>
            </Box>
            <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor={!here} bold={here}>
                {it.total > 0 ? formatBytes(it.total) : "-"}
              </Text>
            </Box>
            <Box width={10} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text dimColor={!here}>{formatRelative((it.completedAt ?? 0) / 1000) || "-"}</Text>
            </Box>
            <Box width={5} flexShrink={0} marginLeft={1} justifyContent="flex-end">
              <Text color={ss.color} dimColor={!here} bold={here}>
                {ss.tag}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Panel>
  );
}

function dirOf(file: string): string {
  const i = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return i > 0 ? file.slice(0, i) : file;
}
