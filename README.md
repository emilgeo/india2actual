# india2actual

[![npm](https://img.shields.io/npm/v/india2actual)](https://www.npmjs.com/package/india2actual)
[![license](https://img.shields.io/npm/l/india2actual)](LICENSE)

Get your Indian bank statements into [Actual Budget](https://actualbudget.org),
with **real payee names instead of UPI reference strings**.

Website: <https://india2actual.emil.ge>

## Why this exists

**1. Actual has no bank sync for Indian banks, and is unlikely to get one soon.**
([more below](#limitations)). The only way to
get transactions in is to download a statement and import it yourself. This tool
makes that as painless as it can be: hand it the file your bank gave you (CSV,
Excel or PDF) and it either produces a clean CSV for Actual or puts the
transactions straight into your budget.

**2. UPI transactions are unreadable as they come.** Your bank describes two
orders from the same shop like this:

```
UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment
UPI/DR/419876543210/SWIGGY/YESB/swiggy@ybl/Payment
```

Every line has a different reference number, so Actual treats them as two
different payees. A few months in, you have hundreds of junk payees, reports by
payee tell you nothing, and Actual cannot learn your categories.

This tool pulls the name out of each line, so both become simply `Swiggy`:

| Date       | Payee          | Notes                                                | Amount   |
| ---------- | -------------- | ---------------------------------------------------- | -------- |
| 2024-04-01 | Swiggy         | `UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl/Payment` | -450.50  |
| 2024-04-03 | ATM Withdrawal | `ATW/1234/CASH WDL/BANGALORE`                        | -2000.00 |
| 2024-04-04 | DMart          | `POS 1234XXXX5678 DMART BANGALORE`                   | -3250.75 |
| 2024-04-05 | John Doe       | `UPI/412345678903/JOHN DOE/johndoe@oksbi`            | 1500.00  |

The bank's original text is kept in Notes, so nothing is lost.

## Quick start

You need [Node.js](https://nodejs.org) 22.14 or newer. There is nothing else to
install.

**Step 1. Download a statement from your bank.** Use internet banking rather
than the mobile app if you can: the website usually offers Excel or CSV, which
work better than PDF.

**Step 2. Convert it.**

```bash
npx india2actual statement.csv
```

This writes `statement.actual.csv` next to your file. Works the same for
`.xls`, `.xlsx` and `.pdf`.

**Step 3. Import it into Actual.** Open the account, choose **Import**, pick
`statement.actual.csv`, and match up the `Date`, `Payee`, `Notes` and `Amount`
columns. Leave `Reference` unmapped. Actual remembers this per account, so you
only do it once.

That's it.

If you use it often, install it so you can drop the `npx`:

```bash
npm install -g india2actual
```

## Skip the import step

If you run an Actual sync server, the tool can send transactions straight into
your budget. No CSV, no import dialog.

Create a file named `.env` in the folder you run the tool from:

```bash
ACTUAL_SERVER_URL=https://actual.example.com
ACTUAL_PASSWORD=your-actual-password
ACTUAL_SYNC_ID=your-sync-id        # Actual: Settings > Advanced > Sync ID
```

Preview first, then do it for real:

```bash
india2actual statement.pdf --push --account "ICICI Savings" --dry-run
# [dry run] ICICI Savings: would add 34, would update 0.

india2actual statement.pdf --push --account "ICICI Savings"
```

Pushing is also the better way to import:

- **No duplicates.** If two statements overlap, transactions already in Actual
  are skipped.
- **Actual learns faster.** It sees both the clean payee and the bank's original
  text, which is what its payee matching learns from.

Want to check the result before it reaches your budget? Convert, edit the CSV,
then push the CSV:

```bash
india2actual statement.pdf
# open statement.actual.csv and fix anything you like
india2actual statement.actual.csv --push --account "ICICI Savings"
```

## Password-protected PDFs

Add the PDF's password to your `.env` file:

```bash
STATEMENT_PASSWORD=your-pdf-password
```

Passwords go in `.env` rather than on the command line so they do not end up in
your shell history.

## Fixing a payee name

Common Indian merchants are recognised out of the box. For anything else, such
as your local shop or your employer, write your own rules in a JSON file:

```json
[
  { "pattern": "^mylocalkirana", "name": "Kirana Store" },
  { "pattern": "^acmecorp", "name": "Acme Payroll" }
]
```

```bash
india2actual statement.csv --merchants my-merchants.json
```

Write patterns in lowercase with no spaces or dots. They are matched against
the UPI ID (the part before the `@`) or the merchant name. Your rules win over
the built-in ones.

Two cases where rules are especially useful:

- **EMIs and other auto-debits (NACH).** The bank's text has no name, only a
  mandate number, so these show up as something like
  `NACH ICIC0000000000000001`. Name each one once:

  ```json
  [{ "pattern": "icic0000000000000001", "name": "Home Loan EMI" }]
  ```

- **Names cut short.** Some banks trim names to about ten characters, so the
  same person can appear as `Mr A N OTHE`, `A N OTHER` or `OTHER`. Add one rule
  per variant to merge them.

## It checks its own work

Nearly every Indian statement has a running balance column. The tool uses it to
verify every transaction: each amount must match the change in balance. If
anything does not add up, it **refuses to write the file** and tells you which
row is wrong:

```
Balance check FAILED (4/5 rows agree).
  1 of 5 rows do not agree with the balance column.
  2024-04-03 "ATW/1234/CASH WDL/BANGALORE": balance moved by -2000.00 but the parsed amount is -9000.00
Refusing to write a statement that does not reconcile. Re-run with --force to write it anyway.
```

## Credit card statements

Credit card statements work the same way: run the tool on the file and import
the result into a credit card account in Actual.

```bash
npx india2actual card-statement.pdf
```

There is no running balance on a card statement, so the check is different. If
the statement prints its totals for the period (purchases and payments), the
tool adds up the rows it read and refuses to write the file if either total is
off:

```
Statement totals check FAILED (1/2 totals agree).
  Purchases and cash advances: the statement says 3210.40 but the parsed rows total 2500.00
Refusing to write a statement that does not reconcile. Re-run with --force to write it anyway.
```

Statements that do not print totals, such as a yearly summary, cannot be
checked, and the tool says so. If a card statement is not recognised and the
signs come out reversed, add `--card`.

So far this has been tested on ICICI card statements only. Other issuers'
conventions (a trailing `C` or `D`, a leading `+` on credits, `DR` and `CR`
markers, and summary lines for finance charges and fees) are handled from public
documentation of those layouts and are unverified.

### Card payments as transfers

A card payment shows up twice: as an autopay debit on your bank statement and as
a payment on your card statement. Imported as ordinary transactions, one looks
like spending and the other like income. With `--push`, the tool can link them
as a transfer instead:

```bash
# card statement: the payment becomes a transfer with your bank account
india2actual card.pdf --push --account "ICICI Amazon Pay" --transfer-to "ICICI Savings"

# bank statement: the autopay debit becomes a transfer with the card
india2actual savings.pdf --push --account "ICICI Savings" --transfer-to "ICICI Amazon Pay"
```

Use the option on both runs, in either order. Whichever statement you import
first creates the transfer, and the other one matches it instead of adding a
second transaction.

- It only works with `--push`. Actual's CSV import has no way to create
  transfers.
- Only payments the tool recognises as card payments are affected. Everything
  else is imported as usual.
- The two amounts must match, with dates within 7 days. A minimum-due payment
  that differs from the autopay amount will not pair up.
- If the other account already has an ordinary transaction for a payment, for
  example from an earlier import without this option, that payment is imported
  normally and the tool says so. Link that pair in Actual yourself, since the
  API cannot link existing transactions.
- With several cards, name the right card on each run.

Tested against Actual 26.10.0.

## Statements with several accounts

Some banks now email one monthly PDF that covers all of your accounts. The tool
reads each account on its own, because each has its own running balance and its
own place in Actual.

```bash
npx india2actual consolidated.pdf
```

You get one CSV per account, named with the last four digits of the account
number, for example `consolidated.1234.actual.csv`. Import each one into the
matching account in Actual. The tool lists which file is which:

```
Found 2 accounts in this statement:
  1. account ending 1234: 8 transaction(s)
  2. account ending 5678: 3 transaction(s)
```

Each account gets its own balance check, and a second check against the totals
its table prints, when it prints any. An account with no transactions that
month is left out.

To handle just one account, pick it by its number in that list:

```bash
npx india2actual consolidated.pdf --section 2
```

`--push` sends to one Actual account at a time, so it needs `--section`. For
three accounts, run it three times with a different `--section` and `--account`.
This is PDF only for now.

## Help test your bank

This tool needs help from you to test statements from unverified banks. The tool runs on your own computer and uploads nothing.

1. Run it on a statement as usual: `npx india2actual statement.pdf`.
2. If it says `Balance check passed` (or `Statement totals check passed` for a
   card), it worked.
3. If it did not, run it again with `--debug-layout` and keep the output:
   `npx india2actual statement.pdf --debug-layout`.
4. Fill in the [bank report form](https://github.com/emilgeo/india2actual/issues/new?template=bank-report.yml).

The report shows how the file was read: the columns it found, row counts and
the balance check result. Letters are printed as `x` and digits as `9`, so it
carries no names, account numbers or amounts. Read it before you post it, and
please never attach or paste the statement itself.

What is most wanted (see [Supported banks](#supported-banks) for formats):

| Bank                                    | Savings | Credit card |
| --------------------------------------- | ------- | ----------- |
| ICICI                                   | Tested  | Tested      |
| Federal Bank, IDFC FIRST Bank, CSB Bank | Tested  |             |
| HDFC, SBI, Axis, Kotak, IndusInd        | Wanted  | Wanted      |
| PNB, Bank of Baroda, Canara, Yes Bank   | Wanted  |             |
| Any other bank                          | Wanted  | Wanted      |

A bank can ship more than one layout, so a report on a newer statement from a
bank that is already tested is useful too.

## Reference

### Supported files

| File                              | Supported                     |
| --------------------------------- | ----------------------------- |
| CSV / TSV                         | yes                           |
| Excel `.xlsx`                     | yes                           |
| `.xls` that is really HTML or XML | yes                           |
| PDF, including password-protected | yes                           |
| Old binary `.xls`                 | no, re-save as `.xlsx` or CSV |

### Supported banks

| Bank                                                              | Account     | Formats                                     | Status     |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------- | ---------- |
| ICICI                                                             | Savings     | PDF, including the monthly all-accounts PDF | Tested     |
| ICICI                                                             | Credit card | PDF (annual and monthly Amazon Pay layouts) | Tested     |
| Federal Bank                                                      | Savings     | PDF                                         | Tested     |
| IDFC FIRST Bank                                                   | Savings     | Excel, and the monthly all-accounts PDF     | Tested     |
| CSB Bank                                                          | Savings     | CSV                                         | Tested     |
| HDFC                                                              | Savings     | CSV, Excel                                  | Unverified |
| SBI, Axis, Kotak, PNB, Bank of Baroda, Canara, IndusInd, Yes Bank | Savings     | CSV, Excel, PDF                             | Unverified |
| HDFC, SBI, Axis, Kotak, IndusInd                                  | Credit card | PDF                                         | Unverified |

**Tested** means a real statement was run and the output checked. **Unverified**
means the bank's usual layout is expected to work, but nobody has confirmed it
on a real file. If you try one, a report of what worked or failed is very
welcome: see [Help test your bank](#help-test-your-bank). Please never share a
real statement.

### Options

| Option                       | Purpose                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--out <path>`               | Where to write the CSV. Default `<input>.actual.csv`.                                                       |
| `--stdout`                   | Print the result instead of writing a file.                                                                 |
| `--date-order dmy\|mdy\|ymd` | Only affects all-numeric dates, where `01/02/2024` is ambiguous. Default `dmy`.                             |
| `--delimiter <char>`         | Force the CSV delimiter instead of detecting it.                                                            |
| `--merchants <path>`         | Your own payee rules. See [above](#fixing-a-payee-name).                                                    |
| `--card`                     | Read the file as a credit card statement. Normally detected automatically.                                  |
| `--env-file <path>`          | Read settings from this file instead of `./.env`.                                                           |
| `--push`                     | Send to Actual directly instead of writing a CSV.                                                           |
| `--account <name\|id>`       | Which Actual account to import into. Required with `--push`.                                                |
| `--dry-run`                  | With `--push`, report what would change without writing.                                                    |
| `--transfer-to <account>`    | With `--push`, send card payments as transfers with this account. See [above](#card-payments-as-transfers). |
| `--section <n>`              | For a statement with several accounts, handle only the nth. Required with `--push`. See [above](#statements-with-several-accounts). |
| `--force`                    | Write even if the balance check fails.                                                                      |
| `--quiet`                    | Only report problems.                                                                                       |
| `--debug-layout`             | Print a report on how the file was read, safe to paste into an issue, and write nothing.                    |
| `--help`, `-h`               | Show the usage text.                                                                                        |
| `--version`, `-v`            | Show the installed version.                                                                                 |

### Settings

These go in a `.env` file in the folder you run the tool from. None are needed
just to convert a statement to CSV.

| Setting                      | Purpose                                               |
| ---------------------------- | ----------------------------------------------------- |
| `STATEMENT_PASSWORD`         | Password on an encrypted statement PDF.               |
| `ACTUAL_SERVER_URL`          | Your Actual sync server.                              |
| `ACTUAL_PASSWORD`            | Password for that server. Not the statement password. |
| `ACTUAL_SYNC_ID`             | Budget to import into: Settings > Advanced > Sync ID. |
| `ACTUAL_ENCRYPTION_PASSWORD` | Only for end-to-end encrypted budgets.                |
| `ACTUAL_DATA_DIR`            | Local budget cache. Default `./.actual-cache`.        |

Real environment variables override the file, which is handy for a one-off:

```bash
ACTUAL_SYNC_ID=other-budget india2actual statement.pdf --push --account Savings
```

### How duplicates are avoided

Each UPI transaction carries a 12-digit reference number. The tool writes it to
the `Reference` column, and with `--push` Actual uses it to recognise a
transaction it already has.

Only exactly-12-digit values that appear once in the file are used. Anything
else could be an account or card number, and would make Actual wrongly merge
separate transactions. Where there is no reference, Actual falls back to
matching on date and amount.

When you push a CSV you converted earlier, payees you edited are kept as they
are and the references survive. The balance check cannot run again, because the
converted CSV has no balance column, but it already ran when the CSV was made.

## Limitations

- **PDF is the least reliable input.** The table has to be rebuilt from where
  each piece of text sits on the page, which can break when a bank changes its
  layout. The balance check is there to catch this. Use CSV or Excel when your
  bank offers it.
- **A card statement whose spending equals its payments** cannot reveal
  reversed signs through the totals check, since both totals swap to the same
  figure. Detection normally gets the signs right, so this only matters if a
  card statement is not recognised.
- **Long text in a PDF may gain or lose a space** where a line wrapped. Dates,
  amounts, payees and references are not affected.
- **Payee names are a best guess.** Payment gateways often hide the real shop.
  You get one consistent payee instead of one per transaction, but not always
  the actual shop.
- **It cannot fetch statements for you.** India's Account Aggregator framework
  needs a registered entity and a commercial contract, so a free always-on
  connector like Actual's European bank sync is not possible. You download the
  statement; this tool does the rest.

<!-- ## Contributing -->

## Development

```bash
git clone https://github.com/emilgeo/india2actual.git
cd india2actual
npm install

npm test
npm run typecheck
npm run dev -- statement.csv   # run the CLI from source
```

## License

MIT
