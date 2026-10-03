# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `--transfer-to <account>` with `--push` sends card payments as transfers
  between the bank and card accounts, so a payment is not counted as spending
  in one and income in the other. Payments whose other side already exists as an
  ordinary transaction are imported normally and reported.
- Credit card statements that mark credits with a trailing `C` or `D` flag or a
  leading `+` are read with the right sign. A leading `C` is treated as a rupee
  sign.
- The card totals check also counts finance charges and fees printed apart from
  purchases.
- A combined `Date & Time` column is recognised as the date.

### Changed

- Uses Actual API 26.10. Its SQLite module ships prebuilt binaries, so nothing is
  compiled on install, but `--push` now needs Node 22.14 or newer. Older Node 22
  releases crash when the module loads.
- The minimum Node version is now 22.14 for the whole tool, not only `--push`.
  npm warns on older releases.

### Fixed

- `--push` on Node older than 22.14 now stops with a clear message instead of
  crashing when the Actual API loads.
- A first-time `--push` no longer fails with `ENOENT` when the local data
  directory does not exist yet.
- Excel workbooks with a notes sheet longer than the statement are read from
  the sheet that holds the transactions.
- Add supported and tested banks to README

## 0.2.0 - 2026-10-01

### Added

- Credit card statements (PDF, CSV, Excel) are recognised automatically.
  Spending is recorded as money out, and payments and refunds as money in.
  `--card` forces this when a statement is not detected.
- A card statement has no running balance, so the parsed rows are checked
  against the purchases and payments totals the statement prints. A statement
  that prints no totals is reported as unchecked.
- Card payments are named `Credit Card Payment`.

### Fixed

- Card statement tables are read correctly from PDF: footers, section titles,
  chart labels and card-number lines no longer leak into transactions.
- Header-like text and prose containing numbers on later pages no longer break
  column detection.

### Changed

- Updates to README

## 0.1.1 - 2026-09-28

### Fixed

- Corrected stale invocation and API-package advice in the README.
- Dropped the `./` prefix from the `bin` path, which npm silently stripped at
  publish time.

## 0.1.0 - 2026-09-28

First release on npm.

### Added

- Convert Indian bank statements into Actual Budget transactions, from CSV,
  Excel, HTML tables, Excel 2003 XML and PDF (including password-protected).
- Turn UPI, NEFT, IMPS, NACH, card and ATM narrations into real payee names,
  with a built-in merchant map and your own rules through `--merchants`.
- Balance check that refuses to write a statement that does not reconcile.
- Push straight into Actual with `--push`, with `--dry-run` and duplicate
  protection through the bank reference.
- Settings and passwords from a `.env` file instead of command-line flags.
