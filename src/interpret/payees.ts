import type { PayeeSource } from '../narration/types.js';

import type { StatementTransaction } from './rows.js';

/** Sources that are guesses a person may want to correct. */
const UNCLEAR: ReadonlySet<PayeeSource> = new Set([
  'vpa',
  'single',
  'account',
  'mandate',
  'raw',
]);

export type PayeeGroup = {
  /** Merchant rule pattern shared by the group, empty when there is none. */
  rule: string;
  /** The name the rows currently carry. */
  payee: string;
  source: PayeeSource;
  count: number;
  /** Net amount of the group, signed. */
  total: number;
  /** One narration from the group, as the bank wrote it. */
  example: string;
  /** Positions in the list the group was built from. */
  indexes: number[];
};

export function isUnclear(transaction: StatementTransaction): boolean {
  return (
    transaction.payeeSource !== undefined &&
    UNCLEAR.has(transaction.payeeSource)
  );
}

/**
 * Transactions grouped by the merchant rule that would name them, so one
 * correction covers every row like it. Only the unclear ones by default,
 * most frequent first.
 */
export function payeeGroups(
  transactions: StatementTransaction[],
  options: { all?: boolean } = {},
): PayeeGroup[] {
  const groups = new Map<string, PayeeGroup>();

  for (const [index, transaction] of transactions.entries()) {
    if (!options.all && !isUnclear(transaction)) {
      continue;
    }

    const key = transaction.payeeRule || `payee:${transaction.payee}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.total += transaction.amount;
      group.indexes.push(index);
    } else {
      groups.set(key, {
        rule: transaction.payeeRule ?? '',
        payee: transaction.payee,
        source: transaction.payeeSource ?? 'raw',
        count: 1,
        total: transaction.amount,
        example: transaction.raw,
        indexes: [index],
      });
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total),
  );
}
