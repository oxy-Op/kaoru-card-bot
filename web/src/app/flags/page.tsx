import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { users } from "@shared/db/schema";
import { inArray } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { PaginationBar } from "@/components/pagination-bar";
import { revalidatePath } from "next/cache";

const PAGE_SIZE = 25;

interface Props {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function FlagsPage({ searchParams }: Props) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const canClear = hasRole(role, "admin");
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const page = Math.max(1, parseInt(params.page ?? "1", 10));

  async function clearFlagAction(formData: FormData) {
    "use server";
    const currentSession = await auth();
    const currentRole = (currentSession?.user as { role?: string } | undefined)?.role ?? "viewer";
    if (!hasRole(currentRole, "admin")) return;

    const discordId = String(formData.get("discordId") ?? "").trim();
    if (!discordId) return;

    await redis.del(`ab:flags:${discordId}`);
    await redis.del(`ab:flaglog:${discordId}`);
    revalidatePath("/flags");
  }

  const keys = await redis.keys("ab:flags:*");
  const discordIds = keys.map((k) => k.replace("ab:flags:", ""));

  const userRows = discordIds.length
    ? await db
      .select({
        discordId: users.discordId,
        username: users.username,
        id: users.id,
      })
      .from(users)
      .where(inArray(users.discordId, discordIds))
    : [];

  const userMap = new Map(userRows.map((u) => [u.discordId, u]));

  const allRows = await Promise.all(
    discordIds.map(async (discordId) => {
      const [countRaw, ttl, reasons] = await Promise.all([
        redis.get(`ab:flags:${discordId}`),
        redis.ttl(`ab:flags:${discordId}`),
        redis.lrange(`ab:flaglog:${discordId}`, -5, -1),
      ]);
      const count = Number.parseInt(countRaw ?? "0", 10) || 0;
      const user = userMap.get(discordId);
      return {
        discordId,
        username: user?.username ?? "Unknown",
        userId: user?.id ?? null,
        count,
        ttl,
        reasons: reasons.reverse(),
      };
    })
  );

  const filtered = allRows
    .filter((r) => {
      if (!q) return true;
      return (
        r.discordId.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.count - a.count || a.discordId.localeCompare(b.discordId));

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  const listParams: Record<string, string | undefined> = {
    q: q || undefined,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Anti-bot Flags"
        description="Review active anti-bot flag buckets and clear false positives without using Discord commands."
      />

      {!canClear ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
          You can view flags, but only Admin/Owner can clear them.
        </div>
      ) : null}

      <form
        method="GET"
        className="flex flex-col gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-4 sm:flex-row sm:items-end"
      >
        <label className="block min-w-0 flex-1">
          <span className="mb-1 block text-xs font-medium text-zinc-500">
            Search username or Discord ID
          </span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search…"
            className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Apply
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30 shadow-xl shadow-black/20">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs font-medium uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Discord ID</th>
                <th className="px-4 py-3 text-right">Flags</th>
                <th className="px-4 py-3">Expires In</th>
                <th className="px-4 py-3">Recent Reasons</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                    No active flag records.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.discordId} className="align-top hover:bg-zinc-800/30">
                    <td className="px-4 py-2 text-zinc-100">
                      {row.username}
                      {row.userId ? (
                        <span className="ml-2 text-xs text-zinc-600">#{row.userId}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                      {row.discordId}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-300">
                      {row.count}
                    </td>
                    <td className="px-4 py-2 text-zinc-400">
                      {formatTtl(row.ttl)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                      {row.reasons.length > 0 ? row.reasons.join(" | ") : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={clearFlagAction}>
                        <input type="hidden" name="discordId" value={row.discordId} />
                        <button
                          type="submit"
                          disabled={!canClear}
                          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar
        page={safePage}
        totalPages={totalPages}
        basePath="/flags"
        searchParams={listParams}
      />
    </div>
  );
}
