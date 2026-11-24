import request from 'supertest';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { findComparableActivities } from '../src/comparison.js';
import { createGarminClient } from '../src/garmin.js';

const query = { from: '2026-10-25', to: '2026-10-25', distanceKm: '10', targetHeartRate: '150' };
const filters = {
  from: query.from, to: query.to, distanceKm: 10, targetHeartRate: 150,
  distanceTolerancePercent: 10, heartRateToleranceBpm: 10,
};

const run = {
  activityId: 1, name: 'Run', startTimeGmt: '2026-10-25 12:00:00',
  isRunning: true, distance: 10_000, duration: 3_000, averageHeartRate: 150,
};

test('matches both inclusive tolerance boundaries and calculates pace', () => {
  const matches = findComparableActivities(filters, [
    { ...run, activityId: 2, distance: 11_000, averageHeartRate: 160 },
    { ...run, activityId: 1, distance: 9_000, duration: 2_700, averageHeartRate: 140, startTimeGmt: '2026-10-25 11:00:00' },
    { ...run, activityId: 3, distance: 8_999 },
    { ...run, activityId: 4, distance: 11_001 },
    { ...run, activityId: 5, averageHeartRate: 139.9 },
    { ...run, activityId: 6, averageHeartRate: 160.1 },
  ]);

  expect(matches.map(({ activityId }) => activityId)).toEqual([1, 2]);
  expect(matches[0]).toEqual({
    activityId: 1, date: '2026-10-25', name: 'Run', distanceKm: 9,
    durationSeconds: 2_700, averageHeartRate: 140, averagePaceSecondsPerKm: 300,
  });

  const exact = { ...filters, distanceTolerancePercent: 0, heartRateToleranceBpm: 0 };
  expect(findComparableActivities(exact, [run, { ...run, distance: 9_999 }, { ...run, averageHeartRate: 150.1 }]))
    .toHaveLength(1);
});

test('excludes non-running activities and missing or invalid metrics', () => {
  expect(findComparableActivities(filters, [
    { ...run, isRunning: false },
    { ...run, distance: undefined },
    { ...run, distance: 0 },
    { ...run, duration: undefined },
    { ...run, duration: -1 },
    { ...run, duration: Infinity },
    { ...run, averageHeartRate: undefined },
    { ...run, averageHeartRate: NaN },
    { ...run, averageHeartRate: 0 },
  ])).toEqual([]);
});

function mockedApp(...pages: Response[]) {
  const exp = Math.floor(Date.now() / 1_000) + 3_600;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const fetchGarmin = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(`header.${payload}.signature`));
  for (const page of pages) {
    fetchGarmin.mockResolvedValueOnce(page);
  }
  return { app: createApp(createGarminClient('test-only-key', fetchGarmin)), fetchGarmin };
}

test('reuses Garmin pagination and enforces exact Rome dates across the DST transition', async () => {
  const activity = {
    activityName: 'Trail run', activityType: { typeKey: 'trail_running', parentTypeId: 1 },
    distance: 10_000, duration: 3_000, averageHR: 150,
  };
  const cycling = { ...activity, activityType: { typeKey: 'cycling', parentTypeId: 17 } };
  const { app, fetchGarmin } = mockedApp(
    Response.json(Array.from({ length: 99 }, () => cycling)),
    Response.json([
      { ...activity, activityId: 3, startTimeGMT: '2026-10-25 22:59:59' },
      { ...activity, activityId: 4, startTimeGMT: '2026-10-25 23:00:00' },
      { ...activity, activityId: 2, startTimeGMT: '2026-10-24 22:00:00', startTimeLocal: '2026-10-24 18:00:00' },
      { ...activity, activityId: 1, startTimeGMT: '2026-10-24 21:59:59' },
    ]),
  );

  const result = await request(app).get('/api/comparison').query(query).expect(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.body).toEqual({
    filters,
    totalMatchingCount: 2,
    activities: [2, 3].map((activityId) => ({
      activityId, date: '2026-10-25', name: 'Trail run', distanceKm: 10,
      durationSeconds: 3_000, averageHeartRate: 150, averagePaceSecondsPerKm: 300,
    })),
  });
  expect(fetchGarmin).toHaveBeenCalledTimes(3);
  expect(fetchGarmin.mock.calls.slice(1).map(([url]) => {
    const search = new URL(String(url));
    expect(search.pathname).toBe('/activitylist-service/activities/search/activities');
    return Object.fromEntries(search.searchParams);
  })).toEqual([
    { start: '0', limit: '99', startDate: '2026-10-24', endDate: '2026-10-26' },
    { start: '99', limit: '99', startDate: '2026-10-24', endDate: '2026-10-26' },
  ]);
});

test('returns empty results and accepts a 90-day inclusive range', async () => {
  const { app, fetchGarmin } = mockedApp(Response.json([]));
  await request(app).get('/api/comparison').query({
    ...query, from: '2026-01-01', to: '2026-03-31', distanceTolerancePercent: '2.5', heartRateToleranceBpm: '0',
  }).expect(200, {
    filters: { ...filters, from: '2026-01-01', to: '2026-03-31', distanceTolerancePercent: 2.5, heartRateToleranceBpm: 0 },
    totalMatchingCount: 0,
    activities: [],
  });
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
});

test.each([
  { from: '' }, { from: '2026-02-30' }, { to: '2026-10-24' }, { to: '2026-10-25T00:00:00Z' },
  { from: '2026-01-01', to: '2026-04-01' },
  { distanceKm: '' }, { distanceKm: '0' }, { distanceKm: 'Infinity' }, { distanceKm: ['10', '11'] },
  { targetHeartRate: '' }, { targetHeartRate: '0' }, { targetHeartRate: '150.5' },
  { distanceTolerancePercent: '-1' }, { distanceTolerancePercent: '30.1' },
  { heartRateToleranceBpm: '1.5' }, { heartRateToleranceBpm: '31' },
])('rejects invalid query %j before contacting Garmin', async (invalid) => {
  const { app, fetchGarmin } = mockedApp();
  await request(app).get('/api/comparison').query({ ...query, ...invalid }).expect(400);
  expect(fetchGarmin).not.toHaveBeenCalled();
});

test('returns a sanitized Garmin rate limit error', async () => {
  const { app, fetchGarmin } = mockedApp(new Response('Upstream details', { status: 429 }));
  await request(app).get('/api/comparison').query(query).expect(429, {
    error: 'Garmin rate limit reached. Try again later.',
  });
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
});
