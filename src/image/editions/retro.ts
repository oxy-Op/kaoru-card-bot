import sharp from "sharp";

/** VHS/CRT retro effect: scanlines, color bleed, slight blur, vignette. */
export async function generateRetro(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize(480, 480, { fit: "cover" })
    .modulate({ saturation: 0.8, brightness: 0.95 })
    .blur(0.5)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const output = Buffer.from(data);

  // Scanlines
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * ch;
      output[idx] = Math.floor(output[idx] * 0.7);
      output[idx + 1] = Math.floor(output[idx + 1] * 0.7);
      output[idx + 2] = Math.floor(output[idx + 2] * 0.7);
    }
  }

  // Vignette (darken corners)
  const cx = w / 2;
  const cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const factor = 1.0 - (dist / maxDist) * 0.6;
      const idx = (y * w + x) * ch;
      output[idx] = Math.floor(output[idx] * factor);
      output[idx + 1] = Math.floor(output[idx + 1] * factor);
      output[idx + 2] = Math.floor(output[idx + 2] * factor);
    }
  }

  return sharp(output, { raw: { width: w, height: h, channels: ch } })
    .png()
    .toBuffer();
}
