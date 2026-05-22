import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from "discord.js";
import { db } from "../../db/index.js";
import { users, shopItems, frames } from "../../db/schema.js";
import { and, eq, gte, sql, ilike } from "drizzle-orm";
import { ensureUser } from "../../services/summon.service.js";
import { clearCooldown } from "../../cache/cooldowns.js";
import { openPack, grantCosmeticItem } from "../../services/cosmetics.service.js";

export const data = new SlashCommandBuilder()
  .setName("buy")
  .setDescription("Buy an item from the shop")
  .addStringOption((o) =>
    o.setName("item").setDescription("Item name or ID number").setRequired(true)
  )
  .addIntegerOption((o) =>
    o
      .setName("quantity")
      .setDescription("How many to buy")
      .setMinValue(1)
      .setMaxValue(10)
  );

type ShopRow = typeof shopItems.$inferSelect;

function sanitizeLikeFragment(raw: string): string {
  return raw.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "").trim();
}

async function findShopItem(raw: string): Promise<
  | { kind: "none" }
  | { kind: "ambiguous"; matches: ShopRow[] }
  | { kind: "ok"; item: ShopRow }
> {
  const trimmed = raw.trim();
  const asNum = Number(trimmed);
  if (Number.isInteger(asNum) && asNum > 0) {
    const row = await db.query.shopItems.findFirst({ where: eq(shopItems.id, asNum) });
    return row ? { kind: "ok", item: row } : { kind: "none" };
  }

  const frag = sanitizeLikeFragment(trimmed);
  if (!frag) return { kind: "none" };

  const matches = await db
    .select()
    .from(shopItems)
    .where(ilike(shopItems.name, `%${frag}%`))
    .limit(6);

  if (matches.length === 0) return { kind: "none" };
  if (matches.length > 1) return { kind: "ambiguous", matches };
  return { kind: "ok", item: matches[0] };
}

function balanceFor(user: { gold: number; opals: number; roses: number; cinders: number; shards: number }, costType: ShopRow["costType"]): number {
  switch (costType) {
    case "roses":
      return user.roses;
    case "gold":
      return user.gold;
    case "opals":
      return user.opals;
    case "cinders":
      return user.cinders;
    case "shards":
      return user.shards;
    case "free":
      return Number.POSITIVE_INFINITY;
    default:
      return 0;
  }
}

async function deductCurrency(
  userId: number,
  costType: ShopRow["costType"],
  amount: number
): Promise<boolean> {
  if (amount <= 0 || costType === "free") return true;
  if (costType === "gold") {
    const rows = await db.update(users)
      .set({ gold: sql`${users.gold} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.gold, amount)))
      .returning({ id: users.id });
    return rows.length > 0;
  } else if (costType === "opals") {
    const rows = await db.update(users)
      .set({ opals: sql`${users.opals} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.opals, amount)))
      .returning({ id: users.id });
    return rows.length > 0;
  } else if (costType === "roses") {
    const rows = await db.update(users)
      .set({ roses: sql`${users.roses} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.roses, amount)))
      .returning({ id: users.id });
    return rows.length > 0;
  } else if (costType === "cinders") {
    const rows = await db.update(users)
      .set({ cinders: sql`${users.cinders} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.cinders, amount)))
      .returning({ id: users.id });
    return rows.length > 0;
  } else if (costType === "shards") {
    const rows = await db.update(users)
      .set({ shards: sql`${users.shards} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.shards, amount)))
      .returning({ id: users.id });
    return rows.length > 0;
  }
  return false;
}

async function creditCurrency(
  userId: number,
  costType: ShopRow["costType"],
  amount: number
): Promise<void> {
  if (amount <= 0 || costType === "free") return;
  if (costType === "gold") {
    await db.update(users).set({ gold: sql`${users.gold} + ${amount}` }).where(eq(users.id, userId));
  } else if (costType === "opals") {
    await db.update(users).set({ opals: sql`${users.opals} + ${amount}` }).where(eq(users.id, userId));
  } else if (costType === "roses") {
    await db.update(users).set({ roses: sql`${users.roses} + ${amount}` }).where(eq(users.id, userId));
  } else if (costType === "cinders") {
    await db.update(users).set({ cinders: sql`${users.cinders} + ${amount}` }).where(eq(users.id, userId));
  } else if (costType === "shards") {
    await db.update(users).set({ shards: sql`${users.shards} + ${amount}` }).where(eq(users.id, userId));
  }
}

async function resolveFrameForShopItem(item: ShopRow) {
  const exact = await db.query.frames.findFirst({
    where: ilike(frames.name, item.name.trim()),
  });
  if (exact) return exact;
  const frag = sanitizeLikeFragment(item.name);
  if (!frag) return null;
  const [row] = await db
    .select()
    .from(frames)
    .where(ilike(frames.name, `%${frag}%`))
    .limit(1);
  return row ?? null;
}

async function rollMysteryBox(userId: number): Promise<string> {
  const grantGold = async (g: number, note?: string) => {
    await db.update(users).set({ gold: sql`${users.gold} + ${g}` }).where(eq(users.id, userId));
    return note ? `💰 **+${g} gold** ${note}` : `💰 **+${g} gold**`;
  };

  if (Math.random() < 0.5) {
    const g = 50 + Math.floor(Math.random() * 151);
    return grantGold(g);
  }

  const kinds = ["hex", "sticker", "aura", "frame"] as const;
  const kind = kinds[Math.floor(Math.random() * kinds.length)];

  if (kind === "hex") {
    const pool = await db.query.hexes.findMany();
    if (pool.length === 0) return grantGold(50 + Math.floor(Math.random() * 151), "(fallback — no hexes)");
    const pick = pool[Math.floor(Math.random() * pool.length)];
    await grantCosmeticItem(userId, "hex", pick.id);
    return `✨ Random **hex**: ${pick.name} (${pick.colorPrimary})`;
  }
  if (kind === "sticker") {
    const pool = await db.query.stickers.findMany();
    if (pool.length === 0) return grantGold(50 + Math.floor(Math.random() * 151), "(fallback — no stickers)");
    const pick = pool[Math.floor(Math.random() * pool.length)];
    await grantCosmeticItem(userId, "sticker", pick.id);
    return `✨ Random **sticker**: ${pick.name} (${pick.rarity})`;
  }
  if (kind === "aura") {
    const pool = await db.query.auras.findMany();
    if (pool.length === 0) return grantGold(50 + Math.floor(Math.random() * 151), "(fallback — no auras)");
    const pick = pool[Math.floor(Math.random() * pool.length)];
    await grantCosmeticItem(userId, "aura", pick.id);
    return `✨ Random **aura**: ${pick.name}`;
  }
  const pool = await db.query.frames.findMany();
  if (pool.length === 0) return grantGold(50 + Math.floor(Math.random() * 151), "(fallback — no frames)");
  const pick = pool[Math.floor(Math.random() * pool.length)];
  await grantCosmeticItem(userId, "frame", pick.id);
  return `✨ Random **frame**: ${pick.name}`;
}

async function deliverPurchases(
  interaction: ChatInputCommandInteraction,
  userId: number,
  item: ShopRow,
  quantity: number
): Promise<{ lines: string[]; error?: string }> {
  const lines: string[] = [];
  const guildId = interaction.guildId ?? "DM";
  const discordId = interaction.user.id;
  const username = interaction.user.username;

  for (let q = 0; q < quantity; q++) {
    switch (item.itemType) {
      case "extra_grab":
        await clearCooldown(discordId, "grab");
        lines.push("Grab cooldown cleared.");
        break;
      case "extra_summon":
        await clearCooldown(discordId, "summon");
        lines.push("Summon cooldown cleared.");
        break;
      case "sticker_pack": {
        const result = await openPack(discordId, username, "sticker", { skipPayment: true });
        if (!result.success) return { lines, error: result.reason };
        lines.push(`Sticker pack: ${result.items.join(", ")}`);
        break;
      }
      case "hex_pack": {
        const result = await openPack(discordId, username, "hex", { skipPayment: true });
        if (!result.success) return { lines, error: result.reason };
        lines.push(`Hex pack: ${result.items.join(", ")}`);
        break;
      }
      case "card_pack": {
        const result = await openPack(discordId, username, "card", { skipPayment: true, guildId });
        if (!result.success) return { lines, error: result.reason };
        lines.push(`Card pack:\n${result.items.map((i) => `• ${i}`).join("\n")}`);
        break;
      }
      case "frame": {
        const frame = await resolveFrameForShopItem(item);
        if (!frame) {
          return {
            lines,
            error: `No frame in the catalog matches this shop listing (**${item.name}**). Ask an admin to fix the shop item name.`,
          };
        }
        await grantCosmeticItem(userId, "frame", frame.id);
        lines.push(`Frame: **${frame.name}**`);
        break;
      }
      case "mystery_box": {
        lines.push(await rollMysteryBox(userId));
        break;
      }
      default:
        return { lines, error: "This item type cannot be purchased with /buy yet." };
    }
  }

  return { lines };
}

function costLabel(costType: ShopRow["costType"], amount: number): string {
  const displayType =
    costType === "opals" ? "petals" : costType;
  const emoji =
    costType === "gold"
      ? "💰"
      : costType === "opals"
        ? "🌸"
        : costType === "roses"
          ? "🌹"
        : costType === "cinders"
          ? "🔥"
          : costType === "shards"
            ? "✨"
            : "";
  if (costType === "free") return "free";
  return `${amount} ${displayType}${emoji ? ` ${emoji}` : ""}`;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const rawItem = interaction.options.getString("item", true);
  const quantity = interaction.options.getInteger("quantity") ?? 1;

  await interaction.deferReply();

  const found = await findShopItem(rawItem);
  if (found.kind === "none") {
    await interaction.editReply("No shop item matched that name or ID.");
    return;
  }
  if (found.kind === "ambiguous") {
    await interaction.editReply({
      content:
        `Multiple items match — pick an **ID** or a more specific name:\n${found.matches
          .map((i) => `• **${i.name}** (id \`${i.id}\`)`)
          .join("\n")}`,
    });
    return;
  }

  const item = found.item;
  if (!item.isAvailable) {
    await interaction.editReply("That item is not available.");
    return;
  }

  if (item.stockLimit != null && item.stockLimit < quantity) {
    await interaction.editReply(`Not enough stock (**${item.stockLimit}** left).`);
    return;
  }

  if (item.costType === "event") {
    await interaction.editReply("That item is tied to events and cannot be bought with `/buy`.");
    return;
  }

  const lineTotal = item.costType === "free" ? 0 : item.costAmount * quantity;
  const userId = await ensureUser(interaction.user.id, interaction.user.username);
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { gold: true, opals: true, roses: true, cinders: true, shards: true },
  });

  if (!user) {
    await interaction.editReply("Could not load your account.");
    return;
  }

  if (lineTotal > 0 && balanceFor(user, item.costType) < lineTotal) {
    const emoji =
      item.costType === "gold"
        ? "💰"
        : item.costType === "opals"
          ? "🌸"
          : item.costType === "roses"
            ? "🌹"
          : item.costType === "cinders"
            ? "🔥"
            : item.costType === "shards"
              ? "✨"
              : "";
    const displayCostType = item.costType === "opals" ? "petals" : item.costType;
    await interaction.editReply(
      `You need **${lineTotal} ${displayCostType}** ${emoji} but only have **${balanceFor(user, item.costType)}**.`
    );
    return;
  }

  if (item.itemType === "frame") {
    const frame = await resolveFrameForShopItem(item);
    if (!frame) {
      await interaction.editReply(
        `No frame in the catalog matches **${item.name}**. Ask an admin to align the shop name with a frame name.`
      );
      return;
    }
  }

  const prevStock = item.stockLimit;
  let stockUpdated = false;

  try {
    const deducted = await deductCurrency(userId, item.costType, lineTotal);
    if (!deducted) {
      await interaction.editReply("Your balance changed before purchase completed. Please try again.");
      return;
    }

    if (prevStock != null) {
      const next = prevStock - quantity;
      await db
        .update(shopItems)
        .set({
          stockLimit: next,
          isAvailable: next > 0,
        })
        .where(eq(shopItems.id, item.id));
      stockUpdated = true;
    }

    const delivery = await deliverPurchases(interaction, userId, item, quantity);
    if (delivery.error) {
      await creditCurrency(userId, item.costType, lineTotal);
      if (stockUpdated && prevStock != null) {
        await db
          .update(shopItems)
          .set({ stockLimit: prevStock, isAvailable: true })
          .where(eq(shopItems.id, item.id));
      }
      await interaction.editReply(delivery.error);
      return;
    }

    const fresh = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { gold: true, opals: true, roses: true, cinders: true, shards: true },
    });

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("🛒 Purchase complete")
      .setDescription(
        `**${item.name}** ×${quantity} — ${costLabel(item.costType, lineTotal)}\n\n` +
          delivery.lines.map((l) => `• ${l}`).join("\n")
      )
      .addFields({
        name: "Balances",
        value:
          `💰 ${fresh?.gold ?? 0}  🌸 ${fresh?.opals ?? 0}  🌹 ${fresh?.roses ?? 0}  🔥 ${fresh?.cinders ?? 0}  ✨ ${fresh?.shards ?? 0}`,
      });

    await interaction.editReply({ embeds: [embed] });
  } catch (e) {
    console.error("[buy]", e);
    try {
      await creditCurrency(userId, item.costType, lineTotal);
      if (stockUpdated && prevStock != null) {
        await db
          .update(shopItems)
          .set({ stockLimit: prevStock, isAvailable: true })
          .where(eq(shopItems.id, item.id));
      }
    } catch (revertErr) {
      console.error("[buy] revert failed", revertErr);
    }
    await interaction.editReply("Something went wrong processing your purchase. Your currency was refunded if possible.");
  }
}
