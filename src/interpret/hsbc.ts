import type { Table } from '../extract/types.js';

import { findHeader } from './header.js';
import type { ColumnMap } from './header.js';
import { parseAmount, parseStatementDate } from './values.js';
import type { DateOrder } from './values.js';

type HistoryRow = {
  postingDate: string;
  transactionDate: string;
  description: string;
  amount: number;
};

type History = {
  header: { index: number; map: ColumnMap };
  rows: Map<number, HistoryRow>;
};

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const CARD = /••••\s+••••\s+••••\s+\d{4}\s*$/u;
const DESCRIPTION =
  /^([\s\S]*\S)\s+(\d{2}\/\d{2}\/\d{4})\s+••••\s+••••\s+••••\s+\d{4}\s*$/u;
const AMOUNT =
  /^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})\.\d{2}$/;
const SUMMARY = [
  /^(opening|closing|previous) balance\b/i,
  /^(statement (date|summary)|account summary|reward points|rewards summary)\b/i,
  /^emi (details|schedule)\b/i,
  /^(payment due date|minimum (amount |payment )?due)\b/i,
  /^total (amount due|purchases|payments|debits|credits)\b/i,
];

function unsupported(index: number, reason: string): Error {
  return new Error(
    `HSBC transaction history: row ${index + 1} ${reason}. ` +
      'Refusing to import a potentially incomplete or unsupported layout.',
  );
}

function isHistoryHeader(row: string[]): boolean {
  const map = findHeader([row])?.map;
  return (
    row.length === 3 && map?.date === 0 &&
    map.description === 1 && map.amount === 2
  );
}

/** The verified HSBC CSV carries signed amounts and a dated, masked-card suffix. */
export function readHsbcHistory(
  table: Table,
  dateOrder: DateOrder = 'dmy',
): History | null {
  if (
    table.source.format !== 'csv' ||
    !table.rows.some(row =>
      row.length === 3 && DATE.test((row[0] ?? '').trim()) &&
      CARD.test(row[1] ?? ''),
    )
  ) {
    return null;
  }

  const rows = new Map<number, HistoryRow>();
  let headerIndex = -1;

  for (const [index, row] of table.rows.entries()) {
    if (row.every(cell => !cell.trim())) {
      continue;
    }
    if (isHistoryHeader(row)) {
      if (!rows.size && headerIndex < 0) {
        headerIndex = index;
      }
      continue;
    }

    if (row.length !== 3) {
      throw unsupported(index, 'must have exactly three columns');
    }
    const dateText = (row[0] ?? '').trim();
    const postingDate = DATE.test(dateText)
      ? parseStatementDate(dateText, dateOrder) : null;
    if (!postingDate) {
      throw unsupported(index, 'has no valid posting date');
    }

    const match = DESCRIPTION.exec(row[1] ?? '');
    const transactionDate = match?.[2]
      ? parseStatementDate(match[2], dateOrder) : null;
    if (!match || !transactionDate) {
      throw unsupported(
        index, 'has no valid description, transaction date and masked card suffix',
      );
    }
    const description = match[1] ?? '';
    if (SUMMARY.some(pattern =>
      pattern.test(description.trim().replace(/\s+/g, ' ')))) {
      throw unsupported(index, 'contains unsupported summary or schedule data');
    }

    const amountText = (row[2] ?? '').trim();
    const amount = AMOUNT.test(amountText) ? parseAmount(amountText) : null;
    if (
      amount === null || amount === 0 ||
      !Number.isSafeInteger(Math.round(amount * 100))
    ) {
      throw unsupported(
        index, 'must have a nonzero signed amount with two decimal places',
      );
    }

    rows.set(index, {
      postingDate,
      transactionDate,
      description,
      amount,
    });
  }

  return {
    header: { index: headerIndex, map: { date: 0, description: 1, amount: 2 } },
    rows,
  };
}
