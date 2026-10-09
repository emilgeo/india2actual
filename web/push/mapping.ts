import type { Section } from '../../src/interpret/sections.js';

import type { Account } from './types.js';

const KEY = 'india2actual.accounts.v1';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'> | null;

type Mapping = Record<string, string>;

function read(storage: Storage): Mapping {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Mapping) : {};
  } catch {
    return {};
  }
}

/** What identifies a statement account across files: its digits, else its place. */
export function statementKey(
  syncId: string,
  section: Section,
  fileName: string,
  number: number,
): string {
  return `${syncId}|${section.account ?? `${fileName}#${number}`}`;
}

export function rememberAccount(
  storage: Storage,
  key: string,
  accountId: string,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ ...read(storage), [key]: accountId }));
  } catch {
    // Not remembering is fine.
  }
}

/**
 * The Actual account to start from: the one used last time, else the one open
 * in Actual beside this page, else one whose name carries the statement
 * account's last digits, else none.
 */
export function suggestAccount(
  storage: Storage,
  key: string,
  section: Section,
  accounts: Account[],
  open: string | null = null,
): string {
  const remembered = read(storage)[key];
  if (remembered && accounts.some(account => account.id === remembered)) {
    return remembered;
  }
  if (open && accounts.some(account => account.id === open)) {
    return open;
  }
  const digits = section.account;
  return (
    (digits && accounts.find(account => account.name.includes(digits))?.id) || ''
  );
}
