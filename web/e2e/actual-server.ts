import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import * as api from '@actual-app/api';

const root = resolve(import.meta.dirname, '..', '..');
const PASSWORD = 'test-only-password';

export type Budget = {
  syncId: string;
  savings: string;
  card: string;
  groceries: string;
};

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

/** A real Actual sync server on this computer, with a throwaway password. */
export class TestServer {
  readonly password = PASSWORD;
  private constructor(
    readonly url: string,
    private readonly process: ChildProcess,
    private readonly folder: string,
  ) {}

  static async start(): Promise<TestServer> {
    const folder = mkdtempSync(join(tmpdir(), 'india2actual-server-'));
    const port = await freePort();
    const url = `http://localhost:${port}`;
    const child = spawn(
      process.execPath,
      [
        join(root, 'node_modules/@actual-app/sync-server/build/bin/actual-server.js'),
      ],
      {
        env: { ...process.env, ACTUAL_PORT: String(port), ACTUAL_DATA_DIR: folder },
        stdio: 'ignore',
      },
    );

    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        if ((await fetch(`${url}/health`)).ok) {
          break;
        }
      } catch {
        // Not up yet.
      }
      await new Promise(wait => setTimeout(wait, 500));
    }

    await fetch(`${url}/account/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    return new TestServer(url, child, folder);
  }

  private async open(name: string, syncId?: string) {
    const dataDir = join(this.folder, `client-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });
    await api.init({ dataDir, serverURL: this.url, password: PASSWORD });
    if (syncId) {
      await api.downloadBudget(syncId);
    }
    return name;
  }

  /** A new budget with two accounts and a category, made through the Node API. */
  async newBudget(): Promise<Budget> {
    const name = `Test ${Math.random().toString(36).slice(2, 8)}`;
    await this.open(name);
    try {
      await api.runImport(name, async () => {});
      const savings = await api.createAccount({ name: 'Acme Savings' }, 0);
      const card = await api.createAccount({ name: 'Acme Card' }, 0);
      const group = await api.createCategoryGroup({ name: 'Everyday' });
      const groceries = await api.createCategory({ name: 'Groceries', group_id: group });
      await api.sync();
      const budget = (await api.getBudgets()).find(item => item.name === name);
      if (!budget?.groupId) {
        throw new Error('The test budget did not come back from the server');
      }
      return { syncId: budget.groupId, savings, card, groceries };
    } finally {
      await api.shutdown();
    }
  }

  /** What the server holds, read the way any other client would. */
  async read(syncId: string, accountId: string) {
    await this.open('reader', syncId);
    try {
      const transactions = await api.getTransactions(accountId, '2000-01-01', '2100-01-01');
      const payees = await api.getPayees();
      const rules = await api.getRules();
      return { transactions, payees, rules };
    } finally {
      await api.shutdown();
    }
  }

  stop(): void {
    this.process.kill();
  }
}
