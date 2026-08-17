/**
 * Tests for the dev-only auth bypass (DEV_BYPASS_AUTH).
 *
 * Critical invariants:
 * 1. The bypass is structurally inert when NODE_ENV=production, even with
 *    DEV_BYPASS_AUTH=true.
 * 2. In non-production with the flag set, requests are auto-authenticated as
 *    the designated bypass user without any session.
 * 3. The `authBypass: true` marker appears on EVERY auth DTO response
 *    (/auth/me and /auth/switch-company), so the frontend's test-mode banner
 *    can never be dropped by a company switch.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { isAuthBypassActive } from "./auth";
import app from "../app";

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  setEnv({
    NODE_ENV: ORIGINAL_ENV.NODE_ENV,
    DEV_BYPASS_AUTH: ORIGINAL_ENV.DEV_BYPASS_AUTH,
  });
});

describe("isAuthBypassActive", () => {
  it("is inactive by default (flag unset)", () => {
    setEnv({ NODE_ENV: "development", DEV_BYPASS_AUTH: undefined });
    expect(isAuthBypassActive()).toBe(false);
  });

  it("is active in non-production with DEV_BYPASS_AUTH=true", () => {
    setEnv({ NODE_ENV: "development", DEV_BYPASS_AUTH: "true" });
    expect(isAuthBypassActive()).toBe(true);
  });

  it("is NEVER active in production, even with the flag set", () => {
    setEnv({ NODE_ENV: "production", DEV_BYPASS_AUTH: "true" });
    expect(isAuthBypassActive()).toBe(false);
  });

  it("is NEVER active when NODE_ENV is unset, even with the flag set", () => {
    setEnv({ NODE_ENV: undefined, DEV_BYPASS_AUTH: "true" });
    expect(isAuthBypassActive()).toBe(false);
  });

  it("is NEVER active for arbitrary non-development NODE_ENV values", () => {
    for (const env of ["staging", "test", "prod", "Production", ""]) {
      setEnv({ NODE_ENV: env, DEV_BYPASS_AUTH: "true" });
      expect(isAuthBypassActive()).toBe(false);
    }
  });

  it("requires the exact value 'true'", () => {
    setEnv({ NODE_ENV: "development", DEV_BYPASS_AUTH: "1" });
    expect(isAuthBypassActive()).toBe(false);
  });
});

describe("bypass behavior via HTTP", () => {
  it("production: sessionless request is 401 even with flag on", async () => {
    setEnv({ NODE_ENV: "production", DEV_BYPASS_AUTH: "true" });
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("flag off in dev: sessionless request is 401", async () => {
    setEnv({ NODE_ENV: "development", DEV_BYPASS_AUTH: undefined });
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("flag on in dev: sessionless request is authenticated as bypass user with marker", async () => {
    setEnv({ NODE_ENV: "development", DEV_BYPASS_AUTH: "true" });
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.authBypass).toBe(true);
    expect(typeof res.body.id).toBe("number");
    expect(typeof res.body.companyId).toBe("number");
  });

  it("marker continuity: switch-company DTO also carries authBypass", async () => {
    setEnv({ NODE_ENV: "development", DEV_BYPASS_AUTH: "true" });
    const me = await request(app).get("/api/auth/me");
    expect(me.status).toBe(200);
    // Only meaningful when the bypass user is a super-admin with companies
    if (me.body.superAdmin && me.body.companies?.length) {
      const target = me.body.companies.find(
        (c: { id: number }) => c.id !== me.body.companyId,
      ) ?? me.body.companies[0];
      const res = await request(app)
        .post("/api/auth/switch-company")
        .send({ companyId: target.id });
      expect(res.status).toBe(200);
      expect(res.body.authBypass).toBe(true);
    }
  });
});
