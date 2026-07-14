import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

export function assertSharePng(png, label = "share preview") {
  const image = decodePng(Buffer.from(png));
  if (image.width !== 1200 || image.height !== 630) throw new Error(`${label} must be a 1200x630 PNG`);

  // This rectangle contains only the dynamic title. Decorations start to its
  // right, so a missing font cannot hide behind a dimension-only PNG check.
  let darkTitlePixels = 0;
  for (let y = 190; y < 365; y += 1) {
    for (let x = 48; x < 670; x += 1) {
      const offset = (y * image.width + x) * 4;
      const [red, green, blue, alpha] = image.rgba.subarray(offset, offset + 4);
      if (alpha > 220 && red < 90 && green < 90 && blue < 90) darkTitlePixels += 1;
    }
  }
  if (darkTitlePixels < 600) {
    throw new Error(`${label} has no rendered title text (${darkTitlePixels} dark title pixels)`);
  }
  return { width: image.width, height: image.height, darkTitlePixels };
}

function decodePng(png) {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG signature");
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const compressed = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0 || !compressed.length) {
    throw new Error("Unsupported PNG encoding");
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(compressed));
  if (inflated.length !== (rowBytes + 1) * height) throw new Error("Invalid PNG scanline length");
  const decoded = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const inputOffset = y * (rowBytes + 1);
    const filter = inflated[inputOffset];
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset + 1 + x];
      const left = x >= bytesPerPixel ? decoded[y * rowBytes + x - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[(y - 1) * rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? decoded[(y - 1) * rowBytes + x - bytesPerPixel] : 0;
      const value = filter === 0 ? raw
        : filter === 1 ? raw + left
          : filter === 2 ? raw + up
            : filter === 3 ? raw + Math.floor((left + up) / 2)
              : filter === 4 ? raw + paeth(left, up, upperLeft)
                : Number.NaN;
      if (!Number.isFinite(value)) throw new Error(`Unsupported PNG filter ${filter}`);
      decoded[y * rowBytes + x] = value & 0xff;
    }
  }

  if (colorType === 6) return { width, height, rgba: decoded };
  const rgba = Buffer.alloc(width * height * 4);
  for (let source = 0, target = 0; source < decoded.length; source += 3, target += 4) {
    rgba[target] = decoded[source];
    rgba[target + 1] = decoded[source + 1];
    rgba[target + 2] = decoded[source + 2];
    rgba[target + 3] = 255;
  }
  return { width, height, rgba };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node scripts/check-share-png.mjs <png-file>");
  console.log(JSON.stringify(assertSharePng(readFileSync(file), path.basename(file))));
}
