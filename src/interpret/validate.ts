import type { Figure } from '../extract/types.js';

import type { StatementTransaction } from './rows.js';
import { parseAmount } from './values.js';

export type ValidationStatus = 'passed' | 'failed' | 'skipped';

export type Validation = {
  status: ValidationStatus;
  /** Row order the balance column implies, when it could be determined. */
  order?: 'ascending' | 'descending';
  /** Number of consecutive pairs checked. */
  checked: number;
  matched: number;
  issues: string[];
};

/** Half a paisa, comfortably inside any rounding a bank applies. */
const EPSILON = 0.005;

/**
 * Verify parsed amounts against the statement's running balance.
 *
 * Almost every Indian statement carries a closing-balance column, which makes
 * the parse self-checkable: each transaction must equal the change in balance
 * it caused. This is the difference between "the numbers look plausible" and
 * "the numbers are provably right", and it catches precisely the failure modes
 * of geometric PDF extraction: inverted debit/credit signs, dropped rows, and
 * columns read one position across.
 *
 * Statements come in both date orders, so both interpretations are scored and
 * the better one wins:
 *   ascending  (oldest first): amount[i] === balance[i] - balance[i-1]
 *   descending (newest first): amount[i] === balance[i] - balance[i+1]
 */
export function validateBalances(
  transactions: StatementTransaction[],
): Validation {
  const withBalance = transactions.filter(
    transaction => transaction.balance !== undefined,
  );

  if (withBalance.length < 2) {
    return {
      status: 'skipped',
      checked: 0,
      matched: 0,
      issues: [
        withBalance.length === 0
          ? 'No balance column found, amounts could not be cross-checked.'
          : 'Only one row carried a balance, not enough to cross-check.',
      ],
    };
  }

  const ascending: string[] = [];
  const descending: string[] = [];
  let ascendingMatches = 0;
  let descendingMatches = 0;

  for (let index = 1; index < withBalance.length; index += 1) {
    const current = withBalance[index];
    const previous = withBalance[index - 1];
    if (!current || !previous) {
      continue;
    }

    // Ascending: this row's balance moved by this row's amount.
    const ascDelta = (current.balance ?? 0) - (previous.balance ?? 0);
    if (Math.abs(ascDelta - current.amount) < EPSILON) {
      ascendingMatches += 1;
    } else {
      ascending.push(describe(current, ascDelta));
    }

    // Descending: the *previous* row is the later transaction, so its amount
    // explains the gap between the two balances.
    const descDelta = (previous.balance ?? 0) - (current.balance ?? 0);
    if (Math.abs(descDelta - previous.amount) < EPSILON) {
      descendingMatches += 1;
    } else {
      descending.push(describe(previous, descDelta));
    }
  }

  const checked = withBalance.length - 1;
  const isDescending = descendingMatches > ascendingMatches;
  const matched = isDescending ? descendingMatches : ascendingMatches;
  const failures = isDescending ? descending : ascending;

  if (matched === checked) {
    return {
      status: 'passed',
      order: isDescending ? 'descending' : 'ascending',
      checked,
      matched,
      issues: [],
    };
  }

  return {
    status: 'failed',
    order: isDescending ? 'descending' : 'ascending',
    checked,
    matched,
    issues: [
      `${checked - matched} of ${checked} rows do not agree with the balance column.`,
      // A handful of examples is enough to diagnose; the full list is noise.
      ...failures.slice(0, 5),
    ],
  };
}

function describe(
  transaction: StatementTransaction,
  observedDelta: number,
): string {
  const expected = observedDelta.toFixed(2);
  const actual = transaction.amount.toFixed(2);
  return `${transaction.date} "${truncate(transaction.raw)}": balance moved by ${expected} but the parsed amount is ${actual}`;
}

function truncate(value: string, limit = 60): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

const SPENT_LABELS = [
  /^purchases?/i,
  /^cash\s*advances?/i,
  // Printed apart from purchases by some issuers, but listed as rows.
  /^finance\s*charges?/i,
  /^fees?/i,
];
const PAID_LABELS = [/^payments?/i];

function figureTotal(figures: Figure[], labels: RegExp[]): number | null {
  const found = figures.filter(figure =>
    labels.some(label => label.test(figure.label)),
  );
  if (!found.length) {
    return null;
  }
  return found.reduce(
    (sum, figure) => sum + Math.abs(parseAmount(figure.value) ?? 0),
    0,
  );
}

/**
 * Verify a credit card statement against the totals it prints for the period.
 *
 * A card statement has no running balance, but it states what was spent and
 * what was paid, so the parsed rows must add up to both.
 */
export function validateCardTotals(
  transactions: StatementTransaction[],
  figures: Figure[] = [],
): Validation {
  const checks: Array<{ name: string; stated: number; parsed: number }> = [];
  const spent = figureTotal(figures, SPENT_LABELS);
  const paid = figureTotal(figures, PAID_LABELS);

  if (spent !== null) {
    checks.push({
      name: 'Purchases and cash advances',
      stated: spent,
      parsed: -transactions.reduce(
        (sum, t) => sum + Math.min(t.amount, 0),
        0,
      ),
    });
  }
  if (paid !== null) {
    checks.push({
      name: 'Payments and credits',
      stated: paid,
      parsed: transactions.reduce((sum, t) => sum + Math.max(t.amount, 0), 0),
    });
  }

  if (!checks.length) {
    return {
      status: 'skipped',
      checked: 0,
      matched: 0,
      issues: [
        'No statement summary found, amounts could not be cross-checked.',
      ],
    };
  }

  const failures = checks.filter(
    check => Math.abs(check.stated - check.parsed) >= EPSILON,
  );

  return {
    status: failures.length ? 'failed' : 'passed',
    checked: checks.length,
    matched: checks.length - failures.length,
    issues: failures.map(
      check =>
        `${check.name}: the statement says ${check.stated.toFixed(2)} but the parsed rows total ${check.parsed.toFixed(2)}`,
    ),
  };
}

const SECTION_CREDITS = /^total\b.*\b(deposit|credit)s?\b/i;
const SECTION_DEBITS = /^total\b.*\b(withdrawal|debit)s?\b/i;
const SECTION_CLOSING = /^(closing balance|total\b.*\bbalance)$/i;
const SECTION_OPENING = /^(opening balance|b\/f)$/i;

function printedFigure(figures: Figure[], label: RegExp): number | null {
  const found = figures.find(figure => label.test(figure.label));
  return found ? parseAmount(found.value) : null;
}

/**
 * Verify an account's rows against the totals printed in its own table.
 *
 * Statements that hold several accounts print a totals row or a closing
 * balance for each, which catches a dropped or misread row even where the
 * running balance happens to stay consistent. Skipped when the table prints
 * none of them.
 */
export function validateSectionTotals(
  transactions: StatementTransaction[],
  totals: Figure[] = [],
): Validation {
  const checks: Array<{ name: string; stated: number; parsed: number }> = [];
  const credits = printedFigure(totals, SECTION_CREDITS);
  const debits = printedFigure(totals, SECTION_DEBITS);
  const closing = printedFigure(totals, SECTION_CLOSING);
  const opening = printedFigure(totals, SECTION_OPENING);

  if (credits !== null) {
    checks.push({
      name: 'Deposits',
      stated: Math.abs(credits),
      parsed: transactions.reduce((sum, t) => sum + Math.max(t.amount, 0), 0),
    });
  }
  if (debits !== null) {
    checks.push({
      name: 'Withdrawals',
      stated: Math.abs(debits),
      parsed: -transactions.reduce((sum, t) => sum + Math.min(t.amount, 0), 0),
    });
  }
  const balances = transactions
    .map(t => t.balance)
    .filter((balance): balance is number => balance !== undefined);
  // Either end, since statements run oldest first or newest first.
  const ends = [balances[0], balances[balances.length - 1]].filter(
    (balance): balance is number => balance !== undefined,
  );
  const nearest = (value: number) =>
    [...ends].sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0];

  if (closing !== null && ends.length) {
    checks.push({
      name: 'Closing balance',
      stated: closing,
      parsed: nearest(closing) as number,
    });
  }
  if (opening !== null && ends.length) {
    const expected = opening + transactions.reduce((sum, t) => sum + t.amount, 0);
    checks.push({
      name: 'Opening balance plus movement',
      stated: nearest(expected) as number,
      parsed: expected,
    });
  }

  if (!checks.length) {
    return {
      status: 'skipped',
      checked: 0,
      matched: 0,
      issues: ['The table prints no totals to cross-check.'],
    };
  }

  const failures = checks.filter(
    check => Math.abs(check.stated - check.parsed) >= EPSILON,
  );

  return {
    status: failures.length ? 'failed' : 'passed',
    checked: checks.length,
    matched: checks.length - failures.length,
    issues: failures.map(
      check =>
        `${check.name}: the statement says ${check.stated.toFixed(2)} but the parsed rows give ${check.parsed.toFixed(2)}`,
    ),
  };
}
