---
name: generated query-param booleans
description: Why generated Zod query-param schemas mis-parse boolean flags, and how to handle them
---

Orval-generated Zod schemas type boolean query params as `zod.coerce.boolean()`.
`coerce.boolean()` follows JS truthiness: any non-empty string (including the
string `"false"`) coerces to `true`. So a filter like `?activeOnly=false` parsed
through the generated schema comes out `true` and inverts the user's intent.

**Why:** query-string values are always strings; `coerce.boolean("false") === true`.

**How to apply:** for boolean query params, do NOT trust the generated schema's
coercion. Parse manually in the route handler — treat only `"true"`/`"1"` as true
and `"false"`/`"0"` as false (see `artifacts/api-server/src/lib/params.ts`
`parseQueryBool`). This does not apply to request *body* booleans (real JSON
booleans), only to query strings.
