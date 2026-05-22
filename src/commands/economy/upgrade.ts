import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { upgradeCard } from "../../services/economy.service.js";
import { qualityStars } from "../../utils/codes.js";

export const data = new SlashCommandBuilder()
  .setName("upgrade")
  .setDescription("Upgrade a card's quality using Cinders")
  .addStringOption((opt) => opt.setName("card").setDescription("Card code to upgrade").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("card", true).trim();

  const result = await upgradeCard(interaction.user.id, interaction.user.username, code);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  await interaction.reply(
    `⬆️ Upgraded \`${code}\` to **${result.newQuality}** ${qualityStars(result.newQuality)} (cost: ${result.cost} Cinders)`
  );
}
