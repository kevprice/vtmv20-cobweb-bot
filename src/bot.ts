import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  ModalSubmitInteraction,
  Partials,
  PermissionFlagsBits
} from "discord.js";
import { AppConfig } from "./config.js";
import { COBWEB_COMMAND, COBWEB_ST_COMMAND, CWSETUP_COMMAND } from "./commands.js";
import { CobwebStore } from "./db.js";
import { canUseCobweb, isStoryteller } from "./permissions.js";
import { formatDiscordTimestamp, submitCobwebMessage } from "./queue.js";
import { addMinutes } from "./time.js";
import { CobwebCategory, GuildConfig, GuildSettings } from "./types.js";
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
  const worker = new CobwebWorker(
    store,
    (guildId) => store.getRunnableGuildConfig(guildId),
    new DiscordPublisher(client, (guildId, webhookId, webhookToken) => {
      store.setGuildWebhook(guildId, webhookId, webhookToken);
    }),
    (channelId) => fetchGuildTextChannel(client, channelId),
    config.workerIntervalMs
  );

  client.once("ready", () => {
    console.log(`Cobweb bot logged in as ${client.user?.tag ?? "unknown"}`);
    worker.start();
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      await handleInteraction(interaction, store, worker);
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
  worker: CobwebWorker
): Promise<void> => {
  if (!interaction.guildId) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: "Cobweb commands only work inside a server.", ephemeral: true });
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === CWSETUP_COMMAND) {
      await handleSetupCommand(interaction, store);
      return;
    }

    const config = store.getRunnableGuildConfig(interaction.guildId);
    if (!config) {
      await interaction.reply({
        content:
          "This server is not fully configured for the Cobweb. Use `/cwsetup show` to see what is missing.",
        ephemeral: true
      });
      return;
    }

    await handleCommand(interaction, store, config, worker);
    return;
  }

  const config = store.getRunnableGuildConfig(interaction.guildId);
  if (!config) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: "This server is not fully configured for the Cobweb.",
        ephemeral: true
      });
    }
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

const hasSetupPermission = (member: GuildMember, config: GuildConfig | null): boolean =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) ||
  member.permissions.has(PermissionFlagsBits.Administrator) ||
  Boolean(config && isStoryteller(member, config));

const handleSetupCommand = async (
  interaction: ChatInputCommandInteraction,
  store: CobwebStore
): Promise<void> => {
  const member = getGuildMember(interaction);
  if (!member || !interaction.guildId) {
    await interaction.reply({ content: "Could not read your server roles.", ephemeral: true });
    return;
  }

  const runnableConfig = store.getRunnableGuildConfig(interaction.guildId);
  if (!hasSetupPermission(member, runnableConfig)) {
    await interaction.reply({
      content: "Only server managers or configured ST/admin roles can change Cobweb setup.",
      ephemeral: true
    });
    return;
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();
  let settings: GuildSettings;

  if (subcommandGroup === "blocked-term") {
    const term = interaction.options.getString("term", true);
    settings =
      subcommand === "add"
        ? store.addBlockedTerm(interaction.guildId, term)
        : store.removeBlockedTerm(interaction.guildId, term);
    await interaction.reply({
      content: formatSetupResponse(settings, `Blocked terms updated.`),
      ephemeral: true,
      allowedMentions: { parse: [] }
    });
    return;
  }

  switch (subcommand) {
    case "cobweb-channel": {
      const channel = interaction.options.getChannel("channel", true);
      settings = store.setGuildChannel(interaction.guildId, "cobwebChannelId", channel.id);
      await interaction.reply({
        content: formatSetupResponse(settings, `Cobweb channel set to <#${channel.id}>.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "moderation-channel": {
      const channel = interaction.options.getChannel("channel", true);
      settings = store.setGuildChannel(interaction.guildId, "moderationChannelId", channel.id);
      await interaction.reply({
        content: formatSetupResponse(settings, `Moderation channel set to <#${channel.id}>.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "malkavian-role": {
      const role = interaction.options.getRole("role", true);
      settings = store.addGuildRole(interaction.guildId, "malkavianRoleIds", role.id);
      await interaction.reply({
        content: formatSetupResponse(settings, `Malkavian role added: <@&${role.id}>.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "st-role": {
      const role = interaction.options.getRole("role", true);
      settings = store.addGuildRole(interaction.guildId, "stRoleIds", role.id);
      await interaction.reply({
        content: formatSetupResponse(settings, `ST/admin role added: <@&${role.id}>.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "max-length": {
      const value = interaction.options.getInteger("characters", true);
      settings = store.setGuildNumber(interaction.guildId, "maxLength", value);
      await interaction.reply({
        content: formatSetupResponse(settings, `Max length set to ${value}.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "cooldown": {
      const value = interaction.options.getInteger("minutes", true);
      settings = store.setGuildNumber(interaction.guildId, "cooldownMinutes", value);
      await interaction.reply({
        content: formatSetupResponse(settings, `Cooldown set to ${value} minutes.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "delay-window": {
      const value = interaction.options.getInteger("minutes", true);
      settings = store.setGuildNumber(interaction.guildId, "delayWindowMinutes", value);
      await interaction.reply({
        content: formatSetupResponse(settings, `Delay window set to ${value} minutes.`),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "show": {
      settings = store.ensureGuildSettings(interaction.guildId);
      await interaction.reply({
        content: formatSetupResponse(settings),
        ephemeral: true,
        allowedMentions: { parse: [] }
      });
      return;
    }
    default:
      await interaction.reply({ content: "Unknown setup command.", ephemeral: true });
  }
};

const formatSetupResponse = (settings: GuildSettings, prefix?: string): string => {
  const missing = setupMissingFields(settings);
  const lines = [
    ...(prefix ? [prefix, ""] : []),
    "Cobweb setup:",
    `Cobweb channel: ${settings.cobwebChannelId ? `<#${settings.cobwebChannelId}>` : "not set"}`,
    `Moderation channel: ${
      settings.moderationChannelId ? `<#${settings.moderationChannelId}>` : "not set"
    }`,
    `Malkavian roles: ${formatRoleList(settings.malkavianRoleIds)}`,
    `ST/admin roles: ${formatRoleList(settings.stRoleIds)}`,
    `Max length: ${settings.maxLength}`,
    `Cooldown: ${settings.cooldownMinutes} minutes`,
    `Delay window: ${settings.delayWindowMinutes} minutes`,
    `Webhook: ${settings.webhookId ? "stored" : `${settings.webhookName} will be created on first publish`}`,
    `Blocked terms: ${settings.blockedTerms.length ? settings.blockedTerms.join(", ") : "none"}`,
    "",
    missing.length
      ? `Missing before Cobweb can run: ${missing.join(", ")}`
      : "Cobweb is ready for this server."
  ];

  return lines.join("\n");
};

const formatRoleList = (roleIds: string[]): string =>
  roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "not set";

const setupMissingFields = (settings: GuildSettings): string[] => {
  const missing: string[] = [];
  if (!settings.cobwebChannelId) missing.push("cobweb channel");
  if (!settings.moderationChannelId) missing.push("moderation channel");
  if (settings.malkavianRoleIds.length === 0) missing.push("Malkavian role");
  if (settings.stRoleIds.length === 0) missing.push("ST/admin role");
  return missing;
};

const handleCommand = async (
  interaction: ChatInputCommandInteraction,
  store: CobwebStore,
  config: GuildConfig,
  worker: CobwebWorker
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
  const delayMinutes = isStCommand ? (interaction.options.getInteger("delay-minutes") ?? 0) : null;
  const now = new Date();

  const submission = {
    guildId: interaction.guildId!,
    submitterId: interaction.user.id,
    message,
    category,
    isStoryteller: storyteller
  };
  const result = submitCobwebMessage(
    store,
    config,
    isStCommand
      ? { ...submission, scheduledFor: addMinutes(now, delayMinutes ?? 0) }
      : submission,
    now
  );

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

  if (isStCommand && delayMinutes === 0) {
    await worker.tick(new Date());
  }
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
