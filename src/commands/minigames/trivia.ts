import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  type ChatInputCommandInteraction, ComponentType,
} from "discord.js";
import { db } from "../../db/index.js";
import { characters, users } from "../../db/schema.js";
import { sql, eq } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";
import { getCooldown, setCooldown } from "../../cache/cooldowns.js";

export const data = new SlashCommandBuilder()
  .setName("trivia")
  .setDescription("Anime character trivia — guess the character!");

export async function execute(interaction: ChatInputCommandInteraction) {
  const cdRemaining = await getCooldown(interaction.user.id, "minigame");
  if (cdRemaining > 0) {
    const readyAt = Math.floor(Date.now() / 1000) + cdRemaining;
    await interaction.reply({ content: `Minigame on cooldown! Ready <t:${readyAt}:R>`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  // Pick 4 random characters (1 correct + 3 wrong)
  const pool = await db
    .select({ id: characters.id, name: characters.name, series: characters.series, imageUrl: characters.imageUrl })
    .from(characters)
    .where(sql`${characters.imageUrl} IS NOT NULL`)
    .orderBy(sql`RANDOM()`)
    .limit(4);

  if (pool.length < 4) {
    await interaction.editReply("Not enough characters in the database for trivia.");
    return;
  }

  const correct = pool[0];
  // Shuffle options
  const options = [...pool].sort(() => Math.random() - 0.5);
  const correctIdx = options.findIndex((o) => o.id === correct.id);

  const labels = ["A", "B", "C", "D"];

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🧠 Anime Trivia!")
    .setDescription(
      `**Which character is from "${correct.series}"?**\n\n` +
      options.map((o, i) => `**${labels[i]}.** ${o.name}`).join("\n")
    )
    .setFooter({ text: "You have 15 seconds!" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...options.map((_, i) =>
      new ButtonBuilder()
        .setCustomId(`trivia:${i}`)
        .setLabel(labels[i])
        .setStyle(ButtonStyle.Primary)
    )
  );

  const msg = await interaction.editReply({ embeds: [embed], components: [row] });

  try {
    const response = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 15_000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    const picked = parseInt(response.customId.split(":")[1], 10);
    const won = picked === correctIdx;

    // Disable buttons
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...options.map((o, i) =>
        new ButtonBuilder()
          .setCustomId(`trivia_done:${i}`)
          .setLabel(`${labels[i]} ${o.name}`)
          .setStyle(i === correctIdx ? ButtonStyle.Success : (i === picked && !won ? ButtonStyle.Danger : ButtonStyle.Secondary))
          .setDisabled(true)
      )
    );

    if (won) {
      const reward = Math.floor(Math.random() * 20) + 5;
      const userId = await ensureUser(interaction.user.id, interaction.user.username);
      await db.update(users).set({ gold: sql`${users.gold} + ${reward}` }).where(eq(users.id, userId));

      await setCooldown(interaction.user.id, "minigame");

      await response.update({
        embeds: [embed.setColor(0x2ecc71).setTitle("🧠 Correct!")],
        components: [disabledRow],
        content: `✅ You earned **${reward} gold**!`,
      } as any);
    } else {
      await setCooldown(interaction.user.id, "minigame");

      await response.update({
        embeds: [embed.setColor(0xe74c3c).setTitle("🧠 Wrong!")],
        components: [disabledRow],
        content: `❌ The answer was **${labels[correctIdx]}. ${correct.name}**`,
      } as any);
    }
  } catch {
    // Timeout
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...options.map((o, i) =>
        new ButtonBuilder()
          .setCustomId(`trivia_timeout:${i}`)
          .setLabel(`${labels[i]} ${o.name}`)
          .setStyle(i === correctIdx ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );

    await interaction.editReply({
      embeds: [embed.setColor(0xe74c3c).setTitle("🧠 Time's up!")],
      components: [disabledRow],
      content: `⏰ The answer was **${labels[correctIdx]}. ${correct.name}**`,
    } as any);
  }
}
