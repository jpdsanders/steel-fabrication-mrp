import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  usersTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  purchaseOrderRevisionsTable,
  vendorsTable,
  qualityClausesTable,
  materialMovementsTable,
  receivingRecordsTable,
  receivingLinesTable,
  type PurchaseOrderRow,
  type PurchaseOrderLineRow,
  type VendorRow,
} from "@workspace/db";
import { eq, and, inArray, ilike, or, desc, asc, sql, type SQL } from "drizzle-orm";
import {
  CreatePurchaseOrderBody,
  UpdatePurchaseOrderBody,
  UpdatePurchaseOrderStatusBody,
  ListPurchaseOrdersQueryParams,
} from "@workspace/api-zod";
import { nextPoNumber } from "../services/production";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";
import { getOrSeedThresholds, tierForTotal } from "./poApprovalThresholds";

const router: IRouter = Router();

type JobInfo = { id: number; jobNumber: string; name: string; customer: string };
type VendorInfo = Pick<VendorRow, "id" | "name" | "status">;

function extendedPrice(line: Pick<PurchaseOrderLineRow, "unitPrice" | "pieces">): number | null {
  return line.unitPrice === null ? null : Math.round(line.unitPrice * line.pieces * 100) / 100;
}

function poTotal(lines: Pick<PurchaseOrderLineRow, "unitPrice" | "pieces">[]): number | null {
  const priced = lines.map(extendedPrice).filter((p): p is number => p !== null);
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((s, p) => s + p, 0) * 100) / 100;
}

function summaryView(
  po: PurchaseOrderRow,
  job: JobInfo,
  vendor: VendorInfo | null,
  lines: Pick<PurchaseOrderLineRow, "pieces" | "unitPrice">[],
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
    vendorId: po.vendorId,
    vendorName: vendor?.name ?? null,
    vendorStatus: vendor?.status ?? null,
    vendorExceptionJustification: po.vendorExceptionJustification,
    revision: po.revision,
    totalAmount: poTotal(lines),
    lineCount: lines.length,
    totalPieces: lines.reduce((sum, l) => sum + l.pieces, 0),
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
  };
}

type ReceiptStatus = "not_received" | "partial" | "complete" | "over";

function receiptStatus(orderedPieces: number, receivedPieces: number): ReceiptStatus {
  if (receivedPieces === 0) return "not_received";
  if (receivedPieces > orderedPieces) return "over";
  if (receivedPieces === orderedPieces) return "complete";
  return "partial";
}

function lineView(line: PurchaseOrderLineRow, receivedPieces = 0) {
  return {
    id: line.id,
    profileType: line.profileType,
    profileSize: line.profileSize,
    grade: line.grade,
    pieces: line.pieces,
    lengthIn: line.lengthIn,
    unitPrice: line.unitPrice,
    extendedPrice: extendedPrice(line),
    promiseDate: line.promiseDate,
    qualityClauseIds: line.qualityClauseIds,
    receivedPieces,
    remainingPieces: line.pieces - receivedPieces,
    receiptStatus: receiptStatus(line.pieces, receivedPieces),
  };
}

async function loadVendor(vendorId: number | null, companyId: number): Promise<VendorRow | null> {
  if (vendorId === null) return null;
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.companyId, companyId)));
  return vendor ?? null;
}

/** Aggregate received pieces per PO line id for a set of line ids. */
async function receivedPiecesMap(lineIds: number[]): Promise<Map<number, number>> {
  if (lineIds.length === 0) return new Map();
  const rows = await db
    .select({
      purchaseOrderLineId: receivingLinesTable.purchaseOrderLineId,
      received: sql<number>`cast(coalesce(sum(${receivingLinesTable.pieces}), 0) as int)`,
    })
    .from(receivingLinesTable)
    .where(
      and(
        inArray(receivingLinesTable.purchaseOrderLineId, lineIds),
        // only non-null references (receiving lines without a PO line are freeform)
      ),
    )
    .groupBy(receivingLinesTable.purchaseOrderLineId);
  return new Map(
    rows
      .filter((r) => r.purchaseOrderLineId !== null)
      .map((r) => [r.purchaseOrderLineId as number, r.received]),
  );
}

async function detailView(po: PurchaseOrderRow, companyId: number) {
  const [job] = await db
    .select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber, name: jobsTable.name, customer: jobsTable.customer })
    .from(jobsTable)
    .where(eq(jobsTable.id, po.jobId));
  const vendor = await loadVendor(po.vendorId, companyId);
  const lines = await db
    .select()
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, po.id))
    .orderBy(purchaseOrderLinesTable.sortIndex, purchaseOrderLinesTable.id);

  const receivedMap = await receivedPiecesMap(lines.map((l) => l.id));

  const tiers = await getOrSeedThresholds(companyId);
  const total = poTotal(lines);
  const tier = tierForTotal(tiers, total ?? 0);
  const approval = {
    requiresApproval: tier !== null && tier.requiredRole !== null,
    requiredRole: tier?.requiredRole ?? null,
    thresholdLabel: tier?.label ?? null,
  };

  return {
    ...summaryView(po, job, vendor, lines),
    qualityClauseIds: po.qualityClauseIds,
    approval,
    lines: lines.map((l) => lineView(l, receivedMap.get(l.id) ?? 0)),
  };
}

async function listView(pos: PurchaseOrderRow[], companyId: number) {
  if (pos.length === 0) return [];
  const jobIds = [...new Set(pos.map((p) => p.jobId))];
  const jobs = await db
    .select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber, name: jobsTable.name, customer: jobsTable.customer })
    .from(jobsTable)
    .where(inArray(jobsTable.id, jobIds));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const vendors = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name, status: vendorsTable.status })
    .from(vendorsTable)
    .where(eq(vendorsTable.companyId, companyId));
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));
  const allLines = await db
    .select({
      purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
      pieces: purchaseOrderLinesTable.pieces,
      unitPrice: purchaseOrderLinesTable.unitPrice,
    })
    .from(purchaseOrderLinesTable)
    .where(inArray(purchaseOrderLinesTable.purchaseOrderId, pos.map((p) => p.id)));
  const linesByPo = new Map<number, { pieces: number; unitPrice: number | null }[]>();
  for (const l of allLines) {
    const list = linesByPo.get(l.purchaseOrderId) ?? [];
    list.push({ pieces: l.pieces, unitPrice: l.unitPrice });
    linesByPo.set(l.purchaseOrderId, list);
  }
  return pos.flatMap((po) => {
    const job = jobMap.get(po.jobId);
    if (!job) return [];
    const vendor = po.vendorId ? (vendorMap.get(po.vendorId) ?? null) : null;
    return [summaryView(po, job, vendor, linesByPo.get(po.id) ?? [])];
  });
}

type LineInput = {
  profileType?: string | null;
  profileSize?: string | null;
  grade?: string | null;
  pieces: number;
  lengthIn?: number | null;
  unitPrice?: number | null;
  promiseDate?: string | null;
  qualityClauseIds?: number[];
};

/** Validate that every referenced clause id belongs to this company. */
async function validateClauseIds(companyId: number, ids: number[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const rows = await db
    .select({ id: qualityClausesTable.id })
    .from(qualityClausesTable)
    .where(and(eq(qualityClausesTable.companyId, companyId), inArray(qualityClausesTable.id, unique)));
  return rows.length === unique.length;
}

async function replaceLines(poId: number, lines: LineInput[]) {
  await db.delete(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.purchaseOrderId, poId));
  if (lines.length > 0) {
    await db.insert(purchaseOrderLinesTable).values(
      lines.map((l, index) => ({
        purchaseOrderId: poId,
        profileType: l.profileType ?? null,
        profileSize: l.profileSize ?? null,
        grade: l.grade ?? null,
        pieces: l.pieces,
        lengthIn: l.lengthIn ?? null,
        unitPrice: l.unitPrice ?? null,
        promiseDate: l.promiseDate ?? null,
        qualityClauseIds: l.qualityClauseIds ?? [],
        sortIndex: index,
      })),
    );
  }
}

/**
 * AVL enforcement: Approved/Conditional vendors are fine. Anything else
 * (Suspended/Disqualified) is an exception purchase requiring an explicit
 * justification — never silently blocked or silently allowed.
 */
function vendorEnforcementError(vendor: VendorRow, justification: string | null): string | null {
  if (vendor.status === "approved" || vendor.status === "conditional") return null;
  if (justification && justification.trim().length > 0) return null;
  return `Vendor "${vendor.name}" is ${vendor.status} on the Approved Vendor List. Buying from it requires an explicit exception justification.`;
}

router.get("/purchase-orders/due-in", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const rows = await db
    .select({
      poId: purchaseOrdersTable.id,
      poNumber: purchaseOrdersTable.poNumber,
      poStatus: purchaseOrdersTable.status,
      vendorId: purchaseOrdersTable.vendorId,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
      lineId: purchaseOrderLinesTable.id,
      profileType: purchaseOrderLinesTable.profileType,
      profileSize: purchaseOrderLinesTable.profileSize,
      grade: purchaseOrderLinesTable.grade,
      pieces: purchaseOrderLinesTable.pieces,
      promiseDate: purchaseOrderLinesTable.promiseDate,
    })
    .from(purchaseOrderLinesTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderLinesTable.purchaseOrderId, purchaseOrdersTable.id))
    .innerJoin(jobsTable, eq(purchaseOrdersTable.jobId, jobsTable.id))
    .where(and(eq(jobsTable.companyId, companyId), inArray(purchaseOrdersTable.status, ["sent", "approved"])))
    .orderBy(asc(purchaseOrderLinesTable.promiseDate));

  const [vendors, receivedMap] = await Promise.all([
    db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.companyId, companyId)),
    receivedPiecesMap(rows.map((r) => r.lineId)),
  ]);
  const vendorMap = new Map(vendors.map((v) => [v.id, v.name]));

  const today = new Date().toISOString().slice(0, 10);
  const soonDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = rows
    .map((r) => {
      const received = receivedMap.get(r.lineId) ?? 0;
      const remaining = r.pieces - received;
      const status = receiptStatus(r.pieces, received);

      // Exclude fully-received lines from the due-in view (nothing left to chase).
      // Over-received lines (status === "over") are still surfaced so buyers can flag them.
      if (status === "complete") return null;

      let dueStatus: "overdue" | "due_soon" | "ok" | "no_date";
      if (!r.promiseDate) dueStatus = "no_date";
      else if (r.promiseDate < today) dueStatus = "overdue";
      else if (r.promiseDate <= soonDate) dueStatus = "due_soon";
      else dueStatus = "ok";
      const description = [r.profileType, r.profileSize, r.grade].filter(Boolean).join(" ") || "Material line";
      return {
        poId: r.poId,
        poNumber: r.poNumber,
        poStatus: r.poStatus,
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        jobName: r.jobName,
        vendorName: r.vendorId ? (vendorMap.get(r.vendorId) ?? null) : null,
        lineId: r.lineId,
        description,
        pieces: r.pieces,
        promiseDate: r.promiseDate,
        dueStatus,
        receivedPieces: received,
        remainingPieces: remaining,
        receiptStatus: status,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const rank = { overdue: 0, due_soon: 1, ok: 2, no_date: 3 } as const;
  result.sort((a, b) => rank[a.dueStatus] - rank[b.dueStatus] || (a.promiseDate ?? "9999").localeCompare(b.promiseDate ?? "9999"));
  res.json(result);
});

router.get("/purchase-orders", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const query = ListPurchaseOrdersQueryParams.parse(req.query);
  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(purchaseOrdersTable.status, query.status));

  // Build job ids scoped to this company first
  let companyJobIds: number[];
  if (query.search) {
    const term = `%${query.search}%`;
    const matchingJobs = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.companyId, companyId),
          or(ilike(jobsTable.jobNumber, term), ilike(jobsTable.name, term), ilike(jobsTable.customer, term)),
        ),
      );
    companyJobIds = matchingJobs.map((j) => j.id);
    const match = or(
      ilike(purchaseOrdersTable.poNumber, term),
      companyJobIds.length > 0 ? inArray(purchaseOrdersTable.jobId, companyJobIds) : undefined,
    );
    if (match) conditions.push(match);
    const allCompanyJobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.companyId, companyId));
    companyJobIds = allCompanyJobs.map((j) => j.id);
  } else {
    const companyJobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.companyId, companyId));
    companyJobIds = companyJobs.map((j) => j.id);
  }

  // Always scope to company jobs
  if (companyJobIds.length > 0) {
    conditions.push(inArray(purchaseOrdersTable.jobId, companyJobIds));
  } else {
    res.json([]); return;
  }

  const rows = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(await listView(rows, companyId));
});

router.get("/jobs/:jobId/purchase-orders", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const rows = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.jobId, jobId)).orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(await listView(rows, companyId));
});

router.post("/jobs/:jobId/purchase-orders", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const body = CreatePurchaseOrderBody.parse(req.body);
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const vendor = await loadVendor(body.vendorId, companyId);
  if (!vendor) { res.status(400).json({ error: "A vendor must be selected to create a purchase order." }); return; }
  const justification = body.vendorExceptionJustification?.trim() || null;
  const enforcementError = vendorEnforcementError(vendor, justification);
  if (enforcementError) { res.status(422).json({ error: enforcementError }); return; }

  const clauseIds = body.qualityClauseIds ?? [];
  const allLineClauseIds = (body.lines ?? []).flatMap((l) => l.qualityClauseIds ?? []);
  if (!(await validateClauseIds(companyId, [...clauseIds, ...allLineClauseIds]))) {
    res.status(400).json({ error: "Unknown quality clause referenced." }); return;
  }

  const poNumber = await nextPoNumber();
  const [po] = await db
    .insert(purchaseOrdersTable)
    .values({
      jobId,
      poNumber,
      status: "draft",
      vendorId: vendor.id,
      vendorExceptionJustification:
        vendor.status === "approved" || vendor.status === "conditional" ? null : justification,
      qualityClauseIds: clauseIds,
    })
    .returning();
  await replaceLines(po.id, body.lines);
  res.status(201).json(await detailView(po, companyId));
});

async function loadPo(poId: number, companyId: number): Promise<PurchaseOrderRow | null> {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  if (!po) return null;
  // Verify job belongs to company
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.id, po.jobId), eq(jobsTable.companyId, companyId)));
  if (!job) return null;
  return po;
}

router.get("/purchase-orders/:poId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const po = await loadPo(poId, companyId);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  res.json(await detailView(po, companyId));
});

router.get("/purchase-orders/:poId/revisions", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const po = await loadPo(poId, companyId);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  const revisions = await db
    .select()
    .from(purchaseOrderRevisionsTable)
    .where(eq(purchaseOrderRevisionsTable.purchaseOrderId, po.id))
    .orderBy(desc(purchaseOrderRevisionsTable.revisionNumber));
  const userIds = [...new Set(revisions.map((r) => r.createdBy).filter((u): u is number => u !== null))];
  const users = userIds.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  res.json(revisions.map((r) => ({
    id: r.id,
    revisionNumber: r.revisionNumber,
    note: r.note,
    createdBy: r.createdBy,
    createdByName: r.createdBy ? (userMap.get(r.createdBy) ?? null) : null,
    snapshot: r.snapshot,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.patch("/purchase-orders/:poId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const body = UpdatePurchaseOrderBody.parse(req.body);
  const po = await loadPo(poId, companyId);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  // Resolve vendor (unchanged if not provided)
  const vendorId = body.vendorId ?? po.vendorId;
  const vendor = await loadVendor(vendorId, companyId);
  if (vendorId !== null && !vendor) { res.status(400).json({ error: "Unknown vendor." }); return; }
  const justification = body.vendorExceptionJustification !== undefined
    ? (body.vendorExceptionJustification?.trim() || null)
    : po.vendorExceptionJustification;
  if (vendor) {
    const enforcementError = vendorEnforcementError(vendor, justification);
    if (enforcementError) { res.status(422).json({ error: enforcementError }); return; }
  }

  const clauseIds = body.qualityClauseIds ?? po.qualityClauseIds;
  const allLineClauseIds = body.lines.flatMap((l) => l.qualityClauseIds ?? []);
  if (!(await validateClauseIds(companyId, [...clauseIds, ...allLineClauseIds]))) {
    res.status(400).json({ error: "Unknown quality clause referenced." }); return;
  }

  const pastDraft = po.status !== "draft" && po.status !== "rejected";
  if (pastDraft) {
    // Change order: snapshot current state as the next numbered revision.
    const currentLines = await db
      .select()
      .from(purchaseOrderLinesTable)
      .where(eq(purchaseOrderLinesTable.purchaseOrderId, po.id))
      .orderBy(purchaseOrderLinesTable.sortIndex, purchaseOrderLinesTable.id);
    const nextRevision = po.revision + 1;
    await db.insert(purchaseOrderRevisionsTable).values({
      purchaseOrderId: po.id,
      revisionNumber: nextRevision,
      note: body.revisionNote?.trim() || null,
      createdBy: req.auth!.user.id,
      snapshot: {
        poNumber: po.poNumber,
        status: po.status,
        vendorId: po.vendorId,
        vendorExceptionJustification: po.vendorExceptionJustification,
        qualityClauseIds: po.qualityClauseIds,
        lines: currentLines.map(lineView),
      },
    });
    req.log.info({ poId: po.id, revision: nextRevision }, "purchase order change-order revision captured");
  }

  await replaceLines(po.id, body.lines);
  const [updated] = await db
    .update(purchaseOrdersTable)
    .set({
      vendorId,
      vendorExceptionJustification:
        vendor && (vendor.status === "approved" || vendor.status === "conditional") ? null : justification,
      qualityClauseIds: clauseIds,
      revision: pastDraft ? po.revision + 1 : po.revision,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrdersTable.id, po.id))
    .returning();
  res.json(await detailView(updated, companyId));
});

router.delete("/purchase-orders/:poId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const po = await loadPo(poId, companyId);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status === "approved") { res.status(409).json({ error: "Approved purchase orders cannot be deleted." }); return; }
  // A PO with receiving records anchors heat/CMTR traceability — deleting it
  // would cascade away provenance for inventory and job heat sheets.
  const [receipt] = await db
    .select({ id: receivingRecordsTable.id })
    .from(receivingRecordsTable)
    .where(eq(receivingRecordsTable.purchaseOrderId, po.id))
    .limit(1);
  if (receipt) {
    res.status(409).json({ error: "This purchase order has receiving records and cannot be deleted (heat/MTR traceability)." });
    return;
  }
  await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id));
  res.status(204).send();
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  sent: ["draft", "rejected"],
  approved: ["sent"],
  rejected: ["sent"],
};

router.post("/purchase-orders/:poId/status", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const body = UpdatePurchaseOrderStatusBody.parse(req.body);
  const po = await loadPo(poId, companyId);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  const allowedFrom = ALLOWED_TRANSITIONS[body.status] ?? [];
  if (!allowedFrom.includes(po.status)) {
    res.status(409).json({ error: `Cannot change a ${po.status} purchase order to ${body.status}.` }); return;
  }

  if (body.status === "sent" && po.vendorId === null) {
    res.status(422).json({ error: "A vendor must be assigned before this purchase order can be sent." });
    return;
  }

  if (body.status === "approved") {
    // Per-company approval-threshold matrix enforcement.
    const lines = await db
      .select({ pieces: purchaseOrderLinesTable.pieces, unitPrice: purchaseOrderLinesTable.unitPrice })
      .from(purchaseOrderLinesTable)
      .where(eq(purchaseOrderLinesTable.purchaseOrderId, po.id));
    const total = poTotal(lines) ?? 0;
    const tiers = await getOrSeedThresholds(companyId);
    const tier = tierForTotal(tiers, total);
    if (tier?.requiredRole) {
      const roles = req.auth!.roles;
      const isPrivileged = req.auth!.user.superAdmin || roles.includes("admin") || roles.includes(tier.requiredRole);
      if (!isPrivileged) {
        res.status(403).json({
          error: `This purchase order totals $${total.toFixed(2)} (${tier.label}). Approval requires the ${tier.requiredRole} role.`,
        });
        return;
      }
    }
  }

  const reviewComment = body.status === "sent" ? null : (body.comment?.trim() || null);
  const [updated] = await db
    .update(purchaseOrdersTable)
    .set({ status: body.status, reviewComment, updatedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, po.id))
    .returning();

  // Material-movement ledger (Phase 4): an approved PO is committed spend —
  // log a "purchased" movement per priced line so job costing sees the
  // purchase before the material physically arrives.
  if (body.status === "approved") {
    const lines = await db
      .select()
      .from(purchaseOrderLinesTable)
      .where(eq(purchaseOrderLinesTable.purchaseOrderId, po.id));
    if (lines.length > 0) {
      await db.insert(materialMovementsTable).values(
        lines.map((l) => ({
          companyId,
          movementType: "purchased",
          purchaseOrderId: po.id,
          jobId: po.jobId,
          quantity: l.pieces,
          lengthIn: l.lengthIn,
          totalCost: l.unitPrice !== null ? Math.round(l.unitPrice * l.pieces * 100) / 100 : null,
          createdByUserId: req.auth!.user.id,
        })),
      );
    }
  }
  req.log.info({ poId: po.id, from: po.status, to: body.status }, "purchase order status changed");
  res.json(await detailView(updated, companyId));
});

export default router;
