/**
 * Dependency-free civil-date arithmetic for date and deadline checks.
 *
 * Chinese regulatory deadlines are written in calendar days, working days and
 * calendar-month cycles, so every plugin in this family needs the same three
 * primitives. Everything here is wall-clock arithmetic on `YYYY-MM-DD` strings
 * with no time-zone conversion: a timestamp written in a record means the local
 * time the clinician or the site wrote down, and shifting it into UTC would
 * change the answer to "was this within 6 hours".
 */

/** A wall-clock timestamp with the precision actually present in the source. */
export interface WallClock {
  /** `YYYY-MM-DD`. */
  date: string
  /** `HH:mm`, or `00:00` when the source carried no time. */
  time: string
  /** True when the source carried a time component. */
  hasTime: boolean
  /** Minutes since midnight. */
  minutes: number
}

const DATE_PATTERN = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** True when the three components form a real calendar date. */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

/**
 * Parse a wall-clock timestamp.
 * @param raw - text such as `2026-03-15 08:30`, `2026-03-15T08:30:00` or `2026/3/5`.
 * @returns the parsed value, or `undefined` when the text is not a date.
 */
export function parseWallClock(raw: string): WallClock | undefined {
  const text = raw.trim().replace(/[T\s]+/, ' ')
  if (text === '') return undefined
  const [datePart, timePart] = text.split(' ', 2)
  const dateMatch = DATE_PATTERN.exec(datePart ?? '')
  if (dateMatch === null) return undefined
  const year = Number.parseInt(dateMatch[1] as string, 10)
  const month = Number.parseInt(dateMatch[2] as string, 10)
  const day = Number.parseInt(dateMatch[3] as string, 10)
  if (!isRealDate(year, month, day)) return undefined
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`
  if (timePart === undefined || timePart === '') return { date, time: '00:00', hasTime: false, minutes: 0 }
  const timeMatch = TIME_PATTERN.exec(timePart)
  if (timeMatch === null) return undefined
  const hour = Number.parseInt(timeMatch[1] as string, 10)
  const minute = Number.parseInt(timeMatch[2] as string, 10)
  if (hour > 23 || minute > 59) return undefined
  return { date, time: `${pad(hour)}:${pad(minute)}`, hasTime: true, minutes: hour * 60 + minute }
}

/** Day number for a `YYYY-MM-DD` string (days since the Unix epoch). */
export function dayNumber(date: string): number {
  const match = DATE_PATTERN.exec(date)
  if (match === null) throw new Error(`dayNumber: bad date "${date}"`)
  const year = Number.parseInt(match[1] as string, 10)
  const month = Number.parseInt(match[2] as string, 10)
  const day = Number.parseInt(match[3] as string, 10)
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** Render a day number back to `YYYY-MM-DD`. */
export function fromDayNumber(value: number): string {
  const probe = new Date(value * 86_400_000)
  return `${pad(probe.getUTCFullYear(), 4)}-${pad(probe.getUTCMonth() + 1)}-${pad(probe.getUTCDate())}`
}

/** Shift a `YYYY-MM-DD` date by a whole number of days. */
export function addDays(date: string, delta: number): string {
  return fromDayNumber(dayNumber(date) + delta)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

/** Minute-precision instant for a parsed wall clock. */
export function instant(wall: WallClock): number {
  return dayNumber(wall.date) * 1440 + wall.minutes
}

/** Difference in minutes between two parsed wall clocks. */
export function diffMinutes(from: WallClock, to: WallClock): number {
  return instant(to) - instant(from)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  // 1970-01-01 was a Thursday (4).
  return (((dayNumber(date) + 4) % 7) + 7) % 7
}

/**
 * Expand a closed date range into every calendar day, inclusive.
 * @param from - `YYYY-MM-DD` start.
 * @param to - `YYYY-MM-DD` end.
 * @returns one entry per calendar day.
 */
export function eachDay(from: string, to: string): string[] {
  const start = dayNumber(from)
  const end = dayNumber(to)
  if (end < start) return []
  const out: string[] = []
  for (let value = start; value <= end; value++) out.push(fromDayNumber(value))
  return out
}

/**
 * Format a minute duration as `Xh Ym` / `Ym`.
 * @param minutes - signed duration in minutes.
 * @returns human-readable magnitude with a sign prefix.
 */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const magnitude = Math.abs(minutes)
  const hours = Math.floor(magnitude / 60)
  const rest = magnitude % 60
  if (hours === 0) return `${sign}${rest}分钟`
  if (rest === 0) return `${sign}${hours}小时`
  return `${sign}${hours}小时${rest}分钟`
}
