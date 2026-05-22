"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EyeOff } from "lucide-react";

export function EditionHideButton({ editionId }: { editionId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function hide() {
    if (done || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/editions/${editionId}/remove`, { method: "POST" });
      if (res.ok) {
        setDone(true);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span className="text-xs text-amber-400/90">Hidden from summon</span>
    );
  }

  return (
    <button
      type="button"
      onClick={hide}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-red-500/40 hover:bg-red-950/30 hover:text-red-300 disabled:opacity-50"
    >
      <EyeOff className="h-3 w-3" />
      {loading ? "…" : "Hide summon"}
    </button>
  );
}
