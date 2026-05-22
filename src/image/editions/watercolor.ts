import sharp from "sharp";

/**
 * Watercolor effect: heavy blur + boost saturation + posterize.
 * Creates a soft, painted look with visible color patches.
 */
export async function generateWatercolor(src: Buffer): Promise<Buffer> {
  // Step 1: Blur + boost saturation for the "wet paint" look
  const soft = await sharp(src)
    .resize(480, 480, { fit: "cover" })
    .blur(4)
    .modulate({ saturation: 1.6, brightness: 1.05 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = soft.info.width;
  const h = soft.info.height;
  const ch = soft.info.channels;
  const output = Buffer.from(soft.data);

  // Step 2: Posterize — reduce color depth for "painted" patches
  const levels = 8;
  const step = 255 / levels;
  for (let i = 0; i < output.length; i++) {
    if (ch === 4 && i % 4 === 3) continue; // Skip alpha
    output[i] = Math.round(output[i] / step) * step;
  }

  // Step 3: Add slight paper texture noise
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * ch;
      const noise = (Math.random() - 0.5) * 12;
      output[idx] = Math.min(255, Math.max(0, output[idx] + noise));
      output[idx + 1] = Math.min(255, Math.max(0, output[idx + 1] + noise));
      output[idx + 2] = Math.min(255, Math.max(0, output[idx + 2] + noise));
    }
  }

  return sharp(output, { raw: { width: w, height: h, channels: ch } })
    .blur(1.5) // Final soft pass
    .png()
    .toBuffer();
}
