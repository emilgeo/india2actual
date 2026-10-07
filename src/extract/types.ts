export type SourceFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * The single boundary between extraction and interpretation.
 *
 * Every extractor (CSV, XLS/XLSX, PDF) produces this and nothing else, and
 * the interpreter never sees anything else. That is what keeps a bank's column
 * logic written once even when the same bank ships two formats.
 *
 * Cells are always strings, exactly as they appeared. Type coercion (dates,
 * amounts) belongs to interpretation, not extraction.
 */
/** An amount with the label printed over it, both exactly as they appeared. */
export type Figure = { label: string; value: string };

export type Table = {
  rows: string[][];
  /** Text above the table. Only PDFs set it: their rows start at the header. */
  preamble?: string[];
  /** Labelled amounts above the table, such as a card statement's summary. */
  figures?: Figure[];
  /**
   * Amounts printed inside the table itself: opening and closing balance rows
   * and column totals, labelled by the row and column that carry them.
   */
  totals?: Figure[];
  /**
   * Last four digits of the account number printed with this table. Set when a
   * statement holds several accounts, so that each can be told apart.
   */
  account?: string;
  source: {
    path: string;
    format: SourceFormat;
    /** Sheet name (spreadsheets) or page number (PDF), when meaningful. */
    part?: string;
  };
};
