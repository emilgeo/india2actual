import type { Table } from '../extract/types.js';

import { interpretTable } from './rows.js';
import type { Interpreted, InterpretOptions } from './rows.js';
import { parseAmount } from './values.js';

/** One account's rows, read from one or more tables. */
export type Section = {
  /** Last four digits of the account number, when the statement printed one. */
  account?: string;
  table: Table;
  result: Interpreted;
};

const OPENING_ROW =
  /^\s*(b\/f|opening balance|balance (b\/f|brought forward)|brought forward)/i;

/** Half a paisa, comfortably inside any rounding a bank applies. */
const EPSILON = 0.005;

/**
 * The balance a table says it starts from, taken from an opening balance row
 * it prints, or null when it prints none.
 */
export function openingBalance(
  table: Table,
  result: Interpreted,
): number | null {
  const printed = table.totals?.find(figure =>
    OPENING_ROW.test(figure.label),
  );
  if (printed) {
    return parseAmount(printed.value);
  }

  const { map, index } = result.header;
  const first = result.skipped.find(row => row.index === index + 1);
  const description = map.description === undefined ? '' : first?.row[map.description];
  if (!first || !description || !OPENING_ROW.test(description)) {
    return null;
  }
  return map.balance === undefined
    ? null
    : parseAmount(first.row[map.balance] ?? '');
}

function endBalances(result: Interpreted): number[] {
  const balances = result.transactions
    .map(transaction => transaction.balance)
    .filter((balance): balance is number => balance !== undefined);
  return balances.length
    ? [balances[0] as number, balances[balances.length - 1] as number]
    : [];
}

/**
 * Is this table the same account carrying on from the previous one?
 *
 * A statement repeats its header on every page, so a table that follows
 * another is usually a continuation. It is a different account when its
 * account number differs, or when it opens with a balance that does not
 * continue where the previous table stopped.
 */
function continues(
  previous: Section,
  table: Table,
  result: Interpreted,
): boolean {
  if (previous.account && table.account && previous.account !== table.account) {
    return false;
  }

  const opening = openingBalance(table, result);
  if (opening === null) {
    return true;
  }

  return endBalances(previous.result).some(
    balance => Math.abs(balance - opening) < EPSILON,
  );
}

function join(first: Table, next: Table): Table {
  const totals = [...(first.totals ?? []), ...(next.totals ?? [])];
  return {
    ...first,
    // The next table's first row is its repeated header.
    rows: [...first.rows, ...next.rows.slice(1)],
    ...(totals.length ? { totals } : {}),
  };
}

/**
 * Read each account's rows from a statement's tables.
 *
 * Tables that carry on from one another are joined, so a statement whose
 * table runs over a page break is still one account. Tables with no
 * recognisable transaction columns are dropped.
 */
export function interpretSections(
  tables: Table[],
  options: InterpretOptions = {},
): Section[] {
  const sections: Section[] = [];

  for (const table of tables) {
    const result = interpretTable(table, options);
    if (!result) {
      continue;
    }

    const previous = sections[sections.length - 1];
    if (previous && continues(previous, table, result)) {
      const joined = join(previous.table, table);
      const rejoined = interpretTable(joined, options);
      if (rejoined) {
        sections[sections.length - 1] = {
          ...(previous.account ? { account: previous.account } : {}),
          table: joined,
          result: rejoined,
        };
        continue;
      }
    }

    sections.push({
      ...(table.account ? { account: table.account } : {}),
      table,
      result,
    });
  }

  return sections;
}
