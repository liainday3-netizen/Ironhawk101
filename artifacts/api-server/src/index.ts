import app from "./app";
import { logger } from "./lib/logger";
import { beginTradingSession } from "./lib/tradingMode";

// Evaluate the trading configuration before anything binds a port. A process
// that is armed for live trading but missing part of its configuration
// terminates here, in the deploy log, rather than booting into a mode the
// operator did not intend.
const session = beginTradingSession();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, mode: session.mode }, "Server listening");
});
