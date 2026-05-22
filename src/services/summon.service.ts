import { db } from "../db/index.js";
import {
  characters,
  characterEditions,
  cards,
  users,
  guilds,
  summonList,
  likeList,
} from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { newCardCode, newSummonId, rollQuality, rollPrintNumber, weightedRandom } from "../utils/codes.js";
import { getCooldown, setCooldown } from "../cache/cooldowns.js";
import { redis } from "../cache/index.js";
import { isDevUser } from "../config.js";
import { getCommunityWeight } from "./community-weight.service.js";
import { attachClaimedFusionCard, claimFusionPileEntry } from "./fusion-pile.service.js";

export interface SummonedCard {
  code: string;
  frameStyle: "silver" | "gold" | "crimson" | "sapphire";
  characterId: number;
  editionId: number;
  printNumber: number;
  quality: string;
  character: {
    name: string;
    nameJp: string | null;
    series: string;
    imageUrl: string | null;
  };
  edition: {
    editionNumber: number;
    imagePath: string;
    generationMethod: string;
  };
}

export interface SummonResult {
  summonId: string;
  cards: [SummonedCard, SummonedCard, SummonedCard]; // 3 cards: slot 1, 2, mystery
  mysteryIsFusionToken: boolean;
  fusionTokenAmount: number;
  isActivitySpawn: boolean;
}

/**
 * Ensure a user exists in the database, creating them if needed.
 */
export async function ensureUser(
  discordId: string,
  username: string
): Promise<number> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({ discordId, username })
    .returning({ id: users.id });
  return created.id;
}

/**
 * Ensure a guild config exists, creating defaults if needed.
 */
export async function ensureGuild(discordId: string) {
  const [existing] = await db
    .select()
    .from(guilds)
    .where(eq(guilds.discordId, discordId))
    .limit(1);
  if (existing) return existing;

  const { config: appConfig } = await import("../config.js");
  const [created] = await db
    .insert(guilds)
    .values({ discordId, prefix: appConfig.DEFAULT_PREFIX })
    .returning();
  return created;
}

/**
 * Era weighting for summons. Keeps day-to-day summons feeling modern
 * WITHOUT penalising popular classic series (DBZ, Doraemon, Naruto, etc.).
 *
 * Popular characters (500+ favourites) are never penalised for age —
 * only obscure old characters get suppressed.
 */
export function eraMultiplier(year: number | null, popularity: number = 0): number {
  // Popular characters: classics stay at baseline, recent gets a small boost
  if (popularity >= 500) {
    if (!year) return 1.0;
    if (year >= 2015) return 1.5; // recent popular — slight boost
    return 1.0;                    // old popular — normal rate
  }

  // Obscure characters: heavily boost recent so summons feel modern,
  // suppress old obscure filler that nobody recognises
  if (!year) return 1.0;
  if (year >= 2020) return 4.0;  // current — lots of modern art
  if (year >= 2015) return 3.0;  // recent
  if (year >= 2005) return 2.0;  // modern
  if (year >= 1995) return 1.0;  // classic obscure — baseline
  return 0.3;                     // retro obscure — very rare
}

/**
 * Select N random characters + editions for summoning.
 * Applies summon list bonus: characters on the user's summon list get 2x weight.
 */
interface ActiveWish {
  characterId: number;
  summonsRemaining: number;
}

interface LowPrintPityProfile {
  streak: number;
  extraRolls: number;
  forceOneLowPrint: boolean;
}

interface SummonPoolRow {
  editionId: number;
  characterId: number;
  editionNumber: number;
  imagePath: string;
  generationMethod: string;
  rarityWeight: number;
  charName: string;
  charNameJp: string | null;
  charSeries: string;
  charImageUrl: string | null;
  charPopularity: number | null;
  localLikeCount: number;
  seriesYear: number | null;
  maxPrints: number | null;
  baseWeight: number;
}

export interface CharacterSelectionResult {
  selected: SummonPoolRow[];
  wishTargetAvailable: boolean;
}

export const WISH_SUMMON_WINDOW = 50;
const WISH_BOOST_MULTIPLIER = 8;
const LOW_PRINT_PITY_SOFT_START = 80;
const LOW_PRINT_PITY_HARD_TRIGGER = 100;
const SUMMON_HEAD_POOL_SIZE = 1400;
const SUMMON_TAIL_POOL_SIZE = 1800;
const SUMMON_POOL_CACHE_MS = 60_000;

let summonBasePoolCache:
  | {
    expiresAt: number;
    rows: SummonPoolRow[];
  }
  | null = null;

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function frameStyleForCardCode(code: string): "silver" | "gold" | "crimson" | "sapphire" {
  const styles: Array<"silver" | "gold" | "crimson" | "sapphire"> = ["silver", "gold", "crimson", "sapphire"];
  return styles[hashString(code) % styles.length];
}

async function getActiveWish(userId: number): Promise<ActiveWish | null> {
  const [u] = await db
    .select({
      wishCharacterId: users.wishCharacterId,
      wishSummonsRemaining: users.wishSummonsRemaining,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!u?.wishCharacterId || u.wishSummonsRemaining <= 0) return null;
  return { characterId: u.wishCharacterId, summonsRemaining: u.wishSummonsRemaining };
}

async function clearActiveWish(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ wishCharacterId: null, wishSummonsRemaining: 0 })
    .where(eq(users.id, userId));
}

async function updateWishAfterSummon(
  userId: number,
  wish: ActiveWish | null,
  selection: CharacterSelectionResult
): Promise<void> {
  if (!wish) return;
  if (!selection.wishTargetAvailable) {
    await clearActiveWish(userId);
    return;
  }

  const targetHit = selection.selected.some((row) => row.characterId === wish.characterId);
  const nextRemaining = Math.max(wish.summonsRemaining - 1, 0);

  if (targetHit || nextRemaining <= 0) {
    await clearActiveWish(userId);
    return;
  }

  await db
    .update(users)
    .set({ wishSummonsRemaining: nextRemaining })
    .where(eq(users.id, userId));
}

async function buildSummonBasePool(): Promise<SummonPoolRow[]> {
  const poolWhere = sql`${characterEditions.rarityWeight} > 0 AND (${characterEditions.maxPrints} IS NULL OR ${characterEditions.currentPrints} < ${characterEditions.maxPrints})`;
  const selectShape = {
    editionId: characterEditions.id,
    characterId: characterEditions.characterId,
    editionNumber: characterEditions.editionNumber,
    imagePath: characterEditions.imagePath,
    generationMethod: characterEditions.generationMethod,
    rarityWeight: characterEditions.rarityWeight,
    charName: characters.name,
    charNameJp: characters.nameJp,
    charSeries: characters.series,
    charImageUrl: characters.imageUrl,
    charPopularity: characters.popularity,
    localLikeCount: sql<number>`COALESCE((SELECT count(*) FROM ${likeList} WHERE ${likeList.characterId} = ${characterEditions.characterId}), 0)`,
    seriesYear: characters.seriesYear,
    maxPrints: characterEditions.maxPrints,
  };

  // Head pool: prioritize high-signal characters so popular units repeat naturally.
  const headPool: SummonPoolRow[] = await db
    .select(selectShape)
    .from(characterEditions)
    .innerJoin(characters, eq(characterEditions.characterId, characters.id))
    .where(poolWhere)
    .orderBy(
      sql`COALESCE((SELECT count(*) FROM ${likeList} WHERE ${likeList.characterId} = ${characterEditions.characterId}), 0) DESC`,
      desc(characters.popularity),
      desc(characterEditions.rarityWeight)
    )
    .limit(SUMMON_HEAD_POOL_SIZE);

  // Tail pool: keep discovery/variety alive so summon does not feel static.
  const tailPool: SummonPoolRow[] = await db
    .select(selectShape)
    .from(characterEditions)
    .innerJoin(characters, eq(characterEditions.characterId, characters.id))
    .where(poolWhere)
    .orderBy(sql`RANDOM()`)
    .limit(SUMMON_TAIL_POOL_SIZE);

  const poolMap = new Map<number, SummonPoolRow>();
  for (const row of headPool) poolMap.set(row.editionId, row);
  for (const row of tailPool) if (!poolMap.has(row.editionId)) poolMap.set(row.editionId, row);

  const baseRows = [...poolMap.values()];
  const withWeights: SummonPoolRow[] = await Promise.all(
    baseRows.map(async (row) => {
      const pop = Math.max(row.charPopularity ?? 0, 0);
      const popularityScore = 1 + Math.min(0.45, Math.log10(pop + 1) * 0.08);
      const eliteBoost =
        pop >= 10_000 ? 1.2
          : pop >= 5_000 ? 1.12
            : pop >= 2_000 ? 1.06
              : 1.0;
      const localLikeBoost = 1 + Math.min(0.28, Math.log10((row.localLikeCount ?? 0) + 1) * 0.12);
      // DB rarityWeight skews high on many low-demand rows; treat it as a soft modifier only.
      const rarityAdj = 1 + (1 - Math.min(Math.max(row.rarityWeight, 0), 1)) * 0.45;
      const community = await getCommunityWeight(row.charSeries, row.charName);
      const era = eraMultiplier(row.seriesYear, row.charPopularity ?? 0);
      const baseWeight = popularityScore * eliteBoost * localLikeBoost * rarityAdj * community * era;
      return { ...row, baseWeight };
    })
  );

  return withWeights;
}

async function getSummonBasePool(): Promise<SummonPoolRow[]> {
  const now = Date.now();
  if (summonBasePoolCache && summonBasePoolCache.expiresAt > now) {
    return summonBasePoolCache.rows;
  }
  const rows = await buildSummonBasePool();
  summonBasePoolCache = {
    rows,
    expiresAt: now + SUMMON_POOL_CACHE_MS,
  };
  return rows;
}

export async function selectCharacters(
  userId: number,
  count: number,
  wish: ActiveWish | null = null
): Promise<CharacterSelectionResult> {
  const userSummonList = await db.query.summonList.findMany({
    where: eq(summonList.userId, userId),
  });
  const summonListCharIds = new Set(userSummonList.map((s) => s.characterId));

  const pool = [...await getSummonBasePool()];

  let wishTargetAvailable = false;
  if (wish) {
    const [wishRow] = await db
      .select({
        editionId: characterEditions.id,
        characterId: characterEditions.characterId,
        editionNumber: characterEditions.editionNumber,
        imagePath: characterEditions.imagePath,
        generationMethod: characterEditions.generationMethod,
        rarityWeight: characterEditions.rarityWeight,
        charName: characters.name,
        charNameJp: characters.nameJp,
        charSeries: characters.series,
        charImageUrl: characters.imageUrl,
        charPopularity: characters.popularity,
        localLikeCount: sql<number>`COALESCE((SELECT count(*) FROM ${likeList} WHERE ${likeList.characterId} = ${characterEditions.characterId}), 0)`,
        seriesYear: characters.seriesYear,
        maxPrints: characterEditions.maxPrints,
        baseWeight: sql<number>`1`,
      })
      .from(characterEditions)
      .innerJoin(characters, eq(characterEditions.characterId, characters.id))
      .where(and(
        eq(characterEditions.characterId, wish.characterId),
        sql`${characterEditions.rarityWeight} > 0`,
        sql`(${characterEditions.maxPrints} IS NULL OR ${characterEditions.currentPrints} < ${characterEditions.maxPrints})`,
      ))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (wishRow) {
      wishTargetAvailable = true;
      if (!pool.some((row) => row.characterId === wish.characterId)) {
        pool.push(wishRow);
      }
    }
  }

  if (pool.length < count) {
    throw new Error("Not enough characters available for summoning. Run the seed script first.");
  }

  const weighted = await Promise.all(
    pool.map(async (row) => ({
      ...row,
      weight:
        Math.max(row.baseWeight, 0.0001)
        * (summonListCharIds.has(row.characterId) ? 2.0 : 1.0)
        * (wish && row.characterId === wish.characterId ? WISH_BOOST_MULTIPLIER : 1.0),
    }))
  );

  // Pick N unique characters
  const selected: typeof weighted = [];

  if (wish && wishTargetAvailable && wish.summonsRemaining <= 1) {
    const targetOptions = weighted.filter((row) => row.characterId === wish.characterId);
    if (targetOptions.length > 0) {
      const forced = weightedRandom(targetOptions);
      selected.push(forced);
      for (let i = weighted.length - 1; i >= 0; i--) {
        if (weighted[i].characterId === forced.characterId) {
          weighted.splice(i, 1);
        }
      }
    }
  }

  while (selected.length < count && weighted.length > 0) {
    const pick = weightedRandom(weighted);
    selected.push(pick);
    // Remove same character from pool to avoid duplicates
    for (let i = weighted.length - 1; i >= 0; i--) {
      if (weighted[i].characterId === pick.characterId) {
        weighted.splice(i, 1);
      }
    }
  }

  return { selected, wishTargetAvailable };
}

async function getNextPrint(
  editionId: number,
  maxPrints: number | null,
  pity: LowPrintPityProfile,
  forceLowPrint: boolean
): Promise<{ printNumber: number; isLowPrint: boolean; lowPrintCutoff: number }> {
  const existing = await db
    .select({ printNumber: cards.printNumber })
    .from(cards)
    .where(eq(cards.editionId, editionId));

  const takenPrints = new Set(existing.map((r) => r.printNumber));
  const totalIssued = takenPrints.size;
  const upperBound =
    maxPrints !== null
      ? maxPrints
      : 5000;
  // Low-print pity targets the early rarity bands explicitly.
  const lowPrintCutoff = Math.max(1, Math.min(25, upperBound));

  if (forceLowPrint) {
    const availableLow: number[] = [];
    for (let n = 1; n <= lowPrintCutoff; n++) {
      if (!takenPrints.has(n)) availableLow.push(n);
    }
    if (availableLow.length > 0) {
      const pick = availableLow[Math.floor(Math.random() * availableLow.length)];
      return { printNumber: pick, isLowPrint: true, lowPrintCutoff };
    }
  }

  let best = rollPrintNumber(takenPrints, maxPrints);
  for (let i = 0; i < pity.extraRolls; i++) {
    const candidate = rollPrintNumber(takenPrints, maxPrints);
    if (candidate < best) best = candidate;
  }
  return {
    printNumber: best,
    isLowPrint: best <= lowPrintCutoff,
    lowPrintCutoff,
  };
}

function buildLowPrintPityProfile(streak: number): LowPrintPityProfile {
  if (streak >= LOW_PRINT_PITY_HARD_TRIGGER) {
    return { streak, extraRolls: 12, forceOneLowPrint: true };
  }
  if (streak < LOW_PRINT_PITY_SOFT_START) {
    return { streak, extraRolls: 0, forceOneLowPrint: false };
  }
  // Soft pity ramp: 80->99 gives 1..5 extra chances for lower prints.
  const t = (streak - LOW_PRINT_PITY_SOFT_START) / (LOW_PRINT_PITY_HARD_TRIGGER - LOW_PRINT_PITY_SOFT_START);
  const extraRolls = 1 + Math.floor(t * 4);
  return { streak, extraRolls, forceOneLowPrint: false };
}

export interface SummonOptions {
  discordUserId: string;
  username: string;
  guildDiscordId: string;
  isActivitySpawn?: boolean;
  skipCooldown?: boolean;
}

const SUMMON_EXPIRY_SEC = 60; // 1 min to claim
const FUSION_TOKEN_CHANCE = 0.05; // 5% (1 in 20)
const FUSION_TOKEN_FALLBACK_CINDERS = 50; // used when pile has no claimable entries

/**
 * Execute a summon: check cooldowns, select 3 characters, create 3 cards.
 * Returns 3 cards: slots 1 & 2 are revealed, slot 3 is the mystery card.
 * Slot 3 has a 5% chance to be a fusion token instead of a character card.
 */
export async function performSummon(
  opts: SummonOptions
): Promise<SummonResult> {
  const userId = await ensureUser(opts.discordUserId, opts.username);
  await ensureGuild(opts.guildDiscordId);

  // Check cooldown (skip for activity spawns and dev users)
  const isDev = isDevUser(opts.discordUserId);
  if (!opts.isActivitySpawn && !opts.skipCooldown && !isDev) {
    const remaining = await getCooldown(opts.discordUserId, "summon");
    if (remaining > 0) {
      throw new SummonCooldownError(remaining);
    }
  }
  if (isDev) {
    console.log(`[Dev] Cooldown bypassed for ${opts.discordUserId}`);
  }

  // Roll whether mystery slot (3rd) is a fusion token
  const mysteryIsFusionToken = Math.random() < FUSION_TOKEN_CHANCE;

  // Select characters: 3 if normal, 2 if fusion token (slot 3 won't be a card)
  const charCount = mysteryIsFusionToken ? 2 : 3;
  const activeWish = await getActiveWish(userId);
  const selection = await selectCharacters(userId, charCount, activeWish);
  await updateWishAfterSummon(userId, activeWish, selection);
  const selected = selection.selected;
  const summonId = newSummonId();
  const [u] = await db
    .select({ lowPrintPityStreak: users.lowPrintPityStreak })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const pity = buildLowPrintPityProfile(u?.lowPrintPityStreak ?? 0);

  const summonedCards: SummonedCard[] = [];
  let lowPrintHitThisSummon = false;
  let forcedLowPrintUsed = false;

  for (const sel of selected) {
    const shouldForceLowPrint = pity.forceOneLowPrint && !forcedLowPrintUsed;
    const printPick = await getNextPrint(sel.editionId, sel.maxPrints, pity, shouldForceLowPrint);
    const printNumber = printPick.printNumber;
    if (printPick.isLowPrint) {
      lowPrintHitThisSummon = true;
      if (shouldForceLowPrint) forcedLowPrintUsed = true;
    }
    const quality = rollQuality();
    const code = newCardCode();
    const frameStyle = frameStyleForCardCode(code);

    await db.insert(cards).values({
      code,
      characterId: sel.characterId,
      editionId: sel.editionId,
      printNumber,
      quality,
      originalQuality: quality,
      summonerId: userId,
      ownerId: null,
      guildId: opts.guildDiscordId,
    });

    // Increment print counter for limited editions
    await db
      .update(characterEditions)
      .set({ currentPrints: sql`${characterEditions.currentPrints} + 1` })
      .where(eq(characterEditions.id, sel.editionId));

    summonedCards.push({
      code,
      frameStyle,
      characterId: sel.characterId,
      editionId: sel.editionId,
      printNumber,
      quality,
      character: {
        name: sel.charName,
        nameJp: sel.charNameJp,
        series: sel.charSeries,
        imageUrl: sel.charImageUrl,
      },
      edition: {
        editionNumber: sel.editionNumber,
        imagePath: sel.imagePath,
        generationMethod: sel.generationMethod,
      },
    });
  }

  // If fusion token, push a placeholder for slot 3
  if (mysteryIsFusionToken) {
    summonedCards.push({
      code: "__FUSION_TOKEN__",
      frameStyle: "silver",
      characterId: 0,
      editionId: 0,
      printNumber: 0,
      quality: "pristine",
      character: { name: "Fusion Token", nameJp: null, series: "Bonus", imageUrl: null },
      edition: { editionNumber: 0, imagePath: "", generationMethod: "original" },
    });
  }

  // Increment summon stats + award XP
  await db
    .update(users)
    .set({
      totalSummons: sql`${users.totalSummons} + 1`,
      lowPrintPityStreak: lowPrintHitThisSummon
        ? 0
        : sql`${users.lowPrintPityStreak} + 1`,
    })
    .where(eq(users.id, userId));

  const { awardXp } = await import("./level.service.js");
  await awardXp(userId, "summon");

  // Set cooldown
  if (!opts.isActivitySpawn) {
    await setCooldown(opts.discordUserId, "summon");
  }

  // Store summon session in Redis for grab handling
  await redis.set(
    `summon:${summonId}`,
    JSON.stringify({
      cards: summonedCards.map((c) => c.code),
      summonerId: opts.discordUserId,
      guildId: opts.guildDiscordId,
      grabbed: [false, false, false],
      grabbedBy: [null, null, null],
      mysteryIsFusionToken,
      fusionTokenAmount: mysteryIsFusionToken ? FUSION_TOKEN_FALLBACK_CINDERS : 0,
      summonedAt: Date.now(),
    }),
    "EX",
    SUMMON_EXPIRY_SEC
  );

  return {
    summonId,
    cards: summonedCards as [SummonedCard, SummonedCard, SummonedCard],
    mysteryIsFusionToken,
    fusionTokenAmount: mysteryIsFusionToken ? FUSION_TOKEN_FALLBACK_CINDERS : 0,
    isActivitySpawn: opts.isActivitySpawn ?? false,
  };
}

export interface SummonSession {
  cards: [string, string, string]; // card codes ("__FUSION_TOKEN__" for fusion slot)
  summonerId: string;
  guildId: string;
  grabbed: [boolean, boolean, boolean];
  grabbedBy: [string | null, string | null, string | null];
  mysteryIsFusionToken: boolean;
  fusionTokenAmount: number;
  summonedAt: number; // timestamp (Date.now()) when the summon was created
}

/** Get the summon session from Redis. Returns null if expired. */
export async function getSummonSession(
  summonId: string
): Promise<SummonSession | null> {
  const raw = await redis.get(`summon:${summonId}`);
  if (!raw) return null;
  return JSON.parse(raw);
}

/** Update the summon session after a grab. */
async function updateSummonSession(
  summonId: string,
  session: SummonSession
): Promise<void> {
  const ttl = await redis.ttl(`summon:${summonId}`);
  if (ttl <= 0) return;
  await redis.set(`summon:${summonId}`, JSON.stringify(session), "EX", ttl);
}

export type GrabResult =
  | { success: true; type: "card"; cardCode: string; foughtOff?: string }
  | { success: true; type: "fusion_card"; cardCode: string; foughtOff?: string }
  | { success: true; type: "fusion_token"; amount: number; foughtOff?: string }
  | { success: false; reason: string };

/**
 * Attempt to grab a card (or fusion token) from a summon by slot (0, 1, or 2).
 */
export async function grabCard(
  summonId: string,
  slot: number,
  discordUserId: string,
  username: string
): Promise<GrabResult> {
  const session = await getSummonSession(summonId);
  if (!session) {
    return { success: false, reason: "This summon has expired!" };
  }

  if (slot < 0 || slot > 2) {
    return { success: false, reason: "Invalid slot." };
  }

  if (session.grabbed[slot]) {
    return { success: false, reason: "That card was already grabbed!" };
  }

  // Check if this user already grabbed from this summon
  if (session.grabbedBy.includes(discordUserId)) {
    return { success: false, reason: "You already grabbed a card from this summon!" };
  }

  // Anti-snipe check: only the summoner can grab during the anti-snipe window
  if (discordUserId !== session.summonerId) {
    const [guildConfig] = await db
      .select({ antiSnipeSeconds: guilds.antiSnipeSeconds })
      .from(guilds)
      .where(eq(guilds.discordId, session.guildId))
      .limit(1);
    const antiSnipeSeconds = guildConfig?.antiSnipeSeconds ?? 0;
    if (antiSnipeSeconds > 0) {
      const elapsed = Date.now() - session.summonedAt;
      if (elapsed < antiSnipeSeconds * 1000) {
        const remaining = Math.ceil((antiSnipeSeconds * 1000 - elapsed) / 1000);
        return {
          success: false,
          reason: `Anti-snipe active! The summoner has ${remaining} seconds to grab first.`,
        };
      }
    }
  }

  // Check grab cooldown (dev users bypass)
  if (!isDevUser(discordUserId)) {
    const grabCd = await getCooldown(discordUserId, "grab");
    if (grabCd > 0) {
      return { success: false, reason: `You're on grab cooldown! Ready <t:${Math.floor(Date.now() / 1000) + grabCd}:R>` };
    }
  }

  // Atomic grab lock
  const lockKey = `grab_lock:${summonId}:${slot}`;
  const locked = await redis.set(lockKey, discordUserId, "EX", 60, "NX");
  if (!locked) {
    // Track this user as "fought off" — they tried but lost
    await redis.sadd(`grab_attempts:${summonId}:${slot}`, discordUserId);
    return { success: false, reason: "Someone else grabbed that card!" };
  }

  // Per-user-per-summon lock to prevent race conditions on the grabbedBy check
  const userLock = await redis.set(`user_grab:${summonId}:${discordUserId}`, "1", "EX", 120, "NX");
  if (!userLock) return { success: false, reason: "You already grabbed a card from this summon!" };

  // Check who we fought off (people who tried before us or concurrently)
  const attempts = await redis.smembers(`grab_attempts:${summonId}:${slot}`);
  const foughtOff = attempts.find((id) => id !== discordUserId);

  const userId = await ensureUser(discordUserId, username);

  // Slot 2 (mystery) might be a fusion token
  if (slot === 2 && session.mysteryIsFusionToken) {
    const claimed = await claimFusionPileEntry(userId, summonId);
    if (claimed) {
      const [editionRow] = await db
        .select({
          id: characterEditions.id,
          characterId: characterEditions.characterId,
          editionNumber: characterEditions.editionNumber,
          imagePath: characterEditions.imagePath,
          generationMethod: characterEditions.generationMethod,
          maxPrints: characterEditions.maxPrints,
        })
        .from(characterEditions)
        .where(eq(characterEditions.id, claimed.editionId))
        .limit(1);

      if (editionRow) {
        const printPick = await getNextPrint(
          editionRow.id,
          editionRow.maxPrints,
          { streak: 0, extraRolls: 0, forceOneLowPrint: false },
          false
        );
        const quality = rollQuality();
        const code = newCardCode();

        const [created] = await db
          .insert(cards)
          .values({
            code,
            characterId: editionRow.characterId,
            editionId: editionRow.id,
            printNumber: printPick.printNumber,
            quality,
            originalQuality: quality,
            summonerId: userId,
            ownerId: userId,
            grabberId: userId,
            grabbedAt: new Date(),
            guildId: session.guildId,
          })
          .returning({ id: cards.id, code: cards.code });

        await db
          .update(characterEditions)
          .set({ currentPrints: sql`${characterEditions.currentPrints} + 1` })
          .where(eq(characterEditions.id, editionRow.id));

        await attachClaimedFusionCard(claimed.id, created.id);
        await setCooldown(discordUserId, "grab");

        session.grabbed[slot] = true;
        session.grabbedBy[slot] = discordUserId;
        await updateSummonSession(summonId, session);

        return { success: true, type: "fusion_card", cardCode: created.code, foughtOff };
      }
    }

    // Fallback when no pile entry is available or the chosen entry is invalid.
    await db
      .update(users)
      .set({ cinders: sql`${users.cinders} + ${session.fusionTokenAmount}` })
      .where(eq(users.id, userId));

    await setCooldown(discordUserId, "grab");

    session.grabbed[slot] = true;
    session.grabbedBy[slot] = discordUserId;
    await updateSummonSession(summonId, session);

    return { success: true, type: "fusion_token", amount: session.fusionTokenAmount, foughtOff };
  }

  // Normal card grab
  const cardCode = session.cards[slot];

  await db
    .update(cards)
    .set({
      ownerId: userId,
      grabberId: userId,
      grabbedAt: new Date(),
    })
    .where(and(eq(cards.code, cardCode), sql`${cards.ownerId} IS NULL`));

  await db
    .update(users)
    .set({ totalGrabs: sql`${users.totalGrabs} + 1` })
    .where(eq(users.id, userId));

  const { awardXp: awardGrabXp } = await import("./level.service.js");
  await awardGrabXp(userId, "grab");

  // Quick Hands buff: reduces grab cooldown
  const { getBuffEffect } = await import("./buff.service.js");
  const grabCdMult = await getBuffEffect(discordUserId, "grabCdMult");
  if (grabCdMult) {
    const { config: appCfg } = await import("../config.js");
    const baseCd = appCfg.GRAB_COOLDOWN_SEC;
    await setCooldown(discordUserId, "grab", Math.ceil(baseCd * grabCdMult));
  } else {
    await setCooldown(discordUserId, "grab");
  }

  // Track grab timing for anti-bot analysis
  const { trackGrabTiming } = await import("./antibot.service.js");
  await trackGrabTiming(discordUserId);

  session.grabbed[slot] = true;
  session.grabbedBy[slot] = discordUserId;
  await updateSummonSession(summonId, session);

  return { success: true, type: "card", cardCode, foughtOff };
}

export class SummonCooldownError extends Error {
  remaining: number;
  constructor(remaining: number) {
    super(`Summon on cooldown: ${remaining}s remaining`);
    this.name = "SummonCooldownError";
    this.remaining = remaining;
  }
}
