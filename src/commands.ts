import {
  ApplicationCommandType,
  PermissionFlagsBits,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder
} from "discord.js";

export const COBWEB_COMMAND = "cobweb";
export const COBWEB_ST_COMMAND = "cobweb_st";
export const CWSETUP_COMMAND = "cwsetup";

export const commandData = (): RESTPostAPIChatInputApplicationCommandsJSONBody[] => [
  new SlashCommandBuilder()
    .setName(COBWEB_COMMAND)
    .setDescription("Whisper an anonymous fragment into the Cobweb.")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("A short fragment for the Cobweb.")
        .setRequired(true)
        .setMaxLength(200)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName(COBWEB_ST_COMMAND)
    .setDescription("Add anonymous ST noise or hints to the Cobweb.")
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("A short fragment for the Cobweb.")
        .setRequired(true)
        .setMaxLength(200)
    )
    .addIntegerOption((option) =>
      option
        .setName("delay-minutes")
        .setDescription("Minutes before this ST fragment posts. Omit or use 0 for immediate.")
        .setMinValue(0)
        .setMaxValue(1440)
        .setRequired(false)
    )
    .toJSON()
  ,
  new SlashCommandBuilder()
    .setName(CWSETUP_COMMAND)
    .setDescription("Open the Cobweb setup panel for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON()
].map((command) => ({ ...command, type: ApplicationCommandType.ChatInput }));
