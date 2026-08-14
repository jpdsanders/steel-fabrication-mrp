import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  stagesTable,
  customersTable,
  employeesTable,
} from "@workspace/db";
import { eq, and, ilike, or, inArray, type SQL } from "drizzle-orm";
import {
  CreateJobBody,
  UpdateJobBody,
  ListJobsQueryParams,
} from "@workspace/api-zod";
import {
  getJobDetail,
  getJobsList,
  createJobWithRouting,
  setJobAssignments,
} from "../services/production";
import { parseIntParam } from "../lib/params";
import { deleteJobDocumentObjects } from "./documents";

const router: IRouter = Router();

/** True when err (possibly wrapped by drizzle) is a Postgres unique violation. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause as Error) {
    if ((e as { code?: string }).code === "23505") return true;
    if (!(e.cause instanceof Error)) break;
  }
  return false;
}

/** Returns true when all given employee ids exist. */
async function allEmployeesExist(employeeIds: number[]): Promise<boolean> {
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(inArray(employeesTable.id, ids));
  return rows.length === ids.length;
}

router.get("/jobs", async (req, res): Promise<void> => {
  const query = ListJobsQueryParams.parse(req.query);
  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(jobsTable.status, query.status));
  if (query.search) {
    const term = `%${query.search}%`;
    const match = or(
      ilike(jobsTable.jobNumber, term),
      ilike(jobsTable.name, term),
      ilike(jobsTable.customer, term),
    );
    if (match) conditions.push(match);
  }
  const rows = await db
    .select()
    .from(jobsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(jobsTable.createdAt);
  const result = await getJobsList(rows);
  res.json(result);
});

router.post("/jobs", async (req, res): Promise<void> => {
  const body = CreateJobBody.parse(req.body);

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, body.customerId));
  if (!customer) {
    res.status(400).json({ error: "Customer not found" });
    return;
  }

  if (body.assignedEmployeeIds && !(await allEmployeesExist(body.assignedEmployeeIds))) {
    res.status(400).json({ error: "One or more assigned employees not found" });
    return;
  }

  const job = await createJobWithRouting({
    name: body.name,
    customer: customer.name,
    customerId: customer.id,
    status: body.status,
    dueDate: body.dueDate ?? null,
    notes: body.notes ?? null,
    stages: body.stages,
  });

  if (body.assignedEmployeeIds && body.assignedEmployeeIds.length > 0) {
    await setJobAssignments(job.id, body.assignedEmployeeIds);
  }

  const detail = await getJobDetail(job.id);
  res.status(201).json(detail);
});

router.get("/jobs/:jobId", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const detail = await getJobDetail(jobId);
  if (!detail) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(detail);
});

router.patch("/jobs/:jobId", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const body = UpdateJobBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { assignedEmployeeIds, ...jobFields } = body;
  const updates: Record<string, unknown> = { ...jobFields };

  // Validate every supplied field before performing any writes so a
  // rejected request never leaves partial changes behind.
  if (body.jobNumber !== undefined) {
    const trimmed = body.jobNumber.trim();
    if (!trimmed) {
      res.status(400).json({ error: "Job number cannot be empty" });
      return;
    }
    updates.jobNumber = trimmed;
  }
  if (body.customerPo !== undefined) {
    updates.customerPo = body.customerPo?.trim() || null;
  }
  if (body.customerId !== undefined) {
    const [customer] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, body.customerId));
    if (!customer) {
      res.status(400).json({ error: "Customer not found" });
      return;
    }
    updates.customer = customer.name;
  }
  if (
    assignedEmployeeIds !== undefined &&
    !(await allEmployeesExist(assignedEmployeeIds))
  ) {
    res.status(400).json({ error: "One or more assigned employees not found" });
    return;
  }

  // Apply the assignment replacement and job update atomically so a
  // conflict (e.g. duplicate job number) rolls back everything.
  try {
    await db.transaction(async (tx) => {
      if (assignedEmployeeIds !== undefined) {
        await setJobAssignments(jobId, assignedEmployeeIds, tx);
      }
      if (Object.keys(updates).length > 0) {
        await tx.update(jobsTable).set(updates).where(eq(jobsTable.id, jobId));
      }
    });
  } catch (err) {
    // Unique violation on jobs.job_number (enforced by the DB so
    // concurrent renames cannot both slip past a read-check).
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ error: "Another job already uses this job number" });
      return;
    }
    throw err;
  }
  const detail = await getJobDetail(jobId);
  res.json(detail);
});

router.delete("/jobs/:jobId", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  await deleteJobDocumentObjects(jobId);
  await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
  res.status(204).send();
});

router.post("/jobs/:jobId/advance", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const stages = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.jobId, jobId))
    .orderBy(stagesTable.orderIndex);

  const currentIdx = stages.findIndex((s) => s.status === "in_progress");
  if (currentIdx !== -1) {
    await db
      .update(stagesTable)
      .set({ status: "complete" })
      .where(eq(stagesTable.id, stages[currentIdx].id));
    const next = stages[currentIdx + 1];
    if (next) {
      await db
        .update(stagesTable)
        .set({ status: "in_progress" })
        .where(eq(stagesTable.id, next.id));
    } else {
      await db
        .update(jobsTable)
        .set({ status: "complete" })
        .where(eq(jobsTable.id, jobId));
    }
  } else {
    const firstNotStarted = stages.find((s) => s.status === "not_started");
    if (firstNotStarted) {
      await db
        .update(stagesTable)
        .set({ status: "in_progress" })
        .where(eq(stagesTable.id, firstNotStarted.id));
    }
  }

  const detail = await getJobDetail(jobId);
  res.json(detail);
});

export default router;
