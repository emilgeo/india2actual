import { writeFile } from 'node:fs/promises';

import type { StatementTransaction } from '../interpret/rows.js';

import { toCsv } from './csv-text.js';

export { COLUMNS, toCsv } from './csv-text.js';

export async function writeCsv(
  path: string,
  transactions: StatementTransaction[],
): Promise<void> {
  await writeFile(path, toCsv(transactions), 'utf8');
}
