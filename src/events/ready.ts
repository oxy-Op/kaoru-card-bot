import { type Client } from "discord.js";
import { config } from "../config.js";
import { registerCommands } from "../commands/index.js";

export async function handleReady(client: Client<true>) {
  console.log(`[Kaoru] Logged in as ${client.user.tag}`);
  console.log(`[Kaoru] Serving ${client.guilds.cache.size} guilds`);
  client.user.setActivity(
    `${config.DEFAULT_PREFIX}help in ${client.guilds.cache.size} servers!`
  );

  try {
    await registerCommands();
  } catch (err) {
    console.error("[Kaoru] Failed to register commands:", err);
  }
}
