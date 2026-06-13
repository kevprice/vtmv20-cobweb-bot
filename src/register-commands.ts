import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandData } from "./commands.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discordToken);
const commands = commandData();

await rest.put(Routes.applicationCommands(config.discordClientId), {
  body: commands
});
console.log("Registered global Cobweb commands.");
