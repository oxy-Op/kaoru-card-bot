import { db } from "../db/index.js";
import { cards, characters, characterEditions, users, likeList, frames } from "../db/schema.js";
import { eq, and, like, ilike, sql, desc, asc, count, gt, lt, gte, lte, isNull, isNotNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export interface CardWithDetails {
  id: number;
  code: string;
  printNumber: number;
  quality: string;
  originalQuality?: string;
  tag: string | null;
  tagEmoji: string | null;
  frameId?: number | null;
  frameImagePath?: string | null;
  ownerId?: number | null;
  ownerName?: string | null;
  ownerDiscordId?: string | null;
  summonerId?: number | null;
  summonerName?: string | null;
  summonerDiscordId?: string | null;
  grabberId?: number | null;
  grabberName?: string | null;
  grabberDiscordId?: string | null;
  guildId?: string;
  summonedAt: Date;
  grabbedAt: Date | null;
  character: {
    id: number;
    name: string;
    nameJp: string | null;
    series: string;
    popularity?: number | null;
  };
  edition: {
    id: number;
    editionNumber: number;
    imagePath: string;
    generationMethod: string;
  };
}

export async function getCardByCode(code: string): Promise<CardWithDetails | null> {
  const summonerUsers = alias(users, "summoner_users");
  const grabberUsers = alias(users, "grabber_users");

  const rows = await db
    .select({
      id: cards.id,
      code: cards.code,
      printNumber: cards.printNumber,
      quality: cards.quality,
      originalQuality: cards.originalQuality,
      tag: cards.tag,
      tagEmoji: cards.tagEmoji,
      summonedAt: cards.summonedAt,
      grabbedAt: cards.grabbedAt,
      guildId: cards.guildId,
      ownerId: cards.ownerId,
      frameId: cards.frameId,
      frameImagePath: frames.imagePath,
      hexId: cards.hexId,
      auraId: cards.auraId,
      charId: characters.id,
      charName: characters.name,
      charNameJp: characters.nameJp,
      charSeries: characters.series,
      charPopularity: characters.popularity,
      edId: characterEditions.id,
      edNumber: characterEditions.editionNumber,
      edImagePath: characterEditions.imagePath,
      edMethod: characterEditions.generationMethod,
      ownerName: users.username,
      ownerDiscordId: users.discordId,
      summonerId: cards.summonerId,
      summonerName: summonerUsers.username,
      summonerDiscordId: summonerUsers.discordId,
      grabberId: cards.grabberId,
      grabberName: grabberUsers.username,
      grabberDiscordId: grabberUsers.discordId,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(characterEditions, eq(cards.editionId, characterEditions.id))
    .leftJoin(users, eq(cards.ownerId, users.id))
    .leftJoin(frames, eq(cards.frameId, frames.id))
    .innerJoin(summonerUsers, eq(cards.summonerId, summonerUsers.id))
    .leftJoin(grabberUsers, eq(cards.grabberId, grabberUsers.id))
    .where(eq(cards.code, code))
    .limit(1);

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    code: r.code,
    printNumber: r.printNumber,
    quality: r.quality,
    originalQuality: r.originalQuality,
    tag: r.tag,
    tagEmoji: r.tagEmoji,
    frameId: r.frameId,
    frameImagePath: r.frameImagePath,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    ownerDiscordId: r.ownerDiscordId,
    summonerId: r.summonerId,
    summonerName: r.summonerName,
    summonerDiscordId: r.summonerDiscordId,
    grabberId: r.grabberId,
    grabberName: r.grabberName,
    grabberDiscordId: r.grabberDiscordId,
    guildId: r.guildId,
    summonedAt: r.summonedAt,
    grabbedAt: r.grabbedAt,
    character: {
      id: r.charId,
      name: r.charName,
      nameJp: r.charNameJp,
      series: r.charSeries,
    },
    edition: {
      id: r.edId,
      editionNumber: r.edNumber,
      imagePath: r.edImagePath,
      generationMethod: r.edMethod,
    },
  };
}

export interface CollectionFilter {
  characterName?: string;
  series?: string;
  quality?: string;       // exact match: "pristine"
  qualityMin?: number;    // q>N  (0=damaged, 1=poor, 2=good, 3=excellent, 4=pristine)
  qualityMax?: number;    // q<N
  tag?: string;           // tag name
  tagNot?: string;        // exclude tag
  untagged?: boolean;     // only untagged cards
  editionNumber?: number;
  printMin?: number;      // n>N
  printMax?: number;      // n<N
  printExact?: number;    // n=N
  hasHex?: boolean;
  hasAura?: boolean;
  hasFrame?: boolean;
}

export type CollectionSort =
  | "newest" | "oldest" | "print" | "printr"
  | "quality" | "qualityr" | "name" | "namer"
  | "series" | "seriesr" | "edition";

const QUALITY_ORDER: Record<string, number> = {
  damaged: 0, poor: 1, good: 2, excellent: 3, pristine: 4,
};
const QUALITY_FROM_NUM: Record<number, string> = {
  0: "damaged", 1: "poor", 2: "good", 3: "excellent", 4: "pristine",
};

export interface CollectionPage {
  cards: CardWithDetails[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getUserCollection(
  discordUserId: string,
  page: number = 1,
  perPage: number = 10,
  filter?: CollectionFilter,
  sortBy: CollectionSort = "newest"
): Promise<CollectionPage> {
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, discordUserId),
  });
  if (!user) return { cards: [], total: 0, page: 1, totalPages: 0 };

  const conditions: any[] = [eq(cards.ownerId, user.id)];

  if (filter?.characterName) {
    conditions.push(ilike(characters.name, `%${filter.characterName}%`));
  }
  if (filter?.series) {
    conditions.push(ilike(characters.series, `%${filter.series}%`));
  }
  if (filter?.quality) {
    conditions.push(eq(cards.quality, filter.quality as any));
  }
  if (filter?.qualityMin !== undefined) {
    const quals = Object.entries(QUALITY_ORDER)
      .filter(([_, v]) => v >= filter.qualityMin!)
      .map(([k]) => k);
    if (quals.length > 0 && quals.length < 5) {
      conditions.push(sql`${cards.quality} IN (${sql.join(quals.map(q => sql`${q}`), sql`, `)})`);
    }
  }
  if (filter?.qualityMax !== undefined) {
    const quals = Object.entries(QUALITY_ORDER)
      .filter(([_, v]) => v <= filter.qualityMax!)
      .map(([k]) => k);
    if (quals.length > 0 && quals.length < 5) {
      conditions.push(sql`${cards.quality} IN (${sql.join(quals.map(q => sql`${q}`), sql`, `)})`);
    }
  }
  if (filter?.tag) {
    conditions.push(eq(cards.tag, filter.tag));
  }
  if (filter?.tagNot) {
    conditions.push(ne(cards.tag, filter.tagNot));
    conditions.push(isNotNull(cards.tag));
  }
  if (filter?.untagged) {
    conditions.push(isNull(cards.tag));
  }
  if (filter?.editionNumber) {
    conditions.push(eq(characterEditions.editionNumber, filter.editionNumber));
  }
  if (filter?.printExact !== undefined) {
    conditions.push(eq(cards.printNumber, filter.printExact));
  }
  if (filter?.printMin !== undefined) {
    conditions.push(gt(cards.printNumber, filter.printMin));
  }
  if (filter?.printMax !== undefined) {
    conditions.push(lt(cards.printNumber, filter.printMax));
  }
  if (filter?.hasHex === true) conditions.push(isNotNull(cards.hexId));
  if (filter?.hasHex === false) conditions.push(isNull(cards.hexId));
  if (filter?.hasAura === true) conditions.push(isNotNull(cards.auraId));
  if (filter?.hasAura === false) conditions.push(isNull(cards.auraId));
  if (filter?.hasFrame === true) conditions.push(isNotNull(cards.frameId));
  if (filter?.hasFrame === false) conditions.push(isNull(cards.frameId));

  const where = and(...conditions);

  const [{ total: totalCount }] = await db
    .select({ total: count() })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(characterEditions, eq(cards.editionId, characterEditions.id))
    .where(where);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * perPage;

  const qualityCase = sql`CASE ${cards.quality} WHEN 'damaged' THEN 0 WHEN 'poor' THEN 1 WHEN 'good' THEN 2 WHEN 'excellent' THEN 3 WHEN 'pristine' THEN 4 ELSE 2 END`;

  const orderClause: any = {
    newest: desc(cards.summonedAt),
    oldest: asc(cards.summonedAt),
    print: asc(cards.printNumber),
    printr: desc(cards.printNumber),
    quality: desc(qualityCase),
    qualityr: asc(qualityCase),
    name: asc(characters.name),
    namer: desc(characters.name),
    series: asc(characters.series),
    seriesr: desc(characters.series),
    edition: asc(characterEditions.editionNumber),
  }[sortBy] ?? desc(cards.summonedAt);

  const rows = await db
    .select({
      id: cards.id,
      code: cards.code,
      printNumber: cards.printNumber,
      quality: cards.quality,
      tag: cards.tag,
      tagEmoji: cards.tagEmoji,
      summonedAt: cards.summonedAt,
      grabbedAt: cards.grabbedAt,
      charId: characters.id,
      charName: characters.name,
      charNameJp: characters.nameJp,
      charSeries: characters.series,
      edId: characterEditions.id,
      edNumber: characterEditions.editionNumber,
      edImagePath: characterEditions.imagePath,
      edMethod: characterEditions.generationMethod,
    })
    .from(cards)
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(characterEditions, eq(cards.editionId, characterEditions.id))
    .where(where)
    .orderBy(orderClause)
    .limit(perPage)
    .offset(offset);

  return {
    cards: rows.map((r) => ({
      id: r.id,
      code: r.code,
      printNumber: r.printNumber,
      quality: r.quality,
      tag: r.tag,
      tagEmoji: r.tagEmoji,
      summonedAt: r.summonedAt,
      grabbedAt: r.grabbedAt,
      character: {
        id: r.charId,
        name: r.charName,
        nameJp: r.charNameJp,
        series: r.charSeries,
        popularity: r.charPopularity,
      },
      edition: {
        id: r.edId,
        editionNumber: r.edNumber,
        imagePath: r.edImagePath,
        generationMethod: r.edMethod,
      },
    })),
    total: totalCount,
    page: safePage,
    totalPages,
  };
}

/**
 * Parse legacy collection filter args.
 * Examples: "o=print", "q=4", "n>5", "n<20", "t=fav", "t!=jojo",
 *           "c=goku", "s=naruto", "hex=1", "aura=0", "frame=1"
 */
export function parseCollectionArgs(args: string[]): {
  filter: CollectionFilter;
  sort: CollectionSort;
  page: number;
} {
  const filter: CollectionFilter = {};
  let sort: CollectionSort = "newest";
  let page = 1;

  for (const arg of args) {
    // order: o=print, o=p, o=q, o=c, o=s, o=n, o=l
    const orderMatch = arg.match(/^o(?:rder)?=(.+)$/i);
    if (orderMatch) {
      const v = orderMatch[1].toLowerCase();
      const map: Record<string, CollectionSort> = {
        p: "print", print: "print", n: "print", number: "print",
        pr: "printr", printr: "printr",
        q: "quality", quality: "quality",
        qr: "qualityr",
        c: "name", characters: "name", character: "name", name: "name",
        cr: "namer",
        s: "series", series: "series",
        sr: "seriesr",
        newest: "newest", oldest: "oldest", old: "oldest",
        ed: "edition", edition: "edition",
      };
      sort = map[v] ?? "newest";
      continue;
    }

    // quality: q=4, q>2, q<3
    const qExact = arg.match(/^q=(\d)$/i);
    if (qExact) {
      const n = parseInt(qExact[1]);
      filter.quality = QUALITY_FROM_NUM[n];
      continue;
    }
    const qGt = arg.match(/^q>(\d)$/i);
    if (qGt) { filter.qualityMin = parseInt(qGt[1]) + 1; continue; }
    const qLt = arg.match(/^q<(\d)$/i);
    if (qLt) { filter.qualityMax = parseInt(qLt[1]) - 1; continue; }

    // print: n=1, n>5, n<20, p=1, p>5, p<20
    const nExact = arg.match(/^[np]=(\d+)$/i);
    if (nExact) { filter.printExact = parseInt(nExact[1]); continue; }
    const nGt = arg.match(/^[np]>(\d+)$/i);
    if (nGt) { filter.printMin = parseInt(nGt[1]); continue; }
    const nLt = arg.match(/^[np]<(\d+)$/i);
    if (nLt) { filter.printMax = parseInt(nLt[1]); continue; }

    // tag: t=tagname, t!=tagname, t=untagged, t=ut, t=none
    const tagNot = arg.match(/^t!=(.+)$/i);
    if (tagNot) { filter.tagNot = tagNot[1]; continue; }
    const tagMatch = arg.match(/^(?:tag|t)=(.+)$/i);
    if (tagMatch) {
      const v = tagMatch[1].toLowerCase();
      if (v === "untagged" || v === "ut" || v === "none") {
        filter.untagged = true;
      } else {
        filter.tag = tagMatch[1];
      }
      continue;
    }

    // character: c=name, character=name
    const charMatch = arg.match(/^(?:character|char|c)=(.+)$/i);
    if (charMatch) { filter.characterName = charMatch[1]; continue; }

    // series: s=name, series=name
    const seriesMatch = arg.match(/^(?:series|s)=(.+)$/i);
    if (seriesMatch) { filter.series = seriesMatch[1]; continue; }

    // cosmetic filters: hex=1, aura=0, frame=1
    const hexMatch = arg.match(/^(?:hex|h)=([01tfyn])/i);
    if (hexMatch) { filter.hasHex = ["1","t","y"].includes(hexMatch[1].toLowerCase()); continue; }
    const auraMatch = arg.match(/^(?:aura|a)=([01tfyn])/i);
    if (auraMatch) { filter.hasAura = ["1","t","y"].includes(auraMatch[1].toLowerCase()); continue; }
    const frameMatch = arg.match(/^(?:frame|f)=([01tfyn])/i);
    if (frameMatch) { filter.hasFrame = ["1","t","y"].includes(frameMatch[1].toLowerCase()); continue; }

    // page number
    const pageMatch = arg.match(/^(?:page|pg)=(\d+)$/i);
    if (pageMatch) { page = parseInt(pageMatch[1]); continue; }
  }

  return { filter, sort, page };
}

export async function searchCharacters(
  query: string,
  page: number = 1,
  perPage: number = 10
) {
  const where = ilike(characters.name, `%${query}%`);

  const [{ total: totalCount }] = await db
    .select({ total: count() })
    .from(characters)
    .where(where);

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const offset = (Math.min(Math.max(1, page), totalPages) - 1) * perPage;

  const rows = await db
    .select()
    .from(characters)
    .where(where)
    .orderBy(desc(characters.popularity))
    .limit(perPage)
    .offset(offset);

  return { characters: rows, total: totalCount, page, totalPages };
}

export async function getWishlistCount(characterId: number): Promise<number> {
  const [result] = await db
    .select({ hearts: count() })
    .from(likeList)
    .where(eq(likeList.characterId, characterId));
  return result?.hearts ?? 0;
}
