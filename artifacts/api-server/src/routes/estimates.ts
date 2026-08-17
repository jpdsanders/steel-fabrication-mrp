import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { estimatesTable, jobsTable } from "@workspace/db";
import { eq, and, ilike, or, desc, type SQL } from "drizzle-orm";
import {
  CreateEstimateBody,
  UpdateEstimateBody,
  ConvertEstimateToJobBody,
  ListEstimatesQueryParams,
} from "@workspace/api-zod";
import {
  nextBidNumber,
  createJobWithRouting,
  getJobDetail,
} from "../services/production";
import { parseIntParam } from "../lib/params";
import { deleteEstimateDocumentObjects } from "./documents";
import { documentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

type EstimateRow = typeof estimatesTable.$inferSelect;

async function estimateView(estimate: EstimateRow) {
  const [job] = await db
    .select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber })
    .from(jobsTable)
    .where(eq(jobsTable.estimateId, estimate.id));
  return toView(estimate, job ?? null);
}

function toView(
  estimate: EstimateRow,
  job: { id: number; jobNumber: string } | null,
) {
  return {
    id: estimate.id,
    bidNumber: estimate.bidNumber,
    name: estimate.name,
    customer: estimate.customer,
    status: estimate.status,
    // Internal type values only — user-facing labels come from a swappable
    // display constant. OPEN QUESTION: see OPEN_QUESTIONS.md (#2)
    type: estimate.type,
    marginPercent: estimate.marginPercent,
    quoteFormat: estimate.quoteFormat,
    estimatedHours: estimate.estimatedHours,
    amount: estimate.amount,
    bidDate: estimate.bidDate,
    dueDate: estimate.dueDate,
    notes: estimate.notes,
    jobId: job?.id ?? null,
    jobNumber: job?.jobNumber ?? null,
    createdAt: estimate.createdAt.toISOString(),
    updatedAt: estimate.updatedAt.toISOString(),
  };
}

router.get("/estimates", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const query = ListEstimatesQueryParams.parse(req.query);
  const conditions: SQL[] = [eq(estimatesTable.companyId, companyId)];
  if (query.status) conditions.push(eq(estimatesTable.status, query.status));
  if (query.search) {
    const term = `%${query.search}%`;
    const match = or(
      ilike(estimatesTable.bidNumber, term),
      ilike(estimatesTable.name, term),
      ilike(estimatesTable.customer, term),
    );
    if (match) conditions.push(match);
  }
  const rows = await db
    .select()
    .from(estimatesTable)
    .where(and(...conditions))
    .orderBy(desc(estimatesTable.createdAt));

  const jobs = await db
    .select({
      id: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      estimateId: jobsTable.estimateId,
    })
    .from(jobsTable)
    .where(eq(jobsTable.companyId, companyId));
  const jobByEstimate = new Map(
    jobs
      .filter((j) => j.estimateId != null)
      .map((j) => [j.estimateId as number, { id: j.id, jobNumber: j.jobNumber }]),
  );
  res.json(rows.map((e) => toView(e, jobByEstimate.get(e.id) ?? null)));
});

router.post("/estimates", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateEstimateBody.parse(req.body);
  const bidNumber = await nextBidNumber();
  const [estimate] = await db
    .insert(estimatesTable)
    .values({
      companyId,
      bidNumber,
      name: body.name,
      customer: body.customer,
      status: body.status ?? "draft",
      type: body.type ?? "preliminary",
      marginPercent: body.marginPercent ?? 0,
      quoteFormat: body.quoteFormat ?? "summary",
      estimatedHours: body.estimatedHours ?? 0,
      amount: body.amount ?? null,
      bidDate: body.bidDate ?? null,
      dueDate: body.dueDate ?? null,
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(await estimateView(estimate));
});

router.get("/estimates/:estimateId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const estimateId = parseIntParam(req.params.estimateId);
  if (estimateId === null) {
    res.status(400).json({ error: "Invalid estimate id" });
    return;
  }
  const [estimate] = await db
    .select()
    .from(estimatesTable)
    .where(and(eq(estimatesTable.id, estimateId), eq(estimatesTable.companyId, companyId)));
  if (!estimate) {
    res.status(404).json({ error: "Estimate not found" });
    return;
  }
  res.json(await estimateView(estimate));
});

router.patch("/estimates/:estimateId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const estimateId = parseIntParam(req.params.estimateId);
  if (estimateId === null) {
    res.status(400).json({ error: "Invalid estimate id" });
    return;
  }
  const body = UpdateEstimateBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(estimatesTable)
    .where(and(eq(estimatesTable.id, estimateId), eq(estimatesTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Estimate not found" });
    return;
  }
  if (existing.status === "won" && body.status) {
    res.status(409).json({ error: "A won (converted) estimate cannot change status" });
    return;
  }
  await db
    .update(estimatesTable)
    .set(body)
    .where(eq(estimatesTable.id, estimateId));
  const [updated] = await db
    .select()
    .from(estimatesTable)
    .where(eq(estimatesTable.id, estimateId));
  res.json(await estimateView(updated));
});

router.delete("/estimates/:estimateId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const estimateId = parseIntParam(req.params.estimateId);
  if (estimateId === null) {
    res.status(400).json({ error: "Invalid estimate id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(estimatesTable)
    .where(and(eq(estimatesTable.id, estimateId), eq(estimatesTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Estimate not found" });
    return;
  }
  if (existing.status === "won") {
    res.status(409).json({ error: "Cannot delete a converted estimate" });
    return;
  }
  await deleteEstimateDocumentObjects(estimateId);
  await db.delete(estimatesTable).where(eq(estimatesTable.id, estimateId));
  res.status(204).send();
});

router.post(
  "/estimates/:estimateId/convert",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const body = ConvertEstimateToJobBody.parse(req.body ?? {});
    const [estimate] = await db
      .select()
      .from(estimatesTable)
      .where(and(eq(estimatesTable.id, estimateId), eq(estimatesTable.companyId, companyId)));
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    if (estimate.status === "won") {
      res.status(409).json({ error: "Estimate already converted to a job" });
      return;
    }

    const job = await createJobWithRouting({
      companyId,
      name: estimate.name,
      customer: estimate.customer,
      dueDate: body.dueDate ?? estimate.dueDate,
      notes: estimate.notes,
      estimateId: estimate.id,
      stages: body.stages,
    });

    await db
      .update(estimatesTable)
      .set({ status: "won" })
      .where(eq(estimatesTable.id, estimateId));

    await db
      .update(documentsTable)
      .set({ jobId: job.id, estimateId: null })
      .where(eq(documentsTable.estimateId, estimateId));

    const detail = await getJobDetail(job.id, companyId);
    res.status(201).json(detail);
  },
);

export default router;
