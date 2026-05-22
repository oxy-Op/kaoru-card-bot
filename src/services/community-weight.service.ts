import { readFile } from "fs/promises";
import { join } from "path";

const LOOKUP_FILE = join(process.cwd(), "community-weights.txt");
const LOOKUP_LINE_RE = /^(.*?)\s+·\s+(.*?)\s+·\s+❤\s*([\d,]+)\s*$/;

type WeightsCache = {
  bySeriesAndName: Map<string, number>;
  byName: Map<string, number>;
  maxHearts: number;
};

let cachePromise: Promise<WeightsCache> | null = null;

function normalizePart(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function seriesNameKey(series: string, name: string): string {
  return `${normalizePart(series)}::${normalizePart(name)}`;
}

export function parseCommunityLookupLine(line: string): { series: string; name: string; hearts: number } | null {
  const match = line.match(LOOKUP_LINE_RE);
  if (!match) return null;

  const hearts = parseInt(match[3].replace(/,/g, ""), 10);
  if (!Number.isFinite(hearts) || hearts <= 0) return null;

  return {
    series: match[1].trim(),
    name: match[2].trim(),
    hearts,
  };
}

export function communityBoostFromHearts(hearts: number, maxHearts: number): number {
  if (hearts <= 0 || maxHearts <= 0) return 1;
  // Stronger bias for community-proven favorites: [1.00 .. 2.20].
  const norm = Math.sqrt(Math.min(1, hearts / maxHearts));
  return 1 + norm * 1.2;
}

async function loadWeights(): Promise<WeightsCache> {
  const bySeriesAndName = new Map<string, number>();
  const byName = new Map<string, number>();
  let maxHearts = 0;

  try {
    const raw = await readFile(LOOKUP_FILE, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseCommunityLookupLine(line);
      if (!parsed) continue;
      maxHearts = Math.max(maxHearts, parsed.hearts);

      const compositeKey = seriesNameKey(parsed.series, parsed.name);
      const existingComposite = bySeriesAndName.get(compositeKey) ?? 0;
      if (parsed.hearts > existingComposite) {
        bySeriesAndName.set(compositeKey, parsed.hearts);
      }

      const nameKey = normalizePart(parsed.name);
      const existingName = byName.get(nameKey) ?? 0;
      if (parsed.hearts > existingName) {
        byName.set(nameKey, parsed.hearts);
      }
    }
  } catch {
    // Missing community weights file should never break summons.
  }

  return { bySeriesAndName, byName, maxHearts };
}

async function getWeightsCache(): Promise<WeightsCache> {
  if (!cachePromise) {
    cachePromise = loadWeights();
  }
  return cachePromise;
}

export async function getCommunityWeight(series: string, name: string): Promise<number> {
  const cache = await getWeightsCache();
  if (cache.maxHearts <= 0) return 1;

  const composite = cache.bySeriesAndName.get(seriesNameKey(series, name));
  if (composite) return communityBoostFromHearts(composite, cache.maxHearts);

  const byName = cache.byName.get(normalizePart(name));
  if (byName) {
    // Name-only matches are noisy (different series can share names).
    // Keep a weak fallback so we don't accidentally over-boost unrelated characters.
    const fullBoost = communityBoostFromHearts(byName, cache.maxHearts);
    return 1 + (fullBoost - 1) * 0.2;
  }

  return 1;
}
