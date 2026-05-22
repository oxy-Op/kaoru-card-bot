import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { users, cards, characters, characterEditions } from "../../db/schema.js";
import { and, eq, gte, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";
import { newCardCode, rollQuality } from "../../utils/codes.js";

const PACK_TYPES = {
  standard: { cost: 300, costType: "gold" as const, cardCount: 3, label: "Standard Pack", description: "3 random cards" },
  premium: { cost: 25, costType: "shards" as const, cardCount: 5, label: "Premium Pack", description: "5 random cards (higher quality odds)" },
  legendary: { cost: 100, costType: "shards" as const, cardCount: 5, label: "Legendary Pack", description: "5 cards with guaranteed rare+ character" },
  rose: { cost: 12, costType: "roses" as const, cardCount: 3, label: "Rose Pack", description: "3 curated cards from high-demand pool" },
};

export const data = new SlashCommandBuilder()
  .setName("openpack")
  .setDescription("Open a card pack")
  .addStringOption((o) =>
    o.setName("type").setDescription("Pack type").setRequired(true)
      .addChoices(
        { name: "Standard (300 gold, 3 cards)", value: "standard" },
        { name: "Premium (25 shards, 5 cards)", value: "premium" },
        { name: "Legendary (100 shards, 5 cards, guaranteed rare+)", value: "legendary" },
        { name: "Rose Pack (12 roses, 3 curated cards)", value: "rose" },
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const packType = interaction.options.getString("type", true) as keyof typeof PACK_TYPES;
  const pack = PACK_TYPES[packType];

  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { gold: true, shards: true, roses: true },
  });

  const balance =
    pack.costType === "gold"
      ? (user?.gold ?? 0)
      : pack.costType === "shards"
        ? (user?.shards ?? 0)
        : (user?.roses ?? 0);
  if (balance < pack.cost) {
    await interaction.reply({
      content: `Need **${pack.cost} ${pack.costType}**. You have ${balance}.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  // Pull random characters
  const minPopularity = packType === "legendary" ? 500 : packType === "rose" ? 1200 : 0;
  const pool = await db
    .select({
      editionId: characterEditions.id,
      characterId: characterEditions.characterId,
      editionNumber: characterEditions.editionNumber,
      imagePath: characterEditions.imagePath,
      charName: characters.name,
      charSeries: characters.series,
      popularity: characters.popularity,
    })
    .from(characterEditions)
    .innerJoin(characters, eq(characterEditions.characterId, characters.id))
    .where(sql`${characters.popularity} >= ${minPopularity}`)
    .orderBy(sql`RANDOM()`)
    .limit(pack.cardCount);

  if (pool.length < pack.cardCount) {
    await interaction.editReply("Not enough packable characters available right now. Try again later.");
    return;
  }

  // Deduct cost with a guarded update to prevent concurrent underflow.
  let deducted = false;
  if (pack.costType === "gold") {
    const rows = await db
      .update(users)
      .set({ gold: sql`${users.gold} - ${pack.cost}` })
      .where(and(eq(users.id, userId), gte(users.gold, pack.cost)))
      .returning({ id: users.id });
    deducted = rows.length > 0;
  } else if (pack.costType === "roses") {
    const rows = await db
      .update(users)
      .set({ roses: sql`${users.roses} - ${pack.cost}` })
      .where(and(eq(users.id, userId), gte(users.roses, pack.cost)))
      .returning({ id: users.id });
    deducted = rows.length > 0;
  } else {
    const rows = await db
      .update(users)
      .set({ shards: sql`${users.shards} - ${pack.cost}` })
      .where(and(eq(users.id, userId), gte(users.shards, pack.cost)))
      .returning({ id: users.id });
    deducted = rows.length > 0;
  }

  if (!deducted) {
    await interaction.editReply("Your balance changed before this pack opened. Please try again.");
    return;
  }

  const pulledCards: { code: string; name: string; series: string; quality: string; print: number }[] = [];

  for (const pick of pool) {
    const code = newCardCode();
    const quality = packType === "premium"
      ? rollQuality(0.15) // boosted pristine odds
      : rollQuality();

    const [printResult] = await db
      .select({ maxPrint: sql<number>`COALESCE(MAX(${cards.printNumber}), 0)` })
      .from(cards)
      .where(eq(cards.editionId, pick.editionId));
    const printNumber = (printResult?.maxPrint ?? 0) + 1;

    await db.insert(cards).values({
      code,
      characterId: pick.characterId,
      editionId: pick.editionId,
      printNumber,
      quality,
      originalQuality: quality,
      summonerId: userId,
      ownerId: userId,
      guildId: interaction.guildId ?? "DM",
    });

    pulledCards.push({
      code,
      name: pick.charName,
      series: pick.charSeries,
      quality,
      print: printNumber,
    });
  }

  const cardList = pulledCards
    .map((c) => `\`${c.code}\` **${c.name}** — ${c.series} (${c.quality}, #${c.print})`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(packType === "legendary" ? 0xf1c40f : packType === "premium" ? 0x9b59b6 : 0x3498db)
    .setTitle(`📦 ${pack.label}`)
    .setDescription(`${cardList}\n\n*${pulledCards.length} cards added to your collection!*`);

  await interaction.editReply({ embeds: [embed] });
}
