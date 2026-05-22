import sharp from "sharp";

/** Threshold → black silhouette on colored background. */
export async function generateSilhouette(
  src: Buffer,
  bgColor: { r: number; g: number; b: number } = { r: 180, g: 60, b: 120 }
): Promise<Buffer> {
  // Create silhouette mask
  const mask = await sharp(src)
    .resize(480, 480, { fit: "cover" })
    .grayscale()
    .threshold(128)
    .negate()
    .toBuffer();

  // Create colored background
  const bg = await sharp({
    create: { width: 480, height: 480, channels: 3, background: bgColor },
  }).png().toBuffer();

  // Composite silhouette on colored bg
  return sharp(bg)
    .composite([{ input: mask, blend: "multiply" }])
    .png()
    .toBuffer();
}
