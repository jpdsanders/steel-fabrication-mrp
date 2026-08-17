---
name: Multi-tenant auth setup
description: Session-based auth on Express with company scoping; kiosk routes need a separate auth path.
---

# Multi-tenant auth setup

## Architecture
- `express-session` + `connect-pg-simple` (table `user_sessions`, auto-created on startup)
- `SESSION_SECRET` env var required (min 32 chars)
- Cookie is `secure: process.env.NODE_ENV === "production"` — HTTP in dev, HTTPS in prod
- `loadAuth` middleware runs on every request, populates `req.auth` from session; does NOT reject unauthenticated requests
- `requireAuth` rejects with 401; `requireSuperAdmin` rejects with 403
- All tenant-scoped queries use `req.auth.companyId` — super-admins always have an active company (set via `POST /auth/switch-company`)

## Auth DTO shape (login / me / switch-company all return the same flat shape)
All three call `buildAuthDto(userId, companyId)` in `auth.ts` and return:
`{ id, email, name, superAdmin, companyId, companyName, companySlug, roles, companies? }`
Frontend `AuthUser` interface in `useAuth.tsx` matches this shape exactly.

## Key files
- `artifacts/api-server/src/middlewares/auth.ts` — `loadAuth`, `requireAuth`, `requireSuperAdmin`, `AuthContext` type
- `artifacts/api-server/src/routes/auth.ts` — login/logout/me/switch-company/companies + `buildAuthDto` helper
- `artifacts/api-server/src/app.ts` — session setup, CORS with credentials

## Ownership resolvers — always use these for direct-ID endpoints
- `resolveDocWithOwnership(docId, companyId)` in `documents.ts` — resolves doc through job/estimate/part chain
- `verifyAssemblyOwnership(assemblyId, companyId)` in `bom.ts`
- `verifyPartOwnership(partId, companyId)` in `bom.ts`

## Dashboard tenant isolation
**Why:** `activeCountByJob()` in `production.ts` must be scoped to the caller's company jobs or it returns the aggregate clocked-in count across all companies.
`getDashboardSummary(companyId)` and `getDashboardJobs(companyId)` pass `jobs.map(j => j.id)` as an allow-list to `activeCountByJob(jobIds)`.

## Kiosk routes need special handling
**Why:** Shop floor kiosk runs without a browser login session. After adding `requireAuth` to time routes, kiosk clock-in/out returns 401. A PIN-based or employee-ID kiosk token flow needs to be built separately — see follow-up task.
**Current state:** `/shop-floor` route is inside `ProtectedRoute` (requires session login) until kiosk auth is built.

## Initial companies
- Three companies seeded: S&S Steel (`ss-steel`), St. George Steel (`stg-steel`), Exclusive Metals (`exclusive-metals`)
- Super-admin bootstrap: use `SEED_ADMIN_PASSWORD` env var, or a random password is generated and printed once on first run
- Seed command: `pnpm --filter @workspace/scripts run seed:companies` (idempotent)

## Frontend auth
- `artifacts/mrp/src/hooks/useAuth.tsx` — `AuthProvider`, `useAuth()`, `AuthUser` type
- `artifacts/mrp/src/lib/api.ts` — `getApiUrl(path)` helper
- `artifacts/mrp/src/App.tsx` — `ProtectedRoute` uses `useEffect` for redirect (NOT render-phase navigation)
- Login page: `artifacts/mrp/src/pages/Login.tsx`
- Admin pages: `artifacts/mrp/src/pages/admin/`

## Scripts — all tenant-scoped inserts need companyId
seed.ts, import-customers.ts, import-jobs.ts, migrate-customers.ts all look up S&S Steel by slug at start of main() and pass companyId to every tenant-scoped insert (jobs, estimates, customers, employees, stageLibrary).
