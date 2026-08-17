/**
 * Integration tests for the Phase 6 QC & shipping hard gates.
 *
 * Covers the review-critical invariants:
 * 1. Ready-to-Ship gate: a shipment can only contain Inspected, not-on-hold
 *    assemblies.
 * 2. Paperwork gate: BOL/packing slip 409 until a written shipment
 *    notification is recorded.
 * 3. Departure gate: departure 409s without a signed load confirmation, and
 *    marks the shipment's assemblies Shipped.
 * 4. Shipped is terminal for direct edits: the assembly PATCH endpoint can
 *    neither set "Shipped" nor move a shipped assembly to any other stage.
 * 5. Substitution approval is blocked without customer concurrence when the
 *    material is customer-specified.
 *
 * Runs against the development database with an isolated throwaway company.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { seedDefaultStageLibrary } from "../services/production";
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
  bomAssembliesTable,
  stageLibraryTable,
} from "@workspace/db";
import app from "../app";

const agent = request.agent(app);
const suffix = Date.now().toString(36);
const email = `ship-test-${suffix}@example.com`;
const password = "ship-test-password-1";

let companyId: number;
let userId: number;
let jobId: number;
let jobNumber: string;
let inspectedId: number; // Inspected, not on hold — RTS
let fitId: number; // earlier stage — not RTS
let heldId: number; // Inspected but on hold — not RTS

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `Ship Test Co ${suffix}`, slug: `ship-test-${suffix}` })
    .returning();
  companyId = company.id;
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "Ship Tester", passwordHash: await bcrypt.hash(password, 4) })
    .returning();
  userId = user.id;
  await db.insert(userCompanyRolesTable).values({ userId, companyId, role: "admin" });
  await seedDefaultStageLibrary(companyId);
  const [customer] = await db
    .insert(customersTable)
    .values({ companyId, name: `Ship Test Customer ${suffix}` })
    .returning();
  jobNumber = `ST-${suffix}`;
  const [job] = await db
    .insert(jobsTable)
    .values({
      companyId,
      jobNumber,
      name: "Shipping gate test job",
      customer: customer.name,
      customerId: customer.id,
    })
    .returning();
  jobId = job.id;
  const rows = await db
    .insert(bomAssembliesTable)
    .values([
      { jobId, mark: "ST-A1", quantity: 1, currentStage: "Inspected", onHold: false, sortIndex: 1 },
      { jobId, mark: "ST-A2", quantity: 1, currentStage: "Fit", onHold: false, sortIndex: 2 },
      { jobId, mark: "ST-A3", quantity: 1, currentStage: "Inspected", onHold: true, sortIndex: 3 },
    ])
    .returning();
  inspectedId = rows[0].id;
  fitId = rows[1].id;
  heldId = rows[2].id;

  await agent.post("/api/auth/login").send({ email, password }).expect(200);
});

afterAll(async () => {
  // Job cascade removes assemblies, shipments, notifications, confirmations.
  await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
  await db.delete(userCompanyRolesTable).where(eq(userCompanyRolesTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(customersTable).where(eq(customersTable.companyId, companyId));
  await db.delete(stageLibraryTable).where(eq(stageLibraryTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("Ready-to-Ship gate", () => {
  it("rejects shipments containing a not-yet-inspected assembly", async () => {
    const res = await agent
      .post(`/api/jobs/${jobId}/shipments`)
      .send({ assemblyIds: [inspectedId, fitId] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Not Ready to Ship/i);
    expect(res.body.error).toContain("ST-A2");
  });

  it("rejects shipments containing an on-hold assembly", async () => {
    const res = await agent
      .post(`/api/jobs/${jobId}/shipments`)
      .send({ assemblyIds: [heldId] });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("ST-A3");
  });
});

describe("shipment gates and departure", () => {
  let shipmentId: number;

  it("creates a shipment from RTS assemblies with a [job#]-S[NN] number", async () => {
    const res = await agent
      .post(`/api/jobs/${jobId}/shipments`)
      .send({ assemblyIds: [inspectedId], carrier: "Test Trucking" });
    expect(res.status).toBe(201);
    expect(res.body.shipperNumber).toBe(`${jobNumber}-S01`);
    expect(res.body.paperworkReady).toBe(false);
    shipmentId = res.body.id;
  });

  it("blocks BOL/packing-slip paperwork before the written notification", async () => {
    const bol = await agent.get(`/api/shipments/${shipmentId}/bol.pdf`);
    expect(bol.status).toBe(409);
    const slip = await agent.get(`/api/shipments/${shipmentId}/packing-slip.pdf`);
    expect(slip.status).toBe(409);
  });

  it("blocks departure before the written notification", async () => {
    const res = await agent.post(`/api/shipments/${shipmentId}/depart`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/notification/i);
  });

  it("allows paperwork once the notification is recorded", async () => {
    await agent
      .post(`/api/shipments/${shipmentId}/notification`)
      .send({ proposedShipDate: "2026-09-01", carrier: "Test Trucking" })
      .expect(201);
    const bol = await agent.get(`/api/shipments/${shipmentId}/bol.pdf`);
    expect(bol.status).toBe(200);
    expect(bol.headers["content-type"]).toContain("application/pdf");
  });

  it("blocks departure before a signed load confirmation", async () => {
    const res = await agent.post(`/api/shipments/${shipmentId}/depart`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/load confirmation/i);
  });

  it("revalidates RTS at departure — an assembly put on hold after shipment creation blocks departure", async () => {
    await agent
      .post(`/api/shipments/${shipmentId}/load-confirmation`)
      .send({ signedBy: "Gate Tester" })
      .expect(201);
    // Sabotage after all paperwork/sign-offs are in place.
    await agent
      .patch(`/api/bom/assemblies/${inspectedId}`)
      .send({ onHold: true })
      .expect(200);
    const blocked = await agent.post(`/api/shipments/${shipmentId}/depart`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/no longer Ready to Ship/i);
    // Same for regressing the stage.
    await agent
      .patch(`/api/bom/assemblies/${inspectedId}`)
      .send({ onHold: false, currentStage: "Fit" })
      .expect(200);
    const blocked2 = await agent.post(`/api/shipments/${shipmentId}/depart`);
    expect(blocked2.status).toBe(409);
    // Restore RTS.
    await agent
      .patch(`/api/bom/assemblies/${inspectedId}`)
      .send({ currentStage: "Inspected" })
      .expect(200);
  });

  it("refuses to put the same assembly on a second shipment", async () => {
    const res = await agent
      .post(`/api/jobs/${jobId}/shipments`)
      .send({ assemblyIds: [inspectedId] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already on a shipment/i);
  });

  it("departs once all gates pass and marks assemblies Shipped", async () => {
    const res = await agent.post(`/api/shipments/${shipmentId}/depart`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("departed");
    const [asm] = await db
      .select({ currentStage: bomAssembliesTable.currentStage })
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.id, inspectedId));
    expect(asm.currentStage).toBe("Shipped");
  });

  it("refuses to delete a departed shipment", async () => {
    const res = await agent.delete(`/api/shipments/${shipmentId}`);
    expect(res.status).toBe(409);
  });

  it("blocks BOM re-import once the job has shipping history", async () => {
    const kiss = [
      "H,ST,Shipping gate test job",
      "D,ST-A1,1,ST-A1,ST-A1,1,W,W12X26,A992,3048,,MAIN",
    ].join("\n");
    const res = await agent
      .post(`/api/jobs/${jobId}/bom`)
      .attach("file", Buffer.from(kiss), "reimport.kss");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/shipments/i);
    // The shipped assembly and the departed shipment's manifest survive.
    const [asm] = await db
      .select({ currentStage: bomAssembliesTable.currentStage })
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.id, inspectedId));
    expect(asm.currentStage).toBe("Shipped");
  });
});

describe("Shipped is not directly editable", () => {
  it("rejects setting Shipped via the assembly PATCH endpoint", async () => {
    const res = await agent
      .patch(`/api/bom/assemblies/${fitId}`)
      .send({ currentStage: "Shipped" });
    expect(res.status).toBe(409);
  });

  it("rejects moving a shipped assembly back to another stage", async () => {
    const res = await agent
      .patch(`/api/bom/assemblies/${inspectedId}`)
      .send({ currentStage: "Inspected" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/shipped/i);
  });

  it("rejects clearing a shipped assembly's stage", async () => {
    const res = await agent
      .patch(`/api/bom/assemblies/${inspectedId}`)
      .send({ currentStage: null });
    expect(res.status).toBe(409);
  });
});

describe("substitution customer-concurrence gate", () => {
  it("blocks approval of a customer-specified substitution until concurrence", async () => {
    const created = await agent.post("/api/substitution-requests").send({
      originalSpec: "W12x26 A992",
      proposedSubstitution: "W12x30 A992",
      type: "upgrade",
      engineeringRationale: "Availability",
      jobId,
      customerSpecified: true,
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const blocked = await agent
      .patch(`/api/substitution-requests/${id}`)
      .send({ approve: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/concurrence/i);

    await agent
      .patch(`/api/substitution-requests/${id}`)
      .send({ customerConcurrence: true })
      .expect(200);
    const approved = await agent
      .patch(`/api/substitution-requests/${id}`)
      .send({ approve: true });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");

    // Approval is terminal: concurrence cannot be revoked and the status
    // cannot be flipped afterwards.
    const revoke = await agent
      .patch(`/api/substitution-requests/${id}`)
      .send({ customerConcurrence: false });
    expect(revoke.status).toBe(409);
    const reReject = await agent
      .patch(`/api/substitution-requests/${id}`)
      .send({ reject: true });
    expect(reReject.status).toBe(409);
    // Only the execution reference may still be recorded.
    const exec = await agent
      .patch(`/api/substitution-requests/${id}`)
      .send({ executionReference: "ECN-42" });
    expect(exec.status).toBe(200);
    expect(exec.body.executionReference).toBe("ECN-42");
  });
});
