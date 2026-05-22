import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { cards, users } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

const SPELL_COSTS: Record<string, number> = {
  glow: 50,
  shadow: 50,
  rainbow: 150,
  gold_text: 100,
  crimson: 75,
  ice: 75,
  sakura: 100,
  void: 200,
};

const SPELL_DESCRIPTIONS: Record<string, string> = {
  glow: "White glow effect on card name",
  shadow: "Dark shadow behind card text",
  rainbow: "Rainbow gradient on card name",
  gold_text: "Golden text on card name",
  crimson: "Red glow on card text",
  ice: "Cool blue frost effect",
  sakura: "Pink petal overlay on text",
  void: "Dark purple void effect",
};

export const data = new SlashCommandBuilder()
  .setName("spell")
  .setDescription("Apply text effects to your cards")
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("View available spells and costs")
  )
  .addSubcommand((sub) =>
    sub.setName("apply").setDescription("Apply a spell to a card")
      .addStringOption((o) => o.setName("code").setDescription("Card code").setRequired(true))
      .addStringOption((o) =>
        o.setName("spell").setDescription("Spell name").setRequired(true)
          .addChoices(
            ...Object.keys(SPELL_COSTS).map((s) => ({ name: s, value: s }))
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("remove").setDescription("Remove a spell from a card")
      .addStringOption((o) => o.setName("code").setDescription("Card code").setRequired(true))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "list") {
    const list = Object.entries(SPELL_COSTS)
      .map(([name, cost]) => `**${name}** — ${cost} shards — ${SPELL_DESCRIPTIONS[name]}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("✨ Spells")
      .setDescription(list)
      .setFooter({ text: "Use /spell apply <code> <spell> to apply" });

    await interaction.reply({ embeds: [embed] });
  }

  else if (sub === "apply") {
    const cardCode = interaction.options.getString("code", true);
    const spellName = interaction.options.getString("spell", true);
    const cost = SPELL_COSTS[spellName];

    if (!cost) {
      await interaction.reply({ content: "Unknown spell.", ephemeral: true });
      return;
    }

    const userId = await ensureUser(interaction.user.id, interaction.user.username);

    let applied = false;
    try {
      applied = await db.transaction(async (tx) => {
        const [deducted] = await tx
          .update(users)
          .set({ shards: sql`${users.shards} - ${cost}` })
          .where(and(eq(users.id, userId), sql`${users.shards} >= ${cost}`))
          .returning({ id: users.id });
        if (!deducted) return false;

        const [updatedCard] = await tx
          .update(cards)
          .set({ spell: spellName, updatedAt: new Date() })
          .where(and(eq(cards.code, cardCode), eq(cards.ownerId, userId)))
          .returning({ id: cards.id });
        if (!updatedCard) throw new Error("Card no longer eligible");

        return true;
      });
    } catch {
      applied = false;
    }

    if (!applied) {
      await interaction.reply({
        content: `Could not apply spell. You either lack shards or no longer own \`${cardCode}\`.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply(`✨ Applied **${spellName}** spell to \`${cardCode}\`!`);
  }

  else if (sub === "remove") {
    const cardCode = interaction.options.getString("code", true);
    const userId = await ensureUser(interaction.user.id, interaction.user.username);

    const card = await db.query.cards.findFirst({
      where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
      columns: { id: true, spell: true },
    });

    if (!card) {
      await interaction.reply({ content: `You don't own card \`${cardCode}\`.`, ephemeral: true });
      return;
    }

    if (!card.spell) {
      await interaction.reply({ content: "That card has no spell.", ephemeral: true });
      return;
    }

    await db.update(cards).set({ spell: null, updatedAt: new Date() }).where(eq(cards.id, card.id));
    await interaction.reply(`Removed spell from \`${cardCode}\`.`);
  }
}
