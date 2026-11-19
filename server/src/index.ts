import { app } from './app.js';

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
