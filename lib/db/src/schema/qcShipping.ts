import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";
import { bomAssembliesTable } from "./bom";
import { purchaseOrdersTable } from "./purchaseOrders";

// ---------------------------------------------------------------------------
// QC — nonconformance reports & substitution requests (Phase 6).
//
// NOTE: the QC data model is a DRAFT pending validation by someone with
// hands-on QC experience (rebuild brief Phase 6 caveat). Keep these tables
// adaptable; do not treat field lists as final.
// ---------------------------------------------------------------------------

export const NCR_SOURCES = [
  "receiving",
  "in_process",
  "final",
  "post_delivery",
] as const;
export type NcrSource = (typeof NCR_SOURCES)[number];

export const NCR_DISPOSITIONS = [
  "rework",
  "scrap",
  "accept_with_deviation",
] as const;
export type NcrDisposition = (typeof NCR_DISPOSITIONS)[number];

export const NCR_STATUSES = ["open", "closed"] as const;
export type NcrStatus = (typeof NCR_STATUSES)[number];

export const nonconformanceReportsTable = pgTable(
  "nonconformance_reports",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    number: text("number").notNull(), // NCR-1001, sequential per company
    source: text("source").notNull(), // NcrSource
    description: text("description").notNull(),
    jobId: integer("job_id").references(() => jobsTable.id, {
      onDelete: "cascade",
    }),
    // BOM re-imports replace assemblies; the NCR record must survive that.
    assemblyId: integer("assembly_id").references(
      () => bomAssembliesTable.id,
      { onDelete: "set null" },
    ),
    purchaseOrderId: integer("purchase_order_id").references(
      () => purchaseOrdersTable.id,
      { onDelete: "set null" },
    ),
    disposition: text("disposition"), // NcrDisposition, null until decided
    dispositionNotes: text("disposition_notes"),
    // Root cause is expected for repeat/high-impact issues.
    rootCause: text("root_cause"),
    approvedBy: integer("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    status: text("status").notNull().default("open"), // NcrStatus
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ncrs_company_number_unique").on(t.companyId, t.number)],
);

export const SUBSTITUTION_TYPES = [
  "like_for_like",
  "equivalent",
  "upgrade",
  "downgrade",
] as const;
export type SubstitutionType = (typeof SUBSTITUTION_TYPES)[number];

export const SUBSTITUTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
export type SubstitutionStatus = (typeof SUBSTITUTION_STATUSES)[number];

export const substitutionRequestsTable = pgTable(
  "substitution_requests",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    number: text("number").notNull(), // SUB-1001, sequential per company
    jobId: integer("job_id").references(() => jobsTable.id, {
      onDelete: "cascade",
    }),
    assemblyId: integer("assembly_id").references(
      () => bomAssembliesTable.id,
      { onDelete: "set null" },
    ),
    originalSpec: text("original_spec").notNull(),
    proposedSubstitution: text("proposed_substitution").notNull(),
    type: text("type").notNull(), // SubstitutionType
    engineeringRationale: text("engineering_rationale").notNull(),
    // Customer concurrence is REQUIRED before approval when the material is
    // customer-specified or the application is safety-critical.
    customerSpecified: boolean("customer_specified").notNull().default(false),
    safetyCritical: boolean("safety_critical").notNull().default(false),
    customerConcurrence: boolean("customer_concurrence")
      .notNull()
      .default(false),
    concurrenceReference: text("concurrence_reference"),
    status: text("status").notNull().default("pending"), // SubstitutionStatus
    approvedBy: integer("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    executionReference: text("execution_reference"),
    createdBy: integer("created_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("substitution_requests_company_number_unique").on(
      t.companyId,
      t.number,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Shipping — shipments with hard gates:
//   1. every assembly on a shipment must be Ready to Ship (Inspected, not on
//      hold) at creation;
//   2. a shipment notification record is required before BOL/packing-slip
//      paperwork can be generated;
//   3. a signed load confirmation is required before a shipment can be marked
//      departed. Departure moves assemblies to the Shipped stage.
// ---------------------------------------------------------------------------

export const SHIPMENT_STATUSES = ["planned", "departed"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const shipmentsTable = pgTable("shipments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  shipperNumber: text("shipper_number").notNull().unique(), // [job#]-S[NN]
  carrier: text("carrier"),
  pickupInfo: text("pickup_info"),
  notes: text("notes"),
  status: text("status").notNull().default("planned"), // ShipmentStatus
  departedAt: timestamp("departed_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const shipmentAssembliesTable = pgTable(
  "shipment_assemblies",
  {
    id: serial("id").primaryKey(),
    shipmentId: integer("shipment_id")
      .notNull()
      .references(() => shipmentsTable.id, { onDelete: "cascade" }),
    assemblyId: integer("assembly_id")
      .notNull()
      .references(() => bomAssembliesTable.id, { onDelete: "cascade" }),
  },
  (t) => [
    // An assembly can be on at most ONE shipment — enforced at the DB level
    // so concurrent shipment creations cannot double-book an assembly.
    uniqueIndex("shipment_assemblies_assembly_unique").on(t.assemblyId),
  ],
);

/** Replaces the "verbal, hallway conversation" ship notice — required
 * before shipping paperwork can be generated. */
export const shipmentNotificationsTable = pgTable("shipment_notifications", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .unique()
    .references(() => shipmentsTable.id, { onDelete: "cascade" }),
  proposedShipDate: text("proposed_ship_date").notNull(), // YYYY-MM-DD
  carrier: text("carrier").notNull(),
  notes: text("notes"),
  notifiedBy: integer("notified_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Required sign-off before a shipment can be marked departed. */
export const loadConfirmationsTable = pgTable("load_confirmations", {
  id: serial("id").primaryKey(),
  shipmentId: integer("shipment_id")
    .notNull()
    .unique()
    .references(() => shipmentsTable.id, { onDelete: "cascade" }),
  signedBy: text("signed_by").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  discrepancyNotes: text("discrepancy_notes"),
});

export type NonconformanceReportRow =
  typeof nonconformanceReportsTable.$inferSelect;
export type SubstitutionRequestRow =
  typeof substitutionRequestsTable.$inferSelect;
export type ShipmentRow = typeof shipmentsTable.$inferSelect;
export type ShipmentAssemblyRow = typeof shipmentAssembliesTable.$inferSelect;
export type ShipmentNotificationRow =
  typeof shipmentNotificationsTable.$inferSelect;
export type LoadConfirmationRow = typeof loadConfirmationsTable.$inferSelect;
