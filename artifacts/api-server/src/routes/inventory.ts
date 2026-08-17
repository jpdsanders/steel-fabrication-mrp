import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  jobsTable,
  usersTable,
  documentsTable,
  vendorsTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  bomPartsTable,
  bomAssembliesTable,
  receivingRecordsTable,
  receivingLinesTable,
  inventoryItemsTable,
  materialMovementsTable,
  type InventoryItemRow,
  type ReceivingRecordRow,
  type ReceivingLineRow,
} from "@workspace/db";
import { eq, and, or, inArray, desc, asc, gte, lt, ne, sql } from "drizzle-orm";
import {
  CreateReceivingRecordBody,
  CreateInventoryItemBody,
  ConsumeInventoryItemBody,
  TransferInventoryItemBody,
  CommitInventoryItemBody,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Load a PO and verify its job belongs to the caller's company. */
async function loadPo(poId: number, companyId: number) {
  const [row] = await db
    .select({
      po: purchaseOrdersTable,
      jobId: jobsTable.id,
      jobNumber: jobsTable.jobNumber,
    })
    .from(purchaseOrdersTable)
    .innerJoin(jobsTable, eq(purchaseOrdersTable.jobId, jobsTable.id))
    .where(and(eq(purchaseOrdersTable.id, poId), eq(jobsTable.companyId, companyId)));
  return row ?? null;
}

async function loadCompanyJob(jobId: number, companyId: number) {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  return job ?? null;
}

/**
 * Verify a document is a valid CMTR for a receipt: it must be an `mtr`-category
 * document attached to the PO's own job — not just any company document.
 */
async function validCmtrForJob(documentId: number, jobId: number): Promise<boolean> {
  const rows = await db
    .select({ id: documentsTable.id })
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, documentId),
        eq(documentsTable.jobId, jobId),
        eq(documentsTable.category, "mtr"),
      ),
    );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Traceability lookups: receiving line → record → PO → vendor + CMTR filename
// ---------------------------------------------------------------------------

type TraceInfo = {
  heatNumber: string;
  cmtrDocumentId: number;
  cmtrFilename: string | null;
  poNumber: string | null;
  vendorName: string | null;
  /** Job the material was originally received against. */
  originalJobId: number | null;
  originalJobNumber: string | null;
};

async function traceByReceivingLineIds(ids: number[]): Promise<Map<number, TraceInfo>> {
  const map = new Map<number, TraceInfo>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      lineId: receivingLinesTable.id,
      heatNumber: receivingLinesTable.heatNumber,
      cmtrDocumentId: receivingLinesTable.cmtrDocumentId,
      cmtrFilename: documentsTable.filename,
      poNumber: purchaseOrdersTable.poNumber,
      vendorId: purchaseOrdersTable.vendorId,
      vendorName: vendorsTable.name,
      originalJobId: jobsTable.id,
      originalJobNumber: jobsTable.jobNumber,
    })
    .from(receivingLinesTable)
    .innerJoin(
      receivingRecordsTable,
      eq(receivingLinesTable.receivingRecordId, receivingRecordsTable.id),
    )
    .innerJoin(
      purchaseOrdersTable,
      eq(receivingRecordsTable.purchaseOrderId, purchaseOrdersTable.id),
    )
    .innerJoin(jobsTable, eq(purchaseOrdersTable.jobId, jobsTable.id))
    .leftJoin(documentsTable, eq(receivingLinesTable.cmtrDocumentId, documentsTable.id))
    .leftJoin(vendorsTable, eq(purchaseOrdersTable.vendorId, vendorsTable.id))
    .where(inArray(receivingLinesTable.id, ids));
  for (const r of rows) {
    map.set(r.lineId, {
      heatNumber: r.heatNumber,
      cmtrDocumentId: r.cmtrDocumentId,
      cmtrFilename: r.cmtrFilename ?? null,
      poNumber: r.poNumber,
      vendorName: r.vendorName ?? null,
      originalJobId: r.originalJobId,
      originalJobNumber: r.originalJobNumber,
    });
  }
  return map;
}

async function inventoryItemViews(items: InventoryItemRow[]) {
  const traceMap = await traceByReceivingLineIds(
    [...new Set(items.map((i) => i.receivingLineId).filter((v): v is number => v !== null))],
  );
  // Collect all relevant job ids (source + committed)
  const allJobIds = [
    ...new Set([
      ...items.map((i) => i.sourceJobId).filter((v): v is number => v !== null),
      ...items.map((i) => i.committedJobId).filter((v): v is number => v !== null),
    ]),
  ];
  const jobs = allJobIds.length
    ? await db
        .select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber })
        .from(jobsTable)
        .where(inArray(jobsTable.id, allJobIds))
    : [];
  const jobMap = new Map(jobs.map((j) => [j.id, j.jobNumber]));
  return items.map((i) => {
    const trace = i.receivingLineId !== null ? traceMap.get(i.receivingLineId) : undefined;
    return {
      id: i.id,
      profileType: i.profileType,
      profileSize: i.profileSize,
      grade: i.grade,
      quantity: i.quantity,
      lengthIn: i.lengthIn,
      sourceJobId: i.sourceJobId,
      sourceJobNumber: i.sourceJobId !== null ? (jobMap.get(i.sourceJobId) ?? null) : null,
      receivingLineId: i.receivingLineId,
      heatNumber: trace?.heatNumber ?? null,
      poNumber: trace?.poNumber ?? null,
      vendorName: trace?.vendorName ?? null,
      cmtrDocumentId: trace?.cmtrDocumentId ?? null,
      isRemnant: i.isRemnant,
      status: i.status,
      committedJobId: i.committedJobId ?? null,
      committedJobNumber: i.committedJobId !== null ? (jobMap.get(i.committedJobId) ?? null) : null,
      unitCost: i.unitCost,
      notes: i.notes,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  });
}

async function inventoryItemView(item: InventoryItemRow) {
  const [view] = await inventoryItemViews([item]);
  return view;
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

async function receivingRecordView(record: ReceivingRecordRow, poNumber: string | null) {
  const lines: ReceivingLineRow[] = await db
    .select()
    .from(receivingLinesTable)
    .where(eq(receivingLinesTable.receivingRecordId, record.id))
    .orderBy(asc(receivingLinesTable.id));
  const docIds = [...new Set(lines.map((l) => l.cmtrDocumentId))];
  const docs = docIds.length
    ? await db
        .select({ id: documentsTable.id, filename: documentsTable.filename })
        .from(documentsTable)
        .where(inArray(documentsTable.id, docIds))
    : [];
  const docMap = new Map(docs.map((d) => [d.id, d.filename]));
  const invItems = lines.length
    ? await db
        .select({ id: inventoryItemsTable.id, receivingLineId: inventoryItemsTable.receivingLineId })
        .from(inventoryItemsTable)
        .where(
          and(
            inArray(inventoryItemsTable.receivingLineId, lines.map((l) => l.id)),
            eq(inventoryItemsTable.isRemnant, false),
          ),
        )
    : [];
  const invMap = new Map(invItems.map((i) => [i.receivingLineId, i.id]));
  let receivedByName: string | null = null;
  if (record.receivedByUserId !== null) {
    const [u] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, record.receivedByUserId));
    receivedByName = u?.name ?? null;
  }
  return {
    id: record.id,
    purchaseOrderId: record.purchaseOrderId,
    poNumber,
    receivedDate: record.receivedDate,
    receivedByName,
    notes: record.notes,
    lines: lines.map((l) => ({
      id: l.id,
      purchaseOrderLineId: l.purchaseOrderLineId,
      profileType: l.profileType,
      profileSize: l.profileSize,
      grade: l.grade,
      heatNumber: l.heatNumber,
      cmtrDocumentId: l.cmtrDocumentId,
      cmtrFilename: docMap.get(l.cmtrDocumentId) ?? null,
      pieces: l.pieces,
      lengthIn: l.lengthIn,
      unitCost: l.unitCost,
      discrepancyNotes: l.discrepancyNotes,
      inventoryItemId: invMap.get(l.id) ?? null,
    })),
    createdAt: record.createdAt.toISOString(),
  };
}

router.get("/purchase-orders/:poId/receiving", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const found = await loadPo(poId, companyId);
  if (!found) { res.status(404).json({ error: "Purchase order not found" }); return; }
  const records = await db
    .select()
    .from(receivingRecordsTable)
    .where(eq(receivingRecordsTable.purchaseOrderId, poId))
    .orderBy(desc(receivingRecordsTable.receivedDate), desc(receivingRecordsTable.id));
  res.json(await Promise.all(records.map((r) => receivingRecordView(r, found.po.poNumber))));
});

router.post("/purchase-orders/:poId/receiving", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const poId = parseIntParam(req.params.poId);
  if (poId === null) { res.status(400).json({ error: "Invalid purchase order id" }); return; }
  const body = CreateReceivingRecordBody.parse(req.body);
  const found = await loadPo(poId, companyId);
  if (!found) { res.status(404).json({ error: "Purchase order not found" }); return; }
  const po = found.po;

  // Material may only be received against an approved PO — receipts on
  // draft/sent POs could be erased by a later PO deletion.
  if (po.status !== "approved") {
    res.status(409).json({ error: "Material can only be received against an approved purchase order." });
    return;
  }

  // Heat number + CMTR document are mandatory per line — enforce beyond zod.
  for (const line of body.lines) {
    if (!Number.isInteger(line.pieces) || line.pieces <= 0) {
      res.status(400).json({ error: "Received pieces must be a positive whole number." }); return;
    }
    if (!line.heatNumber.trim()) {
      res.status(400).json({ error: "Every received line requires a heat/lot number." }); return;
    }
    if (!(await validCmtrForJob(line.cmtrDocumentId, found.jobId))) {
      res.status(400).json({ error: "CMTR must be a mill-cert (MTR) document uploaded to this PO's job." }); return;
    }
  }

  const poLines = await db
    .select()
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, po.id));
  const poLineMap = new Map(poLines.map((l) => [l.id, l]));
  for (const line of body.lines) {
    if (line.purchaseOrderLineId != null && !poLineMap.has(line.purchaseOrderLineId)) {
      res.status(400).json({ error: "Referenced PO line does not belong to this purchase order." }); return;
    }
  }

  // Atomic: record + lines + inventory items + ledger movements land together
  // or not at all.
  const record = await db.transaction(async (tx) => {
    const [rec] = await tx
      .insert(receivingRecordsTable)
      .values({
        purchaseOrderId: po.id,
        receivedDate: body.receivedDate.toISOString().slice(0, 10),
        receivedByUserId: req.auth!.user.id,
        notes: body.notes?.trim() || null,
      })
      .returning();

    for (const line of body.lines) {
      const poLine = line.purchaseOrderLineId != null ? poLineMap.get(line.purchaseOrderLineId) : undefined;
      const profileType = line.profileType ?? poLine?.profileType ?? null;
      const profileSize = line.profileSize ?? poLine?.profileSize ?? null;
      const grade = line.grade ?? poLine?.grade ?? null;
      const lengthIn = line.lengthIn ?? poLine?.lengthIn ?? null;
      const unitCost = line.unitCost ?? poLine?.unitPrice ?? null;

      const [rl] = await tx
        .insert(receivingLinesTable)
        .values({
          receivingRecordId: rec.id,
          purchaseOrderLineId: line.purchaseOrderLineId ?? null,
          profileType,
          profileSize,
          grade,
          heatNumber: line.heatNumber.trim(),
          cmtrDocumentId: line.cmtrDocumentId,
          pieces: line.pieces,
          lengthIn,
          unitCost,
          discrepancyNotes: line.discrepancyNotes?.trim() || null,
        })
        .returning();

      const [item] = await tx
        .insert(inventoryItemsTable)
        .values({
          companyId,
          profileType,
          profileSize,
          grade,
          quantity: line.pieces,
          lengthIn,
          sourceJobId: po.jobId,
          receivingLineId: rl.id,
          isRemnant: false,
          status: "available",
          unitCost,
        })
        .returning();

      await tx.insert(materialMovementsTable).values({
        companyId,
        movementType: "received",
        inventoryItemId: item.id,
        receivingLineId: rl.id,
        purchaseOrderId: po.id,
        jobId: po.jobId,
        quantity: line.pieces,
        lengthIn,
        totalCost: unitCost !== null ? round2(unitCost * line.pieces) : null,
        createdByUserId: req.auth!.user.id,
      });
    }
    return rec;
  });

  req.log.info({ poId: po.id, recordId: record.id, lines: body.lines.length }, "receiving record created");
  res.status(201).json(await receivingRecordView(record, po.poNumber));
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

router.get("/inventory", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  // Parse query params manually (generated coercion mishandles booleans/enums).
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const jobId = typeof req.query.jobId === "string" ? parseIntParam(req.query.jobId) : null;

  const conditions = [eq(inventoryItemsTable.companyId, companyId)];
  if (status && ["available", "committed", "consumed"].includes(status)) {
    conditions.push(eq(inventoryItemsTable.status, status));
  }
  if (jobId !== null) conditions.push(eq(inventoryItemsTable.sourceJobId, jobId));

  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(...conditions))
    .orderBy(desc(inventoryItemsTable.createdAt));

  let views = await inventoryItemViews(items);
  if (search) {
    views = views.filter((v) =>
      [v.profileType, v.profileSize, v.grade, v.heatNumber, v.poNumber, v.vendorName, v.sourceJobNumber]
        .some((f) => f?.toLowerCase().includes(search)),
    );
  }
  res.json(views);
});

router.post("/inventory", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateInventoryItemBody.parse(req.body);
  if (!Number.isInteger(body.quantity) || body.quantity <= 0) {
    res.status(400).json({ error: "Quantity must be a positive whole number." });
    return;
  }
  if (body.sourceJobId != null) {
    const job = await loadCompanyJob(body.sourceJobId, companyId);
    if (!job) { res.status(400).json({ error: "Unknown job." }); return; }
  }
  // Manual stock also enters the movement ledger so trend/on-hand reports
  // reconcile with inventory items.
  const item = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(inventoryItemsTable)
      .values({
        companyId,
        profileType: body.profileType?.trim() || null,
        profileSize: body.profileSize?.trim() || null,
        grade: body.grade?.trim() || null,
        quantity: body.quantity,
        lengthIn: body.lengthIn ?? null,
        sourceJobId: body.sourceJobId ?? null,
        isRemnant: body.isRemnant ?? false,
        status: "available",
        unitCost: body.unitCost ?? null,
        notes: body.notes?.trim() || null,
      })
      .returning();
    await tx.insert(materialMovementsTable).values({
      companyId,
      movementType: "received",
      inventoryItemId: created.id,
      jobId: created.sourceJobId,
      quantity: created.quantity,
      lengthIn: created.lengthIn,
      totalCost: created.unitCost !== null ? round2(created.unitCost * created.quantity) : null,
      notes: "Manual stock entry",
      createdByUserId: req.auth!.user.id,
    });
    return created;
  });
  res.status(201).json(await inventoryItemView(item));
});

async function loadItem(itemId: number, companyId: number): Promise<InventoryItemRow | null> {
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(and(eq(inventoryItemsTable.id, itemId), eq(inventoryItemsTable.companyId, companyId)));
  return item ?? null;
}

router.post("/inventory/:itemId/consume", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) { res.status(400).json({ error: "Invalid inventory item id" }); return; }
  const body = ConsumeInventoryItemBody.parse(req.body);
  const item = await loadItem(itemId, companyId);
  if (!item) { res.status(404).json({ error: "Inventory item not found" }); return; }
  if (item.status === "consumed") { res.status(409).json({ error: "This inventory item is already fully consumed." }); return; }
  if (body.pieces > item.quantity) {
    res.status(409).json({ error: `Only ${item.quantity} piece(s) on hand.` }); return;
  }
  const job = await loadCompanyJob(body.jobId, companyId);
  if (!job) { res.status(400).json({ error: "Unknown job." }); return; }

  // Committed items are reserved — only the job they're committed to may consume them.
  // Any other job must go through uncommit first.
  if (item.status === "committed" && item.committedJobId !== job.id) {
    res.status(409).json({
      error: "This item is reserved for another job. Uncommit it first before consuming it on a different job.",
    });
    return;
  }

  if (body.bomPartId != null) {
    const rows = await db
      .select({ id: bomPartsTable.id })
      .from(bomPartsTable)
      .innerJoin(bomAssembliesTable, eq(bomPartsTable.assemblyId, bomAssembliesTable.id))
      .where(and(eq(bomPartsTable.id, body.bomPartId), eq(bomAssembliesTable.jobId, job.id)));
    if (rows.length === 0) { res.status(400).json({ error: "BOM part does not belong to this job." }); return; }
  }

  if (!Number.isInteger(body.pieces) || body.pieces <= 0) {
    res.status(400).json({ error: "Consumed pieces must be a positive whole number." });
    return;
  }
  // Heat/CMTR traceability is mandatory on the job heat sheet: only material
  // anchored to a receiving line (heat + mill cert) may be consumed on a job.
  if (item.receivingLineId === null) {
    res.status(409).json({
      error: "This item has no heat/CMTR traceability. Receive it against a purchase order before consuming it on a job.",
    });
    return;
  }

  // Remnant must be a genuine cut-off: strictly shorter than the source piece,
  // and cut from exactly one piece so cost allocation is unambiguous.
  const remnantLen = body.remnantLengthIn != null && body.remnantLengthIn > 0 ? body.remnantLengthIn : null;
  if (remnantLen != null && body.pieces !== 1) {
    res.status(400).json({ error: "A remnant can only be recorded when consuming a single piece." });
    return;
  }
  if (remnantLen != null && item.lengthIn != null && remnantLen >= item.lengthIn) {
    res.status(400).json({ error: "Remnant length must be shorter than the source piece length." });
    return;
  }

  // Atomic consume: conditional decrement inside a transaction so two
  // concurrent consumes can never over-allocate the same pieces.
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(inventoryItemsTable)
      .set({
        quantity: sql`${inventoryItemsTable.quantity} - ${body.pieces}`,
        // Consuming a committed item releases the reservation.
        committedJobId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventoryItemsTable.id, item.id),
          gte(inventoryItemsTable.quantity, body.pieces),
          ne(inventoryItemsTable.status, "consumed"),
        ),
      )
      .returning();
    if (!updated) return null;
    if (updated.quantity === 0) {
      await tx
        .update(inventoryItemsTable)
        .set({ status: "consumed" })
        .where(eq(inventoryItemsTable.id, item.id));
      updated.status = "consumed";
    } else if (updated.status === "committed") {
      // Partial consume of a committed item returns it to available.
      await tx
        .update(inventoryItemsTable)
        .set({ status: "available" })
        .where(eq(inventoryItemsTable.id, item.id));
      updated.status = "available";
    }

    // Value model: the job is charged the NET cost — full consumed pieces
    // minus the proportional value retained by the remnant. The remnant's
    // "received" movement carries zero cost (its value stays in inventory
    // via the reduced consumed cost), so ledger-derived trend balances
    // (pieces & value) reconcile with actual inventory items.
    const remnantValue =
      remnantLen != null && item.unitCost != null && item.lengthIn != null && item.lengthIn > 0
        ? round2(item.unitCost * (remnantLen / item.lengthIn))
        : null;
    const consumedCost =
      item.unitCost !== null
        ? round2(item.unitCost * body.pieces - (remnantValue ?? 0))
        : null;

    await tx.insert(materialMovementsTable).values({
      companyId,
      movementType: "consumed",
      inventoryItemId: item.id,
      receivingLineId: item.receivingLineId,
      jobId: job.id,
      bomPartId: body.bomPartId ?? null,
      quantity: body.pieces,
      lengthIn: item.lengthIn,
      totalCost: consumedCost,
      notes: body.notes?.trim() || null,
      createdByUserId: req.auth!.user.id,
    });

    // Remnant returned to stock: carries the ORIGINAL receiving-line reference
    // (heat/vendor/PO/CMTR) forward — never a new synthetic reference.
    if (remnantLen != null) {
      const [remnant] = await tx
        .insert(inventoryItemsTable)
        .values({
          companyId,
          profileType: item.profileType,
          profileSize: item.profileSize,
          grade: item.grade,
          quantity: 1,
          lengthIn: remnantLen,
          sourceJobId: null, // remnants return to general stock
          receivingLineId: item.receivingLineId,
          isRemnant: true,
          status: "available",
          unitCost: remnantValue,
          notes: `Remnant cut on job ${job.jobNumber}`,
        })
        .returning();
      await tx.insert(materialMovementsTable).values({
        companyId,
        movementType: "received",
        inventoryItemId: remnant.id,
        receivingLineId: item.receivingLineId,
        jobId: null,
        quantity: 1,
        lengthIn: remnantLen,
        // Piece-flow only: the remnant's value is retained in inventory by
        // reducing the consumed cost, so this movement carries zero cost.
        totalCost: remnantValue != null ? 0 : null,
        notes: `Remnant returned to stock from job ${job.jobNumber} (value retained via net consumed cost)`,
        createdByUserId: req.auth!.user.id,
      });
    }
    return updated;
  });

  if (!result) {
    res.status(409).json({ error: "Not enough pieces on hand — the item may have just been consumed." });
    return;
  }

  req.log.info({ itemId: item.id, jobId: job.id, pieces: body.pieces }, "inventory consumed");
  res.json(await inventoryItemView(result));
});

router.post("/inventory/:itemId/transfer", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) { res.status(400).json({ error: "Invalid inventory item id" }); return; }
  const body = TransferInventoryItemBody.parse(req.body);
  const item = await loadItem(itemId, companyId);
  if (!item) { res.status(404).json({ error: "Inventory item not found" }); return; }
  if (item.status === "consumed") { res.status(409).json({ error: "A consumed item cannot be transferred." }); return; }
  if (item.status === "committed") {
    res.status(409).json({
      error: "This item is reserved for a job. Uncommit it before transferring it.",
    });
    return;
  }
  let destJobId: number | null = null;
  if (body.jobId != null) {
    const job = await loadCompanyJob(body.jobId, companyId);
    if (!job) { res.status(400).json({ error: "Unknown job." }); return; }
    destJobId = job.id;
  }
  const [updated] = await db
    .update(inventoryItemsTable)
    .set({ sourceJobId: destJobId, updatedAt: new Date() })
    .where(eq(inventoryItemsTable.id, item.id))
    .returning();
  await db.insert(materialMovementsTable).values({
    companyId,
    movementType: "transferred",
    inventoryItemId: item.id,
    receivingLineId: item.receivingLineId,
    jobId: destJobId,
    quantity: item.quantity,
    lengthIn: item.lengthIn,
    totalCost: item.unitCost !== null ? round2(item.unitCost * item.quantity) : null,
    notes: body.notes?.trim() || null,
    createdByUserId: req.auth!.user.id,
  });
  res.json(await inventoryItemView(updated));
});

// ---------------------------------------------------------------------------
// Commit / Uncommit
// ---------------------------------------------------------------------------

router.post("/inventory/:itemId/commit", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) { res.status(400).json({ error: "Invalid inventory item id" }); return; }
  const body = CommitInventoryItemBody.parse(req.body);
  const item = await loadItem(itemId, companyId);
  if (!item) { res.status(404).json({ error: "Inventory item not found" }); return; }
  if (item.status === "consumed") {
    res.status(409).json({ error: "A consumed item cannot be committed." }); return;
  }
  if (item.status === "committed" && item.committedJobId !== body.jobId) {
    res.status(409).json({ error: "This item is already committed to a different job. Uncommit it first." }); return;
  }
  const job = await loadCompanyJob(body.jobId, companyId);
  if (!job) { res.status(400).json({ error: "Unknown job." }); return; }

  // Optimistic lock: the WHERE clause restricts the UPDATE to rows that are
  // either (a) available — the normal path — or (b) already committed to THIS
  // same job, which preserves idempotency for retry/double-submit from the
  // same PM. A concurrent request from a DIFFERENT job sees the row in state
  // (committed, otherJobId) after the first writer wins, matches neither
  // branch, and receives a 409 instead of silently overwriting the reservation.
  const [updated] = await db
    .update(inventoryItemsTable)
    .set({ status: "committed", committedJobId: job.id, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryItemsTable.id, item.id),
        or(
          eq(inventoryItemsTable.status, "available"),
          and(
            eq(inventoryItemsTable.status, "committed"),
            eq(inventoryItemsTable.committedJobId, job.id),
          ),
        ),
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "This item was already committed by another request. Refresh and try again." });
    return;
  }

  req.log.info({ itemId: item.id, jobId: job.id }, "inventory item committed");
  res.json(await inventoryItemView(updated));
});

router.post("/inventory/:itemId/uncommit", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const itemId = parseIntParam(req.params.itemId);
  if (itemId === null) { res.status(400).json({ error: "Invalid inventory item id" }); return; }
  const item = await loadItem(itemId, companyId);
  if (!item) { res.status(404).json({ error: "Inventory item not found" }); return; }
  if (item.status !== "committed") {
    res.status(409).json({ error: "This item is not committed." }); return;
  }
  // Optimistic lock: include status = "committed" in the WHERE clause so that
  // only one concurrent uncommit request wins. If a second request races past
  // the status check above and reaches the UPDATE after the first writer has
  // already flipped the row to "available", the WHERE predicate matches nothing
  // and `updated` is undefined — the loser gets a 409 instead of silently
  // no-op'ing or returning stale data.
  const [updated] = await db
    .update(inventoryItemsTable)
    .set({ status: "available", committedJobId: null, updatedAt: new Date() })
    .where(and(eq(inventoryItemsTable.id, item.id), eq(inventoryItemsTable.status, "committed")))
    .returning();

  if (!updated) {
    res.status(409).json({ error: "This item is not committed." });
    return;
  }

  req.log.info({ itemId: item.id }, "inventory item uncommitted");
  res.json(await inventoryItemView(updated));
});

// ---------------------------------------------------------------------------
// Job Heat Sheet
// ---------------------------------------------------------------------------

export interface HeatSheetEntry {
  movementId: number;
  assemblyMark: string | null;
  partMark: string | null;
  profileType: string | null;
  profileSize: string | null;
  grade: string | null;
  pieces: number;
  lengthIn: number | null;
  heatNumber: string | null;
  vendorName: string | null;
  poNumber: string | null;
  cmtrDocumentId: number | null;
  cmtrFilename: string | null;
  originalJobNumber: string | null;
  isRemnant: boolean;
  totalCost: number | null;
  consumedAt: string;
}

/**
 * Job Heat Sheet entries — the traceability bridge (assembly → part →
 * receiving line → CMTR). Shared by the heat-sheet endpoint, shipping
 * paperwork (BOL/packing slip heat citations), and the closeout report.
 */
export async function buildHeatSheetEntries(
  companyId: number,
  jobId: number,
): Promise<HeatSheetEntry[]> {
  const movements = await db
    .select({
      movement: materialMovementsTable,
      item: inventoryItemsTable,
      partMark: bomPartsTable.partMark,
      assemblyMark: bomAssembliesTable.mark,
    })
    .from(materialMovementsTable)
    .leftJoin(inventoryItemsTable, eq(materialMovementsTable.inventoryItemId, inventoryItemsTable.id))
    .leftJoin(bomPartsTable, eq(materialMovementsTable.bomPartId, bomPartsTable.id))
    .leftJoin(bomAssembliesTable, eq(bomPartsTable.assemblyId, bomAssembliesTable.id))
    .where(
      and(
        eq(materialMovementsTable.companyId, companyId),
        eq(materialMovementsTable.movementType, "consumed"),
        eq(materialMovementsTable.jobId, jobId),
      ),
    )
    .orderBy(desc(materialMovementsTable.occurredAt));

  const traceMap = await traceByReceivingLineIds(
    [...new Set(movements.map((m) => m.movement.receivingLineId).filter((v): v is number => v !== null))],
  );

  return movements.map(({ movement, item, partMark, assemblyMark }) => {
    const trace = movement.receivingLineId !== null ? traceMap.get(movement.receivingLineId) : undefined;
    return {
      movementId: movement.id,
      assemblyMark: assemblyMark ?? null,
      partMark: partMark ?? null,
      profileType: item?.profileType ?? null,
      profileSize: item?.profileSize ?? null,
      grade: item?.grade ?? null,
      pieces: movement.quantity,
      lengthIn: movement.lengthIn,
      heatNumber: trace?.heatNumber ?? null,
      vendorName: trace?.vendorName ?? null,
      poNumber: trace?.poNumber ?? null,
      cmtrDocumentId: trace?.cmtrDocumentId ?? null,
      cmtrFilename: trace?.cmtrFilename ?? null,
      originalJobNumber:
        trace && trace.originalJobId !== null && trace.originalJobId !== jobId
          ? trace.originalJobNumber
          : null,
      isRemnant: item?.isRemnant ?? false,
      totalCost: movement.totalCost,
      consumedAt: movement.occurredAt.toISOString(),
    };
  });
}

router.get("/jobs/:jobId/heat-sheet", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const job = await loadCompanyJob(jobId, companyId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const entries = await buildHeatSheetEntries(companyId, job.id);
  res.json({ jobId: job.id, jobNumber: job.jobNumber, jobName: job.name, entries });
});

// ---------------------------------------------------------------------------
// Stock check at BOM/PO-creation time
// ---------------------------------------------------------------------------

const matKey = (t: string | null, s: string | null, g: string | null) =>
  [t, s, g].map((v) => (v ?? "").trim().toLowerCase()).join("|");

router.get("/jobs/:jobId/stock-matches", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const job = await loadCompanyJob(jobId, companyId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  // Roll up the job's BOM needs by material.
  const parts = await db
    .select({
      profileType: bomPartsTable.profileType,
      profileSize: bomPartsTable.profileSize,
      grade: bomPartsTable.grade,
      quantity: bomPartsTable.quantity,
      lengthIn: bomPartsTable.lengthIn,
      assemblyQty: bomAssembliesTable.quantity,
    })
    .from(bomPartsTable)
    .innerJoin(bomAssembliesTable, eq(bomPartsTable.assemblyId, bomAssembliesTable.id))
    .where(eq(bomAssembliesTable.jobId, job.id));

  type Need = {
    profileType: string | null; profileSize: string | null; grade: string | null;
    neededPieces: number; neededLengthIn: number;
  };
  const needs = new Map<string, Need>();
  for (const p of parts) {
    if (!p.profileType && !p.profileSize) continue;
    const key = matKey(p.profileType, p.profileSize, p.grade);
    const pieces = p.quantity * p.assemblyQty;
    const existing = needs.get(key) ?? {
      profileType: p.profileType, profileSize: p.profileSize, grade: p.grade,
      neededPieces: 0, neededLengthIn: 0,
    };
    existing.neededPieces += pieces;
    existing.neededLengthIn += (p.lengthIn ?? 0) * pieces;
    needs.set(key, existing);
  }
  if (needs.size === 0) { res.json([]); return; }

  const stock = await db
    .select()
    .from(inventoryItemsTable)
    .where(
      and(
        eq(inventoryItemsTable.companyId, companyId),
        eq(inventoryItemsTable.status, "available"),
      ),
    );
  const traceMap = await traceByReceivingLineIds(
    [...new Set(stock.map((i) => i.receivingLineId).filter((v): v is number => v !== null))],
  );
  const jobIds = [...new Set(stock.map((i) => i.sourceJobId).filter((v): v is number => v !== null))];
  const jobs = jobIds.length
    ? await db.select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber }).from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const jobMap = new Map(jobs.map((j) => [j.id, j.jobNumber]));

  const result = [...needs.values()].map((need) => {
    const items = stock.filter(
      (i) => matKey(i.profileType, i.profileSize, i.grade) === matKey(need.profileType, need.profileSize, need.grade),
    );
    return {
      profileType: need.profileType,
      profileSize: need.profileSize,
      grade: need.grade,
      neededPieces: need.neededPieces,
      neededLengthIn: need.neededLengthIn > 0 ? need.neededLengthIn : null,
      availablePieces: items.reduce((s, i) => s + i.quantity, 0),
      items: items.map((i) => {
        const trace = i.receivingLineId !== null ? traceMap.get(i.receivingLineId) : undefined;
        return {
          id: i.id,
          quantity: i.quantity,
          lengthIn: i.lengthIn,
          heatNumber: trace?.heatNumber ?? null,
          sourceJobNumber: i.sourceJobId !== null ? (jobMap.get(i.sourceJobId) ?? null) : null,
          isRemnant: i.isRemnant,
          status: i.status,
          unitCost: i.unitCost,
        };
      }),
    };
  });
  // Materials with stock first
  result.sort((a, b) => (b.availablePieces > 0 ? 1 : 0) - (a.availablePieces > 0 ? 1 : 0));
  res.json(result);
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

router.get("/reports/material-movements", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const month = typeof req.query.month === "string" ? req.query.month : "";
  if (!/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

  const rows = await db
    .select({
      movement: materialMovementsTable,
      item: inventoryItemsTable,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.name,
      poNumber: purchaseOrdersTable.poNumber,
      heatNumber: receivingLinesTable.heatNumber,
    })
    .from(materialMovementsTable)
    .leftJoin(inventoryItemsTable, eq(materialMovementsTable.inventoryItemId, inventoryItemsTable.id))
    .leftJoin(jobsTable, eq(materialMovementsTable.jobId, jobsTable.id))
    .leftJoin(purchaseOrdersTable, eq(materialMovementsTable.purchaseOrderId, purchaseOrdersTable.id))
    .leftJoin(receivingLinesTable, eq(materialMovementsTable.receivingLineId, receivingLinesTable.id))
    .where(
      and(
        eq(materialMovementsTable.companyId, companyId),
        gte(materialMovementsTable.occurredAt, start),
        lt(materialMovementsTable.occurredAt, end),
      ),
    )
    .orderBy(asc(materialMovementsTable.occurredAt));

  const movements = rows.map((r) => ({
    id: r.movement.id,
    movementType: r.movement.movementType,
    jobId: r.movement.jobId,
    jobNumber: r.jobNumber ?? null,
    poNumber: r.poNumber ?? null,
    profileType: r.item?.profileType ?? null,
    profileSize: r.item?.profileSize ?? null,
    grade: r.item?.grade ?? null,
    heatNumber: r.heatNumber ?? null,
    quantity: r.movement.quantity,
    lengthIn: r.movement.lengthIn,
    totalCost: r.movement.totalCost,
    notes: r.movement.notes,
    occurredAt: r.movement.occurredAt.toISOString(),
  }));

  type JobTotal = { jobId: number | null; jobNumber: string | null; jobName: string | null; receivedCost: number; consumedCost: number; movementCount: number };
  const jobTotals = new Map<string, JobTotal>();
  for (const r of rows) {
    const key = String(r.movement.jobId ?? "none");
    const t = jobTotals.get(key) ?? {
      jobId: r.movement.jobId, jobNumber: r.jobNumber ?? null, jobName: r.jobName ?? null,
      receivedCost: 0, consumedCost: 0, movementCount: 0,
    };
    t.movementCount += 1;
    const cost = r.movement.totalCost ?? 0;
    // "purchased" movements are listed individually but excluded from received
    // totals — otherwise PO approval + receipt double-counts the same material.
    if (r.movement.movementType === "received") t.receivedCost = round2(t.receivedCost + cost);
    if (r.movement.movementType === "consumed") t.consumedCost = round2(t.consumedCost + cost);
    jobTotals.set(key, t);
  }

  res.json({
    month,
    movements,
    jobTotals: [...jobTotals.values()].sort((a, b) => (a.jobNumber ?? "").localeCompare(b.jobNumber ?? "")),
    totalReceivedCost: round2([...jobTotals.values()].reduce((s, t) => s + t.receivedCost, 0)),
    totalConsumedCost: round2([...jobTotals.values()].reduce((s, t) => s + t.consumedCost, 0)),
  });
});

router.get("/reports/inventory-trend", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const monthsParam = typeof req.query.months === "string" ? parseIntParam(req.query.months) : null;
  const months = Math.min(Math.max(monthsParam ?? 12, 1), 36);

  const movements = await db
    .select({
      movementType: materialMovementsTable.movementType,
      quantity: materialMovementsTable.quantity,
      totalCost: materialMovementsTable.totalCost,
      occurredAt: materialMovementsTable.occurredAt,
    })
    .from(materialMovementsTable)
    .where(
      and(
        eq(materialMovementsTable.companyId, companyId),
        ne(materialMovementsTable.movementType, "transferred"),
      ),
    )
    .orderBy(asc(materialMovementsTable.occurredAt));

  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const byMonth = new Map(
    monthKeys.map((m) => [m, { receivedCost: 0, consumedCost: 0, receivedPieces: 0, consumedPieces: 0 }]),
  );
  // Running balances (value/pieces on hand) computed across ALL history so
  // the window starts from the true balance, not zero.
  let runningValue = 0;
  let runningPieces = 0;
  const endOfMonth = new Map<string, { value: number; pieces: number }>();
  for (const m of movements) {
    const key = m.occurredAt.toISOString().slice(0, 7);
    const cost = m.totalCost ?? 0;
    // "purchased" (PO approval) is on-order, not on-hand — only "received"
    // affects inventory balances and received totals.
    if (m.movementType === "received") {
      runningValue += cost; runningPieces += m.quantity;
      const b = byMonth.get(key);
      if (b) { b.receivedCost = round2(b.receivedCost + cost); b.receivedPieces += m.quantity; }
    } else if (m.movementType === "consumed") {
      runningValue -= cost; runningPieces -= m.quantity;
      const b = byMonth.get(key);
      if (b) { b.consumedCost = round2(b.consumedCost + cost); b.consumedPieces += m.quantity; }
    }
    endOfMonth.set(key, { value: round2(runningValue), pieces: runningPieces });
  }

  let lastValue = 0;
  let lastPieces = 0;
  // Seed with balance before the window
  for (const [key, bal] of endOfMonth) {
    if (key < monthKeys[0]) { lastValue = bal.value; lastPieces = bal.pieces; }
  }
  const points = monthKeys.map((key) => {
    const bal = endOfMonth.get(key);
    if (bal) { lastValue = bal.value; lastPieces = bal.pieces; }
    const b = byMonth.get(key)!;
    return {
      month: key,
      receivedCost: b.receivedCost,
      consumedCost: b.consumedCost,
      receivedPieces: b.receivedPieces,
      consumedPieces: b.consumedPieces,
      inventoryValue: lastValue,
      availablePieces: lastPieces,
    };
  });
  res.json(points);
});

export default router;
