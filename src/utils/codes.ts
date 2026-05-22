import { nanoid, customAlphabet } from "nanoid";

// Card codes: 6 char alphanumeric, no ambiguous characters (0/O, 1/l/I)
const CARD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const generateCode = customAlphabet(CARD_ALPHABET, 6);

/** Generate a unique card code. */
export function newCardCode(): string {
  return generateCode();
}

/** Generate a unique summon event ID. */
export function newSummonId(): string {
  return nanoid(12);
}

/**
 * Weighted random selection from an array.
 * Each item has a `weight` field — higher weight = more likely to be selected.
 */
export function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }

  // Fallback (shouldn't happen)
  return items[items.length - 1];
}

/**
 * Roll card quality at summon time.
 * Distribution: good 55%, excellent 25%, pristine 10%, poor 8%, damaged 2%
 */
export function rollQuality(pristineBoost: number = 0): "damaged" | "poor" | "good" | "excellent" | "pristine" {
  const roll = Math.random();
  const pristineThreshold = 0.90 - pristineBoost; // lower = more pristine
  if (roll < 0.02) return "damaged";
  if (roll < 0.10) return "poor";
  if (roll < 0.65) return "good";
  if (roll < pristineThreshold) return "excellent";
  return "pristine";
}

/** Quality display: star rating. */
export function qualityStars(quality: string): string {
  const map: Record<string, string> = {
    damaged: "☆☆☆☆☆",
    poor: "★☆☆☆☆",
    good: "★★★☆☆",
    excellent: "★★★★☆",
    pristine: "★★★★★",
  };
  return map[quality] ?? "★★★☆☆";
}

/**
 * Roll a weighted random print number where low prints are rare.
 * Uses a power distribution: P(print <= x% of range) ≈ x^4.
 *   ~0.01% chance of bottom 10%, ~0.81% chance of bottom 30%,
 *   ~6.25% chance of bottom 50%. Most prints land in the top 30%.
 *
 * @param takenPrints - set of already-issued print numbers
 * @param maxPrints   - hard cap (for limited editions), or null for unlimited
 */
export function rollPrintNumber(
  takenPrints: Set<number>,
  maxPrints: number | null
): number {
  const DEFAULT_UNLIMITED_PRINT_POOL = 5000;
  const upperBound = maxPrints ?? DEFAULT_UNLIMITED_PRINT_POOL;

  const bands = [
    { min: 1, max: 9, weight: 0.001 },       // Extremely rare
    { min: 10, max: 25, weight: 0.005 },     // Very rare
    { min: 26, max: 100, weight: 0.03 },     // Rare
    { min: 101, max: 300, weight: 0.09 },    // Uncommon
    { min: 301, max: 1000, weight: 0.22 },   // Common-ish
    { min: 1001, max: upperBound, weight: 0.652 }, // Most drops
  ];

  const availableBands = bands
    .map((band) => {
      const max = Math.min(band.max, upperBound);
      if (band.min > max) return null;
      const available: number[] = [];
      for (let n = band.min; n <= max; n++) {
        if (!takenPrints.has(n)) available.push(n);
      }
      const rangeSize = max - band.min + 1;
      const availabilityRatio = rangeSize > 0 ? available.length / rangeSize : 0;
      return {
        available,
        weight: band.weight * availabilityRatio,
      };
    })
    .filter((band): band is { available: number[]; weight: number } => !!band && band.available.length > 0);

  if (availableBands.length > 0) {
    const totalWeight = availableBands.reduce((sum, band) => sum + Math.max(band.weight, 0), 0);
    if (totalWeight > 0) {
      let roll = Math.random() * totalWeight;
      for (const band of availableBands) {
        roll -= band.weight;
        if (roll <= 0) {
          return band.available[Math.floor(Math.random() * band.available.length)];
        }
      }
      const fallbackBand = availableBands[availableBands.length - 1];
      return fallbackBand.available[Math.floor(Math.random() * fallbackBand.available.length)];
    }
  }

  // All slots in range taken — extend beyond (shouldn't happen for unlimited)
  let overflow = upperBound + 1;
  while (takenPrints.has(overflow)) overflow++;
  return overflow;
}

/** Format a print number with hash. */
export function formatPrint(print: number): string {
  return `#${print}`;
}

/** Format an edition number. */
export function formatEdition(edition: number): string {
  return `ED${edition}`;
}
