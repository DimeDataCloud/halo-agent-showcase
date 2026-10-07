// Excerpt from a private codebase: HALO Agent OS, server/zoned-time.ts at 88cf4ce.
// Shown for reading. Not licensed for reuse; see ../LICENSE.
//
// Wall-clock times in a named zone, without a dependency.
//
// Two callers need the same arithmetic and must agree: the routine scheduler
// (a routine says "08:00" and means 08:00 where the owner is, not where the
// container is) and the calendar reader (an ICS event carries
// `DTSTART;TZID=America/Chicago:20260908T090000`). Getting them from one place
// is the point — two implementations of DST would diverge exactly once, at
// 02:00 on a Sunday, unattended.
//
// Pure, and cheap enough to call on every tick: the only expensive thing here
// is building an `Intl.DateTimeFormat`, and those are cached per zone.
/** Intl formatters are expensive to build and this runs on every tick, per routine. */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

export function zoneFormatter(tz: string): Intl.DateTimeFormat | null {
  const cached = zoneFormatters.get(tz);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    zoneFormatters.set(tz, f);
    return f;
  } catch {
    // An unknown zone must not stop a routine from ever running again. Fall
    // back to this computer's zone, which is the old behaviour.
    return null;
  }
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface ZonedFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

export function zonedFields(f: Intl.DateTimeFormat, ts: number): ZonedFields {
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ts))) if (p.type !== "literal") parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** The zone's offset from UTC at that instant, in ms (positive east of Greenwich). */
export function zoneOffsetMs(f: Intl.DateTimeFormat, ts: number): number {
  const z = zonedFields(f, ts);
  return Date.UTC(z.year, z.month, z.day, z.hour, z.minute, z.second) - Math.floor(ts / 1000) * 1000;
}

/**
 * The instant whose wall clock in this zone is the given date and time.
 *
 * Two passes, then a check: guess with the offset at the guess, correct with
 * the offset actually in force there, and READ THE RESULT BACK. The read-back
 * is the part that matters. On a spring-forward day the two passes oscillate
 * across the gap, and taking the second one silently lands an hour BEFORE the
 * transition — a 02:30 routine firing at 01:30. So:
 *
 *   - the corrected instant whose wall clock really is the requested one wins
 *     (every ordinary day, and the first of the two fall-back occurrences, so
 *     an ambiguous time fires once rather than twice);
 *   - when neither candidate has it, the time does not exist that day, and the
 *     later candidate wins — the first instant past the gap. Fires once, on the
 *     right day, shortly after the intended time; never skipped, never early.
 */
export function instantForZonedWallClock(f: Intl.DateTimeFormat, y: number, m: number, d: number, hh: number, mm: number): number {
  const wall = Date.UTC(y, m, d, hh, mm, 0);
  const first = wall - zoneOffsetMs(f, wall);
  const second = wall - zoneOffsetMs(f, first);
  const z = zonedFields(f, second);
  const matches = z.year === y && z.month === m && z.day === d && z.hour === hh && z.minute === mm;
  return matches ? second : Math.max(first, second);
}

/** Shift a zoned calendar date by whole days, without leaving the zone's calendar. */
export function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m, d));
  t.setUTCDate(t.getUTCDate() + days);
  return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()];
}
