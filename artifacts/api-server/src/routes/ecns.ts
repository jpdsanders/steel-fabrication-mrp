import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  ecnsTable,
  ecnAffectedRevisionsTable,
  drawingRevisionsTable,
  drawingsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { CreateEcnBody, UpdateEcnBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

async function ecnDtos(ecns: (typeof ecnsTable.$inferSelect)[]) {
  const ecnIds = ecns.map((e) => e.id);
  const userIds = [
    ...new Set(
      ecns.map((e) => e.approvedBy).filter((v): v is number => v !== null),
    ),
  ];
  const [links, users] = await Promise.all([
    ecnIds.length
      ? db
          .select()
          .from(ecnAffectedRevisionsTable)
          .where(inArray(ecnAffectedRevisionsTable.ecnId, ecnIds))
      : Promise.resolve(
          [] as (typeof ecnAffectedRevisionsTable.$inferSelect)[],
        ),
    userIds.length
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : Promise.resolve([]),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  return ecns.map(({ companyId: _companyId, updatedAt: _u, ...e }) => ({
    ...e,
    approvedByName:
      e.approvedBy !== null ? (userMap.get(e.approvedBy) ?? null) : null,
    affectedRevisionIds: links
      .filter((l) => l.ecnId === e.id)
      .map((l) => l.drawingRevisionId),
  }));
}

/** Allocates the next ECN-YYYY-NNNN number for a company (inside a tx). */
async function nextEcnNumber(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ECN-${year}-`;
  const [row] = await tx
    .select({
      max: sql<string | null>`max(substring(${ecnsTable.number} from ${prefix.length + 1}))`,
    })
    .from(ecnsTable)
    .where(
      and(
        eq(ecnsTable.companyId, companyId),
        sql`${ecnsTable.number} like ${prefix + "%"}`,
      ),
    );
  const next = (row?.max ? parseInt(row.max, 10) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/** Verifies every revision id belongs to a drawing on this specific job. */
async function validRevisionIds(
  revisionIds: number[],
  jobId: number,
): Promise<boolean> {
  if (revisionIds.length === 0) return true;
  const rows = await db
    .select({ id: drawingRevisionsTable.id })
    .from(drawingRevisionsTable)
    .innerJoin(
      drawingsTable,
      eq(drawingRevisionsTable.drawingId, drawingsTable.id),
    )
    .where(
      and(
        inArray(drawingRevisionsTable.id, revisionIds),
        eq(drawingsTable.jobId, jobId),
      ),
    );
  return rows.length === new Set(revisionIds).size;
}

router.get("/jobs/:jobId/ecns", requireAuth, async (req, res): Promise<void> => {
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
  const ecns = await db
    .select()
    .from(ecnsTable)
    .where(eq(ecnsTable.jobId, jobId))
    .orderBy(desc(ecnsTable.createdAt));
  res.json(await ecnDtos(ecns));
});

router.post(
  "/jobs/:jobId/ecns",
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
    const parsed = CreateEcnBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const {
      source,
      description,
      affectedWork,
      costImpact,
      scheduleImpact,
      disposition,
      affectedRevisionIds = [],
    } = parsed.data;
    if (!description.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    if (!(await validRevisionIds(affectedRevisionIds, jobId))) {
      res
        .status(400)
        .json({ error: "Affected revisions must belong to this job" });
      return;
    }

    const ecn = await db.transaction(async (tx) => {
      const number = await nextEcnNumber(tx, companyId);
      const [created] = await tx
        .insert(ecnsTable)
        .values({
          companyId,
          number,
          jobId,
          source,
          description: description.trim(),
          affectedWork: affectedWork ?? null,
          costImpact: costImpact ?? null,
          scheduleImpact: scheduleImpact ?? null,
          disposition: disposition ?? null,
        })
        .returning();
      if (affectedRevisionIds.length) {
        await tx.insert(ecnAffectedRevisionsTable).values(
          [...new Set(affectedRevisionIds)].map((drawingRevisionId) => ({
            ecnId: created.id,
            drawingRevisionId,
          })),
        );
      }
      return created;
    });

    req.log.info({ ecnId: ecn.id, number: ecn.number, jobId }, "ecn created");
    const [dto] = await ecnDtos([ecn]);
    res.status(201).json(dto);
  },
);

router.patch("/ecns/:ecnId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const ecnId = parseIntParam(req.params.ecnId);
  if (ecnId === null) {
    res.status(400).json({ error: "Invalid ECN id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(ecnsTable)
    .where(and(eq(ecnsTable.id, ecnId), eq(ecnsTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "ECN not found" });
    return;
  }
  const parsed = UpdateEcnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const {
    description,
    affectedWork,
    costImpact,
    scheduleImpact,
    disposition,
    status,
    affectedRevisionIds,
  } = parsed.data;
  if (
    affectedRevisionIds !== undefined &&
    !(await validRevisionIds(affectedRevisionIds, existing.jobId))
  ) {
    res
      .status(400)
      .json({ error: "Affected revisions must belong to this ECN's job" });
    return;
  }

  const updates: Partial<typeof ecnsTable.$inferInsert> = {};
  if (description !== undefined) updates.description = description;
  if (affectedWork !== undefined) updates.affectedWork = affectedWork;
  if (costImpact !== undefined) updates.costImpact = costImpact;
  if (scheduleImpact !== undefined) updates.scheduleImpact = scheduleImpact;
  if (disposition !== undefined) updates.disposition = disposition;
  if (status !== undefined && status !== existing.status) {
    updates.status = status;
    if (status === "approved") {
      updates.approvedBy = req.auth!.user.id;
      updates.approvedAt = new Date();
    }
    if (status === "closed") {
      updates.closedAt = new Date();
      // Closing implies approval when nobody has approved yet.
      if (existing.approvedBy === null) {
        updates.approvedBy = req.auth!.user.id;
        updates.approvedAt = new Date();
      }
    }
    if (status === "open") {
      updates.approvedBy = null;
      updates.approvedAt = null;
      updates.closedAt = null;
    }
  }
  if (Object.keys(updates).length === 0 && affectedRevisionIds === undefined) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    let row = existing;
    if (Object.keys(updates).length > 0) {
      [row] = await tx
        .update(ecnsTable)
        .set(updates)
        .where(eq(ecnsTable.id, ecnId))
        .returning();
    }
    if (affectedRevisionIds !== undefined) {
      await tx
        .delete(ecnAffectedRevisionsTable)
        .where(eq(ecnAffectedRevisionsTable.ecnId, ecnId));
      if (affectedRevisionIds.length) {
        await tx.insert(ecnAffectedRevisionsTable).values(
          [...new Set(affectedRevisionIds)].map((drawingRevisionId) => ({
            ecnId,
            drawingRevisionId,
          })),
        );
      }
    }
    return row;
  });

  req.log.info({ ecnId, updates: Object.keys(updates) }, "ecn updated");
  const [dto] = await ecnDtos([updated]);
  res.json(dto);
});

export default router;
