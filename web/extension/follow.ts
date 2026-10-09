import { useEffect, useState } from 'preact/hooks';

/**
 * The Actual account a page address shows, or null. Actual's account screens
 * live at `/accounts/<id>`; the lists of all accounts, budget and the rest do
 * not name one.
 */
export function accountFromUrl(url: string, origin: string): string | null {
  try {
    const address = new URL(url);
    if (address.origin !== origin) {
      return null;
    }
    return /^\/accounts\/([^/]+)\/?$/.exec(address.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

type TabLike = { url?: string | undefined; active?: boolean; lastAccessed?: number };

/** The tab to read: the active one, else the one used most recently. */
export function pickTab<T extends TabLike>(tabs: T[]): T | undefined {
  return [...tabs].sort(
    (a, b) =>
      Number(b.active ?? false) - Number(a.active ?? false) ||
      (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  )[0];
}

/** Ask to read tabs on the user's own Actual server. False when refused. */
export async function requestHostAccess(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/**
 * The account open in the Actual tab beside the side panel. Always null outside
 * the extension, or without permission to read that server's tabs.
 */
export function useActualAccount(origin: string | null): string | null {
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!__EXTENSION__ || !origin || typeof chrome === 'undefined' || !chrome.tabs) {
      setAccountId(null);
      return undefined;
    }

    const refresh = async () => {
      try {
        const tabs = await chrome.tabs.query({
          currentWindow: true,
          url: `${origin}/*`,
        });
        const tab = pickTab(tabs);
        setAccountId(tab?.url ? accountFromUrl(tab.url, origin) : null);
      } catch {
        setAccountId(null);
      }
    };

    void refresh();
    chrome.tabs.onUpdated.addListener(refresh);
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onRemoved.addListener(refresh);
    return () => {
      chrome.tabs.onUpdated.removeListener(refresh);
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onRemoved.removeListener(refresh);
    };
  }, [origin]);

  return accountId;
}
