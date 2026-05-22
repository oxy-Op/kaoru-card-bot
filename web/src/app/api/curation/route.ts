import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pendingEditions, characters } from "@shared/db/schema";
import { eq, count, desc, asc, or, ilike, and, gte, lte } from "drizzle-orm";
import { withAuth } from "@/lib/api-auth";
import { parseDayStart, parseDayEnd } from "@/lib/list-filters";

export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10))
  );
  const searchStr = (url.searchParams.get("search") ?? "").trim();
  const fromStr = (url.searchParams.get("from") ?? "").trim();
  const toStr = (url.searchParams.get("to") ?? "").trim();
  const sortOldest = url.searchParams.get("sort") === "oldest";

  const offset = (page - 1) * limit;

  const fromDate = parseDayStart(fromStr);
  const toDate = parseDayEnd(toStr);

  const crossStatus = [];
  if (searchStr) {
    crossStatus.push(
      or(
        ilike(characters.name, `%${searchStr}%`),
        ilike(characters.series, `%${searchStr}%`)
      )!
    );
  }
  if (fromDate) crossStatus.push(gte(pendingEditions.createdAt, fromDate));
  if (toDate) crossStatus.push(lte(pendingEditions.createdAt, toDate));

  const whereClause =
    crossStatus.length > 0
      ? and(eq(pendingEditions.status, status), ...crossStatus)
      : eq(pendingEditions.status, status);

  const items = await db
    .select({
      id: pendingEditions.id,
      characterId: pendingEditions.characterId,
      imageUrl: pendingEditions.imageUrl,
      imagePath: pendingEditions.imagePath,
      source: pendingEditions.source,
      sourceUrl: pendingEditions.sourceUrl,
      artistName: pendingEditions.artistName,
      status: pendingEditions.status,
      rejectionReason: pendingEditions.rejectionReason,
      createdAt: pendingEditions.createdAt,
      charName: characters.name,
      charSeries: characters.series,
    })
    .from(pendingEditions)
    .innerJoin(characters, eq(pendingEditions.characterId, characters.id))
    .where(whereClause)
    .orderBy(
      sortOldest
        ? asc(pendingEditions.createdAt)
        : desc(pendingEditions.createdAt)
    )
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(pendingEditions)
    .innerJoin(characters, eq(pendingEditions.characterId, characters.id))
    .where(whereClause);

  return NextResponse.json({
    items,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});
