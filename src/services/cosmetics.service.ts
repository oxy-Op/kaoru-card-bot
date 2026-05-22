import { db } from "../db/index.js";
import {
  users, cards, frames, hexes, auras, stickers, characters, characterEditions,
  userFrames, userHexes, userAuras, userStickers, cardStickers,
} from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";
import { newCardCode, rollQuality } from "../utils/codes.js";

export type OpenPackOptions = {
  /** When true, skip the built-in gold cost (shop / external payment already handled). */
  skipPayment?: boolean;
  guildId?: string | null;
};

// ─── Inventory Queries ─────────────────────────────────

export async function getUserFrames(discordId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.discordId, discordId), columns: { id: true } });
  if (!user) return [];
  const rows = await db.select({ frameId: userFrames.frameId, quantity: userFrames.quantity, name: frames.name, costType: frames.costType })
    .from(userFrames).innerJoin(frames, eq(userFrames.frameId, frames.id)).where(eq(userFrames.userId, user.id));
  return rows;
}

export async function getUserHexes(discordId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.discordId, discordId), columns: { id: true } });
  if (!user) return [];
  return db.select({ hexId: userHexes.hexId, quantity: userHexes.quantity, name: hexes.name, colorPrimary: hexes.colorPrimary, colorSecondary: hexes.colorSecondary })
    .from(userHexes).innerJoin(hexes, eq(userHexes.hexId, hexes.id)).where(eq(userHexes.userId, user.id));
}

export async function getUserAuras(discordId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.discordId, discordId), columns: { id: true } });
  if (!user) return [];
  return db.select({ auraId: userAuras.auraId, quantity: userAuras.quantity, name: auras.name, glowColor: auras.glowColor, intensity: auras.intensity })
    .from(userAuras).innerJoin(auras, eq(userAuras.auraId, auras.id)).where(eq(userAuras.userId, user.id));
}

export async function getUserStickers(discordId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.discordId, discordId), columns: { id: true } });
  if (!user) return [];
  return db.select({ stickerId: userStickers.stickerId, quantity: userStickers.quantity, name: stickers.name, rarity: stickers.rarity })
    .from(userStickers).innerJoin(stickers, eq(userStickers.stickerId, stickers.id)).where(eq(userStickers.userId, user.id));
}

// ─── Apply Cosmetics ───────────────────────────────────

export async function applyFrame(
  discordId: string, username: string, cardCode: string, frameId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);

  // Check ownership of card
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  // Check user has the frame
  const uf = await db.query.userFrames.findFirst({
    where: and(eq(userFrames.userId, userId), eq(userFrames.frameId, frameId)),
    columns: { quantity: true },
  });
  if (!uf || uf.quantity <= 0) return { success: false, reason: "You don't have that frame." };

  await db.update(cards).set({ frameId, updatedAt: new Date() }).where(eq(cards.id, card.id));
  return { success: true };
}

export async function applyHex(
  discordId: string, username: string, cardCode: string, hexId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const uh = await db.query.userHexes.findFirst({
    where: and(eq(userHexes.userId, userId), eq(userHexes.hexId, hexId)),
    columns: { quantity: true },
  });
  if (!uh || uh.quantity <= 0) return { success: false, reason: "You don't have that hex." };

  await db.update(cards).set({ hexId, updatedAt: new Date() }).where(eq(cards.id, card.id));
  return { success: true };
}

export async function applyAura(
  discordId: string, username: string, cardCode: string, auraId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const ua = await db.query.userAuras.findFirst({
    where: and(eq(userAuras.userId, userId), eq(userAuras.auraId, auraId)),
    columns: { quantity: true },
  });
  if (!ua || ua.quantity <= 0) return { success: false, reason: "You don't have that aura." };

  await db.update(cards).set({ auraId, updatedAt: new Date() }).where(eq(cards.id, card.id));
  return { success: true };
}

export async function removeHex(
  discordId: string,
  username: string,
  cardCode: string
): Promise<{ success: true; hexName: string } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true, hexId: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  if (!card.hexId) return { success: false, reason: "That card doesn't have a hex applied." };

  const hexId = card.hexId;
  const hex = await db.query.hexes.findFirst({
    where: eq(hexes.id, hexId),
    columns: { name: true },
  });

  await db.update(cards).set({ hexId: null, updatedAt: new Date() }).where(eq(cards.id, card.id));

  const existing = await db.query.userHexes.findFirst({
    where: and(eq(userHexes.userId, userId), eq(userHexes.hexId, hexId)),
  });
  if (existing) {
    await db
      .update(userHexes)
      .set({ quantity: sql`${userHexes.quantity} + 1` })
      .where(and(eq(userHexes.userId, userId), eq(userHexes.hexId, hexId)));
  } else {
    await db.insert(userHexes).values({ userId, hexId, quantity: 1 });
  }

  return { success: true, hexName: hex?.name ?? "Unknown" };
}

export async function removeAura(
  discordId: string,
  username: string,
  cardCode: string
): Promise<{ success: true; auraName: string } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true, auraId: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  if (!card.auraId) return { success: false, reason: "That card doesn't have an aura applied." };

  const auraId = card.auraId;
  const aura = await db.query.auras.findFirst({
    where: eq(auras.id, auraId),
    columns: { name: true },
  });

  await db.update(cards).set({ auraId: null, updatedAt: new Date() }).where(eq(cards.id, card.id));

  const existing = await db.query.userAuras.findFirst({
    where: and(eq(userAuras.userId, userId), eq(userAuras.auraId, auraId)),
  });
  if (existing) {
    await db
      .update(userAuras)
      .set({ quantity: sql`${userAuras.quantity} + 1` })
      .where(and(eq(userAuras.userId, userId), eq(userAuras.auraId, auraId)));
  } else {
    await db.insert(userAuras).values({ userId, auraId, quantity: 1 });
  }

  return { success: true, auraName: aura?.name ?? "Unknown" };
}

export async function removeFrame(
  discordId: string,
  username: string,
  cardCode: string
): Promise<{ success: true; frameName: string } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true, frameId: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  if (!card.frameId) return { success: false, reason: "That card doesn't have a frame applied." };

  const frameId = card.frameId;
  const frame = await db.query.frames.findFirst({
    where: eq(frames.id, frameId),
    columns: { name: true },
  });

  await db.update(cards).set({ frameId: null, updatedAt: new Date() }).where(eq(cards.id, card.id));

  const existing = await db.query.userFrames.findFirst({
    where: and(eq(userFrames.userId, userId), eq(userFrames.frameId, frameId)),
  });
  if (existing) {
    await db
      .update(userFrames)
      .set({ quantity: sql`${userFrames.quantity} + 1` })
      .where(and(eq(userFrames.userId, userId), eq(userFrames.frameId, frameId)));
  } else {
    await db.insert(userFrames).values({ userId, frameId, quantity: 1 });
  }

  return { success: true, frameName: frame?.name ?? "Unknown" };
}

export async function placeSticker(
  discordId: string, username: string, cardCode: string, stickerId: number, position: number
): Promise<{ success: true } | { success: false; reason: string }> {
  if (position < 1 || position > 19) return { success: false, reason: "Position must be 1-19." };

  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const us = await db.query.userStickers.findFirst({
    where: and(eq(userStickers.userId, userId), eq(userStickers.stickerId, stickerId)),
    columns: { quantity: true },
  });
  if (!us || us.quantity <= 0) return { success: false, reason: "You don't have that sticker." };

  // Check position not occupied
  const existing = await db.query.cardStickers.findFirst({
    where: and(eq(cardStickers.cardId, card.id), eq(cardStickers.position, position)),
  });
  if (existing) return { success: false, reason: `Position ${position} already has a sticker.` };

  // Place sticker and consume from inventory
  await db.insert(cardStickers).values({ cardId: card.id, stickerId, position });
  await db.update(userStickers)
    .set({ quantity: sql`${userStickers.quantity} - 1` })
    .where(and(eq(userStickers.userId, userId), eq(userStickers.stickerId, stickerId)));

  return { success: true };
}

export async function removeSticker(
  discordId: string, username: string, cardCode: string, position: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const existing = await db.query.cardStickers.findFirst({
    where: and(eq(cardStickers.cardId, card.id), eq(cardStickers.position, position)),
    columns: { stickerId: true },
  });
  if (!existing) return { success: false, reason: `No sticker at position ${position}.` };

  // Return sticker to inventory
  await db.delete(cardStickers).where(and(eq(cardStickers.cardId, card.id), eq(cardStickers.position, position)));

  const inv = await db.query.userStickers.findFirst({
    where: and(eq(userStickers.userId, userId), eq(userStickers.stickerId, existing.stickerId)),
  });
  if (inv) {
    await db.update(userStickers).set({ quantity: sql`${userStickers.quantity} + 1` })
      .where(and(eq(userStickers.userId, userId), eq(userStickers.stickerId, existing.stickerId)));
  } else {
    await db.insert(userStickers).values({ userId, stickerId: existing.stickerId, quantity: 1 });
  }

  return { success: true };
}

// ─── Open Packs (Gacha) ───────────────────────────────

export async function openPack(
  discordId: string,
  username: string,
  packType: "hex" | "sticker" | "card",
  options?: OpenPackOptions
): Promise<{ success: true; items: string[] } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, username);
  const skipPayment = options?.skipPayment === true;

  const costs: Record<string, number> = { hex: 200, sticker: 150, card: 300 };
  const cost = costs[packType];

  const items: string[] = [];

  if (packType === "hex") {
    const allHexes = await db.query.hexes.findMany();
    if (allHexes.length === 0) return { success: false, reason: "No hexes available yet." };

    if (!skipPayment) {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { gold: true } });
      if (!user || user.gold < cost) {
        return { success: false, reason: `Need **${cost} gold**. You have ${user?.gold ?? 0}.` };
      }
      await db.update(users).set({ gold: sql`${users.gold} - ${cost}` }).where(eq(users.id, userId));
    }

    const count = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < count; i++) {
      const hex = allHexes[Math.floor(Math.random() * allHexes.length)];
      await grantCosmeticItem(userId, "hex", hex.id);
      items.push(`${hex.name} (${hex.colorPrimary})`);
    }
    return { success: true, items };
  }

  if (packType === "sticker") {
    const allStickers = await db.query.stickers.findMany();
    if (allStickers.length === 0) return { success: false, reason: "No stickers available yet." };

    if (!skipPayment) {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { gold: true } });
      if (!user || user.gold < cost) {
        return { success: false, reason: `Need **${cost} gold**. You have ${user?.gold ?? 0}.` };
      }
      await db.update(users).set({ gold: sql`${users.gold} - ${cost}` }).where(eq(users.id, userId));
    }

    const count = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < count; i++) {
      const sticker = allStickers[Math.floor(Math.random() * allStickers.length)];
      await grantCosmeticItem(userId, "sticker", sticker.id);
      items.push(`${sticker.name} (${sticker.rarity})`);
    }
    return { success: true, items };
  }

  if (packType === "card") {
    const guildId = options?.guildId ?? "DM";
    const cardCount = 3;
    const pool = await db
      .select({
        editionId: characterEditions.id,
        characterId: characterEditions.characterId,
        charName: characters.name,
        charSeries: characters.series,
      })
      .from(characterEditions)
      .innerJoin(characters, eq(characterEditions.characterId, characters.id))
      .orderBy(sql`RANDOM()`)
      .limit(cardCount);

    if (pool.length === 0) {
      return { success: false, reason: "No character editions available for card packs yet." };
    }

    if (!skipPayment) {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { gold: true } });
      if (!user || user.gold < cost) {
        return { success: false, reason: `Need **${cost} gold**. You have ${user?.gold ?? 0}.` };
      }
      await db.update(users).set({ gold: sql`${users.gold} - ${cost}` }).where(eq(users.id, userId));
    }

    for (const pick of pool) {
      const code = newCardCode();
      const quality = rollQuality();

      const [printResult] = await db
        .select({ maxPrint: sql<number>`COALESCE(MAX(${cards.printNumber}), 0)` })
        .from(cards)
        .where(eq(cards.editionId, pick.editionId));
      const printNumber = (printResult?.maxPrint ?? 0) + 1;

      await db.insert(cards).values({
        code,
        characterId: pick.characterId,
        editionId: pick.editionId,
        printNumber,
        quality,
        originalQuality: quality,
        summonerId: userId,
        ownerId: userId,
        guildId,
      });

      items.push(`\`${code}\` **${pick.charName}** — ${pick.charSeries} (${quality}, #${printNumber})`);
    }

    return { success: true, items };
  }

  return { success: false, reason: "Unknown pack type." };
}

export async function grantCosmeticItem(
  userId: number,
  type: "hex" | "sticker" | "aura" | "frame",
  itemId: number
) {
  const tables = {
    hex: { table: userHexes, userCol: userHexes.userId, itemCol: userHexes.hexId, qtyCol: userHexes.quantity },
    sticker: { table: userStickers, userCol: userStickers.userId, itemCol: userStickers.stickerId, qtyCol: userStickers.quantity },
    aura: { table: userAuras, userCol: userAuras.userId, itemCol: userAuras.auraId, qtyCol: userAuras.quantity },
    frame: { table: userFrames, userCol: userFrames.userId, itemCol: userFrames.frameId, qtyCol: userFrames.quantity },
  };

  const t = tables[type];
  const existing = await db.select().from(t.table).where(and(eq(t.userCol, userId), eq(t.itemCol, itemId))).limit(1);

  if (existing.length > 0) {
    await db.update(t.table).set({ quantity: sql`${t.qtyCol} + 1` }).where(and(eq(t.userCol, userId), eq(t.itemCol, itemId)));
  } else {
    await db.insert(t.table).values({ userId, [t.itemCol.name]: itemId, quantity: 1 } as any);
  }
}
