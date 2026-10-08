import { startingBalanceRow } from '../../src/interpret/opening.js';
import type { StatementTransaction } from '../../src/interpret/rows.js';
import type { Section } from '../../src/interpret/sections.js';

/** `name.csv` becomes `name.1234.actual.csv`, matching the command line. */
export function csvFileName(
  inputName: string,
  section: Section,
  number: number,
  several: boolean,
): string {
  const base = inputName.replace(/\.[^./\\]+$/, '');
  const suffix = several ? `.${section.account ?? `section${number}`}` : '';
  return `${base}${suffix}.actual.csv`;
}

export type RowChoices = {
  /** Positions in the section's transactions to leave out. */
  excluded: ReadonlySet<number>;
  /** Names typed for single rows, by position. */
  renamed: ReadonlyMap<number, string>;
  /** Actual category ids chosen for rows, by position. */
  categories?: ReadonlyMap<number, string>;
  startingBalance: boolean;
};

/** The rows a download should hold: renamed, with exclusions and an opening row. */
export function rowsToDownload(
  section: Section,
  choices: RowChoices,
): StatementTransaction[] {
  const rows = section.result.transactions.flatMap((row, index) => {
    if (choices.excluded.has(index)) {
      return [];
    }
    const name = choices.renamed.get(index);
    const categoryId = choices.categories?.get(index);
    return [
      {
        ...row,
        ...(name ? { payee: name } : {}),
        ...(categoryId ? { categoryId } : {}),
      },
    ];
  });

  const opening = choices.startingBalance ? startingBalanceRow(section) : null;
  return opening ? [opening, ...rows] : rows;
}
