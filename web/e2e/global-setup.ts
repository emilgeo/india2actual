import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/** Build both pages once, before any test opens them. */
export default function globalSetup(): void {
  const root = resolve(import.meta.dirname, '..', '..');
  execFileSync(process.execPath, [join(root, 'scripts/build-web.mjs')], {
    cwd: root,
    stdio: 'ignore',
  });
}
