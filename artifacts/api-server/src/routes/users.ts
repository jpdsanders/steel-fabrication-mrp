import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  userCompanyRolesTable,
  companiesTable,
} from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { parseIntParam } from "../lib/params";

const router: IRouter = Router();

const CreateUserBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  superAdmin: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  // Optional: assign to a company on creation
  companyId: z.number().int().positive().optional(),
  roles: z.array(z.string()).optional(),
});

const UpdateUserBody = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  superAdmin: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** GET /users — list all users (super-admin only) */
router.get(
  "/users",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
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

    const users = search
      ? await baseQuery.where(
          or(
            ilike(usersTable.name, `%${search}%`),
            ilike(usersTable.email, `%${search}%`),
          ),
        )
      : await baseQuery;

    // Attach company roles for each user
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

/** POST /users — create user (super-admin only) */
router.post(
  "/users",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const body = CreateUserBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues });
      return;
    }

    const passwordHash = await bcrypt.hash(body.data.password, 12);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: body.data.email.toLowerCase(),
        name: body.data.name,
        passwordHash,
        superAdmin: body.data.superAdmin,
        active: body.data.active,
      })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        superAdmin: usersTable.superAdmin,
        active: usersTable.active,
      });

    // Optionally assign to a company
    if (body.data.companyId && body.data.roles && body.data.roles.length > 0) {
      await db.insert(userCompanyRolesTable).values(
        body.data.roles.map((role) => ({
          userId: user.id,
          companyId: body.data.companyId!,
          role,
        })),
      );
    }

    res.status(201).json(user);
  },
);

/** GET /users/:userId */
router.get(
  "/users/:userId",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const id = parseIntParam(req.params.userId as string);
    if (id === null) {
      res.status(400).json({ error: "Invalid id" });
      return;
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
      .where(eq(userCompanyRolesTable.userId, id));

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
  requireSuperAdmin,
  async (req, res): Promise<void> => {
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
