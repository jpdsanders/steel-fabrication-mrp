/**
 * Seed the three initial companies and the super-admin user (Jonah).
 * Run: pnpm --filter @workspace/scripts run seed:companies
 *
 * Idempotent — will not duplicate companies or the admin user.
 */
import { db, pool } from "@workspace/db";
import {
  companiesTable,
  usersTable,
  userCompanyRolesTable,
  stageLibraryTable,
} from "@workspace/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const COMPANIES = [
  {
    name: "S&S Steel",
    slug: "ss-steel",
    primaryColor: "#1e3a5f",
    accentColor: "#f97316",
  },
  {
    name: "St. George Steel",
    slug: "stg-steel",
    primaryColor: "#1e3a5f",
    accentColor: "#22c55e",
  },
  {
    name: "Exclusive Metals",
    slug: "exclusive-metals",
    primaryColor: "#1a1a2e",
    accentColor: "#e94560",
  },
];

const DEFAULT_STAGE_LIBRARY = [
  "Estimating",
  "Fabrication",
  "Welding",
  "Paint",
  "Inspection",
  "Shipping",
];

async function main() {
  console.log("Seeding companies and super-admin...");

  // Insert companies (idempotent via slug)
  const insertedCompanies: { id: number; name: string; slug: string }[] = [];
  for (const co of COMPANIES) {
    const [existing] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.slug, co.slug));
    if (existing) {
      console.log(`  Company already exists: ${co.name}`);
      insertedCompanies.push(existing);
    } else {
      const [created] = await db.insert(companiesTable).values(co).returning();
      console.log(`  Created company: ${co.name} (id=${created.id})`);
      insertedCompanies.push(created);
    }
  }

  // Seed default stage library for each company
  for (const co of insertedCompanies) {
    const existing = await db
      .select()
      .from(stageLibraryTable)
      .where(eq(stageLibraryTable.companyId, co.id));
    if (existing.length === 0) {
      await db.insert(stageLibraryTable).values(
        DEFAULT_STAGE_LIBRARY.map((name) => ({ companyId: co.id, name })),
      );
      console.log(`  Seeded stage library for ${co.name}`);
    }
  }

  // Create super-admin user
  // Bootstrap password: use SEED_ADMIN_PASSWORD env var if set, otherwise generate a
  // random credential and print it once.  Never hard-code a fixed password.
  const adminEmail = "jsanders@exclusivefab.com";
  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, adminEmail));

  if (existingUser) {
    console.log(`  Super-admin already exists: ${adminEmail}`);
  } else {
    // Use env var if provided, otherwise generate a random one-time password.
    const envPw = process.env.SEED_ADMIN_PASSWORD;
    const defaultPassword = envPw && envPw.length >= 12
      ? envPw
      : Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#"[b % 64])
          .join("");
    const passwordHash = await bcrypt.hash(defaultPassword, 12);
    const [admin] = await db
      .insert(usersTable)
      .values({
        email: adminEmail,
        name: "Jonah Sanders",
        passwordHash,
        superAdmin: true,
        active: true,
      })
      .returning();
    console.log(`  Created super-admin: ${adminEmail} (id=${admin.id})`);
    if (!envPw) {
      console.log(`  One-time bootstrap password: ${defaultPassword}`);
      console.log("  ⚠  Save this — it will NOT be shown again. Change it after first login.");
    }
  }

  console.log("\nDone. Companies and super-admin are ready.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
