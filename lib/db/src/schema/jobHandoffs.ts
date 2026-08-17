import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";
import { documentsTable } from "./documents";

export const jobHandoffsTable = pgTable("job_handoffs", {
  id: serial("id").primaryKey(),
  sourceCompanyId: integer("source_company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  // OPEN QUESTION: see OPEN_QUESTIONS.md — whether the handoff preserves a
  // reference link back to the originating job, or is a clean one-way copy.
  // Nullable FK exists structurally; no UI/reporting built on it.
  sourceJobId: integer("source_job_id").references(() => jobsTable.id, {
    onDelete: "set null",
  }),
  destinationCompanyId: integer("destination_company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  destinationJobId: integer("destination_job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  transmittalRef: text("transmittal_ref"),
  notes: text("notes"),
  pushedByUserId: integer("pushed_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobHandoffDocumentsTable = pgTable("job_handoff_documents", {
  id: serial("id").primaryKey(),
  handoffId: integer("handoff_id")
    .notNull()
    .references(() => jobHandoffsTable.id, { onDelete: "cascade" }),
  sourceDocumentId: integer("source_document_id").references(
    () => documentsTable.id,
    { onDelete: "set null" },
  ),
  destinationDocumentId: integer("destination_document_id").references(
    () => documentsTable.id,
    { onDelete: "set null" },
  ),
});

export type JobHandoff = typeof jobHandoffsTable.$inferSelect;
export type JobHandoffDocument = typeof jobHandoffDocumentsTable.$inferSelect;
