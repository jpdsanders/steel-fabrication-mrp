# Steel Fabrication MRP

A production-tracking MRP for a structural steel fabrication shop: jobs move through production stages, shop-floor workers clock time against jobs/stages at a kiosk, and managers watch progress and labor burn vs. estimates on a live dashboard.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/mrp run dev` — run the web app (managed by the `artifacts/mrp: web` workflow)
- `pnpm --filter @workspace/scripts run seed` — reset & seed demo data (jobs, stages, employees, time entries)
- `pnpm --filter @workspace/scripts run import:customers` — import real customers/contacts/addresses from the bid log spreadsheet in `attached_assets/` (idempotent; reconciles missing child rows on rerun)
- `pnpm --filter @workspace/scripts run import:jobs` — import real jobs + stage routing from the production tracker spreadsheet in `attached_assets/` (idempotent by job number; legacy jobs keep their "EM ####" numbers; assembly detail goes into job notes)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + wouter + TanStack Query + shadcn/ui (Tailwind v4)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)

## Where things live

- API contract (source of truth): `lib/api-spec/openapi.yaml` — edit this, then run codegen
- Generated React Query hooks: `@workspace/api-client-react` (`lib/api-client-react/src/generated`)
- Generated Zod schemas: `@workspace/api-zod` (`lib/api-zod/src/generated`)
- DB schema (one table per file): `lib/db/src/schema/` (jobs, stages, stageLibrary, employees, timeEntries, documents, customers, contacts, customerAddresses)
- Job documents: `artifacts/api-server/src/routes/documents.ts` (multipart upload via multer → GCS object storage), UI card `artifacts/mrp/src/components/jobs/DocumentsCard.tsx`
- API routes: `artifacts/api-server/src/routes/` (registered in `routes/index.ts`)
- Aggregation logic (dashboard, job detail, hours): `artifacts/api-server/src/services/production.ts`
- Frontend pages: `artifacts/mrp/src/pages/`; office nav shell: `artifacts/mrp/src/components/layout/NavShell.tsx`
- Theme tokens (industrial steel + safety orange): `artifacts/mrp/src/index.css`
- Seed script: `scripts/src/seed.ts`

## Architecture decisions

- `actualHours` is derived, never stored: it is the summed duration of completed time entries per stage/job, computed in `services/production.ts`. Open (clocked-in) punches do not count toward actual hours but do drive `clockedInCount`.
- Job stage routing is per-job: creating a job copies a routing (custom or the default workflow) into `stages` rows. The `stage_library` is just a template list to populate routing; it is not linked to job stages.
- Numbering is auto-assigned server-side (no manual entry): estimates get Bid #s `B-1001+`, jobs get Job #s `J-2001+` (`nextBidNumber`/`nextJobNumber` in `services/production.ts` scan max numeric suffix).
- Estimates: statuses draft/submitted/won/lost. "Won" happens only via convert (POST `/estimates/{id}/convert`), which creates a linked job (jobs.estimateId) with stage routing; won estimates reject status PATCH and DELETE with 409. One job per estimate.
- Default workflow: Estimating → Fabrication → Welding → Paint → Inspection → Shipping. First stage starts `in_progress` on job creation.
- `advanceJobStage` marks the current `in_progress` stage `complete` and starts the next; advancing past the last stage sets the job `complete`.
- `percentComplete` = completed stages / total stages. `isPastDue` = dueDate < today AND status not complete/closed.
- No auth yet (product decision for this phase).
- Documents belong to exactly one parent: `documents` has nullable `jobId` XOR `estimateId` (DB check constraint, both cascade delete). Estimate uploads mirror job uploads (`/estimates/{id}/documents`); converting an estimate moves its documents to the new job (jobId set, estimateId cleared); deleting an estimate removes its stored objects first. Job documents are stored in Replit App Storage (GCS). The `documents` table stores metadata + `storageKey` (never exposed via API). Uploads stream through the server (multer memory → GCS) so file type (.pdf .dwg .dxf .nc1 .nc .jpg .jpeg .png .xlsx .csv) and size (50 MB max) are enforced server-side. Deleting a document or its job also deletes the stored object (`deleteJobDocumentObjects` runs before job delete since DB cascade would drop the rows first).
- Job assignments: `job_assignments` join table (jobId+employeeId unique, cascade deletes). `assignedEmployeeIds` on job create/PATCH is a full replacement list; `assignedEmployees` ({id,name}[]) is returned on JobDetail and DashboardJob. Dashboard "Assigned to" filter is client-side; dashboard status filter defaults to "active".
- BOM (KISS import): `bom_assemblies`/`bom_parts` cascade from jobs. Parser at `api-server/src/lib/kissParser.ts` (H header, D rows; a D row whose partMark equals the assembly mark starts a new assembly). POST `/bom/parse` previews without saving; POST `/jobs/{id}/bom` replaces the whole BOM and records the original .kss as an `nc_data` document in one transaction (object saved to GCS first, cleaned up on failure). Only `.kss` accepted server-side. Material totals grouped by profileType|size|grade; KISS length column is mm (Tekla) and is converted to inches on import; lengths stored in inches and displayed as feet-and-inches (formatter in `artifacts/mrp/src/lib/units.ts`). UI: `components/jobs/BomCard.tsx` (job detail card + shared preview/upload helpers used by the New Job dialog).
- New Job dialog is a 3-step upload-first wizard (Upload → Review → Details) in `artifacts/mrp/src/pages/JobsList.tsx`: step 1 accepts any allowed document type plus .kss/.xml (skippable); .kss is parsed for a BOM preview and prefills job name from KISS jobName/jobRef; other files are attach-only (category inferred from extension). File upload happens after job creation — partial failure shows a destructive toast pointing to the job detail page. `.xml` is in the server document whitelist.
- Purchase orders: `purchase_orders`/`purchase_order_lines` cascade from jobs; PO #s `PO-3001+` (unique index), statuses draft→sent→approved/rejected. Transitions: sent←draft/rejected, approve/reject←sent (409 otherwise); lines PATCH is full replacement, allowed only draft/rejected; DELETE blocked when approved; `reviewComment` cleared on send. Lines carry quantities/lengths only (lengthIn = TOTAL length in inches per line, matching BOM material totals used to prefill new POs) — no pricing/weights/vendors by design. Routes: `api-server/src/routes/purchaseOrders.ts`; UI: `pages/PurchasingList.tsx`, `pages/PurchaseOrderDetail.tsx` (print CSS recap grouped by profile type — Print/PDF via window.print), `components/jobs/PurchaseOrdersCard.tsx`, shared editor in `components/purchasing/`.
- Customers: jobs link to customers via nullable `jobs.customerId` (FK, set null on delete); `jobs.customer` text is kept denormalized and synced on customer rename. Job create/update takes `customerId` only. Deleting a customer with linked jobs returns 409. Contacts enforce one primary per customer (server clears others when `isPrimary` set).

## Product

Implemented (phase 1): Production Tracking + Dashboard on a Jobs spine, plus a kiosk-style shop-floor clock in/out.
- Estimates: bid pipeline (list/detail, draft→submitted→won/lost) with "Convert to Job" (copies routing, links job to bid)
- Dashboard: live KPIs + per-job progress (current stage, hours burned vs. estimated, past-due, floor headcount)
- Jobs: searchable/filterable list, create with editable stage routing, job detail with stage advance/edit and time entries
- Shop Floor kiosk (`/shop-floor`): fullscreen, touch-friendly clock in/out wizard + live "on the floor" list
- Employees roster, supervisor Time view (correct/manual/delete entries), Stage Library settings
- Customers (CRM): list + detail (client info, contacts, delivery addresses, job history); customer picker with inline quick-add in new-job dialog
- Dashboard grid view: Excel-style production rollup (default view, toggle to cards) — per-job quantity-weighted assembly counts per stage (Not Started + Vendor Processing + In-Shop Pipeline groups + On Hold), due date/days out, derived status, % done; counts reconcile to Total Qty (held units count only under On Hold); `computeAssemblyStageCounts`/`computeAssemblyRollup` in `services/production.ts` are quantity-weighted; grid UI in `components/dashboard/ProductionGrid.tsx`
- Purchasing: materials POs per job (prefilled from BOM totals), PM review (send/approve/reject with comment), printable recap grouped by profile type

Planned later (from PRD): Estimating, Purchasing, richer Time Tracking, Document Control, Reporting, multi-org, PDF/file storage.

## Gotchas

- Edit `lib/api-spec/openapi.yaml` then run codegen; do not hand-edit generated files. Do not change the OpenAPI `info.title` — it controls generated filenames.
- Every generated query hook requires a `queryKey` in its `query` options (use the `get*QueryKey` helpers), even when only setting `refetchInterval` or `enabled`.
- wouter: to wrap routes in a layout, use a pathless catch-all `<Route>` around the nested `<Switch>`. A wildcard path like `<Route path="/:rest*">` consumes the path and breaks nested absolute route matching (blank page).
- Server uses `req.log` (never `console.log`). Zod validation errors are caught centrally in `middlewares/errorHandler.ts` and returned as 400.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
