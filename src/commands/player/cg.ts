import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { characterEditions, characters } from "../../db/schema.js";
import { ensureUser } from "../../services/summon.service.js";
import { checkLevel, LEVEL_REQUIREMENTS } from "../../services/level.service.js";
import { getCardByCode } from "../../services/card.service.js";
import { listActiveAuctions } from "../../services/auction.service.js";
import { listActiveBounties } from "../../services/bounty.service.js";

export const data = new SlashCommandBuilder()
  .setName("cg")
  .setDescription("Card hunter + marketplace search")
  .addStringOption((opt) =>
    opt
      .setName("query")
      .setDescription("Character, series, card code, or ID")
      .setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("Rows per section")
      .setMinValue(1)
      .setMaxValue(10)
  );

interface CgResult {
  cardHit: ReturnType<typeof getCardByCode> extends Promise<infer T> ? T : never;
  chars: Array<{
    id: number;
    name: string;
    series: string;
    popularity: number | null;
    editionNumbers: number[];
  }>;
  auctions: Awaited<ReturnType<typeof listActiveAuctions>>;
  bounties: Awaited<ReturnType<typeof listActiveBounties>>;
}

async function runCgSearch(query: string, limit: number): Promise<CgResult> {
  const normalized = query.trim();
  const lower = normalized.toLowerCase();
  const parsedId = Number.parseInt(normalized, 10);
  const idLike = Number.isFinite(parsedId) ? parsedId : null;
  const cardLike = /^[A-Za-z0-9]{6}$/.test(normalized);
  const charWhere = idLike
    ? or(
      ilike(characters.name, `%${normalized}%`),
      ilike(characters.series, `%${normalized}%`),
      eq(characters.id, idLike)
    )
    : or(
      ilike(characters.name, `%${normalized}%`),
      ilike(characters.series, `%${normalized}%`)
    );

  const [cardHit, charsRaw, auctionsAll, bountiesAll] = await Promise.all([
    cardLike ? getCardByCode(normalized) : Promise.resolve(null),
    db
      .select({
        id: characters.id,
        name: characters.name,
        series: characters.series,
        popularity: characters.popularity,
      })
      .from(characters)
      .where(charWhere)
      .orderBy(desc(characters.popularity))
      .limit(limit),
    listActiveAuctions(100),
    listActiveBounties(100),
  ]);

  const editionRows = charsRaw.length > 0
    ? await db
      .select({
        characterId: characterEditions.characterId,
        editionNumber: characterEditions.editionNumber,
      })
      .from(characterEditions)
      .where(
        and(
          inArray(characterEditions.characterId, charsRaw.map((c) => c.id)),
          eq(characterEditions.isOfficial, true)
        )
      )
      .orderBy(characterEditions.editionNumber)
    : [];

  const editionsByChar = new Map<number, number[]>();
  for (const row of editionRows) {
    const list = editionsByChar.get(row.characterId) ?? [];
    list.push(row.editionNumber);
    editionsByChar.set(row.characterId, list);
  }

  const chars = charsRaw.map((c) => ({
    ...c,
    editionNumbers: editionsByChar.get(c.id) ?? [],
  }));

  const auctions = auctionsAll
    .filter((a) =>
      a.cardCode.toLowerCase() === lower
      || a.cardCode.toLowerCase().includes(lower)
      || a.characterName.toLowerCase().includes(lower)
      || a.series.toLowerCase().includes(lower)
      || String(a.id) === normalized
    )
    .slice(0, limit);

  const bounties = bountiesAll
    .filter((b) =>
      b.characterName.toLowerCase().includes(lower)
      || b.series.toLowerCase().includes(lower)
      || String(b.id) === normalized
      || String(b.characterId) === normalized
    )
    .slice(0, limit);

  return { cardHit, chars, auctions, bounties };
}

function buildCgEmbed(username: string, query: string, result: CgResult): EmbedBuilder {
  const sections: string[] = [];

  if (result.cardHit) {
    sections.push(
      `### Card Match\n` +
      `\`${result.cardHit.code}\` • **${result.cardHit.character.name}** (${result.cardHit.character.series})\n` +
      `character_id=${result.cardHit.character.id} • edition_id=${result.cardHit.edition.id} • ed#=${result.cardHit.edition.editionNumber} • print=#${result.cardHit.printNumber}`
    );
  }

  if (result.chars.length > 0) {
    sections.push(
      `### Character IDs\n` +
      result.chars
        .map((c) => {
          const editions = c.editionNumbers.length > 0 ? c.editionNumbers.join(",") : "none";
          return `id=${c.id} • **${c.name}** (${c.series}) • ed=[${editions}]`;
        })
        .join("\n")
    );
  }

  if (result.auctions.length > 0) {
    sections.push(
      `### Marketplace • Auctions\n` +
      result.auctions
        .map((a) => {
          const current = a.currentBid ?? a.startingBid;
          return `#${a.id} • \`${a.cardCode}\` • ${a.characterName} • ${current.toLocaleString()}g • <t:${Math.floor(a.endsAt.getTime() / 1000)}:R>`;
        })
        .join("\n")
    );
  }

  if (result.bounties.length > 0) {
    sections.push(
      `### Marketplace • Bounties\n` +
      result.bounties
        .map((b) =>
          `#${b.id} • ${b.characterName} (char_id=${b.characterId}) • ${b.goldAmount.toLocaleString()}g • <t:${Math.floor(b.expiresAt.getTime() / 1000)}:R>`
        )
        .join("\n")
    );
  }

  if (sections.length === 0) {
    sections.push("No card, character, auction, or bounty matches found.");
  }

  return new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle("Card Hunter")
    .setAuthor({ name: username })
    .setDescription(`Query: \`${query}\`\n\n${sections.join("\n\n")}`);
}

async function checkCgGate(discordId: string, username: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const ok = await checkLevel(userId, LEVEL_REQUIREMENTS.cardhunter);
  if (!ok) {
    return {
      ok: false,
      reason: `You need to be **Level ${LEVEL_REQUIREMENTS.cardhunter}** to use Card Hunter.`,
    };
  }
  return { ok: true };
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query", true).trim();
  const limit = interaction.options.getInteger("limit") ?? 5;

  const gate = await checkCgGate(interaction.user.id, interaction.user.username);
  if (!gate.ok) {
    await interaction.reply({ content: gate.reason, ephemeral: true });
    return;
  }

  await interaction.deferReply();
  const result = await runCgSearch(query, limit);
  const embed = buildCgEmbed(interaction.user.username, query, result);
  await interaction.editReply({ embeds: [embed] });
}

export async function executePrefix(message: Message, args: string[]) {
  const query = args.join(" ").trim();
  if (!query) {
    await message.reply("Usage: `cg <character|series|card_code|id>`");
    return;
  }

  const gate = await checkCgGate(message.author.id, message.author.username);
  if (!gate.ok) {
    await message.reply(gate.reason);
    return;
  }

  const result = await runCgSearch(query, 5);
  const embed = buildCgEmbed(message.author.username, query, result);
  await message.reply({ embeds: [embed] });
}
