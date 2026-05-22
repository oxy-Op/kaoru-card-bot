"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImageUp } from "lucide-react";

export function EditionReplaceButton({ editionId }: { editionId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || loading) return;

    setError(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("image", file);
      const res = await fetch(`/api/editions/${editionId}/replace`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300 transition-colors hover:border-indigo-500/40 hover:bg-indigo-950/30 hover:text-indigo-200 disabled:opacity-50"
      >
        <ImageUp className="h-3 w-3" />
        {loading ? "…" : "Replace image"}
      </button>
      {error ? (
        <span className="max-w-[12rem] text-right text-[10px] text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}
