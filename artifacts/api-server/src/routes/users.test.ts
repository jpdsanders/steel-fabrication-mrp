/**
 * Integration tests for company-scoped user administration.
 *
 * Invariants (Update Brief 02 §1):
 * - Company admins see/create/edit ONLY their own company's users.
 * - POST companyId is forced to the caller's company; others rejected.
 * - Company admins can never grant/change the global superAdmin flag.
 * - Non-super-admin users must be created with company + ≥1 role and can
 *   log in immediately.
 * - Super-admin behavior is unchanged (cross-company).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray, or, ilike } from "drizzle-orm";
import {
  db,
  companiesTable,
  usersTable,
  userCompanyRolesTable,
} from "@workspace/db";
import app from "../app";

const adminAgent = request.agent(app); // company admin of company A
const superAgent = request.agent(app); // super-admin

const suffix = Date.now().toString(36);
const adminEmail = `usr-admin-${suffix}@example.com`;
const superEmail = `usr-super-${suffix}@example.com`;
const password = "usr-test-password-1";

let companyAId: number;
let companyBId: number;
let adminId: number;
let superId: number;
let userBId: number; // plain user in company B
const createdEmails: string[] = [adminEmail, superEmail];

beforeAll(async () => {
  const [a] = await db
    .insert(companiesTable)
    .values({ name: `Usr Test Co A ${suffix}`, slug: `usr-a-${suffix}` })
    .returning();
  const [b] = await db
    .insert(companiesTable)
    .values({ name: `Usr Test Co B ${suffix}`, slug: `usr-b-${suffix}` })
    .returning();
  companyAId = a.id;
  companyBId = b.id;

  const hash = await bcrypt.hash(password, 4);
  const [admin] = await db
    .insert(usersTable)
    .values({ email: adminEmail, name: "Usr Admin", passwordHash: hash })
    .returning();
  adminId = admin.id;
  await db
    .insert(userCompanyRolesTable)
    .values({ userId: adminId, companyId: companyAId, role: "admin" });

  const [sup] = await db
    .insert(usersTable)
    .values({ email: superEmail, name: "Usr Super", passwordHash: hash, superAdmin: true })
    .returning();
  superId = sup.id;

  const bEmail = `usr-b-user-${suffix}@example.com`;
  createdEmails.push(bEmail);
  const [bUser] = await db
    .insert(usersTable)
    .values({ email: bEmail, name: "B User", passwordHash: hash })
    .returning();
  userBId = bUser.id;
  await db
    .insert(userCompanyRolesTable)
    .values({ userId: userBId, companyId: companyBId, role: "qc" });

  await adminAgent.post("/api/auth/login").send({ email: adminEmail, password }).expect(200);
  await superAgent.post("/api/auth/login").send({ email: superEmail, password }).expect(200);
});

afterAll(async () => {
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      or(
        inArray(usersTable.email, createdEmails),
        ilike(usersTable.email, `%usr-new-%${suffix}%`),
      ),
    );
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.delete(userCompanyRolesTable).where(inArray(userCompanyRolesTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyAId, companyBId]));
});

describe("company admin scoping", () => {
  it("lists only own company's users", async () => {
    const res = await adminAgent.get("/api/users").expect(200);
    const ids = res.body.map((u: { id: number }) => u.id);
    expect(ids).toContain(adminId);
    expect(ids).not.toContain(userBId);
    // no cross-company role visibility
    for (const u of res.body) {
      for (const c of u.companies) expect(c.id).toBe(companyAId);
    }
  });

  it("cannot fetch a user from another company", async () => {
    await adminAgent.get(`/api/users/${userBId}`).expect(404);
  });

  it("cannot create a user in another company", async () => {
    const res = await adminAgent.post("/api/users").send({
      email: `usr-new-other-${suffix}@example.com`,
      name: "Nope",
      password: "password-123",
      companyId: companyBId,
      roles: ["qc"],
    });
    expect(res.status).toBe(403);
  });

  it("cannot grant superAdmin on create or update", async () => {
    const res = await adminAgent.post("/api/users").send({
      email: `usr-new-sa-${suffix}@example.com`,
      name: "Nope",
      password: "password-123",
      superAdmin: true,
      companyId: companyAId,
      roles: ["qc"],
    });
    expect(res.status).toBe(403);

    const patch = await adminAgent
      .patch(`/api/users/${adminId}`)
      .send({ superAdmin: true });
    expect(patch.status).toBe(403);
  });

  it("cannot edit a shared account (user with roles in another company too)", async () => {
    const email = `usr-new-shared-${suffix}@example.com`;
    const [shared] = await db
      .insert(usersTable)
      .values({ email, name: "Shared", passwordHash: await bcrypt.hash(password, 4) })
      .returning();
    await db.insert(userCompanyRolesTable).values([
      { userId: shared.id, companyId: companyAId, role: "qc" },
      { userId: shared.id, companyId: companyBId, role: "qc" },
    ]);

    // Global fields (active/password/etc.) would affect company B's access
    const res = await adminAgent
      .patch(`/api/users/${shared.id}`)
      .send({ active: false });
    expect(res.status).toBe(403);

    // Super-admin can still edit shared accounts
    await superAgent.patch(`/api/users/${shared.id}`).send({ active: false }).expect(200);
  });

  it("cannot edit users outside own company", async () => {
    await adminAgent.patch(`/api/users/${userBId}`).send({ name: "hax" }).expect(404);
  });

  it("creates a user in own company (companyId defaulted) who can log in immediately", async () => {
    const email = `usr-new-ok-${suffix}@example.com`;
    const res = await adminAgent.post("/api/users").send({
      email,
      name: "New QC",
      password: "password-123",
      roles: ["qc"],
    });
    expect(res.status).toBe(201);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password-123" });
    expect(login.status).toBe(200);
    expect(login.body.companyId).toBe(companyAId);
    expect(login.body.roles).toEqual(["qc"]);
  });

  it("rejects creating a non-super-admin without roles", async () => {
    const res = await adminAgent.post("/api/users").send({
      email: `usr-new-norole-${suffix}@example.com`,
      name: "Orphan",
      password: "password-123",
    });
    expect(res.status).toBe(400);
  });
});

describe("super-admin behavior unchanged", () => {
  it("sees users across companies and can filter by companyId", async () => {
    const all = await superAgent.get("/api/users").expect(200);
    const ids = all.body.map((u: { id: number }) => u.id);
    expect(ids).toContain(adminId);
    expect(ids).toContain(userBId);

    const filtered = await superAgent
      .get(`/api/users?companyId=${companyBId}`)
      .expect(200);
    const fIds = filtered.body.map((u: { id: number }) => u.id);
    expect(fIds).toContain(userBId);
    expect(fIds).not.toContain(adminId);
  });

  it("can create users in any company", async () => {
    const res = await superAgent.post("/api/users").send({
      email: `usr-new-super-${suffix}@example.com`,
      name: "Made By Super",
      password: "password-123",
      companyId: companyBId,
      roles: ["shipping"],
    });
    expect(res.status).toBe(201);
  });

  it("non-admin roles cannot access /users at all", async () => {
    const email = `usr-new-plain-${suffix}@example.com`;
    await superAgent
      .post("/api/users")
      .send({ email, name: "Plain", password: "password-123", companyId: companyAId, roles: ["qc"] })
      .expect(201);
    const plainAgent = request.agent(app);
    await plainAgent.post("/api/auth/login").send({ email, password: "password-123" }).expect(200);
    await plainAgent.get("/api/users").expect(403);
  });
});

describe("public login branding", () => {
  it("GET /api/auth/companies is public and exposes only branding fields", async () => {
    const res = await request(app).get("/api/auth/companies").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const co = res.body.find((c: { id: number }) => c.id === companyAId);
    expect(co).toBeTruthy();
    expect(Object.keys(co).sort()).toEqual(
      ["accentColor", "id", "logoUrl", "name", "primaryColor", "slug"].sort(),
    );
  });
});
