import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script without type declarations
import { EXTENSION_POLICY, manifestFor } from './extension-manifest.mjs';

// What a store reviewer and a user rely on. A change here is a decision, not a side effect.
describe('the extension manifest', () => {
  for (const target of ['chrome', 'firefox'] as const) {
    const manifest = manifestFor('1.2.3', target);

    it(`${target}: asks for no more access than documented`, () => {
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.version).toBe('1.2.3');
      expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
      expect(manifest.optional_host_permissions).toEqual(['https://*/*']);
      expect(manifest).not.toHaveProperty('content_scripts');
      expect(manifest).not.toHaveProperty('web_accessible_resources');
      expect(manifest).not.toHaveProperty('externally_connectable');
    });

    it(`${target}: allows no inline script, remote code or eval`, () => {
      const policy = manifest.content_security_policy.extension_pages as string;
      expect(policy).toBe(EXTENSION_POLICY);
      expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(policy).not.toMatch(/unsafe-inline|(?<!wasm-)unsafe-eval|script-src[^;]*https?:/);
      expect(policy).toContain("object-src 'none'");
    });
  }

  it('chrome: uses the side panel and only that permission', () => {
    const manifest = manifestFor('1.2.3', 'chrome');
    expect(manifest.permissions).toEqual(['sidePanel']);
    expect(manifest.side_panel).toEqual({ default_path: 'panel.html' });
  });

  it('firefox: keeps the permanent add-on id and declares that no data is collected', () => {
    const { gecko } = manifestFor('1.2.3', 'firefox').browser_specific_settings;
    expect(gecko.id).toBe('{da353e25-8c44-4925-9eee-04430daf93cd}');
    expect(gecko.strict_min_version).toBe('142.0');
    expect(gecko.data_collection_permissions).toEqual({ required: ['none'] });
    expect(manifestFor('1.2.3', 'firefox')).not.toHaveProperty('permissions');
  });
});
