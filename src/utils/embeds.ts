import {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ColorResolvable,
} from "discord.js";
import { qualityStars, formatPrint, formatEdition } from "./codes.js";

// ─── Quality colors ────────────────────────────────────

const QUALITY_COLORS: Record<string, ColorResolvable> = {
  damaged: 0x808080,
  poor: 0xc0c0c0,
  good: 0x3498db,
  excellent: 0x9b59b6,
  pristine: 0xf1c40f,
};

const QUALITY_GEMS: Record<string, string> = {
  damaged: "⬛",
  poor: "◇",
  good: "◆",
  excellent: "💎",
  pristine: "💠",
};

// ─── Card View Embed ───────────────────────────────────

interface CardEmbedData {
  code: string;
  characterName: string;
  series: string;
  quality: string;
  printNumber: number;
  editionNumber: number;
  imageBuffer: Buffer;
  tag?: string;
  tagEmoji?: string;
}

export function buildCardEmbed(card: CardEmbedData) {
  const filename = `card-${card.code}.png`;
  const attachment = new AttachmentBuilder(card.imageBuffer, { name: filename });

  const tagDisplay = card.tag
    ? `${card.tagEmoji ?? "🏷️"} ${card.tag}`
    : "";

  const embed = new EmbedBuilder()
    .setColor(QUALITY_COLORS[card.quality] ?? 0x3498db)
    .setTitle(card.characterName)
    .setDescription(
      [
        card.series,
        `${qualityStars(card.quality)}  ${formatPrint(card.printNumber)}  ${formatEdition(card.editionNumber)}`,
        tagDisplay,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setImage(`attachment://${filename}`)
    .setFooter({ text: `Code: ${card.code}` });

  return { embed, attachment };
}

// ─── Summon Embed (multi-card) ─────────────────────────

interface SummonEmbedData {
  summonId: string;
  summonerName: string;
  cardCount: number;
  imageBuffer: Buffer;
  isActivitySpawn: boolean;
}

/** Build summon message — no embed, just image + text + buttons. */
export function buildSummonMessage(data: SummonEmbedData) {
  const filename = `summon-${data.summonId}.png`;
  const attachment = new AttachmentBuilder(data.imageBuffer, { name: filename });

  const content = data.isActivitySpawn
    ? `✨ **Activity Summon** — pick a card!`
    : `<@${data.summonerName}> is summoning ${data.cardCount} cards!`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`grab:${data.summonId}:0`)
      .setLabel("1")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`grab:${data.summonId}:1`)
      .setLabel("2")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`grab:${data.summonId}:2`)
      .setLabel("?")
      .setStyle(ButtonStyle.Secondary)
  );

  return { content, attachment, row };
}

/** Build the grab result line shown below the summon. */
export function formatGrabLine(
  discordId: string,
  cardCode: string,
  quality: string,
  editionNumber: number,
  printNumber: number,
  series: string,
  characterName: string,
  hearts: number = 0
): string {
  const gem = QUALITY_GEMS[quality] ?? "◆";
  return `<@${discordId}> grabbed ♥${hearts} · \`${cardCode}\` · ${gem} · ◎ ${editionNumber} · #${printNumber} · ${series} · **${characterName}**`;
}

// ─── Cooldown Embed ────────────────────────────────────

export function buildCooldownEmbed(
  cooldowns: Record<string, number>,
  username: string
) {
  const formatTime = (s: number) => {
    if (s <= 0) return "✅ Ready";
    // Use Discord relative timestamp for live countdown
    const readyAt = Math.floor(Date.now() / 1000) + s;
    return `⏳ <t:${readyAt}:R>`;
  };

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setAuthor({ name: `${username}'s Cooldowns` })
    .setDescription(
      Object.entries(cooldowns)
        .map(([type, sec]) => `**${type.charAt(0).toUpperCase() + type.slice(1)}** · ${formatTime(sec)}`)
        .join("\n")
    );
}

// ─── Pagination ────────────────────────────────────────

export function buildPaginationRow(currentPage: number, totalPages: number, prefix: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}:first`)
      .setLabel("⏮")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}:prev`)
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}:page`)
      .setLabel(`${currentPage}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${prefix}:next`)
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
    new ButtonBuilder()
      .setCustomId(`${prefix}:last`)
      .setLabel("⏭")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages)
  );
}
