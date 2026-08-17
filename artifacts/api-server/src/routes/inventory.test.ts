/**
 * Integration tests for inventory & heat/MTR traceability.
 *
 * Covers the review-critical invariants:
 * 1. Concurrency: an item can never be consumed beyond its on-hand quantity.
 * 2. Reconciliation: the inventory trend (derived from the movement ledger)
 *    matches the actual on-hand inventory items — including manual stock and
 *    remnants.
 * 3. Receiving integrity: heat number and CMTR are mandatory.
 *
 * Runs against the development database with an isolated throwaway company.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompanyRolesTable,
  customersTable,
  jobsTable,
  vendorsTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  documentsTable,
  inventoryItemsTable,
  materialMovementsTable,
  receivingRecordsTable,
  receivingLinesTable,
} from "@workspace/db";
import app from "../app";

const agent = request.agent(app);
const suffix = Date.now().toString(36);
const email = `inv-test-${suffix}@example.com`;
const password = "inv-test-password-1";

let companyId: number;
let userId: number;
let jobAId: number;
let jobBId: number;
let poId: number;
let poLineId: number;
let cmtrDocId: number;

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `Inv Test Co ${suffix}`, slug: `inv-test-${suffix}` })
    .returning();
  companyId = company.id;
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "Inv Tester", passwordHash: await bcrypt.hash(password, 4) })
    .returning();
  userId = user.id;
  await db.insert(userCompanyRolesTable).values({ userId, companyId, role: "admin" });

  const [customer] = await db
    .insert(customersTable)
    .values({ companyId, name: "Inv Test Customer" })
    .returning();
  const [jobA] = await db
    .insert(jobsTable)
    .values({ companyId, customerId: customer.id, customer: "Inv Test Customer", jobNumber: `IT-A-${suffix}`, name: "Inv Test Job A" })
    .returning();
  const [jobB] = await db
    .insert(jobsTable)
    .values({ companyId, customerId: customer.id, customer: "Inv Test Customer", jobNumber: `IT-B-${suffix}`, name: "Inv Test Job B" })
    .returning();
  jobAId = jobA.id;
  jobBId = jobB.id;

  const [vendor] = await db
    .insert(vendorsTable)
    .values({ companyId, name: "Inv Test Vendor", status: "approved" })
    .returning();
  const [po] = await db
    .insert(purchaseOrdersTable)
    .values({ jobId: jobAId, vendorId: vendor.id, poNumber: `IT-PO-${suffix}`, status: "approved" })
    .returning();
  poId = po.id;
  const [poLine] = await db
    .insert(purchaseOrderLinesTable)
    .values({ purchaseOrderId: poId, profileType: "W", profileSize: "W12x26", grade: "A992", pieces: 10, lengthIn: 480, unitPrice: 100 })
    .returning();
  poLineId = poLine.id;

  const [doc] = await db
    .insert(documentsTable)
    .values({ jobId: jobAId, filename: "cmtr-test.pdf", category: "mtr", mimeType: "application/pdf", sizeBytes: 10, storageKey: `test/${suffix}` })
    .returning();
  cmtrDocId = doc.id;

  const login = await agent.post("/api/auth/login").send({ email, password });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  // Movement/receiving/inventory rows cascade or are cleaned explicitly.
  await db.delete(materialMovementsTable).where(eq(materialMovementsTable.companyId, companyId));
  await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.companyId, companyId));
  const recs = await db.select().from(receivingRecordsTable).where(eq(receivingRecordsTable.purchaseOrderId, poId));
  for (const r of recs) await db.delete(receivingLinesTable).where(eq(receivingLinesTable.receivingRecordId, r.id));
  await db.delete(receivingRecordsTable).where(eq(receivingRecordsTable.purchaseOrderId, poId));
  await db.delete(documentsTable).where(eq(documentsTable.id, cmtrDocId));
  await db.delete(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.purchaseOrderId, poId));
  await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  await db.delete(jobsTable).where(eq(jobsTable.companyId, companyId));
  await db.delete(customersTable).where(eq(customersTable.companyId, companyId));
  await db.delete(vendorsTable).where(eq(vendorsTable.companyId, companyId));
  await db.delete(userCompanyRolesTable).where(eq(userCompanyRolesTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("receiving integrity", () => {
  it("rejects receiving against a non-approved PO", async () => {
    const [draftPo] = await db
      .insert(purchaseOrdersTable)
      .values({ jobId: jobAId, poNumber: `IT-PO-D-${suffix}`, status: "draft" })
      .returning();
    const res = await agent.post(`/api/purchase-orders/${draftPo.id}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ heatNumber: "H-1", cmtrDocumentId: cmtrDocId, pieces: 1 }],
    });
    expect(res.status).toBe(409);
    await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, draftPo.id));
  });

  it("rejects fractional pieces", async () => {
    const res = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "H-1", cmtrDocumentId: cmtrDocId, pieces: 1.5 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a blank heat number", async () => {
    const res = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "  ", cmtrDocumentId: cmtrDocId, pieces: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a CMTR document from outside the company", async () => {
    const res = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "H-1", cmtrDocumentId: 999999999, pieces: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-MTR document as CMTR", async () => {
    const [drawing] = await db
      .insert(documentsTable)
      .values({ jobId: jobAId, filename: "drawing.pdf", category: "drawing", mimeType: "application/pdf", sizeBytes: 10, storageKey: `test/dwg-${suffix}` })
      .returning();
    const res = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "H-1", cmtrDocumentId: drawing.id, pieces: 1 }],
    });
    expect(res.status).toBe(400);
    await db.delete(documentsTable).where(eq(documentsTable.id, drawing.id));
  });

  it("rejects an MTR document from a different job", async () => {
    const [otherDoc] = await db
      .insert(documentsTable)
      .values({ jobId: jobBId, filename: "other-mtr.pdf", category: "mtr", mimeType: "application/pdf", sizeBytes: 10, storageKey: `test/other-${suffix}` })
      .returning();
    const res = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "H-1", cmtrDocumentId: otherDoc.id, pieces: 1 }],
    });
    expect(res.status).toBe(400);
    await db.delete(documentsTable).where(eq(documentsTable.id, otherDoc.id));
  });

  it("creates inventory and a received movement on valid receipt", async () => {
    const res = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "HEAT-777", cmtrDocumentId: cmtrDocId, pieces: 10 }],
    });
    expect(res.status).toBe(201);
    const inv = await agent.get("/api/inventory?status=available");
    expect(inv.status).toBe(200);
    expect(inv.body.length).toBe(1);
    expect(inv.body[0].heatNumber).toBe("HEAT-777");
    expect(inv.body[0].quantity).toBe(10);
  });

  it("blocks deleting a PO that has receiving records (provenance)", async () => {
    const res = await agent.delete(`/api/purchase-orders/${poId}`);
    expect(res.status).toBe(409);
  });
});

describe("concurrent consumption", () => {
  it("never over-allocates pieces under parallel consumes", async () => {
    const inv = await agent.get("/api/inventory?status=available");
    const itemId = inv.body[0].id as number;

    // 6 parallel consumes of 2 pieces each against 10 on hand: exactly 5 can win.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        agent.post(`/api/inventory/${itemId}/consume`).send({ jobId: jobBId, pieces: 2 }),
      ),
    );
    const ok = results.filter((r) => r.status === 200).length;
    const conflict = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(5);
    expect(conflict).toBe(1);

    const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, itemId));
    expect(item.quantity).toBe(0);
    expect(item.status).toBe("consumed");

    // Consumed movements must account for exactly 10 pieces — no more.
    const movements = await db.select().from(materialMovementsTable).where(eq(materialMovementsTable.companyId, companyId));
    const consumedPieces = movements.filter((m) => m.movementType === "consumed").reduce((s, m) => s + m.quantity, 0);
    expect(consumedPieces).toBe(10);
  });
});

describe("remnants and reconciliation", () => {
  it("blocks consuming manual stock that has no heat/CMTR anchor", async () => {
    const created = await agent.post("/api/inventory").send({
      profileType: "PL",
      profileSize: `1/2x12-${suffix}`,
      grade: "A36",
      quantity: 2,
      lengthIn: 240,
      unitCost: 60,
    });
    expect(created.status).toBe(201);
    const manualId = created.body.id as number;
    const res = await agent.post(`/api/inventory/${manualId}/consume`).send({ jobId: jobAId, pieces: 1 });
    expect(res.status).toBe(409);
  });

  it("bounds remnant length, preserves traceability, and retains proportional cost", async () => {
    // Receive 2 more traceable pieces (480" @ $100 each) to cut from.
    const rec = await agent.post(`/api/purchase-orders/${poId}/receiving`).send({
      receivedDate: "2026-08-14",
      lines: [{ purchaseOrderLineId: poLineId, heatNumber: "HEAT-888", cmtrDocumentId: cmtrDocId, pieces: 2 }],
    });
    expect(rec.status).toBe(201);
    const inv = await agent.get("/api/inventory?status=available");
    const traced = inv.body.find((i: { heatNumber: string | null }) => i.heatNumber === "HEAT-888");
    const tracedId = traced.id as number;

    // Remnant longer than the source piece is rejected.
    const tooLong = await agent.post(`/api/inventory/${tracedId}/consume`).send({ jobId: jobAId, pieces: 1, remnantLengthIn: 500 });
    expect(tooLong.status).toBe(400);

    // Remnant with a multi-piece consume is ambiguous and rejected.
    const multi = await agent.post(`/api/inventory/${tracedId}/consume`).send({ jobId: jobAId, pieces: 2, remnantLengthIn: 120 });
    expect(multi.status).toBe(400);

    // Fractional consume pieces are rejected.
    const fractional = await agent.post(`/api/inventory/${tracedId}/consume`).send({ jobId: jobAId, pieces: 0.5 });
    expect(fractional.status).toBe(400);

    // Valid remnant: half the length retains half the per-piece cost.
    const consumed = await agent.post(`/api/inventory/${tracedId}/consume`).send({ jobId: jobAId, pieces: 1, remnantLengthIn: 240 });
    expect(consumed.status).toBe(200);

    const items0 = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.companyId, companyId));
    const remnant0 = items0.find((i) => i.isRemnant);
    // Remnant keeps the ORIGINAL receiving-line anchor.
    const src = items0.find((i) => i.id === tracedId);
    expect(remnant0!.receivingLineId).toBe(src!.receivingLineId);

    // Job is charged NET cost: 1 × $100 minus $50 retained by the remnant.
    const movements2 = await db.select().from(materialMovementsTable).where(eq(materialMovementsTable.companyId, companyId));
    const netConsume = movements2.find((m) => m.movementType === "consumed" && m.jobId === jobAId);
    expect(netConsume?.totalCost).toBe(50);

    const items = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.companyId, companyId));
    const remnant = items.find((i) => i.isRemnant);
    expect(remnant).toBeDefined();
    expect(remnant!.unitCost).toBe(50);
    expect(remnant!.lengthIn).toBe(240);

    // Trend (ledger-derived) reconciles with actual on-hand items.
    const trend = await agent.get("/api/reports/inventory-trend?months=1");
    expect(trend.status).toBe(200);
    const latest = trend.body[trend.body.length - 1];
    const onHandPieces = items.filter((i) => i.status !== "consumed").reduce((s, i) => s + i.quantity, 0);
    const onHandValue = items
      .filter((i) => i.status !== "consumed")
      .reduce((s, i) => s + (i.unitCost ?? 0) * i.quantity, 0);
    expect(latest.availablePieces).toBe(onHandPieces);
    expect(latest.inventoryValue).toBeCloseTo(onHandValue, 2);
  });
});
