import { useState } from 'preact/hooks';

import { safeStorage } from '../dom.js';
import { requestHostAccess } from '../extension/follow.js';

import { checkServerAddress } from './address.js';
import { SignInExpired } from './auth.js';
import { currentVault } from './credentials.js';
import { connect, disconnect, versionsMatch } from './session.js';
import type { Connection } from './types.js';

const SAVED = 'india2actual.connection.v1';

/** Only in the extension; null elsewhere, so a page never keeps a secret. */
const vault = currentVault();

type Props = {
  connection: Connection | null;
  onConnected: (connection: Connection) => void;
  onDisconnected: () => void;
};

function savedAddress(): { serverURL: string; syncId: string } {
  try {
    const parsed = JSON.parse(safeStorage()?.getItem(SAVED) ?? '{}') as Record<string, string>;
    return { serverURL: parsed.serverURL ?? '', syncId: parsed.syncId ?? '' };
  } catch {
    return { serverURL: '', syncId: '' };
  }
}

/** Where to enter the server details and open the budget. */
export function ConnectPanel({ connection, onConnected, onDisconnected }: Props) {
  const [saved, setSaved] = useState(() => vault?.load() ?? null);
  const [form, setForm] = useState({
    ...savedAddress(),
    ...(saved ? { serverURL: saved.serverURL, syncId: saved.syncId } : {}),
    password: '',
    encryptionPassword: '',
  });
  const [stay, setStay] = useState(Boolean(saved));
  const [remember, setRemember] = useState(true);

  // The saved token belongs to one server, so only use it while the address matches.
  const usable =
    saved !== null && checkServerAddress(form.serverURL).url === saved.serverURL;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (name: keyof typeof form) => (event: Event) =>
    setForm({ ...form, [name]: (event.currentTarget as HTMLInputElement).value });

  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      // First, while the click that started this still counts, so the browser
      // may ask. Refusing only turns off following the Actual tab.
      if (__EXTENSION__) {
        const checked = checkServerAddress(form.serverURL);
        if (checked.url !== undefined) {
          await requestHostAccess(new URL(checked.url).origin);
        }
      }
      const opened = await connect({
        ...form,
        ...(usable && !form.password && saved ? { token: saved.token } : {}),
      });
      if (vault) {
        if (stay) {
          const entry = {
            serverURL: opened.serverURL,
            syncId: opened.syncId,
            token: opened.token,
          };
          vault.save(entry);
          setSaved(entry);
        } else {
          vault.forget();
          setSaved(null);
        }
      }
      if (remember) {
        try {
          safeStorage()?.setItem(
            SAVED,
            JSON.stringify({ serverURL: form.serverURL, syncId: form.syncId }),
          );
        } catch {
          // Not remembering is fine.
        }
      }
      setForm({ ...form, password: '', encryptionPassword: '' });
      onConnected(opened);
    } catch (problem) {
      if (problem instanceof SignInExpired) {
        vault?.forget();
        setSaved(null);
        setStay(false);
      }
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  };

  if (connection) {
    const mismatch = !versionsMatch(__ACTUAL_API_VERSION__, connection.serverVersion);
    return (
      <section class="panel" aria-label="Actual connection">
        <div class="panel-head">
          <h2>Connected to {connection.budgetName}</h2>
          <button
            type="button"
            class="button"
            onClick={() => {
              void disconnect(connection).then(onDisconnected);
            }}
          >
            Disconnect
          </button>
        </div>
        <p class="muted">
          {connection.accounts.length} accounts. The server runs Actual{' '}
          {connection.serverVersion ?? '(version unknown)'}; this page was built for Actual{' '}
          {__ACTUAL_API_VERSION__}.
        </p>
        {mismatch ? (
          <p class="notice error">
            The server and this page are on different Actual releases, so
            pushing may fail or misbehave. Use the matching India2Actual file
            from the releases page, or update the server.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <form class="panel" onSubmit={event => void submit(event)} aria-label="Connect to Actual">
      <h2>Push straight into Actual</h2>
      <p class="muted">
        Connect to your Actual server to choose accounts and import without a
        separate step. The password stays in this page and is gone when you
        close it.
      </p>
      <div class="fields">
        <label>
          Server address
          <input
            type="text"
            value={form.serverURL}
            placeholder="https://actual.example.com"
            onInput={set('serverURL')}
          />
        </label>
        <label>
          Server password
          <input
            type="password"
            autoComplete="off"
            value={form.password}
            placeholder={usable ? 'Not needed, using your saved sign-in' : ''}
            onInput={set('password')}
          />
        </label>
        <label>
          Sync ID
          <input
            type="text"
            value={form.syncId}
            placeholder="Settings, Show advanced settings"
            onInput={set('syncId')}
          />
        </label>
        <label>
          Encryption password <span class="muted">(only if the budget is encrypted)</span>
          <input
            type="password"
            autoComplete="off"
            value={form.encryptionPassword}
            onInput={set('encryptionPassword')}
          />
        </label>
      </div>
      <label class="check">
        <input
          type="checkbox"
          checked={remember}
          onChange={event => setRemember((event.currentTarget as HTMLInputElement).checked)}
        />
        Remember the address and Sync ID in this browser (never the passwords)
      </label>
      {vault ? (
        <label class="check">
          <input
            type="checkbox"
            checked={stay}
            onChange={event => setStay((event.currentTarget as HTMLInputElement).checked)}
          />
          Stay connected on this device (keeps a sign-in token in this extension,
          not your password)
        </label>
      ) : null}
      {usable ? (
        <p class="muted">Signed in earlier. Press Connect to use that sign-in.</p>
      ) : null}
      {error ? <p class="notice error">{error}</p> : null}
      <div class="row">
        <button
          type="submit"
          class="button primary"
          disabled={busy || (!form.password && !usable)}
        >
          {busy ? 'Connecting...' : 'Connect'}
        </button>
        {saved ? (
          <button
            type="button"
            class="button"
            disabled={busy}
            onClick={() => {
              vault?.forget();
              setSaved(null);
              setStay(false);
            }}
          >
            Forget saved sign-in
          </button>
        ) : null}
      </div>
    </form>
  );
}
