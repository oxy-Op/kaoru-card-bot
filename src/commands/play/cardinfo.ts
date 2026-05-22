import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { cards, users } from "../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { getCardByCode, getWishlistCount } from "../../services/card.service.js";
import { loadCharacterImage } from "../../image/renderer.js";
import { formatPrint } from "../../utils/codes.js";

const QUALITY_DISPLAY: Record<string, { emoji: string; label: string }> = {
  damaged: { emoji: "💔", label: "Damaged" },
  poor: { emoji: "🍂", label: "Poor" },
  good: { emoji: "🍀", label: "Good" },
  excellent: { emoji: "💎", label: "Excellent" },
  pristine: { emoji: "💠", label: "Pristine" },
};

const QUALITY_COLORS: Record<string, number> = {
  damaged: 0x808080,
  poor: 0xc0c0c0,
  good: 0x3498db,
  excellent: 0x9b59b6,
  pristine: 0xf1c40f,
};

export const data = new SlashCommandBuilder()
  .setName("cardinfo")
  .setDescription("View detailed info about a card")
  .addStringOption((opt) =>
    opt.setName("code").setDescription("The card code (omit to show your last card)").setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("code")?.trim();

  let card;
  if (!code) {
    const [userRecord] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, interaction.user.id))
      .limit(1);
    if (!userRecord) {
      await interaction.reply({ content: "You haven't grabbed any cards yet!", ephemeral: true });
      return;
    }
    const [lastCard] = await db
      .select({ code: cards.code })
      .from(cards)
      .where(eq(cards.ownerId, userRecord.id))
      .orderBy(desc(cards.grabbedAt))
      .limit(1);
    if (!lastCard) {
      await interaction.reply({ content: "You don't own any cards yet!", ephemeral: true });
      return;
    }
    card = await getCardByCode(lastCard.code);
  } else {
    card = await getCardByCode(code);
  }

  if (!card) {
    await interaction.reply({ content: "Card not found.", ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const hearts = await getWishlistCount(card.character.id);

  // Quality display
  const currentQ = QUALITY_DISPLAY[card.quality] ?? { emoji: "🍀", label: card.quality };
  const origQuality = card.originalQuality ?? card.quality;
  const originalQ = QUALITY_DISPLAY[origQuality] ?? { emoji: "🍀", label: origQuality };
  const qualityLine = card.quality !== origQuality
    ? `${originalQ.emoji} · ${originalQ.label} --> ${currentQ.emoji} · ${currentQ.label}`
    : `${currentQ.emoji} · ${currentQ.label}`;

  // Summoned timestamp
  const summonedDate = card.summonedAt.toUTCString().replace("GMT", "UTC");

  // Build description lines
  const lines: string[] = [
    `Likes · ❤️${hearts}`,
    `Code · ${card.code}`,
    `Name · **${card.character.name}**`,
    `Series · **${card.character.series}**`,
    `Print · ${formatPrint(card.printNumber)}`,
    `Edition · ◎${card.edition.editionNumber}`,
    `Quality · ${qualityLine}`,
    "",
    `Summoned on ${summonedDate}`,
    `Summoned in Server ID ${card.guildId}`,
    `Source · ${card.edition.generationMethod.toUpperCase()}`,
    "",
    `Owner · ${card.ownerDiscordId ? `<@${card.ownerDiscordId}>` : "None"}`,
    `Grabber · ${card.grabberDiscordId ? `<@${card.grabberDiscordId}>` : "None"}`,
    `Summoner · ${card.summonerDiscordId ? `<@${card.summonerDiscordId}>` : "Unknown"}`,
  ];

  if (card.tag) {
    lines.push(`Tag · ${card.tagEmoji ?? "🏷️"} ${card.tag}`);
  }

  // Load card image for thumbnail
  let attachment: AttachmentBuilder | undefined;
  const filename = `card-${card.code}.png`;
  try {
    const imageBuffer = await loadCharacterImage(card.edition.imagePath);
    attachment = new AttachmentBuilder(imageBuffer, { name: filename });
  } catch {
    // No image available — embed without thumbnail
  }

  const embed = new EmbedBuilder()
    .setColor(QUALITY_COLORS[card.quality] ?? 0x3498db)
    .setTitle("Card Info")
    .setDescription(lines.join("\n"));

  if (attachment) {
    embed.setThumbnail(`attachment://${filename}`);
  }

  await interaction.editReply({
    embeds: [embed],
    ...(attachment ? { files: [attachment] } : {}),
  });
}
