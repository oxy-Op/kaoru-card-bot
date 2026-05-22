import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { claimDaily } from "../../services/economy.service.js";
import { formatCooldown } from "../../services/cooldown.service.js";

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Collect your daily gold reward!");

export async function execute(interaction: ChatInputCommandInteraction) {
  const result = await claimDaily(interaction.user.id, interaction.user.username);

  if (!result.success) {
    await interaction.reply({
      content: `Already claimed! Come back in **${formatCooldown(result.remaining)}**.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.reply(`💰 You received **${result.amount} gold**!`);
}
