import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { fastFuse } from "../../services/fusion.service.js";

export const data = new SlashCommandBuilder()
  .setName("fastfuse")
  .setDescription("Fuse all possible cards from your board at once");

export async function execute(interaction: ChatInputCommandInteraction) {
  const result = await fastFuse(interaction.user.id, interaction.user.username);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  await interaction.reply(
    `🔥 Fast fused **${result.totalFused}** cards! Earned **${result.goldEarned} gold** + **${result.cindersEarned} cinders**. ` +
    `Added **${result.pileAdded}** entries to Fusion Pile. ` +
    `Board: ${result.remaining} remaining.`
  );
}
