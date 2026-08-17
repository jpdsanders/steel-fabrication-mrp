import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  userCompanyRolesTable,
  companiesTable,
  COMPANY_ROLES,
  type CompanyRole,
} from "@workspace/db";
import { eq, ilike, or, and, inArray } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAuth, requireRole } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

const RoleEnum = z.enum(
  COMPANY_ROLES as unknown as [CompanyRole, ...CompanyRole[]],
);

const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  superAdmin: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  companyId: z.number().int().positive().optional(),
  roles: z.array(RoleEnum).optional(),
});

const UpdateUserBody = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  superAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** True when the caller is a global super-admin. */
function isSuper(req: { auth?: { user: { superAdmin: boolean } } }): boolean {
  return !!req.auth?.user.superAdmin;
}

/** User ids that have at least one role in the given company. */
async function userIdsInCompany(companyId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ userId: userCompanyRolesTable.userId })
    .from(userCompanyRolesTable)
    .where(eq(userCompanyRolesTable.companyId, companyId));
  return rows.map((r) => r.userId);
}

/**
 * GET /users — list users.
 * Super-admin: all users (optional ?companyId= filter).
 * Company admin: only users with a role in the caller's active company.
 */
router.get(
  "/users",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const auth = req.auth!;
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;

    // Determine company scope
    let scopeCompanyId: number | undefined;
    if (isSuper(req)) {
      const q = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
      if (q !== undefined) {
        const parsed = parseIntParam(q);
        if (parsed === null) {
          res.status(400).json({ error: "Invalid companyId" });
          return;
        }
        scopeCompanyId = parsed;
      }
    } else {
      scopeCompanyId = auth.companyId;
    }

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(usersTable.name, `%${search}%`),
          ilike(usersTable.email, `%${search}%`),
        ),
      );
    }
    if (scopeCompanyId !== undefined) {
      const ids = await userIdsInCompany(scopeCompanyId);
      if (ids.length === 0) {
        res.json([]);
        return;
      }
      conditions.push(inArray(usersTable.id, ids));
    }

    const baseQuery = db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        superAdmin: usersTable.superAdmin,
        active: usersTable.active,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable);

    const users =
      conditions.length > 0
        ? await baseQuery.where(and(...conditions))
        : await baseQuery;

    // Attach company roles. Non-super-admin callers only see role assignments
    // for their own company — no cross-company visibility.
    const roleRows = await db
      .select({
        userId: userCompanyRolesTable.userId,
        companyId: userCompanyRolesTable.companyId,
        role: userCompanyRolesTable.role,
        companyName: companiesTable.name,
      })
      .from(userCompanyRolesTable)
      .innerJoin(
        companiesTable,
        eq(userCompanyRolesTable.companyId, companiesTable.id),
      )
      .where(
        isSuper(req)
          ? undefined
          : eq(userCompanyRolesTable.companyId, auth.companyId),
      );

    const result = users.map((u) => ({
      ...u,
      companies: roleRows
        .filter((r) => r.userId === u.id)
        .reduce(
          (acc, r) => {
            let c = acc.find((x) => x.id === r.companyId);
            if (!c) {
              c = { id: r.companyId, name: r.companyName, roles: [] };
              acc.push(c);
            }
            c.roles.push(r.role);
            return acc;
          },
          [] as { id: number; name: string; roles: string[] }[],
        ),
    }));

    res.json(result);
  },
);

/**
 * POST /users — create user.
 * Company admin: forced to own company, cannot grant superAdmin.
 * Non-super-admin accounts always require a company + at least one role so
 * every created user can log in immediately.
 */
router.post(
  "/users",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const auth = req.auth!;
    const body = CreateUserBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues });
      return;
    }
    const data = body.data;

    if (!isSuper(req)) {
      if (data.superAdmin) {
        res.status(403).json({ error: "Only super-admins can grant super-admin" });
        return;
      }
      if (data.companyId !== undefined && data.companyId !== auth.companyId) {
        res.status(403).json({ error: "Cannot create users in another company" });
        return;
      }
      data.companyId = auth.companyId;
    }

    // Every non-super-admin account must be created with a usable assignment.
    if (!data.superAdmin) {
      if (!data.companyId || !data.roles || data.roles.length === 0) {
        res.status(400).json({
          error: "companyId and at least one role are required for non-super-admin users",
        });
        return;
      }
    }

    // Verify target company exists (also guards super-admin typos)
    if (data.companyId) {
      const [company] = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, data.companyId))
        .limit(1);
      if (!company) {
        res.status(400).json({ error: "Company not found" });
        return;
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(usersTable)
        .values({
          email: data.email.toLowerCase(),
          name: data.name,
          passwordHash,
          superAdmin: data.superAdmin,
          active: data.active,
        })
        .returning({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          superAdmin: usersTable.superAdmin,
          active: usersTable.active,
        });

      if (data.companyId && data.roles && data.roles.length > 0) {
        await tx.insert(userCompanyRolesTable).values(
          data.roles.map((role) => ({
            userId: created.id,
            companyId: data.companyId!,
            role,
          })),
        );
      }
      return created;
    });

    res.status(201).json(user);
  },
);

/** GET /users/:userId */
router.get(
  "/users/:userId",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const auth = req.auth!;
    const id = parseIntParam(req.params.userId as string);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    if (!isSuper(req)) {
      const ids = await userIdsInCompany(auth.companyId);
      if (!ids.includes(id)) {
        res.status(404).json({ error: "User not found" });
        return;
      }
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        superAdmin: usersTable.superAdmin,
        active: usersTable.active,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, id))
      .limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const roleRows = await db
      .select({
        companyId: userCompanyRolesTable.companyId,
        role: userCompanyRolesTable.role,
        companyName: companiesTable.name,
      })
      .from(userCompanyRolesTable)
      .innerJoin(
        companiesTable,
        eq(userCompanyRolesTable.companyId, companiesTable.id),
      )
      .where(
        isSuper(req)
          ? eq(userCompanyRolesTable.userId, id)
          : and(
              eq(userCompanyRolesTable.userId, id),
              eq(userCompanyRolesTable.companyId, auth.companyId),
            ),
      );

    res.json({
      ...user,
      companies: roleRows.reduce(
        (acc, r) => {
          let c = acc.find((x) => x.id === r.companyId);
          if (!c) {
            c = { id: r.companyId, name: r.companyName, roles: [] };
            acc.push(c);
          }
          c.roles.push(r.role);
          return acc;
        },
        [] as { id: number; name: string; roles: string[] }[],
      ),
    });
  },
);

/** PATCH /users/:userId */
router.patch(
  "/users/:userId",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const auth = req.auth!;
    const id = parseIntParam(req.params.userId as string);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const body = UpdateUserBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues });
      return;
    }

    if (!isSuper(req)) {
      // Company admins can never touch the superAdmin flag
      if (body.data.superAdmin !== undefined) {
        res.status(403).json({ error: "Only super-admins can change super-admin status" });
        return;
      }
      // Target must belong to the caller's company
      const ids = await userIdsInCompany(auth.companyId);
      if (!ids.includes(id)) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      // Company admins cannot edit super-admin accounts
      const [target] = await db
        .select({ superAdmin: usersTable.superAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);
      if (target?.superAdmin) {
        res.status(403).json({ error: "Cannot edit a super-admin account" });
        return;
      }
      // Shared accounts: PATCH mutates global account fields (active, email,
      // password, name). If the target also has access to another company,
      // letting a company admin change these would affect the other
      // company's access — a cross-company violation. Only a super-admin may
      // edit shared accounts.
      const targetCompanies = await db
        .selectDistinct({ companyId: userCompanyRolesTable.companyId })
        .from(userCompanyRolesTable)
        .where(eq(userCompanyRolesTable.userId, id));
      if (targetCompanies.some((c) => c.companyId !== auth.companyId)) {
        res.status(403).json({
          error:
            "This user also belongs to another company; only a super-admin can edit shared accounts",
        });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.data.name) updates.name = body.data.name;
    if (body.data.email) updates.email = body.data.email.toLowerCase();
    if (body.data.password)
      updates.passwordHash = await bcrypt.hash(body.data.password, 12);
    if (body.data.superAdmin !== undefined) updates.superAdmin = body.data.superAdmin;
    if (body.data.active !== undefined) updates.active = body.data.active;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        superAdmin: usersTable.superAdmin,
        active: usersTable.active,
      });
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(updated);
  },
);

export default router;
