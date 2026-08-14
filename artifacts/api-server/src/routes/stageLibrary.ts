import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { stageLibraryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateStageLibraryItemBody,
  ListStageLibraryResponse,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

function toView(row: typeof stageLibraryTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/stage-library", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(stageLibraryTable)
    .orderBy(stageLibraryTable.name);
  res.json(ListStageLibraryResponse.parse(rows.map(toView)));
});

router.post("/stage-library", async (req, res): Promise<void> => {
  const body = CreateStageLibraryItemBody.parse(req.body);
  const [row] = await db
    .insert(stageLibraryTable)
    .values({ name: body.name })
    .returning();
  res.status(201).json(toView(row));
});

router.delete("/stage-library/:itemId", async (req, res): Promise<void> => {
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) {
    res.status(400).json({ error: "Invalid stage library item id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(stageLibraryTable)
    .where(eq(stageLibraryTable.id, itemId));
  if (!existing) {
    res.status(404).json({ error: "Stage library item not found" });
    return;
  }
  await db.delete(stageLibraryTable).where(eq(stageLibraryTable.id, itemId));
  res.status(204).send();
});

export default router;
