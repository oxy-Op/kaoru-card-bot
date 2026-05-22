import { db } from "@/lib/db";
import { pendingEditions, characters } from "@shared/db/schema";
import {
  eq,
  desc,
  asc,
  count,
  or,
  ilike,
  and,
  gte,
  lte,
  type SQL,
} from "drizzle-orm";
import { CurationGrid } from "@/components/curation-grid";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { parseDayStart, parseDayEnd, toQueryString } from "@/lib/list-filters";

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "dmca", label: "DMCA" },
];

interface CurationPageProps {
  searchParams: Promise<{
    status?: string;
    page?: string;
    from?: string;
    to?: string;
    search?: string;
    sort?: string;
  }>;
}

export default async function CurationPage({ searchParams }: CurationPageProps) {
  const params = await searchParams;
  const status = params.status ?? "pending";
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const fromStr = (params.from ?? "").trim();
  const toStr = (params.to ?? "").trim();
  const searchStr = (params.search ?? "").trim();
  const sortOldest = params.sort === "oldest";

  const fromDate = parseDayStart(fromStr);
  const toDate = parseDayEnd(toStr);

  const crossStatus: SQL[] = [];
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

  const statusCounts: Record<string, number> = {};
  for (const tab of STATUS_TABS) {
    const tabWhere =
      crossStatus.length > 0
        ? and(eq(pendingEditions.status, tab.value), ...crossStatus)
        : eq(pendingEditions.status, tab.value);
    const [{ c }] = await db
      .select({ c: count() })
      .from(pendingEditions)
      .innerJoin(characters, eq(pendingEditions.characterId, characters.id))
      .where(tabWhere);
    statusCounts[tab.value] = c;
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const preserveQuery: Record<string, string | undefined> = {
    from: fromStr || undefined,
    to: toStr || undefined,
    search: searchStr || undefined,
    sort: sortOldest ? "oldest" : undefined,
  };

  const tabHref = (tabStatus: string) =>
    `/curation${toQueryString({ status: tabStatus, ...preserveQuery })}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Image curation"
        description="Review pending uploads before they become summonable editions. Curator role required for approve/reject."
      />

      <form
        method="GET"
        className="flex flex-col gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <input type="hidden" name="status" value={status} />
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:flex-1">
          <label className="block min-w-0 sm:col-span-2 lg:col-span-1">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Character / series
            </span>
            <input
              name="search"
              defaultValue={searchStr}
              placeholder="Search name or series…"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              From (UTC)
            </span>
            <input
              type="date"
              name="from"
              defaultValue={fromStr}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              To (UTC)
            </span>
            <input
              type="date"
              name="to"
              defaultValue={toStr}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Sort
            </span>
            <select
              name="sort"
              defaultValue={sortOldest ? "oldest" : "newest"}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="h-10 shrink-0 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Apply
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800/80 pb-px">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tabHref(tab.value)}
            className={cn(
              "flex items-center gap-2 rounded-t-md px-4 py-2 text-sm transition-colors",
              status === tab.value
                ? "bg-zinc-800 text-white border-b-2 border-indigo-500"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {tab.label}
            {statusCounts[tab.value] > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  tab.value === "pending"
                    ? "bg-amber-600/20 text-amber-400"
                    : "bg-zinc-700 text-zinc-400"
                )}
              >
                {statusCounts[tab.value]}
              </span>
            )}
          </Link>
        ))}
      </div>

      <CurationGrid
        items={items}
        total={total}
        page={page}
        totalPages={totalPages}
        status={status}
        preserveQuery={preserveQuery}
      />
    </div>
  );
}
