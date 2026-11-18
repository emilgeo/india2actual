import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script without type declarations
import { syncReadme } from './sync-actual-version.mjs';

function project(locked: string | null, readme: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-actual-'));
  const packages = locked ? { 'node_modules/@actual-app/api': { version: locked } } : {};
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages }));
  writeFileSync(join(dir, 'README.md'), readme);
  return dir;
}

describe('syncReadme', () => {
  it('rewrites the tested version to the locked one', () => {
    const dir = project('30.2.1', 'Intro\n\nTested against Actual 30.1.0.\n');
    expect(syncReadme(dir)).toEqual({ changed: true, version: '30.2.1' });
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('Intro\n\nTested against Actual 30.2.1.\n');
  });

  it('leaves the file alone when it already matches', () => {
    const dir = project('30.2.1', 'Tested against Actual 30.2.1.\n');
    expect(syncReadme(dir)).toEqual({ changed: false, version: '30.2.1' });
  });

  it('does not write in check mode', () => {
    const dir = project('30.2.1', 'Tested against Actual 30.1.0.\n');
    expect(syncReadme(dir, { write: false })).toEqual({ changed: true, version: '30.2.1' });
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('30.1.0');
  });

  it('fails when the package is not locked or the README has no line', () => {
    expect(() => syncReadme(project(null, 'Tested against Actual 1.0.0.'))).toThrow('not in package-lock.json');
    expect(() => syncReadme(project('1.0.0', 'No line here.'))).toThrow('no "Tested against Actual" line');
  });
});

describe('this repository', () => {
  it('names the locked Actual version in the README', () => {
    const root = new URL('..', import.meta.url).pathname;
    expect(syncReadme(root, { write: false }).changed).toBe(false);
  });
});
