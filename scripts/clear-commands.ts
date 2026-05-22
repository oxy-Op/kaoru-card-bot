import "dotenv/config";
import { REST, Routes } from "discord.js";

async function main() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

  // Clear global commands
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), { body: [] });
  console.log("Cleared global commands");

  // Clear guild commands if dev guild set
  if (process.env.DISCORD_DEV_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID!, process.env.DISCORD_DEV_GUILD_ID),
      { body: [] }
    );
    console.log("Cleared guild commands");
  }

  console.log("Done — restart the bot to re-register fresh");
}

main().catch(console.error);
