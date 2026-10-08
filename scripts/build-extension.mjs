// Builds the side panel extension into dist-extension/ and a zip of it.
//
// The page is the push page, as separate files because an extension page may
// not carry inline script. `--firefox` builds the sidebar variant instead.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { manifestFor } from './extension-manifest.mjs';
import { pngIcon, zip } from './pack.mjs';
import { buildCss, buildWorker, bundleApp, packageVersion, root } from './web-shared.mjs';

const target = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const outDir = resolve(root, target === 'firefox' ? 'dist-extension-firefox' : 'dist-extension');

const worker = await buildWorker();
const files = [
  { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifestFor(packageVersion, target), null, 2)}\n`) },
  { name: 'background.js', data: readFileSync(resolve(root, 'extension/background.js')) },
  { name: 'panel.html', data: readFileSync(resolve(root, 'extension/panel.html')) },
  { name: 'panel.css', data: Buffer.from(await buildCss()) },
  { name: 'panel.js', data: Buffer.from(await bundleApp({ push: true, extension: true, worker })) },
  ...[16, 32, 48, 128].map(size => ({ name: `icons/${size}.png`, data: pngIcon(size) })),
];

rmSync(outDir, { recursive: true, force: true });
for (const { name, data } of files) {
  const path = resolve(outDir, name);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, data);
}
const archive = resolve(outDir, 'India2Actual-extension.zip');
writeFileSync(archive, zip(files));

const size = files.reduce((sum, file) => sum + file.data.length, 0);
console.log(`${outDir} (${target}), ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log(archive);
