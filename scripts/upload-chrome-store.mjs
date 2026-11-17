// Uploads an extension zip to the Chrome Web Store and submits it for review.
//
// Usage: node scripts/upload-chrome-store.mjs <zip>
// Reads CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID and
// CWS_EXTENSION_ID from the environment. Exits non-zero on any store error.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://chromewebstore.googleapis.com';

async function call(fetchFn, url, init, what) {
  const response = await fetchFn(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} failed (HTTP ${response.status}): ${text}`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} returned something that is not JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * Uploads `zip` then publishes it. `fetchFn` and `sleep` are parameters so a test
 * can run the flow without the network.
 */
export async function uploadToChromeStore({ zip, env, fetchFn = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log }) {
  const required = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID'];
  const missing = required.filter(name => !env[name]);
  if (missing.length > 0) throw new Error(`Missing settings: ${missing.join(', ')}`);

  const token = await call(
    fetchFn,
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.CWS_CLIENT_ID,
        client_secret: env.CWS_CLIENT_SECRET,
        refresh_token: env.CWS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    },
    'Getting an access token',
  );
  if (!token.access_token) throw new Error('Getting an access token returned no access_token.');
  const auth = { authorization: `Bearer ${token.access_token}` };
  const item = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;

  const upload = await call(
    fetchFn,
    `${API}/upload/v2/${item}:upload`,
    { method: 'POST', headers: auth, body: zip },
    'Upload',
  );
  log(`Upload state: ${upload.uploadState} (version ${upload.crxVersion ?? 'unknown'})`);

  let state = upload.uploadState;
  for (let attempt = 0; state === 'IN_PROGRESS' && attempt < 30; attempt++) {
    await sleep(10_000);
    const status = await call(fetchFn, `${API}/v2/${item}:fetchStatus`, { headers: auth }, 'Checking the upload');
    state = status.lastAsyncUploadState;
    log(`Upload state: ${state}`);
  }
  if (state !== 'SUCCEEDED') throw new Error(`The upload did not succeed (state ${state}).`);

  const published = await call(
    fetchFn,
    `${API}/v2/${item}:publish`,
    {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: false }),
    },
    'Submitting for review',
  );
  log(`Submitted: ${published.state}`);
  for (const warning of published.warningInfo?.warnings ?? []) log(`Store warning: ${warning.reason}: ${warning.description}`);
  if (published.state !== 'PENDING_REVIEW') throw new Error(`Unexpected state after submitting: ${published.state}`);
  return published;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/upload-chrome-store.mjs <zip>');
    process.exit(2);
  }
  try {
    await uploadToChromeStore({ zip: readFileSync(path), env: process.env });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
