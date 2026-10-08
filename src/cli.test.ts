import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { consolidatedLines } from './testing/fixtures.js';
import { pdfFromLines } from './testing/pdf.js';

const root = resolve(import.meta.dirname, '..');
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** Run the CLI from source, in a folder of its own so nothing leaks between tests. */
function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(
    process.execPath,
    ['--import', tsx, join(root, 'src/cli.ts'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ACTUAL_SERVER_URL: '',
        ACTUAL_PASSWORD: '',
        ACTUAL_SYNC_ID: '',
        STATEMENT_PASSWORD: '',
        ...env,
      },
    },
  );
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const BANK_CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '12/03/2025,UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA,725.00,,"9,275.00"',
  '13/03/2025,UPI/412345678903/9876543210@ybl/PAY,,430.00,"9,705.00"',
  '',
].join('\n');

let folder: string;
let csv: string;
let pdf: string;
let locked: string;

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'india2actual-cli-'));
  csv = join(folder, 'statement.csv');
  pdf = join(folder, 'consolidated.pdf');
  writeFileSync(csv, BANK_CSV);
  writeFileSync(pdf, pdfFromLines(consolidatedLines()));
  locked = join(folder, 'locked.pdf');
  writeFileSync(
    locked,
    pdfFromLines(consolidatedLines(), { password: 'not-a-real-password' }),
  );
});

describe('the command line', () => {
  it('prints its version', () => {
    const { code, out } = run(['--version']);

    expect(code).toBe(0);
    expect(out.trim()).toBe(
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    );
  });

  it('converts a CSV statement next to the input and checks the balance', () => {
    const { code, err } = run([csv]);

    expect(code).toBe(0);
    expect(err).toContain('Balance check passed');
    const written = readFileSync(join(folder, 'statement.actual.csv'), 'utf8');
    expect(written).toContain('Acme Store Pune');
    expect(written.trim().split('\n')).toHaveLength(3);
  });

  it('says which payees are guesses, with a rule to start from', () => {
    const { err } = run([csv]);

    expect(err).toContain('may be worth naming');
    expect(err).toContain('"pattern":"^9876543210"');
  });

  it('adds a Starting Balance row only when asked', () => {
    const out = join(folder, 'with-start.csv');

    const { code, err } = run([csv, '--starting-balance', '--out', out]);

    expect(code).toBe(0);
    expect(err).toContain('Added a Starting Balance row of 10000.00');
    expect(readFileSync(out, 'utf8')).toContain('Starting Balance');
    expect(readFileSync(join(folder, 'statement.actual.csv'), 'utf8')).not.toContain(
      'Starting Balance',
    );
  });

  it('refuses a statement whose balances do not add up, unless forced', () => {
    const broken = join(folder, 'broken.csv');
    writeFileSync(broken, BANK_CSV.replace('9,705.00', '9,000.00'));

    const refused = run([broken]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain('Balance check FAILED');
    expect(existsSync(join(folder, 'broken.actual.csv'))).toBe(false);

    const forced = run([broken, '--force']);
    expect(forced.code).toBe(0);
    expect(existsSync(join(folder, 'broken.actual.csv'))).toBe(true);
  });

  it('prints a masked layout report and writes nothing', () => {
    const { code, out } = run([csv, '--debug-layout']);

    expect(code).toBe(0);
    expect(out).toContain('layout report');
    expect(out).not.toContain('ACME');
    expect(out).not.toContain('9876543210');
  });
});

describe('a statement that holds several accounts', () => {
  it('writes one CSV per account, named by the last four digits', () => {
    const { code, err } = run([pdf]);

    expect(code).toBe(0);
    expect(err).toContain('Found 2 accounts in this statement');
    expect(readdirSync(folder)).toEqual(
      expect.arrayContaining([
        'consolidated.1111.actual.csv',
        'consolidated.2222.actual.csv',
      ]),
    );
    expect(
      readFileSync(join(folder, 'consolidated.1111.actual.csv'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(3);
  });

  it('writes only the chosen account, to the file asked for', () => {
    const out = join(folder, 'chosen.csv');

    const { code } = run([pdf, '--section', '2', '--out', out]);

    expect(code).toBe(0);
    expect(readFileSync(out, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('refuses a section that does not exist', () => {
    const { code, err } = run([pdf, '--section', '9']);

    expect(code).toBe(1);
    expect(err).toContain('--section 9 does not exist');
  });

  it('refuses one output file, stdout or a push without a section', () => {
    for (const args of [
      ['--out', join(folder, 'one.csv')],
      ['--stdout'],
    ]) {
      const { code, err } = run([pdf, ...args]);
      expect(code).toBe(1);
      expect(err).toContain('Choose one with --section');
    }

    const push = run([pdf, '--push', '--account', 'Acme Savings'], {
      ACTUAL_SERVER_URL: 'https://actual.example.test',
      ACTUAL_PASSWORD: 'not-a-real-password',
      ACTUAL_SYNC_ID: 'sync-1',
    });
    expect(push.code).toBe(1);
    expect(push.err).toContain('--push sends to one Actual account');
  });
});

describe('a password protected statement', () => {
  it('opens with the password from the environment', () => {
    const { code, err } = run([locked], {
      STATEMENT_PASSWORD: 'not-a-real-password',
    });

    expect(code).toBe(0);
    expect(err).toContain('Found 2 accounts in this statement');
  });

  it('asks for a password when there is none', () => {
    const { code, err } = run([locked]);

    expect(code).toBe(1);
    expect(err.toLowerCase()).toContain('password');
  });
});
