import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelSelectMenuInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  InteractionReplyOptions,
  Message,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  Partials,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle
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
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
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

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleCobwebChannelMessage(message, store, worker);
    } catch (error) {
      console.error("Cobweb channel message interception failed", error);
      await safeDirectMessage(
        message,
        "The Cobweb could not take that message. Please try `/cobweb` instead."
      );
    }
  });

  client.once("shardDisconnect", () => worker.stop());

  await client.login(config.discordToken);
  return client;
};

const handleCobwebChannelMessage = async (
  message: Message,
  store: CobwebStore,
  worker: CobwebWorker
): Promise<void> => {
  if (!message.inGuild() || message.author.bot || message.webhookId) return;

  const config = store.getRunnableGuildConfig(message.guildId);
  if (!config || !message.member) return;
  const isMalkavian = config.malkavianRoleIds.some((roleId) =>
    message.member!.roles.cache.has(roleId)
  );
  const storyteller = isStoryteller(message.member, config);
  const isCobwebChannel = message.channelId === config.cobwebChannelId;
  const isModerationChannel = message.channelId === config.moderationChannelId;
  if (!(isCobwebChannel && (isMalkavian || storyteller)) && !(isModerationChannel && storyteller)) {
    return;
  }

  try {
    await message.delete();
  } catch (error) {
    console.error(`Could not delete intercepted Cobweb message ${message.id}`, error);
    await safeDirectMessage(
      message,
      "I could not hide your message, so it was not added to the Cobweb queue. Please alert a Storyteller."
    );
    return;
  }

  const result = submitCobwebMessage(
    store,
    config,
    {
      guildId: message.guildId,
      submitterId: message.author.id,
      submitterName: message.member.displayName,
      message: message.content,
      isStoryteller: storyteller,
      ...(storyteller ? { scheduledFor: message.createdAt } : {})
    },
    message.createdAt
  );
  if (!result.ok) {
    await safeDirectMessage(message, result.reason);
    return;
  }

  const moderationChannel = await fetchGuildTextChannel(message.client, config.moderationChannelId);
  if (!moderationChannel) {
    store.deleteQueuedMessage(result.queued.id);
    await safeDirectMessage(
      message,
      "The moderation channel is unavailable, so your message was not queued."
    );
    return;
  }

  try {
    await postModerationEntry(store, moderationChannel, result.queued);
  } catch (error) {
    store.deleteQueuedMessage(result.queued.id);
    throw error;
  }

  if (storyteller) {
    await worker.tick(new Date());
  }

  await safeDirectMessage(
    message,
    storyteller
      ? "The Cobweb has taken your Storyteller message and queued it for immediate publication."
      : "The Cobweb has received your message. It will surface when it is ready."
  );
};

const safeDirectMessage = async (message: Message, content: string): Promise<void> => {
  try {
    await message.author.send({ content, allowedMentions: { parse: [] } });
  } catch {
    // Direct messages may be disabled; interception and queueing should still succeed.
  }
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
          "This server is not fully configured for the Cobweb. Use `/cwsetup` to finish setup."
      });
      return;
    }

    await handleCommand(interaction, store, config, worker);
    return;
  }

  if (interaction.isChannelSelectMenu() && interaction.customId.startsWith("cwsetup:")) {
    await handleSetupChannelSelect(interaction, store);
    return;
  }

  if (interaction.isRoleSelectMenu() && interaction.customId.startsWith("cwsetup:")) {
    await handleSetupRoleSelect(interaction, store);
    return;
  }

  if (interaction.isButton() && interaction.customId === SETUP_SETTINGS_BUTTON_ID) {
    await handleSetupSettingsButton(interaction, store);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === SETUP_SETTINGS_MODAL_ID) {
    await handleSetupSettingsModal(interaction, store);
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

const hasSetupPermission = (member: GuildMember): boolean =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) ||
  member.permissions.has(PermissionFlagsBits.Administrator);

const SETUP_COBWEB_CHANNEL_ID = "cwsetup:cobweb-channel";
const SETUP_MODERATION_CHANNEL_ID = "cwsetup:moderation-channel";
const SETUP_MALKAVIAN_ROLES_ID = "cwsetup:malkavian-roles";
const SETUP_ST_ROLES_ID = "cwsetup:st-roles";
const SETUP_SETTINGS_BUTTON_ID = "cwsetup:settings";
const SETUP_SETTINGS_MODAL_ID = "cwsetup:settings-modal";

const handleSetupCommand = async (
  interaction: ChatInputCommandInteraction,
  store: CobwebStore
): Promise<void> => {
  const member = getGuildMember(interaction);
  if (!member || !interaction.guildId) {
    await respondEphemeral(interaction, { content: "Could not read your server roles." });
    return;
  }

  if (!hasSetupPermission(member)) {
    await respondEphemeral(interaction, {
      content: "Only server admins or users with Manage Server can change Cobweb setup."
    });
    return;
  }

  const settings = store.ensureGuildSettings(interaction.guildId);
  await respondEphemeral(interaction, await setupPanel(interaction.client, settings));
};

const assertSetupPermission = async (interaction: Interaction): Promise<boolean> => {
  const member = getGuildMember(interaction);
  if (member && hasSetupPermission(member)) {
    return true;
  }

  await respondEphemeral(interaction, {
    content: "Only server admins or users with Manage Server can change Cobweb setup."
  });
  return false;
};

const handleSetupChannelSelect = async (
  interaction: ChannelSelectMenuInteraction,
  store: CobwebStore
): Promise<void> => {
  if (!interaction.guildId || !(await assertSetupPermission(interaction))) return;

  const channelId = interaction.values[0];
  if (!channelId) return;
  await interaction.deferUpdate();
  const field =
    interaction.customId === SETUP_COBWEB_CHANNEL_ID
      ? "cobwebChannelId"
      : "moderationChannelId";
  const settings = store.setGuildChannel(interaction.guildId, field, channelId);
  await interaction.editReply(await setupPanel(interaction.client, settings, "Channel updated."));
};

const handleSetupRoleSelect = async (
  interaction: RoleSelectMenuInteraction,
  store: CobwebStore
): Promise<void> => {
  if (!interaction.guildId || !(await assertSetupPermission(interaction))) return;

  await interaction.deferUpdate();
  const field =
    interaction.customId === SETUP_MALKAVIAN_ROLES_ID ? "malkavianRoleIds" : "stRoleIds";
  const settings = store.setGuildRoles(interaction.guildId, field, interaction.values);
  await interaction.editReply(await setupPanel(interaction.client, settings, "Roles updated."));
};

const handleSetupSettingsButton = async (
  interaction: ButtonInteraction,
  store: CobwebStore
): Promise<void> => {
  if (!interaction.guildId || !(await assertSetupPermission(interaction))) return;
  const settings = store.ensureGuildSettings(interaction.guildId);
  const modal = new ModalBuilder()
    .setCustomId(SETUP_SETTINGS_MODAL_ID)
    .setTitle("Cobweb limits & filters")
    .addComponents(
      textInputRow("max-length", "Maximum fragment length (20–200)", String(settings.maxLength)),
      textInputRow("cooldown", "User cooldown in minutes (1–1440)", String(settings.cooldownMinutes)),
      textInputRow("delay-window", "Random delay window in minutes (1–1440)", String(settings.delayWindowMinutes)),
      textInputRow(
        "blocked-terms",
        "Blocked terms (one per line)",
        settings.blockedTerms.join("\n"),
        false,
        TextInputStyle.Paragraph
      )
    );
  await interaction.showModal(modal);
};

const textInputRow = (
  customId: string,
  label: string,
  value: string,
  required = true,
  style = TextInputStyle.Short
): ActionRowBuilder<TextInputBuilder> =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(
    buildTextInput(customId, label, value, required, style)
  );

const buildTextInput = (
  customId: string,
  label: string,
  value: string,
  required: boolean,
  style: TextInputStyle
): TextInputBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(style === TextInputStyle.Paragraph ? 1000 : 4);
  if (value) input.setValue(value);
  return input;
};

const handleSetupSettingsModal = async (
  interaction: ModalSubmitInteraction,
  store: CobwebStore
): Promise<void> => {
  if (!interaction.guildId || !(await assertSetupPermission(interaction))) return;

  const maxLength = parseSetupInteger(interaction.fields.getTextInputValue("max-length"), 20, 200);
  const cooldown = parseSetupInteger(interaction.fields.getTextInputValue("cooldown"), 1, 1440);
  const delayWindow = parseSetupInteger(
    interaction.fields.getTextInputValue("delay-window"),
    1,
    1440
  );
  if (maxLength === null || cooldown === null || delayWindow === null) {
    await respondEphemeral(interaction, {
      content: "Use whole numbers in the displayed ranges for max length, cooldown, and delay window."
    });
    return;
  }

  const blockedTerms = interaction.fields
    .getTextInputValue("blocked-terms")
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (blockedTerms.some((term) => term.length > 100)) {
    await respondEphemeral(interaction, {
      content: "Each blocked term must be 100 characters or fewer."
    });
    return;
  }

  store.setGuildNumber(interaction.guildId, "maxLength", maxLength);
  store.setGuildNumber(interaction.guildId, "cooldownMinutes", cooldown);
  store.setGuildNumber(interaction.guildId, "delayWindowMinutes", delayWindow);
  const settings = store.setBlockedTerms(interaction.guildId, blockedTerms);
  if (interaction.isFromMessage()) {
    await interaction.deferUpdate();
    await interaction.editReply(
      await setupPanel(interaction.client, settings, "Limits and filters saved.")
    );
  } else {
    await respondEphemeral(
      interaction,
      await setupPanel(interaction.client, settings, "Limits and filters saved.")
    );
  }
};

const parseSetupInteger = (value: string, minimum: number, maximum: number): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};

const setupPanel = async (
  client: Client,
  settings: GuildSettings,
  prefix?: string
): Promise<Omit<InteractionReplyOptions, "flags" | "ephemeral">> => {
  const cobwebChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETUP_COBWEB_CHANNEL_ID)
    .setPlaceholder("Choose the Cobweb feed channel")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  const moderationChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETUP_MODERATION_CHANNEL_ID)
    .setPlaceholder("Choose the Storyteller moderation channel")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(1)
    .setMaxValues(1);
  const malkavianRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId(SETUP_MALKAVIAN_ROLES_ID)
    .setPlaceholder("Choose one or more Malkavian roles")
    .setMinValues(1)
    .setMaxValues(25);
  const stRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId(SETUP_ST_ROLES_ID)
    .setPlaceholder("Choose one or more Storyteller/admin roles")
    .setMinValues(1)
    .setMaxValues(25);

  if (settings.cobwebChannelId) cobwebChannelSelect.setDefaultChannels(settings.cobwebChannelId);
  if (settings.moderationChannelId) {
    moderationChannelSelect.setDefaultChannels(settings.moderationChannelId);
  }
  if (settings.malkavianRoleIds.length) {
    malkavianRoleSelect.setDefaultRoles(...settings.malkavianRoleIds);
  }
  if (settings.stRoleIds.length) stRoleSelect.setDefaultRoles(...settings.stRoleIds);

  return {
    content: await formatSetupResponse(client, settings, prefix),
    components: [
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(cobwebChannelSelect),
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(moderationChannelSelect),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(malkavianRoleSelect),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(stRoleSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SETUP_SETTINGS_BUTTON_ID)
          .setLabel("Edit limits & blocked terms")
          .setStyle(ButtonStyle.Primary)
      )
    ],
    allowedMentions: { parse: [] }
  };
};

const formatSetupResponse = async (
  client: Client,
  settings: GuildSettings,
  prefix?: string
): Promise<string> => {
  const missing = setupMissingFields(settings);
  const cobwebChannel = settings.cobwebChannelId
    ? await safeFetchGuildTextChannel(client, settings.cobwebChannelId)
    : null;
  const moderationChannel = settings.moderationChannelId
    ? await safeFetchGuildTextChannel(client, settings.moderationChannelId)
    : null;
  const cobwebDiagnostic = settings.cobwebChannelId
    ? formatChannelDiagnostic(diagnoseCobwebChannel(cobwebChannel, client.user))
    : "Cobweb permissions: channel not set";
  const moderationDiagnostic = settings.moderationChannelId
    ? formatChannelDiagnostic(diagnoseModerationChannel(moderationChannel, client.user))
    : "Moderation permissions: channel not set";
  const lines = [
    ...(prefix ? [prefix, ""] : []),
    "Use the menus below to configure this server. Changes save immediately.",
    "",
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
