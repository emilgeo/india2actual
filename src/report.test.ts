import { describe, expect, it } from 'vitest';

import type { Table } from './extract/types.js';
import { interpretTable } from './interpret/rows.js';
import { validateBalances } from './interpret/validate.js';
import { buildReport, maskText } from './report.js';

function table(rows: string[][]): Table {
  return { rows, source: { path: 'test.csv', format: 'csv' } };
}

function report(source: Table, checkName = 'Balance check'): string {
  const result = interpretTable(source);
  return buildReport({
    version: '0.0.0',
    node: 'v0.0.0',
    format: 'CSV',
    table: source,
    result,
    validation: result ? validateBalances(result.transactions) : null,
    checkName,
  });
}

const HEADER = [
  'Date',
  'Narration',
  'Withdrawal Amt.',
  'Deposit Amt.',
  'Closing Balance',
];

const ROWS = [
  ['Account No: 0000000000000000'],
  HEADER,
  [
    '12/03/2025',
    'UPI-ACME STORE PUNE-swiggy@ybl-412345678901-NA',
    '725.00',
    '',
    '9,275.00',
  ],
  [
    '13/03/2025',
    'NEFT CR-HDFC0001234-ACME CONSULTING PVT LTD-JOHN DOE-N000000000001',
    '',
    '430.00',
    '9,705.00',
  ],
  ['', 'Statement note for A N OTHER', '', '', ''],
];

describe('maskText', () => {
  it('turns letters into x and digits into 9 and keeps punctuation', () => {
    expect(maskText('UPI-ACME 12/03/2025 swiggy@ybl')).toBe(
      'xxx-xxxx 99/99/9999 xxxxxx@xxx',
    );
  });

  it('collapses whitespace so wrapped cells cannot reveal line breaks', () => {
    expect(maskText('A  B\nC')).toBe('x x x');
  });

  it('masks letters, vowel signs and digits outside ASCII', () => {
    expect(maskText('मुंबई ₹५०')).toBe('xxx ₹99');
  });
});

describe('buildReport', () => {
  it('shows structure and counts', () => {
    const text = report(table(ROWS));

    expect(text).toContain('india2actual 0.0.0 layout report (Node v0.0.0)');
    expect(text).toContain('File: CSV');
    expect(text).toContain('Header: row 2, columns date=0');
    expect(text).toContain(
      'Header cells: Date | Narration | Withdrawal Amt. | Deposit Amt. | Closing Balance',
    );
    expect(text).toContain('Parsed 2 transaction(s), skipped 1 row(s)');
    expect(text).toContain('Narration kinds: upi=1, neft=1');
    expect(text).toMatch(/Balance check: passed \(\d+\/\d+ agree\)/);
  });

  it('never prints values from the statement', () => {
    const text = report(table(ROWS));

    for (const secret of [
      'ACME',
      'swiggy',
      'JOHN',
      'OTHER',
      '725',
      '9,275',
      '430',
      '12/03/2025',
      '412345678901',
      '0000000000000000',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('99/99/9999');
    expect(text).toContain('999.99');
  });

  it('masks a header cell that is not a bare column label', () => {
    const rows = ROWS.map(row => [...row]);
    rows[1] = [...HEADER.slice(0, 4), 'Balance as on 31-03-2025'];

    const text = report(table(rows));

    expect(text).toContain('Deposit Amt. | xxxxxxx xx xx 99-99-9999');
    expect(text).not.toContain('Balance as on');
  });

  it('leaves out validation issues, which quote amounts and dates', () => {
    const rows = ROWS.map(row => [...row]);
    rows[3] = ['13/03/2025', 'NEFT CR-ACME', '', '430.00', '9,000.00'];

    const text = report(table(rows));

    expect(text).toContain('Balance check: failed');
    expect(text).not.toContain('9,000');
    expect(text).not.toContain('430');
  });

  it('writes out known labels in a header-like row even without a table', () => {
    const text = report(
      table([['Date', 'Narration'], ['12/03/2025', 'Dr ACME']]),
    );

    expect(text).toContain('Header: no transaction table found');
    expect(text).toContain('  Date | Narration');
    expect(text).toContain('  99/99/9999 | xx xxxx');
    expect(text).not.toContain('ACME');
  });

  it('still describes the file when no table is found', () => {
    const text = report(
      table([['Dear A N OTHER'], ['Account 0000000000000000 summary']]),
    );

    expect(text).toContain('Header: no transaction table found');
    expect(text).toContain('xxxx x x xxxxx');
    expect(text).not.toContain('OTHER');
    expect(text).not.toContain('0000000000000000');
  });
});
