import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { getCooldown, setCooldown } from "../../cache/cooldowns.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

const VOTE_REWARD_GOLD = 50;
const VOTE_REWARD_SHARDS = 5;
const ENABLE_UNVERIFIED_VOTE_REWARDS =
  process.env.ENABLE_UNVERIFIED_VOTE_REWARDS === "1";
const VOTE_URL = process.env.VOTE_URL ?? "";

export const data = new SlashCommandBuilder()
  .setName("vote")
  .setDescription("Claim your vote reward or get the vote link");

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!ENABLE_UNVERIFIED_VOTE_REWARDS) {
    await interaction.reply({
      ephemeral: true,
      content:
        `Vote rewards are disabled in this deployment until vote verification is configured.` +
        (VOTE_URL ? `\nVote link: ${VOTE_URL}` : ""),
    });
    return;
  }

  const remaining = await getCooldown(interaction.user.id, "vote");

  if (remaining > 0) {
    await interaction.reply({
      content: `Already claimed! Vote again <t:${Math.floor(Date.now() / 1000) + remaining}:R>.`,
      ephemeral: true,
    });
    return;
  }

  // In production, this would verify with top.gg webhook
  // For now, direct claim with cooldown
  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  await db.update(users).set({
    gold: sql`${users.gold} + ${VOTE_REWARD_GOLD}`,
    shards: sql`${users.shards} + ${VOTE_REWARD_SHARDS}`,
  }).where(eq(users.id, userId));

  await setCooldown(interaction.user.id, "vote");

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🗳️ Vote Reward Claimed!")
    .setDescription(
      `Thanks for voting!\n\n` +
      `+**${VOTE_REWARD_GOLD}** gold\n` +
      `+**${VOTE_REWARD_SHARDS}** shards\n\n` +
      `Vote again in 12 hours for more rewards!`
    );

  await interaction.reply({ embeds: [embed] });
}
