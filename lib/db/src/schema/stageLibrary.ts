import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

/**
 * Per-company production stage pipeline — the single source of truth for
 * the assembly-level pipeline (bom_assemblies.currentStage values are
 * validated against these rows).
 *
 * Invariants enforced at the DB level (see scripts/post-merge.sh DDL):
 * - at most one is_ready_to_ship_gate=true row per company (partial unique index)
 * - stage names unique per company (case-insensitive)
 */
export const stageLibraryTable = pgTable("stage_library", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  // "in_house" | "vendor"
  stageType: text("stage_type").notNull().default("in_house"),
  isReadyToShipGate: boolean("is_ready_to_ship_gate").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const STAGE_TYPES = ["in_house", "vendor"] as const;

export const insertStageLibrarySchema = createInsertSchema(
  stageLibraryTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertStageLibraryItem = z.infer<typeof insertStageLibrarySchema>;
export type StageLibraryItem = typeof stageLibraryTable.$inferSelect;
