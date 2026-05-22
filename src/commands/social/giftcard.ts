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
import { cards, characters, likeList, users, gifts } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("giftcard")
  .setDescription("Gift a card to someone who likes that character")
  .addStringOption((o) => o.setName("code").setDescription("Card code to gift").setRequired(true))
  .addBooleanOption((o) => o.setName("anonymous").setDescription("Send anonymously?"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("code", true).trim();
  const anonymous = interaction.options.getBoolean("anonymous") ?? false;
  const senderId = await ensureUser(interaction.user.id, interaction.user.username);

  const card = await db
    .select({
      id: cards.id,
      characterId: cards.characterId,
      charName: characters.name,
      series: characters.series,
      printNumber: cards.printNumber,
      inFusionPile: cards.inFusionPile,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .where(and(eq(cards.code, code), eq(cards.ownerId, senderId)))
    .limit(1);

  if (card.length === 0) {
    await interaction.reply({ content: `You don't own card \`${code}\`.`, ephemeral: true });
    return;
  }

  const c = card[0];
  if (c.inFusionPile) {
    await interaction.reply({ content: "That card is in the fusion pile.", ephemeral: true });
    return;
  }

  const likers = await db
    .select({ userId: likeList.userId })
    .from(likeList)
    .where(eq(likeList.characterId, c.characterId));

  const eligibleLikers = likers.filter((l) => l.userId !== senderId);

  if (eligibleLikers.length === 0) {
    await interaction.reply({ content: "No one else has liked this character.", ephemeral: true });
    return;
  }

  const recipient = eligibleLikers[Math.floor(Math.random() * eligibleLikers.length)];
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const confirm = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("gift:yes").setLabel("Send Gift").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("gift:no").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe91e63)
    .setTitle("🎁 Gift Card")
    .setDescription(
      `Gift **${c.charName}** #${c.printNumber} to a random liker?\n` +
      `${anonymous ? "(anonymously)" : ""}\n\n` +
      `${eligibleLikers.length} player(s) have liked this character.`
    );

  const msg = await interaction.reply({ embeds: [embed], components: [confirm], fetchReply: true });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 30_000,
    max: 1,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "gift:yes") {
      try {
        await db.transaction(async (tx) => {
          const [moved] = await tx
            .update(cards)
            .set({ ownerId: null, updatedAt: new Date() })
            .where(and(
              eq(cards.id, c.id),
              eq(cards.ownerId, senderId),
              eq(cards.inFusionPile, false)
            ))
            .returning({ id: cards.id });

          if (!moved) {
            throw new Error("Card is no longer available to gift.");
          }

          await tx.insert(gifts).values({
            senderId,
            recipientId: recipient.userId,
            cardId: c.id,
            anonymous,
            expiresAt,
          });

          await tx
            .update(users)
            .set({ totalGifts: sql`${users.totalGifts} + 1` })
            .where(eq(users.id, senderId));
        });
      } catch (err) {
        await i.update({
          content: err instanceof Error ? err.message : "Failed to send gift. Try again.",
          embeds: [],
          components: [],
        });
        return;
      }

      await i.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setDescription(`🎁 **${c.charName}** has been gifted! The recipient will find it in \`/gifts\`.`)
        ],
        components: [],
      });
    } else {
      await i.update({ content: "Gift cancelled.", embeds: [], components: [] });
    }
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) {
      await msg.edit({ content: "Gift timed out.", embeds: [], components: [] }).catch(() => {});
    }
  });
}
