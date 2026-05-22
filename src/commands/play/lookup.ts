import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { searchCharacters } from "../../services/card.service.js";
import { buildPaginationRow } from "../../utils/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("lookup")
  .setDescription("Search for characters in the database")
  .addStringOption((opt) =>
    opt.setName("query").setDescription("Character name to search").setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt.setName("page").setDescription("Page number").setMinValue(1)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true).trim();
  const page = interaction.options.getInteger("page") ?? 1;

  await interaction.deferReply();

  const result = await searchCharacters(query, page, 10);

  if (result.total === 0) {
    await interaction.editReply(`No characters found matching "${query}".`);
    return;
  }

  const lines = result.characters.map((c, i) => {
    const idx = (result.page - 1) * 10 + i + 1;
    const pop = c.popularity ? ` (♥ ${c.popularity})` : "";
    return `\`${idx}.\` **${c.name}** — ${c.series}${pop}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`Search: "${query}"`)
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `${result.total} results | Page ${result.page}/${result.totalPages}`,
    });

  const components =
    result.totalPages > 1
      ? [buildPaginationRow(result.page, result.totalPages, `lookup:${query}`)]
      : [];

  await interaction.editReply({ embeds: [embed], components });
}
