import { describe, expect, it } from 'vitest';

import type { Table } from '../extract/types.js';

import { findHeader } from './header.js';
import { interpretTable } from './rows.js';
import type { StatementTransaction } from './rows.js';
import {
  validateBalances,
  validateCardTotals,
  validateSectionTotals,
} from './validate.js';
import { roleForHeader } from './synonyms.js';
import { parseAmount, parseStatementDate } from './values.js';

function table(rows: string[][]): Table {
  return { rows, source: { path: 'test.csv', format: 'csv' } };
}

describe('parseAmount', () => {
  it('parses Indian lakh grouping', () => {
    expect(parseAmount('1,23,456.78')).toBe(123456.78);
    expect(parseAmount('12,34,567')).toBe(1234567);
  });

  it('strips currency decoration', () => {
    expect(parseAmount('₹1,234.50')).toBe(1234.5);
    expect(parseAmount('Rs. 1,234.50')).toBe(1234.5);
    expect(parseAmount('INR 1,234.50')).toBe(1234.5);
  });

  it('handles the several ways a statement marks money out', () => {
    expect(parseAmount('-1,234.50')).toBe(-1234.5);
    expect(parseAmount('(1,234.50)')).toBe(-1234.5);
    expect(parseAmount('1,234.50 Dr')).toBe(-1234.5);
    expect(parseAmount('1,234.50 Cr')).toBe(1234.5);
  });

  it('treats blanks and placeholders as absent', () => {
    for (const value of ['', '   ', '-', 'NIL', 'NA']) {
      expect(parseAmount(value)).toBeNull();
    }
  });
});

describe('parseStatementDate', () => {
  it('defaults to day-first, the Indian convention', () => {
    expect(parseStatementDate('01/04/2024')).toBe('2024-04-01');
    expect(parseStatementDate('01-04-24')).toBe('2024-04-01');
    expect(parseStatementDate('01.04.2024')).toBe('2024-04-01');
  });

  it('reads month names', () => {
    expect(parseStatementDate('01-Apr-2024')).toBe('2024-04-01');
    expect(parseStatementDate('1 April 24')).toBe('2024-04-01');
  });

  it('reads ISO regardless of the configured order', () => {
    expect(parseStatementDate('2024-04-01', 'dmy')).toBe('2024-04-01');
  });

  it('ignores a trailing time component', () => {
    expect(parseStatementDate('01/04/2024 00:00:00')).toBe('2024-04-01');
  });

  it('rejects impossible and unparseable dates', () => {
    expect(parseStatementDate('31/02/2024')).toBeNull();
    expect(parseStatementDate('Opening Balance')).toBeNull();
    expect(parseStatementDate('')).toBeNull();
  });
});

describe('findHeader', () => {
  it('finds the header below a statement preamble', () => {
    const match = findHeader([
      ['HDFC BANK LTD'],
      ['Statement of account'],
      [],
      [
        'Date',
        'Narration',
        'Chq./Ref.No.',
        'Value Dt',
        'Withdrawal Amt.',
        'Deposit Amt.',
        'Closing Balance',
      ],
      [
        '01/04/24',
        'UPI/DR/1/X/Y/z@ybl/Payment',
        '',
        '01/04/24',
        '1.00',
        '',
        '2.00',
      ],
    ]);

    expect(match?.index).toBe(3);
    expect(match?.map).toMatchObject({
      date: 0,
      description: 1,
      ref: 2,
      valueDate: 3,
      debit: 4,
      credit: 5,
      balance: 6,
    });
  });

  it('handles the ICICI vocabulary and its two date columns', () => {
    const match = findHeader([
      [
        'S No.',
        'Value Date',
        'Transaction Date',
        'Cheque Number',
        'Transaction Remarks',
        'Withdrawal Amount (INR)',
        'Deposit Amount (INR)',
        'Balance (INR)',
      ],
    ]);

    expect(match?.map).toMatchObject({
      valueDate: 1,
      date: 2,
      ref: 3,
      description: 4,
      debit: 5,
      credit: 6,
      balance: 7,
    });
  });

  it('handles the terse Axis vocabulary', () => {
    const match = findHeader([
      ['Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL'],
    ]);

    expect(match?.map).toMatchObject({
      date: 0,
      ref: 1,
      description: 2,
      debit: 3,
      credit: 4,
      balance: 5,
    });
  });

  it('returns null when there is no transaction table', () => {
    expect(findHeader([['Account Holder'], ['Mr. A N Other']])).toBeNull();
  });
});

const hdfcStatement = table([
  ['HDFC BANK LTD'],
  ['Statement of account'],
  [],
  [
    'Date',
    'Narration',
    'Chq./Ref.No.',
    'Value Dt',
    'Withdrawal Amt.',
    'Deposit Amt.',
    'Closing Balance',
  ],
  [
    '01/04/24',
    'UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment',
    '',
    '01/04/24',
    '450.50',
    '',
    '1,23,456.78',
  ],
  [
    '02/04/24',
    'SALARY ACME CONSULTING',
    '',
    '02/04/24',
    '',
    '50,000.00',
    '1,73,456.78',
  ],
  [
    '03/04/24',
    'ATW/1234/CASH WDL/BANGALORE',
    '',
    '03/04/24',
    '2,000.00',
    '',
    '1,71,456.78',
  ],
  ['', '*** End of statement ***'],
]);

describe('interpretTable', () => {
  it('reads an HDFC-shaped statement end to end', () => {
    const result = interpretTable(hdfcStatement);

    expect(result).not.toBeNull();
    expect(result?.transactions).toHaveLength(3);

    expect(result?.transactions[0]).toMatchObject({
      date: '2024-04-01',
      amount: -450.5,
      payee: 'Swiggy',
      ref: '412345678901',
      balance: 123456.78,
    });
    expect(result?.transactions[1]).toMatchObject({
      date: '2024-04-02',
      amount: 50000,
    });
    expect(result?.transactions[2]).toMatchObject({
      amount: -2000,
      payee: 'ATM Withdrawal',
      kind: 'atm',
    });
  });

  it('keeps the raw narration for imported_payee', () => {
    const result = interpretTable(hdfcStatement);

    expect(result?.transactions[0]?.raw).toBe(
      'UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment',
    );
  });

  it('skips the footer rather than guessing at it', () => {
    const result = interpretTable(hdfcStatement);

    expect(result?.skipped).toHaveLength(1);
    expect(result?.skipped[0]?.reason).toBe('no parseable date');
  });

  it('returns null when no transaction table can be found', () => {
    expect(
      interpretTable(table([['Account Holder'], ['Mr. A N Other']])),
    ).toBeNull();
  });

  it('drops references that repeat, which cannot be real bank references', () => {
    // Both rows carry the same value in the reference column, a padded
    // placeholder, not a per-transaction id. Keeping it would make Actual
    // treat the second transaction as a duplicate of the first.
    const result = interpretTable(
      table([
        ['Date', 'Narration', 'Ref No', 'Debit', 'Credit', 'Balance'],
        ['01/04/24', 'PAYMENT ONE', '999999999', '100.00', '', '900.00'],
        ['02/04/24', 'PAYMENT TWO', '999999999', '100.00', '', '800.00'],
      ]),
    );

    expect(result?.droppedRefs).toBe(2);
    expect(result?.transactions.every(t => t.ref === undefined)).toBe(true);
  });

  it('applies a Dr/Cr indicator column over the amount sign', () => {
    const result = interpretTable(
      table([
        ['Date', 'Particulars', 'Amount', 'DR/CR', 'Balance'],
        ['01/04/24', 'PAYMENT ONE', '100.00', 'DR', '900.00'],
        ['02/04/24', 'REFUND', '50.00', 'CR', '950.00'],
      ]),
    );

    expect(result?.transactions.map(t => t.amount)).toEqual([-100, 50]);
  });
});

function transactionsOf(
  entries: Array<[amount: number, balance: number]>,
): StatementTransaction[] {
  return entries.map(([amount, balance], index) => ({
    date: `2024-04-0${index + 1}`,
    amount,
    balance,
    payee: 'Test',
    raw: 'TEST NARRATION',
    kind: 'other' as const,
  }));
}

describe('validateBalances', () => {
  it('passes when every amount agrees with the balance column', () => {
    const result = validateBalances(
      transactionsOf([
        [-450.5, 1000],
        [50000, 51000],
        [-2000, 49000],
      ]),
    );

    expect(result.status).toBe('passed');
    expect(result.order).toBe('ascending');
    expect(result.matched).toBe(2);
  });

  it('recognises a newest-first statement', () => {
    const result = validateBalances(
      transactionsOf([
        [-2000, 49000],
        [50000, 51000],
        [-450.5, 1000],
      ]),
    );

    expect(result.status).toBe('passed');
    expect(result.order).toBe('descending');
  });

  it('catches an inverted sign', () => {
    // The middle amount should be +50000; a debit/credit mix-up flips it.
    const result = validateBalances(
      transactionsOf([
        [-450.5, 1000],
        [-50000, 51000],
        [-2000, 49000],
      ]),
    );

    expect(result.status).toBe('failed');
    expect(result.issues[0]).toContain('do not agree with the balance column');
  });

  it('catches a dropped row', () => {
    // 51000 -> 49000 needs a -2000 row; without it the jump is unexplained.
    const result = validateBalances(
      transactionsOf([
        [-450.5, 1000],
        [50000, 51000],
        [-10, 49000],
      ]),
    );

    expect(result.status).toBe('failed');
  });

  it('reports honestly when there is nothing to check against', () => {
    const result = validateBalances([
      {
        date: '2024-04-01',
        amount: -1,
        payee: 'Test',
        raw: 'TEST',
        kind: 'other',
      },
    ]);

    expect(result.status).toBe('skipped');
    expect(result.issues[0]).toContain('No balance column');
  });
});

describe('credit card statements', () => {
  const header = ['Date', 'Transaction Details', 'Amount (in ₹)'];
  const body = [
    ['12/03/2025', 'AUTODEBIT PAYMENT RECD.', '725.00 CR'],
    ['05/03/2025', 'NETFLIX DI SI DELHI IN', '430.00'],
    ['09/03/2025', 'ACME STORE PUNE IN', '120.00'],
  ];

  const card = (
    rows: string[][],
    preamble: string[] = ['CREDIT CARD STATEMENT'],
  ) => interpretTable({ ...table([header, ...rows]), preamble });

  it('detects a card statement from the text above the table', () => {
    expect(card(body)?.card).toBe(true);
    expect(card(body, ['Statement of Account'])?.card).toBe(false);
  });

  it('detects a card statement from rows above a spreadsheet header', () => {
    const result = interpretTable(
      table([['Credit Card Statement'], header, ...body]),
    );

    expect(result?.card).toBe(true);
  });

  it('records spending as money out and a credit as money in', () => {
    expect(card(body)?.transactions.map(t => t.amount)).toEqual([
      725, -430, -120,
    ]);
  });

  it('reads a negative figure as a credit', () => {
    const result = card([
      ['20/02/2025', 'AUTODEBIT PAYMENT RECD.', '-910.00'],
    ]);

    expect(result?.transactions[0]?.amount).toBe(910);
  });

  it('reads a bank statement the other way round', () => {
    const result = card(body, ['Statement of Account']);

    expect(result?.transactions.map(t => t.amount)).toEqual([725, 430, 120]);
  });

  it('lets the caller force the convention', () => {
    const result = interpretTable(table([header, ...body]), { card: true });

    expect(result?.transactions.map(t => t.amount)).toEqual([
      725, -430, -120,
    ]);
  });
});

describe('validateCardTotals', () => {
  const figures = [
    { label: 'Purchases / Charges', value: '550.00' },
    { label: 'Cash Advances', value: '0.00' },
    { label: 'Payments / Credits', value: '`1,000.00' },
  ];

  it('passes when spending and payments both match the summary', () => {
    const result = validateCardTotals(
      transactionsOf([
        [-430, 0],
        [-120, 0],
        [1000, 0],
      ]),
      figures,
    );

    expect(result).toMatchObject({ status: 'passed', checked: 2, matched: 2 });
  });

  it('fails when a row is dropped', () => {
    const result = validateCardTotals(
      transactionsOf([
        [-430, 0],
        [1000, 0],
      ]),
      figures,
    );

    expect(result.status).toBe('failed');
    expect(result.issues[0]).toContain('550.00');
    expect(result.issues[0]).toContain('430.00');
  });

  it('fails when every sign is inverted', () => {
    const result = validateCardTotals(
      transactionsOf([
        [430, 0],
        [120, 0],
        [-1000, 0],
      ]),
      figures,
    );

    expect(result.status).toBe('failed');
    expect(result.matched).toBe(0);
  });

  it('reports honestly when the statement has no summary', () => {
    const result = validateCardTotals(transactionsOf([[-430, 0]]));

    expect(result.status).toBe('skipped');
  });
});

describe('credit card markers used by other issuers', () => {
  const amounts = (values: string[]) =>
    interpretTable({
      rows: [
        ['Date', 'Transaction Details', 'Amount'],
        ...values.map(value => ['07/05/2025', 'ACME STORE PUNE IN', value]),
      ],
      preamble: ['Credit Card Statement'],
      source: { path: 'card.pdf', format: 'pdf' },
    })?.transactions.map(t => t.amount);

  it('reads a trailing C or D flag as credit or debit', () => {
    expect(amounts(['1,250.00 D', '310.00 C'])).toEqual([-1250, 310]);
  });

  it('reads a leading plus as a credit', () => {
    expect(amounts(['+ 310.00', '1,250.00'])).toEqual([310, -1250]);
  });

  it('treats a leading C as a rupee sign, not a credit', () => {
    expect(amounts(['C 1,250.00', '+ C 310.00'])).toEqual([-1250, 310]);
  });

  it('reads DR and CR markers', () => {
    expect(amounts(['1,250.00 DR', '310.00 CR'])).toEqual([-1250, 310]);
  });

  it('counts finance charges and fees as spending in the totals check', () => {
    const result = validateCardTotals(
      transactionsOf([
        [-400, 0],
        [-35.5, 0],
        [-18, 0],
        [200, 0],
      ]),
      [
        { label: 'Purchases / Debits', value: '400.00' },
        { label: 'Finance Charges', value: '35.50' },
        { label: 'Fees / Taxes / Interest', value: '18.00' },
        { label: 'Payments / Credits', value: '200.00' },
      ],
    );

    expect(result.status).toBe('passed');
  });

  it('recognises a combined date and time header', () => {
    expect(roleForHeader('Date & Time')).toBe('date');
    expect(roleForHeader('Date and Time')).toBe('date');
  });
});

describe('validateSectionTotals', () => {
  const row = (
    amount: number,
    balance: number,
  ): StatementTransaction => ({
    date: '2025-03-13',
    amount,
    payee: 'ACME',
    raw: 'ACME',
    kind: 'other',
    balance,
  });
  const rows = [row(500, 1500), row(-200, 1300)];

  it('passes when deposits, withdrawals and closing balance agree', () => {
    const result = validateSectionTotals(rows, [
      { label: 'Total DEPOSITS', value: '500.00' },
      { label: 'Total WITHDRAWALS', value: '200.00' },
      { label: 'Total BALANCE', value: '1,300.00' },
    ]);

    expect(result).toMatchObject({ status: 'passed', checked: 3, matched: 3 });
  });

  it('fails when a printed total disagrees with the rows', () => {
    const result = validateSectionTotals(rows, [
      { label: 'Total DEPOSITS', value: '600.00' },
    ]);

    expect(result.status).toBe('failed');
    expect(result.issues[0]).toContain('Deposits');
  });

  it('is skipped when the table prints no totals', () => {
    expect(validateSectionTotals(rows, []).status).toBe('skipped');
  });

  it('checks a single row against the printed opening balance', () => {
    const only = [row(-725, 9275)];

    expect(
      validateSectionTotals(only, [
        { label: 'Opening Balance', value: '10,000.00 CR' },
      ]).status,
    ).toBe('passed');
    expect(
      validateSectionTotals(only, [
        { label: 'Opening Balance', value: '9,000.00 CR' },
      ]).status,
    ).toBe('failed');
  });

  it('accepts a closing balance on either end, for newest-first statements', () => {
    const newestFirst = [row(-200, 1300), row(500, 1500)];

    expect(
      validateSectionTotals(newestFirst, [
        { label: 'Closing Balance', value: '1,300.00' },
      ]).status,
    ).toBe('passed');
  });
});
