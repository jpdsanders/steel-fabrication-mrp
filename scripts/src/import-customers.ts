import {
  db,
  pool,
  customersTable,
  contactsTable,
  customerAddressesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";

const BID_LOG = path.resolve(
  import.meta.dirname,
  "../../attached_assets/CURRENT_BID_LOG_1783531862157.xls",
);
const SHEETS = ["2026", "2025", "2024"];

type Extracted = {
  name: string;
  bidCount: number;
  contacts: Set<string>;
  addresses: Set<string>;
  phones: Set<string>;
  faxes: Set<string>;
};

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim();
}

function extract(): Extracted[] {
  const wb = XLSX.read(fs.readFileSync(BID_LOG), { type: "buffer" });
  const byKey = new Map<string, Extracted>();

  for (const sheetName of SHEETS) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const headerIdx = rows.findIndex(
      (r) => Array.isArray(r) && r.includes("Customer Name"),
    );
    if (headerIdx === -1) continue;
    const header = rows[headerIdx] as string[];
    const col = (label: string) => header.indexOf(label);
    const ci = col("Customer Name");
    const co = col("Contact");
    const da = col("Delivery Address");
    const ph = col("Phone #");
    const fx = col("Fax #");

    for (const row of rows.slice(headerIdx + 1)) {
      if (!Array.isArray(row)) continue;
      const name = clean(row[ci]);
      if (name.length < 2) continue;
      const key = name.toLowerCase();
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          name,
          bidCount: 0,
          contacts: new Set(),
          addresses: new Set(),
          phones: new Set(),
          faxes: new Set(),
        };
        byKey.set(key, entry);
      }
      entry.bidCount++;
      const contact = co >= 0 ? clean(row[co]) : "";
      if (contact.length >= 2 && contact.length <= 40 && !/\d/.test(contact))
        entry.contacts.add(contact);
      const address = da >= 0 ? clean(row[da]) : "";
      if (address.length >= 2) entry.addresses.add(address);
      const phone = ph >= 0 ? clean(row[ph]) : "";
      if (phone.length >= 7) entry.phones.add(phone);
      const fax = fx >= 0 ? clean(row[fx]) : "";
      if (fax.length >= 7) entry.faxes.add(fax);
    }
  }

  return [...byKey.values()].sort((a, b) => b.bidCount - a.bidCount);
}

async function main() {
  const extracted = extract();
  console.log(
    `Extracted ${extracted.length} distinct customers from bid log sheets ${SHEETS.join(", ")}.`,
  );

  const existing = await db.select().from(customersTable);
  const existingByName = new Map(
    existing.map((c) => [c.name.trim().toLowerCase(), c]),
  );

  let created = 0;
  let updated = 0;
  let contactsAdded = 0;
  let addressesAdded = 0;

  for (const e of extracted) {
    const key = e.name.toLowerCase();
    const addresses = [...e.addresses];

    // Dedupe contact name variants case-insensitively.
    const contactNames = new Map<string, string>();
    for (const c of e.contacts) {
      const ck = c.toLowerCase();
      if (!contactNames.has(ck)) contactNames.set(ck, c);
    }

    await db.transaction(async (tx) => {
      let customerId: number;
      const existingCustomer = existingByName.get(key);
      if (existingCustomer) {
        customerId = existingCustomer.id;
        updated++;
      } else {
        const [customer] = await tx
          .insert(customersTable)
          .values({
            name: e.name,
            phone: [...e.phones][0] ?? null,
            fax: [...e.faxes][0] ?? null,
            defaultDeliveryAddress: addresses[0] ?? null,
            status: "active",
            notes: `Imported from bid log (${e.bidCount} bid${e.bidCount === 1 ? "" : "s"} 2024-2026).`,
          })
          .returning();
        customerId = customer.id;
        existingByName.set(key, customer);
        created++;
      }

      // Reconcile contacts/addresses idempotently (add only what's missing).
      const existingContacts = await tx
        .select()
        .from(contactsTable)
        .where(eq(contactsTable.customerId, customerId));
      const haveContact = new Set(
        existingContacts.map((c) => c.name.trim().toLowerCase()),
      );
      let hasPrimary = existingContacts.some((c) => c.isPrimary);
      for (const name of contactNames.values()) {
        if (haveContact.has(name.toLowerCase())) continue;
        await tx.insert(contactsTable).values({
          customerId,
          name,
          isPrimary: !hasPrimary,
        });
        hasPrimary = true;
        contactsAdded++;
      }

      const existingAddresses = await tx
        .select()
        .from(customerAddressesTable)
        .where(eq(customerAddressesTable.customerId, customerId));
      const haveAddress = new Set(
        existingAddresses.map((a) => a.address.trim().toLowerCase()),
      );
      for (const address of addresses) {
        if (haveAddress.has(address.toLowerCase())) continue;
        await tx.insert(customerAddressesTable).values({
          customerId,
          label: "Delivery",
          address,
        });
        addressesAdded++;
      }
    });
  }

  console.log(
    `Done. Created ${created} customer(s), reconciled ${updated} existing, added ${contactsAdded} contact(s) and ${addressesAdded} delivery address(es).`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
