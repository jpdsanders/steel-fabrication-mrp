import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  companiesTable,
  usersTable,
  userCompanyRolesTable,
  COMPANY_ROLES,
  type CompanyRole,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";
import { z } from "zod/v4";

const router: IRouter = Router();

const CreateCompanyBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  logoUrl: z.string().url().optional().nullable(),
  primaryColor: z.string().optional().nullable(),
  accentColor: z.string().optional().nullable(),
});

const UpdateCompanyBody = CreateCompanyBody.partial();

const AssignRolesBody = z.object({
  roles: z.array(z.enum(COMPANY_ROLES as unknown as [CompanyRole, ...CompanyRole[]])).min(1),
});

function companyView(co: typeof companiesTable.$inferSelect) {
  return {
    id: co.id,
    name: co.name,
    slug: co.slug,
    logoUrl: co.logoUrl,
    primaryColor: co.primaryColor,
    accentColor: co.accentColor,
    createdAt: co.createdAt.toISOString(),
  };
}

/** GET /companies — list all companies (super-admin only) */
router.get(
  "/companies",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(companiesTable).orderBy(companiesTable.name);
    res.json(rows.map(companyView));
  },
);

/** POST /companies — create a company (super-admin only) */
router.post(
  "/companies",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const body = CreateCompanyBody.parse(req.body);
    const [existing] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.slug, body.slug));
    if (existing) {
      res.status(409).json({ error: "A company with that slug already exists" });
      return;
    }
    const [co] = await db.insert(companiesTable).values(body).returning();
    res.status(201).json(companyView(co));
  },
);

/** GET /companies/:id */
router.get(
  "/companies/:id",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const id = parseIntParam(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid company id" }); return; }
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }
    res.json(companyView(co));
  },
);

/** PATCH /companies/:id */
router.patch(
  "/companies/:id",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const id = parseIntParam(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid company id" }); return; }
    const body = UpdateCompanyBody.parse(req.body);
    if (body.slug) {
      const [existing] = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.slug, body.slug));
      if (existing && existing.id !== id) {
        res.status(409).json({ error: "A company with that slug already exists" }); return;
      }
    }
    const [co] = await db
      .update(companiesTable)
      .set(body)
      .where(eq(companiesTable.id, id))
      .returning();
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }
    res.json(companyView(co));
  },
);

/** GET /companies/:id/users — list users in a company with their roles */
router.get(
  "/companies/:id/users",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const companyId = parseIntParam(req.params.id);
    if (companyId === null) { res.status(400).json({ error: "Invalid company id" }); return; }
    const rows = await db
      .select({
        userId: userCompanyRolesTable.userId,
        role: userCompanyRolesTable.role,
        email: usersTable.email,
        name: usersTable.name,
        active: usersTable.active,
        superAdmin: usersTable.superAdmin,
      })
      .from(userCompanyRolesTable)
      .innerJoin(usersTable, eq(userCompanyRolesTable.userId, usersTable.id))
      .where(eq(userCompanyRolesTable.companyId, companyId));

    // Group by user
    const byUser = new Map<number, { userId: number; email: string; name: string; active: boolean; superAdmin: boolean; roles: string[] }>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? {
        userId: row.userId, email: row.email, name: row.name,
        active: row.active, superAdmin: row.superAdmin, roles: [],
      };
      entry.roles.push(row.role);
      byUser.set(row.userId, entry);
    }
    res.json([...byUser.values()]);
  },
);

/** PUT /companies/:id/users/:userId/roles — assign roles to a user in a company */
router.put(
  "/companies/:id/users/:userId/roles",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const companyId = parseIntParam(req.params.id);
    const userId = parseIntParam(req.params.userId);
    if (companyId === null || userId === null) {
      res.status(400).json({ error: "Invalid id" }); return;
    }
    const { roles } = AssignRolesBody.parse(req.body);

    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const [co] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!co) { res.status(404).json({ error: "Company not found" }); return; }

    await db.transaction(async (tx) => {
      await tx.delete(userCompanyRolesTable).where(
        and(eq(userCompanyRolesTable.userId, userId), eq(userCompanyRolesTable.companyId, companyId)),
      );
      await tx.insert(userCompanyRolesTable).values(roles.map((role) => ({ userId, companyId, role })));
    });
    res.json({ userId, companyId, roles });
  },
);

/** DELETE /companies/:id/users/:userId — remove user from company */
router.delete(
  "/companies/:id/users/:userId",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const companyId = parseIntParam(req.params.id);
    const userId = parseIntParam(req.params.userId);
    if (companyId === null || userId === null) {
      res.status(400).json({ error: "Invalid id" }); return;
    }
    await db.delete(userCompanyRolesTable).where(
      and(eq(userCompanyRolesTable.userId, userId), eq(userCompanyRolesTable.companyId, companyId)),
    );
    res.status(204).send();
  },
);

export default router;
