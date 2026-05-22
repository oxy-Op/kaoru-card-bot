import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { users, characters, likeList, summonList } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser, WISH_SUMMON_WINDOW } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("wish")
  .setDescription("Manage your wishlist and summon list")
  .addSubcommand((sub) =>
    sub.setName("add").setDescription("Add a character to your wishlist (♥)")
      .addStringOption((o) => o.setName("name").setDescription("Character name to search").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("remove").setDescription("Remove a character from your wishlist")
      .addStringOption((o) => o.setName("name").setDescription("Character name").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("View your wishlist")
  )
  .addSubcommand((sub) =>
    sub.setName("summonlist").setDescription("View your summon list (boosts odds)")
  )
  .addSubcommand((sub) =>
    sub.setName("summonadd").setDescription("Add a character to your summon list (limited slots)")
      .addStringOption((o) => o.setName("name").setDescription("Character name").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("summonremove").setDescription("Remove from your summon list")
      .addStringOption((o) => o.setName("name").setDescription("Character name").setRequired(true))
  );

async function findCharacter(name: string) {
  return db.query.characters.findFirst({
    where: sql`LOWER(${characters.name}) LIKE LOWER(${'%' + name + '%'})`,
    columns: { id: true, name: true, series: true, popularity: true },
  });
}

/** Gold sink: popular characters cost more to wishlist. */
export function wishAddCost(popularity: number | null | undefined): number {
  const pop = popularity ?? 0;
  if (pop >= 10000) return 5000;
  if (pop >= 3000) return 2500;
  if (pop >= 500) return 1000;
  if (pop >= 50) return 400;
  return 150;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const userId = await ensureUser(interaction.user.id, interaction.user.username);

  if (sub === "add") {
    const name = interaction.options.getString("name", true);
    const char = await findCharacter(name);
    if (!char) {
      await interaction.reply({ content: `No character found matching "${name}".`, ephemeral: true });
      return;
    }

    const cost = wishAddCost(char.popularity);
    const addedOrRefreshed = await db.transaction(async (tx) => {
      const [deducted] = await tx
        .update(users)
        .set({ gold: sql`${users.gold} - ${cost}` })
        .where(and(eq(users.id, userId), sql`${users.gold} >= ${cost}`))
        .returning({ id: users.id });
      if (!deducted) return null;

      const existing = await tx.query.likeList.findFirst({
        where: and(eq(likeList.userId, userId), eq(likeList.characterId, char.id)),
      });

      if (!existing) {
        await tx.insert(likeList).values({ userId, characterId: char.id });
      }

      await tx
        .update(users)
        .set({
          wishCharacterId: char.id,
          wishSummonsRemaining: WISH_SUMMON_WINDOW,
        })
        .where(eq(users.id, userId));

      return existing ? "refreshed" as const : "added" as const;
    });

    if (!addedOrRefreshed) {
      await interaction.reply({
        content: `Not enough gold. Adding **${char.name}** costs **${cost.toLocaleString()} gold**.`,
        ephemeral: true,
      });
      return;
    }
    await interaction.reply(
      `♥ ${addedOrRefreshed === "refreshed" ? "Refreshed" : "Added"} **${char.name}** (${char.series}) on your wishlist.\n` +
      `🎯 Wish boost active for next **${WISH_SUMMON_WINDOW} summons** (guaranteed appearance within the window).\n` +
      `💰 Cost: **${cost.toLocaleString()} gold** (popularity-scaled).`
    );
  }

  else if (sub === "remove") {
    const name = interaction.options.getString("name", true);
    const char = await findCharacter(name);
    if (!char) {
      await interaction.reply({ content: `No character found matching "${name}".`, ephemeral: true });
      return;
    }

    const deleted = await db.delete(likeList)
      .where(and(eq(likeList.userId, userId), eq(likeList.characterId, char.id)));

    await interaction.reply(`Removed **${char.name}** from your wishlist.`);
  }

  else if (sub === "list") {
    const wishes = await db
      .select({ charName: characters.name, series: characters.series })
      .from(likeList)
      .innerJoin(characters, eq(likeList.characterId, characters.id))
      .where(eq(likeList.userId, userId))
      .limit(25);

    if (wishes.length === 0) {
      await interaction.reply({ content: "Your wishlist is empty! Use `/wish add` to add characters.", ephemeral: true });
      return;
    }

    const list = wishes.map((w, i) => `${i + 1}. **${w.charName}** — ${w.series}`).join("\n");
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`♥ ${interaction.user.username}'s Wishlist`)
      .setDescription(list)
      .setFooter({ text: `${wishes.length} characters` });

    await interaction.reply({ embeds: [embed] });
  }

  else if (sub === "summonlist") {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { summonListSlots: true } });
    const entries = await db
      .select({ charName: characters.name, series: characters.series, slot: summonList.slotNumber })
      .from(summonList)
      .innerJoin(characters, eq(summonList.characterId, characters.id))
      .where(eq(summonList.userId, userId))
      .orderBy(summonList.slotNumber);

    const slots = user?.summonListSlots ?? 5;
    const list = entries.length > 0
      ? entries.map((e) => `Slot ${e.slot}: **${e.charName}** — ${e.series}`).join("\n")
      : "*Empty — add characters to boost their summon odds!*";

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`✨ ${interaction.user.username}'s Summon List`)
      .setDescription(list)
      .setFooter({ text: `${entries.length}/${slots} slots used | Characters on your summon list get 2x odds` });

    await interaction.reply({ embeds: [embed] });
  }

  else if (sub === "summonadd") {
    const name = interaction.options.getString("name", true);
    const char = await findCharacter(name);
    if (!char) {
      await interaction.reply({ content: `No character found matching "${name}".`, ephemeral: true });
      return;
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { summonListSlots: true } });
    const slots = user?.summonListSlots ?? 5;

    const current = await db.select({ id: summonList.characterId })
      .from(summonList).where(eq(summonList.userId, userId));

    if (current.length >= slots) {
      await interaction.reply({ content: `Summon list full (${slots}/${slots} slots). Remove one first.`, ephemeral: true });
      return;
    }

    if (current.some((c) => c.id === char.id)) {
      await interaction.reply({ content: `**${char.name}** is already on your summon list!`, ephemeral: true });
      return;
    }

    const nextSlot = current.length + 1;
    await db.insert(summonList).values({ userId, characterId: char.id, slotNumber: nextSlot });
    await interaction.reply(`✨ Added **${char.name}** to summon list (slot ${nextSlot}/${slots}). Their summon odds are now **2x**!`);
  }

  else if (sub === "summonremove") {
    const name = interaction.options.getString("name", true);
    const char = await findCharacter(name);
    if (!char) {
      await interaction.reply({ content: `No character found matching "${name}".`, ephemeral: true });
      return;
    }

    await db.delete(summonList)
      .where(and(eq(summonList.userId, userId), eq(summonList.characterId, char.id)));

    await interaction.reply(`Removed **${char.name}** from your summon list.`);
  }
}
