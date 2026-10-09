import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/** Build the pages and the extension once, before any test opens them. */
export default function globalSetup(): void {
  const root = resolve(import.meta.dirname, '..', '..');
  for (const script of ['build-web.mjs', 'build-extension.mjs']) {
    execFileSync(process.execPath, [join(root, 'scripts', script)], {
      cwd: root,
      stdio: 'ignore',
    });
  }
}
