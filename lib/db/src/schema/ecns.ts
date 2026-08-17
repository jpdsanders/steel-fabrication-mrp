import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { jobsTable } from "./jobs";
import { drawingRevisionsTable } from "./drawings";
import { usersTable } from "./users";

export const ECN_SOURCES = ["customer", "internal", "field"] as const;
export const ECN_DISPOSITIONS = [
  "rework",
  "scrap",
  "fabricate_to_new_rev",
  "no_impact",
] as const;
export const ECN_STATUSES = ["open", "approved", "closed"] as const;

/** Engineering Change Notice — numbered ECN-YYYY-NNNN per company per year. */
export const ecnsTable = pgTable(
  "ecns",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    description: text("description").notNull(),
    /** Free-text note on affected in-process work. */
    affectedWork: text("affected_work"),
    costImpact: text("cost_impact"),
    scheduleImpact: text("schedule_impact"),
    disposition: text("disposition"),
    status: text("status").notNull().default("open"),
    approvedBy: integer("approved_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("ecns_company_number_unique").on(table.companyId, table.number),
    check(
      "ecns_source_valid",
      sql`${table.source} in ('customer','internal','field')`,
    ),
    check(
      "ecns_disposition_valid",
      sql`${table.disposition} is null or ${table.disposition} in ('rework','scrap','fabricate_to_new_rev','no_impact')`,
    ),
    check(
      "ecns_status_valid",
      sql`${table.status} in ('open','approved','closed')`,
    ),
  ],
);

/** Join: which drawing revisions an ECN affects. */
export const ecnAffectedRevisionsTable = pgTable(
  "ecn_affected_revisions",
  {
    id: serial("id").primaryKey(),
    ecnId: integer("ecn_id")
      .notNull()
      .references(() => ecnsTable.id, { onDelete: "cascade" }),
    drawingRevisionId: integer("drawing_revision_id")
      .notNull()
      .references(() => drawingRevisionsTable.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("ecn_affected_revisions_unique").on(
      table.ecnId,
      table.drawingRevisionId,
    ),
  ],
);

export const insertEcnSchema = createInsertSchema(ecnsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEcn = z.infer<typeof insertEcnSchema>;
export type Ecn = typeof ecnsTable.$inferSelect;
