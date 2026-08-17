import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { db } from "@workspace/db";
import {
  jobsTable,
  estimatesTable,
  documentsTable,
  bomAssembliesTable,
  bomPartsTable,
  processingPathOptionsTable,
  shipmentsTable,
  stageLibraryTable,
} from "@workspace/db";

/** Thrown when a BOM replacement would destroy shipping history. */
class BomLockedByShippingError extends Error {
  constructor() {
    super(
      "This job has shipments; its BOM can no longer be replaced by re-import. Delete planned shipments first — departed shipments permanently lock the BOM for traceability.",
    );
  }
}
import { eq, and, or, ne, isNull, inArray, asc, isNotNull, sql } from "drizzle-orm";
import {
  KissParseError,
  type ParsedBom,
  type ParsedBomAssembly,
} from "../lib/kissParser";
import { parseBomUpload, bomUploadExtError } from "../lib/bomUpload";
import { absorbJobBomIntoEstimate } from "./estimateBom";
import { parseIntParam } from "../lib/params";
import {
  UpdateBomAssemblyBody,
  UpdateBomPartBody,
  CreateProcessingPathOptionBody,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  storageFile,
  deleteStoredObject,
  MAX_DOCUMENT_SIZE_BYTES,
} from "./documents";
import { requireAuth } from "../middlewares/auth";
import {
  getCompanyPipeline,
  canonicalPipelineStage,
  gateStage,
  finalStage,
} from "../services/production";

/** Verify that an assembly belongs (via its job) to the given company. */
async function verifyAssemblyOwnership(assemblyId: number, companyId: number): Promise<boolean> {
  const rows = await db
    .select({ jobId: bomAssembliesTable.jobId })
    .from(bomAssembliesTable)
    .innerJoin(jobsTable, eq(bomAssembliesTable.jobId, jobsTable.id))
    .where(and(eq(bomAssembliesTable.id, assemblyId), eq(jobsTable.companyId, companyId)));
  return rows.length > 0;
}

/** Verify that a BOM part belongs (via its assembly's job) to the given company. */
async function verifyPartOwnership(partId: number, companyId: number): Promise<boolean> {
  const rows = await db
    .select({ assemblyId: bomPartsTable.assemblyId })
    .from(bomPartsTable)
    .innerJoin(bomAssembliesTable, eq(bomPartsTable.assemblyId, bomAssembliesTable.id))
    .innerJoin(jobsTable, eq(bomAssembliesTable.jobId, jobsTable.id))
    .where(and(eq(bomPartsTable.id, partId), eq(jobsTable.companyId, companyId)));
  return rows.length > 0;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
});

function uploadKissFile(
  req: Parameters<ReturnType<typeof upload.single>>[0],
  res: Parameters<ReturnType<typeof upload.single>>[1],
  next: Parameters<ReturnType<typeof upload.single>>[2],
) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          error: `File is too large. Maximum size is ${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)} MB.`,
        });
        return;
      }
      next(err);
      return;
    }
    next();
  });
}

function getOriginalName(file: Express.Multer.File): string {
  return Buffer.from(file.originalname, "latin1").toString("utf8");
}

function rejectNonKiss(res: { status: (code: number) => { json: (body: unknown) => void } }, originalName: string): boolean {
  const extError = bomUploadExtError(originalName);
  if (extError) {
    res.status(400).json({ error: extError });
    return true;
  }
  return false;
}

const router: IRouter = Router();

export interface ViewAssemblyPart {
  id?: number;
  partMark: string | null;
  quantity: number;
  profileType: string | null;
  profileSize: string | null;
  grade: string | null;
  lengthIn: number | null;
  description: string | null;
  heatNumber: string | null;
}

export interface ViewAssembly {
  id?: number;
  mark: string;
  quantity: number;
  description: string | null;
  finish: string | null;
  processingPath: string | null;
  currentStage: string | null;
  onHold: boolean;
  notes: string | null;
  inspectedOn: string | null;
  station: string | null;
  inspector: string | null;
  parts: ViewAssemblyPart[];
}

function buildView(
  assemblies: ViewAssembly[],
  jobRef: string | null = null,
  jobName: string | null = null,
) {
  const totalsMap = new Map<
    string,
    {
      profileType: string | null;
      profileSize: string | null;
      grade: string | null;
      pieces: number;
      totalLengthIn: number | null;
    }
  >();
  let partCount = 0;
  let totalPieces = 0;
  for (const asm of assemblies) {
    for (const p of asm.parts) {
      partCount += 1;
      const pieces = p.quantity * asm.quantity;
      totalPieces += pieces;
      const key = `${p.profileType ?? ""}|${p.profileSize ?? ""}|${p.grade ?? ""}`;
      const entry = totalsMap.get(key) ?? {
        profileType: p.profileType,
        profileSize: p.profileSize,
        grade: p.grade,
        pieces: 0,
        totalLengthIn: null as number | null,
      };
      entry.pieces += pieces;
      if (p.lengthIn !== null) {
        entry.totalLengthIn =
          Math.round(((entry.totalLengthIn ?? 0) + p.lengthIn * pieces) * 100) /
          100;
      }
      totalsMap.set(key, entry);
    }
  }
  const totals = [...totalsMap.values()].sort(
    (a, b) =>
      (a.profileType ?? "").localeCompare(b.profileType ?? "") ||
      (a.profileSize ?? "").localeCompare(b.profileSize ?? ""),
  );
  return {
    jobRef,
    jobName,
    assemblyCount: assemblies.length,
    partCount,
    totalPieces,
    assemblies,
    totals,
  };
}

function parsedToView(parsed: ParsedBom) {
  const assemblies: ViewAssembly[] = parsed.assemblies.map(
    (a: ParsedBomAssembly) => ({
      mark: a.mark,
      quantity: a.quantity,
      description: a.description,
      finish: a.finish,
      processingPath: null,
      currentStage: null,
      onHold: false,
      notes: null,
      inspectedOn: null,
      station: null,
      inspector: null,
      parts: a.parts.map((p) => ({ ...p, heatNumber: null })),
    }),
  );
  return buildView(assemblies, parsed.jobRef, parsed.jobName);
}

function parseUpload(file: Express.Multer.File): ParsedBom {
  return parseBomUpload(getOriginalName(file), file.buffer);
}

export async function loadJobBom(jobId: number): Promise<ViewAssembly[]> {
  const asmRows = await db
    .select()
    .from(bomAssembliesTable)
    .where(eq(bomAssembliesTable.jobId, jobId))
    .orderBy(asc(bomAssembliesTable.sortIndex));
  if (asmRows.length === 0) return [];
  const partRows = await db
    .select()
    .from(bomPartsTable)
    .where(
      inArray(
        bomPartsTable.assemblyId,
        asmRows.map((a) => a.id),
      ),
    )
    .orderBy(asc(bomPartsTable.sortIndex));
  const partsByAsm = new Map<number, typeof partRows>();
  for (const p of partRows) {
    const list = partsByAsm.get(p.assemblyId) ?? [];
    list.push(p);
    partsByAsm.set(p.assemblyId, list);
  }
  return asmRows.map((a) => ({
    id: a.id,
    mark: a.mark,
    quantity: a.quantity,
    description: a.description,
    finish: a.finish,
    processingPath: a.processingPath,
    currentStage: a.currentStage,
    onHold: a.onHold,
    notes: a.notes,
    inspectedOn: a.inspectedOn,
    station: a.station,
    inspector: a.inspector,
    parts: (partsByAsm.get(a.id) ?? []).map((p) => ({
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
  }));
}

/** Replaces the job's BOM with the parsed one inside a transaction, optionally recording the source document. */
async function replaceJobBom(
  jobId: number,
  parsed: ParsedBom,
  document?: typeof documentsTable.$inferInsert,
): Promise<void> {
  let partDocs: { storageKey: string }[] = [];
  await db.transaction(async (tx) => {
    // Hard gate: once the job has shipping history, its BOM can no longer be
    // replaced — a re-import would cascade-delete shipment manifests and
    // effectively "unship" departed assemblies, destroying traceability.
    const [existingShipment] = await tx
      .select({ id: shipmentsTable.id })
      .from(shipmentsTable)
      .where(eq(shipmentsTable.jobId, jobId))
      .limit(1);
    if (existingShipment) {
      throw new BomLockedByShippingError();
    }
    // Part documents cascade-delete with their parts; capture their storage
    // keys inside the transaction (just before the delete) so the stored
    // objects can be cleaned up after the swap commits.
    partDocs = await tx
      .select({ storageKey: documentsTable.storageKey })
      .from(documentsTable)
      .innerJoin(bomPartsTable, eq(documentsTable.partId, bomPartsTable.id))
      .innerJoin(
        bomAssembliesTable,
        eq(bomPartsTable.assemblyId, bomAssembliesTable.id),
      )
      .where(eq(bomAssembliesTable.jobId, jobId));
    await tx
      .delete(bomAssembliesTable)
      .where(eq(bomAssembliesTable.jobId, jobId));
    for (let i = 0; i < parsed.assemblies.length; i++) {
      const a = parsed.assemblies[i];
      const [asm] = await tx
        .insert(bomAssembliesTable)
        .values({
          jobId,
          mark: a.mark,
          quantity: a.quantity,
          description: a.description,
          finish: a.finish,
          sortIndex: i,
        })
        .returning();
      if (a.parts.length > 0) {
        await tx.insert(bomPartsTable).values(
          a.parts.map((p, j) => ({
            assemblyId: asm.id,
            partMark: p.partMark,
            quantity: p.quantity,
            profileType: p.profileType,
            profileSize: p.profileSize,
            grade: p.grade,
            lengthIn: p.lengthIn,
            description: p.description,
            sortIndex: j,
          })),
        );
      }
    }
    if (document) {
      await tx.insert(documentsTable).values(document);
    }
  });
  await Promise.all(partDocs.map((d) => deleteStoredObject(d.storageKey)));
}

function optionToView(row: typeof processingPathOptionsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * processing_path_options is a SHARED reference table (intentionally not company-scoped),
 * analogous to the material catalog. The option names ("Cut", "Bend", "Roll", etc.) are
 * shop-wide vocabulary that has no confidential per-company content.
 *
 * Auto-seed only reads the *caller's* company's assemblies so that one tenant's private
 * processing-path text cannot be discovered by another tenant via the options list.
 */
async function seedOptionsFromAssemblies(companyId: number): Promise<void> {
  // Limit discovery to the caller's company's assemblies via the job FK
  const used = await db
    .selectDistinct({ value: bomAssembliesTable.processingPath })
    .from(bomAssembliesTable)
    .innerJoin(jobsTable, eq(bomAssembliesTable.jobId, jobsTable.id))
    .where(and(
      isNotNull(bomAssembliesTable.processingPath),
      eq(jobsTable.companyId, companyId),
    ));
  const values = used
    .map((r) => r.value?.trim())
    .filter((v): v is string => !!v);
  if (values.length === 0) return;
  await db
    .insert(processingPathOptionsTable)
    .values(values.map((name) => ({ name })))
    .onConflictDoNothing();
}

router.get("/processing-path-options", requireAuth, async (req, res): Promise<void> => {
  await seedOptionsFromAssemblies(req.auth!.companyId);
  const rows = await db
    .select()
    .from(processingPathOptionsTable)
    .orderBy(asc(processingPathOptionsTable.name));
  res.json(rows.map(optionToView));
});

router.post("/processing-path-options", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateProcessingPathOptionBody.safeParse(req.body);
  const name = parsed.success ? parsed.data.name.trim() : "";
  if (!parsed.success || name === "") {
    res.status(400).json({ error: "Option name is required" });
    return;
  }
  // Case-insensitive dedupe: return the existing option if one matches.
  const [existing] = await db
    .select()
    .from(processingPathOptionsTable)
    .where(
      sql`lower(${processingPathOptionsTable.name}) = lower(${name})`,
    );
  if (existing) {
    res.status(201).json(optionToView(existing));
    return;
  }
  const [row] = await db
    .insert(processingPathOptionsTable)
    .values({ name })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    // Lost a race with a concurrent insert; fetch the winner.
    const [winner] = await db
      .select()
      .from(processingPathOptionsTable)
      .where(eq(processingPathOptionsTable.name, name));
    res.status(201).json(optionToView(winner));
    return;
  }
  res.status(201).json(optionToView(row));
});

router.post(
  "/bom/parse",
  requireAuth,
  uploadKissFile,
  async (req, res): Promise<void> => {
    if (!req.file) {
      res
        .status(400)
        .json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }
    if (rejectNonKiss(res, getOriginalName(req.file))) return;
    try {
      const parsed = parseUpload(req.file);
      res.json(parsedToView(parsed));
    } catch (err) {
      if (err instanceof KissParseError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.get("/jobs/:jobId/bom", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const assemblies = await loadJobBom(jobId);
  res.json(buildView(assemblies));
});

router.post(
  "/jobs/:jobId/bom",
  requireAuth,
  uploadKissFile,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (!req.file) {
      res
        .status(400)
        .json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }

    const originalName = getOriginalName(req.file);
    if (rejectNonKiss(res, originalName)) return;

    let parsed: ParsedBom;
    try {
      parsed = parseUpload(req.file);
    } catch (err) {
      if (err instanceof KissParseError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Save the original file to object storage first, then replace the BOM
    // and record the document in a single transaction so an import always
    // has its source file attached.
    const service = new ObjectStorageService();
    let privateDir = service.getPrivateObjectDir();
    if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);
    const storageKey = `${privateDir}/documents/job-${jobId}/${randomUUID()}.kss`;
    await storageFile(storageKey).save(req.file.buffer, {
      contentType: "text/plain",
      resumable: false,
    });

    try {
      await replaceJobBom(jobId, parsed, {
        jobId,
        filename: originalName,
        category: "nc_data",
        mimeType: "text/plain",
        sizeBytes: req.file.size,
        storageKey,
      });
    } catch (err) {
      // BOM replacement failed; clean up the orphaned stored object.
      await storageFile(storageKey)
        .delete()
        .catch((cleanupErr: unknown) =>
          req.log.warn(
            { err: cleanupErr, storageKey },
            "Failed to clean up stored KISS file after import error",
          ),
        );
      if (err instanceof BomLockedByShippingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    // Detailed-BOM absorption: when a job created from a (preliminary) won
    // estimate receives a real KISS/CNC package, the estimate is now backed
    // by detailed data. Re-importing replaces the job's BOM in place,
    // preserving the job/customer/PO history — no new estimate is created —
    // and the linked estimate's own BOM is synchronized so its pricing and
    // quote reflect the detailed package.
    if (job.estimateId != null) {
      await absorbJobBomIntoEstimate(job.estimateId, parsed);
      await db
        .update(estimatesTable)
        .set({ type: "detailed" })
        .where(eq(estimatesTable.id, job.estimateId));
    }

    req.log.info(
      { jobId, assemblies: parsed.assemblies.length },
      "BOM imported from KISS file",
    );
    const assemblies = await loadJobBom(jobId);
    res.status(201).json(buildView(assemblies));
  },
);

router.patch("/bom/assemblies/:assemblyId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const assemblyId = parseIntParam(req.params.assemblyId);
  if (assemblyId === null) {
    res.status(400).json({ error: "Invalid assembly id" });
    return;
  }
  if (!(await verifyAssemblyOwnership(assemblyId, companyId))) {
    res.status(404).json({ error: "Assembly not found" });
    return;
  }
  const parsed = UpdateBomAssemblyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
    return;
  }
  const body = parsed.data;
  if (body.quantity !== undefined && body.quantity < 1) {
    res.status(400).json({ error: "Quantity must be at least 1" });
    return;
  }
  const updates: Partial<typeof bomAssembliesTable.$inferInsert> = {};
  if (body.description !== undefined) updates.description = body.description;
  if (body.quantity !== undefined) updates.quantity = body.quantity;
  if (body.processingPath !== undefined) updates.processingPath = body.processingPath;
  // The company's pipeline (stage_library) — needed for stage validation and
  // for the shipped-terminal guard below.
  const pipeline =
    body.currentStage !== undefined ? await getCompanyPipeline(companyId) : [];
  const shippedStage = finalStage(pipeline);
  if (body.currentStage !== undefined) {
    // Enforced stage state machine: only the company's stage-library pipeline
    // stages are accepted, and the final stage is reachable only via shipment
    // departure. A shipped assembly is terminal: no direct stage edits.
    const [current] = await db
      .select({ currentStage: bomAssembliesTable.currentStage })
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.id, assemblyId));
    const isFinal = (stage: string | null | undefined) =>
      !!shippedStage &&
      !!stage &&
      stage.trim().toLowerCase() === shippedStage.name.toLowerCase();
    if (current && isFinal(current.currentStage) && !isFinal(body.currentStage)) {
      res.status(409).json({
        error:
          "This assembly has shipped; its stage can no longer be edited directly. Shipping records are the source of truth for departed assemblies.",
      });
      return;
    }
    if (body.currentStage === null || body.currentStage === "") {
      updates.currentStage = null;
    } else {
      const canonical = canonicalPipelineStage(pipeline, body.currentStage);
      if (!canonical) {
        res.status(400).json({
          error: `Unknown stage "${body.currentStage}". Valid stages: ${pipeline.map((s) => s.name).join(", ")}.`,
        });
        return;
      }
      if (shippedStage && canonical.id === shippedStage.id) {
        res.status(409).json({
          error: `Assemblies are marked ${shippedStage.name} by departing a shipment (with a signed load confirmation), not by editing the stage directly.`,
        });
        return;
      }
      updates.currentStage = canonical.name;
      if (canonical.isReadyToShipGate) {
        // Stamp inspection metadata when the assembly reaches the RTS gate.
        const [existing] = await db
          .select({ inspectedOn: bomAssembliesTable.inspectedOn })
          .from(bomAssembliesTable)
          .where(eq(bomAssembliesTable.id, assemblyId));
        if (!existing?.inspectedOn) {
          updates.inspectedOn = new Date().toISOString().slice(0, 10);
          updates.inspector = req.auth!.user.name;
        }
      }
    }
  }
  if (body.onHold !== undefined) updates.onHold = body.onHold;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  // When the stage is being changed, guard the write itself so a stale PATCH
  // can never overwrite "Shipped" set by a concurrent shipment departure
  // (the earlier pre-read check alone would be racy).
  const stageGuard =
    body.currentStage !== undefined && shippedStage
      ? or(
          isNull(bomAssembliesTable.currentStage),
          ne(bomAssembliesTable.currentStage, shippedStage.name),
        )
      : undefined;
  // Serialize against concurrent stage-library rename/delete: lock the target
  // stage row FOR SHARE in the same transaction as the assembly write. A
  // delete/rename takes FOR UPDATE on the pipeline rows, so it either
  // committed before we lock (stage gone → 409 here) or waits for us.
  let updated: typeof bomAssembliesTable.$inferSelect | undefined;
  await db.transaction(async (tx) => {
    if (typeof updates.currentStage === "string") {
      const [stageRow] = await tx
        .select({ name: stageLibraryTable.name })
        .from(stageLibraryTable)
        .where(
          and(
            eq(stageLibraryTable.companyId, companyId),
            sql`lower(${stageLibraryTable.name}) = lower(${updates.currentStage})`,
          ),
        )
        .for("share");
      if (!stageRow) return; // stage vanished concurrently → handled below
      updates.currentStage = stageRow.name; // canonical casing
    }
    [updated] = await tx
      .update(bomAssembliesTable)
      .set(updates)
      .where(and(eq(bomAssembliesTable.id, assemblyId), stageGuard))
      .returning();
  });
  if (!updated) {
    const [still] = await db
      .select({ currentStage: bomAssembliesTable.currentStage })
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.id, assemblyId));
    if (
      still &&
      shippedStage &&
      (still.currentStage ?? "").trim().toLowerCase() === shippedStage.name.toLowerCase()
    ) {
      res.status(409).json({
        error:
          "This assembly has shipped; its stage can no longer be edited directly. Shipping records are the source of truth for departed assemblies.",
      });
      return;
    }
    if (still && typeof updates.currentStage === "string") {
      res.status(409).json({
        error: "The pipeline changed while saving. Refresh and try again.",
      });
      return;
    }
    res.status(404).json({ error: "Assembly not found" });
    return;
  }
  const parts = await db
    .select()
    .from(bomPartsTable)
    .where(eq(bomPartsTable.assemblyId, assemblyId))
    .orderBy(asc(bomPartsTable.sortIndex));
  res.json({
    id: updated.id,
    mark: updated.mark,
    quantity: updated.quantity,
    description: updated.description,
    finish: updated.finish,
    processingPath: updated.processingPath,
    currentStage: updated.currentStage,
    onHold: updated.onHold,
    notes: updated.notes,
    inspectedOn: updated.inspectedOn,
    station: updated.station,
    inspector: updated.inspector,
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
  });
});

router.patch("/bom/parts/:partId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const partId = parseIntParam(req.params.partId);
  if (partId === null) {
    res.status(400).json({ error: "Invalid part id" });
    return;
  }
  if (!(await verifyPartOwnership(partId, companyId))) {
    res.status(404).json({ error: "Part not found" });
    return;
  }
  const parsed = UpdateBomPartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
    return;
  }
  const body = parsed.data;
  if (body.quantity !== undefined && body.quantity < 1) {
    res.status(400).json({ error: "Quantity must be at least 1" });
    return;
  }
  const updates: Partial<typeof bomPartsTable.$inferInsert> = {};
  if (body.partMark !== undefined) updates.partMark = body.partMark;
  if (body.quantity !== undefined) updates.quantity = body.quantity;
  if (body.profileType !== undefined) updates.profileType = body.profileType;
  if (body.profileSize !== undefined) updates.profileSize = body.profileSize;
  if (body.grade !== undefined) updates.grade = body.grade;
  if (body.lengthIn !== undefined) updates.lengthIn = body.lengthIn;
  if (body.description !== undefined) updates.description = body.description;
  if (body.heatNumber !== undefined) updates.heatNumber = body.heatNumber;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(bomPartsTable)
    .set(updates)
    .where(eq(bomPartsTable.id, partId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Part not found" });
    return;
  }
  res.json({
    id: updated.id,
    partMark: updated.partMark,
    quantity: updated.quantity,
    profileType: updated.profileType,
    profileSize: updated.profileSize,
    grade: updated.grade,
    lengthIn: updated.lengthIn,
    description: updated.description,
    heatNumber: updated.heatNumber,
  });
});

export default router;
