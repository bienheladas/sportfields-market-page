// Slot times are stored on-chain as POSIX ms (absolute UTC instants) — but the
// weekly schedule (open/close hours) is meant to represent the FIELD's local
// hours (OwnerRecord.timezone, an IANA string, Mejora L), not UTC literal and
// not the viewer's browser timezone. These helpers convert between the two.

import tzlookup from 'tz-lookup'

/**
 * Derives the IANA timezone from the field's coordinates instead of trusting
 * manual entry — a free-text "America/Guatemala" typed by whoever registers
 * the field can silently mismatch the field's actual location (e.g. defaulting
 * to the registering browser's own timezone). Falls back to 'UTC' if lat/long
 * are out of range or off the map (tz-lookup throws for open ocean).
 */
export function timezoneFromLatLong(lat: number, long: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return 'UTC'
  try {
    return tzlookup(lat, long)
  } catch {
    return 'UTC'
  }
}

/**
 * Converts a "wall clock" date/time in a given IANA timezone to the
 * corresponding UTC instant (POSIX ms). Guess-and-correct algorithm using
 * Intl.DateTimeFormat — no external libraries, DST-aware.
 */
export function zonedTimeToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(utcGuess))) map[p.type] = p.value
  const asIfUtc = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) % 24, Number(map.minute), Number(map.second),
  )
  const driftMs = asIfUtc - utcGuess
  return utcGuess - driftMs
}

/** Formats a POSIX ms instant in a given IANA timezone (falls back to UTC if invalid/missing). */
export function formatInTimeZone(
  ms: number,
  timeZone: string | undefined | null,
  opts: Intl.DateTimeFormatOptions,
  locale = 'es-AR',
): string {
  try {
    return new Date(ms).toLocaleString(locale, { ...opts, timeZone: timeZone || 'UTC' })
  } catch {
    return new Date(ms).toLocaleString(locale, { ...opts, timeZone: 'UTC' })
  }
}

/** UTC-based hour (0-23) of a POSIX ms instant in a given IANA timezone. */
export function hourInTimeZone(ms: number, timeZone: string | undefined | null): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', hourCycle: 'h23', hour: '2-digit' })
    return Number(dtf.format(new Date(ms))) % 24
  } catch {
    return new Date(ms).getUTCHours()
  }
}
