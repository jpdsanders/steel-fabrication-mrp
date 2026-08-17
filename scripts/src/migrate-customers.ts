import { db, pool, jobsTable, customersTable, companiesTable } from "@workspace/db";
import { eq, isNull, and, ne } from "drizzle-orm";

async function main() {
  // migrate-customers links jobs to customer rows; new customers belong to S&S Steel
  const [ssSteelCo] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.slug, "ss-steel"))
    .limit(1);
  if (!ssSteelCo) {
    throw new Error("S&S Steel company not found. Run `pnpm --filter @workspace/scripts run seed:companies` first.");
  }
  const companyId = ssSteelCo.id;

  const orphanJobs = await db
    .select()
    .from(jobsTable)
    .where(and(isNull(jobsTable.customerId), ne(jobsTable.customer, "")));

  if (orphanJobs.length === 0) {
    console.log("No jobs need migration — all jobs are linked to customers.");
    await pool.end();
    return;
  }

  console.log(`Found ${orphanJobs.length} job(s) with unlinked customer text.`);

  const existing = await db.select().from(customersTable);
  const idByName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c.id]));

  let created = 0;
  let linked = 0;
  for (const job of orphanJobs) {
    const name = job.customer.trim();
    const key = name.toLowerCase();
    let customerId = idByName.get(key);
    if (customerId === undefined) {
      const [customer] = await db
        .insert(customersTable)
        .values({ companyId, name, status: "active" })
        .returning();
      customerId = customer.id;
      idByName.set(key, customerId);
      created++;
      console.log(`Created customer "${name}" (id ${customerId})`);
    }
    await db
      .update(jobsTable)
      .set({ customerId })
      .where(eq(jobsTable.id, job.id));
    linked++;
    console.log(`Linked job ${job.jobNumber} -> customer "${name}"`);
  }

  console.log(`Done. Created ${created} customer(s), linked ${linked} job(s).`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
