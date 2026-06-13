import "dotenv/config";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKER_INTERVAL_MS = 30_000;

export type AppConfig = {
  discordToken: string;
  discordClientId: string;
  databasePath: string;
  workerIntervalMs: number;
  healthPort: number | null;
};

const required = (name: string, value: string | undefined): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const databasePathFromEnv = (): string => {
  const raw = process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? "./data/cobweb.db";

  if (raw.startsWith("file:")) {
    return fileURLToPath(raw);
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    throw new Error(
      "DATABASE_URL must be a SQLite file path or file: URL. Postgres-style DATABASE_URL values are not supported yet."
    );
  }

  return raw;
};

const optionalPort = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
};

export const loadConfig = (): AppConfig => ({
  discordToken: required("DISCORD_TOKEN", process.env.DISCORD_TOKEN),
  discordClientId: required("DISCORD_CLIENT_ID", process.env.DISCORD_CLIENT_ID),
  databasePath: databasePathFromEnv(),
  workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS ?? DEFAULT_WORKER_INTERVAL_MS),
  healthPort: optionalPort(process.env.PORT)
});
