import { Router, type IRouter } from "express";
import { getDashboardSummary, getDashboardJobs } from "../services/production";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  res.json(await getDashboardSummary());
});

router.get("/dashboard/jobs", async (_req, res): Promise<void> => {
  res.json(await getDashboardJobs());
});

export default router;
