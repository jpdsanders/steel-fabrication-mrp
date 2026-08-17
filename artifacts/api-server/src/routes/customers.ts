import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  customersTable,
  contactsTable,
  customerAddressesTable,
  jobsTable,
} from "@workspace/db";
import { eq, and, ilike, or, type SQL } from "drizzle-orm";
import {
  ListCustomersQueryParams,
  CreateCustomerBody,
  UpdateCustomerBody,
  CreateContactBody,
  UpdateContactBody,
  CreateCustomerAddressBody,
  UpdateCustomerAddressBody,
} from "@workspace/api-zod";
import { getJobsList } from "../services/production";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

type CustomerRow = typeof customersTable.$inferSelect;
type ContactRow = typeof contactsTable.$inferSelect;
type AddressRow = typeof customerAddressesTable.$inferSelect;

function customerView(c: CustomerRow) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    fax: c.fax,
    email: c.email,
    website: c.website,
    billingAddress: c.billingAddress,
    defaultDeliveryAddress: c.defaultDeliveryAddress,
    industry: c.industry,
    status: c.status,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function contactView(c: ContactRow) {
  return {
    id: c.id,
    customerId: c.customerId,
    name: c.name,
    title: c.title,
    phone: c.phone,
    mobile: c.mobile,
    fax: c.fax,
    email: c.email,
    isPrimary: c.isPrimary,
    createdAt: c.createdAt.toISOString(),
  };
}

function addressView(a: AddressRow) {
  return {
    id: a.id,
    customerId: a.customerId,
    label: a.label,
    address: a.address,
    createdAt: a.createdAt.toISOString(),
  };
}

async function findCustomer(customerId: number, companyId: number): Promise<CustomerRow | null> {
  const [row] = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.companyId, companyId)));
  return row ?? null;
}

router.get("/customers", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const query = ListCustomersQueryParams.parse(req.query);
  const conditions: SQL[] = [eq(customersTable.companyId, companyId)];
  if (query.status) conditions.push(eq(customersTable.status, query.status));
  if (query.search) {
    const term = `%${query.search}%`;
    const match = or(
      ilike(customersTable.name, term),
      ilike(customersTable.industry, term),
      ilike(customersTable.email, term),
    );
    if (match) conditions.push(match);
  }
  const rows = await db
    .select()
    .from(customersTable)
    .where(and(...conditions))
    .orderBy(customersTable.name);
  res.json(rows.map(customerView));
});

router.post("/customers", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateCustomerBody.parse(req.body);
  const [row] = await db
    .insert(customersTable)
    .values({
      companyId,
      name: body.name,
      phone: body.phone ?? null,
      fax: body.fax ?? null,
      email: body.email ?? null,
      website: body.website ?? null,
      billingAddress: body.billingAddress ?? null,
      defaultDeliveryAddress: body.defaultDeliveryAddress ?? null,
      industry: body.industry ?? null,
      status: body.status ?? "active",
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(customerView(row));
});

router.get("/customers/:customerId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const customerId = parseIntParam(req.params.customerId);
  if (customerId === null) { res.status(400).json({ error: "Invalid customer id" }); return; }
  const customer = await findCustomer(customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [contacts, addresses, jobRows] = await Promise.all([
    db.select().from(contactsTable).where(eq(contactsTable.customerId, customerId)).orderBy(contactsTable.createdAt),
    db.select().from(customerAddressesTable).where(eq(customerAddressesTable.customerId, customerId)).orderBy(customerAddressesTable.createdAt),
    db.select().from(jobsTable).where(and(eq(jobsTable.customerId, customerId), eq(jobsTable.companyId, companyId))).orderBy(jobsTable.createdAt),
  ]);
  const jobs = await getJobsList(jobRows);
  res.json({
    customer: customerView(customer),
    contacts: contacts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map(contactView),
    addresses: addresses.map(addressView),
    jobs,
  });
});

router.patch("/customers/:customerId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const customerId = parseIntParam(req.params.customerId);
  if (customerId === null) { res.status(400).json({ error: "Invalid customer id" }); return; }
  const body = UpdateCustomerBody.parse(req.body);
  const existing = await findCustomer(customerId, companyId);
  if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }
  const [row] = await db.update(customersTable).set(body).where(eq(customersTable.id, customerId)).returning();
  if (body.name && body.name !== existing.name) {
    await db.update(jobsTable).set({ customer: body.name }).where(and(eq(jobsTable.customerId, customerId), eq(jobsTable.companyId, companyId)));
  }
  res.json(customerView(row));
});

router.delete("/customers/:customerId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const customerId = parseIntParam(req.params.customerId);
  if (customerId === null) { res.status(400).json({ error: "Invalid customer id" }); return; }
  const existing = await findCustomer(customerId, companyId);
  if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }
  const linkedJobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.customerId, customerId), eq(jobsTable.companyId, companyId)));
  if (linkedJobs.length > 0) {
    res.status(409).json({ error: `Customer has ${linkedJobs.length} linked job(s). Reassign or delete them first.` }); return;
  }
  await db.delete(customersTable).where(eq(customersTable.id, customerId));
  res.status(204).send();
});

router.post("/customers/:customerId/contacts", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const customerId = parseIntParam(req.params.customerId);
  if (customerId === null) { res.status(400).json({ error: "Invalid customer id" }); return; }
  const body = CreateContactBody.parse(req.body);
  const customer = await findCustomer(customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  if (body.isPrimary) {
    await db.update(contactsTable).set({ isPrimary: false }).where(eq(contactsTable.customerId, customerId));
  }
  const [row] = await db
    .insert(contactsTable)
    .values({ customerId, name: body.name, title: body.title ?? null, phone: body.phone ?? null, mobile: body.mobile ?? null, fax: body.fax ?? null, email: body.email ?? null, isPrimary: body.isPrimary ?? false })
    .returning();
  res.status(201).json(contactView(row));
});

router.patch("/contacts/:contactId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const contactId = parseIntParam(req.params.contactId);
  if (contactId === null) { res.status(400).json({ error: "Invalid contact id" }); return; }
  const body = UpdateContactBody.parse(req.body);
  const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (!existing) { res.status(404).json({ error: "Contact not found" }); return; }
  // Verify customer belongs to company
  const customer = await findCustomer(existing.customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Contact not found" }); return; }
  if (body.isPrimary) {
    await db.update(contactsTable).set({ isPrimary: false }).where(eq(contactsTable.customerId, existing.customerId));
  }
  await db.update(contactsTable).set(body).where(eq(contactsTable.id, contactId));
  const [row] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  res.json(contactView(row));
});

router.delete("/contacts/:contactId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const contactId = parseIntParam(req.params.contactId);
  if (contactId === null) { res.status(400).json({ error: "Invalid contact id" }); return; }
  const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (!existing) { res.status(404).json({ error: "Contact not found" }); return; }
  const customer = await findCustomer(existing.customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Contact not found" }); return; }
  await db.delete(contactsTable).where(eq(contactsTable.id, contactId));
  res.status(204).send();
});

router.post("/customers/:customerId/addresses", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const customerId = parseIntParam(req.params.customerId);
  if (customerId === null) { res.status(400).json({ error: "Invalid customer id" }); return; }
  const body = CreateCustomerAddressBody.parse(req.body);
  const customer = await findCustomer(customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  const [row] = await db
    .insert(customerAddressesTable)
    .values({ customerId, label: body.label ?? null, address: body.address })
    .returning();
  res.status(201).json(addressView(row));
});

router.patch("/addresses/:addressId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const addressId = parseIntParam(req.params.addressId);
  if (addressId === null) { res.status(400).json({ error: "Invalid address id" }); return; }
  const body = UpdateCustomerAddressBody.parse(req.body);
  const [existing] = await db.select().from(customerAddressesTable).where(eq(customerAddressesTable.id, addressId));
  if (!existing) { res.status(404).json({ error: "Address not found" }); return; }
  const customer = await findCustomer(existing.customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Address not found" }); return; }
  await db.update(customerAddressesTable).set(body).where(eq(customerAddressesTable.id, addressId));
  const [row] = await db.select().from(customerAddressesTable).where(eq(customerAddressesTable.id, addressId));
  res.json(addressView(row));
});

router.delete("/addresses/:addressId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const addressId = parseIntParam(req.params.addressId);
  if (addressId === null) { res.status(400).json({ error: "Invalid address id" }); return; }
  const [existing] = await db.select().from(customerAddressesTable).where(eq(customerAddressesTable.id, addressId));
  if (!existing) { res.status(404).json({ error: "Address not found" }); return; }
  const customer = await findCustomer(existing.customerId, companyId);
  if (!customer) { res.status(404).json({ error: "Address not found" }); return; }
  await db.delete(customerAddressesTable).where(eq(customerAddressesTable.id, addressId));
  res.status(204).send();
});

export default router;
