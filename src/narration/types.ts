/**
 * The transaction families Indian banks encode into the narration/particulars
 * column. `other` covers interest postings, charges, cheques and anything else
 * we do not recognise, and it is not an error.
 */
export type NarrationKind =
  | 'upi'
  | 'neft'
  | 'imps'
  | 'rtgs'
  | 'pos'
  | 'ach'
  | 'atm'
  | 'other';

/**
 * Which link of the payee fallback chain produced the name. `vpa`, `single`,
 * `account`, `mandate` and `raw` are guesses a person may want to correct.
 */
export type PayeeSource =
  | 'merchant'
  | 'posting'
  | 'atm'
  | 'name'
  | 'vpa'
  | 'single'
  | 'account'
  | 'mandate'
  | 'raw';

export type ParsedNarration = {
  kind: NarrationKind;

  /**
   * Display payee. Guaranteed non-empty: when nothing can be extracted this
   * falls back to the raw narration, so the worst case matches what Actual
   * would have shown anyway.
   */
  merchant: string;

  /** Virtual Payment Address, e.g. `swiggy@ybl`, when present. */
  vpa?: string;

  /**
   * Bank-issued UPI reference (UTR/RRN). Only set when we are confident it is
   * genuinely per-transaction unique, because a non-unique value here would
   * make Actual collapse distinct transactions. See `extractRef`.
   */
  ref?: string;

  /** The narration exactly as the bank wrote it. */
  raw: string;

  /** Which link of the fallback chain named the payee. */
  source: PayeeSource;

  /**
   * The pattern a merchant rule would use to catch this narration and others
   * like it. Empty when the narration offers nothing stable to match on.
   */
  rule: string;
};
