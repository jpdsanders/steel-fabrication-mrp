import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { stageLibraryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateStageLibraryItemBody,
  ListStageLibraryResponse,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function toView(row: typeof stageLibraryTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/stage-library", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const rows = await db
    .select()
    .from(stageLibraryTable)
    .where(eq(stageLibraryTable.companyId, companyId))
    .orderBy(stageLibraryTable.name);
  res.json(ListStageLibraryResponse.parse(rows.map(toView)));
});

router.post("/stage-library", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateStageLibraryItemBody.parse(req.body);
  const [row] = await db
    .insert(stageLibraryTable)
    .values({ companyId, name: body.name })
    .returning();
  res.status(201).json(toView(row));
});

router.delete("/stage-library/:itemId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) {
    res.status(400).json({ error: "Invalid stage library item id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(stageLibraryTable)
    .where(and(eq(stageLibraryTable.id, itemId), eq(stageLibraryTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Stage library item not found" });
    return;
  }
  await db.delete(stageLibraryTable).where(eq(stageLibraryTable.id, itemId));
  res.status(204).send();
});

export default router;
