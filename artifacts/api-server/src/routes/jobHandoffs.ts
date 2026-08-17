import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  jobHandoffsTable,
  jobHandoffDocumentsTable,
  jobsTable,
  companiesTable,
  documentsTable,
  customersTable,
  drawingRevisionsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";
import { storageFile } from "./documents";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();

const CreateHandoffBody = z.object({
  destinationCompanyId: z.number().int().positive(),
  transmittalRef: z.string().optional(),
  notes: z.string().optional(),
  /** IDs of documents attached to the source job to include in the handoff. */
  documentIds: z.array(z.number().int().positive()).optional(),
  /** Job context for the new job in the destination company. */
  destinationJob: z.object({
    name: z.string().min(1),
    customer: z.string().min(1),
    /** If provided, must be a customer in the *destination* company. */
    customerId: z.number().int().positive().optional(),
    customerPo: z.string().optional(),
    notes: z.string().optional(),
    dueDate: z.string().optional(),
  }),
});

/** GET /jobs/:jobId/handoffs — list handoffs initiated from this job */
router.get("/jobs/:jobId/handoffs", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)))
    .limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const handoffs = await db
    .select()
    .from(jobHandoffsTable)
    .where(eq(jobHandoffsTable.sourceJobId, jobId));

  res.json(handoffs);
});

/** POST /jobs/:jobId/handoffs — push a job to another company, copying documents */
router.post("/jobs/:jobId/handoffs", requireAuth, async (req, res): Promise<void> => {
  const sourceJobId = parseIntParam(req.params.jobId);
  if (sourceJobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }

  const body = CreateHandoffBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.issues }); return; }

  const sourceCompanyId = req.auth!.companyId;

  // Verify source job belongs to caller's company
  const [sourceJob] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, sourceJobId), eq(jobsTable.companyId, sourceCompanyId)))
    .limit(1);
  if (!sourceJob) { res.status(404).json({ error: "Source job not found" }); return; }

  // Destination company must differ from source
  if (body.data.destinationCompanyId === sourceCompanyId) {
    res.status(400).json({ error: "Destination company must differ from source" }); return;
  }
  const [destCompany] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, body.data.destinationCompanyId))
    .limit(1);
  if (!destCompany) { res.status(404).json({ error: "Destination company not found" }); return; }

  // If a destinationCustomerId is supplied, verify it belongs to the destination company
  if (body.data.destinationJob.customerId !== undefined) {
    const [destCustomer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(
        eq(customersTable.id, body.data.destinationJob.customerId),
        eq(customersTable.companyId, body.data.destinationCompanyId),
      ))
      .limit(1);
    if (!destCustomer) {
      res.status(400).json({ error: "destinationJob.customerId does not belong to the destination company" });
      return;
    }
  }

  // Validate and load document records — each must belong to the source job
  const requestedDocIds = body.data.documentIds ?? [];
  let sourceDocs: (typeof documentsTable.$inferSelect)[] = [];
  if (requestedDocIds.length > 0) {
    sourceDocs = await db
      .select()
      .from(documentsTable)
      .where(
        and(
          inArray(documentsTable.id, requestedDocIds),
          eq(documentsTable.jobId, sourceJobId),
        ),
      );
    const foundIds = new Set(sourceDocs.map((d) => d.id));
    const missing = requestedDocIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      res.status(400).json({ error: `Document IDs not found on source job: ${missing.join(", ")}` });
      return;
    }
    // Controlled documents (files backing a drawing revision) must never be
    // copied as ordinary documents — that would bypass the acknowledgment
    // gate on the destination. They stay under the drawing revision workflow.
    const controlledRows = await db
      .select({ documentId: drawingRevisionsTable.documentId })
      .from(drawingRevisionsTable)
      .where(inArray(drawingRevisionsTable.documentId, requestedDocIds));
    if (controlledRows.length > 0) {
      res.status(400).json({
        error: `Documents backing controlled drawing revisions cannot be included in a handoff: ${controlledRows.map((r) => r.documentId).join(", ")}`,
      });
      return;
    }
  }

  // Generate destination job number (per-company max)
  const destJobs = await db
    .select({ jobNumber: jobsTable.jobNumber })
    .from(jobsTable)
    .where(eq(jobsTable.companyId, body.data.destinationCompanyId));
  const maxNum = destJobs.reduce((max, j) => {
    const m = j.jobNumber.match(/(\d+)$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 2000);
  const destJobNumber = `J-${maxNum + 1}`;

  // Copy GCS objects for each source document before starting the transaction
  const service = new ObjectStorageService();
  let privateDir = service.getPrivateObjectDir();
  if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);

  type CopiedDoc = {
    sourceDoc: typeof documentsTable.$inferSelect;
    destStorageKey: string;
  };
  const copiedDocs: CopiedDoc[] = [];
  for (const sourceDoc of sourceDocs) {
    const ext = sourceDoc.filename.includes(".")
      ? "." + sourceDoc.filename.split(".").pop()
      : "";
    const destStorageKey = `${privateDir}/documents/job-handoff-${destJobNumber.replace("J-", "")}/${randomUUID()}${ext}`;
    const srcFile = storageFile(sourceDoc.storageKey);
    const destFile = storageFile(destStorageKey);
    const [srcExists] = await srcFile.exists();
    if (srcExists) {
      await srcFile.copy(destFile);
    }
    copiedDocs.push({ sourceDoc, destStorageKey });
  }

  let result: unknown;
  try {
    result = await db.transaction(async (tx) => {
      // Create the destination job
      const [destJob] = await tx
        .insert(jobsTable)
        .values({
          companyId: body.data.destinationCompanyId,
          jobNumber: destJobNumber,
          name: body.data.destinationJob.name,
          customer: body.data.destinationJob.customer,
          customerId: body.data.destinationJob.customerId,
          customerPo: body.data.destinationJob.customerPo,
          notes: body.data.destinationJob.notes,
          dueDate: body.data.destinationJob.dueDate,
          status: "active",
        })
        .returning();

      // Create the handoff record
      const [handoff] = await tx
        .insert(jobHandoffsTable)
        .values({
          sourceCompanyId,
          sourceJobId,
          destinationCompanyId: body.data.destinationCompanyId,
          destinationJobId: destJob.id,
          transmittalRef: body.data.transmittalRef,
          notes: body.data.notes,
          pushedByUserId: req.auth!.user.id,
        })
        .returning();

      // Create destination document records and link them in the handoff
      const handoffDocValues: { handoffId: number; sourceDocumentId: number; destinationDocumentId: number | null }[] = [];
      for (const { sourceDoc, destStorageKey } of copiedDocs) {
        const [destDoc] = await tx
          .insert(documentsTable)
          .values({
            jobId: destJob.id,
            filename: sourceDoc.filename,
            category: sourceDoc.category,
            mimeType: sourceDoc.mimeType,
            sizeBytes: sourceDoc.sizeBytes,
            storageKey: destStorageKey,
          })
          .returning();
        handoffDocValues.push({
          handoffId: handoff.id,
          sourceDocumentId: sourceDoc.id,
          destinationDocumentId: destDoc.id,
        });
      }
      if (handoffDocValues.length > 0) {
        await tx.insert(jobHandoffDocumentsTable).values(handoffDocValues);
      }

      return { handoff, destJob, documentsCopied: handoffDocValues.length };
    });
  } catch (err) {
    // Clean up any GCS objects we copied before the transaction failed
    await Promise.allSettled(
      copiedDocs.map(({ destStorageKey }) =>
        storageFile(destStorageKey).delete({ ignoreNotFound: true }),
      ),
    );
    throw err;
  }

  req.log.info(
    { sourceJobId, destJobNumber, documentsCopied: copiedDocs.length },
    "job handoff created",
  );
  res.status(201).json(result);
});

export default router;
