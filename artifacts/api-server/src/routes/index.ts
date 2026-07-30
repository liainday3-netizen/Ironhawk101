import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradesRouter from "./trades";
import signalsRouter from "./signals";
import portfolioRouter from "./portfolio";
import watchlistRouter from "./watchlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tradesRouter);
router.use(signalsRouter);
router.use(portfolioRouter);
router.use(watchlistRouter);

export default router;
