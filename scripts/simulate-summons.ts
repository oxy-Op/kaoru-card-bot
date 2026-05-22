import "dotenv/config";
import { db } from "../src/db/index.js";
import { cards, characterEditions, users } from "../src/db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";
import { redis } from "../src/cache/index.js";
import { performSummon, ensureUser } from "../src/services/summon.service.js";

type CharHit = {
  characterId: number;
  name: string;
  series: string;
  hits: number;
};

const RUNS = Math.max(1, parseInt(process.argv[2] ?? "1000", 10));
const TOP_N = Math.max(5, parseInt(process.argv[3] ?? "20", 10));

const SIM_USER_ID = `999999999${Date.now()}`;
const SIM_USERNAME = "summon-sim";
const SIM_GUILD_ID = "SIM_GUILD";

async function main() {
  const createdCodes: string[] = [];
  const touchedSummonIds: string[] = [];
  const editionIncrements = new Map<number, number>();
  const charHits = new Map<number, CharHit>();

  let mysteryTokenSummons = 0;
  let totalCardSpawns = 0;

  let pityResetCount = 0;
  let maxObservedPityStreak = 0;
  let prevStreak = 0;

  let simDbUserId: number | null = null;

  try {
    simDbUserId = await ensureUser(SIM_USER_ID, SIM_USERNAME);

    for (let i = 0; i < RUNS; i++) {
      const result = await performSummon({
        discordUserId: SIM_USER_ID,
        username: SIM_USERNAME,
        guildDiscordId: SIM_GUILD_ID,
        skipCooldown: true,
      });

      touchedSummonIds.push(result.summonId);
      if (result.mysteryIsFusionToken) mysteryTokenSummons++;

      for (const card of result.cards) {
        if (card.code === "__FUSION_TOKEN__") continue;
        totalCardSpawns++;
        createdCodes.push(card.code);

        const current = editionIncrements.get(card.editionId) ?? 0;
        editionIncrements.set(card.editionId, current + 1);

        const prev = charHits.get(card.characterId);
        if (prev) {
          prev.hits += 1;
        } else {
          charHits.set(card.characterId, {
            characterId: card.characterId,
            name: card.character.name,
            series: card.character.series,
            hits: 1,
          });
        }
      }

      const [u] = await db
        .select({ lowPrintPityStreak: users.lowPrintPityStreak })
        .from(users)
        .where(eq(users.id, simDbUserId))
        .limit(1);

      const streak = u?.lowPrintPityStreak ?? 0;
      if (streak === 0 && prevStreak > 0) pityResetCount++;
      if (streak > maxObservedPityStreak) maxObservedPityStreak = streak;
      prevStreak = streak;
    }

    const [finalUser] = await db
      .select({ lowPrintPityStreak: users.lowPrintPityStreak })
      .from(users)
      .where(eq(users.id, simDbUserId))
      .limit(1);

    const topChars = [...charHits.values()]
      .sort((a, b) => b.hits - a.hits)
      .slice(0, TOP_N)
      .map((row, idx) => ({
        rank: idx + 1,
        characterId: row.characterId,
        name: row.name,
        series: row.series,
        hits: row.hits,
        pctOfCards: Number(((row.hits / Math.max(1, totalCardSpawns)) * 100).toFixed(3)),
      }));

    const summary = {
      runs: RUNS,
      totalCardSpawns,
      mysteryTokenSummons,
      mysteryTokenRatePct: Number(((mysteryTokenSummons / RUNS) * 100).toFixed(3)),
      uniqueCharactersHit: charHits.size,
      pity: {
        resetsObserved: pityResetCount,
        maxObservedStreak: maxObservedPityStreak,
        finalStreak: finalUser?.lowPrintPityStreak ?? null,
      },
      topCharacters: topChars,
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (createdCodes.length > 0) {
      const chunk = 500;
      for (let i = 0; i < createdCodes.length; i += chunk) {
        const slice = createdCodes.slice(i, i + chunk);
        await db.delete(cards).where(inArray(cards.code, slice));
      }
    }

    for (const [editionId, increment] of editionIncrements.entries()) {
      await db
        .update(characterEditions)
        .set({
          currentPrints: sql`GREATEST(${characterEditions.currentPrints} - ${increment}, 0)`,
        })
        .where(eq(characterEditions.id, editionId));
    }

    if (simDbUserId !== null) {
      await db.delete(users).where(eq(users.id, simDbUserId));
    }

    if (touchedSummonIds.length > 0) {
      const keys = touchedSummonIds.map((id) => `summon:${id}`);
      await redis.del(...keys);
    }

    await redis.del(`cd:summon:${SIM_USER_ID}`);
    await redis.del(`cd:grab:${SIM_USER_ID}`);
    await redis.del(`ab:cmdvel:${SIM_USER_ID}`);
    await redis.del(`ab:flags:${SIM_USER_ID}`);
    await redis.del(`ab:flaglog:${SIM_USER_ID}`);
  }
}

main()
  .catch((err) => {
    console.error("[simulate-summons] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => {});
  });
