import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

import { consolidatedLines } from '../../src/testing/fixtures.js';
import { pdfFromLines } from '../../src/testing/pdf.js';

import { TestServer } from './actual-server.js';
import type { Budget } from './actual-server.js';

const root = resolve(import.meta.dirname, '..', '..');
const extensionPath = join(root, 'dist-extension');

const CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '12/03/2025,UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA,725.00,,"9,275.00"',
  '13/03/2025,UPI/412345678903/9876543210@ybl/PAY,,430.00,"9,705.00"',
  '',
].join('\n');

let server: TestServer;
let folder: string;
let budget: Budget;
let context: BrowserContext;
let extensionId: string;
let panel: Page;

function file(name: string, contents: string | Uint8Array): string {
  const path = join(folder, name);
  writeFileSync(path, contents);
  return path;
}

const upload = (page: Page, path: string) =>
  page.locator('.drop input[type=file]').setInputFiles(path);

async function connect(page: Page) {
  await page.getByLabel('Server address').fill(server.url);
  await page.getByLabel('Server password').fill(server.password);
  await page.getByLabel('Sync ID', { exact: true }).fill(budget.syncId);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/^Connected to/)).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  folder = mkdtempSync(join(tmpdir(), 'india2actual-extension-'));
  server = await TestServer.start();
});

test.afterAll(() => {
  server?.stop();
});

test.beforeEach(async () => {
  test.setTimeout(120_000);
  budget = await server.newBudget();
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'profile-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 20_000 });
  extensionId = new URL(worker.url()).host;
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
});

test.afterEach(async () => {
  await context.close();
});

test.describe('the side panel extension', () => {
  test('loads, opens its panel from the toolbar icon and asks for little', async () => {
    const [worker] = context.serviceWorkers();
    const behaviour = await worker?.evaluate(() => chrome.sidePanel.getPanelBehavior());
    const manifest = await worker?.evaluate(() => chrome.runtime.getManifest());

    expect(behaviour).toEqual({ openPanelOnActionClick: true });
    expect(manifest?.permissions).toEqual(['sidePanel']);
    expect(manifest?.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect(manifest?.optional_host_permissions).toEqual(['https://*/*']);
    await expect(panel.locator('h1')).toHaveText('India2Actual');
  });

  test('reads a CSV and a PDF with two accounts under the extension policy', async () => {
    await upload(panel, file('statement.csv', CSV));
    await expect(panel.locator('.check-item.passed').first()).toBeVisible();

    await upload(panel, file('all.pdf', pdfFromLines(consolidatedLines())));
    await expect(panel.locator('article.card')).toHaveCount(3);
    await expect(panel.getByRole('heading', { name: 'Account ending 2222' })).toBeVisible();
  });

  test('cannot reach a plain http address that is not on this computer', async () => {
    const outcome = await panel.evaluate(async () => {
      try {
        await fetch('http://example.com/');
        return 'sent';
      } catch {
        return 'blocked';
      }
    });

    expect(outcome).toBe('blocked');
  });

  test('connects and pushes into the account you choose', async () => {
    await connect(panel);
    await upload(panel, file('statement.csv', CSV));
    await panel.getByLabel('Import into', { exact: true }).selectOption({ label: 'Acme Savings' });

    await panel.getByRole('button', { name: /^Push 2 rows/ }).click();

    await expect(panel.getByText('Imported into Acme Savings: 2 new')).toBeVisible();
    expect((await server.read(budget.syncId, budget.savings)).transactions).toHaveLength(2);
  });

  test('follows the account open in the Actual tab', async () => {
    const actual = await context.newPage();
    await actual.route(`${server.url}/accounts/**`, route =>
      route.fulfill({ contentType: 'text/html', body: '<title>Actual</title>' }),
    );
    await actual.goto(`${server.url}/accounts/${budget.savings}`);
    await panel.bringToFront();

    await connect(panel);
    await upload(panel, file('statement.csv', CSV));

    await expect(panel.getByText('Actual is showing Acme Savings.')).toBeVisible();
    await expect(panel.getByLabel('Import into', { exact: true })).toHaveValue(budget.savings);

    // Moving to another account in Actual updates the hint without replacing a choice.
    await actual.goto(`${server.url}/accounts/${budget.card}`);
    await expect(panel.getByText('Actual is showing Acme Card.')).toBeVisible();
    await expect(panel.getByLabel('Import into', { exact: true })).toHaveValue(budget.savings);

    await panel.getByRole('button', { name: 'Use it' }).click();
    await expect(panel.getByLabel('Import into', { exact: true })).toHaveValue(budget.card);
  });

  test('does not guess an account for a statement with several', async () => {
    const actual = await context.newPage();
    await actual.route(`${server.url}/accounts/**`, route =>
      route.fulfill({ contentType: 'text/html', body: '<title>Actual</title>' }),
    );
    await actual.goto(`${server.url}/accounts/${budget.savings}`);
    await panel.bringToFront();

    await connect(panel);
    await upload(panel, file('all.pdf', pdfFromLines(consolidatedLines())));

    await expect(panel.locator('article.card').first().getByLabel('Import into', { exact: true })).toHaveValue('');
  });
});
