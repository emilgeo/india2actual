#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { argv, cwd, env, exit, stderr, stdout, versions } from 'node:process';

import { loadEnvironmentFile, setting } from './env-file.js';
import { describeFormat, extractTable } from './extract/index.js';
import {
  interpretConvertedOutput,
  isConvertedOutput,
} from './interpret/roundtrip.js';
import { interpretTable } from './interpret/rows.js';
import {
  validateBalances,
  validateCardTotals,
} from './interpret/validate.js';
import type { DateOrder } from './interpret/values.js';
import { loadMerchantRules } from './merchants-file.js';
import type { MerchantRule } from './narration/merchants.js';
import { toCsv, writeCsv } from './out/csv.js';
import { nodeTooOldForPush, pushTransactions } from './out/push.js';
import type { PushConfig } from './out/push.js';
import { buildReport } from './report.js';

const USAGE = `
india2actual: convert Indian bank statements for Actual Budget

Usage:
  india2actual <statement-file> [options]

Options:
  --out <path>          Where to write the normalised CSV.
                        Default: <input>.actual.csv next to the input file.
  --stdout              Write the CSV to stdout instead of a file.
  --date-order <order>  dmy (default), mdy or ymd. Only affects all-numeric
                        dates, where 01/02/2024 is genuinely ambiguous.
  --delimiter <char>    Force the CSV delimiter instead of detecting it.
  --merchants <path>    JSON file of { pattern, name } merchant rules, which
                        take precedence over the built-in map.
  --card                Read the file as a credit card statement. Normally
                        detected from the statement itself.
  --env-file <path>     Read settings from this file instead of ./.env.
  --force               Write the CSV even if the balance check fails.
  --debug-layout        Print a report on how the file was read, with all text
                        masked so it is safe to paste into an issue, and write
                        nothing.
  --quiet               Only report problems.
  --help, -h            Show this message.
  --version, -v         Show the installed version.

Pushing straight into Actual (instead of writing a CSV):
  --push                Send the transactions to Actual via its API.
  --account <name|id>   Which Actual account to import into. Required for --push.
  --dry-run             With --push, report what would change without writing.
  --transfer-to <acct>  With --push, send card payments as transfers with this
                        account (the card for a bank statement, the bank for a
                        card statement), so they are not counted twice.

Settings come from a .env file in the current directory, or from real
environment variables, which take precedence. Never from flags, which would
end up in your shell history. Copy .env.example to .env to get started.

    ACTUAL_SERVER_URL           e.g. https://actual.example.com
    ACTUAL_PASSWORD             your Actual server password
    ACTUAL_SYNC_ID              the budget's sync id (Settings > Advanced)
    ACTUAL_ENCRYPTION_PASSWORD  only if the budget file is encrypted
    ACTUAL_DATA_DIR             local cache dir (default: ./.actual-cache)
    STATEMENT_PASSWORD          password for an encrypted statement PDF
                                (not the same as ACTUAL_PASSWORD)

Input is detected by content, not by extension, because banks routinely name
HTML tables ".xls". Supported: CSV/TSV, Excel .xlsx, HTML tables, Excel 2003
XML, and PDF (including password-protected). Legacy binary .xls must be
re-saved as .xlsx or .csv first.
`.trim();

type Options = {
  input: string;
  out?: string;
  useStdout: boolean;
  dateOrder: DateOrder;
  delimiter?: string;
  merchants?: string;
  card: boolean;
  debugLayout: boolean;
  force: boolean;
  quiet: boolean;
  push: boolean;
  account?: string;
  dryRun: boolean;
  transferTo?: string;
  envFile?: string;
};

function parseArgs(args: string[]): Options | null {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    return null;
  }

  const options: Options = {
    input: '',
    useStdout: false,
    dateOrder: 'dmy',
    force: false,
    quiet: false,
    card: false,
    debugLayout: false,
    push: false,
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case '--out':
        options.out = next();
        break;
      case '--stdout':
        options.useStdout = true;
        break;
      case '--date-order': {
        const value = next();
        if (value !== 'dmy' && value !== 'mdy' && value !== 'ymd') {
          throw new Error('--date-order must be dmy, mdy or ymd');
        }
        options.dateOrder = value;
        break;
      }
      case '--delimiter':
        options.delimiter = next();
        break;
      case '--merchants':
        options.merchants = next();
        break;
      case '--card':
        options.card = true;
        break;
      case '--env-file':
        options.envFile = next();
        break;
      case '--push':
        options.push = true;
        break;
      case '--account':
        options.account = next();
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--transfer-to':
        options.transferTo = next();
        break;
      case '--debug-layout':
        options.debugLayout = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--quiet':
        options.quiet = true;
        break;
      default:
        if (arg === undefined || arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (options.input) {
          throw new Error('Only one input file at a time');
        }
        options.input = arg;
    }
  }

  if (!options.input) {
    throw new Error('No input file given');
  }

  if (options.push && !options.account) {
    throw new Error('--push also needs --account <name|id>');
  }

  if (options.debugLayout && options.push) {
    throw new Error('--debug-layout cannot be combined with --push');
  }

  if (options.dryRun && !options.push) {
    throw new Error('--dry-run only applies to --push');
  }

  if (options.transferTo && !options.push) {
    throw new Error('--transfer-to only applies to --push');
  }

  return options;
}

function defaultOutPath(input: string): string {
  const extension = extname(input);
  const name = basename(input, extension);
  return join(dirname(input), `${name}.actual.csv`);
}

function packageVersion(): string {
  // Resolves to the package root from both src/ and dist/.
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

async function run(args: string[]): Promise<number> {
  if (args.includes('--version') || args.includes('-v')) {
    stdout.write(`${packageVersion()}\n`);
    return 0;
  }

  const options = parseArgs(args);
  if (!options) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const log = (message: string) => {
    if (!options.quiet) {
      stderr.write(`${message}\n`);
    }
  };

  // Before anything reads the environment. Both the statement password and the
  // Actual credentials can come from here.
  const envFile = loadEnvironmentFile(options.envFile ?? join(cwd(), '.env'));
  if (envFile.loaded) {
    log(`Loaded environment from ${envFile.path}`);
  } else if (options.envFile) {
    // Explicitly asked for, so silence would be wrong.
    throw new Error(`${options.envFile} does not exist`);
  }

  let merchantRules: MerchantRule[] = [];
  if (options.merchants) {
    merchantRules = await loadMerchantRules(options.merchants);
    log(
      `Loaded ${merchantRules.length} merchant rule(s) from ${options.merchants}`,
    );
  }

  // Resolved before any parsing work so a missing credential or account fails
  // immediately rather than after processing the whole statement.
  const pushConfig = options.push ? pushConfigFromEnv(options) : null;

  // From .env or the environment, never a flag, so it stays out of shell
  // history.
  const pdfPassword = setting('STATEMENT_PASSWORD');

  const { table, format } = await extractTable(options.input, {
    ...(options.delimiter ? { delimiter: options.delimiter } : {}),
    ...(pdfPassword ? { password: pdfPassword } : {}),
  });
  log(`Read ${options.input} as ${describeFormat(format)}`);

  if (options.debugLayout) {
    const interpreted = interpretTable(table, {
      dateOrder: options.dateOrder,
      ...(options.card ? { card: true } : {}),
      ...(merchantRules.length ? { merchantRules } : {}),
    });
    stdout.write(
      buildReport({
        version: packageVersion(),
        node: versions.node,
        format: describeFormat(format),
        table,
        result: interpreted,
        validation: interpreted
          ? interpreted.card
            ? validateCardTotals(interpreted.transactions, table.figures)
            : validateBalances(interpreted.transactions)
          : null,
        checkName: interpreted?.card ? 'Statement totals check' : 'Balance check',
      }),
    );
    return 0;
  }

  // Our own output is passed through rather than re-parsed, so that payees
  // corrected by hand in the CSV survive.
  const converted = isConvertedOutput(table);
  if (converted) {
    log(
      'Recognised this as already-converted output: payees kept as-is, ' +
        'narrations kept in Notes.',
    );
  }

  const result = converted
    ? interpretConvertedOutput(table)
    : interpretTable(table, {
        dateOrder: options.dateOrder,
        ...(options.card ? { card: true } : {}),
        ...(merchantRules.length ? { merchantRules } : {}),
      });

  if (!result) {
    stderr.write(
      'Could not find a transaction table in this file.\n' +
        'Expected columns resembling: Date, Narration/Particulars, ' +
        'Withdrawal/Debit, Deposit/Credit, Balance.\n',
    );
    return 1;
  }

  const { transactions, skipped, header, droppedRefs, card } = result;

  if (card) {
    log(
      'Read as a credit card statement: purchases are money out, ' +
        'payments and credits are money in.',
    );
  }

  log(
    `Header on row ${header.index + 1}; columns: ${Object.entries(header.map)
      .map(([role, column]) => `${role}=${column}`)
      .join(', ')}`,
  );
  log(
    `Parsed ${transactions.length} transaction(s), skipped ${skipped.length} row(s)`,
  );

  if (droppedRefs) {
    log(
      `Discarded ${droppedRefs} non-unique reference(s); those rows will rely ` +
        `on Actual's date and amount matching instead.`,
    );
  }

  if (!transactions.length) {
    stderr.write('No transactions were parsed, nothing to write.\n');
    return 1;
  }

  // The balance column, or a card's printed totals, is the only independent
  // check that the parse is right, so a failure blocks the write unless
  // explicitly overridden.
  const validation = card
    ? validateCardTotals(transactions, table.figures)
    : validateBalances(transactions);
  const checkName = card ? 'Statement totals check' : 'Balance check';
  const unit = card ? 'totals' : 'rows';

  if (validation.status === 'failed') {
    stderr.write(
      `${checkName} FAILED (${validation.matched}/${validation.checked} ${unit} agree).\n`,
    );
    for (const issue of validation.issues) {
      stderr.write(`  ${issue}\n`);
    }
    if (!options.force) {
      stderr.write(
        'Refusing to write a statement that does not reconcile. ' +
          'Re-run with --force to write it anyway.\n',
      );
      return 2;
    }
    stderr.write('Writing anyway because --force was given.\n');
  } else if (validation.status === 'passed') {
    log(
      `${checkName} passed (${validation.matched}/${validation.checked} ${unit}` +
        `${validation.order ? `, ${validation.order} order` : ''}).`,
    );
  } else {
    log(`${checkName} skipped: ${validation.issues[0] ?? 'no balance data'}`);
    if (converted) {
      // Said plainly, because it is the one real cost of the round trip: the
      // CSV carries no balance column, so these amounts are not independently
      // verified here. They were when the CSV was produced.
      log(
        'Converted output carries no balance column, so this run cannot ' +
          're-verify the amounts. Check the balance line from the run that ' +
          'produced this CSV.',
      );
    }
  }

  if (pushConfig) {
    const result = await pushTransactions(transactions, pushConfig);

    const verb = result.dryRun ? 'would add' : 'added';
    const alsoVerb = result.dryRun ? 'would update' : 'updated';
    stderr.write(
      `${result.dryRun ? '[dry run] ' : ''}${result.accountName}: ` +
        `${verb} ${result.added}, ${alsoVerb} ${result.updated}.\n`,
    );

    if (result.transfer) {
      const { accountName, sent, unlinked } = result.transfer;
      stderr.write(
        `  ${sent} card payment(s) ${result.dryRun ? 'would be ' : ''}sent as ` +
          `transfers with ${accountName}.\n`,
      );
      if (unlinked.length) {
        stderr.write(
          `  ${unlinked.length} payment(s) imported as ordinary transactions ` +
            `because ${accountName} already has a matching ordinary ` +
            `transaction (${unlinked.map(row => `${row.date} ${row.amount.toFixed(2)}`).join(', ')}). ` +
            'Link each pair in Actual so the payment is not counted twice.\n',
        );
      }
    }

    for (const error of result.errors) {
      stderr.write(`  error: ${error}\n`);
    }

    return result.errors.length ? 1 : 0;
  }

  if (options.useStdout) {
    stdout.write(toCsv(transactions));
    return 0;
  }

  const outPath = options.out ?? defaultOutPath(options.input);
  await writeCsv(outPath, transactions);
  log(`Wrote ${outPath}`);

  return 0;
}

/**
 * Build the push configuration from the environment.
 *
 * Credentials are read from the environment rather than accepted as flags so
 * they do not end up in shell history or process listings.
 */
function pushConfigFromEnv(options: Options): PushConfig {
  if (nodeTooOldForPush(versions.node)) {
    throw new Error(
      `--push needs Node 22.14 or newer, but this is Node ${versions.node}. ` +
        'Older versions crash when the Actual API loads. Upgrade Node, or ' +
        'convert to CSV and import that instead.',
    );
  }

  if (!options.account) {
    throw new Error('--push also needs --account <name|id>');
  }

  const missing = (
    ['ACTUAL_SERVER_URL', 'ACTUAL_PASSWORD', 'ACTUAL_SYNC_ID'] as const
  ).filter(name => !setting(name));
  if (missing.length) {
    throw new Error(
      `--push needs these settings: ${missing.join(', ')}\n` +
        'Set them in .env or in the environment. See --help for the full list.',
    );
  }

  const encryptionPassword = setting('ACTUAL_ENCRYPTION_PASSWORD');

  return {
    serverURL: setting('ACTUAL_SERVER_URL') as string,
    password: setting('ACTUAL_PASSWORD') as string,
    syncId: setting('ACTUAL_SYNC_ID') as string,
    dataDir: setting('ACTUAL_DATA_DIR') ?? join(cwd(), '.actual-cache'),
    account: options.account,
    dryRun: options.dryRun,
    ...(options.transferTo ? { transferTo: options.transferTo } : {}),
    ...(encryptionPassword ? { encryptionPassword } : {}),
  };
}

run(argv.slice(2))
  .then(code => exit(code))
  .catch((error: unknown) => {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  });
