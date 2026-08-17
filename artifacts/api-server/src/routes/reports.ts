import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  stagesTable,
  employeesTable,
  timeEntriesTable,
  estimatesTable,
  estimateBomAssembliesTable,
  estimateBomPartsTable,
  estimateLaborLinesTable,
  laborRatesTable,
  vendorsTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  receivingRecordsTable,
  receivingLinesTable,
  materialMovementsTable,
  nestingPlansTable,
  nestingPlanBarsTable,
  nestingPlanCutsTable,
  rfisTable,
  shipmentsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc, gte, lte, sql } from "drizzle-orm";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Completed time-entry duration in hours, or null while still clocked in. */
function entryHours(clockIn: Date, clockOut: Date | null): number | null {
  if (!clockOut) return null;
  return Math.max(0, clockOut.getTime() - clockIn.getTime()) / 3600000;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Days between two YYYY-MM-DD dates (b - a). */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000,
  );
}

const OPEN_PO_STATUSES = ["draft", "sent", "approved"];
/**
 * POs that count as financial commitments in cost/vendor reports. Only
 * `approved` POs are committed spend — draft/sent are pending approval and
 * `rejected` never became commitments (receiving also requires approval).
 */
const COMMITTED_PO_STATUSES = ["approved"];

/** Company job ids (optionally restricted), plus number/name lookup. */
async function companyJobs(companyId: number) {
  return db
    .select({
      id: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      name: jobsTable.name,
      customer: jobsTable.customer,
      status: jobsTable.status,
      dueDate: jobsTable.dueDate,
      estimateId: jobsTable.estimateId,
    })
    .from(jobsTable)
    .where(eq(jobsTable.companyId, companyId))
    .orderBy(asc(jobsTable.jobNumber));
}

/**
 * Company labor rates keyed by lowercase trade name, plus the average rate as
 * a fallback for stages that don't match a configured trade.
 */
async function companyLaborRates(companyId: number) {
  const rates = await db
    .select()
    .from(laborRatesTable)
    .where(eq(laborRatesTable.companyId, companyId));
  const byTrade = new Map(rates.map((r) => [r.trade.trim().toLowerCase(), r.hourlyRate]));
  const avg =
    rates.length > 0 ? rates.reduce((s, r) => s + r.hourlyRate, 0) / rates.length : 0;
  return { byTrade, avgRate: avg };
}

/**
 * Actual labor hours + cost per job. Cost uses the company labor-rate table:
 * a stage whose name matches a configured trade uses that trade's rate,
 * otherwise the average configured rate (0 when no rates are configured).
 */
async function actualLaborByJob(companyId: number, jobIds: number[]) {
  const result = new Map<number, { hours: number; cost: number }>();
  if (jobIds.length === 0) return result;
  const { byTrade, avgRate } = await companyLaborRates(companyId);
  const rows = await db
    .select({
      jobId: timeEntriesTable.jobId,
      clockIn: timeEntriesTable.clockIn,
      clockOut: timeEntriesTable.clockOut,
      stageName: stagesTable.name,
    })
    .from(timeEntriesTable)
    .leftJoin(stagesTable, eq(timeEntriesTable.stageId, stagesTable.id))
    .where(inArray(timeEntriesTable.jobId, jobIds));
  for (const r of rows) {
    const hours = entryHours(r.clockIn, r.clockOut);
    if (hours === null) continue;
    const rate = byTrade.get((r.stageName ?? "").trim().toLowerCase()) ?? avgRate;
    const t = result.get(r.jobId) ?? { hours: 0, cost: 0 };
    t.hours += hours;
    t.cost += hours * rate;
    result.set(r.jobId, t);
  }
  return result;
}

/** Consumed material cost per job from material movements. */
async function consumedCostByJob(companyId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({
      jobId: materialMovementsTable.jobId,
      totalCost: materialMovementsTable.totalCost,
      movementType: materialMovementsTable.movementType,
    })
    .from(materialMovementsTable)
    .where(
      and(
        eq(materialMovementsTable.companyId, companyId),
        eq(materialMovementsTable.movementType, "consumed"),
      ),
    );
  const result = new Map<number, number>();
  for (const r of rows) {
    if (r.jobId === null) continue;
    result.set(r.jobId, (result.get(r.jobId) ?? 0) + (r.totalCost ?? 0));
  }
  return result;
}

/** Total PO line value per job (all non-cancelled POs). */
async function poValueByJob(jobIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (jobIds.length === 0) return result;
  const rows = await db
    .select({
      jobId: purchaseOrdersTable.jobId,
      status: purchaseOrdersTable.status,
      pieces: purchaseOrderLinesTable.pieces,
      unitPrice: purchaseOrderLinesTable.unitPrice,
    })
    .from(purchaseOrderLinesTable)
    .innerJoin(
      purchaseOrdersTable,
      eq(purchaseOrderLinesTable.purchaseOrderId, purchaseOrdersTable.id),
    )
    .where(
      and(
        inArray(purchaseOrdersTable.jobId, jobIds),
        inArray(purchaseOrdersTable.status, COMMITTED_PO_STATUSES),
      ),
    );
  for (const r of rows) {
    result.set(r.jobId, (result.get(r.jobId) ?? 0) + (r.unitPrice ?? 0) * r.pieces);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Labor detail
// ---------------------------------------------------------------------------

router.get("/reports/labor-detail", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const jobId = typeof req.query.jobId === "string" ? parseIntParam(req.query.jobId) : null;
  const employeeId =
    typeof req.query.employeeId === "string" ? parseIntParam(req.query.employeeId) : null;

  const conditions = [eq(employeesTable.companyId, companyId)];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from))
    conditions.push(gte(timeEntriesTable.clockIn, new Date(`${from}T00:00:00Z`)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(to))
    conditions.push(lte(timeEntriesTable.clockIn, new Date(`${to}T23:59:59.999Z`)));
  if (jobId !== null) conditions.push(eq(timeEntriesTable.jobId, jobId));
  if (employeeId !== null) conditions.push(eq(timeEntriesTable.employeeId, employeeId));

  const rows = await db
    .select({
      id: timeEntriesTable.id,
      clockIn: timeEntriesTable.clockIn,
      clockOut: timeEntriesTable.clockOut,
      employeeId: employeesTable.id,
      employeeName: employeesTable.name,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
      stageName: stagesTable.name,
    })
    .from(timeEntriesTable)
    .innerJoin(employeesTable, eq(timeEntriesTable.employeeId, employeesTable.id))
    .innerJoin(jobsTable, eq(timeEntriesTable.jobId, jobsTable.id))
    .leftJoin(stagesTable, eq(timeEntriesTable.stageId, stagesTable.id))
    .where(and(...conditions))
    .orderBy(asc(timeEntriesTable.clockIn));

  const entries = [];
  const byEmployee = new Map<number, { employeeId: number; employeeName: string; hours: number }>();
  const byJob = new Map<number, { jobId: number; jobNumber: string; jobName: string; hours: number }>();
  let totalHours = 0;
  for (const r of rows) {
    const hours = entryHours(r.clockIn, r.clockOut);
    if (hours === null) continue;
    totalHours += hours;
    entries.push({
      id: r.id,
      date: isoDate(r.clockIn),
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      jobName: r.jobName,
      stageName: r.stageName ?? null,
      clockIn: r.clockIn.toISOString(),
      clockOut: r.clockOut!.toISOString(),
      hours: round2(hours),
    });
    const e = byEmployee.get(r.employeeId) ?? {
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      hours: 0,
    };
    e.hours = round2(e.hours + hours);
    byEmployee.set(r.employeeId, e);
    const j = byJob.get(r.jobId) ?? {
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      jobName: r.jobName,
      hours: 0,
    };
    j.hours = round2(j.hours + hours);
    byJob.set(r.jobId, j);
  }

  res.json({
    entries,
    employeeTotals: [...byEmployee.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    ),
    jobTotals: [...byJob.values()].sort((a, b) => a.jobNumber.localeCompare(b.jobNumber)),
    totalHours: round2(totalHours),
  });
});

// ---------------------------------------------------------------------------
// Outstanding POs
// ---------------------------------------------------------------------------

router.get("/reports/outstanding-pos", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const today = isoDate(new Date());

  const pos = await db
    .select({
      id: purchaseOrdersTable.id,
      poNumber: purchaseOrdersTable.poNumber,
      status: purchaseOrdersTable.status,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
      vendorName: vendorsTable.name,
    })
    .from(purchaseOrdersTable)
    .innerJoin(jobsTable, eq(purchaseOrdersTable.jobId, jobsTable.id))
    .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
    .where(
      and(eq(jobsTable.companyId, companyId), inArray(purchaseOrdersTable.status, OPEN_PO_STATUSES)),
    )
    .orderBy(asc(purchaseOrdersTable.poNumber));

  const poIds = pos.map((p) => p.id);
  const lines =
    poIds.length === 0
      ? []
      : await db
          .select()
          .from(purchaseOrderLinesTable)
          .where(inArray(purchaseOrderLinesTable.purchaseOrderId, poIds));

  // Aggregate received pieces per line so fully-received lines drop out and
  // partially-received lines count only their remaining value.
  const receivedByLine = new Map<number, number>();
  if (lines.length > 0) {
    const receivedRows = await db
      .select({
        purchaseOrderLineId: receivingLinesTable.purchaseOrderLineId,
        received: sql<number>`cast(coalesce(sum(${receivingLinesTable.pieces}), 0) as int)`,
      })
      .from(receivingLinesTable)
      .where(inArray(receivingLinesTable.purchaseOrderLineId, lines.map((l) => l.id)))
      .groupBy(receivingLinesTable.purchaseOrderLineId);
    for (const r of receivedRows) {
      if (r.purchaseOrderLineId !== null) receivedByLine.set(r.purchaseOrderLineId, r.received);
    }
  }

  const linesByPo = new Map<number, typeof lines>();
  for (const l of lines) {
    const remaining = l.pieces - (receivedByLine.get(l.id) ?? 0);
    if (remaining <= 0) continue; // fully received — nothing outstanding
    const list = linesByPo.get(l.purchaseOrderId) ?? [];
    list.push(l);
    linesByPo.set(l.purchaseOrderId, list);
  }

  const soonCutoff = isoDate(new Date(Date.now() + 7 * 86400000));
  const result = pos
    .filter((p) => (linesByPo.get(p.id) ?? []).length > 0)
    .map((p) => {
    const poLines = linesByPo.get(p.id) ?? [];
    const value = poLines.reduce(
      (s, l) => s + (l.unitPrice ?? 0) * Math.max(0, l.pieces - (receivedByLine.get(l.id) ?? 0)),
      0,
    );
    const promiseDates = poLines
      .map((l) => l.promiseDate)
      .filter((d): d is string => d !== null)
      .sort();
    const earliestPromise = promiseDates[0] ?? null;
    let dueStatus: string = "no_date";
    if (earliestPromise !== null) {
      if (earliestPromise < today) dueStatus = "overdue";
      else if (earliestPromise <= soonCutoff) dueStatus = "due_soon";
      else dueStatus = "ok";
    }
    return {
      id: p.id,
      poNumber: p.poNumber,
      status: p.status,
      jobId: p.jobId,
      jobNumber: p.jobNumber,
      jobName: p.jobName,
      vendorName: p.vendorName ?? null,
      lineCount: poLines.length,
      value: round2(value),
      earliestPromiseDate: earliestPromise,
      dueStatus,
    };
  });
  // Overdue first, then due soon, then by promise date
  const rank: Record<string, number> = { overdue: 0, due_soon: 1, ok: 2, no_date: 3 };
  result.sort(
    (a, b) =>
      rank[a.dueStatus] - rank[b.dueStatus] ||
      (a.earliestPromiseDate ?? "9999").localeCompare(b.earliestPromiseDate ?? "9999"),
  );
  res.json({
    pos: result,
    totalValue: round2(result.reduce((s, p) => s + p.value, 0)),
    overdueCount: result.filter((p) => p.dueStatus === "overdue").length,
  });
});

// ---------------------------------------------------------------------------
// Estimate vs actual / job margin
// ---------------------------------------------------------------------------

/**
 * Shared job-cost rollup used by estimate-vs-actual, job margin, and WIP:
 * estimate figures + actual labor (rate table) + consumed material + PO value.
 */
async function jobCostRollup(companyId: number) {
  const jobs = await companyJobs(companyId);
  const jobIds = jobs.map((j) => j.id);
  const estimateIds = [...new Set(jobs.map((j) => j.estimateId).filter((x): x is number => x !== null))];
  const estimates =
    estimateIds.length === 0
      ? []
      : await db.select().from(estimatesTable).where(inArray(estimatesTable.id, estimateIds));
  const estById = new Map(estimates.map((e) => [e.id, e]));

  // Estimated labor cost from estimate labor lines
  const laborLines =
    estimateIds.length === 0
      ? []
      : await db
          .select()
          .from(estimateLaborLinesTable)
          .where(inArray(estimateLaborLinesTable.estimateId, estimateIds));
  const estLaborByEstimate = new Map<number, { hours: number; cost: number }>();
  for (const l of laborLines) {
    const t = estLaborByEstimate.get(l.estimateId) ?? { hours: 0, cost: 0 };
    t.hours += l.hours;
    t.cost += l.hours * l.hourlyRate;
    estLaborByEstimate.set(l.estimateId, t);
  }

  // Estimated material cost from estimate BOM parts (quoted price, falling
  // back to catalog price) — the cost budget, excluding margin.
  const estMaterialByEstimate = new Map<number, number>();
  if (estimateIds.length > 0) {
    const estAssemblies = await db
      .select({ id: estimateBomAssembliesTable.id, estimateId: estimateBomAssembliesTable.estimateId })
      .from(estimateBomAssembliesTable)
      .where(inArray(estimateBomAssembliesTable.estimateId, estimateIds));
    const estimateByAssembly = new Map(estAssemblies.map((a) => [a.id, a.estimateId]));
    const assemblyIds = estAssemblies.map((a) => a.id);
    const parts =
      assemblyIds.length === 0
        ? []
        : await db
            .select()
            .from(estimateBomPartsTable)
            .where(inArray(estimateBomPartsTable.assemblyId, assemblyIds));
    for (const p of parts) {
      const estimateId = estimateByAssembly.get(p.assemblyId);
      if (estimateId === undefined) continue;
      const unitPrice = p.quotedUnitPrice ?? p.catalogUnitPrice ?? 0;
      estMaterialByEstimate.set(estimateId, (estMaterialByEstimate.get(estimateId) ?? 0) + unitPrice * p.quantity);
    }
  }

  const [actualLabor, consumed, poValue] = await Promise.all([
    actualLaborByJob(companyId, jobIds),
    consumedCostByJob(companyId),
    poValueByJob(jobIds),
  ]);

  return jobs.map((job) => {
    const est = job.estimateId !== null ? estById.get(job.estimateId) : undefined;
    const estLabor = est ? (estLaborByEstimate.get(est.id) ?? { hours: 0, cost: 0 }) : { hours: 0, cost: 0 };
    const labor = actualLabor.get(job.id) ?? { hours: 0, cost: 0 };
    const materialCost = consumed.get(job.id) ?? 0;
    const poCost = poValue.get(job.id) ?? 0;
    const actualCost = labor.cost + materialCost;
    const estMaterialCost = est ? (estMaterialByEstimate.get(est.id) ?? 0) : 0;
    return {
      job,
      estimate: est ?? null,
      estimatedHours: round2(est?.estimatedHours ?? estLabor.hours),
      estimatedLaborCost: round2(estLabor.cost),
      estimatedMaterialCost: round2(estMaterialCost),
      estimatedTotalCost: round2(estLabor.cost + estMaterialCost),
      contractValue: est?.amount ?? null,
      actualHours: round2(labor.hours),
      actualLaborCost: round2(labor.cost),
      materialCost: round2(materialCost),
      poValue: round2(poCost),
      actualCost: round2(actualCost),
    };
  });
}

router.get("/reports/estimate-vs-actual", requireAuth, async (req, res): Promise<void> => {
  const rollup = await jobCostRollup(req.auth!.companyId);
  const rows = rollup
    .filter((r) => r.estimate !== null)
    .map((r) => ({
      jobId: r.job.id,
      jobNumber: r.job.jobNumber,
      jobName: r.job.name,
      jobStatus: r.job.status,
      bidNumber: r.estimate!.bidNumber,
      estimatedHours: r.estimatedHours,
      actualHours: r.actualHours,
      hoursVariance: round2(r.actualHours - r.estimatedHours),
      estimatedLaborCost: r.estimatedLaborCost,
      estimatedMaterialCost: r.estimatedMaterialCost,
      estimatedTotalCost: r.estimatedTotalCost,
      estimateAmount: r.contractValue,
      actualCost: r.actualCost,
      // Cost variance vs. the estimate's cost budget (labor + material, no margin)
      costVariance: round2(r.actualCost - r.estimatedTotalCost),
      // Revenue-side variance kept separate: quoted amount minus actual cost
      contractVariance: r.contractValue !== null ? round2(r.contractValue - r.actualCost) : null,
      actualLaborCost: r.actualLaborCost,
      materialCost: r.materialCost,
    }));
  res.json(rows);
});

router.get("/reports/job-margin", requireAuth, async (req, res): Promise<void> => {
  const rollup = await jobCostRollup(req.auth!.companyId);
  const rows = rollup
    .filter((r) => r.contractValue !== null)
    .map((r) => {
      const contract = r.contractValue as number;
      const margin = contract - r.actualCost;
      return {
        jobId: r.job.id,
        jobNumber: r.job.jobNumber,
        jobName: r.job.name,
        jobStatus: r.job.status,
        customer: r.job.customer,
        contractValue: round2(contract),
        actualLaborCost: r.actualLaborCost,
        materialCost: r.materialCost,
        actualCost: r.actualCost,
        margin: round2(margin),
        marginPercent: contract > 0 ? round1((margin / contract) * 100) : null,
        estimatedMarginPercent: r.estimate?.marginPercent ?? null,
      };
    });
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Bid win/loss
// ---------------------------------------------------------------------------

router.get("/reports/bid-win-loss", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const estimates = await db
    .select()
    .from(estimatesTable)
    .where(eq(estimatesTable.companyId, companyId))
    .orderBy(asc(estimatesTable.createdAt));

  const classify = (status: string): "won" | "lost" | "open" => {
    const s = status.toLowerCase();
    if (s === "won") return "won";
    if (s === "lost" || s === "declined" || s === "cancelled") return "lost";
    return "open";
  };

  const byMonth = new Map<
    string,
    { month: string; wonCount: number; wonAmount: number; lostCount: number; lostAmount: number; openCount: number; openAmount: number }
  >();
  let wonCount = 0, wonAmount = 0, lostCount = 0, lostAmount = 0, openCount = 0, openAmount = 0;
  for (const e of estimates) {
    const month = (e.bidDate ?? isoDate(e.createdAt)).slice(0, 7);
    const b = byMonth.get(month) ?? {
      month, wonCount: 0, wonAmount: 0, lostCount: 0, lostAmount: 0, openCount: 0, openAmount: 0,
    };
    const amount = e.amount ?? 0;
    const cls = classify(e.status);
    if (cls === "won") { b.wonCount++; b.wonAmount = round2(b.wonAmount + amount); wonCount++; wonAmount += amount; }
    else if (cls === "lost") { b.lostCount++; b.lostAmount = round2(b.lostAmount + amount); lostCount++; lostAmount += amount; }
    else { b.openCount++; b.openAmount = round2(b.openAmount + amount); openCount++; openAmount += amount; }
    byMonth.set(month, b);
  }
  const decided = wonCount + lostCount;
  res.json({
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    totals: {
      wonCount,
      wonAmount: round2(wonAmount),
      lostCount,
      lostAmount: round2(lostAmount),
      openCount,
      openAmount: round2(openAmount),
      winRatePercent: decided > 0 ? round1((wonCount / decided) * 100) : null,
    },
  });
});

// ---------------------------------------------------------------------------
// Backlog
// ---------------------------------------------------------------------------

router.get("/reports/backlog", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobs = await companyJobs(companyId);
  const active = jobs.filter((j) => j.status !== "complete" && j.status !== "closed");
  const estimateIds = [...new Set(active.map((j) => j.estimateId).filter((x): x is number => x !== null))];
  const estimates =
    estimateIds.length === 0
      ? []
      : await db
          .select({ id: estimatesTable.id, amount: estimatesTable.amount, bidNumber: estimatesTable.bidNumber })
          .from(estimatesTable)
          .where(inArray(estimatesTable.id, estimateIds));
  const estById = new Map(estimates.map((e) => [e.id, e]));

  // Shipment activity: jobs with departed shipments are partially delivered
  const jobIds = active.map((j) => j.id);
  const shipments =
    jobIds.length === 0
      ? []
      : await db
          .select({ jobId: shipmentsTable.jobId, status: shipmentsTable.status })
          .from(shipmentsTable)
          .where(inArray(shipmentsTable.jobId, jobIds));
  const departedJobs = new Set(shipments.filter((s) => s.status === "departed").map((s) => s.jobId));

  const rows = active.map((j) => {
    const est = j.estimateId !== null ? estById.get(j.estimateId) : undefined;
    return {
      jobId: j.id,
      jobNumber: j.jobNumber,
      jobName: j.name,
      customer: j.customer,
      status: j.status,
      dueDate: j.dueDate,
      bidNumber: est?.bidNumber ?? null,
      contractValue: est?.amount ?? null,
      hasDepartedShipments: departedJobs.has(j.id),
    };
  });
  res.json({
    jobs: rows,
    totalContractValue: round2(rows.reduce((s, r) => s + (r.contractValue ?? 0), 0)),
    jobCount: rows.length,
    unvaluedJobCount: rows.filter((r) => r.contractValue === null).length,
  });
});

// ---------------------------------------------------------------------------
// Estimate recap
// ---------------------------------------------------------------------------

router.get("/reports/estimate-recap/:estimateId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const estimateId = parseIntParam(req.params.estimateId);
  if (estimateId === null) { res.status(400).json({ error: "Invalid estimate id" }); return; }
  const [estimate] = await db
    .select()
    .from(estimatesTable)
    .where(and(eq(estimatesTable.id, estimateId), eq(estimatesTable.companyId, companyId)));
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }

  const assemblies = await db
    .select({ id: estimateBomAssembliesTable.id })
    .from(estimateBomAssembliesTable)
    .where(eq(estimateBomAssembliesTable.estimateId, estimateId));
  const assemblyIds = assemblies.map((a) => a.id);
  const parts =
    assemblyIds.length === 0
      ? []
      : await db
          .select()
          .from(estimateBomPartsTable)
          .where(inArray(estimateBomPartsTable.assemblyId, assemblyIds));

  // Material rollup by category (profile type; misc items grouped separately)
  const categories = new Map<string, { category: string; partCount: number; pieceCount: number; cost: number }>();
  let materialTotal = 0;
  for (const p of parts) {
    const unitPrice = p.quotedUnitPrice ?? p.catalogUnitPrice ?? 0;
    const cost = unitPrice * p.quantity;
    materialTotal += cost;
    const category = p.isMisc ? "Misc / Hardware" : p.profileType || "Uncategorized";
    const c = categories.get(category) ?? { category, partCount: 0, pieceCount: 0, cost: 0 };
    c.partCount += 1;
    c.pieceCount += p.quantity;
    c.cost = round2(c.cost + cost);
    categories.set(category, c);
  }

  const laborLines = await db
    .select()
    .from(estimateLaborLinesTable)
    .where(eq(estimateLaborLinesTable.estimateId, estimateId));
  const labor = laborLines.map((l) => ({
    trade: l.trade,
    hours: l.hours,
    hourlyRate: l.hourlyRate,
    cost: round2(l.hours * l.hourlyRate),
  }));
  const laborTotal = labor.reduce((s, l) => s + l.cost, 0);
  const subtotal = materialTotal + laborTotal;
  const marginAmount = subtotal * (estimate.marginPercent / 100);

  res.json({
    estimateId: estimate.id,
    bidNumber: estimate.bidNumber,
    name: estimate.name,
    customer: estimate.customer,
    status: estimate.status,
    materialCategories: [...categories.values()].sort((a, b) => b.cost - a.cost),
    materialTotal: round2(materialTotal),
    laborLines: labor,
    laborTotal: round2(laborTotal),
    subtotal: round2(subtotal),
    marginPercent: estimate.marginPercent,
    marginAmount: round2(marginAmount),
    total: round2(subtotal + marginAmount),
    quotedAmount: estimate.amount,
  });
});

// ---------------------------------------------------------------------------
// Job costing / WIP
// ---------------------------------------------------------------------------

router.get("/reports/job-costing", requireAuth, async (req, res): Promise<void> => {
  const rollup = await jobCostRollup(req.auth!.companyId);
  const rows = rollup.map((r) => ({
    jobId: r.job.id,
    jobNumber: r.job.jobNumber,
    jobName: r.job.name,
    customer: r.job.customer,
    status: r.job.status,
    contractValue: r.contractValue,
    laborHours: r.actualHours,
    laborCost: r.actualLaborCost,
    materialConsumedCost: r.materialCost,
    poValue: r.poValue,
    totalCost: r.actualCost,
    wip:
      r.contractValue !== null && r.job.status !== "complete" && r.job.status !== "closed"
        ? round2((r.contractValue as number) - r.actualCost)
        : null,
  }));
  res.json({
    jobs: rows,
    totals: {
      laborCost: round2(rows.reduce((s, r) => s + r.laborCost, 0)),
      materialConsumedCost: round2(rows.reduce((s, r) => s + r.materialConsumedCost, 0)),
      poValue: round2(rows.reduce((s, r) => s + r.poValue, 0)),
      totalCost: round2(rows.reduce((s, r) => s + r.totalCost, 0)),
    },
  });
});

// ---------------------------------------------------------------------------
// Material yield / scrap (from nesting plans)
// ---------------------------------------------------------------------------

router.get("/reports/material-yield", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const plans = await db
    .select({
      id: nestingPlansTable.id,
      status: nestingPlansTable.status,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
    })
    .from(nestingPlansTable)
    .innerJoin(jobsTable, eq(nestingPlansTable.jobId, jobsTable.id))
    .where(and(eq(jobsTable.companyId, companyId), eq(nestingPlansTable.status, "accepted")));
  const planIds = plans.map((p) => p.id);
  const bars =
    planIds.length === 0
      ? []
      : await db
          .select()
          .from(nestingPlanBarsTable)
          .where(inArray(nestingPlanBarsTable.planId, planIds));

  const planById = new Map(plans.map((p) => [p.id, p]));
  type YieldRow = {
    key: string;
    jobId: number;
    jobNumber: string;
    jobName: string;
    profileType: string;
    profileSize: string;
    grade: string;
    barCount: number;
    stockLengthIn: number;
    wasteIn: number;
  };
  const rows = new Map<string, YieldRow>();
  for (const bar of bars) {
    const plan = planById.get(bar.planId);
    if (!plan) continue;
    const key = `${plan.jobId}|${bar.profileType}|${bar.profileSize}|${bar.grade}`;
    const r = rows.get(key) ?? {
      key,
      jobId: plan.jobId,
      jobNumber: plan.jobNumber,
      jobName: plan.jobName,
      profileType: bar.profileType,
      profileSize: bar.profileSize,
      grade: bar.grade,
      barCount: 0,
      stockLengthIn: 0,
      wasteIn: 0,
    };
    r.barCount += 1;
    r.stockLengthIn += bar.stockLengthIn;
    r.wasteIn += bar.wasteIn;
    rows.set(key, r);
  }
  const result = [...rows.values()].map((r) => ({
    jobId: r.jobId,
    jobNumber: r.jobNumber,
    jobName: r.jobName,
    profileType: r.profileType,
    profileSize: r.profileSize,
    grade: r.grade,
    barCount: r.barCount,
    stockLengthIn: round2(r.stockLengthIn),
    usedLengthIn: round2(r.stockLengthIn - r.wasteIn),
    wasteIn: round2(r.wasteIn),
    scrapPercent: r.stockLengthIn > 0 ? round1((r.wasteIn / r.stockLengthIn) * 100) : 0,
    yieldPercent:
      r.stockLengthIn > 0 ? round1(((r.stockLengthIn - r.wasteIn) / r.stockLengthIn) * 100) : 0,
  }));
  result.sort((a, b) => a.jobNumber.localeCompare(b.jobNumber) || b.scrapPercent - a.scrapPercent);
  const totalStock = result.reduce((s, r) => s + r.stockLengthIn, 0);
  const totalWaste = result.reduce((s, r) => s + r.wasteIn, 0);
  res.json({
    rows: result,
    totals: {
      stockLengthIn: round2(totalStock),
      wasteIn: round2(totalWaste),
      scrapPercent: totalStock > 0 ? round1((totalWaste / totalStock) * 100) : 0,
      yieldPercent: totalStock > 0 ? round1(((totalStock - totalWaste) / totalStock) * 100) : 0,
    },
  });
});

// ---------------------------------------------------------------------------
// Cut lists (accepted nesting plans, flattened for print)
// ---------------------------------------------------------------------------

router.get("/reports/cut-lists", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = typeof req.query.jobId === "string" ? parseIntParam(req.query.jobId) : null;

  const conditions = [eq(jobsTable.companyId, companyId), eq(nestingPlansTable.status, "accepted")];
  if (jobId !== null) conditions.push(eq(nestingPlansTable.jobId, jobId));
  const plans = await db
    .select({
      id: nestingPlansTable.id,
      createdAt: nestingPlansTable.createdAt,
      acceptedAt: nestingPlansTable.acceptedAt,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
    })
    .from(nestingPlansTable)
    .innerJoin(jobsTable, eq(nestingPlansTable.jobId, jobsTable.id))
    .where(and(...conditions))
    .orderBy(desc(nestingPlansTable.createdAt));

  const planIds = plans.map((p) => p.id);
  const bars =
    planIds.length === 0
      ? []
      : await db
          .select()
          .from(nestingPlanBarsTable)
          .where(inArray(nestingPlanBarsTable.planId, planIds))
          .orderBy(asc(nestingPlanBarsTable.sortIndex));
  const barIds = bars.map((b) => b.id);
  const cuts =
    barIds.length === 0
      ? []
      : await db
          .select()
          .from(nestingPlanCutsTable)
          .where(inArray(nestingPlanCutsTable.barId, barIds))
          .orderBy(asc(nestingPlanCutsTable.sortIndex));
  const cutsByBar = new Map<number, typeof cuts>();
  for (const c of cuts) {
    const list = cutsByBar.get(c.barId) ?? [];
    list.push(c);
    cutsByBar.set(c.barId, list);
  }
  const barsByPlan = new Map<number, typeof bars>();
  for (const b of bars) {
    const list = barsByPlan.get(b.planId) ?? [];
    list.push(b);
    barsByPlan.set(b.planId, list);
  }

  res.json(
    plans.map((p) => ({
      planId: p.id,
      jobId: p.jobId,
      jobNumber: p.jobNumber,
      jobName: p.jobName,
      acceptedAt: p.acceptedAt ? p.acceptedAt.toISOString() : null,
      bars: (barsByPlan.get(p.id) ?? []).map((b, index) => ({
        barNumber: index + 1,
        profileType: b.profileType,
        profileSize: b.profileSize,
        grade: b.grade,
        source: b.source,
        vendorName: b.vendorName ?? null,
        stockLengthIn: b.stockLengthIn,
        wasteIn: b.wasteIn,
        cuts: (cutsByBar.get(b.id) ?? []).map((c) => ({
          label: c.label ?? null,
          lengthIn: c.lengthIn,
          quantity: c.quantity,
        })),
      })),
    })),
  );
});

// ---------------------------------------------------------------------------
// RFI turnaround
// ---------------------------------------------------------------------------

router.get("/reports/rfi-turnaround", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const today = isoDate(new Date());
  const rows = await db
    .select({
      id: rfisTable.id,
      number: rfisTable.number,
      question: rfisTable.question,
      status: rfisTable.status,
      dueDate: rfisTable.dueDate,
      responseDate: rfisTable.responseDate,
      createdAt: rfisTable.createdAt,
      directedTo: rfisTable.directedTo,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
    })
    .from(rfisTable)
    .innerJoin(jobsTable, eq(rfisTable.jobId, jobsTable.id))
    .where(eq(rfisTable.companyId, companyId))
    .orderBy(desc(rfisTable.createdAt));

  const rfis = rows.map((r) => {
    const created = isoDate(r.createdAt);
    const turnaroundDays = r.responseDate !== null ? daysBetween(created, r.responseDate) : null;
    const daysOpen = r.status === "closed" && r.responseDate !== null ? null : daysBetween(created, today);
    return {
      id: r.id,
      number: r.number,
      jobId: r.jobId,
      jobNumber: r.jobNumber,
      jobName: r.jobName,
      question: r.question,
      directedTo: r.directedTo ?? null,
      status: r.status,
      createdDate: created,
      dueDate: r.dueDate,
      responseDate: r.responseDate,
      turnaroundDays,
      daysOpen,
      overdue: r.status !== "closed" && r.dueDate !== null && r.dueDate < today,
    };
  });
  const answered = rfis.filter((r) => r.turnaroundDays !== null);
  res.json({
    rfis,
    summary: {
      openCount: rfis.filter((r) => r.status !== "closed").length,
      overdueCount: rfis.filter((r) => r.overdue).length,
      answeredCount: answered.length,
      avgTurnaroundDays:
        answered.length > 0
          ? round1(answered.reduce((s, r) => s + (r.turnaroundDays ?? 0), 0) / answered.length)
          : null,
    },
  });
});

// ---------------------------------------------------------------------------
// Vendor performance
// ---------------------------------------------------------------------------

router.get("/reports/vendor-performance", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.companyId, companyId))
    .orderBy(asc(vendorsTable.name));

  const pos = await db
    .select({
      id: purchaseOrdersTable.id,
      vendorId: purchaseOrdersTable.vendorId,
      status: purchaseOrdersTable.status,
    })
    .from(purchaseOrdersTable)
    .innerJoin(jobsTable, eq(purchaseOrdersTable.jobId, jobsTable.id))
    .where(and(eq(jobsTable.companyId, companyId), inArray(purchaseOrdersTable.status, COMMITTED_PO_STATUSES)));
  const poIds = pos.map((p) => p.id);
  const poById = new Map(pos.map((p) => [p.id, p]));

  const lines =
    poIds.length === 0
      ? []
      : await db
          .select()
          .from(purchaseOrderLinesTable)
          .where(inArray(purchaseOrderLinesTable.purchaseOrderId, poIds));
  const receipts =
    poIds.length === 0
      ? []
      : await db
          .select({
            purchaseOrderId: receivingRecordsTable.purchaseOrderId,
            receivedDate: receivingRecordsTable.receivedDate,
          })
          .from(receivingRecordsTable)
          .where(inArray(receivingRecordsTable.purchaseOrderId, poIds));
  // First receipt date per PO
  const firstReceiptByPo = new Map<number, string>();
  for (const r of receipts) {
    const cur = firstReceiptByPo.get(r.purchaseOrderId);
    if (cur === undefined || r.receivedDate < cur) firstReceiptByPo.set(r.purchaseOrderId, r.receivedDate);
  }
  // Earliest promise date + spend per PO
  const promiseByPo = new Map<number, string>();
  const spendByPo = new Map<number, number>();
  for (const l of lines) {
    if (l.promiseDate !== null) {
      const cur = promiseByPo.get(l.purchaseOrderId);
      if (cur === undefined || l.promiseDate < cur) promiseByPo.set(l.purchaseOrderId, l.promiseDate);
    }
    spendByPo.set(
      l.purchaseOrderId,
      (spendByPo.get(l.purchaseOrderId) ?? 0) + (l.unitPrice ?? 0) * l.pieces,
    );
  }

  type Perf = {
    poCount: number;
    totalSpend: number;
    receivedCount: number;
    measuredCount: number;
    onTimeCount: number;
    lateDaysSum: number;
  };
  const perf = new Map<number, Perf>();
  for (const po of pos) {
    if (po.vendorId === null) continue;
    const p = perf.get(po.vendorId) ?? {
      poCount: 0, totalSpend: 0, receivedCount: 0, measuredCount: 0, onTimeCount: 0, lateDaysSum: 0,
    };
    p.poCount += 1;
    p.totalSpend += spendByPo.get(po.id) ?? 0;
    const received = firstReceiptByPo.get(po.id);
    if (received !== undefined) {
      p.receivedCount += 1;
      const promise = promiseByPo.get(po.id);
      if (promise !== undefined) {
        p.measuredCount += 1;
        const late = daysBetween(promise, received);
        if (late <= 0) p.onTimeCount += 1;
        else p.lateDaysSum += late;
      }
    }
    perf.set(po.vendorId, p);
  }

  res.json(
    vendors.map((v) => {
      const p = perf.get(v.id);
      return {
        vendorId: v.id,
        vendorName: v.name,
        vendorStatus: v.status,
        poCount: p?.poCount ?? 0,
        totalSpend: round2(p?.totalSpend ?? 0),
        receivedPoCount: p?.receivedCount ?? 0,
        onTimePercent:
          p !== undefined && p.measuredCount > 0
            ? round1((p.onTimeCount / p.measuredCount) * 100)
            : null,
        avgDaysLate:
          p !== undefined && p.measuredCount > p.onTimeCount
            ? round1(p.lateDaysSum / (p.measuredCount - p.onTimeCount))
            : null,
      };
    }),
  );
});

export default router;
