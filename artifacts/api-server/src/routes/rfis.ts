import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  rfisTable,
  usersTable,
  drawingsTable,
  drawingRevisionsTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { CreateRfiBody, UpdateRfiBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

async function rfiDtos(rfis: (typeof rfisTable.$inferSelect)[]) {
  const userIds = [
    ...new Set(
      rfis.map((r) => r.submittedBy).filter((v): v is number => v !== null),
    ),
  ];
  const users = userIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, userIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  return rfis.map(({ companyId: _companyId, updatedAt: _u, ...r }) => ({
    ...r,
    submittedByName:
      r.submittedBy !== null ? (userMap.get(r.submittedBy) ?? null) : null,
  }));
}

/** Allocates the next RFI-YYYY-NNNN number for a company (inside a tx). */
async function nextRfiNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `RFI-${year}-`;
  const [row] = await tx
    .select({
      max: sql<string | null>`max(substring(${rfisTable.number} from ${prefix.length + 1}))`,
    })
    .from(rfisTable)
    .where(
      and(
        eq(rfisTable.companyId, companyId),
        sql`${rfisTable.number} like ${prefix + "%"}`,
      ),
    );
  const next = (row?.max ? parseInt(row.max, 10) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

router.get("/jobs/:jobId/rfis", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const rfis = await db
    .select()
    .from(rfisTable)
    .where(eq(rfisTable.jobId, jobId))
    .orderBy(desc(rfisTable.createdAt));
  res.json(await rfiDtos(rfis));
});

router.post(
  "/jobs/:jobId/rfis",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const [job] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const parsed = CreateRfiBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const { question, drawingId, drawingRevisionId, directedTo, dueDate } =
      parsed.data;
    if (!question.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    // Validate any referenced drawing / revision belongs to this job.
    if (drawingId != null) {
      const [drawing] = await db
        .select({ id: drawingsTable.id })
        .from(drawingsTable)
        .where(
          and(eq(drawingsTable.id, drawingId), eq(drawingsTable.jobId, jobId)),
        );
      if (!drawing) {
        res
          .status(400)
          .json({ error: "Referenced drawing must belong to this job" });
        return;
      }
    }
    if (drawingRevisionId != null) {
      const [rev] = await db
        .select({
          id: drawingRevisionsTable.id,
          drawingId: drawingRevisionsTable.drawingId,
        })
        .from(drawingRevisionsTable)
        .innerJoin(
          drawingsTable,
          eq(drawingRevisionsTable.drawingId, drawingsTable.id),
        )
        .where(
          and(
            eq(drawingRevisionsTable.id, drawingRevisionId),
            eq(drawingsTable.jobId, jobId),
          ),
        );
      if (!rev) {
        res
          .status(400)
          .json({ error: "Referenced revision must belong to this job" });
        return;
      }
      if (drawingId != null && rev.drawingId !== drawingId) {
        res.status(400).json({
          error: "Referenced revision does not belong to the referenced drawing",
        });
        return;
      }
    }

    const rfi = await db.transaction(async (tx) => {
      const number = await nextRfiNumber(tx, companyId);
      const [created] = await tx
        .insert(rfisTable)
        .values({
          companyId,
          number,
          jobId,
          drawingId: drawingId ?? null,
          drawingRevisionId: drawingRevisionId ?? null,
          question: question.trim(),
          submittedBy: req.auth!.user.id,
          directedTo: directedTo ?? null,
          dueDate: dueDate ?? null,
        })
        .returning();
      return created;
    });

    req.log.info({ rfiId: rfi.id, number: rfi.number, jobId }, "rfi created");
    const [dto] = await rfiDtos([rfi]);
    res.status(201).json(dto);
  },
);

router.patch("/rfis/:rfiId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const rfiId = parseIntParam(req.params.rfiId);
  if (rfiId === null) {
    res.status(400).json({ error: "Invalid RFI id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(rfisTable)
    .where(and(eq(rfisTable.id, rfiId), eq(rfisTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "RFI not found" });
    return;
  }
  const parsed = UpdateRfiBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { status, responseText, responseDate, directedTo, dueDate } =
    parsed.data;
  const updates: Partial<typeof rfisTable.$inferInsert> = {};
  if (status !== undefined) updates.status = status;
  if (responseText !== undefined) updates.responseText = responseText;
  if (responseDate !== undefined) updates.responseDate = responseDate;
  if (directedTo !== undefined) updates.directedTo = directedTo;
  if (dueDate !== undefined) updates.dueDate = dueDate;
  // Recording a response without an explicit date stamps today.
  if (
    updates.responseText &&
    updates.responseDate === undefined &&
    existing.responseDate === null
  ) {
    updates.responseDate = new Date().toISOString().slice(0, 10);
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(rfisTable)
    .set(updates)
    .where(eq(rfisTable.id, rfiId))
    .returning();
  req.log.info({ rfiId, updates: Object.keys(updates) }, "rfi updated");
  const [dto] = await rfiDtos([updated]);
  res.json(dto);
});

export default router;
