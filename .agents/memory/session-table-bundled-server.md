---
name: session table on fresh DBs
description: connect-pg-simple createTableIfMissing fails in the esbuild-bundled API server; sessions silently break on a fresh database.
---

On a fresh database, every authenticated request 401s even after a 200 login. **Why:** the API server is bundled with esbuild, so connect-pg-simple's `createTableIfMissing` can't read its `table.sql` (ENOENT under `dist/`), session saves fail, and the store caches the failure.

**How to apply:** create the table manually, then restart the server (the failed-create state is cached in-process):

```sh
psql "$DATABASE_URL" -f node_modules/.pnpm/connect-pg-simple@10.0.0/node_modules/connect-pg-simple/table.sql
psql "$DATABASE_URL" -c 'ALTER TABLE "session" RENAME TO "user_sessions"'
```

Also note: generated `@workspace/api-zod` schemas throw zod v3 `ZodError`, while the error handler originally only caught `zod/v4` — it now catches both; keep it that way or body-validation failures become 500s.
