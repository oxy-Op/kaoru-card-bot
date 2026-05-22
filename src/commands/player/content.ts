import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { cards, characters, characterEditions } from "../../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("content")
  .setDescription("See recent summon activity in this server");

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    return;
  }

  const recent = await db
    .select({
      code: cards.code,
      printNumber: cards.printNumber,
      quality: cards.quality,
      ownerId: cards.ownerId,
      summonedAt: cards.summonedAt,
      charName: characters.name,
      series: characters.series,
      editionNum: characterEditions.editionNumber,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(characterEditions, eq(cards.editionId, characterEditions.id))
    .where(eq(cards.guildId, interaction.guildId))
    .orderBy(desc(cards.summonedAt))
    .limit(10);

  if (recent.length === 0) {
    await interaction.reply({ content: "No summons in this server yet!", ephemeral: true });
    return;
  }

  const lines = recent.map((r) => {
    const claimed = r.ownerId ? "✅" : "❌";
    const time = `<t:${Math.floor(r.summonedAt.getTime() / 1000)}:R>`;
    return `${claimed} **${r.charName}** · ${r.series}\n\u2003◎${r.editionNum} · #${r.printNumber} · \`${r.code}\` · ${time}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle("Recent Summons")
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `${interaction.guild?.name}` });

  await interaction.reply({ embeds: [embed] });
}
