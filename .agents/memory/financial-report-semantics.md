---
name: financial report semantics
description: Conventions the completion reviewer enforces for money math in MRP reports
---

Rules the completion code review enforces for any report/metric touching money:

- **Cost variance baselines must exclude margin.** Compare actuals to the estimate's cost budget (labor lines + BOM material at quoted/catalog price), never to the quoted/contract amount. Keep revenue-side variance as a separate field.
- **"Committed" PO spend = approved POs only.** Draft/sent are pending, rejected never committed. The PO state machine has no `cancelled` status — don't filter on it.
- **"Outstanding" must net out receipts.** Aggregate received pieces per PO line (receiving_lines), drop fully received lines/POs, and value only remaining quantities (pattern: `/purchase-orders/due-in`).

**Why:** three consecutive completion-review rejections on the reporting build-out were each about one of these.
**How to apply:** any new report, dashboard number, or rollup involving PO value, estimates, or variances — mirror these definitions and add integration tests proving exclusions (rejected POs, received lines, margin).
