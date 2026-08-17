import { Router, type IRouter } from "express";
import { getDashboardSummary, getDashboardJobs } from "../services/production";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  res.json(await getDashboardSummary(req.auth!.companyId));
});

router.get("/dashboard/jobs", requireAuth, async (req, res): Promise<void> => {
  res.json(await getDashboardJobs(req.auth!.companyId));
});

export default router;
