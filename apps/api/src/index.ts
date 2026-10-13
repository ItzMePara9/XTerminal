import { buildApp } from "./app.js";
import { config, assertProductionConfig } from "./config.js";
import { logger, prisma } from "./context.js";
import { sshManager } from "./services/ssh/manager.js";
import { masterKey } from "@xterminal/crypto";

async function main(): Promise<void> {
  if (config.isProd) {
    assertProductionConfig();
  }
  // Fail fast when the vault key is missing in any environment that expects one.
  try {
    masterKey();
  } catch {
    if (config.isProd) throw new Error("ENCRYPTION_KEY is required in production");
    logger.warn("ENCRYPTION_KEY not set - credential vault disabled until configured");
  }

  const app = await buildApp();

  const address = await app.listen({
    host: config.host,
    port: config.port,
  });
  logger.info({ address }, `XTerminal listening on ${address}`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    // End every SSH session cleanly - no orphaned PTYs.
    sshManager.shutdownAll();
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandled rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaught exception - exiting");
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  console.error(err);
  process.exit(1);
});
