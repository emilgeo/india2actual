import { readFile } from 'node:fs/promises';

import { extractTablesFromBytes } from './bytes.js';
import type { ExtractOptions, Extraction } from './bytes.js';

export { describeFormat, detectFormat, extractTablesFromBytes } from './bytes.js';
export type { DetectedFormat, ExtractOptions, Extraction, Table } from './bytes.js';

/** Read a statement file into its tables. */
export async function extractTables(
  path: string,
  options: ExtractOptions = {},
): Promise<Extraction> {
  return extractTablesFromBytes(await readFile(path), path, options);
}
