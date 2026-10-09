import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';

import { consolidatedLines } from '../../src/testing/fixtures.js';
import { pdfFromLines } from '../../src/testing/pdf.js';

const root = resolve(import.meta.dirname, '..', '..');
const pageUrl = pathToFileURL(join(root, 'dist-web', 'india2actual-convert.html')).href;

const CSV = [
  'Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '12/03/2025,UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA,725.00,,"9,275.00"',
  '13/03/2025,UPI/412345678903/9876543210@ybl/PAY,,430.00,"9,705.00"',
  '',
].join('\n');

let folder: string;

function file(name: string, contents: string | Uint8Array): string {
  const path = join(folder, name);
  writeFileSync(path, contents);
  return path;
}

const upload = (page: Page, path: string) =>
  page.locator('.drop input[type=file]').setInputFiles(path);

async function download(page: Page): Promise<{ name: string; text: string }> {
  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download CSV/ }).first().click(),
  ]);
  return {
    name: saved.suggestedFilename(),
    text: readFileSync(await saved.path(), 'utf8'),
  };
}

const blocked = (page: Page) =>
  page.evaluate(() => (window as unknown as { __blocked: string[] }).__blocked);

test.beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'india2actual-web-'));
});

test.beforeEach(async ({ page }) => {
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

test.describe('the convert page', () => {
  test('opens with no policy violations and shows the privacy promise', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('india2actual');
    await expect(page.locator('.privacy')).toContainText('not uploaded');
    expect(await blocked(page)).toEqual([]);
  });

  test('converts a CSV statement, checks it and downloads the CSV', async ({ page }) => {
    await upload(page, file('statement.csv', CSV));

    await expect(page.locator('.check-item.passed').first()).toContainText('Balance check');
    await expect(page.locator('.rows tbody tr')).toHaveCount(2);

    const saved = await download(page);
    expect(saved.name).toBe('statement.actual.csv');
    expect(saved.text).toContain('Date,Payee,Notes,Amount,Reference');
    expect(saved.text).toContain('Acme Store Pune');
    expect(saved.text).toContain('-725.00');
  });

  test('reads an Excel workbook', async ({ page }) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Statement');
    sheet.addRow(['Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
    sheet.addRow(['12/03/2025', 'UPI-ACME STORE PUNE-acmestore@ybl-412345678901-NA', '725.00', '', '9275.00']);
    sheet.addRow(['13/03/2025', 'UPI/412345678903/9876543210@ybl/PAY', '', '430.00', '9705.00']);
    const path = file('statement.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()));

    await upload(page, path);

    await expect(page.locator('.check-item.passed').first()).toBeVisible();
    await expect(page.locator('.rows tbody tr')).toHaveCount(2);
  });

  test('reads each account of a PDF and names the files by account digits', async ({ page }) => {
    await upload(page, file('consolidated.pdf', pdfFromLines(consolidatedLines())));

    await expect(page.locator('article.card')).toHaveCount(2);
    await expect(page.locator('article.card').first()).toContainText('Account ending 1111');

    const [saved] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('article.card').nth(1).getByRole('button', { name: /Download CSV/ }).click(),
    ]);
    expect(saved.suggestedFilename()).toBe('consolidated.2222.actual.csv');
  });

  test('asks for a password and then reads the PDF', async ({ page }) => {
    await upload(
      page,
      file(
        'locked.pdf',
        pdfFromLines(consolidatedLines(), { password: 'not-a-real-password' }),
      ),
    );

    await expect(page.getByText('This PDF is password protected.')).toBeVisible();
    await page.getByLabel('Statement password').fill('wrong');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText('That password did not open the file.')).toBeVisible();

    await page.getByLabel('Statement password').fill('not-a-real-password');
    await page.getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('article.card')).toHaveCount(2);
  });

  test('lets you name an unclear payee and uses the name in the download', async ({ page }) => {
    await upload(page, file('statement.csv', CSV));
    const review = page.locator('section[aria-label="Payees to review"]');
    await expect(review).toContainText('9876543210@ybl');

    await review.getByPlaceholder('Name it').first().fill('Neighbourhood Kirana');
    await review.getByRole('button', { name: 'Apply' }).first().click();

    await expect(review).toContainText('Every payee looks clear');
    expect((await download(page)).text).toContain('Neighbourhood Kirana');
  });

  test('remembers a name for the next statement', async ({ page }) => {
    await upload(page, file('statement.csv', CSV));
    const review = page.locator('section[aria-label="Payees to review"]');
    await review.getByPlaceholder('Name it').first().fill('Neighbourhood Kirana');
    await review.getByRole('button', { name: 'Apply' }).first().click();

    await page.reload();
    await upload(page, file('statement.csv', CSV));

    await expect(page.locator('section[aria-label="Payees to review"]')).toContainText(
      'Every payee looks clear',
    );
    await expect(page.locator('.rows tbody')).toContainText('Neighbourhood Kirana');
  });

  test('adds a starting balance row on request', async ({ page }) => {
    await upload(page, file('statement.csv', CSV));
    await page.locator('summary', { hasText: 'Options' }).click();
    await page.getByLabel(/Add a Starting Balance row/).check();

    await expect(page.locator('.rows tr.opening')).toContainText('Starting Balance');
    const saved = await download(page);
    expect(saved.text).toContain('Starting Balance');
    expect(saved.text).toContain('10000.00');
  });

  test('leaves out a row you untick', async ({ page }) => {
    await upload(page, file('statement.csv', CSV));

    await page.getByLabel(/Include 2025-03-12/).uncheck();
    const saved = await download(page);

    expect(saved.text).not.toContain('Acme Store Pune');
    expect(saved.text).toContain('9876543210');
  });

  test('will not offer the file after a failed check until you say so', async ({ page }) => {
    await upload(page, file('broken.csv', CSV.replace('9,705.00', '9,000.00')));

    const button = page.getByRole('button', { name: /Download CSV/ });
    await expect(page.locator('.check-item.failed').first()).toBeVisible();
    await expect(button).toBeDisabled();

    await page.getByLabel(/A check failed/).check();
    await expect(button).toBeEnabled();
  });

  test('explains a file it cannot read', async ({ page }) => {
    await upload(
      page,
      file('old.xls', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    );

    await expect(page.locator('.notice.error')).toContainText('not supported');
  });

  test('shows a masked report that carries no statement text', async ({ page }) => {
    await upload(page, file('statement.csv', CSV));

    await page.getByRole('button', { name: /masked report/ }).click();

    // A bare test browser refuses clipboard access, so the text is shown instead.
    const text = await page.locator('textarea').inputValue();
    expect(text).toContain('layout report');
    expect(text).not.toContain('ACME');
    expect(text).not.toContain('9876543210');
  });
});

test.describe('the theme', () => {
  const paper = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test('follows the system, and a saved choice wins over it', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await paper(page);
    await page.getByLabel('Theme').selectOption('light');
    const light = await paper(page);
    expect(light).not.toBe(dark);
    await page.reload();
    await expect(page.getByLabel('Theme')).toHaveValue('light');
    expect(await paper(page)).toBe(light);
    await page.getByLabel('Theme').selectOption('system');
    expect(await paper(page)).toBe(dark);
  });

  test('dark can be chosen on a light system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const light = await paper(page);
    await page.getByLabel('Theme').selectOption('dark');
    expect(await paper(page)).not.toBe(light);
  });
});

test.describe('the network policy', () => {
  test('carries a policy that forbids every request', async ({ page }) => {
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  test('blocks a request to anywhere', async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/');
        return 'sent';
      } catch {
        return 'blocked';
      }
    });

    expect(outcome).toBe('blocked');
    expect(await blocked(page)).toContainEqual(expect.stringContaining('connect-src'));
  });

  test('loads no script, style or image from outside the file', async ({ page }) => {
    const external = await page.evaluate(
      () => document.querySelectorAll('script[src], link[href], img[src], iframe').length,
    );

    expect(external).toBe(0);
  });
});
