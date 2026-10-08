import type { StatementTransaction } from './rows.js';
import { openingBalance } from './sections.js';
import type { Section } from './sections.js';
import { validateBalances } from './validate.js';

export const STARTING_BALANCE_PAYEE = 'Starting Balance';

/** Half a paisa, comfortably inside any rounding a bank applies. */
const EPSILON = 0.005;

/**
 * The balance the account held before its first transaction, or null when the
 * statement does not show enough to say.
 *
 * Taken from an opening balance the table prints, else worked back from the
 * oldest row's balance. If both exist and disagree, neither is trusted.
 */
export function startingBalance(section: Section): number | null {
  const { transactions } = section.result;
  if (section.result.card) {
    return null;
  }

  const printed = openingBalance(section.table, section.result);

  // Rows run oldest first or newest first, and the balance check says which.
  const order = validateBalances(transactions).order;
  const oldest =
    order === 'descending'
      ? transactions[transactions.length - 1]
      : transactions[0];
  const derived =
    oldest && oldest.balance !== undefined
      ? oldest.balance - oldest.amount
      : null;

  if (printed !== null && derived !== null) {
    return Math.abs(printed - derived) < EPSILON ? printed : null;
  }
  return printed ?? derived;
}

/**
 * A row that opens the account at the balance it had before the statement, so
 * a first import leaves Actual agreeing with the bank. Null when the balance
 * is unknown or zero.
 */
export function startingBalanceRow(
  section: Section,
): StatementTransaction | null {
  const amount = startingBalance(section);
  const dates = section.result.transactions.map(row => row.date).sort();
  const date = dates[0];
  if (amount === null || Math.abs(amount) < EPSILON || !date) {
    return null;
  }

  return {
    date,
    amount,
    payee: STARTING_BALANCE_PAYEE,
    raw: 'Opening balance from the statement',
    kind: 'other',
  };
}
