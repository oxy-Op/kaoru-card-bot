"use client";

import { useState } from "react";
import { Check, X, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { toImageApiUrl } from "@/lib/image-path";

interface CurationCardProps {
  item: {
    id: number;
    characterId: number;
    imageUrl: string;
    imagePath: string | null;
    source: string;
    sourceUrl: string | null;
    artistName: string | null;
    charName: string;
    charSeries: string;
  };
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onApprove: (id: number) => void;
  onReject: (id: number, reason: string) => void;
}

const REJECT_REASONS = [
  { value: "nsfw", label: "NSFW" },
  { value: "low_quality", label: "Low Quality" },
  { value: "wrong_character", label: "Wrong Character" },
  { value: "duplicate", label: "Duplicate" },
  { value: "copyright", label: "Copyright/DMCA" },
  { value: "other", label: "Other" },
];

export function CurationCard({
  item,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
}: CurationCardProps) {
  const [showRejectMenu, setShowRejectMenu] = useState(false);
  const [loading, setLoading] = useState(false);

  const imageUrl = item.imagePath
    ? toImageApiUrl(item.imagePath)
    : item.imageUrl;

  const handleApprove = () => {
    setLoading(true);
    onApprove(item.id);
  };

  const handleReject = (reason: string) => {
    setLoading(true);
    setShowRejectMenu(false);
    onReject(item.id, reason);
  };

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-zinc-900/50 overflow-hidden transition-all",
        selected ? "border-indigo-500 ring-1 ring-indigo-500/50" : "border-zinc-800 hover:border-zinc-700",
        loading && "opacity-50 pointer-events-none"
      )}
    >
      {/* Selection checkbox */}
      <button
        onClick={() => onToggleSelect(item.id)}
        className={cn(
          "absolute top-2 left-2 z-10 h-5 w-5 rounded border flex items-center justify-center transition-colors cursor-pointer",
          selected
            ? "bg-indigo-600 border-indigo-600 text-white"
            : "border-zinc-600 bg-zinc-900/80 text-transparent hover:border-zinc-400"
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </button>

      {/* Image */}
      <div className="aspect-[3/4] relative bg-zinc-800">
        <img
          src={imageUrl}
          alt={item.charName}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {/* Source badge */}
        <div className="absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-zinc-300 backdrop-blur-sm">
          {item.source}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div>
          <p className="text-sm font-medium text-white truncate">{item.charName}</p>
          <p className="text-xs text-zinc-500 truncate">{item.charSeries}</p>
        </div>

        {item.artistName && (
          <p className="text-xs text-zinc-500 truncate">
            by {item.artistName}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          <button
            onClick={handleApprove}
            className="flex-1 flex items-center justify-center gap-1 rounded-md bg-emerald-600/20 px-2 py-1.5 text-xs text-emerald-400 hover:bg-emerald-600/30 transition-colors cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            Approve
          </button>
          <div className="relative flex-1">
            <button
              onClick={() => setShowRejectMenu(!showRejectMenu)}
              className="w-full flex items-center justify-center gap-1 rounded-md bg-red-600/20 px-2 py-1.5 text-xs text-red-400 hover:bg-red-600/30 transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </button>
            {showRejectMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-40 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl z-20">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => handleReject(r.value)}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-md bg-zinc-800 p-1.5 text-zinc-400 hover:text-white transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
