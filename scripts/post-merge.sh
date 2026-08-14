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

pnpm --filter @workspace/db run push
