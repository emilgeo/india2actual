/** What is kept so the next visit can sign in without the password. */
export type SavedSignIn = { serverURL: string; syncId: string; token: string };

const KEY = 'india2actual.signin.v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Where a sign-in token is kept: the extension's own page storage, which other
 * websites and files cannot read. Null everywhere else, so the web pages never
 * keep a secret, since a page opened from disk shares storage with other files.
 */
export function signInVault(store: Store | null) {
  return {
    load(): SavedSignIn | null {
      try {
        const parsed = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<SavedSignIn> | null;
        return parsed?.serverURL && parsed.syncId && parsed.token
          ? { serverURL: parsed.serverURL, syncId: parsed.syncId, token: parsed.token }
          : null;
      } catch {
        return null;
      }
    },
    save(saved: SavedSignIn): void {
      try {
        store?.setItem(KEY, JSON.stringify(saved));
      } catch {
        // Not staying signed in is fine: the password works.
      }
    },
    forget(): void {
      try {
        store?.removeItem(KEY);
      } catch {
        // Nothing to forget.
      }
    },
  };
}

export type SignInVault = ReturnType<typeof signInVault>;

/** The vault for this build: real in the extension, empty elsewhere. */
export function currentVault(): SignInVault | null {
  if (!__EXTENSION__) {
    return null;
  }
  try {
    return signInVault(window.localStorage);
  } catch {
    return null;
  }
}
