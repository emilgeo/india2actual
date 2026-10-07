import { describe, expect, it } from 'vitest';

import type { Figure, Table } from '../extract/types.js';

import { interpretSections } from './sections.js';

const HEADER = ['Date', 'Narration', 'Withdrawal', 'Deposit', 'Balance'];

function table(
  rows: string[][],
  extras: { account?: string; totals?: Figure[] } = {},
): Table {
  return {
    rows: [HEADER, ...rows],
    ...extras,
    source: { path: 'test.pdf', format: 'pdf' },
  };
}

const FIRST = table([
  ['01/04/2025', 'ACME STORE', '100.00', '', '900.00'],
  ['02/04/2025', 'ACME CAFE', '50.00', '', '850.00'],
]);

describe('interpretSections', () => {
  it('joins a table that carries on from the previous one', () => {
    const next = table([['03/04/2025', 'ACME TAXI', '25.00', '', '825.00']]);

    const sections = interpretSections([FIRST, next]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.result.transactions).toHaveLength(3);
  });

  it('joins a table that opens with the balance the last one ended on', () => {
    const next = table([
      ['03/04/2025', 'B/F', '', '', '850.00'],
      ['03/04/2025', 'ACME TAXI', '25.00', '', '825.00'],
    ]);

    expect(interpretSections([FIRST, next])).toHaveLength(1);
  });

  it('keeps a table apart when it opens with a different balance', () => {
    const next = table([
      ['01/04/2025', 'B/F', '', '', '5,000.00'],
      ['03/04/2025', 'ACME TAXI', '25.00', '', '4,975.00'],
    ]);

    const sections = interpretSections([FIRST, next]);

    expect(sections).toHaveLength(2);
    expect(sections[1]?.result.transactions).toHaveLength(1);
  });

  it('uses an opening balance printed in the table when there is no B/F row', () => {
    const next = table(
      [['03/04/2025', 'ACME TAXI', '25.00', '', '4,975.00']],
      { totals: [{ label: 'Opening Balance', value: '5,000.00 CR' }] },
    );

    expect(interpretSections([FIRST, next])).toHaveLength(2);
  });

  it('keeps tables apart when their account numbers differ', () => {
    const first = { ...FIRST, account: '1111' };
    const next = table([['03/04/2025', 'ACME TAXI', '25.00', '', '825.00']], {
      account: '2222',
    });

    const sections = interpretSections([first, next]);

    expect(sections.map(section => section.account)).toEqual(['1111', '2222']);
  });

  it('keeps the account of the first table when tables are joined', () => {
    const first = { ...FIRST, account: '1111' };
    const next = table([['03/04/2025', 'ACME TAXI', '25.00', '', '825.00']], {
      account: '1111',
    });

    const sections = interpretSections([first, next]);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.account).toBe('1111');
  });

  it('drops a table with no transaction columns', () => {
    const summary: Table = {
      rows: [
        ['Account type', 'Amount'],
        ['Savings', '1,000.00'],
      ],
      source: { path: 'test.pdf', format: 'pdf' },
    };

    expect(interpretSections([summary, FIRST])).toHaveLength(1);
  });
});
