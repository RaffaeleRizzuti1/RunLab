
# RunLab — Agent Instructions

## Project overview
RunLab is a personal running analytics web application focused on running performance and Zone 2 heart-rate analysis.

## Tech stack
- Frontend: React + TypeScript + Vite
- Backend: Node.js + TypeScript
- Database: PostgreSQL
- Styling: Tailwind CSS
- Testing: Vitest

## Development principles
- Prefer simple, maintainable solutions over unnecessary complexity.
- Use TypeScript with strict type checking.
- Keep business logic separate from API routes and UI components.
- Avoid unnecessary dependencies.
- Never hardcode API keys, tokens, or credentials.
- Use environment variables for secrets.
- Do not introduce features outside the current task.
      
## Working with the developer
- Before implementing a task, explain the proposed approach.
- Implement one small feature at a time.
- Explain important architectural decisions.
- Add tests for business logic.
- Run relevant tests after changes.
- Do not create Git commits unless explicitly requested.
- Ask before introducing major architectural changes.

## Code quality
- Use descriptive names.
- Prefer small, focused functions.
- Handle errors explicitly.
- Avoid using `any` unless justified.
- Keep the README updated when setup instructions change.
