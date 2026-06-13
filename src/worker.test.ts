import { describe, expect, it, vi } from "vitest";
import { CobwebStore } from "./db.js";
import { CobwebWorker, Publisher } from "./worker.js";
import { GuildConfig } from "./types.js";

const config: GuildConfig = {
  guildId: "guild",
  cobwebChannelId: "feed",
  moderationChannelId: "mod",
  malkavianRoleIds: [],
  stRoleIds: [],
  maxLength: 180,
  cooldownMinutes: 15,
  delayWindowMinutes: 60,
  webhookName: "Cobweb",
  webhookId: null,
  webhookToken: null,
  blockedTerms: []
};

describe("CobwebWorker", () => {
  it("publishes due messages and marks them posted", async () => {
    const store = new CobwebStore();
    const queued = store.createQueuedMessage({
      guildId: "guild",
      submitterId: "user",
      submitterName: "Ariadne",
      text: "The docks remember.",
      scheduledFor: new Date("2026-06-13T12:00:00.000Z")
    });
    const publisher: Publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const worker = new CobwebWorker(
      store,
      () => config,
      publisher,
      async () => null,
      30_000
    );

    await worker.tick(new Date("2026-06-13T12:01:00.000Z"));

    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(store.getQueuedMessage(queued.id)?.status).toBe("posted");
    store.close();
  });

  it("marks failed publishes retryable with actionable permission text", async () => {
    const store = new CobwebStore();
    const queued = store.createQueuedMessage({
      guildId: "guild",
      submitterId: "user",
      submitterName: "Ariadne",
      text: "The docks remember.",
      scheduledFor: new Date("2026-06-13T12:00:00.000Z")
    });
    const publisher: Publisher = {
      publish: vi
        .fn()
        .mockRejectedValue(new Error("Bot is missing Manage Webhooks in #cobweb"))
    };
    const worker = new CobwebWorker(
      store,
      () => config,
      publisher,
      async () => null,
      30_000
    );

    await worker.tick(new Date("2026-06-13T12:01:00.000Z"));

    const failed = store.getQueuedMessage(queued.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBe("Bot is missing Manage Webhooks in #cobweb");
    expect(store.listDueMessages(new Date("2026-06-13T12:02:00.000Z"))).toHaveLength(1);
    store.close();
  });
});
