import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { guilds } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureGuild } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("prefix")
  .setDescription("Set the bot prefix for this server")
  .addStringOption((opt) =>
    opt
      .setName("prefix")
      .setDescription("New prefix (1-5 characters)")
      .setRequired(true)
      .setMaxLength(5)
      .setMinLength(1)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use this in a server!", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server to change the prefix.", ephemeral: true });
    return;
  }

  const newPrefix = interaction.options.getString("prefix", true);

  await ensureGuild(interaction.guild.id);
  await db
    .update(guilds)
    .set({ prefix: newPrefix, updatedAt: new Date() })
    .where(eq(guilds.discordId, interaction.guild.id));

  await interaction.reply(`Prefix updated to \`${newPrefix}\``);
}
