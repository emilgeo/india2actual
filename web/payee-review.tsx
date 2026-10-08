import { useState } from 'preact/hooks';

import { payeeGroups } from '../src/interpret/payees.js';
import type { PayeeGroup } from '../src/interpret/payees.js';
import type { StatementTransaction } from '../src/interpret/rows.js';

import { formatAmount } from './dom.js';

type Props = {
  transactions: StatementTransaction[];
  /** Positions already given a name for this account only. */
  renamed: ReadonlyMap<number, string>;
  /** Called with a group, the name typed, and whether to remember it. */
  onName: (group: PayeeGroup, name: string, remember: boolean) => void;
};

function GroupRow({
  group,
  onName,
}: {
  group: PayeeGroup;
  onName: Props['onName'];
}) {
  const [name, setName] = useState('');
  const [remember, setRemember] = useState(Boolean(group.rule));

  const save = () => {
    const trimmed = name.trim();
    if (trimmed) {
      onName(group, trimmed, remember && Boolean(group.rule));
      setName('');
    }
  };

  return (
    <li class="payee-row">
      <div class="payee-info">
        <strong>{group.payee}</strong>
        <span class="muted">
          {group.count} {group.count === 1 ? 'row' : 'rows'}, net{' '}
          {formatAmount(group.total)}
        </span>
        <span class="muted narration" title={group.example}>
          {group.example}
        </span>
      </div>
      <form
        class="payee-form"
        onSubmit={event => {
          event.preventDefault();
          save();
        }}
      >
        <label class="visually-hidden" htmlFor={`name-${group.rule}-${group.payee}`}>
          Name for {group.payee}
        </label>
        <input
          id={`name-${group.rule}-${group.payee}`}
          type="text"
          placeholder="Name it"
          value={name}
          onInput={event => setName((event.currentTarget as HTMLInputElement).value)}
        />
        <label class="check">
          <input
            type="checkbox"
            checked={remember}
            disabled={!group.rule}
            onChange={event =>
              setRemember((event.currentTarget as HTMLInputElement).checked)
            }
          />
          Remember
        </label>
        <button type="submit" class="button" disabled={!name.trim()}>
          Apply
        </button>
      </form>
    </li>
  );
}

/** Payees the tool was unsure about, with a box to name each one. */
export function PayeeReview({ transactions, renamed, onName }: Props) {
  const [showAll, setShowAll] = useState(false);

  const groups = payeeGroups(transactions, { all: showAll }).filter(group =>
    group.indexes.some(index => !renamed.has(index)),
  );
  const unclear = payeeGroups(transactions).filter(group =>
    group.indexes.some(index => !renamed.has(index)),
  );

  return (
    <section class="panel" aria-label="Payees to review">
      <div class="panel-head">
        <h4>
          {unclear.length
            ? `${unclear.length} payee ${unclear.length === 1 ? 'name' : 'names'} worth checking`
            : 'Every payee looks clear'}
        </h4>
        <label class="check">
          <input
            type="checkbox"
            checked={showAll}
            onChange={event =>
              setShowAll((event.currentTarget as HTMLInputElement).checked)
            }
          />
          Show all payees
        </label>
      </div>
      {groups.length ? (
        <ul class="payee-list">
          {groups.slice(0, 50).map(group => (
            <GroupRow
              key={`${group.rule}|${group.payee}`}
              group={group}
              onName={onName}
            />
          ))}
        </ul>
      ) : null}
      {groups.length > 50 ? (
        <p class="muted">Showing the 50 most frequent of {groups.length}.</p>
      ) : null}
    </section>
  );
}
