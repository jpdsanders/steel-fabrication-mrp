import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import path from "path";
import { db } from "@workspace/db";
import {
  jobsTable,
  documentsTable,
  drawingsTable,
  drawingRevisionsTable,
  drawingAcknowledgmentsTable,
  usersTable,
  DRAWING_REVISION_STATUSES,
} from "@workspace/db";
import { eq, and, inArray, desc, asc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_EXTENSIONS_LABEL,
  uploadMiddleware,
  storageFile,
  deleteStoredObject,
} from "./documents";

const router: IRouter = Router();

type RevisionRow = typeof drawingRevisionsTable.$inferSelect;

function isValidStatus(status: unknown): status is RevisionRow["status"] {
  return (
    typeof status === "string" &&
    (DRAWING_REVISION_STATUSES as readonly string[]).includes(status)
  );
}

async function getOwnedJob(jobId: number, companyId: number) {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  return job ?? null;
}

/** Resolves a drawing and verifies the caller's company owns its job. */
async function getOwnedDrawing(drawingId: number, companyId: number) {
  const rows = await db
    .select({ drawing: drawingsTable })
    .from(drawingsTable)
    .innerJoin(jobsTable, eq(drawingsTable.jobId, jobsTable.id))
    .where(
      and(eq(drawingsTable.id, drawingId), eq(jobsTable.companyId, companyId)),
    );
  return rows[0]?.drawing ?? null;
}

/** Resolves a revision (with its drawing) scoped to the caller's company. */
async function getOwnedRevision(revisionId: number, companyId: number) {
  const rows = await db
    .select({ revision: drawingRevisionsTable, drawing: drawingsTable })
    .from(drawingRevisionsTable)
    .innerJoin(
      drawingsTable,
      eq(drawingRevisionsTable.drawingId, drawingsTable.id),
    )
    .innerJoin(jobsTable, eq(drawingsTable.jobId, jobsTable.id))
    .where(
      and(
        eq(drawingRevisionsTable.id, revisionId),
        eq(jobsTable.companyId, companyId),
      ),
    );
  return rows[0] ?? null;
}

async function revisionDtos(
  revisions: RevisionRow[],
  currentUserId: number,
  opts: { includeAcks?: boolean } = {},
) {
  const revisionIds = revisions.map((r) => r.id);
  const documentIds = [...new Set(revisions.map((r) => r.documentId))];
  const userIds = [
    ...new Set(revisions.map((r) => r.issuedBy).filter((v): v is number => v !== null)),
  ];

  const [docs, users, acks] = await Promise.all([
    documentIds.length
      ? db
          .select({ id: documentsTable.id, filename: documentsTable.filename })
          .from(documentsTable)
          .where(inArray(documentsTable.id, documentIds))
      : Promise.resolve([]),
    userIds.length
      ? db
          .select({ id: usersTable.id, name: usersTable.name })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : Promise.resolve([]),
    revisionIds.length
      ? db
          .select({
            drawingRevisionId: drawingAcknowledgmentsTable.drawingRevisionId,
            userId: drawingAcknowledgmentsTable.userId,
            acknowledgedAt: drawingAcknowledgmentsTable.acknowledgedAt,
            userName: usersTable.name,
          })
          .from(drawingAcknowledgmentsTable)
          .innerJoin(
            usersTable,
            eq(drawingAcknowledgmentsTable.userId, usersTable.id),
          )
          .where(
            inArray(drawingAcknowledgmentsTable.drawingRevisionId, revisionIds),
          )
      : Promise.resolve(
          [] as {
            drawingRevisionId: number;
            userId: number;
            acknowledgedAt: Date;
            userName: string;
          }[],
        ),
  ]);
  const docMap = new Map(docs.map((d) => [d.id, d.filename]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return revisions.map((r) => ({
    id: r.id,
    drawingId: r.drawingId,
    revisionLabel: r.revisionLabel,
    status: r.status,
    isActive: r.isActive,
    changeSummary: r.changeSummary,
    documentId: r.documentId,
    documentFilename: docMap.get(r.documentId) ?? "",
    issuedBy: r.issuedBy,
    issuedByName: r.issuedBy !== null ? (userMap.get(r.issuedBy) ?? null) : null,
    supersededAt: r.supersededAt,
    createdAt: r.createdAt,
    acknowledgedByMe: acks.some(
      (a) => a.drawingRevisionId === r.id && a.userId === currentUserId,
    ),
    ...(opts.includeAcks
      ? {
          acknowledgments: acks
            .filter((a) => a.drawingRevisionId === r.id)
            .map((a) => ({
              userId: a.userId,
              userName: a.userName,
              acknowledgedAt: a.acknowledgedAt,
            })),
        }
      : {}),
  }));
}

async function drawingDetailDto(
  drawing: typeof drawingsTable.$inferSelect,
  currentUserId: number,
) {
  const revisions = await db
    .select()
    .from(drawingRevisionsTable)
    .where(eq(drawingRevisionsTable.drawingId, drawing.id))
    .orderBy(desc(drawingRevisionsTable.createdAt));
  return {
    id: drawing.id,
    jobId: drawing.jobId,
    drawingNumber: drawing.drawingNumber,
    description: drawing.description,
    createdAt: drawing.createdAt,
    revisions: await revisionDtos(revisions, currentUserId, {
      includeAcks: true,
    }),
  };
}

/** Uploads a file to GCS and creates the backing documents row. */
async function storeDrawingFile(
  jobId: number,
  file: Express.Multer.File,
): Promise<{ documentId: number; storageKey: string } | { error: string }> {
  const originalName = Buffer.from(file.originalname, "latin1").toString(
    "utf8",
  );
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      error: `File type "${ext || "unknown"}" is not allowed. Allowed types: ${ALLOWED_EXTENSIONS_LABEL}.`,
    };
  }
  const service = new ObjectStorageService();
  let privateDir = service.getPrivateObjectDir();
  if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);
  const storageKey = `${privateDir}/documents/job-${jobId}/${randomUUID()}${ext}`;

  const gcsFile = storageFile(storageKey);
  await gcsFile.save(file.buffer, {
    contentType: file.mimetype || "application/octet-stream",
    resumable: false,
  });

  try {
    const [doc] = await db
      .insert(documentsTable)
      .values({
        jobId,
        filename: originalName,
        category: "drawing",
        mimeType: file.mimetype || "application/octet-stream",
        sizeBytes: file.size,
        storageKey,
      })
      .returning();
    return { documentId: doc.id, storageKey };
  } catch (err) {
    await deleteStoredObject(storageKey);
    throw err;
  }
}

// ── Drawings ────────────────────────────────────────────────────────────────

router.get(
  "/jobs/:jobId/drawings",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const userId = req.auth!.user.id;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const job = await getOwnedJob(jobId, companyId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const drawings = await db
      .select()
      .from(drawingsTable)
      .where(eq(drawingsTable.jobId, jobId))
      .orderBy(asc(drawingsTable.drawingNumber));
    const drawingIds = drawings.map((d) => d.id);
    const revisions = drawingIds.length
      ? await db
          .select()
          .from(drawingRevisionsTable)
          .where(inArray(drawingRevisionsTable.drawingId, drawingIds))
      : [];
    const activeRevisions = revisions.filter((r) => r.isActive);
    const activeDtos = await revisionDtos(activeRevisions, userId);
    const activeByDrawing = new Map(activeDtos.map((r) => [r.drawingId, r]));

    res.json(
      drawings.map((d) => {
        const active = activeByDrawing.get(d.id) ?? null;
        return {
          id: d.id,
          jobId: d.jobId,
          drawingNumber: d.drawingNumber,
          description: d.description,
          createdAt: d.createdAt,
          revisionCount: revisions.filter((r) => r.drawingId === d.id).length,
          activeRevision: active,
          ackRequired: active !== null && !active.acknowledgedByMe,
        };
      }),
    );
  },
);

router.post(
  "/jobs/:jobId/drawings",
  requireAuth,
  uploadMiddleware,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const userId = req.auth!.user.id;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const job = await getOwnedJob(jobId, companyId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }
    const drawingNumber =
      typeof req.body.drawingNumber === "string"
        ? req.body.drawingNumber.trim()
        : "";
    if (!drawingNumber) {
      res.status(400).json({ error: "drawingNumber is required" });
      return;
    }
    const description =
      typeof req.body.description === "string" && req.body.description.trim()
        ? req.body.description.trim()
        : null;
    const revisionLabel =
      typeof req.body.revisionLabel === "string" && req.body.revisionLabel.trim()
        ? req.body.revisionLabel.trim()
        : "0";
    const status = req.body.status ?? "issued_for_approval";
    if (!isValidStatus(status)) {
      res.status(400).json({ error: "Invalid revision status" });
      return;
    }

    const [existing] = await db
      .select({ id: drawingsTable.id })
      .from(drawingsTable)
      .where(
        and(
          eq(drawingsTable.jobId, jobId),
          eq(drawingsTable.drawingNumber, drawingNumber),
        ),
      );
    if (existing) {
      res.status(409).json({
        error: `Drawing ${drawingNumber} already exists on this job. Upload a new revision instead.`,
      });
      return;
    }

    const stored = await storeDrawingFile(jobId, file);
    if ("error" in stored) {
      res.status(400).json({ error: stored.error });
      return;
    }

    const drawing = await db.transaction(async (tx) => {
      const [d] = await tx
        .insert(drawingsTable)
        .values({ jobId, drawingNumber, description })
        .returning();
      await tx.insert(drawingRevisionsTable).values({
        drawingId: d.id,
        revisionLabel,
        status,
        isActive: true,
        documentId: stored.documentId,
        issuedBy: userId,
      });
      return d;
    });

    req.log.info(
      { drawingId: drawing.id, jobId, drawingNumber },
      "drawing created",
    );
    res.status(201).json(await drawingDetailDto(drawing, userId));
  },
);

router.get(
  "/drawings/:drawingId",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const drawingId = parseIntParam(req.params.drawingId);
    if (drawingId === null) {
      res.status(400).json({ error: "Invalid drawing id" });
      return;
    }
    const drawing = await getOwnedDrawing(drawingId, companyId);
    if (!drawing) {
      res.status(404).json({ error: "Drawing not found" });
      return;
    }
    res.json(await drawingDetailDto(drawing, req.auth!.user.id));
  },
);

// ── Revisions ───────────────────────────────────────────────────────────────

router.post(
  "/drawings/:drawingId/revisions",
  requireAuth,
  uploadMiddleware,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const userId = req.auth!.user.id;
    const drawingId = parseIntParam(req.params.drawingId);
    if (drawingId === null) {
      res.status(400).json({ error: "Invalid drawing id" });
      return;
    }
    const drawing = await getOwnedDrawing(drawingId, companyId);
    if (!drawing) {
      res.status(404).json({ error: "Drawing not found" });
      return;
    }
    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }
    const revisionLabel =
      typeof req.body.revisionLabel === "string"
        ? req.body.revisionLabel.trim()
        : "";
    if (!revisionLabel) {
      res.status(400).json({ error: "revisionLabel is required" });
      return;
    }
    const status = req.body.status ?? "issued_for_approval";
    if (!isValidStatus(status)) {
      res.status(400).json({ error: "Invalid revision status" });
      return;
    }
    const changeSummary =
      typeof req.body.changeSummary === "string" && req.body.changeSummary.trim()
        ? req.body.changeSummary.trim()
        : null;

    const [labelClash] = await db
      .select({ id: drawingRevisionsTable.id })
      .from(drawingRevisionsTable)
      .where(
        and(
          eq(drawingRevisionsTable.drawingId, drawingId),
          eq(drawingRevisionsTable.revisionLabel, revisionLabel),
        ),
      );
    if (labelClash) {
      res.status(409).json({
        error: `Revision ${revisionLabel} already exists for this drawing.`,
      });
      return;
    }

    const [priorActive] = await db
      .select()
      .from(drawingRevisionsTable)
      .where(
        and(
          eq(drawingRevisionsTable.drawingId, drawingId),
          eq(drawingRevisionsTable.isActive, true),
        ),
      );
    if (priorActive && !changeSummary) {
      res.status(400).json({
        error:
          "changeSummary is required when superseding the current Active revision — describe what changed so the shop floor can acknowledge it.",
      });
      return;
    }

    const stored = await storeDrawingFile(drawing.jobId, file);
    if ("error" in stored) {
      res.status(400).json({ error: stored.error });
      return;
    }

    // Supersede the prior Active revision and activate the new one atomically.
    // Exactly one Active revision per drawing is also enforced by a partial
    // unique index (drawing_revisions_one_active).
    await db.transaction(async (tx) => {
      if (priorActive) {
        await tx
          .update(drawingRevisionsTable)
          .set({ isActive: false, supersededAt: new Date() })
          .where(eq(drawingRevisionsTable.id, priorActive.id));
      }
      await tx.insert(drawingRevisionsTable).values({
        drawingId,
        revisionLabel,
        status,
        isActive: true,
        changeSummary,
        documentId: stored.documentId,
        issuedBy: userId,
      });
    });

    req.log.info(
      { drawingId, revisionLabel, supersededRevisionId: priorActive?.id },
      "drawing revision created",
    );
    res.status(201).json(await drawingDetailDto(drawing, userId));
  },
);

router.patch(
  "/drawing-revisions/:revisionId/status",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const revisionId = parseIntParam(req.params.revisionId);
    if (revisionId === null) {
      res.status(400).json({ error: "Invalid revision id" });
      return;
    }
    const owned = await getOwnedRevision(revisionId, companyId);
    if (!owned) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    const status = req.body?.status;
    if (!isValidStatus(status)) {
      res.status(400).json({ error: "Invalid revision status" });
      return;
    }
    const [updated] = await db
      .update(drawingRevisionsTable)
      .set({ status })
      .where(eq(drawingRevisionsTable.id, revisionId))
      .returning();
    req.log.info({ revisionId, status }, "drawing revision status updated");
    const [dto] = await revisionDtos([updated], req.auth!.user.id, {
      includeAcks: true,
    });
    res.json(dto);
  },
);

// ── Acknowledgment gate ─────────────────────────────────────────────────────

router.post(
  "/drawing-revisions/:revisionId/acknowledge",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const userId = req.auth!.user.id;
    const revisionId = parseIntParam(req.params.revisionId);
    if (revisionId === null) {
      res.status(400).json({ error: "Invalid revision id" });
      return;
    }
    const owned = await getOwnedRevision(revisionId, companyId);
    if (!owned) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    const [ack] = await db
      .insert(drawingAcknowledgmentsTable)
      .values({ userId, drawingRevisionId: revisionId })
      .onConflictDoNothing()
      .returning();
    if (ack) {
      req.log.info(
        { revisionId, userId, acknowledgedAt: ack.acknowledgedAt },
        "drawing revision acknowledged",
      );
      res.status(201).json(ack);
      return;
    }
    // Already acknowledged — return the existing record (idempotent).
    const [existing] = await db
      .select()
      .from(drawingAcknowledgmentsTable)
      .where(
        and(
          eq(drawingAcknowledgmentsTable.userId, userId),
          eq(drawingAcknowledgmentsTable.drawingRevisionId, revisionId),
        ),
      );
    res.status(201).json(existing);
  },
);

router.get(
  "/drawing-revisions/:revisionId/file",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const userId = req.auth!.user.id;
    const revisionId = parseIntParam(req.params.revisionId);
    if (revisionId === null) {
      res.status(400).json({ error: "Invalid revision id" });
      return;
    }
    const owned = await getOwnedRevision(revisionId, companyId);
    if (!owned) {
      res.status(404).json({ error: "Revision not found" });
      return;
    }
    // The blocking gate, enforced server-side: an Active revision's file
    // cannot be viewed until the caller has acknowledged it.
    if (owned.revision.isActive) {
      const [ack] = await db
        .select({ id: drawingAcknowledgmentsTable.id })
        .from(drawingAcknowledgmentsTable)
        .where(
          and(
            eq(drawingAcknowledgmentsTable.userId, userId),
            eq(drawingAcknowledgmentsTable.drawingRevisionId, revisionId),
          ),
        );
      if (!ack) {
        res.status(403).json({
          error:
            "You must acknowledge this revision's changes before viewing it.",
        });
        return;
      }
    }
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, owned.revision.documentId));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const gcsFile = storageFile(doc.storageKey);
    const [exists] = await gcsFile.exists();
    if (!exists) {
      res.status(404).json({ error: "Stored file not found" });
      return;
    }
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(doc.sizeBytes));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    const stream = gcsFile.createReadStream();
    stream.on("error", (err) => {
      req.log.error({ err, revisionId }, "revision file stream error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to download file" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  },
);

// ── Closeout package ────────────────────────────────────────────────────────

router.get(
  "/jobs/:jobId/closeout-package",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const job = await getOwnedJob(jobId, companyId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const drawings = await db
      .select()
      .from(drawingsTable)
      .where(eq(drawingsTable.jobId, jobId))
      .orderBy(asc(drawingsTable.drawingNumber));
    const drawingIds = drawings.map((d) => d.id);
    // Only the current Active revision of each drawing can represent the
    // as-built record — superseded revisions never enter the closeout package.
    const asBuilt = drawingIds.length
      ? await db
          .select()
          .from(drawingRevisionsTable)
          .where(
            and(
              inArray(drawingRevisionsTable.drawingId, drawingIds),
              eq(drawingRevisionsTable.isActive, true),
              eq(drawingRevisionsTable.status, "as_built_final"),
            ),
          )
      : [];
    const dtos = await revisionDtos(asBuilt, req.auth!.user.id);
    const byDrawing = new Map(drawings.map((d) => [d.id, d]));
    res.json({
      jobId,
      totalDrawings: drawings.length,
      asBuiltCount: dtos.length,
      asBuiltDrawings: dtos.map((r) => {
        const d = byDrawing.get(r.drawingId)!;
        return {
          drawingId: d.id,
          drawingNumber: d.drawingNumber,
          description: d.description,
          revision: r,
        };
      }),
    });
  },
);

export default router;
