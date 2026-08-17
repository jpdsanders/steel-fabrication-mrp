import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  usersTable,
  bomAssembliesTable,
  purchaseOrdersTable,
  nonconformanceReportsTable,
  substitutionRequestsTable,
  type NonconformanceReportRow,
  type SubstitutionRequestRow,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  CreateNcrBody,
  UpdateNcrBody,
  CreateSubstitutionRequestBody,
  UpdateSubstitutionRequestBody,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

// NOTE: the QC data model is a DRAFT pending SME validation (rebuild brief
// Phase 6 caveat) — keep behavior conservative and the shape adaptable.

const router: IRouter = Router();

/** Next per-company sequential number like "NCR-1001" / "SUB-1001". */
async function nextCompanyNumber(
  companyId: number,
  prefix: "NCR" | "SUB",
): Promise<string> {
  const table =
    prefix === "NCR" ? nonconformanceReportsTable : substitutionRequestsTable;
  const rows = await db
    .select({ number: table.number })
    .from(table)
    .where(eq(table.companyId, companyId));
  let max = 1000;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) {
    const m = re.exec(r.number.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${max + 1}`;
}

async function loadCompanyJob(jobId: number, companyId: number) {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  return job ?? null;
}

/** Verify an assembly belongs to a company job; returns its jobId or null. */
async function assemblyCompanyJobId(
  assemblyId: number,
  companyId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ jobId: bomAssembliesTable.jobId })
    .from(bomAssembliesTable)
    .innerJoin(jobsTable, eq(bomAssembliesTable.jobId, jobsTable.id))
    .where(
      and(eq(bomAssembliesTable.id, assemblyId), eq(jobsTable.companyId, companyId)),
    );
  return row?.jobId ?? null;
}

async function poCompanyOwned(poId: number, companyId: number): Promise<boolean> {
  const rows = await db
    .select({ id: purchaseOrdersTable.id })
    .from(purchaseOrdersTable)
    .innerJoin(jobsTable, eq(purchaseOrdersTable.jobId, jobsTable.id))
    .where(and(eq(purchaseOrdersTable.id, poId), eq(jobsTable.companyId, companyId)));
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Shared view assembly (job number / assembly mark / PO number / user names)
// ---------------------------------------------------------------------------

type NameMaps = {
  jobNumbers: Map<number, string>;
  assemblyMarks: Map<number, string>;
  poNumbers: Map<number, string>;
  userNames: Map<number, string>;
};

async function buildNameMaps(rows: {
  jobId: number | null;
  assemblyId: number | null;
  purchaseOrderId?: number | null;
  approvedBy: number | null;
  createdBy: number | null;
}[]): Promise<NameMaps> {
  const jobIds = [...new Set(rows.map((r) => r.jobId).filter((v): v is number => v !== null))];
  const asmIds = [...new Set(rows.map((r) => r.assemblyId).filter((v): v is number => v !== null))];
  const poIds = [...new Set(rows.map((r) => r.purchaseOrderId ?? null).filter((v): v is number => v !== null))];
  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.approvedBy, r.createdBy])
        .filter((v): v is number => v !== null),
    ),
  ];
  const [jobs, asms, pos, users] = await Promise.all([
    jobIds.length
      ? db.select({ id: jobsTable.id, n: jobsTable.jobNumber }).from(jobsTable).where(inArray(jobsTable.id, jobIds))
      : [],
    asmIds.length
      ? db.select({ id: bomAssembliesTable.id, n: bomAssembliesTable.mark }).from(bomAssembliesTable).where(inArray(bomAssembliesTable.id, asmIds))
      : [],
    poIds.length
      ? db.select({ id: purchaseOrdersTable.id, n: purchaseOrdersTable.poNumber }).from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, poIds))
      : [],
    userIds.length
      ? db.select({ id: usersTable.id, n: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds))
      : [],
  ]);
  return {
    jobNumbers: new Map(jobs.map((r) => [r.id, r.n])),
    assemblyMarks: new Map(asms.map((r) => [r.id, r.n])),
    poNumbers: new Map(pos.map((r) => [r.id, r.n])),
    userNames: new Map(users.map((r) => [r.id, r.n])),
  };
}

function ncrView(r: NonconformanceReportRow, maps: NameMaps) {
  return {
    id: r.id,
    number: r.number,
    source: r.source,
    description: r.description,
    jobId: r.jobId,
    jobNumber: r.jobId !== null ? (maps.jobNumbers.get(r.jobId) ?? null) : null,
    assemblyId: r.assemblyId,
    assemblyMark: r.assemblyId !== null ? (maps.assemblyMarks.get(r.assemblyId) ?? null) : null,
    purchaseOrderId: r.purchaseOrderId,
    poNumber: r.purchaseOrderId !== null ? (maps.poNumbers.get(r.purchaseOrderId) ?? null) : null,
    disposition: r.disposition,
    dispositionNotes: r.dispositionNotes,
    rootCause: r.rootCause,
    approvedBy: r.approvedBy,
    approvedByName: r.approvedBy !== null ? (maps.userNames.get(r.approvedBy) ?? null) : null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    status: r.status,
    closedAt: r.closedAt?.toISOString() ?? null,
    createdByName: r.createdBy !== null ? (maps.userNames.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function subView(r: SubstitutionRequestRow, maps: NameMaps) {
  return {
    id: r.id,
    number: r.number,
    jobId: r.jobId,
    jobNumber: r.jobId !== null ? (maps.jobNumbers.get(r.jobId) ?? null) : null,
    assemblyId: r.assemblyId,
    assemblyMark: r.assemblyId !== null ? (maps.assemblyMarks.get(r.assemblyId) ?? null) : null,
    originalSpec: r.originalSpec,
    proposedSubstitution: r.proposedSubstitution,
    type: r.type,
    engineeringRationale: r.engineeringRationale,
    customerSpecified: r.customerSpecified,
    safetyCritical: r.safetyCritical,
    customerConcurrence: r.customerConcurrence,
    concurrenceReference: r.concurrenceReference,
    status: r.status,
    approvedBy: r.approvedBy,
    approvedByName: r.approvedBy !== null ? (maps.userNames.get(r.approvedBy) ?? null) : null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    executionReference: r.executionReference,
    createdByName: r.createdBy !== null ? (maps.userNames.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Nonconformance reports
// ---------------------------------------------------------------------------

router.get("/ncrs", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const conditions = [eq(nonconformanceReportsTable.companyId, companyId)];
  const jobIdRaw = typeof req.query.jobId === "string" ? req.query.jobId : null;
  if (jobIdRaw !== null) {
    const jobId = parseIntParam(jobIdRaw);
    if (jobId === null) { res.status(400).json({ error: "Invalid jobId" }); return; }
    conditions.push(eq(nonconformanceReportsTable.jobId, jobId));
  }
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status === "open" || status === "closed") {
    conditions.push(eq(nonconformanceReportsTable.status, status));
  }
  const rows = await db
    .select()
    .from(nonconformanceReportsTable)
    .where(and(...conditions))
    .orderBy(desc(nonconformanceReportsTable.createdAt));
  const maps = await buildNameMaps(rows);
  res.json(rows.map((r) => ncrView(r, maps)));
});

router.post("/ncrs", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const parsed = CreateNcrBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  if (body.jobId != null && !(await loadCompanyJob(body.jobId, companyId))) {
    res.status(400).json({ error: "Unknown job." });
    return;
  }
  if (body.assemblyId != null) {
    const asmJobId = await assemblyCompanyJobId(body.assemblyId, companyId);
    if (asmJobId === null) { res.status(400).json({ error: "Unknown assembly." }); return; }
    if (body.jobId != null && asmJobId !== body.jobId) {
      res.status(400).json({ error: "Assembly does not belong to the given job." });
      return;
    }
  }
  if (body.purchaseOrderId != null && !(await poCompanyOwned(body.purchaseOrderId, companyId))) {
    res.status(400).json({ error: "Unknown purchase order." });
    return;
  }
  const number = await nextCompanyNumber(companyId, "NCR");
  const [created] = await db
    .insert(nonconformanceReportsTable)
    .values({
      companyId,
      number,
      source: body.source,
      description: body.description,
      jobId: body.jobId ?? null,
      assemblyId: body.assemblyId ?? null,
      purchaseOrderId: body.purchaseOrderId ?? null,
      createdBy: req.auth!.user.id,
    })
    .returning();
  const maps = await buildNameMaps([created]);
  res.status(201).json(ncrView(created, maps));
});

router.patch("/ncrs/:ncrId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const ncrId = parseIntParam(req.params.ncrId);
  if (ncrId === null) { res.status(400).json({ error: "Invalid NCR id" }); return; }
  const [ncr] = await db
    .select()
    .from(nonconformanceReportsTable)
    .where(
      and(
        eq(nonconformanceReportsTable.id, ncrId),
        eq(nonconformanceReportsTable.companyId, companyId),
      ),
    );
  if (!ncr) { res.status(404).json({ error: "NCR not found" }); return; }
  const parsed = UpdateNcrBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const updates: Partial<typeof nonconformanceReportsTable.$inferInsert> = {};
  if (body.description !== undefined) {
    if (!body.description.trim()) { res.status(400).json({ error: "Description cannot be empty." }); return; }
    updates.description = body.description;
  }
  if (body.disposition !== undefined) updates.disposition = body.disposition;
  if (body.dispositionNotes !== undefined) updates.dispositionNotes = body.dispositionNotes;
  if (body.rootCause !== undefined) updates.rootCause = body.rootCause;
  if (body.approve) {
    updates.approvedBy = req.auth!.user.id;
    updates.approvedAt = new Date();
  }
  if (body.close && body.reopen) {
    res.status(400).json({ error: "Cannot close and reopen at once." });
    return;
  }
  if (body.close) {
    const disposition = body.disposition !== undefined ? body.disposition : ncr.disposition;
    if (!disposition) {
      res.status(400).json({ error: "An NCR cannot be closed without a disposition." });
      return;
    }
    updates.status = "closed";
    updates.closedAt = new Date();
  }
  if (body.reopen) {
    updates.status = "open";
    updates.closedAt = null;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  updates.updatedAt = new Date();
  const [updated] = await db
    .update(nonconformanceReportsTable)
    .set(updates)
    .where(eq(nonconformanceReportsTable.id, ncr.id))
    .returning();
  const maps = await buildNameMaps([updated]);
  res.json(ncrView(updated, maps));
});

// ---------------------------------------------------------------------------
// Substitution requests
// ---------------------------------------------------------------------------

router.get("/substitution-requests", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const conditions = [eq(substitutionRequestsTable.companyId, companyId)];
  const jobIdRaw = typeof req.query.jobId === "string" ? req.query.jobId : null;
  if (jobIdRaw !== null) {
    const jobId = parseIntParam(jobIdRaw);
    if (jobId === null) { res.status(400).json({ error: "Invalid jobId" }); return; }
    conditions.push(eq(substitutionRequestsTable.jobId, jobId));
  }
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status === "pending" || status === "approved" || status === "rejected") {
    conditions.push(eq(substitutionRequestsTable.status, status));
  }
  const rows = await db
    .select()
    .from(substitutionRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(substitutionRequestsTable.createdAt));
  const maps = await buildNameMaps(rows);
  res.json(rows.map((r) => subView(r, maps)));
});

router.post("/substitution-requests", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const parsed = CreateSubstitutionRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  if (body.jobId != null && !(await loadCompanyJob(body.jobId, companyId))) {
    res.status(400).json({ error: "Unknown job." });
    return;
  }
  if (body.assemblyId != null) {
    const asmJobId = await assemblyCompanyJobId(body.assemblyId, companyId);
    if (asmJobId === null) { res.status(400).json({ error: "Unknown assembly." }); return; }
    if (body.jobId != null && asmJobId !== body.jobId) {
      res.status(400).json({ error: "Assembly does not belong to the given job." });
      return;
    }
  }
  const number = await nextCompanyNumber(companyId, "SUB");
  const [created] = await db
    .insert(substitutionRequestsTable)
    .values({
      companyId,
      number,
      jobId: body.jobId ?? null,
      assemblyId: body.assemblyId ?? null,
      originalSpec: body.originalSpec,
      proposedSubstitution: body.proposedSubstitution,
      type: body.type,
      engineeringRationale: body.engineeringRationale,
      customerSpecified: body.customerSpecified ?? false,
      safetyCritical: body.safetyCritical ?? false,
      createdBy: req.auth!.user.id,
    })
    .returning();
  const maps = await buildNameMaps([created]);
  res.status(201).json(subView(created, maps));
});

router.patch(
  "/substitution-requests/:requestId",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const requestId = parseIntParam(req.params.requestId);
    if (requestId === null) { res.status(400).json({ error: "Invalid request id" }); return; }
    const [request] = await db
      .select()
      .from(substitutionRequestsTable)
      .where(
        and(
          eq(substitutionRequestsTable.id, requestId),
          eq(substitutionRequestsTable.companyId, companyId),
        ),
      );
    if (!request) { res.status(404).json({ error: "Substitution request not found" }); return; }
    const parsed = UpdateSubstitutionRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const body = parsed.data;
    if (body.approve && body.reject) {
      res.status(400).json({ error: "Cannot approve and reject at once." });
      return;
    }
    // Approved/rejected requests are terminal: only the execution reference
    // may still be recorded. In particular, customer concurrence can never be
    // revoked from an approved request — the approval depended on it.
    if (request.status !== "pending") {
      const attempted = Object.entries(body).filter(([, v]) => v !== undefined).map(([k]) => k);
      const disallowed = attempted.filter((k) => k !== "executionReference");
      if (disallowed.length > 0) {
        res.status(409).json({
          error: `This request is ${request.status} and can no longer be modified (only an execution reference may be added).`,
        });
        return;
      }
    }
    const updates: Partial<typeof substitutionRequestsTable.$inferInsert> = {};
    if (body.customerConcurrence !== undefined) updates.customerConcurrence = body.customerConcurrence;
    if (body.concurrenceReference !== undefined) updates.concurrenceReference = body.concurrenceReference;
    if (body.executionReference !== undefined) updates.executionReference = body.executionReference;
    if (body.approve) {
      // Hard gate: customer-specified or safety-critical substitutions cannot
      // be approved without recorded customer concurrence.
      const concurrence =
        body.customerConcurrence !== undefined
          ? body.customerConcurrence
          : request.customerConcurrence;
      if ((request.customerSpecified || request.safetyCritical) && !concurrence) {
        res.status(409).json({
          error:
            "Customer concurrence is required before approving a customer-specified or safety-critical substitution.",
        });
        return;
      }
      updates.status = "approved";
      updates.approvedBy = req.auth!.user.id;
      updates.approvedAt = new Date();
    }
    if (body.reject) {
      updates.status = "rejected";
      updates.approvedBy = req.auth!.user.id;
      updates.approvedAt = new Date();
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    updates.updatedAt = new Date();
    const [updated] = await db
      .update(substitutionRequestsTable)
      .set(updates)
      .where(eq(substitutionRequestsTable.id, request.id))
      .returning();
    const maps = await buildNameMaps([updated]);
    res.json(subView(updated, maps));
  },
);

export default router;
