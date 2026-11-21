import express from 'express';
import { createGarminClient, GarminError } from './garmin.js';

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
      if (error instanceof GarminError && error.kind === 'not-configured') {
        response.status(503).json({ error: 'Garmin is not configured on the RunLab server.' });
      } else if (error instanceof GarminError && error.kind === 'rate-limited') {
        response.status(429).json({ error: 'Garmin rate limit reached. Try again later.' });
      } else {
        response.status(502).json({ error: 'Could not load activities from Garmin.' });
      }
    }
  });

  return app;
}
