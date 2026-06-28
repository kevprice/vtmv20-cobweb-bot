import { describe, expect, it } from "vitest";
import { CobwebStore } from "./db.js";

describe("CobwebStore", () => {
  it("persists guild setup and returns runnable config when required fields exist", () => {
    const store = new CobwebStore();

    let settings = store.ensureGuildSettings("guild");
    expect(settings.maxLength).toBe(180);
    expect(store.getRunnableGuildConfig("guild")).toBeNull();

    settings = store.setGuildChannel("guild", "cobwebChannelId", "feed");
    settings = store.setGuildChannel("guild", "moderationChannelId", "mod");
    settings = store.addGuildRole("guild", "malkavianRoleIds", "malk");
    settings = store.addGuildRole("guild", "stRoleIds", "st");
    settings = store.setGuildRoles("guild", "malkavianRoleIds", ["malk", "malk-2", "malk"]);
    settings = store.setGuildNumber("guild", "maxLength", 140);
    settings = store.setBlockedTerms("guild", ["Victor Temple", "victor temple", "  Janus  "]);
    settings = store.setGuildWebhook("guild", "webhook-id", "webhook-token");

    expect(settings.blockedTerms).toEqual(["Victor Temple", "Janus"]);
    expect(settings.webhookId).toBe("webhook-id");

    const runnable = store.getRunnableGuildConfig("guild");
    expect(runnable).toMatchObject({
      guildId: "guild",
      cobwebChannelId: "feed",
      moderationChannelId: "mod",
      malkavianRoleIds: ["malk", "malk-2"],
      stRoleIds: ["st"],
      maxLength: 140,
      webhookId: "webhook-id",
      webhookToken: "webhook-token",
      blockedTerms: ["Victor Temple", "Janus"]
    });

    store.close();
  });

  it("tracks queue lifecycle", () => {
    const store = new CobwebStore();
    const queued = store.createQueuedMessage({
      guildId: "guild",
      submitterId: "user",
      submitterName: "Ariadne",
      text: "The mirror coughs.",
      scheduledFor: new Date("2026-06-13T12:00:00.000Z")
    });

    expect(queued.status).toBe("pending");
    expect(queued.submitterName).toBe("Ariadne");

    store.setModerationMessageId(queued.id, "message-id");
    const edited = store.editQueuedMessage(queued.id, "The mirror lies.");
    expect(edited?.currentText).toBe("The mirror lies.");
    expect(edited?.moderationMessageId).toBe("message-id");

    const due = store.listDueMessages(new Date("2026-06-13T12:01:00.000Z"));
    expect(due).toHaveLength(1);

    const posted = store.markPosted(queued.id, new Date("2026-06-13T12:02:00.000Z"));
    expect(posted?.status).toBe("posted");
    expect(posted?.postedAt).toBe("2026-06-13T12:02:00.000Z");

    store.close();
  });

  it("does not return deleted messages as due", () => {
    const store = new CobwebStore();
    const queued = store.createQueuedMessage({
      guildId: "guild",
      submitterId: "user",
      submitterName: "Ariadne",
      text: "gone",
      scheduledFor: new Date("2026-06-13T12:00:00.000Z")
    });

    store.deleteQueuedMessage(queued.id);
    expect(store.listDueMessages(new Date("2026-06-13T12:01:00.000Z"))).toHaveLength(0);

    store.close();
  });
});
