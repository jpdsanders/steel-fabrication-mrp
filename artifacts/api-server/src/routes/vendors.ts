import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  vendorsTable,
  vendorCategoriesTable,
  purchaseOrdersTable,
  type VendorRow,
} from "@workspace/db";
import { eq, and, ilike, asc } from "drizzle-orm";
import {
  CreateVendorBody,
  UpdateVendorBody,
  ListVendorsQueryParams,
  CreateVendorCategoryBody,
  UpdateVendorCategoryBody,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function vendorView(v: VendorRow, categoryName: string | null) {
  return {
    id: v.id,
    name: v.name,
    categoryId: v.categoryId,
    categoryName,
    status: v.status,
    scopeOfApproval: v.scopeOfApproval,
    coiExpiration: v.coiExpiration,
    coiLapsed: v.coiExpiration !== null && v.coiExpiration < todayIso(),
    contactName: v.contactName,
    contactEmail: v.contactEmail,
    contactPhone: v.contactPhone,
    notes: v.notes,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

async function categoryMap(companyId: number): Promise<Map<number, string>> {
  const cats = await db
    .select()
    .from(vendorCategoriesTable)
    .where(eq(vendorCategoriesTable.companyId, companyId));
  return new Map(cats.map((c) => [c.id, c.name]));
}

router.get("/vendors", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const query = ListVendorsQueryParams.parse(req.query);
  const conditions = [eq(vendorsTable.companyId, companyId)];
  if (query.status) conditions.push(eq(vendorsTable.status, query.status));
  if (query.search) conditions.push(ilike(vendorsTable.name, `%${query.search}%`));
  const rows = await db
    .select()
    .from(vendorsTable)
    .where(and(...conditions))
    .orderBy(asc(vendorsTable.name));
  const cats = await categoryMap(companyId);
  res.json(rows.map((v) => vendorView(v, v.categoryId ? (cats.get(v.categoryId) ?? null) : null)));
});

async function resolveCategory(companyId: number, categoryId: number | null | undefined): Promise<{ ok: boolean; id: number | null; name: string | null }> {
  if (categoryId === null || categoryId === undefined) return { ok: true, id: null, name: null };
  const [cat] = await db
    .select()
    .from(vendorCategoriesTable)
    .where(and(eq(vendorCategoriesTable.id, categoryId), eq(vendorCategoriesTable.companyId, companyId)));
  if (!cat) return { ok: false, id: null, name: null };
  return { ok: true, id: cat.id, name: cat.name };
}

router.post("/vendors", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateVendorBody.parse(req.body);
  const cat = await resolveCategory(companyId, body.categoryId);
  if (!cat.ok) { res.status(400).json({ error: "Unknown vendor category" }); return; }
  const [existing] = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(and(eq(vendorsTable.companyId, companyId), ilike(vendorsTable.name, body.name.trim())));
  if (existing) { res.status(409).json({ error: "A vendor with that name already exists." }); return; }
  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      companyId,
      name: body.name.trim(),
      categoryId: cat.id,
      status: body.status ?? "conditional",
      scopeOfApproval: body.scopeOfApproval ?? null,
      coiExpiration: body.coiExpiration ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(vendorView(vendor, cat.name));
});

router.patch("/vendors/:vendorId", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const vendorId = parseIntParam(req.params.vendorId);
  if (vendorId === null) { res.status(400).json({ error: "Invalid vendor id" }); return; }
  const body = UpdateVendorBody.parse(req.body);
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.companyId, companyId)));
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const cat = await resolveCategory(companyId, body.categoryId);
  if (!cat.ok) { res.status(400).json({ error: "Unknown vendor category" }); return; }
  const [updated] = await db
    .update(vendorsTable)
    .set({
      name: body.name.trim(),
      categoryId: cat.id,
      status: body.status ?? vendor.status,
      scopeOfApproval: body.scopeOfApproval ?? null,
      coiExpiration: body.coiExpiration ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      notes: body.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(vendorsTable.id, vendor.id))
    .returning();
  req.log.info({ vendorId: vendor.id, status: updated.status }, "vendor updated");
  res.json(vendorView(updated, cat.name));
});

router.delete("/vendors/:vendorId", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const vendorId = parseIntParam(req.params.vendorId);
  if (vendorId === null) { res.status(400).json({ error: "Invalid vendor id" }); return; }
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.companyId, companyId)));
  if (!vendor) { res.status(404).json({ error: "Vendor not found" }); return; }
  const [po] = await db
    .select({ id: purchaseOrdersTable.id })
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.vendorId, vendor.id))
    .limit(1);
  if (po) {
    res.status(409).json({ error: "This vendor is referenced by purchase orders. Suspend or disqualify it instead." });
    return;
  }
  await db.delete(vendorsTable).where(eq(vendorsTable.id, vendor.id));
  res.status(204).send();
});

// --- Vendor categories (per-company configurable taxonomy) ---

router.get("/vendor-categories", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const rows = await db
    .select()
    .from(vendorCategoriesTable)
    .where(eq(vendorCategoriesTable.companyId, companyId))
    .orderBy(asc(vendorCategoriesTable.sortIndex), asc(vendorCategoriesTable.name));
  res.json(rows.map((c) => ({ id: c.id, name: c.name, sortIndex: c.sortIndex })));
});

router.post("/vendor-categories", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateVendorCategoryBody.parse(req.body);
  const [existing] = await db
    .select({ id: vendorCategoriesTable.id })
    .from(vendorCategoriesTable)
    .where(and(eq(vendorCategoriesTable.companyId, companyId), ilike(vendorCategoriesTable.name, body.name.trim())));
  if (existing) { res.status(409).json({ error: "That category already exists." }); return; }
  const [cat] = await db
    .insert(vendorCategoriesTable)
    .values({ companyId, name: body.name.trim(), sortIndex: body.sortIndex ?? 0 })
    .returning();
  res.status(201).json({ id: cat.id, name: cat.name, sortIndex: cat.sortIndex });
});

router.patch("/vendor-categories/:categoryId", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const categoryId = parseIntParam(req.params.categoryId);
  if (categoryId === null) { res.status(400).json({ error: "Invalid category id" }); return; }
  const body = UpdateVendorCategoryBody.parse(req.body);
  const [cat] = await db
    .select()
    .from(vendorCategoriesTable)
    .where(and(eq(vendorCategoriesTable.id, categoryId), eq(vendorCategoriesTable.companyId, companyId)));
  if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
  const [updated] = await db
    .update(vendorCategoriesTable)
    .set({ name: body.name.trim(), sortIndex: body.sortIndex ?? cat.sortIndex })
    .where(eq(vendorCategoriesTable.id, cat.id))
    .returning();
  res.json({ id: updated.id, name: updated.name, sortIndex: updated.sortIndex });
});

router.delete("/vendor-categories/:categoryId", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const categoryId = parseIntParam(req.params.categoryId);
  if (categoryId === null) { res.status(400).json({ error: "Invalid category id" }); return; }
  const [cat] = await db
    .select()
    .from(vendorCategoriesTable)
    .where(and(eq(vendorCategoriesTable.id, categoryId), eq(vendorCategoriesTable.companyId, companyId)));
  if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
  await db.delete(vendorCategoriesTable).where(eq(vendorCategoriesTable.id, cat.id));
  res.status(204).send();
});

export default router;
