import sharp from "sharp";

/** Add film grain noise + slight desaturation + warm tint + vignette. */
export async function generateFilmGrain(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize(480, 480, { fit: "cover" })
    .modulate({ saturation: 0.85 })
    .tint({ r: 240, g: 220, b: 200 }) // Warm analog tint
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const output = Buffer.from(data);

  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * ch;

      // Film grain: random noise ±15
      const noise = (Math.random() - 0.5) * 30;
      output[idx] = Math.min(255, Math.max(0, output[idx] + noise));
      output[idx + 1] = Math.min(255, Math.max(0, output[idx + 1] + noise));
      output[idx + 2] = Math.min(255, Math.max(0, output[idx + 2] + noise));

      // Vignette
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const vignette = 1.0 - (dist / maxDist) * 0.5;
      output[idx] = Math.floor(output[idx] * vignette);
      output[idx + 1] = Math.floor(output[idx + 1] * vignette);
      output[idx + 2] = Math.floor(output[idx + 2] * vignette);
    }
  }

  return sharp(output, { raw: { width: w, height: h, channels: ch } })
    .png()
    .toBuffer();
}
