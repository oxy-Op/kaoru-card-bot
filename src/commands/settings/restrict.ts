import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { guilds } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureGuild } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("restrict")
  .setDescription("Restrict a command category to specific channels")
  .addStringOption((opt) => opt.setName("category").setDescription("Command category").setRequired(true)
    .addChoices(
      { name: "Play", value: "play" },
      { name: "Economy", value: "economy" },
      { name: "Fusion", value: "fusion" },
      { name: "Cosmetics", value: "cosmetics" },
    ))
  .addChannelOption((opt) => opt.setName("channel").setDescription("Channel to restrict to (empty to clear)").addChannelTypes(ChannelType.GuildText))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use this in a server!", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server to update command restrictions.", ephemeral: true });
    return;
  }

  const category = interaction.options.getString("category", true);
  const channel = interaction.options.getChannel("channel");

  const guild = await ensureGuild(interaction.guild.id);
  const restricted = (guild.restrictedChannels ?? {}) as Record<string, string[]>;

  if (channel) {
    if (!restricted[category]) restricted[category] = [];
    if (!restricted[category].includes(channel.id)) {
      restricted[category].push(channel.id);
    }
    await db.update(guilds).set({ restrictedChannels: restricted, updatedAt: new Date() })
      .where(eq(guilds.discordId, interaction.guild.id));
    await interaction.reply(`Restricted **${category}** commands to <#${channel.id}>`);
  } else {
    delete restricted[category];
    await db.update(guilds).set({ restrictedChannels: restricted, updatedAt: new Date() })
      .where(eq(guilds.discordId, interaction.guild.id));
    await interaction.reply(`Cleared restrictions for **${category}** commands.`);
  }
}
