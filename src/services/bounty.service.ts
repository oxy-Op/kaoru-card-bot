import { and, eq, ilike, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bounties, cards, characters, users } from "../db/schema.js";
import { ensureUser } from "./summon.service.js";
import { logAudit } from "./audit.service.js";

const BOUNTY_DURATION_DAYS = 7;

export interface BountySummary {
  id: number;
  requesterUserId: number;
  requesterName: string;
  characterId: number;
  characterName: string;
  series: string;
  goldAmount: number;
  expiresAt: Date;
  status: string;
}

function bountyExpiryDate(): Date {
  return new Date(Date.now() + BOUNTY_DURATION_DAYS * 24 * 60 * 60 * 1000);
}

export async function expireBounties(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({
      id: bounties.id,
      requesterId: bounties.requesterId,
      goldAmount: bounties.goldAmount,
    })
    .from(bounties)
    .where(and(eq(bounties.status, "active"), lt(bounties.expiresAt, now)));

  for (const row of rows) {
    await db.transaction(async (tx) => {
      await tx
        .update(bounties)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(bounties.id, row.id));

      await tx
        .update(users)
        .set({ gold: sql`${users.gold} + ${row.goldAmount}` })
        .where(eq(users.id, row.requesterId));
    });
  }

  return rows.length;
}

export async function listActiveBounties(limit = 10): Promise<BountySummary[]> {
  await expireBounties();
  const rows = await db
    .select({
      id: bounties.id,
      requesterUserId: bounties.requesterId,
      requesterName: users.username,
      characterId: bounties.characterId,
      characterName: characters.name,
      series: characters.series,
      goldAmount: bounties.goldAmount,
      expiresAt: bounties.expiresAt,
      status: bounties.status,
    })
    .from(bounties)
    .innerJoin(users, eq(users.id, bounties.requesterId))
    .innerJoin(characters, eq(characters.id, bounties.characterId))
    .where(eq(bounties.status, "active"))
    .orderBy(sql`${bounties.goldAmount} DESC, ${bounties.createdAt} DESC`)
    .limit(limit);

  return rows;
}

export async function postBounty(
  requesterDiscordId: string,
  requesterUsername: string,
  characterNameQuery: string,
  goldAmount: number
): Promise<
  | { success: true; bountyId: number; characterName: string; series: string; goldAmount: number; expiresAt: Date }
  | { success: false; reason: string }
> {
  if (!Number.isFinite(goldAmount) || goldAmount <= 0) {
    return { success: false, reason: "Bounty amount must be a positive number." };
  }

  const requesterId = await ensureUser(requesterDiscordId, requesterUsername);
  const character = await db.query.characters.findFirst({
    where: ilike(characters.name, `%${characterNameQuery}%`),
    columns: { id: true, name: true, series: true },
  });
  if (!character) {
    return { success: false, reason: `No character found matching "${characterNameQuery}".` };
  }

  const [requester] = await db
    .select({ gold: users.gold })
    .from(users)
    .where(eq(users.id, requesterId))
    .limit(1);
  if (!requester || requester.gold < goldAmount) {
    return { success: false, reason: `Not enough gold. You have ${requester?.gold ?? 0}.` };
  }

  const expiresAt = bountyExpiryDate();
  let bountyId = 0;
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ gold: sql`${users.gold} - ${goldAmount}` })
      .where(eq(users.id, requesterId));

    const [created] = await tx
      .insert(bounties)
      .values({
        requesterId,
        characterId: character.id,
        goldAmount,
        expiresAt,
      })
      .returning({ id: bounties.id });
    bountyId = created.id;
  });

  await logAudit(requesterId, "bounty_posted", {
    bountyId,
    characterId: character.id,
    goldAmount,
  });

  return {
    success: true,
    bountyId,
    characterName: character.name,
    series: character.series,
    goldAmount,
    expiresAt,
  };
}

export async function cancelBounty(
  requesterDiscordId: string,
  requesterUsername: string,
  bountyId: number
): Promise<{ success: true; refunded: number } | { success: false; reason: string }> {
  const requesterId = await ensureUser(requesterDiscordId, requesterUsername);
  const bounty = await db.query.bounties.findFirst({
    where: eq(bounties.id, bountyId),
    columns: { id: true, requesterId: true, goldAmount: true, status: true },
  });
  if (!bounty) return { success: false, reason: "Bounty not found." };
  if (bounty.requesterId !== requesterId) return { success: false, reason: "You can only cancel your own bounties." };
  if (bounty.status !== "active") return { success: false, reason: `Bounty is already ${bounty.status}.` };

  await db.transaction(async (tx) => {
    await tx
      .update(bounties)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(bounties.id, bountyId));

    await tx
      .update(users)
      .set({ gold: sql`${users.gold} + ${bounty.goldAmount}` })
      .where(eq(users.id, requesterId));
  });

  await logAudit(requesterId, "bounty_cancelled", { bountyId, refunded: bounty.goldAmount });
  return { success: true, refunded: bounty.goldAmount };
}

export async function claimBounty(
  claimerDiscordId: string,
  claimerUsername: string,
  bountyId: number,
  cardCode: string
): Promise<
  | { success: true; payout: number; characterName: string; requesterName: string }
  | { success: false; reason: string }
> {
  await expireBounties();
  const claimerId = await ensureUser(claimerDiscordId, claimerUsername);

  const bounty = await db
    .select({
      id: bounties.id,
      requesterId: bounties.requesterId,
      characterId: bounties.characterId,
      goldAmount: bounties.goldAmount,
      status: bounties.status,
      characterName: characters.name,
      requesterName: users.username,
    })
    .from(bounties)
    .innerJoin(characters, eq(characters.id, bounties.characterId))
    .innerJoin(users, eq(users.id, bounties.requesterId))
    .where(eq(bounties.id, bountyId))
    .limit(1);

  if (bounty.length === 0) return { success: false, reason: "Bounty not found." };
  const b = bounty[0];
  if (b.status !== "active") return { success: false, reason: `Bounty is ${b.status}.` };
  if (b.requesterId === claimerId) return { success: false, reason: "You can't claim your own bounty." };

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, claimerId)),
    columns: { id: true, characterId: true, inFusionPile: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };
  if (card.inFusionPile) return { success: false, reason: "Card is in fusion pile." };
  if (card.characterId !== b.characterId) {
    return { success: false, reason: "That card does not match the bounty target." };
  }

  try {
    await db.transaction(async (tx) => {
      // Claim bounty atomically to avoid double-fulfillment races.
      const [claimedBounty] = await tx
        .update(bounties)
        .set({
          status: "fulfilled",
          fulfilledByUserId: claimerId,
          fulfilledCardId: card.id,
          updatedAt: new Date(),
        })
        .where(and(
          eq(bounties.id, b.id),
          eq(bounties.status, "active")
        ))
        .returning({ id: bounties.id });

      if (!claimedBounty) {
        throw new Error("Bounty was already claimed or is no longer active.");
      }

      const [movedCard] = await tx
        .update(cards)
        .set({ ownerId: b.requesterId, updatedAt: new Date() })
        .where(and(
          eq(cards.id, card.id),
          eq(cards.ownerId, claimerId),
          eq(cards.inFusionPile, false),
          eq(cards.characterId, b.characterId)
        ))
        .returning({ id: cards.id });

      if (!movedCard) {
        throw new Error("Card ownership changed before claim completed.");
      }

      await tx
        .update(users)
        .set({ gold: sql`${users.gold} + ${b.goldAmount}` })
        .where(eq(users.id, claimerId));
    });
  } catch (err) {
    return {
      success: false,
      reason: err instanceof Error ? err.message : "Could not claim this bounty right now.",
    };
  }

  await logAudit(claimerId, "bounty_claimed", {
    bountyId: b.id,
    cardCode,
    payout: b.goldAmount,
    requesterId: b.requesterId,
  });

  return {
    success: true,
    payout: b.goldAmount,
    characterName: b.characterName,
    requesterName: b.requesterName,
  };
}
