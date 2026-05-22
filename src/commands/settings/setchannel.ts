import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { guilds } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ensureGuild } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("setchannel")
  .setDescription("Set the summon channel (or clear it)")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("Channel for summons (leave empty to clear)")
      .addChannelTypes(ChannelType.GuildText)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use this in a server!", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server to set summon channels.", ephemeral: true });
    return;
  }

  const channel = interaction.options.getChannel("channel");

  await ensureGuild(interaction.guild.id);
  await db
    .update(guilds)
    .set({
      summonChannelId: channel?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(guilds.discordId, interaction.guild.id));

  if (channel) {
    await interaction.reply(`Summon channel set to <#${channel.id}>`);
  } else {
    await interaction.reply("Summon channel cleared — summons work in any channel now.");
  }
}
