import Link from "next/link";
import { db } from "@/lib/db";
import { characters, characterEditions } from "@shared/db/schema";
import {
  count,
  desc,
  asc,
  or,
  ilike,
  inArray,
  and,
  gte,
  sql,
} from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { PaginationBar } from "@/components/pagination-bar";

const PAGE_SIZE = 40;

type SortKey =
  | "popularity_desc"
  | "popularity_asc"
  | "name_asc"
  | "name_desc"
  | "series_asc"
  | "newest"
  | "editions_desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "popularity_desc", label: "Popularity (high → low)" },
  { value: "popularity_asc", label: "Popularity (low → high)" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "series_asc", label: "Series A–Z" },
  { value: "newest", label: "Newest in DB" },
  { value: "editions_desc", label: "Edition count (most)" },
];

interface Props {
  searchParams: Promise<{
    q?: string;
    series?: string;
    minPop?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function CharactersPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const seriesOnly = (params.series ?? "").trim();
  const minPopRaw = params.minPop?.trim();
  const minPop = minPopRaw ? parseInt(minPopRaw, 10) : undefined;
  const sort = (params.sort as SortKey) || "popularity_desc";
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [];
  if (q) {
    conditions.push(
      or(ilike(characters.name, `%${q}%`), ilike(characters.series, `%${q}%`))
    );
  }
  if (seriesOnly) {
    conditions.push(ilike(characters.series, `%${seriesOnly}%`));
  }
  if (minPop !== undefined && !Number.isNaN(minPop)) {
    conditions.push(gte(characters.popularity, minPop));
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(characters)
    .where(whereClause);

  const editionCountExpr = sql<number>`(
    SELECT COUNT(*)::int FROM character_editions ce
    WHERE ce.character_id = ${characters.id}
  )`;

  const orderByClause =
    sort === "popularity_asc"
      ? asc(characters.popularity)
      : sort === "name_asc"
        ? asc(characters.name)
        : sort === "name_desc"
          ? desc(characters.name)
          : sort === "series_asc"
            ? asc(characters.series)
            : sort === "newest"
              ? desc(characters.createdAt)
              : sort === "editions_desc"
                ? desc(editionCountExpr)
                : desc(characters.popularity);

  const rows = await db
    .select({
      id: characters.id,
      name: characters.name,
      series: characters.series,
      popularity: characters.popularity,
      imageUrl: characters.imageMediumUrl,
    })
    .from(characters)
    .where(whereClause)
    .orderBy(orderByClause)
    .limit(PAGE_SIZE)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  let editionMap = new Map<number, number>();
  if (ids.length > 0) {
    const agg = await db
      .select({
        characterId: characterEditions.characterId,
        c: count(characterEditions.id),
      })
      .from(characterEditions)
      .where(inArray(characterEditions.characterId, ids))
      .groupBy(characterEditions.characterId);
    editionMap = new Map(agg.map((a) => [a.characterId, a.c]));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const listParams: Record<string, string | undefined> = {
    q: q || undefined,
    series: seriesOnly || undefined,
    minPop:
      minPop !== undefined && !Number.isNaN(minPop) ? String(minPop) : undefined,
    sort: sort !== "popularity_desc" ? sort : undefined,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Characters"
        description="Filter by text, series substring, minimum source popularity, and sort. All filters combine with AND."
      />

      <form
        method="GET"
        className="flex flex-col gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:flex-1">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Name or series (any)
            </span>
            <input
              name="q"
              defaultValue={q}
              placeholder="e.g. Goku, Naruto"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Series contains
            </span>
            <input
              name="series"
              defaultValue={seriesOnly}
              placeholder="Narrow to a franchise"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Min popularity
            </span>
            <input
              name="minPop"
              type="number"
              min={0}
              defaultValue={minPopRaw ?? ""}
              placeholder="0"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Sort
            </span>
            <select
              name="sort"
              defaultValue={sort}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="submit"
            className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Apply
          </button>
          <Link
            href="/characters"
            className="inline-flex h-10 items-center rounded-lg border border-zinc-700 px-4 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30 shadow-xl shadow-black/20">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-3 w-14" />
              <th className="px-4 py-3">Character</th>
              <th className="px-4 py-3 hidden md:table-cell">Series</th>
              <th className="px-4 py-3 text-right">Editions</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">Pop.</th>
              <th className="px-4 py-3 w-24 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/80">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                  No characters match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-zinc-800/40"
                >
                  <td className="px-4 py-2 w-14">
                    {row.imageUrl ? (
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.imageUrl}
                          alt=""
                          className="h-full w-full object-cover object-top"
                        />
                      </div>
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs text-zinc-500">
                        ?
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 font-medium text-zinc-100">{row.name}</td>
                  <td className="px-4 py-2 text-zinc-400 hidden md:table-cell max-w-[200px] truncate">
                    {row.series}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-300">
                    {editionMap.get(row.id) ?? 0}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-500 hidden sm:table-cell">
                    {row.popularity ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/characters/${row.id}`}
                      className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        basePath="/characters"
        searchParams={listParams}
      />
    </div>
  );
}
