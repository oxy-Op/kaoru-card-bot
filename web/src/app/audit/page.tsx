import { db } from "@/lib/db";
import { auditLog, users } from "@shared/db/schema";
import { count, desc, asc, eq, and, gte, lte } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { PaginationBar } from "@/components/pagination-bar";
import Link from "next/link";
import { parseDayStart, parseDayEnd, toQueryString } from "@/lib/list-filters";

const PAGE_SIZE = 60;

interface Props {
  searchParams: Promise<{
    action?: string;
    page?: string;
    from?: string;
    to?: string;
    sort?: string;
  }>;
}

export default async function AuditPage({ searchParams }: Props) {
  const params = await searchParams;
  const actionFilter = (params.action ?? "").trim();
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;
  const fromStr = (params.from ?? "").trim();
  const toStr = (params.to ?? "").trim();
  const sortAsc = params.sort === "asc";

  const fromDate = parseDayStart(fromStr);
  const toDate = parseDayEnd(toStr);

  const conditions = [];
  if (actionFilter) conditions.push(eq(auditLog.action, actionFilter));
  if (fromDate) conditions.push(gte(auditLog.createdAt, fromDate));
  if (toDate) conditions.push(lte(auditLog.createdAt, toDate));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLog)
    .where(whereClause);

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      details: auditLog.details,
      guildId: auditLog.guildId,
      createdAt: auditLog.createdAt,
      username: users.username,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(whereClause)
    .orderBy(sortAsc ? asc(auditLog.createdAt) : desc(auditLog.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const commonActions = [
    "give_card",
    "give_gold",
    "edition_remove",
    "curation_approve",
    "curation_reject",
  ];

  const listParams: Record<string, string | undefined> = {
    action: actionFilter || undefined,
    from: fromStr || undefined,
    to: toStr || undefined,
    sort: sortAsc ? "asc" : undefined,
  };

  const chipQuery = (overrides: Record<string, string | undefined>) =>
    toQueryString({ ...listParams, ...overrides });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Audit log"
        description="Immutable trail of sensitive bot actions. Filter by action, UTC date range, and sort order."
      />

      <form
        method="GET"
        className="flex flex-col gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 sm:flex-row sm:flex-wrap sm:items-end"
      >
        {actionFilter ? (
          <input type="hidden" name="action" value={actionFilter} />
        ) : null}
        <div className="grid w-full gap-3 sm:grid-cols-3 lg:flex-1">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              From (UTC date)
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
              To (UTC date)
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
              Sort by time
            </span>
            <select
              name="sort"
              defaultValue={sortAsc ? "asc" : "desc"}
              className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
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

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/audit${chipQuery({ action: undefined })}`}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !actionFilter
              ? "bg-indigo-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
        >
          All
        </Link>
        {commonActions.map((a) => (
          <Link
            key={a}
            href={`/audit${chipQuery({ action: a })}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              actionFilter === a
                ? "bg-indigo-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {a}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30 shadow-xl shadow-black/20">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3 w-44">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3 hidden md:table-cell">User</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-zinc-500">
                    No entries
                    {actionFilter ? ` for “${actionFilter}”` : ""}
                    {(fromStr || toStr) ? " in this date range" : ""}.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-zinc-800/30">
                    <td className="px-4 py-2 text-xs text-zinc-500 whitespace-nowrap">
                      {row.createdAt?.toISOString?.() ?? String(row.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-indigo-300">
                        {row.action}
                      </code>
                    </td>
                    <td className="px-4 py-2 text-zinc-400 hidden md:table-cell">
                      {row.username ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500 break-all max-w-md">
                      {JSON.stringify(row.details)}
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
        basePath="/audit"
        searchParams={listParams}
      />
    </div>
  );
}
