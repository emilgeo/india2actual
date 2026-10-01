# CLAUDE.md - guide for AI agents working on india2actual

A CLI that converts Indian bank statements (CSV, Excel, HTML tables, PDF) into
[Actual Budget](https://actualbudget.org) transactions, either as an importable
CSV or pushed directly through Actual's API.

## The rule that matters most: no real statement data

**Never put real transaction data into source, tests, fixtures, comments, docs
or commit messages.** "Real" means any value that came from an actual statement,
not only the ones that identify a person. That covers account and card numbers,
UTR/RRN and serial references, VPAs, IFSC codes, counterparty names, phone
numbers, addresses, passwords, and also **amounts, balances, summary totals,
dates and merchant descriptors**. An amount next to a date and a merchant is a
real transaction even though none of the three identifies anyone alone. This is
a public repository and the data is financial.

When someone reports a parsing bug, or gives you statements to work with, the
lines they paste are real data. Build a structurally identical fake from
scratch and never commit the original.

**Invent the fake before writing the test, do not copy and then edit.** Every
value in a fixture should be one you chose, not one you saw. Changing only the
reference or the name while keeping the real amount and date is the usual way
this rule gets broken.

**Before staging, check the diff against what you read.** If you inspected a
real statement while working, search the staged changes for its amounts, dates,
descriptors and references, and fix every hit. Do this before reporting the work
as done, not after being asked. Keep any dumps of real statements in the
scratchpad only, never in the repository, and do not paste them into comments.

Established fake values, already used throughout the tests:

| Thing            | Use                                    |
| ---------------- | -------------------------------------- |
| Account number   | `0000000000000000`                     |
| Bank code / IFSC | `BANK`, `BANK000`, `HDFC0001234`       |
| UTR / RRN        | `412345678901`, `1000000000NN`         |
| Sequence number  | `100000N`                              |
| Person           | `JOHN DOE`, `A N OTHER`, `Mr A N OTHE` |
| Company          | `ACME CONSULTING PVT LTD`              |
| VPA              | `swiggy@ybl`, `johndoe@oksbi`          |
| Card number      | `4000XXXXXXXX0000`                     |
| Amount           | `725.00`, `430.00` (made up)           |
| Date             | `12/03/2025` (made up)                 |
| Descriptor       | `ACME STORE PUNE IN`                   |

For amounts, dates and descriptors the point is that you invented them: keep
the shape of what you saw, change every value.

Fake summary totals must stay internally consistent, because the totals check
reads them. Make purchases and payments differ, otherwise reversed signs swap
two equal numbers and a sign test passes by accident.

**Preserve the digit _arrangement_, not just the shape.** The parser branches on
things like how many digit groups a token has, so a fake that changes the
arrangement silently exercises a different code path than the bug being fixed.
For example `TCS3rdINTDiv03022026` has two digit groups and is treated as an
opaque reference, while `TCSInterimDiv03022026` has one and is treated as a
name. Faking the digits is right; dropping the `3rd` is not.

Naming a public company that is already in the merchant map is fine. Naming a
real individual, or reproducing real references, amounts or descriptors, is not.
Column positions and other page geometry are layout, not data, and may be kept.

## Commands

```bash
npm test          # vitest, runs once and exits
npm run typecheck # tsc --noEmit
npm run build     # tsc, emits dist/
npm run dev -- statement.csv   # run the CLI from source
```

Node 22 or newer. ESM only (`"type": "module"`), so relative imports need the
`.js` extension. TypeScript is strict, including `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, so indexed access is possibly-undefined and
optional properties cannot be assigned `undefined` explicitly.

## Layout

| Directory         | Responsibility                                               |
| ----------------- | ------------------------------------------------------------ |
| `src/extract`     | Detect the real format by content and read a raw table       |
| `src/interpret`   | Header synonyms, row parsing, balance validation, round-trip |
| `src/narration`   | Parse the narration into a payee; the merchant map           |
| `src/out`         | Write CSV, or push via `@actual-app/api`                     |
| `src/env-file.ts` | Load settings from `.env`                                    |

Formats are detected by **inspecting file contents, not the extension**,
because Indian banks routinely name an HTML table `.xls`.

## How payee resolution works

`resolveMerchant` in `src/narration/parse.ts` is an ordered fallback chain:

1. Merchant map, matched on the VPA local part
2. Merchant map, matched on the best name candidate
3. Posting rules (interest, charges, card autopay) matched on the whole narration
4. ATM withdrawals, which have no payee
5. A multi-word name candidate
6. A name derived from the VPA, or the VPA itself
7. A single-word name candidate
8. An account reference (`digits@BANKCODE`), rendered as `BANK <account>`
9. A NACH mandate reference, then the NACH company name
10. The raw narration, as a last resort

**The ordering is the design.** Anything that names a human or a merchant must
outrank anything that is merely a stable identifier. When fixing a narration
that resolves badly, add a new link low in the chain rather than loosening a
check higher up, because loosening an early check silently changes every
narration that currently works.

The fallback must never be empty: the worst case is the raw narration, which is
what Actual would have shown anyway.

## Decisions that are settled

Do not relitigate these without a reason:

- **The balance check is a hard gate.** Almost every Indian statement carries a
  running balance, so each parsed amount must equal the change in balance it
  caused. A statement that does not reconcile is refused unless `--force`. Both
  date orders are scored, so newest-first exports work.
- **`imported_id` only from an exactly-12-digit UTR/RRN**, and any reference
  appearing more than once in a file is discarded. Account and card numbers
  appear at other lengths and are not unique per transaction, and a repeated
  `imported_id` makes Actual treat distinct transactions as the same one and
  drop them. No id is better than a wrong one.
- **Credit card statements are read with the card sign convention and checked
  against their own totals.** A card prints spending as a plain positive figure
  and marks only credits, the reverse of a bank statement, so amounts are
  flipped. There is no running balance, so the parsed rows must add up to the
  purchases and payments totals the statement prints, and a mismatch is refused
  unless `--force`. A statement with no printed totals is reported as
  unchecked, never as passed.
- **Secrets come from `.env` or real environment variables, never CLI flags**,
  which would land in shell history.

## Publishing

Maintainer-only. Do not run `npm publish` on someone's behalf.

- **`bin` must not have a `./` prefix.** `"./dist/cli.js"` is silently stripped
  by npm's publish-time normalization, shipping a package with no command at
  all. Neither `npm pack` nor installing the tarball reproduces this, because
  only `npm publish` applies that normalization.
- **Always check `npm publish --dry-run`** for an "auto-corrected" warning
  block before a real publish.
- `files` ships `dist` and `.env.example` only.
- `@actual-app/api` is an `optionalDependency`, so `--push` works without a
  separate install while CSV-only users can skip it.
- `prepublishOnly` gates on typecheck, tests and a fresh build.

## Writing code

**Comments.** Write them impersonally, with no first-person "we". Default to no
comment at all, and add one only when the reason is not deducible from reading
the code: a gotcha, a regression guard, or an external constraint. Keep each
comment self-contained, so it makes sense to someone reading only that file
with no knowledge of the conversation that produced it. State the concrete
code-level consequence (what breaks), not a story about how it was discovered.
Prefer one short note per non-obvious branch over a long block, one line where
possible. Do not restate an obvious signature in `@param` or `@return`.

**No em dashes.** Not in code, comments, UI strings, docs, commit messages or
PR text. Use a period, colon, semicolon, comma or parentheses instead, and
split into shorter sentences where that reads better.

**No issue IDs in code comments.** The link between an issue and the code
belongs in the commit message or the pull request, not the source. Leave any
pre-existing references alone, just do not add new ones.

**Keep diffs focused.** Change only what the issue being worked on requires. Do
not opportunistically refactor, simplify or tidy unrelated code, even when it
looks like an easy win, because it makes the change harder to review. When a
helper you are adding could also DRY up existing code, prefer keeping the new
code self-contained over editing the shared function, unless that was the point
of the change.

## Changelog

`CHANGELOG.md` records user-visible changes, newest first, in Keep a Changelog
style. A `feat:` or `fix:` change adds one line under `## Unreleased` in the
same change, grouped as Added, Changed or Fixed. Write it for a user of the CLI
("Credit card statements are detected automatically"), not for the diff. Docs,
tests and chores do not need an entry.

At release time, the maintainer renames `Unreleased` to the version and date,
adds a fresh empty `Unreleased` above it, and copies that section into the
GitHub release notes.

## Working with the user

**Never run `git commit`.** Not when asked to, not as the final step of
anything. Stop at staging: `git add` the relevant files, show what is staged,
and suggest a commit message for the user to use or ignore. The same applies to
anything that publishes or rewrites history, including `git push`, `git merge`,
`git rebase`, `git reset --hard`, `git stash drop`, creating tags, and opening
or merging pull requests. Never add `Co-Authored-By: Claude` or any other
AI attribution to a commit message or PR body.

**Never get ahead of instructions.** Do what was asked and stop there. A
question ("how can I...", "any suggestions?") is a request for an answer, not
permission to implement. Announcing an intention is not approval either. When a
good idea falls outside the request, mention it in one line and let the user
decide. If it is unclear whether something is in scope, it is not.

**Advise, do not agree.** Think a question through before answering rather than
defaulting to agreement, and do not treat the framing of a question as settled
fact. Give the best recommendation even when it contradicts what was proposed,
saying plainly that it disagrees and why. Changing position because the
reasoning warrants it is fine; changing it because of pushback alone is not.
Verify claims before stating them, say which part is uncertain rather than
guessing confidently, and correct your own findings as soon as they look
questionable.

## Contributing

Adding a bank usually means adding column synonyms or narration token shapes,
both small and contained. Narration strings are the most useful contribution:
the description column only, with every name, account number and reference
replaced by a realistic fake, as above.
