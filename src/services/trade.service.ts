import { db } from "../db/index.js";
import { users, cards, characters, trades } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "../cache/index.js";
import { ensureUser } from "./summon.service.js";

const TRADE_TTL = 600; // 10 minutes

export interface TradeCardInfo {
  code: string;
  charName: string;
  printNumber: number;
  quality: string;
}

export interface TradeSession {
  initiatorId: string;
  receiverId: string;
  initiatorCards: TradeCardInfo[];
  receiverCards: TradeCardInfo[];
  initiatorGold: number;
  receiverGold: number;
  initiatorLocked: boolean;
  receiverLocked: boolean;
}

function tradeKey(id: string) { return `trade:${id}`; }

async function saveSession(tradeId: string, session: TradeSession) {
  const ttl = await redis.ttl(tradeKey(tradeId));
  await redis.set(tradeKey(tradeId), JSON.stringify(session), "EX", Math.max(ttl, 60));
}

/** Resolve a card code to display info, verifying ownership. */
async function resolveCard(
  code: string,
  ownerDbId: number
): Promise<{ success: true; info: TradeCardInfo } | { success: false; reason: string }> {
  const card = await db
    .select({
      code: cards.code,
      printNumber: cards.printNumber,
      quality: cards.quality,
      ownerId: cards.ownerId,
      inFusionPile: cards.inFusionPile,
      charName: characters.name,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .where(eq(cards.code, code))
    .limit(1);

  if (card.length === 0) return { success: false, reason: `Card \`${code}\` not found.` };
  const c = card[0];
  if (c.ownerId !== ownerDbId) return { success: false, reason: `You don't own \`${code}\`.` };
  if (c.inFusionPile) return { success: false, reason: `\`${code}\` is in your fusion pile.` };

  return {
    success: true,
    info: { code: c.code, charName: c.charName, printNumber: c.printNumber, quality: c.quality },
  };
}

// ─── Quick Trade (1:1, unchanged) ────────────────────────

export async function quickTrade(
  initiatorDiscordId: string,
  initiatorUsername: string,
  receiverDiscordId: string,
  receiverUsername: string,
  initiatorCardCode: string,
  receiverCardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const initId = await ensureUser(initiatorDiscordId, initiatorUsername);
  const recvId = await ensureUser(receiverDiscordId, receiverUsername);

  if (initId === recvId) return { success: false, reason: "Can't trade with yourself." };

  const initCard = await db.query.cards.findFirst({
    where: and(eq(cards.code, initiatorCardCode), eq(cards.ownerId, initId)),
    columns: { id: true, inFusionPile: true },
  });
  const recvCard = await db.query.cards.findFirst({
    where: and(eq(cards.code, receiverCardCode), eq(cards.ownerId, recvId)),
    columns: { id: true, inFusionPile: true },
  });

  if (!initCard) return { success: false, reason: `You don't own \`${initiatorCardCode}\`.` };
  if (!recvCard) return { success: false, reason: `They don't own \`${receiverCardCode}\`.` };
  if (initCard.inFusionPile || recvCard.inFusionPile) {
    return { success: false, reason: "Can't trade cards in fusion piles." };
  }

  try {
    await db.transaction(async (tx) => {
      const [movedInit] = await tx
        .update(cards)
        .set({ ownerId: recvId, updatedAt: new Date() })
        .where(and(
          eq(cards.id, initCard.id),
          eq(cards.ownerId, initId),
          eq(cards.inFusionPile, false)
        ))
        .returning({ id: cards.id });
      if (!movedInit) throw new Error(`You no longer own \`${initiatorCardCode}\`.`);

      const [movedRecv] = await tx
        .update(cards)
        .set({ ownerId: initId, updatedAt: new Date() })
        .where(and(
          eq(cards.id, recvCard.id),
          eq(cards.ownerId, recvId),
          eq(cards.inFusionPile, false)
        ))
        .returning({ id: cards.id });
      if (!movedRecv) throw new Error(`They no longer own \`${receiverCardCode}\`.`);

      await tx.update(users).set({ totalTrades: sql`${users.totalTrades} + 1` }).where(eq(users.id, initId));
      await tx.update(users).set({ totalTrades: sql`${users.totalTrades} + 1` }).where(eq(users.id, recvId));

      await tx.insert(trades).values({
        initiatorId: initId,
        receiverId: recvId,
        initiatorCards: [initiatorCardCode],
        receiverCards: [receiverCardCode],
        initiatorLocked: true,
        receiverLocked: true,
        status: "completed",
        completedAt: new Date(),
      });
    });
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : "Trade failed." };
  }

  return { success: true };
}

// ─── Multi-Trade ─────────────────────────────────────────

export async function createMultiTrade(
  initiatorDiscordId: string,
  receiverDiscordId: string
): Promise<string> {
  const tradeId = `mt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const session: TradeSession = {
    initiatorId: initiatorDiscordId,
    receiverId: receiverDiscordId,
    initiatorCards: [],
    receiverCards: [],
    initiatorGold: 0,
    receiverGold: 0,
    initiatorLocked: false,
    receiverLocked: false,
  };

  await redis.set(tradeKey(tradeId), JSON.stringify(session), "EX", TRADE_TTL);
  return tradeId;
}

export async function getMultiTrade(tradeId: string): Promise<TradeSession | null> {
  const raw = await redis.get(tradeKey(tradeId));
  return raw ? JSON.parse(raw) : null;
}

/** Add one or more cards to the trade. Returns resolved card info for display. */
export async function addCardsToTrade(
  tradeId: string,
  discordId: string,
  cardCodes: string[]
): Promise<{ success: true; added: TradeCardInfo[]; errors: string[] } | { success: false; reason: string }> {
  const session = await getMultiTrade(tradeId);
  if (!session) return { success: false, reason: "Trade expired." };

  const isInitiator = discordId === session.initiatorId;
  const isReceiver = discordId === session.receiverId;
  if (!isInitiator && !isReceiver) return { success: false, reason: "Not your trade." };

  if (isInitiator && session.initiatorLocked) return { success: false, reason: "Your side is locked." };
  if (isReceiver && session.receiverLocked) return { success: false, reason: "Your side is locked." };

  const list = isInitiator ? session.initiatorCards : session.receiverCards;
  const ownerDbId = await ensureUser(discordId, "");
  const added: TradeCardInfo[] = [];
  const errors: string[] = [];

  for (const code of cardCodes) {
    if (list.some((c) => c.code === code)) {
      errors.push(`\`${code}\` already in trade.`);
      continue;
    }
    // Make sure it's not on the other side either
    const otherList = isInitiator ? session.receiverCards : session.initiatorCards;
    if (otherList.some((c) => c.code === code)) {
      errors.push(`\`${code}\` is on the other side.`);
      continue;
    }

    const result = await resolveCard(code, ownerDbId);
    if (!result.success) {
      errors.push(result.reason);
      continue;
    }
    list.push(result.info);
    added.push(result.info);
  }

  if (added.length > 0) {
    await saveSession(tradeId, session);
  }

  return { success: true, added, errors };
}

/** Remove a card from the trade. */
export async function removeFromTrade(
  tradeId: string,
  discordId: string,
  cardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const session = await getMultiTrade(tradeId);
  if (!session) return { success: false, reason: "Trade expired." };

  const isInitiator = discordId === session.initiatorId;
  const isReceiver = discordId === session.receiverId;
  if (!isInitiator && !isReceiver) return { success: false, reason: "Not your trade." };

  if (isInitiator && session.initiatorLocked) return { success: false, reason: "Your side is locked." };
  if (isReceiver && session.receiverLocked) return { success: false, reason: "Your side is locked." };

  const list = isInitiator ? session.initiatorCards : session.receiverCards;
  const idx = list.findIndex((c) => c.code === cardCode);
  if (idx === -1) return { success: false, reason: `\`${cardCode}\` is not in your trade.` };

  list.splice(idx, 1);
  await saveSession(tradeId, session);
  return { success: true };
}

/** Set gold amount for a side. */
export async function setTradeGold(
  tradeId: string,
  discordId: string,
  amount: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const session = await getMultiTrade(tradeId);
  if (!session) return { success: false, reason: "Trade expired." };

  const isInitiator = discordId === session.initiatorId;
  const isReceiver = discordId === session.receiverId;
  if (!isInitiator && !isReceiver) return { success: false, reason: "Not your trade." };

  if (isInitiator && session.initiatorLocked) return { success: false, reason: "Your side is locked." };
  if (isReceiver && session.receiverLocked) return { success: false, reason: "Your side is locked." };

  if (amount < 0) return { success: false, reason: "Amount can't be negative." };

  // Verify balance
  if (amount > 0) {
    const dbId = await ensureUser(discordId, "");
    const user = await db.query.users.findFirst({ where: eq(users.id, dbId), columns: { gold: true } });
    if (!user || user.gold < amount) {
      return { success: false, reason: `Not enough gold. You have ${user?.gold ?? 0}.` };
    }
  }

  if (isInitiator) session.initiatorGold = amount;
  else session.receiverGold = amount;

  await saveSession(tradeId, session);
  return { success: true };
}

/** Lock your side of the trade. */
export async function lockTrade(
  tradeId: string,
  discordId: string
): Promise<{ success: true; bothLocked: boolean } | { success: false; reason: string }> {
  const session = await getMultiTrade(tradeId);
  if (!session) return { success: false, reason: "Trade expired." };

  if (discordId === session.initiatorId) {
    if (session.initiatorLocked) return { success: false, reason: "Already locked." };
    session.initiatorLocked = true;
  } else if (discordId === session.receiverId) {
    if (session.receiverLocked) return { success: false, reason: "Already locked." };
    session.receiverLocked = true;
  } else {
    return { success: false, reason: "Not your trade." };
  }

  await saveSession(tradeId, session);
  return { success: true, bothLocked: session.initiatorLocked && session.receiverLocked };
}

/** Execute a locked multi-trade. Both sides must be locked. */
export async function executeMultiTrade(
  tradeId: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const session = await getMultiTrade(tradeId);
  if (!session) return { success: false, reason: "Trade expired." };
  if (!session.initiatorLocked || !session.receiverLocked) {
    return { success: false, reason: "Both sides must lock first." };
  }

  if (session.initiatorCards.length === 0 && session.receiverCards.length === 0
      && session.initiatorGold === 0 && session.receiverGold === 0) {
    return { success: false, reason: "Nothing to trade." };
  }

  const initDbId = await ensureUser(session.initiatorId, "");
  const recvDbId = await ensureUser(session.receiverId, "");

  const initCodes = session.initiatorCards.map((c) => c.code);
  const recvCodes = session.receiverCards.map((c) => c.code);

  // Re-verify ownership at execution time
  for (const code of initCodes) {
    const card = await db.query.cards.findFirst({
      where: and(eq(cards.code, code), eq(cards.ownerId, initDbId)),
      columns: { id: true, inFusionPile: true },
    });
    if (!card) return { success: false, reason: `You no longer own \`${code}\`.` };
    if (card.inFusionPile) return { success: false, reason: `\`${code}\` is in a fusion pile.` };
  }
  for (const code of recvCodes) {
    const card = await db.query.cards.findFirst({
      where: and(eq(cards.code, code), eq(cards.ownerId, recvDbId)),
      columns: { id: true, inFusionPile: true },
    });
    if (!card) return { success: false, reason: `They no longer own \`${code}\`.` };
    if (card.inFusionPile) return { success: false, reason: `\`${code}\` is in a fusion pile.` };
  }

  // Verify gold
  if (session.initiatorGold > 0 || session.receiverGold > 0) {
    const [initUser] = await db.select({ gold: users.gold }).from(users).where(eq(users.id, initDbId)).limit(1);
    const [recvUser] = await db.select({ gold: users.gold }).from(users).where(eq(users.id, recvDbId)).limit(1);
    if ((initUser?.gold ?? 0) < session.initiatorGold) {
      return { success: false, reason: "Initiator doesn't have enough gold." };
    }
    if ((recvUser?.gold ?? 0) < session.receiverGold) {
      return { success: false, reason: "Receiver doesn't have enough gold." };
    }
  }

  try {
    await db.transaction(async (tx) => {
      if (session.initiatorGold > 0) {
        const rows = await tx
          .update(users)
          .set({ gold: sql`${users.gold} - ${session.initiatorGold}` })
          .where(and(eq(users.id, initDbId), sql`${users.gold} >= ${session.initiatorGold}`))
          .returning({ id: users.id });
        if (rows.length === 0) throw new Error("Initiator doesn't have enough gold.");
        await tx.update(users).set({ gold: sql`${users.gold} + ${session.initiatorGold}` }).where(eq(users.id, recvDbId));
      }
      if (session.receiverGold > 0) {
        const rows = await tx
          .update(users)
          .set({ gold: sql`${users.gold} - ${session.receiverGold}` })
          .where(and(eq(users.id, recvDbId), sql`${users.gold} >= ${session.receiverGold}`))
          .returning({ id: users.id });
        if (rows.length === 0) throw new Error("Receiver doesn't have enough gold.");
        await tx.update(users).set({ gold: sql`${users.gold} + ${session.receiverGold}` }).where(eq(users.id, initDbId));
      }

      // Swap cards with ownership/fusion guards at execution time.
      for (const code of initCodes) {
        const rows = await tx
          .update(cards)
          .set({ ownerId: recvDbId, updatedAt: new Date() })
          .where(and(
            eq(cards.code, code),
            eq(cards.ownerId, initDbId),
            eq(cards.inFusionPile, false)
          ))
          .returning({ id: cards.id });
        if (rows.length === 0) throw new Error(`You no longer own \`${code}\`.`);
      }
      for (const code of recvCodes) {
        const rows = await tx
          .update(cards)
          .set({ ownerId: initDbId, updatedAt: new Date() })
          .where(and(
            eq(cards.code, code),
            eq(cards.ownerId, recvDbId),
            eq(cards.inFusionPile, false)
          ))
          .returning({ id: cards.id });
        if (rows.length === 0) throw new Error(`They no longer own \`${code}\`.`);
      }

      // Stats + log
      await tx.update(users).set({ totalTrades: sql`${users.totalTrades} + 1` }).where(eq(users.id, initDbId));
      await tx.update(users).set({ totalTrades: sql`${users.totalTrades} + 1` }).where(eq(users.id, recvDbId));

      await tx.insert(trades).values({
        initiatorId: initDbId,
        receiverId: recvDbId,
        initiatorCards: initCodes,
        receiverCards: recvCodes,
        initiatorResources: { gold: session.initiatorGold },
        receiverResources: { gold: session.receiverGold },
        initiatorLocked: true,
        receiverLocked: true,
        status: "completed",
        completedAt: new Date(),
      });
    });
  } catch (err) {
    return { success: false, reason: err instanceof Error ? err.message : "Trade failed." };
  }

  await redis.del(tradeKey(tradeId));
  return { success: true };
}
