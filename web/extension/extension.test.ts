import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { EXTENSION_POLICY, manifestFor } from '../../scripts/extension-manifest.mjs';
import { crc32, zip } from '../../scripts/pack.mjs';
import { bundleAppSplit } from '../../scripts/web-shared.mjs';

import { accountFromUrl, hostPattern, pickTab } from './follow.js';

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

describe('hostPattern', () => {
  it('names the host without a port, which Firefox match patterns reject', () => {
    expect(hostPattern('http://localhost:5006')).toBe('http://localhost/*');
    expect(hostPattern('https://actual.example.test')).toBe('https://actual.example.test/*');
    expect(hostPattern('https://actual.example.test:8443')).toBe('https://actual.example.test/*');
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
    expect(firefox.action?.default_title).toBe('Open india2actual');
  });

  it('declares on Firefox that no data is collected', () => {
    const gecko = manifestFor('1.2.3', 'firefox').browser_specific_settings?.gecko;
    expect(gecko?.data_collection_permissions).toEqual({ required: ['none'] });
    expect(gecko?.strict_min_version).toBe('142.0');
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
});

describe('the icons', () => {
  it.each([16, 32, 48, 128])('has a square %i px PNG', size => {
    const png = readFileSync(new URL(`../../extension/icons/${size}.png`, import.meta.url));

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  });
});

describe('the extension bundle', () => {
  it('starts the Actual workers from files, since extension pages may not use blob: workers', async () => {
    const files = await bundleAppSplit();
    const names = files.map(file => file.name);

    expect(names).toContain('actual-worker.js');
    expect(names).toContain('actual-idb-worker.js');
    for (const { name, data } of files) {
      const text = data.toString();
      // The blob bootstrap of the backend worker, and the base64 of the IndexedDB worker.
      expect(text, name).not.toContain('revokeObjectURL(self.location.href)');
      expect(text, name).not.toContain('Lyogcm9sbHVwLXBsdWdpbi13ZWItd29ya2Vy');
    }
  }, 120_000);
});
