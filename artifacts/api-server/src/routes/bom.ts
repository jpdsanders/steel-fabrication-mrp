import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { db } from "@workspace/db";
import {
  jobsTable,
  documentsTable,
  bomAssembliesTable,
  bomPartsTable,
  processingPathOptionsTable,
} from "@workspace/db";
import { eq, inArray, asc, isNotNull, sql } from "drizzle-orm";
import {
  parseKissFile,
  KissParseError,
  type ParsedBom,
  type ParsedBomAssembly,
} from "../lib/kissParser";
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
  const ext = path.extname(originalName).toLowerCase();
  if (ext !== ".kss") {
    res.status(400).json({
      error: `File type "${ext || "unknown"}" is not allowed. Upload a KISS (.kss) file.`,
    });
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

function parseUpload(buffer: Buffer): ParsedBom {
  return parseKissFile(buffer.toString("utf8"));
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

/** Inserts any distinct processing path values used on assemblies that are missing from the options table. */
async function seedOptionsFromAssemblies(): Promise<void> {
  const used = await db
    .selectDistinct({ value: bomAssembliesTable.processingPath })
    .from(bomAssembliesTable)
    .where(isNotNull(bomAssembliesTable.processingPath));
  const values = used
    .map((r) => r.value?.trim())
    .filter((v): v is string => !!v);
  if (values.length === 0) return;
  await db
    .insert(processingPathOptionsTable)
    .values(values.map((name) => ({ name })))
    .onConflictDoNothing();
}

router.get("/processing-path-options", async (_req, res): Promise<void> => {
  await seedOptionsFromAssemblies();
  const rows = await db
    .select()
    .from(processingPathOptionsTable)
    .orderBy(asc(processingPathOptionsTable.name));
  res.json(rows.map(optionToView));
});

router.post("/processing-path-options", async (req, res): Promise<void> => {
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
      const parsed = parseUpload(req.file.buffer);
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

router.get("/jobs/:jobId/bom", async (req, res): Promise<void> => {
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const assemblies = await loadJobBom(jobId);
  res.json(buildView(assemblies));
});

router.post(
  "/jobs/:jobId/bom",
  uploadKissFile,
  async (req, res): Promise<void> => {
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId));
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
      parsed = parseUpload(req.file.buffer);
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
      throw err;
    }

    req.log.info(
      { jobId, assemblies: parsed.assemblies.length },
      "BOM imported from KISS file",
    );
    const assemblies = await loadJobBom(jobId);
    res.status(201).json(buildView(assemblies));
  },
);

router.patch("/bom/assemblies/:assemblyId", async (req, res): Promise<void> => {
  const assemblyId = parseIntParam(req.params.assemblyId);
  if (assemblyId === null) {
    res.status(400).json({ error: "Invalid assembly id" });
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
  if (body.currentStage !== undefined) updates.currentStage = body.currentStage;
  if (body.onHold !== undefined) updates.onHold = body.onHold;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [updated] = await db
    .update(bomAssembliesTable)
    .set(updates)
    .where(eq(bomAssembliesTable.id, assemblyId))
    .returning();
  if (!updated) {
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

router.patch("/bom/parts/:partId", async (req, res): Promise<void> => {
  const partId = parseIntParam(req.params.partId);
  if (partId === null) {
    res.status(400).json({ error: "Invalid part id" });
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
