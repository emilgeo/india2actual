export type Theme = 'system' | 'light' | 'dark';

export const THEMES: Theme[] = ['system', 'light', 'dark'];

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

// The site's own theme switch stores its choice under this name, so one choice covers both.
const KEY = 'starlight-theme';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadTheme(storage: ThemeStorage | null): Theme {
  try {
    const saved = storage?.getItem(KEY);
    return THEMES.find(theme => theme === saved) ?? 'system';
  } catch {
    return 'system';
  }
}

/** `system` removes the attribute, so the stylesheet follows the browser. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function saveTheme(storage: ThemeStorage | null, theme: Theme): void {
  try {
    if (theme === 'system') {
      storage?.removeItem(KEY);
    } else {
      storage?.setItem(KEY, theme);
    }
  } catch {
    // Not remembering is fine: the choice still applies for this visit.
  }
}
