import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

for (const size of [16, 32, 48, 128]) {
  await sharp(path('../../extension/icon.svg'), { density: (72 * size) / 128 })
    .resize(size, size)
    .png()
    .toFile(path(`../../extension/icons/${size}.png`));
}
