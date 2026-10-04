import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

await sharp(path('./og-image.svg'))
  .resize(1200, 630)
  .png()
  .toFile(path('../public/og-image.png'));
