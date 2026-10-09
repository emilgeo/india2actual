import type { Item, Line } from '../extract/pdf.js';

/**
 * Build a line from `[x, text]` pairs. Widths are approximated at 5 points per
 * character, which is close enough to real statement typesetting for the
 * wrap-versus-line-break test below.
 */
export function line(
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
 * Two accounts printed one after the other, then a page whose tax summary has
 * a dated row of its own. Shaped like a consolidated monthly statement.
 */
export function consolidatedLines(): Line[] {
  const row = (y: number, cells: Array<[number, string]>, page = 1) =>
    line(y, cells, page, 4);

  const header = (y: number) =>
    row(y, [
      [37, 'DATE'],
      [81, 'MODE'],
      [141, 'PARTICULARS'],
      [371, 'DEPOSITS'],
      [428, 'WITHDRAWALS'],
      [524, 'BALANCE'],
    ]);

  return [
    row(750, [[34, 'Summary of accounts held with the bank']]),
    row(442, [
      [34, 'Statement of transactions in Savings Account XXXXXXXX1111 in INR'],
    ]),
    header(419),
    row(405, [
      [35, '12-03-2025'],
      [141, 'B/F'],
      [538, '1,000.00'],
    ]),
    row(391, [
      [35, '13-03-2025'],
      [81, 'BY CASH'],
      [141, 'CASH DEPOSIT'],
      [376, '500.00'],
      [528, '1,500.00'],
    ]),
    row(377, [
      [35, '14-03-2025'],
      [141, 'UPI/ACME STORE PUNE'],
      [456, '200.00'],
      [528, '1,300.00'],
    ]),
    row(363, [
      [141, 'Total:'],
      [369, '500.00'],
      [455, '200.00'],
      [527, '1,300.00'],
    ]),
    row(340, [
      [34, 'Statement of transactions in Savings Account XXXXXXXX2222 in INR'],
    ]),
    header(317),
    row(303, [
      [35, '12-03-2025'],
      [141, 'B/F'],
      [538, '2,000.00'],
    ]),
    row(289, [
      [35, '15-03-2025'],
      [141, 'NEFT FROM ACME CONSULTING'],
      [376, '100.00'],
      [528, '2,100.00'],
    ]),
    row(275, [
      [141, 'Total:'],
      [369, '100.00'],
      [527, '2,100.00'],
    ]),
    row(740, [[34, 'Summary of interest and tax']], 2),
    row(
      700,
      [
        [37, '100000000001'],
        [111, '31-03-2025'],
        [202, '12.00'],
        [277, '1.00'],
      ],
      2,
    ),
    row(
      686,
      [
        [37, 'Closing Balance (Cumulative)'],
        [202, '12.00'],
      ],
      2,
    ),
  ];
}

/**
 * One account whose block starts with a summary that reads like a header, a
 * two-line header, and an opening balance row, as an IDFC-style statement
 * lays it out.
 */
export function summaryFirstLines(): Line[] {
  const row = (y: number, cells: Array<[number, string]>, page = 1) =>
    line(y, cells, page, 3.2);

  return [
    row(803, [[163, 'ACME BANK STATEMENT']]),
    row(315, [[53, 'SAVINGS ACCOUNT DETAILS FOR A/c : 10001234567']]),
    row(305, [
      [73, 'Opening Balance'],
      [169, 'Number of'],
      [227, 'Number of Deposits'],
      [314, 'Withdrawals'],
      [390, 'Deposits'],
      [460, 'Closing Balance'],
    ]),
    row(295, [
      [95, '(INR)'],
      [166, 'Withdrawals'],
      [327, '(INR)'],
      [397, '(INR)'],
      [480, '(INR)'],
    ]),
    row(283, [
      [84, '10,000.00 CR'],
      [183, '1'],
      [258, '1'],
      [323, '725.00'],
      [400, '430.00'],
      [474, '9,705.00 CR'],
    ]),
    row(262, [
      [57, 'Date and Time'],
      [120, 'Value Date'],
      [189, 'Transaction Details'],
      [286, 'Cheque/Ref'],
      [342, 'Withdrawals'],
      [409, 'Deposits'],
      [481, 'Balance'],
    ]),
    row(252, [
      [302, 'No.'],
      [356, '(INR)'],
      [417, '(INR)'],
      [487, '(INR)'],
    ]),
    row(240, [
      [169, 'Opening Balance'],
      [487, '10,000.00 CR'],
    ]),
    row(229, [[169, 'UPI-ACME STORE PUNE-swiggy@ybl-412345678901-NA']]),
    row(224, [
      [57, '12 Mar 25 10:15'],
      [123, '12 Mar 25'],
      [361, '725.00'],
      [497, '9,275.00 CR'],
    ]),
    row(219, [[169, 'ACME/STORE/412345678901']]),
    row(205, [
      [57, '13 Mar 25 11:20'],
      [123, '13 Mar 25'],
      [169, 'NEFT-ACME CONSULTING'],
      [420, '430.00'],
      [497, '9,705.00 CR'],
    ]),
  ];
}

