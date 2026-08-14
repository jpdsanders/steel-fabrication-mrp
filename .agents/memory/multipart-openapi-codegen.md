---
name: Multipart endpoints in OpenAPI + Orval codegen
description: How to add multipart/form-data upload endpoints without breaking Orval/Zod codegen typecheck
---

Rule: when adding a `multipart/form-data` requestBody to the OpenAPI spec, use a `$ref` to a named component schema (not an inline object), and ensure the zod lib package's tsconfig includes the DOM lib.

**Why:** Orval generates `zod.instanceof(File)` and a `file: Blob` type for binary fields. With an inline schema, the zod schema and the generated TS type both get the operation-derived name (e.g. `UploadJobDocumentBody`), causing a duplicate-export ambiguity from the barrel `index.ts`. And `File`/`Blob` are not in Node-only TS libs, so `typecheck:libs` fails until `"lib": ["ES2023", "DOM"]` is set in the zod package tsconfig (runtime is fine — Node 24 has both globals).

**How to apply:** define the form as a named component (e.g. `DocumentUploadForm`) and `$ref` it from the requestBody. On the server, validate non-file fields with `GeneratedBody.omit({ file: true }).parse(req.body)` and handle the file via multer. Client uploads use a plain `fetch` + `FormData` (generated hooks don't handle multipart well).
