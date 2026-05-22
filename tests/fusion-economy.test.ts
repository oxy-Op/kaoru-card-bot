import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testDb,
  seedCharacter,
  seedUser,
  seedGuild,
  seedCard,
  cleanup,
  closeDb,
} from "./setup.js";
import { users, fusionPileEntries } from "../src/db/schema.js";
import { eq, sql } from "drizzle-orm";
import { fuse } from "../src/services/fusion.service.js";

const DISCORD_ID = "test_fusion_econ_user_999";

let userId: number;
let charId: number;
let editionId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  userId = await seedUser(DISCORD_ID, "fusionEco");
  const char = await seedCharacter({ name: "FusionEcoChar", series: "FusionEcoSeries" });
  charId = char.characterId;
  editionId = char.editionId;
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

describe("fusion economy yields", () => {
  it("rewards scale with fused card quality", async () => {
    await testDb.update(users).set({ gold: 0, cinders: 0 }).where(eq(users.id, userId));

    await seedCard({
      characterId: charId,
      editionId,
      ownerId: userId,
      quality: "damaged",
      inFusionPile: true,
      code: "FEDMG1",
    });
    await seedCard({
      characterId: charId,
      editionId,
      ownerId: userId,
      quality: "good",
      inFusionPile: true,
      code: "FEGOOD1",
    });
    await seedCard({
      characterId: charId,
      editionId,
      ownerId: userId,
      quality: "pristine",
      inFusionPile: true,
      code: "FEPRIS1",
    });

    const result = await fuse(DISCORD_ID, "fusionEco");
    expect(result.success).toBe(true);
    if (!result.success) return;

    // damaged(4,2) + good(12,5) + pristine(35,12)
    expect(result.goldEarned).toBe(51);
    expect(result.cindersEarned).toBe(19);
    expect(result.pileAdded).toBe(1);

    const [u] = await testDb
      .select({ gold: users.gold, cinders: users.cinders })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    expect(u.gold).toBe(51);
    expect(u.cinders).toBe(19);

    const [pile] = await testDb
      .select({ count: sql<number>`count(*)` })
      .from(fusionPileEntries)
      .where(eq(fusionPileEntries.sourceUserId, userId));
    expect(Number(pile.count)).toBeGreaterThanOrEqual(1);
  });
});
