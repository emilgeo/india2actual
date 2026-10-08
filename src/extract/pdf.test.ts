import { describe, expect, it } from 'vitest';

import { interpretTable } from '../interpret/rows.js';
import { interpretSections } from '../interpret/sections.js';
import {
  validateBalances,
  validateSectionTotals,
} from '../interpret/validate.js';

import {
  assembleRows,
  inferBands,
  readFigures,
  splitSections,
  tablesFromLines,
  trimToTable,
} from './pdf.js';
import type { Item, Line } from './pdf.js';
import { consolidatedLines, summaryFirstLines } from '../testing/fixtures.js';
import { pdfFromLines } from '../testing/pdf.js';
import { extractTablesFromBytes } from './bytes.js';
import { isPasswordError } from './pdf.js';

/**
 * Build a line from `[x, text]` pairs. Widths are approximated at 5 points per
 * character, which is close enough to real statement typesetting for the
 * wrap-versus-line-break test below.
 */
function line(
  y: number,
  cells: Array<[number, string]>,
  page = 1,
  charWidth = 5,
): Line {
  const items: Item[] = cells.map(([x, text]) => ({
    x,
    right: x + text.length * charWidth,
    y,
    text,
  }));
  return { y, page, items };
}

/**
 * Reproduces the geometry of an ICICI statement, which is the awkward case:
 * a header split across three baselines, right-aligned amounts, a descriptor
 * line above each row, and narrations wrapped over several lines.
 */
function iciciLines(): Line[] {
  return [
    // Preamble. The title starting at x=46 is the important part: it sits in
    // the gap between the serial-number and date columns.
    line(800, [[418, '1']]),
    line(737, [
      [46, 'Statement of Transactions in Saving Account no. 0941 in INR'],
    ]),
    line(705, [[20, 'A N OTHER']]),
    line(694, [[20, 'SOME STREET, SOME TOWN']]),

    // Three-line header.
    line(619, [
      [60, 'Transaction'],
      [399, 'Withdrawal'],
      [474, 'Deposit'],
      [532, 'Balance'],
    ]),
    line(614, [
      [24, 'S No.'],
      [122, 'Cheque Number'],
      [247, 'Transaction Remarks'],
    ]),
    line(609, [
      [74, 'Date'],
      [396, 'Amount (INR)'],
      [462, 'Amount (INR)'],
      [538, '(INR)'],
    ]),

    // Transaction 1: descriptor above, narration wrapped below.
    line(594, [[192, 'Debit trxn']]),
    line(589, [
      [30, '1'],
      [61, '31.12.2025'],
      [432, '46.00'],
      [540, '2650.07'],
    ]),
    line(584, [[192, '000123456789:WTax.Pd:30-09-2025to 30-12-']]),
    line(574, [[192, '2025']]),

    // Transaction 2: a UPI credit whose reference wraps mid-token.
    line(564, [[192, 'A N OTHER']]),
    line(559, [
      [30, '2'],
      [61, '04.01.2026'],
      [484, '50000.00'],
      [536, '52697.07'],
    ]),
    line(554, [[192, 'UPI/A N OTHER/another@axl/Payment fr/FEDERAL']]),
    line(544, [[192, 'BA/100000000001/AXL1aa2bb3cc4dd5ee6ff7aa8b']]),
    line(534, [[192, 'b9cc0dd2ee']]),

    // Page footer, far below the last transaction.
    line(60, [
      [46, 'www.icici.bank.in'],
      [396, '18001080'],
    ]),
  ];
}

describe('inferBands', () => {
  it('ignores preamble text that would bridge two columns', () => {
    const bands = inferBands(iciciLines());

    // The serial-number column and the date column must stay separate, which
    // only holds if the x=46 title line is excluded from inference.
    const bandAt = (x: number) =>
      bands.findIndex(band => x >= band.left && x <= band.right);
    expect(bandAt(30)).not.toBe(bandAt(61));
  });

  it('keeps a right-aligned amount in the same column as its header', () => {
    const bands = inferBands(iciciLines());

    // The withdrawal header starts at x=396 and its only value at x=432.
    // Comparing start positions alone would split these apart.
    const bandAt = (x: number) =>
      bands.findIndex(band => x >= band.left && x <= band.right);
    expect(bandAt(432)).toBe(bandAt(399));
  });
});

describe('assembleRows', () => {
  const rows = () => {
    const lines = iciciLines();
    return assembleRows(lines, inferBands(lines));
  };

  it('reconstructs a header split across three baselines', () => {
    expect(rows()[0]).toEqual([
      'S No.',
      'Transaction Date',
      'Cheque Number',
      'Transaction Remarks',
      'Withdrawal Amount (INR)',
      'Deposit Amount (INR)',
      'Balance (INR)',
    ]);
  });

  it('produces one row per transaction', () => {
    // Two transactions, plus the header.
    expect(rows()).toHaveLength(3);
  });

  it('drops the descriptor line printed above each row', () => {
    // `Debit trxn` is a PDF-only descriptor: the source spreadsheet contains
    // no occurrence of "trxn". Keeping it would corrupt both the narration and
    // the payee derived from it.
    expect(rows()[1]?.[3]).not.toContain('Debit trxn');
    expect(rows()[1]?.[3]).toContain('000123456789:WTax.Pd');
  });

  it('keeps a wrapped reference usable even though the wrap point is lossy', () => {
    const description = rows()[2]?.[3] ?? '';

    // Whether a line break was a wrap or a deliberate break is not always
    // decidable from a PDF: the previous line here ends two characters short
    // of the column's wrap width, which is ambiguous slack. So a space can be
    // introduced inside a reference, or lost between words (`FEDERAL BA` ->
    // `FEDERALBA`).
    //
    // That is cosmetic only, and this test pins down why: the fields that
    // matter are still recovered. The reference used for deduplication comes
    // from the 12-digit UTR token, not from this text.
    expect(description).toContain('UPI/A N OTHER/another@axl');
    expect(description).toContain('100000000001');
    expect(description).toContain('AXL1aa2bb3cc4dd5ee6ff7aa8b');
  });

  it('keeps the page footer out of the last transaction', () => {
    // The footer's toll-free number sits in the withdrawal column. Folded in,
    // it would concatenate onto an amount and produce a wildly wrong figure,
    // which the balance check would then reject.
    const last = rows()[2] ?? [];
    expect(last.join(' ')).not.toContain('18001080');
    expect(last.join(' ')).not.toContain('www.icici.bank.in');
  });

  it('interprets into transactions that agree with the balance column', () => {
    const result = interpretTable({
      rows: rows(),
      source: { path: 'test.pdf', format: 'pdf' },
    });

    expect(result?.transactions).toHaveLength(2);
    expect(result?.transactions[0]).toMatchObject({
      date: '2025-12-31',
      amount: -46,
      payee: 'Withholding Tax',
    });
    expect(result?.transactions[1]).toMatchObject({
      date: '2026-01-04',
      amount: 50000,
      payee: 'A N Other',
      ref: '100000000001',
    });
  });
});

/**
 * Federal Bank's geometry, which differs from ICICI's in every way that
 * caused a bug:
 *
 * - Ten columns packed ~45 points apart with labels nearly that wide, so the
 *   gutters between them are only a handful of points.
 * - Dates in the preamble (`Account Open Date : 25/03/2013`).
 * - A `GRAND TOTAL` row carrying column sums, and an `Opening Balance` row.
 * - A separate DR/CR indicator column.
 *
 * Positions are taken from a real statement; values are anonymised. The
 * narrower 4-point character width matters: it is what leaves the true
 * gutters between columns.
 */
function federalLines(): Line[] {
  const at = (y: number, cells: Array<[number, string]>) => line(y, cells, 1, 4);

  return [
    // Preamble. Note the dates, which must not become transactions.
    at(690, [
      [18, 'Address Last Updated On'],
      [161, ': 13/08/2024'],
      [304, 'Account Number'],
      [446, ': 00000000000000'],
    ]),
    at(650, [
      [18, 'Email ID'],
      [161, ': someone@example.com'],
      [304, 'Account Open Date'],
      [446, ': 25/03/2013'],
    ]),

    // Header, split across three baselines.
    at(467, [
      [266, 'Tran'],
      [373, 'Cheque'],
      [563, 'DR'],
    ]),
    at(463, [
      [33, 'Date'],
      [79, 'Value Date'],
      [173, 'Particulars'],
      [311, 'Tran ID'],
      [419, 'Withdrawals'],
      [474, 'Deposits'],
      [518, 'Balance'],
    ]),
    at(459, [
      [266, 'Type'],
      [374, 'Details'],
      [562, '/CR'],
    ]),

    // Opening balance: no date, so it must not attach to a transaction.
    at(442, [
      [129, 'Opening Balance'],
      [530, '81744'],
      [572, 'Cr'],
    ]),

    at(425, [
      [23, '01-JAN-2026'],
      [80, '01-JAN-2026'],
      [129, 'UPIOUT/100000000001 '],
      [273, 'TFR'],
      [318, 'S43297822'],
      [433, '22000.00'],
      [521, '59744.00'],
      [572, 'Cr'],
    ]),
    at(417, [[129, '/0000000000000000@BANK000/0000']]),

    at(400, [
      [23, '04-JAN-2026'],
      [80, '04-JAN-2026'],
      [129, 'FT IMPS/IFI/100000000002/Mr A N'],
      [273, 'TFR'],
      [318, 'S93293503'],
      [477, '50000.00'],
      [517, '109744.00'],
      [572, 'Cr'],
    ]),
    at(392, [[129, 'OTHER/IMPSTXN']]),

    // Summary row with per-column sums, sitting just below the last
    // transaction as it does in a real statement, close enough that the
    // continuation-distance guard does not exclude it, so only recognising it
    // as a summary keeps its totals out of a transaction's amount fields.
    at(385, [
      [199, 'GRAND TOTAL'],
      [433, '603374.0'],
      [477, '716652.0'],
    ]),
  ];
}

describe('assembleRows on a Federal-shaped statement', () => {
  const rows = () => {
    const lines = federalLines();
    return assembleRows(lines, inferBands(lines));
  };

  it('keeps tightly packed amount columns separate', () => {
    // Withdrawals and Deposits sit 55 points apart with labels nearly that
    // wide. Merging spans that overlap collapses them into one cell, after
    // which every deposit is read as a withdrawal.
    const header = rows()[0] ?? [];

    expect(header).toContain('Withdrawals');
    expect(header).toContain('Deposits');
    expect(header.some(cell => /withdrawals\s+deposits/i.test(cell))).toBe(
      false,
    );
  });

  it('does not treat preamble dates as transactions', () => {
    // `Address Last Updated On : 13/08/2024` and `Account Open Date :
    // 25/03/2013` both parse as dates but are not transactions.
    const body = rows().slice(1);

    expect(body).toHaveLength(2);
    expect(rows().flat().join(' ')).not.toContain('25/03/2013');
  });

  it('excludes the GRAND TOTAL row and its column sums', () => {
    // Its sums sit in the amount columns, so folding it into the preceding
    // transaction replaces a real amount with the statement total.
    const all = rows().flat().join(' ');

    expect(all).not.toContain('GRAND TOTAL');
    expect(all).not.toContain('603374');
    expect(all).not.toContain('716652');
  });

  it('excludes the Opening Balance row', () => {
    expect(rows().flat().join(' ')).not.toContain('Opening Balance');
  });

  it('interprets both transactions with the right signs', () => {
    const result = interpretTable({
      rows: rows(),
      source: { path: 'federal.pdf', format: 'pdf' },
    });

    expect(result?.header.map).toMatchObject({
      date: 0,
      valueDate: 1,
      description: 2,
      debit: 6,
      credit: 7,
      balance: 8,
    });
    expect(result?.transactions.map(t => t.amount)).toEqual([-22000, 50000]);
  });
});

/**
 * A card statement: a transaction table beside a chart legend, with a card
 * number line between rows, a section title below the last row, and a later
 * page whose terms table carries header-like labels and prose with numbers.
 */
function cardLines(): Line[] {
  const span = (
    y: number,
    cells: Array<[number, number, string]>,
    page = 1,
  ): Line => ({
    y,
    page,
    items: cells.map(([x, right, text]) => ({ x, right, y, text })),
  });

  return [
    span(468, [
      [208, 221, 'Date'],
      [262, 280, 'SerNo.'],
      [305, 358, 'Transaction Details'],
      [443, 465, 'Reward'],
      [522, 557, 'Amount (in ₹)'],
    ]),
    span(430, [
      [208, 239, '12/03/2025'],
      [252, 291, '100000000001'],
      [305, 380, 'ACME STORE PUNE IN'],
      [452, 456, '0'],
      [529, 557, '725.00 CR'],
    ]),
    span(415, [[208, 285, '4000XXXXXXXX0000']]),
    span(402, [
      [48, 63, '100%'],
      [208, 239, '05/03/2025'],
      [252, 291, '100000000002'],
      [305, 376, 'ACME STREAMING PUNE'],
      [452, 456, '1'],
      [538, 557, '120.00'],
    ]),
    span(396, [[305, 325, 'URB IN']]),
    span(381, [
      [205, 207, '#'],
      [209, 265, 'International Spends'],
    ]),
    span(360, [[235, 361, 'TRANSACTION DETAILS']]),

    span(700, [
      [134, 189, 'Particulars'],
      [317, 378, 'Amount in ₹'],
    ], 2),
    span(690, [[28, 400, '5% of 1,00,000 + 7,800']], 2),
  ];
}

describe('assembleRows on a card statement', () => {
  const rows = () => {
    const lines = trimToTable(cardLines());
    return assembleRows(lines, inferBands(lines));
  };

  it('takes columns from the first header only', () => {
    expect(rows()[0]).toEqual([
      'Date',
      'SerNo.',
      'Transaction Details',
      'Reward',
      'Amount (in ₹)',
    ]);
  });

  it('keeps a prose line with numbers from becoming a row', () => {
    expect(rows()).toHaveLength(3);
  });

  it('keeps the card number line out of the row above it', () => {
    expect(rows().flat().join(' ')).not.toContain('4000XXXXXXXX0000');
  });

  it('keeps the legend and section title out of the cells', () => {
    const all = rows().flat().join(' ');

    expect(all).not.toContain('100%');
    expect(all).not.toContain('International Spends');
    expect(all).not.toContain('TRANSACTION DETAILS');
  });

  it('keeps a wrapped description line with its row', () => {
    expect(rows()[2]?.[2]).toBe('ACME STREAMING PUNE URB IN');
  });

  it('reads the credit suffix as money in', () => {
    const result = interpretTable({
      rows: rows(),
      source: { path: 'card.pdf', format: 'pdf' },
    });

    expect(result?.transactions.map(t => t.amount)).toEqual([725, 120]);
  });
});

describe('readFigures', () => {
  const summary = (): Line[] => [
    line(568, [
      [81, 'Total Amount due'],
      [306, 'Purchases / Charges'],
      [488, 'Payments / Credits'],
    ]),
    line(553, [[99, '3,210.40']]),
    line(550, [
      [325, '3,210.40'],
      [502, '`725.00'],
    ]),
  ];

  it('pairs each amount with the label above it', () => {
    expect(readFigures(summary())).toEqual([
      { label: 'Total Amount due', value: '3,210.40' },
      { label: 'Purchases / Charges', value: '3,210.40' },
      { label: 'Payments / Credits', value: '`725.00' },
    ]);
  });

  it('ignores an amount with no label close above it', () => {
    expect(readFigures([line(100, [[99, 'Total']]), line(40, [[99, '9.00']])])).toEqual([]);
  });
});

const SOURCE = { path: 'test.pdf', format: 'pdf' as const };

describe('splitSections', () => {
  it('starts a section at each header that is followed by dated rows', () => {
    const sections = splitSections(consolidatedLines());

    expect(sections.map(section => section.account)).toEqual(['1111', '2222']);
  });

  it('drops a dated line that is not under the date column', () => {
    const text = splitSections(consolidatedLines())
      .flatMap(section => section.lines)
      .flatMap(item => item.items.map(entry => entry.text));

    expect(text).not.toContain('100000000001');
    expect(text).toContain('UPI/ACME STORE PUNE');
  });

  it('does not take a summary that reads like a header for the table header', () => {
    const sections = splitSections(summaryFirstLines());

    expect(sections).toHaveLength(1);
    expect(sections[0]?.account).toBe('4567');
    const first = sections[0]?.lines[0]?.items.map(entry => entry.text);
    expect(first).toContain('Date and Time');
  });

  it('finds nothing in text without a header and dated rows', () => {
    expect(splitSections([line(700, [[34, 'A note with no table']])])).toEqual(
      [],
    );
  });
});

describe('tablesFromLines on a consolidated statement', () => {
  const tables = () => tablesFromLines(consolidatedLines(), SOURCE);

  it('keeps each account in its own table with its own columns', () => {
    expect(tables()).toHaveLength(2);
    expect(tables()[0]?.rows[0]).toEqual([
      'DATE',
      'MODE',
      'PARTICULARS',
      'DEPOSITS',
      'WITHDRAWALS',
      'BALANCE',
    ]);
  });

  it('reads the totals row, labelled by column', () => {
    expect(tables()[0]?.totals).toEqual([
      { label: 'Total DEPOSITS', value: '500.00' },
      { label: 'Total WITHDRAWALS', value: '200.00' },
      { label: 'Total BALANCE', value: '1,300.00' },
    ]);
  });

  it('reads both accounts and agrees with their printed totals', () => {
    const sections = interpretSections(tables());

    expect(sections.map(section => section.result.transactions.length)).toEqual(
      [2, 1],
    );
    for (const section of sections) {
      expect(validateSectionTotals(section.result.transactions, section.table.totals).status).toBe('passed');
    }
    expect(validateBalances(sections[0]?.result.transactions ?? []).status).toBe(
      'passed',
    );
  });

  it('keeps the notice with a date out of the second account', () => {
    const second = tables()[1];

    expect(second?.rows.flat().join(' ')).not.toContain('100000000001');
  });
});

describe('tablesFromLines on a summary-first statement', () => {
  const tables = () => tablesFromLines(summaryFirstLines(), SOURCE);

  it('recognises a Date and Time header and reads the opening balance row', () => {
    expect(tables()).toHaveLength(1);
    expect(tables()[0]?.rows[0]).toContain('Date and Time');
    expect(tables()[0]?.totals).toEqual([
      { label: 'Opening Balance', value: '10,000.00 CR' },
    ]);
  });

  it('reads both rows and checks opening balance plus movement', () => {
    const [section] = interpretSections(tables());

    expect(section?.result.transactions.map(row => row.amount)).toEqual([
      -725, 430,
    ]);
    expect(
      validateSectionTotals(
        section?.result.transactions ?? [],
        section?.table.totals,
      ).status,
    ).toBe('passed');
  });
});

describe('tablesFromLines on one account whose header repeats', () => {
  it('splits per page, and the sections join back into one account', () => {
    const header = (y: number, page: number) =>
      line(
        y,
        [
          [40, 'Date'],
          [120, 'Narration'],
          [300, 'Debit'],
          [370, 'Credit'],
          [450, 'Balance'],
        ],
        page,
      );
    const lines = [
      header(700, 1),
      line(680, [[40, '01/04/2025'], [120, 'ACME STORE'], [300, '100.00'], [450, '900.00']]),
      line(660, [[40, '02/04/2025'], [120, 'ACME CAFE'], [300, '50.00'], [450, '850.00']]),
      header(700, 2),
      line(680, [[40, '03/04/2025'], [120, 'ACME TAXI'], [300, '25.00'], [450, '825.00']], 2),
    ];

    const tables = tablesFromLines(lines, SOURCE);
    const sections = interpretSections(tables);

    expect(tables).toHaveLength(2);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.result.transactions).toHaveLength(3);
    expect(validateBalances(sections[0]?.result.transactions ?? []).status).toBe(
      'passed',
    );
  });
});

describe('reading a real PDF file', () => {
  it('reads each account of a consolidated statement from PDF bytes', async () => {
    const bytes = pdfFromLines(consolidatedLines());

    const { tables, format } = await extractTablesFromBytes(bytes, 'test.pdf');
    const sections = interpretSections(tables);

    expect(format).toBe('pdf');
    expect(sections.map(section => section.account)).toEqual(['1111', '2222']);
    expect(
      sections.map(section => section.result.transactions.map(row => row.amount)),
    ).toEqual([[500, -200], [100]]);
    for (const section of sections) {
      expect(
        validateSectionTotals(section.result.transactions, section.table.totals)
          .status,
      ).toBe('passed');
    }
  });

  it('reads the headings, opening balance and rows of a summary-first page', async () => {
    const bytes = pdfFromLines(summaryFirstLines());

    const { tables } = await extractTablesFromBytes(bytes, 'test.pdf');
    const [section] = interpretSections(tables);

    expect(tables[0]?.rows[0]).toContain('Date and Time');
    expect(section?.result.transactions.map(row => row.amount)).toEqual([
      -725, 430,
    ]);
  });

  it('does not change the bytes it was given', async () => {
    const bytes = pdfFromLines(consolidatedLines());
    const before = bytes.slice();

    await extractTablesFromBytes(bytes, 'test.pdf');

    expect(bytes).toEqual(before);
  });
});

describe('a password protected PDF', () => {
  const locked = () => pdfFromLines(consolidatedLines(), { password: 'not-a-real-password' });

  it('opens with the right password', async () => {
    const { tables } = await extractTablesFromBytes(locked(), 'locked.pdf', {
      password: 'not-a-real-password',
    });

    expect(interpretSections(tables).map(section => section.account)).toEqual([
      '1111',
      '2222',
    ]);
  });

  it('says a password is needed, and when the one given is wrong', async () => {
    const missing = await extractTablesFromBytes(locked(), 'locked.pdf').catch(
      (error: unknown) => error,
    );
    const wrong = await extractTablesFromBytes(locked(), 'locked.pdf', {
      password: 'wrong',
    }).catch((error: unknown) => error);

    expect(isPasswordError(missing)).toBe(true);
    expect(isPasswordError(wrong)).toBe(true);
    expect(isPasswordError(new Error('something else'))).toBe(false);
  });
});
