import { describe, expect, it } from "vitest";
import { CobwebStore } from "./db.js";
import { submitCobwebMessage } from "./queue.js";
import { GuildConfig } from "./types.js";

const guildConfig: GuildConfig = {
  guildId: "guild",
  cobwebChannelId: "cobweb",
  moderationChannelId: "mod",
  malkavianRoleIds: ["malk"],
  stRoleIds: ["st"],
  maxLength: 180,
  cooldownMinutes: 15,
  delayWindowMinutes: 60,
  webhookName: "Cobweb",
  webhookId: null,
  webhookToken: null,
  blockedTerms: []
};

describe("submitCobwebMessage", () => {
  it("queues a valid message with a random scheduled time within the next hour", () => {
    const store = new CobwebStore();
    const now = new Date("2026-06-13T12:00:00.000Z");

    const result = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "user",
        submitterName: "Ariadne",
        message: "The river remembers.",
        isStoryteller: false
      },
      now,
      () => 0.5
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.queued.currentText).toBe("The river remembers.");
      expect(result.queued.scheduledFor).toBe("2026-06-13T12:30:00.000Z");
    }

    store.close();
  });

  it("enforces cooldown per user and guild", () => {
    const store = new CobwebStore();
    const now = new Date("2026-06-13T12:00:00.000Z");

    const first = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "user",
        submitterName: "Ariadne",
        message: "one",
        isStoryteller: false
      },
      now,
      () => 0
    );
    const second = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "user",
        submitterName: "Ariadne",
        message: "two",
        isStoryteller: false
      },
      new Date("2026-06-13T12:05:00.000Z"),
      () => 0
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("The Cobweb is still full of your last whisper. Try again later.");
    }

    store.close();
  });

  it("does not enforce cooldown for storyteller submissions", () => {
    const store = new CobwebStore();
    const now = new Date("2026-06-13T12:00:00.000Z");

    const first = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "st-user",
        submitterName: "Storyteller",
        message: "one",
        isStoryteller: true,
        scheduledFor: now
      },
      now
    );
    const second = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "st-user",
        submitterName: "Storyteller",
        message: "two",
        isStoryteller: true,
        scheduledFor: new Date("2026-06-13T12:05:00.000Z")
      },
      new Date("2026-06-13T12:01:00.000Z")
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.queued.scheduledFor).toBe("2026-06-13T12:00:00.000Z");
      expect(second.queued.scheduledFor).toBe("2026-06-13T12:05:00.000Z");
    }

    store.close();
  });

  it("allows out-of-order scheduling after cooldown", () => {
    const store = new CobwebStore();

    const first = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "user",
        submitterName: "Ariadne",
        message: "late",
        isStoryteller: false
      },
      new Date("2026-06-13T12:00:00.000Z"),
      () => 0.9
    );
    const second = submitCobwebMessage(
      store,
      guildConfig,
      {
        guildId: "guild",
        submitterId: "user",
        submitterName: "Ariadne",
        message: "early",
        isStoryteller: false
      },
      new Date("2026-06-13T12:16:00.000Z"),
      () => 0.1
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(new Date(second.queued.scheduledFor).getTime()).toBeLessThan(
        new Date(first.queued.scheduledFor).getTime()
      );
    }

    store.close();
  });
});
