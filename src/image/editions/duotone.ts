import sharp from "sharp";

/** Map grayscale to a two-color gradient. */
export async function generateDuotone(
  src: Buffer,
  colorA: [number, number, number] = [20, 20, 80],   // dark
  colorB: [number, number, number] = [255, 200, 100]  // light
): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize(480, 480, { fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const output = Buffer.alloc(w * h * 3);

  for (let i = 0; i < data.length; i++) {
    const t = data[i] / 255;
    const oi = i * 3;
    output[oi] = Math.round(colorA[0] * (1 - t) + colorB[0] * t);
    output[oi + 1] = Math.round(colorA[1] * (1 - t) + colorB[1] * t);
    output[oi + 2] = Math.round(colorA[2] * (1 - t) + colorB[2] * t);
  }

  return sharp(output, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}
