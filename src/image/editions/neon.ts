import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";

/** Edge detect → colorize edges + glow → neon effect. */
export async function generateNeon(
  src: Buffer,
  glowColor: [number, number, number] = [0, 255, 200]
): Promise<Buffer> {
  const size = 480;
  const { data } = await sharp(src)
    .resize(size, size, { fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Black background
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, size, size);

  // Edge detection + neon colorize
  const imgData = ctx.createImageData(size, size);

  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const gx =
        -data[(y - 1) * size + (x - 1)] + data[(y - 1) * size + (x + 1)] +
        -2 * data[y * size + (x - 1)] + 2 * data[y * size + (x + 1)] +
        -data[(y + 1) * size + (x - 1)] + data[(y + 1) * size + (x + 1)];

      const gy =
        -data[(y - 1) * size + (x - 1)] - 2 * data[(y - 1) * size + x] - data[(y - 1) * size + (x + 1)] +
         data[(y + 1) * size + (x - 1)] + 2 * data[(y + 1) * size + x] + data[(y + 1) * size + (x + 1)];

      const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      const t = mag / 255;

      const idx = (y * size + x) * 4;
      imgData.data[idx] = Math.floor(glowColor[0] * t);
      imgData.data[idx + 1] = Math.floor(glowColor[1] * t);
      imgData.data[idx + 2] = Math.floor(glowColor[2] * t);
      imgData.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Glow effect — blur a copy and composite
  const edgeBuffer = Buffer.from(canvas.toBuffer("image/png"));
  const blurred = await sharp(edgeBuffer).blur(3).toBuffer();

  return sharp(edgeBuffer)
    .composite([{ input: blurred, blend: "screen" }])
    .png()
    .toBuffer();
}
