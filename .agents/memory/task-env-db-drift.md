---
name: drizzle push unusable in headless envs
description: drizzle-kit push prompts interactively and cannot run in non-TTY environments here.
---

`drizzle-kit push` prompts interactively ("create or rename", triggered by DB-only tables like session storage) and cannot run without a TTY.

**Why:** the dev/merge environments run commands non-interactively, so a prompt hangs or fails the run.

**How to apply:** schema changes must reach databases through idempotent, non-interactive means (idempotent migration scripts or `IF NOT EXISTS` DDL), never by relying on `drizzle-kit push` in automation.

**Update (Aug 2026):** post-merge.sh ends with non-interactive `drizzle-kit push --force` + idempotent seeding, which covers plain new tables; manual SQL is only needed for renames/data conversions that push would destroy.
