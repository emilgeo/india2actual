import type { SkippedRow, StatementTransaction } from './interpret/rows.js';

type Order = 'ascending' | 'descending';

/** Half a paisa, the same tolerance the balance check uses. */
const EPSILON = 0.005;

/** Failing positions listed before the rest are only counted. */
const MAX_RANGES = 12;

const AMOUNT_CELL = /^\(?-?\d[\d,]*\.\d{2}\)?(\s?(cr|dr))?$/i;

type Pair = {
  /** Index in the parsed list of the row the check blames. */
  blamed: number;
  /** Index of the other row of the pair. */
  other: number;
  /** Balance change between the two rows, in the direction of time. */
  delta: number;
  /** What the blamed row's amount would have to be. */
  amount: number;
  /** Sum of every amount that lies between the two balances, rows without a balance included. */
  between: number;
  /** Whether any row without a balance lies between the two. */
  gap: boolean;
};

const agrees = (pair: Pair) => Math.abs(pair.delta - pair.amount) < EPSILON;
const close = (a: number, b: number) => Math.abs(a - b) < EPSILON;

/** Adjacent pairs of the rows that carry a balance, as the balance check builds them. */
function pairsFor(
  rows: StatementTransaction[],
  order: Order,
  amountOf: (row: StatementTransaction) => number,
  balanceOf: (row: StatementTransaction) => number,
): Pair[] {
  const balanced = rows.flatMap((row, index) => (row.balance === undefined ? [] : [index]));
  const pairs: Pair[] = [];

  for (let k = 1; k < balanced.length; k += 1) {
    const previous = balanced[k - 1] as number;
    const current = balanced[k] as number;
    const asc = order === 'ascending';
    const blamed = asc ? current : previous;
    const from = asc ? previous + 1 : previous;
    const to = asc ? current : current - 1;
    let between = 0;
    for (let i = from; i <= to; i += 1) {
      between += amountOf(rows[i] as StatementTransaction);
    }
    const before = balanceOf(rows[previous] as StatementTransaction);
    const after = balanceOf(rows[current] as StatementTransaction);
    pairs.push({
      blamed,
      other: asc ? previous : current,
      delta: asc ? after - before : before - after,
      amount: amountOf(rows[blamed] as StatementTransaction),
      between,
      gap: current - previous > 1,
    });
  }
  return pairs;
}

const score = (
  rows: StatementTransaction[],
  amountOf: (row: StatementTransaction) => number = row => row.amount,
  balanceOf: (row: StatementTransaction) => number = row => row.balance as number,
) =>
  Math.max(
    ...(['ascending', 'descending'] as const).map(
      order => pairsFor(rows, order, amountOf, balanceOf).filter(agrees).length,
    ),
  );

/** Position ranges like `3-4, 7`, shortened after a fixed number. */
function ranges(positions: number[]): string {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const spans: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (sorted[j + 1] === (sorted[j] as number) + 1) {
      j += 1;
    }
    spans.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return spans.length > MAX_RANGES
    ? `${spans.slice(0, MAX_RANGES).join(', ')} and ${spans.length - MAX_RANGES} more`
    : spans.join(', ');
}

function relationOf(
  pair: Pair,
  rows: StatementTransaction[],
): 'did not move' | 'flipped debit' | 'flipped credit' | 'gap' | 'swap' | 'other' {
  const { delta, amount } = pair;
  if (Math.abs(delta) < EPSILON) {
    return 'did not move';
  }
  if (close(delta, -amount)) {
    return amount < 0 ? 'flipped debit' : 'flipped credit';
  }
  if (pair.gap && close(delta, pair.between)) {
    return 'gap';
  }
  const neighbours = [rows[pair.blamed - 1], rows[pair.blamed + 1]].flatMap(row =>
    row ? [row.amount] : [],
  );
  const swapped = neighbours.some(
    n =>
      close(delta, n) ||
      close(delta, -n) ||
      close(delta, amount + n) ||
      close(delta, amount - n) ||
      close(delta, n - amount) ||
      close(delta, -amount - n),
  );
  return swapped ? 'swap' : 'other';
}

const RELATION_LABEL = {
  'did not move': 'balance did not move',
  'flipped debit': 'sign flipped (parsed debits)',
  'flipped credit': 'sign flipped (parsed credits)',
  gap: 'rows without a balance in between',
  swap: 'swapped-pair pattern',
  other: 'none of these',
} as const;

/**
 * Lines that say why a running-balance check failed, as counts and yes or no
 * answers only: no amount, balance or date is ever written. Empty when the
 * check cannot run or every row agrees. The balance check itself is not
 * changed; its pairing and tolerance are repeated here.
 */
export function diagnoseBalance(
  rows: StatementTransaction[],
  skipped: SkippedRow[],
): string[] {
  const balanced = rows.filter(row => row.balance !== undefined);
  if (balanced.length < 2) {
    return [];
  }

  const ascending = pairsFor(rows, 'ascending', row => row.amount, row => row.balance as number);
  const descending = pairsFor(rows, 'descending', row => row.amount, row => row.balance as number);
  const ascMatches = ascending.filter(agrees).length;
  const descMatches = descending.filter(agrees).length;
  const order: Order = descMatches > ascMatches ? 'descending' : 'ascending';
  const pairs = order === 'descending' ? descending : ascending;
  const failing = pairs.filter(pair => !agrees(pair));
  if (failing.length === 0) {
    return [];
  }

  const counts = new Map<keyof typeof RELATION_LABEL, number>();
  for (const pair of failing) {
    const relation = relationOf(pair, rows);
    counts.set(relation, (counts.get(relation) ?? 0) + 1);
  }

  const failingAt = new Set(
    pairs.flatMap((pair, k) => (agrees(pair) ? [] : [k])),
  );
  let runs = 0;
  let longest = 0;
  let current = 0;
  for (let k = 0; k < pairs.length; k += 1) {
    if (failingAt.has(k)) {
      current += 1;
      if (current === 1) {
        runs += 1;
      }
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  const sameDate = failing.filter(
    pair => rows[pair.blamed]?.date === rows[pair.other]?.date,
  ).length;

  const first = balanced[0] as StatementTransaction;
  const last = balanced[balanced.length - 1] as StatementTransaction;
  const firstIndex = rows.indexOf(first);
  const lastIndex = rows.lastIndexOf(last);
  const ascTotals = ascMatches >= descMatches;
  const span = ascTotals
    ? rows.slice(firstIndex + 1, lastIndex + 1)
    : rows.slice(firstIndex, lastIndex);
  const change = ascTotals
    ? (last.balance as number) - (first.balance as number)
    : (first.balance as number) - (last.balance as number);
  const totalsHold = close(
    change,
    span.reduce((sum, row) => sum + row.amount, 0),
  );

  const tie = ascMatches === descMatches;
  const checked = pairs.length;
  const amountShaped = skipped.filter(skippedRow =>
    skippedRow.row.some(cell => AMOUNT_CELL.test(cell.trim())),
  ).length;
  const equalToBalance = balanced.filter(
    row =>
      Math.abs(row.amount) > EPSILON &&
      close(Math.abs(row.amount), Math.abs(row.balance as number)),
  ).length;

  return [
    'Why the balance check failed:',
    `  Row order read from the balances: ${
      tie ? 'undetermined (both orders agree equally)' : order === 'descending' ? 'newest first' : 'oldest first'
    }`,
    `  Failing pairs: ${failing.length} of ${checked}. Relation between the balance change and the amount: ${
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([relation, count]) => `${RELATION_LABEL[relation]}=${count}`)
        .join(', ')
    }`,
    `  Failing rows (position in the parsed list): ${ranges(failing.map(pair => pair.blamed + 1))}`,
    `  Failure runs: ${runs}, longest ${longest}`,
    `  Failing rows on the same date as the neighbouring row: ${sameDate} of ${failing.length}`,
    `  The balance change from the first to the last balanced row equals the sum of the parsed amounts: ${totalsHold ? 'yes' : 'no'}`,
    `  If every amount had the opposite sign: ${score(rows, row => -row.amount)} of ${checked} agree`,
    `  If balances were read as positive numbers: ${score(rows, row => row.amount, row => Math.abs(row.balance as number))} of ${checked} agree`,
    `  Rows whose amount equals the balance: ${equalToBalance} of ${balanced.length}`,
    `  Skipped rows with an amount-shaped cell: ${amountShaped} of ${skipped.length}`,
  ];
}
