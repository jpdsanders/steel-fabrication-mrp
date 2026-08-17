/**
 * Integration tests for the Phase 7 reporting endpoints.
 *
 * Covers the review-critical math:
 * 1. Actual labor cost — stage-name → trade rate matching, with the
 *    company-average fallback for unmatched stage names.
 * 2. Estimate-vs-actual — cost variance is measured against the estimate's
 *    COST budget (labor + BOM material, no margin), not the quoted amount;
 *    the quoted (margin-bearing) amount is reported separately.
 * 3. Outstanding POs — only open statuses (draft/sent/approved) count.
 * 4. Company scoping — reports never leak another company's rows.
 *
 * Runs against the development database with an isolated throwaway company.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompanyRolesTable,
  jobsTable,
  stagesTable,
  employeesTable,
  timeEntriesTable,
  laborRatesTable,
  estimatesTable,
  estimateBomAssembliesTable,
  estimateBomPartsTable,
  estimateLaborLinesTable,
  vendorsTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  materialMovementsTable,
  receivingRecordsTable,
  receivingLinesTable,
  documentsTable,
} from "@workspace/db";
import app from "../app";

const agent = request.agent(app);
const otherAgent = request.agent(app);
const suffix = `rpt${Date.now().toString(36)}`;
const email = `rpt-test-${suffix}@example.com`;
const otherEmail = `rpt-other-${suffix}@example.com`;
const password = "rpt-test-password-1";

let companyId: number;
let otherCompanyId: number;
const userIds: number[] = [];
let jobId: number;
let otherJobId: number;
let estimateId: number;
let vendorId: number;
let cmtrDocumentId: number;

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `Rpt Test Co ${suffix}`, slug: `rpt-test-${suffix}` })
    .returning();
  companyId = company.id;
  const [otherCompany] = await db
    .insert(companiesTable)
    .values({ name: `Rpt Other Co ${suffix}`, slug: `rpt-other-${suffix}` })
    .returning();
  otherCompanyId = otherCompany.id;

  const hash = await bcrypt.hash(password, 4);
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "Rpt Tester", passwordHash: hash })
    .returning();
  const [otherUser] = await db
    .insert(usersTable)
    .values({ email: otherEmail, name: "Rpt Other", passwordHash: hash })
    .returning();
  userIds.push(user.id, otherUser.id);
  await db.insert(userCompanyRolesTable).values([
    { userId: user.id, companyId, role: "admin" },
    { userId: otherUser.id, companyId: otherCompanyId, role: "admin" },
  ]);

  // Labor rates: Fitter $80, Welder $120 → company average $100
  await db.insert(laborRatesTable).values([
    { companyId, trade: "Fitter", hourlyRate: 80 },
    { companyId, trade: "Welder", hourlyRate: 120 },
  ]);

  // Estimate: labor budget 10h Fitter @ $90 = $900; material budget
  // (2 × $100 quoted) + (3 × $50 catalog fallback) = $350; cost budget $1,250.
  // Quoted amount $2,000 carries margin and must NOT drive cost variance.
  const [estimate] = await db
    .insert(estimatesTable)
    .values({
      companyId,
      bidNumber: `RB-${suffix}`,
      name: "Rpt Estimate",
      customer: "Rpt Customer",
      status: "won",
      estimatedHours: 10,
      amount: 2000,
      marginPercent: 20,
    })
    .returning();
  estimateId = estimate.id;
  await db
    .insert(estimateLaborLinesTable)
    .values({ estimateId, trade: "Fitter", hours: 10, hourlyRate: 90 });
  const [assembly] = await db
    .insert(estimateBomAssembliesTable)
    .values({ estimateId, mark: "A1" })
    .returning();
  await db.insert(estimateBomPartsTable).values([
    { assemblyId: assembly.id, quantity: 2, profileType: "W", quotedUnitPrice: 100 },
    { assemblyId: assembly.id, quantity: 3, profileType: "L", catalogUnitPrice: 50 },
  ]);

  const [job] = await db
    .insert(jobsTable)
    .values({
      companyId,
      estimateId,
      customer: "Rpt Customer",
      jobNumber: `RJ-${suffix}`,
      name: "Rpt Job",
      status: "active",
    })
    .returning();
  jobId = job.id;
  const [otherJob] = await db
    .insert(jobsTable)
    .values({
      companyId: otherCompanyId,
      customer: "Other Customer",
      jobNumber: `RO-${suffix}`,
      name: "Rpt Other Job",
      status: "active",
    })
    .returning();
  otherJobId = otherJob.id;

  // Stages: "Fitter" matches the rate table; "Paint" does not (avg fallback).
  const [fitStage] = await db
    .insert(stagesTable)
    .values({ jobId, name: "Fitter", orderIndex: 0 })
    .returning();
  const [paintStage] = await db
    .insert(stagesTable)
    .values({ jobId, name: "Paint", orderIndex: 1 })
    .returning();
  const [employee] = await db
    .insert(employeesTable)
    .values({ companyId, name: "Rpt Employee" })
    .returning();
  // 2h on Fitter (2 × $80 = $160) + 1h on Paint (1 × avg $100 = $100) → $260
  await db.insert(timeEntriesTable).values([
    {
      employeeId: employee.id,
      jobId,
      stageId: fitStage.id,
      clockIn: new Date("2026-08-10T07:00:00Z"),
      clockOut: new Date("2026-08-10T09:00:00Z"),
    },
    {
      employeeId: employee.id,
      jobId,
      stageId: paintStage.id,
      clockIn: new Date("2026-08-10T09:00:00Z"),
      clockOut: new Date("2026-08-10T10:00:00Z"),
    },
  ]);

  // Consumed material: $500
  await db.insert(materialMovementsTable).values({
    companyId,
    movementType: "consumed",
    jobId,
    quantity: 1,
    totalCost: 500,
    occurredAt: new Date("2026-08-11T12:00:00Z"),
  });

  // POs: one pending (sent, 2 × $10 = $20), one committed (approved,
  // 3 × $10 = $30), and one rejected (must never count financially)
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ companyId, name: `Rpt Vendor ${suffix}`, status: "approved" })
    .returning();
  const [sentPo] = await db
    .insert(purchaseOrdersTable)
    .values({ jobId, vendorId: vendor.id, poNumber: `RP-SENT-${suffix}`, status: "sent" })
    .returning();
  const [approvedPo] = await db
    .insert(purchaseOrdersTable)
    .values({ jobId, vendorId: vendor.id, poNumber: `RP-APPR-${suffix}`, status: "approved" })
    .returning();
  const [rejectedPo] = await db
    .insert(purchaseOrdersTable)
    .values({ jobId, vendorId: vendor.id, poNumber: `RP-REJ-${suffix}`, status: "rejected" })
    .returning();
  await db.insert(purchaseOrderLinesTable).values([
    { purchaseOrderId: sentPo.id, pieces: 2, unitPrice: 10 },
    { purchaseOrderId: rejectedPo.id, pieces: 5, unitPrice: 999 },
  ]);
  // Approved PO: one line partially received (3 of 10 → 7 × $10 remaining)
  // and one line fully received (must drop off the outstanding report).
  const [partialLine] = await db
    .insert(purchaseOrderLinesTable)
    .values({ purchaseOrderId: approvedPo.id, pieces: 10, unitPrice: 10 })
    .returning();
  const [fullLine] = await db
    .insert(purchaseOrderLinesTable)
    .values({ purchaseOrderId: approvedPo.id, pieces: 3, unitPrice: 100 })
    .returning();
  // A second approved PO that is FULLY received — must not appear at all.
  const [receivedPo] = await db
    .insert(purchaseOrdersTable)
    .values({ jobId, vendorId: vendor.id, poNumber: `RP-RCVD-${suffix}`, status: "approved" })
    .returning();
  const [receivedLine] = await db
    .insert(purchaseOrderLinesTable)
    .values({ purchaseOrderId: receivedPo.id, pieces: 4, unitPrice: 25 })
    .returning();
  const [cmtrDoc] = await db
    .insert(documentsTable)
    .values({ jobId, filename: "rpt-cmtr.pdf", category: "mtr", mimeType: "application/pdf", sizeBytes: 10, storageKey: `rpt-test/${suffix}` })
    .returning();
  cmtrDocumentId = cmtrDoc.id;
  const [rec1] = await db
    .insert(receivingRecordsTable)
    .values({ purchaseOrderId: approvedPo.id, receivedDate: "2026-08-14" })
    .returning();
  const [rec2] = await db
    .insert(receivingRecordsTable)
    .values({ purchaseOrderId: receivedPo.id, receivedDate: "2026-08-15" })
    .returning();
  await db.insert(receivingLinesTable).values([
    { receivingRecordId: rec1.id, purchaseOrderLineId: partialLine.id, heatNumber: "H1", cmtrDocumentId, pieces: 3 },
    { receivingRecordId: rec1.id, purchaseOrderLineId: fullLine.id, heatNumber: "H2", cmtrDocumentId, pieces: 3 },
    { receivingRecordId: rec2.id, purchaseOrderLineId: receivedLine.id, heatNumber: "H3", cmtrDocumentId, pieces: 4 },
  ]);
  vendorId = vendor.id;

  const login = await agent.post("/api/auth/login").send({ email, password });
  expect(login.status).toBe(200);
  const otherLogin = await otherAgent.post("/api/auth/login").send({ email: otherEmail, password });
  expect(otherLogin.status).toBe(200);
});

afterAll(async () => {
  const companyIds = [companyId, otherCompanyId];
  await db.delete(materialMovementsTable).where(inArray(materialMovementsTable.companyId, companyIds));
  // Receiving lines reference the CMTR document with ON DELETE RESTRICT, so
  // tear receiving down explicitly before the job cascade reaches documents.
  const pos = await db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.jobId, jobId));
  const recs = pos.length === 0 ? [] : await db.select({ id: receivingRecordsTable.id }).from(receivingRecordsTable).where(inArray(receivingRecordsTable.purchaseOrderId, pos.map((p) => p.id)));
  if (recs.length > 0) await db.delete(receivingLinesTable).where(inArray(receivingLinesTable.receivingRecordId, recs.map((r) => r.id)));
  if (pos.length > 0) await db.delete(receivingRecordsTable).where(inArray(receivingRecordsTable.purchaseOrderId, pos.map((p) => p.id)));
  await db.delete(documentsTable).where(eq(documentsTable.id, cmtrDocumentId));
  await db.delete(jobsTable).where(inArray(jobsTable.companyId, companyIds)); // cascades stages, time entries, POs
  await db.delete(estimatesTable).where(inArray(estimatesTable.companyId, companyIds)); // cascades BOM + labor lines
  await db.delete(employeesTable).where(inArray(employeesTable.companyId, companyIds));
  await db.delete(vendorsTable).where(inArray(vendorsTable.companyId, companyIds));
  await db.delete(laborRatesTable).where(inArray(laborRatesTable.companyId, companyIds));
  await db.delete(userCompanyRolesTable).where(inArray(userCompanyRolesTable.userId, userIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
});

describe("labor cost rate matching", () => {
  it("matches stage name to trade rate and falls back to company average", async () => {
    const res = await agent.get("/api/reports/job-costing");
    expect(res.status).toBe(200);
    const row = res.body.jobs.find((j: any) => j.jobId === jobId);
    expect(row).toBeDefined();
    expect(row.laborHours).toBe(3);
    // 2h Fitter @ 80 + 1h Paint @ avg(80,120)=100 → 260
    expect(row.laborCost).toBe(260);
    expect(row.materialConsumedCost).toBe(500);
    expect(row.totalCost).toBe(760);
    // Committed PO value counts only approved POs (full ordered value):
    // RP-APPR (10×$10 + 3×$100 = $400) + RP-RCVD (4×$25 = $100)
    expect(row.poValue).toBe(500);
  });
});

describe("estimate vs actual", () => {
  it("measures cost variance against the cost budget, not the quoted amount", async () => {
    const res = await agent.get("/api/reports/estimate-vs-actual");
    expect(res.status).toBe(200);
    const row = res.body.find((r: any) => r.jobId === jobId);
    expect(row).toBeDefined();
    expect(row.estimatedLaborCost).toBe(900); // 10h × $90
    expect(row.estimatedMaterialCost).toBe(350); // 2×$100 + 3×$50
    expect(row.estimatedTotalCost).toBe(1250);
    expect(row.actualCost).toBe(760); // 260 labor + 500 material
    // Cost variance vs the budget: 760 − 1250 = −490 (under budget)
    expect(row.costVariance).toBe(-490);
    // Quoted amount (includes margin) is reported separately
    expect(row.estimateAmount).toBe(2000);
    expect(row.contractVariance).toBe(1240); // 2000 − 760
  });

  it("keeps the quoted margin out of the recap subtotal", async () => {
    const res = await agent.get(`/api/reports/estimate-recap/${estimateId}`);
    expect(res.status).toBe(200);
    expect(res.body.laborTotal).toBe(900);
    expect(res.body.materialTotal).toBe(350);
    expect(res.body.subtotal).toBe(1250);
    expect(res.body.marginPercent).toBe(20);
    expect(res.body.marginAmount).toBe(250);
    expect(res.body.total).toBe(1500);
  });
});

describe("outstanding POs", () => {
  it("counts only open statuses and their line value", async () => {
    const res = await agent.get("/api/reports/outstanding-pos");
    expect(res.status).toBe(200);
    const mine = res.body.pos.filter((p: any) => p.jobId === jobId);
    expect(mine.map((p: any) => p.poNumber).sort()).toEqual([
      `RP-APPR-${suffix}`,
      `RP-SENT-${suffix}`,
    ]);
    const values = Object.fromEntries(mine.map((p: any) => [p.poNumber, p.value]));
    expect(values[`RP-SENT-${suffix}`]).toBe(20);
    // Partially received line: 10 ordered, 3 received → 7 × $10 remaining;
    // the fully received $100/pc line contributes nothing.
    expect(values[`RP-APPR-${suffix}`]).toBe(70);
    // The fully received approved PO must not appear at all.
    expect(values[`RP-RCVD-${suffix}`]).toBeUndefined();
  });
});

describe("vendor performance", () => {
  it("counts only approved (committed) POs — rejected and sent excluded", async () => {
    const res = await agent.get("/api/reports/vendor-performance");
    expect(res.status).toBe(200);
    const row = res.body.find((v: any) => v.vendorId === vendorId);
    expect(row).toBeDefined();
    expect(row.poCount).toBe(2); // both approved POs; sent + rejected excluded
    expect(row.totalSpend).toBe(500);
  });
});

describe("company scoping", () => {
  it("never returns another company's jobs", async () => {
    const [costing, eva, labor] = await Promise.all([
      otherAgent.get("/api/reports/job-costing"),
      otherAgent.get("/api/reports/estimate-vs-actual"),
      otherAgent.get("/api/reports/labor-detail?from=2026-08-01&to=2026-08-31"),
    ]);
    expect(costing.body.jobs.map((j: any) => j.jobId)).toEqual([otherJobId]);
    expect(eva.body).toEqual([]);
    expect(labor.body.entries).toEqual([]);
    // And the other company's estimate recap is not reachable
    const recap = await otherAgent.get(`/api/reports/estimate-recap/${estimateId}`);
    expect(recap.status).toBe(404);
  });
});
