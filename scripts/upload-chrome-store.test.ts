import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script without type declarations
import { uploadToChromeStore } from './upload-chrome-store.mjs';

const env = {
  CWS_CLIENT_ID: 'id',
  CWS_CLIENT_SECRET: 'secret',
  CWS_REFRESH_TOKEN: 'refresh',
  CWS_PUBLISHER_ID: 'pub',
  CWS_EXTENSION_ID: 'ext',
};

type Reply = { status?: number; body: unknown };

/** A fetch that answers from a queue by URL suffix and records the calls. */
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    const key = Object.keys(replies).find(suffix => url.endsWith(suffix));
    const reply = key ? replies[key]!.shift() : undefined;
    calls.push(url);
    if (!reply) throw new Error(`unexpected call ${url}`);
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      text: async () => JSON.stringify(reply.body),
    };
  };
  return { fn, calls };
}

type Capture = { url: string; init: { headers?: Record<string, string>; body?: unknown } };

const run = (fn: unknown, overrides: Record<string, string> = {}) =>
  uploadToChromeStore({
    zip: Buffer.from('zip'),
    env: { ...env, ...overrides },
    fetchFn: fn,
    sleep: async () => {},
    log: () => {},
  });

describe('uploadToChromeStore', () => {
  it('uploads then submits for review', async () => {
    const { fn, calls } = fakeFetch({
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ body: { uploadState: 'SUCCEEDED', crxVersion: '0.5.5' } }],
      ':publish': [{ body: { state: 'PENDING_REVIEW' } }],
    });
    await expect(run(fn)).resolves.toMatchObject({ state: 'PENDING_REVIEW' });
    expect(calls[1]).toContain('/upload/v2/publishers/pub/items/ext:upload');
  });

  it('waits for an upload that is still in progress', async () => {
    const { fn } = fakeFetch({
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ body: { uploadState: 'IN_PROGRESS' } }],
      ':fetchStatus': [{ body: { lastAsyncUploadState: 'IN_PROGRESS' } }, { body: { lastAsyncUploadState: 'SUCCEEDED' } }],
      ':publish': [{ body: { state: 'PENDING_REVIEW' } }],
    });
    await expect(run(fn)).resolves.toMatchObject({ state: 'PENDING_REVIEW' });
  });

  it('fails and does not publish when the upload fails', async () => {
    const { fn, calls } = fakeFetch({
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ body: { uploadState: 'FAILED' } }],
    });
    await expect(run(fn)).rejects.toThrow('did not succeed');
    expect(calls.some(url => url.endsWith(':publish'))).toBe(false);
  });

  it('fails on an HTTP error from the store, with its message', async () => {
    const { fn } = fakeFetch({
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ status: 400, body: { error: { message: 'version not increased' } } }],
    });
    await expect(run(fn)).rejects.toThrow('version not increased');
  });

  it('fails on any state other than pending review', async () => {
    const { fn } = fakeFetch({
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ body: { uploadState: 'SUCCEEDED' } }],
      ':publish': [{ body: { state: 'PUBLISHED' } }],
    });
    await expect(run(fn)).rejects.toThrow('Unexpected state');
  });

  it('names missing settings without calling the network', async () => {
    const { fn, calls } = fakeFetch({});
    await expect(run(fn, { CWS_REFRESH_TOKEN: '' })).rejects.toThrow('CWS_REFRESH_TOKEN');
    expect(calls).toHaveLength(0);
  });

  it('sends the bearer token and the review-bound publish body', async () => {
    const seen: Capture[] = [];
    const replies: Record<string, Reply[]> = {
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ body: { uploadState: 'SUCCEEDED' } }],
      ':publish': [{ body: { state: 'PENDING_REVIEW' } }],
    };
    const inner = fakeFetch(replies).fn;
    await run((url: string, init: Capture['init']) => {
      seen.push({ url, init });
      return inner(url);
    });
    const publish = seen.find(call => call.url.endsWith(':publish'))!;
    expect(publish.init.headers?.authorization).toBe('Bearer tok');
    expect(JSON.parse(String(publish.init.body))).toEqual({
      publishType: 'DEFAULT_PUBLISH',
      skipReview: false,
      blockOnWarnings: false,
    });
  });

  it('gives up when the upload stays in progress', async () => {
    const { fn, calls } = fakeFetch({
      '/token': [{ body: { access_token: 'tok' } }],
      ':upload': [{ body: { uploadState: 'IN_PROGRESS' } }],
      ':fetchStatus': Array.from({ length: 30 }, () => ({ body: { lastAsyncUploadState: 'IN_PROGRESS' } })),
    });
    await expect(run(fn)).rejects.toThrow('did not succeed');
    expect(calls.some(url => url.endsWith(':publish'))).toBe(false);
  });

  it('fails when the token exchange is refused', async () => {
    const { fn } = fakeFetch({ '/token': [{ status: 400, body: { error: 'invalid_grant' } }] });
    await expect(run(fn)).rejects.toThrow('invalid_grant');
  });

  it('reports a reply that is not JSON', async () => {
    const calls: string[] = [];
    const fn = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => '<html>oops</html>' };
    };
    await expect(run(fn)).rejects.toThrow('not JSON');
  });

  it('fails when the token reply has no access token', async () => {
    const { fn } = fakeFetch({ '/token': [{ body: {} }] });
    await expect(run(fn)).rejects.toThrow('no access_token');
  });
});
