import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}

export function PaginationBar({ page, totalPages, basePath, searchParams }: PaginationBarProps) {
  const buildUrl = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) q.set(k, v);
    }
    if (p > 1) q.set("page", String(p));
    else q.delete("page");
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-4 border-t border-zinc-800/80 pt-6">
      <p className="text-sm text-zinc-500">
        Page <span className="text-zinc-300">{page}</span> of{" "}
        <span className="text-zinc-300">{totalPages}</span>
      </p>
      <div className="flex gap-2">
        <Link
          href={buildUrl(Math.max(1, page - 1))}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800/80",
            page <= 1 && "pointer-events-none opacity-40"
          )}
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Link>
        <Link
          href={buildUrl(Math.min(totalPages, page + 1))}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800/80",
            page >= totalPages && "pointer-events-none opacity-40"
          )}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
