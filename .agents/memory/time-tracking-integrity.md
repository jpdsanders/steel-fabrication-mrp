---
name: time-tracking integrity rules
description: Invariants the MRP API must enforce on time entries and clock-in
---

Core data-integrity rules enforced in `artifacts/api-server/src/routes/time.ts`.
These are business invariants, not derivable from the schema alone:

- **Stage must belong to the entry's job.** On both create and update of a time
  entry, validate `stageId` links to the same `jobId`; never accept a stage from a
  different job (would create cross-job labor rows).
- **`clockOut >= clockIn`.** Reject inverted/negative intervals with 400 on create
  and update. Do NOT rely on the duration helper to clamp negatives to 0 — that
  silently masks bad data and undercounts labor in rollups.
- **Clock-in eligibility.** Reject clock-in on jobs that are `complete`/`closed`
  and on stages that are `complete`. (Kiosk still allows `not_started`/`in_progress`
  stages so a worker can begin the next stage.)
- **One open punch per employee.** Reject clock-in if the employee already has an
  entry with null `clockOut`.

**Why:** `actualHours` is a *derived* rollup (summed completed-entry durations); any
bad interval or mislinked stage silently corrupts dashboard/job hour totals with no
error surfaced.

**How to apply:** whenever adding/editing time-entry write paths, re-check these
four invariants. Also validate numeric path params (see `lib/params.ts`
`parseIntParam`) so non-numeric IDs return 400 instead of hitting the DB.
