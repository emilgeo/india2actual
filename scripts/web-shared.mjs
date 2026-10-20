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

// The wordmark font holds only the letters of the name, so it is inlined as a
// data URI and the page still makes no request.
const wordmarkFont = `data:font/woff2;base64,${readFileSync(
  resolve(root, 'web/fonts/wordmark.woff2'),
).toString('base64')}`;

export async function buildCss() {
  const css = readFileSync(resolve(root, 'web/styles.css'), 'utf8').replace(
    '__WORDMARK_FONT__',
    wordmarkFont,
  );
  return (
    await transform(css, {
      loader: 'css',
      minify: true,
    })
  ).code.trim();
}

/**
 * The app for the extension, split so that no file passes the 5 MB the Firefox
 * add-on checks will read. The Actual API (SQLite engine included) becomes its
 * own chunk, loaded when the page first connects. Returns `{ name, data }` files.
 */
export async function bundleAppSplit() {
  const workers = [];
  const result = await build({
    entryPoints: { panel: resolve(root, 'web/main.tsx') },
    ...appOptions({ push: true, extension: true, worker: '' }),
    plugins: [workersAsFiles(workers)],
    format: 'esm',
    splitting: true,
    outdir: 'out',
    chunkNames: 'chunk-[hash]',
  });
  return [
    ...result.outputFiles.map(file => ({
      name: file.path.replace(/^.*[\\/]out[\\/]/, ''),
      data: Buffer.from(file.contents),
    })),
    ...workers,
  ];
}

/**
 * The Actual API starts its two workers from blob: URLs, which an extension page
 * may not do (Firefox blocks them under `script-src 'self'`). Their code is moved
 * into files beside the page and the API starts those instead. The build fails
 * if the API's code no longer looks as expected.
 */
function workersAsFiles(files) {
  return {
    name: 'workers-as-files',
    setup(b) {
      b.onLoad({ filter: /@actual-app[\\/]api[\\/]dist[\\/]browser\.js$/ }, args => {
        let source = readFileSync(args.path, 'utf8');

        const idb = /\bs = o\("([A-Za-z0-9+/=]+)", [^,]+, [^)]+\)/.exec(source);
        const loader = source.indexOf(', L = typeof self < "u" && self.Blob');
        const start = source.lastIndexOf('I = "', loader);
        const fnStart = source.indexOf('function R(e) {', start);
        const fnEnd = source.indexOf('\n}\n', fnStart) + 3;
        if (!idb || loader < 0 || start < 0 || fnStart < 0 || fnEnd < fnStart) {
          throw new Error('The Actual API worker code changed; update workersAsFiles in scripts/web-shared.mjs.');
        }

        const backend = new Function(`return ${source.slice(start + 4, loader)}`)();
        files.push(
          { name: 'actual-worker.js', data: Buffer.from(backend) },
          { name: 'actual-idb-worker.js', data: Buffer.from(idb[1], 'base64') },
        );

        source =
          source.slice(0, start) +
          'I = "";\n' +
          "function R(e) { return new Worker('actual-worker.js', { name: e?.name }); }\n" +
          source.slice(fnEnd);
        source = source.replace(
          idb[0],
          "s = function (options) { return new Worker('actual-idb-worker.js', options); }",
        );
        return { contents: source, loader: 'js' };
      });
    },
  };
}

/** The app as one script. `push` carries the Actual API, `extension` is for the side panel. */
export async function bundleApp({ push, extension = false, worker }) {
  const result = await build({
    entryPoints: [resolve(root, 'web/main.tsx')],
    ...appOptions({ push, extension, worker }),
    format: 'iife',
  });
  return result.outputFiles[0]?.text ?? '';
}

function appOptions({ push, extension, worker }) {
  return {
    bundle: true,
    write: false,
    platform: 'browser',
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
  };
}
