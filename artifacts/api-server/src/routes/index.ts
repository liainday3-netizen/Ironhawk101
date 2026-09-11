import { Router, type IRouter } from "express";
import scannerRouter from "./scanner";
import marketRouter from "./market";
import traderRouter from "./trader";

const router: IRouter = Router();

router.use(scannerRouter);
router.use(marketRouter);
router.use(traderRouter);

export default router;
