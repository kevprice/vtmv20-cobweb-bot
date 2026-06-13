import {
  Channel,
  Client,
  GuildTextBasedChannel,
  PermissionFlagsBits,
  WebhookClient,
  Webhook
} from "discord.js";
import { CobwebStore } from "./db.js";
import { GuildConfig, QueuedMessage } from "./types.js";
import { refreshModerationEntry } from "./moderation.js";

export type PublishTarget = Pick<WebhookClient, "send"> | Pick<Webhook, "send">;

export type Publisher = {
  publish(message: QueuedMessage, config: GuildConfig): Promise<void>;
};

export class DiscordPublisher implements Publisher {
  constructor(
    private readonly client: Client,
    private readonly saveWebhook?: (
      guildId: string,
      webhookId: string | null,
      webhookToken: string | null
    ) => void
  ) {}

  async publish(message: QueuedMessage, config: GuildConfig): Promise<void> {
    if (config.webhookId && config.webhookToken) {
      try {
        await this.sendViaWebhook(
          new WebhookClient({ id: config.webhookId, token: config.webhookToken }),
          message
        );
        return;
      } catch (error) {
        this.saveWebhook?.(config.guildId, null, null);
        console.warn(
          `Stored Cobweb webhook failed for guild ${config.guildId}; recreating webhook.`,
          error
        );
      }
    }

    const channel = await this.fetchWebhookChannel(config.cobwebChannelId);
    const webhook = await this.getOrCreateWebhook(channel, {
      ...config,
      webhookId: null,
      webhookToken: null
    });
    await this.sendViaWebhook(webhook, message);
  }

  private async fetchWebhookChannel(channelId: string): Promise<WebhookCapableChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isWebhookCapableChannel(channel)) {
      throw new Error(`Channel ${channelId} cannot publish Cobweb webhooks`);
    }

    const missing = this.missingCobwebPermissions(channel);
    if (missing.length > 0) {
      throw new Error(`Bot is missing ${missing.join(", ")} in #${channel.name}`);
    }

    return channel;
  }

  private async getOrCreateWebhook(
    channel: WebhookCapableChannel,
    config: GuildConfig
  ): Promise<PublishTarget> {
    let webhooks: Awaited<ReturnType<WebhookCapableChannel["fetchWebhooks"]>>;
    try {
      webhooks = await channel.fetchWebhooks();
    } catch (error) {
      throw new Error(`Bot cannot inspect webhooks in #${channel.name}: ${formatDiscordError(error)}`);
    }
    const existing = webhooks.find((webhook) => webhook.name === config.webhookName);

    if (existing?.token) {
      this.saveWebhook?.(config.guildId, existing.id, existing.token);
      return existing;
    }

    let created: Awaited<ReturnType<WebhookCapableChannel["createWebhook"]>>;
    try {
      created = await channel.createWebhook({
        name: config.webhookName,
        reason: "Cobweb anonymous feed publisher"
      });
    } catch (error) {
      throw new Error(`Bot cannot create Cobweb webhook in #${channel.name}: ${formatDiscordError(error)}`);
    }
    this.saveWebhook?.(config.guildId, created.id, created.token);
    return created;
  }

  private async sendViaWebhook(webhook: PublishTarget, message: QueuedMessage): Promise<void> {
    try {
      await webhook.send({
        content: message.currentText,
        allowedMentions: { parse: [] }
      });
    } catch (error) {
      throw new Error(`Bot cannot send through the Cobweb webhook: ${formatDiscordError(error)}`);
    }
  }

  private missingCobwebPermissions(channel: WebhookCapableChannel): string[] {
    const botUser = this.client.user;
    if (!botUser) {
      return ["bot user unavailable"];
    }

    const permissions = channel.permissionsFor(botUser);
    if (!permissions) {
      return ["permissions unavailable"];
    }

    const requirements = [
      { label: "View Channel", flag: PermissionFlagsBits.ViewChannel },
      { label: "Send Messages", flag: PermissionFlagsBits.SendMessages },
      { label: "Manage Webhooks", flag: PermissionFlagsBits.ManageWebhooks }
    ] as const;

    return requirements
      .filter((requirement) => !permissions.has(requirement.flag))
      .map((requirement) => requirement.label);
  }
}

export class CobwebWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: CobwebStore,
    private readonly getConfig: (guildId: string) => GuildConfig | null,
    private readonly publisher: Publisher,
    private readonly fetchModerationChannel: (
      channelId: string
    ) => Promise<GuildTextBasedChannel | null>,
    private readonly intervalMs: number
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.error("Cobweb worker tick failed", error);
      });
    }, this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now = new Date()): Promise<void> {
    const due = this.store.listDueMessages(now);

    for (const message of due) {
      const config = this.getConfig(message.guildId);
      if (!config) {
        this.store.markFailed(message.id, `No guild config for ${message.guildId}`);
        continue;
      }

      try {
        await this.publisher.publish(message, config);
        const posted = this.store.markPosted(message.id);
        if (posted) {
          await this.refreshModeration(config, posted);
        }
      } catch (error) {
        const failed = this.store.markFailed(message.id, (error as Error).message);
        if (failed) {
          await this.refreshModeration(config, failed);
        }
      }
    }
  }

  private async refreshModeration(config: GuildConfig, message: QueuedMessage): Promise<void> {
    const channel = await this.fetchModerationChannel(config.moderationChannelId);
    if (!channel) {
      return;
    }

    await refreshModerationEntry(channel, message);
  }
}

export const fetchGuildTextChannel = async (
  client: Client,
  channelId: string
): Promise<GuildTextBasedChannel | null> => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    return null;
  }

  return channel;
};

type WebhookCapableChannel = GuildTextBasedChannel & {
  name: string;
  fetchWebhooks(): ReturnType<Extract<GuildTextBasedChannel, { fetchWebhooks: unknown }>["fetchWebhooks"]>;
  createWebhook(
    options: Parameters<Extract<GuildTextBasedChannel, { createWebhook: unknown }>["createWebhook"]>[0]
  ): ReturnType<Extract<GuildTextBasedChannel, { createWebhook: unknown }>["createWebhook"]>;
};

const isWebhookCapableChannel = (channel: Channel | null): channel is WebhookCapableChannel =>
  Boolean(
    channel &&
      channel.isTextBased() &&
      !channel.isDMBased() &&
      "fetchWebhooks" in channel &&
      "createWebhook" in channel
  );

const formatDiscordError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message);
  }

  return String(error);
};
