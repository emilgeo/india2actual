// What the page builds share: the PDF reader's worker, the styles and the
// bundling of the app itself.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, transform } from 'esbuild';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const packageVersion = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
).version;

export const actualApiVersion = JSON.parse(
  readFileSync(resolve(root, 'node_modules/@actual-app/api/package.json'), 'utf8'),
).version;

/** A Content-Security-Policy source for exactly this text. */
export const hash = text =>
  `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

// The PDF reader's worker ships as a module, which a page opened from disk
// cannot start from a Blob. Bundled into a classic script it starts anywhere.
export async function buildWorker() {
  const result = await build({
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
  return result.outputFiles[0]?.text ?? '';
}

export async function buildCss() {
  return (
    await transform(readFileSync(resolve(root, 'web/styles.css'), 'utf8'), {
      loader: 'css',
      minify: true,
    })
  ).code.trim();
}

/** The app as one script. `push` carries the Actual API, `extension` is for the side panel. */
export async function bundleApp({ push, extension = false, worker }) {
  const result = await build({
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
      ...(push ? {} : { '@actual-app/api': resolve(root, 'web/push/no-api.ts') }),
    },
    define: {
      __VERSION__: JSON.stringify(packageVersion),
      __PDF_WORKER__: JSON.stringify(worker),
      __PUSH__: String(push),
      __EXTENSION__: String(extension),
      __ACTUAL_API_VERSION__: JSON.stringify(actualApiVersion),
    },
  });
  return result.outputFiles[0]?.text ?? '';
}
