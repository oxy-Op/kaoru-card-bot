import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { getFusionBoard } from "../../services/fusion.service.js";

export const data = new SlashCommandBuilder()
  .setName("fusionboard")
  .setDescription("View your fusion board");

export async function execute(interaction: ChatInputCommandInteraction) {
  const board = await getFusionBoard(interaction.user.id);

  if (board.length === 0) {
    await interaction.reply("Your fusion board is empty. Use `/fuseadd` to add cards!");
    return;
  }

  const lines = board.map((c, i) => `\`${i + 1}.\` \`${c.code}\` — ${c.quality}`);

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`${interaction.user.username}'s Fusion Board`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `${board.length} cards | Need 3 to fuse` });

  await interaction.reply({ embeds: [embed] });
}
