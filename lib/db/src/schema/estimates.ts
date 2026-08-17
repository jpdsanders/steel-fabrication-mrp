import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  bidNumber: text("bid_number").notNull(),
  name: text("name").notNull(),
  customer: text("customer").notNull(),
  status: text("status").notNull().default("draft"),
  // Internal enum values only — user-facing labels are routed through a
  // swappable display constant in the frontend.
  // OPEN QUESTION: see OPEN_QUESTIONS.md (#2 — user-facing type names)
  type: text("type").notNull().default("preliminary"), // preliminary | detailed
  marginPercent: real("margin_percent").notNull().default(0),
  quoteFormat: text("quote_format").notNull().default("summary"), // itemized | summary
  estimatedHours: real("estimated_hours").notNull().default(0),
  amount: real("amount"),
  bidDate: date("bid_date", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertEstimateSchema = createInsertSchema(estimatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimatesTable.$inferSelect;
