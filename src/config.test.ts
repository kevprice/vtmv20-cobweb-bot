import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

const loadFreshConfigModule = async () => import("./config.js");

describe("loadConfig", () => {
  it("accepts Railway volume-style SQLite paths", async () => {
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_CLIENT_ID = "client";
    process.env.DATABASE_URL = "/data/cobweb.db";
    process.env.PORT = "3000";

    const { loadConfig } = await loadFreshConfigModule();

    expect(loadConfig()).toMatchObject({
      discordToken: "token",
      discordClientId: "client",
      databasePath: "/data/cobweb.db",
      healthPort: 3000
    });
  });

  it("rejects Postgres DATABASE_URL values until a Postgres store exists", async () => {
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_CLIENT_ID = "client";
    process.env.DATABASE_URL = "postgres://user:pass@example.com/db";

    const { loadConfig } = await loadFreshConfigModule();

    expect(() => loadConfig()).toThrow("Postgres-style DATABASE_URL values are not supported yet");
  });
});
