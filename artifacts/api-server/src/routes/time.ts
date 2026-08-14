import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  timeEntriesTable,
  employeesTable,
  jobsTable,
  stagesTable,
} from "@workspace/db";
import { eq, and, isNull, desc, type SQL } from "drizzle-orm";
import {
  ClockInBody,
  ClockOutBody,
  CreateTimeEntryBody,
  UpdateTimeEntryBody,
  ListTimeEntriesQueryParams,
} from "@workspace/api-zod";
import {
  enrichTimeEntries,
  enrichOneTimeEntry,
} from "../services/production";
import { parseIntParam, parseQueryBool } from "../lib/params";

const router: IRouter = Router();

async function validateRefs(
  employeeId: number,
  jobId: number,
  stageId: number,
): Promise<string | null> {
  const [emp] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
  if (!emp) return "Employee not found";
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return "Job not found";
  const [stage] = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.id, stageId));
  if (!stage || stage.jobId !== jobId)
    return "Stage not found for this job";
  return null;
}

/** Validate that a stage belongs to the given job. */
async function stageBelongsToJob(
  stageId: number,
  jobId: number,
): Promise<boolean> {
  const [stage] = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.id, stageId));
  return !!stage && stage.jobId === jobId;
}

router.get("/time-entries", async (req, res): Promise<void> => {
  const query = ListTimeEntriesQueryParams.parse(req.query);
  const conditions: SQL[] = [];
  if (query.jobId) conditions.push(eq(timeEntriesTable.jobId, query.jobId));
  if (query.employeeId)
    conditions.push(eq(timeEntriesTable.employeeId, query.employeeId));
  if (parseQueryBool(req.query.activeOnly))
    conditions.push(isNull(timeEntriesTable.clockOut));
  const rows = await db
    .select()
    .from(timeEntriesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(timeEntriesTable.clockIn));
  res.json(await enrichTimeEntries(rows));
});

router.post("/time-entries", async (req, res): Promise<void> => {
  const body = CreateTimeEntryBody.parse(req.body);
  const err = await validateRefs(body.employeeId, body.jobId, body.stageId);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  const clockIn = new Date(body.clockIn);
  const clockOut = new Date(body.clockOut);
  if (clockOut.getTime() < clockIn.getTime()) {
    res.status(400).json({ error: "clockOut must be at or after clockIn" });
    return;
  }
  const [row] = await db
    .insert(timeEntriesTable)
    .values({
      employeeId: body.employeeId,
      jobId: body.jobId,
      stageId: body.stageId,
      clockIn,
      clockOut,
    })
    .returning();
  res.status(201).json(await enrichOneTimeEntry(row));
});

router.patch("/time-entries/:entryId", async (req, res): Promise<void> => {
  const entryId = parseIntParam(req.params.entryId);
  if (entryId === null) {
    res.status(400).json({ error: "Invalid time entry id" });
    return;
  }
  const body = UpdateTimeEntryBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.id, entryId));
  if (!existing) {
    res.status(404).json({ error: "Time entry not found" });
    return;
  }
  const updates: Partial<typeof timeEntriesTable.$inferInsert> = {};
  if (body.stageId !== undefined) {
    if (!(await stageBelongsToJob(body.stageId, existing.jobId))) {
      res.status(400).json({ error: "Stage not found for this job" });
      return;
    }
    updates.stageId = body.stageId;
  }
  if (body.clockIn !== undefined) updates.clockIn = new Date(body.clockIn);
  if (body.clockOut !== undefined)
    updates.clockOut = body.clockOut ? new Date(body.clockOut) : null;
  const effClockIn = updates.clockIn ?? existing.clockIn;
  const effClockOut =
    updates.clockOut !== undefined ? updates.clockOut : existing.clockOut;
  if (
    effClockOut &&
    effClockIn &&
    effClockOut.getTime() < effClockIn.getTime()
  ) {
    res.status(400).json({ error: "clockOut must be at or after clockIn" });
    return;
  }
  await db
    .update(timeEntriesTable)
    .set(updates)
    .where(eq(timeEntriesTable.id, entryId));
  const [row] = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.id, entryId));
  res.json(await enrichOneTimeEntry(row));
});

router.delete("/time-entries/:entryId", async (req, res): Promise<void> => {
  const entryId = parseIntParam(req.params.entryId);
  if (entryId === null) {
    res.status(400).json({ error: "Invalid time entry id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.id, entryId));
  if (!existing) {
    res.status(404).json({ error: "Time entry not found" });
    return;
  }
  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.id, entryId));
  res.status(204).send();
});

router.post("/time-clock/in", async (req, res): Promise<void> => {
  const body = ClockInBody.parse(req.body);
  const err = await validateRefs(body.employeeId, body.jobId, body.stageId);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, body.jobId));
  if (job.status === "complete" || job.status === "closed") {
    res
      .status(400)
      .json({ error: "Cannot clock in to a completed or closed job" });
    return;
  }
  const [stage] = await db
    .select()
    .from(stagesTable)
    .where(eq(stagesTable.id, body.stageId));
  if (stage.status === "complete") {
    res.status(400).json({ error: "Cannot clock in to a completed stage" });
    return;
  }
  const [open] = await db
    .select()
    .from(timeEntriesTable)
    .where(
      and(
        eq(timeEntriesTable.employeeId, body.employeeId),
        isNull(timeEntriesTable.clockOut),
      ),
    );
  if (open) {
    res.status(400).json({ error: "Employee is already clocked in" });
    return;
  }
  const [row] = await db
    .insert(timeEntriesTable)
    .values({
      employeeId: body.employeeId,
      jobId: body.jobId,
      stageId: body.stageId,
      clockIn: new Date(),
    })
    .returning();
  res.status(201).json(await enrichOneTimeEntry(row));
});

router.post("/time-clock/out", async (req, res): Promise<void> => {
  const body = ClockOutBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.id, body.entryId));
  if (!existing) {
    res.status(404).json({ error: "Time entry not found" });
    return;
  }
  if (existing.clockOut) {
    res.status(400).json({ error: "Time entry is already clocked out" });
    return;
  }
  await db
    .update(timeEntriesTable)
    .set({ clockOut: new Date() })
    .where(eq(timeEntriesTable.id, body.entryId));
  const [row] = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.id, body.entryId));
  res.json(await enrichOneTimeEntry(row));
});

router.get("/time-clock/active", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(timeEntriesTable)
    .where(isNull(timeEntriesTable.clockOut))
    .orderBy(desc(timeEntriesTable.clockIn));
  res.json(await enrichTimeEntries(rows));
});

export default router;
