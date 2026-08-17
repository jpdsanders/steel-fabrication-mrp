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

/**
 * Per-company configurable library of standard PO quality clauses
 * (CMTR required, marking requirements, packaging, right of inspection, ...).
 * Attachable to a whole PO or to individual PO lines via id arrays.
 */
export const qualityClausesTable = pgTable(
  "quality_clauses",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("quality_clauses_company_code_idx").on(
      table.companyId,
      table.code,
    ),
  ],
);

export type QualityClauseRow = typeof qualityClausesTable.$inferSelect;
