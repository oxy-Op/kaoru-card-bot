import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { fusionPileEntries } from "../db/schema.js";

export interface FusionPileSeedCard {
  characterId: number;
  editionId: number;
  sourceCardId?: number | null;
}

export interface ClaimedFusionPileEntry {
  id: number;
  characterId: number;
  editionId: number;
}

export async function enqueueFusionPileEntries(
  sourceUserId: number | null,
  cards: FusionPileSeedCard[],
  source: "fusion" | "admin_seed" | "event" = "fusion"
): Promise<number> {
  if (cards.length === 0) return 0;
  await db.insert(fusionPileEntries).values(
    cards.map((card) => ({
      characterId: card.characterId,
      editionId: card.editionId,
      sourceCardId: card.sourceCardId ?? null,
      sourceUserId,
      source,
      status: "available",
    }))
  );
  return cards.length;
}

/**
 * Claims one available fusion pile entry.
 * Retries a few times if a race claims the same row first.
 */
export async function claimFusionPileEntry(
  claimedByUserId: number,
  summonId: string
): Promise<ClaimedFusionPileEntry | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await db.query.fusionPileEntries.findFirst({
      where: eq(fusionPileEntries.status, "available"),
      columns: {
        id: true,
        characterId: true,
        editionId: true,
      },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });
    if (!candidate) return null;

    const [claimed] = await db
      .update(fusionPileEntries)
      .set({
        status: "claimed",
        claimedByUserId,
        claimSummonId: summonId,
        claimedAt: new Date(),
      })
      .where(and(
        eq(fusionPileEntries.id, candidate.id),
        eq(fusionPileEntries.status, "available")
      ))
      .returning({
        id: fusionPileEntries.id,
        characterId: fusionPileEntries.characterId,
        editionId: fusionPileEntries.editionId,
      });

    if (claimed) return claimed;
  }
  return null;
}

export async function attachClaimedFusionCard(
  entryId: number,
  claimedCardId: number
): Promise<void> {
  await db
    .update(fusionPileEntries)
    .set({ claimedCardId })
    .where(eq(fusionPileEntries.id, entryId));
}

export async function getFusionPileStats() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      available: sql<number>`COUNT(*) FILTER (WHERE ${fusionPileEntries.status} = 'available')`,
      claimed24h: sql<number>`COUNT(*) FILTER (WHERE ${fusionPileEntries.status} = 'claimed' AND ${fusionPileEntries.claimedAt} >= ${dayAgo})`,
      total: sql<number>`COUNT(*)`,
    })
    .from(fusionPileEntries);

  return {
    available: Number(row?.available ?? 0),
    claimed24h: Number(row?.claimed24h ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function listRecentFusionPileClaims(limit = 10) {
  return db.query.fusionPileEntries.findMany({
    where: and(
      eq(fusionPileEntries.status, "claimed"),
      gte(fusionPileEntries.claimedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
    ),
    columns: {
      id: true,
      characterId: true,
      editionId: true,
      claimedByUserId: true,
      claimSummonId: true,
      claimedAt: true,
    },
    orderBy: (t, { desc }) => [desc(t.claimedAt)],
    limit: Math.max(1, Math.min(limit, 50)),
  });
}
