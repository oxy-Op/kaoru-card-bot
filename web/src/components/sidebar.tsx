"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";
import type { AdminRole } from "@/lib/auth";
import {
  LayoutDashboard,
  Images,
  BookOpen,
  Users,
  ScrollText,
  Settings,
  ShieldAlert,
  BarChart3,
  LogOut,
  Menu,
  X,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Curation", href: "/curation", icon: Images },
  { label: "Characters", href: "/characters", icon: BookOpen },
  { label: "Users", href: "/users", icon: Users },
  { label: "Flags", href: "/flags", icon: ShieldAlert },
  { label: "Economy Lab", href: "/economy", icon: BarChart3 },
  { label: "Audit Log", href: "/audit", icon: ScrollText },
  { label: "System", href: "/config", icon: Settings },
];

interface SidebarProps {
  user: {
    username: string;
    role: AdminRole;
    image?: string | null;
  };
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setMobileOpen(true)}
        className="fixed left-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/90 text-zinc-200 shadow-lg md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur-md transition-transform duration-200 ease-out",
          "md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-zinc-800/80 px-4 md:justify-start">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-500/20">
              K
            </div>
            <div>
              <span className="text-sm font-semibold tracking-tight text-white">Kaoru</span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Admin
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all",
                active
                  ? "bg-zinc-800/90 text-white shadow-sm ring-1 ring-white/5"
                  : "text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-100"
              )}
            >
              <Icon className={cn("h-4 w-4", active && "text-indigo-400")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 p-3">
        <div className="flex items-center gap-3 px-1">
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs text-zinc-400">
              {user.username[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{user.username}</p>
            <p className={cn("text-xs", ROLE_COLORS[user.role])}>
              {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        <form
          action="/api/auth/signout"
          method="POST"
          className="mt-2"
        >
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
    </>
  );
}
