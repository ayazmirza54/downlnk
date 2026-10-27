import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { Panel } from "./Panel";
import { COLOR, ENGINE_LABEL, GUTTER, ICON, sourceStyle } from "../theme";
import { wrapStep } from "../move";
import type { Resolved } from "../../download/resolve";
import { DEFAULT_MEDIA, type MediaOptions } from "../../download/types";
import { INSTALL_HINT, locateTool } from "../../tools/resolve";
import { cleanText, formatBytes, truncate } from "../../util/format";

interface Choice {
  quality: string;
  label: string;
  detail?: string;
}

const STANDARD = [2160, 1440, 1080, 720, 480, 360];

export function choicesFor(res: Resolved): Choice[] {
  if (res.engine !== "ytdlp") return [];
  const { heights, hasVideo } = res.info;
  const out: Choice[] = [];
  if (hasVideo) {
    out.push({ quality: "best", label: "Best available", detail: heights[0] ? `${heights[0]}p` : undefined });
    const max = heights[0] ?? 0;
    for (const h of STANDARD) {
      if (h < max && heights.some((x) => x >= h)) out.push({ quality: String(h), label: `${h}p` });
    }
  } else {
    out.push({ quality: "best", label: "Original" });
  }
  out.push({ quality: "audio", label: "Audio only" });
  return out;
}

function lengthOf(sec?: number): string {
  if (!sec) return "";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function FormatPicker({
  width,
  resolved,
  defaultQuality,
  connections,
  target,
  onDownload,
  onCancel,
}: {
  width: number;
  resolved: Resolved;
  defaultQuality: string;
  connections: number;
  /** Where it will land with the given choices, for the "→ folder" line. */
  target: (media: MediaOptions) => string;
  onDownload: (media: MediaOptions, pickFolder: boolean) => void;
  onCancel: () => void;
}) {
  const choices = choicesFor(resolved);
  const initial = Math.max(0, choices.findIndex((c) => c.quality === defaultQuality));
  const [idx, setIdx] = useState(initial);
  const [media, setMedia] = useState<MediaOptions>({ ...DEFAULT_MEDIA });
  const chosen: MediaOptions = { ...media, quality: choices[idx]?.quality ?? "best" };
  const isAudio = chosen.quality === "audio";
  const playlist = resolved.engine === "ytdlp" && resolved.info.isPlaylist;

  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) return onDownload(chosen, false);
    if (input === "f" || input === "D") return onDownload(chosen, true);
    if (!choices.length) return;
    if (key.upArrow || input === "k") setIdx(wrapStep(idx, -1, choices.length));
    else if (key.downArrow || input === "j") setIdx(wrapStep(idx, 1, choices.length));
    else if (input === "s") setMedia({ ...media, subtitles: !media.subtitles });
    else if (input === "p" && playlist) setMedia({ ...media, playlist: !media.playlist });
    else if (input === "m") {
      if (isAudio) setMedia({ ...media, audioFormat: media.audioFormat === "mp3" ? "m4a" : "mp3" });
      else setMedia({ ...media, container: media.container === "mp4" ? "mkv" : "mp4" });
    }
  });

  const ss = sourceStyle(resolved.route.source, resolved.engine);
  const ffmpeg = locateTool("ffmpeg");
  const inner = width - 4;

  const facts: string[] = [];
  if (resolved.engine === "ytdlp") {
    const i = resolved.info;
    if (i.uploader) facts.push(i.uploader);
    if (i.duration) facts.push(lengthOf(i.duration));
    if (i.isPlaylist) facts.push(`${i.entries ?? "?"} items`);
    if (i.sizeEstimate) facts.push(`~${formatBytes(i.sizeEstimate)}`);
  } else if (resolved.engine === "gallerydl") {
    const n = resolved.info.count;
    facts.push(n ? `${n} file${n === 1 ? "" : "s"}` : "a collection of posts");
  } else {
    const p = resolved.probe;
    facts.push(p.total ? formatBytes(p.total) : "size unknown");
    if (p.contentType) facts.push(p.contentType.split(";")[0]!);
    facts.push(
      p.ranged
        ? `resumable ${ICON.dot} up to ${connections} connections`
        : "no resume support: one connection",
    );
  }

  const listRows = choices.length;
  const toggles =
    resolved.engine === "ytdlp"
      ? [
          isAudio ? `m ${media.audioFormat.toUpperCase()}` : `m ${media.container.toUpperCase()}`,
          `s subtitles ${media.subtitles ? "on" : "off"}`,
          ...(playlist ? [`p ${media.playlist ? "whole playlist" : "just this one"}`] : []),
        ]
      : [];
  const warn =
    resolved.engine === "ytdlp" && !ffmpeg
      ? `${ICON.warn} ffmpeg not found: ${isAudio ? "keeping the original audio format" : "limited to single-file formats"}. ${INSTALL_HINT.ffmpeg}`
      : null;

  const height = 3 + (facts.length ? 0 : -1) + (listRows ? listRows + 1 : 0) + (toggles.length ? 1 : 0) + (warn ? 1 : 0) + 1;

  return (
    <Box flexDirection="column" width={width}>
      <Panel title="download" width={width} focused height={height}>
        <Box>
          <Box flexGrow={1} minWidth={0}>
            <Text bold color={COLOR.text} wrap="truncate-end">
              {cleanText(resolved.engine === "http" ? resolved.probe.filename : resolved.info.title)}
            </Text>
          </Box>
          <Box marginLeft={1} flexShrink={0}>
            <Text color={ss.color}>{ss.tag}</Text>
            {ss.tag !== ENGINE_LABEL[resolved.engine] ? (
              <Text dimColor>{` ${ICON.dot} ${ENGINE_LABEL[resolved.engine]}`}</Text>
            ) : null}
          </Box>
        </Box>
        {facts.length ? <Text dimColor wrap="truncate-end">{facts.join(`  ${ICON.dot}  `)}</Text> : null}
        {listRows ? (
          <Box flexDirection="column" marginTop={1}>
            {choices.map((c, i) => {
              const here = i === idx;
              const detail = c.quality === "audio" ? media.audioFormat.toUpperCase() : c.detail;
              return (
                <Box key={c.quality}>
                  <Box width={GUTTER} flexShrink={0}>
                    <Text color={COLOR.accent} bold>
                      {here ? ICON.pointer : ""}
                    </Text>
                  </Box>
                  <Text bold={here} color={here ? COLOR.accent : undefined} dimColor={!here}>
                    {c.label}
                  </Text>
                  {detail ? <Text dimColor>{`  ${detail}`}</Text> : null}
                </Box>
              );
            })}
          </Box>
        ) : null}
        {toggles.length ? (
          <Text wrap="truncate-end">
            {toggles.map((t, i) => (
              <Text key={t}>
                {i > 0 ? <Text dimColor>{"   "}</Text> : null}
                <Text color={COLOR.alt}>{t.split(" ")[0]}</Text>
                <Text dimColor>{` ${t.split(" ").slice(1).join(" ")}`}</Text>
              </Text>
            ))}
          </Text>
        ) : null}
        {warn ? (
          <Text color={COLOR.warn} wrap="truncate-end">
            {warn}
          </Text>
        ) : null}
        <Text dimColor wrap="truncate-end">
          {`→ ${truncate(target(chosen), inner - 2)}`}
        </Text>
      </Panel>
      <Box marginTop={1}>
        <Text>
          <Text color={COLOR.accent} bold>
            ↵
          </Text>
          <Text color={COLOR.text}> download</Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text color={COLOR.alt}>f</Text>
          <Text dimColor> pick folder</Text>
          <Text dimColor>{`  ${ICON.dot}  `}</Text>
          <Text color={COLOR.alt}>esc</Text>
          <Text dimColor> cancel</Text>
        </Text>
      </Box>
    </Box>
  );
}

