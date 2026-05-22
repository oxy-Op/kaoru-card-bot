import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { characters, characterEditions } from "../../db/schema.js";
import { eq, sql, ilike, desc } from "drizzle-orm";
import { isDevUser } from "../../config.js";

export const data = new SlashCommandBuilder()
  .setName("browse")
  .setDescription("(Admin) Browse popular characters and their editions")
  .addStringOption((o) => o.setName("search").setDescription("Search by name or series").setRequired(false))
  .addIntegerOption((o) => o.setName("page").setDescription("Page number").setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!isDevUser(interaction.user.id)) {
    await interaction.reply({ content: "Only bot admins can use this command.", ephemeral: true });
    return;
  }

  const search = interaction.options.getString("search");
  const page = Math.max(1, interaction.options.getInteger("page") ?? 1);
  const perPage = 15;
  const offset = (page - 1) * perPage;

  let results;
  let total: number;

  if (search) {
    results = await db
      .select({ id: characters.id, name: characters.name, series: characters.series, popularity: characters.popularity })
      .from(characters)
      .where(sql`LOWER(${characters.name}) LIKE LOWER(${'%' + search + '%'}) OR LOWER(${characters.series}) LIKE LOWER(${'%' + search + '%'})`)
      .orderBy(desc(characters.popularity))
      .limit(perPage)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(characters)
      .where(sql`LOWER(${characters.name}) LIKE LOWER(${'%' + search + '%'}) OR LOWER(${characters.series}) LIKE LOWER(${'%' + search + '%'})`);
    total = count;
  } else {
    results = await db
      .select({ id: characters.id, name: characters.name, series: characters.series, popularity: characters.popularity })
      .from(characters)
      .orderBy(desc(characters.popularity))
      .limit(perPage)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(characters);
    total = count;
  }

  if (results.length === 0) {
    await interaction.reply({ content: "No characters found.", ephemeral: true });
    return;
  }

  // Get edition counts for these characters
  const charIds = results.map((c) => c.id);
  const edCounts = await db
    .select({ characterId: characterEditions.characterId, editions: sql<number>`count(*)` })
    .from(characterEditions)
    .where(sql`${characterEditions.characterId} IN (${sql.join(charIds.map(id => sql`${id}`), sql`,`)})`)
    .groupBy(characterEditions.characterId);

  const edMap = new Map(edCounts.map((e) => [e.characterId, e.editions]));

  const list = results.map((c, i) => {
    const eds = edMap.get(c.id) ?? 1;
    return `\`${c.id}\` · **${c.name}** · ${c.series} · ❤${c.popularity ?? 0} · ${eds} ed${eds > 1 ? "s" : ""}`;
  }).join("\n");

  const totalPages = Math.ceil(total / perPage);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🔍 Admin Browse")
    .setDescription(list)
    .setFooter({ text: `Page ${page}/${totalPages} · ${total} results · Use /grant <userid> <name> to grant` });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
