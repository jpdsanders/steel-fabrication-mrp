import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { materialCatalogTable, insertMaterialCatalogSchema } from "@workspace/db";
import { eq, and, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

const STALE_DAYS = 90;

// Adds a computed `isStale` field: true if unitPrice is null or updatedAt > 90 days ago
function addStaleFlag<T extends { updatedAt: Date; unitPrice: number | null }>(item: T) {
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - STALE_DAYS);
  return {
    ...item,
    isStale: item.unitPrice === null || item.updatedAt < staleThreshold,
  };
}

/** GET /material-catalog */
router.get("/material-catalog", requireAuth, async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const staleOnly = req.query.staleOnly === "true";

  let items = await db
    .select()
    .from(materialCatalogTable)
    .orderBy(materialCatalogTable.profileType, materialCatalogTable.profileSize, materialCatalogTable.grade);

  if (search) {
    const term = search.toLowerCase();
    items = items.filter(
      (i) =>
        i.profileType.toLowerCase().includes(term) ||
        i.profileSize.toLowerCase().includes(term) ||
        i.grade.toLowerCase().includes(term),
    );
  }

  const result = items.map(addStaleFlag);

  if (staleOnly) {
    res.json(result.filter((i) => i.isStale));
    return;
  }

  res.json(result);
});

/** POST /material-catalog */
router.post("/material-catalog", requireAuth, async (req, res): Promise<void> => {
  const body = insertMaterialCatalogSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues });
    return;
  }
  // Attach updatedByUserId from auth
  const data = { ...body.data, updatedByUserId: req.auth!.user.id };
  const [item] = await db.insert(materialCatalogTable).values(data).returning();
  res.status(201).json(addStaleFlag(item));
});

/** GET /material-catalog/:itemId */
router.get("/material-catalog/:itemId", requireAuth, async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.itemId);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  const [item] = await db.select().from(materialCatalogTable).where(eq(materialCatalogTable.id, id)).limit(1);
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(addStaleFlag(item));
});

/** PATCH /material-catalog/:itemId */
router.patch("/material-catalog/:itemId", requireAuth, async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.itemId);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  const UpdateBody = insertMaterialCatalogSchema.partial();
  const body = UpdateBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues }); return; }
  if (Object.keys(body.data).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const updates = { ...body.data, updatedByUserId: req.auth!.user.id, updatedAt: new Date() };
  const [updated] = await db
    .update(materialCatalogTable)
    .set(updates)
    .where(eq(materialCatalogTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(addStaleFlag(updated));
});

/** DELETE /material-catalog/:itemId */
router.delete("/material-catalog/:itemId", requireAuth, async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.itemId);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.delete(materialCatalogTable).where(eq(materialCatalogTable.id, id)).returning({ id: materialCatalogTable.id });
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

export default router;
