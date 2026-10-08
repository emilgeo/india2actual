import { describe, expect, it } from 'vitest';

import type { Table } from '../extract/types.js';

import { closingBalance, startingBalance, startingBalanceRow } from './opening.js';
import { interpretSections } from './sections.js';

const HEADER = ['Date', 'Narration', 'Withdrawal', 'Deposit', 'Balance'];

function sectionFor(rows: string[][], totals?: Table['totals']) {
  const table: Table = {
    rows: [HEADER, ...rows],
    ...(totals ? { totals } : {}),
    source: { path: 'test.pdf', format: 'pdf' },
  };
  const [section] = interpretSections([table]);
  if (!section) {
    throw new Error('no section');
  }
  return section;
}

describe('startingBalance', () => {
  it('works back from the oldest row when the statement runs oldest first', () => {
    const section = sectionFor([
      ['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00'],
      ['13/03/2025', 'ACME CAFE', '', '430.00', '9,705.00'],
    ]);

    expect(startingBalance(section)).toBe(10000);
  });

  it('works back from the last row when the statement runs newest first', () => {
    const section = sectionFor([
      ['13/03/2025', 'ACME CAFE', '', '430.00', '9,705.00'],
      ['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00'],
    ]);

    expect(startingBalance(section)).toBe(10000);
  });

  it('uses a printed opening balance when it agrees', () => {
    const section = sectionFor(
      [['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00']],
      [{ label: 'Opening Balance', value: '10,000.00 CR' }],
    );

    expect(startingBalance(section)).toBe(10000);
  });

  it('trusts neither figure when they disagree', () => {
    const section = sectionFor(
      [['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00']],
      [{ label: 'Opening Balance', value: '9,000.00' }],
    );

    expect(startingBalance(section)).toBeNull();
  });

  it('is null when the statement carries no balances', () => {
    const section = sectionFor([['12/03/2025', 'ACME STORE', '725.00', '', '']]);

    expect(startingBalance(section)).toBeNull();
  });
});

describe('startingBalanceRow', () => {
  it('builds a row on the first transaction date with no reference', () => {
    const section = sectionFor([
      ['13/03/2025', 'ACME CAFE', '', '430.00', '9,705.00'],
      ['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00'],
    ]);

    expect(startingBalanceRow(section)).toEqual({
      date: '2025-03-12',
      amount: 10000,
      payee: 'Starting Balance',
      raw: 'Opening balance from the statement',
      kind: 'other',
    });
  });

  it('is null when the opening balance is zero', () => {
    const section = sectionFor([
      ['12/03/2025', 'ACME CAFE', '', '430.00', '430.00'],
    ]);

    expect(startingBalanceRow(section)).toBeNull();
  });
});

describe('closingBalance', () => {
  it('is the balance of the newest row, whichever way the statement runs', () => {
    const oldestFirst = sectionFor([
      ['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00'],
      ['13/03/2025', 'ACME CAFE', '', '430.00', '9,705.00'],
    ]);
    const newestFirst = sectionFor([
      ['13/03/2025', 'ACME CAFE', '', '430.00', '9,705.00'],
      ['12/03/2025', 'ACME STORE', '725.00', '', '9,275.00'],
    ]);

    expect(closingBalance(oldestFirst)).toEqual({ amount: 9705, date: '2025-03-13' });
    expect(closingBalance(newestFirst)).toEqual({ amount: 9705, date: '2025-03-13' });
  });

  it('is null when no row carries a balance', () => {
    const section = sectionFor([['12/03/2025', 'ACME STORE', '725.00', '', '']]);

    expect(closingBalance(section)).toBeNull();
  });
});
