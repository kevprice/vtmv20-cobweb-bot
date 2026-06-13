import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  InteractionReplyOptions,
  MessageFlags,
  ModalSubmitInteraction,
  Partials,
  PermissionFlagsBits
} from "discord.js";
import { AppConfig } from "./config.js";
import { COBWEB_COMMAND, COBWEB_ST_COMMAND, CWSETUP_COMMAND } from "./commands.js";
import { CobwebStore } from "./db.js";
import {
  diagnoseCobwebChannel,
  diagnoseModerationChannel,
  formatChannelDiagnostic,
  setupMissingFields
} from "./diagnostics.js";
import { canUseCobweb, isStoryteller } from "./permissions.js";
import { formatDiscordTimestamp, submitCobwebMessage } from "./queue.js";
import { addMinutes } from "./time.js";
import { GuildConfig, GuildSettings } from "./types.js";
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

  client.once(Events.ClientReady, () => {
    console.log(`Cobweb bot logged in as ${client.user?.tag ?? "unknown"}`);
    worker.start();
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction, store, worker);
    } catch (error) {
      console.error("Interaction failed", error);
      await safeRespondEphemeral(interaction, {
        content: "The Cobweb shivers and refuses the fragment. Try again later."
      });
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
  if (interaction.isChatInputCommand()) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  if (!interaction.guildId) {
    if (interaction.isRepliable()) {
      await respondEphemeral(interaction, { content: "Cobweb commands only work inside a server." });
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
      await respondEphemeral(interaction, {
        content:
          "This server is not fully configured for the Cobweb. Use `/cwsetup show` to see what is missing."
      });
      return;
    }

    await handleCommand(interaction, store, config, worker);
    return;
  }

  const config = store.getRunnableGuildConfig(interaction.guildId);
  if (!config) {
    if (interaction.isRepliable()) {
      await respondEphemeral(interaction, {
        content: "This server is not fully configured for the Cobweb."
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

const respondEphemeral = async (
  interaction: Interaction,
  options: Omit<InteractionReplyOptions, "flags" | "ephemeral">
): Promise<void> => {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.deferred || interaction.replied) {
    const editOptions: Parameters<typeof interaction.editReply>[0] = {};
    if (options.content !== undefined) editOptions.content = options.content;
    if (options.embeds !== undefined) editOptions.embeds = options.embeds;
    if (options.components !== undefined) editOptions.components = options.components;
    if (options.files !== undefined) editOptions.files = options.files;
    if (options.allowedMentions !== undefined) {
      editOptions.allowedMentions = options.allowedMentions;
    }

    await interaction.editReply(editOptions);
    return;
  }

  await interaction.reply({
    ...options,
    flags: MessageFlags.Ephemeral
  });
};

const safeRespondEphemeral = async (
  interaction: Interaction,
  options: Omit<InteractionReplyOptions, "flags" | "ephemeral">
): Promise<void> => {
  try {
    await respondEphemeral(interaction, options);
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.warn("Could not respond because Discord already expired the interaction.");
      return;
    }

    throw error;
  }
};

const isUnknownInteractionError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === 10062;

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
    await respondEphemeral(interaction, { content: "Could not read your server roles." });
    return;
  }

  const runnableConfig = store.getRunnableGuildConfig(interaction.guildId);
  if (!hasSetupPermission(member, runnableConfig)) {
    await respondEphemeral(interaction, {
      content: "Only server managers or configured ST/admin roles can change Cobweb setup."
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
    await respondEphemeral(interaction, {
      content: await formatSetupResponse(interaction, settings, `Blocked terms updated.`),
      allowedMentions: { parse: [] }
    });
    return;
  }

  switch (subcommand) {
    case "cobweb-channel": {
      const channel = interaction.options.getChannel("channel", true);
      settings = store.setGuildChannel(interaction.guildId, "cobwebChannelId", channel.id);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(
          interaction,
          settings,
          `Cobweb channel set to <#${channel.id}>.`
        ),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "moderation-channel": {
      const channel = interaction.options.getChannel("channel", true);
      settings = store.setGuildChannel(interaction.guildId, "moderationChannelId", channel.id);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(
          interaction,
          settings,
          `Moderation channel set to <#${channel.id}>.`
        ),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "malkavian-role": {
      const role = interaction.options.getRole("role", true);
      settings = store.addGuildRole(interaction.guildId, "malkavianRoleIds", role.id);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(
          interaction,
          settings,
          `Malkavian role added: <@&${role.id}>.`
        ),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "st-role": {
      const role = interaction.options.getRole("role", true);
      settings = store.addGuildRole(interaction.guildId, "stRoleIds", role.id);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(
          interaction,
          settings,
          `ST/admin role added: <@&${role.id}>.`
        ),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "max-length": {
      const value = interaction.options.getInteger("characters", true);
      settings = store.setGuildNumber(interaction.guildId, "maxLength", value);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(interaction, settings, `Max length set to ${value}.`),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "cooldown": {
      const value = interaction.options.getInteger("minutes", true);
      settings = store.setGuildNumber(interaction.guildId, "cooldownMinutes", value);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(
          interaction,
          settings,
          `Cooldown set to ${value} minutes.`
        ),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "delay-window": {
      const value = interaction.options.getInteger("minutes", true);
      settings = store.setGuildNumber(interaction.guildId, "delayWindowMinutes", value);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(
          interaction,
          settings,
          `Delay window set to ${value} minutes.`
        ),
        allowedMentions: { parse: [] }
      });
      return;
    }
    case "show": {
      settings = store.ensureGuildSettings(interaction.guildId);
      await respondEphemeral(interaction, {
        content: await formatSetupResponse(interaction, settings),
        allowedMentions: { parse: [] }
      });
      return;
    }
    default:
      await respondEphemeral(interaction, { content: "Unknown setup command." });
  }
};

const formatSetupResponse = async (
  interaction: ChatInputCommandInteraction,
  settings: GuildSettings,
  prefix?: string
): Promise<string> => {
  const missing = setupMissingFields(settings);
  const cobwebChannel = settings.cobwebChannelId
    ? await safeFetchGuildTextChannel(interaction.client, settings.cobwebChannelId)
    : null;
  const moderationChannel = settings.moderationChannelId
    ? await safeFetchGuildTextChannel(interaction.client, settings.moderationChannelId)
    : null;
  const cobwebDiagnostic = settings.cobwebChannelId
    ? formatChannelDiagnostic(diagnoseCobwebChannel(cobwebChannel, interaction.client.user))
    : "Cobweb permissions: channel not set";
  const moderationDiagnostic = settings.moderationChannelId
    ? formatChannelDiagnostic(diagnoseModerationChannel(moderationChannel, interaction.client.user))
    : "Moderation permissions: channel not set";
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
    "Setup health:",
    cobwebDiagnostic,
    moderationDiagnostic,
    "",
    missing.length
      ? `Missing before Cobweb can run: ${missing.join(", ")}`
      : "Cobweb is ready for this server."
  ];

  return lines.join("\n");
};

const safeFetchGuildTextChannel = async (
  client: Client,
  channelId: string
): Promise<Awaited<ReturnType<typeof fetchGuildTextChannel>>> => {
  try {
    return await fetchGuildTextChannel(client, channelId);
  } catch {
    return null;
  }
};

const formatRoleList = (roleIds: string[]): string =>
  roleIds.length ? roleIds.map((roleId) => `<@&${roleId}>`).join(", ") : "not set";

const handleCommand = async (
  interaction: ChatInputCommandInteraction,
  store: CobwebStore,
  config: GuildConfig,
  worker: CobwebWorker
): Promise<void> => {
  const member = getGuildMember(interaction);
  if (!member) {
    await respondEphemeral(interaction, { content: "Could not read your server roles." });
    return;
  }

  const storyteller = isStoryteller(member, config);
  const isStCommand = interaction.commandName === COBWEB_ST_COMMAND;

  if (interaction.commandName !== COBWEB_COMMAND && !isStCommand) {
    return;
  }

  if (isStCommand && !storyteller) {
    await respondEphemeral(interaction, { content: "Only ST/admin roles can use `/cobweb_st`." });
    return;
  }

  if (!canUseCobweb(member, config)) {
    await respondEphemeral(interaction, { content: "The Cobweb is closed to you." });
    return;
  }

  const message = interaction.options.getString("message", true);
  const delayMinutes = isStCommand ? (interaction.options.getInteger("delay-minutes") ?? 0) : null;
  const now = new Date();

  const submission = {
    guildId: interaction.guildId!,
    submitterId: interaction.user.id,
    submitterName: member.displayName,
    message,
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
    await respondEphemeral(interaction, { content: result.reason });
    return;
  }

  const moderationChannel = await fetchGuildTextChannel(interaction.client, config.moderationChannelId);
  if (!moderationChannel) {
    store.deleteQueuedMessage(result.queued.id);
    await respondEphemeral(interaction, {
      content: "The moderation channel is not available, so the fragment was not queued."
    });
    return;
  }

  try {
    await postModerationEntry(store, moderationChannel, result.queued);
  } catch (error) {
    store.deleteQueuedMessage(result.queued.id);
    throw error;
  }

  await respondEphemeral(interaction, {
    content: isStCommand
      ? `The Cobweb has taken it. It may surface ${formatDiscordTimestamp(
          new Date(result.queued.scheduledFor)
        )}.`
      : "The Cobweb has received it. It will surface when it is ready."
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
    await respondEphemeral(interaction, { content: "That fragment is no longer pending." });
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
    await respondEphemeral(interaction, { content: result.reason });
    return;
  }

  const moderationChannel = await fetchGuildTextChannel(interaction.client, config.moderationChannelId);
  if (moderationChannel) {
    await refreshModerationEntry(moderationChannel, result);
  }

  await respondEphemeral(interaction, { content: "The fragment has shifted." });
};
