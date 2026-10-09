import { validateBalances, validateCardTotals, validateSectionTotals } from './validate.js';
import type { Validation } from './validate.js';
import type { Section } from './sections.js';

/** The independent checks that apply to a section, in the order they run. */
export function checksFor(
  section: Section,
): Array<{ name: string; unit: string; validation: Validation }> {
  const { transactions, card } = section.result;
  const checks = [
    {
      name: card ? 'Statement totals check' : 'Balance check',
      unit: card ? 'totals' : 'rows',
      validation: card
        ? validateCardTotals(transactions, section.table.figures)
        : validateBalances(transactions),
    },
  ];

  if (!card) {
    const totals = validateSectionTotals(transactions, section.table.totals);
    if (totals.status !== 'skipped') {
      checks.push({
        name: 'Printed totals check',
        unit: 'totals',
        validation: totals,
      });
    }
  }

  return checks;
}
