import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, likeList, cards, characters } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

export const data = new SlashCommandBuilder()
  .setName("likematch")
  .setDescription("See which of a user's liked characters you own")
  .addUserOption((o) => o.setName("user").setDescription("User whose like list to compare").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user", true);

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "Use this on another user to compare!", ephemeral: true });
    return;
  }

  const [targetUser] = await db
    .select({ id: users.id, privateFields: users.privateFields })
    .from(users)
    .where(eq(users.discordId, target.id))
    .limit(1);
  const [selfUser] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, interaction.user.id)).limit(1);

  if (!targetUser || !selfUser) {
    await interaction.reply({ content: "One of the users hasn't started playing yet.", ephemeral: true });
    return;
  }
  if (targetUser.privateFields?.includes("likes")) {
    await interaction.reply({ content: "This user's likes are private.", ephemeral: true });
    return;
  }

  const liked = await db
    .select({
      characterId: likeList.characterId,
      charName: characters.name,
      series: characters.series,
    })
    .from(likeList)
    .innerJoin(characters, eq(likeList.characterId, characters.id))
    .where(eq(likeList.userId, targetUser.id));

  if (liked.length === 0) {
    await interaction.reply({ content: `${target.username} hasn't liked any characters.`, ephemeral: true });
    return;
  }

  const likedCharIds = liked.map((l) => l.characterId);

  const owned = await db
    .select({ characterId: cards.characterId })
    .from(cards)
    .where(and(
      eq(cards.ownerId, selfUser.id),
      sql`${cards.characterId} = ANY(${likedCharIds})`,
      sql`${cards.inFusionPile} = false`,
    ))
    .groupBy(cards.characterId);

  const ownedSet = new Set(owned.map((o) => o.characterId));

  const lines = liked.map((l) => {
    const has = ownedSet.has(l.characterId);
    return `${has ? "✅" : "❌"} **${l.charName}** · ${l.series}`;
  });

  const matchCount = ownedSet.size;
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `Like Match with ${target.username}`, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(
      `You own **${matchCount}/${liked.length}** of ${target.username}'s liked characters.\n\n` +
      lines.join("\n")
    );

  await interaction.reply({ embeds: [embed] });
}
