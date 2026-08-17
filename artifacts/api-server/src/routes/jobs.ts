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
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause as Error) {
    if ((e as { code?: string }).code === "23505") return true;
    if (!(e.cause instanceof Error)) break;
  }
  return false;
}

async function allEmployeesExist(
  employeeIds: number[],
  companyId: number,
): Promise<boolean> {
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return true;
  const rows = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(
      and(
        inArray(employeesTable.id, ids),
        eq(employeesTable.companyId, companyId),
      ),
    );
  return rows.length === ids.length;
}

router.get("/jobs", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const query = ListJobsQueryParams.parse(req.query);
  const conditions: SQL[] = [eq(jobsTable.companyId, companyId)];
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
    .where(and(...conditions))
    .orderBy(jobsTable.createdAt);
  const result = await getJobsList(rows);
  res.json(result);
});

router.post("/jobs", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateJobBody.parse(req.body);

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(
      and(
        eq(customersTable.id, body.customerId),
        eq(customersTable.companyId, companyId),
      ),
    );
  if (!customer) {
    res.status(400).json({ error: "Customer not found" });
    return;
  }

  if (
    body.assignedEmployeeIds &&
    !(await allEmployeesExist(body.assignedEmployeeIds, companyId))
  ) {
    res.status(400).json({ error: "One or more assigned employees not found" });
    return;
  }

  const job = await createJobWithRouting({
    companyId,
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

  const detail = await getJobDetail(job.id, companyId);
  res.status(201).json(detail);
});

router.get("/jobs/:jobId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const detail = await getJobDetail(jobId, companyId);
  if (!detail) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(detail);
});

router.patch("/jobs/:jobId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const body = UpdateJobBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { assignedEmployeeIds, ...jobFields } = body;
  const updates: Record<string, unknown> = { ...jobFields };

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
      .where(
        and(
          eq(customersTable.id, body.customerId),
          eq(customersTable.companyId, companyId),
        ),
      );
    if (!customer) {
      res.status(400).json({ error: "Customer not found" });
      return;
    }
    updates.customer = customer.name;
  }
  if (
    assignedEmployeeIds !== undefined &&
    !(await allEmployeesExist(assignedEmployeeIds, companyId))
  ) {
    res.status(400).json({ error: "One or more assigned employees not found" });
    return;
  }

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
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Another job already uses this job number" });
      return;
    }
    throw err;
  }
  const detail = await getJobDetail(jobId, companyId);
  res.json(detail);
});

router.delete("/jobs/:jobId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  await deleteJobDocumentObjects(jobId);
  await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
  res.status(204).send();
});

router.post(
  "/jobs/:jobId/advance",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
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

    const detail = await getJobDetail(jobId, companyId);
    res.json(detail);
  },
);

export default router;
