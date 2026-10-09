import { describe, expect, it } from 'vitest';

import { applyTheme, loadTheme, saveTheme } from './theme.js';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('theme', () => {
  it('follows the system until a choice is saved', () => {
    const storage = memory();
    expect(loadTheme(storage)).toBe('system');
    saveTheme(storage, 'dark');
    expect(loadTheme(storage)).toBe('dark');
    saveTheme(storage, 'system');
    expect(loadTheme(storage)).toBe('system');
    expect(storage.data.size).toBe(0);
  });

  it('ignores a saved value it does not know', () => {
    expect(loadTheme(memory({ 'starlight-theme': 'sepia' }))).toBe('system');
  });

  it('works without storage', () => {
    expect(loadTheme(null)).toBe('system');
    expect(() => saveTheme(null, 'light')).not.toThrow();
  });

  it('sets and clears the attribute the stylesheet reads', () => {
    const attributes = new Map<string, string>();
    const root = {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    } as unknown as HTMLElement;
    applyTheme('dark', root);
    expect(attributes.get('data-theme')).toBe('dark');
    applyTheme('system', root);
    expect(attributes.has('data-theme')).toBe(false);
  });
});
