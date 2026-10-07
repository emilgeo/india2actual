import type { Table } from './extract/types.js';
import type { Interpreted } from './interpret/rows.js';
import { roleForHeader } from './interpret/synonyms.js';
import type { Validation } from './interpret/validate.js';

export type ReportInput = {
  version: string;
  node: string;
  /** What the file was detected as, for example `PDF`. */
  format: string;
  table: Table;
  /** Null when no transaction table was found. */
  result: Interpreted | null;
  /** Null when there is no result to check. */
  validation: Validation | null;
  checkName: string;
};

/** Rows shown after the header, and skipped rows shown. */
const SAMPLE_ROWS = 8;
const SAMPLE_SKIPPED = 3;

/** Longest cell shown, so a long narration cannot dominate the report. */
const MAX_CELL = 24;

/** A column label is only ever a few words, unlike prose that mentions one. */
const LABEL = /^[\p{L}][\p{L} .\/&()'-]{0,29}$/u;

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

/**
 * A cell is shown as written only when it is a short known column label.
 * Anything else, such as a name in a preamble, is masked.
 */
function describeCell(cell: string): string {
  return isLabel(cell) ? cell.replace(/\s+/gu, ' ').trim() : maskCell(cell);
}

function isLabel(cell: string): boolean {
  const text = cell.replace(/\s+/gu, ' ').trim();
  return LABEL.test(text) && roleForHeader(text) !== null;
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

/**
 * A plain-text report about how a statement was read, safe to paste into a
 * public issue. It carries structure and counts only: text is masked, validation
 * issues are left out because they quote amounts and dates, and nothing from
 * a PDF's preamble is shown.
 */
export function buildReport(input: ReportInput): string {
  const { table, result, validation } = input;
  const lines: string[] = [
    `india2actual ${input.version} layout report (Node ${input.node})`,
    'Letters are shown as x and digits as 9. Only known column labels are ' +
      'written out. The length of text and the size of amounts stay visible.',
    '',
    `File: ${input.format}${table.source.part ? `, ${table.source.part}` : ''}`,
    `Rows extracted: ${table.rows.length}, cells ${cellCounts(table.rows)}`,
  ];

  if (!result) {
    lines.push(
      'Header: no transaction table found',
      '',
      'First rows, masked:',
      ...table.rows.slice(0, SAMPLE_ROWS + 2).map(row => `  ${maskRow(row)}`),
    );
    return `${lines.join('\n')}\n`;
  }

  const { header, transactions, skipped } = result;
  const headerRow = table.rows[header.index] ?? [];

  lines.push(
    `Header: row ${header.index + 1}, columns ${Object.entries(header.map)
      .map(([role, column]) => `${role}=${column}`)
      .join(', ')}`,
    `Header cells: ${headerRow.map(describeCell).join(' | ')}`,
    `Credit card statement: ${result.card ? 'yes' : 'no'}`,
    `Parsed ${transactions.length} transaction(s), skipped ${skipped.length} row(s)` +
      (skipped.length
        ? ` (${countBy(skipped, row => row.reason)})`
        : ''),
    `Narration kinds: ${countBy(transactions, row => row.kind)}`,
    `Payee left as the raw narration: ${
      transactions.filter(row => row.payee === row.raw).length
    } of ${transactions.length}`,
    `Non-unique references discarded: ${result.droppedRefs}`,
  );

  if (validation) {
    lines.push(
      `${input.checkName}: ${validation.status}` +
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

  return `${lines.join('\n')}\n`;
}
