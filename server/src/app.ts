import express, { type Response } from 'express';
import { findComparableActivities, parseComparisonFilters } from './comparison.js';
import { createGarminClient, GarminError } from './garmin.js';
import { getRomeWeek, shiftCalendarDate, weekFromMonday } from './rome-calendar.js';
import { summarizeWeek, compareWeeks } from './weekly-summary.js';

function sendGarminError(response: Response, error: unknown) {
  if (error instanceof GarminError && error.kind === 'not-configured') {
    response.status(503).json({ error: 'Garmin is not configured on the RunLab server.' });
  } else if (error instanceof GarminError && error.kind === 'rate-limited') {
    response.status(429).json({ error: 'Garmin rate limit reached. Try again later.' });
  } else {
    response.status(502).json({ error: 'Could not load activities from Garmin.' });
  }
}

export function createApp(garmin = createGarminClient()) {
  const app = express();

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', app: 'RunLab' });
  });

  app.get('/api/activities', async (_request, response) => {
    response.set('Cache-Control', 'no-store');

    try {
      response.json(await garmin.getActivities());
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  app.get('/api/weekly-summary', async (request, response) => {
    response.set('Cache-Control', 'no-store');

    const { weekStart } = request.query;
    const week = weekStart === undefined ? getRomeWeek(new Date()) : weekFromMonday(weekStart);
    if (!week) {
      response.status(400).json({ error: 'weekStart must be a Monday in YYYY-MM-DD format.' });
      return;
    }

    try {
      const previousWeek = {
        weekStart: shiftCalendarDate(week.weekStart, -7),
        weekEnd: shiftCalendarDate(week.weekStart, -1),
      };
      // Garmin filters by the activity's local date, which can differ from Rome's.
      const activities = await garmin.getActivitiesInDateRange(
        shiftCalendarDate(previousWeek.weekStart, -1),
        shiftCalendarDate(week.weekEnd, 1),
      );
      const current = summarizeWeek(week, activities);
      const previous = summarizeWeek(previousWeek, activities);
      response.json({ ...current, previousWeek: previous, comparison: compareWeeks(current, previous) });
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  app.get('/api/comparison', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const result = parseComparisonFilters(request.query);
    if ('error' in result) {
      response.status(400).json({ error: result.error });
      return;
    }

    const { filters } = result;
    try {
      // Garmin filters by activity-local dates. The matcher enforces the exact Rome dates.
      const candidates = await garmin.getActivitiesInDateRange(
        shiftCalendarDate(filters.from, -1),
        shiftCalendarDate(filters.to, 1),
      );
      const activities = findComparableActivities(filters, candidates);
      response.json({ filters, totalMatchingCount: activities.length, activities });
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  return app;
}
