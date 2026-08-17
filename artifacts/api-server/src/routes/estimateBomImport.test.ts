/**
 * Integration tests for the estimate BOM import pipeline (KISS + PowerFab XML).
 *
 * Covers the review-critical invariants:
 * 1. .xml (Tekla PowerFab) uploads parse through the same preview endpoint.
 * 2. Disallowed extensions are rejected.
 * 3. A manual resolution without a positive price can NEVER be committed —
 *    an unmatched material must be matched, marked needs_quote, or given a
 *    real (> 0) manual price.
 *
 * Runs against the development database with an isolated throwaway company.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  db,
  companiesTable,
  usersTable,
  userCompanyRolesTable,
  estimatesTable,
} from "@workspace/db";
import app from "../app";

const agent = request.agent(app);
const suffix = Date.now().toString(36);
const email = `bomimport-test-${suffix}@example.com`;
const password = "bomimport-test-password-1";

const xmlPath = resolve(
  __dirname,
  "../../../../attached_assets/0_SUBMITTAL_51_XML_1786975904583.xml",
);

let companyId: number;
let userId: number;
let estimateId: number;

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `BomImport Test Co ${suffix}`, slug: `bomimport-${suffix}` })
    .returning();
  companyId = company.id;
  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "BomImport Tester", passwordHash: await bcrypt.hash(password, 4) })
    .returning();
  userId = user.id;
  await db.insert(userCompanyRolesTable).values({ userId, companyId, role: "admin" });

  const [estimate] = await db
    .insert(estimatesTable)
    .values({
      companyId,
      bidNumber: `BI-${suffix}`,
      name: "BomImport Estimate",
      customer: "BomImport Customer",
    })
    .returning();
  estimateId = estimate.id;

  await agent.post("/api/auth/login").send({ email, password }).expect(200);
});

afterAll(async () => {
  await db.delete(estimatesTable).where(eq(estimatesTable.id, estimateId));
  await db.delete(userCompanyRolesTable).where(eq(userCompanyRolesTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("estimate BOM parse endpoint", () => {
  it("parses a Tekla PowerFab .xml upload into a preview", async () => {
    const res = await agent
      .post(`/api/estimates/${estimateId}/bom/parse`)
      .attach("file", readFileSync(xmlPath), "submittal.xml")
      .expect(200);
    expect(res.body.bom.jobRef).toBe("466");
    expect(res.body.bom.assemblies.length).toBeGreaterThan(0);
    expect(res.body.materials.length).toBeGreaterThan(0);
  });

  it("rejects disallowed file extensions", async () => {
    const res = await agent
      .post(`/api/estimates/${estimateId}/bom/parse`)
      .attach("file", Buffer.from("a,b,c"), "bom.csv")
      .expect(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it("rejects XML that is not a PowerFab export", async () => {
    const res = await agent
      .post(`/api/estimates/${estimateId}/bom/parse`)
      .attach("file", Buffer.from("<foo><bar/></foo>"), "other.xml")
      .expect(400);
    expect(res.body.error).toMatch(/PowerFab/i);
  });
});

describe("estimate BOM import commit — manual price gate", () => {
  const assemblies = [
    {
      mark: "A1",
      quantity: 1,
      description: null,
      finish: null,
      parts: [
        {
          partMark: "p1",
          quantity: 2,
          profileType: "PL",
          profileSize: 'PL1/2"X6"',
          grade: "A572-50",
          lengthIn: 12,
          description: null,
        },
      ],
    },
  ];
  const key = 'PL|PL1/2"X6"|A572-50';

  it("rejects a manual resolution without a price", async () => {
    const res = await agent
      .post(`/api/estimates/${estimateId}/bom/import`)
      .send({ assemblies, resolutions: [{ key, action: "manual" }] })
      .expect(400);
    expect(res.body.error).toMatch(/unresolved/i);
  });

  it("rejects a manual resolution with a zero price", async () => {
    const res = await agent
      .post(`/api/estimates/${estimateId}/bom/import`)
      .send({
        assemblies,
        resolutions: [{ key, action: "manual", manualUnitPrice: 0, manualPriceUnit: "per_foot" }],
      })
      .expect(400);
    expect(res.body.error).toMatch(/unresolved/i);
  });

  it("accepts a needs_quote resolution and commits", async () => {
    await agent
      .post(`/api/estimates/${estimateId}/bom/import`)
      .send({ assemblies, resolutions: [{ key, action: "needs_quote" }] })
      .expect(201);
    const bom = await agent.get(`/api/estimates/${estimateId}/bom`).expect(200);
    expect(bom.body.assemblyCount).toBe(1);
    expect(bom.body.needsQuoteCount).toBeGreaterThan(0);
  });
});
