import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { estimatesTable } from "./estimates";
import { bomPartsTable } from "./bom";

export const documentsTable = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").references(() => jobsTable.id, {
      onDelete: "cascade",
    }),
    estimateId: integer("estimate_id").references(() => estimatesTable.id, {
      onDelete: "cascade",
    }),
    partId: integer("part_id").references(() => bomPartsTable.id, {
      onDelete: "cascade",
    }),
    filename: text("filename").notNull(),
    category: text("category").notNull().default("other"),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "documents_one_parent",
      sql`num_nonnulls(${table.jobId}, ${table.estimateId}, ${table.partId}) = 1`,
    ),
  ],
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  uploadedAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
