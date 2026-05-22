import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import {
  characters,
  characterEditions,
  cards,
  users,
  pendingEditions,
} from "@shared/db/schema";
import { count, sql, eq, gte } from "drizzle-orm";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import {
  BookOpen,
  Layers,
  CreditCard,
  Users as UsersIcon,
  Clock,
  AlertTriangle,
  Images,
  ArrowRight,
  ScrollText,
  Settings,
  ShieldAlert,
  BarChart3,
} from "lucide-react";

async function getStats() {
  const [charCount] = await db
    .select({ count: count() })
    .from(characters);

  const [editionCount] = await db
    .select({ count: count() })
    .from(characterEditions);

  const [cardCount] = await db
    .select({ count: count() })
    .from(cards);

  const [userCount] = await db
    .select({ count: count() })
    .from(users);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [todayCards] = await db
    .select({ count: count() })
    .from(cards)
    .where(gte(cards.summonedAt, today));

  let pendingCount = 0;
  try {
    const [pending] = await db
      .select({ count: count() })
      .from(pendingEditions)
      .where(eq(pendingEditions.status, "pending"));
    pendingCount = pending.count;
  } catch {
    // table may not exist yet
  }

  // Flagged users from Redis
  let flaggedCount = 0;
  try {
    const keys = await redis.keys("ab:flags:*");
    flaggedCount = keys.length;
  } catch {}

  return {
    characters: charCount.count,
    editions: editionCount.count,
    cards: cardCount.count,
    users: userCount.count,
    todayCards: todayCards.count,
    pending: pendingCount,
    flagged: flaggedCount,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  const shortcuts = [
    { href: "/curation", label: "Curation queue", desc: "Approve or reject images", icon: Images },
    { href: "/characters", label: "Characters", desc: "Catalog & editions", icon: BookOpen },
    { href: "/users", label: "Users", desc: "Player accounts", icon: UsersIcon },
    { href: "/flags", label: "Flags", desc: "Anti-bot review and clear", icon: ShieldAlert },
    { href: "/economy", label: "Economy Lab", desc: "Run summon simulations", icon: BarChart3 },
    { href: "/audit", label: "Audit log", desc: "Moderation trail", icon: ScrollText },
    { href: "/config", label: "System", desc: "Health & env", icon: Settings },
  ];

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        description="Live counts from PostgreSQL and Redis. Use the sidebar or shortcuts below to drill in."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {shortcuts.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex items-center gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/30 p-4 transition-all hover:border-indigo-500/30 hover:bg-zinc-900/50"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400 transition-colors group-hover:bg-indigo-500/15 group-hover:text-indigo-400">
              <s.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-100">{s.label}</p>
              <p className="text-xs text-zinc-500">{s.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Characters"
          value={stats.characters}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <StatCard
          label="Editions"
          value={stats.editions}
          icon={<Layers className="h-5 w-5" />}
        />
        <StatCard
          label="Total Cards"
          value={stats.cards}
          icon={<CreditCard className="h-5 w-5" />}
        />
        <StatCard
          label="Users"
          value={stats.users}
          icon={<UsersIcon className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Cards Today"
          value={stats.todayCards}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Pending Curation"
          value={stats.pending}
          subtitle={stats.pending > 0 ? "Images awaiting review" : "Queue clear"}
          icon={<Images className="h-5 w-5" />}
          trend={stats.pending > 10 ? "down" : "neutral"}
        />
        <StatCard
          label="Flagged Users"
          value={stats.flagged}
          subtitle={stats.flagged > 0 ? "Anti-bot flags active" : "No flags"}
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={stats.flagged > 0 ? "down" : "neutral"}
        />
      </div>
    </div>
  );
}
