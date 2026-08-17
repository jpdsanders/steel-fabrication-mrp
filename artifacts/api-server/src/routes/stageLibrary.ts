import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  stageLibraryTable,
  bomAssembliesTable,
  jobsTable,
  STAGE_TYPES,
} from "@workspace/db";
import { eq, and, sql, asc, inArray, ne } from "drizzle-orm";
import {
  CreateStageLibraryItemBody,
  UpdateStageLibraryItemBody,
  ReorderStageLibraryBody,
  ListStageLibraryResponse,
  GetStageLibraryRollupResponse,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";
import { getCompanyPipeline, computeAssemblyStageCounts } from "../services/production";

const router: IRouter = Router();

class ReorderError extends Error {}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Postgres unique-constraint violation (duplicate name / gate). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" ||
    (typeof err === "object" &&
      err !== null &&
      typeof (err as { cause?: { code?: string } }).cause === "object" &&
      (err as { cause?: { code?: string } }).cause?.code === "23505")
  );
}

function toView(row: typeof stageLibraryTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.orderIndex,
    stageType: row.stageType as "in_house" | "vendor",
    isReadyToShipGate: row.isReadyToShipGate,
    createdAt: row.createdAt.toISOString(),
  };
}

async function listOrdered(companyId: number) {
  return db
    .select()
    .from(stageLibraryTable)
    .where(eq(stageLibraryTable.companyId, companyId))
    .orderBy(asc(stageLibraryTable.orderIndex), asc(stageLibraryTable.id));
}

router.get("/stage-library", requireAuth, async (req, res): Promise<void> => {
  const rows = await listOrdered(req.auth!.companyId);
  res.json(ListStageLibraryResponse.parse(rows.map(toView)));
});

// Live per-stage assembly counts across the company's ACTIVE jobs. Assemblies
// with no stage set are surfaced explicitly (noStage), never silently dropped.
router.get("/stage-library/rollup", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const pipeline = await getCompanyPipeline(companyId);
  const assemblies = await db
    .select({ asm: bomAssembliesTable })
    .from(bomAssembliesTable)
    .innerJoin(jobsTable, eq(bomAssembliesTable.jobId, jobsTable.id))
    .where(and(eq(jobsTable.companyId, companyId), eq(jobsTable.status, "active")));
  const { counts, totalQty } = computeAssemblyStageCounts(
    pipeline,
    assemblies.map((r) => r.asm),
  );
  res.json(
    GetStageLibraryRollupResponse.parse({
      stages: counts.stages,
      onHold: counts.onHold,
      noStage: counts.noStage,
      totalQty,
    }),
  );
});

router.post("/stage-library", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const parsed = CreateStageLibraryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const name = body.name.trim();
  if (!name) {
    res.status(400).json({ error: "Stage name is required" });
    return;
  }
  const stageType = body.stageType ?? "in_house";
  if (!STAGE_TYPES.includes(stageType)) {
    res.status(400).json({ error: "Invalid stage type" });
    return;
  }
  // Insert the new stage BEFORE the final (shipped) stage: the last stage is
  // terminal (set only by shipment departure), so appending after it would
  // silently change which stage is terminal and reopen departed assemblies.
  let row: typeof stageLibraryTable.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(stageLibraryTable)
      .where(eq(stageLibraryTable.companyId, companyId))
      .orderBy(asc(stageLibraryTable.orderIndex), asc(stageLibraryTable.id))
      .for("update");
    if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpError(409, `A stage named "${name}" already exists.`);
    }
    const last = rows[rows.length - 1];
    let orderIndex: number;
    if (!last) {
      orderIndex = 0;
    } else {
      orderIndex = last.orderIndex;
      await tx
        .update(stageLibraryTable)
        .set({ orderIndex: last.orderIndex + 1 })
        .where(eq(stageLibraryTable.id, last.id));
    }
    const [created] = await tx
      .insert(stageLibraryTable)
      .values({ companyId, name, stageType, orderIndex })
      .returning();
    return created;
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `A stage named "${name}" already exists.` });
      return;
    }
    throw err;
  }
  res.status(201).json(toView(row));
});

router.patch("/stage-library/:itemId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) {
    res.status(400).json({ error: "Invalid stage library item id" });
    return;
  }
  const parsed = UpdateStageLibraryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const [existing] = await db
    .select()
    .from(stageLibraryTable)
    .where(and(eq(stageLibraryTable.id, itemId), eq(stageLibraryTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Stage library item not found" });
    return;
  }
  if (body.stageType !== undefined && !STAGE_TYPES.includes(body.stageType)) {
    res.status(400).json({ error: "Invalid stage type" });
    return;
  }
  if (body.isReadyToShipGate === true) {
    const rows = await listOrdered(companyId);
    const last = rows[rows.length - 1];
    if (last && last.id === itemId) {
      res.status(409).json({
        error:
          "The final stage marks shipped assemblies and cannot be the Ready-to-Ship gate. Move it earlier in the pipeline first.",
      });
      return;
    }
  }
  if (body.isReadyToShipGate === false && existing.isReadyToShipGate) {
    res.status(409).json({
      error:
        "Every pipeline needs a Ready-to-Ship gate. Mark another stage as the gate instead of unsetting this one.",
    });
    return;
  }
  const newName = body.name?.trim();
  if (body.name !== undefined && !newName) {
    res.status(400).json({ error: "Stage name is required" });
    return;
  }
  let updated: typeof stageLibraryTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
    // Lock the pipeline rows: serializes with delete/reorder and with
    // assembly-stage writes, and lets the dup check run race-free.
    const lockedRows = await tx
      .select()
      .from(stageLibraryTable)
      .where(eq(stageLibraryTable.companyId, companyId))
      .for("update");
    if (
      newName &&
      lockedRows.some(
        (r) => r.id !== itemId && r.name.toLowerCase() === newName.toLowerCase(),
      )
    ) {
      throw new HttpError(409, `A stage named "${newName}" already exists.`);
    }
    if (body.isReadyToShipGate === true && !existing.isReadyToShipGate) {
      // Move the gate: unset the previous gate first (partial unique index
      // enforces at most one per company).
      await tx
        .update(stageLibraryTable)
        .set({ isReadyToShipGate: false })
        .where(
          and(
            eq(stageLibraryTable.companyId, companyId),
            eq(stageLibraryTable.isReadyToShipGate, true),
          ),
        );
    }
    const updates: Partial<typeof stageLibraryTable.$inferInsert> = {};
    if (newName !== undefined) updates.name = newName;
    if (body.stageType !== undefined) updates.stageType = body.stageType;
    if (body.isReadyToShipGate === true) updates.isReadyToShipGate = true;
    const [row] =
      Object.keys(updates).length > 0
        ? await tx
            .update(stageLibraryTable)
            .set(updates)
            .where(eq(stageLibraryTable.id, itemId))
            .returning()
        : [existing];
    // Renaming a stage carries the assemblies currently in it along.
    if (newName !== undefined && newName !== existing.name) {
      await tx
        .update(bomAssembliesTable)
        .set({ currentStage: newName })
        .where(
          and(
            sql`lower(${bomAssembliesTable.currentStage}) = lower(${existing.name})`,
            inArray(
              bomAssembliesTable.jobId,
              tx
                .select({ id: jobsTable.id })
                .from(jobsTable)
                .where(eq(jobsTable.companyId, companyId)),
            ),
          ),
        );
    }
    return row;
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `A stage named "${newName}" already exists.` });
      return;
    }
    throw err;
  }
  res.json(toView(updated));
});

router.post("/stage-library/reorder", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const parsed = ReorderStageLibraryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const itemIds = parsed.data.itemIds;
  try {
    await db.transaction(async (tx) => {
      // Lock the company's pipeline rows to serialize concurrent reorders.
      const rows = await tx
        .select()
        .from(stageLibraryTable)
        .where(eq(stageLibraryTable.companyId, companyId))
        .for("update");
      const existingIds = new Set(rows.map((r) => r.id));
      const uniqueIds = new Set(itemIds);
      if (
        uniqueIds.size !== itemIds.length ||
        itemIds.length !== rows.length ||
        itemIds.some((id) => !existingIds.has(id))
      ) {
        throw new ReorderError(
          "Reorder must include each pipeline stage id exactly once.",
        );
      }
      // Invariant: the RTS gate must sit strictly before the final (shipped)
      // stage — departure moves gate-stage assemblies forward to the final one.
      const gate = rows.find((r) => r.isReadyToShipGate);
      if (gate && itemIds[itemIds.length - 1] === gate.id) {
        throw new ReorderError(
          "The Ready-to-Ship gate must come before the final (shipped) stage.",
        );
      }
      // Invariant: the terminal stage identity is stable. Assemblies already
      // departed live in the current final stage; promoting a different stage
      // to last would silently reopen them.
      const sorted = [...rows].sort(
        (a, b) => a.orderIndex - b.orderIndex || a.id - b.id,
      );
      const currentFinal = sorted[sorted.length - 1];
      if (currentFinal && itemIds[itemIds.length - 1] !== currentFinal.id) {
        throw new ReorderError(
          `"${currentFinal.name}" is the final (shipped) stage and must stay last — shipped assemblies live there.`,
        );
      }
      for (let i = 0; i < itemIds.length; i++) {
        await tx
          .update(stageLibraryTable)
          .set({ orderIndex: i })
          .where(
            and(
              eq(stageLibraryTable.id, itemIds[i]),
              eq(stageLibraryTable.companyId, companyId),
            ),
          );
      }
    });
  } catch (err) {
    if (err instanceof ReorderError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  const reordered = await listOrdered(companyId);
  res.json(ListStageLibraryResponse.parse(reordered.map(toView)));
});

router.delete("/stage-library/:itemId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) {
    res.status(400).json({ error: "Invalid stage library item id" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      // Lock the pipeline rows: serializes with reorder/rename (FOR UPDATE)
      // and with assembly-stage writes (which take FOR SHARE on the stage row).
      const ordered = await tx
        .select()
        .from(stageLibraryTable)
        .where(eq(stageLibraryTable.companyId, companyId))
        .orderBy(asc(stageLibraryTable.orderIndex), asc(stageLibraryTable.id))
        .for("update");
      const existing = ordered.find((r) => r.id === itemId);
      if (!existing) throw new HttpError(404, "Stage library item not found");
      if (existing.isReadyToShipGate) {
        throw new HttpError(
          409,
          "This stage is the Ready-to-Ship gate. Mark another stage as the gate before deleting it.",
        );
      }
      const last = ordered[ordered.length - 1];
      if (last && last.id === itemId) {
        throw new HttpError(
          409,
          "The final (shipped) stage cannot be deleted — departed assemblies live there. Rename it instead.",
        );
      }
      const remaining = ordered.filter((r) => r.id !== itemId);
      const remainingGateIdx = remaining.findIndex((r) => r.isReadyToShipGate);
      if (remainingGateIdx >= 0 && remainingGateIdx === remaining.length - 1) {
        throw new HttpError(
          409,
          "Deleting this stage would make the Ready-to-Ship gate the final (shipped) stage. The gate must stay strictly before the final stage.",
        );
      }
      // In-use check under the same lock: an assembly PATCH validating this
      // stage locks the stage row FOR SHARE, so it either committed before we
      // got the lock (visible here) or waits until this delete resolves.
      const [{ inUse }] = await tx
        .select({ inUse: sql<number>`count(*)::int` })
        .from(bomAssembliesTable)
        .innerJoin(jobsTable, eq(bomAssembliesTable.jobId, jobsTable.id))
        .where(
          and(
            eq(jobsTable.companyId, companyId),
            sql`lower(${bomAssembliesTable.currentStage}) = lower(${existing.name})`,
          ),
        );
      if (inUse > 0) {
        throw new HttpError(
          409,
          `Cannot delete "${existing.name}" — ${inUse} assembl${inUse === 1 ? "y" : "ies"} currently sit in this stage. Move them first.`,
        );
      }
      await tx.delete(stageLibraryTable).where(eq(stageLibraryTable.id, itemId));
    });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
  res.status(204).send();
});

export default router;
