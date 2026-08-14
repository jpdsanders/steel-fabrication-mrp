import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  ListEmployeesResponse,
} from "@workspace/api-zod";
import { parseIntParam, parseQueryBool } from "../lib/params";

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

router.get("/employees", async (req, res): Promise<void> => {
  const activeOnly = parseQueryBool(req.query.activeOnly);
  const rows = await db
    .select()
    .from(employeesTable)
    .where(activeOnly ? eq(employeesTable.active, true) : undefined)
    .orderBy(employeesTable.name);
  res.json(ListEmployeesResponse.parse(rows.map(toView)));
});

router.post("/employees", async (req, res): Promise<void> => {
  const body = CreateEmployeeBody.parse(req.body);
  const [row] = await db
    .insert(employeesTable)
    .values({
      name: body.name,
      employeeCode: body.employeeCode ?? null,
      jobTitle: body.jobTitle ?? null,
      active: body.active ?? true,
    })
    .returning();
  res.status(201).json(toView(row));
});

router.patch("/employees/:employeeId", async (req, res): Promise<void> => {
  const employeeId = parseIntParam(req.params.employeeId);
  if (employeeId === null) {
    res.status(400).json({ error: "Invalid employee id" });
    return;
  }
  const body = UpdateEmployeeBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
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

router.delete("/employees/:employeeId", async (req, res): Promise<void> => {
  const employeeId = parseIntParam(req.params.employeeId);
  if (employeeId === null) {
    res.status(400).json({ error: "Invalid employee id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
  if (!existing) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  await db.delete(employeesTable).where(eq(employeesTable.id, employeeId));
  res.status(204).send();
});

export default router;
