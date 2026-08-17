# Material Nesting Spike — 1D Cutting-Stock (Phase 5)

**Status:** Recommendation for review (Jonah) — August 14, 2026
**Scope:** Linear (1D) nesting only. 2D plate nesting is out of scope for v1.

## 1. Problem statement

Given a job/estimate BOM, group parts by (profile type, profile size, grade). For each
group, fit the required cut lengths onto purchasable stock bars so that total material
bought — and therefore drop/waste — is minimized. Constraints and realities:

- Different vendors sell different standard stock lengths (e.g. 40' vs 60' vs 20').
- Remnants already in inventory should be consumed before buying new stock (Phase 4
  integration; see §5).
- Every cut consumes a kerf (saw blade width). Default 0.25", configurable per run.
- Output must be actionable: a per-bar cut list a saw operator can follow.

Formally this is the classic **1D cutting-stock / bin-packing problem** (NP-hard), with
the twist that the "bin size" is itself a choice (which vendor stock length to buy).

## 2. Approaches evaluated

### A. First-Fit-Decreasing / Best-Fit-Decreasing heuristics (recommended)
Sort demand lengths descending; place each part on the open bar where it fits best
(BFD) or first (FFD); open a new bar when nothing fits.

- **Quality:** FFD/BFD are guaranteed within ~22% of optimal worst-case, and in practice
  on steel BOMs (few distinct lengths, many repeats) they land at or within 1 bar of
  optimal for nearly all groups.
- **Speed:** O(n log n); instant for any realistic BOM (hundreds of parts per profile).
- **Determinism:** same input → same plan. Easy to explain to an estimator.
- **Improvement trick:** run BFD several times with different orderings (pure descending,
  descending with tie-shuffles, pair-swap local search on the worst bar) and keep the
  best result. Cheap and closes most of the gap to optimal.

### B. ILP / column generation (Gilmore–Gomory)
Provably optimal. Requires a MIP solver (GLPK/HiGHS/OR-Tools via WASM or native
bindings), adds a heavyweight dependency to the bundled Express server (esbuild
externals are already delicate — pdfkit precedent), non-deterministic solve times, and
the optimality gain over multi-start BFD on shop-scale BOMs is typically zero or one
bar per group. **Not worth the operational risk for v1.**

### C. Existing JS libraries
Surveyed `binpackingjs`, `bin-packer`, assorted npm cutting-stock packages: unmaintained,
no kerf support, no multi-stock-length support, no remnant support. We'd wrap and fight
them. A purpose-built ~300-line engine we own outright is simpler and testable.

## 3. Recommendation

**Multi-start Best-Fit-Decreasing heuristic, implemented in-house as a pure TypeScript
module** (`artifacts/api-server/src/lib/nesting.ts`), with:

1. **Per-group solve:** parts grouped by profile type + size + grade.
2. **Remnants-first pass:** available remnant lengths (matching profile/grade) are
   offered as zero-cost bins before new stock is opened.
3. **Stock-length options compared, not guessed:** for each group the engine solves the
   nest once per candidate stock length (every vendor standard length on file for that
   profile, plus a mixed "best fit" run that may combine lengths), and returns **all
   options ranked by waste %** so the purchaser sees the tradeoff (e.g. "3× 40' @ 8.6%
   drop from Vendor A vs 2× 60' @ 4.1% from Vendor B").
4. **Kerf-aware:** each cut after the first on a bar consumes kerf; bar feasibility =
   Σ(part lengths) + kerf × (cuts − 1) ≤ usable bar length.
5. **Deterministic multi-start:** descending sort + a bounded set of perturbation
   restarts (seeded, so results are reproducible).
6. Parts longer than every available stock length are reported as **unnestable**, never
   silently dropped.

Escape hatch: if a real optimality gap ever shows up in practice, the engine's
interface (demand + bin catalog in, placements out) is solver-agnostic — an ILP backend
can be swapped in behind the same API without schema or UI changes.

## 4. Data model additions

- **`vendor_stock_lengths`** (company-scoped via vendor): `id`, `vendor_id` FK,
  `profile_type` (nullable — null = applies to all profiles this vendor supplies),
  `length_in` (real, required), `notes`, timestamps. Unique (vendor, profile_type,
  length_in). This lives on the **vendor**, per the brief ("varying per vendor").
- **`nesting_plans`**: `id`, `job_id` FK, `status` (`draft`/`accepted`), `kerf_in`,
  `created_by`, timestamps. One accepted plan per job at a time (enforced in code).
- **`nesting_plan_bars`**: `id`, `plan_id` FK, group fields (profile type/size/grade),
  `source` (`stock`/`remnant`), `vendor_id` (nullable), `stock_length_in`,
  `remnant_ref` (nullable text reference until Phase 4 lands — see §5), `waste_in`,
  `sort_index`.
- **`nesting_plan_cuts`**: `id`, `bar_id` FK, `bom_part_id` FK, `length_in`, `quantity`,
  `sort_index`.

Computation is on-demand (POST returns ranked options, nothing persisted); **accepting**
an option persists it as a plan, and the **cut list** is a view over the accepted plan's
bars/cuts.

## 5. Remnant integration (Phase 4 dependency)

Phase 4 (inventory & remnants) is in flight in parallel. The engine accepts remnants as
a plain input list (`{lengthIn, ref}`), so it is remnant-ready today; the API will pass
an empty list until the `inventory_items` table merges, then a small follow-up wires
`status = available` remnants matching the profile/grade into the request and marks them
committed on plan acceptance. This keeps the two phases mergeable without coordination.

## 6. Implementation plan

1. Schema: `vendor_stock_lengths`, `nesting_plans`, `nesting_plan_bars`,
   `nesting_plan_cuts` + migration DDL.
2. Engine: pure `nestGroup()` / `nestBom()` functions with unit tests (kerf, remnants,
   unnestable parts, multi-length comparison).
3. API: manage vendor stock lengths (CRUD under vendors); `POST /jobs/:id/nesting/compute`
   (ranked options per group); `POST /jobs/:id/nesting/plans` (accept an option);
   `GET /jobs/:id/nesting/plan` + `GET .../cut-list`.
4. UI: vendor stock lengths on the Vendors page; a Nesting section on Job Detail with
   per-profile option comparison (bars visualized, waste %), accept action, and a
   printable cut list.
