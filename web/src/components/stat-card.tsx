import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
}

export function StatCard({ label, value, subtitle, icon, trend }: StatCardProps) {
  return (
    <div className="group rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-5 shadow-sm shadow-black/20 transition-colors hover:border-zinc-700/90 hover:bg-zinc-900/60">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-white">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p
              className={cn(
                "mt-1 text-xs",
                trend === "up"
                  ? "text-emerald-400"
                  : trend === "down"
                    ? "text-red-400"
                    : "text-zinc-500"
              )}
            >
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20 transition-colors group-hover:bg-indigo-500/15">
          {icon}
        </div>
      </div>
    </div>
  );
}
