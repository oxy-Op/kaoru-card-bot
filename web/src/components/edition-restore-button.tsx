"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye } from "lucide-react";

export function EditionRestoreButton({ editionId }: { editionId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function restore() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/editions/${editionId}/restore`, {
        method: "POST",
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={restore}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-emerald-500/40 hover:bg-emerald-950/20 hover:text-emerald-300 disabled:opacity-50"
    >
      <Eye className="h-3 w-3" />
      {loading ? "…" : "Restore summon"}
    </button>
  );
}
