import "dotenv/config";
import { ensureUser, selectCharacters } from "../src/services/summon.service.js";
import { db } from "../src/db/index.js";
import { users } from "../src/db/schema.js";
import { redis } from "../src/cache/index.js";
import { eq } from "drizzle-orm";

const RUNS = Math.max(1, parseInt(process.argv[2] ?? "1500", 10));
const TOP_N = Math.max(10, parseInt(process.argv[3] ?? "50", 10));
const WATCH = (process.argv[4] ?? "marin").toLowerCase();

const SIM_USER_ID = `999999998${Date.now()}`;
const SIM_USERNAME = "selection-sim";

async function main() {
  const userId = await ensureUser(SIM_USER_ID, SIM_USERNAME);
  const charCounts = new Map<string, { id: number; name: string; series: string; hits: number }>();
  let watchHits = 0;

  try {
    for (let i = 0; i < RUNS; i++) {
      const { selected } = await selectCharacters(userId, 3, null);
      for (const row of selected) {
        const key = `${row.characterId}:${row.charName}:${row.charSeries}`;
        const prev = charCounts.get(key);
        if (prev) {
          prev.hits += 1;
        } else {
          charCounts.set(key, {
            id: row.characterId,
            name: row.charName,
            series: row.charSeries,
            hits: 1,
          });
        }

        const combined = `${row.charName} ${row.charSeries}`.toLowerCase();
        if (combined.includes(WATCH)) watchHits += 1;
      }
    }

    const totalSelections = RUNS * 3;
    const top = [...charCounts.values()]
      .sort((a, b) => b.hits - a.hits)
      .slice(0, TOP_N)
      .map((x, idx) => ({
        rank: idx + 1,
        characterId: x.id,
        name: x.name,
        series: x.series,
        hits: x.hits,
        pct: Number(((x.hits / totalSelections) * 100).toFixed(4)),
      }));

    console.log(JSON.stringify({
      runs: RUNS,
      totalSelections,
      uniqueCharacters: charCounts.size,
      watch: WATCH,
      watchHits,
      watchPct: Number(((watchHits / totalSelections) * 100).toFixed(4)),
      top,
    }, null, 2));
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
}

main()
  .catch((err) => {
    console.error("[simulate-selection] Failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await redis.quit().catch(() => {});
  });
