import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import healthRouter from "./routes/health";
import { requireAuth } from "./middlewares/auth";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { logger } from "./lib/logger";
import { startScanner } from "./lib/scanner";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk's frontend API proxy must run before body parsers so it can stream raw
// request bodies in production.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health is intentionally public for deployment probes. All application data
// requires a Clerk session, and trading mutations add an owner allowlist check.
app.use("/api", healthRouter);
app.use("/api", requireAuth, router);

// Start the IronHawk scanner after the server is initialized.
//
// The scanner runs in every configuration, including monitor mode: that is
// deliberate, because a deployment with trading unset is the way to collect
// the signal history that any decision to go live depends on. What changes
// with the environment is whether signals can become orders, not whether the
// engine observes the market. beginTradingSession reports which mode this
// process is in and refuses to start if trading is armed but misconfigured.
startScanner();

export default app;
