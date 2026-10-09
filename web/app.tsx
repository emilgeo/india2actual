import { useMemo, useRef, useState } from 'preact/hooks';

import { checksFor } from '../src/interpret/checks.js';
import type { PayeeGroup } from '../src/interpret/payees.js';
import type { DateOrder } from '../src/interpret/values.js';
import { rulesToJson } from '../src/narration/rules.js';
import type { RuleSpec } from '../src/narration/rules.js';
import { buildReport } from '../src/report.js';

import { copyText, downloadText, safeStorage } from './dom.js';
import { datesAreAmbiguous } from './logic/dates.js';
import { loadFile, readSections } from './logic/files.js';
import type { LoadedFile, Settings } from './logic/files.js';
import {
  clearRules,
  loadRules,
  mergeRules,
  readRulesFile,
  saveRules,
  withRule,
} from './logic/rules-store.js';
import { useActualAccount } from './extension/follow.js';
import { ConnectPanel } from './push/connect-panel.js';
import type { RuleRequest } from './push/actions.js';
import type { Connection } from './push/types.js';
import type { NameExtras } from './payee-review.js';
import { SectionCard } from './section-card.js';
import { THEMES, applyTheme, loadTheme, saveTheme } from './theme.js';
import type { Theme } from './theme.js';

const storage = safeStorage();

/** The site's links, shown only where the page is served as part of the site. */
function SiteBar() {
  return (
    <nav class="sitebar" aria-label="Site">
      <a class="sitebar-name" href="/">
        india2actual
      </a>
      <a href="/docs/">Documentation</a>
      <a href="/changelog/">Changelog</a>
      <a href="/privacy/">Privacy</a>
      <a href="https://github.com/emilgeo/india2actual">GitHub</a>
      <a href="https://www.npmjs.com/package/india2actual">npm</a>
    </nav>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme(storage));
  return (
    <div class="theme">
      <label for="theme">Theme</label>
      <select
        id="theme"
        value={theme}
        onChange={event => {
          const next = event.currentTarget.value as Theme;
          setTheme(next);
          applyTheme(next);
          saveTheme(storage, next);
        }}
      >
        {THEMES.map(name => (
          <option value={name}>{name[0]?.toUpperCase()}{name.slice(1)}</option>
        ))}
      </select>
    </div>
  );
}

function PasswordPrompt({
  file,
  onSubmit,
}: {
  file: LoadedFile;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  return (
    <form
      class="panel"
      onSubmit={event => {
        event.preventDefault();
        onSubmit(password);
      }}
    >
      <p>
        {file.wrongPassword
          ? 'That password did not open the file. Try again.'
          : 'This PDF is password protected.'}
      </p>
      <label htmlFor={`pw-${file.id}`}>Statement password</label>
      <input
        id={`pw-${file.id}`}
        type="password"
        autoComplete="off"
        value={password}
        onInput={event => setPassword((event.currentTarget as HTMLInputElement).value)}
      />
      <button type="submit" class="button" disabled={!password}>
        Open
      </button>
    </form>
  );
}

export function App() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [forceCard, setForceCard] = useState(false);
  const [startingBalance, setStartingBalance] = useState(false);
  const [rules, setRulesState] = useState<RuleSpec[]>(() => loadRules(storage));
  const [renamed, setRenamed] = useState<Map<string, string>>(new Map());
  const [excluded, setExcluded] = useState<Map<string, Set<number>>>(new Map());
  const [connection, setConnection] = useState<Connection | null>(null);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [ruleRequests, setRuleRequests] = useState<Map<string, RuleRequest[]>>(new Map());
  const [reportText, setReportText] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const openAccountId = useActualAccount(connection?.serverOrigin ?? null);
  const nextId = useRef(1);

  const setRules = (next: RuleSpec[]) => {
    setRulesState(next);
    saveRules(storage, next);
  };

  const settings: Settings = { dateOrder, forceCard, rules };

  const results = useMemo(
    () => files.map(file => ({ file, sections: readSections(file, settings) })),
    // `settings` is rebuilt every render, so its parts are listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, dateOrder, forceCard, rules],
  );

  const addFiles = async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const id = nextId.current++;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const loaded = await loadFile(id, file.name, bytes);
      setFiles(previous => [...previous, loaded]);
    }
  };

  const openWithPassword = async (file: LoadedFile, password: string) => {
    const loaded = await loadFile(file.id, file.name, file.bytes, password);
    setFiles(previous => previous.map(item => (item.id === file.id ? loaded : item)));
  };

  const sectionKey = (fileId: number, index: number) => `${fileId}:${index}`;

  const nameGroup = (
    fileId: number,
    index: number,
    group: PayeeGroup,
    name: string,
    remember: boolean,
    extras: NameExtras,
  ) => {
    const key = sectionKey(fileId, index);
    if (name && remember && group.rule) {
      setRules(withRule(rules, { pattern: group.rule, name }));
    } else if (name) {
      setRenamed(previous => {
        const next = new Map(previous);
        for (const row of group.indexes) {
          next.set(`${key}:${row}`, name);
        }
        return next;
      });
    }

    const { categoryId } = extras;
    if (categoryId) {
      setCategories(previous => {
        const next = new Map(previous);
        for (const row of group.indexes) {
          next.set(`${key}:${row}`, categoryId);
        }
        return next;
      });
      if (extras.makeRule) {
        setRuleRequests(previous => {
          const next = new Map(previous);
          next.set(key, [
            ...(next.get(key) ?? []),
            { payee: name || group.payee, categoryId },
          ]);
          return next;
        });
      }
    }
  };

  const renamedFor = (fileId: number, index: number) => {
    const prefix = `${sectionKey(fileId, index)}:`;
    const found = new Map<number, string>();
    for (const [key, value] of renamed) {
      if (key.startsWith(prefix)) {
        found.set(Number(key.slice(prefix.length)), value);
      }
    }
    return found;
  };

  const categoriesFor = (fileId: number, index: number) => {
    const prefix = `${sectionKey(fileId, index)}:`;
    const found = new Map<number, string>();
    for (const [key, value] of categories) {
      if (key.startsWith(prefix)) {
        found.set(Number(key.slice(prefix.length)), value);
      }
    }
    return found;
  };

  const exclude = (fileId: number, index: number, row: number, out: boolean) => {
    setExcluded(previous => {
      const next = new Map(previous);
      const set = new Set(next.get(sectionKey(fileId, index)) ?? []);
      if (out) {
        set.add(row);
      } else {
        set.delete(row);
      }
      next.set(sectionKey(fileId, index), set);
      return next;
    });
  };

  const reportFor = (entry: (typeof results)[number]) =>
    buildReport({
      version: __VERSION__,
      runtime: 'browser',
      format: entry.file.format ?? 'unknown',
      tables: entry.file.tables,
      sections: entry.sections.map((section, index) => ({
        number: index + 1,
        ...(section.account ? { account: section.account } : {}),
        table: section.table,
        result: section.result,
        checks: checksFor(section).map(({ name, validation }) => ({
          name,
          validation,
        })),
      })),
    });

  const copyReport = async (entry: (typeof results)[number]) => {
    const text = reportFor(entry);
    setReportText((await copyText(text)) ? null : text);
    setMessage(
      'Report copied. Letters are shown as x and digits as 9, so it is safe to paste into a bug report.',
    );
  };

  const loadRulesFile = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) {
      return;
    }
    try {
      setRules(mergeRules(rules, readRulesFile(await file.text(), file.name)));
      setMessage(`Loaded names from ${file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const ambiguous = results.some(({ sections }) => sections.some(datesAreAmbiguous));

  return (
    <>
      {!__PUSH__ && location.protocol.startsWith('http') ? <SiteBar /> : null}
      <main>
        <header class="hero">
          <ThemePicker />
          <h1>india2actual</h1>
          <p>
            Turn an Indian bank or credit card statement into a file Actual Budget
            can import, with real payee names.
          </p>
          <p class="privacy">
            Everything happens in this page. Your statement is not uploaded, and
            this page is not allowed to make network requests.
          </p>
        </header>

        <label
          class="drop"
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            if (event.dataTransfer?.files.length) {
              void addFiles(event.dataTransfer.files);
            }
          }}
        >
          <span class="drop-title">Drop statements here, or choose files</span>
          <span class="muted">PDF, CSV, Excel, or an HTML table saved as .xls</span>
          <input
            type="file"
            multiple
            accept=".pdf,.csv,.tsv,.txt,.xls,.xlsx,.html,.htm"
            onChange={event => {
              const input = event.currentTarget as HTMLInputElement;
              if (input.files?.length) {
                void addFiles(input.files);
                input.value = '';
              }
            }}
          />
        </label>

        {__PUSH__ ? (
          <ConnectPanel
            connection={connection}
            onConnected={setConnection}
            onDisconnected={() => setConnection(null)}
          />
        ) : (
          <p class="muted">
            To push straight into Actual instead of downloading a file, download{' '}
            <a
              href="https://github.com/emilgeo/india2actual/releases/latest/download/india2actual.html"
              rel="noreferrer"
            >
              india2actual.html
            </a>{' '}
            from the latest release and open it from your computer.
          </p>
        )}

        <details class="options">
          <summary>Options</summary>
          <label class="check">
            <input
              type="checkbox"
              checked={startingBalance}
              onChange={event =>
                setStartingBalance((event.currentTarget as HTMLInputElement).checked)
              }
            />
            Add a Starting Balance row (for the first import into a new account)
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={forceCard}
              onChange={event =>
                setForceCard((event.currentTarget as HTMLInputElement).checked)
              }
            />
            Read as a credit card statement
          </label>
          <label>
            Dates like 01/02/2025 mean{' '}
            <select
              value={dateOrder}
              onChange={event =>
                setDateOrder((event.currentTarget as HTMLSelectElement).value as DateOrder)
              }
            >
              <option value="dmy">day / month / year</option>
              <option value="mdy">month / day / year</option>
              <option value="ymd">year / month / day</option>
            </select>
          </label>
        </details>

        {ambiguous ? (
          <p class="notice">
            Every date in a statement could be read day-first or month-first.
            Check the dates below, and change the setting under Options if they
            are wrong.
          </p>
        ) : null}

        <div aria-live="polite" class="messages">
          {message ? <p class="notice">{message}</p> : null}
        </div>
        {reportText ? (
          <section class="panel">
            <p>Copying was not allowed here. Select and copy this instead:</p>
            <textarea readOnly rows={10} value={reportText} />
          </section>
        ) : null}

        {results.map(entry => {
          const { file, sections } = entry;
          return (
            <section class="file" key={file.id} aria-label={file.name}>
              <header class="file-head">
                <h2>{file.name}</h2>
                <span class="muted">{file.format ?? ''}</span>
                <button
                  type="button"
                  class="link"
                  onClick={() => setFiles(files.filter(item => item.id !== file.id))}
                >
                  Remove
                </button>
              </header>

              {file.status === 'password' ? (
                <PasswordPrompt
                  file={file}
                  onSubmit={password => void openWithPassword(file, password)}
                />
              ) : null}
              {file.status === 'error' ? (
                <p class="notice error">{file.error}</p>
              ) : null}
              {file.status === 'ready' && !sections.length ? (
                <p class="notice error">
                  No transaction table was found in this file. If you report
                  this, the button below copies a report with every letter and
                  digit masked.
                </p>
              ) : null}
              {sections.length > 1 ? (
                <p class="muted">
                  This statement holds {sections.length} accounts. Each gets its
                  own file.
                </p>
              ) : null}

              {sections.map((section, index) => (
                <SectionCard
                  key={`${file.id}-${index}`}
                  file={file}
                  section={section}
                  number={index + 1}
                  several={sections.length > 1}
                  startingBalance={startingBalance}
                  excluded={excluded.get(sectionKey(file.id, index)) ?? new Set()}
                  renamed={renamedFor(file.id, index)}
                  onExclude={(row, out) => exclude(file.id, index, row, out)}
                  onName={(group, name, remember, extras) =>
                    nameGroup(file.id, index, group, name, remember, extras)
                  }
                  connection={connection}
                  openAccountId={openAccountId}
                  categories={categoriesFor(file.id, index)}
                  ruleRequests={ruleRequests.get(sectionKey(file.id, index)) ?? []}
                />
              ))}

              {file.status === 'ready' ? (
                <button type="button" class="link" onClick={() => void copyReport(entry)}>
                  Copy a masked report for a bug report
                </button>
              ) : null}
            </section>
          );
        })}

        <section class="panel" aria-label="Saved payee names">
          <h2>Your payee names</h2>
          <p class="muted">
            Names you give payees are kept in this browser only, so the next
            statement uses them too. {rules.length} saved.
          </p>
          <div class="row">
            <button
              type="button"
              class="button"
              disabled={!rules.length}
              onClick={() =>
                downloadText('india2actual-names.json', rulesToJson(rules), 'application/json')
              }
            >
              Download names
            </button>
            <label class="button">
              Load names
              <input
                type="file"
                accept=".json,application/json"
                class="visually-hidden"
                onChange={event => {
                  const input = event.currentTarget as HTMLInputElement;
                  void loadRulesFile(input.files);
                  input.value = '';
                }}
              />
            </label>
            <button
              type="button"
              class="button"
              disabled={!rules.length}
              onClick={() => {
                clearRules(storage);
                setRulesState([]);
              }}
            >
              Clear saved names
            </button>
          </div>
          <p class="muted">
            The downloaded file also works with the command line tool&apos;s
            <code> --merchants </code> option.
          </p>
        </section>

        <footer class="foot">
          <span>india2actual {__VERSION__}</span>
          <span>Not affiliated with Actual Budget or any bank.</span>
          <span>Made by an Actual Budget lover.</span>
          {location.protocol.startsWith('http') ? (
            <>
              <a href="SHA256SUMS">Fingerprint of this page</a>
              <a href="/privacy/">Privacy</a>
              <a href="/docs/">Documentation</a>
              <a href="https://github.com/emilgeo/india2actual/issues">Report a problem</a>
              <a href="https://github.com/emilgeo/india2actual/blob/main/LICENSE">Licence (MIT)</a>
              <a href="https://github.com/emilgeo/india2actual/releases/latest">Downloads</a>
            </>
          ) : null}
        </footer>
      </main>
    </>
  );
}
