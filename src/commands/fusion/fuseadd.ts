import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { fuseAdd } from "../../services/fusion.service.js";

export const data = new SlashCommandBuilder()
  .setName("fuseadd")
  .setDescription("Add cards to your fusion board")
  .addStringOption((opt) =>
    opt.setName("cards").setDescription("Card codes (space-separated)").setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const input = interaction.options.getString("cards", true);
  const codes = input.trim().split(/\s+/);

  const result = await fuseAdd(interaction.user.id, interaction.user.username, codes);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  await interaction.reply(`🔥 Added **${result.added}** card(s) to your fusion board.`);
}
