import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { getUserCollection, type CollectionFilter } from "../../services/card.service.js";
import { qualityStars, formatPrint, formatEdition } from "../../utils/codes.js";

export const data = new SlashCommandBuilder()
  .setName("collection")
  .setDescription("View your card collection")
  .addUserOption((opt) =>
    opt.setName("user").setDescription("User to view (default: you)")
  )
  .addStringOption((opt) =>
    opt.setName("character").setDescription("Filter by character name")
  )
  .addStringOption((opt) =>
    opt.setName("series").setDescription("Filter by series")
  )
  .addStringOption((opt) =>
    opt
      .setName("quality")
      .setDescription("Filter by quality")
      .addChoices(
        { name: "Damaged", value: "damaged" },
        { name: "Poor", value: "poor" },
        { name: "Good", value: "good" },
        { name: "Excellent", value: "excellent" },
        { name: "Pristine", value: "pristine" }
      )
  )
  .addStringOption((opt) =>
    opt.setName("tag").setDescription("Filter by tag")
  )
  .addStringOption((opt) =>
    opt
      .setName("sort")
      .setDescription("Sort order")
      .addChoices(
        { name: "Newest", value: "newest" },
        { name: "Oldest", value: "oldest" },
        { name: "Print #", value: "print" },
        { name: "Quality", value: "quality" }
      )
  )
  .addIntegerOption((opt) =>
    opt.setName("page").setDescription("Page number").setMinValue(1)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;
  const targetDbUser = await db.query.users.findFirst({
    where: eq(users.discordId, targetUser.id),
    columns: { privateFields: true },
  });
  if (
    targetUser.id !== interaction.user.id &&
    targetDbUser?.privateFields?.includes("collection")
  ) {
    await interaction.reply({ content: "This user's collection is private.", ephemeral: true });
    return;
  }

  const page = interaction.options.getInteger("page") ?? 1;
  const sort = (interaction.options.getString("sort") ?? "newest") as
    | "newest"
    | "oldest"
    | "print"
    | "quality";

  const filter: CollectionFilter = {};
  const charFilter = interaction.options.getString("character");
  const seriesFilter = interaction.options.getString("series");
  const qualityFilter = interaction.options.getString("quality");
  const tagFilter = interaction.options.getString("tag");

  if (charFilter) filter.characterName = charFilter;
  if (seriesFilter) filter.series = seriesFilter;
  if (qualityFilter) filter.quality = qualityFilter;
  if (tagFilter) filter.tag = tagFilter;

  await interaction.deferReply();

  const result = await getUserCollection(
    targetUser.id,
    page,
    6,
    filter,
    sort
  );

  if (result.total === 0) {
    await interaction.editReply(
      targetUser.id === interaction.user.id
        ? "Your collection is empty! Use `/summon` to get your first card."
        : `${targetUser.username}'s collection is empty.`
    );
    return;
  }

  const lines = result.cards.map((card, i) => {
    const idx = (result.page - 1) * 6 + i + 1;
    const stars = qualityStars(card.quality);
    const likes = card.character.popularity ?? 0;
    return `╭ \`${idx}.\` **${card.character.name}**\n` +
      `│ ${card.character.series}\n` +
      `│ ${formatEdition(card.edition.editionNumber)} · ${formatPrint(card.printNumber)} · ${stars} · 🤍${likes}\n` +
      `╰ \`${card.code}\``;
  });

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`${targetUser.username}'s Collection`)
    .setDescription(lines.join("\n"))
    .setFooter({
      text: `Showing ${(result.page - 1) * 6 + 1}-${(result.page - 1) * 6 + result.cards.length} of ${result.total} · Page ${result.page}/${result.totalPages}`,
    });

  const components =
    result.totalPages > 1
      ? [buildCollectionPaginationRow(result.page, result.totalPages, interaction.user.id, filter, sort)]
      : [];

  await interaction.editReply({ embeds: [embed], components });
}

function buildCollectionPaginationRow(
  page: number,
  totalPages: number,
  viewerDiscordId: string,
  filter: CollectionFilter,
  sort: "newest" | "oldest" | "print" | "quality"
) {
  const filterArgs: string[] = [];
  if (filter.characterName) filterArgs.push(`c=${filter.characterName}`);
  if (filter.series) filterArgs.push(`s=${filter.series}`);
  if (filter.quality) {
    const qNum =
      filter.quality === "damaged" ? 1
        : filter.quality === "poor" ? 2
          : filter.quality === "good" ? 3
            : filter.quality === "excellent" ? 4
              : filter.quality === "pristine" ? 5
                : 0;
    if (qNum > 0) filterArgs.push(`q=${qNum}`);
  }
  if (filter.tag) filterArgs.push(`t=${filter.tag}`);

  const sortArg =
    sort === "print" ? "o=print"
      : sort === "quality" ? "o=quality"
        : sort === "oldest" ? "o=oldest"
          : "o=newest";
  filterArgs.push(sortArg);

  const filterEncoded = filterArgs.length > 0 ? `:${encodeURIComponent(filterArgs.join(" "))}` : "";
  const eid = encodeURIComponent(viewerDiscordId);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`col:prev:${page - 1}:${eid}${filterEncoded}`)
      .setEmoji("⬅")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`col:next:${page + 1}:${eid}${filterEncoded}`)
      .setEmoji("➡")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages)
  );
}
