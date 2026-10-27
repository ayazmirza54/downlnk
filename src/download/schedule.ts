// IDM-style scheduler: "start the queue at HH:MM", "stop it at HH:MM".
// Times are wall-clock minutes of the day, so a 23:30 → 01:00 window works.

export function minutesOf(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Accepts "2", "2:5", "02:05", "14:30"; returns canonical "HH:MM" or null. */
export function normalizeTime(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const dayMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** True when wall-clock time moved past `target` between `prev` and `now`. */
export function crossed(prev: Date, now: Date, target: number): boolean {
  if (now.getTime() <= prev.getTime()) return false;
  // Over a day apart: every time of day was passed.
  if (now.getTime() - prev.getTime() >= 24 * 3600_000) return true;
  const a = dayMinutes(prev);
  const b = dayMinutes(now);
  if (a === b) return false;
  return a < b ? target > a && target <= b : target > a || target <= b;
}

/** True when `now` falls inside the [start, stop) window. */
export function inWindow(now: Date, start: number, stop: number | null): boolean {
  const t = dayMinutes(now);
  if (stop === null || stop === start) return t >= start;
  return start < stop ? t >= start && t < stop : t >= start || t < stop;
}

export interface ScheduleHooks {
  hold: (until: string | null) => void;
  stop: () => void;
}

/**
 * Watch the clock and drive the queue. With a start time set, the queue holds
 * until that time arrives (unless it's already inside the window); at the
 * stop time it pauses everything and holds until the next start.
 */
export function startScheduler(
  getTimes: () => { start: string | null; stop: string | null },
  hooks: ScheduleHooks,
  tickMs = 15_000,
): { refresh: () => void; dispose: () => void } {
  let prev = new Date();

  const refresh = () => {
    const { start, stop } = getTimes();
    const s = start ? minutesOf(start) : null;
    const e = stop ? minutesOf(stop) : null;
    if (s === null) hooks.hold(null);
    else hooks.hold(inWindow(new Date(), s, e) ? null : start);
  };

  const timer = setInterval(() => {
    const now = new Date();
    const { start, stop } = getTimes();
    const s = start ? minutesOf(start) : null;
    const e = stop ? minutesOf(stop) : null;
    if (s !== null && crossed(prev, now, s)) hooks.hold(null);
    if (e !== null && crossed(prev, now, e)) {
      hooks.stop();
      hooks.hold(start ?? "later");
    }
    prev = now;
  }, tickMs);
  timer.unref?.();

  refresh();
  return { refresh, dispose: () => clearInterval(timer) };
}
