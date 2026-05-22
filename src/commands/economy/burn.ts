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
import { cards, characters, users } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

const QUALITY_REWARDS: Record<string, { gold: number; cinders: number }> = {
  damaged: { gold: 5, cinders: 1 },
  poor: { gold: 10, cinders: 2 },
  good: { gold: 20, cinders: 5 },
  excellent: { gold: 50, cinders: 10 },
  pristine: { gold: 100, cinders: 25 },
};

export const data = new SlashCommandBuilder()
  .setName("burn")
  .setDescription("Destroy a card for gold and cinders")
  .addStringOption((o) => o.setName("code").setDescription("Card code to burn").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const code = interaction.options.getString("code", true).trim();
  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  const card = await db
    .select({
      id: cards.id,
      quality: cards.quality,
      charName: characters.name,
      series: characters.series,
      printNumber: cards.printNumber,
      inFusionPile: cards.inFusionPile,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .where(and(eq(cards.code, code), eq(cards.ownerId, userId)))
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

  const reward = QUALITY_REWARDS[c.quality] ?? QUALITY_REWARDS.good;

  const confirm = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("burn:yes").setLabel("Burn").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("burn:no").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("🔥 Burn Card")
    .setDescription(
      `Are you sure you want to burn this card?\n\n` +
      `**${c.charName}** · ${c.series}\n` +
      `#${c.printNumber} · ${c.quality}\n\n` +
      `Rewards: 💰 **${reward.gold}** Gold + 🔥 **${reward.cinders}** Cinders`
    );

  const msg = await interaction.reply({ embeds: [embed], components: [confirm], fetchReply: true });

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 30_000,
    max: 1,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "burn:yes") {
      await db.delete(cards).where(eq(cards.id, c.id));
      await db.update(users).set({
        gold: sql`${users.gold} + ${reward.gold}`,
        cinders: sql`${users.cinders} + ${reward.cinders}`,
        totalFusions: sql`${users.totalFusions} + 1`,
      }).where(eq(users.id, userId));

      await i.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setDescription(`🔥 Burned **${c.charName}** #${c.printNumber}\n+💰 ${reward.gold} Gold · +🔥 ${reward.cinders} Cinders`)
        ],
        components: [],
      });
    } else {
      await i.update({ content: "Burn cancelled.", embeds: [], components: [] });
    }
  });

  collector.on("end", async (collected) => {
    if (collected.size === 0) {
      await msg.edit({ content: "Burn timed out.", embeds: [], components: [] }).catch(() => {});
    }
  });
}
