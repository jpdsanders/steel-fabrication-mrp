import { pgTable, serial, text, date, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const estimatesTable = pgTable("estimates", {
  id: serial("id").primaryKey(),
  bidNumber: text("bid_number").notNull(),
  name: text("name").notNull(),
  customer: text("customer").notNull(),
  status: text("status").notNull().default("draft"),
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
