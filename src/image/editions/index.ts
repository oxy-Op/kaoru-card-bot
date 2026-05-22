import { generatePixelArt } from "./pixelArt.js";
import { generateSketch } from "./sketch.js";
import { generateColorGrade } from "./colorGrade.js";
import { generateGlitch } from "./glitch.js";
import { generateDuotone } from "./duotone.js";
import { generateSilhouette } from "./silhouette.js";
import { generateRetro } from "./retro.js";
import { generateNeon } from "./neon.js";
import { generateFilmGrain } from "./filmGrain.js";
import { generateHalftone } from "./halftone.js";
import { generateWatercolor } from "./watercolor.js";
import sharp from "sharp";

export type EditionType =
  | "pixel_art" | "sketch" | "color_grade" | "glitch"
  | "duotone" | "silhouette" | "retro" | "neon" | "negative" | "cinematic"
  | "film_grain" | "halftone" | "watercolor";

const generators: Record<EditionType, (src: Buffer) => Promise<Buffer>> = {
  pixel_art: generatePixelArt,
  sketch: generateSketch,
  color_grade: (src) => generateColorGrade(src, "warm"),
  glitch: generateGlitch,
  duotone: (src) => generateDuotone(src),
  silhouette: (src) => generateSilhouette(src),
  retro: generateRetro,
  neon: (src) => generateNeon(src),
  negative: (src) => sharp(src).negate({ alpha: false }).png().toBuffer(),
  cinematic: (src) =>
    sharp(src)
      .resize(480, 270, { fit: "cover" }) // Letterbox crop
      .extend({ top: 105, bottom: 105, background: { r: 0, g: 0, b: 0 } })
      .modulate({ saturation: 0.8 })
      .tint({ r: 100, g: 180, b: 200 }) // Teal-orange grade
      .png()
      .toBuffer(),
  film_grain: generateFilmGrain,
  halftone: generateHalftone,
  watercolor: generateWatercolor,
};

/** Generate a specific edition type from a source image. */
export async function generateEdition(src: Buffer, type: EditionType): Promise<Buffer> {
  const gen = generators[type];
  if (!gen) throw new Error(`Unknown edition type: ${type}`);
  return gen(src);
}

/** List of all available edition types. */
export const EDITION_TYPES: EditionType[] = Object.keys(generators) as EditionType[];

/** Pick N random edition types (excluding given ones). */
export function pickRandomEditions(count: number, exclude: EditionType[] = []): EditionType[] {
  const available = EDITION_TYPES.filter((t) => !exclude.includes(t));
  const shuffled = available.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
