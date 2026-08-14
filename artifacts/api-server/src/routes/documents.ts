import { Router, type IRouter } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import { Readable } from "stream";
import { db } from "@workspace/db";
import {
  jobsTable,
  estimatesTable,
  documentsTable,
  bomPartsTable,
  bomAssembliesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { UploadJobDocumentBody } from "@workspace/api-zod";
import { objectStorageClient, ObjectStorageService } from "../lib/objectStorage";
import { parseIntParam } from "../lib/params";

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".dwg",
  ".dxf",
  ".nc1",
  ".nc",
  ".jpg",
  ".jpeg",
  ".png",
  ".xlsx",
  ".csv",
  ".kss",
  ".xml",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
});

function parseStorageKey(storageKey: string): {
  bucketName: string;
  objectName: string;
} {
  const parts = storageKey.startsWith("/")
    ? storageKey.slice(1).split("/")
    : storageKey.split("/");
  return { bucketName: parts[0], objectName: parts.slice(1).join("/") };
}

export function storageFile(storageKey: string) {
  const { bucketName, objectName } = parseStorageKey(storageKey);
  return objectStorageClient.bucket(bucketName).file(objectName);
}

export async function deleteStoredObject(
  storageKey: string,
): Promise<boolean> {
  try {
    await storageFile(storageKey).delete({ ignoreNotFound: true });
    return true;
  } catch {
    return false;
  }
}

export async function deleteJobDocumentObjects(jobId: number): Promise<void> {
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.jobId, jobId));
  await Promise.all(docs.map((d) => deleteStoredObject(d.storageKey)));
  await deleteJobPartDocumentObjects(jobId);
}

/** Deletes stored objects for documents attached to any BOM part of the job. */
export async function deleteJobPartDocumentObjects(
  jobId: number,
): Promise<void> {
  const docs = await db
    .select({ storageKey: documentsTable.storageKey })
    .from(documentsTable)
    .innerJoin(bomPartsTable, eq(documentsTable.partId, bomPartsTable.id))
    .innerJoin(
      bomAssembliesTable,
      eq(bomPartsTable.assemblyId, bomAssembliesTable.id),
    )
    .where(eq(bomAssembliesTable.jobId, jobId));
  await Promise.all(docs.map((d) => deleteStoredObject(d.storageKey)));
}

export async function deleteEstimateDocumentObjects(
  estimateId: number,
): Promise<void> {
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.estimateId, estimateId));
  await Promise.all(docs.map((d) => deleteStoredObject(d.storageKey)));
}

function toDocumentDto(doc: typeof documentsTable.$inferSelect) {
  const { storageKey: _storageKey, ...rest } = doc;
  return rest;
}

const router: IRouter = Router();

const uploadMiddleware = (
  req: Parameters<ReturnType<typeof upload.single>>[0],
  res: Parameters<ReturnType<typeof upload.single>>[1],
  next: Parameters<ReturnType<typeof upload.single>>[2],
) => {
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
};

router.get(
  "/estimates/:estimateId/documents",
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const [estimate] = await db
      .select()
      .from(estimatesTable)
      .where(eq(estimatesTable.id, estimateId));
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const docs = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.estimateId, estimateId))
      .orderBy(documentsTable.uploadedAt);
    res.json(docs.map(toDocumentDto));
  },
);

router.post(
  "/estimates/:estimateId/documents",
  uploadMiddleware,
  async (req, res): Promise<void> => {
    const estimateId = parseIntParam(req.params.estimateId);
    if (estimateId === null) {
      res.status(400).json({ error: "Invalid estimate id" });
      return;
    }
    const [estimate] = await db
      .select()
      .from(estimatesTable)
      .where(eq(estimatesTable.id, estimateId));
    if (!estimate) {
      res.status(404).json({ error: "Estimate not found" });
      return;
    }
    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }
    const { category } = UploadJobDocumentBody.omit({ file: true }).parse(
      req.body,
    );

    const originalName = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({
        error: `File type "${ext || "unknown"}" is not allowed. Allowed types: PDF, DWG, DXF, NC1, NC, JPG, PNG, XLSX, CSV, KSS, XML.`,
      });
      return;
    }

    const service = new ObjectStorageService();
    let privateDir = service.getPrivateObjectDir();
    if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);
    const storageKey = `${privateDir}/documents/estimate-${estimateId}/${randomUUID()}${ext}`;

    const gcsFile = storageFile(storageKey);
    await gcsFile.save(file.buffer, {
      contentType: file.mimetype || "application/octet-stream",
      resumable: false,
    });

    const [doc] = await db
      .insert(documentsTable)
      .values({
        estimateId,
        filename: originalName,
        category,
        mimeType: file.mimetype || "application/octet-stream",
        sizeBytes: file.size,
        storageKey,
      })
      .returning();

    req.log.info(
      { documentId: doc.id, estimateId, storageKey },
      "estimate document uploaded",
    );
    res.status(201).json(toDocumentDto(doc));
  },
);

router.get("/jobs/:jobId/documents", async (req, res): Promise<void> => {
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
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.jobId, jobId))
    .orderBy(documentsTable.uploadedAt);
  res.json(docs.map(toDocumentDto));
});

router.post(
  "/jobs/:jobId/documents",
  uploadMiddleware,
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
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }
    const { category } = UploadJobDocumentBody.omit({ file: true }).parse(
      req.body,
    );

    const originalName = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({
        error: `File type "${ext || "unknown"}" is not allowed. Allowed types: PDF, DWG, DXF, NC1, NC, JPG, PNG, XLSX, CSV, KSS, XML.`,
      });
      return;
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

    const [doc] = await db
      .insert(documentsTable)
      .values({
        jobId,
        filename: originalName,
        category,
        mimeType: file.mimetype || "application/octet-stream",
        sizeBytes: file.size,
        storageKey,
      })
      .returning();

    req.log.info({ documentId: doc.id, jobId, storageKey }, "document uploaded");
    res.status(201).json(toDocumentDto(doc));
  },
);

router.get("/bom/parts/:partId/documents", async (req, res): Promise<void> => {
  const partId = parseIntParam(req.params.partId);
  if (partId === null) {
    res.status(400).json({ error: "Invalid part id" });
    return;
  }
  const [part] = await db
    .select()
    .from(bomPartsTable)
    .where(eq(bomPartsTable.id, partId));
  if (!part) {
    res.status(404).json({ error: "Part not found" });
    return;
  }
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.partId, partId))
    .orderBy(documentsTable.uploadedAt);
  res.json(docs.map(toDocumentDto));
});

router.post(
  "/bom/parts/:partId/documents",
  uploadMiddleware,
  async (req, res): Promise<void> => {
    const partId = parseIntParam(req.params.partId);
    if (partId === null) {
      res.status(400).json({ error: "Invalid part id" });
      return;
    }
    const [part] = await db
      .select()
      .from(bomPartsTable)
      .where(eq(bomPartsTable.id, partId));
    if (!part) {
      res.status(404).json({ error: "Part not found" });
      return;
    }
    const file = req.file;
    if (!file) {
      res
        .status(400)
        .json({ error: "No file provided. Attach a file in the 'file' field." });
      return;
    }

    const originalName = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const ext = path.extname(originalName).toLowerCase();
    // Validate by content, not just filename: PDFs start with "%PDF-".
    const isPdf =
      ext === ".pdf" && file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    if (!isPdf) {
      res.status(400).json({
        error: "Only PDF files can be attached to a part line.",
      });
      return;
    }

    const service = new ObjectStorageService();
    let privateDir = service.getPrivateObjectDir();
    if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);
    const storageKey = `${privateDir}/documents/part-${partId}/${randomUUID()}${ext}`;

    const gcsFile = storageFile(storageKey);
    await gcsFile.save(file.buffer, {
      contentType: "application/pdf",
      resumable: false,
    });

    let doc: typeof documentsTable.$inferSelect;
    try {
      [doc] = await db
        .insert(documentsTable)
        .values({
          partId,
          filename: originalName,
          category: "mtr",
          mimeType: "application/pdf",
          sizeBytes: file.size,
          storageKey,
        })
        .returning();
    } catch (err) {
      // Don't leave an orphaned object if the DB insert fails
      // (e.g. the part was deleted while the upload was in flight).
      await deleteStoredObject(storageKey);
      throw err;
    }

    req.log.info(
      { documentId: doc.id, partId, storageKey },
      "part document uploaded",
    );
    res.status(201).json(toDocumentDto(doc));
  },
);

router.get(
  "/documents/:documentId/download",
  async (req, res): Promise<void> => {
    const documentId = parseIntParam(req.params.documentId);
    if (documentId === null) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(eq(documentsTable.id, documentId));
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
      req.log.error({ err, documentId }, "document download stream error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to download file" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  },
);

router.delete("/documents/:documentId", async (req, res): Promise<void> => {
  const documentId = parseIntParam(req.params.documentId);
  if (documentId === null) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, documentId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const deleted = await deleteStoredObject(doc.storageKey);
  if (!deleted) {
    req.log.warn(
      { documentId, storageKey: doc.storageKey },
      "failed to delete stored object; removing record anyway",
    );
  }
  await db.delete(documentsTable).where(eq(documentsTable.id, documentId));
  res.status(204).send();
});

export default router;
