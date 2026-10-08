import type { ActualApi } from '../../src/out/push.js';

export type Account = { id: string; name: string; closed?: boolean };
export type Category = { id: string; name: string };
export type CategoryGroup = { id: string; name: string; categories?: Category[] };
export type Payee = { id: string; name: string; transfer_acct?: string | null };

type RuleEntity = {
  conditions: Array<{ field: string; value: unknown }>;
  actions: Array<{ field?: string }>;
};

/** The slice of the Actual API the push page uses, beyond what the CLI does. */
export type WebApi = ActualApi & {
  sync(): Promise<void>;
  getBudgets(): Promise<Array<{ name?: string; groupId?: string }>>;
  getServerVersion(): Promise<{ version: string } | { error: string }>;
  getAccountBalance(id: string, cutoff?: Date): Promise<number>;
  getCategoryGroups(): Promise<CategoryGroup[]>;
  deleteTransaction(id: string): Promise<unknown>;
  getRules(): Promise<RuleEntity[]>;
  createRule(rule: unknown): Promise<unknown>;
};

export type Connection = {
  api: WebApi;
  syncId: string;
  budgetName: string;
  serverVersion: string | null;
  accounts: Account[];
  categoryGroups: CategoryGroup[];
  payees: Payee[];
};
