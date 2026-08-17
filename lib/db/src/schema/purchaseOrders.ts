import {
  pgTable,
  serial,
  integer,
  text,
  real,
  date,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { vendorsTable } from "./vendors";

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  status: text("status").notNull().default("draft"),
  reviewComment: text("review_comment"),
  /** Vendor is required at the API level for all new POs (AVL enforcement). */
  vendorId: integer("vendor_id").references(() => vendorsTable.id, {
    onDelete: "restrict",
  }),
  /** Required justification when buying from a non-approved/non-listed vendor. */
  vendorExceptionJustification: text("vendor_exception_justification"),
  /** Current change-order revision number; 0 = original issue. */
  revision: integer("revision").notNull().default(0),
  /** PO-level quality clause ids (quality_clauses). */
  qualityClauseIds: integer("quality_clause_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [uniqueIndex("purchase_orders_po_number_idx").on(table.poNumber)]);

export const purchaseOrderLinesTable = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id")
    .notNull()
    .references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  profileType: text("profile_type"),
  profileSize: text("profile_size"),
  grade: text("grade"),
  pieces: integer("pieces").notNull().default(1),
  lengthIn: real("length_in"),
  sortIndex: integer("sort_index").notNull().default(0),
  /** Price per piece. Extended price = unitPrice * pieces (computed). */
  unitPrice: real("unit_price"),
  /** Vendor promise date used for due-in tracking. */
  promiseDate: date("promise_date", { mode: "string" }),
  /** Line-level quality clause ids (quality_clauses). */
  qualityClauseIds: integer("quality_clause_ids").array().notNull().default([]),
});

/**
 * Numbered change-order revisions: when a PO past Draft is edited, the prior
 * state (header + lines) is snapshotted here and purchase_orders.revision
 * increments. Rev N snapshot = state before the (N+1)th issue.
 */
export const purchaseOrderRevisionsTable = pgTable(
  "purchase_order_revisions",
  {
    id: serial("id").primaryKey(),
    purchaseOrderId: integer("purchase_order_id")
      .notNull()
      .references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    note: text("note"),
    snapshot: jsonb("snapshot").notNull(),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("po_revisions_po_rev_idx").on(
      table.purchaseOrderId,
      table.revisionNumber,
    ),
  ],
);

export type PurchaseOrderRow = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderLineRow = typeof purchaseOrderLinesTable.$inferSelect;
export type PurchaseOrderRevisionRow =
  typeof purchaseOrderRevisionsTable.$inferSelect;
