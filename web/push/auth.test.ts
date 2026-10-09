import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTokenRefused, signIn } from './auth.js';
import { signInVault } from './credentials.js';

function reply(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ status, json: async () => body })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('signIn', () => {
  it('returns the token Actual hands back, asking the way its own login does', async () => {
    reply({ status: 'ok', data: { token: 'a-session-token' } });

    expect(await signIn('https://actual.example.test', 'a password')).toBe('a-session-token');
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://actual.example.test/account/login');
    expect(JSON.parse(init.body as string)).toEqual({
      loginMethod: 'password',
      password: 'a password',
    });
  });

  it('fails with the reason the server gave, in words the error text understands', async () => {
    reply({ status: 'error', reason: 'invalid-password' }, 400);

    await expect(signIn('https://actual.example.test', 'wrong')).rejects.toThrow(
      'Authentication failed: invalid-password',
    );
  });

  it('fails clearly when the reply is not what Actual sends', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 502, json: async () => { throw new Error('html'); } })));

    await expect(signIn('https://actual.example.test', 'x')).rejects.toThrow('HTTP 502');
  });
});

describe('isTokenRefused', () => {
  it('recognises a refused token but not a network failure', () => {
    expect(isTokenRefused(new Error('Authentication failed: invalid or expired session token'))).toBe(true);
    expect(isTokenRefused({ reason: 'unauthorized' })).toBe(true);
    expect(isTokenRefused(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('the saved sign-in', () => {
  function memory() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }
  const saved = { serverURL: 'https://actual.example.test', syncId: 'sync-1', token: 't' };

  it('is saved, read back and forgotten', () => {
    const vault = signInVault(memory());

    expect(vault.load()).toBeNull();
    vault.save(saved);
    expect(vault.load()).toEqual(saved);
    vault.forget();
    expect(vault.load()).toBeNull();
  });

  it('keeps nothing without storage and ignores damaged data', () => {
    const none = signInVault(null);
    expect(() => none.save(saved)).not.toThrow();
    expect(none.load()).toBeNull();

    const store = memory();
    store.setItem('india2actual.signin.v1', '{"serverURL":"x"}');
    expect(signInVault(store).load()).toBeNull();
    store.setItem('india2actual.signin.v1', 'not json');
    expect(signInVault(store).load()).toBeNull();
  });
});
