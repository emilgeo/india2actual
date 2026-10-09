import { readFile } from 'node:fs/promises';

import type { MerchantRule } from './narration/merchants.js';
import { parseMerchantRules } from './narration/rules.js';

/** Load user merchant rules from a JSON file. */
export async function loadMerchantRules(path: string): Promise<MerchantRule[]> {
  return parseMerchantRules(await readFile(path, 'utf8'), path);
}
