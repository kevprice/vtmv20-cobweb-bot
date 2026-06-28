import { describe, expect, it } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import { commandData, CWSETUP_COMMAND } from "./commands.js";

describe("commandData", () => {
  it("restricts cwsetup visibility to users with Manage Server", () => {
    const command = commandData().find((entry) => entry.name === CWSETUP_COMMAND);

    expect(command?.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
    expect(command?.options).toEqual([]);
  });
});
