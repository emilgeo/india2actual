import { extractTablesFromBytes } from '../../src/extract/bytes.js';
import { describeFormat } from '../../src/extract/sniff.js';
import { isPasswordError } from '../../src/extract/pdf.js';
import type { Table } from '../../src/extract/types.js';
import { interpretSections } from '../../src/interpret/sections.js';
import type { Section } from '../../src/interpret/sections.js';
import type { DateOrder } from '../../src/interpret/values.js';
import type { MerchantRule } from '../../src/narration/merchants.js';
import type { RuleSpec } from '../../src/narration/rules.js';

export type LoadedFile = {
  id: number;
  name: string;
  bytes: Uint8Array;
  status: 'ready' | 'password' | 'error';
  /** A password was tried and did not work. */
  wrongPassword?: boolean;
  error?: string;
  /** What the file turned out to be, in words. */
  format?: string;
  tables: Table[];
};

/** Read a file's tables. A PDF that needs a password says so, rather than failing. */
export async function loadFile(
  id: number,
  name: string,
  bytes: Uint8Array,
  password?: string,
): Promise<LoadedFile> {
  try {
    const { tables, format } = await extractTablesFromBytes(bytes, name, {
      ...(password ? { password } : {}),
    });
    return {
      id,
      name,
      bytes,
      status: 'ready',
      format: describeFormat(format),
      tables,
    };
  } catch (error) {
    if (isPasswordError(error)) {
      return {
        id,
        name,
        bytes,
        status: 'password',
        ...(password ? { wrongPassword: true } : {}),
        tables: [],
      };
    }
    return {
      id,
      name,
      bytes,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      tables: [],
    };
  }
}

export type Settings = {
  dateOrder: DateOrder;
  forceCard: boolean;
  rules: RuleSpec[];
};

function compile(rules: RuleSpec[]): MerchantRule[] {
  return rules.flatMap(({ pattern, name }) => {
    try {
      return [{ pattern: new RegExp(pattern, 'i'), name }];
    } catch {
      return [];
    }
  });
}

/** The accounts in a file, read with the user's date order and saved names. */
export function readSections(file: LoadedFile, settings: Settings): Section[] {
  if (file.status !== 'ready') {
    return [];
  }
  const merchantRules = compile(settings.rules);
  return interpretSections(file.tables, {
    dateOrder: settings.dateOrder,
    ...(settings.forceCard ? { card: true } : {}),
    ...(merchantRules.length ? { merchantRules } : {}),
  });
}
