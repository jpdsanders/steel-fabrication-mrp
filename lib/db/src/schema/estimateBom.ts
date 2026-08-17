import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { estimatesTable } from "./estimates";
import { materialCatalogTable } from "./materialCatalog";
import { companiesTable } from "./companies";

// Estimate-stage BOM — mirrors the job-level bom_assemblies/bom_parts structure
// so a BOM can be built and priced before a job exists (Phase 2).
export const estimateBomAssembliesTable = pgTable("estimate_bom_assemblies", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id")
    .notNull()
    .references(() => estimatesTable.id, { onDelete: "cascade" }),
  mark: text("mark").notNull(),
  quantity: integer("quantity").notNull().default(1),
  description: text("description"),
  finish: text("finish"),
  sortIndex: integer("sort_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const estimateBomPartsTable = pgTable("estimate_bom_parts", {
  id: serial("id").primaryKey(),
  assemblyId: integer("assembly_id")
    .notNull()
    .references(() => estimateBomAssembliesTable.id, { onDelete: "cascade" }),
  partMark: text("part_mark"),
  quantity: integer("quantity").notNull().default(1),
  profileType: text("profile_type"),
  profileSize: text("profile_size"),
  grade: text("grade"),
  lengthIn: real("length_in"),
  description: text("description"),
  sortIndex: integer("sort_index").notNull().default(0),
  // Pricing resolution against the shared material catalog.
  // matched      — resolved to a catalog item (catalogItemId set)
  // needs_quote  — no confident catalog match; goes on the RFQ list
  // manual       — estimator entered a price by hand (misc/hardware etc.)
  pricingStatus: text("pricing_status").notNull().default("needs_quote"),
  catalogItemId: integer("catalog_item_id").references(
    () => materialCatalogTable.id,
    { onDelete: "set null" },
  ),
  // Baseline catalog price snapshot at match time ($ per priceUnit).
  catalogUnitPrice: real("catalog_unit_price"),
  catalogPriceUnit: text("catalog_price_unit"), // per_foot | per_piece | per_lb
  // Live vendor quote / manual price, preserved alongside the baseline.
  quotedUnitPrice: real("quoted_unit_price"),
  quotedPriceUnit: text("quoted_price_unit"),
  quoteSource: text("quote_source"), // vendor name / note for a live quote
  isMisc: boolean("is_misc").notNull().default(false),
});

// Labor estimation lines: trade/stage, hours, rate → computed cost at view time.
export const estimateLaborLinesTable = pgTable("estimate_labor_lines", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id")
    .notNull()
    .references(() => estimatesTable.id, { onDelete: "cascade" }),
  trade: text("trade").notNull(),
  hours: real("hours").notNull().default(0),
  hourlyRate: real("hourly_rate").notNull().default(0),
  notes: text("notes"),
  sortIndex: integer("sort_index").notNull().default(0),
});

// Per-company configurable labor rates (S&S estimates off weight/footage +
// judgment; other companies may differ — rates are data, not code).
export const laborRatesTable = pgTable(
  "labor_rates",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    trade: text("trade").notNull(),
    hourlyRate: real("hourly_rate").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("labor_rates_company_trade_unique").on(t.companyId, t.trade)],
);

export type EstimateBomAssembly =
  typeof estimateBomAssembliesTable.$inferSelect;
export type EstimateBomPart = typeof estimateBomPartsTable.$inferSelect;
export type EstimateLaborLine = typeof estimateLaborLinesTable.$inferSelect;
export type LaborRate = typeof laborRatesTable.$inferSelect;
