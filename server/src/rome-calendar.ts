export type Week = { weekStart: string; weekEnd: string };

const romeDay = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function romeDate(instant: Date): string {
  const parts = romeDay.formatToParts(instant);
  const get = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Use UTC purely for date arithmetic on already-resolved Rome calendar dates.
export function shiftCalendarDate(date: string, days: number): string {
  const calendarDay = new Date(date);
  calendarDay.setUTCDate(calendarDay.getUTCDate() + days);
  return calendarDay.toISOString().slice(0, 10);
}

export function getRomeWeek(now: Date): Week {
  const today = romeDate(now);
  const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const weekStart = shiftCalendarDate(today, -daysSinceMonday);
  return { weekStart, weekEnd: shiftCalendarDate(weekStart, 6) };
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function weekFromMonday(value: unknown): Week | undefined {
  if (!isCalendarDate(value) || new Date(value).getUTCDay() !== 1) {
    return undefined;
  }
  return { weekStart: value, weekEnd: shiftCalendarDate(value, 6) };
}
