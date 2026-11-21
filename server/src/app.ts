import express, { type Response } from 'express';
import { createGarminClient, GarminError } from './garmin.js';
import { getRomeWeek, shiftCalendarDate, summarizeWeek } from './weekly-summary.js';

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

  app.get('/api/weekly-summary', async (_request, response) => {
    response.set('Cache-Control', 'no-store');

    try {
      const week = getRomeWeek(new Date());
      // Garmin filters by the activity's local date, which can differ from Rome's.
      const activities = await garmin.getActivitiesInDateRange(
        shiftCalendarDate(week.weekStart, -1),
        shiftCalendarDate(week.weekEnd, 1),
      );
      response.json(summarizeWeek(week, activities));
    } catch (error) {
      sendGarminError(response, error);
    }
  });

  return app;
}
