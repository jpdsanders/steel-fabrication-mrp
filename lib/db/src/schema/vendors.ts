import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Per-company configurable vendor category taxonomy (e.g. Critical/Standard).
 * Each company defines its own set — nothing is hardcoded.
 */
export const vendorCategoriesTable = pgTable(
  "vendor_categories",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortIndex: integer("sort_index").notNull().default(0),
  },
  (table) => [
    uniqueIndex("vendor_categories_company_name_idx").on(
      table.companyId,
      table.name,
    ),
  ],
);

export const VENDOR_STATUSES = [
  "conditional",
  "approved",
  "suspended",
  "disqualified",
] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** Approved Vendor List (AVL) — company-scoped. */
export const vendorsTable = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    categoryId: integer("category_id").references(
      () => vendorCategoriesTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("conditional"),
    /** What the vendor is qualified to supply. */
    scopeOfApproval: text("scope_of_approval"),
    /** Certificate of insurance expiration; lapse is flagged when in the past. */
    coiExpiration: date("coi_expiration", { mode: "string" }),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("vendors_company_name_idx").on(table.companyId, table.name),
  ],
);

export type VendorCategoryRow = typeof vendorCategoriesTable.$inferSelect;
export type VendorRow = typeof vendorsTable.$inferSelect;
