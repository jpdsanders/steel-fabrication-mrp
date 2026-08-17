import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable, userCompanyRolesTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// Extend Express session to include our auth fields
declare module "express-session" {
  interface SessionData {
    userId: number;
    activeCompanyId: number;
  }
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  superAdmin: boolean;
  active: boolean;
}

export interface AuthContext {
  user: AuthUser;
  companyId: number;
  roles: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Dev-only auth bypass (Update Brief 02 §4).
 * Structurally inert in production: the NODE_ENV check is part of this
 * function, so setting DEV_BYPASS_AUTH=true alone can never activate the
 * bypass when the app runs with NODE_ENV=production.
 */
export function isAuthBypassActive(): boolean {
  // Explicit development allow-list: an unset or unknown NODE_ENV (e.g. a
  // misconfigured production deployment) can never enable the bypass.
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_BYPASS_AUTH === "true"
  );
}

const BYPASS_USER_EMAIL =
  process.env.DEV_BYPASS_USER_EMAIL || "jsanders@exclusivefab.com";

/** Populate req.auth as the designated test user. Returns false if unavailable. */
async function loadBypassAuth(req: Request): Promise<boolean> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, BYPASS_USER_EMAIL.toLowerCase()))
    .limit(1);
  if (!user || !user.active) return false;

  // First available company: any company for super-admins, else first role row
  let companyId: number | undefined;
  let roles: string[];
  if (user.superAdmin) {
    const [first] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .orderBy(companiesTable.name)
      .limit(1);
    companyId = first?.id;
    roles = ["super_admin"];
  } else {
    const [firstRole] = await db
      .select({
        companyId: userCompanyRolesTable.companyId,
        role: userCompanyRolesTable.role,
      })
      .from(userCompanyRolesTable)
      .where(eq(userCompanyRolesTable.userId, user.id))
      .limit(1);
    companyId = firstRole?.companyId;
    roles = firstRole ? [firstRole.role] : [];
  }
  if (!companyId) return false;

  // Respect an explicit company switch stored on the session (super-admins)
  const session = req.session as { activeCompanyId?: number };
  if (session.activeCompanyId && user.superAdmin) {
    companyId = session.activeCompanyId;
  }

  req.auth = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      superAdmin: user.superAdmin,
      active: user.active,
    },
    companyId,
    roles,
  };
  return true;
}

/** Load user + company context from session. Attaches req.auth if valid. */
export async function loadAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (isAuthBypassActive()) {
    await loadBypassAuth(req);
    next();
    return;
  }

  const session = req.session as { userId?: number; activeCompanyId?: number };
  if (!session.userId) {
    next();
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  if (!user || !user.active) {
    next();
    return;
  }

  const companyId = session.activeCompanyId;
  if (!companyId) {
    next();
    return;
  }

  // Verify company exists
  const [company] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);

  if (!company) {
    next();
    return;
  }

  let roles: string[] = [];
  if (!user.superAdmin) {
    const roleRows = await db
      .select({ role: userCompanyRolesTable.role })
      .from(userCompanyRolesTable)
      .where(
        and(
          eq(userCompanyRolesTable.userId, user.id),
          eq(userCompanyRolesTable.companyId, companyId),
        ),
      );
    roles = roleRows.map((r) => r.role);
    // Non-super-admin with no roles in this company → reject
    if (roles.length === 0) {
      next();
      return;
    }
  } else {
    roles = ["super_admin"];
  }

  req.auth = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      superAdmin: user.superAdmin,
      active: user.active,
    },
    companyId,
    roles,
  };
  next();
}

/** Require authenticated session. Returns 401 if not authenticated. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Require one of the given company roles (super-admins always pass).
 * Returns 403 otherwise. Use after requireAuth.
 */
export function requireRole(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (auth.user.superAdmin || auth.roles.some((r) => allowed.includes(r))) {
      next();
      return;
    }
    res.status(403).json({
      error: `Forbidden: requires one of the following roles: ${allowed.join(", ")}`,
    });
  };
}

/** Require super_admin. Returns 403 if not super-admin. */
export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth?.user.superAdmin) {
    res.status(403).json({ error: "Forbidden: super-admin required" });
    return;
  }
  next();
}
