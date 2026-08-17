import {
  pgTable,
  serial,
  integer,
  text,
  real,
  timestamp,
} from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";
import { jobsTable } from "./jobs";
import { bomPartsTable } from "./bom";

/**
 * Standard stock lengths a vendor offers for a given profile type.
 * Null profileType means the vendor offers this length for all profiles
 * they are approved to supply.
 */
export const vendorStockLengthsTable = pgTable(
  "vendor_stock_lengths",
  {
    id: serial("id").primaryKey(),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    /** Profile type this length applies to, or null = all profiles this vendor supplies. */
    profileType: text("profile_type"),
    /** Usable stock length in inches. */
    lengthIn: real("length_in").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Uniqueness is enforced by a COALESCE expression index applied in post-merge.sh:
  //   CREATE UNIQUE INDEX vendor_stock_lengths_unique_idx
  //   ON vendor_stock_lengths (vendor_id, COALESCE(profile_type,''), length_in)
  // A plain Drizzle uniqueIndex on nullable profile_type would treat each NULL as
  // distinct and allow duplicate generic stock lengths.
  () => [],
);

export const NESTING_PLAN_STATUSES = ["draft", "accepted"] as const;
export type NestingPlanStatus = (typeof NESTING_PLAN_STATUSES)[number];

/**
 * A computed nesting plan for a job. At most one plan per job can be "accepted".
 */
export const nestingPlansTable = pgTable("nesting_plans", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("draft"),
  /** Saw kerf used during this computation, in inches. */
  kerfIn: real("kerf_in").notNull().default(0.25),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export const NESTING_BAR_SOURCES = ["stock", "remnant"] as const;
export type NestingBarSource = (typeof NESTING_BAR_SOURCES)[number];

/**
 * One bar (stock piece) within a nesting plan.
 * Groups are (profileType, profileSize, grade).
 */
export const nestingPlanBarsTable = pgTable("nesting_plan_bars", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id")
    .notNull()
    .references(() => nestingPlansTable.id, { onDelete: "cascade" }),
  profileType: text("profile_type").notNull(),
  profileSize: text("profile_size").notNull(),
  grade: text("grade").notNull(),
  /** Whether this bar is purchased stock or a remnant from inventory. */
  source: text("source").notNull().default("stock"),
  /** FK to vendor if source=stock; null for remnants. */
  vendorId: integer("vendor_id").references(() => vendorsTable.id, {
    onDelete: "set null",
  }),
  vendorName: text("vendor_name"),
  /** Total length of this bar in inches. */
  stockLengthIn: real("stock_length_in").notNull(),
  /** Waste/drop on this bar in inches. */
  wasteIn: real("waste_in").notNull(),
  /** Remnant inventory reference (free text until Phase 4 inventory module lands). */
  remnantRef: text("remnant_ref"),
  sortIndex: integer("sort_index").notNull().default(0),
});

/**
 * One cut on a bar — a required part (or quantity of identical parts).
 */
export const nestingPlanCutsTable = pgTable("nesting_plan_cuts", {
  id: serial("id").primaryKey(),
  barId: integer("bar_id")
    .notNull()
    .references(() => nestingPlanBarsTable.id, { onDelete: "cascade" }),
  /** FK to the BOM part this cut satisfies (nullable — may be unnested or manual). */
  bomPartId: integer("bom_part_id").references(() => bomPartsTable.id, {
    onDelete: "set null",
  }),
  lengthIn: real("length_in").notNull(),
  quantity: integer("quantity").notNull().default(1),
  /** Label shown on the cut list (part mark + description). */
  label: text("label"),
  sortIndex: integer("sort_index").notNull().default(0),
});

export type VendorStockLength = typeof vendorStockLengthsTable.$inferSelect;
export type NestingPlan = typeof nestingPlansTable.$inferSelect;
export type NestingPlanBar = typeof nestingPlanBarsTable.$inferSelect;
export type NestingPlanCut = typeof nestingPlanCutsTable.$inferSelect;
