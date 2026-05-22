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
  .setName("antisnipe")
  .setDescription("Set anti-snipe delay (0-10 seconds)")
  .addIntegerOption((opt) =>
    opt
      .setName("seconds")
      .setDescription("Seconds only the summoner can grab (0 = off)")
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(10)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "Use this in a server!", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need Manage Server to change anti-snipe settings.", ephemeral: true });
    return;
  }

  const seconds = interaction.options.getInteger("seconds", true);

  await ensureGuild(interaction.guild.id);
  await db
    .update(guilds)
    .set({ antiSnipeSeconds: seconds, updatedAt: new Date() })
    .where(eq(guilds.discordId, interaction.guild.id));

  if (seconds === 0) {
    await interaction.reply("Anti-snipe disabled.");
  } else {
    await interaction.reply(
      `Anti-snipe set to **${seconds}s** — only the summoner can grab for ${seconds} seconds.`
    );
  }
}
