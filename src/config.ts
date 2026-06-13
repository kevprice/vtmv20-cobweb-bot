import "dotenv/config";

const DEFAULT_WORKER_INTERVAL_MS = 30_000;

export type AppConfig = {
  discordToken: string;
  discordClientId: string;
  databasePath: string;
  workerIntervalMs: number;
};

const required = (name: string, value: string | undefined): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const databasePathFromEnv = (): string =>
  process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? "./data/cobweb.db";

export const loadConfig = (): AppConfig => ({
  discordToken: required("DISCORD_TOKEN", process.env.DISCORD_TOKEN),
  discordClientId: required("DISCORD_CLIENT_ID", process.env.DISCORD_CLIENT_ID),
  databasePath: databasePathFromEnv(),
  workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS ?? DEFAULT_WORKER_INTERVAL_MS)
});
