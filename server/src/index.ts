import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createGarminClient } from './garmin.js';

try {
  loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
    throw new Error('Could not load the RunLab server environment file');
  }
}

const app = createApp(createGarminClient(process.env.GARMIN_API_KEY?.trim()));
const host = '127.0.0.1';
const port = 3000;

app
  .listen(port, host, () => {
    console.log(`RunLab API listening at http://${host}:${port}`);
  })
  .on('error', (error) => {
    console.error('Could not start the RunLab API', error);
    process.exitCode = 1;
  });
