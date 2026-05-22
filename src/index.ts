import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
} from "discord.js";
import { config } from "./config.js";
import { handleReady } from "./events/ready.js";

// Create the Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction],
});

// Bot ready
client.on(Events.ClientReady, handleReady);

// Message handler (prefix commands + activity tracking)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const { handleMessage } = await import("./events/messageCreate.js");
  await handleMessage(message);
});

// Interaction handler (slash commands + buttons)
client.on(Events.InteractionCreate, async (interaction) => {
  const { handleInteraction } = await import("./events/interactionCreate.js");
  await handleInteraction(interaction);
});

// Web admin_users ↔ Discord roles (optional; see ADMIN_SYNC_* env)
client.on(Events.GuildMemberUpdate, async (_old, member) => {
  try {
    const { handleAdminPanelMemberChange } = await import(
      "./events/adminPanelSync.js"
    );
    await handleAdminPanelMemberChange(member);
  } catch (err) {
    console.error("[Kaoru] admin panel sync (member update):", err);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const { handleAdminPanelMemberChange } = await import(
      "./events/adminPanelSync.js"
    );
    await handleAdminPanelMemberChange(member);
  } catch (err) {
    console.error("[Kaoru] admin panel sync (member add):", err);
  }
});

// Login
client.login(config.DISCORD_TOKEN).catch((err) => {
  console.error("[Kaoru] Failed to login:", err.message);
  process.exit(1);
});

export { client };
