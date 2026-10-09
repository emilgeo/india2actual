/**
 * Sign in to an Actual server the way Actual's own login does, and return the
 * session token. The token can be kept in place of the password, which is the
 * point: the password itself never needs to be stored.
 *
 * Neither this endpoint nor the API's `sessionToken` option is in Actual's
 * published docs, so the end to end tests, which run against a real sync
 * server, are what would notice a release that changes them.
 */
export async function signIn(serverURL: string, password: string): Promise<string> {
  const response = await fetch(`${serverURL}/account/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginMethod: 'password', password }),
  });

  let body: { status?: string; reason?: string; data?: { token?: string } } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Handled below, as a failure with no reason given.
  }

  const token = body.data?.token;
  if (body.status === 'ok' && typeof token === 'string' && token) {
    return token;
  }
  throw new Error(`Authentication failed: ${body.reason ?? `HTTP ${response.status}`}`);
}

/** A saved token the server no longer accepts, so the password is needed again. */
export class SignInExpired extends Error {
  constructor() {
    super('Your saved sign-in no longer works. Enter the server password again.');
    this.name = 'SignInExpired';
  }
}

/** Does this failure mean the token was refused, not that the server is unreachable? */
export function isTokenRefused(error: unknown): boolean {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? JSON.stringify(error)
        : String(error);
  return /invalid or expired session token|unauthorized|invalid-password|token-expired/i.test(text);
}
