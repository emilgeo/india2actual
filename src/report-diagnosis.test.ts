import { describe, expect, it } from 'vitest';

import type { SkippedRow, StatementTransaction } from './interpret/rows.js';
import { diagnoseBalance } from './report-diagnosis.js';

/** Invented rows. Balances are built from the true amounts, so tests can then misread the amounts. */
function ledger(
  start: number,
  rows: Array<{ date?: string; amount: number; balance?: boolean }>,
): StatementTransaction[] {
  let balance = start;
  return rows.map((row, index) => {
    balance = Math.round((balance + row.amount) * 100) / 100;
    return {
      date: row.date ?? `2025-03-${String(index + 1).padStart(2, '0')}`,
      amount: row.amount,
      payee: 'ACME STORE',
      raw: 'ACME STORE PUNE IN',
      kind: 'other',
      ...(row.balance === false ? {} : { balance }),
    } as StatementTransaction;
  });
}

const TRUE_AMOUNTS = [-120, 500, -35.5, -60, 250, -80, 40.25, -15];
const clean = () => ledger(1000, TRUE_AMOUNTS.map(amount => ({ amount })));

const text = (lines: string[]) => lines.join('\n');

describe('diagnoseBalance', () => {
  it('says nothing when every row agrees', () => {
    expect(diagnoseBalance(clean(), [])).toEqual([]);
  });

  it('recognises amounts read with the opposite sign', () => {
    const flipped = clean().map(row => ({ ...row, amount: -row.amount }));
    const out = text(diagnoseBalance(flipped, []));
    expect(out).toMatch(/sign flipped \(parsed debits\)=[1-9]/);
    expect(out).toMatch(/every amount had the opposite sign: 7 of 7 agree/);
    expect(out).toMatch(/first to the last balanced row equals the sum of the parsed amounts: no/);
  });

  it('separates a flip on only one side', () => {
    const rows = clean().map(row => (row.amount > 0 ? { ...row, amount: -row.amount } : row));
    const out = text(diagnoseBalance(rows, []));
    expect(out).toMatch(/sign flipped \(parsed debits\)=[1-9]/);
    expect(out).not.toContain('parsed credits');
  });

  it('recognises a swapped adjacent pair and an unchanged total', () => {
    const rows = clean();
    [rows[3], rows[4]] = [rows[4]!, rows[3]!];
    const out = text(diagnoseBalance(rows, []));
    expect(out).toMatch(/swapped-pair pattern=[1-9]/);
    expect(out).toMatch(/equals the sum of the parsed amounts: yes/);
  });

  it('recognises rows without a balance between two balanced rows', () => {
    const rows = ledger(1000, [
      { amount: -10 },
      { amount: -20, balance: false },
      { amount: -30 },
      { amount: 5 },
    ]);
    // Misread: the second row's amount is wrong, so the gap sum no longer matches either.
    rows[2] = { ...rows[2]!, amount: -31 };
    const out = text(diagnoseBalance(rows, []));
    expect(out).toMatch(/none of these=[1-9]/);
    const ok = ledger(1000, [{ amount: -10 }, { amount: -20, balance: false }, { amount: -30 }]);
    expect(text(diagnoseBalance(ok, []))).toMatch(/rows without a balance in between=1/);
  });

  it('counts a balance that did not move', () => {
    const rows = clean();
    rows[2] = { ...rows[2]!, balance: rows[1]!.balance! };
    expect(text(diagnoseBalance(rows, []))).toMatch(/balance did not move=[1-9]/);
  });

  it('describes failures in newest-first statements', () => {
    const rows = clean().reverse();
    rows[2] = { ...rows[2]!, amount: -rows[2]!.amount };
    const out = text(diagnoseBalance(rows, []));
    expect(out).toContain('Row order read from the balances: newest first');
    expect(out).toContain('sign flipped');
  });

  it('says the order is undetermined on a tie', () => {
    const rows = ledger(100, [{ amount: -10 }, { amount: -10 }]);
    // Two balances, one pair; make it fail both ways.
    rows[1] = { ...rows[1]!, amount: 7 };
    expect(text(diagnoseBalance(rows, []))).toContain('undetermined');
  });

  it('lists failing positions as ranges and counts runs', () => {
    const rows = clean();
    for (const index of [2, 3, 6]) {
      rows[index] = { ...rows[index]!, amount: rows[index]!.amount * 3 };
    }
    const out = text(diagnoseBalance(rows, []));
    expect(out).toMatch(/Failing rows \(position in the parsed list\): 3-4, 7/);
    expect(out).toMatch(/Failure runs: 2, longest 2/);
  });

  it('counts failing rows that share a date with their neighbour', () => {
    const rows = ledger(1000, [
      { amount: -10, date: '2025-03-01' },
      { amount: -20, date: '2025-03-02' },
      { amount: -30, date: '2025-03-02' },
    ]);
    rows[2] = { ...rows[2]!, amount: 30 };
    expect(text(diagnoseBalance(rows, []))).toMatch(/same date as the neighbouring row: 1 of /);
  });

  it('counts skipped rows that hold an amount-shaped cell', () => {
    const rows = clean();
    rows[3] = { ...rows[3]!, amount: 1 };
    const skipped: SkippedRow[] = [
      { index: 1, reason: 'no parseable date', row: ['text only', 'more text'] },
      { index: 2, reason: 'no parseable date', row: ['text', '1,234.50'] },
    ];
    expect(text(diagnoseBalance(rows, skipped))).toMatch(/Skipped rows with an amount-shaped cell: 1 of 2/);
  });

  it('never writes an amount, balance or date', () => {
    const rows = clean().map(row => ({ ...row, amount: -row.amount }));
    const out = text(diagnoseBalance(rows, [{ index: 1, reason: 'x', row: ['12.34'] }]));
    expect(out).not.toMatch(/\d+\.\d{2}/);
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
