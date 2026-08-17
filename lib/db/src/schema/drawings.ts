import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { documentsTable } from "./documents";
import { usersTable } from "./users";

/** A drawing identified by drawing number, tracked across its revision history. */
export const drawingsTable = pgTable(
  "drawings",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    drawingNumber: text("drawing_number").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("drawings_job_number_unique").on(
      table.jobId,
      table.drawingNumber,
    ),
  ],
);

export const DRAWING_REVISION_STATUSES = [
  "issued_for_approval",
  "approved",
  "approved_as_noted",
  "rejected_revise_resubmit",
  "issued_for_fabrication",
  "as_built_final",
] as const;
export type DrawingRevisionStatus = (typeof DRAWING_REVISION_STATUSES)[number];

/**
 * One revision of a drawing. Exactly one revision per drawing may be Active
 * (isActive = true) — enforced by a partial unique index and in route code.
 * Superseded revisions keep their row (never deleted) with supersededAt set.
 */
export const drawingRevisionsTable = pgTable(
  "drawing_revisions",
  {
    id: serial("id").primaryKey(),
    drawingId: integer("drawing_id")
      .notNull()
      .references(() => drawingsTable.id, { onDelete: "cascade" }),
    revisionLabel: text("revision_label").notNull(),
    status: text("status").notNull().default("issued_for_approval"),
    isActive: boolean("is_active").notNull().default(false),
    /** Required when this revision supersedes a prior Active revision. */
    changeSummary: text("change_summary"),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "restrict" }),
    issuedBy: integer("issued_by").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("drawing_revisions_one_active")
      .on(table.drawingId)
      .where(sql`${table.isActive} = true`),
    uniqueIndex("drawing_revisions_label_unique").on(
      table.drawingId,
      table.revisionLabel,
    ),
    check(
      "drawing_revisions_status_valid",
      sql`${table.status} in ('issued_for_approval','approved','approved_as_noted','rejected_revise_resubmit','issued_for_fabrication','as_built_final')`,
    ),
  ],
);

/** Per-user acknowledgment of a drawing revision — the blocking gate log. */
export const drawingAcknowledgmentsTable = pgTable(
  "drawing_acknowledgments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    drawingRevisionId: integer("drawing_revision_id")
      .notNull()
      .references(() => drawingRevisionsTable.id, { onDelete: "cascade" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("drawing_acks_user_revision_unique").on(
      table.userId,
      table.drawingRevisionId,
    ),
  ],
);

export const insertDrawingSchema = createInsertSchema(drawingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDrawing = z.infer<typeof insertDrawingSchema>;
export type Drawing = typeof drawingsTable.$inferSelect;

export const insertDrawingRevisionSchema = createInsertSchema(
  drawingRevisionsTable,
).omit({ id: true, createdAt: true });
export type InsertDrawingRevision = z.infer<
  typeof insertDrawingRevisionSchema
>;
export type DrawingRevision = typeof drawingRevisionsTable.$inferSelect;

export type DrawingAcknowledgment =
  typeof drawingAcknowledgmentsTable.$inferSelect;
