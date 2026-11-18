import { describe, expect, it } from 'vitest';

import type { Table } from './extract/types.js';
import { interpretSections } from './interpret/sections.js';
import { validateBalances } from './interpret/validate.js';
import type { PdfLayout } from './extract/pdf.js';
import { PAYMENT_WORDS, buildReport, maskText } from './report.js';
import { hsbcRows } from './testing/hsbc.js';

function table(rows: string[][]): Table {
  return { rows, source: { path: 'test.csv', format: 'csv' } };
}

function report(...sources: Table[]): string {
  return buildReport({
    version: '0.0.0',
    runtime: 'Node v0.0.0',
    format: 'CSV',
    tables: sources,
    sections: interpretSections(sources).map((section, index) => ({
      number: index + 1,
      ...(section.account ? { account: section.account } : {}),
      table: section.table,
      result: section.result,
      checks: [
        {
          name: 'Balance check',
          validation: validateBalances(section.result.transactions),
        },
      ],
    })),
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
    expect(maskText('ACME 12/03/2025 swiggy@ybl')).toBe(
      'xxxx 99/99/9999 xxxxxx@xxx',
    );
  });

  it('writes payment-type words out, whole words only, and masks what surrounds them', () => {
    expect(maskText('UPI/P2A/412345678901/ACME STORE')).toBe(
      'UPI/P2A/999999999999/xxxx xxxxx',
    );
    expect(maskText('UPIOUT-swiggy@ybl')).toBe('UPIOUT-xxxxxx@xxx');
    expect(maskText('neft imps')).toBe('neft imps');
    expect(maskText('UPIX NEFTS 4UPI')).toBe('xxxx xxxxx 9xxx');
  });

  it('keeps ambiguous words masked, since they can be part of a name', () => {
    expect(maskText('NA SI FT PAID SENT PAY VIN')).toBe('xx xx xx xxxx xxxx xxx xxx');
  });

  it('pins the list of payment words, so adding one is a deliberate review', () => {
    expect([...PAYMENT_WORDS].sort()).toEqual([
      'ach', 'atd', 'atm', 'atw', 'awb', 'cwdr', 'ecom', 'ecs', 'fti', 'fto',
      'ifi', 'imps', 'impstxn', 'inft', 'mmt', 'nach', 'neft', 'nwd', 'p2a',
      'p2m', 'p2p', 'pos', 'ref', 'refno', 'rtgs', 'trf', 'txn', 'upi',
      'upiin', 'upiout', 'vps',
    ]);
  });

  it('collapses whitespace so wrapped cells cannot reveal line breaks', () => {
    expect(maskText('A  B\nC')).toBe('x x x');
  });

  it('masks enclosed letters and private-use characters, which are not letters', () => {
    expect(maskText('\u24BF\u24DE\u24D7\u24DD')).toBe('xxxx');
    expect(maskText('A\uE001B')).toBe('xxx');
  });

  it('masks letters, vowel signs and digits outside ASCII', () => {
    expect(maskText('मुंबई ₹५०')).toBe('xxx ₹99');
  });
});

describe('buildReport', () => {
  it('reports a headerless layout without exposing the HSBC narration', () => {
    const text = report(table(hsbcRows()));
    expect(text).toContain('Header: absent (layout detected), columns date=0');
    expect(text).toContain('Parsed 5 transaction(s)');
    expect(text).not.toContain('ACME');
    expect(text).not.toContain('11/03/2025');
    expect(text).not.toContain('725.00');
  });

  it('shows structure and counts', () => {
    const text = report(table(ROWS));

    expect(text).toContain('india2actual 0.0.0 layout report (Node v0.0.0)');
    expect(text).toContain('File: CSV');
    expect(text).toContain('Tables found: 1, read as transactions: 1');
    expect(text).toContain('Section 1');
    expect(text).toContain('Header: row 2, columns date=0');
    expect(text).toContain(
      'Header cells: Date | Narration | Withdrawal Amt. | Deposit Amt. | Closing Balance',
    );
    expect(text).toContain('Parsed 2 transaction(s), skipped 1 row(s)');
    expect(text).toContain('Narration kinds: upi=1, neft=1');
    expect(text).toMatch(/Balance check: passed \(\d+\/\d+ agree\)/);
  });

  it('explains a failed balance check without printing any value', () => {
    const failing = ROWS.map(row => [...row]);
    // The second balance is wrong, so the check fails.
    failing[3]![4] = '8,123.00';
    const text = report(table(failing));

    expect(text).toMatch(/Balance check: failed/);
    expect(text).toContain('Why the balance check failed:');
    expect(text).toContain('Failing pairs: 1 of 1');
    const section = text.split('Why the balance check failed:')[1]!.split('\n\n')[0]!;
    expect(section).not.toMatch(/\d[\d,]*\.\d{2}|\d{2}[/-]\d{2}[/-]\d{4}/);
    expect(section).not.toMatch(/ACME|swiggy|JOHN|OTHER/);
  });

  it('adds no diagnosis to a passing check', () => {
    expect(report(table(ROWS))).not.toContain('Why the balance check failed');
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

  it('writes out heading words but masks the rest of a row', () => {
    const text = report(
      table([['Date and Time', 'Details', 'Nothing', 'Else']]),
    );

    expect(text).toContain('  Date and Time | Details | xxxxxxx | xxxx');
  });

  it('reports each account on its own and never prints the account number', () => {
    const other = (account: string): Table => ({
      ...table(ROWS.map(row => [...row])),
      account,
    });

    const text = report(other('1111'), other('2222'));

    expect(text).toContain('Tables found: 2, read as transactions: 2');
    expect(text).toContain('Section 1');
    expect(text).toContain('Section 2');
    expect(text).toContain('Account number found near the title: yes');
    expect(text).not.toContain('1111');
    expect(text).not.toContain('2222');
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

describe('text that only looks like a column label', () => {
  const withIndicator = [
    ['Date', 'Narration', 'Amount', 'Dr/Cr', 'Balance'],
    ['12/03/2025', 'DRAVID KUMAR', '725.00', 'Dr', '9,275.00'],
    ['13/03/2025', 'CREIGHTON SMITH', '430.00', 'Cr', '9,705.00'],
    ['', 'DRAKE CROWE', '', 'Dr', ''],
  ];

  it('masks names that begin with a column word, on dated rows and skipped rows', () => {
    const text = report(table(withIndicator));
    for (const secret of ['DRAVID', 'KUMAR', 'CREIGHTON', 'SMITH', 'DRAKE', 'CROWE']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('Header cells: Date | Narration | Amount | Dr/Cr | Balance');
  });

  it('masks a name in the first rows when no table was found', () => {
    const text = buildReport({
      version: '0.0.0',
      runtime: 'browser',
      format: 'PDF',
      tables: [table([['Dr', 'DRAVID KUMAR']])],
      sections: [],
    });
    expect(text).not.toContain('DRAVID');
  });

  it('does not write a heading out when a digit in another script follows it', () => {
    const header = ['Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance \u0667\u0662\u0665'];
    const text = report(table([header, ROWS[2]!]));
    expect(text).not.toContain('\u0667');
  });

  it('masks a sheet name, which can be anything', () => {
    const text = buildReport({
      version: '0.0.0',
      runtime: 'browser',
      format: 'Excel workbook',
      tables: [{ rows: [], source: { path: 'x.xlsx', format: 'xlsx', part: 'JOHN DOE 0000000000000000' } }],
      sections: [],
    });
    expect(text).not.toContain('JOHN');
    expect(text).not.toContain('0000000000000000');
  });

  it('still shows the page count of a PDF', () => {
    const text = buildReport({
      version: '0.0.0',
      runtime: 'browser',
      format: 'PDF',
      tables: [{ rows: [], source: { path: 'x.pdf', format: 'pdf', part: '8 page(s)' } }],
      sections: [],
    });
    expect(text).toContain('File: PDF, 8 page(s)');
  });
});

describe('PDF layout in the report', () => {
  const dated = (...cells: Array<[number, string]>) => ({
    dateLed: true,
    items: cells.map(([x, text]) => ({ x, text })),
  });
  const plain = (...cells: Array<[number, string]>) => ({
    dateLed: false,
    items: cells.map(([x, text]) => ({ x, text })),
  });

  const pdfReport = (layout: PdfLayout) =>
    buildReport({
      version: '0.0.0',
      runtime: 'browser',
      format: 'PDF',
      tables: [{ rows: [], source: { path: 'x.pdf', format: 'pdf', part: '3 page(s)' } }],
      sections: [],
      layout,
    });

  const base: PdfLayout = {
    pages: [
      { page: 1, items: 120, lines: 40, dateLines: 14, amountLines: 14, inTable: true },
      { page: 2, items: 0, lines: 0, dateLines: 0, amountLines: 0, inTable: false },
      { page: 3, items: 0, lines: 0, dateLines: 0, amountLines: 0, inTable: false },
    ],
    window: [],
    above: [],
  };

  it('lists each page and flags pages without a text layer', () => {
    const text = pdfReport(base);
    expect(text).toContain('page 1: 120 text items, 40 lines, 14 date-led, 14 with two or more amounts, in a table: yes');
    expect(text).toContain('Pages without a text layer: 2-3');
    expect(text).toContain('scanned');
  });

  it('prints no sample when every dated row is in a table', () => {
    expect(pdfReport(base)).not.toContain('Text positions');
  });

  it('shows a masked sample with positions rounded to 5 and never the lines above it', () => {
    const text = pdfReport({
      ...base,
      windowPage: 2,
      above: [
        plain([36, 'JOHN DOE'], [200, 'Flat 4, Example Road']),
        plain([20, 'Date'], [80, 'Narration'], [220, 'Withdrawal']),
      ],
      window: [
        dated([21, '12/03/2025'], [82, 'ACME STORE PUNE IN'], [221, '725.00']),
        plain([82, 'Drake Crowe'], [221, 'Dr']),
      ],
    });

    expect(text).toContain('Text positions on page 2');
    expect(text).toContain('x=20 99/99/9999');
    expect(text).toContain('x=80 xxxx xxxxx xxxx xx');
    // Heading words directly above are written out; the name line above them is not reached.
    expect(text).toContain('x=20 Date | x=80 Narration | x=220 Withdrawal');
    for (const secret of ['JOHN', 'DOE', 'Example', 'ACME', 'Drake', 'Crowe', '725', '12/03/2025']) {
      expect(text).not.toContain(secret);
    }
  });

  it('stops at the first line above that is not only heading words', () => {
    const text = pdfReport({
      ...base,
      windowPage: 1,
      above: [
        plain([20, 'Date'], [80, 'Narration']),
        plain([36, 'JOHN DOE'], [200, 'Flat 4']),
      ],
      window: [dated([20, '12/03/2025'], [220, '725.00'])],
    });
    expect(text).not.toContain('Narration');
    expect(text).not.toContain('JOHN');
  });

  it('masks heading words on the rows of the sample and any digit script above it', () => {
    const text = pdfReport({
      ...base,
      windowPage: 1,
      above: [plain([20, 'Date'], [80, 'Balance \u0967\u0968,\u0969\u096A\u096B.\u0966\u0966'])],
      window: [
        dated([20, '12/03/2025'], [220, '725.00']),
        plain([80, 'Dr'], [120, 'Savings'], [160, 'to the account']),
      ],
    });
    expect(text).not.toContain('\u0967');
    expect(text).not.toContain('Savings');
    expect(text).not.toMatch(/x=80 Dr/);
    expect(text).toContain('x=80 xx | x=120 xxxxxxx | x=160 xx xxx xxxxxxx');
  });

  it('writes a window word out only on a line that is not date-led', () => {
    const text = pdfReport({
      ...base,
      windowPage: 1,
      window: [dated([20, '12/03/2025'], [80, 'Balance'], [220, '725.00'])],
    });
    expect(text).not.toContain('Balance');
  });

  const rowsOnly = [dated([20, '12/03/2025'], [220, '725.00'])];

  it('samples the rows of a table that was found but never read as transactions', () => {
    const text = pdfReport({ ...base, all: { windowPage: 1, above: [], window: rowsOnly } });
    expect(text).toContain('Text positions on page 1');
    expect(text).toContain('x=20 99/99/9999');
  });

  it('prefers the rows no table took when other tables were read', () => {
    const text = buildReport({
      version: '0.0.0',
      runtime: 'browser',
      format: 'PDF',
      tables: [table(ROWS)],
      sections: interpretSections([table(ROWS)]).map((section, index) => ({
        number: index + 1,
        table: section.table,
        result: section.result,
        checks: [],
      })),
      layout: { ...base, all: { windowPage: 1, above: [], window: rowsOnly } },
    });
    expect(text).not.toContain('Text positions');
  });

  it('keeps the PDF block apart from the lines after it', () => {
    expect(pdfReport(base)).toMatch(/Pages without a text layer: 2-3 .*\n\nRows extracted/);
  });

  it('caps the pages listed', () => {
    const pages = Array.from({ length: 60 }, (_, index) => ({
      page: index + 1, items: 5, lines: 2, dateLines: 0, amountLines: 0, inTable: false,
    }));
    const text = pdfReport({ ...base, pages });
    expect(text).toContain('and 20 more pages');
  });
});
