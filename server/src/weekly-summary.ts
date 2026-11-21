type Week = { weekStart: string; weekEnd: string };

type WeeklyActivity = {
  isRunning: boolean;
  startTimeGmt?: string;
  distance?: number;
  duration?: number;
};

const romeDay = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function romeDate(instant: Date): string {
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

function nonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function summarizeWeek(week: Week, activities: readonly WeeklyActivity[]) {
  let distanceMeters = 0;
  let durationSeconds = 0;
  let activityCount = 0;

  for (const activity of activities) {
    if (!activity.isRunning || !activity.startTimeGmt) {
      continue;
    }

    // Garmin returns GMT as YYYY-MM-DD HH:mm:ss without an offset suffix.
    const start = new Date(activity.startTimeGmt.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(start.getTime())) {
      continue;
    }
    const date = romeDate(start);
    if (date < week.weekStart || date > week.weekEnd) {
      continue;
    }

    activityCount += 1;
    distanceMeters += nonNegative(activity.distance);
    durationSeconds += nonNegative(activity.duration);
  }

  const totalDistanceKm = distanceMeters / 1_000;
  return {
    ...week,
    totalDistanceKm,
    totalDurationMinutes: durationSeconds / 60,
    activityCount,
    averagePaceSecondsPerKm: totalDistanceKm > 0 && durationSeconds > 0
      ? durationSeconds / totalDistanceKm
      : null,
  };
}
