# RunLab

RunLab is a personal running analytics application. The React page shows backend health and the five most recent Garmin Connect activities.

## Installation

Use Node.js 24 or newer with npm. Install dependencies for both workspaces from the repository root.

```sh
npm ci
```

## Development

```sh
npm run dev
```

Open http://127.0.0.1:5173. Vite forwards requests under `/api` to Express on http://127.0.0.1:3000. The page shows **Backend connected** when the health check succeeds and an error message if it fails. Keep ports 5173 and 3000 available for these processes.

### Local Garmin API key

Create a personal API key in Garmin Connect using the [Garmin Personal API instructions](https://developer.garmin.com/gc-developer-program/personal/personal-api/). From the repository root, copy the template:

```sh
cp -n server/.env.example server/.env
```

Open `server/.env` in your editor and replace the `GARMIN_API_KEY` placeholder with your personal key. Keep the key in the Git-ignored file. Start or restart `npm run dev`, then load http://127.0.0.1:5173 to see your activities. The backend exchanges the key for a short-lived token and keeps that token in memory. The health check works without a Garmin key.

## Testing and building

```sh
npm test
npm run typecheck
npm run build
```

The backend tests use Vitest and Supertest to verify `GET /api/health` and `GET /api/activities`. Garmin requests are mocked. The type check covers both workspaces, including the backend tests. The build writes browser assets to `client/dist` and server JavaScript to `server/dist`.

Run the compiled API with `npm run start --workspace=server`. The Vite proxy runs during development. When serving the built frontend, configure the host to route `/api` to the Express server on the same origin.
