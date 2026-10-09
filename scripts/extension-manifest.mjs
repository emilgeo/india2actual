// The manifest of the side panel extension. Kept apart from the build so a test
// can read it, and so the permissions are written down in one place.

/**
 * No inline script, no remote code and no `eval`. `wasm-unsafe-eval` is only
 * for the SQLite engine inside the Actual API. Requests may go to an https
 * server or one on this computer, which is all Actual itself supports.
 */
export const EXTENSION_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  'connect-src https: http://localhost:* http://127.0.0.1:*',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const ICONS = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };

/**
 * `chrome` uses a side panel opened from the toolbar; `firefox` uses a sidebar.
 * Reading the Actual tab's address needs host access, which is granted for this
 * computer up front and asked for, one server at a time, for an https server.
 */
export function manifestFor(version, target = 'chrome') {
  const common = {
    manifest_version: 3,
    name: 'india2actual',
    version,
    description:
      'Import Indian bank and credit card statements into Actual Budget, with real payee names, from a side panel.',
    icons: ICONS,
    host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'],
    optional_host_permissions: ['https://*/*'],
    content_security_policy: { extension_pages: EXTENSION_POLICY },
  };

  if (target === 'firefox') {
    return {
      ...common,
      background: { scripts: ['background.js'] },
      sidebar_action: {
        default_title: 'india2actual',
        default_panel: 'panel.html',
        default_icon: ICONS,
      },
      browser_specific_settings: {
        gecko: { id: 'india2actual@users.noreply.github.com' },
      },
    };
  }

  return {
    ...common,
    action: { default_title: 'Open india2actual', default_icon: ICONS },
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'panel.html' },
    permissions: ['sidePanel'],
  };
}
