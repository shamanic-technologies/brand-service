---
name: neon-migrations
description: Standards for database migrations with Drizzle ORM and Neon PostgreSQL. Use when creating migrations, modifying database schema, or troubleshooting migration issues.
---

# Neon Database Migrations with Drizzle

## Migration Tool

This repo uses **Drizzle ORM** for schema and migrations.

## Project Structure

```
brand-service/
├── .env                   # BRAND_SERVICE_DATABASE_URL
├── drizzle.config.ts      # Drizzle configuration
├── drizzle/               # Migration files (generated)
│   ├── *.sql              # SQL migrations
│   ├── schema.ts          # Schema pulled from DB (reference)
│   ├── relations.ts       # Relations pulled from DB
│   └── meta/
│       └── _journal.json  # Migration tracking
└── src/db/
    └── schema.ts          # Schema used in code (copy from drizzle/)
```

## Commands

```bash
# Pull schema from existing database (introspection)
pnpm db:pull

# Generate migration from schema changes
pnpm db:generate

# Run pending migrations  
pnpm db:migrate

# Push schema directly (dev only, bypasses migration files)
pnpm db:push

# Open Drizzle Studio (visual DB browser)
pnpm db:studio
```

## Recommended Workflow

### For new projects or after major DB changes:

```bash
# 1. Pull actual schema from database
pnpm db:pull

# 2. Copy to src for use in code
cp drizzle/schema.ts src/db/schema.ts

# 3. Future changes: edit src/db/schema.ts, then generate migration
pnpm db:generate
```

### For schema changes:

```bash
# 1. Edit src/db/schema.ts
# 2. Generate migration
pnpm db:generate
# 3. Review generated SQL in drizzle/*.sql
# 4. Run migration
pnpm db:migrate
```

## CRITICAL: Known Issues

### drizzle-kit migrate silently fails
`drizzle-kit migrate` may report "success" without actually executing SQL.
**Always verify with Neon MCP** after running migrations:

```
get_database_tables / run_sql to verify changes
```

### Statement Breakpoints
Drizzle SQL files use `--> statement-breakpoint` between statements:

```sql
CREATE TABLE "foo" (...);
--> statement-breakpoint
ALTER TABLE "bar" ADD COLUMN ...;
```

### Complex Migrations (renames, etc.)
For renames and complex operations, **run SQL manually via Neon MCP**:

```
run_sql: ALTER TABLE "old_name" RENAME TO "new_name"
```

Drizzle's auto-generated migrations often use DROP+CREATE instead of RENAME.

## Environment Variables

Create `.env` file:

```
BRAND_SERVICE_DATABASE_URL=postgresql://...
```

## Neon MCP Usage

**Always use Neon MCP to:**
- Verify migration results: `get_database_tables`, `run_sql`
- Run complex/rename migrations manually
- Debug schema issues

**Don't use for:**
- Routine migrations (try CLI first)

## Phased Migrations

For large changes (like org→brand rename):

1. **Phase 1**: Table/column renames → Run manually via Neon MCP
2. **Phase 2**: Function/view updates → Separate migration
3. **Phase 3**: Enum updates → Separate migration

After manual changes, run `db:pull` to sync schema.ts with actual DB state.
