import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { laborRatesTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { parseIntParam } from "../lib/params";
import { CreateLaborRateBody, UpdateLaborRateBody } from "@workspace/api-zod";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function toView(r: typeof laborRatesTable.$inferSelect) {
  return {
    id: r.id,
    trade: r.trade,
    hourlyRate: r.hourlyRate,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/labor-rates", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(laborRatesTable)
    .where(eq(laborRatesTable.companyId, req.auth!.companyId))
    .orderBy(asc(laborRatesTable.trade));
  res.json(rows.map(toView));
});

router.post("/labor-rates", requireAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const parsed = CreateLaborRateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const trade = parsed.data.trade.trim();
  if (trade === "") {
    res.status(400).json({ error: "Trade is required" });
    return;
  }
  const [existing] = await db
    .select()
    .from(laborRatesTable)
    .where(
      and(
        eq(laborRatesTable.companyId, req.auth!.companyId),
        sql`lower(${laborRatesTable.trade}) = lower(${trade})`,
      ),
    );
  if (existing) {
    res.status(409).json({ error: `A rate for "${trade}" already exists` });
    return;
  }
  const [row] = await db
    .insert(laborRatesTable)
    .values({
      companyId: req.auth!.companyId,
      trade,
      hourlyRate: parsed.data.hourlyRate,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  res.status(201).json(toView(row));
});

router.patch(
  "/labor-rates/:rateId",
  requireAuth,
  requireSuperAdmin, async (req, res): Promise<void> => {
  const rateId = parseIntParam(req.params.rateId);
  if (rateId === null) {
    res.status(400).json({ error: "Invalid rate id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(laborRatesTable)
    .where(
      and(
        eq(laborRatesTable.id, rateId),
        eq(laborRatesTable.companyId, req.auth!.companyId),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Labor rate not found" });
    return;
  }
  const parsed = UpdateLaborRateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const updates: Partial<typeof laborRatesTable.$inferInsert> = {};
  if (body.trade !== undefined) updates.trade = body.trade;
  if (body.hourlyRate !== undefined) updates.hourlyRate = body.hourlyRate;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(laborRatesTable)
    .set(updates)
    .where(eq(laborRatesTable.id, rateId))
    .returning();
  res.json(toView(updated));
});

router.delete(
  "/labor-rates/:rateId",
  requireAuth,
  requireSuperAdmin, async (req, res): Promise<void> => {
  const rateId = parseIntParam(req.params.rateId);
  if (rateId === null) {
    res.status(400).json({ error: "Invalid rate id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(laborRatesTable)
    .where(
      and(
        eq(laborRatesTable.id, rateId),
        eq(laborRatesTable.companyId, req.auth!.companyId),
      ),
    );
  if (!existing) {
    res.status(404).json({ error: "Labor rate not found" });
    return;
  }
  await db.delete(laborRatesTable).where(eq(laborRatesTable.id, rateId));
  res.status(204).send();
});

export default router;
