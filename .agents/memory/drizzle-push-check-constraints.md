---
name: drizzle push & check constraints
description: drizzle-kit push does not update modified CHECK constraints on existing tables
---

Changing a `check(...)` definition in a Drizzle schema and running `drizzle-kit push` (even `push --force`) reports "Changes applied" but leaves the old CHECK constraint in the database.

**Why:** discovered when extending `documents_one_parent` to allow a third parent column — inserts kept failing on the old constraint after a successful push.

Also: adding a UNIQUE constraint to an existing table makes `drizzle-kit push` prompt to *truncate* the table, which fails in non-interactive shells (and `--force` fails too). Create the constraint manually with drizzle's expected name (`<table>_<column>_unique`) so push then sees no changes; mirror it idempotently in `scripts/post-merge.sh`.

**How to apply:** after editing any `check()` in `lib/db/src/schema/*`, verify with `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='...'` and, if stale, `ALTER TABLE ... DROP CONSTRAINT ...; ADD CONSTRAINT ... CHECK (...)` manually (dev and prod).
