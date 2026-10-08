import type { StatementTransaction } from '../../src/interpret/rows.js';
import { pushWithApi } from '../../src/out/push.js';
import type { PushOptions, PushResult } from '../../src/out/push.js';

import type { Connection } from './types.js';

export type PushRequest = {
  accountId: string;
  /** Another account to send card payments to as transfers. */
  transferToId?: string;
};

const options = (request: PushRequest, dryRun: boolean): PushOptions => ({
  account: request.accountId,
  dryRun,
  ...(request.transferToId ? { transferTo: request.transferToId } : {}),
});

/** What an import would do, without writing anything. */
export function preview(
  connection: Connection,
  rows: StatementTransaction[],
  request: PushRequest,
): Promise<PushResult> {
  return pushWithApi(connection.api, rows, options(request, true));
}

/** Import the rows and sync, so the change reaches the server. */
export async function importRows(
  connection: Connection,
  rows: StatementTransaction[],
  request: PushRequest,
): Promise<PushResult> {
  const result = await pushWithApi(connection.api, rows, options(request, false));
  await connection.api.sync();
  return result;
}

/** How many transactions the account already has over the statement's dates. */
export async function existingOverlap(
  connection: Connection,
  accountId: string,
  rows: StatementTransaction[],
): Promise<number> {
  const dates = rows.map(row => row.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) {
    return 0;
  }
  return (await connection.api.getTransactions(accountId, first, last)).length;
}

/** Local midnight, so a date means the same day wherever the page runs. */
function localDate(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Actual's balance for the account on a date, in rupees. */
export async function balanceOn(
  connection: Connection,
  accountId: string,
  date: string,
): Promise<number> {
  return (await connection.api.getAccountBalance(accountId, localDate(date))) / 100;
}

/** Delete what an import added, and sync. */
export async function undoImport(
  connection: Connection,
  ids: string[],
): Promise<void> {
  for (const id of ids) {
    await connection.api.deleteTransaction(id);
  }
  await connection.api.sync();
}

export type RuleRequest = { payee: string; categoryId: string };

/**
 * Make Actual categorise a payee on its own from now on. Skips a payee that
 * already has a rule setting a category, and one Actual does not know yet.
 */
export async function createCategoryRules(
  connection: Connection,
  requests: RuleRequest[],
): Promise<number> {
  const { api } = connection;
  const payees = await api.getPayees();
  const rules = await api.getRules();
  let created = 0;

  for (const request of requests) {
    const payee = payees.find(candidate => candidate.name === request.payee);
    if (!payee) {
      continue;
    }
    const covered = rules.some(
      rule =>
        rule.conditions.some(
          condition => condition.field === 'payee' && condition.value === payee.id,
        ) && rule.actions.some(action => action.field === 'category'),
    );
    if (covered) {
      continue;
    }
    await api.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: payee.id }],
      actions: [{ op: 'set', field: 'category', value: request.categoryId }],
    });
    created += 1;
  }

  if (created) {
    await api.sync();
  }
  return created;
}
