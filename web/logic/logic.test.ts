import { describe, expect, it } from 'vitest';

import { consolidatedLines } from '../../src/testing/fixtures.js';
import { pdfFromLines } from '../../src/testing/pdf.js';

import { datesAreAmbiguous } from './dates.js';
import { loadFile, readSections } from './files.js';
import type { Settings } from './files.js';
import { csvFileName, rowsToDownload } from './output.js';
import {
  clearRules,
  loadRules,
  mergeRules,
  readRulesFile,
  saveRules,
  withRule,
} from './rules-store.js';
import type { RuleStorage } from './rules-store.js';

const encode = (text: string) => new TextEncoder().encode(text);

const CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '12/03/2025,UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA,725.00,,"9,275.00"',
  '13/03/2025,UPI/412345678903/9876543210@ybl/PAY,,430.00,"9,705.00"',
  '',
].join('\n');

const SETTINGS: Settings = { dateOrder: 'dmy', forceCard: false, rules: [] };

function memoryStorage(): RuleStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  };
}

describe('loadFile and readSections', () => {
  it('reads a CSV statement into one account', async () => {
    const file = await loadFile(1, 'statement.csv', encode(CSV));

    expect(file.status).toBe('ready');
    expect(file.format).toBe('delimited text');
    expect(readSections(file, SETTINGS)).toHaveLength(1);
  });

  it('reads the accounts of a PDF', async () => {
    const file = await loadFile(2, 'all.pdf', pdfFromLines(consolidatedLines()));

    expect(file.format).toBe('PDF');
    expect(readSections(file, SETTINGS).map(section => section.account)).toEqual([
      '1111',
      '2222',
    ]);
  });

  it('reports a file it cannot use instead of throwing', async () => {
    const file = await loadFile(3, 'old.xls', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

    expect(file.status).toBe('error');
    expect(file.error).toContain('not supported');
  });

  it('applies saved names to the payees', async () => {
    const file = await loadFile(1, 'statement.csv', encode(CSV));

    const [section] = readSections(file, {
      ...SETTINGS,
      rules: [{ pattern: '^9876543210', name: 'Neighbourhood Kirana' }],
    });

    expect(section?.result.transactions.map(row => row.payee)).toEqual([
      'Acme Store Pune',
      'Neighbourhood Kirana',
    ]);
  });

  it('skips a saved rule that is not a valid pattern', async () => {
    const file = await loadFile(1, 'statement.csv', encode(CSV));

    expect(() =>
      readSections(file, { ...SETTINGS, rules: [{ pattern: '(', name: 'X' }] }),
    ).not.toThrow();
  });
});

describe('a password protected PDF', () => {
  const locked = () =>
    pdfFromLines(consolidatedLines(), { password: 'not-a-real-password' });

  it('asks for a password, then for another when it is wrong, then opens', async () => {
    const asked = await loadFile(4, 'locked.pdf', locked());
    expect(asked).toMatchObject({ status: 'password' });
    expect(asked.wrongPassword).toBeUndefined();

    const wrong = await loadFile(4, 'locked.pdf', locked(), 'wrong');
    expect(wrong).toMatchObject({ status: 'password', wrongPassword: true });

    const opened = await loadFile(4, 'locked.pdf', locked(), 'not-a-real-password');
    expect(opened.status).toBe('ready');
    expect(readSections(opened, SETTINGS)).toHaveLength(2);
  });
});

describe('csvFileName', () => {
  it('uses the account digits only when a file holds several accounts', async () => {
    const file = await loadFile(2, 'all.pdf', pdfFromLines(consolidatedLines()));
    const sections = readSections(file, SETTINGS);

    expect(csvFileName('all.pdf', sections[0] as never, 1, true)).toBe(
      'all.1111.actual.csv',
    );
    expect(csvFileName('all.pdf', sections[0] as never, 1, false)).toBe(
      'all.actual.csv',
    );
  });
});

describe('rowsToDownload', () => {
  it('leaves out excluded rows, applies single renames and adds the opening row', async () => {
    const file = await loadFile(1, 'statement.csv', encode(CSV));
    const [section] = readSections(file, SETTINGS);

    const rows = rowsToDownload(section as never, {
      excluded: new Set([0]),
      renamed: new Map([[1, 'Just This One']]),
      startingBalance: true,
    });

    expect(rows.map(row => row.payee)).toEqual(['Starting Balance', 'Just This One']);
    expect(rows[0]?.amount).toBe(10000);
  });
});

describe('saved payee names', () => {
  it('survives a round trip through storage', () => {
    const storage = memoryStorage();

    saveRules(storage, [{ pattern: '^acme', name: 'Acme' }]);

    expect(loadRules(storage)).toEqual([{ pattern: '^acme', name: 'Acme' }]);
    clearRules(storage);
    expect(loadRules(storage)).toEqual([]);
  });

  it('works without storage and ignores damaged data', () => {
    expect(loadRules(null)).toEqual([]);
    expect(() => saveRules(null, [])).not.toThrow();

    const storage = memoryStorage();
    storage.setItem('india2actual.rules.v1', 'not json');
    expect(loadRules(storage)).toEqual([]);
  });

  it('replaces a rule with the same pattern and lets a file win on merge', () => {
    const rules = withRule([{ pattern: '^a', name: 'Old' }], { pattern: '^a', name: 'New' });
    expect(rules).toEqual([{ pattern: '^a', name: 'New' }]);

    expect(
      mergeRules(rules, [
        { pattern: '^a', name: 'FromFile' },
        { pattern: '^b', name: 'B' },
      ]),
    ).toEqual([
      { pattern: '^a', name: 'FromFile' },
      { pattern: '^b', name: 'B' },
    ]);
  });

  it('reads a merchants file the way the command line does', () => {
    expect(readRulesFile('[{"pattern":"^x","name":"X"}]', 'rules.json')).toEqual([
      { pattern: '^x', name: 'X' },
    ]);
    expect(() => readRulesFile('{}', 'rules.json')).toThrow(/array/);
  });
});

describe('datesAreAmbiguous', () => {
  it('is true when every date could be read either way', async () => {
    const csv = CSV.replace('12/03/2025', '05/03/2025').replace('13/03/2025', '06/03/2025');
    const [section] = readSections(await loadFile(1, 's.csv', encode(csv)), SETTINGS);

    expect(datesAreAmbiguous(section as never)).toBe(true);
  });

  it('is false once one date settles it', async () => {
    const [section] = readSections(await loadFile(1, 's.csv', encode(CSV)), SETTINGS);

    expect(datesAreAmbiguous(section as never)).toBe(false);
  });
});
