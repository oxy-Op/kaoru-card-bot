"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CurationCard } from "./curation-card";
import {
  CheckCheck,
  XCircle,
  ChevronLeft,
  ChevronRight,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PendingItem {
  id: number;
  characterId: number;
  imageUrl: string;
  imagePath: string | null;
  source: string;
  sourceUrl: string | null;
  artistName: string | null;
  charName: string;
  charSeries: string;
}

interface CurationGridProps {
  items: PendingItem[];
  total: number;
  page: number;
  totalPages: number;
  status: string;
  /** Query keys to keep when changing page (not including status or page). */
  preserveQuery?: Record<string, string | undefined>;
}

export function CurationGrid({
  items: initialItems,
  total,
  page,
  totalPages,
  status,
  preserveQuery = {},
}: CurationGridProps) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const handleApprove = async (id: number) => {
    const res = await fetch(`/api/curation/${id}/approve`, { method: "POST" });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleReject = async (id: number, reason: string) => {
    const res = await fetch(`/api/curation/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleBulk = async (action: "approve" | "reject") => {
    if (selected.size === 0) return;
    setBulkLoading(true);

    const res = await fetch("/api/curation/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: Array.from(selected),
        action,
        reason: action === "reject" ? "bulk reject" : undefined,
      }),
    });

    if (res.ok) {
      setItems((prev) => prev.filter((i) => !selected.has(i.id)));
      setSelected(new Set());
    }
    setBulkLoading(false);
  };

  const navigate = (newPage: number) => {
    const q = new URLSearchParams();
    q.set("status", status);
    for (const [k, v] of Object.entries(preserveQuery)) {
      if (v) q.set(k, v);
    }
    if (newPage > 1) q.set("page", String(newPage));
    router.push(`/curation?${q.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {selected.size === items.length && items.length > 0 ? "Deselect all" : "Select all"}
          </button>

          {selected.size > 0 && (
            <>
              <span className="text-xs text-zinc-500">{selected.size} selected</span>
              <button
                onClick={() => handleBulk("approve")}
                disabled={bulkLoading}
                className="flex items-center gap-1 rounded-md bg-emerald-600/20 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/30 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Approve all
              </button>
              <button
                onClick={() => handleBulk("reject")}
                disabled={bulkLoading}
                className="flex items-center gap-1 rounded-md bg-red-600/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject all
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => router.refresh()}
            className="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-zinc-500">
            {total} total
          </span>
        </div>
      </div>

      {/* Grid */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-16 text-center">
          <p className="text-sm text-zinc-500">
            {status === "pending"
              ? "No pending images to review"
              : `No ${status} images found`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <CurationCard
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onToggleSelect={toggleSelect}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => navigate(page - 1)}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="text-xs text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => navigate(page + 1)}
            disabled={page >= totalPages}
            className="flex items-center gap-1 rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
