# RunLab

RunLab is a personal running analytics application. This bootstrap connects a React client to an Express health endpoint.

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

## Testing and building

```sh
npm test
npm run typecheck
npm run build
```

The backend test uses Vitest and Supertest to verify the HTTP status and JSON response from `GET /api/health`. The type check covers both workspaces, including the backend test. The build writes browser assets to `client/dist` and server JavaScript to `server/dist`.

Run the compiled API with `npm run start --workspace=server`. The Vite proxy runs during development. When serving the built frontend, configure the host to route `/api` to the Express server on the same origin.
