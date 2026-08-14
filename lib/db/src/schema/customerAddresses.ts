import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const customerAddressesTable = pgTable("customer_addresses", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  address: text("address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCustomerAddressSchema = createInsertSchema(
  customerAddressesTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertCustomerAddress = z.infer<
  typeof insertCustomerAddressSchema
>;
export type CustomerAddress = typeof customerAddressesTable.$inferSelect;
