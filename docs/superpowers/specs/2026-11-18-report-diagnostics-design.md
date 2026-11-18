# Layout report diagnostics

Status: approved to build by the maintainer (2026-11-18). Revised after a higher-model design review.

## Intent and why

When a statement fails to read, the masked layout report is what a tester sends
back, and the maintainer fixes the parser from it. Four reports from friends'
statements (a 41-page PDF, two PDFs with no table found, one CSV) showed that
the report says how far the file got but not why it stopped:

- **Balance check failed** (2 of 4): the report gives matched/checked counts
  only. It cannot say whether the signs are flipped, rows are out of order, or
  a column is misread.
- **No transaction table found** (2 of 4): the report shows one summary row, or
  nothing. It cannot say whether the PDF has a text layer at all, or what the
  unrecognised pages look like.

The goal is a report that lets the maintainer tell, from one paste, which of
those it is, without anyone sharing a statement.

## Goals

- After a failed balance check, the report states which kind of mismatch it is
  and where (row positions), from counts and relations, never values.
- For a PDF, the report states whether each page has a text layer and how many
  lines look like transaction rows, so "scanned" and "no table recognised" are
  distinguishable.
- For a PDF where no table was recognised, or where pages were left out, the
  report shows a small masked sample of the text lines with their column
  positions, so the maintainer can see the layout the band logic faced.
- Each new part is covered by a test that planted real-looking values cannot
  appear in the report.

## Non-goals

- No change to what is read, converted, checked or written. Import behaviour,
  the balance check and its result stay as they are.
- No new parsing support for any bank in this work. This only makes the next
  fix possible.
- No change to the existing masking of payment-type words (`UPI`, `NEFT`, ...).
  Showing them is a separate, later decision.
- No OCR, no support for scanned PDFs.

## Anti-goals (a failure even if it works)

- Any letter or digit from the statement appearing in the report outside the
  closed list of column-heading words, other than counts and positions.
- A report that reads as a pass when the check failed.
- The report path slowing or breaking a normal import.
- A "titles, addresses and footers never appear" claim that is not enforced by
  construction.

## Constraints

- The report is only built on request (`--debug-layout`, the "Copy a masked
  report" button). A normal conversion never calls it.
- `src/report.ts` and anything it imports must stay free of Node APIs, because
  the web page bundles it.
- Where the report needs data the parser already has but does not expose (the
  PDF text lines), the change to extraction must be purely additive: a new
  function computes the summary from the same lines; the tables produced stay
  identical by construction and the existing extraction tests pass untouched.
- No real statement data in tests or fixtures; every value invented
  (CLAUDE.md). Tests build `Line[]` and `StatementTransaction[]` by hand.
- Public repo: no personal data in docs, comments or commit messages.

## Approaches considered

- **A. Extend the report with computed diagnoses and a PDF section (chosen).**
  The balance diagnosis is computed in the report from the parsed transactions
  and the validation order. The PDF section is computed from the text lines,
  which extraction hands back only when asked.
- **B. Put the diagnosis inside the validator** and have it return a richer
  result. Rejected: it changes the code path every import takes, and a
  diagnosis is only needed when asked.
- **C. Ask testers for more (a screenshot, a hand-redacted file).** Rejected:
  hand redaction of PDFs is unreliable and screenshots show no geometry.

## Design

**1. Balance diagnosis** (a new part of a section, shown only for the running
balance check of a non-card section that failed; card totals checks and printed
totals checks get none). Computed in a new pure module from the parsed
transactions, the check's `order`, and the skipped rows; the validator is not
changed.

- Pairs are built exactly as `validateBalances` builds them: adjacent rows of the
  transactions that carry a balance. The row blamed in a failing pair follows the
  validator (the later row when ascending, the earlier when descending). Positions
  are printed as 1-based ordinals in the full transaction list, capped at a fixed
  count then summarised, merged into ranges.
- If the two orders tie, the report says the order is undetermined and uses
  ascending for the relations.
- Printed, all as counts or yes/no, never values:
  - whether the balance change from the first to the last balanced row equals the
    sum of the parsed amounts between (yes means the totals hold and the problem
    is ordering; no means a sign, a missing row or a misread);
  - per failing pair, the relation, first match wins in this order: balance did
    not move; sign flipped (split into rows parsed as debits and as credits);
    change equals the sum of the amounts since the previous balanced row (rows
    without a balance in between); change equals plus or minus the amount of an
    adjacent row, or plus or minus the sum of this and an adjacent row's amounts
    (the signature of a swapped pair); none of these;
  - the number of failure runs and the longest run (one run of many means a
    systematic fault; many runs of one means scattered rows);
  - how many failing rows share their date with the neighbouring row;
  - whole-file hypotheses, each scored in both orders with the better kept:
    every sign opposite; balances read as absolute values; amounts equal to the
    balance (a misread column), as a count of rows;
  - skipped rows that contain an amount-shaped cell.

**2. PDF layout summary.** Computed inside `src/extract/pdf.ts` from the same
`Line[]` and page count that `tablesFromLines` already receives, as a pure
function that does not touch them. Returned next to the tables by a new function
that `extractPdf` wraps, so the tables are identical by construction. It holds:

- per page: text item count (so a page with no text layer shows as zero, even
  though it has no lines), line count, lines that are date-led by the same rule
  `splitSections` uses, lines with two or more amount-shaped items, and whether
  any of the page's date-led lines belong to a recognised table section;
- a geometry window (below), as raw lines, chosen here because it needs the
  private helpers; the report masks it.

The CLI debug path and the web page both receive the summary with the tables;
the web keeps it with the loaded file, so an encrypted PDF needs no re-read.
A normal import ignores it.

**3. PDF geometry sample** (shown when no table was recognised, or some page has
date-led lines outside every recognised section). The window is anchored on the
first such page that has at least three lines which are both date-led and carry
two or more amount-shaped items. It starts at the first of those lines, ends at
the last of them on the same page, never crosses a page, and is capped at ten
lines. Up to two lines immediately above it are added only if every word in
them is in the closed heading list (so no name, address or title can be added).
Each item prints its left edge rounded to 5 pt and the item masked by the
existing rule (letters `x`, digits `9`, punctuation and spacing kept). An item
is written as it is only if it is on a line that is not date-led and every word
in it is in `HEADING_WORDS`; the role-prefix branch (`roleForHeader`) is not
used, because it would pass names that begin with a column word.

**4. Report wording.** Statements that the new parts add are stated plainly:
amounts still show their size, and heading words, `Cr` and `Dr` may be written
out. The README sentence that says the report "carries no names, account numbers
or amounts" is corrected in a separate docs commit.

**5. Tests.**
- Diagnosis: hand-built transactions for each relation, an adjacent swap, a
  reversed same-day block, rows without a balance in the middle, descending
  order, a tie, a clean pass (no section), a card section and a failed printed
  totals check beside a passed balance check (no diagnosis).
- Layout summary and sample: hand-built `Line[]` for a normal table, a page with
  no text (page count larger than the pages that have lines), a summary-only
  table with transaction lines on later pages, and a preamble trap (a statement
  period line with an invented name and address directly above it).
- Privacy: invented markers (names, a reference, a VPA, amounts) with no
  three-character overlap with the report's own wording or heading words, planted
  in every input, asserting none appears, case-insensitively. A planted line of
  `Drishti`, `Creations` and `Dr` asserts all three are masked.
- No behaviour change: the layout function leaves its input unchanged (frozen
  input), and the existing extraction tests pass untouched.
- Web: the Copy report path includes the new sections (Playwright, with the
  existing PDF fixture if one exists, else covered by unit tests of the report).

**6. Docs.** README "Help test your bank" (separate `docs:` commit) and a
changelog line under Unreleased (Added).

## Left to the builder

- Exact wording and layout of the new report lines, within the rules above.
- The caps (rows listed, pages listed, lines sampled).
- The exact shape of the extraction option and how the web page keeps the lines.
- The amount-shaped pattern (one definition, used by the inventory and the sample).

## Calls made without the maintainer

- The payment-type word list is left out of this change (scope).
- Upper and lower case are not preserved in the geometry sample, keeping the
  existing `x` rule (nothing new leaks).
- The layout summary is always returned with a PDF's tables rather than behind an
  option, since it is computed from lines already in memory; this replaces an
  earlier idea of asking for it only on request, which the web page could not do
  for an encrypted PDF.
- X positions are rounded to 5 pt to blunt glyph-width inference.
