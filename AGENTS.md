# RunLab — Agent Instructions

## Project Overview

RunLab is a full-stack running analytics application that transforms Garmin wearable data into performance insights, heart-rate zone analysis, activity comparisons, and AI-powered training recommendations.

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Styling: CSS
- Data Integration: Garmin Connect API
- AI Integration: Groq and Google Gemini
- Testing: Vitest

## Development Principles

- Prefer simple, maintainable solutions over unnecessary complexity.
- Use TypeScript with strict type checking.
- Keep business logic separate from API routes and UI components.
- Maintain clear separation between data integration, analytics, and AI services.
- Preserve provider independence in the AI integration layer.
- Avoid unnecessary dependencies.
- Do not introduce features outside the current task.

## Security and Data Privacy

- Never hardcode API keys, tokens, or credentials.
- Use environment variables for secrets.
- Never commit `.env` files or sensitive athlete data.
- Keep external API credentials server-side.
- Minimize personal and physiological data shared with external AI providers.
- Validate external API responses and AI-generated outputs.
- Never fabricate missing athlete metrics.

## Development Workflow

- Explain the proposed approach before implementation.
- Prefer incremental, focused changes.
- Explain significant architectural decisions.
- Add or update tests when modifying business logic.
- Preserve existing functionality and API contracts unless changes are explicitly required.
- Ask before introducing major architectural changes.
- Do not commit or push unless explicitly requested.

## Code Quality

- Use descriptive names and small, focused functions.
- Handle errors explicitly.
- Avoid using `any` unless justified.
- Maintain consistent UI patterns and responsive layouts.
- Keep documentation synchronized with implementation.

## Verification

Before completing a task, run the relevant verification commands:

- `npm test`
- `npm run typecheck`
- `npm run build`

Report verification results and any known limitations.
