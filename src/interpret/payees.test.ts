import { describe, expect, it } from 'vitest';

import { parseNarration } from '../narration/parse.js';

import { isUnclear, payeeGroups } from './payees.js';
import type { StatementTransaction } from './rows.js';

function row(raw: string, amount = -100): StatementTransaction {
  const parsed = parseNarration(raw);
  return {
    date: '2025-03-12',
    amount,
    payee: parsed.merchant,
    raw: parsed.raw,
    kind: parsed.kind,
    payeeSource: parsed.source,
    payeeRule: parsed.rule,
  };
}

const ROWS = [
  row('UPI-swiggy@ybl-412345678904-ORDER'),
  row('UPI/412345678903/9876543210@ybl/PAY', -50),
  row('UPI/412345678906/9876543210@ybl/PAY', -70),
  row('UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA'),
  row('IMPS/412345678905/0000000000000000@BANK000/PAYMENT', -20),
];

describe('payeeGroups', () => {
  it('lists only the guesses, grouped by the rule that would name them', () => {
    const groups = payeeGroups(ROWS);

    expect(groups.map(group => group.rule)).toEqual([
      '^9876543210',
      'impsbankpayment',
    ]);
    expect(groups[0]).toMatchObject({ count: 2, total: -120, source: 'vpa' });
    expect(groups[0]?.indexes).toEqual([1, 2]);
  });

  it('can list every payee, most frequent first', () => {
    const groups = payeeGroups(ROWS, { all: true });

    expect(groups).toHaveLength(4);
    expect(groups[0]?.count).toBe(2);
  });

  it('keeps one narration as an example, as the bank wrote it', () => {
    expect(payeeGroups(ROWS)[0]?.example).toContain('9876543210@ybl');
  });

  it('puts rows without a rule into a group of their own by name', () => {
    const groups = payeeGroups(
      [{ ...row('UPI-swiggy@ybl-412345678904-ORDER'), payeeRule: '', payeeSource: 'raw' }],
    );

    expect(groups).toHaveLength(1);
  });
});

describe('isUnclear', () => {
  it('is false for a mapped merchant and for a row with no source', () => {
    expect(isUnclear(ROWS[0] as StatementTransaction)).toBe(false);
    expect(
      isUnclear({ ...(ROWS[0] as StatementTransaction), payeeSource: undefined }),
    ).toBe(false);
  });

  it('is true for a payee guessed from a VPA', () => {
    expect(isUnclear(ROWS[1] as StatementTransaction)).toBe(true);
  });
});
