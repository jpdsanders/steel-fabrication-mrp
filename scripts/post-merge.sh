#!/bin/bash
set -e
pnpm install --frozen-lockfile

# One-time data migration: lengths moved from millimeters (length_mm) to
# inches (length_in). Rename the columns and convert values in place.
# Idempotent: only runs while the old column still exists.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'bom_parts' AND column_name = 'length_mm') THEN
    ALTER TABLE bom_parts RENAME COLUMN length_mm TO length_in;
    UPDATE bom_parts SET length_in = round((length_in / 25.4)::numeric, 2)
      WHERE length_in IS NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'purchase_order_lines' AND column_name = 'length_mm') THEN
    ALTER TABLE purchase_order_lines RENAME COLUMN length_mm TO length_in;
    UPDATE purchase_order_lines SET length_in = round((length_in / 25.4)::numeric, 2)
      WHERE length_in IS NOT NULL;
  END IF;
END $$;
SQL

# Migration: documents may now attach to a BOM part (MTR PDFs). drizzle-kit
# push adds the part_id column but silently leaves the modified CHECK
# constraint unchanged, so replace it here. Idempotent: only runs while the
# constraint definition still lacks part_id.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'part_id') THEN
    ALTER TABLE documents ADD COLUMN part_id integer
      REFERENCES bom_parts(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'documents_one_parent'
               AND pg_get_constraintdef(oid) NOT LIKE '%part_id%') THEN
    ALTER TABLE documents DROP CONSTRAINT documents_one_parent;
    ALTER TABLE documents ADD CONSTRAINT documents_one_parent
      CHECK (num_nonnulls(job_id, estimate_id, part_id) = 1);
  END IF;
END $$;
SQL

# Migration: jobs.job_number is now unique. drizzle-kit push cannot add the
# constraint non-interactively (it prompts to truncate the table), so create
# it here. Idempotent; dedupes any existing collisions by suffixing first.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_job_number_unique') THEN
    -- Dedupe collision-proof: suffix with id, extending until unused.
    DECLARE
      r RECORD;
      candidate text;
    BEGIN
      FOR r IN
        SELECT j.id, j.job_number FROM jobs j
        WHERE EXISTS (SELECT 1 FROM jobs o
                      WHERE o.job_number = j.job_number AND o.id < j.id)
        ORDER BY j.id
      LOOP
        candidate := r.job_number || '-' || r.id;
        WHILE EXISTS (SELECT 1 FROM jobs WHERE job_number = candidate) LOOP
          candidate := candidate || '-dup';
        END LOOP;
        UPDATE jobs SET job_number = candidate WHERE id = r.id;
      END LOOP;
    END;
    ALTER TABLE jobs ADD CONSTRAINT jobs_job_number_unique UNIQUE (job_number);
  END IF;
END $$;
SQL

# Migration (Phase 1 — document control): drizzle-kit push prompts interactively
# ("create or rename?") because user_sessions exists in the DB but not in the
# drizzle schema, so create the new tables here. Idempotent.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS drawings (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  drawing_number text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drawings_job_number_unique ON drawings (job_id, drawing_number);

CREATE TABLE IF NOT EXISTS drawing_revisions (
  id serial PRIMARY KEY,
  drawing_id integer NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  revision_label text NOT NULL,
  status text NOT NULL DEFAULT 'issued_for_approval',
  is_active boolean NOT NULL DEFAULT false,
  change_summary text,
  document_id integer NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  issued_by integer REFERENCES users(id) ON DELETE SET NULL,
  superseded_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT drawing_revisions_status_valid CHECK (status in ('issued_for_approval','approved','approved_as_noted','rejected_revise_resubmit','issued_for_fabrication','as_built_final'))
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_revisions_one_active ON drawing_revisions (drawing_id) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS drawing_revisions_label_unique ON drawing_revisions (drawing_id, revision_label);

CREATE TABLE IF NOT EXISTS drawing_acknowledgments (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawing_revision_id integer NOT NULL REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  acknowledged_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_acks_user_revision_unique ON drawing_acknowledgments (user_id, drawing_revision_id);

CREATE TABLE IF NOT EXISTS rfis (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  drawing_id integer REFERENCES drawings(id) ON DELETE SET NULL,
  drawing_revision_id integer REFERENCES drawing_revisions(id) ON DELETE SET NULL,
  question text NOT NULL,
  submitted_by integer REFERENCES users(id) ON DELETE SET NULL,
  directed_to text,
  due_date date,
  status text NOT NULL DEFAULT 'open',
  response_text text,
  response_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rfis_status_valid CHECK (status in ('open','pending','closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS rfis_company_number_unique ON rfis (company_id, number);

CREATE TABLE IF NOT EXISTS ecns (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source text NOT NULL,
  description text NOT NULL,
  affected_work text,
  cost_impact text,
  schedule_impact text,
  disposition text,
  status text NOT NULL DEFAULT 'open',
  approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ecns_source_valid CHECK (source in ('customer','internal','field')),
  CONSTRAINT ecns_disposition_valid CHECK (disposition is null or disposition in ('rework','scrap','fabricate_to_new_rev','no_impact')),
  CONSTRAINT ecns_status_valid CHECK (status in ('open','approved','closed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ecns_company_number_unique ON ecns (company_id, number);

CREATE TABLE IF NOT EXISTS ecn_affected_revisions (
  id serial PRIMARY KEY,
  ecn_id integer NOT NULL REFERENCES ecns(id) ON DELETE CASCADE,
  drawing_revision_id integer NOT NULL REFERENCES drawing_revisions(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ecn_affected_revisions_unique ON ecn_affected_revisions (ecn_id, drawing_revision_id);

CREATE TABLE IF NOT EXISTS transmittals (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sent_date date NOT NULL,
  sender_id integer REFERENCES users(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  purpose text NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT transmittals_purpose_valid CHECK (purpose in ('for_approval','for_record','for_construction','for_information','other'))
);

CREATE TABLE IF NOT EXISTS transmittal_items (
  id serial PRIMARY KEY,
  transmittal_id integer NOT NULL REFERENCES transmittals(id) ON DELETE CASCADE,
  document_id integer REFERENCES documents(id) ON DELETE CASCADE,
  drawing_revision_id integer REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  CONSTRAINT transmittal_items_one_target CHECK (num_nonnulls(document_id, drawing_revision_id) = 1)
);
SQL

# Phase 6 QC & shipping tables (idempotent).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS nonconformance_reports (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL,
  source text NOT NULL,
  description text NOT NULL,
  job_id integer REFERENCES jobs(id) ON DELETE CASCADE,
  assembly_id integer REFERENCES bom_assemblies(id) ON DELETE SET NULL,
  purchase_order_id integer REFERENCES purchase_orders(id) ON DELETE SET NULL,
  disposition text,
  disposition_notes text,
  root_cause text,
  approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamp with time zone,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamp with time zone,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ncrs_company_number_unique ON nonconformance_reports (company_id, number);

CREATE TABLE IF NOT EXISTS substitution_requests (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  number text NOT NULL,
  job_id integer REFERENCES jobs(id) ON DELETE CASCADE,
  assembly_id integer REFERENCES bom_assemblies(id) ON DELETE SET NULL,
  original_spec text NOT NULL,
  proposed_substitution text NOT NULL,
  type text NOT NULL,
  engineering_rationale text NOT NULL,
  customer_specified boolean NOT NULL DEFAULT false,
  safety_critical boolean NOT NULL DEFAULT false,
  customer_concurrence boolean NOT NULL DEFAULT false,
  concurrence_reference text,
  status text NOT NULL DEFAULT 'pending',
  approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamp with time zone,
  execution_reference text,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS substitution_requests_company_number_unique ON substitution_requests (company_id, number);

CREATE TABLE IF NOT EXISTS shipments (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  shipper_number text NOT NULL UNIQUE,
  carrier text,
  pickup_info text,
  notes text,
  status text NOT NULL DEFAULT 'planned',
  departed_at timestamp with time zone,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipment_assemblies (
  id serial PRIMARY KEY,
  shipment_id integer NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  assembly_id integer NOT NULL REFERENCES bom_assemblies(id) ON DELETE CASCADE
);
DROP INDEX IF EXISTS shipment_assemblies_unique;
CREATE UNIQUE INDEX IF NOT EXISTS shipment_assemblies_assembly_unique ON shipment_assemblies (assembly_id);

CREATE TABLE IF NOT EXISTS shipment_notifications (
  id serial PRIMARY KEY,
  shipment_id integer NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
  proposed_ship_date text NOT NULL,
  carrier text NOT NULL,
  notes text,
  notified_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS load_confirmations (
  id serial PRIMARY KEY,
  shipment_id integer NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
  signed_by text NOT NULL,
  signed_at timestamp with time zone NOT NULL DEFAULT now(),
  discrepancy_notes text
);
SQL

pnpm --filter @workspace/db run push-force

# Migration (Phase 5 — material nesting): create nesting tables. Idempotent.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS vendor_stock_lengths (
  id serial PRIMARY KEY,
  vendor_id integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  profile_type text,
  length_in real NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_stock_lengths_unique_idx
  ON vendor_stock_lengths (vendor_id, COALESCE(profile_type,''), length_in);

CREATE TABLE IF NOT EXISTS nesting_plans (
  id serial PRIMARY KEY,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  kerf_in real NOT NULL DEFAULT 0.25,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  accepted_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS nesting_plan_bars (
  id serial PRIMARY KEY,
  plan_id integer NOT NULL REFERENCES nesting_plans(id) ON DELETE CASCADE,
  profile_type text NOT NULL,
  profile_size text NOT NULL,
  grade text NOT NULL,
  source text NOT NULL DEFAULT 'stock',
  vendor_id integer REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name text,
  stock_length_in real NOT NULL,
  waste_in real NOT NULL,
  remnant_ref text,
  sort_index integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS nesting_plan_cuts (
  id serial PRIMARY KEY,
  bar_id integer NOT NULL REFERENCES nesting_plan_bars(id) ON DELETE CASCADE,
  bom_part_id integer REFERENCES bom_parts(id) ON DELETE SET NULL,
  length_in real NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  label text,
  sort_index integer NOT NULL DEFAULT 0
);
-- Drop and recreate the stock-length uniqueness index using COALESCE so that
-- a NULL profile_type (= "all profiles") is treated as a single value, not
-- as infinitely-many distinct NULLs.
DROP INDEX IF EXISTS vendor_stock_lengths_unique_idx;
CREATE UNIQUE INDEX vendor_stock_lengths_unique_idx
  ON vendor_stock_lengths (vendor_id, COALESCE(profile_type,''), length_in);
-- Enforce at most one accepted plan per job at the DB level (prevents concurrent-accept races)
CREATE UNIQUE INDEX IF NOT EXISTS nesting_plans_one_accepted_per_job
  ON nesting_plans (job_id) WHERE status = 'accepted';
SQL

# Seed the three companies + super-admin if missing (idempotent).
pnpm --filter @workspace/scripts run seed:companies
