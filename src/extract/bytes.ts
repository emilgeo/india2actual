import { extractPdf } from './pdf.js';
import { describeFormat, detectFormat } from './sniff.js';
import type { DetectedFormat } from './sniff.js';
import { tableFromCsv } from './csv.js';
import { tableFromHtml } from './html-table.js';
import { tableFromSpreadsheetMl } from './spreadsheetml.js';
import type { Table } from './types.js';
import { extractXlsx } from './xlsx.js';

export type ExtractOptions = {
  /** Only used for delimited text. */
  delimiter?: string;
  /** Only used for encrypted PDFs. */
  password?: string;
};

export type Extraction = {
  /** One table per account. Only a PDF can hold more than one. */
  tables: Table[];
  /** What the file turned out to be, which is often not what it is named. */
  format: DetectedFormat;
};

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * Read a statement's bytes into its tables, choosing the parser by inspecting
 * the contents rather than the extension. Free of Node APIs, so a browser can
 * use it too. `name` is only used in messages and in each table's source.
 */
export async function extractTablesFromBytes(
  bytes: Uint8Array,
  name: string,
  options: ExtractOptions = {},
): Promise<Extraction> {
  const format = detectFormat(bytes);

  switch (format) {
    case 'xlsx':
      return { tables: [await extractXlsx(bytes, name)], format };
    case 'html':
      return { tables: [tableFromHtml(text(bytes), name)], format };
    case 'spreadsheetml':
      return { tables: [tableFromSpreadsheetMl(text(bytes), name)], format };
    case 'pdf':
      return {
        tables: await extractPdf(
          bytes,
          name,
          options.password ? { password: options.password } : {},
        ),
        format,
      };
    case 'biff':
      // Legacy BIFF has no maintained, permissively licensed reader for Node,
      // and re-saving is a one-step fix, so this stays an explicit refusal
      // rather than a half-working parser.
      throw new Error(
        `${name} is a ${describeFormat(format)}, which is not supported.\n` +
          'Open it in Excel or LibreOffice and "Save As" .xlsx or .csv, then ' +
          'run this again. If your bank offers CSV through internet banking, ' +
          'that is the most reliable option.',
      );
    case 'text':
    default:
      return {
        tables: [
          tableFromCsv(
            text(bytes),
            name,
            options.delimiter ? { delimiter: options.delimiter } : {},
          ),
        ],
        format: 'text',
      };
  }
}

export { describeFormat, detectFormat };
export type { DetectedFormat, Table };
