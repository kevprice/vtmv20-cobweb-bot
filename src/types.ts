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
  webhookId: string | null;
  webhookToken: string | null;
  blockedTerms: string[];
};

export type GuildSettings = {
  guildId: string;
  cobwebChannelId: string | null;
  moderationChannelId: string | null;
  malkavianRoleIds: string[];
  stRoleIds: string[];
  maxLength: number;
  cooldownMinutes: number;
  delayWindowMinutes: number;
  webhookName: string;
  webhookId: string | null;
  webhookToken: string | null;
  blockedTerms: string[];
  createdAt: string;
  updatedAt: string;
};

export type QueuedMessage = {
  id: number;
  guildId: string;
  submitterId: string;
  submitterName: string;
  originalText: string;
  currentText: string;
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
  submitterName: string;
  message: string;
  isStoryteller: boolean;
  scheduledFor?: Date;
};
