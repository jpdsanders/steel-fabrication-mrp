---
name: DB package rebuild pattern
description: After adding new schema files to lib/db, you must rebuild declarations before typechecking dependents.
---

# DB package rebuild pattern

## The rule
After adding new schema files to `lib/db/src/schema/` (and re-exporting them in `schema/index.ts`), run `tsc -p tsconfig.json` inside `lib/db/` before running typechecks on `@workspace/api-server` or any other dependent package.

**Why:** `lib/db` uses `composite: true` with `emitDeclarationOnly`. Downstream packages (api-server) consume the compiled `.d.ts` files from `lib/db/dist/`. Until you rebuild, the dist is stale and TypeScript sees the old schema — causing confusing "property X does not exist" errors even when the source is correct.

**How to apply:** Any time you add, rename, or remove a file in `lib/db/src/schema/`, run:
```bash
cd lib/db && npx tsc -p tsconfig.json
```
Then run the downstream typecheck. This is a one-off manual step; there is no watch mode or build script for the db package.
