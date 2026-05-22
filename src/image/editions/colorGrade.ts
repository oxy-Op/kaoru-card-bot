import sharp from "sharp";

type Grade = "warm" | "cool" | "vintage" | "neon";

const GRADES: Record<Grade, { brightness?: number; saturation?: number; hue?: number; tint?: { r: number; g: number; b: number } }> = {
  warm: { brightness: 1.05, saturation: 1.2, tint: { r: 255, g: 200, b: 150 } },
  cool: { brightness: 1.0, saturation: 0.9, tint: { r: 150, g: 200, b: 255 } },
  vintage: { brightness: 0.95, saturation: 0.7, tint: { r: 230, g: 210, b: 180 } },
  neon: { brightness: 1.1, saturation: 1.8, hue: 30 },
};

/** Apply a color grade to an image. */
export async function generateColorGrade(src: Buffer, grade: Grade = "warm"): Promise<Buffer> {
  const g = GRADES[grade];

  let pipeline = sharp(src)
    .modulate({
      brightness: g.brightness,
      saturation: g.saturation,
      hue: g.hue,
    });

  if (g.tint) {
    pipeline = pipeline.tint(g.tint);
  }

  return pipeline.png().toBuffer();
}
