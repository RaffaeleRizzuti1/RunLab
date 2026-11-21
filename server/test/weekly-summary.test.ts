import request from 'supertest';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createGarminClient } from '../src/garmin.js';
import { getRomeWeek } from '../src/rome-calendar.js';
import { compareWeeks, summarizeWeek } from '../src/weekly-summary.js';

const week = { weekStart: '2026-10-19', weekEnd: '2026-10-25' };
const emptyZones = {
  seconds: { z1: null, z2: null, z3: null, z4: null, z5: null },
  coverage: { activitiesWithZoneData: 0, activitiesWithCompleteZoneData: 0 },
};
const emptySummary = {
  ...week,
  totalDistanceKm: 0,
  totalDurationMinutes: 0,
  activityCount: 0,
  averagePaceSecondsPerKm: null,
  heartRateZones: emptyZones,
};

test('uses Monday through Sunday in Rome, even when UTC is still on Sunday', () => {
  expect(getRomeWeek(new Date('2026-10-18T21:59:59Z'))).toEqual({
    weekStart: '2026-10-12', weekEnd: '2026-10-18',
  });
  expect(getRomeWeek(new Date('2026-10-18T22:00:00Z'))).toEqual(week);
  expect(getRomeWeek(new Date('2026-10-25T23:00:00Z'))).toEqual({
    weekStart: '2026-10-26', weekEnd: '2026-11-01',
  });
});

test('returns zeros and no pace for empty weeks or non-running activities', () => {
  expect(summarizeWeek(week, [])).toEqual(emptySummary);
  expect(summarizeWeek(week, [
    {
      startTimeGmt: '2026-10-21 12:00:00', isRunning: false, distance: 15_000, duration: 3_000,
      heartRateZoneSeconds: { z1: 300 },
    },
  ])).toEqual(emptySummary);
});

test('sums fractional zone seconds and distinguishes zero, missing and invalid values', () => {
  const run = { isRunning: true, startTimeGmt: '2026-10-21 12:00:00' };
  const activities = [
    { ...run, heartRateZoneSeconds: { z1: 0, z2: 10.125, z3: -5, z4: Infinity, z5: '4' } },
    { ...run, heartRateZoneSeconds: { z2: 0.375, z3: null, z4: NaN } },
    run,
  ];

  expect(summarizeWeek(week, activities).heartRateZones).toEqual({
    seconds: { z1: 0, z2: 10.5, z3: null, z4: null, z5: null },
    coverage: { activitiesWithZoneData: 2, activitiesWithCompleteZoneData: 0 },
  });
  expect(summarizeWeek(week, [
    ...activities, { ...run, heartRateZoneSeconds: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 } },
  ]).heartRateZones).toEqual({
    seconds: { z1: 0, z2: 10.5, z3: 0, z4: 0, z5: 0 },
    coverage: { activitiesWithZoneData: 3, activitiesWithCompleteZoneData: 1 },
  });
});

test('compares percentages, count and pace in both directions', () => {
  const previous = {
    ...emptySummary,
    totalDistanceKm: 10,
    totalDurationMinutes: 60,
    activityCount: 2,
    averagePaceSecondsPerKm: 360,
  };
  const current = {
    ...previous,
    totalDistanceKm: 20,
    totalDurationMinutes: 90,
    activityCount: 3,
    averagePaceSecondsPerKm: 270,
  };
  expect(compareWeeks(current, previous)).toEqual({
    distanceChangePercent: 100,
    durationChangePercent: 50,
    activityCountChange: 1,
    paceChangeSecondsPerKm: -90,
  });
  const reverse = compareWeeks(previous, current);
  expect(reverse.distanceChangePercent).toBe(-50);
  expect(reverse.durationChangePercent).toBeCloseTo(-100 / 3);
  expect(reverse.activityCountChange).toBe(-1);
  expect(reverse.paceChangeSecondsPerKm).toBe(90);
  expect(compareWeeks(current, current)).toEqual({
    distanceChangePercent: 0,
    durationChangePercent: 0,
    activityCountChange: 0,
    paceChangeSecondsPerKm: 0,
  });
});

test('distinguishes an empty baseline from a decrease to zero', () => {
  const active = {
    ...emptySummary,
    totalDistanceKm: 5,
    totalDurationMinutes: 25,
    activityCount: 1,
    averagePaceSecondsPerKm: 300,
  };
  const noBaseline = {
    distanceChangePercent: null,
    durationChangePercent: null,
    activityCountChange: 0,
    paceChangeSecondsPerKm: null,
  };
  expect(compareWeeks(emptySummary, emptySummary)).toEqual(noBaseline);
  expect(compareWeeks(active, emptySummary)).toEqual({ ...noBaseline, activityCountChange: 1 });
  expect(compareWeeks(emptySummary, active)).toEqual({
    distanceChangePercent: -100,
    durationChangePercent: -100,
    activityCountChange: -1,
    paceChangeSecondsPerKm: null,
  });
});

test('assigns runs by start time across both week boundaries and the DST change', () => {
  const run = { isRunning: true, distance: 5_000, duration: 1_500 };
  expect(summarizeWeek(week, [
    { ...run, startTimeGmt: '2026-10-18 21:59:59' },
    { ...run, startTimeGmt: '2026-10-18 22:00:00' },
    { ...run, startTimeGmt: '2026-10-25 22:59:59', distance: 10_000, duration: 3_300 },
    { ...run, startTimeGmt: '2026-10-25 23:00:00' },
    { ...run, startTimeGmt: 'invalid' },
  ])).toEqual({
    ...week,
    totalDistanceKm: 15,
    totalDurationMinutes: 80,
    activityCount: 2,
    averagePaceSecondsPerKm: 320,
    heartRateZones: emptyZones,
  });
});

test('paginates Garmin date filters and includes running subtypes from later pages', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
  try {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() / 1_000 + 3_600 })).toString('base64url');
    const cycling = {
      activityType: { typeKey: 'cycling', parentTypeId: 17 },
      startTimeGMT: '2026-10-21 12:00:00',
      distance: 30_000,
      duration: 3_600,
    };
    const run = {
      activityType: { typeKey: 'trail_running', parentTypeId: 1 },
      startTimeGMT: '2026-10-18 22:05:00',
      startTimeLocal: '2026-10-18 18:05:00',
      distance: 4_000,
      duration: 1_200,
      hrTimeInZone_1: 0,
      hrTimeInZone_2: 123.125,
      hrTimeInZone_3: -3,
    };
    const fetchGarmin = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(`header.${payload}.signature`))
      .mockResolvedValueOnce(Response.json(Array.from({ length: 99 }, () => cycling)))
      .mockResolvedValueOnce(Response.json([run]));
    const app = createApp(createGarminClient('test-only-key', fetchGarmin));

    const result = await request(app).get('/api/weekly-summary').expect(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual({
      ...week,
      totalDistanceKm: 4,
      totalDurationMinutes: 20,
      activityCount: 1,
      averagePaceSecondsPerKm: 300,
      heartRateZones: {
        seconds: { ...emptyZones.seconds, z1: 0, z2: 123.125 },
        coverage: { activitiesWithZoneData: 1, activitiesWithCompleteZoneData: 0 },
      },
      previousWeek: { ...emptySummary, weekStart: '2026-10-12', weekEnd: '2026-10-18' },
      comparison: {
        distanceChangePercent: null,
        durationChangePercent: null,
        activityCountChange: 1,
        paceChangeSecondsPerKm: null,
      },
    });

    const queries = fetchGarmin.mock.calls.slice(1).map(([url]) =>
      Object.fromEntries(new URL(String(url)).searchParams));
    expect(queries).toEqual([
      { start: '0', limit: '99', startDate: '2026-10-11', endDate: '2026-10-26' },
      { start: '99', limit: '99', startDate: '2026-10-11', endDate: '2026-10-26' },
    ]);
    expect(fetchGarmin).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

test('returns a sanitized error if Garmin rate-limits the summary request', async () => {
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('Upstream details', { status: 429 }));
  const app = createApp(createGarminClient('test-only-key', fetchGarmin));

  await request(app).get('/api/weekly-summary').expect(429, {
    error: 'Garmin rate limit reached. Try again later.',
  });
});

test.each([
  '2026-02-30',
  '2025-02-29',
  '2026-1-05',
  '2026-01-05T00:00:00Z',
  '2026-01-06',
  '2026-01-04',
  '',
])('rejects invalid or non-Monday weekStart %j before contacting Garmin', async (weekStart) => {
  const fetchGarmin = vi.fn<typeof fetch>();
  const app = createApp(createGarminClient('test-only-key', fetchGarmin));

  await request(app).get('/api/weekly-summary').query({ weekStart }).expect(400, {
    error: 'weekStart must be a Monday in YYYY-MM-DD format.',
  });
  expect(fetchGarmin).not.toHaveBeenCalled();
});

test('rejects repeated weekStart parameters', async () => {
  await request(createApp())
    .get('/api/weekly-summary?weekStart=2025-12-29&weekStart=2026-01-05')
    .expect(400);
});

test('summarizes a requested week spanning New Year using Rome start dates', async () => {
  const expiration = Math.floor(Date.now() / 1_000) + 3_600;
  const payload = Buffer.from(JSON.stringify({ exp: expiration })).toString('base64url');
  const run = { activityType: { typeKey: 'running' }, distance: 5_000, duration: 1_500 };
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`header.${payload}.signature`))
    .mockResolvedValueOnce(Response.json([
      { ...run, startTimeGMT: '2025-12-28 23:00:00' },
      { ...run, startTimeGMT: '2025-12-28 22:59:59', duration: 1_800 },
      { ...run, startTimeGMT: '2026-01-01 10:00:00' },
      { ...run, startTimeGMT: '2026-01-04 23:00:00' },
    ]));
  const app = createApp(createGarminClient('test-only-key', fetchGarmin));

  await request(app).get('/api/weekly-summary').query({ weekStart: '2025-12-29' }).expect(200, {
    weekStart: '2025-12-29',
    weekEnd: '2026-01-04',
    totalDistanceKm: 10,
    totalDurationMinutes: 50,
    activityCount: 2,
    averagePaceSecondsPerKm: 300,
    heartRateZones: emptyZones,
    previousWeek: {
      weekStart: '2025-12-22',
      weekEnd: '2025-12-28',
      totalDistanceKm: 5,
      totalDurationMinutes: 30,
      activityCount: 1,
      averagePaceSecondsPerKm: 360,
      heartRateZones: emptyZones,
    },
    comparison: {
      distanceChangePercent: 100,
      durationChangePercent: (50 - 30) / 30 * 100,
      activityCountChange: 1,
      paceChangeSecondsPerKm: -60,
    },
  });
  const search = new URL(String(fetchGarmin.mock.calls[1][0]));
  expect(fetchGarmin).toHaveBeenCalledTimes(2);
  expect(search.searchParams.get('startDate')).toBe('2025-12-21');
  expect(search.searchParams.get('endDate')).toBe('2026-01-05');
});

test('splits consecutive weeks at Rome midnight after the DST change', async () => {
  const expiration = Math.floor(Date.now() / 1_000) + 3_600;
  const payload = Buffer.from(JSON.stringify({ exp: expiration })).toString('base64url');
  const run = { activityType: { typeKey: 'running' }, duration: 1_500 };
  const fetchGarmin = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(`header.${payload}.signature`))
    .mockResolvedValueOnce(Response.json([
      { ...run, startTimeGMT: '2026-10-18 21:59:59', distance: 5_000, hrTimeInZone_2: 100 },
      { ...run, startTimeGMT: '2026-10-18 22:00:00', distance: 5_000, hrTimeInZone_2: 10.25 },
      { ...run, startTimeGMT: '2026-10-25 22:59:59', distance: 5_000, hrTimeInZone_2: 20 },
      { ...run, startTimeGMT: '2026-10-25 23:00:00', distance: 5_000, hrTimeInZone_2: 30.5 },
    ]));
  const app = createApp(createGarminClient('test-only-key', fetchGarmin));

  const { body } = await request(app).get('/api/weekly-summary').query({ weekStart: '2026-10-26' }).expect(200);
  expect(body.activityCount).toBe(1);
  expect(body.previousWeek.activityCount).toBe(2);
  expect(body.heartRateZones).toEqual({
    seconds: { ...emptyZones.seconds, z2: 30.5 },
    coverage: { activitiesWithZoneData: 1, activitiesWithCompleteZoneData: 0 },
  });
  expect(body.previousWeek.heartRateZones).toEqual({
    seconds: { ...emptyZones.seconds, z2: 30.25 },
    coverage: { activitiesWithZoneData: 2, activitiesWithCompleteZoneData: 0 },
  });
  expect(body.comparison).toEqual({
    distanceChangePercent: -50,
    durationChangePercent: -50,
    activityCountChange: -1,
    paceChangeSecondsPerKm: 0,
  });
});
