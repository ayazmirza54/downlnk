// Byte-range bookkeeping for the segmented downloader, kept pure so the
// splitting rules can be tested without a network.
//
// A segment owns the inclusive byte range [start, end]; `done` counts bytes
// already written from `start`. A worker always writes at start + done and
// re-reads `end` before every write, so shrinking `end` (a split) is safe while
// the worker is mid-stream: it simply stops at the new boundary.

export interface Segment {
  start: number;
  end: number;
  done: number;
}

/** Smallest piece worth its own connection; below this, overhead wins. */
export const MIN_SEGMENT = 1024 * 1024;

export function remaining(s: Segment): number {
  return Math.max(0, s.end - s.start + 1 - s.done);
}

export function totalDone(segs: readonly Segment[]): number {
  return segs.reduce((n, s) => n + s.done, 0);
}

export function isComplete(segs: readonly Segment[]): boolean {
  return segs.every((s) => remaining(s) === 0);
}

/** Split `total` bytes into at most `count` contiguous, near-equal segments. */
export function planSegments(total: number, count: number, minSize = MIN_SEGMENT): Segment[] {
  if (total <= 0) return [];
  const n = Math.max(1, Math.min(Math.floor(count), Math.floor(total / minSize)));
  const size = Math.ceil(total / n);
  const out: Segment[] = [];
  for (let start = 0; start < total; start += size) {
    out.push({ start, end: Math.min(total, start + size) - 1, done: 0 });
  }
  return out;
}

/**
 * IDM's dynamic segmentation: when a connection frees up, halve the segment
 * with the most bytes left and hand the back half to the free connection.
 * Mutates the split segment's `end`, appends and returns the new one; null
 * when nothing is big enough to be worth splitting.
 */
export function splitLargest(segs: Segment[], minSplit = MIN_SEGMENT): Segment | null {
  let best: Segment | undefined;
  for (const s of segs) if (!best || remaining(s) > remaining(best)) best = s;
  if (!best) return null;
  const rem = remaining(best);
  if (rem < minSplit * 2) return null;
  const cur = best.start + best.done;
  const mid = cur + Math.floor(rem / 2) - 1;
  const piece: Segment = { start: mid + 1, end: best.end, done: 0 };
  best.end = mid;
  segs.push(piece);
  return piece;
}
