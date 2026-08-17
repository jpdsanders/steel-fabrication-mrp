import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  transmittalsTable,
  transmittalItemsTable,
  documentsTable,
  drawingRevisionsTable,
  drawingsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { CreateTransmittalBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

async function transmittalDtos(
  transmittals: (typeof transmittalsTable.$inferSelect)[],
) {
  const ids = transmittals.map((t) => t.id);
  const senderIds = [
    ...new Set(
      transmittals.map((t) => t.senderId).filter((v): v is number => v !== null),
    ),
  ];
  const [items, senders] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(transmittalItemsTable)
          .where(inArray(transmittalItemsTable.transmittalId, ids))
      : Promise.resolve(
          [] as (typeof transmittalItemsTable.$inferSelect)[],
        ),
    senderIds.length
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, senderIds))
      : Promise.resolve([]),
  ]);
  const docIds = [
    ...new Set(
      items.map((i) => i.documentId).filter((v): v is number => v !== null),
    ),
  ];
  const revIds = [
    ...new Set(
      items
        .map((i) => i.drawingRevisionId)
        .filter((v): v is number => v !== null),
    ),
  ];
  const [docs, revs] = await Promise.all([
    docIds.length
      ? db
          .select({ id: documentsTable.id, filename: documentsTable.filename })
          .from(documentsTable)
          .where(inArray(documentsTable.id, docIds))
      : Promise.resolve([]),
    revIds.length
      ? db
          .select({
            id: drawingRevisionsTable.id,
            revisionLabel: drawingRevisionsTable.revisionLabel,
            drawingNumber: drawingsTable.drawingNumber,
          })
          .from(drawingRevisionsTable)
          .innerJoin(
            drawingsTable,
            eq(drawingRevisionsTable.drawingId, drawingsTable.id),
          )
          .where(inArray(drawingRevisionsTable.id, revIds))
      : Promise.resolve([]),
  ]);
  const docMap = new Map(docs.map((d) => [d.id, d.filename]));
  const revMap = new Map(
    revs.map((r) => [r.id, `${r.drawingNumber} Rev ${r.revisionLabel}`]),
  );
  const senderMap = new Map(senders.map((s) => [s.id, s.name]));

  return transmittals.map((t) => ({
    ...t,
    senderName: t.senderId !== null ? (senderMap.get(t.senderId) ?? null) : null,
    items: items
      .filter((i) => i.transmittalId === t.id)
      .map((i) => ({
        id: i.id,
        documentId: i.documentId,
        drawingRevisionId: i.drawingRevisionId,
        label:
          i.documentId !== null
            ? (docMap.get(i.documentId) ?? `Document #${i.documentId}`)
            : (revMap.get(i.drawingRevisionId!) ??
              `Revision #${i.drawingRevisionId}`),
      })),
  }));
}

router.get(
  "/jobs/:jobId/transmittals",
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
    const transmittals = await db
      .select()
      .from(transmittalsTable)
      .where(eq(transmittalsTable.jobId, jobId))
      .orderBy(desc(transmittalsTable.sentDate), desc(transmittalsTable.id));
    res.json(await transmittalDtos(transmittals));
  },
);

router.post(
  "/jobs/:jobId/transmittals",
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
    const parsed = CreateTransmittalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const { sentDate, recipient, purpose, notes, items } = parsed.data;
    if (!recipient.trim()) {
      res.status(400).json({ error: "recipient is required" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sentDate)) {
      res.status(400).json({ error: "sentDate must be YYYY-MM-DD" });
      return;
    }
    for (const item of items) {
      const hasDoc = typeof item.documentId === "number";
      const hasRev = typeof item.drawingRevisionId === "number";
      if (hasDoc === hasRev) {
        res.status(400).json({
          error:
            "Each item must reference exactly one of documentId or drawingRevisionId",
        });
        return;
      }
    }

    // Validate referenced documents / revisions belong to this specific job.
    const docIds = items
      .map((i) => i.documentId)
      .filter((v): v is number => typeof v === "number");
    const revIds = items
      .map((i) => i.drawingRevisionId)
      .filter((v): v is number => typeof v === "number");
    if (docIds.length) {
      const rows = await db
        .select({ id: documentsTable.id })
        .from(documentsTable)
        .where(
          and(inArray(documentsTable.id, docIds), eq(documentsTable.jobId, jobId)),
        );
      if (rows.length !== new Set(docIds).size) {
        res
          .status(400)
          .json({ error: "Transmittal documents must belong to this job" });
        return;
      }
    }
    if (revIds.length) {
      const rows = await db
        .select({ id: drawingRevisionsTable.id })
        .from(drawingRevisionsTable)
        .innerJoin(
          drawingsTable,
          eq(drawingRevisionsTable.drawingId, drawingsTable.id),
        )
        .where(
          and(
            inArray(drawingRevisionsTable.id, revIds),
            eq(drawingsTable.jobId, jobId),
          ),
        );
      if (rows.length !== new Set(revIds).size) {
        res
          .status(400)
          .json({ error: "Transmittal revisions must belong to this job" });
        return;
      }
    }

    const transmittal = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(transmittalsTable)
        .values({
          jobId,
          sentDate,
          senderId: req.auth!.user.id,
          recipient: recipient.trim(),
          purpose,
          notes: notes ?? null,
        })
        .returning();
      await tx.insert(transmittalItemsTable).values(
        items.map((i) => ({
          transmittalId: created.id,
          documentId: i.documentId ?? null,
          drawingRevisionId: i.drawingRevisionId ?? null,
        })),
      );
      return created;
    });

    req.log.info(
      { transmittalId: transmittal.id, jobId, itemCount: items.length },
      "transmittal logged",
    );
    const [dto] = await transmittalDtos([transmittal]);
    res.status(201).json(dto);
  },
);

export default router;
