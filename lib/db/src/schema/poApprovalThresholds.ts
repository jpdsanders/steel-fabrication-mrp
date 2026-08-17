import {
  pgTable,
  serial,
  integer,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Per-company PO approval-threshold matrix. Each row is a tier starting at
 * `minTotal` (inclusive). The tier with the highest `minTotal` <= PO total
 * applies. `requiredRole` null means auto-approve (no gate).
 * EM's $2,500 / $10,000 tiers are seeded as editable defaults.
 */
export const poApprovalThresholdsTable = pgTable("po_approval_thresholds", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  minTotal: real("min_total").notNull().default(0),
  label: text("label").notNull(),
  /** Role required to approve POs in this tier; null = auto-approve. */
  requiredRole: text("required_role"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PoApprovalThresholdRow =
  typeof poApprovalThresholdsTable.$inferSelect;
