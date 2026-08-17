import {
  pgTable,
  serial,
  text,
  real,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Shared material catalog — NOT company-scoped. Visible and editable from every company.
// A "stale" entry is one whose unitPrice has not been updated in 90+ days (computed at query time).
export const materialCatalogTable = pgTable("material_catalog", {
  id: serial("id").primaryKey(),
  profileType: text("profile_type").notNull(),
  profileSize: text("profile_size").notNull(),
  grade: text("grade").notNull(),
  unitPrice: real("unit_price"), // nullable = unpriced
  priceUnit: text("price_unit").notNull().default("per_foot"), // per_foot | per_piece | per_lb
  notes: text("notes"),
  updatedByUserId: integer("updated_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertMaterialCatalogSchema = createInsertSchema(
  materialCatalogTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMaterialCatalog = z.infer<typeof insertMaterialCatalogSchema>;
export type MaterialCatalogItem = typeof materialCatalogTable.$inferSelect;
