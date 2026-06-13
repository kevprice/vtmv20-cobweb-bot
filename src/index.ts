import { loadConfig } from "./config.js";
import { CobwebStore } from "./db.js";
import { startBot } from "./bot.js";

const config = loadConfig();
const store = new CobwebStore(config.databasePath);

const shutdown = async (signal: string): Promise<void> => {
  console.log(`Received ${signal}; closing Cobweb store.`);
  store.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await startBot(config, store);

