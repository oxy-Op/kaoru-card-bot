import {
  type Interaction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from "discord.js";
import { commands } from "../commands/index.js";
import { redis } from "../cache/index.js";
import { db } from "../db/index.js";
import { users, characters, characterEditions, cards, likeList } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import {
  grabCard,
  getSummonSession,
  type SummonedCard,
} from "../services/summon.service.js";
import { getCardByCode, getWishlistCount, getUserCollection, parseCollectionArgs } from "../services/card.service.js";
import { checkAntiBot } from "../services/antibot.service.js";
import { formatGrabLine } from "../utils/embeds.js";
import {
  renderCard,
  renderMysteryCard,
  renderSummonImage,
  loadCharacterImage,
} from "../image/renderer.js";
import { AttachmentBuilder } from "discord.js";
import { qualityStars } from "../utils/codes.js";

const PARTNER_REQUEST_TTL_MS = 10 * 60 * 1000;

export async function handleInteraction(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    const rlKey = `slash_rl:${interaction.user.id}`;
    const rl = await redis.get(rlKey);
    if (rl) { await interaction.reply({ content: "Slow down!", ephemeral: true }); return; }
    await redis.set(rlKey, "1", "EX", 3);

    const command = commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: "Unknown command.", ephemeral: true });
      return;
    }

    const antiBot = await checkAntiBot(interaction.user.id, interaction.commandName);
    if (!antiBot.allowed) {
      await interaction.reply({
        content: antiBot.reason ?? "Action blocked due to anti-bot checks.",
        ephemeral: true,
      });
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[Command] Error in /${interaction.commandName}:`, err);
      const msg = "Something went wrong!";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
  } else if (interaction.isButton()) {
    await handleButton(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction);
  }
}

async function handleButton(interaction: ButtonInteraction) {
  const parts = interaction.customId.split(":");
  const action = parts[0];

  switch (action) {
    case "grab":
      await handleGrab(interaction, parts[1], parseInt(parts[2], 10));
      break;
    case "partner_accept":
      await handlePartnerAccept(interaction, parseInt(parts[1], 10), parseInt(parts[2], 10));
      break;
    case "partner_reject":
      await handlePartnerReject(interaction, parseInt(parts[1], 10), parseInt(parts[2], 10));
      break;
    case "lu":
      await handleLookupPage(interaction, parts[1]);
      break;
    case "ludet":
      await handleLookupEditionNav(interaction);
      break;
    case "col":
      await handleCollectionPage(interaction);
      break;
    default:
      break;
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  const [action] = interaction.customId.split(":");

  if (action === "lu_edition") {
    await handleEditionSelect(interaction);
  }
}

async function handleGrab(
  interaction: ButtonInteraction,
  summonId: string,
  slot: number
) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  const result = await grabCard(summonId, slot, userId, username);

  if (!result.success) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }

  const foughtOffText = result.foughtOff ? ` fought off <@${result.foughtOff}> and` : "";

  if (result.type === "fusion_token") {
    await interaction.reply(
      `<@${userId}>${foughtOffText} grabbed a **Fusion Token**! 🔥 +${result.amount} Cinders`
    );
  } else if (result.type === "fusion_card") {
    const card = await getCardByCode(result.cardCode);
    if (!card) {
      await interaction.reply(`<@${userId}>${foughtOffText} pulled a **Fusion Pile** card! \`${result.cardCode}\``);
    } else {
      const hearts = await getWishlistCount(card.character.id);
      const grabLine = formatGrabLine(
        userId,
        card.code,
        card.quality,
        card.edition.editionNumber,
        card.printNumber,
        card.character.series,
        card.character.name,
        hearts
      );
      await interaction.reply(`🧪 **Fusion Pile Pull!**\n${grabLine}`);
    }
  } else {
    const card = await getCardByCode(result.cardCode);
    if (!card) {
      await interaction.reply(`<@${userId}>${foughtOffText} grabbed a card! \`${result.cardCode}\``);
    } else {
      const hearts = await getWishlistCount(card.character.id);
      const grabLine = formatGrabLine(
        userId,
        card.code,
        card.quality,
        card.edition.editionNumber,
        card.printNumber,
        card.character.series,
        card.character.name,
        hearts
      );
      const foughtPrefix = result.foughtOff ? `<@${userId}> fought off <@${result.foughtOff}> and grabbed` : "";
      await interaction.reply(foughtPrefix ? `${foughtPrefix}\n${grabLine}` : grabLine);
    }
  }

  // Check if all cards are grabbed or update buttons
  const session = await getSummonSession(summonId);
  if (session) {
    const allGrabbed = session.grabbed.every(Boolean);
    if (allGrabbed) {
      // Disable all buttons
      await disableButtons(interaction, summonId);
    } else {
      // Disable just the grabbed slot
      await updateButtons(interaction, summonId, session.grabbed);
    }
  }
}

async function updateButtons(
  interaction: ButtonInteraction,
  summonId: string,
  grabbed: boolean[]
) {
  try {
    const labels = ["1", "2", "?"];
    const styles = [ButtonStyle.Success, ButtonStyle.Primary, ButtonStyle.Secondary];

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...labels.map((label, i) =>
        new ButtonBuilder()
          .setCustomId(`grab:${summonId}:${i}`)
          .setLabel(grabbed[i] ? "✓" : label)
          .setStyle(grabbed[i] ? ButtonStyle.Danger : styles[i])
          .setDisabled(grabbed[i])
      )
    );

    await interaction.message.edit({ components: [row] });
  } catch {
    // Message might have been deleted or we lack permissions
  }
}

async function disableButtons(
  interaction: ButtonInteraction,
  summonId: string
) {
  try {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`grab:${summonId}:0`)
        .setLabel("✓")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`grab:${summonId}:1`)
        .setLabel("✓")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`grab:${summonId}:2`)
        .setLabel("✓")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );

    await interaction.message.edit({ components: [row] });
  } catch {
    // Message might have been deleted
  }
}

async function handlePartnerAccept(
  interaction: ButtonInteraction,
  initiatorDbId: number,
  targetDbId: number
) {
  if (Date.now() - interaction.message.createdTimestamp > PARTNER_REQUEST_TTL_MS) {
    await interaction.update({
      content: "This partner request expired. Send a new `/partner` request.",
      components: [],
    });
    return;
  }

  // Only the target can accept
  const [targetUser] = await db.select({ discordId: users.discordId })
    .from(users).where(eq(users.id, targetDbId)).limit(1);

  if (!targetUser || interaction.user.id !== targetUser.discordId) {
    await interaction.reply({ content: "Only the invited user can accept!", ephemeral: true });
    return;
  }

  let paired = false;
  try {
    paired = await db.transaction(async (tx) => {
      const [u1] = await tx
        .update(users)
        .set({ partnerId: targetDbId })
        .where(sql`${users.id} = ${initiatorDbId} AND ${users.partnerId} IS NULL`)
        .returning({ id: users.id });
      if (!u1) return false;

      const [u2] = await tx
        .update(users)
        .set({ partnerId: initiatorDbId })
        .where(sql`${users.id} = ${targetDbId} AND ${users.partnerId} IS NULL`)
        .returning({ id: users.id });
      if (!u2) {
        throw new Error("Target no longer eligible");
      }
      return true;
    });
  } catch {
    paired = false;
  }

  if (!paired) {
    await interaction.update({
      content: "This partner request is no longer valid (one of you already has a partner).",
      components: [],
    });
    return;
  }

  await interaction.update({
    content: `💕 Partnership formed!`,
    components: [],
  });
}

async function handlePartnerReject(
  interaction: ButtonInteraction,
  _initiatorDbId: number,
  targetDbId: number
) {
  if (Date.now() - interaction.message.createdTimestamp > PARTNER_REQUEST_TTL_MS) {
    await interaction.update({
      content: "This partner request already expired.",
      components: [],
    });
    return;
  }

  const [targetUser] = await db
    .select({ discordId: users.discordId })
    .from(users)
    .where(eq(users.id, targetDbId))
    .limit(1);

  if (!targetUser || interaction.user.id !== targetUser.discordId) {
    await interaction.reply({ content: "Only the invited user can decline!", ephemeral: true });
    return;
  }

  await interaction.update({ content: "💔 Partnership declined.", components: [] });
}

async function handleLookupPage(interaction: ButtonInteraction, direction: string) {
  // Custom ID format: lu:<direction>:<encodedQuery>:<page>
  const parts = interaction.customId.split(":");
  const query = decodeURIComponent(parts[2]);
  const page = parseInt(parts[3], 10);
  const perPage = 10;
  const offset = (page - 1) * perPage;

  const seriesResults = await db
    .select({
      id: characters.id,
      name: characters.name,
      series: characters.series,
      popularity: characters.popularity,
    })
    .from(characters)
    .where(sql`LOWER(${characters.series}) LIKE LOWER(${'%' + query + '%'})`)
    .orderBy(
      sql`COALESCE((SELECT count(*) FROM like_list WHERE character_id = ${characters.id}), 0) DESC`,
      desc(characters.popularity)
    )
    .limit(perPage)
    .offset(offset);

  const [{ total: seriesTotal }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(characters)
    .where(sql`LOWER(${characters.series}) LIKE LOWER(${'%' + query + '%'})`);

  const totalPages = Math.ceil(seriesTotal / perPage);

  if (seriesResults.length === 0) {
    await interaction.deferUpdate();
    return;
  }

  // Get real wishlist counts
  const charIds = seriesResults.map((c) => c.id);
  const heartCounts = charIds.length > 0 ? await db
    .select({ characterId: likeList.characterId, hearts: sql<number>`count(*)` })
    .from(likeList)
    .where(sql`${likeList.characterId} IN (${sql.join(charIds.map(id => sql`${id}`), sql`,`)})`)
    .groupBy(likeList.characterId) : [];
  const heartMap = new Map(heartCounts.map((h) => [h.characterId, h.hearts]));

  const list = seriesResults
    .map((c, i) => {
      const hearts = heartMap.get(c.id) ?? 0;
      return `${offset + i + 1}. ${c.series} · **${c.name}** · \`❤${hearts}\``;
    })
    .join("\n");

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${interaction.user.username}'s Lookup`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(`Type the number that corresponds to the characters you are looking for.\n\n${list}`)
    .setFooter({ text: `Showing characters ${offset + 1}-${offset + seriesResults.length} of ${seriesTotal}` });

  const q = encodeURIComponent(query.slice(0, 40));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lu:first:${q}:1`).setEmoji("⏮").setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`lu:prev:${q}:${page - 1}`).setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`lu:next:${q}:${page + 1}`).setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
    new ButtonBuilder().setCustomId(`lu:last:${q}:${totalPages}`).setEmoji("⏭").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

// ─── Edition select dropdown handler ────────────────────

async function handleEditionSelect(interaction: StringSelectMenuInteraction) {
  const editionId = parseInt(interaction.values[0], 10);
  const charId = parseInt(interaction.customId.split(":")[1], 10);

  await buildEditionEmbed(interaction, charId, editionId);
}

// ─── Edition nav buttons handler ────────────────────────

async function handleLookupEditionNav(interaction: ButtonInteraction) {
  const parts = interaction.customId.split(":");
  const action = parts[1];

  // Zoom: render full image from the edition
  if (action === "zoom") {
    const editionId = parseInt(parts[2], 10);
    if (!editionId) { await interaction.deferUpdate(); return; }

    await interaction.deferReply({ ephemeral: true });
    try {
      const ed = await db
        .select({ imagePath: characterEditions.imagePath, charId: characterEditions.characterId, edNum: characterEditions.editionNumber })
        .from(characterEditions)
        .where(eq(characterEditions.id, editionId))
        .limit(1);
      if (ed.length === 0) { await interaction.editReply("Edition not found."); return; }

      const char = await db
        .select({ name: characters.name, series: characters.series })
        .from(characters)
        .where(eq(characters.id, ed[0].charId))
        .limit(1);

      const { loadCharacterImage } = await import("../image/renderer.js");
      const img = await loadCharacterImage(ed[0].imagePath);

      const { AttachmentBuilder, EmbedBuilder: EB } = await import("discord.js");
      const attachment = new AttachmentBuilder(img, { name: "full-image.png" });
      const embed = new EB()
        .setColor(0x2b2d31)
        .setTitle(`🔍 ${char[0]?.name ?? "Unknown"} — ED${ed[0].edNum}`)
        .setDescription(char[0]?.series ?? "")
        .setImage("attachment://full-image.png");

      await interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch {
      await interaction.editReply("Could not load the image.");
    }
    return;
  }

  await interaction.deferUpdate();
}

// ─── Collection pagination handler ──────────────────────

async function handleCollectionPage(interaction: ButtonInteraction) {
  // customId: col:<direction>:<page>:<userId>[:<encodedFilters>]
  const parts = interaction.customId.split(":");
  const page = parseInt(parts[2], 10);
  const targetUserId = decodeURIComponent(parts[3]);
  const filterRaw = parts[4] ? decodeURIComponent(parts[4]) : "";

  if (interaction.user.id !== targetUserId) {
    await interaction.reply({ content: "This isn't your collection!", ephemeral: true });
    return;
  }

  const { filter, sort } = filterRaw
    ? parseCollectionArgs(filterRaw.split(" "))
    : { filter: {}, sort: "newest" as const };

  const result = await getUserCollection(targetUserId, page, 6, filter, sort);

  if (result.cards.length === 0) {
    await interaction.deferUpdate();
    return;
  }

  const list = result.cards
    .map((c) => {
      const likes = c.character.popularity ?? 0;
      const tagStr = c.tag ? ` · 🏷️${c.tag}` : "";
      return `╭ **${c.character.name}**\n` +
        `│ ${c.character.series}\n` +
        `│ ◎${c.edition.editionNumber} · #${c.printNumber} · ${qualityStars(c.quality)} · 🤍${likes}${tagStr}\n` +
        `╰ \`${c.code}\``;
    })
    .join("\n");

  const startIdx = (result.page - 1) * 6 + 1;
  const endIdx = startIdx + result.cards.length - 1;

  const filterEncoded = filterRaw ? `:${encodeURIComponent(filterRaw)}` : "";

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setAuthor({ name: `${interaction.user.username}'s Collection`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(list)
    .setFooter({ text: `Showing ${startIdx}-${endIdx} of ${result.total} · Page ${result.page}/${result.totalPages}` });

  const eid = encodeURIComponent(targetUserId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`col:prev:${result.page - 1}:${eid}${filterEncoded}`)
      .setEmoji("⬅")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(result.page <= 1),
    new ButtonBuilder()
      .setCustomId(`col:next:${result.page + 1}:${eid}${filterEncoded}`)
      .setEmoji("➡")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(result.page >= result.totalPages),
  );

  await interaction.update({ embeds: [embed], components: [row] });
}

// ─── Edition Labels ─────────────────────────────────────

function editionName(e: { editionNumber: number }) {
  return `Edition ${e.editionNumber}`;
}

// ─── Shared: build edition detail embed ─────────────────

async function buildEditionEmbed(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  charId: number,
  editionId?: number
) {
  // Get character info
  const [char] = await db
    .select({ id: characters.id, name: characters.name, series: characters.series, popularity: characters.popularity, imageUrl: characters.imageUrl })
    .from(characters)
    .where(eq(characters.id, charId))
    .limit(1);

  if (!char) { await interaction.deferUpdate(); return; }

  // Get all editions
  const editions = await db
    .select({ id: characterEditions.id, editionNumber: characterEditions.editionNumber, generationMethod: characterEditions.generationMethod, imagePath: characterEditions.imagePath, rarityWeight: characterEditions.rarityWeight })
    .from(characterEditions)
    .where(eq(characterEditions.characterId, charId))
    .orderBy(characterEditions.editionNumber);

  // Find selected edition (or first)
  const selectedEd = editionId
    ? editions.find((e) => e.id === editionId) ?? editions[0]
    : editions[0];

  if (!selectedEd) { await interaction.deferUpdate(); return; }

  // Stats for this character
  const [stats] = await db
    .select({
      totalSummoned: sql<number>`count(*)`,
      totalClaimed: sql<number>`count(${cards.ownerId})`,
    })
    .from(cards)
    .where(eq(cards.characterId, charId));

  const totalSummoned = stats?.totalSummoned ?? 0;
  const totalClaimed = stats?.totalClaimed ?? 0;
  const claimRate = totalSummoned > 0 ? Math.round((totalClaimed / totalSummoned) * 100) : 0;

  // Render the selected edition's card image
  const { loadCharacterImage, renderCard } = await import("../image/renderer.js");
  const { AttachmentBuilder: AB } = await import("discord.js");
  let files: any[] = [];
  let imageRef: string | undefined;

  try {
    const charImg = await loadCharacterImage(selectedEd.imagePath);
    const cardBuf = await renderCard({
      characterImage: charImg,
      name: char.name,
      series: char.series,
      quality: "good",
      printNumber: totalSummoned,
      editionNumber: selectedEd.editionNumber,
    });
    const fname = `edition-${charId}-${selectedEd.editionNumber}.png`;
    files.push(new AB(cardBuf, { name: fname }));
    imageRef = `attachment://${fname}`;
  } catch {}

  // Get real wishlist count
  const [wlResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(likeList)
    .where(eq(likeList.characterId, charId));
  const wishlistCount = wlResult?.count ?? 0;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${interaction.user.username}'s Lookup`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(
      `Character · **${char.name}**\n` +
      `Series · **${char.series}**\n` +
      `Edition · ◎${selectedEd.editionNumber} · ${editionName(selectedEd)}\n\n` +
      `Wishlist · ❤${wishlistCount}\n\n` +
      `Total summoned · **${totalSummoned}**\n` +
      `Summons claimed · **${totalClaimed}**\n` +
      `Summon claim rate · **${claimRate}%**`
    );

  if (imageRef) {
    embed.setImage(imageRef);
  } else if (char.imageUrl) {
    embed.setThumbnail(char.imageUrl);
  }

  // Rebuild components
  const components: any[] = [];

  // Only show editions with weight > 0 (hides disabled/admin/bad editions)
  const publicEditions = editions.filter((e) => (e.rarityWeight ?? 0) > 0);

  if (publicEditions.length > 1) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`lu_edition:${charId}`)
      .setPlaceholder(editionName(selectedEd))
      .addOptions(
        publicEditions.slice(0, 25).map((e) => ({
          label: editionName(e),
          value: `${e.id}`,
          default: e.id === selectedEd.id,
        }))
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ludet:first:${charId}`).setEmoji("⏮").setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`ludet:prev:${charId}`).setEmoji("⬅").setStyle(ButtonStyle.Primary).setDisabled(true),
    new ButtonBuilder().setCustomId(`ludet:next:${charId}`).setEmoji("➡").setStyle(ButtonStyle.Primary).setDisabled(editions.length <= 1),
    new ButtonBuilder().setCustomId(`ludet:last:${charId}`).setEmoji("⏭").setStyle(ButtonStyle.Primary).setDisabled(editions.length <= 1),
    new ButtonBuilder().setCustomId(`ludet:zoom:${selectedEd.id}`).setEmoji("🔍").setStyle(ButtonStyle.Secondary),
  );
  components.push(navRow);

  // interaction.update doesn't properly replace attachments, so we defer + editReply
  if (files.length > 0) {
    await interaction.deferUpdate();
    await interaction.message.edit({ embeds: [embed], components, files, attachments: [] });
  } else {
    await interaction.update({ embeds: [embed], components });
  }
}
