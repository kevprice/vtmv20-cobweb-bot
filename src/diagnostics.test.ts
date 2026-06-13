import { describe, expect, it } from "vitest";
import { PermissionFlagsBits, User } from "discord.js";
import {
  diagnoseChannelPermissions,
  formatChannelDiagnostic,
  setupMissingFields
} from "./diagnostics.js";
import { GuildSettings } from "./types.js";

const user = {} as User;

const channelWith = (permissions: bigint[]) => ({
  id: "channel",
  permissionsFor: () => ({
    has: (permission: bigint) => permissions.includes(permission)
  })
});

describe("diagnostics", () => {
  it("formats missing channel permissions", () => {
    const diagnostic = diagnoseChannelPermissions(
      channelWith([PermissionFlagsBits.ViewChannel]),
      user,
      "Cobweb permissions",
      [
        { label: "View Channel", flag: PermissionFlagsBits.ViewChannel },
        { label: "Send Messages", flag: PermissionFlagsBits.SendMessages },
        { label: "Manage Webhooks", flag: PermissionFlagsBits.ManageWebhooks }
      ]
    );

    expect(diagnostic).toEqual({
      label: "Cobweb permissions",
      ok: false,
      missing: ["Send Messages", "Manage Webhooks"]
    });
    expect(formatChannelDiagnostic(diagnostic)).toBe(
      "Cobweb permissions: missing Send Messages, Manage Webhooks"
    );
  });

  it("reports ready channel permissions", () => {
    const diagnostic = diagnoseChannelPermissions(
      channelWith([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
      user,
      "Moderation permissions",
      [
        { label: "View Channel", flag: PermissionFlagsBits.ViewChannel },
        { label: "Send Messages", flag: PermissionFlagsBits.SendMessages }
      ]
    );

    expect(formatChannelDiagnostic(diagnostic)).toBe("Moderation permissions: ready");
  });

  it("reports missing setup fields", () => {
    const settings: GuildSettings = {
      guildId: "guild",
      cobwebChannelId: "feed",
      moderationChannelId: null,
      malkavianRoleIds: [],
      stRoleIds: ["st"],
      maxLength: 180,
      cooldownMinutes: 15,
      delayWindowMinutes: 60,
      webhookName: "Cobweb",
      webhookId: null,
      webhookToken: null,
      blockedTerms: [],
      createdAt: "2026-06-13T12:00:00.000Z",
      updatedAt: "2026-06-13T12:00:00.000Z"
    };

    expect(setupMissingFields(settings)).toEqual(["moderation channel", "Malkavian role"]);
  });
});
