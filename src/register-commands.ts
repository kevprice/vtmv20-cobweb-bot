import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandData } from "./commands.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);
const commands = commandData();

for (const guild of config.guilds) {
  await rest.put(Routes.applicationGuildCommands(config.discordClientId, guild.guildId), {
    body: commands
  });
  console.log(`Registered Cobweb commands for guild ${guild.guildId}`);
}

