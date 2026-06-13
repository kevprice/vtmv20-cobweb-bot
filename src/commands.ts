import {
  ApplicationCommandType,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder
} from "discord.js";
import { COBWEB_CATEGORIES } from "./types.js";

export const COBWEB_COMMAND = "cobweb";
export const COBWEB_ST_COMMAND = "cobweb_st";

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
    .toJSON()
].map((command) => ({ ...command, type: ApplicationCommandType.ChatInput }));

