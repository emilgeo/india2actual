import { describe, expect, it } from 'vitest';

import { line } from '../testing/fixtures.js';

import { describePdfLayout } from './pdf.js';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

const HEADER = (page = 1) =>
  line(700, [[20, 'Date'], [80, 'Narration'], [220, 'Withdrawal'], [290, 'Deposit'], [360, 'Balance']], page);
const ROW = (y: number, page: number, date = '01/04/2025') =>
  line(y, [[20, date], [80, 'ACME STORE'], [220, '100.00'], [360, '900.00']], page);

describe('describePdfLayout', () => {
  it('counts the lines of each page and marks the pages inside a recognised table', () => {
    const lines = [HEADER(), ROW(680, 1), ROW(660, 1), ROW(640, 1)];
    const layout = describePdfLayout(lines, 1);

    expect(layout.pages).toEqual([
      { page: 1, items: 5 + 12, lines: 4, dateLines: 3, amountLines: 3, inTable: true },
    ]);
    expect(layout.window).toEqual([]);
  });

  it('shows a page with no text as empty, even though it has no lines', () => {
    const layout = describePdfLayout([HEADER(), ROW(680, 1)], 3);

    expect(layout.pages.map(page => [page.page, page.items])).toEqual([
      [1, 5 + 4],
      [2, 0],
      [3, 0],
    ]);
  });

  it('windows the dated rows that no table claimed, starting at the first of them, without the lines above', () => {
    const lines = [
      line(780, [[36, 'Krishnan Iyer'], [200, 'Flat 4, Example Road']], 1),
      line(760, [[36, 'Statement period'], [200, '01/03/2025']], 1),
      ROW(680, 1),
      ROW(660, 1),
      ROW(640, 1),
      line(100, [[36, 'Example Bank, Branch 12']], 1),
    ];
    const layout = describePdfLayout(lines, 1);

    expect(layout.pages[0]?.inTable).toBe(false);
    const shown = layout.window.map(entry => entry.items.map(item => item.text).join(' '));
    expect(shown.join('\n')).toContain('ACME STORE');
    expect(shown.join('\n')).not.toMatch(/Krishnan|Example|Statement period/);
    expect(layout.window.every(entry => entry.dateLed)).toBe(true);
    // The two lines above, raw, so the report can keep the ones made only of heading words.
    expect(layout.above.map(entry => entry.items.map(item => item.text).join(' '))).toEqual([
      'Krishnan Iyer Flat 4, Example Road',
      'Statement period 01/03/2025',
    ]);
  });

  it('windows dated rows on a later page that the table did not take', () => {
    const lines = [
      HEADER(1),
      ROW(680, 1),
      ROW(660, 1),
      ROW(640, 1),
      // Dates far from the header's date column are not table rows.
      ...[600, 580, 560].map(y =>
        line(y, [[300, '02/04/2025'], [340, '5.00'], [380, '6.00']], 2),
      ),
    ];
    const layout = describePdfLayout(lines, 2);

    expect(layout.pages.map(page => page.inTable)).toEqual([true, false]);
    expect(layout.window.length).toBe(3);
  });

  it('caps the window and keeps it on one page', () => {
    const lines = Array.from({ length: 30 }, (_, index) => ROW(700 - index * 10, index < 15 ? 1 : 2));
    const layout = describePdfLayout(lines, 2);

    expect(layout.window.length).toBeLessThanOrEqual(10);
  });

  it('does not change what it is given', () => {
    const lines = deepFreeze([HEADER(), ROW(680, 1), ROW(660, 1), ROW(640, 1)]);
    expect(() => describePdfLayout(lines, 2)).not.toThrow();
  });
});
