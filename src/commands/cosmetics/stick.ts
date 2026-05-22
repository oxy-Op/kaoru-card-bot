import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { placeSticker, removeSticker } from "../../services/cosmetics.service.js";

export const data = new SlashCommandBuilder()
  .setName("stick")
  .setDescription("Place or remove a sticker on a card")
  .addStringOption((opt) => opt.setName("card").setDescription("Card code").setRequired(true))
  .addIntegerOption((opt) => opt.setName("position").setDescription("Position 1-19").setRequired(true).setMinValue(1).setMaxValue(19))
  .addIntegerOption((opt) => opt.setName("sticker").setDescription("Sticker ID to place (omit to remove)"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const card = interaction.options.getString("card", true).trim();
  const stickerId = interaction.options.getInteger("sticker");
  const position = interaction.options.getInteger("position", true);

  if (stickerId) {
    const result = await placeSticker(interaction.user.id, interaction.user.username, card, stickerId, position);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    await interaction.reply(`Placed sticker #${stickerId} on \`${card}\` at position ${position}!`);
  } else {
    const result = await removeSticker(interaction.user.id, interaction.user.username, card, position);
    if (!result.success) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      return;
    }
    await interaction.reply(`Removed sticker from \`${card}\` position ${position}.`);
  }
}
