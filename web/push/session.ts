import { describeConnectionError, checkServerAddress } from './address.js';
import { loadApi } from './load-api.js';
import type { Connection, WebApi } from './types.js';

export type ConnectForm = {
  serverURL: string;
  password: string;
  syncId: string;
  encryptionPassword: string;
};

/** Open the budget and read what the page needs to offer choices. */
export async function connect(form: ConnectForm): Promise<Connection> {
  const checked = checkServerAddress(form.serverURL);
  if (checked.url === undefined) {
    throw new Error(checked.problem);
  }
  const syncId = form.syncId.trim();
  if (!syncId) {
    throw new Error('Enter the Sync ID, under Settings, Show advanced settings.');
  }

  const api = (await loadApi()) as unknown as WebApi;
  try {
    await api.init({ serverURL: checked.url, password: form.password });
    await api.downloadBudget(
      syncId,
      form.encryptionPassword ? { password: form.encryptionPassword } : undefined,
    );
  } catch (error) {
    await api.shutdown().catch(() => undefined);
    throw new Error(describeConnectionError(error));
  }

  const version = await api.getServerVersion().catch(() => ({ error: 'unknown' }));
  const budgets = await api.getBudgets().catch(() => []);
  return {
    api,
    serverOrigin: new URL(checked.url).origin,
    syncId,
    budgetName: budgets.find(budget => budget.groupId === syncId)?.name ?? 'your budget',
    serverVersion: 'version' in version ? version.version : null,
    accounts: (await api.getAccounts()).filter(account => !account.closed),
    categoryGroups: await api.getCategoryGroups().catch(() => []),
    payees: await api.getPayees(),
  };
}

export async function disconnect(connection: Connection): Promise<void> {
  await connection.api.shutdown().catch(() => undefined);
}

/** Do the page's bundled API and the server share a year and month? */
export function versionsMatch(bundled: string, server: string | null): boolean {
  if (!server) {
    return true;
  }
  const part = (version: string) => version.split('.').slice(0, 2).join('.');
  return part(bundled) === part(server);
}
