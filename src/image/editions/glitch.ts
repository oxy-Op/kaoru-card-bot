import sharp from "sharp";

/** Split RGB channels and offset them + add scanlines → glitch effect. */
export async function generateGlitch(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize(480, 480, { fit: "cover" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const output = Buffer.alloc(data.length);

  const rShift = 5;  // Red channel shift right
  const bShift = -4; // Blue channel shift left

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * channels;

      // Red from shifted position
      const rx = Math.min(w - 1, Math.max(0, x + rShift));
      const rIdx = (y * w + rx) * channels;
      output[idx] = data[rIdx]; // R

      // Green stays
      output[idx + 1] = data[idx + 1]; // G

      // Blue from shifted position
      const bx = Math.min(w - 1, Math.max(0, x + bShift));
      const bIdx = (y * w + bx) * channels;
      output[idx + 2] = data[bIdx + 2]; // B

      if (channels === 4) output[idx + 3] = data[idx + 3]; // A
    }

    // Random horizontal glitch lines
    if (Math.random() < 0.05) {
      const shift = Math.floor(Math.random() * 20) - 10;
      const lineLen = Math.floor(Math.random() * 3) + 1;
      for (let dy = 0; dy < lineLen && y + dy < h; dy++) {
        for (let x = 0; x < w; x++) {
          const srcX = Math.min(w - 1, Math.max(0, x + shift));
          const dstIdx = ((y + dy) * w + x) * channels;
          const srcIdx = ((y + dy) * w + srcX) * channels;
          for (let c = 0; c < channels; c++) {
            output[dstIdx + c] = data[srcIdx + c];
          }
        }
      }
    }
  }

  // Add scanlines
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * channels;
      output[idx] = Math.floor(output[idx] * 0.85);
      output[idx + 1] = Math.floor(output[idx + 1] * 0.85);
      output[idx + 2] = Math.floor(output[idx + 2] * 0.85);
    }
  }

  return sharp(output, { raw: { width: w, height: h, channels } })
    .png()
    .toBuffer();
}
