import { db } from "../db/index.js";
import { albums, albumPages, albumCards, cards, characters, characterEditions, users } from "../db/schema.js";
import { eq, and, sql, count, asc } from "drizzle-orm";
import { ensureUser } from "./summon.service.js";

const MAX_CARDS_PER_PAGE = 8;
const ABSOLUTE_MAX_ALBUMS = 20;
const ABSOLUTE_MAX_PAGES = 50;

export interface AlbumSummary {
  id: number;
  name: string;
  pageCount: number;
  cardCount: number;
}

export async function getUserAlbums(discordId: string): Promise<AlbumSummary[]> {
  const userId = await ensureUser(discordId, "");
  const rows = await db
    .select({
      id: albums.id,
      name: albums.name,
      pageCount: sql<number>`(SELECT count(*) FROM album_pages WHERE album_id = ${albums.id})`,
      cardCount: sql<number>`(SELECT count(*) FROM album_cards ac JOIN album_pages ap ON ac.page_id = ap.id WHERE ap.album_id = ${albums.id})`,
    })
    .from(albums)
    .where(eq(albums.userId, userId))
    .orderBy(albums.createdAt);

  return rows;
}

export async function createAlbum(
  discordId: string,
  name: string
): Promise<{ success: true; albumId: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { maxAlbums: true },
  });
  const maxAlbums = user?.maxAlbums ?? 2;

  const [{ total }] = await db.select({ total: count() }).from(albums).where(eq(albums.userId, userId));
  if (total >= maxAlbums) {
    return { success: false, reason: `You already have **${total}/${maxAlbums}** albums. Upgrade with \`ka!asu\`.` };
  }
  if (total >= ABSOLUTE_MAX_ALBUMS) {
    return { success: false, reason: `Maximum ${ABSOLUTE_MAX_ALBUMS} albums reached.` };
  }

  if (name.length > 32) return { success: false, reason: "Album name too long (max 32 chars)." };

  const existing = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, name)),
  });
  if (existing) return { success: false, reason: `Album "${name}" already exists.` };

  const [album] = await db.insert(albums).values({ userId, name }).returning({ id: albums.id });

  // Auto-create page 1
  await db.insert(albumPages).values({ albumId: album.id, pageNumber: 1 });

  return { success: true, albumId: album.id };
}

export async function deleteAlbum(
  discordId: string,
  name: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, name)),
  });
  if (!album) return { success: false, reason: `Album "${name}" not found.` };

  await db.delete(albums).where(eq(albums.id, album.id));
  return { success: true };
}

export async function renameAlbum(
  discordId: string,
  oldName: string,
  newName: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");
  if (newName.length > 32) return { success: false, reason: "New name too long (max 32 chars)." };

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, oldName)),
  });
  if (!album) return { success: false, reason: `Album "${oldName}" not found.` };

  const dup = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, newName)),
  });
  if (dup) return { success: false, reason: `Album "${newName}" already exists.` };

  await db.update(albums).set({ name: newName }).where(eq(albums.id, album.id));
  return { success: true };
}

export async function addPage(
  discordId: string,
  albumName: string
): Promise<{ success: true; pageNumber: number } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { maxAlbumPages: true },
  });
  const maxPages = user?.maxAlbumPages ?? 5;

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { success: false, reason: `Album "${albumName}" not found.` };

  const [{ total }] = await db.select({ total: count() }).from(albumPages).where(eq(albumPages.albumId, album.id));
  if (total >= maxPages) {
    return { success: false, reason: `Album has **${total}/${maxPages}** pages. Upgrade with \`ka!apu\`.` };
  }
  if (total >= ABSOLUTE_MAX_PAGES) {
    return { success: false, reason: `Maximum ${ABSOLUTE_MAX_PAGES} pages per album.` };
  }

  const pageNumber = total + 1;
  await db.insert(albumPages).values({ albumId: album.id, pageNumber });
  return { success: true, pageNumber };
}

export async function removePage(
  discordId: string,
  albumName: string,
  pageNumber: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { success: false, reason: `Album "${albumName}" not found.` };

  const page = await db.query.albumPages.findFirst({
    where: and(eq(albumPages.albumId, album.id), eq(albumPages.pageNumber, pageNumber)),
  });
  if (!page) return { success: false, reason: `Page ${pageNumber} not found.` };

  await db.delete(albumPages).where(eq(albumPages.id, page.id));

  // Renumber remaining pages
  const remaining = await db
    .select({ id: albumPages.id, pageNumber: albumPages.pageNumber })
    .from(albumPages)
    .where(eq(albumPages.albumId, album.id))
    .orderBy(asc(albumPages.pageNumber));

  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].pageNumber !== i + 1) {
      await db.update(albumPages).set({ pageNumber: i + 1 }).where(eq(albumPages.id, remaining[i].id));
    }
  }

  return { success: true };
}

export interface AlbumCardInfo {
  position: number;
  code: string;
  characterName: string;
  series: string;
  quality: string;
  printNumber: number;
  editionNumber: number;
}

export interface AlbumPageView {
  albumName: string;
  pageNumber: number;
  totalPages: number;
  backgroundId: number | null;
  cards: AlbumCardInfo[];
}

export async function getAlbumPage(
  discordId: string,
  albumName: string,
  pageNumber: number = 1
): Promise<AlbumPageView | { error: string }> {
  const userId = await ensureUser(discordId, "");

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { error: `Album "${albumName}" not found.` };

  const [{ total }] = await db.select({ total: count() }).from(albumPages).where(eq(albumPages.albumId, album.id));
  if (total === 0) return { error: "Album has no pages." };

  const safePage = Math.min(Math.max(1, pageNumber), total);

  const page = await db.query.albumPages.findFirst({
    where: and(eq(albumPages.albumId, album.id), eq(albumPages.pageNumber, safePage)),
  });
  if (!page) return { error: `Page ${safePage} not found.` };

  const cardRows = await db
    .select({
      position: albumCards.position,
      code: cards.code,
      characterName: characters.name,
      series: characters.series,
      quality: cards.quality,
      printNumber: cards.printNumber,
      editionNumber: characterEditions.editionNumber,
    })
    .from(albumCards)
    .innerJoin(cards, eq(albumCards.cardId, cards.id))
    .innerJoin(characters, eq(cards.characterId, characters.id))
    .innerJoin(characterEditions, eq(cards.editionId, characterEditions.id))
    .where(eq(albumCards.pageId, page.id))
    .orderBy(asc(albumCards.position));

  return {
    albumName: album.name,
    pageNumber: safePage,
    totalPages: total,
    backgroundId: page.backgroundId,
    cards: cardRows,
  };
}

export async function addCardToAlbum(
  discordId: string,
  albumName: string,
  pageNumber: number,
  position: number,
  cardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  if (position < 1 || position > MAX_CARDS_PER_PAGE) {
    return { success: false, reason: `Position must be 1-${MAX_CARDS_PER_PAGE}.` };
  }

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { success: false, reason: `Album "${albumName}" not found.` };

  const page = await db.query.albumPages.findFirst({
    where: and(eq(albumPages.albumId, album.id), eq(albumPages.pageNumber, pageNumber)),
  });
  if (!page) return { success: false, reason: `Page ${pageNumber} not found.` };

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  // Check card isn't already in this album
  const existingInAlbum = await db
    .select({ id: albumCards.id })
    .from(albumCards)
    .innerJoin(albumPages, eq(albumCards.pageId, albumPages.id))
    .where(and(eq(albumPages.albumId, album.id), eq(albumCards.cardId, card.id)))
    .limit(1);

  if (existingInAlbum.length > 0) {
    return { success: false, reason: "This card is already in this album." };
  }

  // Check cards on this page
  const [{ total }] = await db.select({ total: count() }).from(albumCards).where(eq(albumCards.pageId, page.id));
  if (total >= MAX_CARDS_PER_PAGE) {
    return { success: false, reason: `Page is full (${MAX_CARDS_PER_PAGE} cards max).` };
  }

  // Check position not taken (exact match)
  const positionTaken = await db.query.albumCards.findFirst({
    where: and(eq(albumCards.pageId, page.id), eq(albumCards.position, position)),
  });
  if (positionTaken) {
    return { success: false, reason: `Position ${position} is already occupied on this page.` };
  }

  await db.insert(albumCards).values({ pageId: page.id, cardId: card.id, position });
  return { success: true };
}

export async function removeCardFromAlbum(
  discordId: string,
  albumName: string,
  cardCode: string
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { success: false, reason: `Album "${albumName}" not found.` };

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.code, cardCode), eq(cards.ownerId, userId)),
    columns: { id: true },
  });
  if (!card) return { success: false, reason: `You don't own card \`${cardCode}\`.` };

  const entry = await db
    .select({ id: albumCards.id })
    .from(albumCards)
    .innerJoin(albumPages, eq(albumCards.pageId, albumPages.id))
    .where(and(eq(albumPages.albumId, album.id), eq(albumCards.cardId, card.id)))
    .limit(1);

  if (entry.length === 0) return { success: false, reason: "Card not found in this album." };

  await db.delete(albumCards).where(eq(albumCards.id, entry[0].id));
  return { success: true };
}

export async function setPageBackground(
  discordId: string,
  albumName: string,
  pageNumber: number | "all",
  backgroundId: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { success: false, reason: `Album "${albumName}" not found.` };

  if (pageNumber === "all") {
    await db.update(albumPages).set({ backgroundId }).where(eq(albumPages.albumId, album.id));
  } else {
    const page = await db.query.albumPages.findFirst({
      where: and(eq(albumPages.albumId, album.id), eq(albumPages.pageNumber, pageNumber)),
    });
    if (!page) return { success: false, reason: `Page ${pageNumber} not found.` };
    await db.update(albumPages).set({ backgroundId }).where(eq(albumPages.id, page.id));
  }

  return { success: true };
}

export async function swapPages(
  discordId: string,
  albumName: string,
  page1: number,
  page2: number
): Promise<{ success: true } | { success: false; reason: string }> {
  const userId = await ensureUser(discordId, "");

  const album = await db.query.albums.findFirst({
    where: and(eq(albums.userId, userId), eq(albums.name, albumName)),
  });
  if (!album) return { success: false, reason: `Album "${albumName}" not found.` };

  const p1 = await db.query.albumPages.findFirst({
    where: and(eq(albumPages.albumId, album.id), eq(albumPages.pageNumber, page1)),
  });
  const p2 = await db.query.albumPages.findFirst({
    where: and(eq(albumPages.albumId, album.id), eq(albumPages.pageNumber, page2)),
  });
  if (!p1 || !p2) return { success: false, reason: "One or both page numbers are invalid." };

  // Swap via temp value
  await db.update(albumPages).set({ pageNumber: -1 }).where(eq(albumPages.id, p1.id));
  await db.update(albumPages).set({ pageNumber: page1 }).where(eq(albumPages.id, p2.id));
  await db.update(albumPages).set({ pageNumber: page2 }).where(eq(albumPages.id, p1.id));

  return { success: true };
}
