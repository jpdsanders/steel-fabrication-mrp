import {
  pgTable,
  serial,
  integer,
  text,
  date,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";
import { documentsTable } from "./documents";
import { drawingRevisionsTable } from "./drawings";

export const TRANSMITTAL_PURPOSES = [
  "for_approval",
  "for_record",
  "for_construction",
  "for_information",
  "other",
] as const;

/** Transmittal log entry — who sent which documents/revisions to whom, and why. */
export const transmittalsTable = pgTable(
  "transmittals",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    sentDate: date("sent_date", { mode: "string" }).notNull(),
    senderId: integer("sender_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    recipient: text("recipient").notNull(),
    purpose: text("purpose").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "transmittals_purpose_valid",
      sql`${table.purpose} in ('for_approval','for_record','for_construction','for_information','other')`,
    ),
  ],
);

/** A document or drawing revision included in a transmittal (exactly one of the two). */
export const transmittalItemsTable = pgTable(
  "transmittal_items",
  {
    id: serial("id").primaryKey(),
    transmittalId: integer("transmittal_id")
      .notNull()
      .references(() => transmittalsTable.id, { onDelete: "cascade" }),
    documentId: integer("document_id").references(() => documentsTable.id, {
      onDelete: "cascade",
    }),
    drawingRevisionId: integer("drawing_revision_id").references(
      () => drawingRevisionsTable.id,
      { onDelete: "cascade" },
    ),
  },
  (table) => [
    check(
      "transmittal_items_one_target",
      sql`num_nonnulls(${table.documentId}, ${table.drawingRevisionId}) = 1`,
    ),
  ],
);

export const insertTransmittalSchema = createInsertSchema(
  transmittalsTable,
).omit({ id: true, createdAt: true });
export type InsertTransmittal = z.infer<typeof insertTransmittalSchema>;
export type Transmittal = typeof transmittalsTable.$inferSelect;
export type TransmittalItem = typeof transmittalItemsTable.$inferSelect;
