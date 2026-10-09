import { describe, expect, it } from 'vitest';

import type { StatementTransaction } from '../interpret/rows.js';

import {
  findExistingCounterparts,
  isCardPayment,
  nodeTooOldForPush,
  pushTransactions,
  resolveAccount,
  toImportEntities,
  toPaise,
} from './push.js';
import type { ActualApi, PushConfig } from './push.js';

function transaction(
  overrides: Partial<StatementTransaction> = {},
): StatementTransaction {
  return {
    date: '2024-04-01',
    amount: -450.5,
    payee: 'Swiggy',
    raw: 'UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment',
    kind: 'upi',
    ...overrides,
  };
}

describe('toPaise', () => {
  it('converts rupees to integer paise', () => {
    expect(toPaise(-450.5)).toBe(-45050);
    expect(toPaise(50000)).toBe(5000000);
  });

  it('rounds rather than truncating float error', () => {
    // 0.1 + 0.2 style drift must not lose a paisa.
    expect(toPaise(1234.565)).toBe(123457);
    expect(toPaise(19.99)).toBe(1999);
  });
});

describe('toImportEntities', () => {
  it('splits the cleaned payee from the raw narration', () => {
    const [entity] = toImportEntities([transaction()]);

    // This split is the thing the CSV output cannot express, because Actual's
    // CSV field mapping has no imported_payee slot.
    expect(entity).toMatchObject({
      date: '2024-04-01',
      amount: -45050,
      payee_name: 'Swiggy',
      imported_payee: 'UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment',
      cleared: true,
    });
  });

  it('writes the narration to notes as well as imported_payee', () => {
    // Both, not either. `imported_payee` is what Actual's payee matching uses
    // but is not a column you can read at a glance; Notes is the one you can
    // see, search and filter. Setting only the former left the narration
    // effectively invisible after a push.
    const [entity] = toImportEntities([transaction()]);

    expect(entity?.notes).toBe(
      'UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment',
    );
    expect(entity?.imported_payee).toBe(entity?.notes);
  });

  it('keeps notes as the full narration even when the payee is unrecognisable', () => {
    // The case where notes matters most: nothing useful was extracted, so the
    // narration is the only record of what the transaction actually was.
    const raw = '000011002200 FD clos 13-03-2026 A N OTHER';
    const [entity] = toImportEntities([transaction({ payee: 'Unknown', raw })]);

    expect(entity?.notes).toBe(raw);
  });

  it('sets imported_id only when a reference survived the safety checks', () => {
    const withRef = toImportEntities([transaction({ ref: '412345678901' })]);
    const withoutRef = toImportEntities([transaction()]);

    expect(withRef[0]?.imported_id).toBe('412345678901');
    // Absent rather than undefined-valued: Actual falls back to matching on
    // date and amount, which is safer than a reference we do not trust.
    expect(withoutRef[0]).not.toHaveProperty('imported_id');
  });
});

describe('resolveAccount', () => {
  const accounts = [
    { id: 'acct-1', name: 'HDFC Savings' },
    { id: 'acct-2', name: 'ICICI Savings' },
    { id: 'acct-3', name: 'Old Account', closed: true },
  ];

  it('matches on id', () => {
    expect(resolveAccount(accounts, 'acct-2').name).toBe('ICICI Savings');
  });

  it('matches on name, ignoring case and surrounding space', () => {
    expect(resolveAccount(accounts, '  hdfc savings ').id).toBe('acct-1');
  });

  it('lists the open accounts when nothing matches', () => {
    expect(() => resolveAccount(accounts, 'Nonexistent')).toThrow(
      /No account matching "Nonexistent"/,
    );
    // Closed accounts would only be noise in that list.
    expect(() => resolveAccount(accounts, 'Nonexistent')).toThrow(
      /HDFC Savings/,
    );
    expect(() => resolveAccount(accounts, 'Nonexistent')).not.toThrow(
      /Old Account/,
    );
  });
});

describe('card payments as transfers', () => {
  const payment = (overrides: Partial<StatementTransaction> = {}) =>
    transaction({
      date: '2025-03-10',
      amount: 500,
      payee: 'Credit Card Payment',
      raw: 'AUTODEBIT PAYMENT RECD.',
      ...overrides,
    });

  it('recognises both sides of a card payment', () => {
    expect(isCardPayment(payment())).toBe(true);
    expect(isCardPayment(payment({ payee: 'Credit Card Autopay' }))).toBe(true);
    expect(isCardPayment(transaction())).toBe(false);
  });

  it('sends a payment with the transfer payee id and no payee name', () => {
    const [entity] = toImportEntities([payment()], {
      payeeId: 'payee-bank',
      skip: new Set(),
    });

    expect(entity).toMatchObject({ payee: 'payee-bank', amount: 50000 });
    expect(entity).not.toHaveProperty('payee_name');
    expect(entity?.notes).toBe('AUTODEBIT PAYMENT RECD.');
  });

  it('leaves other rows and skipped payments as ordinary payees', () => {
    const entities = toImportEntities([transaction(), payment()], {
      payeeId: 'payee-bank',
      skip: new Set([1]),
    });

    expect(entities[0]).toMatchObject({ payee_name: 'Swiggy' });
    expect(entities[1]).toMatchObject({ payee_name: 'Credit Card Payment' });
    expect(entities[1]).not.toHaveProperty('payee');
  });

  it('sends nothing as a transfer when no account is given', () => {
    const [entity] = toImportEntities([payment()]);

    expect(entity).toMatchObject({ payee_name: 'Credit Card Payment' });
  });
});

describe('findExistingCounterparts', () => {
  const payment = (date: string, amount: number) =>
    transaction({ date, amount, payee: 'Credit Card Payment' });
  const existing = (date: string, amount: number, transfer_id?: string) => ({
    date,
    amount,
    ...(transfer_id ? { transfer_id } : {}),
  });

  it('finds an ordinary opposite-amount transaction within the window', () => {
    const rows = [payment('2025-03-10', 500)];

    expect(
      findExistingCounterparts(rows, [existing('2025-03-08', -50000)]),
    ).toEqual([0]);
    expect(
      findExistingCounterparts(rows, [existing('2025-03-17', -50000)]),
    ).toEqual([0]);
  });

  it('ignores a counterpart outside the window or with another amount', () => {
    const rows = [payment('2025-03-10', 500)];

    expect(
      findExistingCounterparts(rows, [existing('2025-03-18', -50000)]),
    ).toEqual([]);
    expect(
      findExistingCounterparts(rows, [existing('2025-03-10', -49900)]),
    ).toEqual([]);
    expect(
      findExistingCounterparts(rows, [existing('2025-03-10', 50000)]),
    ).toEqual([]);
  });

  it('ignores a transaction that is already a transfer', () => {
    // A mirror from an earlier import is what the new row should match.
    const rows = [payment('2025-03-10', 500)];

    expect(
      findExistingCounterparts(rows, [existing('2025-03-10', -50000, 't-1')]),
    ).toEqual([]);
  });

  it('uses each counterpart once, preferring the nearest date', () => {
    const rows = [payment('2025-03-10', 500), payment('2025-04-10', 500)];
    const others = [
      existing('2025-03-12', -50000),
      existing('2025-03-09', -50000),
    ];

    // Only the March payment has a counterpart; the nearer one is used.
    expect(findExistingCounterparts(rows, others)).toEqual([0]);
    expect(
      findExistingCounterparts([rows[0] as StatementTransaction, rows[0] as StatementTransaction], others),
    ).toEqual([0, 1]);
  });

  it('only considers card payments', () => {
    const rows = [transaction({ date: '2025-03-10', amount: 500 })];

    expect(
      findExistingCounterparts(rows, [existing('2025-03-10', -50000)]),
    ).toEqual([]);
  });
});

describe('nodeTooOldForPush', () => {
  it('rejects Node versions before 22.14', () => {
    for (const version of ['20.18.0', '21.7.3', '22.0.0', '22.13.1']) {
      expect(nodeTooOldForPush(version)).toBe(true);
    }
  });

  it('accepts 22.14 and later, including newer majors', () => {
    for (const version of ['22.14.0', '22.23.3', '24.1.0', '25.0.0']) {
      expect(nodeTooOldForPush(version)).toBe(false);
    }
  });
});

describe('pushTransactions with a supplied connector', () => {
  const config: PushConfig = {
    serverURL: 'https://actual.example.test',
    password: 'not-a-real-password',
    syncId: 'sync-1',
    account: 'Acme Savings',
    dryRun: false,
  };

  /** A stand-in for the Actual API that records what it is asked to do. */
  function fakeApi() {
    const calls: string[] = [];
    const imported: Array<{ accountId: string; rows: unknown[]; opts: unknown }> =
      [];
    const api: ActualApi = {
      init: async () => {
        calls.push('init');
      },
      downloadBudget: async () => {
        calls.push('download');
      },
      getAccounts: async () => [
        { id: 'a1', name: 'Acme Savings' },
        { id: 'a2', name: 'Acme Card' },
      ],
      getPayees: async () => [
        { id: 'p-card', name: 'Acme Card', transfer_acct: 'a2' },
      ],
      getTransactions: async () => [],
      importTransactions: async (accountId, rows, opts) => {
        calls.push('import');
        imported.push({ accountId, rows, opts });
        return { added: rows.map((_, index) => `id${index}`), updated: [] };
      },
      shutdown: async () => {
        calls.push('shutdown');
      },
    };
    return { api, calls, imported };
  }

  it('imports into the named account and shuts the connection down', async () => {
    const { api, calls, imported } = fakeApi();

    const result = await pushTransactions(
      [transaction({ ref: '412345678901' })],
      config,
      async () => api,
    );

    expect(result).toMatchObject({ accountName: 'Acme Savings', added: 1 });
    expect(imported[0]?.accountId).toBe('a1');
    expect(imported[0]?.rows).toEqual([
      expect.objectContaining({ amount: -45050, imported_id: '412345678901' }),
    ]);
    expect(calls).toEqual(['download', 'import', 'shutdown']);
  });

  it('passes a dry run through so nothing is written', async () => {
    const { api, imported } = fakeApi();

    await pushTransactions(
      [transaction()],
      { ...config, dryRun: true },
      async () => api,
    );

    expect(imported[0]?.opts).toMatchObject({ dryRun: true });
  });

  it('shuts down even when the account does not exist', async () => {
    const { api, calls } = fakeApi();

    await expect(
      pushTransactions(
        [transaction()],
        { ...config, account: 'No Such Account' },
        async () => api,
      ),
    ).rejects.toThrow(/No account matching/);

    expect(calls).toContain('shutdown');
    expect(calls).not.toContain('import');
  });

  it('sends a card payment to the other account as a transfer', async () => {
    const { api, imported } = fakeApi();

    await pushTransactions(
      [transaction({ payee: 'Credit Card Autopay', amount: -1500 })],
      { ...config, transferTo: 'Acme Card' },
      async () => api,
    );

    expect(imported[0]?.rows).toEqual([
      expect.objectContaining({ payee: 'p-card', amount: -150000 }),
    ]);
  });

  it('sends a Starting Balance row like any other, without a reference', async () => {
    const { api, imported } = fakeApi();

    await pushTransactions(
      [
        transaction({
          payee: 'Starting Balance',
          raw: 'Opening balance from the statement',
          amount: 10000,
        }),
      ],
      config,
      async () => api,
    );

    const [row] = imported[0]?.rows ?? [];
    expect(row).toMatchObject({
      payee_name: 'Starting Balance',
      amount: 1000000,
    });
    expect(row).not.toHaveProperty('imported_id');
  });
});
