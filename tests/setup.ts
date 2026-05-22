/**
 * Test setup: connects to the real local DB, provides helpers
 * to seed test characters/editions and clean up after tests.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql, and, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.js";

const queryClient = postgres(process.env.DATABASE_URL!, {
  max: 5,
  idle_timeout: 10,
});

export const testDb = drizzle(queryClient, { schema });

// Track all IDs created during tests for cleanup
const createdCharacterIds: number[] = [];
const createdUserIds: number[] = [];
const createdGuildIds: number[] = [];
const createdCardIds: number[] = [];

/**
 * Seed a test character with an edition. Returns the character ID and edition ID.
 */
export async function seedCharacter(opts: {
  name: string;
  series: string;
  seriesYear?: number | null;
  popularity?: number;
  rarityWeight?: number;
  role?: string;
  maxPrints?: number | null;
}) {
  const [char] = await testDb
    .insert(schema.characters)
    .values({
      name: opts.name,
      series: opts.series,
      seriesYear: opts.seriesYear ?? null,
      popularity: opts.popularity ?? 100,
      source: "anilist",
      sourceId: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      role: opts.role ?? "SUPPORTING",
    })
    .returning({ id: schema.characters.id });

  createdCharacterIds.push(char.id);

  const [edition] = await testDb
    .insert(schema.characterEditions)
    .values({
      characterId: char.id,
      editionNumber: 1,
      imagePath: `test/char_${char.id}/ed1.png`,
      generationMethod: "original",
      rarityWeight: opts.rarityWeight ?? 1.0,
      maxPrints: opts.maxPrints ?? null,
    })
    .returning({ id: schema.characterEditions.id });

  return { characterId: char.id, editionId: edition.id };
}

/**
 * Seed a test user. Returns the internal user ID.
 */
export async function seedUser(discordId: string, username: string = "test_user") {
  const [user] = await testDb
    .insert(schema.users)
    .values({ discordId, username })
    .onConflictDoNothing()
    .returning({ id: schema.users.id });

  if (user) {
    createdUserIds.push(user.id);
    return user.id;
  }

  // Already existed
  const [existing] = await testDb
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return existing.id;
}

/**
 * Seed a test guild.
 */
export async function seedGuild(discordId: string) {
  await testDb
    .insert(schema.guilds)
    .values({ discordId, prefix: "t!" })
    .onConflictDoNothing();
  createdGuildIds.push(0); // tracked by discordId in cleanup
}

/**
 * Add a character to a user's summon list.
 */
export async function addToSummonList(userId: number, characterId: number, slot: number = 1) {
  await testDb
    .insert(schema.summonList)
    .values({ userId, characterId, slotNumber: slot })
    .onConflictDoNothing();
}

/**
 * Seed a test card owned by a user. Returns the card code.
 */
export async function seedCard(opts: {
  characterId: number;
  editionId: number;
  ownerId: number;
  summonerId?: number;
  code?: string;
  printNumber?: number;
  quality?: "damaged" | "poor" | "good" | "excellent" | "pristine";
  guildId?: string;
  inFusionPile?: boolean;
}) {
  const code = opts.code ?? `T${Math.random().toString(36).slice(2, 7)}`;
  const [card] = await testDb
    .insert(schema.cards)
    .values({
      code,
      characterId: opts.characterId,
      editionId: opts.editionId,
      printNumber: opts.printNumber ?? 1,
      quality: opts.quality ?? "good",
      originalQuality: opts.quality ?? "good",
      ownerId: opts.ownerId,
      summonerId: opts.summonerId ?? opts.ownerId,
      guildId: opts.guildId ?? "test_guild",
    })
    .returning({ id: schema.cards.id, code: schema.cards.code });

  if (opts.inFusionPile) {
    await testDb
      .update(schema.cards)
      .set({ inFusionPile: true })
      .where(eq(schema.cards.id, card.id));
  }

  createdCardIds.push(card.id);
  return { cardId: card.id, code: card.code };
}

/**
 * Set a user's gold balance directly.
 */
export async function setUserGold(userId: number, gold: number) {
  await testDb
    .update(schema.users)
    .set({ gold })
    .where(eq(schema.users.id, userId));
}

/**
 * Get a user's gold balance.
 */
export async function getUserGold(userId: number): Promise<number> {
  const [user] = await testDb
    .select({ gold: schema.users.gold })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.gold ?? 0;
}

/**
 * Get a card's owner ID.
 */
export async function getCardOwner(code: string): Promise<number | null> {
  const [card] = await testDb
    .select({ ownerId: schema.cards.ownerId })
    .from(schema.cards)
    .where(eq(schema.cards.code, code))
    .limit(1);
  return card?.ownerId ?? null;
}

/**
 * Clean up all test data created during this session.
 * Order matters due to FK constraints: cards → summon_list → editions → characters → users
 */
export async function cleanup() {
  // 0. Delete trades and mail for test users (tables may not exist yet)
  if (createdUserIds.length > 0) {
    try {
      await testDb
        .delete(schema.auditLog)
        .where(inArray(schema.auditLog.userId, createdUserIds));
    } catch {}
    try {
      await testDb
        .delete(schema.trades)
        .where(inArray(schema.trades.initiatorId, createdUserIds));
      await testDb
        .delete(schema.trades)
        .where(inArray(schema.trades.receiverId, createdUserIds));
    } catch {}
    try {
      await testDb
        .delete(schema.mail)
        .where(inArray(schema.mail.recipientId, createdUserIds));
    } catch {}
    try {
      await testDb
        .delete(schema.bounties)
        .where(inArray(schema.bounties.requesterId, createdUserIds));
      await testDb
        .delete(schema.bounties)
        .where(inArray(schema.bounties.fulfilledByUserId, createdUserIds));
    } catch {}
    try {
      await testDb
        .delete(schema.auctions)
        .where(inArray(schema.auctions.sellerId, createdUserIds));
      await testDb
        .delete(schema.auctions)
        .where(inArray(schema.auctions.currentBidderId, createdUserIds));
    } catch {}
    try {
      await testDb
        .delete(schema.petalTransactions)
        .where(inArray(schema.petalTransactions.userId, createdUserIds));
    } catch {}
    try {
      await testDb
        .delete(schema.fusionPileEntries)
        .where(inArray(schema.fusionPileEntries.sourceUserId, createdUserIds));
      await testDb
        .delete(schema.fusionPileEntries)
        .where(inArray(schema.fusionPileEntries.claimedByUserId, createdUserIds));
    } catch {}
  }

  // 1. Delete cards by tracked IDs, characters, or users
  if (createdCardIds.length > 0) {
    try {
      await testDb
        .delete(schema.fusionPileEntries)
        .where(inArray(schema.fusionPileEntries.sourceCardId, createdCardIds));
      await testDb
        .delete(schema.fusionPileEntries)
        .where(inArray(schema.fusionPileEntries.claimedCardId, createdCardIds));
    } catch {}
    await testDb
      .delete(schema.cards)
      .where(inArray(schema.cards.id, createdCardIds));
    try {
      await testDb
        .delete(schema.auctions)
        .where(inArray(schema.auctions.cardId, createdCardIds));
    } catch {}
  }
  if (createdCharacterIds.length > 0) {
    try {
      await testDb
        .delete(schema.fusionPileEntries)
        .where(inArray(schema.fusionPileEntries.characterId, createdCharacterIds));
    } catch {}
    await testDb
      .delete(schema.cards)
      .where(inArray(schema.cards.characterId, createdCharacterIds));
  }
  if (createdUserIds.length > 0) {
    await testDb
      .delete(schema.cards)
      .where(inArray(schema.cards.summonerId, createdUserIds));
  }

  // 2. Delete summon list entries for test users AND test characters
  for (const uid of createdUserIds) {
    await testDb
      .delete(schema.summonList)
      .where(eq(schema.summonList.userId, uid));
  }
  if (createdCharacterIds.length > 0) {
    await testDb
      .delete(schema.summonList)
      .where(inArray(schema.summonList.characterId, createdCharacterIds));
  }

  // 3. Delete like list entries for test characters
  if (createdCharacterIds.length > 0) {
    await testDb
      .delete(schema.likeList)
      .where(inArray(schema.likeList.characterId, createdCharacterIds));
  }

  // 4. Delete editions for test characters
  if (createdCharacterIds.length > 0) {
    await testDb
      .delete(schema.characterEditions)
      .where(inArray(schema.characterEditions.characterId, createdCharacterIds));
  }

  // 5. Delete test characters
  if (createdCharacterIds.length > 0) {
    await testDb
      .delete(schema.characters)
      .where(inArray(schema.characters.id, createdCharacterIds));
  }

  // 6. Delete test users (now safe — no FK refs left)
  if (createdUserIds.length > 0) {
    await testDb
      .delete(schema.users)
      .where(inArray(schema.users.id, createdUserIds));
  }

  // Clear arrays
  createdCharacterIds.length = 0;
  createdUserIds.length = 0;
  createdGuildIds.length = 0;
  createdCardIds.length = 0;
}

/**
 * Close the DB connection.
 */
export async function closeDb() {
  await queryClient.end();
}
