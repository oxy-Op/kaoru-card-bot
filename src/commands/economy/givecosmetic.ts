import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db } from "../../db/index.js";
import { users, userFrames, userHexes, userAuras, userStickers } from "../../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";

export const data = new SlashCommandBuilder()
  .setName("givecosmetic")
  .setDescription("Gift a cosmetic item to another user")
  .addUserOption((o) => o.setName("user").setDescription("Recipient").setRequired(true))
  .addStringOption((o) =>
    o.setName("type").setDescription("Cosmetic type").setRequired(true)
      .addChoices(
        { name: "Frame", value: "frame" },
        { name: "Hex", value: "hex" },
        { name: "Aura", value: "aura" },
        { name: "Sticker", value: "sticker" },
      )
  )
  .addIntegerOption((o) => o.setName("id").setDescription("Item ID").setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser("user", true);
  const type = interaction.options.getString("type", true) as "frame" | "hex" | "aura" | "sticker";
  const itemId = interaction.options.getInteger("id", true);

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "Can't gift to yourself.", ephemeral: true });
    return;
  }

  const fromId = await ensureUser(interaction.user.id, interaction.user.username);
  const toId = await ensureUser(target.id, target.username);

  const tables = {
    frame: { table: userFrames, userCol: userFrames.userId, itemCol: userFrames.frameId, qtyCol: userFrames.quantity },
    hex: { table: userHexes, userCol: userHexes.userId, itemCol: userHexes.hexId, qtyCol: userHexes.quantity },
    aura: { table: userAuras, userCol: userAuras.userId, itemCol: userAuras.auraId, qtyCol: userAuras.quantity },
    sticker: { table: userStickers, userCol: userStickers.userId, itemCol: userStickers.stickerId, qtyCol: userStickers.quantity },
  };

  const t = tables[type];

  // Check sender has the item
  const senderInv = await db.select({ quantity: t.qtyCol })
    .from(t.table)
    .where(and(eq(t.userCol, fromId), eq(t.itemCol, itemId)))
    .limit(1);

  if (senderInv.length === 0 || senderInv[0].quantity <= 0) {
    await interaction.reply({ content: `You don't have that ${type}.`, ephemeral: true });
    return;
  }

  // Deduct from sender
  await db.update(t.table)
    .set({ quantity: sql`${t.qtyCol} - 1` })
    .where(and(eq(t.userCol, fromId), eq(t.itemCol, itemId)));

  // Add to receiver
  const receiverInv = await db.select()
    .from(t.table)
    .where(and(eq(t.userCol, toId), eq(t.itemCol, itemId)))
    .limit(1);

  if (receiverInv.length > 0) {
    await db.update(t.table)
      .set({ quantity: sql`${t.qtyCol} + 1` })
      .where(and(eq(t.userCol, toId), eq(t.itemCol, itemId)));
  } else {
    await db.insert(t.table).values({ userId: toId, [t.itemCol.name]: itemId, quantity: 1 } as any);
  }

  await interaction.reply(`🎁 Gifted a **${type}** to **${target.username}**!`);
}
