# Brand Service - Project Rules

## README Maintenance (MANDATORY)

**Every agent working in this repo MUST update README.md when making changes that affect any of the following:**

1. **API Endpoints** - Adding, removing, or changing any route in `src/routes/`. Update the corresponding table in the "API Endpoints" section.
2. **Database Schema** - Adding or removing tables/views in `src/db/schema.ts`. Update the "Database" section.
3. **Environment Variables** - Adding new env vars or changing existing ones. Update both `.env.example` and the "Environment Variables" section in README.
4. **Scripts** - Adding or changing scripts in `package.json`. Update the "Scripts" table.
5. **Dependencies** - Adding major new dependencies that change the tech stack. Update the "Tech Stack" section.
6. **Project Structure** - Adding new top-level directories or changing the source layout. Update "Project Structure".
7. **Authentication** - Changes to auth middleware or patterns. Update the "Authentication" section.
8. **CI/CD** - Changes to `.github/workflows/`. Update the "CI/CD" section.

### How to Update

- Keep the existing README structure and formatting
- Be concise - table rows for endpoints, bullet points for lists
- Don't add verbose descriptions - match the existing terse style
- If removing a feature, remove its README entry too

## Code Conventions

- TypeScript strict mode
- Functional patterns over classes
- Express.js routes in `src/routes/`
- Business logic in `src/services/`
- Drizzle ORM for database
- pnpm as package manager
- Vitest for testing

## Database Migrations

- After schema changes: `pnpm db:generate` then `pnpm db:migrate`
- See `.cursor/skills/neon-migrations/SKILL.md` for Neon-specific gotchas
