import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobsRouter from "./jobs";
import estimatesRouter from "./estimates";
import stagesRouter from "./stages";
import stageLibraryRouter from "./stageLibrary";
import employeesRouter from "./employees";
import timeRouter from "./time";
import dashboardRouter from "./dashboard";
import documentsRouter from "./documents";
import customersRouter from "./customers";
import bomRouter from "./bom";
import purchaseOrdersRouter from "./purchaseOrders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(jobsRouter);
router.use(estimatesRouter);
router.use(stagesRouter);
router.use(stageLibraryRouter);
router.use(employeesRouter);
router.use(timeRouter);
router.use(dashboardRouter);
router.use(documentsRouter);
router.use(customersRouter);
router.use(bomRouter);
router.use(purchaseOrdersRouter);

export default router;
