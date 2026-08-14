import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { stagesTable } from "./stages";
import { employeesTable } from "./employees";

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  stageId: integer("stage_id")
    .notNull()
    .references(() => stagesTable.id, { onDelete: "cascade" }),
  clockIn: timestamp("clock_in", { withTimezone: true }).notNull().defaultNow(),
  clockOut: timestamp("clock_out", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;
