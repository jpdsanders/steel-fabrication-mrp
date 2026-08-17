import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  companiesTable,
  userCompanyRolesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  requireAuth,
  requireSuperAdmin,
  isAuthBypassActive,
} from "../middlewares/auth";

const router: IRouter = Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Build the flat auth DTO returned by login, /me, and switch-company.
 * Shape matches AuthUser in the frontend useAuth hook.
 */
async function buildAuthDto(userId: number, activeCompanyId: number) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;

  const [company] = await db
    .select({ id: companiesTable.id, name: companiesTable.name, slug: companiesTable.slug })
    .from(companiesTable)
    .where(eq(companiesTable.id, activeCompanyId))
    .limit(1);
  if (!company) return null;

  let roles: string[] = [];
  if (user.superAdmin) {
    roles = ["super_admin"];
  } else {
    const roleRows = await db
      .select({ role: userCompanyRolesTable.role })
      .from(userCompanyRolesTable)
      .where(and(eq(userCompanyRolesTable.userId, userId), eq(userCompanyRolesTable.companyId, activeCompanyId)));
    roles = roleRows.map((r) => r.role);
  }

  // Super-admin gets all companies for the switcher
  let companies: { id: number; name: string; slug: string }[] | undefined;
  if (user.superAdmin) {
    companies = await db
      .select({ id: companiesTable.id, name: companiesTable.name, slug: companiesTable.slug })
      .from(companiesTable)
      .orderBy(companiesTable.name);
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    superAdmin: user.superAdmin,
    companyId: company.id,
    companyName: company.name,
    companySlug: company.slug,
    roles,
    ...(companies !== undefined ? { companies } : {}),
    // Marker for the dev-only auth bypass: applied to EVERY auth DTO (login,
    // /me, switch-company) so the frontend's test-mode banner can never be
    // dropped by replacing user state from any of these responses.
    ...(isAuthBypassActive() ? { authBypass: true } : {}),
  };
}

/**
 * GET /auth/companies — public, lightweight company identity list for the
 * login screen (name + branding only; no sensitive data).
 */
router.get("/auth/companies", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: companiesTable.id,
      name: companiesTable.name,
      slug: companiesTable.slug,
      logoUrl: companiesTable.logoUrl,
      primaryColor: companiesTable.primaryColor,
      accentColor: companiesTable.accentColor,
    })
    .from(companiesTable)
    .orderBy(companiesTable.name);
  res.json(rows);
});

/** POST /auth/login */
router.post("/auth/login", async (req, res): Promise<void> => {
  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, body.data.email.toLowerCase()))
    .limit(1);

  if (!user || !user.active) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(body.data.password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Determine initial active company
  let activeCompanyId: number | null = null;
  if (user.superAdmin) {
    const [first] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .orderBy(companiesTable.name)
      .limit(1);
    activeCompanyId = first?.id ?? null;
  } else {
    const [firstRole] = await db
      .select({ companyId: userCompanyRolesTable.companyId })
      .from(userCompanyRolesTable)
      .where(eq(userCompanyRolesTable.userId, user.id))
      .limit(1);
    activeCompanyId = firstRole?.companyId ?? null;
  }

  if (activeCompanyId === null) {
    res.status(403).json({ error: "No company access configured for this user" });
    return;
  }

  req.session.userId = user.id;
  req.session.activeCompanyId = activeCompanyId;

  const dto = await buildAuthDto(user.id, activeCompanyId);
  res.json(dto);
});

/** POST /auth/logout */
router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

/** GET /auth/me */
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const auth = req.auth!;
  const dto = await buildAuthDto(auth.user.id, auth.companyId);
  if (!dto) {
    res.status(401).json({ error: "Session invalid" });
    return;
  }
  res.json(dto);
});

/** POST /auth/switch-company — super-admin only */
router.post("/auth/switch-company", requireAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const body = z.object({ companyId: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [company] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, body.data.companyId))
    .limit(1);

  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  req.session.activeCompanyId = company.id;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );

  const dto = await buildAuthDto(req.auth!.user.id, company.id);
  res.json(dto);
});

/** GET /auth/companies — list all companies (super-admin) or user's companies */
router.get("/auth/companies", requireAuth, async (req, res): Promise<void> => {
  const auth = req.auth!;
  if (auth.user.superAdmin) {
    const companies = await db
      .select({ id: companiesTable.id, name: companiesTable.name, slug: companiesTable.slug })
      .from(companiesTable)
      .orderBy(companiesTable.name);
    res.json(companies);
    return;
  }

  // Regular user: return companies they have roles in
  const roleRows = await db
    .select({ companyId: userCompanyRolesTable.companyId })
    .from(userCompanyRolesTable)
    .where(eq(userCompanyRolesTable.userId, auth.user.id));
  const ids = [...new Set(roleRows.map((r) => r.companyId))];
  if (ids.length === 0) {
    res.json([]);
    return;
  }
  const companies = await db
    .select({ id: companiesTable.id, name: companiesTable.name, slug: companiesTable.slug })
    .from(companiesTable)
    .where(inArray(companiesTable.id, ids))
    .orderBy(companiesTable.name);
  res.json(companies);
});

export default router;
