import type { Section } from '../../src/interpret/sections.js';

const NUMERIC = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/;

/**
 * Could the dates in this section be read day-first or month-first? True when
 * every all-numeric date has both of its first two numbers 12 or below, so
 * nothing in the file settles it.
 */
export function datesAreAmbiguous(section: Section): boolean {
  const column = section.result.header.map.date ?? section.result.header.map.valueDate;
  if (column === undefined) {
    return false;
  }

  let numeric = 0;
  for (const row of section.table.rows.slice(section.result.header.index + 1)) {
    const match = NUMERIC.exec(row[column] ?? '');
    if (!match) {
      continue;
    }
    numeric += 1;
    if (Number(match[1]) > 12 || Number(match[2]) > 12) {
      return false;
    }
  }
  return numeric > 0;
}
