import { useId, useState } from 'preact/hooks';

import { closingBalance } from '../../src/interpret/opening.js';
import type { StatementTransaction } from '../../src/interpret/rows.js';
import type { Section } from '../../src/interpret/sections.js';
import type { PushResult } from '../../src/out/push.js';

import { formatAmount, safeStorage } from '../dom.js';
import type { LoadedFile } from '../logic/files.js';

import {
  balanceOn,
  createCategoryRules,
  existingOverlap,
  importRows,
  preview,
  undoImport,
} from './actions.js';
import type { RuleRequest } from './actions.js';
import { rememberAccount, statementKey, suggestAccount } from './mapping.js';
import type { Connection } from './types.js';

type Props = {
  connection: Connection;
  file: LoadedFile;
  section: Section;
  number: number;
  /** The rows to send, with the user's choices applied. */
  rows: StatementTransaction[];
  ruleRequests: RuleRequest[];
};

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'previewed'; result: PushResult; overlap: number }
  | {
      kind: 'pushed';
      result: PushResult;
      rules: number;
      reconcile: { statement: number; actual: number; date: string } | null;
    }
  | { kind: 'undone'; count: number }
  | { kind: 'error'; message: string };

const storage = safeStorage();

function describeResult(result: PushResult): string {
  const parts = [
    `${result.added} new`,
    `${result.updated} matched an existing transaction`,
  ];
  if (result.ignored) {
    parts.push(`${result.ignored} skipped as already deleted`);
  }
  return parts.join(', ');
}

export function PushPanel({ connection, file, section, number, rows, ruleRequests }: Props) {
  const key = statementKey(connection.syncId, section, file.name, number);
  const accountId_ = useId();
  const transferId_ = useId();
  const [accountId, setAccountId] = useState(() =>
    suggestAccount(storage, key, section, connection.accounts),
  );
  const [transferToId, setTransferToId] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const request = {
    accountId,
    ...(transferToId ? { transferToId } : {}),
  };
  const busy = status.kind === 'working';
  const accountName =
    connection.accounts.find(account => account.id === accountId)?.name ?? '';

  const run = async (message: string, action: () => Promise<Status>) => {
    setStatus({ kind: 'working', message });
    try {
      setStatus(await action());
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onPreview = () =>
    run('Checking what an import would do...', async () => ({
      kind: 'previewed',
      result: await preview(connection, rows, request),
      overlap: await existingOverlap(connection, accountId, rows),
    }));

  const onPush = () =>
    run('Importing...', async () => {
      const result = await importRows(connection, rows, request);
      rememberAccount(storage, key, accountId);
      const rules = ruleRequests.length
        ? await createCategoryRules(connection, ruleRequests)
        : 0;
      const closing = closingBalance(section);
      return {
        kind: 'pushed',
        result,
        rules,
        reconcile: closing
          ? {
              statement: closing.amount,
              actual: await balanceOn(connection, accountId, closing.date),
              date: closing.date,
            }
          : null,
      };
    });

  const onUndo = (ids: string[]) =>
    run('Removing what was added...', async () => {
      await undoImport(connection, ids);
      return { kind: 'undone', count: ids.length };
    });

  return (
    <section class="panel push" aria-label="Push to Actual">
      <h4>Push to Actual</h4>
      <div class="fields">
        <div class="field">
          <label htmlFor={accountId_}>Import into</label>
          <select
            id={accountId_}
            value={accountId}
            disabled={busy}
            onChange={event => {
              setAccountId((event.currentTarget as HTMLSelectElement).value);
              setStatus({ kind: 'idle' });
            }}
          >
            <option value="">Choose an account</option>
            {connection.accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label htmlFor={transferId_}>Send card payments as transfers with</label>
          <select
            id={transferId_}
            value={transferToId}
            disabled={busy}
            onChange={event =>
              setTransferToId((event.currentTarget as HTMLSelectElement).value)
            }
          >
            <option value="">No one, import them as ordinary rows</option>
            {connection.accounts
              .filter(account => account.id !== accountId)
              .map(account => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div class="row">
        <button type="button" class="button" disabled={!accountId || busy || !rows.length} onClick={() => void onPreview()}>
          Preview
        </button>
        <button type="button" class="button primary" disabled={!accountId || busy || !rows.length} onClick={() => void onPush()}>
          Push {rows.length} {rows.length === 1 ? 'row' : 'rows'} to {accountName || 'Actual'}
        </button>
      </div>

      <div aria-live="polite">
        {status.kind === 'working' ? <p class="muted">{status.message}</p> : null}
        {status.kind === 'error' ? <p class="notice error">{status.message}</p> : null}

        {status.kind === 'previewed' ? (
          <p class="notice">
            An import would add or change: {describeResult(status.result)}.
            {status.overlap
              ? ` ${accountName} already has ${status.overlap} transactions over these dates.`
              : ''}
            {status.result.errors.length ? ` Problems: ${status.result.errors.join('; ')}` : ''}
          </p>
        ) : null}

        {status.kind === 'pushed' ? (
          <div class="notice">
            <p>
              Imported into {status.result.accountName}: {describeResult(status.result)}.
              {status.rules ? ` Created ${status.rules} Actual ${status.rules === 1 ? 'rule' : 'rules'}.` : ''}
              {status.result.errors.length ? ` Problems: ${status.result.errors.join('; ')}` : ''}
            </p>
            {status.reconcile ? (
              <p
                class={
                  Math.abs(status.reconcile.statement - status.reconcile.actual) < 0.005
                    ? 'reconcile ok'
                    : 'reconcile off'
                }
              >
                Statement balance on {status.reconcile.date}:{' '}
                {formatAmount(status.reconcile.statement)}. Actual:{' '}
                {formatAmount(status.reconcile.actual)}.{' '}
                {Math.abs(status.reconcile.statement - status.reconcile.actual) < 0.005
                  ? 'They match.'
                  : `They differ by ${formatAmount(status.reconcile.actual - status.reconcile.statement)}. Actual may hold other transactions, or the account lacks its starting balance.`}
              </p>
            ) : null}
            {status.result.addedIds.length ? (
              <button
                type="button"
                class="link"
                disabled={busy}
                onClick={() => void onUndo(status.result.addedIds)}
              >
                Undo: remove the {status.result.addedIds.length} added
              </button>
            ) : null}
          </div>
        ) : null}

        {status.kind === 'undone' ? (
          <p class="notice">Removed {status.count} transactions that this import added.</p>
        ) : null}
      </div>
    </section>
  );
}
