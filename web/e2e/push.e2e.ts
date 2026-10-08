import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { TestServer } from './actual-server.js';
import type { Budget } from './actual-server.js';

const root = resolve(import.meta.dirname, '..', '..');
const pageUrl = pathToFileURL(join(root, 'dist-web', 'India2Actual.html')).href;

const CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '12/03/2025,UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA,725.00,,"9,275.00"',
  '13/03/2025,UPI/412345678903/9876543210@ybl/PAY,,430.00,"9,705.00"',
  '',
].join('\n');

let server: TestServer;
let folder: string;
let budget: Budget;

function file(name: string, contents: string): string {
  const path = join(folder, name);
  writeFileSync(path, contents);
  return path;
}

async function tryConnect(page: Page, password = server.password) {
  await page.getByLabel('Server address').fill(server.url);
  await page.getByLabel('Server password').fill(password);
  await page.getByLabel('Sync ID', { exact: true }).fill(budget.syncId);
  await page.getByRole('button', { name: 'Connect' }).click();
}

async function connect(page: Page) {
  await tryConnect(page);
  await expect(page.getByText(/^Connected to/)).toBeVisible({ timeout: 30_000 });
}

const upload = (page: Page, path: string) =>
  page.locator('.drop input[type=file]').setInputFiles(path);

test.beforeAll(async () => {
  test.setTimeout(180_000);
  folder = mkdtempSync(join(tmpdir(), 'india2actual-push-'));
  server = await TestServer.start();
});

test.afterAll(() => {
  server?.stop();
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(120_000);
  budget = await server.newBudget();
  await page.addInitScript(() => {
    (window as unknown as { __blocked: string[] }).__blocked = [];
    document.addEventListener('securitypolicyviolation', event => {
      (window as unknown as { __blocked: string[] }).__blocked.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  await page.goto(pageUrl);
});

test.describe('the push file', () => {
  test('carries a policy that allows only https and this computer', async ({ page }) => {
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(policy).toContain('connect-src https: http://localhost:*');
    expect(policy).toContain("'wasm-unsafe-eval'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toMatch(/unsafe-eval(?!')/);
    expect(policy).not.toContain("'unsafe-eval'");

    const outcome = await page.evaluate(async () => {
      try {
        await fetch('http://example.com/');
        return 'sent';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
  });

  test('keeps no sign-in, since a page opened from disk is no place for a secret', async ({ page }) => {
    await expect(page.getByLabel(/Stay connected/)).toHaveCount(0);
    await tryConnect(page);
    await expect(page.getByText(/^Connected to/)).toBeVisible({ timeout: 30_000 });

    expect(
      await page.evaluate(() => window.localStorage.getItem('india2actual.signin.v1')),
    ).toBeNull();
  });

  test('refuses an http address that is not on this computer', async ({ page }) => {
    await page.getByLabel('Server address').fill('http://192.168.1.20:5006');
    await page.getByLabel('Server password').fill('anything');
    await page.getByLabel('Sync ID', { exact: true }).fill('some-id');
    await page.getByRole('button', { name: 'Connect' }).click();

    await expect(page.locator('.notice.error')).toContainText('https');
  });

  test('says when the password is wrong', async ({ page }) => {
    await tryConnect(page, 'not-the-password');

    await expect(page.locator('.notice.error')).toContainText('did not accept');
  });

  test('connects, lists the accounts and pushes a statement', async ({ page }) => {
    await connect(page);
    await expect(page.getByText('Connected to')).toBeVisible();

    await upload(page, file('statement.csv', CSV));
    await page.locator('summary', { hasText: 'Options' }).click();
    await page.getByLabel(/Add a Starting Balance row/).check();

    await page.getByLabel('Import into', { exact: true }).selectOption({ label: 'Acme Savings' });
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('An import would add or change: 3 new')).toBeVisible();

    await page.getByRole('button', { name: /^Push 3 rows/ }).click();
    await expect(page.getByText('Imported into Acme Savings: 3 new')).toBeVisible();
    await expect(page.locator('.reconcile.ok')).toContainText('They match');

    const stored = await server.read(budget.syncId, budget.savings);
    expect(stored.transactions.map(row => row.amount).sort((a, b) => a - b)).toEqual([
      -72500, 43000, 1000000,
    ]);
    expect(
      await page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked),
    ).toEqual([]);
  });

  test('imports the same statement twice without duplicates', async ({ page }) => {
    await connect(page);
    await upload(page, file('statement.csv', CSV));
    await page.getByLabel('Import into', { exact: true }).selectOption({ label: 'Acme Savings' });

    await page.getByRole('button', { name: /^Push 2 rows/ }).click();
    await expect(page.getByText('Imported into Acme Savings: 2 new')).toBeVisible();
    await page.getByRole('button', { name: /^Push 2 rows/ }).click();
    await expect(page.getByText('Imported into Acme Savings: 0 new')).toBeVisible();

    expect((await server.read(budget.syncId, budget.savings)).transactions).toHaveLength(2);
  });

  test('undoes the last import', async ({ page }) => {
    await connect(page);
    await upload(page, file('statement.csv', CSV));
    await page.getByLabel('Import into', { exact: true }).selectOption({ label: 'Acme Savings' });
    await page.getByRole('button', { name: /^Push 2 rows/ }).click();
    await expect(page.getByText('Imported into Acme Savings: 2 new')).toBeVisible();

    await page.getByRole('button', { name: /Undo: remove the 2 added/ }).click();

    await expect(page.getByText('Removed 2 transactions')).toBeVisible();
    expect((await server.read(budget.syncId, budget.savings)).transactions).toHaveLength(0);
  });

  test('sets a category, makes an Actual rule, and reuses the name', async ({ page }) => {
    await connect(page);
    await upload(page, file('statement.csv', CSV));
    const review = page.locator('section[aria-label="Payees to review"]');

    await review.getByPlaceholder('Name it').first().fill('Neighbourhood Kirana');
    await review.getByLabel(/Category for/).selectOption({ label: 'Groceries' });
    await review.getByRole('button', { name: 'Apply' }).first().click();
    await page.getByLabel('Import into', { exact: true }).selectOption({ label: 'Acme Savings' });
    await page.getByRole('button', { name: /^Push 2 rows/ }).click();
    await expect(page.getByText(/Created 1 Actual rule/)).toBeVisible();

    const stored = await server.read(budget.syncId, budget.savings);
    const kirana = stored.transactions.find(row => row.amount === 43000);
    expect(kirana?.category).toBe(budget.groceries);
    expect(stored.rules).toHaveLength(1);
  });

  test('sends a card payment to the other account as a transfer', async ({ page }) => {
    const bank = [
      'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '10/03/2025,AUTODEBITCC 4000XXXXXXXX0000,"1,500.00",,"8,500.00"',
      '',
    ].join('\n');
    await connect(page);
    await upload(page, file('bank.csv', bank));
    await page.getByLabel('Import into', { exact: true }).selectOption({ label: 'Acme Savings' });
    await page.getByLabel(/Send card payments as transfers/).selectOption({ label: 'Acme Card' });

    await page.getByRole('button', { name: /^Push 1 row/ }).click();
    await expect(page.getByText('Imported into Acme Savings: 1 new')).toBeVisible();

    const card = await server.read(budget.syncId, budget.card);
    expect(card.transactions.map(row => row.amount)).toEqual([150000]);
  });
});
