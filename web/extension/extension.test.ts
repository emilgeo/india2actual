import { inflateRawSync, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { EXTENSION_POLICY, manifestFor } from '../../scripts/extension-manifest.mjs';
import { crc32, pngIcon, zip } from '../../scripts/pack.mjs';

import { accountFromUrl, pickTab } from './follow.js';

const ORIGIN = 'https://actual.example.test';

describe('accountFromUrl', () => {
  it('reads the account from an account screen of the same server', () => {
    expect(accountFromUrl(`${ORIGIN}/accounts/abc-123`, ORIGIN)).toBe('abc-123');
    expect(accountFromUrl(`${ORIGIN}/accounts/abc-123/`, ORIGIN)).toBe('abc-123');
    expect(accountFromUrl(`${ORIGIN}/accounts/abc-123?month=2025-03`, ORIGIN)).toBe('abc-123');
  });

  it('is null for screens that name no account, other servers and non-addresses', () => {
    expect(accountFromUrl(`${ORIGIN}/accounts`, ORIGIN)).toBeNull();
    expect(accountFromUrl(`${ORIGIN}/budget`, ORIGIN)).toBeNull();
    expect(accountFromUrl('https://other.example.test/accounts/abc', ORIGIN)).toBeNull();
    expect(accountFromUrl('not an address', ORIGIN)).toBeNull();
  });

  it('matches a server on this computer whatever the port', () => {
    expect(accountFromUrl('http://localhost:5006/accounts/x1', 'http://localhost:5006')).toBe('x1');
    expect(accountFromUrl('http://localhost:5007/accounts/x1', 'http://localhost:5006')).toBeNull();
  });
});

describe('pickTab', () => {
  it('prefers the active tab, then the most recently used', () => {
    const tabs = [
      { url: 'a', lastAccessed: 5 },
      { url: 'b', lastAccessed: 9 },
      { url: 'c', active: true, lastAccessed: 1 },
    ];

    expect(pickTab(tabs)?.url).toBe('c');
    expect(pickTab(tabs.slice(0, 2))?.url).toBe('b');
    expect(pickTab([])).toBeUndefined();
  });
});

describe('the extension manifest', () => {
  const manifest = manifestFor('1.2.3');

  it('asks for as little as it can', () => {
    expect(manifest.permissions).toEqual(['sidePanel']);
    expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
    expect(manifest.version).toBe('1.2.3');
  });

  it('has a policy with no inline script, no eval and no remote code', () => {
    expect(EXTENSION_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(EXTENSION_POLICY).not.toContain('unsafe-inline');
    expect(EXTENSION_POLICY).not.toMatch(/'unsafe-eval'/);
    // A blob: worker source makes the browser refuse the whole extension.
    expect(EXTENSION_POLICY).not.toContain('blob:');
    expect(EXTENSION_POLICY).toContain('connect-src https: http://localhost:*');
    expect(manifest.content_security_policy.extension_pages).toBe(EXTENSION_POLICY);
  });

  it('opens the side panel on Chrome and a sidebar on Firefox', () => {
    expect(manifest.side_panel).toEqual({ default_path: 'panel.html' });
    expect(manifest.background).toEqual({ service_worker: 'background.js' });

    const firefox = manifestFor('1.2.3', 'firefox');
    expect(firefox.sidebar_action?.default_panel).toBe('panel.html');
    expect(firefox.background).toEqual({ scripts: ['background.js'] });
    expect(firefox.side_panel).toBeUndefined();
    expect(firefox.permissions).toBeUndefined();
  });
});

describe('the file writers', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('writes a zip whose files can be read back', () => {
    const archive = zip([
      { name: 'a.txt', data: Buffer.from('hello hello hello') },
      { name: 'dir/b.txt', data: Buffer.from('world') },
    ]);

    // End of central directory: two entries.
    const end = archive.length - 22;
    expect(archive.readUInt32LE(end)).toBe(0x06054b50);
    expect(archive.readUInt16LE(end + 10)).toBe(2);

    // First local header: name, then deflated data that inflates to the text.
    const nameLength = archive.readUInt16LE(26);
    const size = archive.readUInt32LE(18);
    expect(archive.subarray(30, 30 + nameLength).toString()).toBe('a.txt');
    const body = archive.subarray(30 + nameLength, 30 + nameLength + size);
    expect(inflateRawSync(body).toString()).toBe('hello hello hello');
  });

  it('draws a valid square PNG icon', () => {
    const png = pngIcon(32);

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
    const idat = png.indexOf('IDAT');
    const length = png.readUInt32BE(idat - 4);
    expect(inflateSync(png.subarray(idat + 4, idat + 4 + length)).length).toBe(32 * (32 * 4 + 1));
  });
});
