// Builds the browser converter into self-contained HTML files.
//
// Everything (code, styles, the PDF reader and its worker) is inlined, so the
// page needs no network. The Content-Security-Policy is written from hashes of
// that exact code. The convert page forbids every request, which is what lets
// it promise that a statement never leaves the browser. The push page also
// carries the Actual API and may reach an https server, or one on this
// computer, and nothing else.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist-web');

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
// The PDF reader's worker ships as a module, which a page opened from disk
// cannot start from a Blob. Bundled into a classic script it starts anywhere.
const workerBuild = await build({
  entryPoints: [
    resolve(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  // Only used to find optional files that a single-file page does not have.
  define: { 'import.meta.url': '""' },
  logLevel: 'warning',
});
const worker = workerBuild.outputFiles[0]?.text ?? '';

const actualApiVersion = JSON.parse(
  readFileSync(resolve(root, 'node_modules/@actual-app/api/package.json'), 'utf8'),
).version;

const css = (
  await transform(readFileSync(resolve(root, 'web/styles.css'), 'utf8'), {
    loader: 'css',
    minify: true,
  })
).code.trim();

const hash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

const variants = [
  {
    file: 'India2Actual-convert.html',
    push: false,
    policy: js => [
      "default-src 'none'",
      `script-src ${hash(js)}`,
      `style-src ${hash(css)}`,
      // PDF.js starts its reader from a Blob.
      'worker-src blob:',
      "img-src 'none'",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ],
  },
  {
    file: 'India2Actual.html',
    push: true,
    policy: js => [
      "default-src 'none'",
      // The Actual API runs SQLite compiled to WebAssembly.
      `script-src ${hash(js)} 'wasm-unsafe-eval'`,
      `style-src ${hash(css)}`,
      'worker-src blob:',
      "img-src 'none'",
      // An https server, or one on this computer. Actual needs the same.
      'connect-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*',
      "form-action 'none'",
      "base-uri 'none'",
    ],
  },
];

mkdirSync(outDir, { recursive: true });
const sums = [];

for (const variant of variants) {
  const bundle = await build({
    entryPoints: [resolve(root, 'web/main.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    logLevel: 'warning',
    alias: {
      // Browser builds of the CSV libraries, which carry their own Buffer.
      'csv-parse/sync': 'csv-parse/browser/esm/sync',
      'csv-stringify/sync': 'csv-stringify/browser/esm/sync',
      // The page that cannot push carries none of the Actual API.
      ...(variant.push
        ? {}
        : { '@actual-app/api': resolve(root, 'web/push/no-api.ts') }),
    },
    define: {
      __VERSION__: JSON.stringify(manifest.version),
      __PDF_WORKER__: JSON.stringify(worker),
      __PUSH__: String(variant.push),
      __ACTUAL_API_VERSION__: JSON.stringify(actualApiVersion),
    },
  });

  // A closing script tag inside the code would end the inline script early.
  const js = (bundle.outputFiles[0]?.text ?? '').replaceAll(
    '</script',
    '<\\/script',
  );

  const html = readFileSync(resolve(root, 'web/index.template.html'), 'utf8')
    .replace('__CSP__', variant.policy(js).join('; '))
    .replace('__CSS__', () => css)
    .replace('__JS__', () => js);

  writeFileSync(resolve(outDir, variant.file), html);
  const sha = createHash('sha256').update(html).digest('hex');
  sums.push(`${sha}  ${variant.file}`);
  console.log(`${variant.file}: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
}

writeFileSync(resolve(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(sums.join('\n'));
