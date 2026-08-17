/**
 * Stage Library pipeline invariants:
 * - creating a stage inserts BEFORE the final (terminal) stage
 * - deleting cannot leave the RTS gate as the final stage
 * - reorder cannot put the gate last
 * - renames cascade to assembly currentStage
 * - departed (final-stage) assemblies stay terminal after pipeline edits
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
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
import bcrypt from "bcryptjs";
import app from "../app";
import { seedDefaultStageLibrary } from "../services/production";

const agent = request.agent(app);
const suffix = `slib${Date.now().toString(36)}`;
const email = `stage-${suffix}@test.local`;
const password = "test-password-123";

let companyId: number;
let userId: number;
let jobId: number;
let shippedAsmId: number;
let cutAsmId: number;

let stages: Array<{ id: number; name: string; isReadyToShipGate: boolean }>;

const byName = (name: string) => stages.find((s) => s.name === name)!;

async function refreshStages() {
  const res = await agent.get("/api/stage-library").expect(200);
  stages = res.body;
}

beforeAll(async () => {
  const [co] = await db
    .insert(companiesTable)
    .values({ name: `StageLib Test ${suffix}`, slug: `stagelib-${suffix}` })
    .returning();
  companyId = co.id;
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "Stage Tester", passwordHash: await bcrypt.hash(password, 4) })
    .returning();
  userId = user.id;
  await db.insert(userCompanyRolesTable).values({ userId, companyId, role: "admin" });
  await seedDefaultStageLibrary(companyId);
  const [job] = await db
    .insert(jobsTable)
    .values({
      companyId,
      jobNumber: `SL-${suffix}`,
      name: "Stage lib job",
      customer: "Test Customer",
      status: "active",
    })
    .returning();
  jobId = job.id;
  const [shipped] = await db
    .insert(bomAssembliesTable)
    .values({ jobId, mark: "SHIP-1", quantity: 1, currentStage: "Shipped" })
    .returning();
  shippedAsmId = shipped.id;
  const [cut] = await db
    .insert(bomAssembliesTable)
    .values({ jobId, mark: "CUT-1", quantity: 2, currentStage: "Cut" })
    .returning();
  cutAsmId = cut.id;
  await agent.post("/api/auth/login").send({ email, password }).expect(200);
  await refreshStages();
});

afterAll(async () => {
  await db.delete(jobsTable).where(eq(jobsTable.id, jobId));
  await db.delete(userCompanyRolesTable).where(eq(userCompanyRolesTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(customersTable).where(eq(customersTable.companyId, companyId));
  await db.delete(stageLibraryTable).where(eq(stageLibraryTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("terminal-stage protection", () => {
  it("creating a stage inserts before the final stage, keeping Shipped terminal", async () => {
    const res = await agent
      .post("/api/stage-library")
      .send({ name: "Paint", stageType: "in_house" })
      .expect(201);
    await refreshStages();
    const names = stages.map((s) => s.name);
    expect(names[names.length - 1]).toBe("Shipped");
    expect(names[names.length - 2]).toBe("Paint");
    // Departed assembly is still terminal: direct edits still rejected.
    const patch = await agent
      .patch(`/api/bom/assemblies/${shippedAsmId}`)
      .send({ currentStage: "Cut" });
    expect(patch.status).toBe(409);
    // cleanup
    await agent.delete(`/api/stage-library/${res.body.id}`).expect(204);
    await refreshStages();
  });

  it("rejects deleting the final stage", async () => {
    const res = await agent.delete(`/api/stage-library/${byName("Shipped").id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/final/i);
  });

  it("rejects a reorder that moves the terminal stage away from last", async () => {
    const ids = stages.map((s) => s.id);
    const shippedId = byName("Shipped").id;
    // Move Shipped to the front — another stage would become terminal.
    const reordered = [shippedId, ...ids.filter((id) => id !== shippedId)];
    const res = await agent
      .post("/api/stage-library/reorder")
      .send({ itemIds: reordered });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/final/i);
  });

  it("rejects deleting the final stage even when empty of gate concerns", async () => {
    // Shipped holds a departed assembly in this suite, but even without one
    // the terminal stage is categorically protected.
    const res = await agent.delete(`/api/stage-library/${byName("Shipped").id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/final|shipped/i);
  });

  it("rejects a reorder that puts the gate last", async () => {
    const ids = stages.map((s) => s.id);
    const gateId = byName("Inspected").id;
    const reordered = [...ids.filter((id) => id !== gateId), gateId];
    const res = await agent
      .post("/api/stage-library/reorder")
      .send({ itemIds: reordered });
    expect(res.status).toBe(400);
  });

  it("rejects marking the final stage as the RTS gate", async () => {
    const res = await agent
      .patch(`/api/stage-library/${byName("Shipped").id}`)
      .send({ isReadyToShipGate: true });
    expect(res.status).toBe(409);
  });
});

describe("rename and delete guards", () => {
  it("renaming a stage cascades to assemblies in that stage", async () => {
    await agent
      .patch(`/api/stage-library/${byName("Cut").id}`)
      .send({ name: "Sawed" })
      .expect(200);
    const [asm] = await db
      .select({ currentStage: bomAssembliesTable.currentStage })
      .from(bomAssembliesTable)
      .where(eq(bomAssembliesTable.id, cutAsmId));
    expect(asm.currentStage).toBe("Sawed");
    await refreshStages();
    // rename back
    await agent
      .patch(`/api/stage-library/${byName("Sawed").id}`)
      .send({ name: "Cut" })
      .expect(200);
    await refreshStages();
  });

  it("rejects deleting a stage with assemblies in it", async () => {
    const res = await agent.delete(`/api/stage-library/${byName("Cut").id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/assembl/i);
  });

  it("rejects deleting the gate stage", async () => {
    const res = await agent.delete(`/api/stage-library/${byName("Inspected").id}`);
    expect(res.status).toBe(409);
  });

  it("rejects setting an assembly to a stage not in the library", async () => {
    const res = await agent
      .patch(`/api/bom/assemblies/${cutAsmId}`)
      .send({ currentStage: "Galvanizing" });
    expect(res.status).toBe(400);
  });

  it("rejects setting an assembly directly to the final stage", async () => {
    const res = await agent
      .patch(`/api/bom/assemblies/${cutAsmId}`)
      .send({ currentStage: "Shipped" });
    expect(res.status).toBe(409);
  });
});
