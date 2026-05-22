import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, userHexes, userAuras, userStickers, userFrames, cards } from "../../db/schema.js";
import { eq, sql, and, isNotNull } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("inventory")
  .setDescription("View your items and resources")
  .addUserOption((o) => o.setName("user").setDescription("User to check"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user") ?? interaction.user;

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, target.id),
    columns: {
      gold: true, opals: true, cinders: true, shards: true,
      privateFields: true,
    },
  });

  if (!user) {
    await interaction.reply({ content: "User hasn't started playing yet.", ephemeral: true });
    return;
  }

  if (target.id !== interaction.user.id && user.privateFields?.includes("inventory")) {
    await interaction.reply({ content: "This user's inventory is private.", ephemeral: true });
    return;
  }

  const [hexCount] = await db.select({ total: sql<number>`COALESCE(SUM(${userHexes.quantity}), 0)` }).from(userHexes).where(eq(userHexes.userId, sql`(SELECT id FROM users WHERE discord_id = ${target.id})`));
  const [auraCount] = await db.select({ total: sql<number>`COALESCE(SUM(${userAuras.quantity}), 0)` }).from(userAuras).where(eq(userAuras.userId, sql`(SELECT id FROM users WHERE discord_id = ${target.id})`));
  const [stickerCount] = await db.select({ total: sql<number>`COALESCE(SUM(${userStickers.quantity}), 0)` }).from(userStickers).where(eq(userStickers.userId, sql`(SELECT id FROM users WHERE discord_id = ${target.id})`));
  const [frameCount] = await db.select({ total: sql<number>`COALESCE(SUM(${userFrames.quantity}), 0)` }).from(userFrames).where(eq(userFrames.userId, sql`(SELECT id FROM users WHERE discord_id = ${target.id})`));
  const [cardCount] = await db.select({ total: sql<number>`count(*)` }).from(cards).where(and(eq(cards.ownerId, sql`(SELECT id FROM users WHERE discord_id = ${target.id})`), sql`${cards.inFusionPile} = false`));

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `${target.username}'s Inventory`, iconURL: target.displayAvatarURL() })
    .setDescription(
      `**Resources**\n` +
      `💰 Gold · **${user.gold.toLocaleString()}**\n` +
      `🌸 Petals · **${user.opals.toLocaleString()}**\n` +
      `🔥 Cinders · **${user.cinders.toLocaleString()}**\n` +
      `✨ Shards · **${user.shards.toLocaleString()}**\n\n` +
      `**Items**\n` +
      `🖼️ Frames · **${frameCount?.total ?? 0}**\n` +
      `🎨 Hexes · **${hexCount?.total ?? 0}**\n` +
      `✦ Auras · **${auraCount?.total ?? 0}**\n` +
      `🏷️ Stickers · **${stickerCount?.total ?? 0}**\n\n` +
      `**Cards**\n` +
      `🃏 Owned · **${cardCount?.total ?? 0}**`
    );

  await interaction.reply({ embeds: [embed] });
}
