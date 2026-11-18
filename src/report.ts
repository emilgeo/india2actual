import type { LayoutLine, PdfLayout } from './extract/pdf.js';
import type { Table } from './extract/types.js';
import type { Interpreted } from './interpret/rows.js';
import { roleForHeader } from './interpret/synonyms.js';
import { diagnoseBalance, ranges } from './report-diagnosis.js';
import type { Validation } from './interpret/validate.js';

export type ReportSection = {
  number: number;
  /** Whether an account number was found near the table's title. */
  account?: string;
  table: Table;
  result: Interpreted;
  checks: Array<{ name: string; validation: Validation }>;
};

export type ReportInput = {
  version: string;
  /** What ran it, for example `Node 24.1.0` or `browser`. */
  runtime: string;
  /** What the file was detected as, for example `PDF`. */
  format: string;
  /** Every table found, including any that are not a transaction table. */
  tables: Table[];
  /** The tables that read as transactions, joined where one continues on. */
  sections: ReportSection[];
  /** What a PDF's text looked like, when the file was a PDF. */
  layout?: PdfLayout;
};

/** Rows shown after the header, and skipped rows shown. */
const SAMPLE_ROWS = 8;
const SAMPLE_SKIPPED = 3;

/** Longest cell shown, so a long narration cannot dominate the report. */
const MAX_CELL = 24;

/** Longest column label shown as written. */
const MAX_LABEL = 40;

/** Pages listed one by one, and the longest sample line. */
const MAX_PAGES = 40;
const MAX_SAMPLE_LINE = 160;

/** A column label is only ever a few words, unlike prose that mentions one. */
const LABEL = /^[\p{L}][\p{L} .\/&()'-]{0,29}$/u;

/**
 * Words that appear in column headings and mean nothing about a person.
 * Deliberately short and without anything a payee or a charge would be named.
 */
const HEADING_WORDS = new Set(
  (
    'date time and transaction details detail narration particulars ' +
    'description amount debit credit balance opening closing total deposit ' +
    'deposits withdrawal withdrawals mode type cumulative cheque chq ref ' +
    'reference no number value dr cr inr rs of on for the to from period ' +
    'account statement summary savings current'
  ).split(' '),
);

/**
 * Words that name how a payment was made and mean nothing about a person.
 * Whole words only. Deliberately without short or ordinary words (`si`, `ft`,
 * `na`, `paid`, `pay`) that can be part of a name or sit beside one.
 */
export const PAYMENT_WORDS: ReadonlySet<string> = new Set(
  (
    'upi upiout upiin neft imps mmt inft rtgs pos ecom vps vin ach nach ecs ' +
    'atm atw nwd awb cwdr p2a p2m p2p atd fto fti ifi impstxn txn trf ref refno'
  ).split(' '),
);

/**
 * Letters become `x` and digits `9`, keeping plain punctuation, spacing and
 * the whole words in `PAYMENT_WORDS`.
 * Combining marks are dropped, since vowel signs in Indic scripts are not
 * letters and would otherwise pass through as written.
 */
export function maskText(text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\p{M}/gu, '')
    .replace(/([\p{L}\p{N}]+)|([^\p{L}\p{N}])/gu, (_, run?: string, other?: string) => {
      if (run) {
        return PAYMENT_WORDS.has(run.toLowerCase())
          ? run
          : run.replace(/\p{L}/gu, 'x').replace(/\p{N}/gu, '9');
      }
      // Anything that is not plain punctuation (private-use glyphs from a font
      // with no text mapping, enclosed letters) could be a letter in disguise.
      return /[\s\-/:.,@()&_+'*#%;|\u20B9=<>!?[\]{}"~^$\\]/u.test(other ?? '') ? (other as string) : 'x';
    });
}

function maskCell(cell: string): string {
  const masked = maskText(cell);
  return masked.length > MAX_CELL ? `${masked.slice(0, MAX_CELL)}...` : masked;
}

function clean(cell: string): string {
  return cell.replace(/\s+/gu, ' ').trim();
}

/** Is this cell a column label, made only of heading words or a known role? */
function isLabel(cell: string): boolean {
  const text = clean(cell);
  if (!text || text.length > MAX_LABEL || /\d/u.test(text)) {
    return false;
  }
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const known = words.length > 0 && words.every(word => HEADING_WORDS.has(word));
  return known || (LABEL.test(text) && roleForHeader(text) !== null);
}

/** A label is shown as written, anything else is masked. */
function describeCell(cell: string): string {
  return isLabel(cell) ? clean(cell) : maskCell(cell);
}

/**
 * A single cell that looks like a label may be a payee ("Dr ..." reads as a
 * debit column), so only a row with two or more is treated as a header.
 */
function maskRow(row: string[]): string {
  const header = row.filter(isLabel).length >= 2;
  return row.map(header ? describeCell : maskCell).join(' | ');
}

function cellCounts(rows: string[][]): string {
  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  }
  const [common] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const widths = [...counts.keys()];
  const range =
    widths.length > 1
      ? `, range ${Math.min(...widths)}-${Math.max(...widths)}`
      : '';
  return common ? `${common[0]} per row most often${range}` : 'none';
}

function countBy<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return (
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}=${count}`)
      .join(', ') || 'none'
  );
}

/** Only words from the heading list, never a prefix match, since a name can begin with a column word. */
function isHeadingWords(text: string): boolean {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > MAX_LABEL || /\p{N}/u.test(clean) || !LABEL.test(clean)) {
    return false;
  }
  const words = clean.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.length > 0 && words.every(word => HEADING_WORDS.has(word));
}

/** Words are written out only in a heading line, never in the rows of the sample. */
function sampleLine(line: LayoutLine, allowWords: boolean): string {
  const text = line.items
    .map(item => {
      const shown = allowWords && isHeadingWords(item.text)
        ? item.text.replace(/\s+/gu, ' ').trim()
        : maskCell(item.text);
      return `x=${Math.round(item.x / 5) * 5} ${shown}`;
    })
    .join(' | ');
  return text.length > MAX_SAMPLE_LINE ? `${text.slice(0, MAX_SAMPLE_LINE)}...` : text;
}

/** `none` when no table was read as transactions, so any dated rows are worth showing. */
function describeLayout(layout: PdfLayout, noneRead: boolean): string[] {
  const sampled = noneRead && layout.all;
  const out = ['PDF text, one line per page:'];
  for (const page of layout.pages.slice(0, MAX_PAGES)) {
    out.push(
      `  page ${page.page}: ${page.items} text items, ${page.lines} lines, ` +
        `${page.dateLines} date-led, ${page.amountLines} with two or more amounts, ` +
        `in a table: ${page.inTable ? 'yes' : 'no'}`,
    );
  }
  if (layout.pages.length > MAX_PAGES) {
    out.push(`  and ${layout.pages.length - MAX_PAGES} more pages`);
  }
  const empty = layout.pages.filter(page => page.items === 0).map(page => page.page);
  if (empty.length) {
    out.push(
      `Pages without a text layer: ${ranges(empty)} ` +
        '(probably scanned images, which this tool cannot read)',
    );
  }

  const sample = sampled ? layout.all : layout.window.length
    ? { windowPage: layout.windowPage ?? 0, window: layout.window, above: layout.above }
    : undefined;
  if (sample?.window.length) {
    const heading: LayoutLine[] = [];
    for (const line of [...sample.above].reverse()) {
      if (line.dateLed || !line.items.every(item => isHeadingWords(item.text))) {
        break;
      }
      heading.unshift(line);
    }
    out.push(
      '',
      `Text positions on page ${sample.windowPage || '?'}, ${
        sampled ? 'the first dated rows' : 'the first dated rows no table took'
      } ` +
        '(positions rounded to 5, text masked):',
      ...heading.map(line => `  ${sampleLine(line, true)}`),
      ...sample.window.map(line => `  ${sampleLine(line, false)}`),
    );
  }
  return out;
}

function describeSection(section: ReportSection): string[] {
  const { table, result, checks } = section;
  const { header, transactions, skipped } = result;
  const headerRow = table.rows[header.index] ?? [];
  const headerLocation = header.index < 0
    ? 'absent (layout detected)'
    : `row ${header.index + 1}`;

  const lines = [
    `Section ${section.number}`,
    `Rows extracted: ${table.rows.length}, cells ${cellCounts(table.rows)}`,
    `Account number found near the title: ${section.account ? 'yes' : 'no'}`,
    `Header: ${headerLocation}, columns ${Object.entries(header.map)
      .map(([role, column]) => `${role}=${column}`)
      .join(', ')}`,
    `Header cells: ${headerRow.map(describeCell).join(' | ')}`,
    `Credit card statement: ${result.card ? 'yes' : 'no'}`,
    `Parsed ${transactions.length} transaction(s), skipped ${skipped.length} row(s)` +
      (skipped.length ? ` (${countBy(skipped, row => row.reason)})` : ''),
    `Narration kinds: ${countBy(transactions, row => row.kind)}`,
    `Payee left as the raw narration: ${
      transactions.filter(row => row.payee === row.raw).length
    } of ${transactions.length}`,
    `Non-unique references discarded: ${result.droppedRefs}`,
    `Printed totals found in the table: ${table.totals?.length ?? 0}`,
  ];

  for (const { name, validation } of checks) {
    lines.push(
      `${name}: ${validation.status}` +
        (validation.status === 'skipped'
          ? ''
          : ` (${validation.matched}/${validation.checked} agree)`),
    );
  }

  const balance = checks.find(check => check.name === 'Balance check');
  if (!result.card && balance?.validation.status === 'failed') {
    lines.push('', ...diagnoseBalance(transactions, skipped));
  }

  lines.push(
    '',
    'Rows around the header, masked:',
    ...table.rows
      .slice(Math.max(0, header.index - 1), header.index + 1 + SAMPLE_ROWS)
      .map(row => `  ${maskRow(row)}`),
  );

  if (skipped.length) {
    lines.push(
      '',
      'Skipped rows, masked:',
      ...skipped
        .slice(0, SAMPLE_SKIPPED)
        .map(row => `  ${row.reason}: ${maskRow(row.row)}`),
    );
  }

  return lines;
}

/**
 * A plain-text report about how a statement was read, safe to paste into a
 * public issue. It carries structure and counts only: text is masked, validation
 * issues are left out because they quote amounts and dates, account numbers are
 * reduced to whether one was found, and nothing from a PDF's preamble is shown.
 */
export function buildReport(input: ReportInput): string {
  const { tables, sections } = input;
  const [first] = tables;
  const lines: string[] = [
    `india2actual ${input.version} layout report (${input.runtime})`,
    'Letters are shown as x and digits as 9. Only column labels and payment ' +
      'types such as UPI or NEFT are written out. The length of text and the ' +
      'size of amounts stay visible.',
    '',
    `File: ${input.format}${first?.source.part ? `, ${first.source.part}` : ''}`,
    `Tables found: ${tables.length}, read as transactions: ${sections.length}`,
  ];

  if (input.layout) {
    lines.push('', ...describeLayout(input.layout, sections.length === 0));
  }

  if (!sections.length) {
    const rows = tables.flatMap(table => table.rows);
    lines.push(
      ...(input.layout ? [''] : []),
      `Rows extracted: ${rows.length}, cells ${cellCounts(rows)}`,
      'Header: no transaction table found',
      '',
      'First rows, masked:',
      ...(first?.rows ?? [])
        .slice(0, SAMPLE_ROWS + 2)
        .map(row => `  ${maskRow(row)}`),
    );
    return `${lines.join('\n')}\n`;
  }

  for (const section of sections) {
    lines.push('', ...describeSection(section));
  }

  return `${lines.join('\n')}\n`;
}
