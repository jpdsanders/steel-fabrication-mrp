import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { employeesTable } from "./employees";

export const jobAssignmentsTable = pgTable(
  "job_assignments",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("job_assignments_job_employee_unique").on(t.jobId, t.employeeId)],
);

export type JobAssignment = typeof jobAssignmentsTable.$inferSelect;
