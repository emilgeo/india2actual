import { mkdir } from 'node:fs/promises';

import type { StatementTransaction } from '../interpret/rows.js';
import {
  CARD_AUTOPAY_PAYEE,
  CARD_PAYMENT_PAYEE,
} from '../narration/merchants.js';

/**
 * The subset of Actual's `ImportTransactionEntity` we populate. Declared
 * locally so this module type-checks without `@actual-app/api` installed,
 * it is an optional peer dependency, since the CSV path is the default and
 * the API package pulls in a native SQLite build.
 */
export type ActualImportTransaction = {
  date: string;
  /** Integer paise. */
  amount: number;
  payee_name?: string;
  /** A payee id. Set only for a transfer, where Actual mirrors the transaction. */
  payee?: string;
  imported_payee: string;
  notes: string;
  imported_id?: string;
  cleared: boolean;
};

export type PushConfig = {
  serverURL: string;
  password: string;
  syncId: string;
  dataDir: string;
  /** End-to-end encryption password, for encrypted budget files. */
  encryptionPassword?: string;
  /** Account name (case-insensitive) or id. */
  account: string;
  dryRun: boolean;
  /** Send card payments as transfers with this account. */
  transferTo?: string;
};

export type PushResult = {
  accountName: string;
  accountId: string;
  added: number;
  updated: number;
  errors: string[];
  dryRun: boolean;
  /** Set with `transferTo`. */
  transfer?: {
    accountName: string;
    /** Card payments sent as transfers. */
    sent: number;
    /** Payments imported as ordinary rows because the other side already exists. */
    unlinked: Array<{ date: string; amount: number }>;
  };
};

/** Rupees to integer paise, matching Actual's own `amountToInteger`. */
export function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Map parsed statement rows onto Actual's import shape.
 *
 * Two deliberate choices:
 *
 * - `payee_name` gets the cleaned merchant and `imported_payee` the original
 *   narration, which is exactly what those fields are for: the payee collapses
 *   correctly while Actual's payee matching still sees the raw text. This is
 *   the one thing the CSV output cannot do, since Actual's CSV field mapping
 *   has no `imported_payee` slot.
 * - `notes` also gets the narration, duplicating `imported_payee`. That
 *   duplication looked redundant and was originally left out, which was wrong:
 *   `imported_payee` is not a column you can read at a glance, whereas Notes
 *   is one you can see, search and filter. Without it the narration is
 *   effectively invisible after a push.
 * - `imported_id` is only set when a reference survived the uniqueness checks.
 *   Omitting it is the safe default: Actual falls back to matching on date and
 *   amount within a week, whereas a non-unique id makes it treat distinct
 *   transactions as the same one and drop them.
 */
export function toImportEntities(
  transactions: StatementTransaction[],
  transfer?: { payeeId: string; skip: ReadonlySet<number> },
): ActualImportTransaction[] {
  return transactions.map((transaction, index) => {
    const asTransfer =
      transfer && isCardPayment(transaction) && !transfer.skip.has(index);

    return {
      date: transaction.date,
      amount: toPaise(transaction.amount),
      ...(asTransfer
        ? { payee: transfer.payeeId }
        : { payee_name: transaction.payee }),
      imported_payee: transaction.raw,
      notes: transaction.raw,
      ...(transaction.ref ? { imported_id: transaction.ref } : {}),
      // Statement rows have already settled at the bank.
      cleared: true,
    };
  });
}

/** The Actual API's SQLite module crashes on Node older than this. */
const MIN_PUSH_NODE = { major: 22, minor: 14 };

export function nodeTooOldForPush(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return (
    major < MIN_PUSH_NODE.major ||
    (major === MIN_PUSH_NODE.major && minor < MIN_PUSH_NODE.minor)
  );
}

export function isCardPayment(transaction: StatementTransaction): boolean {
  return (
    transaction.payee === CARD_PAYMENT_PAYEE ||
    transaction.payee === CARD_AUTOPAY_PAYEE
  );
}

/** Actual matches an imported row to an existing one within this many days. */
const MATCH_WINDOW_DAYS = 7;

export type ExistingTransaction = {
  date: string;
  /** Integer paise. */
  amount: number;
  transfer_id?: string | null;
};

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * Indexes of card payments whose other side already exists as an ordinary
 * transaction. Importing those as transfers would add a second outflow, since
 * Actual mirrors a transfer instead of linking to a transaction already there.
 * A counterpart is used at most once, and the nearest date wins.
 */
export function findExistingCounterparts(
  transactions: StatementTransaction[],
  existing: ExistingTransaction[],
): number[] {
  const free = existing.filter(row => !row.transfer_id);
  const used = new Set<number>();
  const found: number[] = [];

  for (const [index, transaction] of transactions.entries()) {
    if (!isCardPayment(transaction)) {
      continue;
    }

    let best = -1;
    let bestDistance = Infinity;
    for (const [candidate, row] of free.entries()) {
      const distance = daysApart(row.date, transaction.date);
      if (
        !used.has(candidate) &&
        row.amount === -toPaise(transaction.amount) &&
        distance <= MATCH_WINDOW_DAYS &&
        distance < bestDistance
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }

    if (best >= 0) {
      used.add(best);
      found.push(index);
    }
  }

  return found;
}

type ActualAccount = { id: string; name: string; closed?: boolean };

/**
 * The slice of `@actual-app/api` we use, described structurally.
 *
 * Declared here rather than imported so this file type-checks whether or not
 * the optional peer dependency is installed.
 */
type ActualApi = {
  init(config: {
    dataDir: string;
    serverURL: string;
    password: string;
  }): Promise<unknown>;
  downloadBudget(
    syncId: string,
    options?: { password: string },
  ): Promise<unknown>;
  getAccounts(): Promise<ActualAccount[]>;
  getPayees(): Promise<
    Array<{ id: string; name: string; transfer_acct?: string | null }>
  >;
  getTransactions(
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<ExistingTransaction[]>;
  importTransactions(
    accountId: string,
    transactions: ActualImportTransaction[],
    opts: {
      dryRun?: boolean;
      defaultCleared?: boolean;
      payeeNameNormalization?: 'original' | 'title-case';
    },
  ): Promise<{
    added?: string[];
    updated?: string[];
    errors?: Array<{ message: string }>;
  }>;
  shutdown(): Promise<void>;
};

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function resolveAccount(
  accounts: ActualAccount[],
  wanted: string,
): ActualAccount {
  const needle = wanted.trim().toLowerCase();

  const match =
    accounts.find(account => account.id === wanted) ??
    accounts.find(account => account.name.trim().toLowerCase() === needle);

  if (!match) {
    const available = accounts
      .filter(account => !account.closed)
      .map(account => `  ${account.name}`)
      .join('\n');
    throw new Error(
      `No account matching "${wanted}". Open accounts:\n${available || '  (none)'}`,
    );
  }

  return match;
}

/**
 * Send transactions to Actual.
 *
 * `@actual-app/api` is imported dynamically so the converter works without it
 * installed, and so a missing install produces an actionable message rather
 * than a module-resolution error at startup.
 */
export async function pushTransactions(
  transactions: StatementTransaction[],
  config: PushConfig,
): Promise<PushResult> {
  let api: ActualApi;
  try {
    // Non-literal specifier on purpose: it keeps TypeScript from trying to
    // resolve an optional dependency that may not be installed.
    const specifier = '@actual-app/api';
    api = (await import(specifier)) as unknown as ActualApi;
  } catch {
    throw new Error(
      '--push needs @actual-app/api, which installs automatically as an\n' +
        'optional dependency. Reinstall with optional dependencies enabled:\n' +
        '  npm install --include=optional india2actual',
    );
  }

  // The API reads this directory on startup and fails if it does not exist.
  await mkdir(config.dataDir, { recursive: true });

  await api.init({
    dataDir: config.dataDir,
    serverURL: config.serverURL,
    password: config.password,
  });

  try {
    await api.downloadBudget(
      config.syncId,
      config.encryptionPassword
        ? { password: config.encryptionPassword }
        : undefined,
    );

    const accounts = await api.getAccounts();
    const account = resolveAccount(accounts, config.account);

    let transfer: { payeeId: string; skip: Set<number> } | undefined;
    let transferAccountName: string | undefined;
    if (config.transferTo) {
      const other = resolveAccount(accounts, config.transferTo);
      if (other.id === account.id) {
        throw new Error('--transfer-to must name a different account.');
      }

      const payee = (await api.getPayees()).find(
        candidate => candidate.transfer_acct === other.id,
      );
      if (!payee) {
        throw new Error(`Actual has no transfer payee for "${other.name}".`);
      }

      const dates = transactions.filter(isCardPayment).map(t => t.date).sort();
      const first = dates[0];
      const last = dates[dates.length - 1];
      const existing =
        first && last
          ? await api.getTransactions(
              other.id,
              shiftDate(first, -MATCH_WINDOW_DAYS),
              shiftDate(last, MATCH_WINDOW_DAYS),
            )
          : [];

      transfer = {
        payeeId: payee.id,
        skip: new Set(findExistingCounterparts(transactions, existing)),
      };
      transferAccountName = other.name;
    }

    const result = await api.importTransactions(
      account.id,
      toImportEntities(transactions, transfer),
      {
        dryRun: config.dryRun,
        defaultCleared: true,
        // Actual title-cases imported payees by default, which lowercases
        // first: `DMart` would become `Dmart` and `HDFC ... SIP` would become
        // `Hdfc ... Sip`. The names here are already deliberately cased.
        payeeNameNormalization: 'original',
      },
    );

    return {
      accountName: account.name,
      accountId: account.id,
      added: result.added?.length ?? 0,
      updated: result.updated?.length ?? 0,
      errors: (result.errors ?? []).map(error => error.message),
      dryRun: config.dryRun,
      ...(transfer && transferAccountName
        ? {
            transfer: {
              accountName: transferAccountName,
              sent: transactions.filter(
                (t, index) => isCardPayment(t) && !transfer.skip.has(index),
              ).length,
              unlinked: [...transfer.skip].flatMap(index => {
                const row = transactions[index];
                return row ? [{ date: row.date, amount: row.amount }] : [];
              }),
            },
          }
        : {}),
    };
  } finally {
    // Always shut down: this flushes the sync and closes the budget, and
    // leaving it open corrupts the local cache for the next run.
    await api.shutdown();
  }
}
