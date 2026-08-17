import { Router, type IRouter } from "express";
import PDFDocument from "pdfkit";
import { db } from "@workspace/db";
import {
  jobsTable,
  usersTable,
  companiesTable,
  customersTable,
  bomAssembliesTable,
  shipmentsTable,
  shipmentAssembliesTable,
  shipmentNotificationsTable,
  loadConfirmationsTable,
  drawingsTable,
  drawingRevisionsTable,
  type ShipmentRow,
  type Job,
} from "@workspace/db";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  CreateShipmentBody,
  CreateShipmentNotificationBody,
  CreateLoadConfirmationBody,
} from "@workspace/api-zod";
import { parseIntParam } from "../lib/params";
import { requireAuth } from "../middlewares/auth";
import { isReadyToShip, SHIPPED_STAGE, INSPECTED_STAGE } from "../services/production";
import { buildHeatSheetEntries, type HeatSheetEntry } from "./inventory";

const router: IRouter = Router();

/** A hard-gate violation surfaced to the client as a 409. */
class GateError extends Error {}

async function loadCompanyJob(jobId: number, companyId: number) {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.companyId, companyId)));
  return job ?? null;
}

/** Load a shipment plus its job, verifying company ownership. */
async function loadShipment(shipmentId: number, companyId: number) {
  const [row] = await db
    .select({ shipment: shipmentsTable, job: jobsTable })
    .from(shipmentsTable)
    .innerJoin(jobsTable, eq(shipmentsTable.jobId, jobsTable.id))
    .where(
      and(eq(shipmentsTable.id, shipmentId), eq(jobsTable.companyId, companyId)),
    );
  return row ?? null;
}

async function shipmentViews(shipments: ShipmentRow[]) {
  if (shipments.length === 0) return [];
  const ids = shipments.map((s) => s.id);
  const [links, notifications, confirmations] = await Promise.all([
    db
      .select({
        shipmentId: shipmentAssembliesTable.shipmentId,
        asm: bomAssembliesTable,
      })
      .from(shipmentAssembliesTable)
      .innerJoin(
        bomAssembliesTable,
        eq(shipmentAssembliesTable.assemblyId, bomAssembliesTable.id),
      )
      .where(inArray(shipmentAssembliesTable.shipmentId, ids))
      .orderBy(asc(bomAssembliesTable.sortIndex)),
    db
      .select()
      .from(shipmentNotificationsTable)
      .where(inArray(shipmentNotificationsTable.shipmentId, ids)),
    db
      .select()
      .from(loadConfirmationsTable)
      .where(inArray(loadConfirmationsTable.shipmentId, ids)),
  ]);
  const notifierIds = [
    ...new Set(notifications.map((n) => n.notifiedBy).filter((v): v is number => v !== null)),
  ];
  const notifiers = notifierIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.id, notifierIds))
    : [];
  const nameMap = new Map(notifiers.map((u) => [u.id, u.name]));
  const notifMap = new Map(notifications.map((n) => [n.shipmentId, n]));
  const confMap = new Map(confirmations.map((c) => [c.shipmentId, c]));

  return shipments.map((s) => {
    const notif = notifMap.get(s.id) ?? null;
    const conf = confMap.get(s.id) ?? null;
    return {
      id: s.id,
      jobId: s.jobId,
      shipperNumber: s.shipperNumber,
      carrier: s.carrier,
      pickupInfo: s.pickupInfo,
      notes: s.notes,
      status: s.status,
      departedAt: s.departedAt?.toISOString() ?? null,
      assemblies: links
        .filter((l) => l.shipmentId === s.id)
        .map(({ asm }) => ({
          assemblyId: asm.id,
          mark: asm.mark,
          quantity: asm.quantity,
          description: asm.description,
          currentStage: asm.currentStage,
          onHold: asm.onHold,
          readyToShip: isReadyToShip(asm),
        })),
      notification: notif
        ? {
            id: notif.id,
            proposedShipDate: notif.proposedShipDate,
            carrier: notif.carrier,
            notes: notif.notes,
            notifiedByName:
              notif.notifiedBy !== null ? (nameMap.get(notif.notifiedBy) ?? null) : null,
            createdAt: notif.createdAt.toISOString(),
          }
        : null,
      loadConfirmation: conf
        ? {
            id: conf.id,
            signedBy: conf.signedBy,
            signedAt: conf.signedAt.toISOString(),
            discrepancyNotes: conf.discrepancyNotes,
          }
        : null,
      paperworkReady: notif !== null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  });
}

async function shipmentView(s: ShipmentRow) {
  const [view] = await shipmentViews([s]);
  return view;
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------

router.get("/jobs/:jobId/shipments", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const job = await loadCompanyJob(jobId, companyId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const rows = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.jobId, job.id))
    .orderBy(desc(shipmentsTable.createdAt));
  res.json(await shipmentViews(rows));
});

router.post("/jobs/:jobId/shipments", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const jobId = parseIntParam(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
  const job = await loadCompanyJob(jobId, companyId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const parsed = CreateShipmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const assemblyIds = [...new Set(body.assemblyIds)];
  const assemblies = await db
    .select()
    .from(bomAssembliesTable)
    .where(
      and(
        inArray(bomAssembliesTable.id, assemblyIds),
        eq(bomAssembliesTable.jobId, job.id),
      ),
    );
  if (assemblies.length !== assemblyIds.length) {
    res.status(400).json({ error: "One or more assemblies do not belong to this job." });
    return;
  }
  // Hard gate: every assembly must be Ready to Ship (Inspected, not on hold).
  const notReady = assemblies.filter((a) => !isReadyToShip(a));
  if (notReady.length > 0) {
    res.status(409).json({
      error: `Not Ready to Ship (must be Inspected and not on hold): ${notReady
        .map((a) => a.mark)
        .join(", ")}`,
    });
    return;
  }
  // An assembly can only be on one shipment.
  const existingLinks = await db
    .select({
      assemblyId: shipmentAssembliesTable.assemblyId,
      mark: bomAssembliesTable.mark,
    })
    .from(shipmentAssembliesTable)
    .innerJoin(
      bomAssembliesTable,
      eq(shipmentAssembliesTable.assemblyId, bomAssembliesTable.id),
    )
    .where(inArray(shipmentAssembliesTable.assemblyId, assemblyIds));
  if (existingLinks.length > 0) {
    res.status(409).json({
      error: `Already on a shipment: ${[...new Set(existingLinks.map((l) => l.mark))].join(", ")}`,
    });
    return;
  }
  // Shipper number [job#]-S[NN]
  const existing = await db
    .select({ shipperNumber: shipmentsTable.shipperNumber })
    .from(shipmentsTable)
    .where(eq(shipmentsTable.jobId, job.id));
  let max = 0;
  const re = new RegExp(`^${job.jobNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-S(\\d+)$`, "i");
  for (const s of existing) {
    const m = re.exec(s.shipperNumber.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const shipperNumber = `${job.jobNumber}-S${String(max + 1).padStart(2, "0")}`;

  let created: ShipmentRow;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(shipmentsTable)
        .values({
          jobId: job.id,
          shipperNumber,
          carrier: body.carrier ?? null,
          pickupInfo: body.pickupInfo ?? null,
          notes: body.notes ?? null,
          createdBy: req.auth!.user.id,
        })
        .returning();
      // The unique index on shipment_assemblies.assembly_id enforces the
      // one-shipment-per-assembly invariant even under concurrent requests.
      await tx
        .insert(shipmentAssembliesTable)
        .values(assemblyIds.map((assemblyId) => ({ shipmentId: row.id, assemblyId })));
      return row;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
    if (/shipment_assemblies_assembly_unique|duplicate key/i.test(message + cause)) {
      res.status(409).json({ error: "One or more assemblies were just added to another shipment." });
      return;
    }
    throw err;
  }
  res.status(201).json(await shipmentView(created));
});

router.get("/shipments/:shipmentId", requireAuth, async (req, res): Promise<void> => {
  const shipmentId = parseIntParam(req.params.shipmentId);
  if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
  const owned = await loadShipment(shipmentId, req.auth!.companyId);
  if (!owned) { res.status(404).json({ error: "Shipment not found" }); return; }
  res.json(await shipmentView(owned.shipment));
});

router.delete("/shipments/:shipmentId", requireAuth, async (req, res): Promise<void> => {
  const shipmentId = parseIntParam(req.params.shipmentId);
  if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
  const owned = await loadShipment(shipmentId, req.auth!.companyId);
  if (!owned) { res.status(404).json({ error: "Shipment not found" }); return; }
  if (owned.shipment.status === "departed") {
    res.status(409).json({ error: "A departed shipment cannot be deleted." });
    return;
  }
  await db.delete(shipmentsTable).where(eq(shipmentsTable.id, owned.shipment.id));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Gates: written notification, signed load confirmation, departure
// ---------------------------------------------------------------------------

router.post(
  "/shipments/:shipmentId/notification",
  requireAuth,
  async (req, res): Promise<void> => {
    const shipmentId = parseIntParam(req.params.shipmentId);
    if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
    const owned = await loadShipment(shipmentId, req.auth!.companyId);
    if (!owned) { res.status(404).json({ error: "Shipment not found" }); return; }
    const parsed = CreateShipmentNotificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const [existing] = await db
      .select({ id: shipmentNotificationsTable.id })
      .from(shipmentNotificationsTable)
      .where(eq(shipmentNotificationsTable.shipmentId, owned.shipment.id));
    if (existing) {
      res.status(409).json({ error: "Shipment notification already recorded." });
      return;
    }
    await db.insert(shipmentNotificationsTable).values({
      shipmentId: owned.shipment.id,
      proposedShipDate: parsed.data.proposedShipDate,
      carrier: parsed.data.carrier,
      notes: parsed.data.notes ?? null,
      notifiedBy: req.auth!.user.id,
    });
    res.status(201).json(await shipmentView(owned.shipment));
  },
);

router.post(
  "/shipments/:shipmentId/load-confirmation",
  requireAuth,
  async (req, res): Promise<void> => {
    const shipmentId = parseIntParam(req.params.shipmentId);
    if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
    const owned = await loadShipment(shipmentId, req.auth!.companyId);
    if (!owned) { res.status(404).json({ error: "Shipment not found" }); return; }
    const parsed = CreateLoadConfirmationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const [existing] = await db
      .select({ id: loadConfirmationsTable.id })
      .from(loadConfirmationsTable)
      .where(eq(loadConfirmationsTable.shipmentId, owned.shipment.id));
    if (existing) {
      res.status(409).json({ error: "Load confirmation already recorded." });
      return;
    }
    await db.insert(loadConfirmationsTable).values({
      shipmentId: owned.shipment.id,
      signedBy: parsed.data.signedBy,
      discrepancyNotes: parsed.data.discrepancyNotes ?? null,
    });
    res.status(201).json(await shipmentView(owned.shipment));
  },
);

router.post(
  "/shipments/:shipmentId/depart",
  requireAuth,
  async (req, res): Promise<void> => {
    const shipmentId = parseIntParam(req.params.shipmentId);
    if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
    const owned = await loadShipment(shipmentId, req.auth!.companyId);
    if (!owned) { res.status(404).json({ error: "Shipment not found" }); return; }
    if (owned.shipment.status === "departed") {
      res.status(409).json({ error: "Shipment has already departed." });
      return;
    }
    // Hard gates, revalidated atomically at the moment of departure:
    // written notification + signed load confirmation must exist, and every
    // linked assembly must STILL be Ready to Ship (it may have been put on
    // hold or moved to an earlier stage since the shipment was created).
    let updated: ShipmentRow;
    try {
      updated = await db.transaction(async (tx) => {
        const [notif] = await tx
          .select({ id: shipmentNotificationsTable.id })
          .from(shipmentNotificationsTable)
          .where(eq(shipmentNotificationsTable.shipmentId, owned.shipment.id));
        if (!notif) {
          throw new GateError(
            "A written shipment notification is required before a shipment can depart.",
          );
        }
        const [conf] = await tx
          .select({ id: loadConfirmationsTable.id })
          .from(loadConfirmationsTable)
          .where(eq(loadConfirmationsTable.shipmentId, owned.shipment.id));
        if (!conf) {
          throw new GateError(
            "A signed load confirmation is required before a shipment can depart.",
          );
        }
        // Row-lock the linked assemblies so no concurrent PATCH can regress
        // their stage or place them on hold between validation and the
        // Shipped update.
        const links = await tx
          .select({ asm: bomAssembliesTable })
          .from(shipmentAssembliesTable)
          .innerJoin(
            bomAssembliesTable,
            eq(shipmentAssembliesTable.assemblyId, bomAssembliesTable.id),
          )
          .where(eq(shipmentAssembliesTable.shipmentId, owned.shipment.id))
          .for("update", { of: bomAssembliesTable });
        const notReady = links.filter(({ asm }) => !isReadyToShip(asm));
        if (notReady.length > 0) {
          throw new GateError(
            `Cannot depart — no longer Ready to Ship (must be Inspected and not on hold): ${notReady
              .map(({ asm }) => asm.mark)
              .join(", ")}`,
          );
        }
        const [row] = await tx
          .update(shipmentsTable)
          .set({ status: "departed", departedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(shipmentsTable.id, owned.shipment.id),
              eq(shipmentsTable.status, "planned"),
            ),
          )
          .returning();
        if (!row) throw new GateError("Shipment has already departed.");
        if (links.length > 0) {
          // Conditional update: only rows that are still Inspected and not on
          // hold may transition to Shipped. With the rows locked above, a
          // count mismatch means an invariant violation — abort loudly.
          const shipped = await tx
            .update(bomAssembliesTable)
            .set({ currentStage: SHIPPED_STAGE })
            .where(
              and(
                inArray(bomAssembliesTable.id, links.map((l) => l.asm.id)),
                eq(bomAssembliesTable.currentStage, INSPECTED_STAGE),
                eq(bomAssembliesTable.onHold, false),
              ),
            )
            .returning({ id: bomAssembliesTable.id });
          if (shipped.length !== links.length) {
            throw new GateError(
              "Departure aborted: one or more assemblies are no longer Ready to Ship.",
            );
          }
        }
        return row;
      });
    } catch (err) {
      if (err instanceof GateError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
    req.log.info(
      { shipmentId: updated.id, shipperNumber: updated.shipperNumber },
      "Shipment departed",
    );
    res.json(await shipmentView(updated));
  },
);

// ---------------------------------------------------------------------------
// Paperwork: BOL & packing slip (gated on the shipment notification)
// ---------------------------------------------------------------------------

type PaperworkContext = {
  shipment: ShipmentRow;
  job: Job;
  companyName: string;
  primaryColor: string;
  customerName: string | null;
  carrier: string | null;
  assemblies: {
    mark: string;
    quantity: number;
    description: string | null;
    heatNumbers: string[];
  }[];
  proposedShipDate: string;
};

/**
 * Assemble everything a BOL/packing slip needs, enforcing the paperwork gates:
 * a written shipment notification must exist, and (until departure) every
 * assembly must still be Ready to Ship.
 */
async function paperworkContext(
  shipmentId: number,
  companyId: number,
): Promise<PaperworkContext | { error: string; code: number }> {
  const owned = await loadShipment(shipmentId, companyId);
  if (!owned) return { error: "Shipment not found", code: 404 };
  const { shipment, job } = owned;
  const [notif] = await db
    .select()
    .from(shipmentNotificationsTable)
    .where(eq(shipmentNotificationsTable.shipmentId, shipment.id));
  if (!notif) {
    return {
      error:
        "Shipping paperwork cannot be generated until a written shipment notification is recorded.",
      code: 409,
    };
  }
  const links = await db
    .select({ asm: bomAssembliesTable })
    .from(shipmentAssembliesTable)
    .innerJoin(
      bomAssembliesTable,
      eq(shipmentAssembliesTable.assemblyId, bomAssembliesTable.id),
    )
    .where(eq(shipmentAssembliesTable.shipmentId, shipment.id))
    .orderBy(asc(bomAssembliesTable.sortIndex));
  if (shipment.status !== "departed") {
    const notReady = links.filter(({ asm }) => !isReadyToShip(asm));
    if (notReady.length > 0) {
      return {
        error: `Paperwork blocked — not Ready to Ship: ${notReady
          .map(({ asm }) => asm.mark)
          .join(", ")}`,
        code: 409,
      };
    }
  }
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  const customer = job.customerId
    ? (
        await db
          .select({ name: customersTable.name })
          .from(customersTable)
          .where(eq(customersTable.id, job.customerId))
      )[0]
    : null;

  // Heat numbers cited from the Job Heat Sheet, grouped by assembly mark.
  const heatEntries: HeatSheetEntry[] = await buildHeatSheetEntries(companyId, job.id);
  const heatByMark = new Map<string, Set<string>>();
  for (const e of heatEntries) {
    if (!e.assemblyMark || !e.heatNumber) continue;
    const set = heatByMark.get(e.assemblyMark) ?? new Set<string>();
    set.add(e.heatNumber);
    heatByMark.set(e.assemblyMark, set);
  }

  return {
    shipment,
    job,
    companyName: company?.name ?? "Shipper",
    primaryColor: company?.primaryColor ?? "#1f2937",
    customerName: customer?.name ?? job.customer ?? null,
    carrier: notif.carrier || shipment.carrier,
    proposedShipDate: notif.proposedShipDate,
    assemblies: links.map(({ asm }) => ({
      mark: asm.mark,
      quantity: asm.quantity,
      description: asm.description,
      heatNumbers: [...(heatByMark.get(asm.mark) ?? [])].sort(),
    })),
  };
}

function paperworkPdf(
  res: import("express").Response,
  ctx: PaperworkContext,
  kind: "BILL OF LADING" | "PACKING SLIP",
) {
  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const filename = `${kind === "BILL OF LADING" ? "bol" : "packing-slip"}-${ctx.shipment.shipperNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  doc.pipe(res);

  const left = 54;
  const right = doc.page.width - 54;

  // Branded header
  doc.rect(0, 0, doc.page.width, 90).fill(ctx.primaryColor);
  doc.fill("#ffffff").font("Helvetica-Bold").fontSize(20).text(ctx.companyName, left, 26);
  doc.font("Helvetica").fontSize(12).text(kind, left, 56);
  doc
    .fontSize(11)
    .text(`Shipper ${ctx.shipment.shipperNumber}`, right - 220, 30, { width: 220, align: "right" })
    .fontSize(10)
    .text(
      new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      right - 220,
      50,
      { width: 220, align: "right" },
    );
  doc.fill("#111111");
  doc.y = 112;
  doc.x = left;

  // Shipment metadata
  doc.font("Helvetica-Bold").fontSize(12).text(`Job ${ctx.job.jobNumber} — ${ctx.job.name}`);
  doc.font("Helvetica").fontSize(10).fillColor("#444444");
  if (ctx.customerName) doc.text(`Consignee: ${ctx.customerName}`);
  doc.text(`Carrier: ${ctx.carrier ?? "TBD"}`);
  doc.text(`Proposed ship date: ${ctx.proposedShipDate}`);
  if (ctx.shipment.pickupInfo) doc.text(`Pickup: ${ctx.shipment.pickupInfo}`);
  if (ctx.shipment.status === "departed" && ctx.shipment.departedAt) {
    doc.text(`Departed: ${ctx.shipment.departedAt.toLocaleString("en-US")}`);
  }
  doc.fillColor("#111111").moveDown(1);

  // Assembly table with heat citations
  const cols = { mark: left, qty: left + 90, desc: left + 140, heats: right - 190 };
  function tableHeader() {
    doc.font("Helvetica-Bold").fontSize(9);
    const y = doc.y;
    doc.text("MARK", cols.mark, y);
    doc.text("QTY", cols.qty, y);
    doc.text("DESCRIPTION", cols.desc, y);
    doc.text("HEAT NUMBER(S)", cols.heats, y, { width: right - cols.heats });
    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#999999").lineWidth(0.8).stroke();
    doc.moveDown(0.3);
  }
  tableHeader();
  doc.font("Helvetica").fontSize(9);
  for (const a of ctx.assemblies) {
    const y = doc.y;
    doc.text(a.mark, cols.mark, y, { width: cols.qty - cols.mark - 8 });
    doc.text(String(a.quantity), cols.qty, y, { width: cols.desc - cols.qty - 8 });
    doc.text(a.description ?? "", cols.desc, y, { width: cols.heats - cols.desc - 8 });
    doc.text(a.heatNumbers.length ? a.heatNumbers.join(", ") : "—", cols.heats, y, {
      width: right - cols.heats,
    });
    doc.moveDown(0.35);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#e5e5e5").lineWidth(0.5).stroke();
    doc.moveDown(0.3);
    if (doc.y > doc.page.height - 180) {
      doc.addPage();
      tableHeader();
      doc.font("Helvetica").fontSize(9);
    }
  }

  doc.moveDown(0.5);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#666666")
    .text(
      "Heat numbers are cited from the Job Heat Sheet (assembly → part → receiving record → CMTR).",
      left,
      doc.y,
      { width: right - left },
    );
  doc.fillColor("#111111");

  // Signature blocks
  doc.moveDown(2.5);
  const sigY = Math.min(doc.y, doc.page.height - 120);
  const half = (right - left - 40) / 2;
  doc.moveTo(left, sigY + 24).lineTo(left + half, sigY + 24).strokeColor("#333333").lineWidth(0.8).stroke();
  doc.moveTo(right - half, sigY + 24).lineTo(right, sigY + 24).stroke();
  doc.fontSize(8).fillColor("#444444");
  doc.text(kind === "BILL OF LADING" ? "Shipper signature / date" : "Prepared by / date", left, sigY + 28);
  doc.text(
    kind === "BILL OF LADING" ? "Carrier signature / date" : "Received by / date",
    right - half,
    sigY + 28,
  );
  doc.end();
}

router.get("/shipments/:shipmentId/bol.pdf", requireAuth, async (req, res): Promise<void> => {
  const shipmentId = parseIntParam(req.params.shipmentId);
  if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
  const ctx = await paperworkContext(shipmentId, req.auth!.companyId);
  if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
  paperworkPdf(res, ctx, "BILL OF LADING");
});

router.get(
  "/shipments/:shipmentId/packing-slip.pdf",
  requireAuth,
  async (req, res): Promise<void> => {
    const shipmentId = parseIntParam(req.params.shipmentId);
    if (shipmentId === null) { res.status(400).json({ error: "Invalid shipment id" }); return; }
    const ctx = await paperworkContext(shipmentId, req.auth!.companyId);
    if ("error" in ctx) { res.status(ctx.code).json({ error: ctx.error }); return; }
    paperworkPdf(res, ctx, "PACKING SLIP");
  },
);

// ---------------------------------------------------------------------------
// Job closeout report: As-Built drawings + Job Heat Sheet + shipments
// ---------------------------------------------------------------------------

router.get(
  "/jobs/:jobId/closeout-report.pdf",
  requireAuth,
  async (req, res): Promise<void> => {
    const companyId = req.auth!.companyId;
    const jobId = parseIntParam(req.params.jobId);
    if (jobId === null) { res.status(400).json({ error: "Invalid job id" }); return; }
    const job = await loadCompanyJob(jobId, companyId);
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));
    const drawings = await db
      .select()
      .from(drawingsTable)
      .where(eq(drawingsTable.jobId, job.id))
      .orderBy(asc(drawingsTable.drawingNumber));
    const asBuilt = drawings.length
      ? await db
          .select()
          .from(drawingRevisionsTable)
          .where(
            and(
              inArray(drawingRevisionsTable.drawingId, drawings.map((d) => d.id)),
              eq(drawingRevisionsTable.isActive, true),
              eq(drawingRevisionsTable.status, "as_built_final"),
            ),
          )
      : [];
    const revByDrawing = new Map(asBuilt.map((r) => [r.drawingId, r]));
    const heatEntries = await buildHeatSheetEntries(companyId, job.id);
    const shipments = await db
      .select()
      .from(shipmentsTable)
      .where(eq(shipmentsTable.jobId, job.id))
      .orderBy(asc(shipmentsTable.createdAt));

    const primary = company?.primaryColor ?? "#1f2937";
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="closeout-${job.jobNumber.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
    );
    doc.pipe(res);

    const left = 54;
    const right = doc.page.width - 54;

    doc.rect(0, 0, doc.page.width, 90).fill(primary);
    doc.fill("#ffffff").font("Helvetica-Bold").fontSize(20).text(company?.name ?? "Closeout", left, 26);
    doc.font("Helvetica").fontSize(12).text("JOB CLOSEOUT — MATERIAL TRACEABILITY PACKAGE", left, 56);
    doc
      .fontSize(10)
      .text(
        new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        right - 220,
        60,
        { width: 220, align: "right" },
      );
    doc.fill("#111111");
    doc.y = 112;
    doc.x = left;

    doc.font("Helvetica-Bold").fontSize(13).text(`Job ${job.jobNumber} — ${job.name}`);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#444444")
      .text(`Customer: ${job.customer}`)
      .text(`Job status: ${job.status}`);
    doc.fillColor("#111111").moveDown(1);

    function sectionTitle(title: string) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor(primary).text(title, left);
      doc.fillColor("#111111");
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor("#cccccc").lineWidth(0.7).stroke();
      doc.moveDown(0.6);
    }

    // 1. As-Built drawing package
    sectionTitle("1. As-Built Drawing Package");
    doc.font("Helvetica").fontSize(9);
    if (drawings.length === 0) {
      doc.fillColor("#666666").text("No drawings on this job.").fillColor("#111111");
    } else {
      for (const d of drawings) {
        const rev = revByDrawing.get(d.id);
        doc.text(
          `${d.drawingNumber}${d.description ? ` — ${d.description}` : ""}: ${
            rev ? `As-Built rev ${rev.revisionLabel}` : "NOT yet marked As-Built/Final"
          }`,
          left,
          doc.y,
          { width: right - left },
        );
        if (doc.y > doc.page.height - 120) doc.addPage();
      }
      const missing = drawings.length - asBuilt.length;
      if (missing > 0) {
        doc
          .moveDown(0.4)
          .fillColor("#b45309")
          .text(`⚠ ${missing} drawing(s) do not yet have an As-Built/Final revision.`)
          .fillColor("#111111");
      }
    }
    doc.moveDown(1);

    // 2. Heat traceability
    sectionTitle("2. Heat Traceability (Job Heat Sheet)");
    doc.font("Helvetica").fontSize(8.5);
    if (heatEntries.length === 0) {
      doc.fillColor("#666666").text("No material consumption recorded for this job.").fillColor("#111111");
    } else {
      const cols = {
        asm: left,
        part: left + 70,
        mat: left + 140,
        heat: left + 290,
        vendor: left + 370,
        po: right - 70,
      };
      doc.font("Helvetica-Bold");
      const hy = doc.y;
      doc.text("ASSY", cols.asm, hy);
      doc.text("PART", cols.part, hy);
      doc.text("MATERIAL", cols.mat, hy);
      doc.text("HEAT #", cols.heat, hy);
      doc.text("VENDOR", cols.vendor, hy);
      doc.text("PO #", cols.po, hy, { width: right - cols.po });
      doc.moveDown(0.4);
      doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#999999").lineWidth(0.7).stroke();
      doc.moveDown(0.25);
      doc.font("Helvetica");
      for (const e of heatEntries) {
        const y = doc.y;
        const material = [e.profileType, e.profileSize, e.grade].filter(Boolean).join(" ");
        doc.text(e.assemblyMark ?? "—", cols.asm, y, { width: cols.part - cols.asm - 6 });
        doc.text(e.partMark ?? "—", cols.part, y, { width: cols.mat - cols.part - 6 });
        doc.text(material || "—", cols.mat, y, { width: cols.heat - cols.mat - 6 });
        doc.text(e.heatNumber ?? "—", cols.heat, y, { width: cols.vendor - cols.heat - 6 });
        doc.text(e.vendorName ?? "—", cols.vendor, y, { width: cols.po - cols.vendor - 6 });
        doc.text(e.poNumber ?? "—", cols.po, y, { width: right - cols.po });
        doc.moveDown(0.55);
        if (doc.y > doc.page.height - 100) doc.addPage();
      }
    }
    doc.moveDown(1);

    // 3. Shipments
    sectionTitle("3. Shipments");
    doc.font("Helvetica").fontSize(9);
    if (shipments.length === 0) {
      doc.fillColor("#666666").text("No shipments recorded for this job.").fillColor("#111111");
    } else {
      for (const s of shipments) {
        doc.text(
          `${s.shipperNumber} — ${s.status === "departed" ? `departed ${s.departedAt?.toLocaleDateString("en-US") ?? ""}` : "planned"}${s.carrier ? ` via ${s.carrier}` : ""}`,
          left,
          doc.y,
          { width: right - left },
        );
        if (doc.y > doc.page.height - 100) doc.addPage();
      }
    }

    doc.moveDown(1.5);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666666")
      .text(
        "Generated automatically from the As-Built drawing register, the Job Heat Sheet (assembly → part → receiving record → CMTR), and shipment records.",
        left,
        doc.y,
        { width: right - left },
      );
    doc.end();
  },
);

export default router;
