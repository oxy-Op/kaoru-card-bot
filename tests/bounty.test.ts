import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanup,
  closeDb,
  getCardOwner,
  getUserGold,
  seedCard,
  seedCharacter,
  seedGuild,
  seedUser,
  setUserGold,
  testDb,
} from "./setup.js";
import { bounties, users } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { cancelBounty, claimBounty, listActiveBounties, postBounty } from "../src/services/bounty.service.js";

const REQUESTER_DISCORD = "test_bounty_requester_999";
const CLAIMER_DISCORD = "test_bounty_claimer_999";

let requesterId: number;
let claimerId: number;
let charId: number;
let editionId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  requesterId = await seedUser(REQUESTER_DISCORD, "bountyRequester");
  claimerId = await seedUser(CLAIMER_DISCORD, "bountyClaimer");
  const char = await seedCharacter({
    name: "BountyTarget",
    series: "BountySeries",
    popularity: 700,
  });
  charId = char.characterId;
  editionId = char.editionId;
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

describe("bounty service", () => {
  it("posts bounty with escrow and appears on board", async () => {
    await setUserGold(requesterId, 5000);

    const posted = await postBounty(REQUESTER_DISCORD, "bountyRequester", "BountyTarget", 1500);
    expect(posted.success).toBe(true);
    if (!posted.success) return;

    const requesterGold = await getUserGold(requesterId);
    expect(requesterGold).toBe(3500);

    const board = await listActiveBounties(20);
    expect(board.some((b) => b.id === posted.bountyId)).toBe(true);
  });

  it("claims bounty by card transfer and pays claimer", async () => {
    await setUserGold(requesterId, 3000);
    await setUserGold(claimerId, 0);
    const posted = await postBounty(REQUESTER_DISCORD, "bountyRequester", "BountyTarget", 1200);
    expect(posted.success).toBe(true);
    if (!posted.success) return;

    const { code } = await seedCard({
      characterId: charId,
      editionId,
      ownerId: claimerId,
      quality: "good",
    });

    const claim = await claimBounty(CLAIMER_DISCORD, "bountyClaimer", posted.bountyId, code);
    expect(claim.success).toBe(true);
    if (!claim.success) return;

    expect(await getCardOwner(code)).toBe(requesterId);
    expect(await getUserGold(claimerId)).toBe(1200);

    const [row] = await testDb
      .select({ status: bounties.status })
      .from(bounties)
      .where(eq(bounties.id, posted.bountyId))
      .limit(1);
    expect(row.status).toBe("fulfilled");
  });

  it("cancels active bounty and refunds escrow", async () => {
    await setUserGold(requesterId, 2000);
    const posted = await postBounty(REQUESTER_DISCORD, "bountyRequester", "BountyTarget", 700);
    expect(posted.success).toBe(true);
    if (!posted.success) return;

    const beforeCancel = await getUserGold(requesterId);
    expect(beforeCancel).toBe(1300);

    const cancelled = await cancelBounty(REQUESTER_DISCORD, "bountyRequester", posted.bountyId);
    expect(cancelled.success).toBe(true);
    if (!cancelled.success) return;
    expect(cancelled.refunded).toBe(700);
    expect(await getUserGold(requesterId)).toBe(2000);

    const [row] = await testDb
      .select({ status: bounties.status })
      .from(bounties)
      .where(eq(bounties.id, posted.bountyId))
      .limit(1);
    expect(row.status).toBe("cancelled");
  });

  it("stores wish fields on users table for compile coverage", async () => {
    const [u] = await testDb
      .select({
        wishCharacterId: users.wishCharacterId,
        wishSummonsRemaining: users.wishSummonsRemaining,
      })
      .from(users)
      .where(eq(users.id, requesterId))
      .limit(1);
    expect(u.wishSummonsRemaining).toBeGreaterThanOrEqual(0);
  });
});
