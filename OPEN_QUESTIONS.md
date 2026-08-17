# Open Questions

These items are flagged per the rebuild brief — do **not** build the specific behaviors listed. Add a `// OPEN QUESTION: see OPEN_QUESTIONS.md` comment at each affected code location.

---

## #1 — Job handoff: preserve source link or clean one-way copy?

**Phase:** Phase 0  
**Status:** Open  
**Question:** When S&S pushes a job into Exclusive Metals, does the handoff record a reference link back to the originating S&S job (so S&S can see "this scope shipped"), or is it a clean one-way copy with no traceability back to S&S?  
**Provisional decision:** A nullable `source_job_id` FK exists in `job_handoffs` so the schema doesn't need to change either way. No UI or reporting on it until this is resolved.  
**Blocks:** `artifacts/api-server/src/routes/jobHandoffs.ts` — the UI/reporting side of handoff source reference.

---

## #2 — Estimate type user-facing labels: "Preliminary" vs. "Detailed"

**Phase:** Phase 2  
**Status:** Open  
**Question:** What should these two estimate types actually be called in user-facing copy? The internal enum values `preliminary` / `detailed` are set. The display labels must route through a single swappable constant so they can be renamed without a schema/logic change.  
**Blocks:** UI labels in Phase 2 estimating module.

---

## #3 — One-Off Job path: is it in scope at all?

**Phase:** Not phased  
**Status:** Open  
**Question:** Should the system support a lightweight "One-Off Job" path (mock-up/sketch scope, cash payment, simplified receipt)? No table, workflow, or UI should be created until this is confirmed.  
**Blocks:** Nothing currently — do not start.

---

## #4 — Infosight tag printer integration: file format vs. direct protocol?

**Phase:** Phase 7  
**Status:** Open  
**Question:** Does the shop tag export produce a formatted file that Infosight's own software ingests, or does it talk directly to the printer protocol? Jonah does not have exact specs yet.  
**Blocks:** Phase 7 tag export/print logic. The "select assemblies → generate tags" UI affordance can be stubbed cheaply when Phase 7 arrives.

---

## #5 — 7-year document retention: group-wide standard or EM-specific?

**Phase:** Cross-cutting  
**Status:** Open  
**Question:** Is the 7-year retention period from Exclusive Metals' QMS a group-wide standard, or EM-specific? **Regardless of the answer**, soft-delete is used everywhere — hard deletion of jobs/estimates/documents is never done. Only the specific retention *period* encoding is blocked.  
**Blocks:** Any retention-period enforcement logic or per-company variation.

## Job-level stages vs. assembly pipeline (Stage Library rework)
The Stage Library is now the single source of truth for the **assembly** production pipeline (per-company, ordered, with a Ready-to-Ship gate and a final shipped stage). Jobs still carry their own separate job-level `stages` list (used for job scheduling/labor), which is unrelated to the assembly pipeline. **For Jonah:** should job-level stages be reconciled with (or replaced by) the Stage Library pipeline, or do they serve a distinct scheduling purpose worth keeping? Leaving both in place until decided.
