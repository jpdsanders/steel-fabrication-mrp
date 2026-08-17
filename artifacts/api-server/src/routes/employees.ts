import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { employeesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  ListEmployeesResponse,
} from "@workspace/api-zod";
import { parseIntParam, parseQueryBool } from "../lib/params";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

function toView(row: typeof employeesTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    employeeCode: row.employeeCode,
    jobTitle: row.jobTitle,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/employees", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const activeOnly = parseQueryBool(req.query.activeOnly);
  const conditions = [eq(employeesTable.companyId, companyId)];
  if (activeOnly) conditions.push(eq(employeesTable.active, true));
  const rows = await db
    .select()
    .from(employeesTable)
    .where(and(...conditions))
    .orderBy(employeesTable.name);
  res.json(ListEmployeesResponse.parse(rows.map(toView)));
});

router.post("/employees", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const body = CreateEmployeeBody.parse(req.body);
  const [row] = await db
    .insert(employeesTable)
    .values({
      companyId,
      name: body.name,
      employeeCode: body.employeeCode ?? null,
      jobTitle: body.jobTitle ?? null,
      active: body.active ?? true,
    })
    .returning();
  res.status(201).json(toView(row));
});

router.patch("/employees/:employeeId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const employeeId = parseIntParam(req.params.employeeId);
  if (employeeId === null) {
    res.status(400).json({ error: "Invalid employee id" });
    return;
  }
  const body = UpdateEmployeeBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  await db
    .update(employeesTable)
    .set(body)
    .where(eq(employeesTable.id, employeeId));
  const [row] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
  res.json(toView(row));
});

router.delete("/employees/:employeeId", requireAuth, async (req, res): Promise<void> => {
  const companyId = req.auth!.companyId;
  const employeeId = parseIntParam(req.params.employeeId);
  if (employeeId === null) {
    res.status(400).json({ error: "Invalid employee id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.companyId, companyId)));
  if (!existing) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  res.status(204).send();
});

export default router;
