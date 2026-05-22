import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { withRole } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { characters, fusionPileEntries, users } from "@shared/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRole("viewer", async (_req: NextRequest) => {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totals] = await db
      .select({
        available: sql<number>`COUNT(*) FILTER (WHERE ${fusionPileEntries.status} = 'available')`,
        claimed24h: sql<number>`COUNT(*) FILTER (WHERE ${fusionPileEntries.status} = 'claimed' AND ${fusionPileEntries.claimedAt} >= ${dayAgo})`,
        total: sql<number>`COUNT(*)`,
      })
      .from(fusionPileEntries);

    const recent = await db
      .select({
        id: fusionPileEntries.id,
        claimedAt: fusionPileEntries.claimedAt,
        claimSummonId: fusionPileEntries.claimSummonId,
        username: users.username,
        characterName: characters.name,
        series: characters.series,
      })
      .from(fusionPileEntries)
      .leftJoin(users, eq(users.id, fusionPileEntries.claimedByUserId))
      .leftJoin(characters, eq(characters.id, fusionPileEntries.characterId))
      .where(and(
        eq(fusionPileEntries.status, "claimed"),
        gte(fusionPileEntries.claimedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      ))
      .orderBy(desc(fusionPileEntries.claimedAt))
      .limit(10);

    return NextResponse.json({
      available: Number(totals?.available ?? 0),
      claimed24h: Number(totals?.claimed24h ?? 0),
      total: Number(totals?.total ?? 0),
      recent,
    });
  } catch (err) {
    return NextResponse.json(
      {
        available: 0,
        claimed24h: 0,
        total: 0,
        recent: [],
        error: err instanceof Error ? err.message : "Failed to load fusion pile stats",
      },
      { status: 500 }
    );
  }
});
