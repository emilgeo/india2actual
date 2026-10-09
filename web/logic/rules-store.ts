import { parseMerchantRules, rulesToJson } from '../../src/narration/rules.js';
import type { RuleSpec } from '../../src/narration/rules.js';

const KEY = 'india2actual.rules.v1';

/** The part of `Storage` in use, so tests can stand in for it. */
export type RuleStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Saved payee rules. Storage can be missing or refuse (a private window, blocked
 * site data), so every access is guarded and the page works without it.
 */
export function loadRules(storage: RuleStorage | null): RuleSpec[] {
  try {
    const text = storage?.getItem(KEY);
    if (!text) {
      return [];
    }
    parseMerchantRules(text, 'saved names');
    return JSON.parse(text) as RuleSpec[];
  } catch {
    return [];
  }
}

export function saveRules(storage: RuleStorage | null, rules: RuleSpec[]): void {
  try {
    storage?.setItem(KEY, rulesToJson(rules));
  } catch {
    // Not remembering is fine: the names still apply for this visit.
  }
}

export function clearRules(storage: RuleStorage | null): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Add a rule, replacing an earlier one with the same pattern. */
export function withRule(rules: RuleSpec[], rule: RuleSpec): RuleSpec[] {
  return [...rules.filter(existing => existing.pattern !== rule.pattern), rule];
}

/** Merge rules read from a file into the current ones; the file wins. */
export function mergeRules(rules: RuleSpec[], incoming: RuleSpec[]): RuleSpec[] {
  return incoming.reduce(withRule, rules);
}

/** Read a rules file the way `--merchants` does, keeping the text form. */
export function readRulesFile(text: string, source: string): RuleSpec[] {
  parseMerchantRules(text, source);
  return (JSON.parse(text) as RuleSpec[]).map(({ pattern, name }) => ({
    pattern,
    name,
  }));
}
