/**
 * Check the address of an Actual server before trying it. The page may only
 * reach https servers, or one on this computer, and Actual itself needs the
 * same, so anything else gets an explanation instead of a silent failure.
 */
export function checkServerAddress(
  raw: string,
): { url: string; problem?: undefined } | { url?: undefined; problem: string } {
  const text = raw.trim();
  if (!text) {
    return { problem: 'Enter the address of your Actual server.' };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { problem: `"${text}" is not a web address.` };
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !local) {
    return {
      problem:
        'A plain http address is not allowed here, and Actual needs https ' +
        'except on this computer. Use the https address of your server, or ' +
        'http://localhost if it runs on this computer.',
    };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { problem: 'The address must start with https:// or http://localhost.' };
  }

  return { url: url.origin + url.pathname.replace(/\/+$/, '') };
}

/** The API throws plain objects as well as errors. */
function textOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const { message, reason } = error as { message?: unknown; reason?: unknown };
    if (typeof message === 'string') {
      return message;
    }
    if (typeof reason === 'string') {
      return reason;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
  return String(error);
}

/** Turn what the Actual API throws into a sentence a person can act on. */
export function describeConnectionError(error: unknown): string {
  const message = textOf(error);

  if (/invalid-password|Authentication failed/i.test(message)) {
    return 'The server did not accept that password.';
  }
  if (/network-failure|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return (
      'Could not reach the server. Check the address, that the server is ' +
      'running, and that it uses https (or is on this computer).'
    );
  }
  if (/not-found|Could not get remote files|no such file/i.test(message)) {
    return (
      'Could not find that budget on the server. Check the Sync ID under ' +
      'Settings, Show advanced settings.'
    );
  }
  if (/decrypt|encrypt/i.test(message)) {
    return (
      'Could not open the budget. If it uses end-to-end encryption, enter ' +
      'its encryption password.'
    );
  }
  return message;
}
