import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";
import { documentsTable } from "./documents";
import { bomPartsTable } from "./bom";
import { purchaseOrdersTable, purchaseOrderLinesTable } from "./purchaseOrders";

/**
 * Phase 4 — Inventory & heat/MTR traceability.
 *
 * The legacy free-text bom_parts.heat_number column is unused; real
 * traceability flows through receiving_lines (heat # + CMTR captured at
 * receiving) → inventory_items → material_movements (consumption).
 */

/** A receiving event against a purchase order (one delivery/packing slip). */
export const receivingRecordsTable = pgTable("receiving_records", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id")
    .notNull()
    .references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  receivedDate: date("received_date", { mode: "string" }).notNull(),
  receivedByUserId: integer("received_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A received material line. Heat number and CMTR document are mandatory at
 * receiving time — never filled in later. Material fields are snapshotted
 * here because PO lines are replaced wholesale on PO edits.
 */
export const receivingLinesTable = pgTable("receiving_lines", {
  id: serial("id").primaryKey(),
  receivingRecordId: integer("receiving_record_id")
    .notNull()
    .references(() => receivingRecordsTable.id, { onDelete: "cascade" }),
  purchaseOrderLineId: integer("purchase_order_line_id").references(
    () => purchaseOrderLinesTable.id,
    { onDelete: "set null" },
  ),
  profileType: text("profile_type"),
  profileSize: text("profile_size"),
  grade: text("grade"),
  heatNumber: text("heat_number").notNull(),
  /** CMTR/MTR document — required at receiving (FK to documents). */
  cmtrDocumentId: integer("cmtr_document_id")
    .notNull()
    .references(() => documentsTable.id, { onDelete: "restrict" }),
  pieces: integer("pieces").notNull().default(1),
  lengthIn: real("length_in"),
  /** Cost per piece at receipt (defaults from the PO line unit price). */
  unitCost: real("unit_cost"),
  discrepancyNotes: text("discrepancy_notes"),
});

export const INVENTORY_STATUSES = [
  "available",
  "committed",
  "consumed",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

/**
 * On-hand stock and remnants. On by default for every company — not a
 * togglable feature. sourceJobId null = general stock. receivingLineId is
 * the heat/CMTR traceability anchor and is carried forward onto remnants.
 */
export const inventoryItemsTable = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  profileType: text("profile_type"),
  profileSize: text("profile_size"),
  grade: text("grade"),
  /** Pieces on hand. */
  quantity: integer("quantity").notNull().default(1),
  lengthIn: real("length_in"),
  /** Job the material is allocated to; null = general stock. */
  sourceJobId: integer("source_job_id").references(() => jobsTable.id, {
    onDelete: "set null",
  }),
  /** Traceability anchor: heat #, CMTR, PO, vendor all resolve through here. */
  receivingLineId: integer("receiving_line_id").references(
    () => receivingLinesTable.id,
    { onDelete: "set null" },
  ),
  isRemnant: boolean("is_remnant").notNull().default(false),
  status: text("status").notNull().default("available"),
  /** Job this item is reserved for (set when status = "committed"). */
  committedJobId: integer("committed_job_id").references(() => jobsTable.id, {
    onDelete: "set null",
  }),
  /** Cost per piece. */
  unitCost: real("unit_cost"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const MOVEMENT_TYPES = [
  "purchased",
  "received",
  "consumed",
  "transferred",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Material-movement ledger with cost attached — drives the monthly
 * material-moved-per-job export and the inventory cost/usage trend report.
 */
export const materialMovementsTable = pgTable("material_movements", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  movementType: text("movement_type").notNull(),
  inventoryItemId: integer("inventory_item_id").references(
    () => inventoryItemsTable.id,
    { onDelete: "set null" },
  ),
  receivingLineId: integer("receiving_line_id").references(
    () => receivingLinesTable.id,
    { onDelete: "set null" },
  ),
  purchaseOrderId: integer("purchase_order_id").references(
    () => purchaseOrdersTable.id,
    { onDelete: "set null" },
  ),
  /** Job the movement is charged to (consumption/receipt against a job). */
  jobId: integer("job_id").references(() => jobsTable.id, {
    onDelete: "set null",
  }),
  /** BOM part consumed (heat-sheet linkage). */
  bomPartId: integer("bom_part_id").references(() => bomPartsTable.id, {
    onDelete: "set null",
  }),
  quantity: integer("quantity").notNull().default(1),
  lengthIn: real("length_in"),
  totalCost: real("total_cost"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ReceivingRecordRow = typeof receivingRecordsTable.$inferSelect;
export type ReceivingLineRow = typeof receivingLinesTable.$inferSelect;
export type InventoryItemRow = typeof inventoryItemsTable.$inferSelect;
export type MaterialMovementRow = typeof materialMovementsTable.$inferSelect;
