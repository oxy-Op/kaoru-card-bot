import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Manga/halftone edition: grayscale → screentone dot pattern.
 * Mimics printed manga panels with halftone shading.
 */
export async function generateHalftone(src: Buffer): Promise<Buffer> {
  const size = 480;
  const dotSpacing = 6; // Distance between dot centers
  const maxRadius = dotSpacing / 2 - 0.5;

  const { data } = await sharp(src)
    .resize(size, size, { fit: "cover" })
    .grayscale()
    .sharpen({ sigma: 1.5 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // White background (like manga paper)
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#000000";

  // Draw halftone dots — darker areas get bigger dots
  for (let gy = 0; gy < size; gy += dotSpacing) {
    for (let gx = 0; gx < size; gx += dotSpacing) {
      // Sample average brightness in this cell
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < dotSpacing && gy + dy < size; dy++) {
        for (let dx = 0; dx < dotSpacing && gx + dx < size; dx++) {
          sum += data[(gy + dy) * size + (gx + dx)];
          count++;
        }
      }
      const brightness = sum / count / 255; // 0 = black, 1 = white
      const darkness = 1 - brightness;

      // Radius proportional to darkness
      const radius = darkness * maxRadius;
      if (radius > 0.3) {
        ctx.beginPath();
        ctx.arc(gx + dotSpacing / 2, gy + dotSpacing / 2, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return Buffer.from(canvas.toBuffer("image/png"));
}
