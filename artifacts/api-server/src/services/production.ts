import { db } from "@workspace/db";
import {
  jobsTable,
  stagesTable,
  employeesTable,
  timeEntriesTable,
  estimatesTable,
  jobAssignmentsTable,
  purchaseOrdersTable,
  bomAssembliesTable,
  bomPartsTable,
} from "@workspace/db";
import { eq, inArray, asc } from "drizzle-orm";

export const DEFAULT_STAGES = [
  "Estimating",
  "Fabrication",
  "Welding",
  "Paint",
  "Inspection",
  "Shipping",
];

type StageRow = typeof stagesTable.$inferSelect;
type JobRow = typeof jobsTable.$inferSelect;
type TimeEntryRow = typeof timeEntriesTable.$inferSelect;
type AssemblyRow = typeof bomAssembliesTable.$inferSelect;
type PartRow = typeof bomPartsTable.$inferSelect;

/** Extract the max numeric suffix from numbers like "B-1003" / "J-2001". */
function maxNumericSuffix(values: string[], prefix: string): number {
  let max = 0;
  const re = new RegExp(`^${prefix}-?(\\d+)$`, "i");
  for (const v of values) {
    const m = re.exec(v.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/** Next sequential bid number, e.g. B-1001. */
export async function nextBidNumber(): Promise<string> {
  const rows = await db
    .select({ bidNumber: estimatesTable.bidNumber })
    .from(estimatesTable);
  const max = maxNumericSuffix(
    rows.map((r) => r.bidNumber),
    "B",
  );
  return `B-${Math.max(1000, max) + 1}`;
}

/** Next sequential job number, e.g. J-2001. Seeded above legacy numbers. */
export async function nextJobNumber(): Promise<string> {
  const rows = await db
    .select({ jobNumber: jobsTable.jobNumber })
    .from(jobsTable);
  const max = maxNumericSuffix(
    rows.map((r) => r.jobNumber),
    "J",
  );
  return `J-${Math.max(2000, max) + 1}`;
}

/** Next sequential purchase order number, e.g. PO-3001. */
export async function nextPoNumber(): Promise<string> {
  const rows = await db
    .select({ poNumber: purchaseOrdersTable.poNumber })
    .from(purchaseOrdersTable);
  const max = maxNumericSuffix(
    rows.map((r) => r.poNumber),
    "PO",
  );
  return `PO-${Math.max(3000, max) + 1}`;
}

export interface StageSpec {
  name: string;
  estimatedHours?: number;
}

export interface CreateJobParams {
  name: string;
  customer: string;
  customerId?: number | null;
  status?: string;
  dueDate?: string | null;
  notes?: string | null;
  estimateId?: number | null;
  stages?: StageSpec[];
}

/**
 * Create a job with a server-assigned job number and its stage routing
 * (custom or default workflow). First stage starts in_progress.
 */
export async function createJobWithRouting(params: CreateJobParams) {
  const jobNumber = await nextJobNumber();
  const [job] = await db
    .insert(jobsTable)
    .values({
      jobNumber,
      name: params.name,
      customer: params.customer,
      customerId: params.customerId ?? null,
      status: params.status ?? "active",
      dueDate: params.dueDate ?? null,
      notes: params.notes ?? null,
      estimateId: params.estimateId ?? null,
    })
    .returning();

  const stageSpecs =
    params.stages && params.stages.length > 0
      ? params.stages
      : DEFAULT_STAGES.map((name) => ({ name, estimatedHours: 0 }));

  await db.insert(stagesTable).values(
    stageSpecs.map((s, index) => ({
      jobId: job.id,
      name: s.name,
      estimatedHours: s.estimatedHours ?? 0,
      orderIndex: index,
      status: index === 0 ? "in_progress" : "not_started",
    })),
  );

  return job;
}

export interface AssignedEmployee {
  id: number;
  name: string;
}

/** Map of jobId -> assigned employees (id + name) for the given job ids. */
export async function assignedEmployeesByJob(
  jobIds: number[],
): Promise<Map<number, AssignedEmployee[]>> {
  const result = new Map<number, AssignedEmployee[]>();
  if (jobIds.length === 0) return result;
  const rows = await db
    .select({
      jobId: jobAssignmentsTable.jobId,
      employeeId: employeesTable.id,
      employeeName: employeesTable.name,
    })
    .from(jobAssignmentsTable)
    .innerJoin(
      employeesTable,
      eq(jobAssignmentsTable.employeeId, employeesTable.id),
    )
    .where(inArray(jobAssignmentsTable.jobId, jobIds));
  for (const row of rows) {
    const list = result.get(row.jobId) ?? [];
    list.push({ id: row.employeeId, name: row.employeeName });
    result.set(row.jobId, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

/** Replace a job's assignments with the given employee ids. */
export async function setJobAssignments(
  jobId: number,
  employeeIds: number[],
  executor: Pick<typeof db, "delete" | "insert"> = db,
): Promise<void> {
  const ids = [...new Set(employeeIds)];
  await executor
    .delete(jobAssignmentsTable)
    .where(eq(jobAssignmentsTable.jobId, jobId));
  if (ids.length > 0) {
    await executor
      .insert(jobAssignmentsTable)
      .values(ids.map((employeeId) => ({ jobId, employeeId })));
  }
}

/** Map of estimateId -> bidNumber for the given ids. */
async function bidNumbersByEstimateId(
  estimateIds: number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(estimateIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: estimatesTable.id, bidNumber: estimatesTable.bidNumber })
    .from(estimatesTable)
    .where(inArray(estimatesTable.id, ids));
  return new Map(rows.map((r) => [r.id, r.bidNumber]));
}

function entryDurationMinutes(entry: TimeEntryRow): number | null {
  if (!entry.clockOut) return null;
  const ms = entry.clockOut.getTime() - entry.clockIn.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function isPastDue(job: JobRow): boolean {
  if (!job.dueDate) return false;
  if (job.status === "complete" || job.status === "closed") return false;
  const today = new Date().toISOString().slice(0, 10);
  return job.dueDate < today;
}

function pickCurrentStage(stages: StageRow[]): StageRow | null {
  const ordered = [...stages].sort((a, b) => a.orderIndex - b.orderIndex);
  const inProgress = ordered.find((s) => s.status === "in_progress");
  if (inProgress) return inProgress;
  const notStarted = ordered.find((s) => s.status === "not_started");
  if (notStarted) return notStarted;
  return null;
}

/** Sum of completed time-entry durations (hours) grouped by stageId. */
async function actualHoursByStage(
  stageIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (stageIds.length === 0) return result;
  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(inArray(timeEntriesTable.stageId, stageIds));
  for (const entry of entries) {
    const mins = entryDurationMinutes(entry);
    if (mins === null) continue;
    result.set(entry.stageId, (result.get(entry.stageId) ?? 0) + mins / 60);
  }
  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stageView(stage: StageRow, actualHours: number) {
  return {
    id: stage.id,
    jobId: stage.jobId,
    name: stage.name,
    orderIndex: stage.orderIndex,
    status: stage.status,
    estimatedHours: stage.estimatedHours,
    actualHours: round2(actualHours),
    createdAt: stage.createdAt.toISOString(),
  };
}

function computeJobAggregates(job: JobRow, stages: StageRow[], stageActual: Map<number, number>) {
  const ordered = [...stages].sort((a, b) => a.orderIndex - b.orderIndex);
  const estimatedHours = ordered.reduce((sum, s) => sum + s.estimatedHours, 0);
  const actualHours = ordered.reduce(
    (sum, s) => sum + (stageActual.get(s.id) ?? 0),
    0,
  );
  const completeCount = ordered.filter((s) => s.status === "complete").length;
  const percentComplete =
    ordered.length === 0 ? 0 : (completeCount / ordered.length) * 100;
  const current = pickCurrentStage(ordered);
  return {
    ordered,
    estimatedHours: round2(estimatedHours),
    actualHours: round2(actualHours),
    percentComplete: round2(percentComplete),
    currentStage: current,
    pastDue: isPastDue(job),
  };
}

/** Load assembly rows for multiple jobs. Returns map of jobId -> assembly rows. */
async function assembliesByJobIds(
  jobIds: number[],
): Promise<Map<number, AssemblyRow[]>> {
  const result = new Map<number, AssemblyRow[]>();
  if (jobIds.length === 0) return result;
  const rows = await db
    .select()
    .from(bomAssembliesTable)
    .where(inArray(bomAssembliesTable.jobId, jobIds))
    .orderBy(asc(bomAssembliesTable.sortIndex));
  for (const row of rows) {
    const list = result.get(row.jobId) ?? [];
    list.push(row);
    result.set(row.jobId, list);
  }
  return result;
}

/** Load part rows for a list of assembly IDs. Returns map of assemblyId -> part rows. */
async function partsByAssemblyIds(
  assemblyIds: number[],
): Promise<Map<number, PartRow[]>> {
  const result = new Map<number, PartRow[]>();
  if (assemblyIds.length === 0) return result;
  const rows = await db
    .select()
    .from(bomPartsTable)
    .where(inArray(bomPartsTable.assemblyId, assemblyIds))
    .orderBy(asc(bomPartsTable.sortIndex));
  for (const row of rows) {
    const list = result.get(row.assemblyId) ?? [];
    list.push(row);
    result.set(row.assemblyId, list);
  }
  return result;
}

/**
 * Compute assembly-level rollup (count, progress %, status) given the job's
 * ordered stage names and the list of assembly rows.
 */
function computeAssemblyRollup(
  assemblies: AssemblyRow[],
  stageNames: string[],
): {
  assemblyCount: number;
  assemblyProgressPct: number | null;
  assemblyStatus: string | null;
} {
  if (assemblies.length === 0) {
    return { assemblyCount: 0, assemblyProgressPct: null, assemblyStatus: null };
  }
  const numStages = stageNames.length;
  if (numStages === 0) {
    return {
      assemblyCount: assemblies.length,
      assemblyProgressPct: null,
      assemblyStatus: null,
    };
  }

  // Quantity-weighted: each assembly contributes its quantity of units.
  // Held or stage-less units contribute 0 progress but stay in the denominator.
  let totalProgress = 0;
  let totalQty = 0;
  let countWithStage = 0;
  let allAtLast = true;
  let anyInProgress = false;

  for (const asm of assemblies) {
    const qty = asm.quantity > 0 ? asm.quantity : 1;
    totalQty += qty;
    const stageIdx = asm.currentStage
      ? stageNames.indexOf(asm.currentStage)
      : -1;
    if (stageIdx >= 0) {
      countWithStage++;
      const pct = numStages > 1 ? (stageIdx / (numStages - 1)) * 100 : 100;
      totalProgress += pct * qty;
      if (stageIdx < numStages - 1) allAtLast = false;
      if (stageIdx > 0) anyInProgress = true;
    } else {
      allAtLast = false;
    }
  }

  const assemblyProgressPct =
    countWithStage > 0 && totalQty > 0
      ? round2(totalProgress / totalQty)
      : 0;

  let assemblyStatus: string;
  if (countWithStage === 0) {
    assemblyStatus = "Not Started";
  } else if (allAtLast) {
    assemblyStatus = "Ready to Ship";
  } else if (anyInProgress) {
    assemblyStatus = "In Progress";
  } else {
    assemblyStatus = "Not Started";
  }

  return { assemblyCount: assemblies.length, assemblyProgressPct, assemblyStatus };
}

const STAGE_COUNT_KEYS: Record<string, keyof AssemblyStageCounts> = {
  "Sent to Vendor": "sentToVendor",
  "At Vendor": "atVendor",
  "Ready for Pickup": "readyForPickup",
  "Parts Processing": "partsProcessing",
  Cut: "cut",
  Fit: "fit",
  Welded: "welded",
  Inspected: "inspected",
  Shipped: "shipped",
};

export interface AssemblyStageCounts {
  sentToVendor: number;
  atVendor: number;
  readyForPickup: number;
  partsProcessing: number;
  cut: number;
  fit: number;
  welded: number;
  inspected: number;
  shipped: number;
  onHold: number;
  notStarted: number;
}

/**
 * Quantity-weighted counts of assemblies per production stage.
 * Held assemblies count only under onHold; assemblies with no/unknown
 * current stage count under notStarted.
 */
function computeAssemblyStageCounts(assemblies: AssemblyRow[]): {
  counts: AssemblyStageCounts;
  totalQty: number;
} {
  const counts: AssemblyStageCounts = {
    sentToVendor: 0,
    atVendor: 0,
    readyForPickup: 0,
    partsProcessing: 0,
    cut: 0,
    fit: 0,
    welded: 0,
    inspected: 0,
    shipped: 0,
    onHold: 0,
    notStarted: 0,
  };
  let totalQty = 0;
  for (const asm of assemblies) {
    const qty = asm.quantity > 0 ? asm.quantity : 1;
    totalQty += qty;
    if (asm.onHold) {
      counts.onHold += qty;
      continue;
    }
    const key = asm.currentStage
      ? STAGE_COUNT_KEYS[asm.currentStage]
      : undefined;
    if (key) counts[key] += qty;
    else counts.notStarted += qty;
  }
  return { counts, totalQty };
}

/**
 * Canonical production sequence used to rank assembly progress. This
 * intentionally differs from the grid's visual column grouping (vendor
 * columns first): parts are processed in-shop first, then go out to the
 * vendor, then return for cut/fit/weld/inspect/ship.
 */
export const ASSEMBLY_PROGRESS_ORDER = [
  "Parts Processing",
  "Sent to Vendor",
  "At Vendor",
  "Ready for Pickup",
  "Cut",
  "Fit",
  "Welded",
  "Inspected",
  "Shipped",
];

const PROGRESS_INDEX = new Map(
  ASSEMBLY_PROGRESS_ORDER.map((name, i) => [name.toLowerCase(), i]),
);
const INSPECTED_INDEX = ASSEMBLY_PROGRESS_ORDER.indexOf("Inspected");
const SHIPPED_INDEX = ASSEMBLY_PROGRESS_ORDER.indexOf("Shipped");


/**
 * Quantity-weighted % done and derived status across the canonical assembly
 * pipeline. Assemblies whose currentStage is unset or unknown contribute 0%
 * progress; on-hold assemblies still contribute their stage progress.
 */
export function computeGridProgress(
  assemblies: Pick<AssemblyRow, "quantity" | "currentStage">[],
): { assemblyGridStatus: string; assemblyGridProgressPct: number } {
  let totalQty = 0;
  let matchedQty = 0;
  let progressSum = 0;
  let minIdx = Number.POSITIVE_INFINITY;

  for (const asm of assemblies) {
    const qty = asm.quantity > 0 ? asm.quantity : 1;
    totalQty += qty;
    const idx = asm.currentStage
      ? (PROGRESS_INDEX.get(asm.currentStage.trim().toLowerCase()) ?? -1)
      : -1;
    if (idx >= 0) {
      matchedQty += qty;
      progressSum += (idx / SHIPPED_INDEX) * qty;
      minIdx = Math.min(minIdx, idx);
    } else {
      minIdx = -1;
    }
  }

  let status: string;
  if (totalQty === 0 || matchedQty === 0) {
    status = "Not Started";
  } else if (matchedQty === totalQty && minIdx >= SHIPPED_INDEX) {
    status = "Complete";
  } else if (matchedQty === totalQty && minIdx >= INSPECTED_INDEX) {
    status = "Ready to Ship";
  } else {
    status = "In Progress";
  }

  return {
    assemblyGridStatus: status,
    assemblyGridProgressPct:
      totalQty === 0 ? 0 : round2((progressSum / totalQty) * 100),
  };
}

function assemblyView(asm: AssemblyRow, parts: PartRow[]) {
  return {
    id: asm.id,
    mark: asm.mark,
    quantity: asm.quantity,
    description: asm.description,
    finish: asm.finish,
    processingPath: asm.processingPath,
    currentStage: asm.currentStage,
    onHold: asm.onHold,
    notes: asm.notes,
    inspectedOn: asm.inspectedOn,
    station: asm.station,
    inspector: asm.inspector,
    parts: parts.map((p) => ({
      id: p.id,
      partMark: p.partMark,
      quantity: p.quantity,
      profileType: p.profileType,
      profileSize: p.profileSize,
      grade: p.grade,
      lengthIn: p.lengthIn,
      description: p.description,
      heatNumber: p.heatNumber,
    })),
  };
}

export async function getJobDetail(jobId: number) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return null;
  const stages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.jobId, jobId));
  const stageActual = await actualHoursByStage(stages.map((s) => s.id));
  const agg = computeJobAggregates(job, stages, stageActual);
  const bidNumbers = await bidNumbersByEstimateId(
    job.estimateId != null ? [job.estimateId] : [],
  );

  // Load assemblies with parts for this job
  const assemblyMap = await assembliesByJobIds([jobId]);
  const jobAssemblies = assemblyMap.get(jobId) ?? [];
  const partMap = await partsByAssemblyIds(jobAssemblies.map((a) => a.id));
  const stageNames = agg.ordered.map((s) => s.name);
  const rollup = computeAssemblyRollup(jobAssemblies, stageNames);

  return {
    id: job.id,
    jobNumber: job.jobNumber,
    name: job.name,
    customer: job.customer,
    customerId: job.customerId,
    customerPo: job.customerPo,
    status: job.status,
    dueDate: job.dueDate,
    notes: job.notes,
    estimateId: job.estimateId,
    bidNumber:
      job.estimateId != null ? (bidNumbers.get(job.estimateId) ?? null) : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    currentStageName: agg.currentStage?.name ?? null,
    estimatedHours: agg.estimatedHours,
    actualHours: agg.actualHours,
    percentComplete: agg.percentComplete,
    isPastDue: agg.pastDue,
    stages: agg.ordered.map((s) => stageView(s, stageActual.get(s.id) ?? 0)),
    assignedEmployees: (await assignedEmployeesByJob([jobId])).get(jobId) ?? [],
    bomAssemblies: jobAssemblies.map((a) =>
      assemblyView(a, partMap.get(a.id) ?? []),
    ),
    assemblyCount: rollup.assemblyCount,
    assemblyProgressPct: rollup.assemblyProgressPct,
    assemblyStatus: rollup.assemblyStatus,
  };
}

async function loadJobBundles(jobs: JobRow[]) {
  const jobIds = jobs.map((j) => j.id);
  const allStages =
    jobIds.length === 0
      ? []
      : await db
          .select()
          .from(stagesTable)
          .where(inArray(stagesTable.jobId, jobIds));
  const stageActual = await actualHoursByStage(allStages.map((s) => s.id));
  const stagesByJob = new Map<number, StageRow[]>();
  for (const s of allStages) {
    const list = stagesByJob.get(s.jobId) ?? [];
    list.push(s);
    stagesByJob.set(s.jobId, list);
  }
  return { stagesByJob, stageActual };
}

export async function getJobsList(jobs: JobRow[]) {
  const { stagesByJob, stageActual } = await loadJobBundles(jobs);
  const bidNumbers = await bidNumbersByEstimateId(
    jobs.flatMap((j) => (j.estimateId != null ? [j.estimateId] : [])),
  );
  return jobs.map((job) => {
    const agg = computeJobAggregates(
      job,
      stagesByJob.get(job.id) ?? [],
      stageActual,
    );
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      name: job.name,
      customer: job.customer,
      customerId: job.customerId,
      customerPo: job.customerPo,
      status: job.status,
      dueDate: job.dueDate,
      notes: job.notes,
      estimateId: job.estimateId,
      bidNumber:
        job.estimateId != null
          ? (bidNumbers.get(job.estimateId) ?? null)
          : null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      currentStageName: agg.currentStage?.name ?? null,
      estimatedHours: agg.estimatedHours,
      actualHours: agg.actualHours,
      percentComplete: agg.percentComplete,
      isPastDue: agg.pastDue,
    };
  });
}

/** Count of employees currently clocked in (open entries) grouped by jobId. */
async function activeCountByJob(): Promise<Map<number, number>> {
  const open = await db.select().from(timeEntriesTable);
  const result = new Map<number, number>();
  for (const e of open) {
    if (e.clockOut) continue;
    result.set(e.jobId, (result.get(e.jobId) ?? 0) + 1);
  }
  return result;
}

export async function getDashboardSummary() {
  const jobs = await db.select().from(jobsTable);
  const activeCounts = await activeCountByJob();
  let clockedInCount = 0;
  for (const c of activeCounts.values()) clockedInCount += c;

  const { stagesByJob, stageActual } = await loadJobBundles(jobs);
  let totalEstimated = 0;
  let totalActual = 0;
  let pastDue = 0;
  const counts = { active: 0, on_hold: 0, complete: 0, closed: 0 };
  for (const job of jobs) {
    const agg = computeJobAggregates(job, stagesByJob.get(job.id) ?? [], stageActual);
    totalEstimated += agg.estimatedHours;
    totalActual += agg.actualHours;
    if (agg.pastDue) pastDue += 1;
    if (job.status in counts) counts[job.status as keyof typeof counts] += 1;
  }
  return {
    activeJobs: counts.active,
    onHoldJobs: counts.on_hold,
    completeJobs: counts.complete,
    closedJobs: counts.closed,
    pastDueJobs: pastDue,
    clockedInCount,
    totalEstimatedHours: round2(totalEstimated),
    totalActualHours: round2(totalActual),
  };
}

export async function getDashboardJobs() {
  const jobs = await db.select().from(jobsTable);
  const { stagesByJob, stageActual } = await loadJobBundles(jobs);
  const activeCounts = await activeCountByJob();
  const assignments = await assignedEmployeesByJob(jobs.map((j) => j.id));

  // Load assemblies for all jobs in one query
  const allAssemblies = await assembliesByJobIds(jobs.map((j) => j.id));

  return jobs.map((job) => {
    const agg = computeJobAggregates(job, stagesByJob.get(job.id) ?? [], stageActual);
    const jobAssemblies = allAssemblies.get(job.id) ?? [];
    const stageNames = agg.ordered.map((s) => s.name);
    const rollup = computeAssemblyRollup(jobAssemblies, stageNames);
    const stageCounts = computeAssemblyStageCounts(jobAssemblies);
    const gridProgress = computeGridProgress(jobAssemblies);
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      name: job.name,
      customer: job.customer,
      customerId: job.customerId,
      status: job.status,
      dueDate: job.dueDate,
      currentStageName: agg.currentStage?.name ?? null,
      currentStageStatus: agg.currentStage?.status ?? null,
      estimatedHours: agg.estimatedHours,
      actualHours: agg.actualHours,
      hoursRemaining: round2(Math.max(0, agg.estimatedHours - agg.actualHours)),
      percentComplete: agg.percentComplete,
      isPastDue: agg.pastDue,
      clockedInCount: activeCounts.get(job.id) ?? 0,
      assignedEmployees: assignments.get(job.id) ?? [],
      assemblyCount: rollup.assemblyCount,
      assemblyProgressPct: rollup.assemblyProgressPct,
      assemblyStatus: rollup.assemblyStatus,
      assemblyTotalQty: stageCounts.totalQty,
      assemblyStageCounts: stageCounts.counts,
      assemblyGridStatus: gridProgress.assemblyGridStatus,
      assemblyGridProgressPct: gridProgress.assemblyGridProgressPct,
    };
  });
}

export async function enrichTimeEntries(entries: TimeEntryRow[]) {
  if (entries.length === 0) return [];
  const empIds = [...new Set(entries.map((e) => e.employeeId))];
  const jobIds = [...new Set(entries.map((e) => e.jobId))];
  const stageIds = [...new Set(entries.map((e) => e.stageId))];
  const [emps, jobs, stages] = await Promise.all([
    db.select().from(employeesTable).where(inArray(employeesTable.id, empIds)),
    db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds)),
    db.select().from(stagesTable).where(inArray(stagesTable.id, stageIds)),
  ]);
  const empMap = new Map(emps.map((e) => [e.id, e]));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  return entries.map((e) => ({
    id: e.id,
    employeeId: e.employeeId,
    employeeName: empMap.get(e.employeeId)?.name ?? "Unknown",
    employeeTitle: empMap.get(e.employeeId)?.jobTitle ?? null,
    jobId: e.jobId,
    jobNumber: jobMap.get(e.jobId)?.jobNumber ?? "",
    jobName: jobMap.get(e.jobId)?.name ?? "Unknown",
    stageId: e.stageId,
    stageName: stageMap.get(e.stageId)?.name ?? "Unknown",
    clockIn: e.clockIn.toISOString(),
    clockOut: e.clockOut ? e.clockOut.toISOString() : null,
    durationMinutes: entryDurationMinutes(e),
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function enrichOneTimeEntry(entry: TimeEntryRow) {
  const [one] = await enrichTimeEntries([entry]);
  return one;
}
