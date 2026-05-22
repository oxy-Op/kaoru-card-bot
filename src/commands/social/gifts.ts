import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { gifts, cards, characters, users } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("gifts")
  .setDescription("View and claim your pending gifts");

export async function execute(interaction: ChatInputCommandInteraction) {
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  await expirePendingGifts(userId);

  const pending = await db
    .select({
      giftId: gifts.id,
      senderId: gifts.senderId,
      senderDiscordId: users.discordId,
      senderName: users.username,
      anonymous: gifts.anonymous,
      cardId: gifts.cardId,
      expiresAt: gifts.expiresAt,
      charName: characters.name,
      series: characters.series,
      printNumber: cards.printNumber,
      code: cards.code,
    })
    .from(gifts)
    .innerJoin(cards, eq(gifts.cardId, cards.id))
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(users, eq(users.id, gifts.senderId))
    .where(and(eq(gifts.recipientId, userId), eq(gifts.status, "pending")));

  if (pending.length === 0) {
    await interaction.reply({ content: "You have no pending gifts.", ephemeral: true });
    return;
  }

  let page = 0;
  const gift = pending[page];

  const buildEmbed = (idx: number) => {
    const g = pending[idx];
    const fromText = g.anonymous ? "Anonymous" : `@${g.senderName}`;
    return new EmbedBuilder()
      .setColor(0xe91e63)
      .setTitle(`🎁 Gift ${idx + 1}/${pending.length}`)
      .setDescription(
        `From: ${fromText}\n\n` +
        `**${g.charName}** · ${g.series}\n` +
        `#${g.printNumber} · \`${g.code}\`\n\n` +
        `Expires <t:${Math.floor(g.expiresAt.getTime() / 1000)}:R>`
      );
  };

  const buildRow = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("gifts:accept").setLabel("Accept").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("gifts:decline").setLabel("Decline").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("gifts:next").setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(pending.length <= 1),
    );

  const msg = await interaction.reply({ embeds: [buildEmbed(0)], components: [buildRow()], fetchReply: true });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 120_000,
  });

  collector.on("collect", async (i) => {
    const g = pending[page];
    const expired = g.expiresAt.getTime() <= Date.now();
    if (expired) {
      await expireSpecificGift(g.giftId, g.senderId, g.cardId);
      pending.splice(page, 1);
      if (pending.length === 0) {
        await i.update({
          content: "This gift expired.",
          embeds: [],
          components: [],
        });
        collector.stop();
        return;
      }
      if (page >= pending.length) page = pending.length - 1;
      await i.update({ content: "That gift expired.", embeds: [buildEmbed(page)], components: [buildRow()] });
      return;
    }

    if (i.customId === "gifts:accept") {
      const accepted = await db.transaction(async (tx) => {
        const [giftRow] = await tx
          .update(gifts)
          .set({ status: "accepted" })
          .where(and(
            eq(gifts.id, g.giftId),
            eq(gifts.recipientId, userId),
            eq(gifts.status, "pending"),
            sql`${gifts.expiresAt} > NOW()`
          ))
          .returning({ id: gifts.id });
        if (!giftRow) return false;

        const [moved] = await tx
          .update(cards)
          .set({ ownerId: userId, updatedAt: new Date() })
          .where(and(
            eq(cards.id, g.cardId),
            sql`${cards.ownerId} IS NULL`
          ))
          .returning({ id: cards.id });
        return !!moved;
      });

      if (!accepted) {
        await i.reply({ content: "This gift is no longer claimable.", ephemeral: true });
        return;
      }
      pending.splice(page, 1);
      if (page >= pending.length) page = Math.max(0, pending.length - 1);

      if (pending.length === 0) {
        await i.update({
          embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(`✅ Accepted **${g.charName}**! No more gifts.`)],
          components: [],
        });
        collector.stop();
        return;
      }
      await i.update({ content: `✅ Accepted **${g.charName}**!`, embeds: [buildEmbed(page)], components: [buildRow()] });
    } else if (i.customId === "gifts:decline") {
      const declined = await db.transaction(async (tx) => {
        const [giftRow] = await tx
          .update(gifts)
          .set({ status: "declined" })
          .where(and(
            eq(gifts.id, g.giftId),
            eq(gifts.recipientId, userId),
            eq(gifts.status, "pending")
          ))
          .returning({ id: gifts.id });
        if (!giftRow) return false;

        const [returned] = await tx
          .update(cards)
          .set({ ownerId: g.senderId, updatedAt: new Date() })
          .where(and(
            eq(cards.id, g.cardId),
            sql`${cards.ownerId} IS NULL`
          ))
          .returning({ id: cards.id });
        return !!returned;
      });

      if (!declined) {
        await i.reply({ content: "This gift is no longer claimable.", ephemeral: true });
        return;
      }
      pending.splice(page, 1);
      if (page >= pending.length) page = Math.max(0, pending.length - 1);

      if (pending.length === 0) {
        await i.update({
          embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`Declined **${g.charName}**. No more gifts.`)],
          components: [],
        });
        collector.stop();
        return;
      }
      await i.update({ content: `Declined **${g.charName}**.`, embeds: [buildEmbed(page)], components: [buildRow()] });
    } else if (i.customId === "gifts:next") {
      page = (page + 1) % pending.length;
      await i.update({ embeds: [buildEmbed(page)], components: [buildRow()] });
    }
  });

  collector.on("end", async () => {
    await msg.edit({ components: [] }).catch(() => {});
  });
}

async function expirePendingGifts(recipientId: number): Promise<void> {
  const expired = await db
    .select({
      giftId: gifts.id,
      senderId: gifts.senderId,
      cardId: gifts.cardId,
    })
    .from(gifts)
    .where(and(
      eq(gifts.recipientId, recipientId),
      eq(gifts.status, "pending"),
      sql`${gifts.expiresAt} <= NOW()`
    ));

  for (const row of expired) {
    await expireSpecificGift(row.giftId, row.senderId, row.cardId);
  }
}

async function expireSpecificGift(giftId: number, senderId: number, cardId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [expiredGift] = await tx
      .update(gifts)
      .set({ status: "expired" })
      .where(and(eq(gifts.id, giftId), eq(gifts.status, "pending")))
      .returning({ id: gifts.id });
    if (!expiredGift) return;

    await tx
      .update(cards)
      .set({ ownerId: senderId, updatedAt: new Date() })
      .where(and(eq(cards.id, cardId), sql`${cards.ownerId} IS NULL`));
  });
}
