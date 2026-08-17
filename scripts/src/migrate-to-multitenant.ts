/**
 * migrate-to-multitenant.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One-time migration: safely add multi-company support to a populated database.
 *
 * Run this INSTEAD OF `drizzle-kit push` when you have existing production data
 * that must not be truncated. It executes atomically inside a single transaction:
 *
 *   1. Create the `companies` and `users`/`user_company_roles` tables if missing.
 *   2. Upsert the three initial companies (S&S Steel, St. George, Exclusive Metals).
 *   3. Add nullable `company_id` columns to every tenant-scoped table (idempotent).
 *   4. Backfill all rows in those tables to S&S Steel.
 *   5. Apply NOT NULL constraints and FK references to `companies`.
 *   6. Create the `user_sessions` table (session store).
 *   7. Create remaining new tables: material_catalog, job_handoffs, job_handoff_documents.
 *
 * The migration is idempotent — you can run it multiple times safely. Each step
 * checks column/table existence before executing DDL.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate:multitenant
 */

import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = ${table}
      AND column_name  = ${column}
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function constraintExists(table: string, constraint: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema   = 'public'
      AND table_name     = ${table}
      AND constraint_name = ${constraint}
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function main() {
  console.log("=== Phase 0 multi-tenant migration ===\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Create companies table (if missing)
    // ─────────────────────────────────────────────────────────────────────────
    if (!(await tableExists("companies"))) {
      console.log("Creating companies table...");
      await client.query(`
        CREATE TABLE companies (
          id            SERIAL PRIMARY KEY,
          name          TEXT NOT NULL,
          slug          TEXT NOT NULL UNIQUE,
          logo_url      TEXT,
          primary_color TEXT,
          accent_color  TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else {
      console.log("companies table already exists — skipping create.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Create users table (if missing)
    // ─────────────────────────────────────────────────────────────────────────
    if (!(await tableExists("users"))) {
      console.log("Creating users table...");
      await client.query(`
        CREATE TABLE users (
          id            SERIAL PRIMARY KEY,
          email         TEXT NOT NULL UNIQUE,
          name          TEXT NOT NULL DEFAULT '',
          password_hash TEXT NOT NULL,
          super_admin   BOOLEAN NOT NULL DEFAULT FALSE,
          active        BOOLEAN NOT NULL DEFAULT TRUE,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else {
      console.log("users table already exists — skipping create.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Create user_company_roles table (if missing)
    // ─────────────────────────────────────────────────────────────────────────
    if (!(await tableExists("user_company_roles"))) {
      console.log("Creating user_company_roles table...");
      await client.query(`
        CREATE TABLE user_company_roles (
          id          SERIAL PRIMARY KEY,
          user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          role        TEXT    NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, company_id, role)
        )
      `);
    } else {
      console.log("user_company_roles table already exists — skipping create.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Upsert the three initial companies
    // ─────────────────────────────────────────────────────────────────────────
    console.log("Upserting initial companies...");
    const { rows: companyRows } = await client.query<{ id: number; slug: string }>(`
      INSERT INTO companies (name, slug)
      VALUES
        ('S&S Steel', 'ss-steel'),
        ('St. George Steel', 'stg-steel'),
        ('Exclusive Metals', 'exclusive-metals')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, slug
    `);
    const ssSteelId = companyRows.find((r) => r.slug === "ss-steel")?.id;
    if (!ssSteelId) throw new Error("Failed to upsert S&S Steel company");
    console.log(`  S&S Steel id=${ssSteelId}`);

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Add nullable company_id to each tenant-scoped table, then backfill,
    //    then enforce NOT NULL + FK constraint.
    // ─────────────────────────────────────────────────────────────────────────
    const tenantTables = [
      "jobs",
      "estimates",
      "customers",
      "employees",
      "stage_library",
    ] as const;

    for (const tbl of tenantTables) {
      const colExists = await columnExists(tbl, "company_id");
      if (!colExists) {
        console.log(`  ${tbl}: adding nullable company_id column...`);
        await client.query(`ALTER TABLE ${tbl} ADD COLUMN company_id INTEGER`);
      }

      // Backfill all rows that don't yet have a company_id
      const { rowCount } = await client.query(
        `UPDATE ${tbl} SET company_id = $1 WHERE company_id IS NULL`,
        [ssSteelId],
      );
      if (rowCount && rowCount > 0) {
        console.log(`  ${tbl}: backfilled ${rowCount} row(s) → company_id=${ssSteelId}`);
      }

      // Enforce NOT NULL
      const notNullResult = await client.query<{ is_nullable: string }>(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_id'
      `, [tbl]);
      if (notNullResult.rows[0]?.is_nullable === "YES") {
        console.log(`  ${tbl}: setting company_id NOT NULL...`);
        await client.query(`ALTER TABLE ${tbl} ALTER COLUMN company_id SET NOT NULL`);
      }

      // Add FK constraint (idempotent)
      const fkName = `${tbl}_company_id_fkey`;
      if (!(await constraintExists(tbl, fkName))) {
        console.log(`  ${tbl}: adding FK → companies(id)...`);
        await client.query(
          `ALTER TABLE ${tbl} ADD CONSTRAINT ${fkName} FOREIGN KEY (company_id) REFERENCES companies(id)`,
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Create session store table
    // ─────────────────────────────────────────────────────────────────────────
    if (!(await tableExists("user_sessions"))) {
      console.log("Creating user_sessions table...");
      await client.query(`
        CREATE TABLE user_sessions (
          sid     TEXT       NOT NULL PRIMARY KEY,
          sess    JSONB      NOT NULL,
          expire  TIMESTAMPTZ NOT NULL
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire)`);
    } else {
      console.log("user_sessions table already exists — skipping create.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Create material_catalog table (shared, no company_id by design)
    // ─────────────────────────────────────────────────────────────────────────
    if (!(await tableExists("material_catalog"))) {
      console.log("Creating material_catalog table...");
      await client.query(`
        CREATE TABLE material_catalog (
          id           SERIAL PRIMARY KEY,
          profile_type TEXT    NOT NULL,
          profile_size TEXT    NOT NULL,
          grade        TEXT    NOT NULL,
          unit_price   NUMERIC(12,4),
          unit         TEXT    NOT NULL DEFAULT 'ft',
          notes        TEXT,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by   INTEGER REFERENCES users(id),
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(profile_type, profile_size, grade)
        )
      `);
    } else {
      console.log("material_catalog table already exists — skipping create.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Create job_handoffs + job_handoff_documents tables
    // ─────────────────────────────────────────────────────────────────────────
    if (!(await tableExists("job_handoffs"))) {
      console.log("Creating job_handoffs table...");
      await client.query(`
        CREATE TABLE job_handoffs (
          id                    SERIAL PRIMARY KEY,
          source_company_id     INTEGER NOT NULL REFERENCES companies(id),
          source_job_id         INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
          destination_company_id INTEGER NOT NULL REFERENCES companies(id),
          destination_job_id    INTEGER NOT NULL REFERENCES jobs(id),
          transmittal_ref       TEXT,
          notes                 TEXT,
          pushed_by_user_id     INTEGER REFERENCES users(id),
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else {
      console.log("job_handoffs table already exists — skipping create.");
    }

    if (!(await tableExists("job_handoff_documents"))) {
      console.log("Creating job_handoff_documents table...");
      await client.query(`
        CREATE TABLE job_handoff_documents (
          id                      SERIAL PRIMARY KEY,
          handoff_id              INTEGER NOT NULL REFERENCES job_handoffs(id) ON DELETE CASCADE,
          source_document_id      INTEGER REFERENCES documents(id) ON DELETE SET NULL,
          destination_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
          created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else {
      console.log("job_handoff_documents table already exists — skipping create.");
    }

    await client.query("COMMIT");
    console.log("\n✓ Migration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
