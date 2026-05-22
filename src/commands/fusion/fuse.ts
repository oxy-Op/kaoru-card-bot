import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { fuse } from "../../services/fusion.service.js";

export const data = new SlashCommandBuilder()
  .setName("fuse")
  .setDescription("Fuse 3 cards from your board into Gold + Cinders");

export async function execute(interaction: ChatInputCommandInteraction) {
  const result = await fuse(interaction.user.id, interaction.user.username);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  await interaction.reply(
    `🔥 Fused **${result.fused}** cards! Earned **${result.goldEarned} gold** + **${result.cindersEarned} cinders**. ` +
    `Added **${result.pileAdded}** entry to Fusion Pile. ` +
    `Board: ${result.remaining} remaining.`
  );
}
