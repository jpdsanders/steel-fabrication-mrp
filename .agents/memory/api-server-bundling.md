---
name: api-server bundling & codegen ordering
description: Durable lessons about esbuild bundling limits and Orval zod array-schema ordering
---
- Keep pdfkit (and similar font/native-stack packages) in the api-server build's `external` list; bundling them fails at runtime.
- Session auto-table-creation (connect-pg-simple `createTableIfMissing`) does not work under the bundled build and caches its failure, making logins look successful while every request 401s. **Why:** the failure is silent and masquerades as an auth bug. **How to apply:** never rely on auto-creation; ensure the session table exists.
- Orval's zod output can emit `zod.array(XItem)` before `XItem` is declared (TDZ crash) when list responses are inline `type: array` in path definitions. **How to apply:** declare list responses as named `...List` array schemas in components and `$ref` them.
