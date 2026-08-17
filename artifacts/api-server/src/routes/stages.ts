import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { jobsTable, stagesTable } from "@workspace/db";
import { eq, and, max } from "drizzle-orm";
import {
  AddJobStageBody,
  UpdateStageBody,
  ReorderJobStagesBody,
} from "@workspace/api-zod";
import { getJobDetail } from "../services/production";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

/** Verify the job exists and belongs to the caller's company. Returns the job or null. */
async function verifyJob(jobId: number, companyId: number) {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  return job ?? null;
}

router.post("/jobs/:jobId/stages", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const body = AddJobStageBody.parse(req.body);
  const job = await verifyJob(jobId, companyId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  let orderIndex = body.orderIndex;
  if (orderIndex === undefined) {
    const [{ value }] = await db
      .select({ value: max(stagesTable.orderIndex) })
      .from(stagesTable)
      .where(eq(stagesTable.jobId, jobId));
    orderIndex = (value ?? -1) + 1;
  }
  await db.insert(stagesTable).values({
    jobId,
    name: body.name,
    estimatedHours: body.estimatedHours ?? 0,
    orderIndex,
    status: "not_started",
  });
  const detail = await getJobDetail(jobId, companyId);
  res.status(201).json(detail);
});

router.post("/jobs/:jobId/stages/reorder", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const body = ReorderJobStagesBody.parse(req.body);
  const job = await verifyJob(jobId, companyId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const stages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.jobId, jobId))
    .orderBy(stagesTable.orderIndex, stagesTable.id);

  const currentIds = stages.map((s) => s.id);
  const requested = body.stageIds;
  if (
    requested.length !== currentIds.length ||
    new Set(requested).size !== requested.length ||
    !requested.every((id) => currentIds.includes(id))
  ) {
    res.status(400).json({ error: "stageIds must be the full list of this job's stage IDs" });
    return;
  }

  const byId = new Map(stages.map((s) => [s.id, s]));
  for (let i = 0; i < requested.length; i++) {
    const current = stages[i];
    const proposed = byId.get(requested[i])!;
    const currentLocked = current.status !== "not_started";
    const proposedLocked = proposed.status !== "not_started";
    if ((currentLocked || proposedLocked) && current.id !== proposed.id) {
      res.status(409).json({ error: "Completed and in-progress stages cannot be moved" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < requested.length; i++) {
      await tx.update(stagesTable).set({ orderIndex: i }).where(eq(stagesTable.id, requested[i]));
    }
  });

  const detail = await getJobDetail(jobId, companyId);
  res.json(detail);
});

router.patch("/stages/:stageId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const stageId = parseIntParam(req.params.stageId);
  if (stageId === null) { res.status(400).json({ error: "Invalid stage id" }); return; }
  const body = UpdateStageBody.parse(req.body);
  const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, stageId));
  if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
  // Verify the job belongs to caller's company
  const job = await verifyJob(stage.jobId, companyId);
  if (!job) { res.status(404).json({ error: "Stage not found" }); return; }
  await db.update(stagesTable).set(body).where(eq(stagesTable.id, stageId));
  const detail = await getJobDetail(stage.jobId, companyId);
  res.json(detail);
});

router.delete("/stages/:stageId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const stageId = parseIntParam(req.params.stageId);
  if (stageId === null) { res.status(400).json({ error: "Invalid stage id" }); return; }
  const [stage] = await db.select().from(stagesTable).where(eq(stagesTable.id, stageId));
  if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
  const job = await verifyJob(stage.jobId, companyId);
  if (!job) { res.status(404).json({ error: "Stage not found" }); return; }
  if (stage.status !== "not_started") {
    res.status(409).json({ error: "Only not-started stages can be deleted" });
    return;
  }
  await db.delete(stagesTable).where(eq(stagesTable.id, stageId));
  const detail = await getJobDetail(stage.jobId, companyId);
  res.json(detail);
});

export default router;
