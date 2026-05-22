import Link from "next/link";
import { db } from "@/lib/db";
import { users } from "@shared/db/schema";
import {
  count,
  desc,
  asc,
  or,
  ilike,
  and,
  gte,
  lte,
} from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { PaginationBar } from "@/components/pagination-bar";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import type { AdminRole } from "@/lib/auth";
import { Lock } from "lucide-react";
import { parseDayStart, parseDayEnd } from "@/lib/list-filters";

const PAGE_SIZE = 50;

type UserSort = "level_desc" | "level_asc" | "newest" | "oldest";

interface Props {
  searchParams: Promise<{
    q?: string;
    page?: string;
    from?: string;
    to?: string;
    sort?: string;
  }>;
}

export default async function UsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;
  const fromStr = (params.from ?? "").trim();
  const toStr = (params.to ?? "").trim();
  const sort = (params.sort as UserSort) || "level_desc";

  const session = await auth();
  const role =
    (session?.user as { role?: AdminRole } | undefined)?.role ?? "viewer";
  const showEconomy = hasRole(role, "admin");

  const fromDate = parseDayStart(fromStr);
  const toDate = parseDayEnd(toStr);

  const conditions = [];
  if (q) {
    conditions.push(
      or(
        ilike(users.username, `%${q}%`),
        ilike(users.discordId, `%${q}%`)
      )
    );
  }
  if (fromDate) conditions.push(gte(users.joinedAt, fromDate));
  if (toDate) conditions.push(lte(users.joinedAt, toDate));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(whereClause);

  const orderByClause =
    sort === "level_asc"
      ? [asc(users.level), asc(users.xp)]
      : sort === "newest"
        ? [desc(users.joinedAt)]
        : sort === "oldest"
          ? [asc(users.joinedAt)]
          : [desc(users.level), desc(users.xp)];

  const rows = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      username: users.username,
      level: users.level,
      xp: users.xp,
      gold: users.gold,
      totalSummons: users.totalSummons,
      totalGrabs: users.totalGrabs,
    })
    .from(users)
    .where(whereClause)
    .orderBy(...orderByClause)
    .limit(PAGE_SIZE)
    .offset(offset);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const listParams: Record<string, string | undefined> = {
    q: q || undefined,
    from: fromStr || undefined,
    to: toStr || undefined,
    sort: sort !== "level_desc" ? sort : undefined,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users"
        description="Discord-linked player accounts. Filter by text, join date (UTC), and sort. Economy columns require Admin or Owner."
      />

      {!showEconomy && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
          <Lock className="h-4 w-4 shrink-0 text-zinc-500" />
          Gold and balances are hidden at your role level.
        </div>
      )}

      <form
        method="GET"
        className="flex flex-col gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:flex-1">
          <label className="block min-w-0 sm:col-span-2 lg:col-span-1">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Username or Discord ID
            </span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search…"
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              Joined from (UTC)
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
              Joined to (UTC)
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
              defaultValue={sort}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="level_desc">Level (high → low)</option>
              <option value="level_asc">Level (low → high)</option>
              <option value="newest">Newest join</option>
              <option value="oldest">Oldest join</option>
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
            href="/users"
            className="inline-flex h-10 items-center rounded-lg border border-zinc-700 px-4 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30 shadow-xl shadow-black/20">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3 hidden lg:table-cell">Discord ID</th>
                <th className="px-4 py-3 text-right">Lv</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">XP</th>
                {showEconomy && (
                  <th className="px-4 py-3 text-right">Gold</th>
                )}
                <th className="px-4 py-3 text-right hidden sm:table-cell">S / G</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={showEconomy ? 6 : 5}
                    className="px-4 py-12 text-center text-zinc-500"
                  >
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-2">
                      <Link
                        href={`/users/${row.id}`}
                        className="font-medium text-zinc-100 hover:text-indigo-300"
                      >
                        {row.username}
                      </Link>
                      <span className="ml-2 text-xs text-zinc-600">#{row.id}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500 hidden lg:table-cell">
                      {row.discordId}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-200">
                      {row.level}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-400 hidden md:table-cell">
                      {row.xp.toLocaleString()}
                    </td>
                    {showEconomy && (
                      <td className="px-4 py-2 text-right tabular-nums text-amber-200/90">
                        {row.gold.toLocaleString()}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-500 text-xs hidden sm:table-cell">
                      {row.totalSummons} / {row.totalGrabs}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar
        page={page}
        totalPages={totalPages}
        basePath="/users"
        searchParams={listParams}
      />
    </div>
  );
}
