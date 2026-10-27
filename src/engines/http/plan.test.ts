import { describe, expect, it } from "vitest";
import { isComplete, planSegments, remaining, splitLargest, totalDone } from "./plan";

describe("planSegments", () => {
  it("covers every byte exactly once", () => {
    const segs = planSegments(10_000_000, 8, 1000);
    expect(segs).toHaveLength(8);
    expect(segs[0]!.start).toBe(0);
    expect(segs.at(-1)!.end).toBe(9_999_999);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.start).toBe(segs[i - 1]!.end + 1);
    expect(segs.reduce((n, s) => n + remaining(s), 0)).toBe(10_000_000);
  });

  it("never makes segments smaller than the minimum", () => {
    expect(planSegments(3000, 8, 1000)).toHaveLength(3);
    expect(planSegments(500, 8, 1000)).toHaveLength(1);
  });

  it("returns nothing for an empty or unknown size", () => {
    expect(planSegments(0, 8)).toEqual([]);
  });
});

describe("splitLargest", () => {
  it("halves what is left of the biggest segment", () => {
    const segs = [
      { start: 0, end: 999, done: 1000 },
      { start: 1000, end: 9999, done: 1000 },
    ];
    const piece = splitLargest(segs, 100)!;
    // 8000 bytes were left from 2000; each half now owns 4000.
    expect(segs[1]!.end).toBe(5999);
    expect(piece).toEqual({ start: 6000, end: 9999, done: 0 });
    expect(remaining(segs[1]!)).toBe(4000);
    expect(remaining(piece)).toBe(4000);
  });

  it("refuses to split below twice the minimum", () => {
    const segs = [{ start: 0, end: 150, done: 0 }];
    expect(splitLargest(segs, 100)).toBeNull();
    expect(segs).toHaveLength(1);
  });

  it("keeps the byte total intact across repeated splits", () => {
    const segs = planSegments(1_000_000, 2, 1000);
    segs[0]!.done = 200_000;
    for (let i = 0; i < 10; i++) splitLargest(segs, 1000);
    expect(totalDone(segs) + segs.reduce((n, s) => n + remaining(s), 0)).toBe(1_000_000);
    expect(isComplete(segs)).toBe(false);
  });
});
