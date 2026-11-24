import request from 'supertest';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createGarminClient } from '../src/garmin.js';
import { getTrainingHistoryWeeks, summarizeTrainingHistory } from '../src/training-history.js';

const now = new Date('2026-11-02T00:00:00Z');
const run = { isRunning: true, distance: 5_000, duration: 1_800, averageHeartRate: 140 };

test('returns six empty completed weeks in chronological order across New Year', () => {
  const weeks = getTrainingHistoryWeeks(new Date('2027-01-03T23:00:00Z'));
  const result = summarizeTrainingHistory(weeks, []);
  expect(result.weeks.map(({ weekStart, weekEnd }) => [weekStart, weekEnd])).toEqual([
    ['2026-11-23', '2026-11-29'], ['2026-11-30', '2026-12-06'], ['2026-12-07', '2026-12-13'],
    ['2026-12-14', '2026-12-20'], ['2026-12-21', '2026-12-27'], ['2026-12-28', '2027-01-03'],
  ]);
  expect(result.summary).toMatchObject({ completedWeeksAnalyzed: 6, totalActivities: 0,
    weeksWithNoRunningActivities: 6, averageWeeklyDistanceKm: 0, dataQuality: { status: 'complete' } });
});

test('assigns runs across Rome DST boundaries and aggregates only available metrics', () => {
  const result = summarizeTrainingHistory(getTrainingHistoryWeeks(now), [
    { ...run, startTimeGmt: '2026-10-25 22:59:59', heartRateZoneSeconds: { z1: 0, z2: 10.25 } },
    { ...run, startTimeGmt: '2026-10-25 23:00:00', heartRateZoneSeconds: { z2: -1 } },
    { ...run, startTimeGmt: '2026-10-28 12:00:00', distance: 10_000, duration: 3_000, averageHeartRate: 160 },
    { ...run, startTimeGmt: '2026-10-29 12:00:00', distance: Infinity, duration: -3, averageHeartRate: NaN },
    { ...run, startTimeGmt: '2026-11-01 22:00:00', distance: 2_000, duration: undefined, averageHeartRate: 180 },
    { ...run, startTimeGmt: '2026-11-01 23:00:00' },
    { ...run, startTimeGmt: '2026-10-28 12:00:00', isRunning: false },
  ]);

  expect(result.weeks[4].heartRateZones.seconds).toEqual({ z1: 0, z2: 10.25, z3: null, z4: null, z5: null });
  expect(result.weeks[5]).toMatchObject({
    weekStart: '2026-10-26', weekEnd: '2026-11-01', activityCount: 4,
    totalDistanceKm: 17, totalDurationSeconds: 4_800, averagePaceSecondsPerKm: 320,
    longestRunDistanceKm: 10, averageHeartRateBpm: 152.5,
    coverage: { activitiesWithDistance: 3, activitiesWithPace: 2, activitiesWithHeartRate: 2 },
    heartRateZones: { seconds: { z1: null, z2: null }, coverage: { activitiesWithZoneData: 0 } },
  });
  expect(result.summary).toMatchObject({
    totalActivities: 5, totalDistanceKm: 22, averageWeeklyDistanceKm: 22 / 6,
    averageRunsPerWeek: 5 / 6, mostRecentRunningActivityDate: '2026-11-01', weeksWithNoRunningActivities: 4,
  });
});

test('marks undateable runs and unclassified activities as partial history', () => {
  const result = summarizeTrainingHistory(getTrainingHistoryWeeks(now), [
    { ...run, startTimeGmt: '2026-10-32 12:00:00' },
    { ...run, isRunning: false, hasActivityType: false },
  ]);
  expect(result.summary.dataQuality).toEqual({
    status: 'partial', runningActivitiesWithoutDate: 1, unclassifiedActivities: 1,
  });
});

function appWithPages(...pages: Response[]) {
  const expiration = Math.floor(Date.now() / 1_000) + 3_600;
  const payload = Buffer.from(JSON.stringify({ exp: expiration })).toString('base64url');
  const fetchGarmin = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`header.${payload}.signature`));
  for (const page of pages) fetchGarmin.mockResolvedValueOnce(page);
  return { app: createApp(createGarminClient('test-only-key', fetchGarmin)), fetchGarmin };
}

const fullPage = Array.from({ length: 99 }, (_, index) => ({
  activityId: index + 1, activityType: { typeKey: 'cycling' },
}));

test('fetches a single padded range with no duplicate searches and accepts malformed fields', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  try {
    const { app, fetchGarmin } = appWithPages(Response.json(fullPage), Response.json([
      null, { activityId: 100, activityType: { parentTypeId: 1 }, startTimeGMT: '2026-10-31 09:00:00',
        distance: 5_000, duration: 1_800, averageHR: 'invalid' },
    ]));
    const { body } = await request(app).get('/api/training-history').expect(200);
    expect(body.summary).toMatchObject({ totalActivities: 1, totalDistanceKm: 5,
      dataQuality: { status: 'partial', unclassifiedActivities: 1 } });
    expect(fetchGarmin).toHaveBeenCalledTimes(3);
    expect(fetchGarmin.mock.calls.slice(1).map(([url]) => Object.fromEntries(new URL(String(url)).searchParams)))
      .toEqual([
        { start: '0', limit: '99', startDate: '2026-09-20', endDate: '2026-11-02' },
        { start: '99', limit: '99', startDate: '2026-09-20', endDate: '2026-11-02' },
      ]);
  } finally {
    vi.useRealTimers();
  }
});

test.each([
  ['upstream failure', () => new Response(null, { status: 500 })],
  ['partial HTTP response', () => Response.json([], { status: 206 })],
  ['non-array page', () => Response.json({ activities: [] })],
  ['overlapping page', () => Response.json([fullPage[0]])],
  ['repeated page', () => Response.json(fullPage)],
] as const)('rejects incomplete history after %s', async (_label, makePage) => {
  const { app, fetchGarmin } = appWithPages(Response.json(fullPage), makePage());
  await request(app).get('/api/training-history').expect(502, { error: 'Could not load activities from Garmin.' });
  expect(fetchGarmin).toHaveBeenCalledTimes(3);
});
