import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const stageLibraryTable = pgTable("stage_library", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertStageLibrarySchema = createInsertSchema(
  stageLibraryTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertStageLibraryItem = z.infer<typeof insertStageLibrarySchema>;
export type StageLibraryItem = typeof stageLibraryTable.$inferSelect;
