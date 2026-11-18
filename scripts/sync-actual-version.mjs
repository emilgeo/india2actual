// Keeps the "Tested against Actual" line in the README in step with the
// @actual-app/api version locked in package-lock.json. Run by the
// readme-actual-version workflow on a Dependabot pull request.
//
// Usage: node scripts/sync-actual-version.mjs [project directory]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LINE = /(Tested against Actual )\d+\.\d+(?:\.\d+)?/;

/** Updates README.md under `root` to the locked version; `write: false` only reports. */
export function syncReadme(root, { write = true } = {}) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const locked = lock.packages?.['node_modules/@actual-app/api']?.version;
  if (!locked) {
    throw new Error('@actual-app/api is not in package-lock.json');
  }

  const readmePath = join(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  if (!LINE.test(readme)) {
    throw new Error('README.md has no "Tested against Actual" line to update');
  }

  const updated = readme.replace(LINE, (_, prefix) => prefix + locked);
  if (updated === readme) {
    return { changed: false, version: locked };
  }
  if (write) {
    writeFileSync(readmePath, updated);
  }
  return { changed: true, version: locked };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url));
  const { changed, version } = syncReadme(root);
  console.log(changed ? `README now says Actual ${version}` : `README already says Actual ${version}`);
}
