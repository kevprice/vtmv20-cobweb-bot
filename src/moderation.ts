import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { CobwebStore } from "./db.js";
import { GuildConfig, QueuedMessage } from "./types.js";
import { formatDiscordTimestamp } from "./queue.js";
import { validateCobwebMessage } from "./validation.js";

const CUSTOM_ID_PREFIX = "cobweb";

export const moderationCustomId = (action: "edit" | "delete", id: number): string =>
  `${CUSTOM_ID_PREFIX}:${action}:${id}`;

export const moderationModalId = (id: number): string => `${CUSTOM_ID_PREFIX}:modal:${id}`;

export const moderationActionRow = (message: QueuedMessage, disabled = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(moderationCustomId("edit", message.id))
      .setLabel("Edit")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(moderationCustomId("delete", message.id))
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

export const moderationContent = (message: QueuedMessage): string => {
  const status = message.status.toUpperCase();
  const scheduled = formatDiscordTimestamp(new Date(message.scheduledFor), "f");
  const posted = message.postedAt
    ? `\nPosted: ${formatDiscordTimestamp(new Date(message.postedAt), "f")}`
    : "";
  const failure = message.failureReason ? `\nFailure: ${message.failureReason}` : "";

  return [
    `Cobweb queue #${message.id} [${status}]`,
    `Submitter: ${message.submitterName}`,
    `Scheduled: ${scheduled}${posted}${failure}`,
    "",
    "```text",
    message.currentText,
    "```"
  ].join("\n");
};

export const postModerationEntry = async (
  store: CobwebStore,
  channel: GuildTextBasedChannel,
  message: QueuedMessage
): Promise<void> => {
  const sent = await channel.send({
    content: moderationContent(message),
    components: [moderationActionRow(message)],
    allowedMentions: { parse: [] }
  });
  store.setModerationMessageId(message.id, sent.id);
};

export const refreshModerationEntry = async (
  channel: GuildTextBasedChannel,
  message: QueuedMessage
): Promise<void> => {
  if (!message.moderationMessageId) {
    return;
  }

  const disabled = message.status !== "pending";
  const moderationMessage = await channel.messages.fetch(message.moderationMessageId);
  await moderationMessage.edit({
    content: moderationContent(message),
    components: [moderationActionRow(message, disabled)],
    allowedMentions: { parse: [] }
  });
};

export const parseModerationCustomId = (
  customId: string
): { action: "edit" | "delete"; id: number } | null => {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== CUSTOM_ID_PREFIX) {
    return null;
  }

  const action = parts[1];
  const id = Number(parts[2]);
  if ((action !== "edit" && action !== "delete") || !Number.isInteger(id)) {
    return null;
  }

  return { action, id };
};

export const parseModerationModalId = (customId: string): number | null => {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== CUSTOM_ID_PREFIX || parts[1] !== "modal") {
    return null;
  }

  const id = Number(parts[2]);
  return Number.isInteger(id) ? id : null;
};

export const showEditModal = async (
  interaction: ButtonInteraction,
  message: QueuedMessage
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(moderationModalId(message.id))
    .setTitle(`Edit Cobweb #${message.id}`);

  const textInput = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("Fragment")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(200)
    .setValue(message.currentText);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput));
  await interaction.showModal(modal);
};

export const assertModerator = async (
  interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction,
  config: GuildConfig,
  isStoryteller: boolean
): Promise<boolean> => {
  if (isStoryteller) {
    return true;
  }

  await interaction.reply({
    content: "Only ST/admin roles can touch the moderation queue.",
    ephemeral: true
  });
  return false;
};

export const updateQueuedTextFromModal = (
  store: CobwebStore,
  config: GuildConfig,
  id: number,
  text: string
): QueuedMessage | { reason: string } => {
  const validation = validateCobwebMessage(text, config);
  if (!validation.ok) {
    return { reason: validation.reason };
  }

  const updated = store.editQueuedMessage(id, validation.text);
  if (!updated || updated.status !== "pending") {
    return { reason: "That fragment is no longer pending." };
  }

  return updated;
};
