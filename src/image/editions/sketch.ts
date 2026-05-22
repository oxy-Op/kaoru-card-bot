import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";

/** Grayscale → edge detection → invert → sketch effect. */
export async function generateSketch(src: Buffer): Promise<Buffer> {
  // Grayscale + sharpen edges
  const gray = await sharp(src)
    .grayscale()
    .sharpen({ sigma: 2 })
    .toBuffer();

  // Get raw pixels for Sobel edge detection
  const { data, info } = await sharp(gray)
    .resize(480, 480, { fit: "cover" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.createImageData(w, h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      // Sobel kernels
      const gx =
        -data[(y - 1) * w + (x - 1)] - 2 * data[y * w + (x - 1)] - data[(y + 1) * w + (x - 1)] +
         data[(y - 1) * w + (x + 1)] + 2 * data[y * w + (x + 1)] + data[(y + 1) * w + (x + 1)];

      const gy =
        -data[(y - 1) * w + (x - 1)] - 2 * data[(y - 1) * w + x] - data[(y - 1) * w + (x + 1)] +
         data[(y + 1) * w + (x - 1)] + 2 * data[(y + 1) * w + x] + data[(y + 1) * w + (x + 1)];

      const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      const inverted = 255 - magnitude; // White bg, dark edges

      const idx = (y * w + x) * 4;
      imgData.data[idx] = inverted;
      imgData.data[idx + 1] = inverted;
      imgData.data[idx + 2] = inverted;
      imgData.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return Buffer.from(canvas.toBuffer("image/png"));
}
