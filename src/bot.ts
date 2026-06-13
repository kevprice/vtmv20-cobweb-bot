import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  ModalSubmitInteraction,
  Partials
} from "discord.js";
import { AppConfig } from "./config.js";
import { COBWEB_COMMAND, COBWEB_ST_COMMAND } from "./commands.js";
import { CobwebStore } from "./db.js";
import { canUseCobweb, isStoryteller } from "./permissions.js";
import { formatDiscordTimestamp, submitCobwebMessage } from "./queue.js";
import { CobwebCategory, GuildConfig } from "./types.js";
import {
  assertModerator,
  parseModerationCustomId,
  parseModerationModalId,
  postModerationEntry,
  moderationActionRow,
  moderationContent,
  refreshModerationEntry,
  showEditModal,
  updateQueuedTextFromModal
} from "./moderation.js";
import { CobwebWorker, DiscordPublisher, fetchGuildTextChannel } from "./worker.js";

export const createClient = (): Client =>
  new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel]
  });

export const startBot = async (config: AppConfig, store: CobwebStore): Promise<Client> => {
  const client = createClient();
  const guildConfigs = new Map(config.guilds.map((guild) => [guild.guildId, guild]));
  const worker = new CobwebWorker(
    store,
    guildConfigs,
    new DiscordPublisher(client),
    (channelId) => fetchGuildTextChannel(client, channelId),
    config.workerIntervalMs
  );

  client.once("ready", () => {
    console.log(`Cobweb bot logged in as ${client.user?.tag ?? "unknown"}`);
    worker.start();
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await handleInteraction(interaction, store, guildConfigs);
    } catch (error) {
      console.error("Interaction failed", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "The Cobweb shivers and refuses the fragment. Try again later.",
          ephemeral: true
        });
      }
    }
  });

  client.once("shardDisconnect", () => worker.stop());

  await client.login(config.discordToken);
  return client;
};

const handleInteraction = async (
  interaction: Interaction,
  store: CobwebStore,
  guildConfigs: Map<string, GuildConfig>
): Promise<void> => {
  if (!interaction.guildId) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "Cobweb commands only work inside a server.", ephemeral: true });
    }
    return;
  }

  const config = guildConfigs.get(interaction.guildId);
  if (!config) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "This server is not configured for the Cobweb.", ephemeral: true });
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction, store, config);
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction, store, config);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModal(interaction, store, config);
  }
};

const getGuildMember = (interaction: Interaction): GuildMember | null =>
  interaction.member instanceof GuildMember ? interaction.member : null;

const handleCommand = async (
  interaction: ChatInputCommandInteraction,
  store: CobwebStore,
  config: GuildConfig
): Promise<void> => {
  const member = getGuildMember(interaction);
  if (!member) {
    await interaction.reply({ content: "Could not read your server roles.", ephemeral: true });
    return;
  }

  const storyteller = isStoryteller(member, config);
  const isStCommand = interaction.commandName === COBWEB_ST_COMMAND;

  if (interaction.commandName !== COBWEB_COMMAND && !isStCommand) {
    return;
  }

  if (isStCommand && !storyteller) {
    await interaction.reply({ content: "Only ST/admin roles can use `/cobweb_st`.", ephemeral: true });
    return;
  }

  if (!canUseCobweb(member, config)) {
    await interaction.reply({ content: "The Cobweb is closed to you.", ephemeral: true });
    return;
  }

  const message = interaction.options.getString("message", true);
  const category = isStCommand
    ? (interaction.options.getString("category") as CobwebCategory | null)
    : null;

  const result = submitCobwebMessage(store, config, {
    guildId: interaction.guildId!,
    submitterId: interaction.user.id,
    message,
    category,
    isStoryteller: storyteller
  });

  if (!result.ok) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  const moderationChannel = await fetchGuildTextChannel(interaction.client, config.moderationChannelId);
  if (!moderationChannel) {
    store.deleteQueuedMessage(result.queued.id);
    await interaction.reply({
      content: "The moderation channel is not available, so the fragment was not queued.",
      ephemeral: true
    });
    return;
  }

  try {
    await postModerationEntry(store, moderationChannel, result.queued);
  } catch (error) {
    store.deleteQueuedMessage(result.queued.id);
    throw error;
  }

  await interaction.reply({
    content: `The Cobweb has taken it. It may surface ${formatDiscordTimestamp(
      new Date(result.queued.scheduledFor)
    )}.`,
    ephemeral: true
  });
};

const handleButton = async (
  interaction: ButtonInteraction,
  store: CobwebStore,
  config: GuildConfig
): Promise<void> => {
  const parsed = parseModerationCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const member = getGuildMember(interaction);
  if (!member || !(await assertModerator(interaction, config, isStoryteller(member, config)))) {
    return;
  }

  const message = store.getQueuedMessage(parsed.id);
  if (!message || message.status !== "pending") {
    await interaction.reply({ content: "That fragment is no longer pending.", ephemeral: true });
    return;
  }

  if (parsed.action === "edit") {
    await showEditModal(interaction, message);
    return;
  }

  const deleted = store.deleteQueuedMessage(parsed.id);
  if (deleted) {
    await interaction.update({
      content: moderationContent(deleted),
      components: [moderationActionRow(deleted, true)],
      allowedMentions: { parse: [] }
    });
  }
};

const handleModal = async (
  interaction: ModalSubmitInteraction,
  store: CobwebStore,
  config: GuildConfig
): Promise<void> => {
  const id = parseModerationModalId(interaction.customId);
  if (!id) {
    return;
  }

  const member = getGuildMember(interaction);
  if (!member || !(await assertModerator(interaction, config, isStoryteller(member, config)))) {
    return;
  }

  const result = updateQueuedTextFromModal(
    store,
    config,
    id,
    interaction.fields.getTextInputValue("message")
  );

  if ("reason" in result) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  const moderationChannel = await fetchGuildTextChannel(interaction.client, config.moderationChannelId);
  if (moderationChannel) {
    await refreshModerationEntry(moderationChannel, result);
  }

  await interaction.reply({ content: "The fragment has shifted.", ephemeral: true });
};

