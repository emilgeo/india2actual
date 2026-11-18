import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script without type declarations
import { MAX_FILE_BYTES, oversizedFiles } from './extension-limits.mjs';

const file = (name: string, size: number) => ({ name, data: { length: size } });

describe('oversizedFiles', () => {
  it('passes files under the limit', () => {
    expect(oversizedFiles([file('a.js', 10), file('b.js', MAX_FILE_BYTES - 1)])).toEqual([]);
  });

  it('names every file at or over the limit, with its size', () => {
    expect(
      oversizedFiles([file('a.js', MAX_FILE_BYTES), file('b.js', 5), file('c.js', MAX_FILE_BYTES + 7)]),
    ).toEqual([
      { name: 'a.js', size: MAX_FILE_BYTES },
      { name: 'c.js', size: MAX_FILE_BYTES + 7 },
    ]);
  });

  it('keeps the limit below the 5 MB Firefox stops reading at, in either unit', () => {
    expect(MAX_FILE_BYTES).toBeLessThanOrEqual(5_000_000);
  });
});
