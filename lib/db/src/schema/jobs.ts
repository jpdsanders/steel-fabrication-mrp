import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  jobNumber: text("job_number").notNull().unique(),
  name: text("name").notNull(),
  customer: text("customer").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id, {
    onDelete: "set null",
  }),
  customerPo: text("customer_po"),
  status: text("status").notNull().default("active"),
  dueDate: date("due_date", { mode: "string" }),
  notes: text("notes"),
  estimateId: integer("estimate_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
