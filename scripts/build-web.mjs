// Builds the browser converter into one self-contained HTML file.
//
// Everything (code, styles, the PDF reader and its worker) is inlined, so the
// page needs no network. The Content-Security-Policy is written from hashes of
// that exact code and forbids every request, which is what lets the page
// promise that a statement never leaves the browser.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-web', 'convert.html');

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
  // Browser builds of the CSV libraries, which carry their own Buffer.
  alias: {
    'csv-parse/sync': 'csv-parse/browser/esm/sync',
    'csv-stringify/sync': 'csv-stringify/browser/esm/sync',
  },
  define: {
    __VERSION__: JSON.stringify(manifest.version),
    __PDF_WORKER__: JSON.stringify(worker),
  },
});

// A closing script tag inside the code would end the inline script early.
const js = (bundle.outputFiles[0]?.text ?? '').replaceAll('</script', '<\\/script');
const css = (
  await transform(readFileSync(resolve(root, 'web/styles.css'), 'utf8'), {
    loader: 'css',
    minify: true,
  })
).code.trim();

const hash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

const policy = [
  "default-src 'none'",
  `script-src ${hash(js)}`,
  `style-src ${hash(css)}`,
  // PDF.js starts its reader from a Blob.
  'worker-src blob:',
  "img-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const html = readFileSync(resolve(root, 'web/index.template.html'), 'utf8')
  .replace('__CSP__', policy)
  .replace('__CSS__', () => css)
  .replace('__JS__', () => js);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);

const sha = createHash('sha256').update(html).digest('hex');
console.log(`${out}`);
console.log(`${(html.length / 1024 / 1024).toFixed(2)} MB, sha256 ${sha}`);
