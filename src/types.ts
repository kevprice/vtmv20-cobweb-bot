export const COBWEB_CATEGORIES = [
  "prophecy",
  "noise",
  "plot_hint",
  "red_herring",
  "memory",
  "warning"
] as const;

export type CobwebCategory = (typeof COBWEB_CATEGORIES)[number];

export type QueueStatus = "pending" | "deleted" | "posted" | "failed";

export type GuildConfig = {
  guildId: string;
  cobwebChannelId: string;
  moderationChannelId: string;
  malkavianRoleIds: string[];
  stRoleIds: string[];
  maxLength: number;
  cooldownMinutes: number;
  delayWindowMinutes: number;
  webhookName: string;
  blockedTerms: string[];
};

export type RawGuildConfig = Partial<GuildConfig> &
  Pick<GuildConfig, "guildId" | "cobwebChannelId" | "moderationChannelId"> & {
    malkavianRoleIds?: string[];
    stRoleIds?: string[];
  };

export type QueuedMessage = {
  id: number;
  guildId: string;
  submitterId: string;
  originalText: string;
  currentText: string;
  category: CobwebCategory | null;
  scheduledFor: string;
  status: QueueStatus;
  moderationMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
  failureReason: string | null;
};

export type SubmissionInput = {
  guildId: string;
  submitterId: string;
  message: string;
  category?: CobwebCategory | null;
  isStoryteller: boolean;
};

