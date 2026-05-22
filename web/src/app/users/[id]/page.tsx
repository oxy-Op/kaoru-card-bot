import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { users, cards } from "@shared/db/schema";
import { eq, count } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import type { AdminRole } from "@/lib/auth";
import { Lock, ChevronLeft } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: Props) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const row = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  if (!row) notFound();

  const [{ ownedCards }] = await db
    .select({ ownedCards: count() })
    .from(cards)
    .where(eq(cards.ownerId, id));

  const session = await auth();
  const role =
    (session?.user as { role?: AdminRole } | undefined)?.role ?? "viewer";
  const showEconomy = hasRole(role, "admin");

  return (
    <div className="space-y-8">
      <Link
        href="/users"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300"
      >
        <ChevronLeft className="h-4 w-4" />
        Users
      </Link>

      <PageHeader
        title={row.username}
        description={`Player #${row.id} · Discord ${row.discordId}`}
      />

      {!showEconomy && (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
          <Lock className="h-4 w-4 shrink-0 text-zinc-500" />
          Economy fields are hidden at your role level.
        </div>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Level / XP
          </dt>
          <dd className="mt-1 text-lg tabular-nums text-zinc-100">
            {row.level}{" "}
            <span className="text-sm font-normal text-zinc-500">
              · {row.xp.toLocaleString()} XP
            </span>
          </dd>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Cards owned
          </dt>
          <dd className="mt-1 text-lg tabular-nums text-zinc-100">
            {ownedCards.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Summons / Grabs
          </dt>
          <dd className="mt-1 text-lg tabular-nums text-zinc-100">
            {row.totalSummons.toLocaleString()} /{" "}
            {row.totalGrabs.toLocaleString()}
          </dd>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Joined (UTC)
          </dt>
          <dd className="mt-1 text-sm text-zinc-300">
            {row.joinedAt?.toISOString?.() ?? String(row.joinedAt)}
          </dd>
        </div>
        {showEconomy && (
          <>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Gold
              </dt>
              <dd className="mt-1 text-lg tabular-nums text-amber-200/90">
                {row.gold.toLocaleString()}
              </dd>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Opals / Cinders / Shards
              </dt>
              <dd className="mt-1 text-sm tabular-nums text-zinc-300">
                {row.opals.toLocaleString()} · {row.cinders.toLocaleString()} ·{" "}
                {row.shards.toLocaleString()}
              </dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}
