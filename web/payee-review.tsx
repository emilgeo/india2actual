import { useState } from 'preact/hooks';

import { payeeGroups } from '../src/interpret/payees.js';
import type { PayeeGroup } from '../src/interpret/payees.js';
import type { StatementTransaction } from '../src/interpret/rows.js';

import { formatAmount } from './dom.js';
import type { CategoryGroup } from './push/types.js';

export type NameExtras = { categoryId?: string; makeRule?: boolean };

type Props = {
  transactions: StatementTransaction[];
  /** Positions already given a name for this account only. */
  renamed: ReadonlyMap<number, string>;
  /** Called with a group, the name typed, and whether to remember it. */
  onName: (
    group: PayeeGroup,
    name: string,
    remember: boolean,
    extras: NameExtras,
  ) => void;
  /** Present once connected to Actual: categories to choose from. */
  categoryGroups?: CategoryGroup[] | undefined;
  /** Payees Actual already has, offered as suggestions. */
  knownPayees?: string[] | undefined;
};

function GroupRow({
  group,
  onName,
  categoryGroups,
}: {
  group: PayeeGroup;
  onName: Props['onName'];
  categoryGroups: CategoryGroup[] | undefined;
}) {
  const [name, setName] = useState('');
  const [remember, setRemember] = useState(Boolean(group.rule));
  const [categoryId, setCategoryId] = useState('');
  const [makeRule, setMakeRule] = useState(true);

  const save = () => {
    const trimmed = name.trim();
    if (trimmed || categoryId) {
      onName(group, trimmed, remember && Boolean(group.rule), {
        ...(categoryId ? { categoryId, makeRule } : {}),
      });
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
          list={categoryGroups ? 'actual-payees' : undefined}
          value={name}
          onInput={event => setName((event.currentTarget as HTMLInputElement).value)}
        />
        {categoryGroups ? (
          <>
            <label class="visually-hidden" htmlFor={`cat-${group.rule}-${group.payee}`}>
              Category for {group.payee}
            </label>
            <select
              id={`cat-${group.rule}-${group.payee}`}
              value={categoryId}
              onChange={event =>
                setCategoryId((event.currentTarget as HTMLSelectElement).value)
              }
            >
              <option value="">No category</option>
              {categoryGroups.map(categoryGroup => (
                <optgroup key={categoryGroup.id} label={categoryGroup.name}>
                  {(categoryGroup.categories ?? []).map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {categoryId ? (
              <label class="check">
                <input
                  type="checkbox"
                  checked={makeRule}
                  onChange={event =>
                    setMakeRule((event.currentTarget as HTMLInputElement).checked)
                  }
                />
                Always in Actual
              </label>
            ) : null}
          </>
        ) : null}
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
        <button type="submit" class="button" disabled={!name.trim() && !categoryId}>
          Apply
        </button>
      </form>
    </li>
  );
}

/** Payees the tool was unsure about, with a box to name each one. */
export function PayeeReview({
  transactions,
  renamed,
  onName,
  categoryGroups,
  knownPayees,
}: Props) {
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
      {knownPayees ? (
        <datalist id="actual-payees">
          {knownPayees.map(payee => (
            <option key={payee} value={payee} />
          ))}
        </datalist>
      ) : null}
      {groups.length ? (
        <ul class="payee-list">
          {groups.slice(0, 50).map(group => (
            <GroupRow
              key={`${group.rule}|${group.payee}`}
              group={group}
              onName={onName}
              categoryGroups={categoryGroups}
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
