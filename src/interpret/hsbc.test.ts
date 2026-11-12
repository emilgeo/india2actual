import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';

import { extractTablesFromBytes } from '../extract/bytes.js';
import type { Table } from '../extract/types.js';
import { toCsv } from '../out/csv-text.js';
import { hsbcCsv, hsbcDescription, hsbcRows } from '../testing/hsbc.js';

import { checksFor } from './checks.js';
import { findHeader } from './header.js';
import { readHsbcHistory } from './hsbc.js';
import { interpretTable } from './rows.js';
import { interpretSections } from './sections.js';

function table(rows = hsbcRows()): Table {
  return { rows, source: { path: 'renamed-export.csv', format: 'csv' } };
}

const HEADER = ['Date', 'Description', 'Amount'];
const FIGURES = [
  { label: 'Purchases / Charges', value: '1,155.00' },
  { label: 'Payments / Credits', value: '1,625.00' },
];

describe('HSBC signed transaction history', () => {
  it('recognises the headerless signature without relying on a filename', () => {
    expect(findHeader(hsbcRows())).toBeNull();
    const history = readHsbcHistory(table());
    expect(history?.header).toEqual({
      index: -1, map: { date: 0, description: 1, amount: 2 },
    });
    expect(history?.rows.size).toBe(5);
    expect(history?.rows.get(0)).toEqual({
      postingDate: '2025-03-12',
      transactionDate: '2025-03-11',
      description: 'ACME STORE           PUNE IN',
      amount: -725,
    });
  });

  it('preserves purchases, repayments, refunds and reversal signs', () => {
    const result = interpretTable(table());
    expect(result).toMatchObject({ card: true, droppedRefs: 0, skipped: [] });
    expect(result?.transactions.map(t => [t.date, t.raw, t.amount])).toEqual([
      ['2025-03-11', hsbcRows()[0]?.[1], -725],
      ['2025-03-13', hsbcRows()[1]?.[1], 1430],
      ['2025-03-14', hsbcRows()[2]?.[1], 120],
      ['2025-03-15', hsbcRows()[3]?.[1], 75],
      ['2025-03-16', hsbcRows()[4]?.[1], -430],
    ]);
    expect(result?.transactions).toHaveLength(5);
    expect(result?.transactions.map(t => t.ref)).toEqual(Array(5).fill(undefined));
  });

  it('uses existing merchant normalisation without the card/date suffix', () => {
    const result = interpretTable(table());
    expect(result?.transactions[0]?.payee).toBe('Acme Store Pune');
    expect(result?.transactions[4]?.payee).toBe('Swiggy');
    const custom = interpretTable(table(), {
      merchantRules: [{ pattern: /^acmestore/, name: 'Local Store' }],
    });
    expect(custom?.transactions[0]).toMatchObject({
      payee: 'Local Store', raw: hsbcRows()[0]?.[1],
    });
  });

  it('retains the signed export convention when --card is requested', () => {
    expect(interpretTable(table(), { card: true })?.transactions.map(t => t.amount))
      .toEqual([-725, 1430, 120, 75, -430]);
  });

  it('honours an explicit date order for both dates', () => {
    const source = table([[
      '04/05/2025', hsbcDescription('ACME STORE', '03/05/2025'), '-725.00',
    ]]);
    expect(interpretTable(source)?.transactions[0]?.date).toBe('2025-05-03');
    expect(interpretTable(source, { dateOrder: 'mdy' })?.transactions[0]?.date)
      .toBe('2025-03-05');
  });

  it('handles a quoted multiline description through the CSV extractor', async () => {
    const description = hsbcDescription('ACME BOOK\nSTORE PUNE IN');
    const csv = hsbcCsv([['12/03/2025', description, '-725.00']]);
    const extracted = await extractTablesFromBytes(new TextEncoder().encode(csv), 'history.csv');
    const result = interpretTable(extracted.tables[0] as Table);
    expect(result?.transactions).toHaveLength(1);
    expect(result?.transactions[0]).toMatchObject({
      date: '2025-03-11', payee: 'Acme Book Store Pune', raw: description, amount: -725,
    });
    const output = parse(toCsv(result?.transactions ?? []), { columns: true });
    expect(output).toEqual([{
      Date: '2025-03-11', Payee: 'Acme Book Store Pune', Notes: description,
      Amount: '-725.00', Reference: '',
    }]);
  });

  it.each([true, false])('keeps every row with repeated headings (initial header: %s)', initial => {
    const rows = hsbcRows();
    const result = interpretTable(table([
      ...(initial ? [HEADER] : []),
      ...rows.slice(0, 2), [], HEADER, ['', '', ''], ...rows.slice(2),
    ]));
    expect(result?.transactions.map(t => t.amount)).toEqual([-725, 1430, 120, 75, -430]);
    expect(result?.header.index).toBe(initial ? 0 : -1);
  });

  it('retains duplicate-looking transactions and never uses the masked card as an ID', () => {
    const row = hsbcRows()[0] as string[];
    const result = interpretTable(table([row, [...row]]));
    expect(result?.transactions).toHaveLength(2);
    expect(result?.transactions[0]).toEqual(result?.transactions[1]);
    expect(result?.transactions.every(t => t.ref === undefined)).toBe(true);
  });

  it('keeps the first row when joining headerless continuations', () => {
    const rows = hsbcRows();
    const sections = interpretSections([table(rows.slice(0, 2)), table(rows.slice(2))]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.result.transactions.map(t => t.amount))
      .toEqual([-725, 1430, 120, 75, -430]);
  });

  it('uses existing reconciliation when independent totals are available', () => {
    const sections = interpretSections([{ ...table(), figures: FIGURES }]);
    expect(checksFor(sections[0]!)[0]?.validation).toEqual({
      status: 'passed', checked: 2, matched: 2, issues: [],
    });
    const mismatched = interpretSections([{
      ...table(), figures: [FIGURES[0]!, { label: 'Payments / Credits', value: '1,600.00' }],
    }]);
    expect(checksFor(mismatched[0]!)[0]?.validation).toMatchObject({
      status: 'failed', checked: 2, matched: 1,
    });
  });

  it('reports the actual history export as unchecked when it has no totals', () => {
    const sections = interpretSections([table()]);
    expect(checksFor(sections[0]!)[0]?.validation.status).toBe('skipped');
  });

  it.each([
    ['31/02/2025', hsbcDescription('ACME STORE'), '-725.00'],
    ['12/03/2025 extra', hsbcDescription('ACME STORE'), '-725.00'],
    ['12/03/2025', hsbcDescription('ACME STORE', '31/02/2025'), '-725.00'],
    ['12/03/2025', hsbcDescription('ACME STORE'), '-7,25.00'],
    ['12/03/2025', hsbcDescription('ACME STORE'), '725.00 CR'],
    ['12/03/2025', hsbcDescription('ACME STORE'), '725.00 430.00'],
    ['12/03/2025', hsbcDescription('ACME STORE'), '0.00'],
    ['12/03/2025', hsbcDescription('ACME STORE'), '9007199254740992.00'],
    ['12/03/2025', hsbcDescription('ACME STORE'), ''],
    ['12/03/2025', 'ACME STORE', '-725.00'],
    ['12/03/2025', hsbcDescription('ACME STORE'), '-725.00', 'extra'],
    ['', 'detached continuation', ''],
  ])('refuses the entire export if a row is malformed: %s', (...row) => {
    expect(() => interpretTable(table([hsbcRows()[0]!, row])))
      .toThrow(/HSBC transaction history: row 2 .*Refusing/);
  });

  it.each([
    'Statement Date', 'Opening Balance', 'Payment Due Date', 'Total Amount Due',
    'Reward Points', 'EMI Details',
  ])('does not turn an unrelated summary into a transaction: %s', label => {
    expect(() => interpretTable(table([
      hsbcRows()[0]!, [label, '12/03/2025', '1,155.00'],
    ]))).toThrow(/HSBC transaction history/);
    expect(() => interpretTable(table([
      hsbcRows()[0]!, ['12/03/2025', hsbcDescription(label), '1,155.00'],
    ]))).toThrow(/HSBC transaction history/);
  });

  it('does not guess at empty files, unknown headerless layouts or PDF geometry', () => {
    expect(interpretTable(table([]))).toBeNull();
    expect(interpretTable(table([['12/03/2025', 'ACME STORE', '-725.00']]))).toBeNull();
    expect(interpretTable({ ...table(), source: { path: 'history.pdf', format: 'pdf' } }))
      .toBeNull();
    expect(interpretTable(table([HEADER]))?.transactions).toEqual([]);
  });

  it('does not change conventional bank or unsigned credit card tables', () => {
    const bank = interpretTable(table([
      ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
      ['12/03/2025', hsbcDescription('ACME STORE'), '725.00', '', '9,275.00'],
    ]));
    expect(bank?.transactions[0]).toMatchObject({ amount: -725, balance: 9275 });
    expect(bank?.card).toBe(false);
    const card = interpretTable({
      ...table([HEADER, ['12/03/2025', 'ACME STORE', '725.00']]),
      preamble: ['Credit Card Statement'],
    });
    expect(card?.card).toBe(true);
    expect(card?.transactions[0]?.amount).toBe(-725);
  });
});
