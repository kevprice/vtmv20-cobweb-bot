import { GuildTextBasedChannel, PermissionFlagsBits, User } from "discord.js";
import { GuildSettings } from "./types.js";

export type PermissionLike = {
  has(permission: bigint): boolean;
};

export type DiagnosticChannel = {
  id: string;
  permissionsFor(user: User): PermissionLike | null;
};

export type ChannelDiagnostic = {
  label: string;
  ok: boolean;
  missing: string[];
};

export const cobwebPermissionRequirements = [
  { label: "View Channel", flag: PermissionFlagsBits.ViewChannel },
  { label: "Send Messages", flag: PermissionFlagsBits.SendMessages },
  { label: "Manage Webhooks", flag: PermissionFlagsBits.ManageWebhooks }
] as const;

export const moderationPermissionRequirements = [
  { label: "View Channel", flag: PermissionFlagsBits.ViewChannel },
  { label: "Send Messages", flag: PermissionFlagsBits.SendMessages },
  { label: "Read Message History", flag: PermissionFlagsBits.ReadMessageHistory }
] as const;

export const diagnoseChannelPermissions = (
  channel: DiagnosticChannel | null,
  botUser: User | null,
  label: string,
  requirements: readonly { label: string; flag: bigint }[]
): ChannelDiagnostic => {
  if (!channel) {
    return { label, ok: false, missing: ["channel unavailable"] };
  }

  if (!botUser) {
    return { label, ok: false, missing: ["bot user unavailable"] };
  }

  const permissions = channel.permissionsFor(botUser);
  if (!permissions) {
    return { label, ok: false, missing: ["permissions unavailable"] };
  }

  const missing = requirements
    .filter((requirement) => !permissions.has(requirement.flag))
    .map((requirement) => requirement.label);

  return { label, ok: missing.length === 0, missing };
};

export const formatChannelDiagnostic = (diagnostic: ChannelDiagnostic): string =>
  diagnostic.ok
    ? `${diagnostic.label}: ready`
    : `${diagnostic.label}: missing ${diagnostic.missing.join(", ")}`;

export const setupMissingFields = (settings: GuildSettings): string[] => {
  const missing: string[] = [];
  if (!settings.cobwebChannelId) missing.push("cobweb channel");
  if (!settings.moderationChannelId) missing.push("moderation channel");
  if (settings.malkavianRoleIds.length === 0) missing.push("Malkavian role");
  if (settings.stRoleIds.length === 0) missing.push("ST/admin role");
  return missing;
};

export const diagnoseCobwebChannel = (
  channel: GuildTextBasedChannel | null,
  botUser: User | null
): ChannelDiagnostic =>
  diagnoseChannelPermissions(channel, botUser, "Cobweb permissions", cobwebPermissionRequirements);

export const diagnoseModerationChannel = (
  channel: GuildTextBasedChannel | null,
  botUser: User | null
): ChannelDiagnostic =>
  diagnoseChannelPermissions(
    channel,
    botUser,
    "Moderation permissions",
    moderationPermissionRequirements
  );
