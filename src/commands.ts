import {
  ApplicationCommandType,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder
} from "discord.js";
import { COBWEB_CATEGORIES } from "./types.js";

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
    .addStringOption((option) => {
      option
        .setName("category")
        .setDescription("Internal ST-only category.")
        .setRequired(false);
      for (const category of COBWEB_CATEGORIES) {
        option.addChoices({ name: category, value: category });
      }
      return option;
    })
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
    .setDescription("Configure Cobweb for this server.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cobweb-channel")
        .setDescription("Set the private Cobweb feed channel.")
        .addChannelOption((option) =>
          option.setName("channel").setDescription("Cobweb feed channel.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("moderation-channel")
        .setDescription("Set the ST/admin moderation queue channel.")
        .addChannelOption((option) =>
          option.setName("channel").setDescription("Moderation queue channel.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("malkavian-role")
        .setDescription("Allow a role to read and submit to the Cobweb.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Malkavian role.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("st-role")
        .setDescription("Allow a role to administer and submit to the Cobweb.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("Storyteller/admin role.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("max-length")
        .setDescription("Set the maximum fragment length.")
        .addIntegerOption((option) =>
          option
            .setName("characters")
            .setDescription("Maximum characters per fragment.")
            .setMinValue(20)
            .setMaxValue(200)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cooldown")
        .setDescription("Set per-user submission cooldown.")
        .addIntegerOption((option) =>
          option
            .setName("minutes")
            .setDescription("Minutes between accepted submissions.")
            .setMinValue(1)
            .setMaxValue(1440)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delay-window")
        .setDescription("Set the random publish delay window.")
        .addIntegerOption((option) =>
          option
            .setName("minutes")
            .setDescription("Maximum minutes before a fragment surfaces.")
            .setMinValue(1)
            .setMaxValue(1440)
            .setRequired(true)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("blocked-term")
        .setDescription("Manage blocked terms for character names or spoilers.")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
            .setDescription("Add a blocked term.")
            .addStringOption((option) =>
              option
                .setName("term")
                .setDescription("Text to reject in future fragments.")
                .setRequired(true)
                .setMaxLength(100)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
            .setDescription("Remove a blocked term.")
            .addStringOption((option) =>
              option
                .setName("term")
                .setDescription("Blocked term to remove.")
                .setRequired(true)
                .setMaxLength(100)
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("show").setDescription("Show this server's Cobweb setup.")
    )
    .toJSON()
].map((command) => ({ ...command, type: ApplicationCommandType.ChatInput }));
