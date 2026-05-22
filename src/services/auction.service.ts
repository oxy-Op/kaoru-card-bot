import { and, eq, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";
import { auctions, cards, characters, users } from "../db/schema.js";
import { ensureUser } from "./summon.service.js";
import { logAudit } from "./audit.service.js";

const ANTI_SNIPE_WINDOW_MS = 2 * 60 * 1000;
const ANTI_SNIPE_EXTEND_MS = 2 * 60 * 1000;

export interface AuctionSummary {
  id: number;
  cardCode: string;
  characterName: string;
  series: string;
  quality: string;
  printNumber: number;
  sellerName: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderName: string | null;
  endsAt: Date;
  status: string;
}

function auctionEndDate(durationMinutes: number): Date {
  return new Date(Date.now() + durationMinutes * 60 * 1000);
}

export async function settleAuction(
  auctionId: number
): Promise<
  | { success: true; status: "settled" | "expired"; winnerUserId: number | null; finalBid: number }
  | { success: false; reason: string }
> {
  const now = new Date();
  const [a] = await db
    .select({
      id: auctions.id,
      sellerId: auctions.sellerId,
      cardId: auctions.cardId,
      currentBid: auctions.currentBid,
      currentBidderId: auctions.currentBidderId,
      status: auctions.status,
      endsAt: auctions.endsAt,
    })
    .from(auctions)
    .where(eq(auctions.id, auctionId))
    .limit(1);

  if (!a) return { success: false, reason: "Auction not found." };
  if (a.status !== "active") return { success: false, reason: `Auction is already ${a.status}.` };
  if (a.endsAt.getTime() > now.getTime()) {
    return { success: false, reason: "Auction has not ended yet." };
  }

  const finalBid = a.currentBid ?? 0;
  const hasWinner = Boolean(a.currentBidderId && finalBid > 0);

  await db.transaction(async (tx) => {
    if (hasWinner) {
      await tx
        .update(cards)
        .set({ ownerId: a.currentBidderId!, updatedAt: new Date() })
        .where(eq(cards.id, a.cardId));

      await tx
        .update(users)
        .set({ gold: sql`${users.gold} + ${finalBid}` })
        .where(eq(users.id, a.sellerId));

      await tx
        .update(auctions)
        .set({ status: "settled", updatedAt: new Date() })
        .where(eq(auctions.id, auctionId));
    } else {
      await tx
        .update(cards)
        .set({ ownerId: a.sellerId, updatedAt: new Date() })
        .where(eq(cards.id, a.cardId));

      await tx
        .update(auctions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(auctions.id, auctionId));
    }
  });

  await logAudit(a.sellerId, hasWinner ? "auction_settled" : "auction_expired", {
    auctionId,
    cardId: a.cardId,
    winnerUserId: hasWinner ? a.currentBidderId : null,
    finalBid,
  });
  if (hasWinner && a.currentBidderId) {
    await logAudit(a.currentBidderId, "auction_won", { auctionId, cardId: a.cardId, finalBid });
  }

  return {
    success: true,
    status: hasWinner ? "settled" : "expired",
    winnerUserId: hasWinner ? a.currentBidderId! : null,
    finalBid,
  };
}

export async function expireAuctions(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(and(eq(auctions.status, "active"), lt(auctions.endsAt, now)));

  for (const row of rows) {
    await settleAuction(row.id);
  }

  return rows.length;
}

export async function listActiveAuctions(limit = 10): Promise<AuctionSummary[]> {
  await expireAuctions();

  const sellerAlias = alias(users, "auction_seller");
  const bidderAlias = alias(users, "auction_bidder");
  const rows = await db
    .select({
      id: auctions.id,
      cardCode: cards.code,
      characterName: characters.name,
      series: characters.series,
      quality: cards.quality,
      printNumber: cards.printNumber,
      sellerName: sellerAlias.username,
      startingBid: auctions.startingBid,
      currentBid: auctions.currentBid,
      currentBidderName: bidderAlias.username,
      endsAt: auctions.endsAt,
      status: auctions.status,
    })
    .from(auctions)
    .innerJoin(cards, eq(cards.id, auctions.cardId))
    .innerJoin(characters, eq(characters.id, cards.characterId))
    .innerJoin(sellerAlias, eq(sellerAlias.id, auctions.sellerId))
    .leftJoin(bidderAlias, eq(bidderAlias.id, auctions.currentBidderId))
    .where(eq(auctions.status, "active"))
    .orderBy(sql`${auctions.endsAt} ASC`)
    .limit(limit);

  return rows;
}

export async function createAuction(
  sellerDiscordId: string,
  sellerUsername: string,
  cardCode: string,
  startingBid: number,
  durationMinutes: number
): Promise<
  | { success: true; auctionId: number; endsAt: Date; cardCode: string; characterName: string; startingBid: number }
  | { success: false; reason: string }
> {
  if (!Number.isFinite(startingBid) || startingBid <= 0) {
    return { success: false, reason: "Starting bid must be a positive number." };
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    return { success: false, reason: "Duration must be between 1 and 1440 minutes." };
  }

  const sellerId = await ensureUser(sellerDiscordId, sellerUsername);
  const card = await db
    .select({
      id: cards.id,
      code: cards.code,
      characterName: characters.name,
      ownerId: cards.ownerId,
      inFusionPile: cards.inFusionPile,
    })
    .from(cards)
    .innerJoin(characters, eq(characters.id, cards.characterId))
    .where(eq(cards.code, cardCode))
    .limit(1);

  if (card.length === 0) return { success: false, reason: `Card \`${cardCode}\` not found.` };
  const c = card[0];
  if (c.ownerId !== sellerId) return { success: false, reason: "You can only auction cards you own." };
  if (c.inFusionPile) return { success: false, reason: "Card is in fusion pile and cannot be auctioned." };

  const [existingActive] = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(and(eq(auctions.cardId, c.id), eq(auctions.status, "active")))
    .limit(1);
  if (existingActive) return { success: false, reason: "That card is already listed in an active auction." };

  const endsAt = auctionEndDate(durationMinutes);
  let auctionId = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(cards)
      .set({ ownerId: null, updatedAt: new Date() })
      .where(eq(cards.id, c.id));

    const [created] = await tx
      .insert(auctions)
      .values({
        sellerId,
        cardId: c.id,
        startingBid,
        endsAt,
      })
      .returning({ id: auctions.id });
    auctionId = created.id;
  });

  await logAudit(sellerId, "auction_created", { auctionId, cardId: c.id, startingBid, endsAt });
  return {
    success: true,
    auctionId,
    endsAt,
    cardCode: c.code,
    characterName: c.characterName,
    startingBid,
  };
}

export async function bidAuction(
  bidderDiscordId: string,
  bidderUsername: string,
  auctionId: number,
  bidAmount: number
): Promise<
  | { success: true; currentBid: number; endsAt: Date; antiSnipeExtended: boolean }
  | { success: false; reason: string }
> {
  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    return { success: false, reason: "Bid must be a positive number." };
  }

  await expireAuctions();
  const bidderId = await ensureUser(bidderDiscordId, bidderUsername);
  const [a] = await db
    .select({
      id: auctions.id,
      sellerId: auctions.sellerId,
      startingBid: auctions.startingBid,
      currentBid: auctions.currentBid,
      currentBidderId: auctions.currentBidderId,
      status: auctions.status,
      endsAt: auctions.endsAt,
    })
    .from(auctions)
    .where(eq(auctions.id, auctionId))
    .limit(1);

  if (!a) return { success: false, reason: "Auction not found." };
  if (a.status !== "active") return { success: false, reason: `Auction is ${a.status}.` };
  if (a.sellerId === bidderId) return { success: false, reason: "You cannot bid on your own auction." };
  if (a.endsAt.getTime() <= Date.now()) return { success: false, reason: "Auction already ended." };

  const minBid = Math.max(a.startingBid, (a.currentBid ?? 0) + 1);
  if (bidAmount < minBid) {
    return { success: false, reason: `Bid must be at least ${minBid.toLocaleString()} gold.` };
  }
  if (a.currentBidderId === bidderId) {
    return { success: false, reason: "You already hold the highest bid." };
  }

  const [bidder] = await db
    .select({ gold: users.gold })
    .from(users)
    .where(eq(users.id, bidderId))
    .limit(1);
  if (!bidder || bidder.gold < bidAmount) {
    return { success: false, reason: `Not enough gold. You have ${bidder?.gold ?? 0}.` };
  }

  const now = Date.now();
  const remaining = a.endsAt.getTime() - now;
  const antiSnipeExtended = remaining <= ANTI_SNIPE_WINDOW_MS;
  const nextEndsAt = antiSnipeExtended
    ? new Date(a.endsAt.getTime() + ANTI_SNIPE_EXTEND_MS)
    : a.endsAt;

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ gold: sql`${users.gold} - ${bidAmount}` })
      .where(eq(users.id, bidderId));

    if (a.currentBidderId && a.currentBid && a.currentBid > 0) {
      await tx
        .update(users)
        .set({ gold: sql`${users.gold} + ${a.currentBid}` })
        .where(eq(users.id, a.currentBidderId));
    }

    await tx
      .update(auctions)
      .set({
        currentBid: bidAmount,
        currentBidderId: bidderId,
        endsAt: nextEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(auctions.id, auctionId));
  });

  await logAudit(bidderId, "auction_bid", { auctionId, bidAmount, antiSnipeExtended, endsAt: nextEndsAt });
  return { success: true, currentBid: bidAmount, endsAt: nextEndsAt, antiSnipeExtended };
}

export async function cancelAuction(
  sellerDiscordId: string,
  sellerUsername: string,
  auctionId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const sellerId = await ensureUser(sellerDiscordId, sellerUsername);
  const [a] = await db
    .select({
      id: auctions.id,
      sellerId: auctions.sellerId,
      cardId: auctions.cardId,
      currentBidderId: auctions.currentBidderId,
      status: auctions.status,
    })
    .from(auctions)
    .where(eq(auctions.id, auctionId))
    .limit(1);

  if (!a) return { success: false, reason: "Auction not found." };
  if (a.sellerId !== sellerId) return { success: false, reason: "You can only cancel your own auction." };
  if (a.status !== "active") return { success: false, reason: `Auction is already ${a.status}.` };
  if (a.currentBidderId) return { success: false, reason: "Cannot cancel an auction with active bids." };

  await db.transaction(async (tx) => {
    await tx
      .update(auctions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(auctions.id, auctionId));
    await tx
      .update(cards)
      .set({ ownerId: sellerId, updatedAt: new Date() })
      .where(eq(cards.id, a.cardId));
  });

  await logAudit(sellerId, "auction_cancelled", { auctionId, cardId: a.cardId });
  return { success: true };
}
