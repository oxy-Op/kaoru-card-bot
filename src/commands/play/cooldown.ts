import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getAllCooldowns } from "../../services/cooldown.service.js";
import { buildCooldownEmbed } from "../../utils/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("cooldown")
  .setDescription("Check your cooldown timers");

export async function execute(interaction: ChatInputCommandInteraction) {
  const cooldowns = await getAllCooldowns(interaction.user.id);

  const embed = buildCooldownEmbed(cooldowns, interaction.user.username);
  await interaction.reply({ embeds: [embed] });
}
