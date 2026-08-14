import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  type PurchaseOrderRow,
  type PurchaseOrderLineRow,
} from "@workspace/db";
import { eq, and, inArray, ilike, or, desc, type SQL } from "drizzle-orm";
import {
  CreatePurchaseOrderBody,
  UpdatePurchaseOrderBody,
  UpdatePurchaseOrderStatusBody,
  ListPurchaseOrdersQueryParams,
} from "@workspace/api-zod";
import { nextPoNumber } from "../services/production";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

type JobInfo = { id: number; jobNumber: string; name: string; customer: string };

function summaryView(
  po: PurchaseOrderRow,
  job: JobInfo,
  lines: Pick<PurchaseOrderLineRow, "pieces">[],
) {
  return {
    id: po.id,
    poNumber: po.poNumber,
    jobId: po.jobId,
    jobNumber: job.jobNumber,
    jobName: job.name,
    customer: job.customer,
    status: po.status,
    reviewComment: po.reviewComment,
    lineCount: lines.length,
    totalPieces: lines.reduce((sum, l) => sum + l.pieces, 0),
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
  };
}

function lineView(line: PurchaseOrderLineRow) {
  return {
    id: line.id,
    profileType: line.profileType,
    profileSize: line.profileSize,
    grade: line.grade,
    pieces: line.pieces,
    lengthIn: line.lengthIn,
  };
}

async function detailView(po: PurchaseOrderRow) {
  const [job] = await db
    .select({
      id: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      name: jobsTable.name,
      customer: jobsTable.customer,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, po.jobId));
  const lines = await db
    .select()
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, po.id))
    .orderBy(purchaseOrderLinesTable.sortIndex, purchaseOrderLinesTable.id);
  return {
    ...summaryView(po, job, lines),
    lines: lines.map(lineView),
  };
}

async function listView(pos: PurchaseOrderRow[]) {
  if (pos.length === 0) return [];
  const jobIds = [...new Set(pos.map((p) => p.jobId))];
  const jobs = await db
    .select({
      id: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      name: jobsTable.name,
      customer: jobsTable.customer,
    })
    .from(jobsTable)
    .where(inArray(jobsTable.id, jobIds));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const allLines = await db
    .select({
      purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
      pieces: purchaseOrderLinesTable.pieces,
    })
    .from(purchaseOrderLinesTable)
    .where(
      inArray(
        purchaseOrderLinesTable.purchaseOrderId,
        pos.map((p) => p.id),
      ),
    );
  const linesByPo = new Map<number, { pieces: number }[]>();
  for (const l of allLines) {
    const list = linesByPo.get(l.purchaseOrderId) ?? [];
    list.push({ pieces: l.pieces });
    linesByPo.set(l.purchaseOrderId, list);
  }
  return pos.flatMap((po) => {
    const job = jobMap.get(po.jobId);
    if (!job) return [];
    return [summaryView(po, job, linesByPo.get(po.id) ?? [])];
  });
}

type LineInput = {
  profileType?: string | null;
  profileSize?: string | null;
  grade?: string | null;
  pieces: number;
  lengthIn?: number | null;
};

async function replaceLines(poId: number, lines: LineInput[]) {
  await db
    .delete(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, poId));
  if (lines.length > 0) {
    await db.insert(purchaseOrderLinesTable).values(
      lines.map((l, index) => ({
        purchaseOrderId: poId,
        profileType: l.profileType ?? null,
        profileSize: l.profileSize ?? null,
        grade: l.grade ?? null,
        pieces: l.pieces,
        lengthIn: l.lengthIn ?? null,
        sortIndex: index,
      })),
    );
  }
}

router.get("/purchase-orders", async (req, res): Promise<void> => {
  const query = ListPurchaseOrdersQueryParams.parse(req.query);
  const conditions: SQL[] = [];
  if (query.status)
    conditions.push(eq(purchaseOrdersTable.status, query.status));
  if (query.search) {
    const term = `%${query.search}%`;
    const matchingJobs = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        or(
          ilike(jobsTable.jobNumber, term),
          ilike(jobsTable.name, term),
          ilike(jobsTable.customer, term),
        ),
      );
    const jobIds = matchingJobs.map((j) => j.id);
    const match = or(
      ilike(purchaseOrdersTable.poNumber, term),
      jobIds.length > 0
        ? inArray(purchaseOrdersTable.jobId, jobIds)
        : undefined,
    );
    if (match) conditions.push(match);
  }
  const rows = await db
    .select()
    .from(purchaseOrdersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(await listView(rows));
});

router.get("/jobs/:jobId/purchase-orders", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const rows = await db
    .select()
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.jobId, jobId))
    .orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(await listView(rows));
});

router.post("/jobs/:jobId/purchase-orders", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const body = CreatePurchaseOrderBody.parse(req.body);
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const poNumber = await nextPoNumber();
  const [po] = await db
    .insert(purchaseOrdersTable)
    .values({ jobId, poNumber, status: "draft" })
    .returning();
  await replaceLines(po.id, body.lines);
  res.status(201).json(await detailView(po));
});

async function loadPo(req: { params: { poId?: string } }, res: {
  status: (code: number) => { json: (body: unknown) => void };
}): Promise<PurchaseOrderRow | null> {
  const poId = parseIntParam(req.params.poId ?? "");
  if (poId === null) {
    res.status(400).json({ error: "Invalid purchase order id" });
    return null;
  }
  const [po] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, poId));
  if (!po) {
    res.status(404).json({ error: "Purchase order not found" });
    return null;
  }
  return po;
}

router.get("/purchase-orders/:poId", async (req, res): Promise<void> => {
  const po = await loadPo(req, res);
  if (!po) return;
  res.json(await detailView(po));
});

router.patch("/purchase-orders/:poId", async (req, res): Promise<void> => {
  const body = UpdatePurchaseOrderBody.parse(req.body);
  const po = await loadPo(req, res);
  if (!po) return;
  if (po.status !== "draft" && po.status !== "rejected") {
    res.status(409).json({
      error: `A ${po.status} purchase order cannot be edited.`,
    });
    return;
  }
  await replaceLines(po.id, body.lines);
  const [updated] = await db
    .update(purchaseOrdersTable)
    .set({ updatedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, po.id))
    .returning();
  res.json(await detailView(updated));
});

router.delete("/purchase-orders/:poId", async (req, res): Promise<void> => {
  const po = await loadPo(req, res);
  if (!po) return;
  if (po.status === "approved") {
    res
      .status(409)
      .json({ error: "Approved purchase orders cannot be deleted." });
    return;
  }
  await db
    .delete(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, po.id));
  res.status(204).send();
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  sent: ["draft", "rejected"],
  approved: ["sent"],
  rejected: ["sent"],
};

router.post(
  "/purchase-orders/:poId/status",
  async (req, res): Promise<void> => {
    const body = UpdatePurchaseOrderStatusBody.parse(req.body);
    const po = await loadPo(req, res);
    if (!po) return;
    const allowedFrom = ALLOWED_TRANSITIONS[body.status] ?? [];
    if (!allowedFrom.includes(po.status)) {
      res.status(409).json({
        error: `Cannot change a ${po.status} purchase order to ${body.status}.`,
      });
      return;
    }
    const reviewComment =
      body.status === "sent" ? null : (body.comment?.trim() || null);
    const [updated] = await db
      .update(purchaseOrdersTable)
      .set({ status: body.status, reviewComment, updatedAt: new Date() })
      .where(eq(purchaseOrdersTable.id, po.id))
      .returning();
    req.log.info(
      { poId: po.id, from: po.status, to: body.status },
      "purchase order status changed",
    );
    res.json(await detailView(updated));
  },
);

export default router;
