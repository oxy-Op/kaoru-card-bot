/**
 * Game character data sources.
 * These use static JSON/API endpoints to fetch character info + splash art.
 */

// ─── Genshin Impact (via Enka / genshin.jmp.blue) ──────

const GENSHIN_API = "https://genshin.jmp.blue";

interface GenshinCharacter {
  name: string;
  rarity: number;
  element: string;
  weapon: string;
  imageUrl: string;
  fallbackUrls?: string[];
}

export async function fetchGenshinCharacters(): Promise<GenshinCharacter[]> {
  const res = await fetch(`${GENSHIN_API}/characters`);
  if (!res.ok) return [];

  const names = (await res.json()) as string[];
  const characters: GenshinCharacter[] = [];

  for (const name of names) {
    try {
      const detailRes = await fetch(`${GENSHIN_API}/characters/${name}`);
      if (!detailRes.ok) continue;

      const detail = (await detailRes.json()) as any;
      // Try gacha-splash first, fallback to portrait, then icon
      const imageUrls = [
        `${GENSHIN_API}/characters/${name}/gacha-splash`,
        `${GENSHIN_API}/characters/${name}/portrait`,
        `${GENSHIN_API}/characters/${name}/icon-big`,
      ];

      characters.push({
        name: detail.name ?? name,
        rarity: detail.rarity ?? 4,
        element: detail.vision ?? "Unknown",
        weapon: detail.weapon ?? "Unknown",
        imageUrl: imageUrls[0],
        fallbackUrls: imageUrls.slice(1),
      });

      await new Promise((r) => setTimeout(r, 200)); // gentle rate limit
    } catch {
      continue;
    }
  }

  return characters;
}

// ─── Wuthering Waves (via wuwa-api) ────────────────────

// ─── Wuthering Waves (via resonance-rest API) ──────────

const WUWA_API = "https://api.resonance.rest/v2";

interface WuwaCharacter {
  name: string;
  rarity: number;
  element: string;
  imageUrl: string;
}

export async function fetchWuwaCharacters(): Promise<WuwaCharacter[]> {
  // Try multiple API endpoints
  const endpoints = [
    `${WUWA_API}/characters`,
    "https://wuwa-api.vercel.app/api/resonators",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;

      const data = (await res.json()) as any;
      const chars = Array.isArray(data) ? data : (data.data ?? []);
      if (!Array.isArray(chars) || chars.length === 0) continue;

      return chars.map((c: any) => ({
        name: c.name ?? c.Name,
        rarity: c.rarity ?? c.Rarity ?? 4,
        element: c.element ?? c.attribute ?? c.Element ?? "Unknown",
        imageUrl: c.images?.icon ?? c.icon ?? c.splashArt ?? c.image ?? "",
      })).filter((c: WuwaCharacter) => c.name && c.imageUrl);
    } catch {
      continue;
    }
  }

  return [];
}

// ─── Honkai: Star Rail (via enka.network assets) ────────

const HSR_API = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master";

interface HSRCharacter {
  name: string;
  rarity: number;
  element: string;
  imageUrl: string;
}

export async function fetchHSRCharacters(): Promise<HSRCharacter[]> {
  try {
    const res = await fetch(`${HSR_API}/index_min/en/characters.json`);
    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, any>;
    return Object.values(data).map((c: any) => ({
      name: c.name,
      rarity: c.rarity ?? 4,
      element: c.element ?? "Unknown",
      imageUrl: `${HSR_API}/image/character_portrait/${c.id}.png`,
    })).filter((c: HSRCharacter) => c.name && !c.name.startsWith("{"));
  } catch {
    return [];
  }
}

// ─── Download a game character's splash image ───────────

export async function downloadGameImage(url: string, fallbacks?: string[]): Promise<Buffer | null> {
  const urls = [url, ...(fallbacks ?? [])];
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) continue;
      return buf;
    } catch {
      continue;
    }
  }
  return null;
}
