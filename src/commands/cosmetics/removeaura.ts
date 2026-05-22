import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { removeAura } from "../../services/cosmetics.service.js";

export const data = new SlashCommandBuilder()
  .setName("removeaura")
  .setDescription("Remove an aura from a card")
  .addStringOption((o) => o.setName("card").setDescription("Card code").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const card = interaction.options.getString("card", true).trim();
  const result = await removeAura(interaction.user.id, interaction.user.username, card);
  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }
  await interaction.reply(
    `Removed aura **${result.auraName}** from \`${card}\` and returned it to your inventory.`
  );
}
