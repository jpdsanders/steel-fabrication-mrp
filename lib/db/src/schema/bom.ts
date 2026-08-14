import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";

export const bomAssembliesTable = pgTable("bom_assemblies", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  mark: text("mark").notNull(),
  quantity: integer("quantity").notNull().default(1),
  description: text("description"),
  finish: text("finish"),
  sortIndex: integer("sort_index").notNull().default(0),
  // Assembly tracking fields (Task #7 / #34)
  processingPath: text("processing_path"),
  currentStage: text("current_stage"),
  onHold: boolean("on_hold").notNull().default(false),
  notes: text("notes"),
  inspectedOn: text("inspected_on"),
  station: text("station"),
  inspector: text("inspector"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bomPartsTable = pgTable("bom_parts", {
  id: serial("id").primaryKey(),
  assemblyId: integer("assembly_id")
    .notNull()
    .references(() => bomAssembliesTable.id, { onDelete: "cascade" }),
  partMark: text("part_mark"),
  quantity: integer("quantity").notNull().default(1),
  profileType: text("profile_type"),
  profileSize: text("profile_size"),
  grade: text("grade"),
  lengthIn: real("length_in"),
  description: text("description"),
  heatNumber: text("heat_number"),
  sortIndex: integer("sort_index").notNull().default(0),
});

export const processingPathOptionsTable = pgTable("processing_path_options", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProcessingPathOption =
  typeof processingPathOptionsTable.$inferSelect;
export type BomAssembly = typeof bomAssembliesTable.$inferSelect;
export type BomPart = typeof bomPartsTable.$inferSelect;
