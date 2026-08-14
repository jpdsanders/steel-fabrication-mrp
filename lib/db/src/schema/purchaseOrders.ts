import {
  pgTable,
  serial,
  integer,
  text,
  real,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  poNumber: text("po_number").notNull(),
  status: text("status").notNull().default("draft"),
  reviewComment: text("review_comment"),
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
});

export type PurchaseOrderRow = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderLineRow = typeof purchaseOrderLinesTable.$inferSelect;
