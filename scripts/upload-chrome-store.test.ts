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
});
