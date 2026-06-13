import {
  Channel,
  Client,
  GuildTextBasedChannel,
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
  constructor(private readonly client: Client) {}

  async publish(message: QueuedMessage, config: GuildConfig): Promise<void> {
    const channel = await this.fetchWebhookChannel(config.cobwebChannelId);
    const webhook = await this.getOrCreateWebhook(channel, config.webhookName);

    await webhook.send({
      content: message.currentText,
      allowedMentions: { parse: [] }
    });
  }

  private async fetchWebhookChannel(channelId: string): Promise<WebhookCapableChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isWebhookCapableChannel(channel)) {
      throw new Error(`Channel ${channelId} cannot publish Cobweb webhooks`);
    }

    return channel;
  }

  private async getOrCreateWebhook(
    channel: WebhookCapableChannel,
    webhookName: string
  ): Promise<PublishTarget> {
    const webhooks = await channel.fetchWebhooks();
    const existing = webhooks.find((webhook) => webhook.name === webhookName);

    if (existing) {
      return existing;
    }

    return channel.createWebhook({
      name: webhookName,
      reason: "Cobweb anonymous feed publisher"
    });
  }
}

export class CobwebWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: CobwebStore,
    private readonly configs: Map<string, GuildConfig>,
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
      const config = this.configs.get(message.guildId);
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
