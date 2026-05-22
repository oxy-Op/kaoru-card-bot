import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
import { auctions } from "../src/db/schema.js";
import { bidAuction, cancelAuction, createAuction, settleAuction } from "../src/services/auction.service.js";

const SELLER_DISCORD = "test_auction_seller_999";
const BIDDER1_DISCORD = "test_auction_bidder1_999";
const BIDDER2_DISCORD = "test_auction_bidder2_999";

let sellerId: number;
let bidder1Id: number;
let bidder2Id: number;
let charId: number;
let editionId: number;

beforeAll(async () => {
  await seedGuild("test_guild");
  sellerId = await seedUser(SELLER_DISCORD, "auctionSeller");
  bidder1Id = await seedUser(BIDDER1_DISCORD, "auctionBidder1");
  bidder2Id = await seedUser(BIDDER2_DISCORD, "auctionBidder2");
  const char = await seedCharacter({
    name: "AuctionTarget",
    series: "AuctionSeries",
    popularity: 900,
  });
  charId = char.characterId;
  editionId = char.editionId;
}, 15_000);

afterAll(async () => {
  await cleanup();
  await closeDb();
}, 30_000);

describe("auction service", () => {
  it("creates auction and locks seller card in escrow", async () => {
    const { code } = await seedCard({
      characterId: charId,
      editionId,
      ownerId: sellerId,
      quality: "excellent",
    });

    const created = await createAuction(SELLER_DISCORD, "auctionSeller", code, 500, 30);
    expect(created.success).toBe(true);
    if (!created.success) return;

    expect(await getCardOwner(code)).toBeNull();
  });

  it("supports bidding with anti-snipe extension and refund on outbid", async () => {
    await setUserGold(bidder1Id, 5000);
    await setUserGold(bidder2Id, 5000);

    const { code } = await seedCard({
      characterId: charId,
      editionId,
      ownerId: sellerId,
      quality: "good",
    });
    const created = await createAuction(SELLER_DISCORD, "auctionSeller", code, 1000, 1);
    expect(created.success).toBe(true);
    if (!created.success) return;

    const firstBid = await bidAuction(BIDDER1_DISCORD, "auctionBidder1", created.auctionId, 1200);
    expect(firstBid.success).toBe(true);
    if (!firstBid.success) return;
    expect(firstBid.antiSnipeExtended).toBe(true);
    expect(await getUserGold(bidder1Id)).toBe(3800);

    const secondBid = await bidAuction(BIDDER2_DISCORD, "auctionBidder2", created.auctionId, 1500);
    expect(secondBid.success).toBe(true);
    if (!secondBid.success) return;
    expect(await getUserGold(bidder1Id)).toBe(5000);
    expect(await getUserGold(bidder2Id)).toBe(3500);
  });

  it("settles ended auction, pays seller, and transfers card to winner", async () => {
    await setUserGold(sellerId, 0);
    await setUserGold(bidder1Id, 4000);

    const { code } = await seedCard({
      characterId: charId,
      editionId,
      ownerId: sellerId,
      quality: "pristine",
    });
    const created = await createAuction(SELLER_DISCORD, "auctionSeller", code, 900, 1);
    expect(created.success).toBe(true);
    if (!created.success) return;

    const bid = await bidAuction(BIDDER1_DISCORD, "auctionBidder1", created.auctionId, 1400);
    expect(bid.success).toBe(true);

    await testDb
      .update(auctions)
      .set({ endsAt: new Date(Date.now() - 1_000) })
      .where(eq(auctions.id, created.auctionId));

    const settled = await settleAuction(created.auctionId);
    expect(settled.success).toBe(true);
    if (!settled.success) return;
    expect(settled.status).toBe("settled");
    expect(settled.finalBid).toBe(1400);
    expect(await getCardOwner(code)).toBe(bidder1Id);
    expect(await getUserGold(sellerId)).toBe(1400);
  });

  it("allows seller cancel before first bid and returns card", async () => {
    const { code } = await seedCard({
      characterId: charId,
      editionId,
      ownerId: sellerId,
      quality: "poor",
    });
    const created = await createAuction(SELLER_DISCORD, "auctionSeller", code, 300, 20);
    expect(created.success).toBe(true);
    if (!created.success) return;

    const cancelled = await cancelAuction(SELLER_DISCORD, "auctionSeller", created.auctionId);
    expect(cancelled.success).toBe(true);
    expect(await getCardOwner(code)).toBe(sellerId);
  });
});
