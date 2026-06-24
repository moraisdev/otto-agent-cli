import { OttoBot } from "./bot.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  logger.info("Initializing Otto bot...");

  try {
    const config = loadConfig();
    logger.setLevel(config.logLevel);

    const bot = new OttoBot({ config });

    // Handle shutdown signals
    const shutdown = async () => {
      logger.info("Received shutdown signal");
      await bot.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start the bot
    await bot.start();

    logger.info("Otto bot is running. Press Ctrl+C to stop.");
  } catch (err) {
    logger.error("Failed to start Otto bot", err);
    process.exit(1);
  }
}

main();
