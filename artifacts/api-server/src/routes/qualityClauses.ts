import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { qualityClausesTable, type QualityClauseRow } from "@workspace/db";
import { eq, and, ilike, asc } from "drizzle-orm";
import {
  CreateQualityClauseBody,
  UpdateQualityClauseBody,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

function clauseView(c: QualityClauseRow) {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    description: c.description,
    active: c.active,
  };
}

router.get("/quality-clauses", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const rows = await db
    .select()
    .from(qualityClausesTable)
    .where(eq(qualityClausesTable.companyId, companyId))
    .orderBy(asc(qualityClausesTable.code));
  res.json(rows.map(clauseView));
});

router.post("/quality-clauses", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateQualityClauseBody.parse(req.body);
  const [existing] = await db
    .select({ id: qualityClausesTable.id })
    .from(qualityClausesTable)
    .where(and(eq(qualityClausesTable.companyId, companyId), ilike(qualityClausesTable.code, body.code.trim())));
  if (existing) { res.status(409).json({ error: "A clause with that code already exists." }); return; }
  const [clause] = await db
    .insert(qualityClausesTable)
    .values({
      companyId,
      code: body.code.trim(),
      title: body.title.trim(),
      description: body.description ?? null,
      active: body.active ?? true,
    })
    .returning();
  res.status(201).json(clauseView(clause));
});

router.patch("/quality-clauses/:clauseId", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const clauseId = parseIntParam(req.params.clauseId);
  if (clauseId === null) { res.status(400).json({ error: "Invalid clause id" }); return; }
  const body = UpdateQualityClauseBody.parse(req.body);
  const [clause] = await db
    .select()
    .from(qualityClausesTable)
    .where(and(eq(qualityClausesTable.id, clauseId), eq(qualityClausesTable.companyId, companyId)));
  if (!clause) { res.status(404).json({ error: "Clause not found" }); return; }
  const [updated] = await db
    .update(qualityClausesTable)
    .set({
      code: body.code.trim(),
      title: body.title.trim(),
      description: body.description ?? null,
      active: body.active ?? clause.active,
      updatedAt: new Date(),
    })
    .where(eq(qualityClausesTable.id, clause.id))
    .returning();
  res.json(clauseView(updated));
});

router.delete("/quality-clauses/:clauseId", requireAuth, requireRole("admin", "purchasing"), async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const clauseId = parseIntParam(req.params.clauseId);
  if (clauseId === null) { res.status(400).json({ error: "Invalid clause id" }); return; }
  const [clause] = await db
    .select()
    .from(qualityClausesTable)
    .where(and(eq(qualityClausesTable.id, clauseId), eq(qualityClausesTable.companyId, companyId)));
  if (!clause) { res.status(404).json({ error: "Clause not found" }); return; }
  await db.delete(qualityClausesTable).where(eq(qualityClausesTable.id, clause.id));
  res.status(204).send();
});

export default router;
