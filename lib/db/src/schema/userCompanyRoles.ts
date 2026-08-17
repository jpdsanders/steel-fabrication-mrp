import {
  pgTable,
  serial,
  integer,
  text,
  uniqueIndex,
  timestamp,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

export const COMPANY_ROLES = [
  "admin",
  "estimator",
  "doc_control",
  "purchasing",
  "shop_foreman",
  "qc",
  "shipping",
] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const userCompanyRolesTable = pgTable(
  "user_company_roles",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_company_roles_unique").on(
      table.userId,
      table.companyId,
      table.role,
    ),
  ],
);

export type UserCompanyRole = typeof userCompanyRolesTable.$inferSelect;
