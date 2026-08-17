import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { jobsTable } from "./jobs";
import { drawingsTable, drawingRevisionsTable } from "./drawings";
import { usersTable } from "./users";

export const RFI_STATUSES = ["open", "pending", "closed"] as const;
export type RfiStatus = (typeof RFI_STATUSES)[number];

/** Request for Information — numbered RFI-YYYY-NNNN per company per year. */
export const rfisTable = pgTable(
  "rfis",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    drawingId: integer("drawing_id").references(() => drawingsTable.id, {
      onDelete: "set null",
    }),
    drawingRevisionId: integer("drawing_revision_id").references(
      () => drawingRevisionsTable.id,
      { onDelete: "set null" },
    ),
    question: text("question").notNull(),
    submittedBy: integer("submitted_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    directedTo: text("directed_to"),
    dueDate: date("due_date", { mode: "string" }),
    status: text("status").notNull().default("open"),
    responseText: text("response_text"),
    responseDate: date("response_date", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("rfis_company_number_unique").on(table.companyId, table.number),
    check(
      "rfis_status_valid",
      sql`${table.status} in ('open','pending','closed')`,
    ),
  ],
);

export const insertRfiSchema = createInsertSchema(rfisTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRfi = z.infer<typeof insertRfiSchema>;
export type Rfi = typeof rfisTable.$inferSelect;
