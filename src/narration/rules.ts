import type { MerchantRule } from './merchants.js';

/** A rule as it is written in a merchants file. */
export type RuleSpec = { pattern: string; name: string };

type RawRule = { pattern?: unknown; name?: unknown };

/**
 * Parse user merchant rules from JSON text:
 *
 *   [
 *     { "pattern": "^mylocalkirana", "name": "Kirana Store" },
 *     { "pattern": "^acmecorp",      "name": "Acme Payroll" }
 *   ]
 *
 * Patterns are matched against a lowercased, separator-stripped form of the
 * VPA local-part or merchant name, so write them without spaces or
 * punctuation. Loaded rules take precedence over the built-in map. `source`
 * names where the text came from, for error messages.
 */
export function parseMerchantRules(
  contents: string,
  source: string,
): MerchantRule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${source} must contain an array of { pattern, name } rules`);
  }

  return parsed.map((entry: RawRule, index) => {
    const { pattern, name } = entry ?? {};

    if (typeof pattern !== 'string' || typeof name !== 'string' || !name) {
      throw new Error(
        `${source}: rule ${index + 1} needs a string "pattern" and a non-empty string "name"`,
      );
    }

    try {
      // Case-insensitive to match how the built-in rules are applied.
      return { pattern: new RegExp(pattern, 'i'), name };
    } catch (error) {
      throw new Error(
        `${source}: rule ${index + 1} has an invalid regular expression (${pattern}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

/** Rules as JSON text that `parseMerchantRules` reads back. */
export function rulesToJson(rules: RuleSpec[]): string {
  return `${JSON.stringify(rules, null, 2)}\n`;
}
