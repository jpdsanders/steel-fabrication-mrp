import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  real,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

export const stagesTable = pgTable("stages", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  status: text("status").notNull().default("not_started"),
  estimatedHours: real("estimated_hours").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertStageSchema = createInsertSchema(stagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStage = z.infer<typeof insertStageSchema>;
export type Stage = typeof stagesTable.$inferSelect;
