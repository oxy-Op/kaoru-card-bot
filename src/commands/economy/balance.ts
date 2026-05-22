import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { getBalance } from "../../services/economy.service.js";

export const data = new SlashCommandBuilder()
  .setName("balance")
  .setDescription("Check your currency balance")
  .addUserOption((opt) => opt.setName("user").setDescription("User to check"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const bal = await getBalance(target.id);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${target.username}'s Balance`)
    .setDescription(
      `💰 **Gold**: ${bal.gold}\n` +
      `🌸 **Petals**: ${bal.petals}\n` +
      `🌹 **Roses**: ${bal.roses}\n` +
      `🔥 **Cinders**: ${bal.cinders}\n` +
      `✨ **Shards**: ${bal.shards}`
    );

  await interaction.reply({ embeds: [embed] });
}
