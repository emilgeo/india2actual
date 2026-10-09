import type { Table } from './extract/types.js';
import type { Interpreted } from './interpret/rows.js';
import { roleForHeader } from './interpret/synonyms.js';
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
};

/** Rows shown after the header, and skipped rows shown. */
const SAMPLE_ROWS = 8;
const SAMPLE_SKIPPED = 3;

/** Longest cell shown, so a long narration cannot dominate the report. */
const MAX_CELL = 24;

/** Longest column label shown as written. */
const MAX_LABEL = 40;

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
 * Letters become `x` and digits `9`, keeping punctuation and spacing.
 * Combining marks are dropped, since vowel signs in Indic scripts are not
 * letters and would otherwise pass through as written.
 */
export function maskText(text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\p{M}/gu, '')
    .replace(/\p{L}/gu, 'x')
    .replace(/\p{N}/gu, '9');
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

function describeSection(section: ReportSection): string[] {
  const { table, result, checks } = section;
  const { header, transactions, skipped } = result;
  const headerRow = table.rows[header.index] ?? [];

  const lines = [
    `Section ${section.number}`,
    `Rows extracted: ${table.rows.length}, cells ${cellCounts(table.rows)}`,
    `Account number found near the title: ${section.account ? 'yes' : 'no'}`,
    `Header: row ${header.index + 1}, columns ${Object.entries(header.map)
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
    'Letters are shown as x and digits as 9. Only column labels are ' +
      'written out. The length of text and the size of amounts stay visible.',
    '',
    `File: ${input.format}${first?.source.part ? `, ${first.source.part}` : ''}`,
    `Tables found: ${tables.length}, read as transactions: ${sections.length}`,
  ];

  if (!sections.length) {
    const rows = tables.flatMap(table => table.rows);
    lines.push(
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
