import { useState } from 'preact/hooks';

import { checksFor } from '../src/interpret/checks.js';
import { startingBalanceRow } from '../src/interpret/opening.js';
import type { PayeeGroup } from '../src/interpret/payees.js';
import type { Section } from '../src/interpret/sections.js';
import { toCsv } from '../src/out/csv-text.js';

import { downloadText, formatAmount } from './dom.js';
import type { LoadedFile } from './logic/files.js';
import { csvFileName, rowsToDownload } from './logic/output.js';
import { PayeeReview } from './payee-review.js';
import type { NameExtras } from './payee-review.js';
import type { RuleRequest } from './push/actions.js';
import { PushPanel } from './push/push-panel.js';
import type { Connection } from './push/types.js';

type Props = {
  file: LoadedFile;
  section: Section;
  number: number;
  several: boolean;
  startingBalance: boolean;
  excluded: ReadonlySet<number>;
  renamed: ReadonlyMap<number, string>;
  onExclude: (index: number, excluded: boolean) => void;
  onName: (
    group: PayeeGroup,
    name: string,
    remember: boolean,
    extras: NameExtras,
  ) => void;
  /** Set once connected to Actual. */
  connection: Connection | null;
  categories: ReadonlyMap<number, string>;
  ruleRequests: RuleRequest[];
};

const PREVIEW_ROWS = 15;

const STATUS_WORDS = { passed: 'Passed', failed: 'Failed', skipped: 'Not checked' };

export function SectionCard(props: Props) {
  const { file, section, number, several, excluded, renamed } = props;
  const [showAll, setShowAll] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const { transactions, skipped, card } = section.result;
  const checks = checksFor(section);
  const failed = checks.some(check => check.validation.status === 'failed');
  const opening = props.startingBalance ? startingBalanceRow(section) : null;
  const included = transactions.length - excluded.size;

  const title = section.account
    ? `Account ending ${section.account}`
    : several
      ? `Account ${number}`
      : file.name;

  const rowsToUse = () =>
    rowsToDownload(section, {
      excluded,
      renamed,
      categories: props.categories,
      startingBalance: props.startingBalance,
    });

  const download = () => {
    downloadText(
      csvFileName(file.name, section, number, several),
      toCsv(rowsToUse()),
    );
  };

  const shown = showAll ? transactions : transactions.slice(0, PREVIEW_ROWS);

  return (
    <article class="card" aria-label={title}>
      <header class="card-head">
        <h3>{title}</h3>
        <p class="muted">
          {transactions.length} {transactions.length === 1 ? 'transaction' : 'transactions'}
          {skipped.length ? `, ${skipped.length} other rows skipped` : ''}
          {card ? ', credit card statement' : ''}
        </p>
      </header>

      <ul class="checks" aria-label="Checks">
        {checks.map(check => (
          <li key={check.name} class={`check-item ${check.validation.status}`}>
            <span class="badge">{STATUS_WORDS[check.validation.status]}</span>
            <span>
              {check.name}
              {check.validation.status === 'skipped'
                ? `: ${check.validation.issues[0] ?? 'nothing to compare'}`
                : ` (${check.validation.matched} of ${check.validation.checked} ${check.unit} agree)`}
            </span>
            {check.validation.status === 'failed' ? (
              <ul class="issues">
                {check.validation.issues.map(issue => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <PayeeReview
        transactions={transactions}
        renamed={renamed}
        onName={props.onName}
        categoryGroups={props.connection?.categoryGroups}
        knownPayees={props.connection?.payees.map(payee => payee.name)}
      />

      <table class="rows">
        <caption class="visually-hidden">Transactions in {title}</caption>
        <thead>
          <tr>
            <th scope="col">Use</th>
            <th scope="col">Date</th>
            <th scope="col">Payee</th>
            <th scope="col">Narration</th>
            <th scope="col" class="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {opening ? (
            <tr class="opening">
              <td />
              <td>{opening.date}</td>
              <td>{opening.payee}</td>
              <td class="narration">{opening.raw}</td>
              <td class="num">{formatAmount(opening.amount)}</td>
            </tr>
          ) : null}
          {shown.map((row, index) => (
            <tr key={index} class={excluded.has(index) ? 'left-out' : ''}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Include ${row.date} ${row.payee}`}
                  checked={!excluded.has(index)}
                  onChange={event =>
                    props.onExclude(
                      index,
                      !(event.currentTarget as HTMLInputElement).checked,
                    )
                  }
                />
              </td>
              <td>{row.date}</td>
              <td>{renamed.get(index) ?? row.payee}</td>
              <td class="narration" title={row.raw}>
                {row.raw}
              </td>
              <td class={`num ${row.amount < 0 ? 'out' : 'in'}`}>
                {formatAmount(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {transactions.length > PREVIEW_ROWS ? (
        <button
          type="button"
          class="link"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show fewer' : `Show all ${transactions.length} rows`}
        </button>
      ) : null}

      {props.connection ? (
        <PushPanel
          connection={props.connection}
          file={file}
          section={section}
          number={number}
          rows={rowsToUse()}
          ruleRequests={props.ruleRequests}
        />
      ) : null}

      <footer class="card-foot">
        {props.startingBalance && !opening ? (
          <p class="muted">
            No starting balance row: this statement does not show the balance
            before its first transaction, or it was zero.
          </p>
        ) : null}
        {failed ? (
          <label class="check warn">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={event =>
                setAcknowledged((event.currentTarget as HTMLInputElement).checked)
              }
            />
            A check failed. I have looked at it and want the file anyway.
          </label>
        ) : null}
        <button
          type="button"
          class="button primary"
          disabled={included === 0 || (failed && !acknowledged)}
          onClick={download}
        >
          Download CSV ({included} {included === 1 ? 'row' : 'rows'}
          {opening ? ' and a starting balance' : ''})
        </button>
      </footer>
    </article>
  );
}
