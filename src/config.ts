import "dotenv/config";
import { GuildConfig, RawGuildConfig } from "./types.js";

const DEFAULT_MAX_LENGTH = 180;
const DEFAULT_COOLDOWN_MINUTES = 15;
const DEFAULT_DELAY_WINDOW_MINUTES = 60;
const DEFAULT_WEBHOOK_NAME = "Cobweb";
const DEFAULT_WORKER_INTERVAL_MS = 30_000;

export type AppConfig = {
  discordToken: string;
  discordClientId: string;
  databasePath: string;
  workerIntervalMs: number;
  guilds: GuildConfig[];
};

const required = (name: string, value: string | undefined): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
};

export const parseGuildConfigs = (raw: string | undefined): GuildConfig[] => {
  const value = required("GUILD_CONFIGS", raw);
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`GUILD_CONFIGS must be valid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("GUILD_CONFIGS must be a non-empty JSON array");
  }

  return parsed.map((entry, index) => normalizeGuildConfig(entry, index));
};

const normalizeGuildConfig = (entry: unknown, index: number): GuildConfig => {
  if (!entry || typeof entry !== "object") {
    throw new Error(`GUILD_CONFIGS[${index}] must be an object`);
  }

  const raw = entry as RawGuildConfig;
  const guildId = required(`GUILD_CONFIGS[${index}].guildId`, raw.guildId);
  const cobwebChannelId = required(
    `GUILD_CONFIGS[${index}].cobwebChannelId`,
    raw.cobwebChannelId
  );
  const moderationChannelId = required(
    `GUILD_CONFIGS[${index}].moderationChannelId`,
    raw.moderationChannelId
  );

  return {
    guildId,
    cobwebChannelId,
    moderationChannelId,
    malkavianRoleIds: Array.isArray(raw.malkavianRoleIds) ? raw.malkavianRoleIds : [],
    stRoleIds: Array.isArray(raw.stRoleIds) ? raw.stRoleIds : [],
    maxLength: toPositiveInt(raw.maxLength, DEFAULT_MAX_LENGTH),
    cooldownMinutes: toPositiveInt(raw.cooldownMinutes, DEFAULT_COOLDOWN_MINUTES),
    delayWindowMinutes: toPositiveInt(raw.delayWindowMinutes, DEFAULT_DELAY_WINDOW_MINUTES),
    webhookName:
      typeof raw.webhookName === "string" && raw.webhookName.trim().length > 0
        ? raw.webhookName.trim()
        : DEFAULT_WEBHOOK_NAME,
    blockedTerms: Array.isArray(raw.blockedTerms)
      ? raw.blockedTerms.filter((term): term is string => typeof term === "string")
      : []
  };
};

export const loadConfig = (): AppConfig => ({
  discordToken: required("DISCORD_TOKEN", process.env.DISCORD_TOKEN),
  discordClientId: required("DISCORD_CLIENT_ID", process.env.DISCORD_CLIENT_ID),
  databasePath: process.env.DATABASE_PATH ?? "./data/cobweb.db",
  workerIntervalMs: Number(process.env.WORKER_INTERVAL_MS ?? DEFAULT_WORKER_INTERVAL_MS),
  guilds: parseGuildConfigs(process.env.GUILD_CONFIGS)
});

